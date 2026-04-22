// Prediction engine v2 — improved calibration parameters
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { rateLimiter } from "hono-rate-limiter";
import "./env";
import { auth } from "./auth";
import { picksRouter } from "./routes/picks";
import { profileRouter } from "./routes/profile";
import { socialRouter } from "./routes/social";
import { newsRouter } from "./routes/news";
import { gamesRouter, clearAllPredictionCaches } from "./routes/games";
import { accuracyRouter } from "./routes/accuracy";
import { teamFollowsRouter } from "./routes/team-follows";
import { notificationsRouter } from "./routes/notifications";
import { promoRouter } from "./routes/promo";
import { backtestRouter } from "./routes/backtest";
import { historicalBacktestRouter } from "./routes/historical-backtest";
import { calibrationRouter } from "./routes/calibration";
import { ingestionRouter } from "./routes/ingestion";
import { shadowRouter } from "./routes/shadow";
import { createHealthRouter } from "./routes/health";
import { prisma } from "./prisma";
import { logger } from "hono/logger";

// Clear any stale prediction caches on startup so deploys with calibration
// changes take effect immediately instead of waiting up to 15 minutes for
// cached predictions to expire.
clearAllPredictionCaches();

// Log which prediction engine is active so we can verify the flag in Railway.
{
  const flagValue = process.env.USE_NEW_PREDICTION_ENGINE;
  const isNew = flagValue === "true";
  console.log(
    `[engine] USE_NEW_PREDICTION_ENGINE=${flagValue ?? "(unset)"}, using ${isNew ? "new" : "old"} engine`,
  );
  console.log(
    "[injuries] source=espn-summary (NBA/MLB/NHL), unavailable (soccer)",
  );
}

// Flipped true when SIGTERM/SIGINT arrives. Exported so tests can reset it.
// Background jobs (setInterval tickers + cron handlers) consult this and
// skip ticks once the drain has started, so a 5-minute job doesn't kick off
// with ~seconds left before Railway's SIGKILL.
export let isShuttingDown = false;
export function __resetShutdownForTests() {
  isShuttingDown = false;
}

// Type the Hono app with user/session variables
const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// CORS middleware - validates origin against allowlist
const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
];

app.use(
  "*",
  cors({
    origin: (origin) => (origin && allowed.some((re) => re.test(origin)) ? origin : null),
    credentials: true,
  })
);

// Logging
app.use("*", logger());

// Auth middleware - populates user/session for all routes
app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    c.set("user", null);
    c.set("session", null);
    await next();
    return;
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});

// ─── Rate limiting ────────────────────────────────────────────────────────────

const rateLimitMessage = {
  error: { message: "Too many requests, please try again later.", code: "RATE_LIMITED" },
};

function ipKey(c: Context): string {
  // Prefer non-spoofable headers set by infrastructure over client-supplied x-forwarded-for
  return c.req.header("cf-connecting-ip")
    ?? c.req.header("x-real-ip")
    ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

// Auth endpoints: 10 req/min per IP
app.use("/api/auth/*", rateLimiter({ windowMs: 60_000, limit: 10, keyGenerator: ipKey, message: rateLimitMessage }));

// SSE live-stream: exempt from rate limiting (long-lived connection, one per client)
app.use("/api/games/live-stream", async (_c, next) => { await next(); });

// Prediction-heavy endpoints: 30 req/min per IP
app.use("/api/games/top-picks", rateLimiter({ windowMs: 60_000, limit: 30, keyGenerator: ipKey, message: rateLimitMessage }));
app.use("/api/sports/predictions/*", rateLimiter({ windowMs: 60_000, limit: 30, keyGenerator: ipKey, message: rateLimitMessage }));

// General catch-all: 100 req/min per IP
app.use("/api/*", rateLimiter({ windowMs: 60_000, limit: 100, keyGenerator: ipKey, message: rateLimitMessage }));

// ─────────────────────────────────────────────────────────────────────────────

// Mount auth handler
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Health check endpoints — /health (liveness, no DB) and /ready (DB ping).
// Mounted at root so they bypass /api/* rate limiting. During shutdown both
// return 503 so the load balancer drains this instance.
app.route("/", createHealthRouter({
  isShuttingDown: () => isShuttingDown,
  prisma,
}));

// File upload endpoint (authenticated, validated)
app.post("/api/upload", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }

  // Size limit: 5MB
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ error: "File too large. Maximum 5MB." }, 400);
  }

  // Type whitelist
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: "Invalid file type. Only JPEG, PNG, WebP, and GIF allowed." }, 400);
  }

  const storageForm = new FormData();
  storageForm.append("file", file);

  const response = await fetch("https://storage.vibecodeapp.com/v1/files/upload", {
    method: "POST",
    body: storageForm,
  });

  if (!response.ok) {
    const error = await response.json() as { error?: string };
    return c.json({ error: error.error || "Upload failed" }, 500);
  }

  const result = await response.json() as { file: { id: string; url: string; filename: string; contentType: string; sizeBytes: number } };
  return c.json({ data: result.file });
});

