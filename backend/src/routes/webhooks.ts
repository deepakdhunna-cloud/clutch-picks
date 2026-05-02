/**
 * Inbound webhook router. Currently houses the RevenueCat receiver.
 * Mounted at /api/webhooks; auth is per-handler (no global middleware
 * since each provider uses a different verification scheme).
 */

import { Hono } from "hono";
import { prisma } from "../prisma";
import {
  verifyRevenueCatAuth,
  applyRevenueCatEvent,
} from "../lib/revenuecat";

const webhooksRouter = new Hono();

webhooksRouter.post("/revenuecat", async (c) => {
  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  const verify = verifyRevenueCatAuth(auth);
  // ── TEMP DEBUG (remove after RC integration verified) ──────────────
  // Logs byte-level info about the incoming Authorization header so we
  // can diagnose mismatches without leaking the secret. Logs:
  //   - whether header is present
  //   - first/last 6 chars (safe to log; full secret is 64 chars)
  //   - byte length of header vs env var
  //   - whether a "Bearer " prefix was sent
  const headerLen = auth?.length ?? 0;
  const expectedLen = process.env.REVENUECAT_WEBHOOK_AUTH?.length ?? 0;
  const hasBearer = auth?.toLowerCase().startsWith("bearer ") ?? false;
  const head = auth ? auth.slice(0, 6) : "(none)";
  const tail = auth && auth.length > 6 ? auth.slice(-6) : "(short)";
  console.log(
    `[webhooks/revenuecat] DEBUG headerLen=${headerLen} expectedLen=${expectedLen} ` +
      `hasBearerPrefix=${hasBearer} head=${head} tail=${tail}`,
  );
  // ── END TEMP DEBUG ─────────────────────────────────────────────────
  if (!verify.ok) {
    console.warn(`[webhooks/revenuecat] reject reason=${verify.reason}`);
    // 401 for bad creds, 503 if we're misconfigured (RC will retry).
    return c.json({ error: verify.reason }, verify.reason === "not_configured" ? 503 : 401);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  if (!body?.event?.type || !body?.event?.id || !body?.event?.app_user_id) {
    return c.json({ error: "missing_event_fields" }, 400);
  }

  try {
    const result = await applyRevenueCatEvent(prisma, body);
    console.log(
      `[webhooks/revenuecat] event=${body.event.type} id=${body.event.id} ` +
        `user=${body.event.app_user_id} status=${result.status}` +
        (result.status === "skipped" ? ` reason=${result.reason}` : ""),
    );
    return c.json({ ok: true, status: result.status }, 200);
  } catch (err) {
    console.error("[webhooks/revenuecat] apply failed", err);
    // 500 → RC retries with backoff. Better than silently dropping.
    return c.json({ error: "internal" }, 500);
  }
});

export { webhooksRouter };
