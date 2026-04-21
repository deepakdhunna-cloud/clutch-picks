/**
 * EPL factor tests — Prompt B Gap 1.
 *
 * Covers the five EPL factors and the hard weight-budget invariant
 * (weights must sum to 0.42 exactly).
 */

import { describe, it, expect } from "bun:test";
import { computeEPLFactors } from "../factors/epl";
import { makeSoccerContext } from "./_soccerFixtures";

function factor(ctx: ReturnType<typeof makeSoccerContext>, key: string) {
  const f = computeEPLFactors(ctx).find((f) => f.key === key);
  if (!f) throw new Error(`factor ${key} not found`);
  return f;
}

describe("EPL — xG differential", () => {
  it("is available when BOTH teams have ≥10 FBRef games", () => {
    const ctx = makeSoccerContext("EPL", {
      homeXG: { name: "Home FC", games: 30, xgPerGame: 2.0, xgaPerGame: 0.9, xgDiffPerGame: 1.1 },
      awayXG: { name: "Away FC", games: 30, xgPerGame: 1.3, xgaPerGame: 1.1, xgDiffPerGame: 0.2 },
    });
    const f = factor(ctx, "xg_differential");
    expect(f.available).toBe(true);
    // diff = 1.1 - 0.2 = 0.9 → 0.9 * 30 = 27 Elo (under ±60 cap)
    expect(f.homeDelta).toBeCloseTo(27, 1);
    expect(f.evidence).toContain("xG diff");
  });

  it("is unavailable when a team has <10 games of xG sample", () => {
    const ctx = makeSoccerContext("EPL", {
      homeXG: { name: "Home FC", games: 6, xgPerGame: 1.7, xgaPerGame: 0.9, xgDiffPerGame: 0.8 },
      awayXG: { name: "Away FC", games: 30, xgPerGame: 1.2, xgaPerGame: 1.1, xgDiffPerGame: 0.1 },
    });
    const f = factor(ctx, "xg_differential");
    expect(f.available).toBe(false);
    expect(f.homeDelta).toBe(0);
  });
});

describe("EPL — fixture congestion", () => {
  it("penalizes the congested team — 3 games in 7 days for home → -20 Elo home", () => {
    const ctx = makeSoccerContext("EPL", {
      homeFixtureCongestion: { gamesLast7Days: 3, gamesLast14Days: 5 },
      awayFixtureCongestion: { gamesLast7Days: 1, gamesLast14Days: 3 },
    });
    const f = factor(ctx, "fixture_congestion");
    expect(f.available).toBe(true);
    // homeExcess=1, awayExcess=0 → delta = 0*20 - 1*20 = -20
    expect(f.homeDelta).toBe(-20);
    expect(f.evidence.toLowerCase()).toContain("hom played 3 matches");
  });
});

describe("EPL — key player availability", () => {
  it("favors home when away has a star player OUT", () => {
    const ctx = makeSoccerContext("EPL", {
      awayInjuries: {
        out: [
          { name: "Star Striker", position: "F", detail: "Hamstring" },
        ],
        doubtful: [],
        questionable: [],
        totalOut: 1, totalDoubtful: 0, totalQuestionable: 0,
      },
    });
    const f = factor(ctx, "key_player_availability");
    expect(f.available).toBe(true);
    // awayImpact = 25, homeImpact = 0 → delta = 25
    expect(f.homeDelta).toBe(25);
    expect(f.evidence).toContain("Star Striker");
  });
});

describe("EPL — manager change", () => {
  it("applies +15 Elo when home is inside its 30-day new-manager window", () => {
    const ctx = makeSoccerContext("EPL", {
      homeManagerChange: { daysSinceChange: 14, newManager: "New Gaffer" },
      awayManagerChange: null,
    });
    const f = factor(ctx, "manager_change");
    expect(f.available).toBe(true);
    expect(f.homeDelta).toBe(15);
    expect(f.evidence).toContain("New Gaffer");
  });

  it("cancels out when both teams just hired a new manager", () => {
    const ctx = makeSoccerContext("EPL", {
      homeManagerChange: { daysSinceChange: 5, newManager: "A" },
      awayManagerChange: { daysSinceChange: 9, newManager: "B" },
    });
    const f = factor(ctx, "manager_change");
    expect(f.homeDelta).toBe(0);
  });
});

describe("EPL — stakes", () => {
  it("gives +25 Elo to a home team fighting relegation with <10 games left vs mid-table away", () => {
    const ctx = makeSoccerContext("EPL", {
      homeStakes: { inTitleRace: false, inRelegationRace: true, inEuropeRace: false, gamesRemaining: 4 },
      awayStakes: { inTitleRace: false, inRelegationRace: false, inEuropeRace: false, gamesRemaining: 4 },
    });
    const f = factor(ctx, "stakes");
    expect(f.available).toBe(true);
    expect(f.homeDelta).toBe(25);
    expect(f.evidence).toContain("fighting relegation");
  });

  it("is unavailable early season when both teams have >=10 games remaining", () => {
    const ctx = makeSoccerContext("EPL", {
      homeStakes: { inTitleRace: true, inRelegationRace: false, inEuropeRace: false, gamesRemaining: 20 },
      awayStakes: { inTitleRace: false, inRelegationRace: false, inEuropeRace: false, gamesRemaining: 20 },
    });
    const f = factor(ctx, "stakes");
    expect(f.available).toBe(false);
  });
});

describe("EPL — weight budget invariant", () => {
  it("factor weights sum to 0.42 (remaining budget after 0.58 base)", () => {
    const ctx = makeSoccerContext("EPL");
    const factors = computeEPLFactors(ctx);
    const total = factors.reduce((s, f) => s + f.weight, 0);
    expect(total).toBeCloseTo(0.42, 6);
  });
});
