import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api/api';

export const NOTIFICATION_PREFS_KEY = 'clutch_notif_prefs';
const PUSH_TOKEN_STORAGE_KEY = 'clutch_expo_push_token';

export type NotificationPreferences = {
  gameLive: boolean;
  pickResult: boolean;
  predictionShift: boolean;
  bigGame: boolean;
  gameSpotlight: boolean;
  underdog: boolean;
  streak: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  gameLive: true,
  pickResult: true,
  predictionShift: true,
  bigGame: true,
  gameSpotlight: true,
  underdog: true,
  streak: true,
};

// Map notification data.type to preference key
const TYPE_TO_PREF: Record<string, string> = {
  game_live: 'gameLive',
  pick_resolved: 'pickResult',
  pick_result: 'pickResult',
  winner_flip: 'predictionShift',
  big_game: 'bigGame',
  game_spotlight: 'gameSpotlight',
  underdog_alert: 'underdog',
  streak: 'streak',
};

// Configure how notifications appear when app is in foreground
// Checks user preferences before showing
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const type = (notification.request.content.data as any)?.type as string | undefined;
    if (type) {
      const prefKey = TYPE_TO_PREF[type];
      if (prefKey) {
        try {
          const raw = await AsyncStorage.getItem(NOTIFICATION_PREFS_KEY);
          if (raw) {
            const prefs = JSON.parse(raw);
            if (prefs[prefKey] === false) {
              return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false };
            }
          }
        } catch {}
      }
    }
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  let prefs = DEFAULT_NOTIFICATION_PREFS;
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (raw) {
      prefs = { ...prefs, ...JSON.parse(raw) };
    }
  } catch {}

  try {
    const serverPrefs = await api.get<NotificationPreferences>('/api/notifications/preferences');
    prefs = { ...prefs, ...serverPrefs };
    await AsyncStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs));
  } catch {}

  return prefs;
}

export async function saveNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<boolean> {
  await AsyncStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs));
  try {
    await api.put('/api/notifications/preferences', prefs);
    return true;
  } catch (error) {
    if (__DEV__) console.log('[Notifications] Failed to sync preferences:', error);
    return false;
  }
}

async function registerForPushNotifications(
  requestPermission: boolean,
): Promise<string | null> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    if (__DEV__) console.log('[Notifications] Not a physical device, skipping');
    return null;
  }

  try {
    // Android 13+ requires a notification channel before the permission prompt/token flow.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request if not granted
    if (existingStatus !== 'granted') {
      if (!requestPermission) return null;
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      if (__DEV__) console.log('[Notifications] Permission not granted');
      return null;
    }

    // Get the Expo push token
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      if (__DEV__) console.log('[Notifications] EAS project ID missing');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    if (__DEV__) console.log('[Notifications] Expo push token acquired');

    return tokenData.data;
  } catch (error) {
    if (__DEV__) console.log('[Notifications] Registration error:', error);
    return null;
  }
}

export async function registerDeviceForPushNotifications(
  requestPermission = true,
): Promise<boolean> {
  const token = await registerForPushNotifications(requestPermission);
  if (!token) return false;

  try {
    await api.post('/api/notifications/register', {
      token,
      platform: Platform.OS,
    });
    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    if (__DEV__) console.log('[Notifications] Token saved to backend');
    return true;
  } catch (error) {
    if (__DEV__) console.log('[Notifications] Failed to save token:', error);
    return false;
  }
}

export async function unregisterCurrentDeviceForPushNotifications(): Promise<void> {
  let token: string | null = null;
  try {
    token = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {}

  if (!token) {
    token = await registerForPushNotifications(false);
  }
  if (!token) return;

  try {
    await api.post('/api/notifications/unregister', { token });
  } catch (error) {
    if (__DEV__) console.log('[Notifications] Failed to unregister token:', error);
  } finally {
    await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY).catch(() => {});
  }
}

/**
 * Hook to register push notifications and save token to backend.
 * Call this once in the root layout after user is authenticated.
 * Safe to call multiple times — deduplicates via the unique token constraint.
 */
export function useNotificationRegistration(userId?: string | null) {
  const registeredUserId = useRef<string | null>(null);
  const refreshInFlight = useRef<boolean>(false);
  const lastRefreshAt = useRef<number>(0);

  useEffect(() => {
    if (!userId) {
      registeredUserId.current = null;
      return;
    }

    const refreshRegistration = async (force = false) => {
      const now = Date.now();
      if (refreshInFlight.current) return;
      if (!force && now - lastRefreshAt.current < 60_000) return;
      refreshInFlight.current = true;
      lastRefreshAt.current = now;
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return;
        const registered = await registerDeviceForPushNotifications(false);
        if (registered) {
          registeredUserId.current = userId;
        }
      } finally {
        refreshInFlight.current = false;
      }
    };

    if (registeredUserId.current !== userId) {
      void refreshRegistration(true);
    }

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshRegistration();
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, [userId]);
}

/**
 * Hook to handle notification taps — navigates to the relevant screen.
 * Pass router from expo-router.
 */
export function useNotificationNavigation(router: any) {
  const handledResponseKey = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const openFromNotification = (notification: Notifications.Notification) => {
      if (!isMounted) return;
      const data = notification.request.content.data;
      if (data?.gameId) {
        router.push({ pathname: '/game/[id]', params: { id: String(data.gameId) } });
      } else if (data?.screen === 'picks') {
        router.push('/(tabs)/clutch-picks');
      } else if (data?.screen === 'profile') {
        router.push('/(tabs)/profile');
      }
    };

    const openFromResponse = (response: Notifications.NotificationResponse | null | undefined) => {
      if (!response?.notification) return;
      const notification = response.notification;
      const data = notification.request.content.data;
      const key = [
        notification.request.identifier,
        data?.gameId ? `game:${String(data.gameId)}` : '',
        data?.screen ? `screen:${String(data.screen)}` : '',
      ].filter(Boolean).join('|');
      if (key && handledResponseKey.current === key) return;
      handledResponseKey.current = key || null;
      openFromNotification(notification);
    };

    Notifications.getLastNotificationResponseAsync()
      .then(openFromResponse)
      .catch(() => {});

    // Handle notification tap when app is opened from background
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromResponse(response);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [router]);
}
