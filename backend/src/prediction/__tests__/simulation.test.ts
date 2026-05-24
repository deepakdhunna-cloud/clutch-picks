import { describe, it, expect } from "bun:test";
import { predictGame } from "../index";
import { simulateGameProjection } from "../simulation";
import { computeBaseFactors } from "../factors/base";
import { computeTennisFactors } from "../factors/tennis";
import { blendFactors, normalizeWeightsToOne } from "../index";
import type { GameContext } from "../types";
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
    id: "nba-sim-1",
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
    homeForm: {
      results: ["W", "W", "W", "L", "W", "W", "L", "W", "W", "W"],
      formString: "W-W-W-L-W-W-L-W-W-W",
      streak: 3,
      avgScore: 122,
      avgAllowed: 111,
      wins: 8,
      losses: 2,
    },
    awayForm: {
      results: ["L", "L", "W", "L", "L", "W", "L", "L", "W", "L"],
      formString: "L-L-W-L-L-W-L-L-W-L",
      streak: -1,
      avgScore: 108,
      avgAllowed: 119,
      wins: 3,
      losses: 7,
    },
    homeExtended: {
      homeRecord: { wins: 25, losses: 8 },
      awayRecord: { wins: 19, losses: 14 },
      lastGameDate: "2026-04-13",
      avgScoreLast5: 122,
      avgScoreLast10: 122,
      scoringTrend: 0.3,
      defenseTrend: 0.2,
      headToHeadResults: [],
      strengthOfSchedule: 0.55,
      restDays: 3,
      consecutiveAwayGames: 0,
    },
    awayExtended: {
      homeRecord: { wins: 16, losses: 17 },
      awayRecord: { wins: 12, losses: 21 },
      lastGameDate: "2026-04-15",
      avgScoreLast5: 108,
      avgScoreLast10: 108,
      scoringTrend: -0.2,
      defenseTrend: -0.3,
      headToHeadResults: [],
      strengthOfSchedule: 0.48,
      restDays: 0,
      consecutiveAwayGames: 4,
    },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: {
      out: [{ name: "Away Star", position: "PG", detail: "Out" }],
      doubtful: [],
      questionable: [],
      totalOut: 1,
      totalDoubtful: 0,
      totalQuestionable: 0,
    },
    homeAdvanced: { offensiveRating: 119, defensiveRating: 111 },
    awayAdvanced: { offensiveRating: 111, defensiveRating: 119 },
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-04-16",
    ...overrides,
  };
}

function makeIPLContext(overrides: Partial<GameContext> = {}): GameContext {
  const home = {
    ...makeTeam("101", "RCB", 8, 4),
    standingsRank: 1,
    standingsPoints: 18,
    netRunRate: 1.065,
    matchesPlayed: 13,
  };
  const away = {
    ...makeTeam("102", "KKR", 6, 6),
    standingsRank: 7,
    standingsPoints: 12,
    netRunRate: -0.32,
    matchesPlayed: 13,
  };
  const game: Game = {
    id: "ipl-sim-1",
    sport: Sport.IPL,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-05-13T14:00Z",
    venue: "M. Chinnaswamy Stadium",
    tvChannel: "",
    status: GameStatus.Scheduled,
    seasonContext: {
      phase: "tournament",
      label: "IPL tournament window",
      detail: "This is IPL T20 context, so venue, recent form, batting depth, and one-match variance should matter more than a generic league read.",
      source: "date",
    },
  };

  return {
    game,
    sport: "IPL",
    homeElo: 1535,
    awayElo: 1495,
    homeForm: {
      results: ["W", "W", "L", "W", "W", "L", "W", "W"],
      formString: "W-W-L-W-W-L-W-W",
      streak: 2,
      avgScore: 176,
      avgAllowed: 162,
      wins: 6,
      losses: 2,
    },
    awayForm: {
      results: ["L", "W", "L", "W", "L", "W", "L", "W"],
      formString: "L-W-L-W-L-W-L-W",
      streak: 1,
      avgScore: 161,
      avgAllowed: 168,
      wins: 4,
      losses: 4,
    },
    homeExtended: {
      homeRecord: { wins: 5, losses: 1 },
      awayRecord: { wins: 3, losses: 3 },
      lastGameDate: "2026-05-10",
      avgScoreLast5: 181,
      avgScoreLast10: 176,
      scoringTrend: 0.28,
      defenseTrend: 0.18,
      headToHeadResults: [
        { date: "2026-04-10", won: true, teamScore: 182, oppScore: 176 },
        { date: "2025-05-01", won: true, teamScore: 168, oppScore: 155 },
      ],
      strengthOfSchedule: 0.55,
      restDays: 3,
      consecutiveAwayGames: 0,
    },
    awayExtended: {
      homeRecord: { wins: 3, losses: 3 },
      awayRecord: { wins: 2, losses: 4 },
      lastGameDate: "2026-05-11",
      avgScoreLast5: 158,
      avgScoreLast10: 161,
      scoringTrend: -0.08,
      defenseTrend: -0.04,
      headToHeadResults: [
        { date: "2026-04-10", won: false, teamScore: 176, oppScore: 182 },
        { date: "2025-05-01", won: false, teamScore: 155, oppScore: 168 },
      ],
      strengthOfSchedule: 0.5,
      restDays: 2,
      consecutiveAwayGames: 2,
    },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: {},
    awayAdvanced: {},
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-05-13",
    ...overrides,
  };
}

