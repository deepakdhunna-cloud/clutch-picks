import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
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
  streak: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  gameLive: true,
  pickResult: true,
  predictionShift: true,
  bigGame: true,
  streak: true,
};

// Map notification data.type to preference key
const TYPE_TO_PREF: Record<string, string> = {
  game_live: 'gameLive',
  pick_resolved: 'pickResult',
  pick_result: 'pickResult',
  winner_flip: 'predictionShift',
  big_game: 'bigGame',
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
): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs));
  try {
    await api.put('/api/notifications/preferences', prefs);
  } catch (error) {
    if (__DEV__) console.log('[Notifications] Failed to sync preferences:', error);
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

  useEffect(() => {
    if (!userId) {
      registeredUserId.current = null;
      return;
    }
    if (registeredUserId.current === userId) return;

    (async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return;
      const registered = await registerDeviceForPushNotifications(false);
      if (registered) {
        registeredUserId.current = userId;
      }
    })();
  }, [userId]);
}

/**
 * Hook to handle notification taps — navigates to the relevant screen.
 * Pass router from expo-router.
 */
export function useNotificationNavigation(router: any) {
  useEffect(() => {
    let isMounted = true;

    const openFromNotification = (notification: Notifications.Notification) => {
      if (!isMounted) return;
      const data = notification.request.content.data;
      if (data?.gameId) {
        router.push(`/game/${String(data.gameId)}`);
      } else if (data?.screen === 'picks') {
        router.push('/(tabs)/clutch-picks');
      } else if (data?.screen === 'profile') {
        router.push('/(tabs)/profile');
      }
    };

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response?.notification) {
          openFromNotification(response.notification);
        }
      })
      .catch(() => {});

    // Handle notification tap when app is opened from background
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromNotification(response.notification);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [router]);
}
