import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, Dimensions, TextInput, Image, Alert,
  ActionSheetIOS, Platform, ActivityIndicator, StyleSheet,
} from 'react-native';
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
  }, [dur, startY, drift]);

  useEffect(() => {
    // Initial delay then start seamless loop
    const timer = setTimeout(() => {
      runCycle();
      const interval = setInterval(runCycle, dur);
      // Cleanup
      (FloatingParticle as any)._cleanup = () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timer);
  }, []);

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
          <Pressable onPress={onContinue} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <LinearGradient colors={[TEAL, '#5A7A8A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: TEAL, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Let's Get Started</Text>
            </LinearGradient>
          </Pressable>
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
        <Pressable onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </Pressable>
        <Pressable onPress={onSkip} style={{ padding: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.25)' }}>Skip</Text>
        </Pressable>
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
            <Pressable onPress={() => doPick('home')}>
              <Animated.View style={[homeStyle, { alignItems: 'center', opacity: picked === 'away' ? 0.35 : 1 }]}>
                <View style={picked === 'home' ? { shadowColor: MAROON, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } } : {}}>
                  <JerseyIcon teamCode="CHI" primaryColor={homeColors.primary} secondaryColor={homeColors.secondary} size={86} sport={jerseyType} />
                </View>
                {picked === 'home' ? (
                  <View style={{ position: 'absolute', bottom: -3, right: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: MAROON, borderWidth: 2.5, borderColor: BG, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: WHITE }}>✓</Text>
                  </View>
                ) : null}
                <Text style={{ fontSize: 13, fontWeight: '700', color: picked === 'away' ? 'rgba(255,255,255,0.3)' : WHITE, marginTop: 6 }}>Bulls</Text>
                <Text style={{ fontSize: 10, color: TEXT_MUT }}>30-34</Text>
              </Animated.View>
            </Pressable>

            <View style={{ alignItems: 'center', paddingBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 48, fontFamily: 'VT323_400Regular', color: WHITE, letterSpacing: 2, lineHeight: 52 }}>0</Text>
                <Text style={{ fontSize: 22, color: 'rgba(255,255,255,0.20)', fontWeight: '300', lineHeight: 52 }}>-</Text>
                <Text style={{ fontSize: 48, fontFamily: 'VT323_400Regular', color: WHITE, letterSpacing: 2, lineHeight: 52 }}>0</Text>
              </View>
              <Text style={{ fontSize: 11, fontFamily: 'VT323_400Regular', color: 'rgba(255,255,255,0.30)', letterSpacing: 3, marginTop: 4 }}>SCHEDULED</Text>
            </View>

            <Pressable onPress={() => doPick('away')}>
              <Animated.View style={[awayStyle, { alignItems: 'center', opacity: picked === 'home' ? 0.35 : 1 }]}>
                <View style={picked === 'away' ? { shadowColor: MAROON, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } } : {}}>
                  <JerseyIcon teamCode="MIN" primaryColor={awayColors.primary} secondaryColor={awayColors.secondary} size={86} sport={jerseyType} />
                </View>
                {picked === 'away' ? (
                  <View style={{ position: 'absolute', bottom: -3, right: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: MAROON, borderWidth: 2.5, borderColor: BG, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: WHITE }}>✓</Text>
                  </View>
                ) : null}
                <Text style={{ fontSize: 13, fontWeight: '700', color: picked === 'home' ? 'rgba(255,255,255,0.3)' : WHITE, marginTop: 6 }}>T-Wolves</Text>
                <Text style={{ fontSize: 10, color: TEXT_MUT }}>40-24</Text>
              </Animated.View>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 }}>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEAL }}>Solid Pick</Text>
            </View>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 }}>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEXT_MUT }}>MIN -3.5</Text>
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
        <Pressable onPress={onContinue} disabled={!picked} style={({ pressed }) => ({ opacity: !picked ? 0.3 : pressed ? 0.9 : 1, transform: [{ scale: pressed && picked ? 0.98 : 1 }] })}>
          <LinearGradient
            colors={picked ? [MAROON, '#6A0818'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.04)']}
            style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 16, fontWeight: '800', color: picked ? WHITE : 'rgba(255,255,255,0.15)', letterSpacing: 0.5 }}>Continue</Text>
          </LinearGradient>
        </Pressable>
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
        <Pressable onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </Pressable>
        <Pressable onPress={onSkip} style={{ padding: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.25)' }}>Skip</Text>
        </Pressable>
      </View>

      <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 }} style={{ flex: 1 }}>
        <Animated.Text entering={FadeInDown.duration(400)} style={{ fontSize: 26, fontWeight: '900', color: WHITE, textAlign: 'center', marginBottom: 6 }}>
          AI-Powered Picks
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={{ fontSize: 13, color: TEXT_MUT, textAlign: 'center', marginBottom: 28 }}>
          Every game analyzed by 20+ prediction factors
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
                      <JerseyIcon teamCode={pickedCode} primaryColor={pickedColors.primary} secondaryColor={pickedColors.secondary} size={52} sport={jerseyType} />
                      <View>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: WHITE }}>{pickedName}</Text>
                        <Text style={{ fontSize: 11, color: TEXT_MUT, marginTop: 2 }}>vs {opponentCode} {opponentName}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: TEXT_MUT, letterSpacing: 1.5 }}>PICK STRENGTH</Text>
                      <View style={{ backgroundColor: 'rgba(122,157,184,0.08)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(122,157,184,0.19)' }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: TEAL }}>Solid Pick</Text>
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
                          { label: 'Matchup Edge', value: 0.65, color: MAROON },
                          { label: 'Home/Away Split', value: 0.45, color: TEAL },
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
                          <Text style={{ fontSize: 11, fontWeight: '600', color: TEAL }}>Full breakdown</Text>
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
            <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>PICK STRENGTH TIERS</Text>
          </View>
          <View style={{ gap: 8 }}>
            {[
              { range: '50–54%', label: 'Considered a Lean', desc: 'Slight edge detected by the model', accent: 'rgba(255,255,255,0.15)' },
              { range: '55–59%', label: 'Considered a Solid Pick', desc: 'Clear advantage found across key factors', accent: 'rgba(122,157,184,0.25)' },
              { range: '60–64%', label: 'Considered a Strong Pick', desc: 'Multiple prediction factors align', accent: 'rgba(122,157,184,0.35)' },
              { range: '65–69%', label: 'Considered a High Confidence Pick', desc: 'Strong model agreement and data depth', accent: 'rgba(139,10,31,0.25)' },
              { range: '70%+', label: 'Considered a Lock', desc: 'Dominant edge across all factors', accent: 'rgba(139,10,31,0.35)' },
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
        <Pressable onPress={onContinue} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <LinearGradient colors={[MAROON, '#6A0818']} style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Continue</Text>
          </LinearGradient>
        </Pressable>
      </View>
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
        <Pressable onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </Pressable>
        <Pressable onPress={onSkip} style={{ padding: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.25)' }}>Skip</Text>
        </Pressable>
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
        <View style={{ flex: 1, paddingHorizontal: 24 }}>
          {subPage === 0 ? <ArenaGameDay /> : null}
          {subPage === 1 ? <ArenaPrepMode /> : null}
          {subPage === 2 ? <ArenaReview /> : null}
        </View>

        {/* Page dots */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: 12 }}>
          {[0, 1, 2].map(i => (
            <View key={i} style={{ width: i === subPage ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === subPage ? MAROON : 'rgba(255,255,255,0.12)' }} />
          ))}
        </View>
      </View>

      <View style={{ paddingHorizontal: 28, paddingBottom: 40 }}>
        <Pressable onPress={onContinue} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <LinearGradient
            colors={subPage === 2 ? [MAROON, '#6A0818'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.06)']}
            style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: subPage < 2 ? 1 : 0, borderColor: BORDER }}
          >
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>
              {subPage < 2 ? 'Swipe to see more →' : 'Continue'}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

function ArenaGameDay() {
  const minColors = getTeamColors('MIN', Sport.NBA);
  const chiColors = getTeamColors('CHI', Sport.NBA);

  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <PulsingDot />
        <Text style={{ fontSize: 9, fontWeight: '700', color: RED, letterSpacing: 1.5 }}>YOUR LIVE GAMES</Text>
      </View>
      <Text style={{ fontSize: 12, color: TEXT_SEC, marginBottom: 4 }}>Track every game you care about in real time</Text>

      {/* Mock live card — matches real LiveCard design */}
      <View style={{ borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
        {/* Dark base */}
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#06080A' }]} />
        {/* Team color washes */}
        <LinearGradient colors={[`${minColors.primary}22`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 0.5 }} style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={['transparent', `${chiColors.primary}18`]} start={{ x: 0.4, y: 0.5 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
        {/* Shimmer ribbon */}
        <LinearGradient colors={[MAROON, TEAL, MAROON]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5, width: '100%' }} />
        {/* Ribbon bleed glow */}
        <LinearGradient colors={['rgba(122,157,184,0.06)', 'rgba(139,10,31,0.03)', 'transparent']} style={{ height: 40, width: '100%' }} />
        {/* Live + sport pill */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: -20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <PulsingDot size={6} />
            <Text style={{ fontSize: 11, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>LIVE</Text>
          </View>
          <View style={{ backgroundColor: 'rgba(122,157,184,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(122,157,184,0.3)' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: WHITE, letterSpacing: 0.5 }}>NBA</Text>
          </View>
        </View>

        {/* Scores — VT323 font */}
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: TEXT_SEC, marginBottom: 2, letterSpacing: 0.5 }}>MIN</Text>
              <View style={{ width: 16, height: 2, backgroundColor: MAROON, borderRadius: 1, marginBottom: 2 }} />
              <Text style={{ fontSize: 48, fontFamily: 'VT323_400Regular', color: WHITE, letterSpacing: 2 }}>67</Text>
            </View>
            <View style={{ alignItems: 'center', marginHorizontal: 8 }}>
              <Text style={{ fontSize: 20, fontWeight: '300', color: 'rgba(255,255,255,0.15)' }}>-</Text>
              <Text style={{ fontSize: 14, fontFamily: 'VT323_400Regular', color: 'rgba(255,255,255,0.45)', letterSpacing: 1, marginTop: 2 }}>Q3 · 5:42</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: TEXT_SEC, marginBottom: 2, letterSpacing: 0.5 }}>CHI</Text>
              <Text style={{ fontSize: 48, fontFamily: 'VT323_400Regular', color: WHITE, letterSpacing: 2 }}>58</Text>
            </View>
          </View>

          {/* Stat boxes — matches real card */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(2,3,8,0.92)', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: MAROON, letterSpacing: 1, marginBottom: 4 }}>YOUR PICK</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE }}>MIN</Text>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEAL, marginTop: 2 }}>Leading</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: 'rgba(2,3,8,0.92)', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: MAROON, letterSpacing: 1, marginBottom: 4 }}>MOMENTUM</Text>
              <View style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end', height: 20, marginBottom: 2 }}>
                {[0.4, 0.7, 0.5, 0.9, 0.6].map((h, i) => <View key={i} style={{ width: 4, height: 8 + h * 12, borderRadius: 2, backgroundColor: h > 0.5 ? TEAL : TEXT_MUT, opacity: 0.5 + h * 0.5 }} />)}
              </View>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEAL }}>Positive</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: 'rgba(2,3,8,0.92)', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: MAROON, letterSpacing: 1, marginBottom: 4 }}>PICK STRENGTH</Text>
              <Text style={{ fontSize: 13, fontWeight: '800', color: TEAL }}>Solid Pick</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Upcoming card — matches HorizonCard style */}
      <View style={{ backgroundColor: 'rgba(8,8,12,0.95)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: WHITE }}>8:30</Text>
          <Text style={{ fontSize: 8, fontWeight: '600', color: WHITE }}>PM</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE }}>DEN vs MIA</Text>
          <Text style={{ fontSize: 10, color: TEXT_MUT, marginTop: 2 }}>NBA</Text>
        </View>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Path d="M9 18l6-6-6-6" stroke={TEXT_MUT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    </Animated.View>
  );
}

