import { View, Text, Pressable, ScrollView, Switch, type AccessibilityRole, type AccessibilityState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowLeft, Bell, Zap, TrendingUp, AlertTriangle, Activity } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useRef, useState, useEffect, useCallback } from 'react';
import { haptics } from '@/lib/haptics';
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPreferences,
  loadNotificationPreferences,
  registerDeviceForPushNotifications,
  saveNotificationPreferences,
} from '@/hooks/useNotifications';
import { guardedRouterBack } from '@/lib/navigation-guard';

interface SettingItemProps {
  icon: any;
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  onPress?: () => void;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
}

const NOTIFICATION_LABELS: Record<keyof NotificationPreferences, string> = {
  gameLive: 'Game Going Live notifications',
  pickResult: 'Pick Results notifications',
  predictionShift: 'Prediction Shifts notifications',
  bigGame: 'Big Game Alerts notifications',
  gameSpotlight: 'Game Spotlights notifications',
  underdog: 'Underdog Alerts notifications',
  streak: 'Win Streak Milestones notifications',
};

const NOTIFICATION_HINTS: Record<keyof NotificationPreferences, string> = {
  gameLive: 'When a game you picked starts',
  pickResult: 'Win or loss when your pick resolves',
  predictionShift: 'When the model changes its predicted winner',
  bigGame: 'High-confidence picks three hours before tip-off',
  gameSpotlight: 'Curated matchups and timely reasons to check the board',
  underdog: 'When the model finds a live upset path',
  streak: 'Celebrate five, seven, and ten correct picks in a row',
};

function SettingItem({
  icon: Icon,
  title,
  subtitle,
  rightElement,
  onPress,
  accessibilityRole,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
}: SettingItemProps) {
  const content = (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
    }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: 'rgba(255,255,255,0.06)',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        <Icon size={18} color="rgba(255,255,255,0.5)" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightElement}
    </View>
  );

  const containerStyle = {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  };

  if (onPress) {
    return (
      <Pressable
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={accessibilityState}
        disabled={accessibilityState?.disabled}
        onPress={onPress}
        style={({ pressed }) => [
          containerStyle,
          pressed ? { backgroundColor: 'rgba(255,255,255,0.04)' } : null,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={containerStyle}>
      {content}
    </View>
  );
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingHorizontal: 20 }}>
        <View style={{ width: 3, height: 12, borderRadius: 1.5, backgroundColor: '#7A9DB8' }} />
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }}>
          {title}
        </Text>
      </View>
      <View
        style={{
          marginHorizontal: 20,
          backgroundColor: 'rgba(20,20,25,0.95)',
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        {children}
      </View>
    </View>
  );
}

