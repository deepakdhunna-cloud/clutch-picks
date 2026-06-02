import fs from 'fs';
import path from 'path';

const revenueCatClientSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/revenuecatClient.ts'),
  'utf8',
);

describe('RevenueCat client configuration', () => {
  it('keeps Apple product pricing as the default even in local development', () => {
    expect(revenueCatClientSource).toContain('const useRevenueCatTestStore =');
    expect(revenueCatClientSource).toContain("process.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE === 'true'");
    expect(revenueCatClientSource).toContain('preferTestKey: useRevenueCatTestStore');
    expect(revenueCatClientSource).not.toContain('preferTestKey: __DEV__');
  });

  it('syncs available app identity into RevenueCat subscriber attributes', () => {
    expect(revenueCatClientSource).toContain('Purchases.setAttributes');
    expect(revenueCatClientSource).toContain('REVENUECAT_CUSTOM_ATTRIBUTES.clutchUserId');
    expect(revenueCatClientSource).toContain('REVENUECAT_CUSTOM_ATTRIBUTES.clutchEmail');
    expect(revenueCatClientSource).toContain('REVENUECAT_CUSTOM_ATTRIBUTES.clutchDisplayName');
    expect(revenueCatClientSource).toContain('Purchases.setEmail(input.email)');
    expect(revenueCatClientSource).toContain('Purchases.setDisplayName(input.displayName)');
  });
});
