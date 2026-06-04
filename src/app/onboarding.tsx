import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Dimensions, TextInput, Image,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { HapticPressable } from '@/components/HapticPressable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  FadeIn, FadeInDown, FadeInRight, FadeOutLeft, SlideInRight, SlideOutLeft,
  useSharedValue, useAnimatedStyle,
  withSpring, withTiming, withSequence, withRepeat, withDelay,
  interpolate, Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle, Line, Rect } from 'react-native-svg';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { getTeamColors } from '@/lib/team-colors';
import { Sport } from '@/types/sports';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { pickImage, takePhoto } from '@/lib/file-picker';
import { uploadFile } from '@/lib/upload';
import { api } from '@/lib/api/api';
import { setDisplayName as setRevenueCatDisplayName } from '@/lib/revenuecatClient';
import { ArenaScoreboard } from '@/components/sports/ArenaScoreboard';
import { FeedbackModal } from '@/components/FeedbackModal';
import { PhotoSourceModal } from '@/components/PhotoSourceModal';

const { width: W } = Dimensions.get('window');

const BG = '#040608';
const MAROON = '#8B0A1F';
const TEAL = '#7A9DB8';
const GREEN = '#4ADE80';
const RED = '#DC2626';
const ERROR = '#EF4444';
const WHITE = '#FFFFFF';
const TEXT_SEC = '#A1B3C9';
const TEXT_MUT = '#6B7C94';
const GLASS = 'rgba(255,255,255,0.02)';
const BORDER = 'rgba(255,255,255,0.06)';

