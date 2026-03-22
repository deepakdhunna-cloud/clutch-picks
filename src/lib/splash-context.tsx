import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface SplashContextType {
  // Whether the splash animation has completed
  splashAnimationComplete: boolean;
  // Function to mark the animation as complete
  markAnimationComplete: () => void;
  // Whether the header logo should be hidden (during splash animation)
  shouldHideHeaderLogo: boolean;
}

const SplashContext = createContext<SplashContextType | undefined>(undefined);

export function SplashProvider({ children }: { children: ReactNode }) {
  const [splashAnimationComplete, setSplashAnimationComplete] = useState(false);

  const markAnimationComplete = useCallback(() => {
    setSplashAnimationComplete(true);
  }, []);

  // Header logo should be hidden until the splash animation is complete
  const shouldHideHeaderLogo = !splashAnimationComplete;

  return (
    <SplashContext.Provider
      value={{
        splashAnimationComplete,
        markAnimationComplete,
        shouldHideHeaderLogo,
      }}
    >
      {children}
    </SplashContext.Provider>
  );
}

export function useSplash() {
  const context = useContext(SplashContext);
  if (context === undefined) {
    throw new Error('useSplash must be used within a SplashProvider');
  }
  return context;
}
