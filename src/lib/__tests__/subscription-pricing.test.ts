import {
  PRO_MONTHLY_PRICE_FALLBACK,
  resolvePaywallPriceString,
} from '../subscription-pricing';

describe('subscription pricing display', () => {
  it('uses the canonical monthly price when RevenueCat test-store metadata is stale', () => {
    expect(
      resolvePaywallPriceString('$4.99', { useRevenueCatTestStore: true }),
    ).toBe(PRO_MONTHLY_PRICE_FALLBACK);
  });

  it('uses the canonical launch price even when store metadata disagrees', () => {
    expect(
      resolvePaywallPriceString('$7.49', { useRevenueCatTestStore: false }),
    ).toBe(PRO_MONTHLY_PRICE_FALLBACK);
  });

  it('falls back to the canonical monthly price when the store omits a price string', () => {
    expect(
      resolvePaywallPriceString('  ', { useRevenueCatTestStore: false }),
    ).toBe(PRO_MONTHLY_PRICE_FALLBACK);
  });
});
