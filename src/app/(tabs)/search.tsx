import React, { useState, useMemo, useCallback, useEffect, memo } from 'react';
import {
  View, Text, Pressable, Dimensions, ActivityIndicator, RefreshControl, ScrollView, TextInput, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withRepeat, Easing, cancelAnimation, runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Search, ChevronRight, Plus, Zap, Lock } from 'lucide-react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useSubscription } from '@/lib/subscription-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useGames } from '@/hooks/useGames';
import { useLiveScores } from '@/hooks/useLiveScores';
import { useUserPicks, useUserStats, type Pick as UserPick, type UserStats } from '@/hooks/usePicks';
import { useTeamFollows } from '@/hooks/useTeamFollows';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { GameWithPrediction, GameStatus, Sport } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { displayConfidence, displayEdgeRating, displayWinProbability, displaySport, formatGameTime, getConfidenceTier } from '@/lib/display-confidence';

// ─── COLORS ───
const MAROON = '#8B0A1F';
const MAROON_DIM = 'rgba(139,10,31,0.15)';
const TEAL = '#7A9DB8';
const TEAL_DIM = 'rgba(122,157,184,0.12)';
const TEAL_DARK = '#5A7A8A';
const LIVE_RED = '#DC2626';
const ERROR = '#EF4444';
const ERROR_DIM = 'rgba(239,68,68,0.10)';
const SILVER = '#C9CED6';
const BG = '#040608';
const GLASS = 'rgba(8,8,12,0.95)';
const GLASS_INNER = 'rgba(2,3,8,0.92)';
const BORDER = 'rgba(255,255,255,0.08)';
const BORDER_HI = 'rgba(255,255,255,0.14)';
const WHITE = '#FFFFFF';
const TEXT_SECONDARY = '#A1B3C9';
const TEXT_MUTED = '#6B7C94';

const { width: SW } = Dimensions.get('window');
const SPORTS = ['All','NBA','NFL','MLB','NHL','NCAAF','NCAAB','MLS','EPL'] as const;
const SPORT_DISPLAY: Record<string, string> = { NCAAF: 'CFB', NCAAB: 'CBB' };
const SPRING = { stiffness: 300, damping: 22, mass: 1 };
const MODES = ['Game Day','Prep Mode','Review'] as const;
const TC = [TEAL, LIVE_RED, MAROON] as const;

// ─── DISCLAIMER ───
const Disclaimer = memo(function Disclaimer() {
  return <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.08)', textAlign: 'center', lineHeight: 14, marginTop: 8, paddingHorizontal: 20, marginBottom: 32 }}>AI predictions are for entertainment purposes only. Not financial advice.</Text>;
});

// ─── PULSING LIVE BADGE ───
const PulsingLiveBadge = memo(function PulsingLiveBadge() {
  const op = useSharedValue(1); const sc = useSharedValue(1);
  useEffect(() => {
    op.value = withRepeat(withTiming(0.6, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
    sc.value = withRepeat(withTiming(1.05, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => { cancelAnimation(op); cancelAnimation(sc); };
  }, []);
  const ds = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ scale: sc.value }] }));
  const gs = useAnimatedStyle(() => ({ opacity: op.value * 0.5, transform: [{ scale: sc.value * 1.2 }] }));
  return (
    <View style={{ position: 'relative' }}>
      <Animated.View style={[{ position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 14, backgroundColor: 'rgba(220,38,38,0.25)' }, gs]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: WHITE, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, gap: 4 }}>
        <Animated.View style={[{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: LIVE_RED }, ds]} />
        <Text style={{ fontSize: 10, fontWeight: '700', color: LIVE_RED }}>LIVE</Text>
      </View>
    </View>
  );
});

// ─── SEARCH BAR ───
const searchBarOuter = {
  marginHorizontal: 20,
  marginTop: 12,
  marginBottom: 20,
} as const;
const searchBarInner = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  backgroundColor: '#000000',
  borderWidth: 1,
  borderColor: '#7A9DB8',
  borderRadius: 16,
  paddingVertical: 14,
  paddingHorizontal: 16,
} as const;
const SearchBar = memo(function SearchBar() {
  const router = useRouter();
  return (
    <View style={searchBarOuter}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push('/search-explore');
        }}
      >
        <View style={searchBarInner}>
          <Search size={18} color="#7A9DB8" strokeWidth={2} />
          <Text style={{ flex: 1, fontSize: 14, color: '#7A9DB8', fontWeight: '400', marginLeft: 12 }}>
            Search games, teams, sports...
          </Text>
        </View>
      </Pressable>
    </View>
  );
});

// ─── SPORT PILLS ───
const SportPills = memo(function SportPills({ selected, onSelect }: { selected: string; onSelect: (s: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 18 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
      {SPORTS.map((s) => {
        const on = selected === s;
        return (
          <Pressable key={s} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelect(s); }}
            style={{ backgroundColor: on ? MAROON : 'rgba(122,157,184,0.08)', borderWidth: on ? 0 : 1, borderColor: on ? 'transparent' : 'rgba(122,157,184,0.12)', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 9 }}>
            <Text style={{ fontSize: 13, fontWeight: on ? '700' : '600', color: on ? WHITE : TEAL, letterSpacing: on ? 0 : 0.4 }}>{SPORT_DISPLAY[s] ?? s}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

// ─── SEGMENTED PILL ───
const SegPill = memo(function SegPill({ active, onChange, hasLive, tx }: { active: number; onChange: (n: number) => void; hasLive: boolean; tx: Animated.SharedValue<number> }) {
  const cw = SW - 40; const sw = (cw - 6) / 3;
  const ss = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value * sw }] }));
  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 22 }}>
      <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 3, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', position: 'relative' }}>
        <Animated.View style={[{ position: 'absolute', top: 3, left: 3, width: sw, height: '100%', backgroundColor: MAROON, borderRadius: 10 }, ss]} />
        {MODES.map((l, i) => (
          <Pressable key={l} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(i); }}
            style={{ flex: 1, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 }}>
            {i === 0 && hasLive ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED }} /> : null}
            <Text style={{ fontSize: 11, fontWeight: '600', color: active === i ? WHITE : TEXT_MUTED }}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

