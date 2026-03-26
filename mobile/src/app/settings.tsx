import { View, Text, Pressable, ScrollView, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowLeft, Lock, Shield, FileText, HelpCircle, ChevronRight, Globe, Trash2, CreditCard, LogOut, Crown, RefreshCw } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { useSubscription } from '@/lib/subscription-context';
import { isRevenueCatEnabled, logoutUser, restorePurchases } from '@/lib/revenuecatClient';
import { api } from '@/lib/api/api';

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
    <Pressable
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

export default function SettingsScreen() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { isPremium, isLoading: isSubscriptionLoading } = useSubscription();
  const invalidateSession = useInvalidateSession();

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
      const keysToDelete = [
        'vibecode_cookie',
        'vibecode_session_data',
        'vibecode_session_token',
        'vibecode_refresh_token',
      ];
      for (const key of keysToDelete) {
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
      Alert.alert('Error', 'Failed to sign out. Please try again.');
      setIsSigningOut(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all your data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await api.delete('/api/profile/delete-account');
              if (isRevenueCatEnabled()) {
                await logoutUser();
              }
              await SecureStore.deleteItemAsync('vibecode_session_token').catch(() => {});
              await SecureStore.deleteItemAsync('vibecode_refresh_token').catch(() => {});
              await invalidateSession();
              router.replace('/welcome');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete account. Please try again or contact support.');
            }
          },
        },
      ]
    );
  };

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
                  onPress={async () => {
                    try {
                      const result = await restorePurchases();
                      if (result.ok) {
                        Alert.alert('Restored!', 'Your subscription has been restored.');
                      } else {
                        Alert.alert('No Subscription Found', 'No previous subscription was found for this account.');
                      }
                    } catch {
                      Alert.alert('Restore Failed', 'Please try again later.');
                    }
                  }}
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

          {/* Privacy & Security */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)}>
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

          {/* Version */}
          <View style={{ alignItems: 'center', marginTop: 20 }}>
            <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
              Clutch Picks v1.0.10
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
