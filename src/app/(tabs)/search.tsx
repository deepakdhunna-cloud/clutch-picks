import React, { useState, useMemo, useCallback, useEffect, memo } from 'react';
import {
  View, Text, Pressable, Dimensions, ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withRepeat, Easing, cancelAnimation, runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { Search, ChevronRight, Plus, Zap } from 'lucide-react-native';
import { useSubscription } from '@/lib/subscription-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useGames } from '@/hooks/useGames';
import { useLiveScores } from '@/hooks/useLiveScores';
import { useUserPicks, useUserStats, type Pick as UserPick, type UserStats } from '@/hooks/usePicks';
import { useTeamFollows } from '@/hooks/useTeamFollows';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { GameWithPrediction, GameStatus, Sport } from '@/types/sports';

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
            <Text style={{ fontSize: 8, fontWeight: '800', color: TEAL, letterSpacing: 1 }}>{game.sport}</Text>
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
            <Text style={{ fontSize: 9, color: LIVE_RED, fontWeight: '700' }}>{game.quarter ?? null}</Text>
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
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/game/[id]', params: { id: game.id } }); }}
      style={{ opacity: 1, width: cardWidth }}
    >
      <View style={{ borderRadius: 22, borderWidth: 1.5, borderColor: BORDER_HI, overflow: 'hidden' }}>
        {/* Dark base + subtle gradient wash */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#06080A' }} />
        <LinearGradient colors={['rgba(139,10,31,0.04)', 'transparent', 'rgba(122,157,184,0.03)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        {/* Shimmer ribbon */}
        <LinearGradient colors={[MAROON, TEAL, MAROON]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5, width: '100%' }} />
        {/* Ribbon bleed glow */}
        <LinearGradient colors={['rgba(122,157,184,0.06)', 'rgba(139,10,31,0.03)', 'transparent']} style={{ height: 40, width: '100%' }} />
        {/* Card content */}
        <View style={{ padding: 20, paddingTop: 0 }}>
          {/* Live meta + sport pill */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED }} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: WHITE }}>LIVE · {game.quarter ?? 'Q1'} {game.clock ?? null}</Text>
            </View>
            <View style={{ backgroundColor: MAROON_DIM, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: MAROON, letterSpacing: 0.5 }}>{game.sport}</Text>
            </View>
          </View>
          {/* Scores */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, color: TEXT_SECONDARY, marginBottom: 4, fontWeight: '600' }}>{game.awayTeam.abbreviation}</Text>
              {pick?.pickedTeam === 'away' ? <View style={{ width: 20, height: 2, backgroundColor: MAROON, borderRadius: 1, marginBottom: 2 }} /> : null}
              <Text style={{ fontSize: 42, fontWeight: '800', color: WHITE }}>{as2}</Text>
            </View>
            <View style={{ alignItems: 'center', marginHorizontal: 12 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 0.5 }}>{game.quarter ?? null}</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: TEXT_SECONDARY, marginTop: 2 }}>{game.clock ?? '0:00'}</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, color: TEXT_SECONDARY, marginBottom: 4, fontWeight: '600' }}>{game.homeTeam.abbreviation}</Text>
              {pick?.pickedTeam === 'home' ? <View style={{ width: 20, height: 2, backgroundColor: MAROON, borderRadius: 1, marginBottom: 2 }} /> : null}
              <Text style={{ fontSize: 42, fontWeight: '800', color: WHITE }}>{hs}</Text>
            </View>
          </View>
          {/* Stat boxes */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, backgroundColor: GLASS_INNER, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: pick ? MAROON_DIM : BORDER }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 1, marginBottom: 4 }}>YOUR PICK</Text>
              {pick ? (<><Text style={{ fontSize: 16, fontWeight: '800', color: WHITE }}>{pt?.abbreviation}</Text><Text style={{ fontSize: 9, fontWeight: '600', color: lead ? TEAL : d === 0 ? TEXT_MUTED : ERROR, marginTop: 2 }}>{lead ? 'Leading' : d === 0 ? 'Tied' : 'Trailing'}</Text></>) : <Text style={{ fontSize: 10, color: TEXT_MUTED }}>No pick</Text>}
            </View>
            <View style={{ flex: 1, backgroundColor: GLASS_INNER, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 1, marginBottom: 4 }}>MOMENTUM</Text>
              <View style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end', height: 20, marginBottom: 2 }}>
                {[0.4,0.7,0.5,0.9,0.6].map((h,i) => <View key={i} style={{ width: 4, height: 8+h*12, borderRadius: 2, backgroundColor: h > 0.5 ? TEAL : TEXT_MUTED, opacity: 0.5+h*0.5 }} />)}
              </View>
              <Text style={{ fontSize: 9, fontWeight: '600', color: TEAL }}>{lead ? 'Positive' : 'Neutral'}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: GLASS_INNER, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 1, marginBottom: 4 }}>KEY STAT</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: SILVER }}>{game.prediction?.confidence ?? 50}%</Text>
              <Text style={{ fontSize: 9, color: TEXT_MUTED, marginTop: 2 }}>Confidence</Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
});

