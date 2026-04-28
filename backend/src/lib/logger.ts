// Pino structured logger. Web (src/index.ts) and worker (src/worker.ts)
// import the same instance; SERVICE_NAME env var distinguishes them in
// downstream log aggregators.
//
// Production: raw JSON to stdout — Railway parses it inline, queryable by
// any field (requestId, userId, job, etc.).
// Dev: pino-pretty transport for human-readable lines while still emitting
// the underlying JSON structure.
import pino from "pino";
import { env } from "../env";

const isProduction = env.NODE_ENV === "production";

export const logger = pino({
  level: isProduction ? "info" : "debug",
  base: {
    service: env.SERVICE_NAME,
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname,service,env",
        },
      },
  // Defense-in-depth: even if a route or job logs an entire request/response
  // payload that happens to carry a token, redact it before it leaves the
  // process. Path patterns match Pino's redact syntax.
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.apiKey",
      "*.authorization",
      "*.cookie",
      "*.set-cookie",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});

// Convenience for binding context (requestId, userId, job, etc.) to a child
// logger — child loggers inherit the parent's config and prepend the bound
// fields to every log line.
export function withContext(context: Record<string, unknown>) {
  return logger.child(context);
}

export type Logger = ReturnType<typeof withContext>;
