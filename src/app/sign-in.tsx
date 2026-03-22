import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ScrollView, StatusBar, TouchableOpacity, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Svg, { Path, Circle, Line, Rect, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { authClient } from '@/lib/auth/auth-client';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useInvalidateSession } from '@/lib/auth/use-session';

const BG = '#040608';
const TEAL = '#7A9DB8';
const TEAL_DARK = '#5A7A8A';
const CORAL = '#E8936A';

function TargetIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Circle cx={16} cy={16} r={14} stroke={CORAL} strokeWidth={2} fill="none" />
      <Circle cx={16} cy={16} r={10} stroke={CORAL} strokeWidth={1.2} fill="none" opacity={0.35} />
      <Circle cx={16} cy={16} r={6} stroke={CORAL} strokeWidth={1.5} fill="none" opacity={0.55} />
      <Circle cx={16} cy={16} r={2.5} fill={CORAL} />
      <Line x1={16} y1={2} x2={16} y2={7} stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      <Line x1={16} y1={25} x2={16} y2={30} stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      <Line x1={2} y1={16} x2={7} y2={16} stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      <Line x1={25} y1={16} x2={30} y2={16} stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
    </Svg>
  );
}

function ChartIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Defs>
        <SvgGrad id="si-chart" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={TEAL} stopOpacity={0.2} />
          <Stop offset="1" stopColor={CORAL} stopOpacity={0.8} />
        </SvgGrad>
      </Defs>
      <Rect x={4} y={18} width={5} height={10} rx={2} fill="url(#si-chart)" />
      <Rect x={11} y={13} width={5} height={15} rx={2} fill="url(#si-chart)" />
      <Rect x={18} y={8} width={5} height={20} rx={2} fill="url(#si-chart)" />
      <Rect x={25} y={4} width={5} height={24} rx={2} fill="url(#si-chart)" />
      <Path d="M6 17 L13 12 L20 7 L27 3" stroke={CORAL} strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.7} />
      <Circle cx={27} cy={3} r={2} fill={CORAL} />
    </Svg>
  );
}

function BoltIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Defs>
        <SvgGrad id="si-bolt" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor={CORAL} stopOpacity={1} />
          <Stop offset="1" stopColor={CORAL} stopOpacity={0.5} />
        </SvgGrad>
      </Defs>
      <Path d="M18 2 L8 16 L14 16 L12 30 L24 14 L17 14 Z" fill="url(#si-bolt)" />
      <Path d="M17 4 L10 15 L14.5 15 L13 27 L22 15 L17.5 15 Z" fill="white" fillOpacity={0.12} />
    </Svg>
  );
}

function EnvelopeIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Defs>
        <SvgGrad id="si-env" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={TEAL} stopOpacity={0.15} />
          <Stop offset="1" stopColor={TEAL} stopOpacity={0.03} />
        </SvgGrad>
      </Defs>
      <Rect x={3} y={7} width={26} height={18} rx={3} fill="url(#si-env)" stroke={TEAL} strokeWidth={1.5} />
      <Path d="M3 10 L16 19 L29 10" stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx={16} cy={17} r={2.5} fill={CORAL} fillOpacity={0.5} />
      <Circle cx={16} cy={17} r={1.2} fill={CORAL} fillOpacity={0.8} />
    </Svg>
  );
}

function AppleLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="#000000">
      <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </Svg>
  );
}

