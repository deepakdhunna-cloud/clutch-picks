// Thin wrapper around Sentry init so both src/index.ts (web) and
// src/worker.ts (worker) bootstrap the SDK identically and tag every event
// with which service emitted it. Re-exports the SDK so call sites only need
// to import from this module.
import * as Sentry from "@sentry/bun";
import { env } from "../env";

export function initSentry(serviceName: "web" | "worker"): void {
  if (!env.SENTRY_DSN) {
    console.log(`[sentry] disabled (no SENTRY_DSN set)`);
    return;
  }
  try {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      // 10% transaction sampling — caps Sentry cost while keeping signal
      // for slow-endpoint detection. Profiling is omitted (off by default
      // in @sentry/bun) so we don't get hit with profile-event billing.
      tracesSampleRate: 0.1,
      initialScope: {
        tags: { service: serviceName },
      },
      beforeSend(event) {
        return event;
      },
    });
    console.log(`[sentry] initialized for service=${serviceName}`);
  } catch (err) {
    // Never block boot on a Sentry init failure.
    console.error(`[sentry] init failed (continuing without):`, err);
  }
}

export { Sentry };
