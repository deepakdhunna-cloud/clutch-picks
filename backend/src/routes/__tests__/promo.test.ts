import { afterEach, describe, expect, it } from "bun:test";
import {
  BUILT_IN_LIFETIME_PROMO_MAX_USES,
  CLUTCH_FNF_PROMO_CODE,
  getBuiltInPromoCodeConfig,
  normalizePromoCode,
} from "../promo";

const originalMaxUses = process.env.CLUTCH_FNF_MAX_USES;

afterEach(() => {
  if (originalMaxUses === undefined) {
    delete process.env.CLUTCH_FNF_MAX_USES;
  } else {
    process.env.CLUTCH_FNF_MAX_USES = originalMaxUses;
  }
});

describe("promo code helpers", () => {
  it("normalizes promo codes before lookup", () => {
    expect(normalizePromoCode("  clutchfnf  ")).toBe(CLUTCH_FNF_PROMO_CODE);
  });

  it("keeps CLUTCHFNF available as a lifetime built-in promo", () => {
    delete process.env.CLUTCH_FNF_MAX_USES;

    expect(getBuiltInPromoCodeConfig(CLUTCH_FNF_PROMO_CODE)).toEqual({
      code: CLUTCH_FNF_PROMO_CODE,
      type: "lifetime",
      maxUses: BUILT_IN_LIFETIME_PROMO_MAX_USES,
      createdBy: "system",
      note: "Friends and family lifetime access",
    });
  });

  it("allows the CLUTCHFNF max-use limit to be raised or lowered by env", () => {
    process.env.CLUTCH_FNF_MAX_USES = "250";

    expect(getBuiltInPromoCodeConfig(CLUTCH_FNF_PROMO_CODE)?.maxUses).toBe(250);
  });
});