// ─── PROGRESS BAR ─────────────────────────────────────────────
function ProgressBar({ step }: { step: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 40, paddingTop: 16 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <View key={i} style={{
          flex: 1, height: 3, borderRadius: 2, overflow: 'hidden',
          backgroundColor: i > step ? 'rgba(255,255,255,0.06)' : undefined,
        }}>
          {i <= step ? (
            <LinearGradient colors={i < step ? [MAROON, TEAL] : [MAROON, MAROON]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 2 }} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ─── PULSING DOT ──────────────────────────────────────────────
function PulsingDot({ color = RED, size = 6 }: { color?: string; size?: number }) {
  const op = useSharedValue(1);
  useEffect(() => {
    op.value = withRepeat(withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const s = useAnimatedStyle(() => ({ opacity: op.value }));
  return <Animated.View style={[s, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />;
}

// ─── FLOATING PARTICLE ───────────────────────────────────────
const PARTICLES = [
  { x: '5%',  startY: 90, size: 5,   color: TEAL,   dur: 10000, delay: 0,    drift: 25 },
  { x: '15%', startY: 95, size: 4,   color: MAROON, dur: 12000, delay: 800,  drift: -18 },
  { x: '25%', startY: 85, size: 6,   color: TEAL,   dur: 11000, delay: 1500, drift: 30 },
  { x: '35%', startY: 92, size: 3.5, color: MAROON, dur: 14000, delay: 300,  drift: -22 },
  { x: '45%', startY: 88, size: 5.5, color: TEAL,   dur: 9000,  delay: 2000, drift: 20 },
  { x: '55%', startY: 96, size: 4.5, color: TEAL,   dur: 13000, delay: 600,  drift: -28 },
  { x: '65%', startY: 82, size: 6,   color: MAROON, dur: 10000, delay: 1200, drift: 15 },
  { x: '75%', startY: 90, size: 4,   color: TEAL,   dur: 11000, delay: 2500, drift: -20 },
  { x: '85%', startY: 94, size: 5,   color: TEAL,   dur: 12000, delay: 400,  drift: 26 },
  { x: '95%', startY: 86, size: 3.5, color: MAROON, dur: 14000, delay: 1800, drift: -15 },
  { x: '10%', startY: 98, size: 4,   color: TEAL,   dur: 8000,  delay: 3000, drift: 18 },
  { x: '30%', startY: 80, size: 5,   color: MAROON, dur: 15000, delay: 500,  drift: -24 },
  { x: '50%', startY: 93, size: 7,   color: TEAL,   dur: 9500,  delay: 1000, drift: 22 },
  { x: '70%', startY: 88, size: 4.5, color: TEAL,   dur: 11500, delay: 2200, drift: -16 },
  { x: '90%', startY: 91, size: 5.5, color: MAROON, dur: 10500, delay: 700,  drift: 20 },
  { x: '20%', startY: 97, size: 3,   color: TEAL,   dur: 13500, delay: 3500, drift: -12 },
  { x: '40%', startY: 84, size: 6,   color: MAROON, dur: 8500,  delay: 1600, drift: 28 },
  { x: '60%', startY: 99, size: 4,   color: TEAL,   dur: 12500, delay: 900,  drift: -20 },
  { x: '80%', startY: 87, size: 5,   color: TEAL,   dur: 9000,  delay: 2800, drift: 18 },
  { x: '48%', startY: 76, size: 4.5, color: MAROON, dur: 16000, delay: 200,  drift: -25 },
] as const;

function FloatingParticle({ x, startY, size, color, dur, delay, drift }: typeof PARTICLES[number]) {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(0);

  const runCycle = useCallback(() => {
    'worklet';
    // Reset position invisibly (particle is already at opacity 0)
    translateY.value = 0;
    translateX.value = 0;
    opacity.value = 0;
    // Float upward — travel far enough that it crosses entire screen
    translateY.value = withTiming(-1200, { duration: dur, easing: Easing.linear });
    // Drift sideways
    translateX.value = withRepeat(
      withTiming(drift, { duration: dur * 0.4, easing: Easing.inOut(Easing.ease) }), -1, true
    );
    // Fade: invisible → bright → hold → invisible
    // Fade out completes at 85% of travel, giving 15% invisible buffer before reset
    opacity.value = withSequence(
      withTiming(1, { duration: dur * 0.10, easing: Easing.out(Easing.ease) }),
      withTiming(0.6, { duration: dur * 0.55, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: dur * 0.20, easing: Easing.in(Easing.ease) }),
    );
  }, [dur, drift]);

  useEffect(() => {
    // Initial delay then start seamless loop
    let interval: ReturnType<typeof setInterval> | null = null;
    const timer = setTimeout(() => {
      runCycle();
      interval = setInterval(runCycle, dur);
    }, delay);
    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [delay, dur, runCycle]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[{
      position: 'absolute', left: x, top: `${startY}%`,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color,
      shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: size * 5,
    }, style]} pointerEvents="none" />
  );
}

// ─── STEP 0: WELCOME ─────────────────────────────────────────
function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  // Two ambient gradients that slowly cross-fade
  const glow1Op = useSharedValue(0.08);
  const glow2Op = useSharedValue(0.03);
  // Grid lines that pulse subtly
  const gridOp = useSharedValue(0.3);

  useEffect(() => {
    // Cross-fading glows
    glow1Op.value = withRepeat(withTiming(0.06, { duration: 5000, easing: Easing.inOut(Easing.ease) }), -1, true);
    glow2Op.value = withRepeat(withTiming(0.14, { duration: 6000, easing: Easing.inOut(Easing.ease) }), -1, true);
    // Grid breathes
    gridOp.value = withRepeat(withTiming(0.5, { duration: 4000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);

  const glow1Style = useAnimatedStyle(() => ({ opacity: glow1Op.value }));
  const glow2Style = useAnimatedStyle(() => ({ opacity: glow2Op.value }));
  const gridStyle = useAnimatedStyle(() => ({ opacity: gridOp.value }));

  return (
    <View style={{ flex: 1 }}>
      {/* Breathing grid */}
      <Animated.View style={[StyleSheet.absoluteFillObject, gridStyle]} pointerEvents="none">
        <Svg width={W} height={800} style={StyleSheet.absoluteFillObject}>
          {Array.from({ length: 40 }).map((_, i) => (
            <Path key={`h${i}`} d={`M0 ${i * 20} L${W} ${i * 20}`} stroke="rgba(255,255,255,0.02)" strokeWidth={0.5} />
          ))}
          {Array.from({ length: 20 }).map((_, i) => (
            <Path key={`v${i}`} d={`M${i * 20} 0 L${i * 20} 800`} stroke="rgba(255,255,255,0.02)" strokeWidth={0.5} />
          ))}
        </Svg>
      </Animated.View>

      {/* Cross-fading ambient glows — maroon top-right, teal bottom-left */}
      <Animated.View style={[{ position: 'absolute', top: '10%', right: '-15%', width: 350, height: 350 }, glow1Style]} pointerEvents="none">
        <LinearGradient colors={['rgba(139,10,31,0.25)', 'transparent']} style={{ flex: 1, borderRadius: 175 }} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', bottom: '15%', left: '-15%', width: 350, height: 350 }, glow2Style]} pointerEvents="none">
        <LinearGradient colors={['rgba(122,157,184,0.20)', 'transparent']} style={{ flex: 1, borderRadius: 175 }} />
      </Animated.View>

      {/* Floating illuminated particles */}
      {PARTICLES.map((p, i) => <FloatingParticle key={i} {...p} />)}

      {/* Logo — upper portion */}
      <View style={{ paddingTop: '35%', alignItems: 'center' }}>
        <Animated.View entering={FadeIn.delay(300).duration(800)}>
          <Image source={require('@/assets/clutch-logo-horizontal.png')} style={{ width: 300, height: 300 * (523 / 3352) }} resizeMode="contain" />
        </Animated.View>
      </View>

      {/* Welcome text — lower */}
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 32, paddingBottom: 24 }}>
        <Animated.View entering={FadeIn.delay(600).duration(600)} style={{ width: 50, height: 1.5, borderRadius: 1, backgroundColor: TEAL, opacity: 0.4, marginBottom: 20 }} />

        <Animated.Text entering={FadeInDown.delay(700).duration(500)} style={{ fontSize: 26, fontWeight: '800', color: WHITE, textAlign: 'center', letterSpacing: -0.3, lineHeight: 32 }}>
          Welcome to Your{'\n'}Game Day Engagement Center
        </Animated.Text>
      </View>

      <View style={{ paddingHorizontal: 28, paddingBottom: 40, paddingTop: 28 }}>
        <Animated.View entering={FadeInDown.delay(1000).duration(500)}>
          <HapticPressable hapticStyle="light" onPress={onContinue} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <LinearGradient colors={[TEAL, '#5A7A8A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: TEAL, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Let's Get Started</Text>
            </LinearGradient>
          </HapticPressable>
        </Animated.View>
      </View>
    </View>
  );
}

// ─── STEP 1: PICK YOUR WINNER ─────────────────────────────────
function PickStep({ picked, setPicked, onContinue, onSkip, onBack }: {
  picked: 'home' | 'away' | null; setPicked: (v: 'home' | 'away') => void; onContinue: () => void; onSkip: () => void; onBack: () => void;
}) {
  const homeScale = useSharedValue(1);
  const awayScale = useSharedValue(1);
  const homeColors = getTeamColors('CHI', Sport.NBA);
  const awayColors = getTeamColors('MIN', Sport.NBA);
  const jerseyType = sportEnumToJersey('NBA');

  const doPick = useCallback((team: 'home' | 'away') => {
    setPicked(team);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const target = team === 'home' ? homeScale : awayScale;
    const other = team === 'home' ? awayScale : homeScale;
    target.value = withSequence(withSpring(0.88, { damping: 15 }), withSpring(1.05, { damping: 12 }), withSpring(1, { damping: 10 }));
    other.value = withSpring(0.85, { damping: 12 });
  }, []);

  const homeStyle = useAnimatedStyle(() => ({ transform: [{ scale: homeScale.value }] }));
  const awayStyle = useAnimatedStyle(() => ({ transform: [{ scale: awayScale.value }] }));

  return (
    <View style={{ flex: 1 }}>
      <ProgressBar step={1} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 4 }}>
        <HapticPressable hapticStyle="light" onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </HapticPressable>
        <HapticPressable hapticStyle="light" onPress={onSkip} style={{ padding: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.25)' }}>Skip</Text>
        </HapticPressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 20 }}>
        <Animated.Text entering={FadeInDown.duration(400)} style={{ fontSize: 26, fontWeight: '900', color: WHITE, textAlign: 'center', marginBottom: 6 }}>
          Pick Your Winner
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={{ fontSize: 13, color: TEXT_MUT, textAlign: 'center', marginBottom: 28 }}>
          Tap the jersey you think wins tonight
        </Animated.Text>

        {/* Matchup card */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ width: '100%', borderRadius: 20, overflow: 'hidden', backgroundColor: GLASS, borderWidth: 1, borderColor: BORDER }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14 }}>
            <View style={{ backgroundColor: 'rgba(122,157,184,0.15)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(122,157,184,0.3)' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: WHITE }}>NBA</Text>
            </View>
            <Text style={{ fontSize: 10, color: TEXT_MUT }}>Tonight 7:00 PM</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 }}>
            <HapticPressable hapticStyle="medium" onPress={() => doPick('home')}>
              <Animated.View style={[homeStyle, { alignItems: 'center', opacity: picked === 'away' ? 0.35 : 1 }]}>
                <View style={picked === 'home' ? { shadowColor: MAROON, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } } : {}}>
                  <JerseyIcon teamCode="CHI" teamName="Chicago Bulls" primaryColor={homeColors.primary} secondaryColor={homeColors.secondary} size={86} sport={jerseyType} />
                </View>
                {picked === 'home' ? (
                  <View style={{ position: 'absolute', bottom: -3, right: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: MAROON, borderWidth: 2.5, borderColor: BG, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: WHITE }}>✓</Text>
                  </View>
                ) : null}
                <Text style={{ fontSize: 13, fontWeight: '700', color: picked === 'away' ? 'rgba(255,255,255,0.3)' : WHITE, marginTop: 6 }}>Bulls</Text>
                <Text style={{ fontSize: 10, color: TEXT_MUT }}>30-34</Text>
              </Animated.View>
            </HapticPressable>

            <View style={{ alignItems: 'center', paddingBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 48, fontFamily: 'VT323_400Regular', color: WHITE, letterSpacing: 2, lineHeight: 52 }}>0</Text>
                <Text style={{ fontSize: 22, color: 'rgba(255,255,255,0.20)', fontWeight: '300', lineHeight: 52 }}>-</Text>
                <Text style={{ fontSize: 48, fontFamily: 'VT323_400Regular', color: WHITE, letterSpacing: 2, lineHeight: 52 }}>0</Text>
              </View>
              <Text style={{ fontSize: 11, fontFamily: 'VT323_400Regular', color: 'rgba(255,255,255,0.30)', letterSpacing: 3, marginTop: 4 }}>SCHEDULED</Text>
            </View>

            <HapticPressable hapticStyle="medium" onPress={() => doPick('away')}>
              <Animated.View style={[awayStyle, { alignItems: 'center', opacity: picked === 'home' ? 0.35 : 1 }]}>
                <View style={picked === 'away' ? { shadowColor: MAROON, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } } : {}}>
                  <JerseyIcon teamCode="MIN" teamName="Minnesota Timberwolves" primaryColor={awayColors.primary} secondaryColor={awayColors.secondary} size={86} sport={jerseyType} />
                </View>
                {picked === 'away' ? (
                  <View style={{ position: 'absolute', bottom: -3, right: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: MAROON, borderWidth: 2.5, borderColor: BG, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: WHITE }}>✓</Text>
                  </View>
                ) : null}
                <Text style={{ fontSize: 13, fontWeight: '700', color: picked === 'home' ? 'rgba(255,255,255,0.3)' : WHITE, marginTop: 6 }}>T-Wolves</Text>
                <Text style={{ fontSize: 10, color: TEXT_MUT }}>40-24</Text>
              </Animated.View>
            </HapticPressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 }}>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEAL }}>Pick saved</Text>
            </View>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 }}>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEXT_MUT }}>Game card ready</Text>
            </View>
          </View>
        </Animated.View>

        {picked ? (
          <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: 'center', marginTop: 20 }}>
            <Text style={{ fontSize: 13, color: TEXT_SEC }}>Nice pick! That's all it takes.</Text>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', marginTop: 8 }}>Tap the other jersey to switch</Text>
          </Animated.View>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 28, paddingBottom: 40 }}>
        <HapticPressable hapticStyle="light" onPress={onContinue} disabled={!picked} style={({ pressed }) => ({ opacity: !picked ? 0.3 : pressed ? 0.9 : 1, transform: [{ scale: pressed && picked ? 0.98 : 1 }] })}>
          <LinearGradient
            colors={picked ? [MAROON, '#6A0818'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.04)']}
            style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 16, fontWeight: '800', color: picked ? WHITE : 'rgba(255,255,255,0.15)', letterSpacing: 0.5 }}>Continue</Text>
          </LinearGradient>
        </HapticPressable>
      </View>
    </View>
  );
}

