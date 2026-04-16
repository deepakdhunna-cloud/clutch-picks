/**
 * UCL factor tests — Prompt B Gap 1.
 *
 * Covers pedigree-based stage factor, continental travel, cross-league
 * xG lookup miss, and the weight-budget invariant.
 */

import { describe, it, expect } from "bun:test";
import { computeUCLFactors } from "../factors/ucl";
import { makeSoccerContext } from "./_soccerFixtures";

function factor(ctx: ReturnType<typeof makeSoccerContext>, key: string) {
  const f = computeUCLFactors(ctx).find((f) => f.key === key);
  if (!f) throw new Error(`factor ${key} not found`);
  return f;
}

describe("UCL — pedigree", () => {
  it("gives home a positive Elo edge when their UCL pedigree is >= 300pts above the opponent", () => {
    const ctx = makeSoccerContext("UCL", {
      game: {
        ...makeSoccerContext("UCL").game,
        homeTeam: { id: "1", name: "Real Madrid", abbreviation: "RMA", logo: "", record: { wins: 0, losses: 0 } },
        awayTeam: { id: "2", name: "Aston Villa",  abbreviation: "AVL", logo: "", record: { wins: 0, losses: 0 } },
      },
    });
    const f = factor(ctx, "ucl_pedigree");
    expect(f.available).toBe(true);
    // Real Madrid 1920 - Aston Villa 1610 = 310 → 310/100 * 8 = 24.8, capped at 25
    expect(f.homeDelta).toBeGreaterThan(20);
    expect(f.homeDelta).toBeLessThanOrEqual(25);
    expect(f.evidence).toContain("Real Madrid");
    expect(f.evidence).toContain("pedigree");
  });

  it("is unavailable when either team is missing from the pedigree JSON", () => {
    const ctx = makeSoccerContext("UCL", {
      game: {
        ...makeSoccerContext("UCL").game,
        homeTeam: { id: "1", name: "Unknown FC", abbreviation: "UNK", logo: "", record: { wins: 0, losses: 0 } },
        awayTeam: { id: "2", name: "Real Madrid", abbreviation: "RMA", logo: "", record: { wins: 0, losses: 0 } },
      },
    });
    const f = factor(ctx, "ucl_pedigree");
    expect(f.available).toBe(false);
    expect(f.homeDelta).toBe(0);
  });
});

describe("UCL — continental travel", () => {
  it("applies +15 Elo home when away traveled >1500km", () => {
    // Real Madrid (Madrid) host Galatasaray (Istanbul) — ~2700km
    const ctx = makeSoccerContext("UCL", {
      game: {
        ...makeSoccerContext("UCL").game,
        homeTeam: { id: "1", name: "Real Madrid", abbreviation: "RMA", logo: "", record: { wins: 0, losses: 0 } },
        awayTeam: { id: "2", name: "Galatasaray", abbreviation: "GAL", logo: "", record: { wins: 0, losses: 0 } },
      },
    });
    const f = factor(ctx, "ucl_travel");
    expect(f.available).toBe(true);
    expect(f.homeDelta).toBe(15);
    expect(f.evidence).toContain("traveled");
  });

  it("applies 0 Elo for a short intra-city / short-haul away trip", () => {
    // Chelsea (London) host Arsenal (London) — same city
    const ctx = makeSoccerContext("UCL", {
      game: {
        ...makeSoccerContext("UCL").game,
        homeTeam: { id: "1", name: "Chelsea", abbreviation: "CHE", logo: "", record: { wins: 0, losses: 0 } },
        awayTeam: { id: "2", name: "Arsenal", abbreviation: "ARS", logo: "", record: { wins: 0, losses: 0 } },
      },
    });
    const f = factor(ctx, "ucl_travel");
    expect(f.available).toBe(true);
    expect(f.homeDelta).toBe(0);
  });
});

describe("UCL — xG cross-league miss", () => {
  it("is unavailable when xG lookup returned null on either side", () => {
    const ctx = makeSoccerContext("UCL", {
      homeXG: null,
      awayXG: { name: "Away FC", games: 25, xgPerGame: 1.8, xgaPerGame: 1.0, xgDiffPerGame: 0.8 },
    });
    const f = factor(ctx, "xg_differential");
    expect(f.available).toBe(false);
    expect(f.homeDelta).toBe(0);
    expect(f.evidence.toLowerCase()).toContain("unavailable");
  });
});

describe("UCL — weight budget invariant", () => {
  it("factor weights sum to 0.42", () => {
    const ctx = makeSoccerContext("UCL");
    const factors = computeUCLFactors(ctx);
    const total = factors.reduce((s, f) => s + f.weight, 0);
    expect(total).toBeCloseTo(0.42, 6);
  });
});
