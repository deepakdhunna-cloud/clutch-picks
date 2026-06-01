import fs from 'fs';
import path from 'path';

const paywallSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/paywall.tsx'),
  'utf8',
);

describe('paywall accessibility', () => {
  it('exposes the close and primary purchase controls as named buttons', () => {
    expect(paywallSource).toContain('accessibilityLabel="Close paywall"');
    expect(paywallSource).toContain('width: 44');
    expect(paywallSource).toContain('height: 44');
    expect(paywallSource).toContain('accessibilityLabel={visibleLabel}');
    expect(paywallSource).toContain('accessibilityState={{ disabled: loading, busy: loading }}');
  });

  it('names promo code controls and loading states', () => {
    expect(paywallSource).toContain('accessibilityLabel="Enter promo code"');
    expect(paywallSource).toContain('accessibilityLabel="Promo code"');
    expect(paywallSource).toContain('accessibilityLabel="Clear promo code"');
    const clearPromoControl = paywallSource.slice(
      paywallSource.indexOf('accessibilityLabel="Clear promo code"'),
      paywallSource.indexOf('accessibilityLabel="Apply promo code"'),
    );
    expect(clearPromoControl).toContain('minWidth: 44');
    expect(clearPromoControl).toContain('minHeight: 44');
    expect(paywallSource).toContain('accessibilityLabel="Apply promo code"');
    expect(paywallSource).toContain('accessibilityState={{ disabled: !promoCode.trim() || promoLoading, busy: promoLoading }}');
  });

  it('exposes restore and legal links as reachable buttons', () => {
    expect(paywallSource).toContain('accessibilityLabel="Restore purchases"');
    expect(paywallSource).toContain('accessibilityState={{ disabled: isRestoring, busy: isRestoring }}');
    expect(paywallSource).toContain('accessibilityLabel="Manage subscription"');
    expect(paywallSource).toContain('accessibilityLabel="Terms of service"');
    expect(paywallSource).toContain('accessibilityLabel="Privacy policy"');
  });
});
