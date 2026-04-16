/**
 * Weekly calibration runner.
 *
 * Invoked automatically by the Monday 03:00 UTC node-cron job in src/index.ts
 * and exposed as a manual endpoint (POST /api/calibration/run) gated on the
 * CALIBRATION_ADMIN_KEY env var.
 *
 * For each supported league we:
 *   1. computeAndStoreCalibration(league) — reads resolved PredictionResults
 *      from the DB, persists a CalibrationSnapshot row, and returns Brier
 *      score, log loss, sample size, and a 5%-wide reliability curve.
 *   2. Compute a simple overall accuracy (correct / sampleSize) from the DB
 *      as a supplementary number (Brier / log loss already measure
 *      calibration; accuracy is the headline the PM asks for).
 *   3. Append per-bucket calibration error ( |predicted - actual| * 100 ).
 *
 * The full snapshot is written to:
 *   backend/backtest-results/calibration-<ISO-date>.json
 *   backend/backtest-results/latest.json    (always overwritten)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../prisma";
import {
  computeAndStoreCalibration,
  type CalibrationMetrics,
  type ReliabilityBucket,
} from "../prediction/calibration";

export const CALIBRATION_LEAGUES = [
  "NFL",
  "NBA",
  "MLB",
  "NHL",
  "NCAAF",
  "NCAAB",
  "MLS",
  "EPL",
  "UCL",
] as const;

export type CalibrationLeague = (typeof CALIBRATION_LEAGUES)[number];

const RESULTS_DIR = path.join(process.cwd(), "backtest-results");

export interface ReliabilityBucketWithError extends ReliabilityBucket {
  /** Signed calibration error (predicted − actual) in percentage points, null when count=0 */
  calibrationErrorPts: number | null;
}

export interface LeagueCalibrationSnapshot {
  league: CalibrationLeague | "ALL";
  brierScore: number;
  logLoss: number;
  sampleSize: number;
  overallAccuracy: number | null;
  reliabilityCurve: ReliabilityBucketWithError[];
  note?: string;
}

export interface WeeklyCalibrationReport {
  runAt: string;
  leagues: LeagueCalibrationSnapshot[];
  // Carries the historical-Elo data-leak warning when applicable so anyone
  // reading the snapshot file knows these numbers still use current-Elo.
  warnings: string[];
}

/** Enhance a raw reliability curve with signed calibration error per bucket. */
function withCalibrationError(
  curve: ReliabilityBucket[],
): ReliabilityBucketWithError[] {
  return curve.map((b) => {
    const calibrationErrorPts =
      b.count > 0 ? Math.round((b.predictedWinRate - b.actualWinRate) * 1000) / 10 : null;
    return { ...b, calibrationErrorPts };
  });
}

/** Pull raw accuracy (correct/total) from PredictionResult for a league. */
async function leagueAccuracy(league: string): Promise<number | null> {
  const where =
    league === "ALL"
      ? { wasCorrect: { not: null } }
      : { sport: league, wasCorrect: { not: null } };

  const total = await prisma.predictionResult.count({ where: where as any });
  if (total === 0) return null;
  const correct = await prisma.predictionResult.count({
    where: { ...(where as any), wasCorrect: true },
  });
  return Math.round((correct / total) * 1000) / 10;
}

function logLeagueSummary(snap: LeagueCalibrationSnapshot): void {
  const brier = snap.brierScore.toFixed(4);
  const logLoss = snap.logLoss.toFixed(4);
  const acc = snap.overallAccuracy === null ? "—" : `${snap.overallAccuracy.toFixed(1)}%`;
  console.log(
    `[calibration] ${snap.league.padEnd(5)}  n=${String(snap.sampleSize).padStart(5)}  ` +
      `Brier=${brier}  logLoss=${logLoss}  acc=${acc}` +
      (snap.note ? `  (${snap.note})` : ""),
  );
  for (const b of snap.reliabilityCurve) {
    if (b.count === 0) continue;
    const err = b.calibrationErrorPts === null ? "—" : `${b.calibrationErrorPts.toFixed(1)}pts`;
    console.log(
      `[calibration]   bucket ${b.bucket.padEnd(6)}  n=${String(b.count).padStart(4)}  ` +
        `predicted=${(b.predictedWinRate * 100).toFixed(1)}%  ` +
        `actual=${(b.actualWinRate * 100).toFixed(1)}%  ` +
        `err=${err}`,
    );
  }
}

function writeSnapshot(report: WeeklyCalibrationReport): void {
  try {
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
    const datePart = report.runAt.slice(0, 10); // YYYY-MM-DD
    const datedPath = path.join(RESULTS_DIR, `calibration-${datePart}.json`);
    fs.writeFileSync(datedPath, JSON.stringify(report, null, 2), "utf8");
    // latest.json is the canonical pointer consumed by /api/calibration
    fs.writeFileSync(
      path.join(RESULTS_DIR, "latest.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
  } catch (err) {
    console.error("[calibration] Failed to persist snapshot:", err);
  }
}

export async function runWeeklyCalibration(): Promise<WeeklyCalibrationReport> {
  const runAt = new Date().toISOString();
  const leagues: LeagueCalibrationSnapshot[] = [];
  const warnings: string[] = [
    // See backtesting/calibration data-leak TODO (Gap 5 audit). Historical
    // predictions are recomputed against *current* Elo ratings, which biases
    // reliability curves for weeks where teams' Elo shifted significantly.
    "HISTORICAL-ELO DATA LEAK: reliability curves are computed from PredictionResult.homeWinProb snapshots " +
      "(good) but any backtest-style recomputation still uses current Elo (see lib/backtesting.ts TODO). " +
      "Reported curves are trustworthy only insofar as stored homeWinProb was captured at prediction time.",
  ];

  const targets: Array<CalibrationLeague | "ALL"> = [...CALIBRATION_LEAGUES, "ALL"];

  for (const league of targets) {
    try {
      const metrics: CalibrationMetrics = await computeAndStoreCalibration(league);
      const accuracy = await leagueAccuracy(league);
      const snap: LeagueCalibrationSnapshot = {
        league,
        brierScore: metrics.brierScore,
        logLoss: metrics.logLoss,
        sampleSize: metrics.sampleSize,
        overallAccuracy: accuracy,
        reliabilityCurve: withCalibrationError(metrics.reliabilityCurve),
        note: metrics.note,
      };
      leagues.push(snap);
      logLeagueSummary(snap);
    } catch (err) {
      console.error(`[calibration] ${league} failed:`, err);
    }
  }

  const report: WeeklyCalibrationReport = { runAt, leagues, warnings };
  writeSnapshot(report);
  console.log(`[calibration] Weekly run complete — ${leagues.length} leagues processed.`);
  return report;
}

// Allow running directly: `bun run src/scripts/runWeeklyCalibration.ts`
// Bun has no require.main equivalent — use import.meta.
if (
  // `import.meta.main` is Bun-specific; the cast silences TS in a node env.
  (import.meta as unknown as { main?: boolean }).main
) {
  runWeeklyCalibration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[calibration] Script failed:", err);
      process.exit(1);
    });
}
