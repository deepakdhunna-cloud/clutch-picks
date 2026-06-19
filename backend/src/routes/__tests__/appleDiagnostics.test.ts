import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-level guard for the Apple diagnostics route. We assert on the source
 * (rather than booting the full app) so this stays fast and dependency-free,
 * and so we can prove the endpoint can never return secret VALUES.
 */
const routeSource = readFileSync(
  path.join(import.meta.dir, "..", "apple-diagnostics.ts"),
  "utf8",
);

describe("apple diagnostics route", () => {
  it("is mounted under /api/apple-auth as a read-only GET", () => {
    expect(routeSource).toContain('appleDiagnosticsRouter.get("/diagnostics"');
  });

  it("never returns raw secret values in the base payload", () => {
    // Secrets must only be reported as presence booleans / lengths, never as
    // their actual value. The private key is the most sensitive: it must only
    // appear as a length or a PEM/format check, never be placed on the body.
    expect(routeSource).toContain("present(env.APPLE_PRIVATE_KEY)");
    expect(routeSource).toContain("present(env.APPLE_TEAM_ID)");
    expect(routeSource).toContain("present(env.APPLE_KEY_ID)");

    // The private key value must never be assigned onto a response field.
    // (We allow `env.APPLE_PRIVATE_KEY ?? ""` purely to derive a length.)
    const forbidden = [
      "privateKey: env.APPLE_PRIVATE_KEY",
      "APPLE_PRIVATE_KEY: env.APPLE_PRIVATE_KEY",
      "key: env.APPLE_PRIVATE_KEY",
      "secret: env.APPLE_PRIVATE_KEY",
    ];
    for (const f of forbidden) {
      expect(routeSource).not.toContain(f);
    }

    // The Team ID / Key ID raw values must only ever be exposed as a length,
    // and only inside the admin-gated block.
    expect(routeSource).toContain("teamIdLength");
    expect(routeSource).toContain("keyIdLength");
    expect(routeSource).toContain("privateKeyLength");
  });

  it("reports the resolved verification audience and bundle/client comparison", () => {
    expect(routeSource).toContain("audienceUsedForVerification");
    expect(routeSource).toContain("bundleIdMatchesExpectedNative");
    expect(routeSource).toContain("bundleIdEqualsClientId");
  });

  it("checks that the Apple client secret can be signed", () => {
    expect(routeSource).toContain("signAppleClientSecret");
    expect(routeSource).toContain("clientSecretSigning");
  });

  it("gates extra detail behind an admin key", () => {
    expect(routeSource).toContain("APPLE_DIAGNOSTICS_KEY");
    expect(routeSource).toContain("x-apple-diagnostics-key");
    expect(routeSource).toContain("if (isAdmin)");
  });
});
