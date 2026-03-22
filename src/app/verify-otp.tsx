import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';

const BG = '#040608';
const TEAL = '#7A9DB8';
const TEAL_DARK = '#5A7A8A';
const CORAL = '#E8936A';
const CODE_LENGTH = 6;

function ShieldCheckIcon({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Defs>
        <SvgGrad id="otp-shield" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor={CORAL} stopOpacity={0.2} />
          <Stop offset="1" stopColor={TEAL} stopOpacity={0.05} />
        </SvgGrad>
      </Defs>
      <Path d="M16 3 L4 8 L4 16 C4 23 9 28 16 30 C23 28 28 23 28 16 L28 8 Z" fill="url(#otp-shield)" stroke={TEAL} strokeWidth={1.5} />
      <Path d="M11 16 L14.5 19.5 L21 12" stroke={CORAL} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
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

  // Auto-verify if OTP was passed via deep link
  useEffect(() => {
    if (initialOtp && initialOtp.length === CODE_LENGTH && email) {
      handleVerifyCode(initialOtp);
    } else {
      // Immediate focus for faster code entry
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
      await invalidateSession();
      router.replace('/(tabs)');
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
    <View style={st.root}>
      <StatusBar barStyle="light-content" />
      <View style={[st.glow, { top: -60, alignSelf: 'center', backgroundColor: `${TEAL}08` }]} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={st.content}>
            <View style={{ height: 8 }} />
            <TouchableOpacity onPress={() => router.back()} style={{ alignSelf: 'flex-start' }}>
              <Text style={st.backText}>← Back</Text>
            </TouchableOpacity>

            <View style={{ height: 32 }} />

            <View style={st.iconContainer}>
              <ShieldCheckIcon size={36} />
            </View>

            <View style={{ height: 16 }} />
            <Text style={st.headline}>Verify Your Email</Text>
            <View style={{ height: 8 }} />
            <Text style={st.sentLabel}>Code sent to</Text>
            <View style={{ height: 4 }} />
            <Text style={st.emailLabel}>{email ?? 'your email'}</Text>

            <View style={{ height: 32 }} />

            <View style={{ position: 'relative', width: '100%', alignItems: 'center' }}>
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

              <View style={st.codeRow} pointerEvents="none">
                {codeDigits.map((digit, i) => {
                  const isFilled = digit !== '';
                  const isActive = i === code.length && !isComplete;
                  return (
                    <View key={i} style={[st.codeBox, isFilled && st.codeBoxFilled, isActive && st.codeBoxActive]}>
                      {isFilled ? (
                        <Text style={st.codeDigit}>{digit}</Text>
                      ) : isActive ? (
                        <View style={st.cursor} />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={{ height: 12 }} />
            <Text style={st.hintText}>Your code will auto-suggest above the keyboard</Text>

            {error ? (
              <>
                <View style={{ height: 8 }} />
                <Text style={st.errorText}>{error}</Text>
              </>
            ) : null}

            <View style={{ height: 24 }} />

            <View style={st.resendRow}>
              <TouchableOpacity onPress={handleResend} disabled={isResending}>
                <Text style={[st.resendText, isResending && { color: 'rgba(255,255,255,0.25)' }]}>
                  {isResending ? 'Sending...' : 'Resend Code'}
                </Text>
              </TouchableOpacity>
              <Text style={st.timerText}>· {timerDisplay}</Text>
            </View>

            <View style={{ flex: 1, minHeight: 32 }} />

            <TouchableOpacity onPress={handleVerify} disabled={!isComplete || isLoading} activeOpacity={0.85} style={{ width: '100%', height: 54, borderRadius: 14, overflow: 'hidden', opacity: isComplete ? 1 : 0.4 }}>
              <LinearGradient colors={[TEAL_DARK, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>Verify My Account</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <View style={{ height: 36 }} />
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  glow: { position: 'absolute', width: 300, height: 300, borderRadius: 150 },
  content: { flex: 1, paddingHorizontal: 24, alignItems: 'center' },
  backText: { color: CORAL, fontSize: 14, fontWeight: '600' },
  iconContainer: { width: 68, height: 68, borderRadius: 22, backgroundColor: `${CORAL}12`, borderWidth: 1, borderColor: `${CORAL}25`, alignItems: 'center', justifyContent: 'center' },
  headline: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  sentLabel: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  emailLabel: { fontSize: 14, fontWeight: '700', color: CORAL },
  codeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  codeBox: { width: 44, height: 54, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center' },
  codeBoxFilled: { borderColor: `${TEAL}50`, backgroundColor: `${TEAL}08` },
  codeBoxActive: { borderWidth: 2, borderColor: CORAL, backgroundColor: `${CORAL}08`, shadowColor: CORAL, shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  codeDigit: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  cursor: { width: 2, height: 22, backgroundColor: CORAL, borderRadius: 1 },
  hintText: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '500' },
  errorText: { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  resendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resendText: { fontSize: 13, fontWeight: '700', color: CORAL },
  timerText: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
});
