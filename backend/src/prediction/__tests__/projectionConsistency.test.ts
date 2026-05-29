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