// ─── FOLLOWED GAME CARD ───
const FollowedCard = memo(function FollowedCard({ game }: { game: GameWithPrediction }) {
  const router = useRouter();
  const live = game.status === GameStatus.LIVE;
  const final = game.status === GameStatus.FINAL;
  const t = new Date(game.gameTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dotOp = useSharedValue(1);
  useEffect(() => { if (live) { dotOp.value = withRepeat(withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true); } return () => cancelAnimation(dotOp); }, [live]);
  const ds = useAnimatedStyle(() => ({ opacity: dotOp.value }));
  return (
    <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/game/${game.id}`); }}
      style={{ minWidth: 150, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: live ? 'rgba(220,38,38,0.25)' : 'rgba(255,255,255,0.12)' }}>
      {/* Background layers */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#060810' }} />
      {/* Maroon→teal diagonal wash */}
      <LinearGradient
        colors={live ? ['rgba(220,38,38,0.08)', 'transparent', 'rgba(122,157,184,0.04)'] : ['rgba(139,10,31,0.06)', 'transparent', 'rgba(122,157,184,0.04)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* Top accent line */}
      <LinearGradient
        colors={live ? [LIVE_RED, 'rgba(220,38,38,0.3)', 'transparent'] : [MAROON, TEAL]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ height: 2 }}
      />
      {/* Content */}
      <View style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
        {/* Sport badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <View style={{ backgroundColor: 'rgba(122,157,184,0.1)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ fontSize: 8, fontWeight: '800', color: TEAL, letterSpacing: 1 }}>{displaySport(game.sport)}</Text>
          </View>
          {live ? (
            <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED }, ds]} />
          ) : null}
        </View>
        {/* Teams */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: WHITE }}>{game.awayTeam.abbreviation}</Text>
          <View style={{ width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 0.5 }} />
          <Text style={{ fontSize: 18, fontWeight: '900', color: WHITE }}>{game.homeTeam.abbreviation}</Text>
        </View>
        {/* Status */}
        {live ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE }}>{game.awayScore ?? 0} - {game.homeScore ?? 0}</Text>
            <Text style={{ fontSize: 9, color: LIVE_RED, fontWeight: '700' }}>{formatGameTime(game.sport, game.quarter, game.clock) ?? null}</Text>
          </View>
        ) : final ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: TEXT_SECONDARY }}>{game.awayScore ?? 0} - {game.homeScore ?? 0}</Text>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 0.5 }}>FINAL</Text>
            </View>
          </View>
        ) : (
          <Text style={{ fontSize: 12, fontWeight: '600', color: TEXT_MUTED }}>{t}</Text>
        )}
      </View>
    </Pressable>
  );
});

// ─── YOUR GAMES ───
const YourGames = memo(function YourGames({ games }: { games: GameWithPrediction[] }) {
  const router = useRouter();
  if (games.length === 0) return (
    <View style={{ marginHorizontal: 20, marginBottom: 28 }}>
      <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE, marginBottom: 8 }}>Your Games</Text>
      <View style={{ backgroundColor: GLASS, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 20, alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: TEXT_MUTED, textAlign: 'center', marginBottom: 12 }}>Follow games or teams to track them here</Text>
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)'); }}
          style={{ backgroundColor: MAROON_DIM, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: MAROON }}>Browse Games</Text>
        </Pressable>
      </View>
    </View>
  );
  return (
    <View style={{ marginBottom: 28 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE }}>Your Games</Text>
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)'); }}>
          <Text style={{ fontSize: 11, fontWeight: '600', color: TEAL }}>Browse +</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingVertical: 8 }}>
        {games.map((g) => <FollowedCard key={g.id} game={g} />)}
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)'); }}
          style={{ width: 65, borderRadius: 16, borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: MAROON_DIM, alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={14} color={MAROON} />
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
});

// ─── LIVE CARD (gradient + sport pill + tappable) ───
const LiveCard = memo(function LiveCard({ game, pick, cardWidth }: { game: GameWithPrediction; pick?: UserPick; cardWidth: number }) {
  const router = useRouter();
  const hs = game.homeScore ?? 0; const as2 = game.awayScore ?? 0;
  const ph = pick?.pickedTeam === 'home';
  const pt = ph ? game.homeTeam : game.awayTeam;
  const ps = ph ? hs : as2; const os = ph ? as2 : hs;
  const lead = ps > os; const d = ps - os;
  const awayColors = getTeamColors(game.awayTeam.abbreviation, game.sport as Sport, game.awayTeam.color);
  const homeColors = getTeamColors(game.homeTeam.abbreviation, game.sport as Sport, game.homeTeam.color);
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/game/[id]', params: { id: game.id } }); }}
      style={{ opacity: 1, width: cardWidth }}
    >
      <View style={{ borderRadius: 22, borderWidth: 1.5, borderColor: BORDER_HI, overflow: 'hidden' }}>
        {/* Dark base */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#06080A' }} />
        {/* Team color washes */}
        <LinearGradient colors={[`${awayColors.primary}22`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 0.5 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <LinearGradient colors={['transparent', `${homeColors.primary}18`]} start={{ x: 0.4, y: 0.5 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        {/* Shimmer ribbon */}
        <LinearGradient colors={[MAROON, TEAL, MAROON]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5, width: '100%' }} />
        {/* Ribbon bleed glow */}
        <LinearGradient colors={['rgba(122,157,184,0.06)', 'rgba(139,10,31,0.03)', 'transparent']} style={{ height: 40, width: '100%' }} />
        {/* Live + sport — overlapping the ribbon bleed */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: -20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED }} />
            <Text style={{ fontSize: 11, fontWeight: '800', color: WHITE, letterSpacing: 0.5 }}>LIVE</Text>
          </View>
          <View style={{ backgroundColor: 'rgba(122,157,184,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(122,157,184,0.3)' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: WHITE, letterSpacing: 0.5 }}>{displaySport(game.sport)}</Text>
          </View>
        </View>

        {/* Card content */}
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}>
          {/* Scores */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: TEXT_SECONDARY, marginBottom: 2, letterSpacing: 0.5 }}>{game.awayTeam.abbreviation}</Text>
              {pick?.pickedTeam === 'away' ? <View style={{ width: 16, height: 2, backgroundColor: MAROON, borderRadius: 1, marginBottom: 2 }} /> : null}
              <Text style={{ fontSize: 48, fontFamily: 'VT323_400Regular', color: WHITE, letterSpacing: 2 }}>{as2}</Text>
            </View>
            <View style={{ alignItems: 'center', marginHorizontal: 8 }}>
              <Text style={{ fontSize: 20, fontWeight: '300', color: 'rgba(255,255,255,0.15)' }}>–</Text>
              {(() => {
                const timeStr = formatGameTime(game.sport, game.quarter, game.clock);
                return timeStr ? (
                  <Text style={{ fontSize: 14, fontFamily: 'VT323_400Regular', color: 'rgba(255,255,255,0.45)', letterSpacing: 1, marginTop: 2 }}>
                    {timeStr}
                  </Text>
                ) : null;
              })()}
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: TEXT_SECONDARY, marginBottom: 2, letterSpacing: 0.5 }}>{game.homeTeam.abbreviation}</Text>
              {pick?.pickedTeam === 'home' ? <View style={{ width: 16, height: 2, backgroundColor: MAROON, borderRadius: 1, marginBottom: 2 }} /> : null}
              <Text style={{ fontSize: 48, fontFamily: 'VT323_400Regular', color: WHITE, letterSpacing: 2 }}>{hs}</Text>
            </View>
          </View>
          {/* Stat boxes */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, backgroundColor: GLASS_INNER, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: MAROON, letterSpacing: 1, marginBottom: 4 }}>YOUR PICK</Text>
              {pick ? (<><Text style={{ fontSize: 16, fontWeight: '800', color: WHITE }}>{pt?.abbreviation}</Text><Text style={{ fontSize: 9, fontWeight: '600', color: lead ? TEAL : d === 0 ? TEXT_MUTED : ERROR, marginTop: 2 }}>{lead ? 'Leading' : d === 0 ? 'Tied' : 'Trailing'}</Text></>) : <Text style={{ fontSize: 10, color: TEXT_MUTED }}>No pick</Text>}
            </View>
            <View style={{ flex: 1, backgroundColor: GLASS_INNER, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: MAROON, letterSpacing: 1, marginBottom: 4 }}>MOMENTUM</Text>
              <View style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end', height: 20, marginBottom: 2 }}>
                {[0.4,0.7,0.5,0.9,0.6].map((h,i) => <View key={i} style={{ width: 4, height: 8+h*12, borderRadius: 2, backgroundColor: h > 0.5 ? TEAL : TEXT_MUTED, opacity: 0.5+h*0.5 }} />)}
              </View>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEAL }}>{lead ? 'Positive' : 'Neutral'}</Text>
            </View>
            {(() => {
              const c = game.prediction?.confidence ?? 50;
              const t = getConfidenceTier(c, game.prediction?.isTossUp);
              return (
                <View style={{ flex: 1, backgroundColor: GLASS_INNER, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: BORDER }}>
                  <Text style={{ fontSize: 8, fontWeight: '700', color: MAROON, letterSpacing: 1, marginBottom: 4 }}>PICK STRENGTH</Text>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: t.color }}>{t.label}</Text>
                </View>
              );
            })()}
          </View>
        </View>
      </View>
    </Pressable>
  );
});

// ─── GENERATE LIVE INTEL ───
function generateLiveIntel(game: GameWithPrediction | null): Array<{ type: 'alert'|'shift'|'trend'|'pulse'; title: string; body: string }> {
  if (!game) return [];
  const pred = game.prediction;
  const intel: Array<{ type: 'alert'|'shift'|'trend'|'pulse'; title: string; body: string }> = [];
  const home = game.homeTeam; const away = game.awayTeam;
  const homeScore = game.homeScore ?? 0; const awayScore = game.awayScore ?? 0;
  const scoreDiff = Math.abs(homeScore - awayScore);
  const totalScore = homeScore + awayScore;
  const leader = homeScore > awayScore ? home : homeScore < awayScore ? away : null;
  const trailer = homeScore > awayScore ? away : homeScore < awayScore ? home : null;
  const quarter = game.quarter ?? '';
  const clock = game.clock ?? '';
  const situation = game.situation ?? '';
  const lastPlay = game.lastPlay ?? '';
  const leaders = game.leaders ?? [];
  const isEarly = quarter.includes('1') || quarter.includes('Top 1') || quarter.includes('Bot 1') || quarter.includes('Top 2');
  const isMid = quarter.includes('2') || quarter.includes('3') || quarter.includes('Half');
  const isLate = quarter.includes('4') || quarter.includes('OT') || quarter.includes('9') || quarter.includes('3rd Period') || quarter.includes('2nd Half');
  const isTied = homeScore === awayScore;
  const conf = displayConfidence(pred?.confidence ?? 50);
  const tierLabel = pred?.isTossUp || conf < 53 ? 'Toss-Up' : conf < 60 ? 'Solid Pick' : conf < 72 ? 'Strong Pick' : 'Lock';
  const predictedWinner = pred ? (pred.predictedWinner === 'home' ? home : away) : null;
  const sport = game.sport;
  const overUnder = game.overUnder;
  const isUpset = leader && predictedWinner && leader.abbreviation !== predictedWinner.abbreviation;

  // ═══ PULSE — PLAY-BY-PLAY FEED ═══
  // Pure action — what just happened on the field/court/ice. No scores, no model talk.
  if (lastPlay && lastPlay.length > 10) {
    const lp = lastPlay.toLowerCase();
    const playTitle = lp.includes('touchdown') ? 'TOUCHDOWN' :
      (lp.includes('goal') && (sport === 'NHL' || sport === 'MLS' || sport === 'EPL')) ? 'GOAL' :
      lp.includes('home run') ? 'HOME RUN' :
      (lp.includes('three pointer') || lp.includes('3-pointer')) ? 'DEEP THREE' :
      lp.includes('dunk') ? 'SLAM' :
      lp.includes('interception') ? 'PICKED OFF' :
      lp.includes('fumble') ? 'LOOSE BALL' :
      lp.includes('steal') ? 'STOLEN' :
      lp.includes('block') ? 'REJECTED' :
      lp.includes('strikeout') ? 'PUNCHOUT' :
      lp.includes('sack') ? 'SACKED' :
      lp.includes('field goal') ? 'THROUGH THE UPRIGHTS' :
      (lp.includes('injury') || lp.includes('hurt') || lp.includes('down on')) ? 'INJURY REPORT' :
      lp.includes('penalty') ? 'FLAG DOWN' :
      lp.includes('foul') ? 'WHISTLE' :
      lp.includes('double') || lp.includes('triple') ? 'EXTRA BASES' :
      lp.includes('save') ? 'BIG SAVE' :
      'LIVE ACTION';
    intel.push({ type: 'pulse', title: playTitle, body: lastPlay });
  } else if (situation) {
    // No last play available — show live game situation instead
    if (sport === 'NFL' || sport === 'NCAAF') {
      intel.push({ type: 'pulse', title: 'ON THE FIELD', body: situation });
    } else if (sport === 'MLB') {
      const isTopHalf = quarter.toLowerCase().includes('top');
      const battingTeam = isTopHalf ? away : home;
      intel.push({ type: 'pulse', title: `${battingTeam.abbreviation} BATTING`, body: `${quarter} — ${situation}` });
    }
  } else if (isLate && scoreDiff <= 3 && leader && trailer) {
    const clockNote = clock ? `${clock} left.` : '';
    intel.push({ type: 'pulse', title: 'CRUNCH TIME', body: `${
      sport === 'NBA' || sport === 'NCAAB' ? `${scoreDiff <= 1 ? 'One bucket changes everything.' : 'Fouling game starting.'} ${clockNote}` :
      sport === 'NFL' || sport === 'NCAAF' ? `Timeouts and clock management decide this. ${clockNote}` :
      sport === 'MLB' ? `Bullpen matchup is critical. ${trailer.abbreviation} running out of outs.` :
      sport === 'NHL' ? `${trailer.abbreviation} pulling their goalie for the extra attacker.` :
      `${trailer.abbreviation} throwing bodies forward. ${clockNote}`
    }` });
  } else if (isLate && isTied) {
    intel.push({ type: 'pulse', title: 'DEADLOCK', body: `${
      sport === 'NBA' || sport === 'NCAAB' ? 'Last possession decides it. Who draws the play?' :
      sport === 'NFL' || sport === 'NCAAF' ? 'Both coaches want the ball last. Field goal range wins it.' :
      sport === 'MLB' ? 'Free baseball incoming — bullpen depth decides extras.' :
      sport === 'NHL' ? 'Next goal wins. 3-on-3 OT is pure chaos.' :
      'Set pieces and late subs are everything right now.'
    }` });
  }

  // ═══ ALERT — PERFORMERS & IMPACT PLAYERS ═══
  // Who's making plays. No game state, no model — just the players doing damage.
  const homeLeaders = leaders.filter(l => l.team === 'home');
  const awayLeaders = leaders.filter(l => l.team === 'away');
  if (homeLeaders.length > 0 || awayLeaders.length > 0) {
    const lines: string[] = [];
    if (homeLeaders[0]) lines.push(`${homeLeaders[0].name} — ${homeLeaders[0].stat}`);
    if (awayLeaders[0]) lines.push(`${awayLeaders[0].name} — ${awayLeaders[0].stat}`);
    // Add second performers if available for depth
    if (homeLeaders[1]) lines.push(`${homeLeaders[1].name} — ${homeLeaders[1].stat}`);
    if (awayLeaders[1]) lines.push(`${awayLeaders[1].name} — ${awayLeaders[1].stat}`);
    intel.push({ type: 'alert', title: 'Impact Players', body: lines.join('\n') });
  } else if (pred?.analysis) {
    intel.push({ type: 'alert', title: 'Scouting Report', body: pred.analysis });
  }

  // ═══ SHIFT — AI MODEL VS THE SCOREBOARD ═══
  // This is unique to Clutch Picks — no other app shows this. Pure model intelligence.
  if (isUpset && leader && trailer) {
    intel.push({ type: 'shift', title: 'Upset Brewing', body: `The model had ${predictedWinner?.abbreviation} as a ${tierLabel} — but ${leader.abbreviation} is proving otherwise. ${
      isLate ? `This upset looks real. ${predictedWinner?.abbreviation} is out of answers.` :
      scoreDiff >= 10 ? `Miracle rally territory for ${predictedWinner?.abbreviation}.` :
      `${predictedWinner?.abbreviation} still has time but the pressure is mounting.`
    }` });
  } else if (leader && predictedWinner && leader.abbreviation === predictedWinner.abbreviation && scoreDiff >= 5) {
    intel.push({ type: 'shift', title: 'Model Holding', body: `${tierLabel} pick on ${predictedWinner.abbreviation} is playing out. The AI saw the mismatch pre-game and the scoreboard confirms it.` });
  } else if (isTied && totalScore === 0) {
    intel.push({ type: 'shift', title: 'First Blood Pending', body: `Model gives ${home.abbreviation} a ${pred?.homeWinProbability ?? 50}% win probability with home-field advantage. First score sets the tone for how this plays out.` });
  } else if (isTied && totalScore > 0) {
    intel.push({ type: 'shift', title: 'Model Waiting', body: `${pred?.isTossUp ? 'Rated Toss-Up pre-game — the tie is expected.' : `The model picked ${predictedWinner?.abbreviation} — they need to separate soon or this becomes anyone\'s game.`}` });
  } else if (leader && predictedWinner && leader.abbreviation === predictedWinner.abbreviation && scoreDiff <= 4) {
    intel.push({ type: 'shift', title: 'Razor Thin', body: `${predictedWinner.abbreviation} leads but barely. The model's ${tierLabel} pick is surviving, not thriving. ${isLate ? 'Execution wins close ones.' : 'This could flip any moment.'}` });
  }

  // ═══ TREND — PACE, OVER/UNDER, STREAKS ═══
  // Data-driven insight you can't get from watching — pace projections, streak context.
  if (overUnder && totalScore > 0 && (isMid || isLate)) {
    const periodFactor = sport === 'NBA' || sport === 'NCAAB' ? 2 : sport === 'MLB' ? (9 / Math.max(1, parseInt(quarter.match(/\d+/)?.[0] ?? '5'))) : 2.5;
    const projectedTotal = Math.round(totalScore * periodFactor);
    const diff = projectedTotal - overUnder;
    if (Math.abs(diff) > overUnder * 0.1) {
      const direction = diff > 0 ? 'OVER' : 'UNDER';
      intel.push({ type: 'trend', title: `Pace: ${direction}`, body: `Projected ${projectedTotal} total vs the ${overUnder} line. ${
        diff > 0 ? (sport === 'NBA' ? 'No defense tonight — both teams running.' : sport === 'MLB' ? 'Pitching staffs getting lit up.' : 'Offenses are in control.') :
        (sport === 'NBA' ? 'Grind-it-out game. Half-court sets and tough defense.' : sport === 'MLB' ? 'Pitchers dealing. Runs are hard to come by.' : 'Low-event game — defenses suffocating.')
      }` });
    }
  }

  if (!intel.some(i => i.type === 'trend')) {
    if (pred?.homeStreak && pred.homeStreak >= 3) {
      const streakStatus = leader?.abbreviation === home.abbreviation ? 'alive and well' : leader ? 'hanging by a thread' : 'being tested';
      intel.push({ type: 'trend', title: `${pred.homeStreak}-Game Streak`, body: `${home.abbreviation} entered on a ${pred.homeStreak}-game heater. Tonight the streak is ${streakStatus}.` });
    } else if (pred?.awayStreak && pred.awayStreak >= 3) {
      const streakStatus = leader?.abbreviation === away.abbreviation ? 'rolling' : leader ? 'in jeopardy' : 'being challenged';
      intel.push({ type: 'trend', title: `${away.abbreviation} on a ${pred.awayStreak}-Game Run`, body: `Road warriors. ${away.abbreviation} has been unbeatable recently and tonight they're ${streakStatus}.` });
    } else if (pred?.ensembleDivergence) {
      intel.push({ type: 'trend', title: 'Volatile Game', body: `Our 3-model ensemble couldn't agree on this one pre-game. When models split, in-game swings are 40% more likely. Stay locked in.` });
    }
  }

  return intel;
}

// ─── INTEL CARD ───
const IntelCard = memo(function IntelCard({ type, title, body }: { type: 'alert'|'shift'|'trend'|'pulse'; title: string; body: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = body.length > 140;
  const displayBody = expanded || !isLong ? body : body.substring(0, 140) + '...';
  const bc = type === 'pulse' ? '#8B0A1F' : type === 'alert' ? LIVE_RED : type === 'shift' ? TEAL_DARK : SILVER;
  const bl = type === 'pulse' ? 'PULSE' : type === 'alert' ? 'ALERT' : type === 'shift' ? 'SHIFT' : 'TREND';
  return (
    <Pressable onPress={() => { if (isLong) setExpanded(!expanded); }} style={{ backgroundColor: GLASS, borderRadius: 14, padding: 13, paddingLeft: 18, borderWidth: 1, borderColor: BORDER, marginBottom: 8, position: 'relative' }}>
      <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, backgroundColor: bc, borderRadius: 2 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}><View style={{ backgroundColor: `${bc}22`, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ fontSize: 8, fontWeight: '700', color: bc, letterSpacing: 0.5 }}>{bl}</Text></View></View>
      <Text style={{ fontSize: 12, fontWeight: '600', color: WHITE, marginBottom: 4 }}>{title}</Text>
      <Text style={{ fontSize: 11, color: TEXT_SECONDARY, lineHeight: 16.5 }}>{displayBody}</Text>
      {isLong && !expanded ? <Text style={{ fontSize: 10, color: bc, fontWeight: '600', marginTop: 4 }}>Tap to read more</Text> : null}
    </Pressable>
  );
});

// ─── HORIZON CARD ───
const HorizonCard = memo(function HorizonCard({ game, index }: { game: GameWithPrediction; index: number }) {
  const router = useRouter();
  const d = new Date(game.gameTime); const h = d.getHours(); const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM'; const dh = h % 12 || 12;
  const ts = `${dh}:${m.toString().padStart(2,'0')}`;
  const ic = game.prediction ? [game.prediction.isTossUp, (game.prediction.edgeRating??0) >= 7, (game.prediction.homeStreak??0) >= 3||(game.prediction.awayStreak??0) >= 3, game.prediction.ensembleDivergence].filter(Boolean).length : 0;
  return (
    <Pressable onPress={() => router.push(`/game/${game.id}`)} style={{ backgroundColor: GLASS, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: TC[index%3], alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
        <Text style={{ fontSize: 13, fontWeight: '800', color: WHITE }}>{ts}</Text>
        <Text style={{ fontSize: 9, fontWeight: '600', color: WHITE }}>{ap}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE }}>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</Text>
        <Text style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 2 }}>{game.prediction ? 'High interest' : 'Scheduled'}{ic > 0 ? ` · ${ic} insight${ic!==1?'s':''}` : null}</Text>
      </View>
      <ChevronRight size={16} color={TEXT_MUTED} />
    </Pressable>
  );
});

