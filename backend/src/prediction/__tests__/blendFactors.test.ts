/**
 * Tests for the factor-blending math.
 *
 * Covers:
 *   (a) blendFactors with all hasSignal=false → rating_diff absorbs the pool
 *       so the final Elo delta equals the Elo-only prediction.
 *   (b) Partial signal — weight moves only from no-signal factors.
 *   (c) Soccer H + D + A sums to 1.0 after the fix runs end-to-end.
 *   (d) NBA / NHL / MLS factor weights sum to exactly 1.0 after normalization.
 */

import { describe, it, expect } from "bun:test";
import {
  blendFactors,
  normalizeWeightsToOne,
  predictGame,
  ratingDeltaToHomeWinProb,
} from "../index";
import type { FactorContribution, GameContext } from "../types";
import type { Game, Team } from "../../types/sports";
import { Sport, League, GameStatus } from "../../types/sports";
import { makeSoccerContext } from "./_soccerFixtures";
import { computeNBAFactors } from "../factors/nba";
import { computeNHLFactors } from "../factors/nhl";
import { computeMLSFactors } from "../factors/mls";
import { computeBaseFactors } from "../factors/base";

// ─── helpers ────────────────────────────────────────────────────────────

function f(
  key: string,
  homeDelta: number,
  weight: number,
  available: boolean,
  hasSignal: boolean,
): FactorContribution {
  return {
    key,
    label: key,
    homeDelta,
    weight,
    available,
    hasSignal,
    evidence: "",
  };
}

function makeHoopsContext(homeElo: number, awayElo: number, sport: "NBA" | "NHL" = "NBA"): GameContext {
  const sportEnum = sport === "NBA" ? Sport.NBA : Sport.NHL;
  const home: Team = { id: "1", name: "Home", abbreviation: "HOM", logo: "", record: { wins: 40, losses: 30 } };
  const away: Team = { id: "2", name: "Away", abbreviation: "AWY", logo: "", record: { wins: 30, losses: 40 } };
  const game: Game = {
    id: "g-1",
    sport: sportEnum,
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
    sport,
    homeElo,
    awayElo,
    homeForm: { results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0 },
    awayForm: { results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0 },
    homeExtended: { homeRecord: { wins: 0, losses: 0 }, awayRecord: { wins: 0, losses: 0 }, lastGameDate: "", avgScoreLast5: 0, avgScoreLast10: 0, scoringTrend: 0, defenseTrend: 0, headToHeadResults: [], strengthOfSchedule: 0.5, restDays: 3, consecutiveAwayGames: 0 },
    awayExtended: { homeRecord: { wins: 0, losses: 0 }, awayRecord: { wins: 0, losses: 0 }, lastGameDate: "", avgScoreLast5: 0, avgScoreLast10: 0, scoringTrend: 0, defenseTrend: 0, headToHeadResults: [], strengthOfSchedule: 0.5, restDays: 3, consecutiveAwayGames: 0 },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: {},
    awayAdvanced: {},
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-04-16",
  };
}

// ─── (a) all hasSignal=false → only Elo contributes ─────────────────────

describe("blendFactors — all hasSignal=false", () => {
  it("pools every other factor's weight into rating_diff so Elo gets full 1.0", () => {
    const factors: FactorContribution[] = [
      f("rating_diff", 200, 0.40, true, true),
      f("rest_diff", 0, 0.05, true, false),
      f("recent_form", 0, 0.10, true, false),
      f("travel", 0, 0.03, true, false),
      f("injuries_nba", 0, 0.19, true, false),
      f("back_to_back", 0, 0.08, true, false),
      f("net_rating", 0, 0.11, true, false),
      f("rotation_fatigue", 0, 0.04, true, false),
    ];
    const blended = blendFactors(factors);
    const rating = blended.find((x) => x.key === "rating_diff")!;
    expect(rating.weight).toBeCloseTo(1.0, 6);

    // Elo delta contribution equals the full 200 (no dilution).
    const totalDelta = blended.reduce(
      (sum, x) => sum + (x.available ? x.homeDelta * x.weight : 0),
      0,
    );
    expect(totalDelta).toBeCloseTo(200, 6);

    // Probability equals pure-Elo probability.
    const blendedProb = ratingDeltaToHomeWinProb(totalDelta);
    const eloOnlyProb = ratingDeltaToHomeWinProb(200);
    expect(blendedProb).toBeCloseTo(eloOnlyProb, 6);
  });

  it("predictGame on a 200 Elo NBA gap lands within 2pp of pure-Elo probability on a zero-signal night", () => {
    // Home 1600, away 1400; NBA home bonus is ~90, so eloDelta = 290.
    // With zero signal on every other factor, rating_diff should absorb
    // essentially all the weight and the prediction should track pure Elo.
    const ctx = makeHoopsContext(1600, 1400, "NBA");
    const pred = predictGame(ctx);

    const base = computeBaseFactors(ctx);
    const eloDelta = base.find((x) => x.key === "rating_diff")!.homeDelta;
    const pureEloProb = ratingDeltaToHomeWinProb(eloDelta);

    expect(Math.abs(pred.homeWinProbability - pureEloProb)).toBeLessThan(0.02);
  });
});

// ─── (b) partial signal — weight moves only from no-signal factors ──────

