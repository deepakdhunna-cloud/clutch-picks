import { useEffect, useRef } from 'react';
import { Platform, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api/api';

// Map notification data.type to preference key
const TYPE_TO_PREF: Record<string, string> = {
  game_live: 'gameLive',
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
          const raw = await AsyncStorage.getItem('clutch_notif_prefs');
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

async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    if (__DEV__) console.log('[Notifications] Not a physical device, skipping');
    return null;
  }

  try {
    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request if not granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      if (__DEV__) console.log('[Notifications] Permission not granted');
      return null;
    }

    // Get the Expo push token
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    if (__DEV__) console.log('[Notifications] Token:', tokenData.data);

    // Android notification channel setup
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    return tokenData.data;
  } catch (error) {
    if (__DEV__) console.log('[Notifications] Registration error:', error);
    return null;
  }
}

/**
 * Hook to register push notifications and save token to backend.
 * Call this once in the root layout after user is authenticated.
 * Safe to call multiple times — deduplicates via the unique token constraint.
 */
export function useNotificationRegistration() {
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;

    (async () => {
      const token = await registerForPushNotifications();
      if (!token) return;

      try {
        await api.post('/api/notifications/register', {
          token,
          platform: Platform.OS,
        });
        if (__DEV__) console.log('[Notifications] Token saved to backend');
      } catch (error) {
        if (__DEV__) console.log('[Notifications] Failed to save token:', error);
      }
    })();
  }, []);
}

/**
 * Hook to handle notification taps — navigates to the relevant screen.
 * Pass router from expo-router.
 */
export function useNotificationNavigation(router: any) {
  useEffect(() => {
    // Handle notification tap when app is opened from background
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.gameId) {
        router.push(`/game/${data.gameId}`);
      } else if (data?.screen === 'picks') {
        router.push('/(tabs)/clutch-picks');
      } else if (data?.screen === 'profile') {
        router.push('/(tabs)/profile');
      }
    });

    return () => subscription.remove();
  }, [router]);
}
