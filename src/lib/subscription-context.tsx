import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { hasEntitlement, getCustomerInfo, isRevenueCatEnabled } from './revenuecatClient';

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
      const result = await hasEntitlement('Clutch Picks Pro');
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

  return (
    <SubscriptionContext.Provider value={{ isPremium, isLoading, checkSubscription }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => useContext(SubscriptionContext);