describe("blendFactors — partial signal", () => {
  it("only unsignaled factors donate weight; signaled non-Elo factors keep theirs", () => {
    const factors: FactorContribution[] = [
      f("rating_diff", 150, 0.40, true, true),
      f("net_rating", 40, 0.11, true, true),     // real net-rating data
      f("injuries_nba", 0, 0.19, true, false),   // no injuries
      f("back_to_back", 0, 0.08, true, false),   // no b2b
      f("rotation_fatigue", 0, 0.04, true, false),
      f("recent_form", 20, 0.10, true, true),    // form signal
      f("rest_diff", 0, 0.05, true, false),      // equal rest
      f("travel", 0, 0.03, true, false),
    ];
    const blended = blendFactors(factors);

    const rating = blended.find((x) => x.key === "rating_diff")!;
    // Pool: 0.19 + 0.08 + 0.04 + 0.05 + 0.03 = 0.39 moved to rating_diff.
    expect(rating.weight).toBeCloseTo(0.40 + 0.39, 6);

    // Signaled non-Elo factors untouched.
    expect(blended.find((x) => x.key === "net_rating")!.weight).toBeCloseTo(0.11, 6);
    expect(blended.find((x) => x.key === "recent_form")!.weight).toBeCloseTo(0.10, 6);

    // Unsignaled factors zeroed.
    for (const key of ["injuries_nba", "back_to_back", "rotation_fatigue", "rest_diff", "travel"]) {
      expect(blended.find((x) => x.key === key)!.weight).toBe(0);
    }

    // Total weight preserved.
    const total = blended.reduce((s, x) => s + x.weight, 0);
    expect(total).toBeCloseTo(1.0, 6);
  });

  it("does not pool weight from factors that are already unavailable", () => {
    // redistributeWeights zeroes unavailable factors upstream, so blendFactors
    // should see weight=0 for them and ignore. Also verifies the invariant
    // available=false → hasSignal=false is respected without double-counting.
    const factors: FactorContribution[] = [
      f("rating_diff", 100, 0.40, true, true),
      f("net_rating", 30, 0.11, true, true),
      f("some_unavail", 0, 0, false, false),    // already zeroed
      f("injuries_nba", 0, 0.49, true, false),  // no signal → pools
    ];
    const blended = blendFactors(factors);
    expect(blended.find((x) => x.key === "rating_diff")!.weight).toBeCloseTo(0.89, 6);
    expect(blended.find((x) => x.key === "injuries_nba")!.weight).toBe(0);
    expect(blended.find((x) => x.key === "some_unavail")!.weight).toBe(0);
  });

  it("returns factors unchanged if rating_diff is missing (safety)", () => {
    const factors: FactorContribution[] = [
      f("some_factor", 0, 0.5, true, false),
      f("other", 0, 0.5, true, false),
    ];
    const blended = blendFactors(factors);
    expect(blended.map((x) => x.weight)).toEqual([0.5, 0.5]);
  });
});

// ─── (c) soccer probabilities still sum to 1.0 after the fix ────────────

describe("soccer H + D + A sums to 1.0 after blendFactors", () => {
  for (const league of ["EPL", "MLS", "UCL"] as const) {
    it(`${league}: home + draw + away ≈ 1.0 with moderate home edge`, () => {
      const ctx = makeSoccerContext(league, {
        homeElo: 1650,
        awayElo: 1450,
      });
      const result = predictGame(ctx);

      const sum = result.homeWinProbability + (result.drawProbability ?? 0) + result.awayWinProbability;
      expect(Math.abs(1 - sum)).toBeLessThan(0.001);
      expect(result.drawProbability).toBeGreaterThan(0);
    });

    it(`${league}: probabilities still sum to 1.0 on a zero-factor-signal night`, () => {
      // Soccer factors will mostly have no signal when fixture congestion,
      // injuries, manager change etc. all come back empty.
      const ctx = makeSoccerContext(league, {
        homeElo: 1700,
        awayElo: 1400,
      });
      const result = predictGame(ctx);
      const sum = result.homeWinProbability + (result.drawProbability ?? 0) + result.awayWinProbability;
      expect(Math.abs(1 - sum)).toBeLessThan(0.001);
    });
  }
});

// ─── (d) NBA / NHL / MLS weights sum to exactly 1.0 ─────────────────────

describe("factor weights sum to 1.0 after normalization", () => {
  it("NBA canonical base+sport weights sum to 1.0", () => {
    const ctx = makeHoopsContext(1500, 1500, "NBA");
    const base = computeBaseFactors(ctx);
    const sport = computeNBAFactors(ctx);
    const all = [...base, ...sport];
    const normalized = normalizeWeightsToOne(all);
    const sum = normalized.reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it("NHL canonical base+sport weights sum to 1.0", () => {
    const ctx = makeHoopsContext(1500, 1500, "NHL");
    const base = computeBaseFactors(ctx);
    const sport = computeNHLFactors(ctx);
    const all = [...base, ...sport];
    const normalized = normalizeWeightsToOne(all);
    const sum = normalized.reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it("MLS canonical base+sport weights sum to 1.0", () => {
    const ctx = makeSoccerContext("MLS");
    const base = computeBaseFactors(ctx);
    const sport = computeMLSFactors(ctx);
    const all = [...base, ...sport];
    const normalized = normalizeWeightsToOne(all);
    const sum = normalized.reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it("end-to-end: predictGame output factor weights sum to 1.0 for NBA", () => {
    const ctx = makeHoopsContext(1600, 1400, "NBA");
    const pred = predictGame(ctx);
    const sum = pred.factors.reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it("end-to-end: predictGame output factor weights sum to 1.0 for NHL", () => {
    const ctx = makeHoopsContext(1600, 1400, "NHL");
    const pred = predictGame(ctx);
    const sum = pred.factors.reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it("end-to-end: predictGame output factor weights sum to 1.0 for MLS", () => {
    const ctx = makeSoccerContext("MLS", { homeElo: 1600, awayElo: 1400 });
    const pred = predictGame(ctx);
    const sum = pred.factors.reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });
});
