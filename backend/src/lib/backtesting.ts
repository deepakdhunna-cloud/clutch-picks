/**
 * Backtesting Harness
 * Evaluates prediction accuracy against resolved game results.
 * Read-only analysis tool — does NOT modify weights automatically.
 * Weight suggestions are advisory only.
 */

import { prisma } from "../prisma";
import * as fs from "node:fs";
import * as path from "node:path";
import { getWeightsForSport, type SportFactorWeights } from "./predictions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfidenceBucket {
  label: string;        // e.g. "55-59"
  minConf: number;
  maxConf: number;
  total: number;
  correct: number;
  accuracy: number | null;         // actual accuracy % in this bucket
  midpoint: number;                // expected accuracy (midpoint of range)
  calibrationError: number | null; // |expected - actual| — 0 is perfect
}

export interface SportBacktestResult {
  sport: string;
  total: number;
  correct: number;
  accuracy: number | null;
  logLoss: number | null;  // lower is better; perfect calibration ≈ ln(2) ≈ 0.693
  buckets: ConfidenceBucket[];
  meanCalibrationError: number | null; // average |predicted - actual| across populated buckets
}

export interface BacktestResults {
  runAt: string;               // ISO timestamp
  totalResolved: number;
  totalCorrect: number;
  overallAccuracy: number | null;
  overallLogLoss: number | null;
  perSport: SportBacktestResult[];
  tossUp: {
    total: number;
    correct: number;
    accuracy: number | null;
  };
  weightSuggestions: WeightSuggestion[];
}

