import { View, Text, ScrollView, Linking, Platform } from 'react-native';
import { HapticPressable } from '@/components/HapticPressable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowLeft, Lock, Shield, FileText, HelpCircle, ChevronRight, Globe, Trash2, CreditCard, LogOut, Crown, RefreshCw, Gift, Bell } from 'lucide-react-native';
import { Modal, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { useSubscription } from '@/lib/subscription-context';
import { isRevenueCatEnabled, logoutUser, restorePurchases, getRevenueCatAppUserId, invalidateCustomerInfoCache } from '@/lib/revenuecatClient';
import { api } from '@/lib/api/api';
import { ConfirmModal } from '@/components/ConfirmModal';
import { FeedbackModal } from '@/components/FeedbackModal';
import { unregisterCurrentDeviceForPushNotifications } from '@/hooks/useNotifications';
import { getAppVersionLabel } from '@/lib/app-version';

interface SettingItemProps {
  icon: any;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  showArrow?: boolean;
  rightElement?: React.ReactNode;
  isDestructive?: boolean;
  disabled?: boolean;
}

function SettingItem({ icon: Icon, title, subtitle, onPress, showArrow = true, rightElement, isDestructive, disabled }: SettingItemProps) {
  return (
    <HapticPressable hapticStyle="none"
      onPress={() => {
        if (disabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : (disabled ? 0.5 : 1),
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.04)',
      })}
    >
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
            backgroundColor: isDestructive ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.06)',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 14,
          }}
        >
          <Icon size={18} color={isDestructive ? '#EF4444' : 'rgba(255,255,255,0.5)'} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: isDestructive ? '#EF4444' : '#FFFFFF', fontSize: 15, fontWeight: '600' }}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rightElement ?? (showArrow ? <ChevronRight size={16} color="rgba(255,255,255,0.2)" /> : null)}
      </View>
    </HapticPressable>
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

const AUTH_STORAGE_KEYS = [
  'vibecode_cookie',
  'vibecode_session_data',
  'vibecode_session_token',
  'vibecode_refresh_token',
  'vibecode_bearer_token',
  'clutchpicks_cookie',
  'clutchpicks_session_data',
  'clutchpicks_session_token',
  'clutchpicks_refresh_token',
  'clutchpicks_bearer_token',
] as const;

type FeedbackState = {
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'info';
};

