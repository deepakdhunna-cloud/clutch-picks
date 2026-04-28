// Background worker process. Owns every setInterval + cron task that used
// to live in src/index.ts so scaling HTTP replicas > 1 doesn't cause
// duplicate ticks.
//
// Deployed as the 'clutch-picks-worker' Railway service:
//   - Same Docker image as web
//   - Railway service CMD override: `bun run worker`
//   - Replicas locked to 1 (no leader election; a second instance would
//     double-fire every cron)
//   - Healthcheck path cleared (no HTTP endpoint)
//   - Shares env vars with the web service (DATABASE_URL, admin keys, etc.)
//
// The web service runs `prisma migrate deploy` on boot; the worker skips
// migrations to avoid a deploy-time race.

// Sentry must initialize before any other imports so its instrumentation
// can wrap subsequent module loads for breadcrumbs.
import { initSentry, Sentry } from "./lib/sentry";
initSentry("worker");

import { env } from "./env";
import { prisma } from "./prisma";
import { cleanOldShadowLogs } from "./prediction/shadow";
import { resolvePicks } from "./lib/resolve-picks";
import {
  checkLiveGamesAndNotify,
  checkBigGameAlerts,
} from "./lib/notification-jobs";
import cron from "node-cron";
import { runWeeklyCalibration } from "./scripts/runWeeklyCalibration";
import { snapshotMarketLines } from "./scripts/snapshotMarketLines";
import {
  runIngestionCycle,
  recordCycleResult,
} from "./lib/ingestion/orchestrator";
import { withContext } from "./lib/logger";

// Per-job child loggers so every line is queryable by job name (e.g.
// `service:"worker" job:"resolve-picks"`) without scraping log prefixes.
const workerLogger = withContext({ tag: "worker" });
const shadowLogger = withContext({ tag: "shadow" });
const resolveLogger = withContext({ job: "resolve-picks" });
const warmLogger = withContext({ job: "prediction-warmer" });
const notifyLogger = withContext({ job: "live-check" });
const bigGameLogger = withContext({ job: "big-game-alerts" });
const cleanupLogger = withContext({ job: "cleanup" });
const calibrationLogger = withContext({ job: "calibration" });
const marketLogger = withContext({ job: "market-snapshot" });
const ingestionLogger = withContext({ job: "ingestion" });

workerLogger.info("starting background jobs");

// Worker-scoped shutdown flag. Isolated from the web process's flag so the
// two services drain independently. Each *Guarded fn short-circuits when
// this flips to true, preventing a new tick from starting just before the
// process exits.
let isShuttingDown = false;

// The three cron-ish jobs that previously hit http://localhost:${port}
// from inside the web process now need the web service's real URL. In
// dev env.BACKEND_URL defaults to http://localhost:3000; in prod Railway
// sets it to the public web URL.
const baseUrl = env.BACKEND_URL;

// ─── Shadow log cleanup (delete files older than 14 days) ───────────────
// One-shot maintenance task — lived at boot in index.ts; moved here because
// it's worker-class work (touches the filesystem, no HTTP interaction).
cleanOldShadowLogs().catch((err) =>
  shadowLogger.error({ err }, "startup cleanup failed"),
);

// ─── resolve-picks — every 5 minutes ────────────────────────────────────

async function resolvePicksInBackground() {
  try {
    const { resolved, skipped } = await resolvePicks();
    if (resolved > 0)
      resolveLogger.info({ resolved, skipped }, "tick complete");
  } catch (err) {
    resolveLogger.error({ err }, "tick failed");
    Sentry.captureException(err, {
      tags: { job: "resolve-picks", service: "worker" },
    });
  }
}

let resolverRunning = false;
async function resolvePicksGuarded() {
  if (isShuttingDown) {
    resolveLogger.info("shutdown in progress, skipping tick");
    return;
  }
  if (resolverRunning) {
    resolveLogger.info("previous run still in progress, skipping");
    return;
  }
  resolverRunning = true;
  try {
    await resolvePicksInBackground();
  } finally {
    resolverRunning = false;
  }
}

resolveLogger.info({ intervalMs: 5 * 60 * 1000 }, "scheduled");
const resolveInterval = setInterval(resolvePicksGuarded, 5 * 60 * 1000);
setTimeout(resolvePicksGuarded, 30_000);

