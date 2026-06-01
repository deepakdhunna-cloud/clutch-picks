import {
  customerInfoHasPremiumAccess,
  REVENUECAT_ENTITLEMENT_ID,
} from '../revenuecat-premium';

describe('RevenueCat premium access detection', () => {
  it('accepts the configured Pro entitlement', () => {
    expect(
      customerInfoHasPremiumAccess({
        entitlements: {
          active: {
            [REVENUECAT_ENTITLEMENT_ID]: { identifier: REVENUECAT_ENTITLEMENT_ID },
          },
        },
      }),
    ).toBe(true);
  });

  it('accepts any active app entitlement as a paid-access fallback', () => {
    expect(
      customerInfoHasPremiumAccess({
        entitlements: {
          active: {
            premium: { identifier: 'premium' },
          },
        },
      }),
    ).toBe(true);
  });

  it('accepts active app subscriptions when entitlements have not hydrated yet', () => {
    expect(
      customerInfoHasPremiumAccess({
        entitlements: { active: {} },
        activeSubscriptions: ['clutch_pro_monthly_v2'],
      }),
    ).toBe(true);
  });

  it('does not grant access with no active entitlement or subscription', () => {
    expect(
      customerInfoHasPremiumAccess({
        entitlements: { active: {} },
        activeSubscriptions: [],
      }),
    ).toBe(false);
  });
});
