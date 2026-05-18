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
import Svg, { Circle, Defs, G, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Search, ChevronRight, Plus, Zap, Lock } from 'lucide-react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useSubscription } from '@/lib/subscription-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useGames } from '@/hooks/useGames';
import { useSmoothRefresh } from '@/hooks/useSmoothRefresh';
import { useUserPicks, useUserStats, type Pick as UserPick, type UserStats } from '@/hooks/usePicks';
import { useTeamFollows } from '@/hooks/useTeamFollows';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { GameWithPrediction, GameStatus, Sport } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { displayConfidence, displaySport, formatGameTime, getConfidenceTier } from '@/lib/display-confidence';
import { generateTonightNarrative } from '@/lib/tonight-narrative';
import {
  MAROON, MAROON_DIM, TEAL, TEAL_DIM, TEAL_DARK, LIVE_RED, LOSS, SILVER,
  BG, PANEL_DARK, PANEL_DARKER, BORDER_MED, BORDER_BOLD, WHITE,
  TEXT_SECONDARY, TEXT_MUTED,
} from '@/lib/theme';
import { TeamJersey } from '@/components/sports/TeamJersey';

// ─── COLORS ───
const ERROR_DIM = 'rgba(239,68,68,0.10)';

const { width: SW } = Dimensions.get('window');
const SPORTS = ['All','NBA','NFL','MLB','NHL','IPL','TENNIS','NCAAF','NCAAB','MLS','EPL','UCL'] as const;
const ALWAYS_VISIBLE_SPORT_FILTERS = new Set<string>(['IPL', 'TENNIS']);
const SPORT_DISPLAY: Record<string, string> = { NCAAF: 'CFB', NCAAB: 'CBB', TENNIS: 'Tennis' };
const SPRING = { stiffness: 300, damping: 22, mass: 1 };
const MODES = ['Game Day','Prep Mode','Review'] as const;
const TC = [TEAL, LIVE_RED, MAROON] as const;
type LiveIntelType = 'alert' | 'shift' | 'trend' | 'pulse';
type LiveIntelItem = { type: LiveIntelType; title: string; body: string };

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
      <Animated.View style={[{ position: 'absolute', top: -5, left: -5, right: -5, bottom: -5, borderRadius: 999, backgroundColor: 'rgba(220,38,38,0.18)' }, gs]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, gap: 6, borderWidth: 1, borderColor: 'rgba(239,68,68,0.24)' }}>
        <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED }, ds]} />
        <Text style={{ fontSize: 10, fontWeight: '900', color: LIVE_RED, letterSpacing: 1.1 }}>LIVE</Text>
      </View>
    </View>
  );
});

const ArenaMetaPill = memo(function ArenaMetaPill({ label, value, color = TEAL }: { label?: string; value: string; color?: string }) {
  return (
    <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
      <View style={{ backgroundColor: 'rgba(4,6,10,0.72)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: hexWithAlpha(color, 0.32), shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 10 }}>
        <Text style={{ fontSize: 10, fontWeight: '900', color, letterSpacing: 1.2 }}>{value}</Text>
      </View>
      {label ? <Text style={{ fontSize: 8, fontWeight: '900', color: 'rgba(224,234,240,0.48)', letterSpacing: 1.3, marginTop: 6 }}>{label}</Text> : null}
    </View>
  );
});

const ArenaHeader = memo(function ArenaHeader({
  title,
  subtitle,
  accent = TEAL,
  right,
}: {
  title: string;
  subtitle: string;
  accent?: string;
  right?: React.ReactNode;
}) {
  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 4,
        marginBottom: 24,
        borderRadius: 26,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: hexWithAlpha(accent, 0.22),
        backgroundColor: '#030509',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.36,
        shadowRadius: 30,
        elevation: 12,
      }}
    >
      <LinearGradient
        colors={['rgba(27,34,44,0.98)', 'rgba(6,9,14,0.99)', 'rgba(2,3,7,1)']}
        locations={[0, 0.54, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 18, minHeight: 148 }}
      >
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.18)', hexWithAlpha(accent, 0.42), 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0)']}
          locations={[0, 0.28, 0.58, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1.5 }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 18,
            bottom: 18,
            width: 5,
            borderTopRightRadius: 5,
            borderBottomRightRadius: 5,
            backgroundColor: hexWithAlpha(accent, 0.9),
            shadowColor: accent,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.42,
            shadowRadius: 12,
          }}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[hexWithAlpha(accent, 0.28), 'rgba(255,255,255,0)', hexWithAlpha(MAROON, 0.13)]}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0)']}
          locations={[0, 0.48, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', left: -30, right: -30, top: 28, height: 58, transform: [{ rotate: '-14deg' }] }}
        />
        <View pointerEvents="none" style={{ position: 'absolute', right: 18, top: 18, bottom: 18, width: 74, opacity: 0.28 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ position: 'absolute', right: i * 16, top: -16, bottom: -16, width: 1, backgroundColor: i % 2 === 0 ? hexWithAlpha(accent, 0.72) : 'rgba(255,255,255,0.28)', transform: [{ rotate: '18deg' }] }} />
          ))}
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: 18, right: 18, bottom: 16, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 28, bottom: 15, width: 72, height: 3, borderRadius: 999, backgroundColor: hexWithAlpha(accent, 0.72) }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 11 }}>
              <View style={{ width: 24, height: 24, borderRadius: 9, borderWidth: 1, borderColor: hexWithAlpha(accent, 0.34), backgroundColor: hexWithAlpha(accent, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: accent }} />
              </View>
              <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontSize: 8.5, fontWeight: '900', color: hexWithAlpha(accent, 0.95), letterSpacing: 2.1 }}>MY ARENA</Text>
              </View>
            </View>
            <Text style={{ fontSize: 30, fontWeight: '900', color: WHITE, lineHeight: 35, letterSpacing: 0 }} numberOfLines={1}>{title}</Text>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: 'rgba(224,234,240,0.72)', lineHeight: 18.5, marginTop: 9, maxWidth: 270 }}>{subtitle}</Text>
          </View>
          {right ? <View style={{ paddingTop: 3, alignItems: 'flex-end', flexShrink: 0 }}>{right}</View> : null}
        </View>
      </LinearGradient>
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
  const visible = available
    ? SPORTS.filter(s => s === 'All' || available.has(s) || ALWAYS_VISIBLE_SPORT_FILTERS.has(s))
    : SPORTS;
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

type FinalTeamResult = 'winner' | 'loser' | 'neutral';
const FOLLOWED_CARD_W = Math.min(326, Math.max(280, SW - 64));

