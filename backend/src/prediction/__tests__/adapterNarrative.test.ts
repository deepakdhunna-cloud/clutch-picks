/**
 * Tests for buildAdapterNarrative — the synchronous narrative hook that
 * runs in runNewEnginePrediction before the HonestPrediction is translated
 * into the API's GamePrediction shape.
 *
 * Regression guard: before this wire-up, analysis always came back as ""
 * for every game on the new engine path.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  buildAdapterNarrative,
  translateNewEnginePrediction,
  enrichPredictionWithLLMNarrative,
  __resetLLMEnrichmentDedupeForTests,
} from "../newEngineAdapter";
import {
  __setLLMClientForTests,
  __resetRateWindowForTests,
  type LLMClient,
} from "../llmNarrative";
import {
  __resetNarrativeCacheForTests,
  putCachedLLMNarrative,
  computeVersionHash,
} from "../narrativeCache";
import type {
  CanonicalPredictionResult,
  HonestPrediction,
  FactorContribution,
  GameContext,
} from "../types";
import type { Game, GamePrediction } from "../../routes/games";

function makeGame(): Game {
  return {
    id: "g1",
    sport: "NBA",
    homeTeam: { id: "1", name: "Boston Celtics", abbreviation: "BOS", logo: "", record: "45-30", primaryColor: "#000", secondaryColor: "#fff" } as any,
    awayTeam: { id: "2", name: "Philadelphia 76ers", abbreviation: "PHI", logo: "", record: "30-45", primaryColor: "#000", secondaryColor: "#fff" } as any,
    gameTime: "2026-04-21T19:00Z",
    status: "SCHEDULED",
    venue: "TD Garden",
  };
}

function makeCanonicalResult(args: {
  eventId: string;
  sport: string;
  finalPick: "home" | "away" | "draw" | "none";
  home: number;
  away: number;
  draw?: number;
  confidence: number;
  marketType?: "moneyline" | "three_way_result";
}): CanonicalPredictionResult {
  const finalProbability =
    args.finalPick === "draw"
      ? args.draw ?? 0
      : args.finalPick === "away"
        ? args.away
        : Math.max(args.home, args.away, args.draw ?? 0);
  return {
    eventId: args.eventId,
    marketType: args.marketType ?? "moneyline",
    finalPick: args.finalPick,
    finalProbability,
    confidence: args.confidence,
    probabilities: args.draw !== undefined
      ? { home: args.home, away: args.away, draw: args.draw }
      : { home: args.home, away: args.away },
    modelInputs: {
      sport: args.sport,
      homeTeamId: "1",
      awayTeamId: "2",
      gameTime: "2026-04-21T19:00Z",
      factorCount: 0,
      availableFactorCount: 0,
      marketConsensusIncluded: false,
    },
    engineBreakdown: [],
    reconciliation: { method: "test", notes: [] },
    timestamp: "2026-04-21T12:00:00.000Z",
    dataVersion: "test",
    warnings: [],
  };
}

function makePred(overrides: Partial<HonestPrediction> & { factors: FactorContribution[] }): HonestPrediction {
  const canonicalResult = overrides.canonicalResult ?? makeCanonicalResult({
    eventId: "g1",
    sport: "NBA",
    finalPick: "home",
    home: 0.78,
    away: 0.22,
    confidence: 78,
  });
  return {
    gameId: "g1",
    league: "NBA",
    predictedWinner: { teamId: "1", abbr: "BOS" },
    homeWinProbability: 0.78,
    awayWinProbability: 0.22,
    confidence: 78.0,
    confidenceBand: "strong edge",
    narrative: "",
    modelVersion: "test",
    generatedAt: new Date().toISOString(),
    dataSources: [],
    unavailableFactors: [],
    ...overrides,
    canonicalResult,
  };
}

describe("buildAdapterNarrative", () => {
  it("produces a non-empty narrative when multiple factors have signal", () => {
    const factors: FactorContribution[] = [
      { key: "rating_diff", label: "Elo rating differential", homeDelta: 220, weight: 0.40, available: true, hasSignal: true, evidence: "Home BOS Elo 1561 + 100 HFA vs Away PHI Elo 1441 = 220 pt differential" },
      { key: "injuries_nba", label: "Star player availability", homeDelta: 60, weight: 0.19, available: true, hasSignal: true, evidence: "PHI: Joel Embiid (C) OUT" },
      { key: "net_rating", label: "Pace-adjusted net rating", homeDelta: 30, weight: 0.11, available: true, hasSignal: true, evidence: "Home net rating +4.0 vs Away net rating +0.5" },
    ];
    const narrative = buildAdapterNarrative(makePred({ factors }), "NBA", makeGame());

    expect(narrative.length).toBeGreaterThan(40);
    expect(narrative).toContain("Boston Celtics");
    // Lead factor evidence is rendered conversationally, not dumped raw.
    expect(narrative).toContain("220");
    expect(narrative).not.toContain("Elo");
    expect(narrative).not.toContain("Home BOS Elo");
    // No "" fallback.
    expect(narrative.trim()).not.toBe("");
  });

  it("produces Elo-only narrative with explicit no-signal note on light-data nights", () => {
    // Simulates a post-blendFactors state where all non-Elo factors were
    // pooled to weight=0 / hasSignal=false. rating_diff carries the pick.
    const factors: FactorContribution[] = [
      { key: "rating_diff", label: "Elo rating differential", homeDelta: 220, weight: 1.0, available: true, hasSignal: true, evidence: "Home BOS Elo 1561 + 100 HFA vs Away PHI Elo 1441 = 220 pt differential" },
      { key: "injuries_nba", label: "Star player availability", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "No significant injuries reported for either team" },
      { key: "back_to_back", label: "Back-to-back fatigue", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "No back-to-back for either team" },
      { key: "net_rating", label: "Pace-adjusted net rating", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "Offensive/defensive rating data unavailable from ESPN" },
    ];
    const narrative = buildAdapterNarrative(makePred({ factors }), "NBA", makeGame());

    expect(narrative).toContain("Boston Celtics");
    expect(narrative).not.toContain("Elo");
    expect(narrative.toLowerCase()).toMatch(/not a ton of extra context|rides on that one main edge/);
  });

  it("produces a valid narrative even for a pick'em (winner=null)", () => {
    const factors: FactorContribution[] = [
      { key: "rating_diff", label: "Elo rating differential", homeDelta: 0, weight: 0.40, available: true, hasSignal: true, evidence: "Home Elo 1500 + 100 HFA vs Away Elo 1600 = 0 pt differential" },
    ];
    const pred = makePred({
      factors,
      predictedWinner: null,
      homeWinProbability: 0.50,
      awayWinProbability: 0.50,
      confidence: 50.0,
      confidenceBand: "coinflip",
    });
    const narrative = buildAdapterNarrative(pred, "NBA", makeGame());
    expect(narrative.length).toBeGreaterThan(20);
    expect(narrative.toLowerCase()).toMatch(/coin flip|toss-up|no clear edge/);
  });

  it("threads real injury context into the deterministic fallback", () => {
    const factors: FactorContribution[] = [
      { key: "rating_diff", label: "Elo rating differential", homeDelta: 220, weight: 0.40, available: true, hasSignal: true, evidence: "Home BOS Elo 1561 + 100 HFA vs Away PHI Elo 1441 = 220 pt differential" },
      { key: "net_rating", label: "Pace-adjusted net rating", homeDelta: 30, weight: 0.11, available: true, hasSignal: true, evidence: "Home net rating +4.0 vs Away net rating +0.5" },
    ];
    const narrative = buildAdapterNarrative(
      makePred({ factors }),
      "NBA",
      makeGame(),
      [
        {
          name: "Joel Embiid",
          team: "PHI",
          position: "C",
          status: "Out",
          reason: "knee injury management",
        },
      ],
    );

    expect(narrative).toContain("Joel Embiid");
    expect(narrative).toContain("PHI");
    expect(narrative.toLowerCase()).toContain("out");
    expect(narrative.toLowerCase()).toContain("knee injury management");
  });

  it("adds season context to the game-card analysis source", () => {
    const factors: FactorContribution[] = [
      { key: "rating_diff", label: "Elo rating differential", homeDelta: 220, weight: 0.40, available: true, hasSignal: true, evidence: "Home BOS Elo 1561 + 100 HFA vs Away PHI Elo 1441 = 220 pt differential" },
      { key: "net_rating", label: "Pace-adjusted net rating", homeDelta: 30, weight: 0.11, available: true, hasSignal: true, evidence: "Home net rating +4.0 vs Away net rating +0.5" },
    ];
    const game = {
      ...makeGame(),
      seasonContext: {
        phase: "playoffs" as const,
        label: "NBA playoff window",
        detail: "This falls in the NBA playoff window, so the pick should lean on repeatable matchup edges instead of generic regular-season form.",
        source: "date" as const,
      },
    };

    const narrative = buildAdapterNarrative(makePred({ factors }), "NBA", game);

    expect(narrative.toLowerCase()).toContain("playoff");
    expect(narrative.toLowerCase()).toContain("repeatable matchup edges");
  });
});

describe("translateNewEnginePrediction", () => {
  it("wires unified decision profile ratings into legacy API fields", () => {
    const canonicalResult = makeCanonicalResult({
      eventId: "g1",
      sport: "NBA",
      finalPick: "home",
      home: 0.64,
      away: 0.36,
      confidence: 64,
    });
    canonicalResult.decisionProfile = {
      version: "unified-decision-profile-v1",
      pick: "home",
      probability: 0.64,
      confidence: 64,
      dataCoverage: 0.82,
      signalCoverage: 0.64,
      agreementScore: 86,
      hiddenEdgeScore: 71,
      upsetScore: 42,
      riskScore: 35,
      edgeRating: 8,
      valueRating: 7,
      lowDataWarning: false,
      engineDivergence: true,
      factorPick: "home",
      projectionPick: "home",
      marketPick: "away",
      marketDelta: 0.09,
      tags: ["model-consensus", "hidden-edge", "market-disagreement"],
      thesis: ["Unified read: home at 64%."],
      watchouts: ["Outside consensus leans away."],
    };
    const prediction = makePred({
      factors: makeFactorsForEnrichment(),
      canonicalResult,
      confidence: 64,
      homeWinProbability: 0.64,
      awayWinProbability: 0.36,
    });

    const translated = translateNewEnginePrediction(makeGame(), prediction, 0, 0, makeMLBCtx());

    expect(translated.edgeRating).toBe(8);
    expect(translated.valueRating).toBe(7);
    expect(translated.lowDataWarning).toBe(false);
    expect(translated.ensembleDivergence).toBe(true);
  });

  it("does not hide a real three-way soccer leader below binary 53 percent", () => {
    const canonicalResult = makeCanonicalResult({
      eventId: "g1",
      sport: "EPL",
      finalPick: "home",
      home: 0.42,
      draw: 0.29,
      away: 0.29,
      confidence: 42,
      marketType: "three_way_result",
    });
    const prediction = makePred({
      factors: makeFactorsForEnrichment(),
      canonicalResult,
      confidence: 42,
      homeWinProbability: 0.42,
      awayWinProbability: 0.29,
      drawProbability: 0.29,
    });

    const translated = translateNewEnginePrediction(
      { ...makeGame(), sport: "EPL" },
      prediction,
      0,
      0,
      makeMLBCtx(),
    );

    expect(translated.predictedOutcome).toBe("home");
    expect(translated.confidence).toBe(42);
    expect(translated.isTossUp).toBe(false);
  });
});

// ─── LLM enrichment orchestration ──────────────────────────────────────
//
// Drives enrichPredictionWithLLMNarrative synchronously (no setImmediate)
// to exercise the cache-check → LLM-call → mutate-prediction pipeline
// without spinning up a real DB or OpenAI endpoint.

const SAMPLE_NARRATIVE =
  "Detroit's the pick because the pitching matchup gives them the cleanest path into this game tonight. Keider Montero brings the better full profile with a 3.12 ERA and 1.70 FIP against Kyle Harrison's 2.87 ERA but 3.63 FIP. The Tigers also have the form edge, sitting 8-2 over their last 10 while Milwaukee is 4-6. The one concern is rest, since Milwaukee comes in fresher with Detroit turning around quicker after its last game. Still, the main baseball reasons point to Detroit.";

function makeFactorsForEnrichment(): FactorContribution[] {
  return [
    {
      key: "rating_diff",
      label: "Elo rating differential",
      homeDelta: 50,
      weight: 0.40,
      available: true,
      hasSignal: true,
      evidence: "Home DET Elo 1505 + 24 HFA vs Away MIL Elo 1518 = 11 pt differential",
    },
    {
      key: "starting_pitcher",
      label: "Starting pitcher matchup",
      homeDelta: 80,
      weight: 0.21,
      available: true,
      hasSignal: true,
      evidence: "Keider Montero (ERA 3.12, FIP 1.70) vs Kyle Harrison (ERA 2.87, FIP 3.63)",
    },
  ];
}

function makeMLBGame(): Game {
  return {
    id: "mlb-enrich-1",
    sport: "MLB",
    homeTeam: {
      id: "1",
      name: "Detroit Tigers",
      abbreviation: "DET",
      logo: "",
      record: "20-10",
      primaryColor: "#000",
      secondaryColor: "#fff",
    } as any,
    awayTeam: {
      id: "2",
      name: "Milwaukee Brewers",
      abbreviation: "MIL",
      logo: "",
      record: "14-16",
      primaryColor: "#000",
      secondaryColor: "#fff",
    } as any,
    gameTime: "2026-04-21T19:00Z",
    status: "SCHEDULED",
    venue: "Comerica Park",
  };
}

function makeMLBCtx(): GameContext {
  return {
    game: {
      id: "mlb-enrich-1",
      sport: "MLB" as any,
      league: "Pro" as any,
      homeTeam: { id: "1", name: "Detroit Tigers", abbreviation: "DET", logo: "", record: { wins: 20, losses: 10 } },
      awayTeam: { id: "2", name: "Milwaukee Brewers", abbreviation: "MIL", logo: "", record: { wins: 14, losses: 16 } },
      dateTime: "2026-04-21T19:00Z",
      venue: "Comerica Park",
      tvChannel: "ESPN",
      status: "Scheduled" as any,
    },
    sport: "MLB",
    homeElo: 1505,
    awayElo: 1518,
    homeForm: { results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0 },
    awayForm: { results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0 },
    homeExtended: { homeRecord: { wins: 0, losses: 0 }, awayRecord: { wins: 0, losses: 0 }, lastGameDate: "", avgScoreLast5: 0, avgScoreLast10: 0, scoringTrend: 0, defenseTrend: 0, headToHeadResults: [], strengthOfSchedule: 0.5, restDays: 1, consecutiveAwayGames: 0 },
    awayExtended: { homeRecord: { wins: 0, losses: 0 }, awayRecord: { wins: 0, losses: 0 }, lastGameDate: "", avgScoreLast5: 0, avgScoreLast10: 0, scoringTrend: 0, defenseTrend: 0, headToHeadResults: [], strengthOfSchedule: 0.5, restDays: 1, consecutiveAwayGames: 0 },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: {},
    awayAdvanced: {},
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-04-21",
  };
}

function makeHonestPred(): HonestPrediction {
  return {
    gameId: "mlb-enrich-1",
    league: "MLB",
    canonicalResult: makeCanonicalResult({
      eventId: "mlb-enrich-1",
      sport: "MLB",
      finalPick: "home",
      home: 0.62,
      away: 0.38,
      confidence: 62,
    }),
    predictedWinner: { teamId: "1", abbr: "DET" },
    homeWinProbability: 0.62,
    awayWinProbability: 0.38,
    confidence: 62.0,
    confidenceBand: "slight edge",
    factors: makeFactorsForEnrichment(),
    unavailableFactors: [],
    narrative: "deterministic fallback",
    modelVersion: "test",
    generatedAt: new Date().toISOString(),
    dataSources: [],
  };
}

function makeGamePrediction(): GamePrediction {
  return {
    id: "pred-mlb-enrich-1",
    gameId: "mlb-enrich-1",
    predictedWinner: "home",
    confidence: 62,
    analysis: "deterministic fallback",
    predictedSpread: 0,
    predictedTotal: 0,
    marketFavorite: "home",
    spread: 0,
    overUnder: 0,
    createdAt: new Date().toISOString(),
    homeWinProbability: 62,
    awayWinProbability: 38,
    factors: makeFactorsForEnrichment().map((f) => ({
      name: f.label,
      weight: f.weight,
      homeScore: 0.5 + Math.max(-100, Math.min(100, f.homeDelta)) / 200,
      awayScore: 1 - (0.5 + Math.max(-100, Math.min(100, f.homeDelta)) / 200),
      description: f.evidence,
    })),
    edgeRating: 0,
    valueRating: 0,
    recentFormHome: "",
    recentFormAway: "",
    homeStreak: 0,
    awayStreak: 0,
    isTossUp: false,
  };
}

function countingClient(text: string | null): { client: LLMClient; calls: () => number } {
  let n = 0;
  const client: LLMClient = {
    async complete() {
      n++;
      if (text === null) return null;
      return { text, tokensUsed: 175 };
    },
  };
  return { client, calls: () => n };
}

function delayedCountingClient(text: string): { client: LLMClient; calls: () => number } {
  let n = 0;
  const client: LLMClient = {
    async complete() {
      n++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { text, tokensUsed: 175 };
    },
  };
  return { client, calls: () => n };
}

describe("enrichPredictionWithLLMNarrative — orchestration", () => {
  beforeEach(() => {
    __resetRateWindowForTests();
    __resetNarrativeCacheForTests();
    __resetLLMEnrichmentDedupeForTests();
    process.env.OPENAI_API_KEY = "sk-test";
  });
  afterEach(() => {
    __setLLMClientForTests(null);
  });

  it("cache hit: reuses stored narrative, no OpenAI call, mutates prediction.analysis", async () => {
    const { client, calls } = countingClient(SAMPLE_NARRATIVE);
    __setLLMClientForTests(client);

    const prediction = makeGamePrediction();
    const ctx = makeMLBCtx();
    const injuries: import("../llmNarrative").InjuryListEntry[] = [];
    const versionHash = computeVersionHash(prediction, injuries);

    // Seed cache (memory layer; DB write may fail silently — we only need
    // the memory entry for the read path).
    await putCachedLLMNarrative(
      prediction.gameId,
      versionHash,
      "Cached analyst-voice narrative from a prior cycle.",
      120,
    );

    await enrichPredictionWithLLMNarrative(
      makeMLBGame(),
      ctx,
      makeHonestPred(),
      prediction,
    );

    expect(calls()).toBe(0);
    expect(prediction.analysis).toBe(
      "Cached analyst-voice narrative from a prior cycle.",
    );
  });

  it("cache miss: calls OpenAI, validates, writes cache, mutates prediction.analysis", async () => {
    const { client, calls } = countingClient(SAMPLE_NARRATIVE);
    __setLLMClientForTests(client);

    const prediction = makeGamePrediction();
    await enrichPredictionWithLLMNarrative(
      makeMLBGame(),
      makeMLBCtx(),
      makeHonestPred(),
      prediction,
    );

    expect(calls()).toBe(1);
    expect(prediction.analysis).toBe(SAMPLE_NARRATIVE);
  });

  it("dedupes concurrent cache misses for the same game/version", async () => {
    const { client, calls } = delayedCountingClient(SAMPLE_NARRATIVE);
    __setLLMClientForTests(client);

    const first = makeGamePrediction();
    const second = makeGamePrediction();
    await Promise.all([
      enrichPredictionWithLLMNarrative(
        makeMLBGame(),
        makeMLBCtx(),
        makeHonestPred(),
        first,
      ),
      enrichPredictionWithLLMNarrative(
        makeMLBGame(),
        makeMLBCtx(),
        makeHonestPred(),
        second,
      ),
    ]);

    expect(calls()).toBe(1);
    expect(first.analysis).toBe(SAMPLE_NARRATIVE);
    expect(second.analysis).toBe(SAMPLE_NARRATIVE);
  });

  it("cache miss + LLM validation fail: analysis stays on deterministic", async () => {
    const { client, calls } = countingClient("Too short. Two sentences.");
    __setLLMClientForTests(client);

    const prediction = makeGamePrediction();
    await enrichPredictionWithLLMNarrative(
      makeMLBGame(),
      makeMLBCtx(),
      makeHonestPred(),
      prediction,
    );

    expect(calls()).toBe(1);
    expect(prediction.analysis).toBe("deterministic fallback");
  });

  it("cache miss + LLM error (null): analysis stays on deterministic", async () => {
    const { client, calls } = countingClient(null);
    __setLLMClientForTests(client);

    const prediction = makeGamePrediction();
    await enrichPredictionWithLLMNarrative(
      makeMLBGame(),
      makeMLBCtx(),
      makeHonestPred(),
      prediction,
    );

    expect(calls()).toBe(1);
    expect(prediction.analysis).toBe("deterministic fallback");
  });
});
