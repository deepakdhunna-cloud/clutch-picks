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

// ─── STEP 0: WELCOME ─────────────────────────────────────────
function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      {/* Grid background */}
      <View style={[StyleSheet.absoluteFillObject, { opacity: 0.4 }]} pointerEvents="none">
        <Svg width={W} height={800} style={StyleSheet.absoluteFillObject}>
          {Array.from({ length: 20 }).map((_, i) => (
            <Path key={`h${i}`} d={`M0 ${i * 20} L${W} ${i * 20}`} stroke="rgba(255,255,255,0.03)" strokeWidth={0.5} />
          ))}
          {Array.from({ length: 20 }).map((_, i) => (
            <Path key={`v${i}`} d={`M${i * 20} 0 L${i * 20} 800`} stroke="rgba(255,255,255,0.03)" strokeWidth={0.5} />
          ))}
        </Svg>
      </View>

      {/* Ambient glows */}
      <View style={{ position: 'absolute', top: '25%', alignSelf: 'center', width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(139,10,31,0.08)' }} pointerEvents="none" />
      <View style={{ position: 'absolute', top: '35%', right: '10%', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(122,157,184,0.04)' }} pointerEvents="none" />

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 }}>
        {/* Ghost jerseys */}
        <Animated.View entering={FadeIn.delay(200).duration(800)} style={{ flexDirection: 'row', gap: 40, marginBottom: 30, opacity: 0.15 }}>
          <View style={{ width: 60, height: 68, borderRadius: 16, backgroundColor: '#552583', transform: [{ rotate: '-8deg' }], alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: WHITE }}>LAL</Text>
          </View>
          <View style={{ width: 60, height: 68, borderRadius: 16, backgroundColor: '#007A33', transform: [{ rotate: '8deg' }], alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: WHITE }}>BOS</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(400).duration(600)}>
          <Image source={require('@/assets/clutch-logo-horizontal.png')} style={{ width: 280, height: 280 * (523 / 3352) }} resizeMode="contain" />
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(700).duration(500)} style={{ fontSize: 14, color: TEXT_MUT, marginTop: 16 }}>
          Your sports prediction command center
        </Animated.Text>
      </View>

      <View style={{ paddingHorizontal: 28, paddingBottom: 40 }}>
        <Animated.View entering={FadeInDown.delay(1000).duration(500)}>
          <Pressable onPress={onContinue} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <LinearGradient colors={[MAROON, '#6A0818']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Let's Go</Text>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

// ─── STEP 1: PICK YOUR WINNER ─────────────────────────────────
function PickStep({ picked, setPicked, onContinue, onSkip }: {
  picked: 'home' | 'away' | null; setPicked: (v: 'home' | 'away') => void; onContinue: () => void; onSkip: () => void;
}) {
  const homeScale = useSharedValue(1);
  const awayScale = useSharedValue(1);
  const lalColors = getTeamColors('LAL', Sport.NBA);
  const bosColors = getTeamColors('BOS', Sport.NBA);
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
      <Pressable onPress={onSkip} style={{ position: 'absolute', top: 16, right: 24, zIndex: 10, padding: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.25)' }}>Skip</Text>
      </Pressable>

      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36 }}>
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
                  <JerseyIcon teamCode="LAL" primaryColor={lalColors.primary} secondaryColor={lalColors.secondary} size={86} sport={jerseyType} />
                </View>
                {picked === 'home' ? (
                  <View style={{ position: 'absolute', bottom: -3, right: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: MAROON, borderWidth: 2.5, borderColor: BG, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: WHITE }}>✓</Text>
                  </View>
                ) : null}
                <Text style={{ fontSize: 13, fontWeight: '700', color: picked === 'away' ? 'rgba(255,255,255,0.3)' : WHITE, marginTop: 6 }}>Lakers</Text>
                <Text style={{ fontSize: 10, color: TEXT_MUT }}>38-26</Text>
              </Animated.View>
            </Pressable>

            <View style={{ alignItems: 'center', paddingBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                <Text style={{ fontSize: 32, fontWeight: '900', color: WHITE }}>0</Text>
                <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.08)' }}>–</Text>
                <Text style={{ fontSize: 32, fontWeight: '900', color: WHITE }}>0</Text>
              </View>
              <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.25)', letterSpacing: 2, marginTop: 2 }}>SCHEDULED</Text>
            </View>

            <Pressable onPress={() => doPick('away')}>
              <Animated.View style={[awayStyle, { alignItems: 'center', opacity: picked === 'home' ? 0.35 : 1 }]}>
                <View style={picked === 'away' ? { shadowColor: MAROON, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } } : {}}>
                  <JerseyIcon teamCode="BOS" primaryColor={bosColors.primary} secondaryColor={bosColors.secondary} size={86} sport={jerseyType} />
                </View>
                {picked === 'away' ? (
                  <View style={{ position: 'absolute', bottom: -3, right: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: MAROON, borderWidth: 2.5, borderColor: BG, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: WHITE }}>✓</Text>
                  </View>
                ) : null}
                <Text style={{ fontSize: 13, fontWeight: '700', color: picked === 'home' ? 'rgba(255,255,255,0.3)' : WHITE, marginTop: 6 }}>Celtics</Text>
                <Text style={{ fontSize: 10, color: TEXT_MUT }}>42-22</Text>
              </Animated.View>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 }}>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEXT_MUT }}>57% confidence</Text>
            </View>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 }}>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEXT_MUT }}>BOS -4.5</Text>
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
function AIPredictionsStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  const bosColors = getTeamColors('BOS', Sport.NBA);
  const jerseyType = sportEnumToJersey('NBA');

  return (
    <View style={{ flex: 1 }}>
      <ProgressBar step={2} />
      <Pressable onPress={onSkip} style={{ position: 'absolute', top: 16, right: 24, zIndex: 10, padding: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.25)' }}>Skip</Text>
      </Pressable>

      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36 }}>
        <Animated.Text entering={FadeInDown.duration(400)} style={{ fontSize: 26, fontWeight: '900', color: WHITE, textAlign: 'center', marginBottom: 6 }}>
          AI-Powered Picks
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={{ fontSize: 13, color: TEXT_MUT, textAlign: 'center', marginBottom: 28 }}>
          Every game analyzed by 20+ prediction factors
        </Animated.Text>

        {/* Clutch Pick card */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ width: '100%' }}>
          <View style={{ borderRadius: 22, overflow: 'hidden', borderWidth: 3, borderColor: 'rgba(255,255,255,0.12)' }}>
            <LinearGradient colors={[MAROON, '#5A7A8A', MAROON, TEAL, MAROON]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { opacity: 0.3 }]} />
            <View style={{ margin: 3, borderRadius: 18, overflow: 'hidden', backgroundColor: '#0A0E14' }}>
              <View style={{ padding: 18 }}>
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <View style={{ backgroundColor: MAROON, width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: WHITE }}>#1</Text>
                  </View>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>CLUTCH PICK</Text>
                </View>

                {/* Team row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                  <JerseyIcon teamCode="BOS" primaryColor={bosColors.primary} secondaryColor={bosColors.secondary} size={52} sport={jerseyType} />
                  <View>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: WHITE }}>Boston Celtics</Text>
                    <Text style={{ fontSize: 11, color: TEXT_MUT, marginTop: 2 }}>vs LAL Lakers</Text>
                  </View>
                </View>

                {/* Confidence */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: TEXT_MUT, letterSpacing: 1.5 }}>CONFIDENCE</Text>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: WHITE }}>57%</Text>
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

                {/* Stats */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: BORDER }}>
                    <Text style={{ fontSize: 8, fontWeight: '700', color: TEXT_MUT, letterSpacing: 1 }}>EDGE</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, marginTop: 2 }}>6/10</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: BORDER }}>
                    <Text style={{ fontSize: 8, fontWeight: '700', color: TEXT_MUT, letterSpacing: 1 }}>VALUE</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: TEAL, marginTop: 2 }}>Fair</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(500).duration(400)} style={{ fontSize: 12, color: TEXT_SEC, textAlign: 'center', marginTop: 20, lineHeight: 18 }}>
          Tap any pick for edge rating, win probability, and full analysis.
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(600).duration(400)} style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', marginTop: 12 }}>
          For entertainment only. Not gambling advice.
        </Animated.Text>
      </View>

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
function ArenaStep({ subPage, onContinue, onSkip }: { subPage: number; onContinue: () => void; onSkip: () => void }) {
  const labels = ['Game Day', 'Prep Mode', 'Review'];

  return (
    <View style={{ flex: 1 }}>
      <ProgressBar step={3} />
      <Pressable onPress={onSkip} style={{ position: 'absolute', top: 16, right: 24, zIndex: 10, padding: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.25)' }}>Skip</Text>
      </Pressable>

      <View style={{ flex: 1, paddingTop: 28 }}>
        <Animated.Text entering={FadeInDown.duration(400)} style={{ fontSize: 26, fontWeight: '900', color: WHITE, textAlign: 'center', marginBottom: 6 }}>
          My Arena
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={{ fontSize: 13, color: TEXT_MUT, textAlign: 'center', marginBottom: 20 }}>
          Your personalized sports command center
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
  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <PulsingDot />
        <Text style={{ fontSize: 9, fontWeight: '700', color: RED, letterSpacing: 1.5 }}>YOUR LIVE GAMES</Text>
      </View>
      <Text style={{ fontSize: 12, color: TEXT_SEC, marginBottom: 8 }}>Track every game you care about in real time</Text>

      {/* Mock live card */}
      <View style={{ backgroundColor: GLASS, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(220,38,38,0.15)' }}>
        <LinearGradient colors={['rgba(220,38,38,0.06)', 'transparent']} style={[StyleSheet.absoluteFill, { borderRadius: 16 }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <PulsingDot size={5} />
          <Text style={{ fontSize: 10, fontWeight: '700', color: RED }}>LIVE · Q3 5:42</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: WHITE }}>BOS</Text>
            <Text style={{ fontSize: 24, fontWeight: '900', color: WHITE }}>67</Text>
          </View>
          <Text style={{ fontSize: 12, color: TEXT_MUT }}>vs</Text>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: 'rgba(255,255,255,0.4)' }}>LAL</Text>
            <Text style={{ fontSize: 24, fontWeight: '900', color: 'rgba(255,255,255,0.4)' }}>58</Text>
          </View>
        </View>
      </View>

      {/* Upcoming */}
      <View style={{ backgroundColor: GLASS, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: WHITE }}>8:30</Text>
          <Text style={{ fontSize: 8, fontWeight: '600', color: WHITE }}>PM</Text>
        </View>
        <View>
          <Text style={{ fontSize: 13, fontWeight: '700', color: WHITE }}>DEN vs MIA</Text>
          <Text style={{ fontSize: 10, color: TEXT_MUT }}>Scheduled</Text>
        </View>
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
        { rank: 1, teams: 'BOS at LAL', story: 'Strong lean', detail: 'BOS clear favorite at 57% confidence' },
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
        { teams: 'BOS vs LAL', result: 'win' },
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
function ProfileStep({ displayName, setDisplayName, profileImage, isUploading, onPhotoPress, onContinue }: {
  displayName: string; setDisplayName: (v: string) => void; profileImage: string | null; isUploading: boolean; onPhotoPress: () => void; onContinue: () => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <ProgressBar step={4} />

      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36 }}>
        <Animated.Text entering={FadeInDown.duration(400)} style={{ fontSize: 26, fontWeight: '900', color: WHITE, textAlign: 'center', marginBottom: 6 }}>
          Build Your Card
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={{ fontSize: 13, color: TEXT_MUT, textAlign: 'center', marginBottom: 28 }}>
          Your analyst identity across the app
        </Animated.Text>

        {/* Profile card */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ width: '100%' }}>
          <View style={{ borderRadius: 24, overflow: 'hidden', borderWidth: 3 }}>
            <LinearGradient colors={[TEAL, '#5A7A8A', TEAL, '#4A6A7A', TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} />
            <View style={{ margin: 3, borderRadius: 21, backgroundColor: '#0A0C0E', padding: 20 }}>
              {/* Header */}
              <Text style={{ fontSize: 8, fontWeight: '700', color: TEXT_MUT, letterSpacing: 2, marginBottom: 16 }}>CLUTCH PICKS</Text>

              {/* Photo + name */}
              <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <Pressable onPress={onPhotoPress}>
                  <View style={{
                    width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: TEAL,
                    backgroundColor: 'rgba(122,157,184,0.1)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  }}>
                    {isUploading ? (
                      <ActivityIndicator color={TEAL} />
                    ) : profileImage ? (
                      <Image source={{ uri: profileImage }} style={{ width: 84, height: 84, borderRadius: 42 }} />
                    ) : (
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ fontSize: 28, fontWeight: '800', color: TEAL }}>?</Text>
                        <Text style={{ fontSize: 7, fontWeight: '700', color: TEXT_MUT, letterSpacing: 1, marginTop: 2 }}>TAP TO ADD</Text>
                      </View>
                    )}
                  </View>
                </Pressable>

                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Your name..."
                  placeholderTextColor={TEXT_MUT}
                  style={{
                    fontSize: 18, fontWeight: '800', color: WHITE, textAlign: 'center',
                    marginTop: 14, paddingVertical: 6, paddingHorizontal: 20, width: '100%',
                    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
                  }}
                  keyboardAppearance="dark"
                  returnKeyType="done"
                />
              </View>

              {/* OVR */}
              <View style={{ alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ fontSize: 28, fontWeight: '900', color: TEAL }}>0</Text>
                <Text style={{ fontSize: 8, fontWeight: '700', color: TEXT_MUT, letterSpacing: 1.5 }}>OVR</Text>
              </View>

              {/* Stats row */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                {[
                  { label: 'PK', value: '0' },
                  { label: 'W', value: '0', color: TEAL },
                  { label: 'L', value: '0', color: ERROR },
                  { label: 'PCT', value: '—' },
                  { label: 'STK', value: '—' },
                ].map(s => (
                  <View key={s.label} style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: s.color ?? WHITE }}>{s.value}</Text>
                    <Text style={{ fontSize: 8, fontWeight: '600', color: TEXT_MUT, letterSpacing: 0.5, marginTop: 2 }}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </Animated.View>

        <Text style={{ fontSize: 12, color: TEXT_MUT, marginTop: 16 }}>Tap photo to add yours. Name is optional.</Text>
      </View>

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

// ─── STEP 5: PAYWALL BRIDGE ──────────────────────────────────
function PaywallStep({ onSubscribe, onSkip }: { onSubscribe: () => void; onSkip: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      {/* Maroon ambient glow */}
      <View style={{ position: 'absolute', top: '20%', alignSelf: 'center', width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(139,10,31,0.08)' }} pointerEvents="none" />

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
        {/* Icon */}
        <Animated.View entering={FadeIn.delay(200).duration(500)} style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: 'rgba(139,10,31,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 24, borderWidth: 1, borderColor: 'rgba(139,10,31,0.3)' }}>
          <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
            <Path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6z" stroke={MAROON} strokeWidth={1.8} strokeLinejoin="round" />
          </Svg>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(300).duration(400)} style={{ fontSize: 28, fontWeight: '900', color: WHITE, marginBottom: 8 }}>
          Clutch Pro
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(400).duration(400)} style={{ fontSize: 14, color: TEXT_SEC, textAlign: 'center', marginBottom: 32 }}>
          Unlock the full prediction engine
        </Animated.Text>

        {/* Perks */}
        <Animated.View entering={FadeInDown.delay(500).duration(400)} style={{ width: '100%', gap: 16 }}>
          {[
            { title: 'Full AI Analysis', desc: 'Detailed breakdowns on every game' },
            { title: 'Clutch Picks', desc: 'Top-ranked AI picks per sport daily' },
            { title: 'Arena Insights', desc: 'Pattern detection and review analytics' },
          ].map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(139,10,31,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(139,10,31,0.2)' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: MAROON }} />
              </View>
              <View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE }}>{p.title}</Text>
                <Text style={{ fontSize: 11, color: TEXT_MUT, marginTop: 1 }}>{p.desc}</Text>
              </View>
            </View>
          ))}
        </Animated.View>
      </View>

      <View style={{ paddingHorizontal: 28, paddingBottom: 20 }}>
        <Pressable onPress={onSubscribe} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <LinearGradient colors={[MAROON, '#6A0818']} style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>Start Free Trial</Text>
          </LinearGradient>
        </Pressable>
        <Pressable onPress={onSkip} style={{ alignItems: 'center', paddingVertical: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: TEXT_MUT }}>Maybe later</Text>
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

  const goNext = useCallback(() => {
    if (step === 3 && arenaSubPage < 2) {
      setArenaSubPage(arenaSubPage + 1);
      return;
    }
    if (step === 4) { saveProfile(); return; }
    if (step === 5) return;
    setStep(step + 1);
    if (step === 3) setArenaSubPage(0);
  }, [step, arenaSubPage]);

  const skip = useCallback(async () => {
    await AsyncStorage.setItem('clutch_onboarding_complete', 'true');
    router.replace('/(tabs)');
  }, []);

  const saveProfile = async () => {
    try {
      if (displayName.trim().length > 0) {
        await api.put('/api/profile', { name: displayName.trim() });
      }
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
        {step === 1 ? <PickStep picked={picked} setPicked={setPicked} onContinue={() => setStep(2)} onSkip={skip} /> : null}
        {step === 2 ? <AIPredictionsStep onContinue={() => setStep(3)} onSkip={skip} /> : null}
        {step === 3 ? <ArenaStep subPage={arenaSubPage} onContinue={goNext} onSkip={skip} /> : null}
        {step === 4 ? <ProfileStep displayName={displayName} setDisplayName={setDisplayName} profileImage={profileImage} isUploading={isUploading} onPhotoPress={handlePhotoPress} onContinue={saveProfile} /> : null}
        {step === 5 ? <PaywallStep onSubscribe={goToPaywall} onSkip={skipPaywall} /> : null}
      </SafeAreaView>
    </View>
  );
}
