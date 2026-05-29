import { describe, test, expect } from "bun:test";
import { reconcileProjectionToFinal } from "../index";
import type { SimulationProjection } from "../types";

function proj(home: number, away: number): SimulationProjection {
  return {
    engine: "game-script-v1",
    iterations: 50000,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    projectedHomeScore: home,
    projectedAwayScore: away,
    projectedSpread: home - away,
    projectedTotal: home + away,
    volatility: 5,
    upsetRisk: 0.4,
    signals: [],
  };
}

const isInt = (n: number) => Number.isInteger(n);

describe("reconcileProjectionToFinal — projected score line consistency", () => {
  test("NBA: whole numbers, arithmetically consistent, winner matches the pick", () => {
    const r = reconcileProjectionToFinal({
      sport: "NBA",
      projection: proj(112.3, 108.1),
      finalProbabilities: { home: 0.62, away: 0.38 },
    });
    expect(isInt(r.projectedHomeScore)).toBe(true);
    expect(isInt(r.projectedAwayScore)).toBe(true);
    expect(r.projectedTotal).toBe(r.projectedHomeScore + r.projectedAwayScore);
    expect(r.projectedSpread).toBe(r.projectedHomeScore - r.projectedAwayScore);
    expect(r.projectedHomeScore).toBeGreaterThan(r.projectedAwayScore); // home pick
  });

  test("MLB: low-scoring sports keep a decimal so the lean shows AND the team scores sum to the real total (no whole-number distortion)", () => {
    const r = reconcileProjectionToFinal({
      sport: "MLB",
      projection: proj(4.3, 4.1),
      finalProbabilities: { home: 0.55, away: 0.45 },
    });
    expect(r.projectedHomeScore).toBeGreaterThan(r.projectedAwayScore); // home pick favored
    expect(r.projectedTotal).toBeCloseTo(r.projectedHomeScore + r.projectedAwayScore, 5); // reconciles
    expect(r.projectedSpread).toBeCloseTo(r.projectedHomeScore - r.projectedAwayScore, 5);
    expect(r.projectedTotal).toBeGreaterThan(7.5); // real ~8.4 preserved, NOT forced down to a whole 7
  });

  test("away pick: the away team leads the whole-number line", () => {
    const r = reconcileProjectionToFinal({
      sport: "NHL",
      projection: proj(2.6, 3.1),
      finalProbabilities: { home: 0.4, away: 0.6 },
    });
    expect(r.projectedAwayScore).toBeGreaterThan(r.projectedHomeScore);
    expect(r.projectedSpread).toBe(r.projectedHomeScore - r.projectedAwayScore); // signed, away → negative
    expect(r.projectedSpread).toBeLessThan(0);
  });

  test("soccer draw: equal score line (decimal, low-scoring)", () => {
    const r = reconcileProjectionToFinal({
      sport: "EPL",
      projection: proj(1.4, 1.3),
      finalProbabilities: { home: 0.3, away: 0.3, draw: 0.4 },
    });
    expect(r.projectedHomeScore).toBe(r.projectedAwayScore);
    expect(r.projectedSpread).toBe(0);
    expect(r.projectedTotal).toBeCloseTo(r.projectedHomeScore + r.projectedAwayScore, 5);
  });

  test("tennis: keeps one decimal (expected games), not forced to whole", () => {
    const r = reconcileProjectionToFinal({
      sport: "TENNIS",
      projection: proj(6.5, 5.5),
      finalProbabilities: { home: 0.6, away: 0.4 },
    });
    expect(r.projectedTotal).toBeCloseTo(r.projectedHomeScore + r.projectedAwayScore, 1);
    // tennis line is allowed a fractional value (one decimal), unlike integer sports
    const oneDecimal = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;
    expect(oneDecimal(r.projectedHomeScore)).toBe(true);
  });
});

