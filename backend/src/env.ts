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
  // Tags every log line so we can split web vs worker traffic in the
  // log aggregator. Set explicitly per Railway service (web → "web",
  // clutch-picks-worker → "worker"); falls back to "web" in dev.
  SERVICE_NAME: z.string().optional().default("web"),

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
  // Required in production so release predictions keep their market
  // calibration and value-comparison surface.
  SHARPAPI_KEY: z.string().optional(),
  // SportsDataIO supplies verified schedules, rosters, injuries, stats, and
  // betting feeds. Required in production so the engine can move off fragile
  // public-only data sources as each sport adapter is wired in.
  SPORTSDATAIO_API_KEY: z.string().optional(),
  // Apify runs the Twitter/X scraper actor for beat-writer ingestion.
  // Required in production so the injury/news pipeline can use beat-writer
  // social signals instead of RSS alone.
  APIFY_API_KEY: z.string().optional(),
  // Verified data-source feeds for factors that must not rely on mock values.
  // Required in production so release predictions keep the full verified-data
  // surface. Each URL should return the same JSON shape as the corresponding
  // file in backend/src/lib/data.
  MLB_UMPIRE_TENDENCY_SOURCE_URL: z.url().optional(),
  SOCCER_MANAGER_CHANGES_SOURCE_URL: z.url().optional(),
  UCL_COEFFICIENTS_SOURCE_URL: z.url().optional(),
  UCL_TEAM_LOCATION_SOURCE_URL: z.url().optional(),
  // RevenueCat: server-side subscription validation + webhooks.
  REVENUECAT_SECRET_KEY: z.string().optional(),
  // Sentry error tracking — when set, both web and worker init the SDK and
  // forward unhandled exceptions/captured errors. Optional so dev runs
  // without it.
  SENTRY_DSN: z.string().optional(),
  // Resend transactional email — used for OTP sign-in delivery.
  // Required in production for the email-OTP auth flow to work; in
  // dev, OTP send will throw if missing so failures surface fast.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional().default("noreply@clutchpicksapp.com"),

  // ─── Sign In with Apple — token revocation (App Store 5.1.1(v)) ─────
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),

  // ─── RevenueCat webhook — inbound subscription events ────────────────
  // Shared secret RevenueCat sends in the Authorization header on every
  // webhook POST. Required for any webhook to be honored; missing → 503.
  REVENUECAT_WEBHOOK_AUTH: z.string().optional(),

  // ─── Admin gates ──────────────────────────────────────────────────────
  // CALIBRATION_ADMIN_KEY gates calibration + backtest replay routes.
  // INGESTION_ADMIN_KEY gates ingestion status; when unset, those routes
  // fall back to CALIBRATION_ADMIN_KEY so a single admin key still works.
  CALIBRATION_ADMIN_KEY: z.string().optional(),
  INGESTION_ADMIN_KEY: z.string().optional(),

  // ─── Feature flags ────────────────────────────────────────────────────
  USE_NEW_PREDICTION_ENGINE: z.string().optional(),
  // Kill-switch for the self-learning calibration layer. Defaults to ENABLED
  // (preserves shipped 2.11.0 behavior). Set to "false"/"0"/"off" to disable
  // the layer in production without a code revert — predictions then serve the
  // raw model probability with no self-learning adjustment.
  SELF_LEARNING_CALIBRATION_ENABLED: z.string().optional(),

  // ─── Paths ────────────────────────────────────────────────────────────
  // Where prediction_shadow_*.jsonl files land; defaults to backend/logs
  // resolved relative to the shadow module.
  LOGS_DIR: z.string().optional(),
  // Persistent profile image uploads. In production this should point at a
  // mounted volume or other durable filesystem path.
  UPLOADS_DIR: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== "production") return;

  const backendUrl = new URL(value.BACKEND_URL);
  if (backendUrl.hostname === "localhost" || backendUrl.hostname === "127.0.0.1") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BACKEND_URL"],
      message: "BACKEND_URL must not point to localhost in production",
    });
  }

  const requiredInProduction: Array<keyof typeof value> = [
    "RESEND_API_KEY",
    "SHARPAPI_KEY",
    "SPORTSDATAIO_API_KEY",
    "APIFY_API_KEY",
    "REVENUECAT_SECRET_KEY",
    "REVENUECAT_WEBHOOK_AUTH",
    "APPLE_TEAM_ID",
    "APPLE_KEY_ID",
    "APPLE_PRIVATE_KEY",
    "APPLE_CLIENT_ID",
    "UPLOADS_DIR",
    "MLB_UMPIRE_TENDENCY_SOURCE_URL",
    "SOCCER_MANAGER_CHANGES_SOURCE_URL",
    "UCL_COEFFICIENTS_SOURCE_URL",
    "UCL_TEAM_LOCATION_SOURCE_URL",
  ];

  for (const key of requiredInProduction) {
    const current = value[key];
    if (typeof current !== "string" || current.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required in production`,
      });
    }
  }
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
  sportsDataIO: !!env.SPORTSDATAIO_API_KEY,
  apify: !!env.APIFY_API_KEY,
  revenuecat: !!env.REVENUECAT_SECRET_KEY,
  sentry: !!env.SENTRY_DSN,
  appleRevoke: !!(env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY && env.APPLE_CLIENT_ID),
  revenuecatWebhook: !!env.REVENUECAT_WEBHOOK_AUTH,
  mlbUmpireTendencies: !!env.MLB_UMPIRE_TENDENCY_SOURCE_URL,
  soccerManagerChanges: !!env.SOCCER_MANAGER_CHANGES_SOURCE_URL,
  uclCoefficients: !!env.UCL_COEFFICIENTS_SOURCE_URL,
  uclTeamLocations: !!env.UCL_TEAM_LOCATION_SOURCE_URL,
} as const;

// The old prediction engine is retained only as historical code. User-facing
// predictions always use the new engine, regardless of stale environment flags.
export const useNewPredictionEngine = true;

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
    `  openai=${onOff(f.openai)}  sharpapi=${onOff(f.sharpapi)}  sportsdataio=${onOff(f.sportsDataIO)}  ` +
      `apify=${onOff(f.apify)}  anthropic=${onOff(f.anthropic)}`,
  );
  console.log(`  revenuecat=${onOff(f.revenuecat)}  sentry=${onOff(f.sentry)}`);
  console.log("[env] verified data feeds:");
  console.log(
    `  mlbUmpires=${onOff(f.mlbUmpireTendencies)}  soccerManagers=${onOff(f.soccerManagerChanges)}  ` +
      `uclCoefficients=${onOff(f.uclCoefficients)}  uclLocations=${onOff(f.uclTeamLocations)}`,
  );
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
