import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from '@/lib/useColorScheme';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableScreens } from 'react-native-screens';
import { useSession } from '@/lib/auth/use-session';
import { View, AppState, Platform } from 'react-native';
import { useEffect, useState, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { SplashProvider, useSplash } from '@/lib/splash-context';
import { SubscriptionProvider } from '@/lib/subscription-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import AsyncStorage from '@react-native-async-storage/async-storage';

enableScreens(true);

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore errors if splash screen is already hidden
});

// Configure online manager for React Query - refetch when network reconnects
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
});

// Configure React Query with optimized settings for real-time data
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Refetch on window focus for fresh data
      refetchOnWindowFocus: true,
      // Refetch when network reconnects
      refetchOnReconnect: true,
      // Keep retrying failed requests
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      // Default stale time - can be overridden per query
      staleTime: 10000, // 10 seconds
      // Cache time before garbage collection
      gcTime: 10 * 60 * 1000, // 10 minutes
      // Enable structural sharing to reduce unnecessary re-renders
      structuralSharing: true,
    },
  },
});

// Prefetch games immediately on app load — don't wait for auth or splash
// This runs at module level so it fires before any component renders
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
queryClient.prefetchQuery({
  queryKey: ['games'],
  queryFn: async () => {
    const response = await fetch(`${BACKEND_URL}/api/games`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) return [];
    const json = await response.json();
    return json.data ?? [];
  },
  staleTime: 10000,
});

function RootLayoutNav({ colorScheme }: { colorScheme: 'light' | 'dark' | null | undefined }) {
  const { data: session, isLoading } = useSession();
  const router = useRouter();
  const segments = useSegments();
  const [appIsReady, setAppIsReady] = useState(false);
  const { markAnimationComplete } = useSplash();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  // Pre-check onboarding status once on mount
  useEffect(() => {
    AsyncStorage.getItem('clutch_onboarding_complete').then((val) => {
      setOnboardingDone(val === 'true');
      setOnboardingChecked(true);
    });
  }, []);

  // Configure focus manager for React Query - refetch when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (Platform.OS !== 'web') {
        focusManager.setFocused(status === 'active');
      }
    });
    return () => subscription.remove();
  }, []);

  // Mark app as ready and hide native splash — AnimatedSplash takes over from here
  useEffect(() => {
    if (!isLoading) {
      setAppIsReady(true);
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isLoading]);

  // Handle auth state changes and redirect accordingly
  useEffect(() => {
    if (isLoading || !onboardingChecked) return;

    const inAuthGroup = segments[0] === 'sign-in' || segments[0] === 'sign-up' || segments[0] === 'verify-otp' || segments[0] === 'welcome' || segments[0] === 'onboarding';
    const inPublicGroup = segments[0] === 'privacy-policy' || segments[0] === 'terms';

    if (session?.user && inAuthGroup && segments[0] !== 'onboarding') {
      // Always go to home — mark onboarding done for returning users
      if (!onboardingDone) {
        AsyncStorage.setItem('clutch_onboarding_complete', 'true').catch(() => {});
      }
      router.replace('/(tabs)');
    } else if (!session?.user && !inAuthGroup && !inPublicGroup) {
      router.replace('/welcome');
    }
  }, [session, isLoading, segments, onboardingChecked, onboardingDone]);

  // Callback when splash animation completes
  const handleAnimationComplete = useCallback(() => {
    markAnimationComplete();
  }, [markAnimationComplete]);

  // Show animated splash while loading
  if (isLoading || !appIsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000' }} />
    );
  }

  return (
    <AnimatedSplash
      isLoading={false}
      onAnimationComplete={handleAnimationComplete}
    >
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false, animation: 'ios_from_right', animationDuration: 200, gestureEnabled: true, fullScreenGestureEnabled: true }}>
          <Stack.Screen name="welcome" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="sign-in" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="sign-up" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="verify-otp" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="(tabs)" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="game/[id]" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="sport/[sport]" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="user/[id]" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="followers/[userId]" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="edit-profile" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="privacy-policy" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="terms" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="settings" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="game-analysis" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false, freezeOnBlur: true }} />
          <Stack.Screen name="profile-setup" options={{ headerShown: false, gestureEnabled: false, freezeOnBlur: true }} />
          <Stack.Screen name="model-accuracy" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="paywall" options={{ presentation: 'modal', freezeOnBlur: true, animation: 'slide_from_bottom', animationDuration: 250 }} />
        </Stack>
      </ThemeProvider>
    </AnimatedSplash>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <QueryClientProvider client={queryClient}>
      <SubscriptionProvider>
        <SplashProvider>
          <ErrorBoundary>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <StatusBar style="light" />
              <RootLayoutNav colorScheme={colorScheme} />
            </GestureHandlerRootView>
          </ErrorBoundary>
        </SplashProvider>
      </SubscriptionProvider>
    </QueryClientProvider>
  );
}
