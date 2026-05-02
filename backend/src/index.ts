// Sentry must initialize before any other imports so its instrumentation
// can wrap subsequent module loads (HTTP client, fs, etc.) for breadcrumbs.
import { initSentry, Sentry } from "./lib/sentry";
initSentry("web");

// Prediction engine v2 — improved calibration parameters
import { randomUUID } from "crypto";
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
import { intelligenceRouter } from "./routes/intelligence";
import { accuracyRouter } from "./routes/accuracy";
import { teamFollowsRouter } from "./routes/team-follows";
import { notificationsRouter } from "./routes/notifications";
import { promoRouter } from "./routes/promo";
import { backtestRouter } from "./routes/backtest";
import { historicalBacktestRouter } from "./routes/historical-backtest";
import { calibrationRouter } from "./routes/calibration";
import { ingestionRouter } from "./routes/ingestion";
import { shadowRouter } from "./routes/shadow";
import { webhooksRouter } from "./routes/webhooks";
import { createHealthRouter } from "./routes/health";
import { deleteUserAccount } from "./lib/deleteAccount";
import { prisma } from "./prisma";
import { logger as honoLogger } from "hono/logger";
import { logger, withContext, type Logger } from "./lib/logger";

// Clear any stale prediction caches on startup so deploys with calibration
// changes take effect immediately instead of waiting up to 15 minutes for
// cached predictions to expire.
clearAllPredictionCaches();

// Log which prediction engine is active so we can verify the flag in Railway.
{
  const flagValue = process.env.USE_NEW_PREDICTION_ENGINE;
  const isNew = flagValue === "true";
  logger.info(
    { tag: "engine", flag: flagValue ?? null, engine: isNew ? "new" : "old" },
    "prediction engine selection",
  );
  logger.info(
    { tag: "injuries", source: "espn-summary", supported: ["NBA", "MLB", "NHL"] },
    "injuries adapter configured (soccer unsupported)",
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
    requestId: string;
    logger: Logger;
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

// Hono's default text logger — left in place for now; the structured
// per-request log line below is what downstream tooling should query against.
// Once route files are migrated to Pino we can drop this.
app.use("*", honoLogger());

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

// Per-request observability: assign a request ID, attach a Pino child
// logger pre-bound with request metadata to the Hono context (so route
// handlers can do `c.get("logger").info(...)`), and pin the same context
// onto the Sentry scope so any captured error carries it. Re-throws so
// the global onError handler still runs.
app.use("/api/*", async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? randomUUID();
  c.set("requestId", requestId);
  const user = c.get("user");
  const userId = user?.id;

  const reqLogger = withContext({
    requestId,
    userId,
    method: c.req.method,
    path: c.req.path,
  });
  c.set("logger", reqLogger);

  Sentry.getCurrentScope().setTag("requestId", requestId);
  if (userId) Sentry.getCurrentScope().setUser({ id: userId });

  const start = Date.now();
  try {
    await next();
    reqLogger.info(
      { status: c.res.status, durationMs: Date.now() - start },
      "request",
    );
  } catch (err) {
    reqLogger.error(
      { err, durationMs: Date.now() - start },
      "request error",
    );
    Sentry.captureException(err, {
      tags: { route: c.req.path, method: c.req.method },
    });
    throw err;
  }
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

// Delete current user's account + all associated data. Required by Apple
// App Store Guideline 5.1.1(v) for any app that allows account creation.
// Known gap: Apple OAuth token revocation on appleid.apple.com/auth/revoke
// is not yet wired — see lib/deleteAccount.ts. Must be closed before App
// Store submission.
app.delete("/api/me", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }
  try {
    await deleteUserAccount(prisma, { id: user.id, email: user.email });
    return c.json({ data: { status: "deleted", userId: user.id } });
  } catch (err) {
    c.get("logger").error(
      { err, tag: "delete-account", targetUserId: user.id },
      "account deletion failed",
    );
    return c.json(
      { error: { message: "Account deletion failed. Please try again.", code: "DELETE_FAILED" } },
      500,
    );
  }
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
app.route("/api/games", intelligenceRouter);
app.route("/api/predictions", accuracyRouter);
app.route("/api/team-follows", teamFollowsRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/promo", promoRouter);
app.route("/api/backtest", backtestRouter);
app.route("/api/historical-backtest", historicalBacktestRouter);
app.route("/api/calibration", calibrationRouter);
app.route("/api/ingestion", ingestionRouter);
app.route("/api/shadow", shadowRouter);
app.route("/api/webhooks", webhooksRouter);

// Global error handler — safety net for anything Hono's per-request middleware
// doesn't catch. Forwards to Sentry with route + request context, then returns
// a generic 500 (no internal error details leak to the client).
app.onError((err, c) => {
  Sentry.captureException(err, {
    tags: {
      route: c.req.path,
      method: c.req.method,
      service: "web",
    },
    extra: {
      requestId: c.get("requestId"),
    },
  });
  // Prefer the per-request child logger when middleware already ran (so
  // requestId/userId are bound). For early-pipeline errors (e.g., before
  // /api/* matched), the request logger may not be set; fall back to root.
  const log = c.get("logger") ?? logger;
  log.error(
    { err, route: c.req.path, method: c.req.method },
    "unhandled route error",
  );
  return c.json(
    { error: { message: "Internal server error", code: "INTERNAL" } },
    500,
  );
});

const port = Number(process.env.PORT) || 3000;

// Background jobs (resolve-picks, warm, ingestion, calibration, etc.) and
// shadow-log maintenance live in src/worker.ts — a separate Railway service
// ('clutch-picks-worker') so scaling HTTP replicas > 1 doesn't double-fire
// crons. Web owns only the HTTP server + graceful drain.

// ─── Graceful shutdown ──────────────────────────────────────────────────────
// Railway sends SIGTERM ~30s before SIGKILL during deploys. Stop accepting
// new connections, drain in-flight requests for up to 25s (margin under
// Railway's 30s window), release the DB pool, and exit.
const server = Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 255,
});
logger.info({ tag: "web", port }, "HTTP server listening");

async function gracefulShutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) return; // Signals can repeat; only drain once.
  isShuttingDown = true;
  logger.info({ tag: "shutdown", signal }, "drain started");

  // Stop accepting new HTTP connections. Passing false keeps existing
  // connections open so in-flight requests finish.
  server.stop(false);

  // Poll pendingRequests until it drains or we hit the 25s budget.
  const drainDeadline = Date.now() + 25_000;
  while (server.pendingRequests > 0 && Date.now() < drainDeadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (server.pendingRequests > 0) {
    logger.warn(
      { tag: "shutdown", pending: server.pendingRequests },
      "drain deadline hit, force-closing in-flight connections",
    );
    server.stop(true); // Now actually close everything.
  }

  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err, tag: "shutdown" }, "prisma.$disconnect failed");
  }

  logger.info({ tag: "shutdown" }, "drain complete, exiting");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

// Last-resort capture for anything that escapes Hono's error path or async
// background work in this process. Logs and forwards to Sentry; we don't
// exit so the server keeps serving other requests.
process.on("uncaughtException", (err) => {
  Sentry.captureException(err, { tags: { service: "web" } });
  logger.fatal({ err, tag: "process" }, "uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason, { tags: { service: "web" } });
  logger.fatal({ err: reason, tag: "process" }, "unhandledRejection");
});
