import { describe, it, expect } from "bun:test";
import {
  APPLE_MAX_CLIENT_SECRET_TTL_SECONDS,
  APPLE_PROVIDER_CLIENT_SECRET_TTL_SECONDS,
  buildAppleAccountTokenUpdate,
  buildAppleTokenExchangeBody,
  revokeAppleToken,
} from "../appleAuth";

describe("revokeAppleToken", () => {
  it("returns skipped when token is null or env not configured (graceful no-op)", async () => {
    const result = await revokeAppleToken({
      token: null,
      tokenTypeHint: "refresh_token",
    });
    expect(result.status).toBe("skipped");
  });

  it("builds the native authorization-code exchange body for Apple", () => {
    const body = buildAppleTokenExchangeBody({
      clientId: "com.example.app",
      clientSecret: "client-secret",
      authorizationCode: "authorization-code",
    });

    expect(body.get("client_id")).toBe("com.example.app");
    expect(body.get("client_secret")).toBe("client-secret");
    expect(body.get("code")).toBe("authorization-code");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.has("redirect_uri")).toBe(false);
  });

  it("keeps the provider client secret below Apple's maximum expiration", () => {
    expect(APPLE_PROVIDER_CLIENT_SECRET_TTL_SECONDS).toBeLessThan(APPLE_MAX_CLIENT_SECRET_TTL_SECONDS);
  });

  it("builds account token updates without clearing an existing refresh token", () => {
    expect(buildAppleAccountTokenUpdate({
      tokenResponse: {
        access_token: "access-token",
        expires_in: 3600,
      },
      identityToken: "identity-token",
      nowMs: 1_000,
    })).toEqual({
      accessToken: "access-token",
      idToken: "identity-token",
      accessTokenExpiresAt: new Date(3_601_000),
    });
  });
});
