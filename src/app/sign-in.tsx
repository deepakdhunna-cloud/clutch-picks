import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ScrollView, StatusBar, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { AuthBackground } from '@/components/AuthBackground';

const BG = '#040608';
const TEAL = '#7A9DB8';
const CORAL = '#8B0A1F';

function BackArrow({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18L9 12L15 6" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function EnvelopeIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 7C3 5.89543 3.89543 5 5 5H19C20.1046 5 21 5.89543 21 7V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7Z" stroke={TEAL} strokeWidth={1.5} />
      <Path d="M3 7L12 13L21 7" stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const BADGE_BLUE = '#5A7A8A';

function AppleLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={BADGE_BLUE}>
      <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </Svg>
  );
}

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const invalidateSession = useInvalidateSession();

  const handleSendOTP = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError('Please enter your email'); return; }
    if (!trimmed.includes('@') || !trimmed.includes('.')) { setError('Please enter a valid email'); return; }

    setIsLoading(true);
    setError(null);

    const result = await authClient.emailOtp.sendVerificationOtp({
      email: trimmed,
      type: 'sign-in',
    });

    setIsLoading(false);

    if (result.error) {
      setError(result.error.message || 'Failed to send verification code');
    } else {
      router.push({ pathname: '/verify-otp' as any, params: { email: trimmed } });
    }
  };

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
      } else {
        setError('Could not authenticate with Apple. Please try again.');
      }
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
      <AuthBackground faint />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back button */}
          <Animated.View entering={FadeIn.duration(300)} style={{ marginTop: 60, marginBottom: 32 }}>
            <Pressable onPress={() => router.back()} hitSlop={16} style={s.backBtn}>
              <BackArrow />
            </Pressable>
          </Animated.View>

          {/* Title */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <Text style={s.title}>Welcome Back</Text>
            <Text style={s.subtitle}>Enter your email and we'll send you a verification code.</Text>
          </Animated.View>

          <View style={{ height: 32 }} />

          {/* Email field */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)}>
            <Text style={s.label}>EMAIL</Text>
            <View style={[s.inputContainer, error ? { borderColor: '#EF444480' } : null]}>
              <EnvelopeIcon />
              <TextInput
                style={s.input}
                placeholder="your@email.com"
                placeholderTextColor="rgba(255,255,255,0.2)"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                autoFocus
                value={email}
                onChangeText={(t) => { setEmail(t); setError(null); }}
                editable={!isLoading}
                returnKeyType="go"
                onSubmitEditing={handleSendOTP}
              />
            </View>
          </Animated.View>

          {error ? (
            <Animated.Text entering={FadeIn.duration(200)} style={s.error}>{error}</Animated.Text>
          ) : null}

          <View style={{ height: 24 }} />

          {/* Sign In button */}
          <Animated.View entering={FadeInDown.delay(300).duration(400)}>
            <Pressable
              onPress={handleSendOTP}
              disabled={isLoading}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : isLoading ? 0.6 : 1 })}
            >
              <View style={s.submitBtn}>
                <Text style={s.submitBtnText}>{isLoading ? 'Sending Code...' : 'Sign In'}</Text>
              </View>
            </Pressable>
          </Animated.View>

          <View style={{ height: 20 }} />

          {/* OR divider */}
          <Animated.View entering={FadeInDown.delay(350).duration(400)} style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR</Text>
            <View style={s.dividerLine} />
          </Animated.View>

          <View style={{ height: 20 }} />

          {/* Apple Sign In */}
          <Animated.View entering={FadeInDown.delay(400).duration(400)}>
            <Pressable
              onPress={handleAppleSignIn}
              disabled={isLoading}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : isLoading ? 0.6 : 1 })}
            >
              <View style={s.appleBtn}>
                <AppleLogo size={18} />
                <Text style={s.appleBtnText}>Continue with Apple</Text>
              </View>
            </Pressable>
          </Animated.View>

          <View style={{ flex: 1, minHeight: 40 }} />

          {/* Switch to Sign Up */}
          <Animated.View entering={FadeIn.delay(500).duration(400)} style={{ alignItems: 'center', paddingBottom: 40 }}>
            <Text style={s.switchText}>
              Don't have an account?{' '}
              <Text style={s.switchLink} onPress={() => router.replace('/sign-up' as any)}>Sign Up</Text>
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 28, fontWeight: '900', color: '#FFFFFF', marginBottom: 10 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 21 },
  label: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 1.5, marginBottom: 8 },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16, height: 48,
  },
  input: { flex: 1, color: '#FFFFFF', fontSize: 15, padding: 0 },
  error: { color: '#EF4444', fontSize: 13, marginTop: 10 },
  submitBtn: {
    backgroundColor: CORAL, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center',
  },
  submitBtnText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  dividerText: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.2)' },
  appleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 14, height: 54, gap: 10,
    shadowColor: '#FFF', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 10, elevation: 8,
  },
  appleBtnText: { fontSize: 16, fontWeight: '700', color: BADGE_BLUE, lineHeight: 20 },
  switchText: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  switchLink: { color: CORAL, fontWeight: '600' },
});
