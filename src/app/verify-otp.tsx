import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  StatusBar, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { setUserId } from '@/lib/revenuecatClient';
import { AuthBackground } from '@/components/AuthBackground';
import { BG, TEAL, TEAL_DARK, MAROON } from '@/lib/theme';

const CODE_LENGTH = 6;

function BackArrow({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18L9 12L15 6" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ShieldCheckIcon({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Defs>
        <SvgGrad id="otp-shield" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor={MAROON} stopOpacity={0.2} />
          <Stop offset="1" stopColor={TEAL} stopOpacity={0.05} />
        </SvgGrad>
      </Defs>
      <Path d="M16 3 L4 8 L4 16 C4 23 9 28 16 30 C23 28 28 23 28 16 L28 8 Z" fill="url(#otp-shield)" stroke={TEAL} strokeWidth={1.5} />
      <Path d="M11 16 L14.5 19.5 L21 12" stroke={MAROON} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export default function VerifyOTP() {
  const router = useRouter();
  const { email, otp: initialOtp } = useLocalSearchParams<{ email: string; otp?: string }>();
  const invalidateSession = useInvalidateSession();

  const [code, setCode] = useState(initialOtp ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(300);
  const inputRef = useRef<TextInput>(null);

  const isComplete = code.length === CODE_LENGTH;

  useEffect(() => {
    if (initialOtp && initialOtp.length === CODE_LENGTH && email) {
      handleVerifyCode(initialOtp);
    } else {
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const timerDisplay = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  useEffect(() => {
    if (code.length === CODE_LENGTH && !initialOtp) {
      handleVerifyCode(code);
    }
  }, [code]);

  const handleVerifyCode = async (otpCode: string) => {
    if (otpCode.length !== CODE_LENGTH || !email) return;
    setIsLoading(true);
    setError(null);
    const result = await authClient.signIn.emailOtp({ email: email.trim(), otp: otpCode });
    setIsLoading(false);
    if (result.error) {
      setError(result.error.message ?? 'Invalid verification code');
      setCode('');
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      const userId = result.data?.user?.id;
      if (userId) {
        await setUserId(userId);
      }
      await invalidateSession();
      const onboarded = await AsyncStorage.getItem('clutch_onboarding_complete');
      router.replace(onboarded === 'true' ? '/(tabs)' : '/onboarding');
    }
  };

  const handleVerify = () => handleVerifyCode(code);

  const handleResend = async () => {
    if (!email) return;
    setIsResending(true);
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' });
    setIsResending(false);
    if (result.error) {
      setError(result.error.message ?? 'Failed to resend code');
    } else {
      setCode('');
      setSeconds(300);
      inputRef.current?.focus();
    }
  };

  const codeDigits = code.split('').concat(Array(CODE_LENGTH - code.length).fill(''));

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      <AuthBackground faint />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={s.content}>
          {/* Back button */}
          <Animated.View entering={FadeIn.duration(300)} style={{ marginTop: 60, marginBottom: 32, alignSelf: 'flex-start' }}>
            <Pressable onPress={() => router.back()} hitSlop={16} style={s.backBtn}>
              <BackArrow />
            </Pressable>
          </Animated.View>

          {/* Header */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ alignItems: 'center', width: '100%' }}>
            <View style={s.iconContainer}>
              <ShieldCheckIcon size={36} />
            </View>
            <View style={{ height: 16 }} />
            <Text style={s.title}>Verify Your Email</Text>
            <View style={{ height: 8 }} />
            <Text style={s.subtitle}>Code sent to</Text>
            <View style={{ height: 4 }} />
            <Text style={s.emailLabel}>{email ?? 'your email'}</Text>
          </Animated.View>

          <View style={{ height: 32 }} />

          {/* Code input */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ position: 'relative', width: '100%', alignItems: 'center' }}>
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);
                setCode(cleaned);
                setError(null);
              }}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
              maxLength={CODE_LENGTH}
              style={{
                position: 'absolute',
                width: 300,
                height: 54,
                opacity: 0.01,
                fontSize: 22,
                letterSpacing: 24,
                zIndex: 1,
              }}
            />

            <View style={s.codeRow} pointerEvents="none">
              {codeDigits.map((digit, i) => {
                const isFilled = digit !== '';
                const isActive = i === code.length && !isComplete;
                return (
                  <View key={i} style={[s.codeBox, isFilled && s.codeBoxFilled, isActive && s.codeBoxActive]}>
                    {isFilled ? (
                      <Text style={s.codeDigit}>{digit}</Text>
                    ) : isActive ? (
                      <View style={s.cursor} />
                    ) : null}
                  </View>
                );
              })}
            </View>
          </Animated.View>

          <View style={{ height: 12 }} />
          <Text style={s.hintText}>Your code will auto-suggest above the keyboard</Text>

          {error ? (
            <Animated.View entering={FadeIn.duration(200)}>
              <View style={{ height: 8 }} />
              <Text style={s.errorText}>{error}</Text>
            </Animated.View>
          ) : null}

          <View style={{ height: 24 }} />

          {/* Resend */}
          <Animated.View entering={FadeInDown.delay(300).duration(400)} style={s.resendRow}>
            <Pressable onPress={handleResend} disabled={isResending}>
              <Text style={[s.resendText, isResending && { color: 'rgba(255,255,255,0.25)' }]}>
                {isResending ? 'Sending...' : 'Resend Code'}
              </Text>
            </Pressable>
            <Text style={s.timerText}>· {timerDisplay}</Text>
          </Animated.View>

          <View style={{ flex: 1, minHeight: 32 }} />

          {/* Verify button */}
          <Animated.View entering={FadeInDown.delay(400).duration(400)} style={{ width: '100%' }}>
            <Pressable
              onPress={handleVerify}
              disabled={!isComplete || isLoading}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : !isComplete ? 0.4 : 1 })}
            >
              <View style={s.submitBtn}>
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={s.submitBtnText}>Verify My Account</Text>
                )}
              </View>
            </Pressable>
          </Animated.View>

          <View style={{ height: 36 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { flex: 1, paddingHorizontal: 24, alignItems: 'center' },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconContainer: {
    width: 68, height: 68, borderRadius: 22,
    backgroundColor: `${TEAL}12`, borderWidth: 1, borderColor: `${TEAL}35`,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 28, fontWeight: '900', color: '#FFFFFF' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 21 },
  emailLabel: { fontSize: 14, fontWeight: '700', color: TEAL },
  codeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  codeBox: {
    width: 44, height: 54, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center', justifyContent: 'center',
  },
  codeBoxFilled: { borderColor: `${TEAL}50`, backgroundColor: `${TEAL}08` },
  codeBoxActive: {
    borderWidth: 2, borderColor: TEAL, backgroundColor: `${TEAL}08`,
    shadowColor: TEAL, shadowOpacity: 0.2, shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  codeDigit: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  cursor: { width: 2, height: 22, backgroundColor: TEAL, borderRadius: 1 },
  hintText: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '500' },
  errorText: { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  resendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resendText: { fontSize: 13, fontWeight: '700', color: MAROON },
  timerText: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  submitBtn: {
    backgroundColor: `${TEAL}20`, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: `${TEAL}AA`,
  },
  submitBtnText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
});