function FieldGoalU({ color, size = 36 }: { color: string; size?: number }) {
  return (
    <Svg width={size * 0.65} height={size} viewBox="0 0 26 40" fill="none">
      <Path d="M4 0 L4 30" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <Path d="M22 0 L22 30" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <Path d="M4 30 L22 30" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <Path d="M13 30 L13 40" stroke={color} strokeWidth={4} strokeLinecap="round" />
      <Path d="M8 15 Q13 10 18 15 Q13 20 8 15" fill={color} transform="rotate(-35 13 15)" />
      <Path d="M13 13 L13 17" stroke={color === '#000000' ? '#000000' : '#0D0D0D'} strokeWidth={1.2} strokeLinecap="round" transform="rotate(-35 13 15)" />
      <Path d="M11.5 14 L14.5 14" stroke={color === '#000000' ? '#000000' : '#0D0D0D'} strokeWidth={0.8} transform="rotate(-35 13 15)" />
      <Path d="M11.5 16 L14.5 16" stroke={color === '#000000' ? '#000000' : '#0D0D0D'} strokeWidth={0.8} transform="rotate(-35 13 15)" />
    </Svg>
  );
}

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const invalidateSession = useInvalidateSession();

  const handleSendOTP = async () => {
    if (!email.trim()) { setError('Please enter your email'); return; }
    setIsLoading(true);
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' });
    setIsLoading(false);
    if (result.error) { setError(result.error.message || 'Failed to send verification code'); }
    else { router.push({ pathname: '/verify-otp' as any, params: { email: email.trim() } }); }
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
          // Refresh the session cache so the auth guard sees the new session
          await invalidateSession();
          router.replace('/(tabs)');
        } else {
          setError('Sign in did not return a session. Please try email sign in.');
        }
      }
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        setError('Apple sign in failed. Please try again.');
      }
    } finally { setIsLoading(false); }
  };

  return (
    <View style={st.root}>
      <StatusBar barStyle="light-content" />
      <View style={[st.glow, { top: -60, alignSelf: 'center', backgroundColor: `${TEAL}10` }]} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ height: 76 }} />

          <Animated.View entering={FadeIn.delay(100).duration(500)} style={{ alignItems: 'center' }}>
            <View style={st.logoRow}>
              <View style={{ position: 'relative' }}>
                <Text style={[st.logoLetter, { position: 'absolute', left: 2.5, top: 2.5, color: '#000' }]}>CL</Text>
                <Text style={[st.logoLetter, { position: 'absolute', left: 1.2, top: 1.2, color: TEAL_DARK }]}>CL</Text>
                <Text style={st.logoLetter}>CL</Text>
              </View>
              <View style={{ marginBottom: 3, marginHorizontal: -1.5 }}>
                <View style={{ position: 'absolute', left: 2.5, top: 2.5 }}><FieldGoalU color="#000000" size={32} /></View>
                <View style={{ position: 'absolute', left: 1.2, top: 1.2 }}><FieldGoalU color={TEAL_DARK} size={32} /></View>
                <FieldGoalU color="#FFFFFF" size={32} />
              </View>
              <View style={{ position: 'relative' }}>
                <Text style={[st.logoLetter, { position: 'absolute', left: 2.5, top: 2.5, color: '#000' }]}>TCH</Text>
                <Text style={[st.logoLetter, { position: 'absolute', left: 1.2, top: 1.2, color: TEAL_DARK }]}>TCH</Text>
                <Text style={st.logoLetter}>TCH</Text>
              </View>
            </View>
            <View style={st.picksBadge}>
              <Text style={st.picksText}>PICKS</Text>
            </View>
          </Animated.View>

          <View style={{ height: 24 }} />

          <Animated.View entering={FadeInDown.delay(200).duration(400)}>
            <Text style={st.headline}>Make Smarter Picks</Text>
            <View style={{ height: 8 }} />
            <Text style={st.subtitle}>AI predictions across NFL, NBA, MLB & more.{'\n'}Track your record and prove your sports IQ.</Text>
          </Animated.View>

          <View style={{ height: 24 }} />

          <Animated.View entering={FadeInDown.delay(300).duration(400)} style={st.pillRow}>
            {([
              { icon: <TargetIcon size={20} />, label: 'AI Picks' },
              { icon: <ChartIcon size={20} />, label: 'Track Stats' },
              { icon: <BoltIcon size={20} />, label: 'Live Scores' },
            ] as const).map((f) => (
              <View key={f.label} style={st.pill}>
                {f.icon}
                <Text style={st.pillLabel}>{f.label}</Text>
              </View>
            ))}
          </Animated.View>

          <View style={{ flex: 1, minHeight: 40 }} />

          {error ? <Text style={st.error}>{error}</Text> : null}

          <Animated.View entering={FadeInDown.delay(400).duration(400)}>
            {!showEmailForm ? (
              <View style={{ gap: 12 }}>
                <TouchableOpacity onPress={handleAppleSignIn} disabled={isLoading} activeOpacity={0.85} style={[st.appleBtn, { opacity: isLoading ? 0.7 : 1 }]}>
                  <AppleLogo size={18} />
                  <Text style={st.appleBtnText}>Continue with Apple</Text>
                </TouchableOpacity>

                <View style={st.divider}>
                  <View style={st.dividerLine} />
                  <Text style={st.dividerText}>or</Text>
                  <View style={st.dividerLine} />
                </View>

                <TouchableOpacity onPress={() => setShowEmailForm(true)} disabled={isLoading} activeOpacity={0.85} style={[st.emailBtn, { opacity: isLoading ? 0.7 : 1 }]}>
                  <EnvelopeIcon size={18} />
                  <Text style={st.emailBtnText}>Continue with Email</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <View style={[st.inputContainer, error ? { borderColor: '#EF4444' } : {}]}>
                  <EnvelopeIcon size={18} />
                  <TextInput
                    style={st.input}
                    placeholder="your@email.com"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChangeText={(t) => { setEmail(t); setError(null); }}
                    editable={!isLoading}
                  />
                </View>
                <View style={{ height: 16 }} />
                <TouchableOpacity onPress={handleSendOTP} disabled={isLoading} activeOpacity={0.85} style={[st.sendBtn, { opacity: isLoading ? 0.7 : 1 }]}>
                  <Text style={st.sendBtnText}>{isLoading ? 'Sending...' : 'Send Code'}</Text>
                </TouchableOpacity>
                <View style={{ height: 16 }} />
                <Pressable onPress={() => { setShowEmailForm(false); setEmail(''); setError(null); }}>
                  <Text style={{ color: CORAL, textAlign: 'center', fontSize: 14, fontWeight: '600' }}>← Back to sign in options</Text>
                </Pressable>
              </View>
            )}
          </Animated.View>

          <View style={{ height: 16 }} />

          <Text style={st.terms}>
            By continuing, you agree to our{' '}
            <Text style={st.termsLink} onPress={() => router.push('/terms' as any)}>Terms</Text>
            {' & '}
            <Text style={st.termsLink} onPress={() => router.push('/privacy-policy' as any)}>Privacy Policy</Text>
          </Text>

          <View style={{ height: 36 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  glow: { position: 'absolute', width: 300, height: 300, borderRadius: 150 },
  logoRow: { flexDirection: 'row', alignItems: 'flex-end' },
  logoLetter: { fontSize: 32, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2, lineHeight: 36 },
  picksBadge: { backgroundColor: 'rgba(90,122,138,0.35)', borderWidth: 2, borderColor: TEAL_DARK, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 6, marginTop: 8 },
  picksText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF', letterSpacing: 4 },
  headline: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 20 },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, backgroundColor: `${CORAL}0A`, borderWidth: 1, borderColor: `${CORAL}1A`, alignItems: 'center', gap: 5 },
  pillLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  error: { color: '#EF4444', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  appleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, height: 54, gap: 8 },
  appleBtnText: { fontSize: 16, fontWeight: '600', color: '#000000' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  dividerText: { fontSize: 11, color: 'rgba(255,255,255,0.25)' },
  emailBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, height: 54, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  emailBtnText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 16, gap: 12 },
  input: { flex: 1, paddingVertical: 16, color: '#FFFFFF', fontSize: 16 },
  sendBtn: { backgroundColor: TEAL_DARK, borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  terms: { fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center' },
  termsLink: { color: `${TEAL}90`, textDecorationLine: 'underline' as const },
});
