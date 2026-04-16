/**
 * Calibration endpoints.
 *
 *   GET  /api/calibration       — public, returns per-league Brier, log loss,
 *                                  sample size, overall accuracy, and the
 *                                  full reliability curve per league.
 *   POST /api/calibration/run   — admin-only (env CALIBRATION_ADMIN_KEY),
 *                                  manually triggers the weekly calibration
 *                                  runner used by the Monday 03:00 UTC cron.
 *
 * This is the "honesty" surface: anyone can verify that "our 65% picks win
 * ~65% of the time." sampleSize < 100 per league is not statistically
 * meaningful and is flagged via the `note` field.
 */

import { Hono } from "hono";
import {
  getLatestCalibration,
  computeAndStoreCalibration,
} from "../prediction/calibration";
import {
  runWeeklyCalibration,
  CALIBRATION_LEAGUES,
  type LeagueCalibrationSnapshot,
  type ReliabilityBucketWithError,
} from "../scripts/runWeeklyCalibration";
import { prisma } from "../prisma";

const calibrationRouter = new Hono();

// ─── GET /api/calibration ───────────────────────────────────────────────────

/**
 * Returns calibration metrics + reliability curves per league.
 * Response shape (inside the standard `{ data }` envelope):
 *
 *   {
 *     generatedAt: ISO timestamp,
 *     description: short human-readable explainer,
 *     perLeague: LeagueCalibrationSnapshot[],      // NFL, NBA, ..., ALL
 *     warnings?: string[],                          // e.g. historical-Elo leak
 *   }
 *
 * The perLeague array always contains one entry per league the model supports
 * + one "ALL" aggregate. Leagues with no resolved predictions get zeroed
 * metrics and a note.
 */
calibrationRouter.get("/", async (c) => {
  try {
    let raw = await getLatestCalibration();
    // If nothing is stored, compute fresh on the fly (first-run fallback).
    if (raw.length === 0) {
      raw = [];
      for (const league of [...CALIBRATION_LEAGUES, "ALL"] as const) {
        try {
          raw.push(await computeAndStoreCalibration(league));
        } catch {
          // Skip leagues that fail (e.g. no resolved predictions yet)
        }
      }
    }

    // Enrich each league with overall accuracy and per-bucket calibration
    // error, matching the snapshot shape written by the weekly runner so
    // clients don't have to branch on which code path produced the data.
    const perLeague: LeagueCalibrationSnapshot[] = [];
    for (const m of raw) {
      const accuracy = await leagueAccuracy(m.league);
      const reliabilityCurve: ReliabilityBucketWithError[] =
        m.reliabilityCurve.map((b) => ({
          ...b,
          calibrationErrorPts:
            b.count > 0
              ? Math.round((b.predictedWinRate - b.actualWinRate) * 1000) / 10
              : null,
        }));

      perLeague.push({
        league: m.league as LeagueCalibrationSnapshot["league"],
        brierScore: m.brierScore,
        logLoss: m.logLoss,
        sampleSize: m.sampleSize,
        overallAccuracy: accuracy,
        reliabilityCurve,
        note: m.note,
      });
    }

    return c.json({
      data: {
        generatedAt: new Date().toISOString(),
        description:
          "Per-league calibration. Brier: lower is better (random=0.25, good<0.22). " +
          "Log loss: lower is better (random=0.693). " +
          "reliabilityCurve[].calibrationErrorPts is signed: positive means the model is over-confident in that bucket.",
        perLeague,
        warnings: [
          "HISTORICAL-ELO DATA LEAK: backtest-style recomputation in lib/backtesting.ts currently uses " +
            "current Elo, not time-of-game Elo. The numbers shown here are trustworthy only insofar as " +
            "stored homeWinProb was captured at prediction time. See TODO in lib/backtesting.ts.",
        ],
      },
    });
  } catch (e) {
    console.error("[calibration] Error:", e);
    return c.json(
      { error: { message: "Failed to retrieve calibration data", code: "CALIBRATION_ERROR" } },
      500,
    );
  }
});

// ─── POST /api/calibration/run ─────────────────────────────────────────────

/**
 * Manually trigger the weekly calibration job. Useful for:
 *   - First-run backfill after a deploy
 *   - Spot-checks after large data ingest events
 *   - CI smoke tests (see env CALIBRATION_ADMIN_KEY)
 *
 * Auth: requires the raw key to be sent in the `x-calibration-admin-key`
 * header. If CALIBRATION_ADMIN_KEY is not set in the environment, the
 * endpoint responds 503 — we refuse to run without a gate configured.
 */
calibrationRouter.post("/run", async (c) => {
  const adminKey = process.env.CALIBRATION_ADMIN_KEY;
  if (!adminKey) {
    return c.json(
      {
        error: {
          message:
            "CALIBRATION_ADMIN_KEY env var is not set — manual trigger disabled",
          code: "ADMIN_KEY_UNSET",
        },
      },
      503,
    );
  }
  const provided = c.req.header("x-calibration-admin-key");
  if (provided !== adminKey) {
    return c.json(
      { error: { message: "Forbidden", code: "FORBIDDEN" } },
      403,
    );
  }

  try {
    const report = await runWeeklyCalibration();
    return c.json({ data: report });
  } catch (e) {
    console.error("[calibration] Manual run failed:", e);
    return c.json(
      { error: { message: "Calibration run failed", code: "CALIBRATION_RUN_FAILED" } },
      500,
    );
  }
});

// ─── helpers ────────────────────────────────────────────────────────────────

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

export { calibrationRouter };
