export const PRO_MONTHLY_PRICE_FALLBACK = '$6.99';
export const PRO_MONTHLY_PRICE_COPY = `${PRO_MONTHLY_PRICE_FALLBACK}/mo`;
export const PRO_MONTHLY_HAS_THREE_DAY_TRIAL = true;

type ResolvePaywallPriceOptions = {
  useRevenueCatTestStore?: boolean;
};

export function resolvePaywallPriceString(
  storePriceString?: string | null,
  options: ResolvePaywallPriceOptions = {},
): string {
  if (options.useRevenueCatTestStore) {
    return PRO_MONTHLY_PRICE_FALLBACK;
  }

  return storePriceString?.trim() || PRO_MONTHLY_PRICE_FALLBACK;
}