// ─── GENERATE LIVE INTEL ───
function generateLiveIntel(game: GameWithPrediction | null): Array<{ type: 'alert'|'shift'|'trend'; title: string; body: string }> {
  if (!game) return [];
  const pred = game.prediction;
  const intel: Array<{ type: 'alert'|'shift'|'trend'; title: string; body: string }> = [];
  const home = game.homeTeam; const away = game.awayTeam;
  const homeScore = game.homeScore ?? 0; const awayScore = game.awayScore ?? 0;
  const scoreDiff = Math.abs(homeScore - awayScore);
  const leader = homeScore > awayScore ? home : homeScore < awayScore ? away : null;
  const trailer = homeScore > awayScore ? away : homeScore < awayScore ? home : null;
  const quarter = game.quarter ?? '';
  const isEarly = quarter.includes('1') || quarter.includes('Top 1') || quarter.includes('Bot 1') || quarter.includes('Top 2');
  const isTied = homeScore === awayScore;
  const conf = pred?.confidence ?? 50;
  const predictedWinner = pred ? (pred.predictedWinner === 'home' ? home : away) : null;

  // ALERT
  if (pred?.analysis) {
    intel.push({ type: 'alert', title: 'Game Analysis', body: pred.analysis.length > 160 ? pred.analysis.substring(0, 160) + '...' : pred.analysis });
  } else if (predictedWinner) {
    const edge = pred?.edgeRating ?? 5;
    let ctx = '';
    if (leader && leader.abbreviation === predictedWinner.abbreviation) ctx = 'Holding to form so far.';
    else if (leader) ctx = `${leader.abbreviation} leads against the model's pick — potential upset developing.`;
    else if (isTied && isEarly) ctx = 'Game tracking as expected in early stages.';
    else if (isTied) ctx = 'Tied up — model separation hasn\'t materialized yet.';
    intel.push({ type: 'alert', title: 'Pre-Game Edge', body: `${predictedWinner.abbreviation} entered as the ${conf}% favorite with a ${edge}/10 edge rating. ${ctx}` });
  }

  // SHIFT
  if (isTied && homeScore === 0 && awayScore === 0) {
    intel.push({ type: 'shift', title: 'Early Stages', body: `Both teams still settling in. ${home.abbreviation} has home-field advantage with the model giving them a ${pred?.homeWinProbability ?? 50}% edge. First score could set the tone.` });
  } else if (isTied && isEarly) {
    intel.push({ type: 'shift', title: 'Level Playing Field', body: `Knotted at ${homeScore}-${awayScore} early. Neither side has found separation yet.` });
  } else if (isTied) {
    intel.push({ type: 'shift', title: 'Deadlocked', body: `${homeScore}-${awayScore} tie. Neither team can pull away — close game the model predicted at ${conf}% confidence.` });
  } else if (scoreDiff >= 10 && leader && trailer) {
    intel.push({ type: 'shift', title: `${leader.abbreviation} Pulling Away`, body: `${leader.abbreviation} leads by ${scoreDiff}. ${trailer.abbreviation} needs a response soon. ${predictedWinner?.abbreviation === leader.abbreviation ? 'This aligns with the pre-game model.' : 'The model had this going the other way — upset unfolding.'}` });
  } else if (scoreDiff > 0 && scoreDiff <= 3 && leader) {
    intel.push({ type: 'shift', title: `${leader.abbreviation} Has the Edge`, body: `Slim ${scoreDiff}-point lead for ${leader.abbreviation}, up ${Math.max(homeScore,awayScore)}-${Math.min(homeScore,awayScore)}. ${conf > 60 ? `The model's ${conf}% confidence suggests the favorite should hold.` : `At just ${conf}% confidence, anything can happen.`}` });
  } else if (scoreDiff > 3 && leader && trailer) {
    intel.push({ type: 'shift', title: `${leader.abbreviation} in Control`, body: `${leader.abbreviation} leads ${Math.max(homeScore,awayScore)}-${Math.min(homeScore,awayScore)}. A comfortable cushion. ${trailer.abbreviation} needs a big rally.` });
  }

  // TREND
  if (pred?.homeStreak && pred.homeStreak >= 3) {
    intel.push({ type: 'trend', title: `${home.abbreviation} Streak Watch`, body: `${home.abbreviation} entered on a ${pred.homeStreak}-game win streak. ${leader?.abbreviation === home.abbreviation ? 'The streak looks alive — they lead.' : isTied ? 'Being tested — game is tied.' : 'Streak in danger.'}` });
  } else if (pred?.awayStreak && pred.awayStreak >= 3) {
    intel.push({ type: 'trend', title: `${away.abbreviation} Road Streak`, body: `${away.abbreviation} riding a ${pred.awayStreak}-game win streak. ${leader?.abbreviation === away.abbreviation ? 'Continuing to roll.' : isTied ? 'Being tested away from home.' : 'Could end tonight.'}` });
  } else if (pred?.ensembleDivergence) {
    intel.push({ type: 'trend', title: 'Model Uncertainty', body: `Prediction models were split pre-game. ${isTied ? 'The tie validates the uncertainty.' : `${leader?.abbreviation ?? 'One team'} making a case, but don't trust the lead yet.`}` });
  } else {
    intel.push({ type: 'trend', title: 'Tracking the Model', body: `Pre-game model had ${conf}% confidence. ${leader ? `${leader.abbreviation} leads ${Math.max(homeScore,awayScore)}-${Math.min(homeScore,awayScore)} — ${predictedWinner?.abbreviation === leader.abbreviation ? 'tracking within expected range.' : 'diverging from expectations.'}` : 'Game is level — still within expected range.'}` });
  }
  return intel;
}

// ─── INTEL CARD ───
const IntelCard = memo(function IntelCard({ type, title, body }: { type: 'alert'|'shift'|'trend'; title: string; body: string }) {
  const bc = type === 'alert' ? LIVE_RED : type === 'shift' ? TEAL_DARK : SILVER;
  const bl = type === 'alert' ? 'ALERT' : type === 'shift' ? 'SHIFT' : 'TREND';
  return (
    <View style={{ backgroundColor: GLASS, borderRadius: 14, padding: 13, paddingLeft: 18, borderWidth: 1, borderColor: BORDER, marginBottom: 8, position: 'relative' }}>
      <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, backgroundColor: bc, borderRadius: 2 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}><View style={{ backgroundColor: `${bc}22`, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ fontSize: 8, fontWeight: '700', color: bc, letterSpacing: 0.5 }}>{bl}</Text></View></View>
      <Text style={{ fontSize: 12, fontWeight: '600', color: WHITE, marginBottom: 4 }}>{title}</Text>
      <Text style={{ fontSize: 11, color: TEXT_SECONDARY, lineHeight: 16.5 }}>{body}</Text>
    </View>
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
  const l10 = picks.slice(-10);
  const c = l10.filter(p => p.result === 'win').length;
  const t = l10.filter(p => p.result === 'win' || p.result === 'loss').length;
  const a = t > 0 ? Math.round((c/t)*100) : 0;
  return (
    <View style={{ backgroundColor: GLASS, borderWidth: 1, borderColor: 'rgba(139,10,31,0.14)', borderRadius: 18, padding: 18, marginHorizontal: 20, marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: WHITE }}>Your predictions</Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: MAROON }}>{a}%</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 4, alignItems: 'flex-end', height: 24, marginBottom: 8 }}>
        {l10.map((p,i) => <View key={p.id||String(i)} style={{ width: 10, height: (p.result==='win'?0.85:p.result==='loss'?0.35:0.5)*24, borderRadius: 2, backgroundColor: p.result==='win'?TEAL:p.result==='loss'?ERROR:TEXT_MUTED, opacity: p.result==='win'?0.9:p.result==='loss'?0.5:0.3 }} />)}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 10, color: TEXT_MUTED }}>Last 10 predictions</Text>
        <Text style={{ fontSize: 10, color: TEAL }}>{c} correct</Text>
      </View>
    </View>
  );
});

