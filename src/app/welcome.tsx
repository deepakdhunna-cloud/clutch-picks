import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, StatusBar, Pressable, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { authClient, setBearerToken } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { setUserId, setEmail as rcSetEmail, setDisplayName } from '@/lib/revenuecatClient';
import { AuthBackground } from '@/components/AuthBackground';

const { width: W } = Dimensions.get('window');

const MAROON = '#8B0A1F';
const TEAL = '#7A9DB8';
const TEAL_DARK = '#5A7A8A';
const BG = '#040608';

function AppleLogo({ size = 18, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </Svg>
  );
}

export default function WelcomeScreen() {
  const invalidateSession = useInvalidateSession();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGetStarted = () => {
    if (isLoading) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/sign-up' as any);
  };

  const onSignIn = () => {
    if (isLoading) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/sign-in' as any);
  };

  const onApple = async () => {
    if (isLoading) return;
    try {
      setIsLoading(true);
      setError(null);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        setIsLoading(false);
        setError('Apple sign in did not complete');
        return;
      }
      const result = await authClient.signIn.social({
        provider: 'apple',
        callbackURL: '/(tabs)',
        idToken: {
          token: credential.identityToken,
          accessToken: credential.authorizationCode || undefined,
        },
      });
      if (result.error) {
        setIsLoading(false);
        setError(result.error.message || 'Apple sign in failed');
        return;
      }
      // Persist the bearer token from the response body as a fallback —
      // the auth-client also captures `set-auth-token` from the response
      // headers, but storing this directly removes any chance of a missed
      // header on iOS native fetch.
      const sessionToken = (result.data as any)?.token;
      if (__DEV__) console.log('[auth] apple sign-in result.data keys:', Object.keys(result.data || {}), 'token?', !!sessionToken);
      if (sessionToken) setBearerToken(sessionToken);
      const userId = (result.data as any)?.user?.id;
      const userEmail = (result.data as any)?.user?.email;
      const userName = (result.data as any)?.user?.name;
      try {
        if (userId) await setUserId(userId);
        if (userEmail) await rcSetEmail(userEmail);
        if (userName) await setDisplayName(userName);
      } catch (identityError) {
        if (__DEV__) console.log('[auth] RevenueCat Apple identity sync failed:', identityError);
      }
      try {
        await invalidateSession();
      } catch (sessionError) {
        if (__DEV__) console.log('[auth] Session cache invalidation failed:', sessionError);
      }
      const onboarded = await AsyncStorage.getItem('clutch_onboarding_complete');
      router.replace(onboarded === 'true' ? '/(tabs)' : '/onboarding');
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        setError('Apple sign in failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      <AuthBackground />
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        {/* Logo */}
        <View style={s.logoSection}>
          <Image
            source={require('@/assets/clutch-logo.png')}
            style={s.logoImage}
            resizeMode="contain"
          />
          <Text style={s.tagline}>AI-powered predictions{'\n'}across 11 leagues</Text>
          <View style={s.leagueStrip}>
            {['NBA', 'NFL', 'MLB', 'NHL', 'IPL', 'Tennis', 'EPL'].map((l) => (
              <View key={l} style={s.leaguePill}>
                <Text style={s.leaguePillText}>{l}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ flex: 1 }} />

        {/* Buttons */}
        <View style={s.buttons}>
          {error ? (
            <View style={s.errorWrap}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={onGetStarted}
            disabled={isLoading}
            style={s.getStartedBtn}
          >
            <Text style={s.getStartedText}>Get Started</Text>
          </Pressable>

          <Pressable
            onPress={onSignIn}
            disabled={isLoading}
            style={s.signInBtn}
          >
            <Text style={s.signInText}>Sign In</Text>
          </Pressable>

          <Pressable
            onPress={onApple}
            disabled={isLoading}
            style={s.appleBtn}
          >
            <AppleLogo size={20} color={TEAL_DARK} />
            <Text style={s.appleText}>Continue with Apple</Text>
          </Pressable>
        </View>

        {/* Terms */}
        <View style={s.termsWrap}>
          <Text style={s.terms}>
            By continuing, you agree to our{' '}
            <Text style={s.termsLink} onPress={() => router.push('/terms' as any)}>Terms</Text>
            {' & '}
            <Text style={s.termsLink} onPress={() => router.push('/privacy-policy' as any)}>Privacy Policy</Text>
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },

  logoSection: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  logoImage: {
    width: W * 0.6,
    height: W * 0.6 * (1275 / 2017),
  },
  tagline: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 80,
    lineHeight: 24,
    letterSpacing: 0.3,
  },
  leagueStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 24,
  },
  leaguePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    marginHorizontal: 4,
    marginVertical: 4,
  },
  leaguePillText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.8,
  },

  buttons: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  errorWrap: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
    marginBottom: 12,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  getStartedBtn: {
    height: 56,
    borderRadius: 14,
    backgroundColor: MAROON,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: MAROON,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  getStartedText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  signInBtn: {
    height: 56,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  signInText: {
    fontSize: 17,
    fontWeight: '700',
    color: TEAL,
    letterSpacing: 0.3,
  },
  appleBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  appleText: {
    fontSize: 16,
    fontWeight: '700',
    color: TEAL_DARK,
    marginLeft: 10,
  },

  termsWrap: {
    paddingHorizontal: 40,
    paddingBottom: 12,
  },
  terms: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.30)',
    textAlign: 'center',
    lineHeight: 16,
  },
  termsLink: {
    color: TEAL,
    textDecorationLine: 'underline',
  },
});
