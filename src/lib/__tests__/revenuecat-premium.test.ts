import {
  classifyCustomerSubscriptionState,
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

  it('rejects unrelated active app entitlements and subscriptions', () => {
    expect(
      customerInfoHasPremiumAccess({
        entitlements: {
          active: {
            premium: { identifier: 'premium' },
          },
        },
        activeSubscriptions: ['other_subscription'],
      }),
    ).toBe(false);
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

describe('RevenueCat subscription state classification', () => {
  const baseInfo = {
    entitlements: { active: {}, all: {} },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
    allExpirationDates: {},
    subscriptionsByProductIdentifier: {},
  };

  it('identifies active free trials', () => {
    expect(
      classifyCustomerSubscriptionState({
        ...baseInfo,
        entitlements: {
          active: {
            [REVENUECAT_ENTITLEMENT_ID]: {
              identifier: REVENUECAT_ENTITLEMENT_ID,
              isActive: true,
              periodType: 'TRIAL',
              willRenew: true,
              expirationDate: '2030-01-01T00:00:00Z',
            },
          },
          all: {},
        },
        activeSubscriptions: ['clutch_pro_monthly_v2'],
      }).status,
    ).toBe('trial');
  });

  it('identifies active paid subscribers', () => {
    expect(
      classifyCustomerSubscriptionState({
        ...baseInfo,
        entitlements: {
          active: {
            [REVENUECAT_ENTITLEMENT_ID]: {
              identifier: REVENUECAT_ENTITLEMENT_ID,
              isActive: true,
              periodType: 'NORMAL',
              willRenew: true,
              expirationDate: '2030-01-01T00:00:00Z',
            },
          },
          all: {},
        },
        activeSubscriptions: ['clutch_pro_monthly_v2'],
      }).status,
    ).toBe('subscribed');
  });

  it('identifies cancelled subscriptions that remain active until expiration', () => {
    expect(
      classifyCustomerSubscriptionState({
        ...baseInfo,
        entitlements: {
          active: {
            [REVENUECAT_ENTITLEMENT_ID]: {
              identifier: REVENUECAT_ENTITLEMENT_ID,
              isActive: true,
              periodType: 'NORMAL',
              willRenew: false,
              unsubscribeDetectedAt: '2026-06-01T00:00:00Z',
              expirationDate: '2030-01-01T00:00:00Z',
            },
          },
          all: {},
        },
        activeSubscriptions: ['clutch_pro_monthly_v2'],
      }).status,
    ).toBe('cancelled');
  });

  it('identifies expired subscribers from purchase history', () => {
    expect(
      classifyCustomerSubscriptionState({
        ...baseInfo,
        allPurchasedProductIdentifiers: ['clutch_pro_monthly_v2'],
        allExpirationDates: {
          clutch_pro_monthly_v2: '2020-01-01T00:00:00Z',
        },
      }).status,
    ).toBe('expired');
  });

  it('identifies restored access during restore flows without changing gating rules', () => {
    const state = classifyCustomerSubscriptionState(
      {
        ...baseInfo,
        entitlements: {
          active: {
            [REVENUECAT_ENTITLEMENT_ID]: {
              identifier: REVENUECAT_ENTITLEMENT_ID,
              isActive: true,
              periodType: 'NORMAL',
              willRenew: true,
              expirationDate: '2030-01-01T00:00:00Z',
            },
          },
          all: {},
        },
        activeSubscriptions: ['clutch_pro_monthly_v2'],
      },
      { restored: true },
    );

    expect(state.status).toBe('restored');
    expect(state.hasPremiumAccess).toBe(true);
  });

  it('identifies users with no active or historical subscription as unsubscribed', () => {
    expect(classifyCustomerSubscriptionState(baseInfo).status).toBe('unsubscribed');
  });
});
