/**
 * Tests for probability.ts — Section 8 placeholder.
 *
 * TODO: Full test suite:
 *   - ratingDeltaToHomeWinProb(0) === 0.5
 *   - ratingDeltaToHomeWinProb(+400) ≈ 0.909
 *   - ratingDeltaToHomeWinProb(-400) ≈ 0.091
 *   - Monotonicity: higher delta → higher probability
 *   - Soccer draw probability estimation
 */

import { describe, it, expect } from "bun:test";
import { ratingDeltaToHomeWinProb } from "../probability";

describe("ratingDeltaToHomeWinProb", () => {
  it("returns 0.5 for zero delta (even matchup)", () => {
    expect(ratingDeltaToHomeWinProb(0)).toBe(0.5);
  });

  it("returns ~0.909 for +400 delta", () => {
    const prob = ratingDeltaToHomeWinProb(400);
    expect(prob).toBeGreaterThan(0.90);
    expect(prob).toBeLessThan(0.92);
  });

  it("returns ~0.091 for -400 delta", () => {
    const prob = ratingDeltaToHomeWinProb(-400);
    expect(prob).toBeGreaterThan(0.08);
    expect(prob).toBeLessThan(0.10);
  });

  it("is monotonically increasing", () => {
    const deltas = [-500, -200, -100, -50, 0, 50, 100, 200, 500];
    const probs = deltas.map(ratingDeltaToHomeWinProb);
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]).toBeGreaterThan(probs[i - 1]!);
    }
  });

  it("stays within [0, 1] for extreme values", () => {
    expect(ratingDeltaToHomeWinProb(2000)).toBeLessThanOrEqual(1);
    expect(ratingDeltaToHomeWinProb(2000)).toBeGreaterThan(0.99);
    expect(ratingDeltaToHomeWinProb(-2000)).toBeGreaterThanOrEqual(0);
    expect(ratingDeltaToHomeWinProb(-2000)).toBeLessThan(0.01);
  });

  it("is symmetric around 0.5", () => {
    const pos = ratingDeltaToHomeWinProb(150);
    const neg = ratingDeltaToHomeWinProb(-150);
    expect(Math.abs(pos + neg - 1)).toBeLessThan(0.0001);
  });
});