// Get current user endpoint
app.get("/api/me", (c) => {
  const user = c.get("user");
  if (!user) return c.body(null, 401);
  return c.json({ data: user });
});

// Cache-control headers for games API responses
app.use('/api/games/*', async (c, next) => {
  await next();
  if (c.res.status === 200) {
    c.res.headers.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
  }
});

// Routes
app.route("/api/picks", picksRouter);
app.route("/api/profile", profileRouter);
app.route("/api/social", socialRouter);
app.route("/api/news", newsRouter);
app.route("/api/games", gamesRouter);
app.route("/api/predictions", accuracyRouter);
app.route("/api/team-follows", teamFollowsRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/promo", promoRouter);
app.route("/api/backtest", backtestRouter);
app.route("/api/historical-backtest", historicalBacktestRouter);
app.route("/api/calibration", calibrationRouter);
app.route("/api/ingestion", ingestionRouter);
app.route("/api/shadow", shadowRouter);

const port = Number(process.env.PORT) || 3000;

// ─── Shadow log cleanup (delete files older than 14 days) ───────────────────
import { cleanOldShadowLogs } from "./prediction/shadow";
cleanOldShadowLogs().catch(e => console.error("[shadow] Startup cleanup failed:", e));

// ─── Background jobs ────────────────────────────────────────────────────────

import { resolvePicks } from "./lib/resolve-picks";
import { checkLiveGamesAndNotify, checkBigGameAlerts } from "./lib/notification-jobs";

async function resolvePicksInBackground() {
  try {
    const { resolved, skipped } = await resolvePicks();
    if (resolved > 0) console.log(`[resolve-picks] Resolved ${resolved}, skipped ${skipped}`);
  } catch (err) {
    console.error("[resolve-picks] Failed:", err);
  }
}

let resolverRunning = false;
async function resolvePicksGuarded() {
  if (isShuttingDown) {
    console.log("[resolve-picks] shutdown in progress, skipping tick");
    return;
  }
  if (resolverRunning) {
    console.log("[resolve-picks] Previous run still in progress, skipping");
    return;
  }
  resolverRunning = true;
  try {
    await resolvePicksInBackground();
  } finally {
    resolverRunning = false;
  }
}

// Resolve picks every 5 minutes
const resolveInterval = setInterval(resolvePicksGuarded, 5 * 60 * 1000);
// Also resolve once on startup after a 30-second delay
setTimeout(resolvePicksGuarded, 30_000);

// Pre-warm prediction cache and refresh live games
async function warmPredictions() {
  try {
    const response = await fetch(`http://localhost:${port}/api/games`);
    if (!response.ok) return;
    const data = await response.json() as { data?: Array<{ id: string; status: string }> };
    const games = data.data ?? [];
    const liveGames = games.filter(g => g.status === "LIVE");
    // Refresh live caches for in-progress games so the list page reflects
    // current scores even when no user is actively viewing the detail page.
    let warmed = 0;
    for (const g of liveGames) {
      try {
        const detailRes = await fetch(`http://localhost:${port}/api/games/id/${g.id}`);
        if (detailRes.ok) warmed++;
      } catch (error) {
        console.warn("[warm] Single prediction warm failed:", error);
      }
    }
    console.log(`[prediction-warmer] Warmed ${games.length} games (${warmed}/${liveGames.length} live refreshed)`);
  } catch (err) {
    console.error("[prediction-warmer] Failed:", err);
  }
}
let warmerRunning = false;
async function warmPredictionsGuarded() {
  if (isShuttingDown) {
    console.log("[prediction-warmer] shutdown in progress, skipping tick");
    return;
  }
  if (warmerRunning) {
    console.log("[prediction-warmer] Previous run still in progress, skipping");
    return;
  }
  warmerRunning = true;
  try {
    await warmPredictions();
  } finally {
    warmerRunning = false;
  }
}

// Run more frequently so live caches don't go stale (was 4 min)
const warmInterval = setInterval(warmPredictionsGuarded, 90 * 1000);
setTimeout(warmPredictionsGuarded, 10_000);

let liveCheckRunning = false;
async function liveCheckGuarded() {
  if (isShuttingDown) {
    console.log("[notify] shutdown in progress, skipping tick");
    return;
  }
  if (liveCheckRunning) {
    console.log("[notify] Previous live game check still in progress, skipping");
    return;
  }
  liveCheckRunning = true;
  try {
    await checkLiveGamesAndNotify();
  } catch (err) {
    console.error("[notify] Live game check failed:", err);
  } finally {
    liveCheckRunning = false;
  }
}

// Check for live games and notify users who picked them — every 2 minutes
const liveCheckInterval = setInterval(liveCheckGuarded, 2 * 60 * 1000);
setTimeout(liveCheckGuarded, 45_000);

// Check for big upcoming games — every 30 minutes
function runBigGameAlertsTick() {
  if (isShuttingDown) {
    console.log("[big-game-alert] shutdown in progress, skipping tick");
    return;
  }
  checkBigGameAlerts().catch(err => console.error("[notify] Big game alert failed:", err));
}
const bigGameInterval = setInterval(runBigGameAlertsTick, 30 * 60 * 1000);
setTimeout(runBigGameAlertsTick, 60_000);

// Clean up old resolved predictions (keep 90 days) — runs daily
async function cleanupOldData() {
  if (isShuttingDown) {
    console.log("[cleanup] shutdown in progress, skipping tick");
    return;
  }
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  try {
    const { count } = await prisma.predictionResult.deleteMany({
      where: { resolvedAt: { not: null, lt: cutoff } },
    });
    if (count > 0) console.log(`[cleanup] Removed ${count} old prediction results`);
  } catch (err) {
    console.error("[cleanup] Failed:", err);
  }
}
const cleanupInterval = setInterval(cleanupOldData, 24 * 60 * 60 * 1000);
setTimeout(cleanupOldData, 60_000);

// ─── SharpAPI gate warning ──────────────────────────────────────────────────
// Single startup-time check so the operator knows whether market data is on.
if (!process.env.SHARPAPI_KEY) {
  console.warn(
    "[market] SHARPAPI_KEY not set — market lines disabled, model will run without market anchor",
  );
}

// ─── Ingestion gate warnings ────────────────────────────────────────────────
// The ingestion pipeline has two feature-gated external deps: Apify (for
// Twitter) and Anthropic (for LLM extraction). Either can be missing and
// the pipeline still partially works — log a single warning per missing
// key at boot so the operator knows what's silently off.
if (!process.env.APIFY_API_KEY) {
  console.warn(
    "[ingestion] APIFY_API_KEY not set — Twitter ingestion disabled, RSS will run alone",
  );
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[ingestion] ANTHROPIC_API_KEY not set — LLM extraction disabled, ingestion will collect but not process",
  );
}

