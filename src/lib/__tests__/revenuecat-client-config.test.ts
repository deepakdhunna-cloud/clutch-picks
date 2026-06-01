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
});