export default function NotificationsSettingsScreen() {
  const router = useRouter();

  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFS);
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const savingKeyRef = useRef<keyof NotificationPreferences | null>(null);

  useEffect(() => {
    loadNotificationPreferences().then(setNotifPrefs).catch(() => {});
  }, []);

  const toggleNotif = useCallback(async (key: keyof NotificationPreferences) => {
    if (savingKey || savingKeyRef.current) return;
    savingKeyRef.current = key;
    const previous = notifPrefs;
    const next = { ...previous, [key]: !previous[key] };
    setNotifPrefs(next);
    setSavingKey(key);
    setStatusMessage(null);
    haptics.selection();

    try {
      const pushRegistered = next[key]
        ? await registerDeviceForPushNotifications(true)
        : true;
      const prefsSaved = await saveNotificationPreferences(next);

      if (pushRegistered && prefsSaved) return;
      setNotifPrefs(previous);
      await saveNotificationPreferences(previous);
      setStatusMessage(pushRegistered
        ? 'Could not save that notification setting. Try again in a moment.'
        : 'Notifications were not enabled. Check device permissions and try again.');
      haptics.error();
    } catch {
      setNotifPrefs(previous);
      setStatusMessage('Could not save that notification setting. Try again in a moment.');
      haptics.error();
    } finally {
      savingKeyRef.current = null;
      setSavingKey(null);
    }
  }, [notifPrefs, savingKey]);

  const renderSwitch = useCallback((key: keyof NotificationPreferences) => (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no">
      <Switch
        accessible={false}
        importantForAccessibility="no"
        value={notifPrefs[key]}
        disabled={savingKey !== null}
        trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(122,157,184,0.4)' }}
        thumbColor={notifPrefs[key] ? '#7A9DB8' : 'rgba(255,255,255,0.3)'}
      />
    </View>
  ), [notifPrefs, savingKey]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingVertical: 16,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => {
              haptics.tap();
              guardedRouterBack(router);
            }}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: 'rgba(255,255,255,0.06)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
            }}
          >
            <ArrowLeft size={20} color="#FFFFFF" />
          </Pressable>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginLeft: 16 }}>
            Notifications
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {statusMessage ? (
            <Text style={{ marginHorizontal: 20, marginBottom: 14, color: '#FCA5A5', fontSize: 12, lineHeight: 18, fontWeight: '700' }}>
              {statusMessage}
            </Text>
          ) : null}
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <SettingSection title="ALERTS">
              <SettingItem
                icon={Activity}
                title="Game Going Live"
                subtitle="When a game you picked starts"
                accessibilityRole="switch"
                accessibilityLabel={NOTIFICATION_LABELS.gameLive}
                accessibilityHint={NOTIFICATION_HINTS.gameLive}
                accessibilityState={{ disabled: savingKey !== null, checked: notifPrefs.gameLive }}
                onPress={() => { void toggleNotif('gameLive'); }}
                rightElement={renderSwitch('gameLive')}
              />
              <SettingItem
                icon={Zap}
                title="Pick Results"
                subtitle="Win or loss when your pick resolves"
                accessibilityRole="switch"
                accessibilityLabel={NOTIFICATION_LABELS.pickResult}
                accessibilityHint={NOTIFICATION_HINTS.pickResult}
                accessibilityState={{ disabled: savingKey !== null, checked: notifPrefs.pickResult }}
                onPress={() => { void toggleNotif('pickResult'); }}
                rightElement={renderSwitch('pickResult')}
              />
              <SettingItem
                icon={AlertTriangle}
                title="Prediction Shifts"
                subtitle="When the model changes its predicted winner"
                accessibilityRole="switch"
                accessibilityLabel={NOTIFICATION_LABELS.predictionShift}
                accessibilityHint={NOTIFICATION_HINTS.predictionShift}
                accessibilityState={{ disabled: savingKey !== null, checked: notifPrefs.predictionShift }}
                onPress={() => { void toggleNotif('predictionShift'); }}
                rightElement={renderSwitch('predictionShift')}
              />
              <SettingItem
                icon={TrendingUp}
                title="Big Game Alerts"
                subtitle="High-confidence picks 3 hours before tip-off"
                accessibilityRole="switch"
                accessibilityLabel={NOTIFICATION_LABELS.bigGame}
                accessibilityHint={NOTIFICATION_HINTS.bigGame}
                accessibilityState={{ disabled: savingKey !== null, checked: notifPrefs.bigGame }}
                onPress={() => { void toggleNotif('bigGame'); }}
                rightElement={renderSwitch('bigGame')}
              />
              <SettingItem
                icon={Bell}
                title="Game Spotlights"
                subtitle="Curated matchups and timely reasons to check the board"
                accessibilityRole="switch"
                accessibilityLabel={NOTIFICATION_LABELS.gameSpotlight}
                accessibilityHint={NOTIFICATION_HINTS.gameSpotlight}
                accessibilityState={{ disabled: savingKey !== null, checked: notifPrefs.gameSpotlight }}
                onPress={() => { void toggleNotif('gameSpotlight'); }}
                rightElement={renderSwitch('gameSpotlight')}
              />
              <SettingItem
                icon={AlertTriangle}
                title="Underdog Alerts"
                subtitle="When the model finds a live upset path"
                accessibilityRole="switch"
                accessibilityLabel={NOTIFICATION_LABELS.underdog}
                accessibilityHint={NOTIFICATION_HINTS.underdog}
                accessibilityState={{ disabled: savingKey !== null, checked: notifPrefs.underdog }}
                onPress={() => { void toggleNotif('underdog'); }}
                rightElement={renderSwitch('underdog')}
              />
              <SettingItem
                icon={Bell}
                title="Win Streak Milestones"
                subtitle="Celebrate 5, 7, 10+ correct picks in a row"
                accessibilityRole="switch"
                accessibilityLabel={NOTIFICATION_LABELS.streak}
                accessibilityHint={NOTIFICATION_HINTS.streak}
                accessibilityState={{ disabled: savingKey !== null, checked: notifPrefs.streak }}
                onPress={() => { void toggleNotif('streak'); }}
                rightElement={renderSwitch('streak')}
              />
            </SettingSection>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
