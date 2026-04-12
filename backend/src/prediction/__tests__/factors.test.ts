/**
 * Tests for factor computations — Section 8.
 *
 * Per-league synthetic GameContext tests verifying:
 * - Factors return correct direction
 * - Weight redistribution works when factors are unavailable
 * - All factors have required fields
 */

import { describe, it, expect } from "bun:test";
import { predictGame } from "../index";
import { computeBaseFactors } from "../factors/base";
import { computeNFLFactors } from "../factors/nfl";
import { computeNBAFactors } from "../factors/nba";
import { computeMLBFactors } from "../factors/mlb";
import { computeNHLFactors } from "../factors/nhl";
import type { GameContext, FactorContribution } from "../types";
import type { Game, Team } from "../../types/sports";
import { Sport, League, GameStatus } from "../../types/sports";

// ─── Test fixture builder ───────────────────────────────────────────────

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "1",
    name: "Home Team",
    abbreviation: "HOM",
    logo: "",
    record: { wins: 40, losses: 30 },
    ...overrides,
  };
}

function makeContext(overrides: Partial<GameContext> = {}): GameContext {
  const home = makeTeam({ id: "1", name: "Home Team", abbreviation: "HOM" });
  const away = makeTeam({
    id: "2", name: "Away Team", abbreviation: "AWY",
    record: { wins: 30, losses: 40 },
  });

  const game: Game = {
    id: "game-1",
    sport: Sport.NBA,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-04-12T19:00Z",
    venue: "Test Arena",
    tvChannel: "ESPN",
    status: GameStatus.Scheduled,
  };

  return {
    game,
    sport: "NBA",
    homeElo: 1550,
    awayElo: 1450,
    homeForm: {
      results: ["W","W","W","L","W","W","W","L","W","W"],
      formString: "W-W-W-L-W-W-W-L-W-W",
      streak: 2, avgScore: 110, avgAllowed: 102, wins: 8, losses: 2,
    },
    awayForm: {
      results: ["L","W","L","L","W","L","W","L","L","W"],
      formString: "L-W-L-L-W-L-W-L-L-W",
      streak: 1, avgScore: 100, avgAllowed: 108, wins: 4, losses: 6,
    },
    homeExtended: {
      homeRecord: { wins: 25, losses: 10 }, awayRecord: { wins: 15, losses: 20 },
      lastGameDate: "2026-04-11", avgScoreLast5: 112, avgScoreLast10: 110,
      scoringTrend: 0.3, defenseTrend: 0.1,
      headToHeadResults: [], strengthOfSchedule: 0.52,
      restDays: 2, consecutiveAwayGames: 0,
    },
    awayExtended: {
      homeRecord: { wins: 20, losses: 15 }, awayRecord: { wins: 10, losses: 25 },
      lastGameDate: "2026-04-11", avgScoreLast5: 98, avgScoreLast10: 100,
      scoringTrend: -0.2, defenseTrend: -0.1,
      headToHeadResults: [], strengthOfSchedule: 0.48,
      restDays: 0, consecutiveAwayGames: 4,
    },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: {
      out: [{ name: "Star Player", position: "PG", detail: "Ankle" }],
      doubtful: [], questionable: [],
      totalOut: 1, totalDoubtful: 0, totalQuestionable: 0,
    },
    homeAdvanced: { offensiveRating: 115, defensiveRating: 108 },
    awayAdvanced: { offensiveRating: 105, defensiveRating: 112 },
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-04-12",
    ...overrides,
  };
}

// ─── Validation helpers ─────────────────────────────────────────────────

