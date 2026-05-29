type RevenueCatPlatform = 'ios' | 'android' | 'web' | string;

type RevenueCatKeyConfig = {
  platform: RevenueCatPlatform;
  appleKey?: string;
  googleKey?: string;
  testKey?: string;
};

export function selectRevenueCatApiKey({
  platform,
  appleKey,
  googleKey,
  testKey,
}: RevenueCatKeyConfig): string | undefined {
  if (platform === 'web') return undefined;
  if (platform === 'ios') return appleKey ?? testKey;
  if (platform === 'android') return googleKey ?? testKey;

  return testKey;
}