// ─── PREDICTIONS STRIP ───
const PredStrip = memo(function PredStrip({ picks }: { picks: UserPick[] }) {
  // Sort by date descending, take last 10 resolved picks for the chart
  const sorted = [...picks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const resolved = sorted.filter(p => p.result === 'win' || p.result === 'loss');
  const pending = sorted.filter(p => p.result !== 'win' && p.result !== 'loss');
  const l10 = resolved.slice(0, 10);
  const pendingCount = pending.length;
  const c = l10.filter(p => p.result === 'win').length;
  const t = l10.length;
  const a = t > 0 ? Math.round((c / t) * 100) : 0;
  // Show oldest first in the chart (left = oldest, right = newest)
  const chartPicks = [...l10].reverse();
  return (
    <View style={{ backgroundColor: GLASS, borderWidth: 1, borderColor: 'rgba(139,10,31,0.14)', borderRadius: 18, padding: 18, marginHorizontal: 20, marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: WHITE }}>Your predictions</Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: a >= 50 ? TEAL : MAROON }}>{a}%</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 4, alignItems: 'flex-end', height: 24, marginBottom: 8 }}>
        {chartPicks.map((p, i) => (
          <View key={p.id || String(i)} style={{
            flex: 1,
            height: p.result === 'win' ? 24 : 8,
            borderRadius: 2,
            backgroundColor: p.result === 'win' ? TEAL : ERROR,
            opacity: p.result === 'win' ? 0.9 : 0.5,
          }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 10, color: TEXT_MUTED }}>
          Last {t} resolved{pendingCount > 0 ? ` · ${pendingCount} pending` : null}
        </Text>
        <Text style={{ fontSize: 10, color: TEAL }}>{c} correct</Text>
      </View>
    </View>
  );
});

// ─── INSIGHT FUNCTIONS ───
function genInsight(games: GameWithPrediction[]): { headline: string; teams: string[] } {
  const s = games.filter(g => g.status === GameStatus.SCHEDULED && g.prediction);
  if (s.length === 0) return { headline: 'No games on the board yet — check back closer to game time.', teams: [] };

  const locks = s.filter(g => g.prediction!.confidence >= 72);
  const strong = s.filter(g => g.prediction!.confidence >= 60 && g.prediction!.confidence < 72);
  const tossups = s.filter(g => g.prediction!.isTossUp);
  const streakers = s.filter(g => (g.prediction!.homeStreak??0) >= 4 || (g.prediction!.awayStreak??0) >= 4);
  const upsets = s.filter(g => {
    const p = g.prediction!;
    const loser = p.predictedWinner === 'home' ? g.awayTeam : g.homeTeam;
    const loserRec = loser.record.split('-').map(Number);
    const loserPct = loserRec[0] / Math.max(loserRec[0] + (loserRec[1] ?? 0), 1);
    return p.confidence >= 55 && p.confidence <= 65 && loserPct > 0.5;
  });
  const sports = new Set(s.map(g => g.sport));

  if (locks.length >= 2) {
    return { headline: `${locks.length} games tonight hit Lock status — that's rare. The model sees dominant edges. Don't sleep on these.`, teams: locks.slice(0,3).map(g => g.prediction!.predictedWinner==='home' ? g.homeTeam.name : g.awayTeam.name) };
  }
  if (upsets.length >= 2) {
    return { headline: `${upsets.length} upset candidates are lurking tonight. The underdogs have the recent form to pull it off — high-risk, high-reward slate.`, teams: upsets.slice(0,3).map(g => { const p = g.prediction!; return p.predictedWinner === 'home' ? g.awayTeam.name : g.homeTeam.name; }) };
  }
  if (streakers.length >= 2) {
    return { headline: `${streakers.length} teams riding hot streaks collide tonight. History says streaks break in spots like this — watch closely.`, teams: streakers.slice(0,3).map(g => (g.prediction!.homeStreak??0) >= 4 ? g.homeTeam.name : g.awayTeam.name) };
  }
  if (strong.length >= 3) {
    return { headline: `Loaded slate — ${strong.length} Strong Picks across ${sports.size} sports. The model found real separation in multiple matchups tonight.`, teams: strong.slice(0,3).map(g => g.prediction!.predictedWinner==='home' ? g.homeTeam.name : g.awayTeam.name) };
  }
  if (tossups.length >= 3) {
    return { headline: `Chaos night. ${tossups.length} games are dead even — the model can barely separate them. Gut-check picks only.`, teams: tossups.slice(0,3).map(g => `${g.awayTeam.abbreviation}/${g.homeTeam.abbreviation}`) };
  }
  if (s.length >= 8) {
    return { headline: `Massive slate tonight — ${s.length} games across ${sports.size} sports. The model has scanned every angle. Your edge is here.`, teams: [] };
  }
  return { headline: `${s.length} games tonight. The AI has broken down every matchup — here's where the value is.`, teams: [] };
}