function makeTennisContext(overrides: Partial<GameContext> = {}): GameContext {
  const home = { ...makeTeam("p-2989", "RUUD", 0, 0), name: "Casper Ruud", rank: 23 };
  const away = { ...makeTeam("p-2367", "KHAC", 0, 0), name: "Karen Khachanov", rank: 13 };
  const game: Game = {
    id: "tennis-sim-1",
    sport: Sport.TENNIS,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-05-13T13:00Z",
    venue: "Internazionali BNL d'Italia · Men's Singles · Quarterfinal - Campo Centrale",
    tvChannel: "",
    status: GameStatus.Scheduled,
    seasonContext: {
      phase: "tournament",
      label: "Tennis tournament setting",
      detail: "This is tennis tournament context, so rankings, draw slot, match format, surface/conditions, and one-match variance should guide the analysis.",
      source: "espn",
    },
  };

  const baseExtended = {
    homeRecord: { wins: 0, losses: 0 },
    awayRecord: { wins: 0, losses: 0 },
    lastGameDate: null,
    avgScoreLast5: 0,
    avgScoreLast10: 0,
    scoringTrend: 0,
    defenseTrend: 0,
    headToHeadResults: [],
    strengthOfSchedule: 0.5,
    restDays: null,
    consecutiveAwayGames: 0,
  };

  return {
    game,
    sport: "TENNIS",
    homeElo: 1500,
    awayElo: 1500,
    homeForm: {
      results: [],
      formString: "",
      streak: 0,
      avgScore: 0,
      avgAllowed: 0,
      wins: 0,
      losses: 0,
    },
    awayForm: {
      results: [],
      formString: "",
      streak: 0,
      avgScore: 0,
      avgAllowed: 0,
      wins: 0,
      losses: 0,
    },
    homeExtended: baseExtended,
    awayExtended: baseExtended,
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: {},
    awayAdvanced: {},
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-05-13",
    ...overrides,
  };
}