function ArenaPrepMode() {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ gap: 12 }}>
      {/* Insight card */}
      <View style={{ backgroundColor: GLASS, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER }}>
        <Text style={{ fontSize: 9, fontWeight: '700', color: MAROON, letterSpacing: 1.5, marginBottom: 8 }}>ARENA INSIGHT</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE, lineHeight: 20 }}>3 home underdogs are in play tonight — a pattern hitting at a high rate this week.</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
          {['Knicks', 'Heat', 'Suns'].map(t => (
            <View key={t} style={{ backgroundColor: 'rgba(139,10,31,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: MAROON }}>{t}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={{ fontSize: 12, fontWeight: '700', color: WHITE }}>Matchups Ranked</Text>

      {/* Ranked cards */}
      {[
        { rank: 1, teams: 'MIN at CHI', story: 'Solid Pick', detail: 'MIN rated a Solid Pick — clear statistical edge' },
        { rank: 2, teams: 'DEN at MIA', story: 'Upset watch', detail: 'MIA 7-3 in last 10 despite underdog status' },
      ].map(c => (
        <View key={c.rank} style={{ backgroundColor: GLASS, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, borderLeftWidth: 3, borderLeftColor: c.rank === 1 ? MAROON : TEAL }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: c.rank === 1 ? MAROON : TEAL, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 10, fontWeight: '900', color: WHITE }}>{c.rank}</Text>
            </View>
            <Text style={{ fontSize: 12, fontWeight: '700', color: WHITE }}>{c.story}</Text>
          </View>
          <Text style={{ fontSize: 11, color: TEXT_SEC, lineHeight: 16 }}>{c.detail}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

function ArenaReview() {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ gap: 12 }}>
      {/* Hero */}
      <View style={{ backgroundColor: GLASS, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: 'rgba(139,10,31,0.12)', alignItems: 'center' }}>
        <Text style={{ fontSize: 9, fontWeight: '700', color: MAROON, letterSpacing: 1.5, marginBottom: 8 }}>YOUR NIGHT</Text>
        <Text style={{ fontSize: 48, fontWeight: '800', color: WHITE }}>4-1</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: MAROON, marginTop: 4 }}>80% accuracy</Text>
        <View style={{ flexDirection: 'row', gap: 3, marginTop: 12 }}>
          {['W', 'W', 'W', 'L', 'W'].map((r, i) => (
            <View key={i} style={{ width: 40, height: 5, borderRadius: 2.5, backgroundColor: r === 'W' ? TEAL : ERROR, opacity: r === 'W' ? 0.9 : 0.4 }} />
          ))}
        </View>
      </View>

      {/* Results */}
      {[
        { teams: 'MIN vs CHI', result: 'win' },
        { teams: 'DEN vs MIA', result: 'win' },
        { teams: 'GSW vs PHI', result: 'loss' },
      ].map((r, i) => (
        <View key={i} style={{ backgroundColor: GLASS, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: WHITE }}>{r.teams}</Text>
          <View style={{ backgroundColor: r.result === 'win' ? 'rgba(122,157,184,0.12)' : 'rgba(239,68,68,0.08)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: r.result === 'win' ? TEAL : ERROR }}>{r.result === 'win' ? 'CORRECT' : 'MISSED'}</Text>
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

// ─── STEP 4: BUILD YOUR CARD ──────────────────────────────────
function ProfileStep({ displayName, setDisplayName, profileImage, isUploading, onPhotoPress, onContinue, onBack }: {
  displayName: string; setDisplayName: (v: string) => void; profileImage: string | null; isUploading: boolean; onPhotoPress: () => void; onContinue: () => void; onBack: () => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <ProgressBar step={4} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 24, paddingTop: 4 }}>
        <Pressable onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </Pressable>
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
                <Pressable onPress={onPhotoPress}>
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
                </Pressable>
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
        <Pressable onPress={onContinue} disabled={!displayName.trim()} style={({ pressed }) => ({ opacity: !displayName.trim() ? 0.35 : pressed ? 0.9 : 1, transform: [{ scale: pressed && displayName.trim() ? 0.98 : 1 }] })}>
          <LinearGradient colors={displayName.trim() ? [MAROON, '#6A0818'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.04)']} style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: displayName.trim() ? 0 : 1, borderColor: BORDER }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Continue</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
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
        <Pressable onPress={onBack} style={{ padding: 8 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </Pressable>
      </View>

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
        {/* CLUTCH PRO badge with gradient bar — matches paywall */}
        <Animated.View entering={FadeIn.delay(200).duration(500)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ width: 3, height: 18, borderRadius: 2 }} />
          <Text style={{ fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 2.5 }}>CLUTCH PRO</Text>
        </Animated.View>

        {/* Title — matches paywall hero */}
        <Animated.Text entering={FadeInDown.delay(300).duration(400)} style={{ fontSize: 32, fontWeight: '900', color: WHITE, textAlign: 'center', letterSpacing: -0.5, lineHeight: 38, marginBottom: 12 }}>
          Every game.{'\n'}Every stat.{'\n'}
          <Text style={{ color: TEAL }}>AI-analyzed.</Text>
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(400).duration(400)} style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
          Multi-factor predictions across every game, every league.
        </Animated.Text>

        {/* Features — alternating maroon/teal like paywall */}
        <Animated.View entering={FadeInDown.delay(500).duration(400)} style={{ width: '100%', gap: 16 }}>
          {[
            { title: 'AI Predictions', desc: 'Multi-factor analysis per game', accent: MAROON, bg: 'rgba(139,10,31,0.12)', border: 'rgba(139,10,31,0.15)' },
            { title: 'Live Scores', desc: 'Real-time across 8 leagues', accent: TEAL, bg: 'rgba(122,157,184,0.10)', border: 'rgba(122,157,184,0.12)' },
            { title: 'Box Scores & Stats', desc: 'Full game breakdowns', accent: MAROON, bg: 'rgba(139,10,31,0.12)', border: 'rgba(139,10,31,0.15)' },
            { title: 'Where to Watch', desc: 'TV & streaming info', accent: TEAL, bg: 'rgba(122,157,184,0.10)', border: 'rgba(122,157,184,0.12)' },
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
        <Pressable onPress={onSubscribe} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <LinearGradient colors={[MAROON, '#6A0818', '#5A0614']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', shadowColor: MAROON, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Start Free Trial</Text>
          </LinearGradient>
        </Pressable>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 10 }}>Free for 3 days, then $4.99/month. Cancel anytime.</Text>
        <Pressable onPress={onSkip} style={{ alignItems: 'center', paddingVertical: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: TEAL }}>Maybe later</Text>
        </Pressable>
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
  const [skipProfile, setSkipProfile] = useState(false);
  const queryClient = useQueryClient();
  const invalidateSession = useInvalidateSession();

  // Check if replaying from settings — skip profile step
  useEffect(() => {
    AsyncStorage.getItem('clutch_onboarding_skip_profile').then(val => {
      if (val === 'true') {
        setSkipProfile(true);
        AsyncStorage.removeItem('clutch_onboarding_skip_profile');
      }
    });
  }, []);

  const goNext = useCallback(() => {
    if (step === 3 && arenaSubPage < 2) {
      setArenaSubPage(arenaSubPage + 1);
      return;
    }
    if (step === 5) return;
    // Skip profile step (4) when replaying from settings
    if (step === 3 && skipProfile) {
      setArenaSubPage(0);
      setStep(5);
    } else {
      if (step === 3) setArenaSubPage(0);
      setStep(step + 1);
    }
  }, [step, arenaSubPage, skipProfile]);

  const goBack = useCallback(() => {
    if (step === 3 && arenaSubPage > 0) {
      setArenaSubPage(arenaSubPage - 1);
      return;
    }
    // When going back from paywall step and profile was skipped, go to arena
    if (step === 5 && skipProfile) {
      setStep(3);
      setArenaSubPage(2);
      return;
    }
    if (step > 0) setStep(step - 1);
    if (step === 4) setArenaSubPage(2); // return to last arena sub-page
  }, [step, arenaSubPage, skipProfile]);

  const skip = useCallback(async () => {
    await AsyncStorage.setItem('clutch_onboarding_complete', 'true');
    router.replace('/(tabs)');
  }, []);

  const saveProfile = async () => {
    try {
      if (displayName.trim().length > 0) {
        await api.put('/api/profile', { name: displayName.trim() });
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
      Alert.alert('Upload Failed', 'Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handlePhotoPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 },
        async (buttonIndex) => {
          if (buttonIndex === 1) handleImageUpload(await takePhoto());
          else if (buttonIndex === 2) handleImageUpload(await pickImage());
        }
      );
    } else {
      Alert.alert('Add Photo', '', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take Photo', onPress: async () => handleImageUpload(await takePhoto()) },
        { text: 'Choose from Library', onPress: async () => handleImageUpload(await pickImage()) },
      ]);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
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
