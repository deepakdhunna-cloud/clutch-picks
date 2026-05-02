import { describe, it, expect } from "bun:test";
import { revokeAppleToken } from "../appleAuth";

describe("revokeAppleToken", () => {
  it("returns skipped when token is null or env not configured (graceful no-op)", async () => {
    const result = await revokeAppleToken({
      token: null,
      tokenTypeHint: "refresh_token",
    });
    expect(result.status).toBe("skipped");
  });
});
