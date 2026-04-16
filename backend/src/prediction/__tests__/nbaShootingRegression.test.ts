/**
 * Tests for the NBA three_point_regression factor — Prompt-A follow-up.
 *
 * Covers the five cases called out in the spec:
 *   1. Hot home team (capped to -25)
 *   2. Cold home team (capped to +25)
 *   3. Within-noise teams → 0 delta
 *   4. Insufficient games (<5)
 *   5. Null shooting data
 */

import { describe, it, expect } from "bun:test";
import { computeNBAFactors } from "../factors/nba";
import type { GameContext } from "../types";
import type { Team, Game } from "../../types/sports";
import { Sport, League, GameStatus } from "../../types/sports";

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "1",
    name: "Home Team",
    abbreviation: "HOM",
    logo: "",
    record: { wins: 10, losses: 10 },
    ...overrides,
  };
}

function makeNBAContext(overrides: Partial<GameContext> = {}): GameContext {
  const home = makeTeam({ id: "1", name: "Home", abbreviation: "HOM" });
  const away = makeTeam({ id: "2", name: "Away", abbreviation: "AWY" });
  const game: Game = {
    id: "g1",
    sport: Sport.NBA,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-04-12T19:00Z",
    venue: "Test Arena",
    tvChannel: "",
    status: GameStatus.Scheduled,
  };
  return {
    game,
    sport: "NBA",
    homeElo: 1500,
    awayElo: 1500,
    homeForm: {
      results: ["W","L","W","L","W","L","W","L","W","L"],
      formString: "W-L-W-L-W-L-W-L-W-L",
      streak: 0, avgScore: 110, avgAllowed: 110, wins: 5, losses: 5,
    },
    awayForm: {
      results: ["W","L","W","L","W","L","W","L","W","L"],
      formString: "W-L-W-L-W-L-W-L-W-L",
      streak: 0, avgScore: 110, avgAllowed: 110, wins: 5, losses: 5,
    },
    homeExtended: {
      homeRecord: { wins: 5, losses: 5 }, awayRecord: { wins: 5, losses: 5 },
      lastGameDate: "2026-04-11", avgScoreLast5: 110, avgScoreLast10: 110,
      scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
      strengthOfSchedule: 0.5, restDays: 2, consecutiveAwayGames: 0,
    },
    awayExtended: {
      homeRecord: { wins: 5, losses: 5 }, awayRecord: { wins: 5, losses: 5 },
      lastGameDate: "2026-04-11", avgScoreLast5: 110, avgScoreLast10: 110,
      scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
      strengthOfSchedule: 0.5, restDays: 2, consecutiveAwayGames: 0,
    },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: {},
    awayAdvanced: {},
    homeLineup: null,
    awayLineup: null,
    weather: null,
    homeShooting: null,
    awayShooting: null,
    gameDate: "2026-04-12",
    ...overrides,
  };
}

function getThreePt(ctx: GameContext) {
  return computeNBAFactors(ctx).find((f) => f.key === "three_point_regression")!;
}

describe("NBA three_point_regression factor", () => {
  it("caps at -25 when home is running ~7pts above season 3P%", () => {
    // +7pts hot × 8 Elo/pt = 56 Elo raw → clamped to -25 (hot team → negative)
    const ctx = makeNBAContext({
      homeShooting: { recent3P: 0.42, season3P: 0.35, gamesUsed: 5 },
      awayShooting: null,
    });
    const f = getThreePt(ctx);
    expect(f.available).toBe(true);
    expect(f.homeDelta).toBe(-25);
    expect(f.evidence).toContain("expect regression");
  });

  it("caps at +25 when home is running ~7pts below season 3P%", () => {
    const ctx = makeNBAContext({
      homeShooting: { recent3P: 0.29, season3P: 0.36, gamesUsed: 5 },
      awayShooting: null,
    });
    const f = getThreePt(ctx);
    expect(f.available).toBe(true);
    expect(f.homeDelta).toBe(25);
    expect(f.evidence).toContain("expect rebound");
  });

  it("returns 0 delta when both teams are within 2pts of season 3P%", () => {
    // Home +1.5pts, Away +1pt — both under the 3-pt threshold
    const ctx = makeNBAContext({
      homeShooting: { recent3P: 0.365, season3P: 0.350, gamesUsed: 5 },
      awayShooting: { recent3P: 0.360, season3P: 0.350, gamesUsed: 5 },
    });
    const f = getThreePt(ctx);
    expect(f.available).toBe(true);
    expect(f.homeDelta).toBe(0);
    expect(f.evidence.toLowerCase()).toContain("no regression signal");
  });

  it("is unavailable when only 4 recent games exist", () => {
    const ctx = makeNBAContext({
      homeShooting: { recent3P: 0.42, season3P: 0.35, gamesUsed: 4 },
      awayShooting: { recent3P: 0.30, season3P: 0.36, gamesUsed: 4 },
    });
    const f = getThreePt(ctx);
    expect(f.available).toBe(false);
    expect(f.homeDelta).toBe(0);
  });

  it("is unavailable when shooting data is null on both sides", () => {
    const ctx = makeNBAContext({ homeShooting: null, awayShooting: null });
    const f = getThreePt(ctx);
    expect(f.available).toBe(false);
    expect(f.homeDelta).toBe(0);
  });
});