// ─── STEP 2: AI PREDICTIONS ───────────────────────────────────
function AIPredictionsStep({ onContinue, onSkip, onBack, picked }: { onContinue: () => void; onSkip: () => void; onBack: () => void; picked: 'home' | 'away' | null }) {
  const pickedCode = picked === 'home' ? 'CHI' : 'MIN';
  const pickedName = picked === 'home' ? 'Bulls' : 'Timberwolves';
  const opponentCode = picked === 'home' ? 'MIN' : 'CHI';
  const opponentName = picked === 'home' ? 'Timberwolves' : 'Bulls';
  const pickedColors = getTeamColors(pickedCode, Sport.NBA);
  const jerseyType = sportEnumToJersey('NBA');

  // Rotating border animation — matches real TopPickCard
  const rotation = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  useEffect(() => {
    rotation.value = withTiming(360000, { duration: 360000 / 360 * 4500, easing: Easing.linear });
    glowPulse.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const rotatingStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value % 360}deg` }] }));
  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(glowPulse.value, [0, 1], [0.25, 0.5]),
    shadowRadius: interpolate(glowPulse.value, [0, 1], [10, 22]),
  }));

  return (
    <View style={{ flex: 1 }}>
      <ProgressBar step={2} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 4 }}>
        <HapticPressable hapticStyle="light" onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </HapticPressable>
        <HapticPressable hapticStyle="light" onPress={onSkip} style={{ padding: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.25)' }}>Skip</Text>
        </HapticPressable>
      </View>

      <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 }} style={{ flex: 1 }}>
        <Animated.Text entering={FadeInDown.duration(400)} style={{ fontSize: 26, fontWeight: '900', color: WHITE, textAlign: 'center', marginBottom: 6 }}>
          Premium Pick Reads
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={{ fontSize: 13, color: TEXT_MUT, textAlign: 'center', marginBottom: 28 }}>
          Reveal confidence, matchup context, and the full model read
        </Animated.Text>

        {/* Clutch Pick card — with rotating shimmer border */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ width: '100%' }}>
          <Animated.View style={[{ borderRadius: 22, shadowColor: '#C0C8D0', shadowOffset: { width: 0, height: 0 } }, glowStyle]}>
            <View style={{ borderRadius: 22, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 20 }}>
              <View style={{ borderRadius: 22, overflow: 'hidden' }}>
                <LinearGradient colors={['#C0C8D0', '#8A929A', '#D4D8DC', '#8A929A', '#C0C8D0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
                <Animated.View style={[{ position: 'absolute', top: -100, left: -100, right: -100, bottom: -100 }, rotatingStyle]}>
                  <LinearGradient colors={['transparent', 'transparent', 'rgba(122,157,184,0.7)', '#7A9DB8', 'rgba(122,157,184,0.7)', 'transparent', 'transparent']} locations={[0, 0.35, 0.42, 0.5, 0.58, 0.65, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: '50%' }} />
                  <LinearGradient colors={['transparent', 'transparent', 'rgba(90,6,20,0.7)', '#8B0A1F', 'rgba(90,6,20,0.7)', 'transparent', 'transparent']} locations={[0, 0.35, 0.42, 0.5, 0.58, 0.65, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ position: 'absolute', top: '50%', left: 0, right: 0, bottom: 0 }} />
                </Animated.View>
                <View style={{ margin: 3, borderRadius: 18, overflow: 'hidden', backgroundColor: '#182028' }}>
                  <View style={{ padding: 18 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <View style={{ backgroundColor: MAROON, width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 12, fontWeight: '900', color: WHITE }}>#1</Text>
                      </View>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>CLUTCH PICK</Text>
                      <View style={{ marginLeft: 'auto', backgroundColor: 'rgba(122,157,184,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                        <Text style={{ fontSize: 9, fontWeight: '700', color: TEAL }}>NBA</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                      <JerseyIcon teamCode={pickedCode} teamName={pickedName} primaryColor={pickedColors.primary} secondaryColor={pickedColors.secondary} size={52} sport={jerseyType} />
                      <View>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: WHITE }}>{pickedName}</Text>
                        <Text style={{ fontSize: 11, color: TEXT_MUT, marginTop: 2 }}>vs {opponentCode} {opponentName}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: TEXT_MUT, letterSpacing: 1.5 }}>PICK READ</Text>
                      <View style={{ backgroundColor: 'rgba(122,157,184,0.08)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(122,157,184,0.19)' }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: TEAL }}>Lean Pick</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 3, height: 5, marginBottom: 16 }}>
                      {Array.from({ length: 10 }).map((_, i) => (
                        <View key={i} style={{ flex: 1, borderRadius: 2, overflow: 'hidden' }}>
                          {i < 6 ? (
                            <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 2 }} />
                          ) : (
                            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 2 }} />
                          )}
                        </View>
                      ))}
                    </View>
                    <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)', paddingTop: 14 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <View style={{ width: 3, height: 12, borderRadius: 1.5, backgroundColor: TEAL }} />
                        <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>THE SIGNAL</Text>
                      </View>
                      <View style={{ gap: 8 }}>
                        {[
                          { label: 'Recent Form', value: 0.8, color: TEAL },
                          { label: 'Matchup Context', value: 0.65, color: MAROON },
                          { label: 'Venue Split', value: 0.45, color: TEAL },
                        ].map((f, i) => (
                          <View key={i}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                              <Text style={{ fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }}>{f.label}</Text>
                              <Text style={{ fontSize: 10, fontWeight: '800', color: f.color }}>{Math.round(f.value * 100)}%</Text>
                            </View>
                            <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.04)' }}>
                              <LinearGradient colors={[f.color, `${f.color}88`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${f.value * 100}%`, height: '100%', borderRadius: 2 }} />
                            </View>
                          </View>
                        ))}
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(122,157,184,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(122,157,184,0.25)' }}>
                          <Text style={{ fontSize: 11, fontWeight: '600', color: TEAL }}>Preview details</Text>
                          <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
                            <Path d="M9 18l6-6-6-6" stroke={TEAL} strokeWidth={2.5} strokeLinecap="round" />
                          </Svg>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </Animated.View>
        </Animated.View>

        {/* Confidence Tier Legend — glass tiles */}
        <Animated.View entering={FadeInDown.delay(500).duration(500)} style={{ width: '100%', marginTop: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ width: 3, height: 14, borderRadius: 1.5 }} />
            <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>CONFIDENCE LANGUAGE</Text>
          </View>
          <View style={{ gap: 8 }}>
            {[
              { range: '< 53%', label: 'Considered a Toss-Up', desc: 'No clean edge from the model', accent: 'rgba(255,255,255,0.15)' },
              { range: '53–59%', label: 'Considered a Lean Pick', desc: 'Narrow edge detected by the model', accent: 'rgba(122,157,184,0.22)' },
              { range: '60–66%', label: 'Considered a Solid Pick', desc: 'Usable separation across core factors', accent: 'rgba(122,157,184,0.32)' },
              { range: '67–74%', label: 'Considered a Strong Pick', desc: 'Strong model agreement and data depth', accent: 'rgba(139,10,31,0.25)' },
              { range: '75%+', label: 'Considered a Lock', desc: 'Dominant edge across all factors', accent: 'rgba(139,10,31,0.35)' },
            ].map((tier, i) => (
              <Animated.View key={i} entering={FadeInDown.delay(550 + i * 60).duration(400)}>
                <View style={{
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  borderRadius: 14,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.06)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  overflow: 'hidden',
                }}>
                  {/* Left accent */}
                  <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: tier.accent, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 }} />
                  {/* Range badge */}
                  <View style={{ backgroundColor: tier.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginRight: 12, minWidth: 54, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: WHITE }}>{tier.range}</Text>
                  </View>
                  {/* Label + description */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: TEAL, letterSpacing: 0.3 }}>{tier.label}</Text>
                    <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2, lineHeight: 14 }}>{tier.desc}</Text>
                  </View>
                </View>
              </Animated.View>
            ))}
          </View>
        </Animated.View>

        <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', marginTop: 16 }}>
          For entertainment only. Not gambling advice.
        </Text>
      </Animated.ScrollView>

      <View style={{ paddingHorizontal: 28, paddingBottom: 40 }}>
        <HapticPressable hapticStyle="light" onPress={onContinue} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <LinearGradient colors={[MAROON, '#6A0818']} style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Continue</Text>
          </LinearGradient>
        </HapticPressable>
      </View>
    </View>
  );
}

