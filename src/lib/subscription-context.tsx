import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import {
  addCustomerInfoListener,
  customerInfoHasPremium,
  hasEntitlement,
  isRevenueCatEnabled,
  REVENUECAT_ENTITLEMENT_ID,
} from './revenuecatClient';

interface SubscriptionState {
  isPremium: boolean;
  isLoading: boolean;
  checkSubscription: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionState>({
  isPremium: false,
  isLoading: true,
  checkSubscription: async () => {},
});

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const checkSubscription = useCallback(async () => {
    if (!isRevenueCatEnabled()) {
      setIsPremium(false);
      setIsLoading(false);
      return;
    }

    try {
      const result = await hasEntitlement(REVENUECAT_ENTITLEMENT_ID);
      if (result.ok) {
        setIsPremium(result.data);
      } else {
        setIsPremium(false);
      }
    } catch (error) {
      if (__DEV__) console.log('[Subscription] Error checking subscription:', error);
      setIsPremium(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  useEffect(() => {
    if (!isRevenueCatEnabled()) return;

    const removeListener = addCustomerInfoListener((customerInfo) => {
      setIsPremium(customerInfoHasPremium(customerInfo));
      setIsLoading(false);
    });

    return removeListener;
  }, []);

  useEffect(() => {
    if (!isRevenueCatEnabled() || Platform.OS === 'web') return;

    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        checkSubscription();
      }
    });

    return () => subscription.remove();
  }, [checkSubscription]);

  return (
    <SubscriptionContext.Provider value={{ isPremium, isLoading, checkSubscription }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => useContext(SubscriptionContext);
