import { describe, it, expect } from "bun:test";
import { verifyRevenueCatAuth, isActiveAfter } from "../revenuecat";

describe("verifyRevenueCatAuth", () => {
  it("rejects when env not configured (no secret set)", () => {
    // In test env REVENUECAT_WEBHOOK_AUTH should be unset.
    const result = verifyRevenueCatAuth("anything");
    expect(result.ok).toBe(false);
  });

  it("rejects null/missing header", () => {
    const result = verifyRevenueCatAuth(null);
    expect(result.ok).toBe(false);
  });
});

describe("isActiveAfter", () => {
  it("marks purchase events as active", () => {
    expect(isActiveAfter("INITIAL_PURCHASE")).toBe(true);
    expect(isActiveAfter("RENEWAL")).toBe(true);
  });

  it("marks termination events as inactive", () => {
    expect(isActiveAfter("CANCELLATION")).toBe(false);
    expect(isActiveAfter("EXPIRATION")).toBe(false);
    expect(isActiveAfter("REFUND")).toBe(false);
  });

  it("returns null for unknown event types", () => {
    expect(isActiveAfter("MADE_UP_EVENT")).toBe(null);
  });
});
