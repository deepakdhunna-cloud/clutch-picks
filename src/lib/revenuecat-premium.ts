export const REVENUECAT_ENTITLEMENT_ID = 'Clutch Picks Pro';

type CustomerInfoLike = {
  entitlements?: {
    active?: Record<string, unknown> | null;
  } | null;
  activeSubscriptions?: string[] | null;
};

export function customerInfoHasPremiumAccess(customerInfo: CustomerInfoLike): boolean {
  const activeEntitlements = customerInfo.entitlements?.active ?? {};

  if (activeEntitlements[REVENUECAT_ENTITLEMENT_ID]) {
    return true;
  }

  if (Object.keys(activeEntitlements).length > 0) {
    return true;
  }

  return (customerInfo.activeSubscriptions?.length ?? 0) > 0;
}