// ─── INSIGHT FUNCTIONS ───
function genInsight(games: GameWithPrediction[]): { headline: string; teams: string[] } {
  const s = games.filter(g => g.status === GameStatus.SCHEDULED && g.prediction);
  const hu = s.filter(g => g.prediction!.predictedWinner === 'home' && g.prediction!.confidence < 55);
  if (hu.length >= 3) return { headline: `${hu.length} home underdogs are in play tonight — a pattern hitting at a high rate this week.`, teams: hu.slice(0,3).map(g => g.homeTeam.name) };
  const he = s.filter(g => (g.prediction!.edgeRating??0) >= 7);
  if (he.length >= 2) return { headline: `${he.length} games tonight have edge rating 7+ — the model sees clear separation.`, teams: he.slice(0,3).map(g => g.prediction!.predictedWinner==='home'?g.homeTeam.name:g.awayTeam.name) };
  const sg = s.filter(g => (g.prediction!.homeStreak??0) >= 4||(g.prediction!.awayStreak??0) >= 4);
  if (sg.length >= 2) return { headline: `${sg.length} teams on 4+ game streaks in action tonight. Streaks continue 68% of the time.`, teams: sg.slice(0,3).map(g => (g.prediction!.homeStreak??0) >= 4?g.homeTeam.name:g.awayTeam.name) };
  const tu = s.filter(g => g.prediction!.isTossUp);
  if (tu.length >= 3) return { headline: `Coin-flip night: ${tu.length} games within 3 points. Proceed with caution.`, teams: tu.slice(0,3).map(g => `${g.awayTeam.abbreviation}/${g.homeTeam.abbreviation}`) };
  return { headline: `${s.length} games tonight across ${new Set(s.map(g => g.sport)).size} sports. Here's what stands out.`, teams: [] };
}

