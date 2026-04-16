/**
 * Tests for the MLB umpire factor — Prompt-A follow-up.
 *
 * Verifies the corrected sign semantics:
 *   - favorsHome is directional (positive → helps home)
 *   - runsPerGameBias is magnitude-only amplifier (1.0× to 1.5×)
 *   - Final cap ±20 Elo, base cap ±15
 *   - available=false cases (unknown umpire / unassigned)
 */

import { describe, it, expect } from "bun:test";
import { computeMLBFactors } from "../factors/mlb";
import type { GameContext } from "../types";
import type { Team, Game } from "../../types/sports";
import { Sport, League, GameStatus } from "../../types/sports";

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "1",
    name: "Home",
    abbreviation: "HOM",
    logo: "",
    record: { wins: 50, losses: 50 },
    ...overrides,
  };
}

function makeMLBContext(overrides: Partial<GameContext> = {}): GameContext {
  const home = makeTeam({ id: "1", name: "Home", abbreviation: "HOM" });
  const away = makeTeam({ id: "2", name: "Away", abbreviation: "AWY" });
  const game: Game = {
    id: "g1",
    sport: Sport.MLB,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-07-04T19:00Z",
    venue: "Test Field",
    tvChannel: "",
    status: GameStatus.Scheduled,
  };
  return {
    game,
    sport: "MLB",
    homeElo: 1500,
    awayElo: 1500,
    homeForm: {
      results: ["W","L","W","L","W","L","W","L","W","L"],
      formString: "W-L-W-L-W-L-W-L-W-L",
      streak: 0, avgScore: 4.5, avgAllowed: 4.5, wins: 5, losses: 5,
    },
    awayForm: {
      results: ["W","L","W","L","W","L","W","L","W","L"],
      formString: "W-L-W-L-W-L-W-L-W-L",
      streak: 0, avgScore: 4.5, avgAllowed: 4.5, wins: 5, losses: 5,
    },
    homeExtended: {
      homeRecord: { wins: 25, losses: 25 }, awayRecord: { wins: 25, losses: 25 },
      lastGameDate: "2026-07-03", avgScoreLast5: 4.5, avgScoreLast10: 4.5,
      scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
      strengthOfSchedule: 0.5, restDays: 1, consecutiveAwayGames: 0,
    },
    awayExtended: {
      homeRecord: { wins: 25, losses: 25 }, awayRecord: { wins: 25, losses: 25 },
      lastGameDate: "2026-07-03", avgScoreLast5: 4.5, avgScoreLast10: 4.5,
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
    homePlateUmpire: null,
    gameDate: "2026-07-04",
    ...overrides,
  };
}

function getUmpire(ctx: GameContext) {
  return computeMLBFactors(ctx).find((f) => f.key === "umpire")!;
}

describe("MLB umpire factor", () => {
  it("applies POSITIVE home delta for a home-favoring pitcher's-zone umpire, amplified ~1.3×", () => {
    // favorsHome: +0.02 → base delta = 8 Elo (under ±15 cap)
    // |runsPerGameBias|=0.15 → amplifier = 1 + min(0.5, 0.15*2) = 1.3
    // Expected: 8 × 1.3 = 10.4 Elo (under ±20 cap)
    const ctx = makeMLBContext({
      homePlateUmpire: {
        name: "Test Ump",
        tendency: { favorsHome: 0.02, runsPerGameBias: -0.15, sampleSize: 300 },
      },
    });
    const f = getUmpire(ctx);
    expect(f.available).toBe(true);
    expect(f.homeDelta).toBeGreaterThan(0);
    expect(f.homeDelta).toBeCloseTo(10.4, 1);
    expect(f.homeDelta).toBeLessThanOrEqual(20);
    expect(f.evidence).toContain("favors home");
    expect(f.evidence).toContain("pitcher's zone");
  });

  it("applies NEGATIVE home delta for an away-favoring hitter's-zone umpire", () => {
    // favorsHome: -0.02 → base = -8 Elo; amplifier = 1.3; final = -10.4
    const ctx = makeMLBContext({
      homePlateUmpire: {
        name: "Test Ump",
        tendency: { favorsHome: -0.02, runsPerGameBias: 0.15, sampleSize: 300 },
      },
    });
    const f = getUmpire(ctx);
    expect(f.available).toBe(true);
    expect(f.homeDelta).toBeLessThan(0);
    expect(f.homeDelta).toBeCloseTo(-10.4, 1);
    expect(f.homeDelta).toBeGreaterThanOrEqual(-20);
    expect(f.evidence).toContain("favors away");
    expect(f.evidence).toContain("hitter's zone");
  });

  it("returns near-zero delta for a neutral umpire", () => {
    const ctx = makeMLBContext({
      homePlateUmpire: {
        name: "Neutral Ump",
        tendency: { favorsHome: 0.001, runsPerGameBias: 0.01, sampleSize: 400 },
      },
    });
    const f = getUmpire(ctx);
    expect(f.available).toBe(true);
    expect(Math.abs(f.homeDelta)).toBeLessThan(1);
    expect(f.evidence).toContain("neutral zone");
  });

  it("marks unavailable when umpire is assigned but has no tendency data", () => {
    const ctx = makeMLBContext({
      homePlateUmpire: { name: "Rookie Ump", tendency: null },
    });
    const f = getUmpire(ctx);
    expect(f.available).toBe(false);
    expect(f.homeDelta).toBe(0);
    expect(f.evidence).toContain("no historical zone data");
  });

  it("marks unavailable when umpire is not yet assigned", () => {
    const ctx = makeMLBContext({ homePlateUmpire: null });
    const f = getUmpire(ctx);
    expect(f.available).toBe(false);
    expect(f.homeDelta).toBe(0);
    expect(f.evidence).toContain("not yet posted");
  });
});
