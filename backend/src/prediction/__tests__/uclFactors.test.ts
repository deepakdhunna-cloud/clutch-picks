/**
 * UCL factor tests.
 *
 * Covers unavailable verified-data factors and the weight-budget invariant.
 *
 * xG factor removed — Understat and FBRef are both Cloudflare-blocked
 * from Railway. Test verifies xg_differential is NOT present.
 */

import { describe, it, expect } from "bun:test";
import { computeUCLFactors } from "../factors/ucl";
import { makeSoccerContext } from "./_soccerFixtures";

function factor(ctx: ReturnType<typeof makeSoccerContext>, key: string) {
  const f = computeUCLFactors(ctx).find((f) => f.key === key);
  if (!f) throw new Error(`factor ${key} not found`);
  return f;
}

describe("UCL — xG factor removed", () => {
  it("does not include xg_differential factor", () => {
    const ctx = makeSoccerContext("UCL");
    const factors = computeUCLFactors(ctx);
    const xg = factors.find((f) => f.key === "xg_differential");
    expect(xg).toBeUndefined();
  });
});

describe("UCL — pedigree", () => {
  it("is unavailable until verified pedigree data is loaded", () => {
    const ctx = makeSoccerContext("UCL", {
      game: {
        ...makeSoccerContext("UCL").game,
        homeTeam: { id: "1", name: "Real Madrid", abbreviation: "RMA", logo: "", record: { wins: 0, losses: 0 } },
        awayTeam: { id: "2", name: "Aston Villa",  abbreviation: "AVL", logo: "", record: { wins: 0, losses: 0 } },
      },
    });
    const f = factor(ctx, "ucl_pedigree");
    expect(f.available).toBe(false);
    expect(f.homeDelta).toBe(0);
  });
});

describe("UCL — continental travel", () => {
  it("is unavailable until verified city-coordinate data is loaded", () => {
    const ctx = makeSoccerContext("UCL", {
      game: {
        ...makeSoccerContext("UCL").game,
        homeTeam: { id: "1", name: "Real Madrid", abbreviation: "RMA", logo: "", record: { wins: 0, losses: 0 } },
        awayTeam: { id: "2", name: "Galatasaray", abbreviation: "GAL", logo: "", record: { wins: 0, losses: 0 } },
      },
    });
    const f = factor(ctx, "ucl_travel");
    expect(f.available).toBe(false);
    expect(f.homeDelta).toBe(0);
  });
});

describe("UCL — weight budget invariant", () => {
  it("factor weights sum to 0.42", () => {
    const ctx = makeSoccerContext("UCL");
    const factors = computeUCLFactors(ctx);
    const total = factors.reduce((s, f) => s + f.weight, 0);
    expect(total).toBeCloseTo(0.42, 6);
  });

  it("returns exactly 4 factors", () => {
    const ctx = makeSoccerContext("UCL");
    const factors = computeUCLFactors(ctx);
    expect(factors.length).toBe(4);
  });
});
