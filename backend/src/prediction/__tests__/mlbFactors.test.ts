/**
 * MLB factor weight-sum and ballpark factor tests.
 */

import { describe, it, expect } from "bun:test";
import { computeMLBFactors, getParkFactor } from "../factors/mlb";
import type { GameContext } from "../types";
import type { Game, Team } from "../../types/sports";
import { Sport, League, GameStatus } from "../../types/sports";

function makeMLBTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "1",
    name: "Home Team",
    abbreviation: "HOM",
    logo: "",
    record: { wins: 40, losses: 30 },
    ...overrides,
  };
}

function makeMLBContext(overrides: Partial<GameContext> = {}): GameContext {
  const home = makeMLBTeam({
    id: "1", name: "Home Team",
    abbreviation: overrides.game?.homeTeam?.abbreviation ?? "HOM",
  });
  const away = makeMLBTeam({
    id: "2", name: "Away Team",
    abbreviation: overrides.game?.awayTeam?.abbreviation ?? "AWY",
    record: { wins: 30, losses: 40 },
  });
  const game: Game = {
    id: "mlb-1",
    sport: Sport.MLB,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-04-16T19:00Z",
    venue: "Test Park",
    tvChannel: "ESPN",
    status: GameStatus.Scheduled,
    ...overrides.game,
  };
  return {
    game,
    sport: "MLB",
    homeElo: 1500,
    awayElo: 1500,
    homeForm: {
      results: ["W","L","W","L","W","L","W","L","W","L"],
      formString: "W-L-W-L-W-L-W-L-W-L",
      streak: 0, avgScore: 4.5, avgAllowed: 4.0, wins: 5, losses: 5,
    },
    awayForm: {
      results: ["L","W","L","W","L","W","L","W","L","W"],
      formString: "L-W-L-W-L-W-L-W-L-W",
      streak: 0, avgScore: 4.0, avgAllowed: 4.5, wins: 5, losses: 5,
    },
    homeExtended: {
      homeRecord: { wins: 20, losses: 15 }, awayRecord: { wins: 20, losses: 15 },
      lastGameDate: "2026-04-15", avgScoreLast5: 4.5, avgScoreLast10: 4.5,
      scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
      strengthOfSchedule: 0.5, restDays: 1, consecutiveAwayGames: 0,
    },
    awayExtended: {
      homeRecord: { wins: 15, losses: 20 }, awayRecord: { wins: 15, losses: 20 },
      lastGameDate: "2026-04-15", avgScoreLast5: 4.0, avgScoreLast10: 4.0,
      scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
      strengthOfSchedule: 0.5, restDays: 1, consecutiveAwayGames: 0,
    },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: {},
    awayAdvanced: {},
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-04-16",
    ...overrides,
  };
}

describe("computeMLBFactors", () => {
  it("factor weights sum to exactly 0.42", () => {
    const ctx = makeMLBContext();
    const factors = computeMLBFactors(ctx);
    const sum = factors.reduce((s, f) => s + f.weight, 0);
    // Use toFixed to avoid floating-point precision issues
    expect(+sum.toFixed(2)).toBe(0.42);
  });

  it("does not include a handedness factor", () => {
    const ctx = makeMLBContext();
    const factors = computeMLBFactors(ctx);
    const handedness = factors.find((f) => f.key === "handedness");
    expect(handedness).toBeUndefined();
  });

  it("ballpark factor is available for known park (COL)", () => {
    const base = makeMLBContext();
    const game: Game = {
      ...base.game,
      homeTeam: makeMLBTeam({ abbreviation: "COL" }),
    };
    const ctx = makeMLBContext({ game });
    const factors = computeMLBFactors(ctx);
    const ballpark = factors.find((f) => f.key === "ballpark");
    expect(ballpark).toBeDefined();
    expect(ballpark!.available).toBe(true);
    expect(ballpark!.homeDelta).toBeGreaterThan(0); // Coors is hitter-friendly
    expect(ballpark!.evidence).toContain("COL");
  });

  it("ballpark factor handles unknown abbreviation gracefully", () => {
    const base = makeMLBContext();
    const game: Game = {
      ...base.game,
      homeTeam: makeMLBTeam({ abbreviation: "ZZZ" }),
    };
    const ctx = makeMLBContext({ game });
    const factors = computeMLBFactors(ctx);
    const ballpark = factors.find((f) => f.key === "ballpark");
    expect(ballpark).toBeDefined();
    expect(ballpark!.available).toBe(false);
    expect(ballpark!.homeDelta).toBe(0);
  });

  it("ballpark delta is capped at ±10", () => {
    // COL has +1.20 runs/game → 1.20 * 20 = 24, should be capped to 10
    const factor = getParkFactor("COL");
    expect(factor).not.toBeNull();
    expect(factor! * 20).toBeGreaterThan(10); // Would exceed cap without clamping

    const base = makeMLBContext();
    const game: Game = {
      ...base.game,
      homeTeam: makeMLBTeam({ abbreviation: "COL" }),
    };
    const ctx = makeMLBContext({ game });
    const factors = computeMLBFactors(ctx);
    const ballpark = factors.find((f) => f.key === "ballpark")!;
    expect(ballpark.homeDelta).toBeLessThanOrEqual(10);
    expect(ballpark.homeDelta).toBeGreaterThanOrEqual(-10);
  });
});

describe("getParkFactor", () => {
  it("returns correct factor for known parks", () => {
    expect(getParkFactor("COL")).toBe(1.20);
    expect(getParkFactor("SF")).toBe(-0.40);
    expect(getParkFactor("NYY")).toBe(0.25);
  });

  it("returns null for unknown abbreviation", () => {
    expect(getParkFactor("XYZ")).toBeNull();
  });
});
