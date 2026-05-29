import { selectRevenueCatApiKey } from '../revenuecat-key-selection';

describe('RevenueCat key selection', () => {
  it('uses the platform store key when production-parity config is available', () => {
    const config = {
      appleKey: 'apple-production-key',
      googleKey: 'google-production-key',
      testKey: 'shared-test-key',
    };

    expect(selectRevenueCatApiKey({ platform: 'ios', ...config })).toBe('apple-production-key');
    expect(selectRevenueCatApiKey({ platform: 'android', ...config })).toBe('google-production-key');
  });

  it('falls back to the shared test key when a platform key is missing', () => {
    expect(selectRevenueCatApiKey({ platform: 'ios', testKey: 'shared-test-key' })).toBe('shared-test-key');
    expect(selectRevenueCatApiKey({ platform: 'android', testKey: 'shared-test-key' })).toBe('shared-test-key');
  });

  it('does not configure RevenueCat on web', () => {
    expect(
      selectRevenueCatApiKey({
        platform: 'web',
        appleKey: 'apple-production-key',
        googleKey: 'google-production-key',
        testKey: 'shared-test-key',
      }),
    ).toBeUndefined();
  });
});
