import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PAYWALL_COPY,
  REVENUECAT_ENTITLEMENT_IDS,
  REVENUECAT_OFFERING_IDS,
  REVENUECAT_PACKAGE_IDS,
  REVENUECAT_PRODUCT_IDS,
} from '../src/lib/subscription-config';

const failures: string[] = [];

function assertPaywallGuard(condition: boolean, message: string) {
  if (!condition) failures.push(message);
}

function readRepoFile(filePath: string): string {
  return readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

assertPaywallGuard(REVENUECAT_PRODUCT_IDS.proMonthly === 'clutch_pro_monthly_v2', 'RevenueCat monthly product id changed.');
assertPaywallGuard(REVENUECAT_PACKAGE_IDS.monthly === '$rc_monthly', 'RevenueCat monthly package id changed.');
assertPaywallGuard(REVENUECAT_ENTITLEMENT_IDS.pro === 'Clutch Picks Pro', 'RevenueCat Pro entitlement id changed.');
assertPaywallGuard(REVENUECAT_OFFERING_IDS.current === 'current', 'RevenueCat current offering selector changed.');
assertPaywallGuard(PAYWALL_COPY.monthlyPrice === '$6.99', 'Paywall monthly price must display $6.99.');
assertPaywallGuard(PAYWALL_COPY.trialDays === 3, 'Paywall trial must remain 3 days.');
assertPaywallGuard(PAYWALL_COPY.primaryTrialCta === 'Start 3-Day Free Trial', 'Paywall primary CTA copy changed.');
assertPaywallGuard(PAYWALL_COPY.onboardingDisclosure.includes('$6.99/mo'), 'Onboarding Pro disclosure must mention $6.99/mo.');
assertPaywallGuard(PAYWALL_COPY.onboardingDisclosure.includes('3-day free trial'), 'Onboarding Pro disclosure must mention the 3-day free trial.');
assertPaywallGuard(PAYWALL_COPY.trialDisclosure('$6.99/month').includes('3-day free trial'), 'Paywall trial disclosure no longer mentions the 3-day free trial.');

const paywallSource = readRepoFile('src/app/paywall.tsx');
const onboardingSource = readRepoFile('src/app/onboarding.tsx');
const revenueCatClientSource = readRepoFile('src/lib/revenuecatClient.ts');
const subscriptionContextSource = readRepoFile('src/lib/subscription-context.tsx');
const revenueCatPremiumSource = readRepoFile('src/lib/revenuecat-premium.ts');

assertPaywallGuard(paywallSource.includes("from '@/lib/subscription-config'"), 'Paywall screen must import centralized subscription config.');
assertPaywallGuard(paywallSource.includes('PAYWALL_COPY.primaryTrialCta'), 'Paywall CTA must use centralized trial CTA copy.');
assertPaywallGuard(paywallSource.includes('PAYWALL_COPY.trialDisclosure'), 'Paywall disclosure must use centralized trial copy.');
assertPaywallGuard(paywallSource.includes('REVENUECAT_PACKAGE_IDS.monthly'), 'Paywall package lookup must use centralized package id.');
assertPaywallGuard(paywallSource.includes('checkSubscription({ restored: true })'), 'Paywall restore flow must classify restored subscribers.');
assertPaywallGuard(!paywallSource.includes("'Start 3-Day Free Trial'"), 'Paywall screen must not hardcode the trial CTA.');
assertPaywallGuard(!paywallSource.includes("'$6.99'"), 'Paywall screen must not hardcode the launch price.');
assertPaywallGuard(onboardingSource.includes('PAYWALL_COPY.onboardingDisclosure'), 'Onboarding Pro entry must use centralized trial/price copy.');
assertPaywallGuard(!onboardingSource.includes('Price shown before purchase.'), 'Onboarding Pro entry must not use stale local price copy.');

assertPaywallGuard(revenueCatClientSource.includes('Purchases.setAttributes'), 'RevenueCat identity sync must set subscriber attributes.');
assertPaywallGuard(revenueCatClientSource.includes('REVENUECAT_CUSTOM_ATTRIBUTES.clutchUserId'), 'RevenueCat identity sync must include Clutch user id.');
assertPaywallGuard(revenueCatClientSource.includes('Purchases.setEmail(input.email)'), 'RevenueCat identity sync must set email when available.');
assertPaywallGuard(revenueCatClientSource.includes('Purchases.setDisplayName(input.displayName)'), 'RevenueCat identity sync must set display name when available.');

assertPaywallGuard(revenueCatPremiumSource.includes('activeSubscriptions?.some(isConfiguredProduct)'), 'Premium gating must only accept the configured product id.');
assertPaywallGuard(!revenueCatPremiumSource.includes('activeSubscriptions?.length'), 'Premium gating must not accept any active subscription as Pro.');

assertPaywallGuard(subscriptionContextSource.includes('classifyCustomerSubscriptionState'), 'Subscription context must classify CustomerInfo state.');
assertPaywallGuard(subscriptionContextSource.includes('getCustomerInfo()'), 'Subscription context must read RevenueCat CustomerInfo.');

if (failures.length > 0) {
  console.error('Paywall verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Paywall verification passed: RevenueCat identifiers, $6.99 price, 3-day trial copy, identity sync, and CustomerInfo gating are intact.');