function ProFeaturePill({ accent = TEAL }: { accent?: string }) {
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(122,157,184,0.10)', borderWidth: 1, borderColor: 'rgba(180,211,235,0.20)' }}>
      <Text style={{ fontSize: 9, lineHeight: 11, fontWeight: '900', color: accent, letterSpacing: 1.1 }}>PRO FEATURE</Text>
    </View>
  );
}

// ─── STEP 3: MY ARENA ────────────────────────────────────────
function ArenaStep({ subPage, onContinue, onSkip, onBack }: { subPage: number; onContinue: () => void; onSkip: () => void; onBack: () => void }) {
  const labels = ['Game Day', 'Prep Mode', 'Review'];

  return (
    <View style={{ flex: 1 }}>
      <ProgressBar step={3} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 4 }}>
        <HapticPressable hapticStyle="light" onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </HapticPressable>
        <HapticPressable hapticStyle="light" onPress={onSkip} style={{ padding: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.25)' }}>Skip</Text>
        </HapticPressable>
      </View>

      <View style={{ flex: 1, paddingTop: 12 }}>
        <Animated.Text entering={FadeInDown.duration(400)} style={{ fontSize: 26, fontWeight: '900', color: WHITE, textAlign: 'center', marginBottom: 6 }}>
          My Arena
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={{ fontSize: 13, color: TEXT_MUT, textAlign: 'center', marginBottom: 20 }}>
          Your personalized engagement center
        </Animated.Text>

        {/* Segmented control */}
        <View style={{ flexDirection: 'row', marginHorizontal: 24, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 3, marginBottom: 20, borderWidth: 1, borderColor: BORDER }}>
          {labels.map((l, i) => (
            <View key={l} style={{ flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: i === subPage ? MAROON : 'transparent', borderRadius: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: i === subPage ? WHITE : TEXT_MUT }}>{l}</Text>
            </View>
          ))}
        </View>

        {/* Sub-page content */}
        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 14 }}
          showsVerticalScrollIndicator={false}
        >
          {subPage === 0 ? <ArenaGameDay /> : null}
          {subPage === 1 ? <ArenaPrepMode /> : null}
          {subPage === 2 ? <ArenaReview /> : null}
        </Animated.ScrollView>

        {/* Page dots */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: 12 }}>
          {[0, 1, 2].map(i => (
            <View key={i} style={{ width: i === subPage ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === subPage ? MAROON : 'rgba(255,255,255,0.12)' }} />
          ))}
        </View>
      </View>

      <View style={{ paddingHorizontal: 28, paddingBottom: 40 }}>
        <HapticPressable hapticStyle="light" onPress={onContinue} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <LinearGradient
            colors={subPage === 2 ? [MAROON, '#6A0818'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.06)']}
            style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: subPage < 2 ? 1 : 0, borderColor: BORDER }}
          >
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>
              {subPage < 2 ? 'Swipe to see more →' : 'Continue'}
            </Text>
          </LinearGradient>
        </HapticPressable>
      </View>
    </View>
  );
}

