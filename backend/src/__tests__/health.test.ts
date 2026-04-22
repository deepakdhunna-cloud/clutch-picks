import { describe, test, expect } from "bun:test";
import { createHealthRouter, type HealthDeps } from "../routes/health";

// The health router is built with injected deps so these tests never touch
// the real PrismaClient or hit a database. `$queryRaw` is invoked as a
// template tag by the real code; a loose signature is fine for the mock.
type MockPrisma = HealthDeps["prisma"];
function fakePrisma(impl: () => Promise<unknown>): MockPrisma {
  return {
    $queryRaw: (() => impl()) as unknown as MockPrisma["$queryRaw"],
  };
}

describe("GET /health", () => {
  test("returns 200 with status ok when not shutting down", async () => {
    const router = createHealthRouter({
      isShuttingDown: () => false,
      prisma: fakePrisma(async () => [{ one: 1 }]),
    });
    const res = await router.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", isShuttingDown: false });
  });

  test("returns 503 shutting-down when drain in progress", async () => {
    const router = createHealthRouter({
      isShuttingDown: () => true,
      prisma: fakePrisma(async () => [{ one: 1 }]),
    });
    const res = await router.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("shutting-down");
  });
});

describe("GET /ready", () => {
  test("returns 200 when DB ping succeeds", async () => {
    const router = createHealthRouter({
      isShuttingDown: () => false,
      prisma: fakePrisma(async () => [{ one: 1 }]),
    });
    const res = await router.request("/ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      db: string;
      responseTimeMs: number;
    };
    expect(body.status).toBe("ready");
    expect(body.db).toBe("ok");
    expect(typeof body.responseTimeMs).toBe("number");
    expect(body.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  test("returns 503 when DB ping throws", async () => {
    const router = createHealthRouter({
      isShuttingDown: () => false,
      prisma: fakePrisma(async () => {
        throw new Error("connection refused");
      }),
    });
    const res = await router.request("/ready");
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      db: string;
      error: string;
    };
    expect(body.status).toBe("not-ready");
    expect(body.db).toBe("error");
    expect(body.error).toContain("connection refused");
  });

  test("returns 503 when DB ping exceeds timeout", async () => {
    const router = createHealthRouter({
      isShuttingDown: () => false,
      // Never resolves — forces the race to lose to the timeout.
      prisma: fakePrisma(() => new Promise(() => {})),
      dbTimeoutMs: 50,
    });
    const res = await router.request("/ready");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { db: string; error: string };
    expect(body.db).toBe("error");
    expect(body.error).toMatch(/timed out/i);
  });

  test("returns 503 shutting-down without running DB query", async () => {
    let pinged = false;
    const router = createHealthRouter({
      isShuttingDown: () => true,
      prisma: fakePrisma(async () => {
        pinged = true;
        return [];
      }),
    });
    const res = await router.request("/ready");
    expect(res.status).toBe(503);
    expect((await res.json()) as { status: string }).toMatchObject({
      status: "shutting-down",
    });
    expect(pinged).toBe(false);
  });
});