export interface WeightSuggestion {
  sport: string;
  observation: string;   // human-readable diagnosis
  suggestions: Array<{
    factor: keyof SportFactorWeights;
    currentWeight: number;
    suggestedWeight: number;
    rationale: string;
  }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_BUCKETS = [
  { label: "50-54", min: 50, max: 54, midpoint: 52 },
  { label: "55-59", min: 55, max: 59, midpoint: 57 },
  { label: "60-64", min: 60, max: 64, midpoint: 62 },
  { label: "65-69", min: 65, max: 69, midpoint: 67 },
  { label: "70-74", min: 70, max: 74, midpoint: 72 },
  { label: "75-79", min: 75, max: 79, midpoint: 77 },
  { label: "80-84", min: 80, max: 84, midpoint: 82 },
  { label: "85-89", min: 85, max: 89, midpoint: 87 },
];

// Directory where backtest snapshots are saved
const RESULTS_DIR = path.join(process.cwd(), "backtest-results");

// ─── Log-loss ─────────────────────────────────────────────────────────────────

/**
 * Compute binary cross-entropy log-loss for a set of predictions.
 * confidence is the model's predicted win probability (50–100 scale).
 * wasCorrect is whether the predicted winner actually won.
 * Lower log-loss = better calibrated. Perfect calibration ≈ 0.693 (ln(2)) for 50/50.
 */
function computeLogLoss(
  rows: Array<{ confidence: number; wasCorrect: boolean }>
): number | null {
  if (rows.length === 0) return null;
  let sum = 0;
  for (const { confidence, wasCorrect } of rows) {
    // Convert confidence (50–100) to probability (0.5–1.0)
    const p = Math.min(0.999, Math.max(0.001, confidence / 100));
    // Binary cross-entropy: -[y*log(p) + (1-y)*log(1-p)]
    const y = wasCorrect ? 1 : 0;
    sum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return sum / rows.length;
}

// ─── Main backtest function ───────────────────────────────────────────────────

export async function runBacktest(): Promise<BacktestResults> {
  // Fetch all resolved predictions
  const resolved = await prisma.predictionResult.findMany({
    where: { wasCorrect: { not: null } },
    select: {
      sport: true,
      confidence: true,
      wasCorrect: true,
      isTossUp: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // ── Group by sport ─────────────────────────────────────────────────────────
  const bySport = new Map<
    string,
    Array<{ confidence: number; wasCorrect: boolean; isTossUp: boolean }>
  >();

  let totalCorrect = 0;
  let tossUpTotal = 0;
  let tossUpCorrect = 0;

  for (const row of resolved) {
    if (row.wasCorrect === null) continue;
    const sport = row.sport;
    if (!bySport.has(sport)) bySport.set(sport, []);
    bySport.get(sport)!.push({
      confidence: row.confidence,
      wasCorrect: row.wasCorrect,
      isTossUp: row.isTossUp,
    });
    if (row.wasCorrect) totalCorrect++;
    if (row.isTossUp) {
      tossUpTotal++;
      if (row.wasCorrect) tossUpCorrect++;
    }
  }

  // ── Per-sport analysis ─────────────────────────────────────────────────────
  const perSport: SportBacktestResult[] = [];

  for (const [sport, rows] of bySport.entries()) {
    const total = rows.length;
    const correct = rows.filter((r) => r.wasCorrect).length;
    const accuracy = total > 0 ? (correct / total) * 100 : null;
    const logLoss = computeLogLoss(rows);

    // Confidence buckets for this sport
    const buckets: ConfidenceBucket[] = CONFIDENCE_BUCKETS.map((b) => {
      const inBucket = rows.filter((r) => r.confidence >= b.min && r.confidence <= b.max);
      const bucketTotal = inBucket.length;
      const bucketCorrect = inBucket.filter((r) => r.wasCorrect).length;
      const bucketAccuracy = bucketTotal > 0 ? (bucketCorrect / bucketTotal) * 100 : null;
      const calibrationError =
        bucketAccuracy !== null ? Math.abs(b.midpoint - bucketAccuracy) : null;

      return {
        label: b.label,
        minConf: b.min,
        maxConf: b.max,
        total: bucketTotal,
        correct: bucketCorrect,
        accuracy: bucketAccuracy !== null ? Math.round(bucketAccuracy * 10) / 10 : null,
        midpoint: b.midpoint,
        calibrationError:
          calibrationError !== null ? Math.round(calibrationError * 10) / 10 : null,
      };
    });

    // Mean calibration error across populated buckets only
    const populatedBuckets = buckets.filter((b) => b.calibrationError !== null);
    const meanCalibrationError =
      populatedBuckets.length > 0
        ? populatedBuckets.reduce((s, b) => s + b.calibrationError!, 0) /
          populatedBuckets.length
        : null;

    perSport.push({
      sport,
      total,
      correct,
      accuracy: accuracy !== null ? Math.round(accuracy * 10) / 10 : null,
      logLoss: logLoss !== null ? Math.round(logLoss * 10000) / 10000 : null,
      buckets,
      meanCalibrationError:
        meanCalibrationError !== null
          ? Math.round(meanCalibrationError * 10) / 10
          : null,
    });
  }

  // Sort sports by total predictions descending
  perSport.sort((a, b) => b.total - a.total);

  // ── Overall metrics ────────────────────────────────────────────────────────
  const overallAccuracy =
    resolved.length > 0 ? (totalCorrect / resolved.length) * 100 : null;

  const allRows = resolved
    .filter((r) => r.wasCorrect !== null)
    .map((r) => ({ confidence: r.confidence, wasCorrect: r.wasCorrect! }));
  const overallLogLoss = computeLogLoss(allRows);

  // ── Weight suggestions ─────────────────────────────────────────────────────
  const weightSuggestions = suggestWeightAdjustments({ perSport } as BacktestResults);

  const results: BacktestResults = {
    runAt: new Date().toISOString(),
    totalResolved: resolved.length,
    totalCorrect,
    overallAccuracy:
      overallAccuracy !== null ? Math.round(overallAccuracy * 10) / 10 : null,
    overallLogLoss:
      overallLogLoss !== null ? Math.round(overallLogLoss * 10000) / 10000 : null,
    perSport,
    tossUp: {
      total: tossUpTotal,
      correct: tossUpCorrect,
      accuracy:
        tossUpTotal > 0
          ? Math.round((tossUpCorrect / tossUpTotal) * 1000) / 10
          : null,
    },
    weightSuggestions,
  };

  // Persist snapshot to disk
  saveResultsSnapshot(results);

  return results;
}

// ─── Weight adjustment suggestions ───────────────────────────────────────────

/**
 * Advisory-only weight suggestions based on calibration data.
 * Looks at which confidence ranges are over/under-confident per sport
 * and suggests targeted factor weight adjustments.
 *
 * Logic:
 * - If accuracy is consistently LOWER than predicted confidence:
 *   The model is over-confident. Reduce the weight of the factors that
 *   contribute most to the composite score (high-weight factors).
 *   Specifically, reduce elo and winPct (the factors easiest to over-fit).
 * - If accuracy is consistently HIGHER than predicted confidence:
 *   The model is under-confident. Increase elo/winPct weights.
 * - If high-confidence buckets (≥70) underperform but low ones (50-65) are accurate:
 *   Strong predictors may be noisy — consider reducing advancedMetrics weight.
 * - If low-confidence buckets are WORSE than random (< 45%):
 *   Increase injuries/rest weight to better capture uncertainty.
 */
export function suggestWeightAdjustments(
  results: Pick<BacktestResults, "perSport">
): WeightSuggestion[] {
  const suggestions: WeightSuggestion[] = [];

  for (const sportResult of results.perSport) {
    // Skip sports with too few samples to draw conclusions
    if (sportResult.total < 20) continue;

    const weights = getWeightsForSport(sportResult.sport);
    const sportSuggestions: WeightSuggestion["suggestions"] = [];
    const observations: string[] = [];

    const populatedBuckets = sportResult.buckets.filter((b) => b.total >= 3);
    if (populatedBuckets.length === 0) continue;

    // Compute average signed calibration error across populated buckets
    // Positive = model predicts higher confidence than actual accuracy (over-confident)
    // Negative = model predicts lower confidence than actual accuracy (under-confident)
    const signedErrors = populatedBuckets.map((b) =>
      b.accuracy !== null ? b.midpoint - b.accuracy : 0
    );
    const avgSignedError =
      signedErrors.reduce((s, v) => s + v, 0) / signedErrors.length;

    // ── Over-confidence diagnosis ────────────────────────────────────────────
    if (avgSignedError > 8) {
      observations.push(
        `Over-confident by ~${Math.round(avgSignedError)}% on average. ` +
          `Model predicts higher win probability than results support.`
      );
      // Reduce the two highest-weight factors by ~15% of their current weight
      const eloWeight = weights.elo;
      const newEloWeight = Math.max(0.10, parseFloat((eloWeight * 0.85).toFixed(2)));
      if (newEloWeight !== eloWeight) {
        sportSuggestions.push({
          factor: "elo",
          currentWeight: eloWeight,
          suggestedWeight: newEloWeight,
          rationale: `Elo has the highest weight (${eloWeight}) and may be dominating the signal. ` +
            `Reducing by ~15% to pull predictions closer to 50%.`,
        });
      }
      const winPctWeight = weights.winPct;
      const newWinPctWeight = Math.max(0.04, parseFloat((winPctWeight * 0.85).toFixed(2)));
      if (newWinPctWeight !== winPctWeight) {
        sportSuggestions.push({
          factor: "winPct",
          currentWeight: winPctWeight,
          suggestedWeight: newWinPctWeight,
          rationale: `Win% can be noisy early season. Slight reduction reduces over-confidence.`,
        });
      }
    }

    // ── Under-confidence diagnosis ────────────────────────────────────────────
    if (avgSignedError < -8) {
      observations.push(
        `Under-confident by ~${Math.round(Math.abs(avgSignedError))}% on average. ` +
          `Model predictions are too conservative relative to actual accuracy.`
      );
      const eloWeight = weights.elo;
      const newEloWeight = Math.min(0.30, parseFloat((eloWeight * 1.10).toFixed(2)));
      if (newEloWeight !== eloWeight) {
        sportSuggestions.push({
          factor: "elo",
          currentWeight: eloWeight,
          suggestedWeight: newEloWeight,
          rationale: `Increasing Elo weight by ~10% to let strong teams stand out more.`,
        });
      }
    }

    // ── High-confidence bucket underperformance ───────────────────────────────
    const highConfBuckets = populatedBuckets.filter(
      (b) => b.minConf >= 70 && b.accuracy !== null
    );
    const avgHighConfAccuracy =
      highConfBuckets.length > 0
        ? highConfBuckets.reduce((s, b) => s + b.accuracy!, 0) /
          highConfBuckets.length
        : null;
    const avgHighConfMidpoint =
      highConfBuckets.length > 0
        ? highConfBuckets.reduce((s, b) => s + b.midpoint, 0) /
          highConfBuckets.length
        : null;

    if (
      avgHighConfAccuracy !== null &&
      avgHighConfMidpoint !== null &&
      avgHighConfMidpoint - avgHighConfAccuracy > 12
    ) {
      observations.push(
        `High-confidence predictions (≥70%) underperform by ~${Math.round(avgHighConfMidpoint - avgHighConfAccuracy)}%. ` +
          `Advanced metrics or Elo may be overclaiming in blowout-looking matchups.`
      );
      const advWeight = weights.advancedMetrics;
      if (advWeight > 0) {
        const newAdvWeight = Math.max(0.03, parseFloat((advWeight * 0.80).toFixed(2)));
        sportSuggestions.push({
          factor: "advancedMetrics",
          currentWeight: advWeight,
          suggestedWeight: newAdvWeight,
          rationale: `Advanced metrics may be amplifying extreme predictions. Reduce by 20%.`,
        });
      }
    }

    // ── Low-confidence bucket worse than random ───────────────────────────────
    const lowConfBuckets = populatedBuckets.filter(
      (b) => b.minConf <= 59 && b.accuracy !== null
    );
    const avgLowConfAccuracy =
      lowConfBuckets.length > 0
        ? lowConfBuckets.reduce((s, b) => s + b.accuracy!, 0) /
          lowConfBuckets.length
        : null;

    if (avgLowConfAccuracy !== null && avgLowConfAccuracy < 45) {
      observations.push(
        `Low-confidence predictions (50-59%) are at ${Math.round(avgLowConfAccuracy)}% accuracy — worse than random. ` +
          `Uncertainty signals (injuries/rest) may be underweighted.`
      );
      const injWeight = weights.injuries;
      const newInjWeight = Math.min(0.22, parseFloat((injWeight * 1.15).toFixed(2)));
      if (newInjWeight !== injWeight) {
        sportSuggestions.push({
          factor: "injuries",
          currentWeight: injWeight,
          suggestedWeight: newInjWeight,
          rationale: `Injury/availability signal is underweighted for toss-up games. Increase by ~15%.`,
        });
      }
      const restWeight = weights.restDays;
      const newRestWeight = Math.min(0.15, parseFloat((restWeight * 1.15).toFixed(2)));
      if (newRestWeight !== restWeight) {
        sportSuggestions.push({
          factor: "restDays",
          currentWeight: restWeight,
          suggestedWeight: newRestWeight,
          rationale: `Rest days are predictive in close games. Slight increase may improve toss-up accuracy.`,
        });
      }
    }

    // ── Log-loss check ────────────────────────────────────────────────────────
    // Well-calibrated model should have log-loss near 0.65–0.70 for 50–87% confidence range
    if (sportResult.logLoss !== null) {
      if (sportResult.logLoss > 0.75) {
        observations.push(
          `Log-loss of ${sportResult.logLoss} is above 0.75 — predictions are poorly calibrated. ` +
            `Consider lowering CALIBRATION_DAMPENER in predictions.ts to pull more toward 50%.`
        );
      } else if (sportResult.logLoss < 0.55 && sportResult.total >= 50) {
        observations.push(
          `Log-loss of ${sportResult.logLoss} is very low — model is well-calibrated or may be getting lucky. ` +
            `Consider raising CALIBRATION_DAMPENER slightly to allow more confident picks.`
        );
      }
    }

    // Only emit a suggestion entry if we have something to say
    if (observations.length > 0 || sportSuggestions.length > 0) {
      suggestions.push({
        sport: sportResult.sport,
        observation: observations.join(" "),
        suggestions: sportSuggestions,
      });
    }
  }

  return suggestions;
}

// ─── Snapshot persistence ─────────────────────────────────────────────────────

/**
 * Save a timestamped JSON snapshot of backtest results so runs can be
 * compared over time. Keeps the last 30 snapshots; deletes older ones.
 */
function saveResultsSnapshot(results: BacktestResults): void {
  try {
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }

    const filename = `backtest-${results.runAt.replace(/[:.]/g, "-")}.json`;
    const filepath = path.join(RESULTS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(results, null, 2), "utf8");

    // Also overwrite latest.json for easy access
    fs.writeFileSync(
      path.join(RESULTS_DIR, "latest.json"),
      JSON.stringify(results, null, 2),
      "utf8"
    );

    // Prune: keep only the 30 most recent snapshots (excluding latest.json)
    const files = fs
      .readdirSync(RESULTS_DIR)
      .filter((f) => f.startsWith("backtest-") && f.endsWith(".json"))
      .sort(); // lexicographic = chronological due to ISO timestamp naming

    if (files.length > 30) {
      const toDelete = files.slice(0, files.length - 30);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(RESULTS_DIR, f));
      }
    }
  } catch (err) {
    // Snapshot persistence is best-effort — never crash the request
    console.error("[backtest] Failed to save snapshot:", err);
  }
}

/**
 * Load the most recent saved backtest results, or null if none exist.
 */
export function loadLatestResults(): BacktestResults | null {
  try {
    const filepath = path.join(RESULTS_DIR, "latest.json");
    if (!fs.existsSync(filepath)) return null;
    return JSON.parse(fs.readFileSync(filepath, "utf8")) as BacktestResults;
  } catch {
    return null;
  }
}
