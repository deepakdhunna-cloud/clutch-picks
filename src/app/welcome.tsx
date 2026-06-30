import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, StatusBar, Pressable, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useNavigationContainerRef } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import { haptics } from '@/lib/haptics';
import { authClient, setBearerToken } from '@/lib/auth/auth-client';
import {
  appleSignInIncompleteError,
  appleSignInFallbackMessage,
  isAppleSignInCancel,
  WELCOME_LEAGUE_PILLS,
} from '@/lib/auth/auth-presentation';
import {
  authPayloadHasSession,
  authUserIdentityFromPayload,
  sessionTokenFromAuthPayload,
} from '@/lib/auth/auth-user';
import { useFinalizeAuthSession } from '@/lib/auth/use-session';
import { withAuthRequestTimeout } from '@/lib/auth/auth-request';
import { api } from '@/lib/api/api';
import { syncSubscriberInfo } from '@/lib/revenuecatClient';
import { AuthBackground } from '@/components/AuthBackground';
import { guardedRouterPush, guardedResetTo } from '@/lib/navigation-guard';

const MAROON = '#8B0A1F';
const TEAL = '#7A9DB8';
const BG = '#040608';

export default function WelcomeScreen() {
  const finalizeAuthSession = useFinalizeAuthSession();
  const navigationRef = useNavigationContainerRef();
  const { width } = useWindowDimensions();
  const [isLoading, setIsLoading] = useState(false);
  const [isAppleAvailable, setIsAppleAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appleInFlightRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (mounted) setIsAppleAvailable(available);
      })
      .catch(() => {
        if (mounted) setIsAppleAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const onGetStarted = () => {
    if (isLoading) return;
    haptics.confirm();
    guardedRouterPush(router, '/sign-up' as any);
  };

  const onSignIn = () => {
    if (isLoading) return;
    haptics.confirm();
    guardedRouterPush(router, '/sign-in' as any);
  };

  const finishAuthenticatedSession = async (authData: unknown) => {
    const sessionToken = sessionTokenFromAuthPayload(authData);
    if (sessionToken) setBearerToken(sessionToken);

    try {
      await syncSubscriberInfo(authUserIdentityFromPayload(authData));
    } catch {
      // RevenueCat attribute sync must not block an otherwise valid login.
    }
    const finalizedSession = await finalizeAuthSession(authData);
    if (!(finalizedSession as any)?.user) {
      throw appleSignInIncompleteError();
    }
    const onboarded = await AsyncStorage.getItem('clutch_onboarding_complete');
    // Reset the stack so the auth screens are flushed and Home can't be
    // back-swiped to Welcome / onboarding.
    guardedResetTo(router, onboarded === 'true' ? '/(tabs)' : '/onboarding', { navigationRef });
  };

  const appleFullName = (fullName: AppleAuthentication.AppleAuthenticationFullName | null): string | null => {
    if (!fullName) return null;
    const formatted = AppleAuthentication.formatFullName(fullName, 'default').trim();
    return formatted.length > 0 ? formatted : null;
  };

  const storeNativeAppleTokens = async (identityToken: string, authorizationCode: string | null) => {
    if (!authorizationCode) {
      throw new Error('Apple sign in did not return an authorization code');
    }
    await api.post('/api/apple-auth/native-token', { identityToken, authorizationCode });
  };

  const signInWithNativeApple = async () => {
    const isAvailable = await AppleAuthentication.isAvailableAsync();
    if (!isAvailable) {
      throw Object.assign(new Error('Apple native sign in is unavailable'), {
        code: 'APPLE_NATIVE_UNAVAILABLE',
      });
    }
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new Error('Apple sign in did not return an identity token');
    }
    const result = await withAuthRequestTimeout(
      authClient.signIn.social({
        provider: 'apple',
        callbackURL: '/(tabs)',
        idToken: {
          token: credential.identityToken,
        },
      }),
      { label: 'Apple backend sign in' },
    );
    if (result.error) {
      throw result.error;
    }

    const sessionToken = sessionTokenFromAuthPayload(result.data);
    if (sessionToken) setBearerToken(sessionToken);

    const existingIdentity = authUserIdentityFromPayload(result.data);
    const name = appleFullName(credential.fullName);
    if (name && (result.data as any)?.user) {
      (result.data as any).user.name = existingIdentity.displayName ?? name;
    }

    void withAuthRequestTimeout(
      storeNativeAppleTokens(credential.identityToken, credential.authorizationCode),
      { timeoutMs: 8_000, label: 'Apple token persistence' },
    ).catch(() => {});

    if (name) {
      if (!existingIdentity.displayName) {
        void withAuthRequestTimeout(
          api.put('/api/profile', { name }),
          { timeoutMs: 8_000, label: 'Apple profile name persistence' },
        ).then(() => {
          if ((result.data as any)?.user) (result.data as any).user.name = name;
        }).catch(() => {});
      }
    }

    return result.data;
  };

  const signInWithAppleOAuthFallback = async () => {
    const result = await authClient.signIn.social({
      provider: 'apple',
      callbackURL: '/(tabs)',
    });
    if (result.error) {
      throw result.error;
    }
    return result.data;
  };

  const onApple = async () => {
    if (isLoading || appleInFlightRef.current) return;
    appleInFlightRef.current = true;
    try {
      setIsLoading(true);
      setError(null);
      let authData: unknown;
      try {
        authData = await signInWithNativeApple();
      } catch (nativeError) {
        if (isAppleSignInCancel(nativeError)) return;
        authData = await signInWithAppleOAuthFallback();
      }

      if (authPayloadHasSession(authData)) {
        await finishAuthenticatedSession(authData);
        return;
      }

      const sessionResult = await withAuthRequestTimeout(
        authClient.getSession(),
        { label: 'Apple session check' },
      );
      if (authPayloadHasSession(sessionResult.data)) {
        await finishAuthenticatedSession(sessionResult.data);
        return;
      }

      throw appleSignInIncompleteError();
    } catch (e: any) {
      const message = appleSignInFallbackMessage(e);
      if (message) {
        haptics.error();
        setError(message);
      }
    } finally {
      appleInFlightRef.current = false;
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
            style={[s.logoImage, { width: width * 0.6, height: width * 0.6 * (1275 / 2017) }]}
            resizeMode="contain"
          />
          <Text style={s.tagline}>AI-powered predictions{'\n'}across 11 leagues</Text>
          <View style={s.leagueStrip}>
            {WELCOME_LEAGUE_PILLS.map((l) => (
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

          <View style={s.emailActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create account"
              accessibilityState={{ disabled: isLoading }}
              onPress={onGetStarted}
              disabled={isLoading}
              style={s.signUpBtn}
            >
              <Text style={s.signUpText}>Sign Up</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: isLoading }}
              onPress={onSignIn}
              disabled={isLoading}
              style={s.signInBtn}
            >
              <Text style={s.signInText}>Sign In</Text>
            </Pressable>
          </View>

          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          <View style={[s.appleBtnWrap, isLoading && s.disabledControl]} pointerEvents={isLoading ? 'none' : 'auto'}>
            {isAppleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={14}
                style={s.appleNativeBtn}
                onPress={onApple}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue with Apple"
                accessibilityState={{ disabled: isLoading, busy: isLoading }}
                onPress={onApple}
                disabled={isLoading}
                style={s.appleFallbackBtn}
              >
                <Text style={s.appleFallbackText}>Continue with Apple</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Terms */}
        <View style={s.termsWrap}>
          <Text style={s.terms}>
            By continuing, you agree to our{' '}
            <Text accessibilityRole="link" accessibilityLabel="Terms" style={s.termsLink} onPress={() => guardedRouterPush(router, '/terms' as any)}>Terms</Text>
            {' & '}
            <Text accessibilityRole="link" accessibilityLabel="Privacy Policy" style={s.termsLink} onPress={() => guardedRouterPush(router, '/privacy-policy' as any)}>Privacy Policy</Text>
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
  logoImage: {},
  tagline: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 70,
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
  emailActions: {
    flexDirection: 'row',
    gap: 12,
  },
  signUpBtn: {
    flex: 1,
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
  signUpText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  signInBtn: {
    flex: 1,
    height: 56,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInText: {
    fontSize: 17,
    fontWeight: '700',
    color: TEAL,
    letterSpacing: 0.3,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  dividerText: {
    paddingHorizontal: 12,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  appleBtnWrap: {
    height: 54,
    marginBottom: 8,
  },
  appleNativeBtn: {
    width: '100%',
    height: 54,
  },
  appleFallbackBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleFallbackText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000000',
  },
  disabledControl: {
    opacity: 0.5,
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
