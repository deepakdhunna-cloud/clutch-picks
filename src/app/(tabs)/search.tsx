import React, { useState, useMemo, useCallback, useEffect, memo } from 'react';
import {
  View, Text, Pressable, Dimensions, ActivityIndicator, RefreshControl, ScrollView, TextInput, StyleSheet, Platform,
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
import { generateTonightNarrative } from '@/lib/tonight-narrative';
import {
  MAROON, MAROON_DIM, TEAL, TEAL_DIM, TEAL_DARK, LIVE_RED, LOSS, SILVER,
  BG, PANEL_DARK, PANEL_DARKER, BORDER_MED, BORDER_BOLD, WHITE,
  TEXT_SECONDARY, TEXT_MUTED,
} from '@/lib/theme';
import { LedScorePanel } from '@/components/sports';
import { TeamJersey } from '@/components/sports/TeamJersey';

// ─── COLORS ───
const ERROR_DIM = 'rgba(239,68,68,0.10)';

const { width: SW } = Dimensions.get('window');
const SPORTS = ['All','NBA','NFL','MLB','NHL','NCAAF','NCAAB','MLS','EPL','UCL'] as const;
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
const SportPills = memo(function SportPills({ selected, onSelect, available }: { selected: string; onSelect: (s: string) => void; available?: Set<string> }) {
  // Hide chips for sports with zero games on the current slate so users
  // don't dead-end into empty filters (e.g. CFB during the off-season).
  // 'All' always stays. When `available` is undefined (loading or no data),
  // show the full set rather than blanking out.
  const visible = available ? SPORTS.filter(s => s === 'All' || available.has(s)) : SPORTS;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 18 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
      {visible.map((s) => {
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
      <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 3, borderWidth: 1, borderColor: BORDER_MED, flexDirection: 'row', position: 'relative' }}>
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
      <View style={{ backgroundColor: PANEL_DARK, borderRadius: 16, borderWidth: 1, borderColor: BORDER_MED, padding: 20, alignItems: 'center' }}>
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
          style={{ width: 65, borderRadius: 16, borderWidth: 1, borderColor: BORDER_MED, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: MAROON_DIM, alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={14} color={MAROON} />
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
});

// ─── LIVE CARD (My Arena) ───────────────────────────────────────
// Refined live card that ties My Arena visually to the home-page LED design
// language: team-color washes flank a dark base, an inline LED scoreboard sits
// in the middle, and three compact stat tiles sit below a hairline divider.

// Maps the existing 4-tier confidence ladder to the user-facing strength labels
// used by this card. Distinct from getConfidenceTier (which is the global
// neutral palette) — these labels and colors only appear here.
function getPickStrengthDisplay(confidence: number, isTossUp?: boolean): { label: string; color: string } {
  if (isTossUp || confidence < 53) return { label: 'Avoid',  color: '#ef4444' };
  if (confidence < 60)             return { label: 'Risky',  color: '#f97316' };
  if (confidence < 72)             return { label: 'Lean',   color: '#facc15' };
  return                                  { label: 'Solid',  color: '#4ade80' };
}

// Pulsing red dot used in the live card header.
const LiveDot = memo(function LiveDot() {
  const op = useSharedValue(1);
  const sc = useSharedValue(1);
  useEffect(() => {
    op.value = withRepeat(withTiming(0.55, { duration: 750, easing: Easing.inOut(Easing.ease) }), -1, true);
    sc.value = withRepeat(withTiming(0.85, { duration: 750, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => { cancelAnimation(op); cancelAnimation(sc); };
  }, []);
  const ds = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ scale: sc.value }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#ef4444' }, ds]} />;
});

// Soft team-color glow that radiates from the jersey silhouette itself — no
// disk or backdrop shape. Wraps the jersey; the shadow renders from the SVG's
// alpha mask, so the halo follows the jersey outline and fades smoothly with
// no hard edges.
//
// iOS: native colored shadow with a wide shadowRadius silhouettes the SVG.
//   Two nested shadow layers stack a tight inner halo and a wider outer halo
//   for stronger spread.
// Android: shadowColor on a View with elevation tints the elevation shadow on
//   API 28+. Less expressive than iOS but stays color-accurate, no hard edges.
const JerseyGlow = memo(function JerseyGlow({ color, children }: { color: string; children: React.ReactNode }) {
  if (Platform.OS === 'ios') {
    return (
      <View
        style={{
          backgroundColor: 'transparent',
          shadowColor: color,
          shadowOpacity: 0.55,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <View
          style={{
            backgroundColor: 'transparent',
            shadowColor: color,
            shadowOpacity: 0.85,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 0 },
          }}
        >
          {children}
        </View>
      </View>
    );
  }
  return (
    <View
      style={{
        backgroundColor: 'transparent',
        elevation: 14,
        shadowColor: color,
      }}
    >
      {children}
    </View>
  );
});

// Add an alpha channel to a hex color string. Falls back to transparent if the
// input isn't a recognised #rrggbb / #rgb format.
function hexWithAlpha(hex: string | undefined, alpha: number): string {
  if (!hex) return 'rgba(31,41,55,0)';
  const a = Math.max(0, Math.min(1, alpha));
  const aHex = Math.round(a * 255).toString(16).padStart(2, '0');
  if (hex.length === 7 && hex[0] === '#') return `${hex}${aHex}`;
  if (hex.length === 4 && hex[0] === '#') {
    const expanded = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    return `${expanded}${aHex}`;
  }
  return hex;
}

const LiveCard = memo(function LiveCard({ game, pick, cardWidth }: { game: GameWithPrediction; pick?: UserPick; cardWidth: number }) {
  const router = useRouter();
  const hs = game.homeScore ?? 0;
  const as2 = game.awayScore ?? 0;
  const ph = pick?.pickedTeam === 'home';
  const pt = ph ? game.homeTeam : game.awayTeam;
  const ps = ph ? hs : as2;
  const os = ph ? as2 : hs;
  const lead = ps > os;
  const awayColors = getTeamColors(game.awayTeam.abbreviation, game.sport as Sport, game.awayTeam.color);
  const homeColors = getTeamColors(game.homeTeam.abbreviation, game.sport as Sport, game.homeTeam.color);
  // Splits "Bayern Munich" → ["Bayern", "Munich"]; "FC Barcelona" → ["FC", "Barcelona"].
  const splitName = (raw: string) => {
    const parts = raw.trim().split(/\s+/);
    if (parts.length <= 1) return [parts[0] ?? '', ''];
    return [parts[0], parts.slice(1).join(' ')];
  };
  const [homeNameTop, homeNameBot] = splitName(game.homeTeam.name);
  const [awayNameTop, awayNameBot] = splitName(game.awayTeam.name);

  const matchTime = formatGameTime(game.sport, game.quarter, game.clock);

  // Momentum sparkline: simple deterministic gradient derived from current state
  // so it varies per game without needing live momentum-feed data. Wired to a
  // real model-confidence feed later — values & coloring will swap in here.
  const momentumBars = useMemo<number[]>(() => {
    const seed = (hs + as2 * 7) % 11;
    return [0.30, 0.45, 0.55, 0.70, 0.85, 0.95, 0.78, 0.62].map((v, i) => {
      const wob = ((seed + i * 3) % 5) / 25;
      return Math.max(0.15, Math.min(1, v - wob));
    });
  }, [hs, as2]);
  const peakIndex = momentumBars.reduce((acc, v, i, arr) => v > arr[acc] ? i : acc, 0);
  const momentumLabel = lead
    ? `${pt?.abbreviation ?? ''} surge`
    : ps === os
      ? 'Even pace'
      : `${(ph ? game.awayTeam : game.homeTeam).abbreviation} surge`;

  const strength = getPickStrengthDisplay(game.prediction?.confidence ?? 50, game.prediction?.isTossUp);

  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/game/[id]', params: { id: game.id } }); }}
      style={{ width: cardWidth }}
    >
      <View
        style={{
          borderRadius: 16,
          borderWidth: 1,
          borderColor: '#1f2937',
          overflow: 'hidden',
          paddingVertical: 16,
          paddingHorizontal: 14,
        }}
      >
        {/* Dark frosted tint — BlurView softens whatever sits behind the card,
            then a heavier semi-transparent dark layer establishes a deeper
            ink-blue base. Together they read as frosted glass over a dark
            substrate. */}
        <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(6,10,18,0.82)' }]} />

        {/* Team-color washes — pulled from team primary color data, not hardcoded.
            Approximated as horizontal LinearGradients (RN doesn't ship a native
            radial-gradient primitive); the falloff lands in the same place a
            radial wash would, with the dark base showing through the middle. */}
        <LinearGradient
          colors={[hexWithAlpha(homeColors.primary, 0.20), hexWithAlpha(homeColors.primary, 0)]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 0.65, y: 0.5 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <LinearGradient
          colors={[hexWithAlpha(awayColors.primary, 0), hexWithAlpha(awayColors.primary, 0.24)]}
          start={{ x: 0.35, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        {/* Top edge live indicator — 14% inset on either side, fades in/out */}
        <LinearGradient
          colors={['transparent', '#ef4444', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', top: 0, left: '14%' as any, right: '14%' as any, height: 2 }}
        />

        {/* A) Header row — live indicator left, competition pill right */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <LiveDot />
            <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '600', letterSpacing: 1.5 }}>LIVE</Text>
          </View>
          <View
            style={{
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderWidth: 0.5,
              borderColor: 'rgba(255,255,255,0.10)',
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: '#d1d5db', fontSize: 11, letterSpacing: 1, fontWeight: '600' }}>
              {displaySport(game.sport)}
            </Text>
          </View>
        </View>

        {/* C) Match body — home left, score middle, away right */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 14 }}>
          {/* Home block (left) */}
          <View style={{ flex: 1, alignItems: 'center', minWidth: 0 }}>
            <JerseyGlow color={homeColors.primary}>
              <TeamJersey
                teamAbbreviation={game.homeTeam.abbreviation}
                primaryColor={homeColors.primary}
                secondaryColor={homeColors.secondary}
                size={46}
                sport={game.sport as Sport}
              />
            </JerseyGlow>
            <Text style={{ color: '#f3f4f6', fontSize: 13, fontWeight: '500', lineHeight: 16, textAlign: 'center', marginTop: 6 }} numberOfLines={1}>
              {homeNameTop}
            </Text>
            {homeNameBot ? (
              <Text style={{ color: '#f3f4f6', fontSize: 13, fontWeight: '500', lineHeight: 16, textAlign: 'center' }} numberOfLines={1}>
                {homeNameBot}
              </Text>
            ) : null}
            <Text style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>{game.homeTeam.record}</Text>
          </View>

          {/* D) LED score panel — same primitives as the home-page LED tiles. */}
          <View style={{ flexShrink: 0, alignItems: 'center' }}>
            {matchTime ? (
              <Text
                style={{
                  color: '#9ca3af',
                  fontSize: 10,
                  fontWeight: '600',
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                {matchTime}
              </Text>
            ) : null}
            <LedScorePanel awayScore={as2} homeScore={hs} />
          </View>

          {/* Away block (right) */}
          <View style={{ flex: 1, alignItems: 'center', minWidth: 0 }}>
            <JerseyGlow color={awayColors.primary}>
              <TeamJersey
                teamAbbreviation={game.awayTeam.abbreviation}
                primaryColor={awayColors.primary}
                secondaryColor={awayColors.secondary}
                size={46}
                sport={game.sport as Sport}
              />
            </JerseyGlow>
            <Text style={{ color: '#f3f4f6', fontSize: 13, fontWeight: '500', lineHeight: 16, textAlign: 'center', marginTop: 6 }} numberOfLines={1}>
              {awayNameTop}
            </Text>
            {awayNameBot ? (
              <Text style={{ color: '#f3f4f6', fontSize: 13, fontWeight: '500', lineHeight: 16, textAlign: 'center' }} numberOfLines={1}>
                {awayNameBot}
              </Text>
            ) : null}
            <Text style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>{game.awayTeam.record}</Text>
          </View>
        </View>

        {/* E) Hairline divider */}
        <View style={{ height: 0.5, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 4, marginBottom: 12 }} />

        {/* F) Stat tiles row */}
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {/* Tile 1 — YOUR PICK */}
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(10,16,25,0.55)',
              borderWidth: 0.5,
              borderColor: 'rgba(255,255,255,0.06)',
              borderRadius: 10,
              paddingVertical: 9,
              paddingHorizontal: 6,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#6b7280', fontSize: 9, fontWeight: '600', letterSpacing: 1.2, marginBottom: 6 }}>YOUR PICK</Text>
            <Text style={{ color: pick ? '#f3f4f6' : '#6b7280', fontSize: 12, fontWeight: '500' }}>
              {pick ? (pt?.abbreviation ?? '—') : 'No pick'}
            </Text>
          </View>

          {/* Tile 2 — MOMENTUM */}
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(10,16,25,0.55)',
              borderWidth: 0.5,
              borderColor: 'rgba(255,255,255,0.06)',
              borderRadius: 10,
              paddingVertical: 9,
              paddingHorizontal: 6,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#6b7280', fontSize: 9, fontWeight: '600', letterSpacing: 1.2, marginBottom: 4 }}>MOMENTUM</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16 }}>
              {momentumBars.map((v, i) => {
                const isPeak = i === peakIndex;
                const c = isPeak ? '#ef4444' : v >= 0.75 ? '#9ca3af' : v >= 0.5 ? '#6b7280' : '#4b5563';
                return (
                  <View
                    key={i}
                    style={{
                      width: 5,
                      height: Math.max(3, Math.round(v * 16)),
                      borderRadius: 1,
                      backgroundColor: c,
                    }}
                  />
                );
              })}
            </View>
            <Text style={{ color: '#9ca3af', fontSize: 10, marginTop: 4 }} numberOfLines={1}>{momentumLabel}</Text>
          </View>

          {/* Tile 3 — PICK STRENGTH */}
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(10,16,25,0.55)',
              borderWidth: 0.5,
              borderColor: 'rgba(255,255,255,0.06)',
              borderRadius: 10,
              paddingVertical: 9,
              paddingHorizontal: 6,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#6b7280', fontSize: 9, fontWeight: '600', letterSpacing: 1.2, marginBottom: 6 }}>PICK STRENGTH</Text>
            <Text style={{ color: strength.color, fontSize: 12, fontWeight: '600' }}>{strength.label}</Text>
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
  if (isLate && scoreDiff <= 3 && leader && trailer) {
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

  // ═══ ALERT — SCOUTING REPORT ═══
  if (pred?.analysis) {
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
    <Pressable onPress={() => { if (isLong) setExpanded(!expanded); }} style={{ backgroundColor: PANEL_DARK, borderRadius: 14, padding: 13, paddingLeft: 18, borderWidth: 1, borderColor: BORDER_MED, marginBottom: 8, position: 'relative' }}>
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
    <Pressable onPress={() => router.push(`/game/${game.id}`)} style={{ backgroundColor: PANEL_DARK, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER_MED, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
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
    <View style={{ backgroundColor: PANEL_DARK, borderWidth: 1, borderColor: 'rgba(139,10,31,0.14)', borderRadius: 18, padding: 18, marginHorizontal: 20, marginBottom: 24 }}>
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
            backgroundColor: p.result === 'win' ? TEAL : LOSS,
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

// ─── MATCHUP GENERATION ───
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
      dt = `Don't look at the records — look at the trajectory. ${underdog.abbreviation} has won ${uForm.wins} of their last ${uForm.total} and they're playing with nothing to lose tonight. ${winner.abbreviation} is favored, but this is the kind of game where the "better team" loses. Popcorn game.`;
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
    hl = 'Strongest signal on tonight\'s slate';
    tags.push('STANDOUT', `EDGE ${edge}/10`);
    dt = `If you only watch one game tonight, make it this one. ${winner.abbreviation} grades out at ${edge}/10 on edge rating — meaning the model is seeing a real statistical gap between these teams that the average fan won't see. ${loser.abbreviation} has a blind spot and ${winner.abbreviation} is built to exploit it.`;
  }

  // 8. COLD TEAM — fading fast
  if (!hl && (hf.wins <= 3 || af.wins <= 3) && hf.total >= 5 && trySet('cold_team')) {
    const cold = hf.wins <= af.wins ? home : away;
    const hot = cold === home ? away : home;
    const cW = cold === home ? hf.wins : af.wins;
    const cT = cold === home ? hf.total : af.total;
    hl = `${cold.abbreviation} is spiraling`;
    tags.push(`${cold.abbreviation} ${cW}-${cT - cW} L${cT}`, 'COLD STREAK');
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
      hl = `The model is calling for a comfortable win`;
      tags.push('PROJECTED MARGIN');
      dt = `Our model projects ${winner.abbreviation} winning by around ${Math.abs(spread)} points. The numbers back it up across multiple factors.`;
    } else if (overUnder && overUnder >= (sport === 'NBA' ? 230 : sport === 'NFL' ? 50 : sport === 'MLB' ? 9 : sport === 'NHL' ? 6.5 : 3.5)) {
      hl = 'Fireworks incoming';
      tags.push('HIGH-SCORING PROJECTION');
      dt = `Our model projects a combined ${overUnder}-point total — this has shootout written all over it. Bring snacks.`;
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
      dt = `Matinee matchup — ${away.abbreviation} at ${home.abbreviation}. The model leans ${winner.abbreviation} and gives them a ${Math.max(homeWP,awayWP)}% win probability. Early games fly under the radar — that's where the model's looking for the real separation.`;
    } else {
      hl = `${away.abbreviation} invades ${home.abbreviation}`;
      tags.push(displaySport(sport), `${Math.max(homeWP,awayWP)}% WIN PROB`);
      dt = `${away.abbreviation} (${away.record}) travels to face ${home.abbreviation} (${home.record}) tonight. The AI sees a ${conf >= 60 ? 'clear' : 'slight'} edge for ${winner.abbreviation}. ${conf < 58 ? 'Tight matchup — trust the numbers but keep an eye on late-breaking news.' : 'The data is leaning one direction. Keep it in mind.'}`;
    }
  }

  return { tags, headline: hl, detail: dt, drawType };
}

// ─── MATCHUP CARD (collapsible) ───
const MatchupCard = memo(function MatchupCard({ game, rank, headline, tags, detail, defaultExpanded }: { game: GameWithPrediction; rank: number; headline: string; tags: string[]; detail: string; defaultExpanded?: boolean }) {
  const router = useRouter(); const isFirst = rank === 1;
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  return (
    <View style={{ backgroundColor: PANEL_DARK, borderRadius: 14, borderWidth: 1, borderColor: BORDER_MED, borderLeftWidth: 3, borderLeftColor: isFirst ? MAROON : TEAL, marginBottom: 10, overflow: 'hidden' }}>
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
  return <View style={{backgroundColor:PANEL_DARK,borderWidth:1,borderColor:'rgba(139,10,31,0.12)',borderRadius:18,padding:18,marginHorizontal:20,marginBottom:16}}><Text style={{fontSize:9,fontWeight:'700',color:MAROON,letterSpacing:1.5,marginBottom:6}}>STREAK</Text><Text style={{fontSize:26,fontWeight:'800',color:WHITE}}>{stats?.currentStreak??0} correct in a row</Text><Text style={{fontSize:11,color:TEXT_MUTED,marginTop:4}}>Keep it going — every correct pick extends your streak</Text></View>;
});

// ─── RESULT CARD ───
const ResultCard = memo(function ResultCard({ game, pick }: { game: GameWithPrediction; pick?: UserPick }) {
  const w = pick?.result === 'win'; const hs = game.homeScore??0; const as2 = game.awayScore??0;
  return (
    <View style={{backgroundColor:PANEL_DARK,borderRadius:14,borderWidth:1,borderColor:BORDER_MED,padding:14,marginBottom:8}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
        <Text style={{fontSize:14,fontWeight:'700',color:WHITE}}>{game.awayTeam.abbreviation} {as2} - {hs} {game.homeTeam.abbreviation}</Text>
        {pick?<View style={{backgroundColor:w?TEAL_DIM:ERROR_DIM,borderRadius:8,paddingHorizontal:8,paddingVertical:3}}><Text style={{fontSize:9,fontWeight:'700',color:w?TEAL:LOSS}}>{w?'CORRECT':'MISSED'}</Text></View>:null}
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
  const tonightNarrative = useMemo(() => generateTonightNarrative(sched), [sched]);
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
        <View><Text style={{fontSize:10,fontWeight:'600',color:TEXT_MUTED,letterSpacing:2.5,marginBottom:4}}>MY ARENA</Text><Text style={{fontSize:24,fontWeight:'800',color:WHITE}}>Your Game Plan</Text></View>
        <View style={{flexDirection:'row',alignItems:'center',gap:6}}><View style={{width:6,height:6,borderRadius:3,backgroundColor:MAROON}} /><Text style={{fontSize:11,fontWeight:'700',color:MAROON}}>{sched.length} GAMES</Text></View>
      </View>

      {/* Tonight's Narrative card */}
      <View style={{backgroundColor:PANEL_DARK,borderRadius:18,borderWidth:1,borderColor:BORDER_MED,padding:18,marginHorizontal:20,marginBottom:20}}>
        <Text style={{fontSize:9,fontWeight:'700',color:MAROON,letterSpacing:1.5,marginBottom:8}}>TONIGHT'S NARRATIVE</Text>
        <Text style={{fontSize:15,fontWeight:'600',color:WHITE,lineHeight:23}}>{tonightNarrative}</Text>
      </View>

      {/* Top 3 quick-glance strip */}
      {top3.length > 0 ? (
        <View style={{marginBottom:20}}>
          <Text style={{fontSize:10,fontWeight:'700',color:TEXT_MUTED,letterSpacing:1.5,paddingHorizontal:20,marginBottom:10}}>HIGHEST CONVICTION TONIGHT</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal:20,gap:10}} style={{flexGrow:0}}>
            {top3.map((r, i) => {
              const conf = Math.round(r.game.prediction?.confidence ?? 50);
              const winner = r.game.prediction?.predictedWinner === 'home' ? r.game.homeTeam : r.game.awayTeam;
              return (
                <Pressable key={r.game.id} onPress={() => router.push(`/game/${r.game.id}`)} style={{width:140,backgroundColor:PANEL_DARK,borderRadius:14,borderWidth:1,borderColor:i===0?'rgba(139,10,31,0.25)':BORDER_MED,padding:12}}>
                  <View style={{flexDirection:'row',alignItems:'center',marginBottom:8}}>
                    <Text style={{fontSize:10,fontWeight:'600',color:TEXT_MUTED}}>{displaySport(r.game.sport)}</Text>
                  </View>
                  <Text style={{fontSize:13,fontWeight:'800',color:WHITE,marginBottom:4}}>{r.game.awayTeam.abbreviation} vs {r.game.homeTeam.abbreviation}</Text>
                  <Text style={{fontSize:10,fontWeight:'600',color:TEAL,marginBottom:2}}>Model: {winner.abbreviation}</Text>
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
            <Pressable key={label} onPress={() => { setPrepTab(idx as 0|1); Haptics.selectionAsync(); }} style={{flex:1,paddingVertical:10,borderRadius:10,alignItems:'center',backgroundColor:active?PANEL_DARK:'transparent'}}>
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
            : <View style={{backgroundColor:PANEL_DARK,borderRadius:14,borderWidth:1,borderColor:BORDER_MED,padding:14}}><Text style={{fontSize:11,color:TEXT_MUTED,lineHeight:16}}>No underdog plays surfaced today — the engine is siding with the market on every game.</Text></View>}
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
        <View style={{backgroundColor:PANEL_DARK,borderRadius:22,borderWidth:1,borderColor:'rgba(139,10,31,0.12)',padding:26,marginHorizontal:20,marginBottom:24,alignItems:'center'}}>
          <Text style={{fontSize:9,fontWeight:'700',color:MAROON,letterSpacing:1.5,marginBottom:8}}>YOUR NIGHT</Text>
          <Text style={{fontSize:56,fontWeight:'800',color:WHITE}}>{w}-{l}</Text>
          <Text style={{fontSize:14,fontWeight:'700',color:MAROON,marginTop:4}}>{a}% accuracy</Text>
          <View style={{flexDirection:'row',gap:3,marginTop:14}}>{pfg.map(g=><View key={g.id} style={{width:48,height:5,borderRadius:2.5,backgroundColor:pm.get(g.id)?.result==='win'?TEAL:LOSS,opacity:pm.get(g.id)?.result==='win'?0.9:0.4}} />)}</View>
        </View>
      ):<View style={{alignItems:'center',paddingVertical:36}}><Text style={{fontSize:13,color:TEXT_MUTED}}>Make some picks to see your results here</Text></View>}
      {pfg.length>0?<View style={{paddingHorizontal:20,marginBottom:24}}><Text style={{fontSize:12,fontWeight:'700',color:WHITE,marginBottom:14}}>Results</Text>{pfg.map(g=><ResultCard key={g.id} game={g} pick={pm.get(g.id)} />)}</View>:null}
      {fg.length>0?<View style={{backgroundColor:PANEL_DARK,borderRadius:18,borderWidth:1,borderColor:BORDER_MED,padding:18,marginHorizontal:20,marginBottom:24}}>
        <Text style={{fontSize:12,fontWeight:'700',color:WHITE,marginBottom:14}}>What The Data Caught</Text>
        {fg.slice(0,3).map(g=>{const p=g.prediction;if(!p) return null;const ok=(p.predictedWinner==='home'&&(g.homeScore??0)>(g.awayScore??0))||(p.predictedWinner==='away'&&(g.awayScore??0)>(g.homeScore??0));return <View key={g.id} style={{marginBottom:10,paddingLeft:12,borderLeftWidth:3,borderLeftColor:ok?TEAL:LOSS}}><Text style={{fontSize:11,fontWeight:'600',color:WHITE,marginBottom:2}}>{g.awayTeam.abbreviation} vs {g.homeTeam.abbreviation}</Text><Text style={{fontSize:11,color:TEXT_SECONDARY,lineHeight:16.5}}>{(() => { const tl = p.isTossUp || p.confidence < 53 ? 'a Toss-Up' : p.confidence < 60 ? 'a Solid Pick' : p.confidence < 72 ? 'a Strong Pick' : 'a Lock'; const tm = p.predictedWinner==='home'?g.homeTeam.abbreviation:g.awayTeam.abbreviation; return ok ? `Model correctly predicted ${tm} as ${tl}.` : `Model missed — rated ${tm} as ${tl} but the upset came through.`; })()}</Text></View>;})}
      </View>:null}
      <View style={{backgroundColor:PANEL_DARK,borderWidth:1,borderColor:'rgba(139,10,31,0.12)',borderRadius:18,padding:18,marginHorizontal:20,marginBottom:24,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
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
            <Pressable key={g.id} onPress={() => router.push(`/game/${g.id}` as any)} style={{ marginHorizontal: 20, backgroundColor: PANEL_DARK, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER_MED, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
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
            <Pressable key={g.id} onPress={() => router.push(`/game/${g.id}` as any)} style={{ marginHorizontal: 20, backgroundColor: PANEL_DARK, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER_MED, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
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
  const availableSports = useMemo(() => new Set((allGames ?? []).map(g => g.sport)), [allGames]);
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
        <SportPills selected={sf} onSelect={setSf} available={availableSports} />
        <FreeArena games={allGames ?? []} sportFilter={sf} router={router} sh={sh} onR={onR} isR={isR} followed={followed} />
        </ErrorBoundary>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{flex:1,backgroundColor:BG}}>
      <ErrorBoundary>
      <SearchBar />
      <SportPills selected={sf} onSelect={setSf} available={availableSports} />
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
