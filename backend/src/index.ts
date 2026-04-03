import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
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
import { gamesRouter } from "./routes/games";
import { accuracyRouter } from "./routes/accuracy";
import { teamFollowsRouter } from "./routes/team-follows";
import { notificationsRouter } from "./routes/notifications";
import { promoRouter } from "./routes/promo";
import { logger } from "hono/logger";

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
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? c.req.header("x-real-ip")
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

const port = Number(process.env.PORT) || 3000;

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

// Resolve picks every 5 minutes
setInterval(resolvePicksInBackground, 5 * 60 * 1000);
// Also resolve once on startup after a 30-second delay
setTimeout(resolvePicksInBackground, 30_000);

// Pre-warm prediction cache every 4 minutes
async function warmPredictions() {
  try {
    const response = await fetch(`http://localhost:${port}/api/games`);
    if (response.ok) {
      console.log("[prediction-warmer] Cache warmed successfully");
    }
  } catch (err) {
    console.error("[prediction-warmer] Failed:", err);
  }
}
setInterval(warmPredictions, 4 * 60 * 1000);
setTimeout(warmPredictions, 10_000);

// Check for live games and notify users who picked them — every 2 minutes
setInterval(() => {
  checkLiveGamesAndNotify().catch(err => console.error("[notify] Live game check failed:", err));
}, 2 * 60 * 1000);
setTimeout(() => {
  checkLiveGamesAndNotify().catch(err => console.error("[notify] Live game check failed:", err));
}, 45_000);

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
