import React from 'react';
import {
  View, Text, Image, StyleSheet, StatusBar, Pressable, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  FadeIn, FadeInUp,
  useSharedValue, useAnimatedStyle,
  withSequence, withSpring,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { AuthBackground } from '@/components/AuthBackground';

import { BG, TEAL, TEAL_DARK, MAROON } from '@/lib/theme';

const { width: W, height: H } = Dimensions.get('window');

// ─── Apple Logo ─────────────────────────────────────────────────
function AppleLogo({ size = 18, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </Svg>
  );
}

// ─── Welcome Screen ─────────────────────────────────────────────
export default function WelcomeScreen() {
  const router = useRouter();
  const invalidateSession = useInvalidateSession();
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleAppleSignIn = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (credential.identityToken) {
        const result = await authClient.signIn.social({
          provider: 'apple',
          callbackURL: '/(tabs)',
          idToken: {
            token: credential.identityToken,
            accessToken: credential.authorizationCode || undefined,
          },
        });
        if (result.error) {
          setError(result.error.message || 'Apple sign in failed');
        } else if (result.data) {
          await invalidateSession();
          const onboarded = await AsyncStorage.getItem('clutch_onboarding_complete');
          router.replace(onboarded === 'true' ? '/(tabs)' : '/onboarding');
        }
      }
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        setError('Apple sign in failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── Button press animation ──
  const appleScale = useSharedValue(1);
  const emailScale = useSharedValue(1);

  const appleAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: appleScale.value }],
  }));
  const emailAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: emailScale.value }],
  }));

  const onApplePress = () => {
    appleScale.value = withSequence(
      withSpring(0.95, { damping: 15, stiffness: 300 }),
      withSpring(1, { damping: 12, stiffness: 200 })
    );
    handleAppleSignIn();
  };
  const onEmailPress = () => {
    emailScale.value = withSequence(
      withSpring(0.95, { damping: 15, stiffness: 300 }),
      withSpring(1, { damping: 12, stiffness: 200 })
    );
    router.push('/sign-in' as any);
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />

      {/* ═══ BACKGROUND ═══ */}
      <AuthBackground />

      {/* ═══ CONTENT ═══ */}
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>

        {/* ── Logo section — upper third ── */}
        <View style={s.logoSection}>
          <Animated.View entering={FadeIn.delay(300).duration(1000)} style={s.logoBlock}>
            <Image
              source={require('@/assets/clutch-logo.png')}
              style={s.logoImage}
              resizeMode="contain"
            />
          </Animated.View>

          <Animated.Text entering={FadeIn.delay(600).duration(800)} style={s.tagline}>
            AI-powered predictions{'\n'}across 8 leagues
          </Animated.Text>

          {/* League pill strip */}
          <Animated.View entering={FadeIn.delay(900).duration(600)} style={s.leagueStrip}>
            {['NBA', 'NFL', 'MLB', 'NHL', 'MLS', 'EPL'].map((l) => (
              <View key={l} style={s.leaguePill}>
                <Text style={s.leaguePillText}>{l}</Text>
              </View>
            ))}
          </Animated.View>
        </View>

        {/* ── Buttons section — all three stacked together ── */}
        <Animated.View entering={FadeInUp.delay(700).duration(700)} style={s.buttonsSection}>

          {error ? (
            <Animated.View entering={FadeIn.duration(300)} style={s.errorWrap}>
              <Text style={s.errorText}>{error}</Text>
            </Animated.View>
          ) : null}

          {/* Email button — frosted glass with coral tint */}
          <Animated.View style={emailAnimStyle}>
            <Pressable
              onPress={onEmailPress}
              disabled={isLoading}
              style={[s.emailBtn, { opacity: isLoading ? 0.5 : 1 }]}
            >
              <LinearGradient
                colors={[`${MAROON}45`, `${MAROON}28`, `${MAROON}38`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.btnGradient}
              >
                <Text style={s.emailBtnText}>Get Started with Email</Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* Sign in button — glass style */}
          <Pressable onPress={() => router.push('/sign-in')} disabled={isLoading}>
            {({ pressed }) => (
              <View style={[s.signInBtn, { opacity: pressed ? 0.7 : 1 }]}>
                <Text style={s.signInBtnText}>I already have an account</Text>
              </View>
            )}
          </Pressable>

          {/* Apple button — solid white with badge blue text */}
          <Animated.View style={appleAnimStyle}>
            <Pressable
              onPress={onApplePress}
              disabled={isLoading}
              style={[s.appleBtn, { opacity: isLoading ? 0.5 : 1 }]}
            >
              <AppleLogo size={20} color={TEAL_DARK} />
              <Text style={s.appleBtnText}>Continue with Apple</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>

        {/* ── Terms — pinned at very bottom ── */}
        <Animated.View entering={FadeIn.delay(900).duration(500)} style={s.termsWrap}>
          <Text style={s.terms}>
            By continuing, you agree to our{' '}
            <Text style={s.termsLink} onPress={() => router.push('/terms' as any)}>Terms</Text>
            {' & '}
            <Text style={s.termsLink} onPress={() => router.push('/privacy-policy' as any)}>Privacy Policy</Text>
          </Text>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },

  // ── Logo section — sits in the upper portion ──
  logoSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  logoBlock: { alignItems: 'center' },
  logoImage: {
    width: W * 0.6,
    height: W * 0.6 * (1275 / 2017), // match original aspect ratio
  },

  tagline: {
    fontSize: 16, color: '#FFFFFF', fontWeight: '500',
    textAlign: 'center', marginTop: 100, lineHeight: 24,
    letterSpacing: 0.3,
  },

  leagueStrip: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', gap: 8,
    marginTop: 24, paddingHorizontal: 40,
  },
  leaguePill: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
  },
  leaguePillText: {
    fontSize: 12, fontWeight: '900', color: '#FFFFFF',
    letterSpacing: 2,
  },

  // ── Buttons section — grouped together ──
  buttonsSection: {
    paddingHorizontal: 24,
    gap: 14,
    marginBottom: 24,
  },

  errorWrap: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
  },
  errorText: {
    color: '#EF4444', fontSize: 13, textAlign: 'center', fontWeight: '600',
  },

  // ── Buttons ──
  appleBtn: {
    height: 54, borderRadius: 14, overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: '#FFF', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 10, elevation: 8,
  },
  appleBtnText: {
    fontSize: 16, fontWeight: '700', color: TEAL_DARK,
  },
  emailBtn: {
    height: 54, borderRadius: 14, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1.5, borderColor: `${MAROON}CC`,
    shadowColor: MAROON, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 12, elevation: 8,
  },
  emailBtnText: {
    fontSize: 16, fontWeight: '800', color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  btnGradient: {
    flex: 1, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },

  // ── Sign in button ──
  signInBtn: {
    height: 54, borderRadius: 14,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row' as const,
  },
  signInBtnText: {
    fontSize: 16, fontWeight: '700', color: '#FFFFFF',
    textAlign: 'center' as const,
  },

  // ── Terms ──
  termsWrap: {
    paddingHorizontal: 40,
    paddingBottom: 8,
  },
  terms: {
    fontSize: 11, color: 'rgba(255,255,255,0.15)',
    textAlign: 'center', lineHeight: 16,
  },
  termsLink: {
    color: `${TEAL}70`, textDecorationLine: 'underline' as const,
  },
});
