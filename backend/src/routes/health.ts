import { Hono } from "hono";
import type { PrismaClient } from "@prisma/client";

export interface HealthDeps {
  isShuttingDown: () => boolean;
  prisma: Pick<PrismaClient, "$queryRaw">;
  dbTimeoutMs?: number;
  metadata?: HealthMetadata;
}

export interface HealthMetadata {
  serviceName?: string;
  predictionEngineVersion?: string;
  gitCommit?: string | null;
  appVersion?: string | null;
  buildNumber?: string | null;
}

function healthPayload(
  status: string,
  isShuttingDown: boolean,
  metadata?: HealthMetadata,
): { status: string; isShuttingDown: boolean; build?: HealthMetadata } {
  return {
    status,
    isShuttingDown,
    ...(metadata ? { build: metadata } : {}),
  };
}

// /health  = liveness, no DB. Fast so Railway can poll aggressively.
// /ready   = readiness, pings Postgres. 503 during shutdown or DB failure so
//            load balancers stop routing to this instance. Deps are injected
//            so tests can drive both paths without touching the real DB.
export function createHealthRouter(deps: HealthDeps) {
  const timeoutMs = deps.dbTimeoutMs ?? 2000;
  const router = new Hono();

  router.get("/health", (c) => {
    if (deps.isShuttingDown()) {
      return c.json(healthPayload("shutting-down", true, deps.metadata), 503);
    }
    return c.json(healthPayload("ok", false, deps.metadata));
  });

  router.get("/ready", async (c) => {
    if (deps.isShuttingDown()) {
      return c.json(healthPayload("shutting-down", true, deps.metadata), 503);
    }

    const startedAt = performance.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const dbPing = deps.prisma.$queryRaw`SELECT 1`;
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`DB ping timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      await Promise.race([dbPing, timeout]);
      const responseTimeMs = Math.round(performance.now() - startedAt);
      if (responseTimeMs > 500) {
        console.warn(`[health] /ready slow: db ping took ${responseTimeMs}ms`);
      }
      return c.json({
        ...healthPayload("ready", false, deps.metadata),
        db: "ok",
        responseTimeMs,
      });
    } catch (err) {
      const responseTimeMs = Math.round(performance.now() - startedAt);
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          ...healthPayload("not-ready", false, deps.metadata),
          db: "error",
          error: message,
          responseTimeMs,
        },
        503,
      );
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  });

  return router;
}
