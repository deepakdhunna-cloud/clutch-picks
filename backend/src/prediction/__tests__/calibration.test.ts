/**
 * Tests for calibration.ts — Section 7 / Section 8.
 *
 * Validates Brier score, log loss, and reliability curve computations
 * against hand-calculated values.
 */

import { describe, it, expect } from "bun:test";
import { computeBrierScore, computeLogLoss, computeReliabilityCurve } from "../calibration";
import { withCalibrationError } from "../../scripts/runWeeklyCalibration";

describe("computeBrierScore", () => {
  it("returns 0 for perfect predictions", () => {
    const predictions = [
      { predictedProb: 1.0, actualOutcome: 1 as const },
      { predictedProb: 0.0, actualOutcome: 0 as const },
      { predictedProb: 1.0, actualOutcome: 1 as const },
      { predictedProb: 0.0, actualOutcome: 0 as const },
    ];
    expect(computeBrierScore(predictions)).toBe(0);
  });

  it("returns 0.25 for random (always 0.5) on balanced results", () => {
    const predictions = [
      { predictedProb: 0.5, actualOutcome: 1 as const },
      { predictedProb: 0.5, actualOutcome: 0 as const },
      { predictedProb: 0.5, actualOutcome: 1 as const },
      { predictedProb: 0.5, actualOutcome: 0 as const },
    ];
    expect(computeBrierScore(predictions)).toBe(0.25);
  });

  it("returns 0.25 for empty input (random baseline)", () => {
    expect(computeBrierScore([])).toBe(0.25);
  });

  it("matches hand calculation on 5-sample fixture", () => {
    // Hand calculation:
    // (0.7-1)^2 = 0.09
    // (0.3-0)^2 = 0.09
    // (0.8-1)^2 = 0.04
    // (0.6-0)^2 = 0.36
    // (0.9-1)^2 = 0.01
    // Sum = 0.59, mean = 0.59/5 = 0.118
    const predictions = [
      { predictedProb: 0.7, actualOutcome: 1 as const },
      { predictedProb: 0.3, actualOutcome: 0 as const },
      { predictedProb: 0.8, actualOutcome: 1 as const },
      { predictedProb: 0.6, actualOutcome: 0 as const },
      { predictedProb: 0.9, actualOutcome: 1 as const },
    ];
    expect(computeBrierScore(predictions)).toBeCloseTo(0.118, 3);
  });

  it("returns 1.0 for perfectly wrong predictions", () => {
    const predictions = [
      { predictedProb: 1.0, actualOutcome: 0 as const },
      { predictedProb: 0.0, actualOutcome: 1 as const },
    ];
    expect(computeBrierScore(predictions)).toBe(1.0);
  });
});