// ─── Weekly calibration (Mondays at 03:00 UTC) ──────────────────────────────
import cron from "node-cron";
import { runWeeklyCalibration } from "./scripts/runWeeklyCalibration";
import { snapshotMarketLines } from "./scripts/snapshotMarketLines";

let calibrationRunning = false;
async function calibrationGuarded() {
  if (isShuttingDown) {
    console.log("[calibration] shutdown in progress, skipping tick");
    return;
  }
  if (calibrationRunning) {
    console.log("[calibration] Previous run still in progress, skipping");
    return;
  }
  calibrationRunning = true;
  try {
    await runWeeklyCalibration();
  } catch (err) {
    console.error("[calibration] Weekly run failed:", err);
  } finally {
    calibrationRunning = false;
  }
}
// "0 3 * * 1" = minute 0, hour 3, every day, every month, Monday
const calibrationCron = cron.schedule("0 3 * * 1", calibrationGuarded, { timezone: "UTC" });

// ─── Market-line snapshot cron (every 30 minutes) ───────────────────────────
// Pulls SharpAPI consensus for scheduled games in the next 24h and persists
// a MarketSnapshot row per game. Gated on SHARPAPI_KEY — no-op without it.
let marketSnapshotRunning = false;
async function marketSnapshotGuarded() {
  if (isShuttingDown) {
    console.log("[market] shutdown in progress, skipping tick");
    return;
  }
  if (!process.env.SHARPAPI_KEY) return; // No key, no work
  if (marketSnapshotRunning) {
    console.log("[market] Previous snapshot still in progress, skipping");
    return;
  }
  marketSnapshotRunning = true;
  try {
    await snapshotMarketLines(port);
  } catch (err) {
    console.error("[market] Snapshot run failed:", err);
  } finally {
    marketSnapshotRunning = false;
  }
}
// "*/30 * * * *" = every 30 minutes
const marketSnapshotCron = cron.schedule("*/30 * * * *", marketSnapshotGuarded, { timezone: "UTC" });

