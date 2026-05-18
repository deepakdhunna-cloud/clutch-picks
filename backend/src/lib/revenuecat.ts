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
  app_user_id?: string;
  original_app_user_id?: string;
  transferred_to?: string[];
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

export type ApplyResult =
  | { status: "applied"; userId: string }
  | {
      status: "skipped";
      reason:
        | "missing_user_identifier"
        | "no_user"
        | "duplicate_event"
        | "metadata_only_event";
    };

export function revenueCatUserIdForEvent(evt: RcEvent): string | null {
  return evt.app_user_id ?? evt.transferred_to?.[0] ?? evt.original_app_user_id ?? null;
}

export function subscriptionAccessStateAfterEvent(
  evt: Pick<RcEvent, "type" | "expiration_at_ms">,
  nowMs = Date.now(),
): boolean | null {
  const ACTIVE = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "UNCANCELLATION",
    "TRIAL_STARTED",
    "TRIAL_CONVERTED",
    "SUBSCRIPTION_EXTENDED",
    "TEMPORARY_ENTITLEMENT_GRANT",
    "REFUND_REVERSED",
  ]);
  const INACTIVE = new Set([
    "EXPIRATION",
    "REFUND",
  ]);

  if (ACTIVE.has(evt.type)) return true;
  if (INACTIVE.has(evt.type)) return false;

  // RevenueCat sends CANCELLATION when auto-renewal is turned off; access
  // usually remains valid until expiration. Only end access if the payload's
  // expiration is already in the past.
  if (evt.type === "CANCELLATION") {
    if (typeof evt.expiration_at_ms !== "number") return null;
    return evt.expiration_at_ms > nowMs;
  }

  // BILLING_ISSUE is not an expiration. Keep access if the current period is
  // still valid, otherwise wait for EXPIRATION to revoke access.
  if (evt.type === "BILLING_ISSUE") {
    if (typeof evt.expiration_at_ms === "number" && evt.expiration_at_ms > nowMs) {
      return true;
    }
    return null;
  }

  // SUBSCRIPTION_PAUSED, TRANSFER, SUBSCRIBER_ALIAS, TEST, and future event
  // types are metadata-only for this mirror unless an expiration arrives.
  return null;
}

export function isActiveAfter(eventType: string): boolean | null {
  return subscriptionAccessStateAfterEvent({ type: eventType });
}

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
  const userId = revenueCatUserIdForEvent(evt);
  if (!userId) return { status: "skipped", reason: "missing_user_identifier" };

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

  const active = subscriptionAccessStateAfterEvent(evt);
  const eventAt = evt.event_timestamp_ms ? new Date(evt.event_timestamp_ms) : new Date();
  const expiration = evt.expiration_at_ms ? new Date(evt.expiration_at_ms) : null;
  const isCancellation = evt.type === "CANCELLATION";
  const isUncancellation = evt.type === "UNCANCELLATION";

  if (active === null) {
    // Metadata-only event — record we saw it but don't touch isActive.
    await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        rcAppUserId: userId,
        isActive: false,
        productId: evt.product_id ?? null,
        periodType: evt.period_type ?? null,
        store: evt.store ?? null,
        environment: evt.environment ?? null,
        purchasedAt: evt.purchased_at_ms ? new Date(evt.purchased_at_ms) : null,
        expiresAt: expiration,
        cancelledAt: isCancellation ? eventAt : null,
        unsubscribeDetectedAt: isCancellation ? eventAt : null,
        lastEventId: evt.id,
        lastEventType: evt.type,
        lastEventAt: eventAt,
      },
      update: {
        productId: evt.product_id ?? undefined,
        periodType: evt.period_type ?? undefined,
        store: evt.store ?? undefined,
        environment: evt.environment ?? undefined,
        purchasedAt: evt.purchased_at_ms ? new Date(evt.purchased_at_ms) : undefined,
        expiresAt: expiration ?? undefined,
        cancelledAt: isCancellation ? eventAt : undefined,
        unsubscribeDetectedAt: isCancellation ? eventAt : undefined,
        lastEventId: evt.id,
        lastEventType: evt.type,
        lastEventAt: eventAt,
      },
    });
    return { status: "skipped", reason: "metadata_only_event" };
  }

  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      rcAppUserId: userId,
      isActive: active,
      productId: evt.product_id ?? null,
      periodType: evt.period_type ?? null,
      store: evt.store ?? null,
      environment: evt.environment ?? null,
      purchasedAt: evt.purchased_at_ms ? new Date(evt.purchased_at_ms) : null,
      expiresAt: expiration,
      cancelledAt: isCancellation && evt.event_timestamp_ms ? eventAt : null,
      unsubscribeDetectedAt: isCancellation && evt.event_timestamp_ms ? eventAt : null,
      lastEventId: evt.id,
      lastEventType: evt.type,
      lastEventAt: eventAt,
    },
    update: {
      isActive: active,
      productId: evt.product_id ?? undefined,
      periodType: evt.period_type ?? undefined,
      store: evt.store ?? undefined,
      environment: evt.environment ?? undefined,
      purchasedAt: evt.purchased_at_ms ? new Date(evt.purchased_at_ms) : undefined,
      expiresAt: expiration ?? undefined,
      cancelledAt: isCancellation && evt.event_timestamp_ms ? eventAt : isUncancellation ? null : undefined,
      unsubscribeDetectedAt: isCancellation && evt.event_timestamp_ms ? eventAt : isUncancellation ? null : undefined,
      lastEventId: evt.id,
      lastEventType: evt.type,
      lastEventAt: eventAt,
    },
  });

  return { status: "applied", userId };
}