function ArenaGameDay() {
  const minColors = getTeamColors('MIN', Sport.NBA);
  const chiColors = getTeamColors('CHI', Sport.NBA);
  const jerseyType = sportEnumToJersey('NBA');
  const momentumBars = [0.34, 0.48, 0.66, 0.78, 0.95, 0.74, 0.58];

  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 2 }}>
        <View>
          <Text style={{ fontSize: 9, fontWeight: '900', color: RED, letterSpacing: 2, marginBottom: 4 }}>LIVE FEED</Text>
          <Text style={{ fontSize: 20, lineHeight: 24, fontWeight: '900', color: WHITE }}>Live board</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.20)' }}>
          <PulsingDot size={6} />
          <Text style={{ fontSize: 9, fontWeight: '900', color: RED, letterSpacing: 1.1, marginLeft: 6 }}>3 LIVE</Text>
        </View>
      </View>

      <View style={{ borderRadius: 24, padding: 2, overflow: 'hidden' }}>
        <LinearGradient
          colors={[`${minColors.primary}90`, `${minColors.primary}44`, '#080C12', `${chiColors.primary}44`, `${chiColors.primary}90`]}
          locations={[0, 0.18, 0.5, 0.82, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={{ borderRadius: 22, padding: 1, overflow: 'hidden' }}>
          <LinearGradient
            colors={[`${minColors.primary}55`, 'rgba(255,255,255,0.10)', '#080C12', `${chiColors.primary}48`]}
            locations={[0, 0.24, 0.58, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={{ borderRadius: 21, overflow: 'hidden' }}>
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(4,5,10,0.92)' }]} />
            <LinearGradient colors={[`${minColors.primary}80`, `${minColors.primary}24`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.72, y: 0.8 }} style={StyleSheet.absoluteFillObject} />
            <LinearGradient colors={[`${chiColors.primary}70`, `${chiColors.primary}24`, 'transparent']} start={{ x: 1, y: 1 }} end={{ x: 0.28, y: 0.2 }} style={StyleSheet.absoluteFillObject} />

            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(239,68,68,0.24)' }}>
                  <PulsingDot size={5} />
                  <Text style={{ color: RED, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginLeft: 6 }}>LIVE</Text>
                </View>
                <View style={{ backgroundColor: 'rgba(122,157,184,0.12)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(122,157,184,0.22)' }}>
                  <Text style={{ fontSize: 9, fontWeight: '900', color: 'rgba(224,234,240,0.88)', letterSpacing: 0.6 }}>NBA</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ width: 78, alignItems: 'center' }}>
                  <JerseyIcon teamCode="MIN" teamName="Minnesota Timberwolves" primaryColor={minColors.primary} secondaryColor={minColors.secondary} size={52} sport={jerseyType} />
                  <Text style={{ fontSize: 12, lineHeight: 14, fontWeight: '900', color: WHITE, marginTop: 5 }}>MIN</Text>
                  <Text style={{ fontSize: 10, color: TEXT_MUT, fontWeight: '700', marginTop: 1 }}>40-24</Text>
                </View>

                <View style={{ width: 132, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}>
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: RED, marginRight: 5 }} />
                    <Text style={{ color: '#b8c3d1', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }}>
                      Q3 5:42
                    </Text>
                  </View>
                  <ArenaScoreboard
                    awayScore={67}
                    homeScore={58}
                    awayColor={minColors.primary}
                    homeColor={chiColors.primary}
                    displayText="67-58"
                    scale={0.84}
                  />
                </View>

                <View style={{ width: 78, alignItems: 'center' }}>
                  <JerseyIcon teamCode="CHI" teamName="Chicago Bulls" primaryColor={chiColors.primary} secondaryColor={chiColors.secondary} size={52} sport={jerseyType} />
                  <Text style={{ fontSize: 12, lineHeight: 14, fontWeight: '900', color: WHITE, marginTop: 5 }}>CHI</Text>
                  <Text style={{ fontSize: 10, color: TEXT_MUT, fontWeight: '700', marginTop: 1 }}>30-34</Text>
                </View>
              </View>

              <LinearGradient
                colors={['transparent', 'rgba(122,157,184,0.20)', 'rgba(255,255,255,0.08)', 'rgba(139,10,31,0.14)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ height: 1, marginVertical: 12 }}
              />

              <View style={{ flexDirection: 'row', gap: 9 }}>
                <View style={{ flex: 1, minHeight: 66, borderRadius: 15, backgroundColor: 'rgba(2,5,12,0.72)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.18)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
                  <Text style={{ fontSize: 8, fontWeight: '900', color: 'rgba(180,211,235,0.60)', letterSpacing: 1.5, marginBottom: 5 }}>YOUR PICK</Text>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: WHITE }}>MIN</Text>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: GREEN, marginTop: 3 }}>Up 9</Text>
                </View>
                <View style={{ flex: 1, minHeight: 66, borderRadius: 15, backgroundColor: 'rgba(2,5,12,0.72)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.18)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
                  <Text style={{ fontSize: 8, fontWeight: '900', color: 'rgba(180,211,235,0.60)', letterSpacing: 1.5, marginBottom: 5 }}>MOMENTUM</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 18 }}>
                    {momentumBars.map((h, i) => (
                      <View key={i} style={{ width: 5, height: Math.max(4, Math.round(h * 18)), borderRadius: 2, backgroundColor: i === 4 ? RED : h > 0.66 ? '#c8d4df' : TEAL, marginHorizontal: 1, opacity: i === 4 ? 1 : 0.78 }} />
                    ))}
                  </View>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: 'rgba(224,234,240,0.72)', marginTop: 4 }}>MIN surge</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>

      <View style={{ borderRadius: 16, padding: 1, backgroundColor: 'rgba(122,157,184,0.16)' }}>
        <View style={{ backgroundColor: 'rgba(7,10,16,0.96)', borderRadius: 15, padding: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: 'rgba(122,157,184,0.12)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: '900', color: WHITE }}>8:30</Text>
            <Text style={{ fontSize: 8, fontWeight: '800', color: TEAL, marginTop: 1 }}>PM</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: WHITE }}>DEN at MIA</Text>
            <Text style={{ fontSize: 10, color: TEXT_MUT, fontWeight: '700', marginTop: 3 }}>NBA - Kaseya Center</Text>
          </View>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path d="M9 18l6-6-6-6" stroke={TEXT_MUT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      </View>
    </Animated.View>
  );
}

