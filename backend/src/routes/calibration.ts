/**
 * GET /api/calibration — public calibration endpoint.
 *
 * Returns the most recent Brier score, log loss, and reliability curve
 * per league. This is the honesty feature — lets anyone verify that
 * "our 65% picks win ~65% of the time."
 *
 * No auth required. Public endpoint.
 *
 * Note: sampleSize < 100 per league is not statistically meaningful.
 * The endpoint returns sampleSize so consumers can gate on it.
 */

import { Hono } from "hono";
import { getLatestCalibration, computeAndStoreCalibration } from "../prediction/calibration";

const calibrationRouter = new Hono();

/**
 * GET /api/calibration
 *
 * Returns the most recent calibration snapshot per league.
 * If no snapshots exist yet, computes them on the fly.
 */
calibrationRouter.get("/", async (c) => {
  try {
    let metrics = await getLatestCalibration();

    // If no snapshots exist, compute fresh ones
    if (metrics.length === 0) {
      const LEAGUES = ["NBA", "NFL", "MLB", "NHL", "MLS", "EPL", "UCL", "NCAAF", "NCAAB", "ALL"];
      metrics = [];
      for (const league of LEAGUES) {
        try {
          const m = await computeAndStoreCalibration(league);
          metrics.push(m);
        } catch {
          // Skip leagues that fail (e.g., no data)
        }
      }
    }

    return c.json({
      data: {
        calibration: metrics,
        generatedAt: new Date().toISOString(),
        description:
          "Calibration metrics for the prediction engine. " +
          "Brier score: lower is better (random=0.25, good<0.22). " +
          "Log loss: lower is better (random=0.693). " +
          "Reliability curve: predicted vs actual win rate per confidence bucket.",
      },
    });
  } catch (e) {
    console.error("[calibration] Error:", e);
    return c.json(
      { error: { message: "Failed to retrieve calibration data", code: "CALIBRATION_ERROR" } },
      500
    );
  }
});

export { calibrationRouter };