type DrawType = 'streak_clash'|'dominant_favorite'|'upset_brewing'|'toss_up'|'high_value'|'model_conflict'|'hot_team'|'cold_team'|'record_mismatch'|'default';

function genMatchup(game: GameWithPrediction, usedTypes: Set<DrawType>): { tags: string[]; headline: string; detail: string; drawType: DrawType } {
  const p = game.prediction!;
  const home = game.homeTeam; const away = game.awayTeam;
  const winner = p.predictedWinner === 'home' ? home : away;
  const loser = p.predictedWinner === 'home' ? away : home;
  const tags: string[] = [];
  const conf = p.confidence ?? 55; const edge = p.edgeRating ?? 5; const value = p.valueRating ?? 5;
  const mTier = p.isTossUp || conf < 53 ? 'Toss-Up' : conf < 60 ? 'Solid Pick' : conf < 72 ? 'Strong Pick' : 'Lock';
  const hStreak = p.homeStreak ?? 0; const aStreak = p.awayStreak ?? 0;
  const sport = game.sport;
  const homeWP = p.homeWinProbability ?? 50;
  const awayWP = p.awayWinProbability ?? 50;
  const spread = game.spread;
  const overUnder = game.overUnder;
  const venue = game.venue;

  const parseForm = (form: string | undefined) => {
    if (!form) return { wins: 0, total: 0, str: '' };
    const chars = form.split('').filter((c: string) => c === 'W' || c === 'L');
    return { wins: chars.filter((c: string) => c === 'W').length, total: Math.max(chars.length, 1), str: chars.join('') };
  };
  const hf = parseForm(p.recentFormHome);
  const af = parseForm(p.recentFormAway);

  const pr = (r: string) => { const [w,l] = r.split('-').map(Number); return { w: w??0, l: l??0, t: (w??0)+(l??0) }; };
  const hr = pr(home.record); const ar = pr(away.record);
  const hPct = hr.w / Math.max(hr.t, 1); const aPct = ar.w / Math.max(ar.t, 1);
  const winnerIsHome = p.predictedWinner === 'home';

  let hl = ''; let dt = ''; let drawType: DrawType = 'default';
  const trySet = (type: DrawType): boolean => { if (usedTypes.has(type)) return false; drawType = type; return true; };

  // Sport-specific flavor
  const sportAction = sport === 'NBA' || sport === 'NCAAB' ? 'on the hardwood' :
    sport === 'NFL' || sport === 'NCAAF' ? 'under the lights' :
    sport === 'MLB' ? 'on the diamond' :
    sport === 'NHL' ? 'on the ice' :
    'on the pitch';

  // 1. STREAK CLASH — two hot teams collide
  if (!hl && hStreak >= 3 && aStreak >= 3 && trySet('streak_clash')) {
    hl = `${home.abbreviation} W${hStreak} vs ${away.abbreviation} W${aStreak}`;
    tags.push('MUST WATCH', 'STREAK CLASH');
    dt = `Two teams that refuse to lose. ${home.abbreviation} hasn't dropped a game in ${hStreak} tries. ${away.abbreviation} has won ${aStreak} straight on the road. One streak dies tonight ${sportAction}. This is appointment viewing.`;
  }

  // 2. DOMINANT FAVORITE — the model sees a clear mismatch
  if (!hl && conf >= 64 && edge >= 5 && trySet('dominant_favorite')) {
    hl = `${winner.abbreviation} looks unstoppable`;
    tags.push(mTier.toUpperCase(), `${Math.max(homeWP,awayWP)}% WIN PROB`);
    dt = `The AI gives ${winner.abbreviation} a ${Math.max(homeWP,awayWP)}% chance to win — and the data backs it up across ${edge >= 7 ? 'nearly every' : 'multiple'} factor${edge >= 7 ? '' : 's'}. ${loser.abbreviation} would need their best performance of the season to pull this off. ${winner.abbreviation} is built for this matchup.`;
  }

  // 3. UPSET BREWING — the underdog has a real shot
  if (!hl && conf >= 55 && conf <= 65 && trySet('upset_brewing')) {
    const favHome = p.predictedWinner === 'home';
    const underdog = favHome ? away : home;
    const uForm = favHome ? af : hf;
    if (uForm.wins >= 4 && uForm.total >= 5) {
      hl = `${underdog.abbreviation} could shock everyone`;
      tags.push('UPSET ALERT', `${underdog.abbreviation} ${uForm.wins}-${uForm.total - uForm.wins} RECENT`);
      dt = `Don't look at the records — look at the trajectory. ${underdog.abbreviation} has won ${uForm.wins} of their last ${uForm.total} and they're playing with house money tonight. ${winner.abbreviation} is favored, but this is the kind of game where the "better team" loses. Popcorn game.`;
    } else { hl = ''; drawType = 'default'; }
  }

  // 4. TOSS-UP — pure drama
  if (!hl && (p.isTossUp || (conf >= 48 && conf <= 53)) && trySet('toss_up')) {
    hl = "This one's a war";
    tags.push('TOSS-UP', `${homeWP}-${awayWP} SPLIT`);
    dt = `The AI ran every angle and couldn't separate them. ${home.abbreviation} (${home.record}) vs ${away.abbreviation} (${away.record}) is as close to 50/50 as it gets. These are the games that come down to one play, one call, one moment. ${winnerIsHome ? 'Home crowd might be the tiebreaker.' : 'Road poise could be the difference.'}`;
  }

  // 5. MODEL CONFLICT — the AI is arguing with itself
  if (!hl && p.ensembleDivergence && trySet('model_conflict')) {
    hl = 'The AI can\'t agree';
    tags.push('MODELS SPLIT', 'VOLATILE');
    dt = `Our 3-model ensemble is at war over this one. The composite model says ${winner.abbreviation}, but the Elo and form models have different takes. When our AI disagrees with itself, expect the unexpected. This game has chaos written all over it.`;
  }

  // 6. HOT TEAM — riding momentum
  if (!hl && (hStreak >= 3 || aStreak >= 3) && trySet('hot_team')) {
    const hot = hStreak >= aStreak ? home : away; const cold = hot === home ? away : home;
    const streak = Math.max(hStreak, aStreak);
    const isHotOnRoad = hot === away;
    hl = `${hot.abbreviation} is on fire`;
    tags.push(`W${streak} STREAK`, isHotOnRoad ? 'ROAD ROLL' : 'HOME FORTRESS');
    dt = `${hot.abbreviation} has won ${streak} straight — ${isHotOnRoad ? 'and they\'re doing it away from home, which is even scarier' : 'their building has become a nightmare for visitors'}. ${cold.abbreviation} walks into a buzzsaw tonight. Can they be the team to snap it? The model says ${winner.abbreviation === hot.abbreviation ? 'probably not' : 'maybe — the streak is due to end'}.`;
  }

  // 7. HIGH VALUE — the sharpest edge on the board
  if (!hl && edge >= 7 && trySet('high_value')) {
    hl = 'Best edge on the board';
    tags.push('SHARP', `EDGE ${edge}/10`);
    dt = `If you only watch one game tonight, make it this one. ${winner.abbreviation} grades out at ${edge}/10 on edge rating — that means the model found a real statistical gap that the average fan won't see. ${loser.abbreviation} has a blind spot and ${winner.abbreviation} is built to exploit it.`;
  }

  // 8. COLD TEAM — fading fast
  if (!hl && (hf.wins <= 3 || af.wins <= 3) && hf.total >= 5 && trySet('cold_team')) {
    const cold = hf.wins <= af.wins ? home : away;
    const hot = cold === home ? away : home;
    const cW = cold === home ? hf.wins : af.wins;
    const cT = cold === home ? hf.total : af.total;
    hl = `${cold.abbreviation} is spiraling`;
    tags.push(`${cold.abbreviation} ${cW}-${cT - cW} L${cT}`, 'FADE ALERT');
    dt = `${cold.abbreviation} has won just ${cW} of their last ${cT}. The slide is real — confidence is low, the locker room energy is off. ${hot.abbreviation} smells blood. This is a dangerous spot for ${cold.abbreviation} and the AI knows it.`;
  }

  // 9. RECORD MISMATCH — talent gap
  if (!hl && trySet('record_mismatch')) {
    if (Math.abs(hPct - aPct) > 0.15) {
      const better = hPct > aPct ? home : away;
      const worse = better === home ? away : home;
      hl = `${better.abbreviation} is a different class`;
      tags.push(`${better.abbreviation} ${better.record}`, `${worse.abbreviation} ${worse.record}`);
      dt = `The records tell the story before the game starts. ${better.abbreviation} at ${better.record} vs ${worse.abbreviation} at ${worse.record} — that's a ${Math.round(Math.abs(hPct - aPct) * 100)}% win-rate gap. ${worse.abbreviation} needs their A-game just to keep it close. ${better.abbreviation} just needs to show up.`;
    } else { hl = ''; drawType = 'default'; }
  }

  // 10. DEFAULT — each one gets a unique angle based on the data
  if (!hl) {
    drawType = 'default';
    const formDiff = hf.wins - af.wins;
    const gameTime = new Date(game.gameTime);
    const isNightGame = gameTime.getHours() >= 19;
    const isMatinee = gameTime.getHours() < 16;

    if (conf >= 62 && value >= 6) {
      hl = `${winner.abbreviation} checks every box`;
      tags.push('ALL SYSTEMS GO');
      dt = `Form, fundamentals, and matchup advantages all point to ${winner.abbreviation}. The AI found edge in ${edge >= 6 ? 'multiple categories' : 'the key areas'}. ${loser.abbreviation} is decent but they're walking into a bad stylistic matchup tonight.`;
    } else if (spread !== undefined && Math.abs(spread) >= 7) {
      hl = `Vegas and the AI agree`;
      tags.push(`SPREAD ${spread > 0 ? home.abbreviation : away.abbreviation} -${Math.abs(spread)}`);
      dt = `The line says ${Math.abs(spread)} points, and our model doesn't disagree. ${winner.abbreviation} should control this one from wire to wire. The question isn't who wins — it's by how much.`;
    } else if (overUnder && overUnder >= (sport === 'NBA' ? 230 : sport === 'NFL' ? 50 : sport === 'MLB' ? 9 : sport === 'NHL' ? 6.5 : 3.5)) {
      hl = 'Fireworks incoming';
      tags.push(`O/U ${overUnder}`, 'HIGH SCORING');
      dt = `The over/under is set at ${overUnder} — this has shootout written all over it. Both teams push pace and neither defense inspires confidence. Grab a seat and enjoy the show.`;
    } else if (winnerIsHome && hPct > 0.55 && isNightGame) {
      hl = `${home.abbreviation}'s house, ${home.abbreviation}'s rules`;
      tags.push('HOME ADVANTAGE');
      dt = `Primetime at ${venue !== 'TBD' ? venue : 'home'}. ${home.abbreviation} (${home.record}) thrives in front of their crowd and the AI has them favored tonight. ${away.abbreviation} needs to silence the building early or this one gets away from them.`;
    } else if (!winnerIsHome && aPct > 0.55) {
      hl = `${away.abbreviation} fears nobody`;
      tags.push('ROAD PICK');
      dt = `${away.abbreviation} (${away.record}) doesn't care about the travel. They're favored ${sportAction} despite being the visitor — that's how good they are right now. ${home.abbreviation} can't rely on crowd noise alone.`;
    } else if (Math.abs(formDiff) >= 2 && hf.total >= 5) {
      const hotter = formDiff > 0 ? home : away;
      const colder = formDiff > 0 ? away : home;
      const hotW = formDiff > 0 ? hf.wins : af.wins;
      const hotT = formDiff > 0 ? hf.total : af.total;
      hl = `Momentum belongs to ${hotter.abbreviation}`;
      tags.push(`${hotter.abbreviation} ${hotW}-${hotT - hotW} RECENT`);
      dt = `Forget the season record — recent form is everything. ${hotter.abbreviation} is ${hotW}-${hotT - hotW} in their last ${hotT} while ${colder.abbreviation} has been inconsistent. In sports, hot beats talented. ${hotter.abbreviation} has the energy right now.`;
    } else if (isMatinee) {
      hl = `Early tip, big opportunity`;
      tags.push(displaySport(sport));
      dt = `Matinee matchup — ${away.abbreviation} at ${home.abbreviation}. The model leans ${winner.abbreviation} and gives them a ${Math.max(homeWP,awayWP)}% win probability. Early games fly under the radar — that's where smart pickers find value.`;
    } else {
      hl = `${away.abbreviation} invades ${home.abbreviation}`;
      tags.push(displaySport(sport), `${Math.max(homeWP,awayWP)}% WIN PROB`);
      dt = `${away.abbreviation} (${away.record}) travels to face ${home.abbreviation} (${home.record}) tonight. The AI sees a ${conf >= 60 ? 'clear' : 'slight'} edge for ${winner.abbreviation}. ${conf < 58 ? 'Tight matchup — trust the process but stay nimble.' : 'The data is leaning one direction. Make your move.'}`;
    }
  }

  return { tags, headline: hl, detail: dt, drawType };
}

