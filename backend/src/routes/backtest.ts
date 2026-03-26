/**
 * Backtest API
 * GET /api/backtest       — run a fresh backtest and return results
 * GET /api/backtest/latest — return the most recent saved backtest (fast, no DB query)
 */

import { Hono } from "hono";
import { runBacktest, loadLatestResults } from "../lib/backtesting";

export const backtestRouter = new Hono();

// GET /api/backtest — run a fresh backtest
backtestRouter.get("/", async (c) => {
  try {
    const results = await runBacktest();
    return c.json({ data: results });
  } catch (err) {
    console.error("[backtest] runBacktest failed:", err);
    return c.json(
      { error: { message: "Backtest failed", code: "BACKTEST_ERROR" } },
      500
    );
  }
});

// GET /api/backtest/latest — return cached snapshot without re-running
backtestRouter.get("/latest", (c) => {
  const results = loadLatestResults();
  if (!results) {
    return c.json(
      { error: { message: "No backtest results available yet. Run GET /api/backtest first.", code: "NO_RESULTS" } },
      404
    );
  }
  return c.json({ data: results });
});
