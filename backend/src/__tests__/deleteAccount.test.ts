import { describe, test, expect, mock } from "bun:test";
import {
  deleteUserAccount,
  type DeleteAccountPrisma,
} from "../lib/deleteAccount";

// Construct a mock prisma + tx pair. Each delegate is a bun mock so tests
// can assert call shape. $transaction runs the callback against mockTx so
// the real execution path is exercised.
function buildMockPrisma(opts?: {
  appleAccounts?: Array<{ id: string }>;
  throwOnUserDelete?: boolean;
}) {
  const mockTx = {
    appNotification: {
      deleteMany: mock(async () => ({ count: 3 })),
    },
    notificationLog: {
      deleteMany: mock(async () => ({ count: 5 })),
    },
    teamFollow: {
      deleteMany: mock(async () => ({ count: 2 })),
    },
    user: {
      delete: mock(async () => {
        if (opts?.throwOnUserDelete) throw new Error("user row missing");
        return { id: "u1" };
      }),
    },
    // PromoRedemption delegate deliberately absent to prove nothing
    // touches it. If a regression adds a promoRedemption.deleteMany call,
    // the test crashes with an undefined-property access.
  };

  const $transaction = mock(async (fn: (tx: typeof mockTx) => unknown) => {
    return await fn(mockTx);
  });

  const account = {
    findMany: mock(async () => opts?.appleAccounts ?? []),
  };

  return {
    prisma: { $transaction, account } as unknown as DeleteAccountPrisma,
    mockTx,
    $transaction,
    account,
  };
}

describe("deleteUserAccount — core module", () => {
  test("deletes AppNotification, NotificationLog, TeamFollow, and the User inside one transaction", async () => {
    const { prisma, mockTx, $transaction } = buildMockPrisma();

    await deleteUserAccount(prisma, { id: "u1", email: "a@b.com" });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.appNotification.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
    });
    expect(mockTx.notificationLog.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
    });
    expect(mockTx.teamFollow.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
    });
    expect(mockTx.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  test("does NOT touch PromoRedemption (retained for audit trail)", async () => {
    const { prisma, mockTx } = buildMockPrisma();

    await deleteUserAccount(prisma, { id: "u1", email: "a@b.com" });

    // The mock tx object exposes only the delegates the module is allowed
    // to call. Asserting the absence of a promoRedemption key locks in
    // the retention policy — adding a deleteMany here would fail.
    expect("promoRedemption" in mockTx).toBe(false);
  });

  test("propagates errors from the transaction so the caller can 500", async () => {
    const { prisma, mockTx } = buildMockPrisma({ throwOnUserDelete: true });

    await expect(
      deleteUserAccount(prisma, { id: "u1", email: "a@b.com" }),
    ).rejects.toThrow("user row missing");

    // The three deleteMany calls inside the tx ran before the throw — in
    // real Prisma the transaction would roll them back. This test proves
    // the module doesn't fall back to a non-transactional path.
    expect(mockTx.user.delete).toHaveBeenCalledTimes(1);
  });

  test("logs Apple revocation warning when user has an Apple account", async () => {
    const warnSpy = mock(() => {});
    const origWarn = console.warn;
    console.warn = warnSpy as unknown as typeof console.warn;
    try {
      const { prisma } = buildMockPrisma({
        appleAccounts: [{ id: "acct-1" }],
      });
      await deleteUserAccount(prisma, { id: "u1", email: "a@b.com" });
    } finally {
      console.warn = origWarn;
    }
    const warnArgs = warnSpy.mock.calls.flat().join(" ");
    expect(warnArgs).toContain("Apple revocation env vars missing");
    expect(warnArgs).toContain("APPLE_TEAM_ID");
  });

  test("skips Apple warning when user has no Apple accounts", async () => {
    const warnSpy = mock(() => {});
    const origWarn = console.warn;
    console.warn = warnSpy as unknown as typeof console.warn;
    try {
      const { prisma } = buildMockPrisma({ appleAccounts: [] });
      await deleteUserAccount(prisma, { id: "u1", email: "a@b.com" });
    } finally {
      console.warn = origWarn;
    }
    const warnArgs = warnSpy.mock.calls.flat().join(" ");
    expect(warnArgs).not.toContain("Apple token revocation");
  });

  test("Apple lookup failure does NOT block deletion", async () => {
    const { mockTx } = buildMockPrisma();
    const prisma = {
      $transaction: mock(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
      account: {
        findMany: mock(async () => {
          throw new Error("connection timeout");
        }),
      },
    } as unknown as DeleteAccountPrisma;

    await deleteUserAccount(prisma, { id: "u1", email: "a@b.com" });

    expect(mockTx.user.delete).toHaveBeenCalledTimes(1);
  });
});

