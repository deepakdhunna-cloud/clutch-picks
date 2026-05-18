import { describe, it, expect } from "bun:test";
import {
  applyRevenueCatEvent,
  isActiveAfter,
  revenueCatUserIdForEvent,
  subscriptionAccessStateAfterEvent,
  verifyRevenueCatAuth,
} from "../revenuecat";

describe("verifyRevenueCatAuth", () => {
  it("rejects when env not configured (no secret set)", () => {
    // In test env REVENUECAT_WEBHOOK_AUTH should be unset.
    const result = verifyRevenueCatAuth("anything");
    expect(result.ok).toBe(false);
  });

  it("rejects null/missing header", () => {
    const result = verifyRevenueCatAuth(null);
    expect(result.ok).toBe(false);
  });
});

describe("isActiveAfter", () => {
  it("marks purchase events as active", () => {
    expect(isActiveAfter("INITIAL_PURCHASE")).toBe(true);
    expect(isActiveAfter("RENEWAL")).toBe(true);
  });

  it("marks true expiration events as inactive", () => {
    expect(isActiveAfter("EXPIRATION")).toBe(false);
    expect(isActiveAfter("REFUND")).toBe(false);
  });

  it("does not treat cancellation, billing issue, transfer, or unknown events as access-ending by default", () => {
    expect(isActiveAfter("CANCELLATION")).toBe(null);
    expect(isActiveAfter("BILLING_ISSUE")).toBe(null);
    expect(isActiveAfter("TRANSFER")).toBe(null);
    expect(isActiveAfter("MADE_UP_EVENT")).toBe(null);
  });
});

describe("subscriptionAccessStateAfterEvent", () => {
  const now = Date.UTC(2026, 4, 14);

  it("keeps cancelled subscriptions active until their expiration date", () => {
    expect(subscriptionAccessStateAfterEvent({
      type: "CANCELLATION",
      expiration_at_ms: now + 86_400_000,
    }, now)).toBe(true);
  });

  it("ends access for cancellation events only when expiration is already past", () => {
    expect(subscriptionAccessStateAfterEvent({
      type: "CANCELLATION",
      expiration_at_ms: now - 1_000,
    }, now)).toBe(false);
  });

  it("keeps billing issue access while the current period is still valid", () => {
    expect(subscriptionAccessStateAfterEvent({
      type: "BILLING_ISSUE",
      expiration_at_ms: now + 86_400_000,
    }, now)).toBe(true);
  });

  it("waits for expiration before revoking access on billing issues", () => {
    expect(subscriptionAccessStateAfterEvent({
      type: "BILLING_ISSUE",
      expiration_at_ms: now - 1_000,
    }, now)).toBe(null);
  });
});

describe("revenueCatUserIdForEvent", () => {
  it("uses app_user_id when present", () => {
    expect(revenueCatUserIdForEvent({
      id: "evt",
      type: "INITIAL_PURCHASE",
      app_user_id: "user-1",
    })).toBe("user-1");
  });

  it("uses transfer destination when RevenueCat omits app_user_id", () => {
    expect(revenueCatUserIdForEvent({
      id: "evt",
      type: "TRANSFER",
      transferred_to: ["user-2"],
    })).toBe("user-2");
  });

  it("returns null when no local user identifier is available", () => {
    expect(revenueCatUserIdForEvent({
      id: "evt",
      type: "TRANSFER",
    })).toBe(null);
  });
});

function createRevenueCatPrismaMock(options?: {
  userExists?: boolean;
  lastEventId?: string | null;
}) {
  const upserts: unknown[] = [];
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        options?.userExists === false ? null : { id: where.id },
    },
    subscription: {
      findUnique: async () =>
        options?.lastEventId ? { lastEventId: options.lastEventId } : null,
      upsert: async (args: unknown) => {
        upserts.push(args);
        return args;
      },
    },
  } as unknown as Parameters<typeof applyRevenueCatEvent>[0];

  return { prisma, upserts };
}

describe("applyRevenueCatEvent", () => {
  it("does not revoke access when a cancellation still has future expiration", async () => {
    const { prisma, upserts } = createRevenueCatPrismaMock();
    const eventAtMs = Date.UTC(2026, 4, 14, 12);

    const result = await applyRevenueCatEvent(prisma, {
      event: {
        id: "evt-cancel",
        type: "CANCELLATION",
        app_user_id: "user-1",
        expiration_at_ms: Date.now() + 86_400_000,
        event_timestamp_ms: eventAtMs,
      },
    });

    expect(result).toEqual({ status: "applied", userId: "user-1" });
    const args = upserts[0] as {
      update: {
        isActive: boolean;
        unsubscribeDetectedAt?: Date;
        cancelledAt?: Date;
      };
    };
    expect(args.update.isActive).toBe(true);
    expect(args.update.unsubscribeDetectedAt?.getTime()).toBe(eventAtMs);
    expect(args.update.cancelledAt?.getTime()).toBe(eventAtMs);
  });

  it("records transfer events without changing existing access state", async () => {
    const { prisma, upserts } = createRevenueCatPrismaMock();

    const result = await applyRevenueCatEvent(prisma, {
      event: {
        id: "evt-transfer",
        type: "TRANSFER",
        transferred_to: ["user-2"],
        event_timestamp_ms: Date.UTC(2026, 4, 14, 13),
      },
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "metadata_only_event",
    });
    const args = upserts[0] as {
      update: { isActive?: boolean; lastEventType: string };
    };
    expect(args.update.isActive).toBeUndefined();
    expect(args.update.lastEventType).toBe("TRANSFER");
  });

  it("skips duplicate webhook deliveries idempotently", async () => {
    const { prisma, upserts } = createRevenueCatPrismaMock({
      lastEventId: "evt-renewal",
    });

    const result = await applyRevenueCatEvent(prisma, {
      event: {
        id: "evt-renewal",
        type: "RENEWAL",
        app_user_id: "user-1",
      },
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "duplicate_event",
    });
    expect(upserts).toHaveLength(0);
  });
});
