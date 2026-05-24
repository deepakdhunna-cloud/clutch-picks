import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Check = {
  key: string;
  required: boolean;
  note: string;
  validate?: (value: string) => string | null;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "../..");
const rootDir = path.resolve(backendDir, "..");

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const env: Record<string, string> = {};
  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function parseEasProductionEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      build?: {
        production?: {
          env?: Record<string, string>;
        };
      };
    };
    return raw.build?.production?.env ?? {};
  } catch {
    return {};
  }
}

const easProductionEnv = parseEasProductionEnv(path.join(rootDir, "eas.json"));
const fileEnv = {
  ...easProductionEnv,
  ...parseEnvFile(path.join(rootDir, ".env")),
  ...parseEnvFile(path.join(backendDir, ".env")),
};
const env = { ...fileEnv, ...process.env };

function hasValue(key: string): boolean {
  return typeof env[key] === "string" && env[key].trim().length > 0;
}

function urlCheck(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return "must not point to localhost for production";
    }
    return null;
  } catch {
    return "must be a valid URL";
  }
}

const checks: Check[] = [
  { key: "EXPO_PUBLIC_BACKEND_URL", required: true, note: "mobile app API base URL", validate: urlCheck },
  { key: "EXPO_PUBLIC_REVENUECAT_APPLE_KEY", required: true, note: "iOS RevenueCat public SDK key" },
  { key: "BACKEND_URL", required: true, note: "backend public URL", validate: urlCheck },
  { key: "DATABASE_URL", required: true, note: "production PostgreSQL database" },
  {
    key: "BETTER_AUTH_SECRET",
    required: true,
    note: "auth session signing secret",
    validate: (value) => value.length >= 32 ? null : "must be at least 32 characters",
  },
  { key: "RESEND_API_KEY", required: true, note: "email OTP delivery" },
  { key: "EMAIL_FROM", required: true, note: "email OTP sender identity" },
  { key: "SHARPAPI_KEY", required: true, note: "market line enrichment and calibration anchor" },
  { key: "SPORTSDATAIO_API_KEY", required: true, note: "verified schedules, rosters, injuries, stats, betting feeds, and news" },
  { key: "REVENUECAT_SECRET_KEY", required: true, note: "server-side RevenueCat API access" },
  { key: "REVENUECAT_WEBHOOK_AUTH", required: true, note: "RevenueCat webhook shared secret" },
  { key: "APPLE_TEAM_ID", required: true, note: "Sign in with Apple token revocation" },
  { key: "APPLE_KEY_ID", required: true, note: "Sign in with Apple token revocation" },
  { key: "APPLE_PRIVATE_KEY", required: true, note: "Sign in with Apple token revocation" },
  { key: "APPLE_CLIENT_ID", required: true, note: "Sign in with Apple token revocation" },
  { key: "UPLOADS_DIR", required: true, note: "persistent profile image upload storage path" },
  { key: "SENTRY_DSN", required: false, note: "production crash/error monitoring" },
  { key: "EXPO_PUBLIC_REVENUECAT_TEST_KEY", required: false, note: "RevenueCat test-store key for dev/TestFlight debugging" },
  { key: "OPENAI_API_KEY", required: false, note: "LLM narrative generation" },
  { key: "APIFY_API_KEY", required: true, note: "Twitter/X beat-writer social/news ingestion" },
  { key: "ANTHROPIC_API_KEY", required: false, note: "ingestion extraction" },
  { key: "MLB_UMPIRE_TENDENCY_SOURCE_URL", required: true, note: "verified MLB umpire tendency feed", validate: urlCheck },
  { key: "SOCCER_MANAGER_CHANGES_SOURCE_URL", required: true, note: "verified soccer manager-change feed", validate: urlCheck },
  { key: "UCL_COEFFICIENTS_SOURCE_URL", required: true, note: "verified UEFA club coefficient feed", validate: urlCheck },
  { key: "UCL_TEAM_LOCATION_SOURCE_URL", required: true, note: "verified UCL team location feed", validate: urlCheck },
  { key: "CALIBRATION_ADMIN_KEY", required: false, note: "protected calibration routes" },
  { key: "INGESTION_ADMIN_KEY", required: false, note: "protected ingestion routes" },
];

let failures = 0;

console.log("Release readiness environment check");
console.log(`Loaded env sources: ${[
  Object.keys(easProductionEnv).length > 0 ? "eas.json production env" : null,
  fs.existsSync(path.join(rootDir, ".env")) ? "root .env" : null,
  fs.existsSync(path.join(backendDir, ".env")) ? "backend .env" : null,
  "process.env",
].filter(Boolean).join(", ")}`);
console.log("");

for (const check of checks) {
  const present = hasValue(check.key);
  const value = env[check.key];
  const validationError = present && check.validate && value ? check.validate(value) : null;
  const ok = present && !validationError;
  const optionalLabel = check.required ? "required" : "optional";

  if (!ok && check.required) failures += 1;
  const status = ok ? "OK" : check.required ? "MISSING" : "OPTIONAL";
  const suffix = validationError ? ` (${validationError})` : "";
  console.log(`${status.padEnd(8)} ${check.key.padEnd(26)} ${optionalLabel} - ${check.note}${suffix}`);
}

console.log("");
if (failures > 0) {
  console.log(`${failures} required production setting(s) still need attention.`);
  console.log("If this was run from a local shell, production secrets may simply be absent locally.");
  console.log("To verify Railway production without printing secret values, run: bun run release:check:production");
  process.exitCode = 1;
} else {
  console.log("Required production settings are present.");
}