describe("computeLogLoss", () => {
  it("returns ln(2) for empty input (random baseline)", () => {
    expect(computeLogLoss([])).toBeCloseTo(Math.log(2), 5);
  });

  it("matches hand calculation on 5-sample fixture", () => {
    // Hand calculation (with eps safety):
    // -[1*ln(0.7) + 0*ln(0.3)] = -ln(0.7) ≈ 0.3567
    // -[0*ln(0.3) + 1*ln(0.7)] = -ln(0.7) ≈ 0.3567
    // -[1*ln(0.8) + 0*ln(0.2)] = -ln(0.8) ≈ 0.2231
    // -[0*ln(0.6) + 1*ln(0.4)] = -ln(0.4) ≈ 0.9163
    // -[1*ln(0.9) + 0*ln(0.1)] = -ln(0.9) ≈ 0.1054
    // Sum ≈ 1.9582, mean ≈ 0.3916
    const predictions = [
      { predictedProb: 0.7, actualOutcome: 1 as const },
      { predictedProb: 0.3, actualOutcome: 0 as const },
      { predictedProb: 0.8, actualOutcome: 1 as const },
      { predictedProb: 0.6, actualOutcome: 0 as const },
      { predictedProb: 0.9, actualOutcome: 1 as const },
    ];
    const result = computeLogLoss(predictions);
    expect(result).toBeCloseTo(0.3916, 2);
  });

  it("approaches 0 for confident correct predictions", () => {
    const predictions = [
      { predictedProb: 0.99, actualOutcome: 1 as const },
      { predictedProb: 0.01, actualOutcome: 0 as const },
    ];
    expect(computeLogLoss(predictions)).toBeLessThan(0.02);
  });

  it("handles extreme probabilities without NaN", () => {
    const predictions = [
      { predictedProb: 0.0, actualOutcome: 0 as const },
      { predictedProb: 1.0, actualOutcome: 1 as const },
    ];
    const result = computeLogLoss(predictions);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe("computeReliabilityCurve", () => {
  it("places predictions into correct buckets", () => {
    const predictions = [
      { predictedProb: 0.72, actualOutcome: 1 as const }, // winner prob = 0.72 → 70-75
      { predictedProb: 0.72, actualOutcome: 0 as const }, // winner prob = 0.72 → 70-75
      { predictedProb: 0.55, actualOutcome: 1 as const }, // winner prob = 0.55 → 55-60
      { predictedProb: 0.51, actualOutcome: 1 as const }, // winner prob = 0.51 → 50-55
    ];

    const curve = computeReliabilityCurve(predictions);

    // 50-55 bucket should have 1 prediction with 100% actual win rate
    const bucket50 = curve.find((b) => b.bucket === "50-55");
    expect(bucket50?.count).toBe(1);
    expect(bucket50?.actualWinRate).toBe(1);

    // 55-60 bucket should have 1 prediction with 100% actual win rate
    const bucket55 = curve.find((b) => b.bucket === "55-60");
    expect(bucket55?.count).toBe(1);

    // 70-75 bucket should have 2 predictions with 50% actual win rate
    const bucket70 = curve.find((b) => b.bucket === "70-75");
    expect(bucket70?.count).toBe(2);
    expect(bucket70?.actualWinRate).toBe(0.5);
  });

  it("returns all 10 buckets even when empty", () => {
    const curve = computeReliabilityCurve([]);
    expect(curve.length).toBe(10);
    for (const bucket of curve) {
      expect(bucket.count).toBe(0);
    }
  });

  it("correctly handles winner prob for away-favored games", () => {
    // Home prob 0.3 → winner is away at 0.7 → bucket 70-75
    const predictions = [
      { predictedProb: 0.3, actualOutcome: 0 as const }, // Home lost, away won
    ];
    const curve = computeReliabilityCurve(predictions);
    const bucket70 = curve.find((b) => b.bucket === "70-75");
    expect(bucket70?.count).toBe(1);
  });
});

describe("withCalibrationError", () => {
  it("adds a calibrationErrorPts field to every bucket", () => {
    const curve = computeReliabilityCurve([
      { predictedProb: 0.72, actualOutcome: 1 as const },
      { predictedProb: 0.72, actualOutcome: 0 as const },
    ]);
    const enhanced = withCalibrationError(curve);
    for (const b of enhanced) {
      expect(b).toHaveProperty("calibrationErrorPts");
    }
  });

  it("returns null calibrationErrorPts when bucket count = 0", () => {
    const enhanced = withCalibrationError(computeReliabilityCurve([]));
    for (const b of enhanced) {
      expect(b.count).toBe(0);
      expect(b.calibrationErrorPts).toBeNull();
    }
  });

  it("returns a signed calibrationErrorPts (predicted - actual), NOT absolute", () => {
    // 4 predictions in the 70-75 bucket (winner prob 0.72).
    // 1 of 4 correct → actual = 25%, predicted midpoint = 72.5% → signed
    // error = +47.5pts. This MUST be positive (over-confident model), not the
    // absolute 47.5 that the legacy Section-8 buckets computed.
    const preds = [
      { predictedProb: 0.72, actualOutcome: 1 as const },
      { predictedProb: 0.72, actualOutcome: 0 as const },
      { predictedProb: 0.72, actualOutcome: 0 as const },
      { predictedProb: 0.72, actualOutcome: 0 as const },
    ];
    const enhanced = withCalibrationError(computeReliabilityCurve(preds));
    const bucket70 = enhanced.find((b) => b.bucket === "70-75");
    expect(bucket70?.count).toBe(4);
    expect(bucket70?.calibrationErrorPts).not.toBeNull();
    expect(bucket70!.calibrationErrorPts!).toBeGreaterThan(0);
    expect(bucket70!.calibrationErrorPts!).toBeCloseTo(47.5, 1);
  });

  it("returns NEGATIVE calibrationErrorPts when model is under-confident", () => {
    // 4 predictions in 55-60 (winner prob 0.58), 4 of 4 correct → actual 100%,
    // predicted 57.5% → signed error = -42.5pts.
    const preds = [
      { predictedProb: 0.58, actualOutcome: 1 as const },
      { predictedProb: 0.58, actualOutcome: 1 as const },
      { predictedProb: 0.58, actualOutcome: 1 as const },
      { predictedProb: 0.58, actualOutcome: 1 as const },
    ];
    const enhanced = withCalibrationError(computeReliabilityCurve(preds));
    const bucket55 = enhanced.find((b) => b.bucket === "55-60");
    expect(bucket55?.count).toBe(4);
    expect(bucket55!.calibrationErrorPts!).toBeLessThan(0);
    expect(bucket55!.calibrationErrorPts!).toBeCloseTo(-42.5, 1);
  });
});
