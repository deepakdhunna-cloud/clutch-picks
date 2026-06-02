import {
  PAYWALL_COPY,
  REVENUECAT_ENTITLEMENT_IDS,
  REVENUECAT_OFFERING_IDS,
  REVENUECAT_PACKAGE_IDS,
  REVENUECAT_PRODUCT_IDS,
} from '../subscription-config';

describe('release-critical subscription configuration', () => {
  it('keeps RevenueCat identifiers centralized and launch-ready', () => {
    expect(REVENUECAT_PRODUCT_IDS.proMonthly).toBe('clutch_pro_monthly_v2');
    expect(REVENUECAT_PACKAGE_IDS.monthly).toBe('$rc_monthly');
    expect(REVENUECAT_ENTITLEMENT_IDS.pro).toBe('Clutch Picks Pro');
    expect(REVENUECAT_OFFERING_IDS.current).toBe('current');
  });

  it('keeps paywall trial and pricing copy fixed for submission', () => {
    expect(PAYWALL_COPY.monthlyPrice).toBe('$6.99');
    expect(PAYWALL_COPY.trialDays).toBe(3);
    expect(PAYWALL_COPY.primaryTrialCta).toBe('Start 3-Day Free Trial');
    expect(PAYWALL_COPY.shortPrice).toBe('$6.99/mo');
    expect(PAYWALL_COPY.onboardingDisclosure).toContain('$6.99/mo');
    expect(PAYWALL_COPY.onboardingDisclosure).toContain('3-day free trial');
    expect(PAYWALL_COPY.trialDisclosure('$6.99/month')).toContain('3-day free trial');
    expect(PAYWALL_COPY.trialDisclosure('$6.99/month')).toContain('$6.99/month');
  });
});
