import {
  REVENUECAT_ENTITLEMENT_IDS,
  REVENUECAT_PRODUCT_IDS,
} from './subscription-config';

export const REVENUECAT_ENTITLEMENT_ID = REVENUECAT_ENTITLEMENT_IDS.pro;

type EntitlementInfoLike = {
  identifier?: string | null;
  isActive?: boolean | null;
  willRenew?: boolean | null;
  periodType?: string | null;
  expirationDate?: string | null;
  productIdentifier?: string | null;
  unsubscribeDetectedAt?: string | null;
  billingIssueDetectedAt?: string | null;
  isSandbox?: boolean | null;
};

type SubscriptionInfoLike = {
  productIdentifier?: string | null;
  expiresDate?: string | null;
  unsubscribeDetectedAt?: string | null;
  billingIssuesDetectedAt?: string | null;
  periodType?: string | null;
  isActive?: boolean | null;
  willRenew?: boolean | null;
  isSandbox?: boolean | null;
};

type CustomerInfoLike = {
  entitlements?: {
    active?: Record<string, EntitlementInfoLike | unknown> | null;
    all?: Record<string, EntitlementInfoLike | unknown> | null;
  } | null;
  activeSubscriptions?: string[] | null;
  allPurchasedProductIdentifiers?: string[] | null;
  allExpirationDates?: Record<string, string | null> | null;
  latestExpirationDate?: string | null;
  managementURL?: string | null;
  subscriptionsByProductIdentifier?: Record<string, SubscriptionInfoLike | undefined> | null;
};

export type RevenueCatSubscriptionStatus =
  | 'trial'
  | 'subscribed'
  | 'cancelled'
  | 'restored'
  | 'expired'
  | 'unsubscribed';

export type RevenueCatSubscriptionState = {
  status: RevenueCatSubscriptionStatus;
  hasPremiumAccess: boolean;
  entitlementId: string | null;
  productId: string | null;
  expiresAt: string | null;
  willRenew: boolean | null;
  managementURL: string | null;
  billingIssueDetectedAt: string | null;
  isSandbox: boolean | null;
};

type ClassifySubscriptionOptions = {
  restored?: boolean;
};

function asEntitlementInfo(value: unknown): EntitlementInfoLike {
  return (value ?? {}) as EntitlementInfoLike;
}

function isConfiguredProduct(productId?: string | null): boolean {
  return productId === REVENUECAT_PRODUCT_IDS.proMonthly;
}

function findActiveEntitlement(customerInfo: CustomerInfoLike): EntitlementInfoLike | null {
  const activeEntitlements = customerInfo.entitlements?.active ?? {};
  const configured = activeEntitlements[REVENUECAT_ENTITLEMENT_ID];
  return configured ? asEntitlementInfo(configured) : null;
}

function getSubscriptionInfo(
  customerInfo: CustomerInfoLike,
  productId: string | null,
): SubscriptionInfoLike | null {
  if (!productId) return null;
  return customerInfo.subscriptionsByProductIdentifier?.[productId] ?? null;
}

function expirationIsInPast(isoDate?: string | null): boolean {
  if (!isoDate) return false;
  const time = Date.parse(isoDate);
  return Number.isFinite(time) && time <= Date.now();
}

export function customerInfoHasPremiumAccess(customerInfo: CustomerInfoLike): boolean {
  const activeEntitlement = findActiveEntitlement(customerInfo);

  if (activeEntitlement) {
    return true;
  }

  return customerInfo.activeSubscriptions?.some(isConfiguredProduct) ?? false;
}

export function classifyCustomerSubscriptionState(
  customerInfo: CustomerInfoLike,
  options: ClassifySubscriptionOptions = {},
): RevenueCatSubscriptionState {
  const activeEntitlement = findActiveEntitlement(customerInfo);
  const configuredActiveSubscription = customerInfo.activeSubscriptions?.find(isConfiguredProduct) ?? null;
  const activeProductId =
    activeEntitlement?.productIdentifier ??
    configuredActiveSubscription ??
    null;
  const activeSubscription = getSubscriptionInfo(customerInfo, activeProductId);
  const hasPremiumAccess = customerInfoHasPremiumAccess(customerInfo);

  if (hasPremiumAccess) {
    const periodType = (
      activeEntitlement?.periodType ??
      activeSubscription?.periodType ??
      ''
    ).toUpperCase();
    const willRenew =
      activeEntitlement?.willRenew ??
      activeSubscription?.willRenew ??
      null;
    const unsubscribeDetectedAt =
      activeEntitlement?.unsubscribeDetectedAt ??
      activeSubscription?.unsubscribeDetectedAt ??
      null;
    const billingIssueDetectedAt =
      activeEntitlement?.billingIssueDetectedAt ??
      activeSubscription?.billingIssuesDetectedAt ??
      null;
    const status: RevenueCatSubscriptionStatus = options.restored
      ? 'restored'
      : periodType === 'TRIAL'
        ? 'trial'
        : willRenew === false || Boolean(unsubscribeDetectedAt)
          ? 'cancelled'
          : 'subscribed';

    return {
      status,
      hasPremiumAccess: true,
      entitlementId: activeEntitlement?.identifier ?? REVENUECAT_ENTITLEMENT_ID,
      productId: activeProductId,
      expiresAt:
        activeEntitlement?.expirationDate ??
        activeSubscription?.expiresDate ??
        null,
      willRenew,
      managementURL: customerInfo.managementURL ?? null,
      billingIssueDetectedAt,
      isSandbox:
        activeEntitlement?.isSandbox ??
        activeSubscription?.isSandbox ??
        null,
    };
  }

  const configuredExpiration = customerInfo.allExpirationDates?.[REVENUECAT_PRODUCT_IDS.proMonthly] ?? null;
  const hasConfiguredPurchase =
    customerInfo.allPurchasedProductIdentifiers?.some(isConfiguredProduct) ??
    Boolean(customerInfo.subscriptionsByProductIdentifier?.[REVENUECAT_PRODUCT_IDS.proMonthly]);
  const latestExpiration = configuredExpiration ?? customerInfo.latestExpirationDate ?? null;

  if (hasConfiguredPurchase || expirationIsInPast(latestExpiration)) {
    return {
      status: 'expired',
      hasPremiumAccess: false,
      entitlementId: REVENUECAT_ENTITLEMENT_ID,
      productId: REVENUECAT_PRODUCT_IDS.proMonthly,
      expiresAt: latestExpiration,
      willRenew: false,
      managementURL: customerInfo.managementURL ?? null,
      billingIssueDetectedAt:
        customerInfo.subscriptionsByProductIdentifier?.[REVENUECAT_PRODUCT_IDS.proMonthly]?.billingIssuesDetectedAt ??
        null,
      isSandbox:
        customerInfo.subscriptionsByProductIdentifier?.[REVENUECAT_PRODUCT_IDS.proMonthly]?.isSandbox ??
        null,
    };
  }

  return {
    status: 'unsubscribed',
    hasPremiumAccess: false,
    entitlementId: null,
    productId: null,
    expiresAt: null,
    willRenew: null,
    managementURL: customerInfo.managementURL ?? null,
    billingIssueDetectedAt: null,
    isSandbox: null,
  };
}
