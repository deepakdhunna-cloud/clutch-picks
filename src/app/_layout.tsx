import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useNavigationContainerRef } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from '@/lib/useColorScheme';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { useSession, sessionBootstrapReady } from '@/lib/auth/use-session';
import { View, AppState, Platform } from 'react-native';
import { useEffect, useState, useCallback, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { SplashProvider, useSplash } from '@/lib/splash-context';
import { SubscriptionProvider } from '@/lib/subscription-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotificationRegistration, useNotificationNavigation } from '@/hooks/useNotifications';
import { useRevenueCatIdentity } from '@/hooks/useRevenueCatIdentity';
import { useFonts, BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { VT323_400Regular } from '@expo-google-fonts/vt323';
import { Orbitron_700Bold } from '@expo-google-fonts/orbitron';
import { useLiveScores } from '@/hooks/useLiveScores';
import { guardedResetTo } from '@/lib/navigation-guard';
import { Image as ExpoImage } from 'expo-image';
import { api } from '@/lib/api/api';
import { prepareHomeGamesFirstPaint } from '@/lib/home-games-first-paint';
import { HOME_GAMES_CACHE_KEY, selectPersistableHomeGames } from '@/lib/home-games-cache';


enableScreens(true);

export const unstable_settings = {
  initialRouteName: 'welcome',
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
      // SSE + polling handle freshness — don't refetch all queries on every tab switch
      refetchOnWindowFocus: false,
      // Refetch when network reconnects
      refetchOnReconnect: true,
      // Keep retrying failed requests
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      // Default stale time - can be overridden per query
      staleTime: 30000, // 30 seconds — prevents excessive refetches on tab switches
      // Cache time before garbage collection
      gcTime: 10 * 60 * 1000, // 10 minutes
      // Enable structural sharing to reduce unnecessary re-renders
      structuralSharing: true,
      // Keep showing the previous data while refetching so screens never flash empty
      // on focus/param changes — improves perceived speed without changing visuals.
      placeholderData: (previousData: unknown) => previousData,
    },
  },
});