describe("reconcileProjectionToFinal — margin matches the displayed confidence", () => {
  // The bug the user caught: a 59% lean showing a 111-110 (1-point) line. The
  // displayed margin must reflect the displayed win probability, not a raw
  // simulator mean that disagrees in magnitude.
  test("NBA: a 59% favorite never shows a 1-point line (it should be ~3)", () => {
    const r = reconcileProjectionToFinal({
      sport: "NBA",
      // raw simulator says a near-tie (111-110) even though the pick is 59%
      projection: proj(111, 110),
      finalProbabilities: { home: 0.59, away: 0.41 },
    });
    const margin = r.projectedHomeScore - r.projectedAwayScore;
    expect(margin).toBeGreaterThanOrEqual(2); // a 59% NBA edge is ~2.8 pts, not 1
    expect(r.projectedHomeScore).toBeGreaterThan(r.projectedAwayScore);
    expect(r.projectedTotal).toBe(r.projectedHomeScore + r.projectedAwayScore);
  });

  test("NBA: a true coin-flip (52%) keeps a small margin", () => {
    const r = reconcileProjectionToFinal({
      sport: "NBA",
      projection: proj(112, 110),
      finalProbabilities: { home: 0.52, away: 0.48 },
    });
    const margin = r.projectedHomeScore - r.projectedAwayScore;
    expect(margin).toBeGreaterThanOrEqual(1); // favorite still leads
    expect(margin).toBeLessThanOrEqual(2); // but barely — matches the ~52%
  });

  test("monotonic: higher confidence always shows a wider (or equal) NBA margin", () => {
    const probs = [0.52, 0.58, 0.64, 0.7, 0.78];
    const margins = probs.map((p) => {
      const r = reconcileProjectionToFinal({
        sport: "NBA",
        projection: proj(112, 110),
        finalProbabilities: { home: p, away: 1 - p },
      });
      return r.projectedHomeScore - r.projectedAwayScore;
    });
    for (let i = 1; i < margins.length; i += 1) {
      expect(margins[i]!).toBeGreaterThanOrEqual(margins[i - 1]!);
    }
    // and the spread genuinely opens up across the range
    expect(margins[margins.length - 1]!).toBeGreaterThan(margins[0]!);
  });

  test("NFL: a 65% favorite shows a real spread (~5), not a field goal", () => {
    const r = reconcileProjectionToFinal({
      sport: "NFL",
      projection: proj(24, 23),
      finalProbabilities: { home: 0.65, away: 0.35 },
    });
    const margin = r.projectedHomeScore - r.projectedAwayScore;
    expect(margin).toBeGreaterThanOrEqual(4);
    expect(r.projectedHomeScore).toBeGreaterThan(r.projectedAwayScore);
  });

  test("MLB: confidence-sized run margin (decimal kept, sums to total)", () => {
    const r = reconcileProjectionToFinal({
      sport: "MLB",
      projection: proj(4.2, 4.1),
      finalProbabilities: { home: 0.62, away: 0.38 },
    });
    expect(r.projectedHomeScore).toBeGreaterThan(r.projectedAwayScore);
    expect(r.projectedTotal).toBeCloseTo(r.projectedHomeScore + r.projectedAwayScore, 5);
    expect(r.projectedSpread).toBeCloseTo(r.projectedHomeScore - r.projectedAwayScore, 5);
  });
});

describe("reconcileProjectionToFinal — audit regression cases", () => {
  // H2: the displayed spread must be monotonic in confidence ACROSS games even
  // when totals differ (the parity-stairstep bug let a 73% game outshow a 75%).
  test("H2: cross-game monotonicity holds regardless of total parity", () => {
    const lowConfHighTotal = reconcileProjectionToFinal({
      sport: "NBA",
      projection: proj(110, 109), // even total 219
      finalProbabilities: { home: 0.73, away: 0.27 },
    });
    const highConfOddTotal = reconcileProjectionToFinal({
      sport: "NBA",
      projection: proj(111, 109), // odd total 220
      finalProbabilities: { home: 0.75, away: 0.25 },
    });
    const lowMargin = lowConfHighTotal.projectedHomeScore - lowConfHighTotal.projectedAwayScore;
    const highMargin = highConfOddTotal.projectedHomeScore - highConfOddTotal.projectedAwayScore;
    expect(highMargin).toBeGreaterThanOrEqual(lowMargin); // never inverted
    // and totals stay within NBA bounds after the parity flex
    expect(highConfOddTotal.projectedTotal).toBeLessThanOrEqual(255);
    expect(highConfOddTotal.projectedTotal).toBeGreaterThanOrEqual(185);
  });

  // H1: a sub-50% soccer pick (the draw eats the rest) must still produce a
  // margin that tracks the head-to-head strength, not a fixed floor line.
  test("H1: soccer sub-50% picks scale with head-to-head strength", () => {
    const weak = reconcileProjectionToFinal({
      sport: "EPL",
      projection: proj(1.4, 1.3),
      finalProbabilities: { home: 0.4, away: 0.38, draw: 0.22 }, // home barely ahead
    });
    const strong = reconcileProjectionToFinal({
      sport: "EPL",
      projection: proj(1.4, 1.3),
      finalProbabilities: { home: 0.55, away: 0.2, draw: 0.25 }, // home clearly ahead
    });
    expect(weak.projectedHomeScore).toBeGreaterThanOrEqual(weak.projectedAwayScore);
    expect(strong.projectedHomeScore).toBeGreaterThan(strong.projectedAwayScore);
    // the clearly-stronger head-to-head pick shows a wider goal margin
    const weakMargin = weak.projectedHomeScore - weak.projectedAwayScore;
    const strongMargin = strong.projectedHomeScore - strong.projectedAwayScore;
    expect(strongMargin).toBeGreaterThan(weakMargin);
  });

  // H3: IPL display margins must be realistic (display SD capped), not 40+ run
  // blowouts at high confidence.
  test("H3: IPL high-confidence margin stays realistic", () => {
    const r = reconcileProjectionToFinal({
      sport: "IPL",
      projection: proj(170, 160),
      finalProbabilities: { home: 0.85, away: 0.15 },
    });
    const margin = r.projectedHomeScore - r.projectedAwayScore;
    expect(margin).toBeGreaterThan(0);
    expect(margin).toBeLessThanOrEqual(30); // not a 40+ run blowout at 85%
  });

  // L1: an extreme-confidence low-scoring pick must not project a literal shutout.
  test("L1: no 0-score shutout line at extreme confidence (NHL)", () => {
    const r = reconcileProjectionToFinal({
      sport: "NHL",
      projection: proj(2.0, 2.0), // total pinned near the floor
      finalProbabilities: { home: 0.97, away: 0.03 },
    });
    expect(r.projectedAwayScore).toBeGreaterThan(0); // loser still scores something
    expect(r.projectedHomeScore).toBeGreaterThan(r.projectedAwayScore);
  });
});
