/**
 * Backtest API
 * GET  /api/backtest              — run a fresh backtest and return results
 * GET  /api/backtest/latest       — return the most recent saved backtest (fast, no DB query)
 * POST /api/backtest/replay       — kick off async replay backtest (admin-gated)
 * GET  /api/backtest/replay/latest — return last replay backtest report
 * GET  /api/backtest/replay/status — check if replay is running
 */

import { Hono } from "hono";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { runBacktest, loadLatestResults } from "../lib/backtesting";
import { prisma } from "../prisma";
import { runReplayBacktest, getReplayProgress, type ReplayBacktestReport } from "../scripts/replayBacktest";

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

// ─── Replay backtest endpoints ──────────────────────────────────────────

function checkAdminKey(c: any): Response | null {
  const adminKey = process.env.CALIBRATION_ADMIN_KEY;
  if (!adminKey) {
    return c.json(
      { error: { message: "CALIBRATION_ADMIN_KEY not configured", code: "ADMIN_KEY_UNSET" } },
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
  return null;
}

// POST /api/backtest/replay — kick off async replay
backtestRouter.post("/replay", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  const progress = getReplayProgress();
  if (progress.running) {
    return c.json({
      data: {
        status: "already_running",
        startedAt: progress.startedAt,
        progress: progress.progress,
      },
    });
  }

  const jobId = `replay-${Date.now()}`;

  // Fire and forget — run in background
  void runReplayBacktest().catch((err) => {
    console.error("[replay] Backtest failed:", err?.message ?? err);
  });

  return c.json({
    data: {
      status: "started",
      jobId,
      note: "Replay running in background. Check /api/backtest/replay/status for progress, /api/backtest/replay/latest for results.",
    },
  });
});

// GET /api/backtest/replay/status — check if replay is running
backtestRouter.get("/replay/status", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  return c.json({ data: getReplayProgress() });
});

// GET /api/backtest/replay/latest — return last replay report
backtestRouter.get("/replay/latest", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  const latestPath = join(__dirname, "../../backtest-results/replay-latest.json");
  if (!existsSync(latestPath)) {
    return c.json({
      error: {
        message: "No replay backtest results available yet. POST /api/backtest/replay to start one.",
        code: "NO_RESULTS",
      },
    }, 404);
  }

  try {
    const content = await readFile(latestPath, "utf-8");
    const report = JSON.parse(content) as ReplayBacktestReport;
    return c.json({ data: report });
  } catch (err: any) {
    return c.json({
      error: { message: `Failed to read replay results: ${err?.message}`, code: "READ_ERROR" },
    }, 500);
  }
});
