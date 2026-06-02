import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import type { CustomerInfo } from 'react-native-purchases';
import {
  addCustomerInfoListener,
  getCustomerInfo,
  isRevenueCatEnabled,
} from './revenuecatClient';
import {
  classifyCustomerSubscriptionState,
  type RevenueCatSubscriptionState,
  type RevenueCatSubscriptionStatus,
} from './revenuecat-premium';

type CheckSubscriptionOptions = {
  restored?: boolean;
};

interface SubscriptionState {
  isPremium: boolean;
  isLoading: boolean;
  status: RevenueCatSubscriptionStatus;
  customerInfo: CustomerInfo | null;
  checkSubscription: (options?: CheckSubscriptionOptions) => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionState>({
  isPremium: false,
  isLoading: true,
  status: 'unsubscribed',
  customerInfo: null,
  checkSubscription: async () => {},
});

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<RevenueCatSubscriptionStatus>('unsubscribed');
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);

  const applyCustomerInfo = useCallback((nextCustomerInfo: CustomerInfo, options?: CheckSubscriptionOptions) => {
    const subscriptionState: RevenueCatSubscriptionState = classifyCustomerSubscriptionState(nextCustomerInfo, options);
    setCustomerInfo(nextCustomerInfo);
    setStatus(subscriptionState.status);
    setIsPremium(subscriptionState.hasPremiumAccess);
    setIsLoading(false);
  }, []);

  const checkSubscription = useCallback(async (options?: CheckSubscriptionOptions) => {
    if (!isRevenueCatEnabled()) {
      setIsPremium(false);
      setStatus('unsubscribed');
      setCustomerInfo(null);
      setIsLoading(false);
      return;
    }

    try {
      const result = await getCustomerInfo();
      if (result.ok) {
        applyCustomerInfo(result.data, options);
      } else {
        setIsPremium(false);
        setStatus('unsubscribed');
        setCustomerInfo(null);
      }
    } catch {
      setIsPremium(false);
      setStatus('unsubscribed');
      setCustomerInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [applyCustomerInfo]);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  useEffect(() => {
    if (!isRevenueCatEnabled()) return;

    const removeListener = addCustomerInfoListener((customerInfo) => {
      applyCustomerInfo(customerInfo);
    });

    return removeListener;
  }, [applyCustomerInfo]);

  useEffect(() => {
    if (!isRevenueCatEnabled() || Platform.OS === 'web') return;

    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        checkSubscription();
      }
    });

    return () => subscription.remove();
  }, [checkSubscription]);

  const value = useMemo(
    () => ({ isPremium, isLoading, status, customerInfo, checkSubscription }),
    [checkSubscription, customerInfo, isLoading, isPremium, status],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => useContext(SubscriptionContext);
