/**
 * Apple Sign-In diagnostics — read-only, secret-safe.
 *
 *   GET /api/apple-auth/diagnostics
 *
 * Purpose: confirm — from the live server, without a Railway console — how the
 * Apple Sign In configuration *resolves at runtime*. The native iOS flow sends
 * Apple's identity token to the backend, and Better Auth verifies the token's
 * `aud` (audience) claim against `appBundleIdentifier` (preferred) or, failing
 * that, the provider `clientId`. A mismatch there is the classic cause of
 * "Apple sign in failed. Please try again." on a build that is otherwise fine.
 *
 * Security: this endpoint NEVER returns secret values. It returns booleans
 * ("is this var present?"), lengths, and the *public* bundle identifier /
 * resolved audience (which already ships inside the iOS app and inside every
 * Apple identity token, so it is not a secret). It also attempts to sign the
 * Apple client secret and reports only success/failure + error class — never
 * the key or the signed JWT.
 *
 * When CALIBRATION_ADMIN_KEY (or APPLE_DIAGNOSTICS_KEY) is set AND a matching
 * `x-apple-diagnostics-key` / `x-calibration-admin-key` header is provided,
 * a few extra non-secret detail fields are included.
 */

import { Hono } from "hono";
import { env, features } from "../env";
import { signAppleClientSecret } from "../lib/appleAuth";

const appleDiagnosticsRouter = new Hono();

const APPLE_NATIVE_BUNDLE_ID = "Com.vibecode.clutchpicks-xzrxme";

function present(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

appleDiagnosticsRouter.get("/diagnostics", async (c) => {
  const adminKey = env.APPLE_DIAGNOSTICS_KEY ?? env.CALIBRATION_ADMIN_KEY;
  const provided =
    c.req.header("x-apple-diagnostics-key") ?? c.req.header("x-calibration-admin-key");
  const isAdmin = present(adminKey) && provided === adminKey;

  // Resolved audience — mirrors exactly what auth.ts hands Better Auth.
  const resolvedClientId = env.APPLE_CLIENT_ID ?? APPLE_NATIVE_BUNDLE_ID;
  const resolvedBundleId = env.APPLE_APP_BUNDLE_IDENTIFIER ?? APPLE_NATIVE_BUNDLE_ID;
  // Better Auth checks appBundleIdentifier first, then falls back to clientId.
  const resolvedAudience = resolvedBundleId || resolvedClientId;

  // Try to sign the Apple client secret (needed for token revoke + the
  // /native-token exchange). Report only pass/fail + error class.
  let clientSecretSigning: { ok: boolean; error?: string } = { ok: false };
  try {
    if (features.appleRevoke) {
      const jwt = await signAppleClientSecret({ expiresInSeconds: 60 });
      clientSecretSigning = { ok: typeof jwt === "string" && jwt.split(".").length === 3 };
    } else {
      clientSecretSigning = { ok: false, error: "APPLE_REVOKE_NOT_CONFIGURED" };
    }
  } catch (err) {
    clientSecretSigning = {
      ok: false,
      error: err instanceof Error ? err.name + ": " + err.message.slice(0, 120) : "UNKNOWN",
    };
  }

  const privateKeyRaw = env.APPLE_PRIVATE_KEY ?? "";
  const privateKeyLooksPem =
    privateKeyRaw.includes("BEGIN PRIVATE KEY") ||
    privateKeyRaw.includes("BEGIN EC PRIVATE KEY");

  const body: Record<string, unknown> = {
    note: "Read-only Apple Sign-In config check. No secret values are returned.",
    nodeEnv: env.NODE_ENV,
    presence: {
      APPLE_TEAM_ID: present(env.APPLE_TEAM_ID),
      APPLE_KEY_ID: present(env.APPLE_KEY_ID),
      APPLE_PRIVATE_KEY: present(env.APPLE_PRIVATE_KEY),
      APPLE_CLIENT_ID: present(env.APPLE_CLIENT_ID),
      APPLE_APP_BUNDLE_IDENTIFIER: present(env.APPLE_APP_BUNDLE_IDENTIFIER),
    },
    resolved: {
      // These are NOT secrets — the bundle id ships in the app binary and in
      // every Apple identity token's `aud` claim.
      audienceUsedForVerification: resolvedAudience,
      bundleIdentifier: resolvedBundleId,
      clientId: resolvedClientId,
      bundleIdMatchesExpectedNative: resolvedBundleId === APPLE_NATIVE_BUNDLE_ID,
      bundleIdEqualsClientId: resolvedBundleId === resolvedClientId,
    },
    checks: {
      appleRevokeFeatureEnabled: features.appleRevoke,
      clientSecretSigning,
      privateKeyLooksPem,
      privateKeyHasEscapedNewlines: privateKeyRaw.includes("\\n"),
    },
  };

  if (isAdmin) {
    body.adminDetail = {
      teamIdLength: (env.APPLE_TEAM_ID ?? "").length,
      keyIdLength: (env.APPLE_KEY_ID ?? "").length,
      privateKeyLength: privateKeyRaw.length,
      clientIdValue: resolvedClientId, // public-ish (Services ID); shown only to admin
    };
  }

  return c.json({ data: body });
});

export { appleDiagnosticsRouter };
