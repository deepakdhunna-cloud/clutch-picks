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
    },
  },
});

// Prefetch games immediately on app load — don't wait for auth or splash.
// This runs at module level so it fires before any component renders.
// Must mirror the per-date fetch in useGames.ts (the /api/games aggregator
// drops today's non-LIVE games + EPL; date endpoints return the full slate).
const GAMES_CACHE_KEY = 'rq_cache_games_v1';
const GAMES_CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const GAMES_CACHE_WRITE_DEBOUNCE_MS = 8000;
let pendingGamesCacheData: unknown[] | null = null;
let gamesCacheWriteTimer: ReturnType<typeof setTimeout> | null = null;

function isPersistableGamesArray(data: unknown): data is unknown[] {
  return Array.isArray(data) && data.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const game = item as {
      id?: unknown;
      gameTime?: unknown;
      homeTeam?: unknown;
      awayTeam?: unknown;
    };
    return (
      typeof game.id === 'string' &&
      typeof game.gameTime === 'string' &&
      !!game.homeTeam &&
      typeof game.homeTeam === 'object' &&
      !!game.awayTeam &&
      typeof game.awayTeam === 'object'
    );
  });
}

function scheduleGamesCacheWrite(data: unknown[]) {
  pendingGamesCacheData = data;
  if (gamesCacheWriteTimer) return;

  gamesCacheWriteTimer = setTimeout(() => {
    const snapshot = pendingGamesCacheData;
    pendingGamesCacheData = null;
    gamesCacheWriteTimer = null;
    if (!snapshot || snapshot.length === 0) return;
    AsyncStorage.setItem(
      GAMES_CACHE_KEY,
      JSON.stringify({ data: snapshot, timestamp: Date.now() })
    ).catch(() => {});
  }, GAMES_CACHE_WRITE_DEBOUNCE_MS);
}

// Hydrate games cache from disk synchronously-ish so cold opens show last-known
// games instantly while the network fetch runs in the background.
AsyncStorage.getItem(GAMES_CACHE_KEY)
  .then((raw) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { data: unknown; timestamp: number };
      if (!isPersistableGamesArray(parsed.data) || parsed.data.length === 0) return;
      if (Date.now() - parsed.timestamp > GAMES_CACHE_MAX_AGE_MS) return;
      // Only seed if a network fetch hasn't already populated the cache
      if (!queryClient.getQueryData(['games'])) {
        queryClient.setQueryData(['games'], parsed.data);
      }
    } catch {
      // Ignore corrupt cache
    }
  })
  .catch(() => {});

// Persist games cache to disk whenever it updates
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated') return;
  if (event.action.type !== 'success' || event.action.manual) return;
  const key = event.query.queryKey;
  if (!Array.isArray(key) || key.length !== 1 || key[0] !== 'games') return;
  const data = event.query.state.data;
  if (!isPersistableGamesArray(data) || data.length === 0) return;
  scheduleGamesCacheWrite(data);
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
  const [appIsReady, setAppIsReady] = useState(false);
  const { markAnimationComplete, splashAnimationComplete } = useSplash();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useRevenueCatIdentity(session?.user);

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
  const appFlowLoading = isLoading || !onboardingChecked || shouldRedirect;

  // Mark app as ready and hide native splash — AnimatedSplash takes over from here.
  useEffect(() => {
    if (fontsReady) {
      setAppIsReady(true);
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsReady]);

  // Handle auth state changes and redirect accordingly
  useEffect(() => {
    if (isLoading || !onboardingChecked) return;

    if (hasUser && inAuthGroup && segment !== 'onboarding') {
      // Check if onboarding is complete — if not, send to onboarding first
      if (!onboardingDone) {
        router.replace('/onboarding');
      } else {
        router.replace('/(tabs)');
      }
    } else if (!hasUser && !inAuthGroup && !inPublicGroup) {
      router.replace('/welcome');
    }
  }, [hasUser, isLoading, onboardingChecked, onboardingDone, segment, inAuthGroup, inPublicGroup, router]);

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
          <Stack.Screen name="(tabs)" options={{ freezeOnBlur: true, gestureEnabled: false, fullScreenGestureEnabled: false }} />
          <Stack.Screen name="game/[id]" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="sport/[sport]" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="user/[id]" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="followers/[userId]" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="edit-profile" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="privacy-policy" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="terms" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="settings" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="notifications-settings" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="game-analysis" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false, freezeOnBlur: true }} />
          <Stack.Screen name="profile-setup" options={{ headerShown: false, gestureEnabled: false, freezeOnBlur: true }} />
          <Stack.Screen name="model-accuracy" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="confidence-explained" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="search-explore" options={{ freezeOnBlur: true, animation: 'fade' }} />
          <Stack.Screen name="picks-history" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="confidence-tiers" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="live-games" options={{ freezeOnBlur: true, animation: 'slide_from_right', animationDuration: 200 }} />
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
              <StatusBar style="light" />
              <RootLayoutNav colorScheme={colorScheme} fontsReady={fontsReady} />
            </GestureHandlerRootView>
          </ErrorBoundary>
        </SplashProvider>
      </SubscriptionProvider>
    </QueryClientProvider>
  );
}