// ─── MATCHUP CARD (collapsible) ───
const MatchupCard = memo(function MatchupCard({ game, rank, headline, tags, detail, defaultExpanded }: { game: GameWithPrediction; rank: number; headline: string; tags: string[]; detail: string; defaultExpanded?: boolean }) {
  const router = useRouter(); const isFirst = rank === 1;
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  return (
    <View style={{ backgroundColor: GLASS, borderRadius: 14, borderWidth: 1, borderColor: BORDER, borderLeftWidth: 3, borderLeftColor: isFirst ? MAROON : TEAL, marginBottom: 10, overflow: 'hidden' }}>
      <Pressable onPress={() => setExpanded(e => !e)} style={{ padding: 14, paddingBottom: expanded ? 6 : 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: isFirst ? MAROON_DIM : TEAL_DIM, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: isFirst ? MAROON : TEAL }}>{rank}</Text>
          </View>
          <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE, flex: 1 }}>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</Text>
          {tags.length > 0 ? <View style={{ backgroundColor: MAROON_DIM, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginRight: 8 }}><Text style={{ fontSize: 9, fontWeight: '700', color: MAROON, letterSpacing: 0.3 }}>{tags[0]}</Text></View> : null}
          <Text style={{ fontSize: 16, color: TEXT_MUTED }}>{expanded ? '−' : '+'}</Text>
        </View>
        <Text style={{ fontSize: 12, fontWeight: '600', color: TEXT_SECONDARY, marginLeft: 32 }} numberOfLines={expanded ? undefined : 1}>{headline}</Text>
      </Pressable>
      {expanded ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
          {tags.length > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8, marginLeft: 32 }}>
            {tags.slice(1).map((tg,i) => <View key={tg+i} style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ fontSize: 9, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 0.3 }}>{tg}</Text></View>)}
          </View> : null}
          <Text style={{ fontSize: 11, color: TEXT_SECONDARY, lineHeight: 16.5, marginLeft: 32 }}>{detail}</Text>
          <Pressable onPress={() => router.push(`/game/${game.id}`)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: MAROON_DIM, borderRadius: 10, paddingVertical: 10, marginTop: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: MAROON, marginRight: 4 }}>View Game</Text>
            <ChevronRight size={12} color={MAROON} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

// ─── ACCURACY BY SPORT ───
const AccBySport = memo(function AccBySport({ picks }: { picks: UserPick[] }) {
  const data = useMemo(() => {
    if (!picks?.length) return [];
    const m = new Map<string,{w:number;t:number}>();
    for (const p of picks) { const s = p.sport ?? 'Unknown'; if (s==='Unknown') continue; const e = m.get(s)??{w:0,t:0}; if (p.result==='win') e.w++; if (p.result==='win'||p.result==='loss') e.t++; m.set(s,e); }
    return Array.from(m.entries()).filter(([,d])=>d.t>=2).map(([s,d])=>({s,p:Math.round((d.w/d.t)*100)})).sort((a,b)=>b.p-a.p);
  },[picks]);
  if (!data.length) return <View style={{marginHorizontal:20,marginBottom:16}}><Text style={{fontSize:12,fontWeight:'700',color:WHITE,marginBottom:10}}>Prediction Accuracy by Sport</Text><Text style={{fontSize:11,color:TEXT_MUTED}}>Make picks to see your accuracy by sport</Text></View>;
  return (
    <View style={{marginHorizontal:20,marginBottom:16}}>
      <Text style={{fontSize:12,fontWeight:'700',color:WHITE,marginBottom:12}}>Prediction Accuracy by Sport</Text>
      {data.map(i => {
        const bc = i.p>65?TEAL:i.p>=55?MAROON:'rgba(255,255,255,0.08)';
        const tc = i.p>65?TEAL:i.p>=55?MAROON:TEXT_MUTED;
        return <View key={i.s} style={{marginBottom:10}}><View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:4}}><Text style={{fontSize:11,fontWeight:'600',color:WHITE}}>{i.s}</Text><Text style={{fontSize:11,fontWeight:'700',color:tc}}>{i.p}%</Text></View><View style={{height:4,borderRadius:2,backgroundColor:'rgba(255,255,255,0.04)',overflow:'hidden'}}><View style={{height:'100%',width:`${i.p}%`,backgroundColor:bc,borderRadius:2}} /></View></View>;
      })}
    </View>
  );
});

// ─── STREAK CARD ───
const StreakCard = memo(function StreakCard({ stats }: { stats: UserStats|undefined }) {
  return <View style={{backgroundColor:GLASS,borderWidth:1,borderColor:'rgba(139,10,31,0.12)',borderRadius:18,padding:18,marginHorizontal:20,marginBottom:16}}><Text style={{fontSize:9,fontWeight:'700',color:MAROON,letterSpacing:1.5,marginBottom:6}}>STREAK</Text><Text style={{fontSize:26,fontWeight:'800',color:WHITE}}>{stats?.currentStreak??0} correct in a row</Text><Text style={{fontSize:11,color:TEXT_MUTED,marginTop:4}}>Keep it going — every correct pick extends your streak</Text></View>;
});

