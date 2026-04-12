/**
 * Calibration harness — STUB.
 *
 * TODO (Section 7): Implement full calibration:
 *   1. Extend PredictionResult model with homeWinProb (float)
 *   2. Write every prediction at serve time
 *   3. Resolve when game finalizes
 *   4. Nightly compute:
 *      - Brier score: mean((homeWinProb - actualHomeWin)^2)
 *      - Log loss: standard cross-entropy
 *      - Reliability curve: bucket by confidence, compute actual win rate
 *      - Per-league breakdowns
 *   5. GET /api/calibration endpoint
 *
 * For now, exports placeholder functions.
 */

export interface CalibrationMetrics {
  brierScore: number;
  logLoss: number;
  sampleSize: number;
  reliabilityCurve: Array<{
    bucket: string;
    midpoint: number;
    predictedWinRate: number;
    actualWinRate: number;
    count: number;
  }>;
}

/**
 * Compute Brier score from resolved predictions.
 * Brier = mean((predicted_prob - actual_outcome)^2)
 * A random 50/50 model scores 0.25. Anything under 0.22 is real signal.
 */
export function computeBrierScore(
  predictions: Array<{ predictedProb: number; actualOutcome: 0 | 1 }>
): number {
  if (predictions.length === 0) return 0.25;
  const sum = predictions.reduce(
    (acc, p) => acc + Math.pow(p.predictedProb - p.actualOutcome, 2),
    0
  );
  return sum / predictions.length;
}

/**
 * Compute log loss from resolved predictions.
 */
export function computeLogLoss(
  predictions: Array<{ predictedProb: number; actualOutcome: 0 | 1 }>
): number {
  if (predictions.length === 0) return Math.log(2); // Random baseline
  const eps = 0.001; // Prevent log(0)
  const sum = predictions.reduce((acc, p) => {
    const prob = Math.max(eps, Math.min(1 - eps, p.predictedProb));
    return (
      acc -
      (p.actualOutcome * Math.log(prob) +
        (1 - p.actualOutcome) * Math.log(1 - prob))
    );
  }, 0);
  return sum / predictions.length;
}
