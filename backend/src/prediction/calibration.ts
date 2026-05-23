/**
 * Calibration harness — tracks whether model confidence means anything.
 *
 * Computes Brier score, log loss, and reliability curves per league.
 * A random 50/50 model scores Brier = 0.25. Anything under 0.22 is real signal.
 *
 * sampleSize < 100 per league is not statistically meaningful;
 * displayed for transparency only.
 *
 * ⚠️ HISTORICAL-ELO DATA LEAK (Gap 5 audit, prompt-a):
 * computeAndStoreCalibration reads PredictionResult's point-in-time selected
 * outcome probability (homeWinProb / awayWinProb / drawProb, with confidence
 * fallback for legacy rows). Those fields should reflect the information a
 * model held when the game tipped off — NOT the current rating. If any backfill
 * ever re-predicts past games with today's Elo, the reliability curves here
 * will be silently biased. We do not yet persist Elo history per game, so this
 * caveat is surfaced via a console warning on every compute call and is
 * included in the /api/calibration response under `warnings`.
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

function normalizeProbability(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const probability = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, probability));
}

function selectedOutcomeProbability(row: {
  predictedWinner: string;
  predictedOutcome?: string | null;
  confidence: number;
  homeWinProb?: number | null;
  awayWinProb?: number | null;
  drawProb?: number | null;
}): number {
  const fallback = normalizeProbability(row.confidence / 100) ?? 0.5;
  const predictedOutcome = row.predictedOutcome ?? row.predictedWinner;

  if (predictedOutcome === "home") {
    return normalizeProbability(row.homeWinProb) ?? fallback;
  }
  if (predictedOutcome === "away") {
    return (
      normalizeProbability(row.awayWinProb) ??
      (normalizeProbability(row.homeWinProb) !== null
        ? 1 - normalizeProbability(row.homeWinProb)!
        : fallback)
    );
  }
  if (predictedOutcome === "draw") {
    return normalizeProbability(row.drawProb) ?? fallback;
  }

  return fallback;
}

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
 * Reliability curve: bucket predictions by selected-outcome probability,
 * compute actual win rate.
 * Buckets include 25-50 for three-way soccer draw reads, then 5-point bands
 * through 100 for normal binary favorites.
 */
export function computeReliabilityCurve(
  predictions: Array<{ predictedProb: number; actualOutcome: 0 | 1 }>
): ReliabilityBucket[] {
  const BUCKETS = [
    { label: "25-30", min: 0.25, max: 0.30, midpoint: 0.275 },
    { label: "30-35", min: 0.30, max: 0.35, midpoint: 0.325 },
    { label: "35-40", min: 0.35, max: 0.40, midpoint: 0.375 },
    { label: "40-45", min: 0.40, max: 0.45, midpoint: 0.425 },
    { label: "45-50", min: 0.45, max: 0.50, midpoint: 0.475 },
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
    const inBucket = predictions.filter((p) => {
      return p.predictedProb >= b.min && p.predictedProb < b.max;
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
  // TODO(historical-elo-leak): see file header. PredictionResult probabilities
  // are assumed point-in-time; if that ever stops being true (e.g. a replay
  // backfill is added that recomputes past games using current Elo), these
  // reliability curves become meaningless. We log once per call so the leak
  // can be spotted in ops logs.
  console.warn(
    `[calibration] ${league}: reading stored probabilities as point-in-time. ` +
      `If a backfill ever re-predicts past games with current Elo, this curve is biased.`,
  );

  const where = league === "ALL"
    ? { wasCorrect: { not: null } }
    : { sport: league, wasCorrect: { not: null } };

  const results = await prisma.predictionResult.findMany({
    where: where as any,
    select: {
      confidence: true,
      homeWinProb: true,
      awayWinProb: true,
      drawProb: true,
      wasCorrect: true,
      predictedWinner: true,
      predictedOutcome: true,
    },
  });

  // Convert to (predictedProb, actualOutcome) pairs
  // predictedProb = probability assigned to the selected outcome
  // actualOutcome = 1 if that selected outcome happened, 0 otherwise
  const pairs = results
    .filter((r) => r.wasCorrect !== null)
    .map((r) => {
      return {
        predictedProb: selectedOutcomeProbability(r),
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
  const LEAGUES = ["NBA", "NFL", "MLB", "NHL", "MLS", "EPL", "UCL", "IPL", "TENNIS", "NCAAF", "NCAAB", "ALL"];
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
