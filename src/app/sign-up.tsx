import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ScrollView, StatusBar, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { authClient } from '@/lib/auth/auth-client';
import { AuthBackground } from '@/components/AuthBackground';

const BG = '#040608';
const TEAL = '#7A9DB8';
const CORAL = '#E8936A';

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

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async () => {
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
      // Pass isNewUser flag so verify-otp routes to onboarding on success
      router.push({ pathname: '/verify-otp' as any, params: { email: trimmed, isNewUser: 'true' } });
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
            <Text style={s.title}>Create Account</Text>
            <Text style={s.subtitle}>Enter your email and we'll send you a verification code to get started.</Text>
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
                onSubmitEditing={handleSignUp}
              />
            </View>
          </Animated.View>

          {error ? (
            <Animated.Text entering={FadeIn.duration(200)} style={s.error}>{error}</Animated.Text>
          ) : null}

          <View style={{ height: 24 }} />

          {/* Create Account button */}
          <Animated.View entering={FadeInDown.delay(300).duration(400)}>
            <Pressable
              onPress={handleSignUp}
              disabled={isLoading}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : isLoading ? 0.6 : 1 })}
            >
              <View style={s.submitBtn}>
                <Text style={s.submitBtnText}>{isLoading ? 'Sending Code...' : 'Create Account'}</Text>
              </View>
            </Pressable>
          </Animated.View>

          <View style={{ flex: 1, minHeight: 40 }} />

          {/* Switch to Sign In */}
          <Animated.View entering={FadeIn.delay(400).duration(400)} style={{ alignItems: 'center', paddingBottom: 40 }}>
            <Text style={s.switchText}>
              Already have an account?{' '}
              <Text style={s.switchLink} onPress={() => router.replace('/sign-in')}>Sign In</Text>
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
  switchText: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  switchLink: { color: CORAL, fontWeight: '600' },
});
