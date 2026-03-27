import { describe, test, expect } from "bun:test";
import { getWeightsForSport, type SportFactorWeights } from "../lib/predictions";
import { determineResult } from "../lib/resolve-picks";

// ─── Weight validation ────────────────────────────────────────────────────────

describe("Sport factor weights", () => {
  const sports = ["NBA", "NFL", "MLB", "NHL", "NCAAB", "NCAAF", "MLS", "EPL"];

  for (const sport of sports) {
    test(`${sport} weights sum to 1.00`, () => {
      const weights = getWeightsForSport(sport);
      const sum = Object.values(weights).reduce((s, v) => s + (v as number), 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.005);
    });
  }

  test("all weights are non-negative", () => {
    for (const sport of sports) {
      const weights = getWeightsForSport(sport);
      for (const [key, value] of Object.entries(weights)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("scoringTrend and defenseTrend are zero for all sports", () => {
    for (const sport of sports) {
      const weights = getWeightsForSport(sport);
      expect(weights.scoringTrend).toBe(0);
      expect(weights.defenseTrend).toBe(0);
    }
  });

  test("unknown sport falls back to NBA weights", () => {
    const weights = getWeightsForSport("UNKNOWN_SPORT");
    const nbaWeights = getWeightsForSport("NBA");
    expect(weights).toEqual(nbaWeights);
  });
});

// ─── Pick resolution ──────────────────────────────────────────────────────────

describe("determineResult", () => {
  test("home pick + home wins = win", () => {
    expect(determineResult("home", 110, 100)).toBe("win");
  });

  test("home pick + away wins = loss", () => {
    expect(determineResult("home", 90, 100)).toBe("loss");
  });

  test("away pick + away wins = win", () => {
    expect(determineResult("away", 90, 100)).toBe("win");
  });

  test("away pick + home wins = loss", () => {
    expect(determineResult("away", 110, 100)).toBe("loss");
  });

  test("tie returns null (unresolved)", () => {
    expect(determineResult("home", 100, 100)).toBeNull();
    expect(determineResult("away", 100, 100)).toBeNull();
  });

  test("invalid pickedTeam returns null", () => {
    expect(determineResult("invalid", 110, 100)).toBeNull();
  });
});
