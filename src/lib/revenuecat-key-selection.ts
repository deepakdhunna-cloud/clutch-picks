type RevenueCatPlatform = 'ios' | 'android' | 'web' | string;

type RevenueCatKeyConfig = {
  platform: RevenueCatPlatform;
  appleKey?: string;
  googleKey?: string;
  testKey?: string;
  preferTestKey?: boolean;
};

export function selectRevenueCatApiKey({
  platform,
  appleKey,
  googleKey,
  testKey,
  preferTestKey = false,
}: RevenueCatKeyConfig): string | undefined {
  if (platform === 'web') return undefined;
  if (preferTestKey && testKey) return testKey;
  if (platform === 'ios') return appleKey ?? testKey;
  if (platform === 'android') return googleKey ?? testKey;

  return testKey;
}