// ─── RESULT CARD ───
const ResultCard = memo(function ResultCard({ game, pick }: { game: GameWithPrediction; pick?: UserPick }) {
  const w = pick?.result === 'win'; const hs = game.homeScore??0; const as2 = game.awayScore??0;
  return (
    <View style={{backgroundColor:GLASS,borderRadius:14,borderWidth:1,borderColor:BORDER,padding:14,marginBottom:8}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
        <Text style={{fontSize:14,fontWeight:'700',color:WHITE}}>{game.awayTeam.abbreviation} {as2} - {hs} {game.homeTeam.abbreviation}</Text>
        {pick?<View style={{backgroundColor:w?TEAL_DIM:ERROR_DIM,borderRadius:8,paddingHorizontal:8,paddingVertical:3}}><Text style={{fontSize:9,fontWeight:'700',color:w?TEAL:ERROR}}>{w?'CORRECT':'MISSED'}</Text></View>:null}
      </View>
      {pick?<Text style={{fontSize:11,color:TEXT_SECONDARY,marginTop:6}}>{w?`You called ${pick.pickedTeam==='home'?game.homeTeam.abbreviation:game.awayTeam.abbreviation} · Won by ${Math.abs(hs-as2)}`:`Picked ${pick.pickedTeam==='home'?game.homeTeam.abbreviation:game.awayTeam.abbreviation} — didn't go as planned`}</Text>:null}
    </View>
  );
});

// ─── GAME DAY ───
const CARD_W = SW - 40;

const GameDay = memo(function GameDay({ live, sched, picks, followed, sh, onR, isR }: { live: GameWithPrediction[]; sched: GameWithPrediction[]; picks: UserPick[]; followed: GameWithPrediction[]; sh: any; onR: ()=>void; isR: boolean }) {
  const pm = useMemo(() => { const m = new Map<string,UserPick>(); picks.forEach(p => m.set(p.gameId,p)); return m; }, [picks]);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [liveSearch, setLiveSearch] = useState('');
  const filteredLive = useMemo(() => {
    if (!liveSearch.trim()) return live;
    const q = liveSearch.toLowerCase().trim();
    return live.filter(g =>
      g.homeTeam.name.toLowerCase().includes(q) || g.homeTeam.abbreviation.toLowerCase().includes(q) ||
      g.awayTeam.name.toLowerCase().includes(q) || g.awayTeam.abbreviation.toLowerCase().includes(q) ||
      g.sport.toLowerCase().includes(q)
    );
  }, [live, liveSearch]);
  const focusedGame = filteredLive[focusedIdx] ?? filteredLive[0] ?? null;
  const focusedIntel = useMemo(() => generateLiveIntel(focusedGame), [focusedGame]);

  const onLiveScroll = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + 12));
    if (idx >= 0 && idx < live.length && idx !== focusedIdx) setFocusedIdx(idx);
  }, [live.length, focusedIdx]);

  // No live games
  if (!live.length) return (
    <Animated.ScrollView onScroll={sh} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:120}} refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}>
      <View style={{paddingHorizontal:20,marginTop:4,marginBottom:24}}><Text style={{fontSize:10,fontWeight:'600',color:TEXT_MUTED,letterSpacing:2.5,marginBottom:4}}>MY ARENA</Text><Text style={{fontSize:24,fontWeight:'800',color:WHITE}}>Game Day</Text></View>
      <YourGames games={followed} />
      <View style={{alignItems:'center',paddingTop:28,paddingBottom:24}}><Text style={{fontSize:14,color:TEXT_MUTED}}>No live games right now</Text></View>
      {sched.length>0?<View style={{paddingHorizontal:20,marginBottom:28}}><Text style={{fontSize:12,fontWeight:'700',color:WHITE,marginTop:4,marginBottom:14}}>Coming Up</Text>{sched.slice(0,5).map((g,i)=><HorizonCard key={g.id} game={g} index={i} />)}</View>:null}
      {picks.length>0?<View style={{marginTop:8}}><PredStrip picks={picks} /></View>:null}
      <Disclaimer />
    </Animated.ScrollView>
  );

  // Has live games
  return (
    <Animated.ScrollView onScroll={sh} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:120}} refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}>
      {/* 1. Header */}
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',paddingHorizontal:20,marginTop:4,marginBottom:24}}>
        <View><Text style={{fontSize:10,fontWeight:'600',color:TEXT_MUTED,letterSpacing:2.5,marginBottom:4}}>MY ARENA</Text><Text style={{fontSize:24,fontWeight:'800',color:WHITE}}>Game Day</Text></View>
        <View style={{marginTop:2}}><PulsingLiveBadge /></View>
      </View>

      {/* 2. Your Games */}
      <YourGames games={followed} />

      {/* 3. Live Intelligence header + search */}
      <View style={{paddingHorizontal:20,marginTop:28,marginBottom:12}}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <Text style={{fontSize:16,fontWeight:'800',color:WHITE}}>Live intelligence</Text>
          <Text style={{fontSize:10,color:TEXT_MUTED}}>Updated just now</Text>
        </View>
        {live.length > 0 ? (
          <View style={{flexDirection:'row',alignItems:'center',backgroundColor:'rgba(255,255,255,0.04)',borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.08)',paddingHorizontal:12,paddingVertical:8,gap:8}}>
            <Search size={14} color={TEXT_MUTED} />
            <TextInput
              value={liveSearch}
              onChangeText={setLiveSearch}
              placeholder="Search intelligence..."
              placeholderTextColor='rgba(255,255,255,0.2)'
              style={{flex:1,fontSize:13,fontWeight:'500',color:WHITE,padding:0}}
              keyboardAppearance="dark"
              returnKeyType="done"
            />
            {liveSearch.length > 0 ? (
              <Pressable onPress={() => setLiveSearch('')} hitSlop={8}>
                <Text style={{fontSize:14,color:TEXT_MUTED}}>×</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* 4. Scrollable live cards */}
      {filteredLive.length === 0 && liveSearch.trim() ? (
        <View style={{alignItems:'center',paddingVertical:20}}>
          <Text style={{fontSize:13,color:TEXT_MUTED}}>No live games match "{liveSearch}"</Text>
        </View>
      ) : filteredLive.length === 1 ? (
        <View style={{paddingHorizontal:20,marginBottom:8}}>
          <LiveCard game={filteredLive[0]} pick={pm.get(filteredLive[0].id)} cardWidth={CARD_W} />
        </View>
      ) : (
        <ScrollView
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          snapToInterval={CARD_W + 12} decelerationRate="fast"
          contentContainerStyle={{paddingHorizontal:20,gap:12}}
          onScroll={onLiveScroll} scrollEventThrottle={16}
          style={{flexGrow:0}}
        >
          {filteredLive.map((g) => <LiveCard key={g.id} game={g} pick={pm.get(g.id)} cardWidth={CARD_W} />)}
        </ScrollView>
      )}

      {/* 5. Page dots */}
      {filteredLive.length > 1 ? (
        <View style={{flexDirection:'row',justifyContent:'center',gap:4,marginTop:10,marginBottom:4}}>
          {filteredLive.map((_,i) => <View key={i} style={{width:i===focusedIdx?8:4,height:4,borderRadius:2,backgroundColor:i===focusedIdx?MAROON:'rgba(255,255,255,0.15)'}} />)}
        </View>
      ) : null}

      {/* 6. Intel feed — tied to focused game */}
      {focusedIntel.length > 0 ? (
        <View style={{paddingHorizontal:20,marginTop:20,marginBottom:28}}>
          {focusedIntel.map((c,i) => <IntelCard key={`${focusedGame?.id}-${i}`} type={c.type} title={c.title} body={c.body} />)}
        </View>
      ) : null}

      {/* 7. On the Horizon */}
      {sched.length>0?<View style={{paddingHorizontal:20,marginBottom:28}}><Text style={{fontSize:12,fontWeight:'700',color:WHITE,marginTop:4,marginBottom:14}}>On the Horizon</Text>{sched.slice(0,6).map((g,i)=><HorizonCard key={g.id} game={g} index={i} />)}</View>:null}

      {/* 8. Predictions */}
      {picks.length>0?<View style={{marginTop:8,marginBottom:28}}><PredStrip picks={picks} /></View>:null}

      {/* 9. Disclaimer */}
      <Disclaimer />
    </Animated.ScrollView>
  );
});

// ─── PREP SUB-TABS ───
const PREP_TABS = ['Ranked', 'Underdogs'] as const;

// ─── PREP MODE ───
const Prep = memo(function Prep({ sched, picks, stats, sh, onR, isR }: { sched: GameWithPrediction[]; picks: UserPick[]; stats: UserStats|undefined; sh: any; onR: ()=>void; isR: boolean }) {
  const [prepTab, setPrepTab] = useState<0|1>(0);
  const insight = useMemo(() => genInsight(sched), [sched]);
  const ranked = useMemo(() => {
    const withPred = sched.filter(g => g.prediction);
    const sorted = withPred.sort((a,b) => {
      const s = (g: GameWithPrediction) => g.prediction!.confidence*0.6+(g.prediction!.edgeRating??5)*2.5+(g.prediction!.valueRating??5)*1.5;
      return s(b)-s(a);
    });
    const usedTypes = new Set<DrawType>();
    return sorted.map(g => {
      const r = genMatchup(g, usedTypes);
      usedTypes.add(r.drawType);
      return { game: g, ...r };
    });
  }, [sched]);

  const underdogPlays = useMemo(() => {
    return ranked
      .filter(r => {
        const mf = r.game.marketFavorite;
        const pw = r.game.prediction?.predictedWinner;
        return !!mf && !!pw && mf !== pw;
      })
      .map(r => {
        const dog = r.game.prediction!.predictedWinner === 'home' ? r.game.homeTeam : r.game.awayTeam;
        const fav = r.game.prediction!.predictedWinner === 'home' ? r.game.awayTeam : r.game.homeTeam;
        const conf = Math.round(r.game.prediction!.confidence ?? 50);
        return {
          ...r,
          udHeadline: `Engine fades ${fav.abbreviation} — taking ${dog.abbreviation}`,
          udTags: ['UNDERDOG PICK', `${conf}% MODEL CONF`],
        };
      });
  }, [ranked]);

  const router = useRouter();
  const top3 = ranked.slice(0, 3);

  return (
    <Animated.ScrollView onScroll={sh} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:120}} refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}>
      {/* Header */}
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',paddingHorizontal:20,marginTop:4,marginBottom:20}}>
        <View><Text style={{fontSize:10,fontWeight:'600',color:TEXT_MUTED,letterSpacing:2.5,marginBottom:4}}>MY ARENA</Text><Text style={{fontSize:24,fontWeight:'800',color:WHITE}}>Your Insights</Text></View>
        <View style={{flexDirection:'row',alignItems:'center',gap:6}}><View style={{width:6,height:6,borderRadius:3,backgroundColor:MAROON}} /><Text style={{fontSize:11,fontWeight:'700',color:MAROON}}>{sched.length} GAMES</Text></View>
      </View>

      {/* Arena Insight card */}
      <View style={{backgroundColor:GLASS,borderRadius:18,borderWidth:1,borderColor:BORDER,padding:18,marginHorizontal:20,marginBottom:20}}>
        <Text style={{fontSize:9,fontWeight:'700',color:MAROON,letterSpacing:1.5,marginBottom:8}}>ARENA INSIGHT</Text>
        <Text style={{fontSize:15,fontWeight:'700',color:WHITE,lineHeight:23}}>{insight.headline}</Text>
        {insight.teams.length>0?<View style={{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:12}}>{insight.teams.map(t=><View key={t} style={{backgroundColor:MAROON_DIM,borderRadius:10,paddingHorizontal:12,paddingVertical:5}}><Text style={{fontSize:10,fontWeight:'700',color:MAROON}}>{t}</Text></View>)}</View>:null}
      </View>

      {/* Top 3 quick-glance strip */}
      {top3.length > 0 ? (
        <View style={{marginBottom:20}}>
          <Text style={{fontSize:10,fontWeight:'700',color:TEXT_MUTED,letterSpacing:1.5,paddingHorizontal:20,marginBottom:10}}>TOP PICKS AT A GLANCE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal:20,gap:10}} style={{flexGrow:0}}>
            {top3.map((r, i) => {
              const conf = Math.round(r.game.prediction?.confidence ?? 50);
              const winner = r.game.prediction?.predictedWinner === 'home' ? r.game.homeTeam : r.game.awayTeam;
              return (
                <Pressable key={r.game.id} onPress={() => router.push(`/game/${r.game.id}`)} style={{width:140,backgroundColor:GLASS,borderRadius:14,borderWidth:1,borderColor:i===0?'rgba(139,10,31,0.25)':BORDER,padding:12}}>
                  <View style={{flexDirection:'row',alignItems:'center',marginBottom:8}}>
                    <View style={{width:20,height:20,borderRadius:6,backgroundColor:i===0?MAROON_DIM:TEAL_DIM,alignItems:'center',justifyContent:'center',marginRight:6}}>
                      <Text style={{fontSize:9,fontWeight:'800',color:i===0?MAROON:TEAL}}>#{i+1}</Text>
                    </View>
                    <Text style={{fontSize:10,fontWeight:'600',color:TEXT_MUTED}}>{displaySport(r.game.sport)}</Text>
                  </View>
                  <Text style={{fontSize:13,fontWeight:'800',color:WHITE,marginBottom:4}}>{r.game.awayTeam.abbreviation} vs {r.game.homeTeam.abbreviation}</Text>
                  <Text style={{fontSize:10,fontWeight:'600',color:TEAL,marginBottom:2}}>Pick: {winner.abbreviation}</Text>
                  <Text style={{fontSize:10,color:TEXT_MUTED}}>{conf}% confidence</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Sub-tab toggle: Ranked / Underdogs */}
      <View style={{flexDirection:'row',marginHorizontal:20,marginBottom:16,backgroundColor:'rgba(255,255,255,0.04)',borderRadius:12,padding:3}}>
        {PREP_TABS.map((label, idx) => {
          const active = prepTab === idx;
          const count = idx === 0 ? ranked.length : underdogPlays.length;
          return (
            <Pressable key={label} onPress={() => { setPrepTab(idx as 0|1); Haptics.selectionAsync(); }} style={{flex:1,paddingVertical:10,borderRadius:10,alignItems:'center',backgroundColor:active?GLASS:'transparent'}}>
              <Text style={{fontSize:12,fontWeight:'700',color:active?WHITE:TEXT_MUTED}}>{label}{count > 0 ? ` (${count})` : null}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Ranked tab content */}
      {prepTab === 0 ? (
        ranked.length > 0 ? (
          <View style={{paddingHorizontal:20,marginBottom:24}}>
            <Text style={{fontSize:10,fontWeight:'600',color:TEXT_MUTED,letterSpacing:1,marginBottom:12}}>Tap any matchup to expand details</Text>
            {ranked.map((r,i)=><MatchupCard key={r.game.id} game={r.game} rank={i+1} headline={r.headline} tags={r.tags} detail={r.detail} defaultExpanded={i === 0} />)}
          </View>
        ) : (
          <View style={{paddingHorizontal:20,marginBottom:24}}><Text style={{fontSize:12,color:TEXT_MUTED}}>No scheduled games with predictions</Text></View>
        )
      ) : null}

      {/* Underdogs tab content */}
      {prepTab === 1 ? (
        <View style={{paddingHorizontal:20,marginBottom:24}}>
          <Text style={{fontSize:11,color:TEXT_MUTED,lineHeight:16,marginBottom:12}}>Games where the engine disagrees with the market favorite.</Text>
          {underdogPlays.length > 0
            ? underdogPlays.map((r,i)=><MatchupCard key={`ud-${r.game.id}`} game={r.game} rank={i+1} headline={r.udHeadline} tags={[...r.udTags, ...r.tags]} detail={r.detail} defaultExpanded={i === 0} />)
            : <View style={{backgroundColor:GLASS,borderRadius:14,borderWidth:1,borderColor:BORDER,padding:14}}><Text style={{fontSize:11,color:TEXT_MUTED,lineHeight:16}}>No underdog plays surfaced today — the engine is siding with the market on every game.</Text></View>}
        </View>
      ) : null}

      <AccBySport picks={picks} />
      <StreakCard stats={stats} />
      <Disclaimer />
    </Animated.ScrollView>
  );
});

// ─── REVIEW ───
const Review = memo(function Review({ final: fg, picks, stats, sh, onR, isR }: { final: GameWithPrediction[]; picks: UserPick[]; stats: UserStats|undefined; sh: any; onR: ()=>void; isR: boolean }) {
  const pm = useMemo(() => { const m = new Map<string,UserPick>(); picks.forEach(p => m.set(p.gameId,p)); return m; }, [picks]);
  const pfg = useMemo(() => fg.filter(g => pm.has(g.id)), [fg, pm]);
  const w = pfg.filter(g => pm.get(g.id)?.result==='win').length;
  const l = pfg.filter(g => pm.get(g.id)?.result==='loss').length;
  const t = w+l; const a = t>0?Math.round((w/t)*100):0;
  const ds = new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  return (
    <Animated.ScrollView onScroll={sh} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:120}} refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',paddingHorizontal:20,marginTop:4,marginBottom:24}}>
        <View><Text style={{fontSize:10,fontWeight:'600',color:TEXT_MUTED,letterSpacing:2.5,marginBottom:4}}>MY ARENA</Text><Text style={{fontSize:24,fontWeight:'800',color:WHITE}}>Last Night</Text></View>
        <Text style={{fontSize:11,color:TEXT_MUTED}}>{ds}</Text>
      </View>
      {t>0?(
        <View style={{backgroundColor:GLASS,borderRadius:22,borderWidth:1,borderColor:'rgba(139,10,31,0.12)',padding:26,marginHorizontal:20,marginBottom:24,alignItems:'center'}}>
          <Text style={{fontSize:9,fontWeight:'700',color:MAROON,letterSpacing:1.5,marginBottom:8}}>YOUR NIGHT</Text>
          <Text style={{fontSize:56,fontWeight:'800',color:WHITE}}>{w}-{l}</Text>
          <Text style={{fontSize:14,fontWeight:'700',color:MAROON,marginTop:4}}>{a}% accuracy</Text>
          <View style={{flexDirection:'row',gap:3,marginTop:14}}>{pfg.map(g=><View key={g.id} style={{width:48,height:5,borderRadius:2.5,backgroundColor:pm.get(g.id)?.result==='win'?TEAL:ERROR,opacity:pm.get(g.id)?.result==='win'?0.9:0.4}} />)}</View>
        </View>
      ):<View style={{alignItems:'center',paddingVertical:36}}><Text style={{fontSize:13,color:TEXT_MUTED}}>Make some picks to see your results here</Text></View>}
      {pfg.length>0?<View style={{paddingHorizontal:20,marginBottom:24}}><Text style={{fontSize:12,fontWeight:'700',color:WHITE,marginBottom:14}}>Results</Text>{pfg.map(g=><ResultCard key={g.id} game={g} pick={pm.get(g.id)} />)}</View>:null}
      {fg.length>0?<View style={{backgroundColor:GLASS,borderRadius:18,borderWidth:1,borderColor:BORDER,padding:18,marginHorizontal:20,marginBottom:24}}>
        <Text style={{fontSize:12,fontWeight:'700',color:WHITE,marginBottom:14}}>What The Data Caught</Text>
        {fg.slice(0,3).map(g=>{const p=g.prediction;if(!p) return null;const ok=(p.predictedWinner==='home'&&(g.homeScore??0)>(g.awayScore??0))||(p.predictedWinner==='away'&&(g.awayScore??0)>(g.homeScore??0));return <View key={g.id} style={{marginBottom:10,paddingLeft:12,borderLeftWidth:3,borderLeftColor:ok?TEAL:ERROR}}><Text style={{fontSize:11,fontWeight:'600',color:WHITE,marginBottom:2}}>{g.awayTeam.abbreviation} vs {g.homeTeam.abbreviation}</Text><Text style={{fontSize:11,color:TEXT_SECONDARY,lineHeight:16.5}}>{(() => { const tl = p.isTossUp || p.confidence < 53 ? 'a Toss-Up' : p.confidence < 60 ? 'a Solid Pick' : p.confidence < 72 ? 'a Strong Pick' : 'a Lock'; const tm = p.predictedWinner==='home'?g.homeTeam.abbreviation:g.awayTeam.abbreviation; return ok ? `Model correctly predicted ${tm} as ${tl}.` : `Model missed — rated ${tm} as ${tl} but the upset came through.`; })()}</Text></View>;})}
      </View>:null}
      <View style={{backgroundColor:GLASS,borderWidth:1,borderColor:'rgba(139,10,31,0.12)',borderRadius:18,padding:18,marginHorizontal:20,marginBottom:24,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
        <View><Text style={{fontSize:9,fontWeight:'700',color:MAROON,letterSpacing:1.5,marginBottom:4}}>SEASON RECORD</Text><Text style={{fontSize:28,fontWeight:'800',color:WHITE}}>{stats?.wins??0}-{stats?.losses??0}</Text></View>
        <Text style={{fontSize:32,fontWeight:'800',color:MAROON}}>{stats?.winRate?`${Math.round(stats.winRate)}%`:'—'}</Text>
      </View>
      <Disclaimer />
    </Animated.ScrollView>
  );
});

// ─── FREE ARENA — Game Day lite + locked Prep/Review previews ───
function FreeArena({ games, sportFilter, router, sh, onR, isR, followed }: { games: GameWithPrediction[]; sportFilter: string; router: ReturnType<typeof useRouter>; sh: any; onR: () => void; isR: boolean; followed: GameWithPrediction[] }) {
  const filtered = useMemo(() => {
    if (sportFilter === 'All') return games;
    return games.filter(g => g.sport === sportFilter);
  }, [games, sportFilter]);

  const live = useMemo(() => filtered.filter(g => g.status === GameStatus.LIVE || (g.status as string) === 'in_progress' || (g.status as string) === 'halftime'), [filtered]);
  const sched = useMemo(() => filtered.filter(g => g.status === GameStatus.SCHEDULED).sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()), [filtered]);
  const final = useMemo(() => filtered.filter(g => g.status === GameStatus.FINAL).slice(0, 5), [filtered]);

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <Animated.ScrollView onScroll={sh} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, marginTop: 4, marginBottom: 20 }}>
        <Text style={{ fontSize: 10, fontWeight: '600', color: TEXT_MUTED, letterSpacing: 2.5, marginBottom: 4 }}>MY ARENA</Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: WHITE }}>Game Day</Text>
      </View>

      {/* Your Games — followed teams/games */}
      <YourGames games={followed} />

      {/* Live games section */}
      {live.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12, gap: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE }}>Live Now</Text>
            <PulsingLiveBadge />
          </View>
          {live.map(g => {
            const ac = getTeamColors(g.awayTeam.abbreviation, g.sport);
            const hc = getTeamColors(g.homeTeam.abbreviation, g.sport);
            return (
              <Pressable key={g.id} onPress={() => router.push(`/game/${g.id}` as any)} style={{ marginHorizontal: 20, marginBottom: 10, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(220,38,38,0.15)' }}>
                <LinearGradient colors={[`${ac.primary}15`, 'rgba(4,6,8,0.95)', `${hc.primary}10`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: WHITE }}>{g.awayTeam.abbreviation}</Text>
                    <Text style={{ fontSize: 10, color: TEXT_MUTED }}>{g.awayTeam.name}</Text>
                  </View>
                  <View style={{ alignItems: 'center', paddingHorizontal: 14 }}>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: WHITE, fontFamily: 'VT323_400Regular' }}>{g.awayScore ?? 0} - {g.homeScore ?? 0}</Text>
                    <Text style={{ fontSize: 9, fontWeight: '600', color: LIVE_RED, marginTop: 2 }}>{(g as any).statusDetail ?? 'LIVE'}</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: WHITE }}>{g.homeTeam.abbreviation}</Text>
                    <Text style={{ fontSize: 10, color: TEXT_MUTED }}>{g.homeTeam.name}</Text>
                  </View>
                </LinearGradient>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Upcoming games */}
      {sched.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE, paddingHorizontal: 20, marginBottom: 12 }}>Upcoming</Text>
          {sched.slice(0, 8).map((g, i) => (
            <Pressable key={g.id} onPress={() => router.push(`/game/${g.id}` as any)} style={{ marginHorizontal: 20, backgroundColor: GLASS, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: TC[i % 3], alignItems: 'center', justifyContent: 'center', marginRight: 14, opacity: 0.9 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: WHITE }}>{fmtTime(g.gameTime).replace(/\s*(AM|PM)/, '')}</Text>
                <Text style={{ fontSize: 8, fontWeight: '600', color: WHITE }}>{fmtTime(g.gameTime).includes('PM') ? 'PM' : 'AM'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE }}>{g.awayTeam.abbreviation} vs {g.homeTeam.abbreviation}</Text>
                <Text style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 2 }}>{displaySport(g.sport)}</Text>
              </View>
              <ChevronRight size={16} color={TEXT_MUTED} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Final scores */}
      {final.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE, paddingHorizontal: 20, marginBottom: 12 }}>Final</Text>
          {final.map(g => (
            <Pressable key={g.id} onPress={() => router.push(`/game/${g.id}` as any)} style={{ marginHorizontal: 20, backgroundColor: GLASS, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: WHITE }}>{g.awayTeam.abbreviation} <Text style={{ color: TEXT_MUTED }}>{g.awayScore ?? '-'}</Text></Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: WHITE, marginTop: 2 }}>{g.homeTeam.abbreviation} <Text style={{ color: TEXT_MUTED }}>{g.homeScore ?? '-'}</Text></Text>
              </View>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: TEXT_MUTED }}>FINAL</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* No games */}
      {live.length === 0 && sched.length === 0 && final.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: TEXT_MUTED }}>No games today</Text>
        </View>
      ) : null}

      {/* Locked Prep Mode preview */}
      <View style={{ marginHorizontal: 20, marginBottom: 16, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(139,10,31,0.18)' }}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={['rgba(139,10,31,0.08)', 'rgba(4,6,8,0.90)']} style={StyleSheet.absoluteFillObject} />
        <Pressable onPress={() => router.push('/paywall')} style={{ padding: 20, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Lock size={16} color={TEAL} />
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE }}>Prep Mode</Text>
            <View style={{ backgroundColor: 'rgba(139,10,31,0.12)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(139,10,31,0.18)' }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: MAROON, letterSpacing: 1 }}>PRO</Text>
            </View>
          </View>
          <Text style={{ fontSize: 12, color: TEAL, textAlign: 'center', lineHeight: 18, opacity: 0.8 }}>AI-ranked matchups, edge ratings, and detailed narratives for every game.</Text>
        </Pressable>
      </View>

      {/* Locked Review preview */}
      <View style={{ marginHorizontal: 20, marginBottom: 24, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(122,157,184,0.15)' }}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={['rgba(122,157,184,0.06)', 'rgba(4,6,8,0.90)']} style={StyleSheet.absoluteFillObject} />
        <Pressable onPress={() => router.push('/paywall')} style={{ padding: 20, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Lock size={16} color={TEAL} />
            <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE }}>Review</Text>
            <View style={{ backgroundColor: 'rgba(139,10,31,0.12)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(139,10,31,0.18)' }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: MAROON, letterSpacing: 1 }}>PRO</Text>
            </View>
          </View>
          <Text style={{ fontSize: 12, color: TEAL, textAlign: 'center', lineHeight: 18, opacity: 0.8 }}>See how your picks performed with accuracy breakdowns and AI analysis.</Text>
        </Pressable>
      </View>

      <Disclaimer />
    </Animated.ScrollView>
  );
}