function validateFactorShape(factors: FactorContribution[]) {
  for (const f of factors) {
    expect(typeof f.key).toBe("string");
    expect(f.key.length).toBeGreaterThan(0);
    expect(typeof f.label).toBe("string");
    expect(typeof f.homeDelta).toBe("number");
    expect(Number.isFinite(f.homeDelta)).toBe(true);
    expect(typeof f.weight).toBe("number");
    expect(f.weight).toBeGreaterThanOrEqual(0);
    expect(f.weight).toBeLessThanOrEqual(2); // Allow for redistribution scaling
    expect(typeof f.available).toBe("boolean");
    expect(typeof f.evidence).toBe("string");
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("base factors", () => {
  it("returns 4 factors for any sport", () => {
    const ctx = makeContext();
    const factors = computeBaseFactors(ctx);
    expect(factors.length).toBe(4);
    validateFactorShape(factors);
  });

  it("Elo differential favors team with higher Elo + home bonus", () => {
    const ctx = makeContext({ homeElo: 1600, awayElo: 1400 });
    const factors = computeBaseFactors(ctx);
    const eloDiff = factors.find((f) => f.key === "rating_diff")!;
    expect(eloDiff.homeDelta).toBeGreaterThan(0); // Home has higher Elo + bonus
  });

  it("rest differential: home advantage when home has more rest", () => {
    const ctx = makeContext();
    // Home: 2 days, Away: 0 days (back-to-back)
    const factors = computeBaseFactors(ctx);
    const rest = factors.find((f) => f.key === "rest_diff")!;
    expect(rest.homeDelta).toBeGreaterThan(0); // Favors home
    expect(rest.available).toBe(true);
  });

  it("recent form: positive when home has better L10", () => {
    const ctx = makeContext();
    const factors = computeBaseFactors(ctx);
    const form = factors.find((f) => f.key === "recent_form")!;
    expect(form.homeDelta).toBeGreaterThan(0); // Home 8-2 vs Away 4-6
  });

  it("travel: positive when away on long road trip", () => {
    const ctx = makeContext();
    const factors = computeBaseFactors(ctx);
    const travel = factors.find((f) => f.key === "travel")!;
    expect(travel.homeDelta).toBeGreaterThan(0); // Away on 4-game road trip
  });
});

describe("NBA factors", () => {
  it("returns 5 factors", () => {
    const ctx = makeContext();
    const factors = computeNBAFactors(ctx);
    expect(factors.length).toBe(5);
    validateFactorShape(factors);
  });

  it("injuries favor home when away has players out", () => {
    const ctx = makeContext();
    const factors = computeNBAFactors(ctx);
    const injuries = factors.find((f) => f.key === "injuries_nba")!;
    expect(injuries.homeDelta).toBeGreaterThan(0); // Away has 1 PG out
  });

  it("back-to-back penalizes the team on b2b", () => {
    const ctx = makeContext();
    const factors = computeNBAFactors(ctx);
    const b2b = factors.find((f) => f.key === "back_to_back")!;
    expect(b2b.homeDelta).toBeGreaterThan(0); // Away is on b2b (restDays=0)
  });

  it("net rating uses offensive/defensive rating differential", () => {
    const ctx = makeContext();
    const factors = computeNBAFactors(ctx);
    const netRating = factors.find((f) => f.key === "net_rating")!;
    expect(netRating.available).toBe(true);
    // Home: 115 - 108 = +7 net, Away: 105 - 112 = -7 net, diff = +14
    expect(netRating.homeDelta).toBeGreaterThan(0);
  });
});

describe("NFL factors", () => {
  it("returns 5 factors", () => {
    const ctx = makeContext({ sport: "NFL" });
    const factors = computeNFLFactors(ctx);
    expect(factors.length).toBe(5);
    validateFactorShape(factors);
  });

  it("QB out creates large swing", () => {
    const ctx = makeContext({
      sport: "NFL",
      awayInjuries: {
        out: [{ name: "QB1", position: "QB", detail: "ACL" }],
        doubtful: [], questionable: [],
        totalOut: 1, totalDoubtful: 0, totalQuestionable: 0,
      },
    });
    const factors = computeNFLFactors(ctx);
    const qb = factors.find((f) => f.key === "starting_qb")!;
    expect(qb.homeDelta).toBe(120); // Away QB out = +120 for home
  });
});

describe("MLB factors", () => {
  it("returns 7 factors", () => {
    const ctx = makeContext({ sport: "MLB" });
    const factors = computeMLBFactors(ctx);
    expect(factors.length).toBe(7);
    validateFactorShape(factors);
  });

  it("starting pitcher is the highest-weighted factor", () => {
    const ctx = makeContext({ sport: "MLB" });
    const factors = computeMLBFactors(ctx);
    const sp = factors.find((f) => f.key === "starting_pitcher")!;
    expect(sp.weight).toBe(0.22);
    // No lineup data → unavailable
    expect(sp.available).toBe(false);
  });

  it("early season fires when GP < 20", () => {
    const ctx = makeContext({
      sport: "MLB",
      game: {
        ...makeContext().game,
        homeTeam: makeTeam({ record: { wins: 5, losses: 5 } }),
        awayTeam: makeTeam({ id: "2", record: { wins: 4, losses: 6 } }),
      },
    });
    const factors = computeMLBFactors(ctx);
    const early = factors.find((f) => f.key === "early_season_mlb")!;
    expect(early.available).toBe(false);
    expect(early.evidence).toContain("games played");
  });
});

describe("NHL factors", () => {
  it("returns 4 factors", () => {
    const ctx = makeContext({
      sport: "NHL",
      homeAdvanced: { savePercentage: 0.920, penaltyKillPct: 0.82, powerPlayPct: 0.22 },
      awayAdvanced: { savePercentage: 0.900, penaltyKillPct: 0.78, powerPlayPct: 0.18 },
    });
    const factors = computeNHLFactors(ctx);
    expect(factors.length).toBe(4);
    validateFactorShape(factors);
  });

  it("goalie factor favors team with higher save percentage", () => {
    const ctx = makeContext({
      sport: "NHL",
      homeAdvanced: { savePercentage: 0.920 },
      awayAdvanced: { savePercentage: 0.900 },
    });
    const factors = computeNHLFactors(ctx);
    const goalie = factors.find((f) => f.key === "starting_goalie")!;
    expect(goalie.homeDelta).toBeGreaterThan(0); // Home has better SV%
    expect(goalie.available).toBe(true);
  });
});

describe("predictGame — weight redistribution", () => {
  it("unavailable factors get weight 0 delta, available get scaled up", () => {
    const ctx = makeContext();
    // Force net_rating and three_point_regression unavailable (they are by default for NBA)
    const prediction = predictGame(ctx);

    // Check that total weight of available factors sums to ~1.0
    const availableWeight = prediction.factors
      .filter((f) => f.available)
      .reduce((sum, f) => sum + f.weight, 0);
    const totalOrigWeight = prediction.factors.reduce((sum, f) => sum + f.weight, 0);

    // Available weights should be scaled up from original
    expect(availableWeight).toBeCloseTo(totalOrigWeight, 1);
  });

  it("returns confidence between 50 and 100", () => {
    const ctx = makeContext();
    const prediction = predictGame(ctx);
    expect(prediction.confidence).toBeGreaterThanOrEqual(50);
    expect(prediction.confidence).toBeLessThanOrEqual(100);
  });

  it("home/away probabilities sum to 1.0", () => {
    const ctx = makeContext();
    const prediction = predictGame(ctx);
    expect(prediction.homeWinProbability + prediction.awayWinProbability).toBeCloseTo(1.0, 5);
  });

  it("even matchup produces confidence near 50", () => {
    const ctx = makeContext({
      homeElo: 1500,
      awayElo: 1500,
      homeForm: {
        results: ["W","L","W","L","W","L","W","L","W","L"],
        formString: "W-L-W-L-W-L-W-L-W-L",
        streak: 0, avgScore: 100, avgAllowed: 100, wins: 5, losses: 5,
      },
      awayForm: {
        results: ["W","L","W","L","W","L","W","L","W","L"],
        formString: "W-L-W-L-W-L-W-L-W-L",
        streak: 0, avgScore: 100, avgAllowed: 100, wins: 5, losses: 5,
      },
      awayExtended: {
        ...makeContext().awayExtended,
        restDays: 2, consecutiveAwayGames: 0,
      },
      homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
      awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
      homeAdvanced: {},
      awayAdvanced: {},
    });
    const prediction = predictGame(ctx);
    // With equal everything, only home-field advantage (100 Elo pts * 0.46 weight ≈ 46 → ~56%)
    expect(prediction.confidence).toBeLessThan(65);
    expect(prediction.confidence).toBeGreaterThan(50);
  });
});
