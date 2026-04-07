/**
 * Backtest API
 * GET /api/backtest       — run a fresh backtest and return results
 * GET /api/backtest/latest — return the most recent saved backtest (fast, no DB query)
 */

import { Hono } from "hono";
import { runBacktest, loadLatestResults } from "../lib/backtesting";
import { prisma } from "../prisma";

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

// GET /api/backtest/diagnostic — show raw row counts so we can see what's actually in the DB
backtestRouter.get("/diagnostic", async (c) => {
  try {
    const cutoff30Min = new Date(Date.now() - 30 * 60 * 1000);
    const cutoff24Hr = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      totalRows,
      resolvedRows,
      unresolvedRows,
      unresolvedOlderThan30Min,
      unresolvedOlderThan24Hr,
      newest,
      oldest,
      oldestUnresolved,
      sampleRows,
      totalUserPicks,
      unresolvedUserPicks,
    ] = await Promise.all([
      prisma.predictionResult.count(),
      prisma.predictionResult.count({ where: { wasCorrect: { not: null } } }),
      prisma.predictionResult.count({ where: { actualWinner: null } }),
      prisma.predictionResult.count({ where: { actualWinner: null, createdAt: { lt: cutoff30Min } } }),
      prisma.predictionResult.count({ where: { actualWinner: null, createdAt: { lt: cutoff24Hr } } }),
      prisma.predictionResult.findFirst({ orderBy: { createdAt: "desc" }, select: { gameId: true, sport: true, createdAt: true, actualWinner: true } }),
      prisma.predictionResult.findFirst({ orderBy: { createdAt: "asc" }, select: { gameId: true, sport: true, createdAt: true, actualWinner: true } }),
      prisma.predictionResult.findFirst({ where: { actualWinner: null }, orderBy: { createdAt: "asc" }, select: { gameId: true, sport: true, createdAt: true } }),
      prisma.predictionResult.findMany({ where: { actualWinner: null, createdAt: { lt: cutoff30Min } }, take: 5, select: { gameId: true, sport: true, createdAt: true, predictedWinner: true } }),
      prisma.userPick.count(),
      prisma.userPick.count({ where: { result: null } }),
    ]);
    return c.json({
      data: {
        predictionResult: {
          totalRows,
          resolvedRows,
          unresolvedRows,
          unresolvedOlderThan30Min,
          unresolvedOlderThan24Hr,
          newest,
          oldest,
          oldestUnresolved,
          sampleUnresolvedOver30Min: sampleRows,
        },
        userPick: {
          totalUserPicks,
          unresolvedUserPicks,
        },
        now: new Date().toISOString(),
      },
    });
  } catch (err) {
    return c.json({ error: { message: String(err), code: "DIAG_ERROR" } }, 500);
  }
});
