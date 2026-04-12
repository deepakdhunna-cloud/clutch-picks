/**
 * Calibration harness — tracks whether model confidence means anything.
 *
 * Computes Brier score, log loss, and reliability curves per league.
 * A random 50/50 model scores Brier = 0.25. Anything under 0.22 is real signal.
 *
 * sampleSize < 100 per league is not statistically meaningful;
 * displayed for transparency only.
 */

import { prisma } from "../prisma";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ReliabilityBucket {
  bucket: string;
  midpoint: number;
  predictedWinRate: number;
  actualWinRate: number;
  count: number;
}

export interface CalibrationMetrics {
  league: string;
  brierScore: number;
  logLoss: number;
  sampleSize: number;
  reliabilityCurve: ReliabilityBucket[];
  note?: string;
}

// ─── Core computations ──────────────────────────────────────────────────

const EPS = 1e-15; // Numerical safety for log loss

/**
 * Brier score: mean((predicted_prob - actual_outcome)^2)
 * Lower is better. Random = 0.25. Good model < 0.22.
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
 * Log loss (cross-entropy): -mean(y*log(p) + (1-y)*log(1-p))
 * Lower is better. Random = ln(2) ≈ 0.693.
 */
export function computeLogLoss(
  predictions: Array<{ predictedProb: number; actualOutcome: 0 | 1 }>
): number {
  if (predictions.length === 0) return Math.log(2);
  const sum = predictions.reduce((acc, p) => {
    const prob = Math.max(EPS, Math.min(1 - EPS, p.predictedProb));
    return (
      acc -
      (p.actualOutcome * Math.log(prob) +
        (1 - p.actualOutcome) * Math.log(1 - prob))
    );
  }, 0);
  return sum / predictions.length;
}

/**
 * Reliability curve: bucket predictions by confidence, compute actual win rate.
 * Buckets: 50-55, 55-60, 60-65, 65-70, 70-75, 75-80, 80-85, 85-90, 90-95, 95-100.
 */
export function computeReliabilityCurve(
  predictions: Array<{ predictedProb: number; actualOutcome: 0 | 1 }>
): ReliabilityBucket[] {
  const BUCKETS = [
    { label: "50-55", min: 0.50, max: 0.55, midpoint: 0.525 },
    { label: "55-60", min: 0.55, max: 0.60, midpoint: 0.575 },
    { label: "60-65", min: 0.60, max: 0.65, midpoint: 0.625 },
    { label: "65-70", min: 0.65, max: 0.70, midpoint: 0.675 },
    { label: "70-75", min: 0.70, max: 0.75, midpoint: 0.725 },
    { label: "75-80", min: 0.75, max: 0.80, midpoint: 0.775 },
    { label: "80-85", min: 0.80, max: 0.85, midpoint: 0.825 },
    { label: "85-90", min: 0.85, max: 0.90, midpoint: 0.875 },
    { label: "90-95", min: 0.90, max: 0.95, midpoint: 0.925 },
    { label: "95-100", min: 0.95, max: 1.01, midpoint: 0.975 },
  ];

  return BUCKETS.map((b) => {
    // Use winner probability (max of home/away)
    const inBucket = predictions.filter((p) => {
      const winnerProb = Math.max(p.predictedProb, 1 - p.predictedProb);
      return winnerProb >= b.min && winnerProb < b.max;
    });

    const count = inBucket.length;
    const actualWinRate =
      count > 0
        ? inBucket.reduce((sum, p) => sum + p.actualOutcome, 0) / count
        : 0;

    return {
      bucket: b.label,
      midpoint: b.midpoint,
      predictedWinRate: b.midpoint,
      actualWinRate,
      count,
    };
  });
}

// ─── Database operations ────────────────────────────────────────────────

/**
 * Compute and store calibration snapshot for a league (or "ALL").
 * Reads resolved PredictionResults from the DB.
 */
export async function computeAndStoreCalibration(
  league: string
): Promise<CalibrationMetrics> {
  const where = league === "ALL"
    ? { wasCorrect: { not: null }, homeWinProb: { not: null } }
    : { sport: league, wasCorrect: { not: null }, homeWinProb: { not: null } };

  const results = await prisma.predictionResult.findMany({
    where: where as any,
    select: {
      homeWinProb: true,
      wasCorrect: true,
      predictedWinner: true,
    },
  });

  // Convert to (predictedProb, actualOutcome) pairs
  // predictedProb = probability that the PREDICTED winner wins
  // actualOutcome = 1 if they won, 0 if they lost
  const pairs = results
    .filter((r) => r.homeWinProb !== null && r.wasCorrect !== null)
    .map((r) => {
      const homeProb = r.homeWinProb!;
      const winnerProb =
        r.predictedWinner === "home"
          ? homeProb
          : 1 - homeProb;
      return {
        predictedProb: winnerProb,
        actualOutcome: (r.wasCorrect ? 1 : 0) as 0 | 1,
      };
    });

  const brier = computeBrierScore(pairs);
  const logLoss = computeLogLoss(pairs);
  const curve = computeReliabilityCurve(pairs);

  const metrics: CalibrationMetrics = {
    league,
    brierScore: brier,
    logLoss,
    sampleSize: pairs.length,
    reliabilityCurve: curve,
  };

  if (pairs.length < 100) {
    metrics.note =
      "sampleSize < 100 is not statistically meaningful; displayed for transparency only.";
  }

  // Store snapshot
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.calibrationSnapshot.upsert({
      where: {
        date_league: { date: today, league },
      },
      create: {
        date: today,
        league,
        brierScore: brier,
        logLoss,
        sampleSize: pairs.length,
        reliabilityCurveJson: JSON.stringify(curve),
      },
      update: {
        brierScore: brier,
        logLoss,
        sampleSize: pairs.length,
        reliabilityCurveJson: JSON.stringify(curve),
      },
    });
  } catch (e) {
    console.error(`[calibration] Failed to store snapshot for ${league}:`, e);
  }

  return metrics;
}

/**
 * Get the most recent calibration snapshot per league.
 * Returns one entry per league plus "ALL".
 */
export async function getLatestCalibration(): Promise<CalibrationMetrics[]> {
  const LEAGUES = ["NBA", "NFL", "MLB", "NHL", "MLS", "EPL", "NCAAF", "NCAAB", "ALL"];
  const results: CalibrationMetrics[] = [];

  for (const league of LEAGUES) {
    const snapshot = await prisma.calibrationSnapshot.findFirst({
      where: { league },
      orderBy: { date: "desc" },
    });

    if (snapshot) {
      const curve = JSON.parse(snapshot.reliabilityCurveJson) as ReliabilityBucket[];
      results.push({
        league: snapshot.league,
        brierScore: snapshot.brierScore,
        logLoss: snapshot.logLoss,
        sampleSize: snapshot.sampleSize,
        reliabilityCurve: curve,
        note:
          snapshot.sampleSize < 100
            ? "sampleSize < 100 is not statistically meaningful; displayed for transparency only."
            : undefined,
      });
    }
  }

  return results;
}