function ArenaPrepMode() {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ gap: 14 }}>
      <View>
        <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '900', color: MAROON, letterSpacing: 2.1 }}>PRO TOOLS</Text>
        <Text style={{ fontSize: 20, lineHeight: 25, fontWeight: '900', color: WHITE, marginTop: 5 }}>Same arena, deeper pregame reads</Text>
      </View>

      <LinearGradient
        colors={['rgba(122,157,184,0.24)', 'rgba(255,255,255,0.08)', 'rgba(139,10,31,0.18)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 24, padding: 1 }}
      >
        <View style={{ borderRadius: 23, overflow: 'hidden', backgroundColor: 'rgba(8,10,15,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(122,157,184,0.13)', 'rgba(5,8,13,0)', 'rgba(139,10,31,0.18)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={{ padding: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <View>
                <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '900', color: 'rgba(180,211,235,0.72)', letterSpacing: 2.2 }}>DAILY MODEL BOARD</Text>
                <Text style={{ fontSize: 25, lineHeight: 30, fontWeight: '900', color: WHITE, marginTop: 5 }}>Prep Mode</Text>
              </View>
              <ProFeaturePill accent={MAROON} />
            </View>
            <Text style={{ fontSize: 12, lineHeight: 18, fontWeight: '700', color: TEXT_SEC, marginTop: 10, marginBottom: 14 }}>
              Ranked matchups, confidence context, and matchup reads before the slate opens.
            </Text>

            {[
              { rank: 1, teams: 'MIN at CHI', label: 'Solid Pick', confidence: 58, color: TEAL },
              { rank: 2, teams: 'DEN at MIA', label: 'Watchlist', confidence: 54, color: MAROON },
              { rank: 3, teams: 'NYK at BOS', label: 'Toss-up', confidence: 51, color: '#9AB8CC' },
            ].map((item, index) => (
              <View key={item.teams} style={{ borderRadius: 13, backgroundColor: 'rgba(122,157,184,0.055)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.11)', padding: 11, marginBottom: index === 2 ? 0 : 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.055)', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: item.color }}>#{item.rank}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 16, fontWeight: '900', color: WHITE }}>{item.teams}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 10, lineHeight: 13, fontWeight: '800', color: 'rgba(224,234,240,0.50)', marginTop: 2 }}>{item.label}</Text>
                  </View>
                  <Text style={{ fontSize: 16, lineHeight: 20, fontWeight: '900', color: item.color }}>{item.confidence}%</Text>
                </View>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginTop: 9 }}>
                  <View style={{ width: `${item.confidence}%` as `${number}%`, height: '100%', borderRadius: 3, backgroundColor: item.color }} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

function ArenaReview() {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ gap: 14 }}>
      <View>
        <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '900', color: TEAL, letterSpacing: 2.1 }}>POSTGAME AUDIT</Text>
        <Text style={{ fontSize: 20, lineHeight: 25, fontWeight: '900', color: WHITE, marginTop: 5 }}>Close the night with a clean recap</Text>
      </View>

      <LinearGradient
        colors={['rgba(122,157,184,0.28)', 'rgba(255,255,255,0.08)', 'rgba(139,10,31,0.14)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 24, padding: 1 }}
      >
        <View style={{ borderRadius: 23, overflow: 'hidden', backgroundColor: 'rgba(8,10,15,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(122,157,184,0.15)', 'rgba(5,8,13,0)', 'rgba(139,10,31,0.12)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={{ padding: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <View>
                <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '900', color: 'rgba(180,211,235,0.72)', letterSpacing: 2.2 }}>REVIEW</Text>
                <Text style={{ fontSize: 25, lineHeight: 30, fontWeight: '900', color: WHITE, marginTop: 5 }}>Your night, organized</Text>
              </View>
              <ProFeaturePill accent={TEAL} />
            </View>
            <Text style={{ fontSize: 12, lineHeight: 18, fontWeight: '700', color: TEXT_SEC, marginTop: 10, marginBottom: 14 }}>
              Results, accuracy, misses, and model notes stay together after final scores settle.
            </Text>
            <View style={{ borderRadius: 16, padding: 14, backgroundColor: 'rgba(2,5,12,0.52)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.12)', marginBottom: 10 }}>
              <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '900', color: 'rgba(180,211,235,0.60)', letterSpacing: 1.8 }}>YOUR NIGHT</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ fontSize: 44, lineHeight: 46, fontWeight: '900', color: WHITE }}>4-1</Text>
                <View style={{ alignItems: 'flex-end', paddingBottom: 5 }}>
                  <Text style={{ fontSize: 10, lineHeight: 13, fontWeight: '900', color: TEAL, letterSpacing: 1.1 }}>80% ACCURACY</Text>
                  <View style={{ flexDirection: 'row', marginTop: 7 }}>
                    {['W', 'W', 'W', 'L', 'W'].map((result, index) => (
                      <View key={`${result}-${index}`} style={{ width: 18, height: 5, borderRadius: 3, backgroundColor: result === 'W' ? TEAL : ERROR, opacity: result === 'W' ? 0.9 : 0.5, marginLeft: index === 0 ? 0 : 3 }} />
                    ))}
                  </View>
                </View>
              </View>
            </View>
            {[
              { label: 'Settled pick history', fill: 74, color: TEAL },
              { label: 'Model notes after finals', fill: 58, color: MAROON },
              { label: 'Season-level trends', fill: 64, color: '#9AB8CC' },
            ].map((item, index) => (
              <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, borderRadius: 11, backgroundColor: 'rgba(122,157,184,0.055)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.10)', paddingHorizontal: 10, marginBottom: index === 2 ? 0 : 8 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: item.color, marginRight: 9 }} />
                <Text style={{ flex: 1, fontSize: 11, lineHeight: 14, fontWeight: '900', color: 'rgba(224,234,240,0.74)' }}>{item.label}</Text>
                <View style={{ width: 64, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                  <View style={{ width: `${item.fill}%` as `${number}%`, height: '100%', borderRadius: 3, backgroundColor: item.color }} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

// ─── STEP 4: BUILD YOUR CARD ──────────────────────────────────
function ProfileStep({ displayName, setDisplayName, profileImage, isUploading, onPhotoPress, onContinue, onBack }: {
  displayName: string; setDisplayName: (v: string) => void; profileImage: string | null; isUploading: boolean; onPhotoPress: () => void; onContinue: () => void; onBack: () => void;
}) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}>
      <ProgressBar step={4} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 24, paddingTop: 4 }}>
        <HapticPressable hapticStyle="light" onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </HapticPressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 12 }}>
        <Animated.Text entering={FadeInDown.duration(400)} style={{ fontSize: 26, fontWeight: '900', color: WHITE, textAlign: 'center', marginBottom: 6 }}>
          Let's Build Your Card
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={{ fontSize: 13, color: TEXT_MUT, textAlign: 'center', marginBottom: 28 }}>
          Your analyst identity across the app
        </Animated.Text>

        {/* Profile card — matches real Analyst Card layout */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ width: '100%' }}>
          <View style={{ borderRadius: 24, overflow: 'hidden', borderWidth: 4, borderColor: 'rgba(255,255,255,0.14)' }}>
            {/* Background layers */}
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,8,12,0.95)' }} />
            <LinearGradient colors={['rgba(139,10,31,0.30)', 'transparent', 'transparent', 'rgba(122,157,184,0.12)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

            <View style={{ padding: 22, paddingTop: 16 }}>
              {/* Avatar + Name row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <HapticPressable hapticStyle="light" onPress={onPhotoPress}>
                  <View style={{ width: 72, height: 72, borderRadius: 36, padding: 3, overflow: 'hidden' }}>
                    <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 36 }} />
                    <View style={{ flex: 1, borderRadius: 33, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {isUploading ? (
                        <ActivityIndicator color={TEAL} />
                      ) : profileImage ? (
                        <Image source={{ uri: profileImage }} style={{ width: '100%', height: '100%' }} />
                      ) : (
                        <Text style={{ fontSize: 24, fontWeight: '800', color: WHITE }}>?</Text>
                      )}
                    </View>
                  </View>
                </HapticPressable>
                <View style={{ flex: 1 }}>
                  <TextInput
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Your name..."
                    placeholderTextColor={TEXT_MUT}
                    style={{ fontSize: 20, fontWeight: '800', color: WHITE, letterSpacing: -0.3, padding: 0 }}
                    keyboardAppearance="dark"
                    returnKeyType="done"
                  />
                  <Text style={{ fontSize: 12, color: TEXT_MUT, marginTop: 2 }}>Tap photo to add yours</Text>
                </View>
              </View>

              {/* Accuracy section */}
              <View style={{ paddingVertical: 20 }}>
                <LinearGradient colors={['transparent', 'rgba(255,255,255,0.15)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1 }} />
                <LinearGradient colors={['transparent', 'rgba(255,255,255,0.15)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1 }} />
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 52, fontWeight: '800', color: WHITE, lineHeight: 52, letterSpacing: -2 }}>0%</Text>
                  <View style={{ alignItems: 'flex-end', paddingBottom: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: TEXT_MUT, letterSpacing: 1.5 }}>ACCURACY</Text>
                  </View>
                </View>
                {/* Accuracy bar */}
                <View style={{ marginTop: 14 }}>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: '#2A3444', overflow: 'hidden' }}>
                    <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: '100%', width: '0%', borderRadius: 3 }} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 2 }}>
                    {[50, 60, 70, 80].map(m => (
                      <Text key={m} style={{ fontSize: 8, color: TEXT_MUT }}>{m}%</Text>
                    ))}
                  </View>
                </View>
              </View>

              {/* Form line — empty */}
              <View style={{ marginTop: 16 }}>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: '#2A3444' }} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ fontSize: 9, color: TEXT_MUT }}>Last 10 predictions</Text>
                  <Text style={{ fontSize: 9, fontWeight: '600', color: TEAL }}>0-0</Text>
                </View>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Name required hint — under the card */}
        {!displayName.trim() ? (
          <Animated.View entering={FadeIn.duration(400)} style={{ marginTop: 16, alignItems: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: TEAL, textAlign: 'center' }}>Enter your name above to continue</Text>
            <Text style={{ fontSize: 11, color: TEXT_MUT, textAlign: 'center', marginTop: 4 }}>Photo is optional</Text>
          </Animated.View>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 28, paddingBottom: 40 }}>
        <HapticPressable hapticStyle="light" onPress={onContinue} disabled={!displayName.trim()} style={({ pressed }) => ({ opacity: !displayName.trim() ? 0.35 : pressed ? 0.9 : 1, transform: [{ scale: pressed && displayName.trim() ? 0.98 : 1 }] })}>
          <LinearGradient colors={displayName.trim() ? [MAROON, '#6A0818'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.04)']} style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: displayName.trim() ? 0 : 1, borderColor: BORDER }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Continue</Text>
          </LinearGradient>
        </HapticPressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── STEP 5: PAYWALL BRIDGE ──────────────────────────────────
function PaywallStep({ onSubscribe, onSkip, onBack }: { onSubscribe: () => void; onSkip: () => void; onBack: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      {/* Background ambience — matches paywall */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <LinearGradient colors={['rgba(139,10,31,0.06)', 'transparent']} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 0.4 }} style={StyleSheet.absoluteFillObject} />
        <View style={{ position: 'absolute', top: '40%', right: -20, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(122,157,184,0.03)' }} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 24, paddingTop: 16 }}>
        <HapticPressable hapticStyle="light" onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </HapticPressable>
      </View>

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
        {/* CLUTCH PRO badge with gradient bar — matches paywall */}
        <Animated.View entering={FadeIn.delay(200).duration(500)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ width: 3, height: 18, borderRadius: 2 }} />
          <Text style={{ fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 2.5 }}>CLUTCH PRO</Text>
        </Animated.View>

        {/* Title — matches current paywall hero */}
        <Animated.Text entering={FadeInDown.delay(300).duration(400)} style={{ fontSize: 32, fontWeight: '900', color: WHITE, textAlign: 'center', letterSpacing: -0.5, lineHeight: 38, marginBottom: 12 }}>
          Clutch Picks Pro{'\n'}
          <Text style={{ color: TEAL }}>built for the full board.</Text>
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(400).duration(400)} style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
          Daily model boards, live intelligence, matchup reads, and postgame review in one polished layer.
        </Animated.Text>

        {/* Features — alternating maroon/teal like paywall */}
        <Animated.View entering={FadeInDown.delay(500).duration(400)} style={{ width: '100%', gap: 16 }}>
          {[
            { title: 'Daily Model Board', desc: 'Ranked picks and confidence context', accent: MAROON, bg: 'rgba(139,10,31,0.12)', border: 'rgba(139,10,31,0.15)' },
            { title: 'Live Intelligence', desc: 'Premium reads during active games', accent: TEAL, bg: 'rgba(122,157,184,0.10)', border: 'rgba(122,157,184,0.12)' },
            { title: 'Full Matchup Reads', desc: 'Factors, projections, and details', accent: MAROON, bg: 'rgba(139,10,31,0.12)', border: 'rgba(139,10,31,0.15)' },
            { title: 'Postgame Review', desc: 'Settled picks and season trends', accent: TEAL, bg: 'rgba(122,157,184,0.10)', border: 'rgba(122,157,184,0.12)' },
          ].map((f, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: f.bg, borderWidth: 1, borderColor: f.border, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: f.accent }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE }}>{f.title}</Text>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </Animated.View>
      </View>

      {/* CTA — matches paywall shimmer button style */}
      <View style={{ paddingHorizontal: 28, paddingBottom: 20 }}>
        <HapticPressable hapticStyle="medium" onPress={onSubscribe} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <LinearGradient colors={[MAROON, '#6A0818', '#5A0614']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', shadowColor: MAROON, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Start Pro</Text>
          </LinearGradient>
        </HapticPressable>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 10 }}>3-day free trial for eligible users. Price shown before purchase.</Text>
        <HapticPressable hapticStyle="light" onPress={onSkip} style={{ alignItems: 'center', paddingVertical: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: TEAL }}>Continue free</Text>
        </HapticPressable>
      </View>
    </View>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [arenaSubPage, setArenaSubPage] = useState(0);
  const [picked, setPicked] = useState<'home' | 'away' | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [photoSourceVisible, setPhotoSourceVisible] = useState(false);
  const [feedback, setFeedback] = useState<{ title: string; message: string; variant?: 'success' | 'error' | 'info' } | null>(null);
  const [tutorialReplay, setTutorialReplay] = useState(false);
  const queryClient = useQueryClient();
  const invalidateSession = useInvalidateSession();

  // Settings replay is a help tour only. It should not show profile setup or paywall.
  useEffect(() => {
    AsyncStorage.getItem('clutch_onboarding_skip_profile').then(val => {
      if (val === 'true') {
        setTutorialReplay(true);
        AsyncStorage.removeItem('clutch_onboarding_skip_profile');
      }
    });
  }, []);

  const goNext = useCallback(async () => {
    if (step === 3 && arenaSubPage < 2) {
      setArenaSubPage(arenaSubPage + 1);
      return;
    }
    if (step === 5) return;
    if (step === 3 && tutorialReplay) {
      setArenaSubPage(0);
      await AsyncStorage.setItem('clutch_onboarding_complete', 'true');
      router.replace('/(tabs)');
    } else {
      if (step === 3) setArenaSubPage(0);
      setStep(step + 1);
    }
  }, [step, arenaSubPage, tutorialReplay, router]);

  const goBack = useCallback(() => {
    if (step === 3 && arenaSubPage > 0) {
      setArenaSubPage(arenaSubPage - 1);
      return;
    }
    // Defensive: settings replay should never reach paywall, but keep it recoverable.
    if (step === 5 && tutorialReplay) {
      setStep(3);
      setArenaSubPage(2);
      return;
    }
    if (step > 0) setStep(step - 1);
    if (step === 4) setArenaSubPage(2); // return to last arena sub-page
  }, [step, arenaSubPage, tutorialReplay]);

  const skip = useCallback(async () => {
    await AsyncStorage.setItem('clutch_onboarding_complete', 'true');
    router.replace('/(tabs)');
  }, []);

  const saveProfile = async () => {
    try {
      if (displayName.trim().length > 0) {
        const name = displayName.trim();
        await api.put('/api/profile', { name });
        await setRevenueCatDisplayName(name);
      }
      // Invalidate caches so profile page picks up changes immediately
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      invalidateSession();
      await AsyncStorage.setItem('clutch_onboarding_complete', 'true');
      setStep(5);
    } catch {
      await AsyncStorage.setItem('clutch_onboarding_complete', 'true');
      setStep(5);
    }
  };

  const goToPaywall = useCallback(async () => {
    await AsyncStorage.setItem('clutch_onboarding_complete', 'true');
    router.replace('/paywall');
  }, []);

  const skipPaywall = useCallback(async () => {
    await AsyncStorage.setItem('clutch_onboarding_complete', 'true');
    router.replace('/(tabs)');
  }, []);

  const handleImageUpload = async (pickedFile: { uri: string; filename: string; mimeType: string } | null) => {
    if (!pickedFile) return;
    setIsUploading(true);
    try {
      const uploadResult = await uploadFile(pickedFile.uri, pickedFile.filename, pickedFile.mimeType);
      await api.put('/api/profile/image', { imageUrl: uploadResult.url });
      setProfileImage(uploadResult.url);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    } catch {
      setFeedback({
        title: 'Upload Failed',
        message: 'Please try again.',
        variant: 'error',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handlePhotoPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhotoSourceVisible(true);
  };

  const handleTakePhoto = async () => {
    setPhotoSourceVisible(false);
    await handleImageUpload(await takePhoto());
  };

  const handleChooseLibrary = async () => {
    setPhotoSourceVisible(false);
    await handleImageUpload(await pickImage());
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <PhotoSourceModal
          visible={photoSourceVisible}
          title="Profile Photo"
          onTakePhoto={handleTakePhoto}
          onChooseLibrary={handleChooseLibrary}
          onCancel={() => setPhotoSourceVisible(false)}
        />
        <FeedbackModal
          visible={!!feedback}
          title={feedback?.title ?? ''}
          message={feedback?.message ?? ''}
          variant={feedback?.variant}
          onDismiss={() => setFeedback(null)}
        />
        {step === 0 ? <WelcomeStep onContinue={() => setStep(1)} /> : null}
        {step === 1 ? <PickStep picked={picked} setPicked={setPicked} onContinue={() => setStep(2)} onSkip={skip} onBack={goBack} /> : null}
        {step === 2 ? <AIPredictionsStep onContinue={() => setStep(3)} onSkip={skip} onBack={goBack} picked={picked} /> : null}
        {step === 3 ? <ArenaStep subPage={arenaSubPage} onContinue={goNext} onSkip={skip} onBack={goBack} /> : null}
        {step === 4 ? <ProfileStep displayName={displayName} setDisplayName={setDisplayName} profileImage={profileImage} isUploading={isUploading} onPhotoPress={handlePhotoPress} onContinue={saveProfile} onBack={goBack} /> : null}
        {step === 5 ? <PaywallStep onSubscribe={goToPaywall} onSkip={skipPaywall} onBack={goBack} /> : null}
      </SafeAreaView>
    </View>
  );
}
