import { z } from "zod";

// Centralized env validation. Every var the backend reads should be declared
// here — anything not declared fails typing when accessed via process.env.X
// (so typos surface at compile time), and anything declared is validated at
// boot. Optional integrations stay optional; missing keys get reported in
// the boot log so operators can see what's on vs. off at a glance.
const envSchema = z.object({
  // ─── Server ───────────────────────────────────────────────────────────
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .optional()
    .default("development"),
  BACKEND_URL: z
    .url("BACKEND_URL must be a valid URL")
    .default("http://localhost:3000"),

  // ─── Database ─────────────────────────────────────────────────────────
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (PostgreSQL connection string)"),

  // ─── Auth — required ──────────────────────────────────────────────────
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be >= 32 chars"),

  // ─── Optional integrations ────────────────────────────────────────────
  // OpenAI powers LLM-generated analyst narratives; the deterministic
  // fallback covers the missing-key case.
  OPENAI_API_KEY: z.string().optional(),
  // Anthropic is the ingestion pipeline's LLM extractor; absent it, raw
  // items are collected but not structured into PlayerAvailability rows.
  ANTHROPIC_API_KEY: z.string().optional(),
  // SharpAPI supplies Pinnacle consensus lines for the market-anchor factor.
  SHARPAPI_KEY: z.string().optional(),
  // Apify runs the Twitter scraper actor for beat-writer ingestion.
  APIFY_API_KEY: z.string().optional(),
  // RevenueCat: server-side subscription validation + webhooks.
  REVENUECAT_SECRET_KEY: z.string().optional(),
  // Sentry error tracking — when set, both web and worker init the SDK and
  // forward unhandled exceptions/captured errors. Optional so dev runs
  // without it.
  SENTRY_DSN: z.string().optional(),

  // ─── Admin gates ──────────────────────────────────────────────────────
  // CALIBRATION_ADMIN_KEY gates calibration + backtest replay routes.
  // INGESTION_ADMIN_KEY gates ingestion status; when unset, those routes
  // fall back to CALIBRATION_ADMIN_KEY so a single admin key still works.
  CALIBRATION_ADMIN_KEY: z.string().optional(),
  INGESTION_ADMIN_KEY: z.string().optional(),

  // ─── Feature flags ────────────────────────────────────────────────────
  USE_NEW_PREDICTION_ENGINE: z.string().optional(),

  // ─── Paths ────────────────────────────────────────────────────────────
  // Where prediction_shadow_*.jsonl files land; defaults to backend/logs
  // resolved relative to the shadow module.
  LOGS_DIR: z.string().optional(),
});

function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    console.log("✅ Environment variables validated successfully");
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Environment variable validation failed:");
      error.issues.forEach((err: z.ZodIssue) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      console.error(
        "\nPlease check your .env file and ensure all required variables are set.",
      );
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;

// Feature presence — boolean flags callers can check instead of doing
// truthiness on a raw process.env string. Single source of truth, so a
// renamed var only changes one place.
export const features = {
  openai: !!env.OPENAI_API_KEY,
  anthropic: !!env.ANTHROPIC_API_KEY,
  sharpapi: !!env.SHARPAPI_KEY,
  apify: !!env.APIFY_API_KEY,
  revenuecat: !!env.REVENUECAT_SECRET_KEY,
  sentry: !!env.SENTRY_DSN,
} as const;

// Prediction-engine flag centralized here so the shadow module and any
// future consumer both read the same derivation.
export const useNewPredictionEngine: boolean =
  env.USE_NEW_PREDICTION_ENGINE === "true";

function onOff(flag: boolean): "on" | "off" {
  return flag ? "on" : "off";
}

function adminKeyStatus(): {
  calibration: "set" | "unset";
  ingestion: "set" | "fallback-to-calibration" | "unset";
} {
  const hasCalibration = !!env.CALIBRATION_ADMIN_KEY;
  const hasIngestion = !!env.INGESTION_ADMIN_KEY;
  return {
    calibration: hasCalibration ? "set" : "unset",
    ingestion: hasIngestion
      ? "set"
      : hasCalibration
        ? "fallback-to-calibration"
        : "unset",
  };
}

// Single block of boot-time logging for everything env-derived. Replaces
// the scattered console.warn lines that used to live in src/index.ts.
export function printEnvReport(): void {
  const f = features;
  console.log("[env] integrations:");
  console.log(
    `  openai=${onOff(f.openai)}  sharpapi=${onOff(f.sharpapi)}  apify=${onOff(f.apify)}  anthropic=${onOff(f.anthropic)}`,
  );
  console.log(`  revenuecat=${onOff(f.revenuecat)}  sentry=${onOff(f.sentry)}`);
  console.log("[env] feature flags:");
  console.log(`  new_prediction_engine=${useNewPredictionEngine}`);
  const admin = adminKeyStatus();
  console.log("[env] admin keys:");
  console.log(
    `  calibration=${admin.calibration}  ingestion=${admin.ingestion}`,
  );
}

printEnvReport();

// NODE_ENV is omitted because @types/bun / @types/node already declare it
// as `string`, and our narrower enum type can't merge with that. Callers
// should read NODE_ENV from `env.NODE_ENV` (validated) rather than raw
// process.env when they need the enum.
type ProcessEnvOverrides = Omit<z.infer<typeof envSchema>, "NODE_ENV">;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    // eslint-disable-next-line import/namespace
    interface ProcessEnv extends ProcessEnvOverrides {}
  }
}