// ─── PRO UPSELL CARD ───
function ProUpsellCard({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ marginHorizontal: 20, marginVertical: 8, borderRadius: 14, overflow: 'hidden' as const, borderWidth: 1, borderColor: 'rgba(139,10,31,0.12)', padding: 14, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, backgroundColor: 'rgba(139,10,31,0.03)' }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(139,10,31,0.10)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.15)', alignItems: 'center' as const, justifyContent: 'center' as const }}>
        <Zap size={14} color={MAROON} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: WHITE }}>{title}</Text>
        <Text style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 1 }}>{subtitle}</Text>
      </View>
      <View style={{ backgroundColor: 'rgba(139,10,31,0.12)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', color: MAROON, letterSpacing: 0.5 }}>PRO</Text>
      </View>
    </Pressable>
  );
}

// ─── FREE GAME LIST ───
function FreeGameList({ games, router }: { games: GameWithPrediction[]; router: ReturnType<typeof useRouter> }) {
  const scheduled = games.filter(g => g.status === GameStatus.SCHEDULED || g.status === GameStatus.LIVE);
  const sorted = [...scheduled].sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());
  const batch1 = sorted.slice(0, 6);
  const batch2 = sorted.slice(6, 12);

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const renderGame = (g: GameWithPrediction, i: number, total: number) => (
    <Pressable key={g.id} onPress={() => router.push(`/game/${g.id}` as any)}
      style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12, borderBottomWidth: i < total - 1 ? 1 : 0, borderBottomColor: 'rgba(255,255,255,0.03)' }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: WHITE, flex: 1 }}>{g.awayTeam.abbreviation} vs {g.homeTeam.abbreviation}</Text>
      <Text style={{ fontSize: 10, color: TEXT_MUTED }}>{displaySport(g.sport)}</Text>
      <Text style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: '600' }}>{g.status === GameStatus.LIVE ? 'LIVE' : fmtTime(g.gameTime)}</Text>
    </Pressable>
  );

  return (
    <View>
      <View style={{ paddingHorizontal: 20, marginBottom: 8, marginTop: 4 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: WHITE }}>Today's Games</Text>
      </View>
      {batch1.length > 0 ? (
        <View style={{ marginHorizontal: 16, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' as const }}>
          {batch1.map((g, i) => renderGame(g, i, batch1.length))}
        </View>
      ) : null}
      <ProUpsellCard title="Want AI-ranked matchups?" subtitle="Insights, narratives & edge ratings" onPress={() => router.push('/paywall')} />
      {batch2.length > 0 ? (
        <View style={{ marginHorizontal: 16, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' as const, marginTop: 4 }}>
          {batch2.map((g, i) => renderGame(g, i, batch2.length))}
        </View>
      ) : null}
      {sorted.length === 0 ? (
        <View style={{ alignItems: 'center' as const, paddingVertical: 40 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: TEXT_MUTED }}>No games today</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── MAIN ───
export default function MyArenaScreen() {
  const {data:allGames,isLoading,refetch} = useGames();
  const {data:userPicks} = useUserPicks();
  const {data:userStats} = useUserStats();
  const {data:teamFollows} = useTeamFollows();
  const { isPremium } = useSubscription();
  useLiveScores();
  const sh = useHideOnScroll();
  const [sf,setSf] = useState('All');
  const [isR,setIsR] = useState(false);
  const [am,setAm] = useState(0);
  const [fgi,setFgi] = useState<Set<string>>(new Set());
  const mtx = useSharedValue(0);

  useEffect(() => { (async()=>{const r=await AsyncStorage.getItem('clutch_followed_games');setFgi(new Set(r?JSON.parse(r):[]));})(); },[]);
  useFocusEffect(useCallback(()=>{(async()=>{const r=await AsyncStorage.getItem('clutch_followed_games');setFgi(new Set(r?JSON.parse(r):[]));})();},[]));

  const games = useMemo(() => { if (!allGames) return []; return sf==='All'?allGames:allGames.filter(g=>g.sport===sf); }, [allGames,sf]);
  const followed = useMemo(() => { if (!allGames) return []; const ta = new Set((teamFollows??[]).map(t=>t.teamAbbreviation.toUpperCase())); return allGames.filter(g=>fgi.has(g.id)||ta.has(g.homeTeam.abbreviation.toUpperCase())||ta.has(g.awayTeam.abbreviation.toUpperCase())); }, [allGames,fgi,teamFollows]);
  const live = useMemo(() => games.filter(g=>g.status===GameStatus.LIVE), [games]);
  const sched = useMemo(() => games.filter(g=>g.status===GameStatus.SCHEDULED), [games]);
  const final = useMemo(() => games.filter(g=>g.status===GameStatus.FINAL), [games]);

  useEffect(() => { let a=0; if (!live.length&&sched.length) a=1; if (!live.length&&!sched.length&&final.length) a=2; setAm(a); mtx.value=withSpring(a,SPRING); }, [live.length,sched.length,final.length]);
  const hmc = useCallback((m:number) => { setAm(m); mtx.value=withSpring(m,SPRING); }, [mtx]);
  const onR = useCallback(async()=>{setIsR(true);await refetch();setIsR(false);},[refetch]);

  const sx = useSharedValue(0);
  const pg = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onStart(()=>{sx.value=mtx.value;})
    .onUpdate(e=>{mtx.value=Math.max(0,Math.min(2,sx.value-(e.translationX/SW)*1.5));})
    .onEnd(e=>{let t=Math.round(mtx.value);if(Math.abs(e.velocityX)>500) t=e.velocityX<0?Math.ceil(mtx.value):Math.floor(mtx.value);t=Math.max(0,Math.min(2,t));mtx.value=withSpring(t,SPRING);runOnJS(setAm)(t);});
  const cs = useAnimatedStyle(()=>({transform:[{translateX:-mtx.value*SW}]}));

  if (isLoading) return <View style={{flex:1,backgroundColor:BG,alignItems:'center',justifyContent:'center'}}><ActivityIndicator size="large" color={TEAL} /></View>;

  const router = useRouter();

  if (!isPremium) {
    return (
      <SafeAreaView edges={['top']} style={{flex:1,backgroundColor:BG}}>
        <ErrorBoundary>
        <SearchBar />
        <SportPills selected={sf} onSelect={setSf} />
        <FreeArena games={allGames ?? []} sportFilter={sf} router={router} sh={sh} onR={onR} isR={isR} followed={followed} />
        </ErrorBoundary>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{flex:1,backgroundColor:BG}}>
      <ErrorBoundary>
      <SearchBar />
      <SportPills selected={sf} onSelect={setSf} />
      <SegPill active={am} onChange={hmc} hasLive={live.length>0} tx={mtx} />
      <GestureDetector gesture={pg}>
        <Animated.View style={[{flexDirection:'row',width:SW*3,flex:1},cs]}>
          <View style={{width:SW}}>{am===0?<GameDay live={live} sched={sched} picks={userPicks??[]} followed={followed} sh={sh} onR={onR} isR={isR} />:<View />}</View>
          <View style={{width:SW}}>{am===1?<Prep sched={sched} picks={userPicks??[]} stats={userStats} sh={sh} onR={onR} isR={isR} />:<View />}</View>
          <View style={{width:SW}}>{am===2?<Review final={final} picks={userPicks??[]} stats={userStats} sh={sh} onR={onR} isR={isR} />:<View />}</View>
        </Animated.View>
      </GestureDetector>
      </ErrorBoundary>
    </SafeAreaView>
  );
}
