import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, StatusBar,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { haptics } from '@/lib/haptics';
import Svg, { Path } from 'react-native-svg';
import { authClient } from '@/lib/auth/auth-client';
import { authRequestErrorMessage, withAuthRequestTimeout } from '@/lib/auth/auth-request';
import { AuthBackground } from '@/components/AuthBackground';
import { PressableScale } from '@/components/shared/PressableScale';
import { PRESS_SCALE_CARD } from '@/lib/motion';
import { guardedRouterBack, guardedRouterPush, guardedRouterReplace } from '@/lib/navigation-guard';

const MAROON = '#8B0A1F';
const TEAL = '#7A9DB8';
const BG = '#040608';

function BackArrow({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18L9 12L15 6" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export default function SignUpScreen() {
  const [email, setEmailInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleContinue = async () => {
    if (isLoading) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Please enter your email');
      return;
    }
    if (!trimmed.includes('@') || !trimmed.includes('.')) {
      setError('Please enter a valid email');
      return;
    }

    setIsLoading(true);
    setError(null);
    haptics.confirm();

    try {
      const result = await withAuthRequestTimeout(
        authClient.emailOtp.sendVerificationOtp({
          email: trimmed,
          type: 'sign-in',
        }),
        { label: 'Send sign-up code' },
      );

      if (result.error) {
        haptics.error();
        setError(result.error.message || 'Failed to send verification code');
        return;
      }

      guardedRouterPush(router, {
        pathname: '/verify-otp' as any,
        params: { email: trimmed, mode: 'signup' },
      });
    } catch (requestError) {
      haptics.error();
      setError(authRequestErrorMessage(
        requestError,
        'Could not send a code. Check your connection and try again.',
      ));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      <AuthBackground faint />
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {/* Back arrow */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => guardedRouterBack(router)}
            hitSlop={16}
            style={s.backBtn}
          >
            <BackArrow />
          </PressableScale>

          {/* Hero */}
          <View style={s.hero}>
            <Text style={s.title}>Get Started</Text>
            <Text style={s.subtitle}>Enter your email to create your account</Text>
          </View>

          {/* Form */}
          <View style={s.form}>
            <Text style={s.label}>Email</Text>
            <TextInput
              accessibilityLabel="Email address"
              value={email}
              onChangeText={(v) => { setEmailInput(v); setError(null); }}
              placeholder="you@email.com"
              placeholderTextColor="rgba(255,255,255,0.30)"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              keyboardType="email-address"
              returnKeyType="go"
              onSubmitEditing={handleContinue}
              submitBehavior="submit"
              style={s.input}
              editable={!isLoading}
            />
            {error ? <Text style={s.errorText}>{error}</Text> : null}
          </View>

          {/* Spacer */}
          <View style={{ flex: 1 }} />

          {/* Continue button */}
          <View style={s.buttonWrap}>
            <PressableScale
              pressedScale={PRESS_SCALE_CARD}
              accessibilityRole="button"
              accessibilityLabel="Continue"
              accessibilityState={{ disabled: isLoading || !email.trim(), busy: isLoading }}
              onPress={handleContinue}
              disabled={isLoading || !email.trim()}
              style={[s.continueBtn, (isLoading || !email.trim()) && { opacity: 0.4 }]}
            >
              {isLoading ? (
                <View style={s.loadingContent}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={s.continueText}>Sending code...</Text>
                </View>
              ) : (
                <Text style={s.continueText}>Continue</Text>
              )}
            </PressableScale>
            <Text style={s.disclaimer}>
              Already have an account?{' '}
              <Text
                accessibilityRole="button"
                accessibilityLabel="Sign in instead"
                style={s.disclaimerLink}
                onPress={() => guardedRouterReplace(router, '/sign-in' as any)}
              >
                Sign In
              </Text>
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 24,
    marginTop: 8,
  },
  hero: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 22,
  },
  form: {
    paddingHorizontal: 24,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    height: 56,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  buttonWrap: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  continueBtn: {
    height: 56,
    borderRadius: 14,
    backgroundColor: MAROON,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: MAROON,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  continueText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  loadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  disclaimer: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginTop: 16,
  },
  disclaimerLink: {
    color: TEAL,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