type DrawType = 'streak_clash'|'dominant_favorite'|'upset_brewing'|'toss_up'|'high_value'|'model_conflict'|'hot_team'|'cold_team'|'record_mismatch'|'default';

function genMatchup(game: GameWithPrediction, usedTypes: Set<DrawType>): { tags: string[]; headline: string; detail: string; drawType: DrawType } {
  const p = game.prediction!;
  const home = game.homeTeam; const away = game.awayTeam;
  const winner = p.predictedWinner === 'home' ? home : away;
  const loser = p.predictedWinner === 'home' ? away : home;
  const tags: string[] = [];
  const conf = p.confidence ?? 55; const edge = p.edgeRating ?? 5;
  const hStreak = p.homeStreak ?? 0; const aStreak = p.awayStreak ?? 0;

  // Parse form — handle both "WWLWL" and "W-L-W" formats
  const parseForm = (form: string | undefined) => {
    if (!form) return { wins: 0, total: 0 };
    const chars = form.split('').filter((c: string) => c === 'W' || c === 'L');
    return { wins: chars.filter((c: string) => c === 'W').length, total: Math.max(chars.length, 1) };
  };
  const hf = parseForm(p.recentFormHome);
  const af = parseForm(p.recentFormAway);

  const pr = (r: string) => { const [w,l] = r.split('-').map(Number); return { w: w??0, l: l??0, t: (w??0)+(l??0) }; };
  const hr = pr(home.record); const ar = pr(away.record);

  let hl = ''; let dt = ''; let drawType: DrawType = 'default';
  const trySet = (type: DrawType): boolean => { if (usedTypes.has(type)) return false; drawType = type; return true; };

  // 1. STREAK CLASH
  if (!hl && hStreak >= 3 && aStreak >= 3 && trySet('streak_clash')) {
    hl = 'Streak vs streak';
    tags.push('CLASH',`${home.abbreviation} W${hStreak}`,`${away.abbreviation} W${aStreak}`);
    dt = `${home.abbreviation} riding a ${hStreak}-game win streak meets ${away.abbreviation} on a ${aStreak}-game tear. Something has to give. ${winner.abbreviation} gets the edge at ${conf}%.`;
  }

  // 2. DOMINANT FAVORITE — lowered threshold
  if (!hl && conf >= 68 && edge >= 6 && trySet('dominant_favorite')) {
    hl = 'Strong lean';
    tags.push('HIGH CONFIDENCE',`${conf}%`);
    dt = `${winner.abbreviation} (${winner.record}) is a clear favorite at ${conf}% with a ${edge}/10 edge rating. ${loser.abbreviation} (${loser.record}) is outmatched across the model's key factors.`;
  }

  // 3. UPSET BREWING — lowered threshold
  if (!hl && conf >= 55 && conf <= 65 && trySet('upset_brewing')) {
    const favHome = p.predictedWinner === 'home';
    const uW = favHome ? af.wins : hf.wins;
    const uT = favHome ? af.total : hf.total;
    if (uW >= 5) {
      hl = 'Upset watch';
      tags.push('UPSET ALERT', `${loser.abbreviation} ${uW}-${uT - uW} L10`);
      dt = `${loser.abbreviation} has been hotter recently with ${uW} wins in their last 10. The model still leans ${winner.abbreviation} at ${conf}%, but the gap is closing. High-variance spot.`;
    } else { hl = ''; drawType = 'default'; }
  }

  // 4. TOSS-UP — expanded range
  if (!hl && (p.isTossUp || (conf >= 48 && conf <= 53)) && trySet('toss_up')) {
    hl = 'Coin flip';
    tags.push('TOSS-UP', `${p.homeWinProbability ?? 50}/${p.awayWinProbability ?? 50}`);
    dt = `Dead even. ${home.abbreviation} (${home.record}) at home vs ${away.abbreviation} (${away.record}) — the model can't separate them. This could go either way.`;
  }

  // 5. MODEL CONFLICT
  if (!hl && p.ensembleDivergence && trySet('model_conflict')) {
    hl = 'Models disagree';
    tags.push('SPLIT DECISION');
    dt = `The prediction models can't agree. Some factors favor ${home.abbreviation}, others point to ${away.abbreviation}. The composite leans ${winner.abbreviation} at ${conf}%, but certainty is lower than the number suggests.`;
  }

  // 6. HOT TEAM — lowered threshold
  if (!hl && (hStreak >= 4 || aStreak >= 4) && trySet('hot_team')) {
    const hot = hStreak >= aStreak ? home : away; const streak = Math.max(hStreak, aStreak);
    hl = `${hot.abbreviation} is rolling`;
    tags.push(`W${streak} STREAK`);
    dt = `${hot.abbreviation} has won ${streak} straight and shows no signs of slowing. Model gives ${winner.abbreviation} ${conf}%.`;
  }

  // 7. HIGH VALUE
  if (!hl && edge >= 7 && trySet('high_value')) {
    hl = 'Best value tonight';
    tags.push('HIGH EDGE',`${edge}/10`);
    dt = `Edge rating ${edge}/10 — one of the sharpest on the board. ${winner.abbreviation} (${winner.record}) has a clear statistical advantage over ${loser.abbreviation} (${loser.record}).`;
  }

  // 8. COLD TEAM — lowered threshold
  if (!hl && (hf.wins <= 3 || af.wins <= 3) && hf.total >= 5 && trySet('cold_team')) {
    const cold = hf.wins <= af.wins ? home : away;
    const cW = Math.min(hf.wins, af.wins);
    const cT = Math.max(hf.total, af.total);
    hl = `${cold.abbreviation} struggling`;
    tags.push(`${cold.abbreviation} ${cW}-${cT - cW} L10`);
    dt = `${cold.abbreviation} has won just ${cW} of their last 10. ${winner.abbreviation} should capitalize — model gives them ${conf}% with a ${edge}/10 edge.`;
  }

  // 9. RECORD MISMATCH — lowered threshold
  if (!hl && trySet('record_mismatch')) {
    const hPct = hr.w / Math.max(hr.t, 1);
    const aPct = ar.w / Math.max(ar.t, 1);
    if (Math.abs(hPct - aPct) > 0.15) {
      const better = hPct > aPct ? home : away;
      const worse = better === home ? away : home;
      hl = 'Mismatch on paper';
      tags.push(`${better.abbreviation} ${better.record}`,`${worse.abbreviation} ${worse.record}`);
      dt = `${better.abbreviation} (${better.record}) has a significantly better record than ${worse.abbreviation} (${worse.record}). The model agrees — ${winner.abbreviation} at ${conf}%.`;
    } else { hl = ''; drawType = 'default'; }
  }

  // 10. DEFAULT — always unique per game
  if (!hl) {
    drawType = 'default'; hl = `${away.abbreviation} at ${home.abbreviation}`;
    dt = `${winner.abbreviation} (${winner.record}) favored at ${conf}% over ${loser.abbreviation} (${loser.record}).`;
    if (hf.total > 1 && af.total > 1) dt += ` Recent form: ${home.abbreviation} ${hf.wins}-${hf.total - hf.wins}, ${away.abbreviation} ${af.wins}-${af.total - af.wins} in last 10.`;
    if (edge >= 6) dt += ` Edge rating ${edge}/10 adds confidence.`;
  }

  const ic = tags.filter(t => !['CLASH','TOSS-UP','SPLIT DECISION','LIMITED DATA'].includes(t)).length;
  if (ic > 0) tags.unshift(`${Math.max(ic,1)} INSIGHT${ic>1?'S':''}`);
  return { tags, headline: hl, detail: dt, drawType };
}

