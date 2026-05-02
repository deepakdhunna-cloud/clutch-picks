/**
 * Sign In with Apple — token revocation helpers.
 * App Store Guideline 5.1.1(v).
 */

import { SignJWT, importPKCS8 } from "jose";
import { env, features } from "../env";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const CLIENT_SECRET_TTL_SECONDS = 10 * 60;

export type AppleRevokeResult =
  | { status: "revoked" }
  | { status: "skipped"; reason: "not_configured" | "no_token" }
  | { status: "failed"; httpStatus: number; body: string }
  | { status: "error"; error: unknown };

export async function signAppleClientSecret(): Promise<string> {
  if (!features.appleRevoke) {
    throw new Error("Apple revocation env vars not configured");
  }
  const teamId = env.APPLE_TEAM_ID!;
  const keyId = env.APPLE_KEY_ID!;
  const clientId = env.APPLE_CLIENT_ID!;
  const privateKeyPem = env.APPLE_PRIVATE_KEY!;

  const key = await importPKCS8(privateKeyPem, "ES256");
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setAudience(APPLE_AUDIENCE)
    .setSubject(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + CLIENT_SECRET_TTL_SECONDS)
    .sign(key);
}

export async function revokeAppleToken(input: {
  token: string | null;
  tokenTypeHint: "refresh_token" | "access_token";
}): Promise<AppleRevokeResult> {
  if (!features.appleRevoke) return { status: "skipped", reason: "not_configured" };
  if (!input.token) return { status: "skipped", reason: "no_token" };

  try {
    const clientSecret = await signAppleClientSecret();
    const body = new URLSearchParams({
      client_id: env.APPLE_CLIENT_ID!,
      client_secret: clientSecret,
      token: input.token,
      token_type_hint: input.tokenTypeHint,
    });

    const res = await fetch(APPLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { status: "failed", httpStatus: res.status, body: text };
    }
    return { status: "revoked" };
  } catch (error) {
    return { status: "error", error };
  }
}