// ─── prediction-warmer — every 90 seconds ───────────────────────────────
// Hits the web service's /api/games to warm its in-memory prediction
// cache. From the worker, each request populates whichever web replica
// the load balancer routes to — imperfect at N>1 replicas but better
// than letting the cache go cold.

async function warmPredictions() {
  try {
    const response = await fetch(`${baseUrl}/api/games`);
    if (!response.ok) return;
    const data = (await response.json()) as {
      data?: Array<{ id: string; status: string }>;
    };
    const games = data.data ?? [];
    const liveGames = games.filter((g) => g.status === "LIVE");
    let warmed = 0;
    for (const g of liveGames) {
      try {
        const detailRes = await fetch(`${baseUrl}/api/games/id/${g.id}`);
        if (detailRes.ok) warmed++;
      } catch (err) {
        warmLogger.warn({ err, gameId: g.id }, "single prediction warm failed");
      }
    }
    warmLogger.info(
      { games: games.length, warmed, liveTotal: liveGames.length },
      "tick complete",
    );
  } catch (err) {
    warmLogger.error({ err }, "tick failed");
    Sentry.captureException(err, {
      tags: { job: "prediction-warmer", service: "worker" },
    });
  }
}

let warmerRunning = false;
async function warmPredictionsGuarded() {
  if (isShuttingDown) {
    warmLogger.info("shutdown in progress, skipping tick");
    return;
  }
  if (warmerRunning) {
    warmLogger.info("previous run still in progress, skipping");
    return;
  }
  warmerRunning = true;
  try {
    await warmPredictions();
  } finally {
    warmerRunning = false;
  }
}

warmLogger.info({ intervalMs: 90 * 1000 }, "scheduled");
const warmInterval = setInterval(warmPredictionsGuarded, 90 * 1000);
setTimeout(warmPredictionsGuarded, 10_000);

// ─── live-game notify — every 2 minutes ─────────────────────────────────

let liveCheckRunning = false;
async function liveCheckGuarded() {
  if (isShuttingDown) {
    notifyLogger.info("shutdown in progress, skipping tick");
    return;
  }
  if (liveCheckRunning) {
    notifyLogger.info("previous run still in progress, skipping");
    return;
  }
  liveCheckRunning = true;
  try {
    await checkLiveGamesAndNotify();
  } catch (err) {
    notifyLogger.error({ err }, "tick failed");
    Sentry.captureException(err, {
      tags: { job: "live-check", service: "worker" },
    });
  } finally {
    liveCheckRunning = false;
  }
}

notifyLogger.info({ intervalMs: 2 * 60 * 1000 }, "scheduled");
const liveCheckInterval = setInterval(liveCheckGuarded, 2 * 60 * 1000);
setTimeout(liveCheckGuarded, 45_000);

// ─── big-game alerts — every 30 minutes ─────────────────────────────────

function runBigGameAlertsTick() {
  if (isShuttingDown) {
    bigGameLogger.info("shutdown in progress, skipping tick");
    return;
  }
  checkBigGameAlerts().catch((err) => {
    bigGameLogger.error({ err }, "tick failed");
    Sentry.captureException(err, {
      tags: { job: "big-game-alerts", service: "worker" },
    });
  });
}

bigGameLogger.info({ intervalMs: 30 * 60 * 1000 }, "scheduled");
const bigGameInterval = setInterval(runBigGameAlertsTick, 30 * 60 * 1000);
setTimeout(runBigGameAlertsTick, 60_000);

// ─── cleanup old prediction results — daily ─────────────────────────────

async function cleanupOldData() {
  if (isShuttingDown) {
    cleanupLogger.info("shutdown in progress, skipping tick");
    return;
  }
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  try {
    const { count } = await prisma.predictionResult.deleteMany({
      where: { resolvedAt: { not: null, lt: cutoff } },
    });
    if (count > 0)
      cleanupLogger.info({ removed: count }, "tick complete");
  } catch (err) {
    cleanupLogger.error({ err }, "tick failed");
    Sentry.captureException(err, {
      tags: { job: "cleanup", service: "worker" },
    });
  }
}

cleanupLogger.info({ intervalMs: 24 * 60 * 60 * 1000 }, "scheduled");
const cleanupInterval = setInterval(cleanupOldData, 24 * 60 * 60 * 1000);
setTimeout(cleanupOldData, 60_000);

// ─── Weekly calibration (Mondays at 03:00 UTC) ──────────────────────────

