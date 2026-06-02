import { PAYWALL_COPY } from './subscription-config';

export const PRO_MONTHLY_PRICE_FALLBACK = PAYWALL_COPY.monthlyPrice;
export const PRO_MONTHLY_PRICE_COPY = PAYWALL_COPY.shortPrice;
export const PRO_MONTHLY_HAS_THREE_DAY_TRIAL = PAYWALL_COPY.hasThreeDayTrial;

type ResolvePaywallPriceOptions = {
  useRevenueCatTestStore?: boolean;
};

export function resolvePaywallPriceString(
  storePriceString?: string | null,
  options: ResolvePaywallPriceOptions = {},
): string {
  void storePriceString;
  void options;
  return PRO_MONTHLY_PRICE_FALLBACK;
}
