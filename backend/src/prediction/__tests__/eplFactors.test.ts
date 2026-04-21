/**
 * EPL factor tests.
 *
 * Covers the four EPL factors and the hard weight-budget invariant
 * (weights must sum to 0.42 exactly).
 *
 * xG factor removed — Understat and FBRef are both Cloudflare-blocked
 * from Railway. Test verifies xg_differential is NOT present.
 */

import { describe, it, expect } from "bun:test";
import { computeEPLFactors } from "../factors/epl";
import { makeSoccerContext } from "./_soccerFixtures";

function factor(ctx: ReturnType<typeof makeSoccerContext>, key: string) {
  const f = computeEPLFactors(ctx).find((f) => f.key === key);
  if (!f) throw new Error(`factor ${key} not found`);
  return f;
}

describe("EPL — xG factor removed", () => {
  it("does not include xg_differential factor", () => {
    const ctx = makeSoccerContext("EPL");
    const factors = computeEPLFactors(ctx);
    const xg = factors.find((f) => f.key === "xg_differential");
    expect(xg).toBeUndefined();
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

  it("returns exactly 4 factors", () => {
    const ctx = makeSoccerContext("EPL");
    const factors = computeEPLFactors(ctx);
    expect(factors.length).toBe(4);
  });
});
