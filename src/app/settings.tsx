import { View, Text, Pressable, ScrollView, Linking, Platform, ActivityIndicator, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowLeft, Lock, Shield, FileText, HelpCircle, ChevronRight, Globe, Trash2, CreditCard, LogOut, Crown, RefreshCw, Gift, Bell } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useRef, useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authClient } from '@/lib/auth/auth-client';
import { clearAuthStorage } from '@/lib/auth/auth-storage';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { useSubscription } from '@/lib/subscription-context';
import {
  isRevenueCatEnabled,
  logoutUser,
  restorePurchases,
  getRevenueCatAppUserId,
  invalidateCustomerInfoCache,
  customerInfoHasPremium,
} from '@/lib/revenuecatClient';
import { api } from '@/lib/api/api';
import { ConfirmModal } from '@/components/ConfirmModal';
import { FeedbackModal } from '@/components/FeedbackModal';
import { unregisterCurrentDeviceForPushNotifications } from '@/hooks/useNotifications';
import { getAppVersionLabel } from '@/lib/app-version';
import * as Updates from 'expo-updates';
import { claimInteractionLock } from '@/lib/interaction-guard';
import { guardedRouterBack, guardedRouterPush, guardedRouterReplace } from '@/lib/navigation-guard';

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
  const isActionable = typeof onPress === 'function';
  const accessibilityLabel = subtitle ? `${title}. ${subtitle}` : title;
  const baseContainerStyle = {
    opacity: disabled ? 0.5 : 1,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  };
  const rowContent = (
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
  );

  if (!isActionable) {
    return (
      <View
        accessible
        accessibilityLabel={accessibilityLabel}
        style={baseContainerStyle}
      >
        {rowContent}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => {
        if (!claimInteractionLock(`settings:${title}`, 700)) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => ({
        ...baseContainerStyle,
        opacity: pressed ? 0.7 : baseContainerStyle.opacity,
      })}
    >
      {rowContent}
    </Pressable>
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

type FeedbackState = {
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'info';
  actionLabel?: string;
  secondaryActionLabel?: string;
  onActionPress?: () => void;
  onSecondaryPress?: () => void;
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
  const signOutInFlightRef = useRef(false);
  const deleteInFlightRef = useRef(false);

  // ── TEMP runtime diagnostic (remove after debugging) ──────────────────────
  // Prints exactly what the running app sees: the resolved backend base URL
  // and the live result of GET /api/games (status + count, or the error).
  const baseForDiag = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '(undefined)').replace('https://', '');
  const [diag, setDiag] = useState<string>('probing…');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<any[]>('/api/games');
        const count = Array.isArray(res) ? res.length : (res == null ? 'null' : typeof res);
        if (!cancelled) setDiag(`games=${count}`);
      } catch (e: any) {
        if (!cancelled) setDiag(`ERR ${String(e?.message ?? e).slice(0, 70)}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const { isPremium, checkSubscription } = useSubscription();
  const invalidateSession = useInvalidateSession();

  const handleRedeemPromo = async (code: string) => {
    if (!code.trim() || promoLoading) return;
    setPromoLoading(true);
    try {
      const rcAppUserId = await getRevenueCatAppUserId();
      const rcUserId = rcAppUserId.ok ? rcAppUserId.data : undefined;
      const result = await api.post<{ success: boolean; message: string }>('/api/promo/redeem', { code: code.trim(), rcUserId });
      await invalidateCustomerInfoCache();
      await checkSubscription();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setFeedback({
        title: 'Code Applied',
        message: result.message ?? 'Lifetime access granted.',
        variant: 'success',
      });
    } catch (error: any) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
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
    if (promoLoading) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPromoModalVisible(true);
  };

  const openSupportEmail = async () => {
    const supportUrl = 'mailto:support@clutchpicksapp.com?subject=Restore%20Pro%20Access';
    try {
      const canOpenSupport = await Linking.canOpenURL(supportUrl);
      if (canOpenSupport) {
        await Linking.openURL(supportUrl);
        return;
      }
    } catch {
      // Fall through to an in-app fallback so the tap never feels dead.
    }

    setFeedback({
      title: 'Email Support',
      message: 'Email us at support@clutchpicksapp.com and we will help you out.',
      variant: 'info',
    });
  };

  const restorePurchasesMutation = useMutation({
    mutationFn: async () => {
      const result = await restorePurchases();
      if (result.ok) {
        await checkSubscription({ restored: true });
        return { hasActive: customerInfoHasPremium(result.data) };
      }

      return { hasActive: false };
    },
    onSuccess: ({ hasActive }) => {
      if (hasActive) {
        setFeedback({
          title: 'Restored',
          message: 'Your subscription has been restored.',
          variant: 'success',
        });
        return;
      }

      setFeedback({
        title: 'No Subscription Found',
        message: 'No App Store subscription was found for this account. If you already had Pro, contact support and we will help recover access.',
        variant: 'info',
        actionLabel: 'Contact Support',
        secondaryActionLabel: 'OK',
        onActionPress: () => { void openSupportEmail(); },
      });
    },
    onError: () => {
      setFeedback({
        title: 'Restore Failed',
        message: 'Please try again later.',
        variant: 'error',
      });
    },
  });

  const isRestoringPurchases = restorePurchasesMutation.isPending;

  const handleRestorePurchases = () => {
    if (restorePurchasesMutation.isPending) return;
    restorePurchasesMutation.mutate();
  };

  const handleTermsPress = () => {
    guardedRouterPush(router, '/terms');
  };

  const handlePrivacyPress = () => {
    guardedRouterPush(router, '/privacy-policy');
  };

  const handleSupportPress = openSupportEmail;

  const handleManageSubscription = () => {
    if (isPremium) {
      // Open subscription management in App Store / Play Store
      if (Platform.OS === 'ios') {
        void Linking.openURL('https://apps.apple.com/account/subscriptions');
      } else {
        void Linking.openURL('https://play.google.com/store/account/subscriptions');
      }
    } else {
      // Show paywall for non-subscribers
      guardedRouterPush(router, '/paywall');
    }
  };

  const handleSignOut = async () => {
    if (signOutInFlightRef.current) return;
    signOutInFlightRef.current = true;
    setIsSigningOut(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    try {
      await unregisterCurrentDeviceForPushNotifications();

      // Sign out from Better Auth
      try {
        await authClient.signOut();
      } catch {
        // Local auth storage is cleared below even if the server sign-out fails.
      }

      // Sign out from RevenueCat if enabled
      if (isRevenueCatEnabled()) {
        try {
          await logoutUser();
        } catch {
          // RevenueCat logout should not trap the user in the account screen.
        }
      }

      await clearAuthStorage();

      // Invalidate session cache
      await invalidateSession();

      // Navigate to welcome
      guardedRouterReplace(router, '/welcome');
    } catch (error) {
      setFeedback({
        title: 'Sign Out Failed',
        message: 'Failed to sign out. Please try again.',
        variant: 'error',
      });
      setIsSigningOut(false);
      signOutInFlightRef.current = false;
    }
  };

  const handleDeleteAccount = () => {
    if (deleteInFlightRef.current) return;
    setDeleteConfirmVisible(true);
  };

  const handleConfirmDeleteAccount = async () => {
    if (deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    setDeleteConfirmVisible(false);
    try {
      await unregisterCurrentDeviceForPushNotifications();
      await api.delete('/api/profile/delete-account');
      if (isRevenueCatEnabled()) {
        await logoutUser();
      }
      await clearAuthStorage();
      // Clear ALL stale local state so re-signin shows onboarding fresh.
      await AsyncStorage.removeItem('clutch_onboarding_complete').catch(() => {});
      await AsyncStorage.removeItem('clutch_onboarding_skip_profile').catch(() => {});
      await invalidateSession();
      guardedRouterReplace(router, '/welcome');
    } catch {
      deleteInFlightRef.current = false;
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
          actionLabel={feedback?.actionLabel}
          secondaryActionLabel={feedback?.secondaryActionLabel}
          variant={feedback?.variant}
          onActionPress={feedback?.onActionPress}
          onSecondaryPress={feedback?.onSecondaryPress}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={4}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
            Settings
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {/* DEV: Version / OTA Update Banner — remove before release */}
          <View style={{
            marginHorizontal: 20,
            marginBottom: 16,
            backgroundColor: 'rgba(122,157,184,0.08)',
            borderRadius: 10,
            borderWidth: 1,
            borderColor: 'rgba(122,157,184,0.18)',
            padding: 12,
          }}>
            <Text style={{ color: '#7A9DB8', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 }}>BUILD INFO</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: 'monospace' }}>
              {getAppVersionLabel()}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 4, fontFamily: 'monospace' }}>
              OTA: {Updates.updateId ? Updates.updateId.slice(0, 16) + '…' : 'embedded (no OTA)'}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2, fontFamily: 'monospace' }}>
              Channel: {Updates.channel ?? 'n/a'}
            </Text>
            <Text style={{ color: '#7A9DB8', fontSize: 11, marginTop: 6, fontFamily: 'monospace' }}>
              base: {baseForDiag}
            </Text>
            <Text style={{ color: '#7A9DB8', fontSize: 11, marginTop: 2, fontFamily: 'monospace' }}>
              probe: {diag}
            </Text>
          </View>

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
                  title={isRestoringPurchases ? "Restoring..." : "Restore Purchases"}
                  subtitle={isRestoringPurchases ? "Checking your App Store purchases" : "Restore a previous subscription"}
                  onPress={handleRestorePurchases}
                  disabled={isRestoringPurchases}
                  rightElement={isRestoringPurchases ? <ActivityIndicator size="small" color="#7A9DB8" /> : undefined}
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
                        void Linking.openURL('https://apps.apple.com/account/subscriptions');
                      } else {
                        void Linking.openURL('https://play.google.com/store/account/subscriptions');
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
                onPress={() => guardedRouterPush(router, '/model-accuracy')}
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
                onPress={() => guardedRouterPush(router, '/notifications-settings')}
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
                onPress={handleSupportPress}
              />
              <SettingItem
                icon={RefreshCw}
                title="Replay Tutorial"
                subtitle="Walk through the app intro again"
                onPress={async () => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  await AsyncStorage.removeItem('clutch_onboarding_skip_profile');
                  guardedRouterReplace(router, '/onboarding?replay=settings');
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
          <Pressable accessible={false} onPress={() => setPromoModalVisible(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
            <View accessible={false} onStartShouldSetResponder={() => true} style={{ width: '85%', backgroundColor: '#0A0E14', borderRadius: 18, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 }}>Promo Code</Text>
              <Text style={{ fontSize: 13, color: '#6B7C94', marginBottom: 16 }}>Enter your code</Text>
              <TextInput
                accessibilityLabel="Promo code"
                value={promoInput}
                onChangeText={(t) => setPromoInput(t.toUpperCase())}
                placeholder="CODE"
                placeholderTextColor="rgba(255,255,255,0.15)"
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (promoInput.trim() && !promoLoading) handleRedeemPromo(promoInput);
                }}
                style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 16, paddingVertical: 14, letterSpacing: 2, marginBottom: 16 }}
                keyboardAppearance="dark"
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel promo code" onPress={() => { setPromoModalVisible(false); setPromoInput(''); }} style={{ flex: 1, minHeight: 44, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#6B7C94' }}>Cancel</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Redeem promo code" accessibilityState={{ disabled: !promoInput.trim() || promoLoading, busy: promoLoading }} onPress={() => handleRedeemPromo(promoInput)} disabled={!promoInput.trim() || promoLoading} style={{ flex: 1, minHeight: 44, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#8B0A1F', opacity: !promoInput.trim() || promoLoading ? 0.5 : 1 }}>
                  {promoLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>Redeem</Text>}
                </Pressable>
              </View>
            </View>
          </Pressable>
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
