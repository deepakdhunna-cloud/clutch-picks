/**
 * RevenueCat webhook receiver — verification + event handling.
 *
 * RevenueCat POSTs events to /api/webhooks/revenuecat for every
 * subscription state change (purchase, renewal, cancellation, billing
 * failure, refund, expiration). We verify the request via a shared
 * secret in the Authorization header, normalize the event, and upsert
 * our Subscription mirror table.
 *
 * RC docs: https://www.revenuecat.com/docs/integrations/webhooks
 */

import type { PrismaClient } from "@prisma/client";
import { env } from "../env";

// Subset of the RC webhook payload we actually consume. The full event
// has many more fields; we keep this narrow so RC schema additions
// don't fail our parse.
interface RcEvent {
  type: string;            // INITIAL_PURCHASE | RENEWAL | CANCELLATION | …
  id: string;              // event id, used for idempotency
  app_user_id: string;
  original_app_user_id?: string;
  product_id?: string;
  period_type?: string;
  store?: string;
  environment?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number;
  cancel_reason?: string | null;
  is_trial_conversion?: boolean;
}

interface RcWebhookBody {
  event: RcEvent;
  api_version?: string;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "missing_header" | "bad_secret" };

// RC sends the shared secret as the *value* of the Authorization header.
// No "Bearer " prefix in their default config. Constant-time compare.
export function verifyRevenueCatAuth(
  authHeader: string | null | undefined,
): VerifyResult {
  const expected = env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) return { ok: false, reason: "not_configured" };
  if (!authHeader) return { ok: false, reason: "missing_header" };

  // Constant-time string comparison.
  if (authHeader.length !== expected.length) {
    return { ok: false, reason: "bad_secret" };
  }
  let mismatch = 0;
  for (let i = 0; i < authHeader.length; i++) {
    mismatch |= authHeader.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0 ? { ok: true } : { ok: false, reason: "bad_secret" };
}

// Decide whether a given RC event type means the user IS currently
// entitled. This is intentionally generous on the active side and
// strict on the inactive side — RC sends multiple terminal events
// (CANCELLATION, EXPIRATION, REFUND) and any of them removes access.
export function isActiveAfter(eventType: string): boolean | null {
  const ACTIVE = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "UNCANCELLATION",
    "TRIAL_STARTED",
    "TRIAL_CONVERTED",
    "SUBSCRIPTION_EXTENDED",
  ]);
  const INACTIVE = new Set([
    "CANCELLATION",
    "EXPIRATION",
    "BILLING_ISSUE",
    "SUBSCRIBER_ALIAS",  // alias-only, no state change really
    "TRANSFER",
    "REFUND",
  ]);
  if (ACTIVE.has(eventType)) return true;
  if (INACTIVE.has(eventType)) return false;
  return null;  // unknown event type — leave isActive untouched
}

export type ApplyResult =
  | { status: "applied"; userId: string }
  | { status: "skipped"; reason: "no_user" | "duplicate_event" | "unknown_event_type" };

// Apply a parsed RC event to our DB. Idempotent: re-delivering the same
// event_id is a no-op.
export async function applyRevenueCatEvent(
  prisma: Pick<PrismaClient, "user" | "subscription">,
  body: RcWebhookBody,
): Promise<ApplyResult> {
  const evt = body.event;

  // We use RC's app_user_id as our userId. If the row doesn't exist we
  // skip — RC will keep retrying and eventually the user will have
  // signed up through our auth flow.
  const userId = evt.app_user_id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { status: "skipped", reason: "no_user" };

  // Idempotency — if we already saw this event_id, skip.
  const existing = await prisma.subscription.findUnique({
    where: { userId },
    select: { lastEventId: true },
  });
  if (existing?.lastEventId === evt.id) {
    return { status: "skipped", reason: "duplicate_event" };
  }

  const active = isActiveAfter(evt.type);
  if (active === null) {
    // Unknown event — record we saw it but don't touch isActive.
    await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        rcAppUserId: evt.app_user_id,
        isActive: false,
        lastEventId: evt.id,
        lastEventType: evt.type,
        lastEventAt: evt.event_timestamp_ms ? new Date(evt.event_timestamp_ms) : new Date(),
      },
      update: {
        lastEventId: evt.id,
        lastEventType: evt.type,
        lastEventAt: evt.event_timestamp_ms ? new Date(evt.event_timestamp_ms) : new Date(),
      },
    });
    return { status: "skipped", reason: "unknown_event_type" };
  }

  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      rcAppUserId: evt.app_user_id,
      isActive: active,
      productId: evt.product_id ?? null,
      periodType: evt.period_type ?? null,
      store: evt.store ?? null,
      environment: evt.environment ?? null,
      purchasedAt: evt.purchased_at_ms ? new Date(evt.purchased_at_ms) : null,
      expiresAt: evt.expiration_at_ms ? new Date(evt.expiration_at_ms) : null,
      cancelledAt: !active && evt.event_timestamp_ms ? new Date(evt.event_timestamp_ms) : null,
      lastEventId: evt.id,
      lastEventType: evt.type,
      lastEventAt: evt.event_timestamp_ms ? new Date(evt.event_timestamp_ms) : new Date(),
    },
    update: {
      isActive: active,
      productId: evt.product_id ?? undefined,
      periodType: evt.period_type ?? undefined,
      store: evt.store ?? undefined,
      environment: evt.environment ?? undefined,
      purchasedAt: evt.purchased_at_ms ? new Date(evt.purchased_at_ms) : undefined,
      expiresAt: evt.expiration_at_ms ? new Date(evt.expiration_at_ms) : undefined,
      cancelledAt: !active && evt.event_timestamp_ms ? new Date(evt.event_timestamp_ms) : undefined,
      lastEventId: evt.id,
      lastEventType: evt.type,
      lastEventAt: evt.event_timestamp_ms ? new Date(evt.event_timestamp_ms) : new Date(),
    },
  });

  return { status: "applied", userId };
}
