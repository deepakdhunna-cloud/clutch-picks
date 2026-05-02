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