// ─── FOLLOWED GAME CARD ───
const FollowedCard = memo(function FollowedCard({ game }: { game: GameWithPrediction }) {
  const router = useRouter();
  const live = game.status === GameStatus.LIVE;
  const final = game.status === GameStatus.FINAL;
  const awayScore = typeof game.awayScore === 'number' ? game.awayScore : null;
  const homeScore = typeof game.homeScore === 'number' ? game.homeScore : null;
  const finalHasScores = final && awayScore !== null && homeScore !== null;
  const awayWon = finalHasScores && awayScore > homeScore;
  const homeWon = finalHasScores && homeScore > awayScore;
  const tiedFinal = finalHasScores && awayScore === homeScore;
  const startTime = new Date(game.gameTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const awayColors = getTeamColors(game.awayTeam.abbreviation, game.sport, game.awayTeam.color);
  const homeColors = getTeamColors(game.homeTeam.abbreviation, game.sport, game.homeTeam.color);
  const winningTeam = awayWon ? game.awayTeam : homeWon ? game.homeTeam : null;
  const winningColors = awayWon ? awayColors : homeWon ? homeColors : null;
  const resultAccent = winningColors?.primary ?? SILVER;
  const prediction = game.prediction;
  const pickSide = prediction?.predictedWinner;
  const pickTeam = pickSide === 'home' ? game.homeTeam : pickSide === 'away' ? game.awayTeam : null;
  const tier = prediction ? getConfidenceTier(prediction.confidence, prediction.isTossUp) : null;
  const startLabel =
    game.sport === Sport.MLB ? 'First Pitch' :
    game.sport === Sport.IPL ? 'First Ball' :
    game.sport === Sport.TENNIS ? 'First Serve' :
    game.sport === Sport.NBA || game.sport === Sport.NCAAB ? 'Tipoff' :
    game.sport === Sport.NHL ? 'Puck Drop' :
    game.sport === Sport.MLS || game.sport === Sport.EPL || game.sport === Sport.UCL ? 'Kickoff' :
    'Starts';
  const centerLabel = live ? (formatGameTime(game.sport, game.quarter, game.clock) ?? 'Live Now') : final ? 'Final' : startLabel;
  const finalOutcomeLabel = winningTeam ? `${winningTeam.abbreviation} WINS` : tiedFinal ? 'DRAW' : null;
  const dotOp = useSharedValue(1);
  useEffect(() => { if (live) { dotOp.value = withRepeat(withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true); } return () => cancelAnimation(dotOp); }, [live]);
  const ds = useAnimatedStyle(() => ({ opacity: dotOp.value }));
  const statusText = live ? 'LIVE' : final ? 'FINAL' : centerLabel.toUpperCase();
  const statusColor = live ? LIVE_RED : final ? resultAccent : TEAL;

  const renderTeam = (
    team: GameWithPrediction['homeTeam'],
    colors: ReturnType<typeof getTeamColors>,
    score: number | null,
    result: FinalTeamResult = 'neutral',
  ) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: result === 'loser' ? 0.58 : 1 }}>
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 13,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: result === 'winner' ? hexWithAlpha(colors.primary, 0.22) : hexWithAlpha(colors.primary, 0.1),
          borderWidth: 1,
          borderColor: result === 'winner' ? 'rgba(255,255,255,0.26)' : hexWithAlpha(colors.primary, 0.2),
          flexShrink: 0,
        }}
      >
        <TeamJersey
          teamAbbreviation={team.abbreviation}
          teamName={team.name}
          primaryColor={colors.primary}
          secondaryColor={colors.secondary}
          size={27}
          sport={game.sport as Sport}
        />
        {result === 'winner' ? (
          <View style={{ position: 'absolute', right: -4, bottom: -4, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: hexWithAlpha(colors.primary, 0.72) }}>
            <Text style={{ color: '#040608', fontSize: 8, fontWeight: '900' }}>W</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: result === 'winner' ? '#FFFFFF' : WHITE, fontSize: 14, fontWeight: '900', letterSpacing: 0 }} numberOfLines={1}>
          {team.abbreviation}
        </Text>
        <Text style={{ color: result === 'winner' ? hexWithAlpha(colors.primary, 0.9) : 'rgba(255,255,255,0.48)', fontSize: 9.5, fontWeight: '800', marginTop: 1 }} numberOfLines={1}>
          {team.name}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', minWidth: 38 }}>
        {live || final ? (
          <Text style={{ color: result === 'winner' ? '#FFFFFF' : 'rgba(255,255,255,0.78)', fontSize: 24, lineHeight: 25, fontWeight: '900', fontFamily: 'VT323_400Regular', letterSpacing: 1 }}>
            {score ?? 0}
          </Text>
        ) : (
          <Text style={{ color: TEXT_MUTED, fontSize: 10, fontWeight: '800' }} numberOfLines={1}>
            {team.record || '--'}
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/game/${game.id}`); }}
      style={({ pressed }) => ({
        width: FOLLOWED_CARD_W,
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: live ? 'rgba(255,84,84,0.3)' : winningTeam ? hexWithAlpha(resultAccent, 0.27) : 'rgba(180,211,235,0.16)',
        transform: [{ scale: pressed ? 0.99 : 1 }],
        backgroundColor: '#0a1018',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.26,
        shadowRadius: 20,
        elevation: 6,
      })}
    >
      <LinearGradient
        colors={['#111a24', '#090f17', '#03060a']}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 12, minHeight: 162 }}
      >
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 15, bottom: 15, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: live ? LIVE_RED : resultAccent }} />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0)']}
          locations={[0, 0.42, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.7, y: 0.8 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[hexWithAlpha(awayColors.primary, 0.16), 'rgba(255,255,255,0)', hexWithAlpha(homeColors.primary, 0.16)]}
          locations={[0, 0.52, 1]}
          start={{ x: 0, y: 0.4 }}
          end={{ x: 1, y: 0.7 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 9, paddingVertical: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: TEAL, letterSpacing: 1.2 }}>{displaySport(game.sport)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: live ? 'rgba(220,38,38,0.13)' : final ? hexWithAlpha(resultAccent, 0.1) : 'rgba(122,157,184,0.075)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: live ? 'rgba(220,38,38,0.22)' : final ? hexWithAlpha(resultAccent, 0.18) : 'rgba(122,157,184,0.13)' }}>
              {live ? <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED }, ds]} /> : null}
              <Text style={{ fontSize: 9, color: statusColor, fontWeight: '900', letterSpacing: 0.8 }}>{statusText}</Text>
            </View>
          </View>
          <ChevronRight size={16} color="rgba(255,255,255,0.34)" strokeWidth={2.4} />
        </View>

        <View style={{ gap: 8 }}>
          {renderTeam(game.awayTeam, awayColors, awayScore, awayWon ? 'winner' : homeWon ? 'loser' : 'neutral')}
          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.055)' }} />
          {renderTeam(game.homeTeam, homeColors, homeScore, homeWon ? 'winner' : awayWon ? 'loser' : 'neutral')}
        </View>

        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.055)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text style={{ flex: 1, color: TEXT_SECONDARY, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>
            {finalOutcomeLabel ?? (live ? (formatGameTime(game.sport, game.quarter, game.clock) ?? 'Live read') : `${startLabel} ${startTime}`)}
          </Text>
          {prediction && !final ? (
            <View style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: `${tier?.color ?? TEAL}14`, borderWidth: 1, borderColor: `${tier?.color ?? TEAL}2A` }}>
              <Text style={{ color: tier?.color ?? TEAL, fontSize: 9, fontWeight: '900' }}>
                {pickTeam?.abbreviation ?? 'PICK'} {Math.round(prediction.confidence)}%
              </Text>
            </View>
          ) : (
            <Text style={{ color: final ? resultAccent : TEAL, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 }}>{final ? 'RECAP' : 'OPEN'}</Text>
          )}
        </View>
      </LinearGradient>
    </Pressable>
  );
});

// ─── YOUR GAMES ───
const YourGames = memo(function YourGames({ games }: { games: GameWithPrediction[] }) {
  const router = useRouter();
  const orderedGames = useMemo(() => {
    const priority = (game: GameWithPrediction) =>
      game.status === GameStatus.LIVE ? 0 :
      game.status === GameStatus.SCHEDULED ? 1 :
      game.status === GameStatus.FINAL ? 2 :
      3;
    return [...games].sort((a, b) => {
      const p = priority(a) - priority(b);
      if (p !== 0) return p;
      return new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime();
    });
  }, [games]);

  if (games.length === 0) return (
    <View style={{ marginHorizontal: 20, marginBottom: 30 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
        <View>
          <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2, marginBottom: 4 }}>FOLLOWING</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', color: WHITE, letterSpacing: 0 }}>Your Games</Text>
        </View>
      </View>
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)'); }}
        style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(180,211,235,0.14)', backgroundColor: PANEL_DARK }}
      >
        <LinearGradient colors={['rgba(255,255,255,0.035)', 'rgba(4,6,8,0.96)', 'rgba(122,157,184,0.09)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 122, padding: 16, justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Plus size={20} color={TEAL} strokeWidth={2.7} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Zap size={12} color={TEAL} fill={TEAL} />
              <Text style={{ color: TEAL, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }}>BUILD BOARD</Text>
            </View>
          </View>
          <View>
            <Text style={{ color: WHITE, fontSize: 21, fontWeight: '900', letterSpacing: 0 }}>Track your slate</Text>
            <Text style={{ color: TEXT_SECONDARY, fontSize: 12.5, lineHeight: 18, marginTop: 4 }}>Follow games or teams and this becomes your personal command rail.</Text>
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
  return (
    <View style={{ marginBottom: 34 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginHorizontal: 20, marginBottom: 12 }}>
        <View>
          <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2, marginBottom: 4 }}>FOLLOWING</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: WHITE, letterSpacing: 0 }}>Your Games</Text>
            <View style={{ minWidth: 24, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, backgroundColor: 'rgba(122,157,184,0.1)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.16)' }}>
              <Text style={{ fontSize: 10, fontWeight: '900', color: TEAL }}>{orderedGames.length}</Text>
            </View>
          </View>
        </View>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)'); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(122,157,184,0.09)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.18)' }}
        >
          <Text style={{ fontSize: 11, fontWeight: '900', color: TEAL }}>Browse</Text>
          <Plus size={12} color={TEAL} strokeWidth={2.8} />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={FOLLOWED_CARD_W + 12}
        snapToAlignment="start"
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }}
      >
        {orderedGames.map((g) => <FollowedCard key={g.id} game={g} />)}
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

const SCORE_FACE_MATRIX: Record<string, number[][]> = {
  '0': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,1,1],[1,0,1,0,1],[1,1,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '1': [[0,0,1,0,0],[0,1,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,1,1,1,0]],
  '2': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,1,1,1,1]],
  '3': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,1,1,0],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '4': [[0,0,0,1,0],[0,0,1,1,0],[0,1,0,1,0],[1,0,0,1,0],[1,1,1,1,1],[0,0,0,1,0],[0,0,0,1,0]],
  '5': [[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '6': [[0,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '7': [[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  '8': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '9': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,1],[0,0,0,0,1],[0,0,0,0,1],[0,1,1,1,0]],
  '-': [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,1,1,1,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]],
};

const SCORE_FACE_SCALE = 2;
const SCORE_FACE_PITCH = 1.62;
const SCORE_FACE_PAD_X = 6;
const SCORE_FACE_PAD_Y = 5;
const SCORE_FACE_GAP = 2;
const SCORE_FACE_ROWS = 7 * SCORE_FACE_SCALE;

function scoreFaceTextWidth(text: string): number {
  let cols = 0;
  for (let i = 0; i < text.length; i++) {
    const matrix = SCORE_FACE_MATRIX[text[i]];
    if (!matrix) continue;
    if (cols > 0) cols += SCORE_FACE_GAP;
    cols += matrix[0].length * SCORE_FACE_SCALE;
  }
  return cols;
}

const ArenaScoreFace = memo(function ArenaScoreFace({ homeScore, awayScore }: { homeScore: number; awayScore: number }) {
  const text = `${homeScore}-${awayScore}`;
  const textCols = scoreFaceTextWidth(text);
  const cols = textCols + 4;
  const rows = SCORE_FACE_ROWS + 4;
  const width = cols * SCORE_FACE_PITCH + SCORE_FACE_PAD_X * 2;
  const height = rows * SCORE_FACE_PITCH + SCORE_FACE_PAD_Y * 2;

  const lit = new Set<string>();
  let cursor = 2;
  for (let i = 0; i < text.length; i++) {
    const matrix = SCORE_FACE_MATRIX[text[i]];
    if (!matrix) continue;
    if (i > 0) cursor += SCORE_FACE_GAP;
    for (let row = 0; row < matrix.length; row++) {
      for (let col = 0; col < matrix[row].length; col++) {
        if (matrix[row][col] !== 1) continue;
        for (let sy = 0; sy < SCORE_FACE_SCALE; sy++) {
          for (let sx = 0; sx < SCORE_FACE_SCALE; sx++) {
            lit.add(`${cursor + col * SCORE_FACE_SCALE + sx},${row * SCORE_FACE_SCALE + sy + 2}`);
          }
        }
      }
    }
    cursor += matrix[0].length * SCORE_FACE_SCALE;
  }

  const cells: { x: number; y: number; lit: boolean }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        x: SCORE_FACE_PAD_X + col * SCORE_FACE_PITCH + SCORE_FACE_PITCH / 2,
        y: SCORE_FACE_PAD_Y + row * SCORE_FACE_PITCH + SCORE_FACE_PITCH / 2,
        lit: lit.has(`${col},${row}`),
      });
    }
  }

  return (
    <View style={{ borderRadius: 10, overflow: 'hidden', backgroundColor: '#020303' }}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="scoreFaceLit" cx="50%" cy="42%" r="62%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
            <Stop offset="46%" stopColor="#f7fbfc" stopOpacity={1} />
            <Stop offset="100%" stopColor="#aeb8bd" stopOpacity={1} />
          </RadialGradient>
          <RadialGradient id="scoreFaceOff" cx="45%" cy="38%" r="64%">
            <Stop offset="0%" stopColor="#323738" stopOpacity={1} />
            <Stop offset="56%" stopColor="#131718" stopOpacity={1} />
            <Stop offset="100%" stopColor="#050606" stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="#020303" />
        <Rect x={1} y={1} width={width - 2} height={height - 2} rx={7} fill="#070909" />
        {cells.map((cell, index) => (
          <G key={index}>
            {cell.lit ? (
              <>
                <Circle cx={cell.x} cy={cell.y} r={1.52} fill="#eaf7ff" opacity={0.13} />
                <Circle cx={cell.x} cy={cell.y} r={0.82} fill="#010202" opacity={0.96} />
                <Circle cx={cell.x} cy={cell.y} r={0.58} fill="url(#scoreFaceLit)" />
                <Circle cx={cell.x - 0.18} cy={cell.y - 0.2} r={0.16} fill="#ffffff" opacity={0.72} />
              </>
            ) : (
              <>
                <Circle cx={cell.x} cy={cell.y} r={0.82} fill="#010202" opacity={0.96} />
                <Circle cx={cell.x} cy={cell.y} r={0.58} fill="url(#scoreFaceOff)" opacity={0.9} />
                <Circle cx={cell.x - 0.16} cy={cell.y - 0.18} r={0.13} fill="#475052" opacity={0.18} />
              </>
            )}
          </G>
        ))}
        {Array.from({ length: rows + 1 }).map((_, row) => (
          <Rect key={`scan-${row}`} x={0} y={SCORE_FACE_PAD_Y + row * SCORE_FACE_PITCH - 0.18} width={width} height={0.2} fill="#ffffff" opacity={0.025} />
        ))}
        {Array.from({ length: Math.floor(cols / 5) + 1 }).map((_, col) => (
          <Rect key={`panel-col-${col}`} x={SCORE_FACE_PAD_X + col * SCORE_FACE_PITCH * 5 - 0.1} y={2} width={0.2} height={height - 4} fill="#000000" opacity={0.28} />
        ))}
        <Rect x={0} y={0} width={width} height={height * 0.28} fill="#ffffff" opacity={0.052} />
        <Rect x={0} y={height * 0.7} width={width} height={height * 0.3} fill="#000000" opacity={0.3} />
        <Rect x={0} y={0} width={width} height={height} fill="#000000" opacity={0.06} />
      </Svg>
    </View>
  );
});

const ArenaScoreboard = memo(function ArenaScoreboard({
  awayScore,
  homeScore,
  awayColor,
  homeColor,
}: {
  awayScore: number;
  homeScore: number;
  awayColor: string;
  homeColor: string;
}) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 8,
          right: 8,
          bottom: -5,
          height: 12,
          borderRadius: 8,
          backgroundColor: 'rgba(0,0,0,0.56)',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 5 },
          shadowOpacity: 0.7,
          shadowRadius: 8,
        }}
      />
      <LinearGradient
        colors={['#46515d', '#111318', '#050505', '#2b323a']}
        locations={[0, 0.2, 0.62, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{
          borderRadius: 18,
          padding: 3,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
          shadowColor: '#ffffff',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.14,
          shadowRadius: 14,
        }}
      >
        <View style={{ borderRadius: 15, padding: 5, backgroundColor: '#030303', overflow: 'hidden' }}>
          <LinearGradient
            colors={[hexWithAlpha(homeColor, 0.62), 'rgba(255,255,255,0.34)', hexWithAlpha(awayColor, 0.62)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', top: 0, left: 8, right: 8, height: 2 }}
          />
          <LinearGradient
            colors={[hexWithAlpha(homeColor, 0.26), 'rgba(255,255,255,0.04)', hexWithAlpha(awayColor, 0.26)]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, backgroundColor: hexWithAlpha(homeColor, 0.75), borderTopRightRadius: 3, borderBottomRightRadius: 3 }} />
          <View style={{ position: 'absolute', right: 0, top: 10, bottom: 10, width: 3, backgroundColor: hexWithAlpha(awayColor, 0.75), borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }} />
          {[
            { top: 4, left: 4 },
            { top: 4, right: 4 },
            { bottom: 4, left: 4 },
            { bottom: 4, right: 4 },
          ].map((pos, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                ...pos,
                width: 4,
                height: 4,
                borderRadius: 2,
                backgroundColor: '#050505',
                borderWidth: 0.7,
                borderColor: 'rgba(255,255,255,0.28)',
              }}
            />
          ))}
          <View style={{ borderRadius: 12, padding: 2, backgroundColor: 'rgba(255,255,255,0.04)' }}>
            <ArenaScoreFace awayScore={awayScore} homeScore={homeScore} />
          </View>
          <LinearGradient
            colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.08)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
        </View>
      </LinearGradient>
    </View>
  );
});

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
  const homeLeading = hs > as2;
  const awayLeading = as2 > hs;
  const leaderColor = homeLeading ? homeColors.primary : awayLeading ? awayColors.primary : TEAL;
  const scoreGap = Math.abs(hs - as2);
  const pickStatusColor = !pick ? '#6b7280' : lead ? '#4ade80' : ps === os ? '#facc15' : LIVE_RED;
  const pickStatusText = !pick ? 'No pick set' : lead ? `Up ${scoreGap}` : ps === os ? 'Even' : `Down ${scoreGap}`;
  const innerPadX = 14;
  const bodyGap = 9;
  const scoreColumnWidth = Math.min(148, Math.max(138, cardWidth * 0.4));
  const teamColumnWidth = Math.max(78, (cardWidth - innerPadX * 2 - scoreColumnWidth - bodyGap * 2) / 2);

  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/game/[id]', params: { id: game.id } }); }}
      style={{ width: cardWidth }}
    >
      <View
        style={{
          borderRadius: 28,
          backgroundColor: 'transparent',
        }}
      >
        <LinearGradient
          colors={[
            'rgba(224,234,240,0.92)',
            'rgba(122,157,184,0.58)',
            'rgba(49,63,78,0.34)',
            'rgba(139,10,31,0.66)',
            'rgba(224,234,240,0.74)',
          ]}
          locations={[0, 0.24, 0.52, 0.78, 1]}
          start={{ x: 0.08, y: 0 }}
          end={{ x: 0.92, y: 1 }}
          style={{ borderRadius: 28, padding: 1.35 }}
        >
          <View
            style={{
              borderRadius: 26.5,
              overflow: 'hidden',
              paddingTop: 14,
              paddingBottom: 15,
              paddingHorizontal: innerPadX,
              backgroundColor: 'rgba(5,8,13,0.96)',
            }}
          >
        {/* Dark frosted tint — BlurView softens whatever sits behind the card,
            then a heavier semi-transparent dark layer establishes a deeper
            ink-blue base. Together they read as frosted glass over a dark
            substrate. */}
        <BlurView intensity={72} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(4,7,12,0.94)' }]} />

        {/* Brand glass wash; team colors stay on jerseys and the scoreboard rails. */}
        <LinearGradient
          colors={['rgba(122,157,184,0.24)', 'rgba(7,10,16,0.08)', 'rgba(139,10,31,0.28)']}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <LinearGradient
          colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.06)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <LinearGradient
          colors={['transparent', 'rgba(122,157,184,0.58)', 'transparent']}
          style={{ position: 'absolute', left: 1, top: 32, bottom: 32, width: 1.6 }}
        />
        <LinearGradient
          colors={['transparent', 'rgba(139,10,31,0.62)', 'transparent']}
          style={{ position: 'absolute', right: 1, top: 32, bottom: 32, width: 1.6 }}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(224,234,240,0.16)', 'rgba(122,157,184,0.04)', 'rgba(122,157,184,0)']}
          locations={[0, 0.42, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 64 }}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(139,10,31,0)', 'rgba(139,10,31,0.08)', 'rgba(139,10,31,0.18)']}
          locations={[0, 0.56, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 76 }}
        />

        {/* Polished top rail. */}
        <LinearGradient
          colors={['transparent', 'rgba(122,157,184,0.78)', 'rgba(255,255,255,0.72)', 'rgba(139,10,31,0.72)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', top: 0, left: '10%' as any, right: '10%' as any, height: 1.6 }}
        />

        {/* A) Header row — balanced controls around a centered pulse. */}
        <View style={{ position: 'relative', height: 42, justifyContent: 'center', marginBottom: 8 }}>
          <View style={{ position: 'absolute', left: 0, top: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.11)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(239,68,68,0.24)' }}>
            <LiveDot />
            <Text style={{ color: '#ff5a52', fontSize: 10, fontWeight: '900', letterSpacing: 1.7 }}>LIVE</Text>
          </View>
          <View style={{ alignSelf: 'center', alignItems: 'center', minWidth: 94, backgroundColor: 'rgba(0,0,0,0.34)', borderRadius: 13, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ color: 'rgba(255,255,255,0.42)', fontSize: 8, fontWeight: '900', letterSpacing: 1.8 }}>GAME PULSE</Text>
            <Text style={{ color: hexWithAlpha(leaderColor, 0.95), fontSize: 11, fontWeight: '900', marginTop: 1 }}>
              {homeLeading ? `${game.homeTeam.abbreviation} +${scoreGap}` : awayLeading ? `${game.awayTeam.abbreviation} +${scoreGap}` : 'LEVEL'}
            </Text>
          </View>
          <View
            style={{
              position: 'absolute',
              right: 0,
              top: 1,
              backgroundColor: 'rgba(122,157,184,0.12)',
              borderWidth: 1,
              borderColor: 'rgba(122,157,184,0.28)',
              borderRadius: 999,
              minWidth: 58,
              alignItems: 'center',
              paddingHorizontal: 13,
              paddingVertical: 6,
            }}
          >
            <Text style={{ color: TEAL, fontSize: 10, letterSpacing: 1.6, fontWeight: '900' }}>
              {displaySport(game.sport)}
            </Text>
          </View>
        </View>

        {/* C) Match body — home left, score middle, away right */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: bodyGap, paddingTop: 1, paddingBottom: 16 }}>
          {/* Home block (left) */}
          <View style={{ width: teamColumnWidth, alignItems: 'center', minWidth: 0 }}>
            <View style={{ height: 62, alignItems: 'center', justifyContent: 'center', opacity: homeLeading || !awayLeading ? 1 : 0.66, transform: [{ scale: homeLeading ? 1.04 : 1 }] }}>
              <JerseyGlow color={homeColors.primary}>
                <TeamJersey
                  teamAbbreviation={game.homeTeam.abbreviation}
                  teamName={game.homeTeam.name}
                  primaryColor={homeColors.primary}
                  secondaryColor={homeColors.secondary}
                  size={48}
                  sport={game.sport as Sport}
                />
              </JerseyGlow>
            </View>
            <Text style={{ color: '#f8fafc', fontSize: 13, fontWeight: '900', lineHeight: 15.5, textAlign: 'center', marginTop: 5, minHeight: 32 }} numberOfLines={2}>
              {game.homeTeam.name}
            </Text>
            <Text style={{ color: homeLeading ? '#d1d5db' : '#8b95a5', fontSize: 11, fontWeight: '700', marginTop: 3 }}>{game.homeTeam.record}</Text>
          </View>

          {/* D) LED score panel — same primitives as the home-page LED tiles. */}
          <View style={{ width: scoreColumnWidth, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
            {matchTime ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: LIVE_RED }} />
                <Text
                  style={{
                    color: '#b8c3d1',
                    fontSize: 9,
                    fontWeight: '900',
                    letterSpacing: 1.1,
                    textTransform: 'uppercase',
                  }}
                >
                  {matchTime}
                </Text>
              </View>
            ) : null}
            <ArenaScoreboard
              awayScore={as2}
              homeScore={hs}
              awayColor={awayColors.primary}
              homeColor={homeColors.primary}
            />
          </View>

          {/* Away block (right) */}
          <View style={{ width: teamColumnWidth, alignItems: 'center', minWidth: 0 }}>
            <View style={{ height: 62, alignItems: 'center', justifyContent: 'center', opacity: awayLeading || !homeLeading ? 1 : 0.66, transform: [{ scale: awayLeading ? 1.04 : 1 }] }}>
              <JerseyGlow color={awayColors.primary}>
                <TeamJersey
                  teamAbbreviation={game.awayTeam.abbreviation}
                  teamName={game.awayTeam.name}
                  primaryColor={awayColors.primary}
                  secondaryColor={awayColors.secondary}
                  size={48}
                  sport={game.sport as Sport}
                />
              </JerseyGlow>
            </View>
            <Text style={{ color: '#f8fafc', fontSize: 13, fontWeight: '900', lineHeight: 15.5, textAlign: 'center', marginTop: 5, minHeight: 32 }} numberOfLines={2}>
              {game.awayTeam.name}
            </Text>
            <Text style={{ color: awayLeading ? '#d1d5db' : '#8b95a5', fontSize: 11, fontWeight: '700', marginTop: 3 }}>{game.awayTeam.record}</Text>
          </View>
        </View>

        {/* E) Hairline divider */}
        <LinearGradient
          colors={['transparent', 'rgba(122,157,184,0.18)', 'rgba(255,255,255,0.1)', 'rgba(139,10,31,0.16)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ height: 1, marginBottom: 13 }}
        />

        {/* F) Stat tiles row */}
        <View style={{ flexDirection: 'row', gap: 9 }}>
          {/* Tile 1 — YOUR PICK */}
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(2,5,12,0.72)',
              borderWidth: 1,
              borderColor: pick ? hexWithAlpha(pickStatusColor, 0.24) : 'rgba(255,255,255,0.08)',
              borderRadius: 16,
              minHeight: 72,
              justifyContent: 'center',
              paddingVertical: 9,
              paddingHorizontal: 7,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#8a95a6', fontSize: 8, fontWeight: '900', letterSpacing: 1.7, marginBottom: 6 }}>YOUR PICK</Text>
            <Text style={{ color: pick ? '#f8fafc' : '#7a8392', fontSize: 13, fontWeight: '800' }}>
              {pick ? (pt?.abbreviation ?? '--') : 'None'}
            </Text>
            <Text style={{ color: pickStatusColor, fontSize: 9, fontWeight: '800', marginTop: 3 }} numberOfLines={1}>{pickStatusText}</Text>
          </View>

          {/* Tile 2 — MOMENTUM */}
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(2,5,12,0.72)',
              borderWidth: 1,
              borderColor: 'rgba(122,157,184,0.2)',
              borderRadius: 16,
              minHeight: 72,
              justifyContent: 'center',
              paddingVertical: 9,
              paddingHorizontal: 7,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#8a95a6', fontSize: 8, fontWeight: '900', letterSpacing: 1.7, marginBottom: 5 }}>MOMENTUM</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18 }}>
              {momentumBars.map((v, i) => {
                const isPeak = i === peakIndex;
                const c = isPeak ? LIVE_RED : v >= 0.75 ? '#c8d4df' : v >= 0.5 ? '#7A9DB8' : '#4b5563';
                return (
                  <View
                    key={i}
                    style={{
                      width: 5,
                      height: Math.max(4, Math.round(v * 18)),
                      borderRadius: 2,
                      backgroundColor: c,
                      shadowColor: c,
                      shadowOpacity: isPeak ? 0.55 : 0,
                      shadowRadius: 5,
                    }}
                  />
                );
              })}
            </View>
            <Text style={{ color: '#b8c3d1', fontSize: 9, fontWeight: '700', marginTop: 4 }} numberOfLines={1}>{momentumLabel}</Text>
          </View>

          {/* Tile 3 — PICK STRENGTH */}
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(2,5,12,0.72)',
              borderWidth: 1,
              borderColor: hexWithAlpha(strength.color, 0.26),
              borderRadius: 16,
              minHeight: 72,
              justifyContent: 'center',
              paddingVertical: 9,
              paddingHorizontal: 7,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#8a95a6', fontSize: 8, fontWeight: '900', letterSpacing: 1.7, marginBottom: 6 }}>AI EDGE</Text>
            <Text style={{ color: strength.color, fontSize: 14, fontWeight: '900' }}>{strength.label}</Text>
            <View style={{ width: 34, height: 3, borderRadius: 2, backgroundColor: hexWithAlpha(strength.color, 0.65), marginTop: 7 }} />
          </View>
        </View>
          </View>
        </LinearGradient>
      </View>
    </Pressable>
  );
});

// ─── GENERATE LIVE INTEL ───
function scoreUnit(sport: Sport, scoreDiff: number): string {
  const plural = scoreDiff === 1 ? '' : 's';
  if (sport === Sport.MLB || sport === Sport.IPL) return `run${plural}`;
  if (sport === Sport.NHL || sport === Sport.MLS || sport === Sport.EPL || sport === Sport.UCL) return `goal${plural}`;
  if (sport === Sport.TENNIS) return `point${plural}`;
  return `point${plural}`;
}

function liveMomentLabel(game: GameWithPrediction): string {
  return formatGameTime(game.sport, game.quarter, game.clock) ?? game.quarter ?? game.clock ?? 'Live now';
}

function pressurePointBody(game: GameWithPrediction, leader: GameWithPrediction['homeTeam'] | null, trailer: GameWithPrediction['homeTeam'] | null, scoreDiff: number, isTied: boolean): string {
  const unit = scoreUnit(game.sport, scoreDiff);

  if (game.sport === Sport.MLB && game.liveState) {
    const state = game.liveState;
    const bases = [
      state.onFirst ? '1st' : null,
      state.onSecond ? '2nd' : null,
      state.onThird ? '3rd' : null,
    ].filter(Boolean).join('/');
    const batter = state.batter?.name ? `${state.batter.name} up` : 'At-bat in progress';
    const count = `${state.balls}-${state.strikes}, ${state.outs} out${state.outs === 1 ? '' : 's'}`;
    return `${batter}. ${count}. ${bases ? `Traffic on ${bases}.` : 'Bases clear.'} ${isTied ? 'One clean swing changes the whole inning.' : `${trailer?.abbreviation ?? 'The trailing side'} needs contact before the inning gets away.`}`;
  }

  if (game.sport === Sport.NBA || game.sport === Sport.NCAAB) {
    return isTied
      ? 'The next two trips are the swing point: get a clean look, avoid the live-ball turnover, then force a half-court shot.'
      : `${trailer?.abbreviation ?? 'The trailer'} needs a stop-and-score burst before ${leader?.abbreviation ?? 'the leader'} turns this into a possession-control game.`;
  }

  if (game.sport === Sport.NFL || game.sport === Sport.NCAAF) {
    return isTied
      ? 'Field position is the hidden scoreboard now. The next drive decides who gets to play downhill.'
      : `${trailer?.abbreviation ?? 'The trailer'} needs a drive that steals time and points; ${leader?.abbreviation ?? 'the leader'} wants a long, clean answer.`;
  }

  if (game.sport === Sport.NHL) {
    return isTied
      ? 'Watch the next clean entry and special-teams chance. One mistake at the blue line can become the whole game.'
      : `${trailer?.abbreviation ?? 'The trailer'} needs zone time, not just shots. ${scoreDiff} ${unit} is still reachable if they tilt the ice now.`;
  }

  if (game.sport === Sport.IPL) {
    return isTied
      ? 'The next over has to create separation. Dot balls and boundaries are the whole mood of this match right now.'
      : `${trailer?.abbreviation ?? 'The chasing side'} needs a clean over soon; ${leader?.abbreviation ?? 'the leader'} is trying to make the required rate bite.`;
  }

  if (game.sport === Sport.TENNIS) {
    return isTied
      ? 'The next service game is the pressure room. First serves and return depth decide who feels the match tighten.'
      : `${trailer?.abbreviation ?? 'The trailing player'} needs a break window soon; ${leader?.abbreviation ?? 'the leader'} is trying to keep every point on serve.`;
  }

  if (game.sport === Sport.MLS || game.sport === Sport.EPL || game.sport === Sport.UCL) {
    return isTied
      ? 'Set pieces, turnovers in midfield, and the next transition chance are where this one opens up.'
      : `${trailer?.abbreviation ?? 'The trailing side'} has to commit numbers forward without giving ${leader?.abbreviation ?? 'the leader'} the counter.`;
  }

  return isTied
    ? 'The next clean sequence breaks the tie. Watch who controls tempo before the scoreboard moves.'
    : `${trailer?.abbreviation ?? 'The trailer'} needs the next response. ${scoreDiff} ${unit} is the gap, but the momentum window is smaller than the score.`;
}

function modelWatchBody(game: GameWithPrediction, leader: GameWithPrediction['homeTeam'] | null, isTied: boolean): string {
  const pred = game.prediction;
  if (!pred) {
    return 'No model read is attached to this game yet, so the live board is staying with verified scoreboard state only.';
  }

  const predictedOutcome = pred.predictedOutcome ?? pred.predictedWinner;
  const predictedTeam = predictedOutcome === 'draw' ? null : predictedOutcome === 'home' ? game.homeTeam : game.awayTeam;
  const conf = Math.round(displayConfidence(pred.confidence ?? 50));
  const tier = getConfidenceTier(conf, pred.isTossUp).label;

  if (predictedOutcome === 'draw') {
    return isTied
      ? `The model expected a draw-type fight, and the scoreboard is still matching that read. Watch for the first side that can hold pressure for more than one sequence.`
      : `The model leaned draw before kickoff, but ${leader?.abbreviation ?? 'one side'} has broken that script. The next response tells us whether this becomes a true swing.`;
  }

  if (isTied) {
    return `${predictedTeam?.abbreviation ?? 'The model side'} was the ${tier} at ${conf}%. The read is still waiting for separation, so the next score matters more than the current tie.`;
  }

  if (leader && predictedTeam && leader.abbreviation === predictedTeam.abbreviation) {
    return `${predictedTeam.abbreviation} was the ${tier} at ${conf}%, and the live score is backing the pregame read. Keep an eye on whether they control the next pressure moment too.`;
  }

  return `${predictedTeam?.abbreviation ?? 'The model side'} was the ${tier} at ${conf}%, but ${leader?.abbreviation ?? 'the opponent'} is pushing against it. This is where the model read gets stress-tested.`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function runtimeAlertIntel(game: GameWithPrediction): LiveIntelItem[] {
  const source = game as unknown as Record<string, unknown>;
  const alertKeys = ['alerts', 'liveAlerts', 'gameAlerts', 'eventAlerts', 'injuryAlerts', 'ejectionAlerts'];
  const rawItems: unknown[] = [];

  for (const key of alertKeys) {
    const value = source[key];
    if (Array.isArray(value)) rawItems.push(...value);
  }

  const items: LiveIntelItem[] = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const searchable = [
      raw.type,
      raw.event,
      raw.status,
      raw.title,
      raw.headline,
      raw.description,
      raw.body,
      raw.message,
    ].map(v => stringValue(v) ?? '').join(' ').toLowerCase();

    const isInjury = searchable.includes('injury') || searchable.includes('availability');
    const isEjection = searchable.includes('ejection') || searchable.includes('red card') || searchable.includes('sent off');
    if (!isInjury && !isEjection) continue;

    const player = stringValue(raw.playerName) ?? stringValue(raw.player);
    const team = stringValue(raw.teamAbbreviation) ?? stringValue(raw.team);
    const status = stringValue(raw.status);
    const reason = stringValue(raw.reason) ?? stringValue(raw.injuryDescription);
    const providedBody = stringValue(raw.body) ?? stringValue(raw.description) ?? stringValue(raw.message);
    const fallbackBody = [player, team, status, reason].filter(Boolean).join(' · ');
    const body = providedBody ?? fallbackBody;
    if (!body) continue;

    items.push({
      type: 'alert',
      title: isEjection ? 'Ejection Alert' : 'Injury Alert',
      body,
    });
  }

  return items.slice(0, 2);
}

function generateLiveIntel(game: GameWithPrediction | null): LiveIntelItem[] {
  if (!game) return [];
  const pred = game.prediction;
  const homeScore = game.homeScore ?? 0;
  const awayScore = game.awayScore ?? 0;
  const scoreDiff = Math.abs(homeScore - awayScore);
  const isTied = homeScore === awayScore;
  const leader = homeScore > awayScore ? game.homeTeam : homeScore < awayScore ? game.awayTeam : null;
  const trailer = homeScore > awayScore ? game.awayTeam : homeScore < awayScore ? game.homeTeam : null;
  const unit = scoreUnit(game.sport, scoreDiff);
  const moment = liveMomentLabel(game);
  const scoreText = `${game.awayTeam.abbreviation} ${awayScore}, ${game.homeTeam.abbreviation} ${homeScore}`;
  const predictedOutcome = pred?.predictedOutcome ?? pred?.predictedWinner;
  const predictedTeam = predictedOutcome === 'draw' ? null : predictedOutcome === 'home' ? game.homeTeam : predictedOutcome === 'away' ? game.awayTeam : null;
  const isUpset = !!leader && !!pred && (predictedOutcome === 'draw' || (!!predictedTeam && leader.abbreviation !== predictedTeam.abbreviation));
  const intel: LiveIntelItem[] = [
    {
      type: 'pulse',
      title: 'Game Pulse',
      body: isTied
        ? `${moment}: all square at ${scoreText}. Nobody owns this yet, so every clean sequence feels louder.`
        : `${moment}: ${leader?.abbreviation ?? 'The leader'} is up by ${scoreDiff} ${unit}, ${scoreText}. ${trailer?.abbreviation ?? 'The trailer'} is chasing the next momentum window.`,
    },
    {
      type: 'trend',
      title: 'Pressure Point',
      body: pressurePointBody(game, leader, trailer, scoreDiff, isTied),
    },
    {
      type: 'shift',
      title: 'Model Watch',
      body: modelWatchBody(game, leader, isTied),
    },
  ];

  if (isUpset && leader && pred) {
    const expected = predictedOutcome === 'draw' ? 'a draw' : predictedTeam?.abbreviation ?? 'the model side';
    const conf = Math.round(displayConfidence(pred.confidence ?? 50));
    intel.push({
      type: 'alert',
      title: 'Upset Watch',
      body: `${leader.abbreviation} is currently breaking the pregame script. The model expected ${expected}${predictedOutcome === 'draw' ? '' : ` at ${conf}%`}, so the next response decides whether this is a live scare or a real flip.`,
    });
  }

  intel.push(...runtimeAlertIntel(game));
  return intel;
}

// ─── INTEL CARD ───
const IntelCard = memo(function IntelCard({ type, title, body }: LiveIntelItem) {
  const [expanded, setExpanded] = useState(false);
  const isLong = body.length > 140;
  const displayBody = expanded || !isLong ? body : body.substring(0, 140) + '...';
  const bc = type === 'pulse' ? '#8B0A1F' : type === 'alert' ? LIVE_RED : type === 'shift' ? TEAL_DARK : SILVER;
  const bl = type === 'pulse' ? 'PULSE' : type === 'alert' ? 'ALERT' : type === 'shift' ? 'SHIFT' : 'TREND';
  return (
    <Pressable onPress={() => { if (isLong) setExpanded(!expanded); }} style={{ marginBottom: 10, borderRadius: 18 }}>
      <LinearGradient
        colors={[hexWithAlpha(bc, 0.56), 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.03)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, padding: 1.2 }}
      >
        <View style={{ backgroundColor: 'rgba(5,6,12,0.94)', borderRadius: 16.8, padding: 14, paddingLeft: 16, overflow: 'hidden' }}>
          <LinearGradient
            colors={[hexWithAlpha(bc, 0.17), 'rgba(5,6,12,0)', 'rgba(122,157,184,0.05)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[hexWithAlpha(bc, 0.12), 'rgba(5,6,12,0)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44 }}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(5,6,12,0)', hexWithAlpha(bc, 0.08)]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 52 }}
          />
          <View style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 4, backgroundColor: bc, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: hexWithAlpha(bc, 0.18), alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: hexWithAlpha(bc, 0.28) }}>
                <Zap size={12} color={bc} fill={hexWithAlpha(bc, 0.28)} />
              </View>
              <View style={{ backgroundColor: hexWithAlpha(bc, 0.18), borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Text style={{ fontSize: 8, fontWeight: '900', color: bc, letterSpacing: 1 }}>{bl}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 8, color: 'rgba(255,255,255,0.32)', fontWeight: '800', letterSpacing: 1.4 }}>LIVE INTEL</Text>
          </View>
          <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE, marginBottom: 6 }}>{title}</Text>
          <Text style={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 18.5 }}>{displayBody}</Text>
          {isLong && !expanded ? <Text style={{ fontSize: 11, color: bc, fontWeight: '800', marginTop: 8 }}>Tap to read more</Text> : null}
        </View>
      </LinearGradient>
    </Pressable>
  );
});

const LiveIntelStage = memo(function LiveIntelStage({ game, intel }: { game: GameWithPrediction | null; intel: LiveIntelItem[] }) {
  if (!game || intel.length === 0) return null;
  const moment = liveMomentLabel(game);
  return (
    <View style={{ paddingHorizontal: 20, marginTop: 24, marginBottom: 30 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
        <View style={{ flex: 1, paddingRight: 14 }}>
          <Text style={{ fontSize: 9, fontWeight: '900', color: LIVE_RED, letterSpacing: 2.4, marginBottom: 6 }}>INSIDE THIS GAME</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', color: WHITE }}>Live intelligence</Text>
          <Text style={{ fontSize: 11, fontWeight: '700', color: TEXT_MUTED, marginTop: 5 }} numberOfLines={1}>
            {game.awayTeam.abbreviation} at {game.homeTeam.abbreviation} · {moment}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.20)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED }} />
            <Text style={{ color: LIVE_RED, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 }}>TRACKING</Text>
          </View>
        </View>
      </View>
      <LinearGradient
        colors={['rgba(122,157,184,0.00)', 'rgba(122,157,184,0.22)', 'rgba(139,10,31,0.20)', 'rgba(122,157,184,0.00)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ height: 1, marginBottom: 14 }}
      />
      {intel.map((item, i) => (
        <IntelCard key={`${game.id}-${item.title}-${i}`} type={item.type} title={item.title} body={item.body} />
      ))}
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
  const mTier = p.isTossUp || conf < 53 ? 'Toss-Up' : conf < 60 ? 'Solid Pick' : conf < 72 ? 'Strong Pick' : 'Prime Pick';
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
    sport === 'IPL' ? 'at the crease' :
    sport === 'TENNIS' ? 'on court' :
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
    } else if (overUnder && overUnder >= (sport === 'NBA' ? 230 : sport === 'NFL' ? 50 : sport === 'MLB' ? 9 : sport === 'NHL' ? 6.5 : sport === 'IPL' ? 330 : sport === 'TENNIS' ? 2.5 : 3.5)) {
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

  useEffect(() => {
    if (focusedIdx >= filteredLive.length) setFocusedIdx(0);
  }, [focusedIdx, filteredLive.length]);

  const onLiveScroll = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + 12));
    if (idx >= 0 && idx < filteredLive.length && idx !== focusedIdx) setFocusedIdx(idx);
  }, [filteredLive.length, focusedIdx]);

  // No live games
  if (!live.length) return (
    <Animated.ScrollView onScroll={sh} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:120}} refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}>
      <ArenaHeader title="Game Day" subtitle="Your followed slate, live board, and upcoming games in one place." accent={TEAL} right={<ArenaMetaPill value="STANDBY" color={TEAL} />} />
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
      <ArenaHeader title="Game Day" subtitle="Follow the games you care about, then tap into the live read as the action moves." accent={LIVE_RED} right={<PulsingLiveBadge />} />

      {/* 2. Your Games */}
      <YourGames games={followed} />

      {/* 3. Live board search */}
      <View style={{paddingHorizontal:20,marginTop:28,marginBottom:12}}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <Text style={{fontSize:16,fontWeight:'800',color:WHITE}}>Live board</Text>
          <Text style={{fontSize:10,color:TEXT_MUTED}}>Swipe to focus</Text>
        </View>
        {live.length > 0 ? (
          <View style={{flexDirection:'row',alignItems:'center',backgroundColor:'rgba(255,255,255,0.04)',borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.08)',paddingHorizontal:12,paddingVertical:8,gap:8}}>
            <Search size={14} color={TEXT_MUTED} />
            <TextInput
              value={liveSearch}
              onChangeText={setLiveSearch}
              placeholder="Search live games..."
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
      <LiveIntelStage game={focusedGame} intel={focusedIntel} />

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
      <ArenaHeader title="Prep Mode" subtitle="Rank tonight, spot pivots, and build a cleaner pregame board." accent={MAROON} right={<ArenaMetaPill label="TODAY" value={`${sched.length} GAMES`} color={MAROON} />} />

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
      <ArenaHeader title="Review" subtitle="Review the calls, the misses, and what the model caught after final scores." accent={SILVER} right={<ArenaMetaPill label="REVIEW" value={ds.toUpperCase()} color={TEAL} />} />
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
        {fg.slice(0,3).map(g=>{const p=g.prediction;if(!p) return null;const ok=(p.predictedWinner==='home'&&(g.homeScore??0)>(g.awayScore??0))||(p.predictedWinner==='away'&&(g.awayScore??0)>(g.homeScore??0));return <View key={g.id} style={{marginBottom:10,paddingLeft:12,borderLeftWidth:3,borderLeftColor:ok?TEAL:LOSS}}><Text style={{fontSize:11,fontWeight:'600',color:WHITE,marginBottom:2}}>{g.awayTeam.abbreviation} vs {g.homeTeam.abbreviation}</Text><Text style={{fontSize:11,color:TEXT_SECONDARY,lineHeight:16.5}}>{(() => { const tl = p.isTossUp || p.confidence < 53 ? 'a Toss-Up' : p.confidence < 60 ? 'a Solid Pick' : p.confidence < 72 ? 'a Strong Pick' : 'a Prime Pick'; const tm = p.predictedWinner==='home'?g.homeTeam.abbreviation:g.awayTeam.abbreviation; return ok ? `Model correctly predicted ${tm} as ${tl}.` : `Model missed — rated ${tm} as ${tl} but the upset came through.`; })()}</Text></View>;})}
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
      <ArenaHeader title="Game Day" subtitle="Your followed games and today’s board in one place." accent={TEAL} right={<ArenaMetaPill value={live.length > 0 ? 'LIVE' : 'TODAY'} color={live.length > 0 ? LIVE_RED : TEAL} />} />

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
  const router = useRouter();
  const {data:allGames,isLoading,refetch} = useGames();
  const {data:userPicks} = useUserPicks();
  const {data:userStats} = useUserStats();
  const {data:teamFollows} = useTeamFollows();
  const { isPremium } = useSubscription();
  const sh = useHideOnScroll();
  const [sf,setSf] = useState('All');
  const { refreshing: isR, onRefresh: onR } = useSmoothRefresh(refetch);
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
  const sx = useSharedValue(0);
  const pg = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onStart(()=>{sx.value=mtx.value;})
    .onUpdate(e=>{mtx.value=Math.max(0,Math.min(2,sx.value-(e.translationX/SW)*1.5));})
    .onEnd(e=>{let t=Math.round(mtx.value);if(Math.abs(e.velocityX)>500) t=e.velocityX<0?Math.ceil(mtx.value):Math.floor(mtx.value);t=Math.max(0,Math.min(2,t));mtx.value=withSpring(t,SPRING);runOnJS(setAm)(t);});
  const cs = useAnimatedStyle(()=>({transform:[{translateX:-mtx.value*SW}]}));

  if (isLoading) return <View style={{flex:1,backgroundColor:BG,alignItems:'center',justifyContent:'center'}}><ActivityIndicator size="large" color={TEAL} /></View>;

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
