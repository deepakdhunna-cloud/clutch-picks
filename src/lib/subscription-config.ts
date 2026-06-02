/**
 * RELEASE-CRITICAL PAYWALL CONFIGURATION.
 *
 * Do not change RevenueCat identifiers, displayed price, or trial copy without
 * running `bun run verify:paywall` and the paywall regression tests. These
 * values must match RevenueCat, App Store Connect, and Google Play Console.
 */

export const REVENUECAT_PRODUCT_IDS = {
  proMonthly: 'clutch_pro_monthly_v2',
} as const;

export const REVENUECAT_PACKAGE_IDS = {
  monthly: '$rc_monthly',
} as const;

export const REVENUECAT_ENTITLEMENT_IDS = {
  pro: 'Clutch Picks Pro',
} as const;

export const REVENUECAT_OFFERING_IDS = {
  // The SDK uses the RevenueCat dashboard's current offering for launch.
  current: 'current',
} as const;

export const PAYWALL_COPY = {
  monthlyPrice: '$6.99',
  shortPrice: '$6.99/mo',
  trialDays: 3,
  hasThreeDayTrial: true,
  primaryTrialCta: 'Start 3-Day Free Trial',
  proProductName: 'Clutch Picks Pro',
  onboardingDisclosure: '3-day free trial for eligible users, then $6.99/mo.',
  trialDisclosure: (priceWithMonthlyPeriod: string) =>
    `Eligible users receive a 3-day free trial, then ${priceWithMonthlyPeriod}. App Store confirms final terms before purchase.`,
  recurringDisclosure: (priceWithMonthlyPeriod: string) =>
    `Subscription renews monthly at ${priceWithMonthlyPeriod}. App Store confirms final terms before purchase.`,
} as const;

export const REVENUECAT_CUSTOM_ATTRIBUTES = {
  clutchUserId: 'clutch_user_id',
  clutchEmail: 'clutch_email',
  clutchDisplayName: 'clutch_display_name',
} as const;