export default function SettingsScreen() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const appVersionLabel = getAppVersionLabel();
  const [promoModalVisible, setPromoModalVisible] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const { isPremium, isLoading: isSubscriptionLoading, checkSubscription } = useSubscription();
  const invalidateSession = useInvalidateSession();

  const handleRedeemPromo = async (code: string) => {
    if (!code.trim()) return;
    setPromoLoading(true);
    try {
      const rcAppUserId = await getRevenueCatAppUserId();
      const rcUserId = rcAppUserId.ok ? rcAppUserId.data : undefined;
      const result = await api.post<{ success: boolean; message: string }>('/api/promo/redeem', { code: code.trim(), rcUserId });
      await invalidateCustomerInfoCache();
      await checkSubscription();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFeedback({
        title: 'Code Applied',
        message: result.message ?? 'Lifetime access granted.',
        variant: 'success',
      });
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFeedback({
        title: 'Invalid Code',
        message: error?.message || 'This code could not be applied.',
        variant: 'error',
      });
    } finally {
      setPromoLoading(false);
      setPromoInput('');
      setPromoModalVisible(false);
    }
  };

  const handlePromoPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPromoModalVisible(true);
  };

  const handleRestorePurchases = async () => {
    try {
      const result = await restorePurchases();
      if (result.ok) {
        await checkSubscription();
        const hasActive = Object.keys(result.data.entitlements.active || {}).length > 0;
        if (hasActive) {
          setFeedback({
            title: 'Restored',
            message: 'Your subscription has been restored.',
            variant: 'success',
          });
        } else {
          setFeedback({
            title: 'No Subscription Found',
            message: 'No previous subscription was found for this account.',
            variant: 'info',
          });
        }
      } else {
        setFeedback({
          title: 'No Subscription Found',
          message: 'No previous subscription was found for this account.',
          variant: 'info',
        });
      }
    } catch {
      setFeedback({
        title: 'Restore Failed',
        message: 'Please try again later.',
        variant: 'error',
      });
    }
  };

  const handleTermsPress = () => {
    router.push('/terms');
  };

  const handlePrivacyPress = () => {
    router.push('/privacy-policy');
  };

  const handleManageSubscription = () => {
    if (isPremium) {
      // Open subscription management in App Store / Play Store
      if (Platform.OS === 'ios') {
        Linking.openURL('https://apps.apple.com/account/subscriptions');
      } else {
        Linking.openURL('https://play.google.com/store/account/subscriptions');
      }
    } else {
      // Show paywall for non-subscribers
      router.push('/paywall');
    }
  };

  const handleSignOut = async () => {
    if (__DEV__) console.log('[Settings] Sign out button tapped!');
    setIsSigningOut(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await unregisterCurrentDeviceForPushNotifications();

      // Sign out from Better Auth
      try {
        if (__DEV__) console.log('[Settings] Calling authClient.signOut()...');
        await authClient.signOut();
        if (__DEV__) console.log('[Settings] authClient.signOut() completed');
      } catch (e) {
        if (__DEV__) console.log('[Settings] Auth signOut error (ignored):', e);
      }

      // Sign out from RevenueCat if enabled
      if (isRevenueCatEnabled()) {
        try {
          await logoutUser();
        } catch (e) {
          if (__DEV__) console.log('[Settings] RevenueCat logout error (ignored):', e);
        }
      }

      // Clear auth cookies from SecureStore
      for (const key of AUTH_STORAGE_KEYS) {
        try {
          await SecureStore.deleteItemAsync(key);
        } catch (e) {
          // ignore
        }
      }
      if (__DEV__) console.log('[Settings] SecureStore cleared');

      // Invalidate session cache
      if (__DEV__) console.log('[Settings] Invalidating session cache...');
      await invalidateSession();
      if (__DEV__) console.log('[Settings] Session invalidated');

      // Navigate to welcome
      if (__DEV__) console.log('[Settings] Navigating to welcome...');
      router.replace('/welcome');
    } catch (error) {
      if (__DEV__) console.log('[Settings] Sign out error:', error);
      setFeedback({
        title: 'Sign Out Failed',
        message: 'Failed to sign out. Please try again.',
        variant: 'error',
      });
      setIsSigningOut(false);
    }
  };

  const handleDeleteAccount = () => {
    setDeleteConfirmVisible(true);
  };

  const handleConfirmDeleteAccount = async () => {
    setDeleteConfirmVisible(false);
    try {
      await unregisterCurrentDeviceForPushNotifications();
      await api.delete('/api/profile/delete-account');
      if (isRevenueCatEnabled()) {
        await logoutUser();
      }
      for (const key of AUTH_STORAGE_KEYS) {
        await SecureStore.deleteItemAsync(key).catch(() => {});
      }
      // Clear ALL stale local state so re-signin shows onboarding fresh.
      await AsyncStorage.removeItem('clutch_onboarding_complete').catch(() => {});
      await AsyncStorage.removeItem('clutch_onboarding_skip_profile').catch(() => {});
      await invalidateSession();
      router.replace('/welcome');
    } catch (error) {
      setFeedback({
        title: 'Delete Failed',
        message: 'Failed to delete account. Please try again or contact support.',
        variant: 'error',
      });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <FeedbackModal
          visible={!!feedback}
          title={feedback?.title ?? ''}
          message={feedback?.message ?? ''}
          variant={feedback?.variant}
          onDismiss={() => setFeedback(null)}
        />
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingVertical: 16,
          }}
        >
          <HapticPressable hapticStyle="none"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: 'rgba(255,255,255,0.06)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
            }}
          >
            <ArrowLeft size={20} color="#FFFFFF" />
          </HapticPressable>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginLeft: 16 }}>
            Settings
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Subscription */}
          {isRevenueCatEnabled() && (
            <Animated.View entering={FadeInDown.delay(100).duration(400)}>
              <SettingSection title="SUBSCRIPTION">
                <SettingItem
                  icon={Crown}
                  title={isPremium ? "Premium Active" : "Upgrade to Premium"}
                  subtitle={isPremium ? "Manage your subscription" : "Unlock all features"}
                  onPress={handleManageSubscription}
                />
                <SettingItem
                  icon={RefreshCw}
                  title="Restore Purchases"
                  subtitle="Restore a previous subscription"
                  onPress={handleRestorePurchases}
                />
                <SettingItem
                  icon={Gift}
                  title="Redeem Promo Code"
                  subtitle="Enter a code to unlock access"
                  onPress={handlePromoPress}
                />
                {isPremium ? (
                  <SettingItem
                    icon={CreditCard}
                    title="Cancel Subscription"
                    subtitle="Manage billing in App Store"
                    onPress={() => {
                      if (Platform.OS === 'ios') {
                        Linking.openURL('https://apps.apple.com/account/subscriptions');
                      } else {
                        Linking.openURL('https://play.google.com/store/account/subscriptions');
                      }
                    }}
                  />
                ) : null}
              </SettingSection>
            </Animated.View>
          )}

          {/* Model Performance */}
          <Animated.View entering={FadeInDown.delay(150).duration(400)}>
            <SettingSection title="AI MODEL">
              <SettingItem
                icon={RefreshCw}
                title="Model Performance"
                subtitle="Accuracy, calibration, and drift"
                onPress={() => router.push('/model-accuracy')}
              />
            </SettingSection>
          </Animated.View>

          {/* Notifications */}
          <Animated.View entering={FadeInDown.delay(175).duration(400)}>
            <SettingSection title="NOTIFICATIONS">
              <SettingItem
                icon={Bell}
                title="Notifications"
                subtitle="Manage alerts and preferences"
                onPress={() => router.push('/notifications-settings')}
              />
            </SettingSection>
          </Animated.View>

          {/* Privacy & Security */}
          <Animated.View entering={FadeInDown.delay(225).duration(400)}>
            <SettingSection title="PRIVACY & SECURITY">
              <SettingItem
                icon={Lock}
                title="Privacy Policy"
                subtitle="How we handle your data"
                onPress={handlePrivacyPress}
              />
              <SettingItem
                icon={Shield}
                title="Data & Security"
                subtitle="Your information is encrypted"
                showArrow={false}
                rightElement={
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, backgroundColor: 'rgba(74,222,128,0.1)' }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: '#4ADE80' }}>SECURE</Text>
                  </View>
                }
              />
            </SettingSection>
          </Animated.View>

          {/* Legal */}
          <Animated.View entering={FadeInDown.delay(250).duration(400)}>
            <SettingSection title="LEGAL">
              <SettingItem
                icon={FileText}
                title="Terms of Service"
                onPress={handleTermsPress}
              />
              <SettingItem
                icon={Globe}
                title="Open Source Licenses"
                subtitle="Built with open source libraries"
                showArrow={false}
              />
            </SettingSection>
          </Animated.View>

          {/* Support */}
          <Animated.View entering={FadeInDown.delay(300).duration(400)}>
            <SettingSection title="SUPPORT">
              <SettingItem
                icon={HelpCircle}
                title="Help & Support"
                subtitle="Get help or send feedback"
                onPress={() => Linking.openURL('mailto:support@clutchpicksapp.com')}
              />
              <SettingItem
                icon={RefreshCw}
                title="Replay Tutorial"
                subtitle="Walk through the app intro again"
                onPress={async () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  await AsyncStorage.setItem('clutch_onboarding_complete', 'false');
                  await AsyncStorage.setItem('clutch_onboarding_skip_profile', 'true');
                  router.replace('/onboarding');
                }}
              />
            </SettingSection>
          </Animated.View>

          {/* Danger Zone */}
          <Animated.View entering={FadeInDown.delay(350).duration(400)}>
            <SettingSection title="ACCOUNT">
              <SettingItem
                icon={LogOut}
                title={isSigningOut ? "Signing Out..." : "Sign Out"}
                subtitle="Log out of your account"
                onPress={handleSignOut}
                isDestructive
                disabled={isSigningOut}
              />
              <SettingItem
                icon={Trash2}
                title="Delete Account"
                subtitle="Permanently delete your account and data"
                onPress={handleDeleteAccount}
                isDestructive
                showArrow={false}
              />
            </SettingSection>
          </Animated.View>

          {/* Version + Disclaimer */}
          <View style={{ alignItems: 'center', marginTop: 20, paddingHorizontal: 32 }}>
            <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
              {appVersionLabel}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.15)', fontSize: 10, textAlign: 'center', marginTop: 8, lineHeight: 15 }}>
              Predictions are for entertainment and informational purposes only. Clutch Picks does not facilitate, encourage, or enable gambling. Past prediction accuracy does not guarantee future results.
            </Text>
          </View>
        </ScrollView>

        <Modal visible={promoModalVisible} transparent animationType="fade" onRequestClose={() => setPromoModalVisible(false)}>
          <HapticPressable hapticStyle="none" onPress={() => setPromoModalVisible(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
            <HapticPressable hapticStyle="none" onPress={() => {}} style={{ width: '85%', backgroundColor: '#0A0E14', borderRadius: 18, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 }}>Promo Code</Text>
              <Text style={{ fontSize: 13, color: '#6B7C94', marginBottom: 16 }}>Enter your code</Text>
              <TextInput
                value={promoInput}
                onChangeText={(t) => setPromoInput(t.toUpperCase())}
                placeholder="CODE"
                placeholderTextColor="rgba(255,255,255,0.15)"
                autoCapitalize="characters"
                autoCorrect={false}
                style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 16, paddingVertical: 14, letterSpacing: 2, marginBottom: 16 }}
                keyboardAppearance="dark"
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <HapticPressable hapticStyle="none" onPress={() => { setPromoModalVisible(false); setPromoInput(''); }} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)' }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#6B7C94' }}>Cancel</Text>
                </HapticPressable>
                <HapticPressable hapticStyle="none" onPress={() => handleRedeemPromo(promoInput)} disabled={!promoInput.trim() || promoLoading} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#8B0A1F', opacity: !promoInput.trim() || promoLoading ? 0.5 : 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{promoLoading ? 'Redeeming...' : 'Redeem'}</Text>
                </HapticPressable>
              </View>
            </HapticPressable>
          </HapticPressable>
        </Modal>

        <ConfirmModal
          visible={deleteConfirmVisible}
          title="Delete Account"
          message="This will permanently delete your account and all your data. This action cannot be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={handleConfirmDeleteAccount}
          onCancel={() => setDeleteConfirmVisible(false)}
        />
      </SafeAreaView>
    </View>
  );
}