// ─── MATCHUP CARD ───
const MatchupCard = memo(function MatchupCard({ game, rank, headline, tags, detail }: { game: GameWithPrediction; rank: number; headline: string; tags: string[]; detail: string }) {
  const router = useRouter(); const isFirst = rank === 1;
  return (
    <Pressable onPress={() => router.push(`/game/${game.id}`)} style={{ backgroundColor: GLASS, borderRadius: 14, borderWidth: 1, borderColor: BORDER, borderLeftWidth: 3, borderLeftColor: isFirst ? MAROON : TEAL, padding: 14, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: isFirst ? MAROON_DIM : TEAL_DIM, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
          <Text style={{ fontSize: 10, fontWeight: '800', color: isFirst ? MAROON : TEAL }}>{rank}</Text>
        </View>
        <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE, flex: 1 }}>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</Text>
        <ChevronRight size={14} color={TEXT_MUTED} />
      </View>
      <Text style={{ fontSize: 13, fontWeight: '700', color: WHITE, marginBottom: 6 }}>{headline}</Text>
      {tags.length > 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {tags.map((tg,i) => <View key={tg+i} style={{ backgroundColor: i===0?MAROON_DIM:'rgba(255,255,255,0.04)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ fontSize: 9, fontWeight: '700', color: i===0?MAROON:TEXT_MUTED, letterSpacing: 0.3 }}>{tg}</Text></View>)}
      </View> : null}
      <Text style={{ fontSize: 11, color: TEXT_SECONDARY, lineHeight: 16.5 }}>{detail}</Text>
    </Pressable>
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
  const focusedGame = live[focusedIdx] ?? null;
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

      {/* 3. Live Intelligence header — ABOVE cards */}
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:20,marginTop:28,marginBottom:18}}>
        <Text style={{fontSize:16,fontWeight:'800',color:WHITE}}>Live intelligence</Text>
        <Text style={{fontSize:10,color:TEXT_MUTED}}>Updated just now</Text>
      </View>

      {/* 4. Scrollable live cards */}
      {live.length === 1 ? (
        <View style={{paddingHorizontal:20,marginBottom:8}}>
          <LiveCard game={live[0]} pick={pm.get(live[0].id)} cardWidth={CARD_W} />
        </View>
      ) : (
        <ScrollView
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          snapToInterval={CARD_W + 12} decelerationRate="fast"
          contentContainerStyle={{paddingHorizontal:20,gap:12}}
          onScroll={onLiveScroll} scrollEventThrottle={16}
          style={{flexGrow:0}}
        >
          {live.map((g) => <LiveCard key={g.id} game={g} pick={pm.get(g.id)} cardWidth={CARD_W} />)}
        </ScrollView>
      )}

      {/* 5. Page dots */}
      {live.length > 1 ? (
        <View style={{flexDirection:'row',justifyContent:'center',gap:4,marginTop:10,marginBottom:4}}>
          {live.map((_,i) => <View key={i} style={{width:i===focusedIdx?8:4,height:4,borderRadius:2,backgroundColor:i===focusedIdx?MAROON:'rgba(255,255,255,0.15)'}} />)}
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

// ─── PREP MODE ───
const Prep = memo(function Prep({ sched, picks, stats, sh, onR, isR }: { sched: GameWithPrediction[]; picks: UserPick[]; stats: UserStats|undefined; sh: any; onR: ()=>void; isR: boolean }) {
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

  return (
    <Animated.ScrollView onScroll={sh} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:120}} refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',paddingHorizontal:20,marginTop:4,marginBottom:24}}>
        <View><Text style={{fontSize:10,fontWeight:'600',color:TEXT_MUTED,letterSpacing:2.5,marginBottom:4}}>MY ARENA</Text><Text style={{fontSize:24,fontWeight:'800',color:WHITE}}>Your Insights</Text></View>
        <View style={{flexDirection:'row',alignItems:'center',gap:6}}><View style={{width:6,height:6,borderRadius:3,backgroundColor:MAROON}} /><Text style={{fontSize:11,fontWeight:'700',color:MAROON}}>{sched.length} GAMES</Text></View>
      </View>
      <View style={{backgroundColor:GLASS,borderRadius:18,borderWidth:1,borderColor:BORDER,padding:18,marginHorizontal:20,marginBottom:24}}>
        <Text style={{fontSize:9,fontWeight:'700',color:MAROON,letterSpacing:1.5,marginBottom:8}}>ARENA INSIGHT</Text>
        <Text style={{fontSize:15,fontWeight:'700',color:WHITE,lineHeight:23}}>{insight.headline}</Text>
        {insight.teams.length>0?<View style={{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:12}}>{insight.teams.map(t=><View key={t} style={{backgroundColor:MAROON_DIM,borderRadius:10,paddingHorizontal:12,paddingVertical:5}}><Text style={{fontSize:10,fontWeight:'700',color:MAROON}}>{t}</Text></View>)}</View>:null}
      </View>
      {ranked.length>0?<View style={{paddingHorizontal:20,marginBottom:24}}><Text style={{fontSize:12,fontWeight:'700',color:WHITE,marginBottom:14}}>Matchups Ranked For You</Text>{ranked.map((r,i)=><MatchupCard key={r.game.id} game={r.game} rank={i+1} headline={r.headline} tags={r.tags} detail={r.detail} />)}</View>:<View style={{paddingHorizontal:20,marginBottom:24}}><Text style={{fontSize:12,color:TEXT_MUTED}}>No scheduled games with predictions</Text></View>}
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
        {fg.slice(0,3).map(g=>{const p=g.prediction;if(!p) return null;const ok=(p.predictedWinner==='home'&&(g.homeScore??0)>(g.awayScore??0))||(p.predictedWinner==='away'&&(g.awayScore??0)>(g.homeScore??0));return <View key={g.id} style={{marginBottom:10,paddingLeft:12,borderLeftWidth:3,borderLeftColor:ok?TEAL:ERROR}}><Text style={{fontSize:11,fontWeight:'600',color:WHITE,marginBottom:2}}>{g.awayTeam.abbreviation} vs {g.homeTeam.abbreviation}</Text><Text style={{fontSize:11,color:TEXT_SECONDARY,lineHeight:16.5}}>{ok?`Model correctly predicted ${p.predictedWinner==='home'?g.homeTeam.abbreviation:g.awayTeam.abbreviation} at ${p.confidence}% confidence.`:`Model missed — predicted ${p.predictedWinner==='home'?g.homeTeam.abbreviation:g.awayTeam.abbreviation} at ${p.confidence}% but the upset came through.`}</Text></View>;})}
      </View>:null}
      <View style={{backgroundColor:GLASS,borderWidth:1,borderColor:'rgba(139,10,31,0.12)',borderRadius:18,padding:18,marginHorizontal:20,marginBottom:24,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
        <View><Text style={{fontSize:9,fontWeight:'700',color:MAROON,letterSpacing:1.5,marginBottom:4}}>SEASON RECORD</Text><Text style={{fontSize:28,fontWeight:'800',color:WHITE}}>{stats?.wins??0}-{stats?.losses??0}</Text></View>
        <Text style={{fontSize:32,fontWeight:'800',color:MAROON}}>{stats?.winRate?`${Math.round(stats.winRate)}%`:'—'}</Text>
      </View>
      <Disclaimer />
    </Animated.ScrollView>
  );
});

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
      <Text style={{ fontSize: 10, color: TEXT_MUTED }}>{g.sport === 'NCAAF' ? 'CFB' : g.sport === 'NCAAB' ? 'CBB' : g.sport}</Text>
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
    .onStart(()=>{sx.value=mtx.value;})
    .onUpdate(e=>{mtx.value=Math.max(0,Math.min(2,sx.value-(e.translationX/SW)*1.5));})
    .onEnd(e=>{let t=Math.round(mtx.value);if(Math.abs(e.velocityX)>500) t=e.velocityX<0?Math.ceil(mtx.value):Math.floor(mtx.value);t=Math.max(0,Math.min(2,t));mtx.value=withSpring(t,SPRING);runOnJS(setAm)(t);});
  const cs = useAnimatedStyle(()=>({transform:[{translateX:-mtx.value*SW}]}));

  if (isLoading) return <View style={{flex:1,backgroundColor:BG,alignItems:'center',justifyContent:'center'}}><ActivityIndicator size="large" color={TEAL} /></View>;

  const router = useRouter();

  if (!isPremium) {
    return (
      <SafeAreaView edges={['top']} style={{flex:1,backgroundColor:BG}}>
        <SearchBar />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          <FreeGameList games={allGames ?? []} router={router} />
          <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
            <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.08)', textAlign: 'center', lineHeight: 14 }}>
              AI predictions are for entertainment purposes only. Not financial advice.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{flex:1,backgroundColor:BG}}>
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
    </SafeAreaView>
  );
}