describe("game-script simulation", () => {
  it("produces deterministic projection outputs", () => {
    const ctx = makeNBAContext();
    const factors = blendFactors(normalizeWeightsToOne(computeBaseFactors(ctx)));
    const first = simulateGameProjection(ctx, 120, factors);
    const second = simulateGameProjection(ctx, 120, factors);

    expect(first).toEqual(second);
    expect(first.iterations).toBe(50000);
    expect(first.projectedTotal).toBeGreaterThan(180);
    expect(first.homeWinProbability).toBeGreaterThan(first.awayWinProbability);
  });

  it("anchors the simulator to the rating edge when scoring form points the other way", () => {
    const neutralExtended = {
      homeRecord: { wins: 10, losses: 10 },
      awayRecord: { wins: 10, losses: 10 },
      lastGameDate: "2026-04-13",
      avgScoreLast5: 110,
      avgScoreLast10: 110,
      scoringTrend: 0,
      defenseTrend: 0,
      headToHeadResults: [],
      strengthOfSchedule: 0.5,
      restDays: 3,
      consecutiveAwayGames: 0,
    };
    const ctx = makeNBAContext({
      homeForm: {
        results: ["L", "L", "W", "L", "L", "W", "L", "L", "L", "W"],
        formString: "L-L-W-L-L-W-L-L-L-W",
        streak: -1,
        avgScore: 98,
        avgAllowed: 123,
        wins: 3,
        losses: 7,
      },
      awayForm: {
        results: ["W", "W", "L", "W", "W", "W", "L", "W", "W", "W"],
        formString: "W-W-L-W-W-W-L-W-W-W",
        streak: 4,
        avgScore: 124,
        avgAllowed: 101,
        wins: 8,
        losses: 2,
      },
      homeExtended: neutralExtended,
      awayExtended: neutralExtended,
      awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    });
    const factors = blendFactors(normalizeWeightsToOne(computeBaseFactors(ctx)));
    const projection = simulateGameProjection(ctx, 120, factors);

    expect(projection.homeWinProbability).toBeGreaterThan(projection.awayWinProbability);
    expect(projection.projectedSpread).toBeGreaterThan(0);
    expect(projection.signals.some((signal) => signal.key === "rating-consensus-anchor")).toBe(true);
  });

  it("is wired into predictGame and exposes projection metadata", () => {
    const prediction = predictGame(makeNBAContext());

    expect(prediction.projection).toBeDefined();
    expect(prediction.dataSources).toContain("game-script simulation");
    expect(prediction.dataSources).not.toContain("legacy prediction ensemble");
    expect(prediction.projection!.signals.some((s) => s.key === "legacy-consensus")).toBe(false);
    expect(prediction.projection!.signals.length).toBeGreaterThan(0);
    const finalSide = prediction.homeWinProbability >= prediction.awayWinProbability ? "home" : "away";
    const projectionSide =
      prediction.projection!.homeWinProbability >= prediction.projection!.awayWinProbability ? "home" : "away";
    expect(projectionSide).toBe(finalSide);
    expect(prediction.confidence).toBe(
      Math.round(Math.max(prediction.homeWinProbability, prediction.awayWinProbability) * 1000) / 10,
    );
  });

  it("wires IPL into cricket factors and T20 projection scale", () => {
    const prediction = predictGame(makeIPLContext());

    expect(prediction.league).toBe("IPL");
    expect(prediction.factors.some((factor) => factor.key === "ipl_table_strength")).toBe(true);
    expect(prediction.factors.some((factor) => factor.key === "ipl_batting_trend")).toBe(true);
    expect(prediction.factors.some((factor) => factor.key === "ipl_bowling_trend")).toBe(true);
    expect(prediction.projection).toBeDefined();
    expect(prediction.projection!.projectedTotal).toBeGreaterThan(250);
    expect(prediction.projection!.signals.some((s) => s.key === "legacy-consensus")).toBe(false);
    expect(prediction.dataSources).toContain("game-script simulation");
    expect(prediction.confidence).toBe(
      Math.round(Math.max(prediction.homeWinProbability, prediction.awayWinProbability) * 1000) / 10,
    );
  });

  it("wires tennis into ranking factors and set-based projection scale", () => {
    const prediction = predictGame(makeTennisContext());

    expect(prediction.league).toBe("TENNIS");
    expect(prediction.factors.some((factor) => factor.key === "tennis_ranking_edge")).toBe(true);
    expect(prediction.factors.some((factor) => factor.key === "tennis_round_pressure")).toBe(true);
    expect(prediction.projection).toBeDefined();
    expect(prediction.projection!.projectedTotal).toBeGreaterThanOrEqual(2);
    expect(prediction.projection!.projectedTotal).toBeLessThanOrEqual(3);
    expect(prediction.awayWinProbability).toBeGreaterThan(prediction.homeWinProbability);
    expect(prediction.confidence).toBeGreaterThan(51);
    expect(prediction.confidence).toBeLessThan(55);
    expect(prediction.projection!.signals.some((s) => s.key === "legacy-consensus")).toBe(false);
    expect(prediction.dataSources).toContain("game-script simulation");
    expect(prediction.confidence).toBe(
      Math.round(Math.max(prediction.homeWinProbability, prediction.awayWinProbability) * 1000) / 10,
    );
  });

  it("treats adverse tennis weather as variance instead of home-side edge", () => {
    const ctx = makeTennisContext({
      weather: {
        temperature: 94,
        windSpeed: 21,
        precipitation: 0.48,
        isDomed: false,
      },
    });
    const factors = blendFactors(normalizeWeightsToOne([
      ...computeBaseFactors(ctx),
      ...computeTennisFactors(ctx),
    ]));
    const conditions = factors.find((factor) => factor.key === "tennis_conditions")!;
    const projection = simulateGameProjection(ctx, -80, factors);

    expect(conditions.available).toBe(true);
    expect(conditions.hasSignal).toBe(true);
    expect(conditions.homeDelta).toBe(0);
    expect(conditions.weight).toBeGreaterThan(0);
    expect(projection.signals.some((signal) => signal.key === "tennis-weather-volatility")).toBe(true);
  });
});