// ─── Beat-writer ingestion cron (every 2 minutes) ───────────────────────────
// Full ingestion cycle — see lib/ingestion/orchestrator.ts. Feature-gated
// components (Twitter, LLM extraction) no-op when their keys aren't set.
import { runIngestionCycle, recordCycleResult } from "./lib/ingestion/orchestrator";

let ingestionRunning = false;
async function ingestionGuarded() {
  if (isShuttingDown) {
    console.log("[ingestion] shutdown in progress, skipping tick");
    return;
  }
  if (ingestionRunning) {
    console.log("[ingestion] Previous cycle still in progress, skipping");
    return;
  }
  ingestionRunning = true;
  try {
    const result = await runIngestionCycle(port);
    recordCycleResult(result);
    console.log(
      `[ingestion] cycle complete — items=${result.itemsProcessed} signals=${result.signalsExtracted}` +
        ` stored=${result.signalsStored} re-predicts=${result.rePredictionsTriggered}` +
        ` expired=${result.expiredCleaned} errors=${result.errors.length}`,
    );
  } catch (err) {
    console.error("[ingestion] Cycle failed:", err);
  } finally {
    ingestionRunning = false;
  }
}
// "*/2 * * * *" = every 2 minutes
const ingestionCron = cron.schedule("*/2 * * * *", ingestionGuarded, { timezone: "UTC" });

// ─── Graceful shutdown ──────────────────────────────────────────────────────
// Railway sends SIGTERM ~30s before SIGKILL during deploys. Without a
// handler, in-flight HTTP requests, SSE streams, and background jobs are
// killed mid-run — users see 502s and DB state can be half-written (pick
// resolved but notification not sent, etc). We stop accepting new work,
// drain for up to 25s (margin under Railway's 30s window), then exit.
const server = Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 255,
});
console.log(`[server] listening on port ${port}`);

async function gracefulShutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) return; // Signals can repeat; only drain once.
  isShuttingDown = true;
  console.log(`[shutdown] signal=${signal} received, draining`);

  // 1. Stop ticking timers so no new background work kicks off. In-flight
  //    work is not interrupted — the guards already have tryFinally.
  clearInterval(resolveInterval);
  clearInterval(warmInterval);
  clearInterval(liveCheckInterval);
  clearInterval(bigGameInterval);
  clearInterval(cleanupInterval);

  // 2. Stop cron tasks. stop() halts future fires; destroy() releases them.
  await Promise.allSettled([
    Promise.resolve(calibrationCron.stop()),
    Promise.resolve(marketSnapshotCron.stop()),
    Promise.resolve(ingestionCron.stop()),
  ]);

  // 3. Stop accepting new HTTP connections. Passing false keeps existing
  //    connections open so in-flight requests finish.
  server.stop(false);

  // 4. Poll pendingRequests until it drains or we hit the 25s budget.
  const drainDeadline = Date.now() + 25_000;
  while (server.pendingRequests > 0 && Date.now() < drainDeadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (server.pendingRequests > 0) {
    console.warn(
      `[shutdown] drain deadline hit with ${server.pendingRequests} in-flight request(s) — force-closing`,
    );
    server.stop(true); // Now actually close everything.
  }

  // 5. Release DB pool so Postgres doesn't see connection leaks.
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error("[shutdown] prisma.$disconnect failed:", err);
  }

  console.log("[shutdown] complete, exiting");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});
