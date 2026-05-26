import { describe, expect, it } from "bun:test";
import { predictGame, reconcileProjectionToFinal } from "../index";
import { buildCanonicalPredictionResult, normalizeCanonicalProbabilities } from "../canonical";
import { buildMarketConsensusFromGameOdds } from "../market";
import type { GameContext, SimulationProjection } from "../types";
import type { Game, Team } from "../../types/sports";
import { GameStatus, League, Sport } from "../../types/sports";

function makeTeam(id: string, abbreviation: string, wins: number, losses: number): Team {
  return {
    id,
    name: abbreviation === "HOM" ? "Home" : "Away",
    abbreviation,
    logo: "",
    record: { wins, losses },
  };
}

function makeNBAContext(overrides: Partial<GameContext> = {}): GameContext {
  const home = makeTeam("1", "HOM", 44, 22);
  const away = makeTeam("2", "AWY", 28, 38);
  const game: Game = {
    id: "nba-canonical-1",
    sport: Sport.NBA,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-04-16T19:00Z",
    venue: "Arena",
    tvChannel: "",
    status: GameStatus.Scheduled,
  };

  return {
    game,
    sport: "NBA",
    homeElo: 1540,
    awayElo: 1510,
    homeForm: { results: ["W", "W", "L"], formString: "W-W-L", streak: 1, avgScore: 116, avgAllowed: 110, wins: 2, losses: 1 },
    awayForm: { results: ["L", "W", "L"], formString: "L-W-L", streak: -1, avgScore: 108, avgAllowed: 114, wins: 1, losses: 2 },
    homeExtended: { homeRecord: { wins: 25, losses: 8 }, awayRecord: { wins: 19, losses: 14 }, lastGameDate: "2026-04-13", avgScoreLast5: 116, avgScoreLast10: 115, scoringTrend: 0.1, defenseTrend: 0.1, headToHeadResults: [], strengthOfSchedule: 0.55, restDays: 3, consecutiveAwayGames: 0 },
    awayExtended: { homeRecord: { wins: 16, losses: 17 }, awayRecord: { wins: 12, losses: 21 }, lastGameDate: "2026-04-15", avgScoreLast5: 108, avgScoreLast10: 108, scoringTrend: -0.1, defenseTrend: -0.1, headToHeadResults: [], strengthOfSchedule: 0.48, restDays: 1, consecutiveAwayGames: 2 },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: { offensiveRating: 117, defensiveRating: 111 },
    awayAdvanced: { offensiveRating: 110, defensiveRating: 118 },
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-04-16",
    ...overrides,
  };
}

function projection(overrides: Partial<SimulationProjection> = {}): SimulationProjection {
  return {
    engine: "game-script-v1",
    iterations: 8000,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    projectedHomeScore: 111,
    projectedAwayScore: 104,
    projectedSpread: 7,
    projectedTotal: 215,
    volatility: 0.18,
    upsetRisk: 0.4,
    signals: [],
    ...overrides,
  };
}