let calibrationRunning = false;
async function calibrationGuarded() {
  if (isShuttingDown) {
    calibrationLogger.info("shutdown in progress, skipping tick");
    return;
  }
  if (calibrationRunning) {
    calibrationLogger.info("previous run still in progress, skipping");
    return;
  }
  calibrationRunning = true;
  try {
    await runWeeklyCalibration();
  } catch (err) {
    calibrationLogger.error({ err }, "tick failed");
    Sentry.captureException(err, {
      tags: { job: "calibration", service: "worker" },
    });
  } finally {
    calibrationRunning = false;
  }
}

calibrationLogger.info({ schedule: "0 3 * * 1", tz: "UTC" }, "scheduled");
const calibrationCron = cron.schedule("0 3 * * 1", calibrationGuarded, {
  timezone: "UTC",
});

// ─── Market-line snapshot cron (every 30 minutes) ───────────────────────

let marketSnapshotRunning = false;
async function marketSnapshotGuarded() {
  if (isShuttingDown) {
    marketLogger.info("shutdown in progress, skipping tick");
    return;
  }
  if (!process.env.SHARPAPI_KEY) return; // No key, no work
  if (marketSnapshotRunning) {
    marketLogger.info("previous run still in progress, skipping");
    return;
  }
  marketSnapshotRunning = true;
  try {
    await snapshotMarketLines(baseUrl);
  } catch (err) {
    marketLogger.error({ err }, "tick failed");
    Sentry.captureException(err, {
      tags: { job: "market-snapshot", service: "worker" },
    });
  } finally {
    marketSnapshotRunning = false;
  }
}

marketLogger.info({ schedule: "*/30 * * * *", tz: "UTC" }, "scheduled");
const marketSnapshotCron = cron.schedule(
  "*/30 * * * *",
  marketSnapshotGuarded,
  { timezone: "UTC" },
);

// ─── Beat-writer ingestion cron (every 2 minutes) ───────────────────────

let ingestionRunning = false;
async function ingestionGuarded() {
  if (isShuttingDown) {
    ingestionLogger.info("shutdown in progress, skipping tick");
    return;
  }
  if (ingestionRunning) {
    ingestionLogger.info("previous cycle still in progress, skipping");
    return;
  }
  ingestionRunning = true;
  try {
    const result = await runIngestionCycle(baseUrl);
    recordCycleResult(result);
    ingestionLogger.info(
      {
        items: result.itemsProcessed,
        signals: result.signalsExtracted,
        stored: result.signalsStored,
        rePredicts: result.rePredictionsTriggered,
        expired: result.expiredCleaned,
        errors: result.errors.length,
      },
      "cycle complete",
    );
  } catch (err) {
    ingestionLogger.error({ err }, "cycle failed");
    Sentry.captureException(err, {
      tags: { job: "ingestion", service: "worker" },
    });
  } finally {
    ingestionRunning = false;
  }
}

ingestionLogger.info({ schedule: "*/2 * * * *", tz: "UTC" }, "scheduled");
const ingestionCron = cron.schedule("*/2 * * * *", ingestionGuarded, {
  timezone: "UTC",
});

// ─── Graceful shutdown ──────────────────────────────────────────────────

async function gracefulShutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  workerLogger.info({ signal, phase: "shutdown" }, "drain started");

  clearInterval(resolveInterval);
  clearInterval(warmInterval);
  clearInterval(liveCheckInterval);
  clearInterval(bigGameInterval);
  clearInterval(cleanupInterval);

  await Promise.allSettled([
    Promise.resolve(calibrationCron.stop()),
    Promise.resolve(marketSnapshotCron.stop()),
    Promise.resolve(ingestionCron.stop()),
  ]);

  try {
    await prisma.$disconnect();
  } catch (err) {
    workerLogger.error(
      { err, phase: "shutdown" },
      "prisma.$disconnect failed",
    );
  }

  workerLogger.info({ phase: "shutdown" }, "drain complete, exiting");
  process.exit(0);
}

// Last-resort capture for anything that escapes a job's try/catch or comes
// from async work that wasn't awaited. Logs and forwards to Sentry; we don't
// exit so the remaining schedulers keep running.
process.on("uncaughtException", (err) => {
  Sentry.captureException(err, { tags: { service: "worker" } });
  workerLogger.fatal({ err }, "uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason, { tags: { service: "worker" } });
  workerLogger.fatal({ err: reason }, "unhandledRejection");
});

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

workerLogger.info("all jobs scheduled, running");