function RootLayoutNav({
  colorScheme,
  fontsReady,
}: {
  colorScheme: 'light' | 'dark' | null | undefined;
  fontsReady: boolean;
}) {
  const { data: session, isLoading } = useSession();
  const router = useRouter();
  const segments = useSegments();
  // Root navigation container ref — used to dispatch a true stack reset on
  // auth-state transitions so Welcome/onboarding can never remain beneath Home
  // in the native back stack (otherwise an iOS edge back-swipe pops back to it).
  const navigationRef = useNavigationContainerRef();
  const [appIsReady, setAppIsReady] = useState(false);
  const [sessionBootstrapDone, setSessionBootstrapDone] = useState(false);
  const { markAnimationComplete, splashAnimationComplete } = useSplash();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  // Wait for the persisted session snapshot to be read from AsyncStorage before
  // allowing the auth redirect logic to run. Without this, on a cold launch the
  // session query starts with no initialData, sees no user, and fires a redirect
  // to /welcome before the snapshot resolves — causing a brief sign-out flash.
  useEffect(() => {
    sessionBootstrapReady.then(() => setSessionBootstrapDone(true)).catch(() => setSessionBootstrapDone(true));
  }, []);

  useRevenueCatIdentity(session?.user);

  // Warm the disk/memory cache for the user's avatar as soon as the session is
  // known, so Profile / Edit Profile render the avatar instantly with no flash.
  const sessionAvatarUri = (session?.user as { image?: string | null } | undefined)?.image ?? null;
  useEffect(() => {
    if (sessionAvatarUri) {
      ExpoImage.prefetch(sessionAvatarUri, 'memory-disk').catch(() => {});
    }
  }, [sessionAvatarUri]);

  // Register push notifications when user is signed in and permission exists.
  useNotificationRegistration(session?.user?.id);
  useNotificationNavigation(router);

  // Re-check onboarding flag ONLY on auth-state transitions:
  //   - Initial mount
  //   - Sign-in (was anonymous, now has a user)
  //   - Sign-out (had a user, now anonymous)
  // Within an authenticated session, RC purchases trigger session
  // refreshes that change session.user.id internals — we must NOT
  // re-read on those, because the flag write from completing onboarding
  // hasn't necessarily landed yet.
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentId = session?.user?.id ?? null;
    const prevId = prevUserIdRef.current;
    let cancelled = false;

    const isFirstRun = prevId === undefined;
    const wasSignedOut = prevId === null && currentId !== null;
    const wasSignedIn = prevId !== null && currentId === null;

    if (isFirstRun || wasSignedOut || wasSignedIn) {
      setOnboardingChecked(false);
      AsyncStorage.getItem('clutch_onboarding_complete').then((val) => {
        if (cancelled) return;
        setOnboardingDone(val === 'true');
        setOnboardingChecked(true);
      }).catch(() => {
        if (cancelled) return;
        setOnboardingDone(false);
        setOnboardingChecked(true);
      });
    }

    prevUserIdRef.current = currentId;

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  // Configure focus manager for React Query - refetch when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (Platform.OS !== 'web') {
        focusManager.setFocused(status === 'active');
      }
    });
    return () => subscription.remove();
  }, []);

  const segment = segments[0];
  const hasUser = Boolean(session?.user);

  // ── Startup games prefetch ────────────────────────────────────────────────
  // Fire the /api/games fetch immediately once the session is confirmed so the
  // data is already in the React Query cache by the time the splash exits.
  // The home tab's useGames hook will find the cache warm and render instantly
  // with current data instead of showing 0 or stale content.
  // Only fires when the user is signed in and session is settled.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!hasUser || isLoading) return;
    // Only prefetch if the cache is empty — don’t stomp a warm cache.
    if (queryClient.getQueryData(['games'])) return;
    void queryClient.prefetchQuery({
      queryKey: ['games'],
      queryFn: async () => {
        const games = prepareHomeGamesFirstPaint(
          await api.get<import('@/types/sports').GameWithPrediction[]>('/api/games'),
        );
        if (games.length > 0) {
          void AsyncStorage.setItem(
            HOME_GAMES_CACHE_KEY,
            JSON.stringify(selectPersistableHomeGames(games)),
          ).catch(() => {});
        }
        return games;
      },
      staleTime: 30000,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUser, isLoading]);
  const inAuthGroup =
    segment === 'sign-in' ||
    segment === 'sign-up' ||
    segment === 'verify-otp' ||
    segment === 'welcome' ||
    segment === 'onboarding';
  const inPublicGroup = segment === 'privacy-policy' || segment === 'terms';
  const shouldRedirect =
    !isLoading &&
    onboardingChecked &&
    (
      (hasUser && inAuthGroup && segment !== 'onboarding') ||
      (!hasUser && !inAuthGroup && !inPublicGroup)
    );
  const appFlowLoading = !sessionBootstrapDone || isLoading || !onboardingChecked || shouldRedirect;

  // Mark app as ready and hide native splash — AnimatedSplash takes over from here.
  // We also wait for the session bootstrap so the auth redirect logic has the
  // persisted snapshot available on the very first frame, preventing a sign-out flash.
  useEffect(() => {
    if (fontsReady && sessionBootstrapDone) {
      setAppIsReady(true);
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsReady, sessionBootstrapDone]);

  // Handle auth state changes and redirect accordingly
  useEffect(() => {
    if (isLoading || !onboardingChecked) return;

    if (hasUser && inAuthGroup && segment !== 'onboarding') {
      // Check if onboarding is complete — if not, send to onboarding first.
      // Use guardedResetTo so welcome/sign-in/onboarding are flushed from the
      // native back stack; otherwise an iOS edge back-swipe on Home could pop
      // back to Welcome and re-trigger onboarding.
      if (!onboardingDone) {
        guardedResetTo(router, '/onboarding', { navigationRef });
      } else {
        guardedResetTo(router, '/(tabs)', { navigationRef });
      }
    } else if (!hasUser && !inAuthGroup && !inPublicGroup) {
      guardedResetTo(router, '/welcome', { navigationRef });
    }
  }, [hasUser, isLoading, onboardingChecked, onboardingDone, segment, inAuthGroup, inPublicGroup, router, navigationRef]);

  // Callback when splash animation completes
  const handleAnimationComplete = useCallback(() => {
    markAnimationComplete();
  }, [markAnimationComplete]);

  // Show animated splash while loading
  if (!appIsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000' }} />
    );
  }

  return (
    <AnimatedSplash
      isLoading={appFlowLoading}
      onAnimationComplete={handleAnimationComplete}
    >
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {splashAnimationComplete && session?.user ? <LiveScoreSync /> : null}
        <Stack screenOptions={{ headerShown: false, animation: 'ios_from_right', animationDuration: 200, gestureEnabled: true, fullScreenGestureEnabled: false }}>
          <Stack.Screen name="welcome" options={{ freezeOnBlur: true, gestureEnabled: false }} />
          <Stack.Screen name="sign-in" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="sign-up" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="verify-otp" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="(tabs)" options={{ freezeOnBlur: false, gestureEnabled: false, fullScreenGestureEnabled: false }} />
          <Stack.Screen name="game/[id]" options={{ freezeOnBlur: false, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="sport/[sport]" options={{ freezeOnBlur: true, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="edit-profile" options={{ freezeOnBlur: true, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="privacy-policy" options={{ freezeOnBlur: true, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="terms" options={{ freezeOnBlur: true, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="settings" options={{ freezeOnBlur: true, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="notifications-settings" options={{ freezeOnBlur: true, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="game-analysis" options={{ freezeOnBlur: true, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false, freezeOnBlur: true }} />
          <Stack.Screen name="profile-setup" options={{ headerShown: false, gestureEnabled: false, freezeOnBlur: true }} />
          <Stack.Screen name="model-accuracy" options={{ freezeOnBlur: true, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="confidence-explained" options={{ freezeOnBlur: false, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="search-explore" options={{ freezeOnBlur: true, animation: 'fade' }} />
          <Stack.Screen name="picks-history" options={{ freezeOnBlur: true, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="confidence-tiers" options={{ freezeOnBlur: false, fullScreenGestureEnabled: true }} />
          <Stack.Screen name="live-games" options={{ freezeOnBlur: true, gestureEnabled: false, animation: 'slide_from_right', animationDuration: 200 }} />
          <Stack.Screen name="paywall" options={{ presentation: 'modal', freezeOnBlur: true, animation: 'slide_from_bottom', animationDuration: 250 }} />
        </Stack>
      </ThemeProvider>
    </AnimatedSplash>
  );
}

function LiveScoreSync() {
  useLiveScores({ trackState: false });
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    BebasNeue_400Regular,
    VT323_400Regular,
    Orbitron_700Bold,
  });
  const fontsReady = fontsLoaded || Boolean(fontError);


  return (
    <QueryClientProvider client={queryClient}>
      <SubscriptionProvider>
        <SplashProvider>
          <ErrorBoundary>
            <GestureHandlerRootView style={{ flex: 1 }}>
              {/* initialWindowMetrics supplies the safe-area insets synchronously on
                  the very first frame, so screens never paint under the status bar
                  and then jump down once the inset resolves. */}
              <SafeAreaProvider initialMetrics={initialWindowMetrics}>
                <StatusBar style="light" hidden={false} />
                <RootLayoutNav colorScheme={colorScheme} fontsReady={fontsReady} />
              </SafeAreaProvider>
            </GestureHandlerRootView>
          </ErrorBoundary>
        </SplashProvider>
      </SubscriptionProvider>
    </QueryClientProvider>
  );
}
