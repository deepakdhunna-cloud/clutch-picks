/**
 * Sign In with Apple — token revocation helpers.
 * App Store Guideline 5.1.1(v).
 */

import { SignJWT, importPKCS8 } from "jose";
import { env, features } from "../env";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const DEFAULT_CLIENT_SECRET_TTL_SECONDS = 10 * 60;
export const APPLE_MAX_CLIENT_SECRET_TTL_SECONDS = 15_777_000;
export const APPLE_PROVIDER_CLIENT_SECRET_TTL_SECONDS =
  APPLE_MAX_CLIENT_SECRET_TTL_SECONDS - 60 * 60;

export type AppleRevokeResult =
  | { status: "revoked" }
  | { status: "skipped"; reason: "not_configured" | "no_token" }
  | { status: "failed"; httpStatus: number; body: string }
  | { status: "error"; error: unknown };

export type AppleTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

function normalizePrivateKey(privateKeyPem: string): string {
  return privateKeyPem.replace(/\\n/g, "\n");
}

export async function signAppleClientSecret(options: {
  expiresInSeconds?: number;
} = {}): Promise<string> {
  if (!features.appleRevoke) {
    throw new Error("Apple revocation env vars not configured");
  }
  const teamId = env.APPLE_TEAM_ID!;
  const keyId = env.APPLE_KEY_ID!;
  const clientId = env.APPLE_CLIENT_ID!;
  const privateKeyPem = normalizePrivateKey(env.APPLE_PRIVATE_KEY!);
  const expiresInSeconds = Math.min(
    options.expiresInSeconds ?? DEFAULT_CLIENT_SECRET_TTL_SECONDS,
    APPLE_MAX_CLIENT_SECRET_TTL_SECONDS,
  );

  if (expiresInSeconds <= 0) {
    throw new Error("Apple client secret expiration must be greater than zero");
  }

  const key = await importPKCS8(privateKeyPem, "ES256");
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setAudience(APPLE_AUDIENCE)
    .setSubject(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(key);
}

export async function buildAppleProviderClientSecret(): Promise<string | null> {
  if (!features.appleRevoke) return null;
  return signAppleClientSecret({
    expiresInSeconds: APPLE_PROVIDER_CLIENT_SECRET_TTL_SECONDS,
  });
}

export function buildAppleTokenExchangeBody(input: {
  clientId: string;
  clientSecret: string;
  authorizationCode: string;
  redirectURI?: string;
}): URLSearchParams {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.authorizationCode,
    grant_type: "authorization_code",
  });
  if (input.redirectURI) body.set("redirect_uri", input.redirectURI);
  return body;
}

export function buildAppleAccountTokenUpdate(input: {
  tokenResponse: AppleTokenResponse;
  identityToken: string;
  nowMs?: number;
}): {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  accessTokenExpiresAt?: Date;
} {
  const { tokenResponse, identityToken } = input;
  const data: {
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    accessTokenExpiresAt?: Date;
  } = {
    idToken: tokenResponse.id_token ?? identityToken,
  };
  if (tokenResponse.access_token) {
    data.accessToken = tokenResponse.access_token;
  }
  if (tokenResponse.refresh_token) {
    data.refreshToken = tokenResponse.refresh_token;
  }
  if (typeof tokenResponse.expires_in === "number" && tokenResponse.expires_in > 0) {
    data.accessTokenExpiresAt = new Date((input.nowMs ?? Date.now()) + tokenResponse.expires_in * 1000);
  }
  return data;
}

export async function exchangeAppleAuthorizationCode(
  authorizationCode: string,
): Promise<AppleTokenResponse> {
  if (!features.appleRevoke) {
    throw new Error("Apple OAuth env vars not configured");
  }

  const clientSecret = await signAppleClientSecret();
  const body = buildAppleTokenExchangeBody({
    clientId: env.APPLE_CLIENT_ID!,
    clientSecret,
    authorizationCode,
  });

  const res = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({})) as AppleTokenResponse;

  if (!res.ok) {
    const message = json.error_description ?? json.error ?? "unknown_error";
    throw new Error(`Apple token exchange failed (${res.status}): ${message}`);
  }
  if (!json.access_token && !json.refresh_token) {
    throw new Error("Apple token exchange returned no access or refresh token");
  }
  return json;
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