describe("canonical prediction result", () => {
  it("predictGame exposes one canonical answer mirrored by legacy fields", () => {
    const result = predictGame(makeNBAContext());
    const canonical = result.canonicalResult;

    const legacyPick =
      result.predictedWinner?.teamId === "1"
        ? "home"
        : result.predictedWinner?.teamId === "2"
          ? "away"
          : "none";

    expect(canonical.eventId).toBe(result.gameId);
    expect(canonical.finalPick).toBe(legacyPick);
    expect(canonical.confidence).toBe(result.confidence);
    expect(canonical.probabilities.home).toBeCloseTo(result.homeWinProbability, 3);
    expect(canonical.probabilities.away).toBeCloseTo(result.awayWinProbability, 3);
    expect(canonical.decisionProfile?.version).toBe("unified-decision-profile-v1");
    expect(canonical.decisionProfile?.pick).toBe(canonical.finalPick);
    expect(canonical.decisionProfile?.edgeRating).toBeGreaterThanOrEqual(1);
    expect(canonical.decisionProfile?.valueRating).toBeGreaterThanOrEqual(1);
    expect(canonical.decisionProfile?.thesis.length).toBeGreaterThan(0);
    expect(canonical.engineBreakdown.map((read) => read.engine)).toContain("factor-model-v1");
    expect(canonical.engineBreakdown.map((read) => read.engine)).toContain("game-script-v1");
    expect(canonical.engineBreakdown[canonical.engineBreakdown.length - 1]?.engine).toBe("orchestrator-v1");
  });

  it("bounds and normalizes probabilities on the canonical object", () => {
    const result = predictGame(makeNBAContext({ homeElo: 1900, awayElo: 1200 }));
    const p = result.canonicalResult.probabilities;

    expect(p.home).toBeGreaterThanOrEqual(0);
    expect(p.home).toBeLessThanOrEqual(1);
    expect(p.away).toBeGreaterThanOrEqual(0);
    expect(p.away).toBeLessThanOrEqual(1);
    expect(p.home + p.away).toBeCloseTo(1, 3);
    expect(result.canonicalResult.finalProbability).toBeGreaterThanOrEqual(0);
    expect(result.canonicalResult.finalProbability).toBeLessThanOrEqual(1);
  });

  it("reports the actual coverage-dependent engine weights used by the blend", () => {
    const result = predictGame(makeNBAContext({
      marketConsensus: {
        lines: [
          {
            sportsbook: "Pinnacle",
            homeAmerican: -120,
            awayAmerican: 110,
            homeDecimal: 1.83,
            awayDecimal: 2.1,
            homeImpliedProb: 0.545,
            awayImpliedProb: 0.476,
            fetchedAt: "2026-05-21T12:00:00.000Z",
          },
          {
            sportsbook: "Book",
            homeAmerican: -118,
            awayAmerican: 108,
            homeDecimal: 1.85,
            awayDecimal: 2.08,
            homeImpliedProb: 0.541,
            awayImpliedProb: 0.481,
            fetchedAt: "2026-05-21T12:00:00.000Z",
          },
        ],
        pinnacleLine: null,
        noVigHomeProb: 0.534,
        noVigAwayProb: 0.466,
        avgHomeProb: 0.543,
        avgAwayProb: 0.479,
      },
    }));

    const reads = new Map(result.canonicalResult.engineBreakdown.map((read) => [read.engine, read]));

    expect(reads.get("factor-model-v1")?.weight).toBeCloseTo(0.76, 3);
    expect(reads.get("game-script-v1")?.weight).toBeCloseTo(0.14, 3);
    expect(reads.get("market-calibration")?.weight).toBeCloseTo(0.1, 3);
    expect(result.canonicalResult.modelInputs.marketConsensusIncluded).toBe(true);
    expect(result.canonicalResult.decisionProfile?.marketPick).toBeDefined();
    expect(result.canonicalResult.decisionProfile?.marketDelta).toBeTypeOf("number");
  });

  it("builds a market fallback from displayed ESPN odds metadata", () => {
    const market = buildMarketConsensusFromGameOdds({
      sport: "NBA",
      marketFavorite: "away",
      spread: 2.5,
      overUnder: 222.5,
      fetchedAt: "2026-05-26T00:00:00.000Z",
    });

    expect(market).not.toBeNull();
    expect(market?.source).toBe("espn-odds");
    expect(market?.sourceLabel).toBe("ESPN odds fallback");
    expect(market?.isFallback).toBe(true);
    expect(market?.marketFavorite).toBe("away");
    expect(market?.spread).toBe(2.5);
    expect(market?.overUnder).toBe(222.5);
    expect(market?.noVigAwayProb ?? 0).toBeGreaterThan(market?.noVigHomeProb ?? 1);
    expect((market?.noVigHomeProb ?? 0) + (market?.noVigAwayProb ?? 0)).toBeCloseTo(1, 3);
  });

  it("includes ESPN odds fallback as market calibration and flags market disagreement", () => {
    const market = buildMarketConsensusFromGameOdds({
      sport: "NBA",
      marketFavorite: "away",
      spread: 2.5,
      overUnder: 222.5,
      fetchedAt: "2026-05-26T00:00:00.000Z",
    });
    const result = predictGame(makeNBAContext({
      marketConsensus: market,
      marketFavorite: "away",
      marketSpread: 2.5,
      marketOverUnder: 222.5,
    }));
    const reads = new Map(result.canonicalResult.engineBreakdown.map((read) => [read.engine, read]));

    expect(result.canonicalResult.modelInputs.marketConsensusIncluded).toBe(true);
    expect(reads.get("market-calibration")?.inputs?.source).toBe("ESPN odds fallback");
    expect(reads.get("market-calibration")?.inputs?.fallback).toBe(true);
    expect(result.dataSources).toContain("ESPN odds fallback");
    expect(result.canonicalResult.decisionProfile?.marketPick).toBe("away");
    expect(result.canonicalResult.decisionProfile?.tags).toContain("market-disagreement");
  });

  it("reconciles public projection probabilities and score to the final pick", () => {
    const reconciled = reconcileProjectionToFinal({
      sport: "NBA",
      projection: projection({
        homeWinProbability: 0.42,
        awayWinProbability: 0.58,
        projectedHomeScore: 99,
        projectedAwayScore: 103,
        projectedSpread: -4,
        projectedTotal: 202,
      }),
      finalProbabilities: { home: 0.64, away: 0.36 },
    });

    expect(reconciled.homeWinProbability).toBeCloseTo(0.64, 3);
    expect(reconciled.awayWinProbability).toBeCloseTo(0.36, 3);
    expect(reconciled.projectedSpread).toBeGreaterThan(0);
    expect(reconciled.projectedHomeScore).toBeGreaterThan(reconciled.projectedAwayScore);
    expect(reconciled.signals[0]?.key).toBe("orchestrator-projection-reconciliation");
  });

  it("preserves sub-engine disagreement while returning one final orchestrator pick", () => {
    const ctx = makeNBAContext();
    const canonical = buildCanonicalPredictionResult({
      ctx,
      factors: [],
      factorProbabilities: normalizeCanonicalProbabilities({ home: 0.7, away: 0.3 }),
      projection: projection({
        homeWinProbability: 0.42,
        awayWinProbability: 0.58,
        projectedHomeScore: 99,
        projectedAwayScore: 103,
        projectedSpread: -4,
      }),
      finalProbabilities: normalizeCanonicalProbabilities({ home: 0.64, away: 0.36 }),
      confidence: 64,
      generatedAt: "2026-05-21T12:00:00.000Z",
      modelVersion: "test",
      blendedProbabilities: normalizeCanonicalProbabilities({ home: 0.64, away: 0.36 }),
    });

    expect(canonical.finalPick).toBe("home");
    expect(canonical.engineBreakdown.find((read) => read.engine === "game-script-v1")?.pick).toBe("away");
    expect(canonical.engineBreakdown[canonical.engineBreakdown.length - 1]?.pick).toBe("home");
    expect(canonical.reconciliation.notes.join(" ")).toContain("disagreement");
  });
});
