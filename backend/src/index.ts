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
import { messagesRouter } from "./routes/messages";
import { gamesRouter, clearAllPredictionCaches } from "./routes/games";
import { accuracyRouter } from "./routes/accuracy";
import { teamFollowsRouter } from "./routes/team-follows";
import { notificationsRouter } from "./routes/notifications";
import { promoRouter } from "./routes/promo";
import { backtestRouter } from "./routes/backtest";
import { historicalBacktestRouter } from "./routes/historical-backtest";
import { calibrationRouter } from "./routes/calibration";
import { logger } from "hono/logger";

// Clear any stale prediction caches on startup so deploys with calibration
// changes take effect immediately instead of waiting up to 15 minutes for
// cached predictions to expire.
clearAllPredictionCaches();

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

function userKey(c: Context): string {
  const user = c.get("user") as { id: string } | null;
  return user?.id ?? ipKey(c);
}

// Auth endpoints: 10 req/min per IP
app.use("/api/auth/*", rateLimiter({ windowMs: 60_000, limit: 10, keyGenerator: ipKey, message: rateLimitMessage }));

// SSE live-stream: exempt from rate limiting (long-lived connection, one per client)
app.use("/api/games/live-stream", async (_c, next) => { await next(); });

// Prediction-heavy endpoints: 30 req/min per IP
app.use("/api/games/top-picks", rateLimiter({ windowMs: 60_000, limit: 30, keyGenerator: ipKey, message: rateLimitMessage }));
app.use("/api/sports/predictions/*", rateLimiter({ windowMs: 60_000, limit: 30, keyGenerator: ipKey, message: rateLimitMessage }));

// Messages: 30 messages/min per user
app.use("/api/messages/*", rateLimiter({ windowMs: 60_000, limit: 30, keyGenerator: userKey, message: rateLimitMessage }));

// General catch-all: 100 req/min per IP
app.use("/api/*", rateLimiter({ windowMs: 60_000, limit: 100, keyGenerator: ipKey, message: rateLimitMessage }));

// ─────────────────────────────────────────────────────────────────────────────

// Mount auth handler
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Health check endpoint
app.get("/health", (c) => c.json({ status: "ok" }));

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
app.route("/api/messages", messagesRouter);
app.route("/api/predictions", accuracyRouter);
app.route("/api/team-follows", teamFollowsRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/promo", promoRouter);
app.route("/api/backtest", backtestRouter);
app.route("/api/historical-backtest", historicalBacktestRouter);
app.route("/api/calibration", calibrationRouter);

const port = Number(process.env.PORT) || 3000;

// ─── Shadow log cleanup (delete files older than 14 days) ───────────────────
import { cleanOldShadowLogs } from "./prediction/shadow";
cleanOldShadowLogs().catch(e => console.error("[shadow] Startup cleanup failed:", e));

// ─── Background jobs ────────────────────────────────────────────────────────

import { resolvePicks } from "./lib/resolve-picks";
import { checkLiveGamesAndNotify, checkBigGameAlerts } from "./lib/notification-jobs";
import { prisma } from "./prisma";

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
setInterval(resolvePicksGuarded, 5 * 60 * 1000);
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
setInterval(warmPredictionsGuarded, 90 * 1000);
setTimeout(warmPredictionsGuarded, 10_000);

let liveCheckRunning = false;
async function liveCheckGuarded() {
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
setInterval(liveCheckGuarded, 2 * 60 * 1000);
setTimeout(liveCheckGuarded, 45_000);

// Check for big upcoming games — every 30 minutes
setInterval(() => {
  checkBigGameAlerts().catch(err => console.error("[notify] Big game alert failed:", err));
}, 30 * 60 * 1000);
setTimeout(() => {
  checkBigGameAlerts().catch(err => console.error("[notify] Big game alert failed:", err));
}, 60_000);

// Clean up old resolved predictions (keep 90 days) — runs daily
async function cleanupOldData() {
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
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);
setTimeout(cleanupOldData, 60_000);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255,
};