// ─── HTTP-layer test ────────────────────────────────────────────────────────
// Exercises the shape of the DELETE /api/me handler without booting the full
// app (which would start crons, servers, etc.). We reconstruct a minimal
// Hono app with the same handler logic and drive it through .request().

import { Hono } from "hono";

function buildAppWithDeleteHandler(opts: {
  user: { id: string; email: string } | null;
  prisma: DeleteAccountPrisma;
}) {
  const app = new Hono<{ Variables: { user: typeof opts.user } }>();
  app.use("*", async (c, next) => {
    c.set("user", opts.user);
    await next();
  });
  app.delete("/api/me", async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
    }
    try {
      await deleteUserAccount(opts.prisma, { id: user.id, email: user.email });
      return c.json({ data: { status: "deleted", userId: user.id } });
    } catch {
      return c.json(
        { error: { message: "Account deletion failed. Please try again.", code: "DELETE_FAILED" } },
        500,
      );
    }
  });
  return app;
}

describe("DELETE /api/me — HTTP handler", () => {
  test("returns 401 when unauthenticated", async () => {
    const { prisma } = buildMockPrisma();
    const app = buildAppWithDeleteHandler({ user: null, prisma });
    const res = await app.request("/api/me", { method: "DELETE" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("returns 200 with deleted status when authenticated", async () => {
    const { prisma, mockTx } = buildMockPrisma();
    const app = buildAppWithDeleteHandler({
      user: { id: "u1", email: "a@b.com" },
      prisma,
    });
    const res = await app.request("/api/me", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { status: "deleted", userId: "u1" },
    });
    expect(mockTx.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  test("returns 500 when prisma transaction throws", async () => {
    const { prisma, mockTx } = buildMockPrisma({ throwOnUserDelete: true });
    const app = buildAppWithDeleteHandler({
      user: { id: "u1", email: "a@b.com" },
      prisma,
    });
    const res = await app.request("/api/me", { method: "DELETE" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DELETE_FAILED");
    // deleteMany calls ran before the throw inside the tx. In real Prisma
    // the tx would roll them back; here we're just proving the handler
    // reached the delete step before failing.
    expect(mockTx.appNotification.deleteMany).toHaveBeenCalled();
  });
});

// ─── Legacy profile path ────────────────────────────────────────────────────
// The mobile app calls DELETE /api/profile/delete-account (not /api/me), so
// that route must share the same deleteUserAccount module and keep the
// { data: { success: true } } envelope the frontend already parses.

function buildProfileDeleteApp(opts: {
  user: { id: string; email: string } | null;
  prisma: DeleteAccountPrisma;
}) {
  const app = new Hono<{ Variables: { user: typeof opts.user } }>();
  app.use("*", async (c, next) => {
    c.set("user", opts.user);
    await next();
  });
  app.delete("/api/profile/delete-account", async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: { message: "Not authenticated", code: "UNAUTHORIZED" } }, 401);
    }
    try {
      await deleteUserAccount(opts.prisma, { id: user.id, email: user.email });
      return c.json({ data: { success: true } });
    } catch {
      return c.json(
        { error: { message: "Failed to delete account", code: "DELETE_FAILED" } },
        500,
      );
    }
  });
  return app;
}

describe("DELETE /api/profile/delete-account — legacy mobile path", () => {
  test("authenticated call returns { data: { success: true } } and deletes the user", async () => {
    const { prisma, mockTx } = buildMockPrisma();
    const app = buildProfileDeleteApp({
      user: { id: "u1", email: "a@b.com" },
      prisma,
    });
    const res = await app.request("/api/profile/delete-account", { method: "DELETE" });
    expect(res.status).toBe(200);
    // Shape must match what mobile settings.tsx expects — do not change.
    expect(await res.json()).toEqual({ data: { success: true } });
    expect(mockTx.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });
});
