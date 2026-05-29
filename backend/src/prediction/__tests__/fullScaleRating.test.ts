import { describe, test, expect, afterEach } from "bun:test";
import { sumRatingDelta } from "../index";
import type { FactorContribution } from "../types";

const FLAG = "ENGINE_FULL_SCALE_RATING";

function factor(key: string, homeDelta: number, weight: number, available = true): FactorContribution {
  return { key, label: key, homeDelta, weight, available, hasSignal: homeDelta !== 0, evidence: "" };
}

afterEach(() => {
  delete process.env[FLAG];
});

describe("sumRatingDelta (#2 full-scale rating)", () => {
  const factors = [
    factor("rating_diff", 100, 0.4), // a 100-pt home Elo edge
    factor("recent_form", 40, 0.1),
    factor("rest_diff", 20, 0.05),
  ];

  test("legacy (flag off): weighted average shrinks the Elo edge to 40% of itself", () => {
    delete process.env[FLAG];
    // 100*0.4 + 40*0.1 + 20*0.05 = 40 + 4 + 1 = 45
    expect(sumRatingDelta(factors)).toBeCloseTo(45, 6);
  });

  test("full-scale (flag on): Elo enters at full scale + weighted factor adjustments", () => {
    process.env[FLAG] = "true";
    // eloBase 100 + (40*0.1 + 20*0.05) = 100 + 5 = 105
    expect(sumRatingDelta(factors)).toBeCloseTo(105, 6);
  });

  test("full-scale preserves earned confidence vs legacy (delta is larger, not shrunk)", () => {
    delete process.env[FLAG];
    const legacy = sumRatingDelta(factors);
    process.env[FLAG] = "true";
    const fullScale = sumRatingDelta(factors);
    expect(fullScale).toBeGreaterThan(legacy);
  });

  test("unavailable rating_diff (e.g. unseeded tennis) → eloBase 0 in full-scale mode", () => {
    process.env[FLAG] = "true";
    const f = [factor("rating_diff", 0, 0.4, false), factor("recent_form", 40, 0.1)];
    // eloBase 0 (unavailable) + 40*0.1 = 4
    expect(sumRatingDelta(f)).toBeCloseTo(4, 6);
  });

  test("skips unavailable non-rating factors in both modes", () => {
    const f = [factor("rating_diff", 80, 0.4), factor("rest_diff", 30, 0.05, false)];
    delete process.env[FLAG];
    expect(sumRatingDelta(f)).toBeCloseTo(32, 6); // 80*0.4
    process.env[FLAG] = "true";
    expect(sumRatingDelta(f)).toBeCloseTo(80, 6); // eloBase only
  });
});
