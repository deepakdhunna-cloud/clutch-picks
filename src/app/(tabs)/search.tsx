import React, { useState, useMemo, useCallback, useEffect, useDeferredValue, memo, useRef } from 'react';
import {
  View, Text, Pressable, Dimensions, ActivityIndicator, RefreshControl, ScrollView, TextInput, StyleSheet, Platform, InteractionManager,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withRepeat, Easing, cancelAnimation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import PagerView from 'react-native-pager-view';
import Svg, { Circle, Defs, G, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Search, ChevronRight, Plus, Zap, Lock } from 'lucide-react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useSubscription } from '@/lib/subscription-context';
import * as Haptics from 'expo-haptics';

import { useGames, usePrefetchGame } from '@/hooks/useGames';
import { useSmoothRefresh } from '@/hooks/useSmoothRefresh';
import { useUserPicks, useUserStats, type Pick as UserPick, type UserStats } from '@/hooks/usePicks';
import { useTeamFollows } from '@/hooks/useTeamFollows';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { GameWithPrediction, GameStatus, Sport } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { displayConfidence, displaySport, formatGameTime, getConfidenceTier } from '@/lib/display-confidence';
import { isSuspendedGame, suspendedLabel, suspendedReasonText, suspendedResumeText } from '@/lib/game-status';
import { generateTonightNarrative } from '@/lib/tonight-narrative';
import { cricketLedScoreText, cricketOversText, cricketPlayersCompactText, cricketRequiredText, cricketRoleText, teamScoreText } from '@/lib/cricket-score';
import {
  getCanonicalConfidence,
  getCanonicalFinalPick,
  getCanonicalWinProbabilities,
} from '@/lib/canonical-result';
import { getGamePredictionDisplay } from '@/lib/prediction-display';
import { pruneFollowedGamesForReset, readFollowedGameIds } from '@/lib/followed-games';
import { claimGameNavigation } from '@/lib/game-navigation-guard';
import {
  GLASS_BOTTOM_NAV_FADE_HEIGHT,
  GLASS_BOTTOM_NAV_HEIGHT,
  GLASS_BOTTOM_NAV_MIN_BOTTOM_PADDING,
  GLASS_BOTTOM_NAV_SCROLL_PADDING,
} from '@/components/GlassBottomNav';
import {
  MAROON, TEAL, TEAL_DIM, TEAL_DARK, LIVE_RED, LOSS, SILVER,
  BG, PANEL_DARK, BORDER_MED, WHITE,
  TEXT_SECONDARY, TEXT_MUTED,
} from '@/lib/theme';
import { TeamJersey } from '@/components/sports/TeamJersey';
import { ArenaScoreboard as SharedArenaScoreboard } from '@/components/sports/ArenaScoreboard';

// ─── COLORS ───
const ERROR_DIM = 'rgba(239,68,68,0.10)';

const { width: SW } = Dimensions.get('window');
const SPORTS = ['All', 'NBA', 'NFL', 'MLB', 'NHL', 'IPL', 'TENNIS', 'NCAAF', 'NCAAB', 'MLS', 'EPL', 'UCL'] as const;
const ALWAYS_VISIBLE_SPORT_FILTERS = new Set<string>(['IPL', 'TENNIS']);
const SPORT_DISPLAY: Record<string, string> = { NCAAF: 'CFB', NCAAB: 'CBB', TENNIS: 'Tennis' };
const ARENA_SIDE_PADDING = 20;
const ARENA_SECTION_GAP = 28;
const ARENA_CARD_GAP = 18;
const MODE_SEGMENT_GAP = 8;
const MODES = ['Game Day', 'Prep Mode', 'Review'] as const;
const TC = [TEAL, LIVE_RED, MAROON] as const;
type LiveIntelType = 'alert' | 'shift' | 'trend' | 'pulse';
type LiveIntelItem = { type: LiveIntelType; title: string; body: string };
type ArenaHorizontalGestureGuard = {
  onHorizontalGestureStart?: () => void;
  onHorizontalGestureEnd?: () => void;
};

function getArenaBottomPadding(bottomInset: number) {
  return GLASS_BOTTOM_NAV_HEIGHT
    + GLASS_BOTTOM_NAV_FADE_HEIGHT
    + Math.max(bottomInset, GLASS_BOTTOM_NAV_MIN_BOTTOM_PADDING)
    + GLASS_BOTTOM_NAV_SCROLL_PADDING;
}

function fireLightHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function fireSelectionHaptic() {
  void Haptics.selectionAsync().catch(() => {});
}

function useGameDetailActions() {
  const router = useRouter();
  const prefetchGame = usePrefetchGame();

  const warmGame = useCallback((game: GameWithPrediction) => {
    prefetchGame(game.id, game);
  }, [prefetchGame]);

  const openGame = useCallback((game: GameWithPrediction) => {
    if (!claimGameNavigation(game.id)) return;
    warmGame(game);
    router.push({ pathname: '/game/[id]', params: { id: game.id } });
    fireLightHaptic();
  }, [router, warmGame]);

  return { openGame, warmGame };
}

// ─── DISCLAIMER ───
const Disclaimer = memo(function Disclaimer() {
  return <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.08)', textAlign: 'center', lineHeight: 14, marginTop: 10, paddingHorizontal: ARENA_SIDE_PADDING, marginBottom: 32 }}>AI predictions are for entertainment purposes only. Not financial advice.</Text>;
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
        marginHorizontal: ARENA_SIDE_PADDING,
        marginTop: 2,
        marginBottom: ARENA_SECTION_GAP,
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(180,211,235,0.12)',
        backgroundColor: '#05080d',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.24,
        shadowRadius: 20,
        elevation: 7,
      }}
    >
      <LinearGradient
        colors={['rgba(13,20,29,0.98)', 'rgba(5,8,13,0.99)', 'rgba(3,5,9,1)']}
        locations={[0, 0.62, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 16, minHeight: 116, justifyContent: 'center' }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 16,
            bottom: 16,
            width: 3,
            borderTopRightRadius: 3,
            borderBottomRightRadius: 3,
            backgroundColor: hexWithAlpha(accent, 0.78),
            shadowColor: accent,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
          }}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[hexWithAlpha(accent, 0.12), 'rgba(255,255,255,0)', 'rgba(255,255,255,0.035)']}
          locations={[0, 0.58, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 0, paddingRight: right ? 14 : 0 }}>
            <Text adjustsFontSizeToFit minimumFontScale={0.82} style={{ fontSize: 24, fontWeight: '900', color: WHITE, lineHeight: 29, letterSpacing: 0 }} numberOfLines={1}>{title}</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: 'rgba(224,234,240,0.62)', lineHeight: 18, marginTop: 7, maxWidth: 320 }} numberOfLines={2}>{subtitle}</Text>
          </View>
          {right ? <View style={{ paddingTop: 1, alignItems: 'flex-end', flexShrink: 0, maxWidth: 116 }}>{right}</View> : null}
        </View>
      </LinearGradient>
    </View>
  );
});

// ─── SEARCH BAR ───
const searchBarOuter = {
  paddingHorizontal: ARENA_SIDE_PADDING,
  paddingTop: 28,
  marginBottom: 18,
} as const;
const searchBarInner = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  backgroundColor: 'rgba(5,8,13,0.96)',
  borderWidth: 1,
  borderColor: 'rgba(180,211,235,0.16)',
  borderRadius: 18,
  paddingVertical: 13,
  paddingHorizontal: 14,
} as const;
const SearchBar = memo(function SearchBar() {
  const router = useRouter();
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(),
    []
  );
  return (
    <View style={searchBarOuter}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 9, fontWeight: '900', color: 'rgba(180,211,235,0.54)', letterSpacing: 2.2, marginBottom: 5 }}>
            Clutch Picks
          </Text>
          <Text adjustsFontSizeToFit minimumFontScale={0.86} numberOfLines={1} style={{ color: WHITE, fontSize: 30, lineHeight: 34, fontWeight: '900', letterSpacing: 0 }}>
            My Arena
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', paddingBottom: 2 }}>
          <View style={{ borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: 'rgba(122,157,184,0.10)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.18)' }}>
            <Text style={{ color: TEAL, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 }}>{dateLabel}</Text>
          </View>
        </View>
      </View>
      <Pressable
        onPress={() => {
          fireLightHaptic();
          router.push('/search-explore');
        }}
        style={({ pressed }) => ({
          opacity: pressed ? 0.86 : 1,
          transform: [{ scale: pressed ? 0.995 : 1 }],
        })}
      >
        <LinearGradient
          colors={['rgba(180,211,235,0.24)', 'rgba(122,157,184,0.10)', 'rgba(139,10,31,0.16)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 19, padding: 1 }}
        >
          <View style={searchBarInner}>
            <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(122,157,184,0.11)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.18)', alignItems: 'center', justifyContent: 'center' }}>
              <Search size={17} color={TEAL} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
              <Text style={{ fontSize: 13.5, color: 'rgba(248,250,252,0.92)', fontWeight: '800' }}>
                Search the slate
              </Text>
              <Text style={{ fontSize: 10.5, color: 'rgba(180,211,235,0.46)', fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
                Games, teams, sports, and live matchups
              </Text>
            </View>
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
});

// ─── SPORT PILLS ───
const SportPills = memo(function SportPills({
  selected,
  onSelect,
  available,
  counts,
  compact = false,
  alwaysShowSpecialSports = true,
  sidePadding = ARENA_SIDE_PADDING,
  bottomMargin = 24,
  onHorizontalGestureStart,
  onHorizontalGestureEnd,
}: {
  selected: string;
  onSelect: (s: string) => void;
  available?: Set<string>;
  counts?: Map<string, number>;
  compact?: boolean;
  alwaysShowSpecialSports?: boolean;
  sidePadding?: number;
  bottomMargin?: number;
} & ArenaHorizontalGestureGuard) {
  // Hide chips for sports with zero games on the current slate so users
  // don't dead-end into empty filters (e.g. CFB during the off-season).
  // 'All' always stays. When `available` is undefined (loading or no data),
  // show the full set rather than blanking out.
  const visible = useMemo(
    () => available
      ? SPORTS.filter(s => s === 'All' || available.has(s) || (alwaysShowSpecialSports && ALWAYS_VISIBLE_SPORT_FILTERS.has(s)))
      : SPORTS,
    [alwaysShowSpecialSports, available]
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, marginBottom: bottomMargin }}
      contentContainerStyle={{ paddingLeft: sidePadding, paddingRight: sidePadding, paddingVertical: 2, flexDirection: 'row', alignItems: 'center' }}
      onTouchStart={onHorizontalGestureStart}
      onTouchEnd={onHorizontalGestureEnd}
      onTouchCancel={onHorizontalGestureEnd}
      onScrollBeginDrag={onHorizontalGestureStart}
      onScrollEndDrag={onHorizontalGestureEnd}
      onMomentumScrollBegin={onHorizontalGestureStart}
      onMomentumScrollEnd={onHorizontalGestureEnd}
    >
      {visible.map((s, index) => {
        const on = selected === s;
        const count = counts?.get(s);
        const label = count !== undefined && counts ? `${SPORT_DISPLAY[s] ?? s} ${count}` : (SPORT_DISPLAY[s] ?? s);
        return (
          <Pressable
            key={s}
            onPress={() => { if (!on) fireSelectionHaptic(); onSelect(s); }}
            style={{
              marginRight: index === visible.length - 1 ? 0 : 12,
            }}
          >
            <LinearGradient
              colors={on
                ? [hexWithAlpha(MAROON, 0.58), 'rgba(180,211,235,0.18)', hexWithAlpha(MAROON, 0.28)]
                : ['rgba(122,157,184,0.16)', 'rgba(122,157,184,0.05)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 22,
                height: compact ? 38 : 44,
                minWidth: compact ? (s === 'All' ? 58 : s === 'TENNIS' ? 92 : 72) : (s === 'All' ? 56 : s === 'TENNIS' ? 98 : 78),
                padding: 1,
              }}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: 21,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? 'rgba(7,10,16,0.52)' : 'rgba(7,10,16,0.88)',
                  paddingHorizontal: compact ? 14 : 18,
                }}
              >
                <Text numberOfLines={1} style={{ fontSize: compact ? 12 : 13, lineHeight: compact ? 15 : 16, fontWeight: on ? '800' : '600', color: on ? WHITE : TEAL, letterSpacing: on ? 0 : 0.4, includeFontPadding: false }}>{label}</Text>
              </View>
            </LinearGradient>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

// ─── SEGMENTED PILL ───
const SegPill = memo(function SegPill({ active, onChange }: { active: number; onChange: (n: number) => void; hasLive: boolean }) {
  return (
    <View style={{ paddingHorizontal: ARENA_SIDE_PADDING, marginBottom: ARENA_SECTION_GAP }}>
      <LinearGradient
        colors={['rgba(122,157,184,0.18)', 'rgba(255,255,255,0.055)', 'rgba(139,10,31,0.16)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 22, padding: 1 }}
      >
        <View style={{ minHeight: 58, backgroundColor: 'rgba(5,8,13,0.78)', borderRadius: 21, padding: 5, flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden' }}>
          {MODES.map((l, i) => {
            const isActive = active === i;
            return (
              <Pressable
                key={l}
                onPress={() => onChange(i)}
                style={{
                  flex: 1,
                  marginRight: i === MODES.length - 1 ? 0 : MODE_SEGMENT_GAP,
                  minWidth: 0,
                }}
              >
                <LinearGradient
                  colors={isActive
                    ? [hexWithAlpha(MAROON, 0.52), 'rgba(180,211,235,0.14)', hexWithAlpha(MAROON, 0.30)]
                    : ['rgba(122,157,184,0.11)', 'rgba(122,157,184,0.035)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ minHeight: 48, borderRadius: 16, padding: 1 }}
                >
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 15,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      overflow: 'hidden',
                      backgroundColor: isActive ? 'rgba(7,10,16,0.48)' : 'rgba(7,10,16,0.70)',
                      paddingHorizontal: 8,
                    }}
                  >
                    <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, lineHeight: 16, fontWeight: isActive ? '900' : '800', color: isActive ? WHITE : 'rgba(180,211,235,0.72)', letterSpacing: 0, includeFontPadding: false }}>
                      {l}
                    </Text>
                  </View>
                </LinearGradient>
              </Pressable>
            );
          })}
        </View>
      </LinearGradient>
    </View>
  );
});

const ArenaChrome = memo(function ArenaChrome({
  selected,
  onSelect,
  available,
  showModes,
  active,
  onChange,
  hasLive,
  onHorizontalGestureStart,
  onHorizontalGestureEnd,
}: {
  selected: string;
  onSelect: (s: string) => void;
  available?: Set<string>;
  showModes?: boolean;
  active: number;
  onChange: (n: number) => void;
  hasLive: boolean;
} & ArenaHorizontalGestureGuard) {
  return (
    <>
      <SearchBar />
      <SportPills
        selected={selected}
        onSelect={onSelect}
        available={available}
        onHorizontalGestureStart={onHorizontalGestureStart}
        onHorizontalGestureEnd={onHorizontalGestureEnd}
      />
      {showModes ? <SegPill active={active} onChange={onChange} hasLive={hasLive} /> : null}
    </>
  );
});

const ArenaLoadingWarmup = memo(function ArenaLoadingWarmup() {
  return (
    <View style={{ paddingHorizontal: ARENA_SIDE_PADDING, paddingTop: 8, paddingBottom: 80, gap: 14 }}>
      {[0, 1, 2].map((item) => (
        <View
          key={item}
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: 'rgba(180,211,235,0.08)',
            backgroundColor: item === 0 ? 'rgba(122,157,184,0.055)' : 'rgba(255,255,255,0.025)',
            padding: 16,
            minHeight: item === 0 ? 118 : 96,
            overflow: 'hidden',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{ width: 88, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.09)' }} />
            <ActivityIndicator size="small" color={TEAL} />
          </View>
          <View style={{ height: 16, borderRadius: 8, width: item === 0 ? '72%' : '58%', backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 12 }} />
          <View style={{ height: 10, borderRadius: 5, width: '92%', backgroundColor: 'rgba(255,255,255,0.045)', marginBottom: 8 }} />
          <View style={{ height: 10, borderRadius: 5, width: item === 2 ? '64%' : '78%', backgroundColor: 'rgba(255,255,255,0.035)' }} />
        </View>
      ))}
    </View>
  );
});

const ArenaScrollView = memo(function ArenaScrollView({
  sh,
  onR,
  isR,
  bottomPadding,
  children,
}: {
  sh: any;
  onR: () => void;
  isR: boolean;
  bottomPadding: number;
  children: React.ReactNode;
}) {
  return (
    <Animated.ScrollView
      onScroll={sh}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      scrollIndicatorInsets={{ bottom: bottomPadding }}
      refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}
    >
      {children}
    </Animated.ScrollView>
  );
});

type FinalTeamResult = 'winner' | 'loser' | 'neutral';
const FOLLOWED_CARD_W = Math.min(326, Math.max(280, SW - 64));

const FollowedCard = memo(function FollowedCard({ game }: { game: GameWithPrediction }) {
  const { openGame, warmGame } = useGameDetailActions();
  const live = game.status === GameStatus.LIVE || (game.status as string) === 'in_progress' || (game.status as string) === 'halftime';
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
  const resultAccent = winningColors?.accent ?? SILVER;
  const prediction = game.prediction;
  const predictionDisplay = prediction ? getGamePredictionDisplay(game) : null;
  const tier = prediction ? getConfidenceTier(getCanonicalConfidence(prediction), predictionDisplay?.isTossUp) : null;
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
  useEffect(() => { if (live) { dotOp.value = withRepeat(withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true); } return () => cancelAnimation(dotOp); }, [dotOp, live]);
  const ds = useAnimatedStyle(() => ({ opacity: dotOp.value }));
  const statusText = live ? 'LIVE' : final ? 'FINAL' : centerLabel.toUpperCase();
  const statusColor = live ? LIVE_RED : final ? resultAccent : TEAL;

  const renderTeam = (
    team: GameWithPrediction['homeTeam'],
    colors: ReturnType<typeof getTeamColors>,
    score: number | null,
    side: 'home' | 'away',
    result: FinalTeamResult = 'neutral',
  ) => {
    const scoreLabel = game.sport === Sport.IPL && (live || final) ? teamScoreText(game, side) : score ?? 0;
    const accent = colors.accent;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', opacity: result === 'loser' ? 0.58 : 1 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: result === 'winner' ? hexWithAlpha(accent, 0.22) : hexWithAlpha(accent, 0.1),
            borderWidth: 1,
            borderColor: result === 'winner' ? 'rgba(255,255,255,0.26)' : hexWithAlpha(accent, 0.2),
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
            <View style={{ position: 'absolute', right: -4, bottom: -4, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: hexWithAlpha(accent, 0.72) }}>
              <Text style={{ color: '#040608', fontSize: 8, fontWeight: '900' }}>W</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
          <Text style={{ color: result === 'winner' ? '#FFFFFF' : WHITE, fontSize: 14, fontWeight: '900', letterSpacing: 0 }} numberOfLines={1}>
            {team.abbreviation}
          </Text>
          <Text style={{ color: result === 'winner' ? hexWithAlpha(accent, 0.9) : 'rgba(255,255,255,0.48)', fontSize: 9.5, fontWeight: '800', marginTop: 1 }} numberOfLines={1}>
            {team.name}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', minWidth: 38 }}>
          {live || final ? (
            <Text style={{ color: result === 'winner' ? '#FFFFFF' : 'rgba(255,255,255,0.78)', fontSize: 24, lineHeight: 25, fontWeight: '900', fontFamily: 'VT323_400Regular', letterSpacing: 1, textAlign: 'right' }}>
              {scoreLabel}
            </Text>
          ) : (
            <Text style={{ color: TEXT_MUTED, fontSize: 10, fontWeight: '800' }} numberOfLines={1}>
              {team.record || '--'}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <Pressable
      onPressIn={() => warmGame(game)}
      onPress={() => openGame(game)}
      style={{
        width: FOLLOWED_CARD_W,
        borderRadius: 30,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: live ? 'rgba(255,84,84,0.3)' : winningTeam ? hexWithAlpha(resultAccent, 0.27) : 'rgba(180,211,235,0.16)',
        backgroundColor: '#0a1018',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.26,
        shadowRadius: 20,
        elevation: 6,
      }}
    >
      <View style={{ padding: 12, minHeight: 162, borderRadius: 30, backgroundColor: '#0b1119' }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 15, bottom: 15, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: live ? LIVE_RED : resultAccent }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 9, paddingVertical: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: TEAL, letterSpacing: 1.2 }}>{displaySport(game.sport)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: live ? 'rgba(220,38,38,0.13)' : final ? hexWithAlpha(resultAccent, 0.1) : 'rgba(122,157,184,0.075)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: live ? 'rgba(220,38,38,0.22)' : final ? hexWithAlpha(resultAccent, 0.18) : 'rgba(122,157,184,0.13)', marginLeft: 7 }}>
              {live ? <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED, marginRight: 5 }, ds]} /> : null}
              <Text style={{ fontSize: 9, color: statusColor, fontWeight: '900', letterSpacing: 0.8 }}>{statusText}</Text>
            </View>
          </View>
          <ChevronRight size={16} color="rgba(255,255,255,0.34)" strokeWidth={2.4} />
        </View>

        <View>
          {renderTeam(game.awayTeam, awayColors, awayScore, 'away', awayWon ? 'winner' : homeWon ? 'loser' : 'neutral')}
          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.055)', marginVertical: 8 }} />
          {renderTeam(game.homeTeam, homeColors, homeScore, 'home', homeWon ? 'winner' : awayWon ? 'loser' : 'neutral')}
        </View>

        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.055)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ flex: 1, color: TEXT_SECONDARY, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>
            {finalOutcomeLabel ?? (live ? (formatGameTime(game.sport, game.quarter, game.clock) ?? 'Live read') : `${startLabel} ${startTime}`)}
          </Text>
          {prediction && !final ? (
            <View style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: `${tier?.color ?? TEAL}14`, borderWidth: 1, borderColor: `${tier?.color ?? TEAL}2A`, marginLeft: 10 }}>
              <Text style={{ color: tier?.color ?? TEAL, fontSize: 9, fontWeight: '900' }}>
                {predictionDisplay?.badgeLabel ?? 'PICK'} {Math.round(getCanonicalConfidence(prediction))}%
              </Text>
            </View>
          ) : (
            <Text style={{ color: final ? resultAccent : TEAL, fontSize: 10, fontWeight: '900', letterSpacing: 0.5, marginLeft: 10 }}>{final ? 'RECAP' : 'OPEN'}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
});

// ─── YOUR GAMES ───
const YourGames = memo(function YourGames({
  games,
  onHorizontalGestureStart,
  onHorizontalGestureEnd,
}: { games: GameWithPrediction[] } & ArenaHorizontalGestureGuard) {
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
    <View style={{ marginHorizontal: 20, marginBottom: ARENA_SECTION_GAP }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
        <View>
          <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2, marginBottom: 4 }}>WATCHLIST</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', color: WHITE, letterSpacing: 0 }}>Tracked Games</Text>
        </View>
      </View>
      <Pressable
        onPress={() => { fireLightHaptic(); router.replace('/(tabs)'); }}
        style={{
          borderRadius: 30,
          overflow: 'hidden',
          backgroundColor: 'rgba(10,15,22,0.98)',
          borderWidth: 1,
          borderColor: 'rgba(122,157,184,0.16)',
        }}
      >
        <View style={{ minHeight: 118, padding: 16, justifyContent: 'space-between', borderRadius: 30, backgroundColor: 'rgba(10,15,22,0.98)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: TEAL }} />
                <Text style={{ color: 'rgba(224,234,240,0.46)', fontSize: 8.5, fontWeight: '900', letterSpacing: 1.8, marginLeft: 7 }}>PRIVATE BOARD</Text>
              </View>
              <Text style={{ color: WHITE, fontSize: 20, fontWeight: '900', letterSpacing: 0 }}>Track your games</Text>
              <Text style={{ color: TEXT_SECONDARY, fontSize: 12.5, lineHeight: 18, marginTop: 5 }}>Add games or teams to keep live scores, starts, and recaps in one focused view.</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <View style={{ width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(122,157,184,0.11)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.2)' }}>
                <Plus size={18} color={TEAL} strokeWidth={2.7} />
              </View>
              <View style={{ backgroundColor: 'rgba(122,157,184,0.09)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(122,157,184,0.16)', marginTop: 9 }}>
                <Text style={{ color: TEAL, fontSize: 9.5, fontWeight: '900', letterSpacing: 1.1 }}>BROWSE SLATE</Text>
              </View>
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
  return (
    <View style={{ marginBottom: ARENA_SECTION_GAP }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginHorizontal: 20, marginBottom: 12 }}>
        <View>
          <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2, marginBottom: 4 }}>WATCHLIST</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: WHITE, letterSpacing: 0 }}>Tracked Games</Text>
            <View style={{ minWidth: 24, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, backgroundColor: 'rgba(122,157,184,0.1)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.16)', marginLeft: 9 }}>
              <Text style={{ fontSize: 10, fontWeight: '900', color: TEAL }}>{orderedGames.length}</Text>
            </View>
          </View>
        </View>
        <Pressable
          onPress={() => { fireLightHaptic(); router.replace('/(tabs)'); }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 999,
            backgroundColor: 'rgba(122,157,184,0.09)',
            borderWidth: 1,
            borderColor: 'rgba(122,157,184,0.18)',
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '900', color: TEAL }}>Browse</Text>
          <View style={{ marginLeft: 5 }}>
            <Plus size={12} color={TEAL} strokeWidth={2.8} />
          </View>
        </Pressable>
      </View>
      <Animated.FlatList
        data={orderedGames}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={FOLLOWED_CARD_W + ARENA_CARD_GAP}
        snapToAlignment="start"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
        ItemSeparatorComponent={() => <View style={{ width: ARENA_CARD_GAP }} />}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FollowedCard game={item} />}
        getItemLayout={(_, index) => ({ length: FOLLOWED_CARD_W + ARENA_CARD_GAP, offset: (FOLLOWED_CARD_W + ARENA_CARD_GAP) * index, index })}
        style={{ flexGrow: 0 }}
        onTouchStart={onHorizontalGestureStart}
        onTouchEnd={onHorizontalGestureEnd}
        onTouchCancel={onHorizontalGestureEnd}
        onScrollBeginDrag={onHorizontalGestureStart}
        onScrollEndDrag={onHorizontalGestureEnd}
        onMomentumScrollBegin={onHorizontalGestureStart}
        onMomentumScrollEnd={onHorizontalGestureEnd}
      />
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
  }, [op, sc]);
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
  '0': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 1, 1], [1, 0, 1, 0, 1], [1, 1, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '1': [[0, 0, 1, 0, 0], [0, 1, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 1, 1, 1, 0]],
  '2': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 1, 0, 0, 0], [1, 1, 1, 1, 1]],
  '3': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 0, 1, 1, 0], [0, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '4': [[0, 0, 0, 1, 0], [0, 0, 1, 1, 0], [0, 1, 0, 1, 0], [1, 0, 0, 1, 0], [1, 1, 1, 1, 1], [0, 0, 0, 1, 0], [0, 0, 0, 1, 0]],
  '5': [[1, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '6': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '7': [[1, 1, 1, 1, 1], [0, 0, 0, 0, 1], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0]],
  '8': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '9': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 1], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '-': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
  '/': [[0, 0, 0, 0, 1], [0, 0, 0, 1, 0], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 1, 0, 0, 0], [0, 1, 0, 0, 0], [1, 0, 0, 0, 0]],
  ' ': [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  'D': [[1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 0]],
  'E': [[1, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 1]],
  'I': [[1, 1, 1], [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0], [1, 1, 1]],
  'N': [[1, 0, 0, 0, 1], [1, 1, 0, 0, 1], [1, 0, 1, 0, 1], [1, 0, 0, 1, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
  'P': [[1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0]],
  'S': [[0, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [1, 1, 1, 1, 0]],
  'U': [[1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
};

const SCORE_FACE_SCALE = 2;
const SCORE_FACE_PITCH = 1.62;
const SCORE_FACE_PAD_X = 6;
const SCORE_FACE_PAD_Y = 5;
const SCORE_FACE_GAP = 2;

function scoreFaceTextWidth(text: string, glyphScale = SCORE_FACE_SCALE): number {
  let cols = 0;
  for (let i = 0; i < text.length; i++) {
    const matrix = SCORE_FACE_MATRIX[text[i]];
    if (!matrix) continue;
    if (cols > 0) cols += SCORE_FACE_GAP;
    cols += matrix[0].length * glyphScale;
  }
  return cols;
}

const ArenaScoreFace = memo(function ArenaScoreFace({ homeScore, awayScore, label }: { homeScore: number; awayScore: number; label?: string }) {
  const text = label ? label.toUpperCase() : `${homeScore}-${awayScore}`;
  const glyphScale = label ? (text.length <= 3 ? SCORE_FACE_SCALE : 1) : SCORE_FACE_SCALE;
  const textCols = scoreFaceTextWidth(text, glyphScale);
  const cols = textCols + 4;
  const rows = 7 * glyphScale + 4;
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
        for (let sy = 0; sy < glyphScale; sy++) {
          for (let sx = 0; sx < glyphScale; sx++) {
            lit.add(`${cursor + col * glyphScale + sx},${row * glyphScale + sy + 2}`);
          }
        }
      }
    }
    cursor += matrix[0].length * glyphScale;
  }

  const litCells = Array.from(lit).map((coord) => {
    const [col, row] = coord.split(',').map(Number);
    return {
      x: SCORE_FACE_PAD_X + col * SCORE_FACE_PITCH + SCORE_FACE_PITCH / 2,
      y: SCORE_FACE_PAD_Y + row * SCORE_FACE_PITCH + SCORE_FACE_PITCH / 2,
    };
  });

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
          <Pattern id="scoreFaceOffPattern" width={SCORE_FACE_PITCH} height={SCORE_FACE_PITCH} patternUnits="userSpaceOnUse">
            <Circle cx={SCORE_FACE_PITCH / 2} cy={SCORE_FACE_PITCH / 2} r={0.82} fill="#010202" opacity={0.96} />
            <Circle cx={SCORE_FACE_PITCH / 2} cy={SCORE_FACE_PITCH / 2} r={0.58} fill="url(#scoreFaceOff)" opacity={0.9} />
            <Circle cx={SCORE_FACE_PITCH / 2 - 0.16} cy={SCORE_FACE_PITCH / 2 - 0.18} r={0.13} fill="#475052" opacity={0.18} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="#020303" />
        <Rect x={1} y={1} width={width - 2} height={height - 2} rx={7} fill="#070909" />
        <Rect
          x={SCORE_FACE_PAD_X}
          y={SCORE_FACE_PAD_Y}
          width={cols * SCORE_FACE_PITCH}
          height={rows * SCORE_FACE_PITCH}
          fill="url(#scoreFaceOffPattern)"
        />
        {litCells.map((cell, index) => (
          <G key={`lit-${index}`}>
            <Circle cx={cell.x} cy={cell.y} r={1.52} fill="#eaf7ff" opacity={0.13} />
            <Circle cx={cell.x} cy={cell.y} r={0.82} fill="#010202" opacity={0.96} />
            <Circle cx={cell.x} cy={cell.y} r={0.58} fill="url(#scoreFaceLit)" />
            <Circle cx={cell.x - 0.18} cy={cell.y - 0.2} r={0.16} fill="#ffffff" opacity={0.72} />
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
  label,
  subLabel,
  detailLabel,
}: {
  awayScore: number;
  homeScore: number;
  awayColor: string;
  homeColor: string;
  label?: string;
  subLabel?: string;
  detailLabel?: string;
}) {
  const hasStatusDetail = Boolean(label && (subLabel || detailLabel));
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
            <ArenaScoreFace awayScore={awayScore} homeScore={homeScore} label={label} />
          </View>
          {hasStatusDetail ? (
            <View style={{ alignItems: 'center', paddingTop: 5, paddingHorizontal: 5, minWidth: 98, maxWidth: 150 }}>
              {subLabel ? (
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  numberOfLines={1}
                  style={{
                    color: '#f8fafc',
                    fontSize: 10,
                    fontWeight: '900',
                    textAlign: 'center',
                  }}
                >
                  {subLabel}
                </Text>
              ) : null}
              {detailLabel ? (
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  numberOfLines={1}
                  style={{
                    color: 'rgba(248,250,252,0.66)',
                    fontSize: 8.5,
                    fontWeight: '800',
                    marginTop: 1,
                    textAlign: 'center',
                  }}
                >
                  {detailLabel}
                </Text>
              ) : null}
            </View>
          ) : null}
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

const LiveCard = memo(function LiveCard({
  game,
  pick,
  cardWidth,
  showModelEdge = true,
}: {
  game: GameWithPrediction;
  pick?: UserPick;
  cardWidth: number;
  showModelEdge?: boolean;
}) {
  const { openGame, warmGame } = useGameDetailActions();
  const hs = game.homeScore ?? 0;
  const as2 = game.awayScore ?? 0;
  const ph = pick?.pickedTeam === 'home';
  const pt = ph ? game.homeTeam : game.awayTeam;
  const ps = ph ? hs : as2;
  const os = ph ? as2 : hs;
  const lead = ps > os;
  const awayColors = getTeamColors(game.awayTeam.abbreviation, game.sport as Sport, game.awayTeam.color);
  const homeColors = getTeamColors(game.homeTeam.abbreviation, game.sport as Sport, game.homeTeam.color);
  const homeAccent = homeColors.accent;
  const awayAccent = awayColors.accent;

  const suspended = isSuspendedGame(game);
  const suspensionTime = suspendedResumeText(game);
  const suspensionReason = suspendedReasonText(game);
  const isCricket = game.sport === Sport.IPL;
  const cricketOvers = !suspended ? cricketOversText(game) : null;
  const cricketRequired = !suspended ? cricketRequiredText(game) : null;
  const cricketCaption = cricketOvers;
  const cricketChaseLine = cricketRequired;
  const cricketPlayerLine = !suspended ? cricketPlayersCompactText(game) : null;
  const matchTime = cricketCaption || cricketChaseLine ? null : formatGameTime(game.sport, game.quarter, game.clock);
  const homeCricketRole = isCricket ? cricketRoleText(game, 'home') : null;
  const awayCricketRole = isCricket ? cricketRoleText(game, 'away') : null;
  const homeScoreLabel = isCricket ? teamScoreText(game, 'home') : null;
  const awayScoreLabel = isCricket ? teamScoreText(game, 'away') : null;
  const cricketLedScore = isCricket && !suspended ? cricketLedScoreText(game) : null;

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

  const livePredictionDisplay = game.prediction ? getGamePredictionDisplay(game) : null;
  const strength = getPickStrengthDisplay(
    game.prediction ? getCanonicalConfidence(game.prediction) : 50,
    livePredictionDisplay?.isTossUp,
  );
  const homeLeading = hs > as2;
  const awayLeading = as2 > hs;
  const leaderColor = homeLeading ? homeAccent : awayLeading ? awayAccent : TEAL;
  const scoreGap = Math.abs(hs - as2);
  const pickStatusColor = !pick ? '#6b7280' : lead ? '#4ade80' : ps === os ? '#facc15' : LIVE_RED;
  const pickStatusText = !pick ? 'No pick set' : lead ? `Up ${scoreGap}` : ps === os ? 'Even' : `Down ${scoreGap}`;
  const innerPadX = 14;
  const bodyGap = 9;
  const scoreColumnWidth = Math.min(148, Math.max(138, cardWidth * 0.4));
  const teamColumnWidth = Math.max(78, (cardWidth - innerPadX * 2 - scoreColumnWidth - bodyGap * 2) / 2);
  const renderCricketTeamMeta = (
    scoreLabel: string | null,
    role: 'BATTING' | 'BOWLING' | null,
    colors: { primary: string; secondary: string; accent?: string },
  ) => {
    if (!scoreLabel) return null;
    const batting = role === 'BATTING';
    const accent = colors.accent ?? colors.primary;
    return (
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.74}
          style={{
            color: batting ? accent : 'rgba(248,250,252,0.74)',
            fontSize: 18,
            lineHeight: 21,
            fontFamily: 'VT323_400Regular',
            letterSpacing: 0.5,
          }}
        >
          {scoreLabel}
        </Text>
        {role ? (
          <View style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: batting ? accent : 'rgba(255,255,255,0.38)', marginRight: 4 }} />
            <Text style={{ color: batting ? '#f8fafc' : 'rgba(255,255,255,0.46)', fontSize: 7, fontWeight: '900', letterSpacing: 1 }}>
              {role}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Pressable
      onPressIn={() => warmGame(game)}
      onPress={() => openGame(game)}
      style={{
        width: cardWidth,
      }}
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
        {/* Solid dark tint keeps the live card cheap to mount during tab switches. */}
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
          <View style={{ position: 'absolute', left: 0, top: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.11)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(239,68,68,0.24)' }}>
            <View style={{ marginRight: 8 }}>
              <LiveDot />
            </View>
            <Text style={{ color: '#ff5a52', fontSize: 10, fontWeight: '900', letterSpacing: 1.7 }}>LIVE</Text>
          </View>
          <View style={{ alignSelf: 'center', alignItems: 'center', minWidth: 94, backgroundColor: 'rgba(0,0,0,0.34)', borderRadius: 13, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ color: 'rgba(255,255,255,0.42)', fontSize: 8, fontWeight: '900', letterSpacing: 1.8 }}>GAME PULSE</Text>
            <Text style={{ color: suspended ? LIVE_RED : hexWithAlpha(leaderColor, 0.95), fontSize: 11, fontWeight: '900', marginTop: 1 }}>
              {suspended ? suspendedLabel(game).toUpperCase() : homeLeading ? `${game.homeTeam.abbreviation} +${scoreGap}` : awayLeading ? `${game.awayTeam.abbreviation} +${scoreGap}` : 'LEVEL'}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 1, paddingBottom: 16 }}>
          {/* Home block (left) */}
          <View style={{ width: teamColumnWidth, alignItems: 'center', minWidth: 0 }}>
            <View style={{ height: 62, alignItems: 'center', justifyContent: 'center', opacity: homeLeading || !awayLeading ? 1 : 0.66, transform: [{ scale: homeLeading ? 1.04 : 1 }] }}>
              <JerseyGlow color={homeAccent}>
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
            {isCricket ? (
              renderCricketTeamMeta(homeScoreLabel, homeCricketRole, homeColors)
            ) : (
              <Text style={{ color: homeLeading ? '#d1d5db' : '#8b95a5', fontSize: 11, fontWeight: '700', marginTop: 3 }}>{game.homeTeam.record}</Text>
            )}
          </View>

          {/* D) LED score panel — same primitives as the home-page LED tiles. */}
          <View style={{ width: scoreColumnWidth, flexShrink: 0, alignItems: 'center', justifyContent: 'center', marginHorizontal: bodyGap / 2 }}>
            {!suspended && matchTime ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: LIVE_RED, marginRight: 5 }} />
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
            <SharedArenaScoreboard
              awayScore={as2}
              homeScore={hs}
              awayColor={awayAccent}
              homeColor={homeAccent}
              label={suspended ? 'SUSPENDED' : undefined}
              displayText={cricketLedScore ?? undefined}
              subLabel={suspended ? suspensionReason : undefined}
              detailLabel={suspended ? suspensionTime : undefined}
            />
            {!suspended && cricketCaption ? (
              <Text style={{ color: 'rgba(248,250,252,0.66)', fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 6, textTransform: 'uppercase' }}>
                {cricketCaption}
              </Text>
            ) : null}
            {!suspended && cricketChaseLine ? (
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={{ maxWidth: scoreColumnWidth + 18, color: 'rgba(248,250,252,0.76)', fontSize: 8.8, fontWeight: '900', lineHeight: 11, marginTop: 2, textAlign: 'center', textTransform: 'uppercase' }}>
                {cricketChaseLine}
              </Text>
            ) : null}
            {!suspended && cricketPlayerLine ? (
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={{ maxWidth: scoreColumnWidth + 18, color: 'rgba(248,250,252,0.56)', fontSize: 8.5, fontWeight: '800', lineHeight: 11, marginTop: 3, textAlign: 'center' }}>
                {cricketPlayerLine}
              </Text>
            ) : null}
          </View>

          {/* Away block (right) */}
          <View style={{ width: teamColumnWidth, alignItems: 'center', minWidth: 0 }}>
            <View style={{ height: 62, alignItems: 'center', justifyContent: 'center', opacity: awayLeading || !homeLeading ? 1 : 0.66, transform: [{ scale: awayLeading ? 1.04 : 1 }] }}>
              <JerseyGlow color={awayAccent}>
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
            {isCricket ? (
              renderCricketTeamMeta(awayScoreLabel, awayCricketRole, awayColors)
            ) : (
              <Text style={{ color: awayLeading ? '#d1d5db' : '#8b95a5', fontSize: 11, fontWeight: '700', marginTop: 3 }}>{game.awayTeam.record}</Text>
            )}
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
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 18 }}>
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
                      marginHorizontal: 1,
                    }}
                  />
                );
              })}
            </View>
            <Text style={{ color: '#b8c3d1', fontSize: 9, fontWeight: '700', marginTop: 4 }} numberOfLines={1}>{momentumLabel}</Text>
          </View>

          {showModelEdge ? (
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
              <Text style={{ color: '#8a95a6', fontSize: 8, fontWeight: '900', letterSpacing: 1.7, marginBottom: 6 }}>MODEL EDGE</Text>
              <Text style={{ color: strength.color, fontSize: 14, fontWeight: '900' }}>{strength.label}</Text>
              <View style={{ width: 34, height: 3, borderRadius: 2, backgroundColor: hexWithAlpha(strength.color, 0.65), marginTop: 7 }} />
            </View>
          ) : null}
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
      ? 'The next over has to create separation. Dot balls and boundary control are setting the pressure profile right now.'
      : `${trailer?.abbreviation ?? 'The chasing side'} needs a clean over soon; ${leader?.abbreviation ?? 'the leader'} is trying to make the required rate bite.`;
  }

  if (game.sport === Sport.TENNIS) {
    return isTied
      ? 'The next service game is the pressure window. First serves and return depth decide who has to defend the match.'
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

  const predictionDisplay = getGamePredictionDisplay(game);
  const predictedTeam = predictionDisplay.team;
  const conf = Math.round(displayConfidence(getCanonicalConfidence(pred)));
  const tier = getConfidenceTier(conf, predictionDisplay.isTossUp).label;

  if (predictionDisplay.outcome === 'draw') {
    return isTied
      ? `The model expected a draw-type fight, and the scoreboard is still matching that read. Watch for the first side that can hold pressure for more than one sequence.`
      : `The model leaned draw before kickoff, but ${leader?.abbreviation ?? 'one side'} has broken that script. The next response tells us whether this becomes a true swing.`;
  }

  if (predictionDisplay.outcome === 'toss_up') {
    return isTied
      ? `The model called this a toss-up, and the scoreboard is still matching that read. Watch for the first side that can create real separation.`
      : `${leader?.abbreviation ?? 'One side'} has the first live edge in a game the model called a toss-up. The next response decides whether this becomes separation or just noise.`;
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
  const predictionDisplay = pred ? getGamePredictionDisplay(game) : null;
  const predictedTeam = predictionDisplay?.team ?? null;
  const isUpset = !!leader && !!pred && (
    predictionDisplay?.outcome === 'draw' ||
    predictionDisplay?.outcome === 'toss_up' ||
    (!!predictedTeam && leader.abbreviation !== predictedTeam.abbreviation)
  );
  const intel: LiveIntelItem[] = [
    {
      type: 'pulse',
      title: 'Game Pulse',
      body: isTied
        ? `${moment}: all square at ${scoreText}. Neither side owns control yet, so the next clean sequence carries real leverage.`
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
    const expected = predictionDisplay?.outcome === 'draw'
      ? 'a draw'
      : predictionDisplay?.outcome === 'toss_up'
        ? 'a toss-up'
        : predictedTeam?.abbreviation ?? 'the model side';
    const conf = Math.round(displayConfidence(getCanonicalConfidence(pred)));
    intel.push({
      type: 'alert',
      title: 'Upset Watch',
      body: `${leader.abbreviation} is currently breaking the pregame script. The model expected ${expected}${predictionDisplay?.outcome === 'draw' || predictionDisplay?.outcome === 'toss_up' ? '' : ` at ${conf}%`}, so the next response decides whether this is a live scare or a real flip.`,
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
    <Pressable
      onPress={() => { if (isLong) { fireSelectionHaptic(); setExpanded(!expanded); } }}
      style={{
        marginBottom: ARENA_CARD_GAP,
        borderRadius: 16,
      }}
    >
      <LinearGradient
        colors={[hexWithAlpha(bc, 0.56), 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.03)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 16, padding: 1.1 }}
      >
        <View style={{ backgroundColor: 'rgba(5,6,12,0.94)', borderRadius: 14.9, padding: 13, paddingLeft: 15, overflow: 'hidden' }}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: hexWithAlpha(bc, 0.18), alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: hexWithAlpha(bc, 0.28) }}>
                <Zap size={12} color={bc} fill={hexWithAlpha(bc, 0.28)} />
              </View>
              <View style={{ backgroundColor: hexWithAlpha(bc, 0.18), borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 8 }}>
                <Text style={{ fontSize: 8, fontWeight: '900', color: bc, letterSpacing: 1 }}>{bl}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 8, color: 'rgba(255,255,255,0.32)', fontWeight: '800', letterSpacing: 1.4 }}>LIVE INTEL</Text>
          </View>
          <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE, marginBottom: 6 }}>{title}</Text>
          <Text style={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 18 }}>{displayBody}</Text>
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
    <View style={{ paddingHorizontal: 20, marginTop: ARENA_SECTION_GAP, marginBottom: ARENA_SECTION_GAP }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
        <View style={{ flex: 1, paddingRight: 14 }}>
          <Text style={{ fontSize: 9, fontWeight: '900', color: LIVE_RED, letterSpacing: 2.4, marginBottom: 6 }}>INSIDE THIS GAME</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', color: WHITE }}>Live intelligence</Text>
          <Text style={{ fontSize: 11, fontWeight: '700', color: TEXT_MUTED, marginTop: 5 }} numberOfLines={1}>
            {game.awayTeam.abbreviation} at {game.homeTeam.abbreviation} · {moment}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.20)', flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED, marginRight: 6 }} />
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

const LockedLiveIntelStage = memo(function LockedLiveIntelStage({ game, onPress }: { game: GameWithPrediction | null; onPress: () => void }) {
  if (!game) return null;
  const moment = liveMomentLabel(game);
  return (
    <View style={{ paddingHorizontal: ARENA_SIDE_PADDING, marginTop: ARENA_SECTION_GAP, marginBottom: ARENA_SECTION_GAP }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
        <View style={{ flex: 1, paddingRight: 14 }}>
          <Text style={{ fontSize: 9, fontWeight: '900', color: LIVE_RED, letterSpacing: 2.4, marginBottom: 6 }}>INSIDE THIS GAME</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', color: WHITE }}>Live intelligence</Text>
          <Text style={{ fontSize: 11, fontWeight: '700', color: TEXT_MUTED, marginTop: 5 }} numberOfLines={1}>
            {game.awayTeam.abbreviation} at {game.homeTeam.abbreviation} · {moment}
          </Text>
        </View>
        <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(139,10,31,0.14)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.30)' }}>
          <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 }}>PRO</Text>
        </View>
      </View>
      <Pressable onPress={onPress}>
        <LinearGradient
          colors={['rgba(122,157,184,0.24)', 'rgba(224,234,240,0.10)', 'rgba(139,10,31,0.18)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 20, padding: 1.2 }}
        >
          <View style={{ borderRadius: 18.8, backgroundColor: 'rgba(5,8,13,0.96)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.10)', padding: 16, overflow: 'hidden' }}>
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(122,157,184,0.15)', 'rgba(255,255,255,0.025)', 'rgba(139,10,31,0.08)', 'rgba(5,8,13,0.96)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 1 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 13 }}>
              <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: 'rgba(122,157,184,0.11)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.28)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Lock size={17} color="#9AB8CC" strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 8.5, lineHeight: 11, fontWeight: '900', color: '#7A9DB8', letterSpacing: 1.7 }}>LIVE INTEL</Text>
                <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: '900', color: WHITE, marginTop: 2 }}>Game pulse is ready</Text>
              </View>
            </View>
            <Text style={{ fontSize: 12.5, lineHeight: 19, fontWeight: '700', color: TEXT_SECONDARY, marginBottom: 13 }}>
              Pressure points, momentum shifts, and model watch notes unlock while the game is moving.
            </Text>
            <View style={{ marginBottom: 14 }}>
              {['Pulse', 'Pressure point', 'Model watch'].map((item, index) => (
                <View key={item} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 30, borderRadius: 10, backgroundColor: 'rgba(122,157,184,0.055)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.10)', paddingHorizontal: 10, marginBottom: index === 2 ? 0 : 7 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: index === 0 ? '#9AB8CC' : index === 1 ? 'rgba(139,10,31,0.78)' : 'rgba(224,234,240,0.55)', marginRight: 8 }} />
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 14, fontWeight: '800', color: 'rgba(224,234,240,0.72)' }}>{item}</Text>
                  <View style={{ width: index === 0 ? 72 : index === 1 ? 96 : 84, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.055)' }} />
                </View>
              ))}
            </View>
            <LinearGradient
              colors={['rgba(122,157,184,0.24)', 'rgba(139,10,31,0.18)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ height: 44, borderRadius: 14, padding: 1 }}
            >
              <View style={{ flex: 1, borderRadius: 13, backgroundColor: 'rgba(5,8,13,0.78)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}>
                <Text style={{ fontSize: 13, lineHeight: 16, fontWeight: '900', color: WHITE, includeFontPadding: false }}>Preview Pro</Text>
                <ChevronRight size={15} color="#9AB8CC" strokeWidth={2.8} style={{ marginLeft: 6 }} />
              </View>
            </LinearGradient>
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
});

// ─── HORIZON CARD ───
const HorizonCard = memo(function HorizonCard({ game, index }: { game: GameWithPrediction; index: number }) {
  const { openGame, warmGame } = useGameDetailActions();
  const d = new Date(game.gameTime); const h = d.getHours(); const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM'; const dh = h % 12 || 12;
  const ts = `${dh}:${m.toString().padStart(2, '0')}`;
  const ic = game.prediction ? [game.prediction.isTossUp, (game.prediction.edgeRating??0) >= 7, (game.prediction.homeStreak??0) >= 3||(game.prediction.awayStreak??0) >= 3, game.prediction.ensembleDivergence].filter(Boolean).length : 0;
  return (
    <Pressable
      onPressIn={() => warmGame(game)}
      onPress={() => openGame(game)}
      style={{
        marginBottom: ARENA_CARD_GAP,
      }}
    >
      <View style={{ minHeight: 96, backgroundColor: PANEL_DARK, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER_MED, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }}>
        <LinearGradient
          pointerEvents="none"
          colors={[hexWithAlpha(TC[index % 3], 0.12), 'rgba(5,8,13,0)', 'rgba(255,255,255,0.025)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={{ width: 58, height: 58, borderRadius: 14, backgroundColor: TC[index%3], alignItems: 'center', justifyContent: 'center', marginRight: 14, flexShrink: 0 }}>
          <Text style={{ fontSize: 14, lineHeight: 17, fontWeight: '900', color: WHITE, includeFontPadding: false }}>{ts}</Text>
          <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '800', color: WHITE, marginTop: 2, includeFontPadding: false }}>{ap}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
          <Text style={{ fontSize: 15, lineHeight: 19, fontWeight: '900', color: WHITE }} numberOfLines={1}>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</Text>
          <Text style={{ fontSize: 11, lineHeight: 15, color: TEXT_MUTED, marginTop: 5, fontWeight: '700' }} numberOfLines={1}>{game.prediction ? 'Model notes ready' : 'Scheduled'}{ic > 0 ? ` · ${ic} insight${ic!==1?'s':''}` : null}</Text>
        </View>
        <View style={{ width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(122,157,184,0.08)', marginLeft: 10, flexShrink: 0 }}>
          <ChevronRight size={15} color={TEXT_MUTED} />
        </View>
      </View>
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
        <Text style={{ fontSize: 12, fontWeight: '700', color: WHITE }}>Prediction Form</Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: a >= 50 ? TEAL : MAROON }}>{a}%</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 24, marginBottom: 8 }}>
        {chartPicks.map((p, i) => (
          <View key={p.id || String(i)} style={{
            flex: 1,
            height: p.result === 'win' ? 24 : 8,
            borderRadius: 2,
            backgroundColor: p.result === 'win' ? TEAL : LOSS,
            opacity: p.result === 'win' ? 0.9 : 0.5,
            marginRight: i === chartPicks.length - 1 ? 0 : 4,
          }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 10, color: TEXT_MUTED }}>
          Last {t} resolved{pendingCount > 0 ? ` · ${pendingCount} pending` : null}
        </Text>
        <Text style={{ fontSize: 10, color: TEAL }}>{c} wins</Text>
      </View>
    </View>
  );
});

// ─── MATCHUP GENERATION ───
type DrawType = 'streak_clash'|'dominant_favorite'|'upset_brewing'|'toss_up'|'high_value'|'model_conflict'|'hot_team'|'cold_team'|'record_mismatch'|'default';

function genMatchup(game: GameWithPrediction, usedTypes: Set<DrawType>): { tags: string[]; headline: string; detail: string; drawType: DrawType } {
  const p = game.prediction!;
  const home = game.homeTeam; const away = game.awayTeam;
  const finalPick = getCanonicalFinalPick(p);
  const predictionDisplay = getGamePredictionDisplay(game);
  const tags: string[] = [];
  const conf = getCanonicalConfidence(p) || 55; const edge = p.edgeRating ?? 5; const value = p.valueRating ?? 5;
  const mTier = predictionDisplay.isTossUp ? 'Toss-Up' : conf < 60 ? 'Solid Pick' : conf < 72 ? 'Strong Pick' : 'Prime Pick';
  const hStreak = p.homeStreak ?? 0; const aStreak = p.awayStreak ?? 0;
  const sport = game.sport;
  const canonicalProbabilities = getCanonicalWinProbabilities(p);
  const homeWP = canonicalProbabilities.home;
  const awayWP = canonicalProbabilities.away;
  const drawWP = canonicalProbabilities.draw;
  const isDrawRead = predictionDisplay.outcome === 'draw' || (drawWP !== undefined && drawWP >= homeWP && drawWP >= awayWP);
  const drawProbabilityLabel = typeof drawWP === 'number' ? `${drawWP}%` : `${conf}%`;
  const winnerSide = predictionDisplay.teamSide ?? (homeWP >= awayWP ? 'home' : 'away');
  const winner = winnerSide === 'home' ? home : away;
  const loser = winnerSide === 'home' ? away : home;
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

  const pr = (r: string) => { const [w, l] = r.split('-').map(Number); return { w: w??0, l: l??0, t: (w??0)+(l??0) }; };
  const hr = pr(home.record); const ar = pr(away.record);
  const hPct = hr.w / Math.max(hr.t, 1); const aPct = ar.w / Math.max(ar.t, 1);
  const winnerIsHome = winnerSide === 'home';

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

  // 1. STREAK CLASH — two in-form teams meet
  if (!hl && hStreak >= 3 && aStreak >= 3 && trySet('streak_clash')) {
    hl = `${home.abbreviation} W${hStreak} vs ${away.abbreviation} W${aStreak}`;
    tags.push('FORM WATCH', 'STREAK CLASH');
    dt = `Both sides enter in sustained form. ${home.abbreviation} has won ${hStreak} straight, while ${away.abbreviation} brings a ${aStreak}-game run into this matchup. The first clean separation should matter.`;
  }

  // 2. DOMINANT FAVORITE — the model sees a clear mismatch
  if (!hl && conf >= 64 && edge >= 5 && trySet('dominant_favorite')) {
    hl = `${winner.abbreviation} owns the matchup edge`;
    tags.push(mTier.toUpperCase(), `${Math.max(homeWP, awayWP)}% WIN PROB`);
    dt = `The model gives ${winner.abbreviation} a ${Math.max(homeWP, awayWP)}% chance to win, backed by ${edge >= 7 ? 'a broad' : 'a meaningful'} factor edge. ${loser.abbreviation} needs a clean, high-efficiency game to close the gap.`;
  }

  // 3. UPSET CASE — the underdog has a live path
  if (!hl && conf >= 55 && conf <= 65 && trySet('upset_brewing')) {
    const favHome = finalPick === 'home';
    const underdog = favHome ? away : home;
    const uForm = favHome ? af : hf;
    if (uForm.wins >= 4 && uForm.total >= 5) {
      hl = `${underdog.abbreviation} has a live upset case`;
      tags.push('UPSET CASE', `${underdog.abbreviation} ${uForm.wins}-${uForm.total - uForm.wins} RECENT`);
      dt = `${underdog.abbreviation} has won ${uForm.wins} of their last ${uForm.total}, giving the board a credible upset profile. ${winner.abbreviation} is still favored, but recent form keeps this from reading like a routine spot.`;
    } else { hl = ''; drawType = 'default'; }
  }

  // 4. TOSS-UP — close model split
  if (!hl && (p.isTossUp || (conf >= 48 && conf <= 53)) && trySet('toss_up')) {
    hl = 'True toss-up profile';
    tags.push('TOSS-UP', `${homeWP}-${awayWP} SPLIT`);
    const separator = predictionDisplay.teamSide === 'home'
      ? 'Home environment is the small separator.'
      : predictionDisplay.teamSide === 'away'
        ? 'Road composure is the small separator.'
        : 'No side has a clean separator yet.';
    dt = `The model ran every angle and could not separate them. ${home.abbreviation} (${home.record}) vs ${away.abbreviation} (${away.record}) is close to even, with late-game execution likely deciding the edge. ${separator}`;
  }

  // 5. MODEL CONFLICT — the ensemble is divided
  if (!hl && p.ensembleDivergence && trySet('model_conflict')) {
    hl = 'Models are split';
    tags.push('MODELS SPLIT', 'VOLATILE');
    dt = `The 3-model ensemble is not fully aligned. The composite read favors ${winner.abbreviation}, while supporting models are less decisive. Treat this as a higher-volatility matchup.`;
  }

  // 6. HOT TEAM — riding momentum
  if (!hl && (hStreak >= 3 || aStreak >= 3) && trySet('hot_team')) {
    const hot = hStreak >= aStreak ? home : away; const cold = hot === home ? away : home;
    const streak = Math.max(hStreak, aStreak);
    const isHotOnRoad = hot === away;
    hl = `${hot.abbreviation} is carrying form`;
    tags.push(`W${streak} STREAK`, isHotOnRoad ? 'ROAD ROLL' : 'HOME FORTRESS');
    dt = `${hot.abbreviation} has won ${streak} straight${isHotOnRoad ? ' with road form that travels' : ' while protecting home court well'}. ${cold.abbreviation} needs to slow the first wave and force this game into a lower-variance script.`;
  }

  // 7. HIGH VALUE — the sharpest edge on the board
  if (!hl && edge >= 7 && trySet('high_value')) {
    hl = 'Strongest signal on tonight\'s slate';
    tags.push('STANDOUT', `EDGE ${edge}/10`);
    dt = `${winner.abbreviation} grades out at ${edge}/10 on edge rating, which means the model is seeing a real statistical gap in this matchup. ${loser.abbreviation} needs to cover that weakness early.`;
  }

  // 8. COLD TEAM — fading fast
  if (!hl && (hf.wins <= 3 || af.wins <= 3) && hf.total >= 5 && trySet('cold_team')) {
    const cold = hf.wins <= af.wins ? home : away;
    const hot = cold === home ? away : home;
    const cW = cold === home ? hf.wins : af.wins;
    const cT = cold === home ? hf.total : af.total;
    hl = `${cold.abbreviation} is losing form`;
    tags.push(`${cold.abbreviation} ${cW}-${cT - cW} L${cT}`, 'COLD STREAK');
    dt = `${cold.abbreviation} has won just ${cW} of their last ${cT}. The trend matters here: ${hot.abbreviation} can pressure them early and force another difficult game state.`;
  }

  // 9. RECORD MISMATCH — talent gap
  if (!hl && trySet('record_mismatch')) {
    if (Math.abs(hPct - aPct) > 0.15) {
      const better = hPct > aPct ? home : away;
      const worse = better === home ? away : home;
      hl = `${better.abbreviation} has the season profile`;
      tags.push(`${better.abbreviation} ${better.record}`, `${worse.abbreviation} ${worse.record}`);
      dt = `${better.abbreviation} enters with a stronger season profile: ${better.record} against ${worse.abbreviation}'s ${worse.record}. That is a ${Math.round(Math.abs(hPct - aPct) * 100)}% win-rate gap, so ${worse.abbreviation} needs an above-baseline performance.`;
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
      tags.push('FULL BOARD EDGE');
      dt = `Form, fundamentals, and matchup advantages all point to ${winner.abbreviation}. The model found edge in ${edge >= 6 ? 'multiple categories' : 'the key areas'}, with ${loser.abbreviation} facing a difficult stylistic setup.`;
    } else if (spread !== undefined && Math.abs(spread) >= 7) {
      hl = `${winner.abbreviation} projects for separation`;
      tags.push('PROJECTED MARGIN');
      dt = `The model projects ${winner.abbreviation} winning by around ${Math.abs(spread)} points, backed by multiple matchup factors. ${loser.abbreviation} needs to keep the early margin controlled.`;
    } else if (overUnder && overUnder >= (sport === 'NBA' ? 230 : sport === 'NFL' ? 50 : sport === 'MLB' ? 9 : sport === 'NHL' ? 6.5 : sport === 'IPL' ? 330 : sport === 'TENNIS' ? 2.5 : 3.5)) {
      hl = 'Elevated scoring profile';
      tags.push('HIGH-SCORING PROJECTION');
      dt = `The model projects a combined ${overUnder}-point total, putting pace, shot quality, and conversion efficiency at the center of this matchup.`;
    } else if (winnerIsHome && hPct > 0.55 && isNightGame) {
      hl = `${home.abbreviation} has a material home edge`;
      tags.push('HOME ADVANTAGE');
      dt = `Primetime at ${venue !== 'TBD' ? venue : 'home'}. ${home.abbreviation} (${home.record}) grades well in this environment, and the model has them favored tonight. ${away.abbreviation} needs a composed opening stretch.`;
    } else if (!winnerIsHome && aPct > 0.55) {
      hl = `${away.abbreviation}'s road profile travels`;
      tags.push('ROAD PICK');
      dt = `${away.abbreviation} (${away.record}) is favored ${sportAction} despite being the visitor. The road profile is strong enough that ${home.abbreviation} needs more than venue edge.`;
    } else if (Math.abs(formDiff) >= 2 && hf.total >= 5) {
      const hotter = formDiff > 0 ? home : away;
      const colder = formDiff > 0 ? away : home;
      const hotW = formDiff > 0 ? hf.wins : af.wins;
      const hotT = formDiff > 0 ? hf.total : af.total;
      hl = `Momentum belongs to ${hotter.abbreviation}`;
      tags.push(`${hotter.abbreviation} ${hotW}-${hotT - hotW} RECENT`);
      dt = `${hotter.abbreviation} is ${hotW}-${hotT - hotW} over the last ${hotT}, while ${colder.abbreviation} has been less stable. Recent form is giving ${hotter.abbreviation} a cleaner path into this matchup.`;
    } else if (isMatinee) {
      hl = `Early window, clean setup`;
      tags.push(displaySport(sport));
      dt = isDrawRead
        ? `Matinee matchup: ${away.abbreviation} at ${home.abbreviation}. The model has draw as the top result at ${drawProbabilityLabel}, with both sides close enough to stay live.`
        : `Matinee matchup: ${away.abbreviation} at ${home.abbreviation}. The model leans ${winner.abbreviation} with a ${Math.max(homeWP, awayWP)}% win probability.`;
    } else {
      hl = `${away.abbreviation} at ${home.abbreviation}`;
      tags.push(displaySport(sport), isDrawRead ? `${drawProbabilityLabel} DRAW` : `${Math.max(homeWP, awayWP)}% WIN PROB`);
      dt = isDrawRead
        ? `${away.abbreviation} (${away.record}) travels to face ${home.abbreviation} (${home.record}) tonight. The model has the draw as the top outcome, so finishing quality and late pressure matter more than a straight side lean.`
        : `${away.abbreviation} (${away.record}) travels to face ${home.abbreviation} (${home.record}) tonight. The model sees a ${conf >= 60 ? 'clear' : 'slight'} edge for ${winner.abbreviation}. ${conf < 58 ? 'Tight matchup; late information still matters.' : 'The data is leaning one direction.'}`;
    }
  }

  return { tags, headline: hl, detail: dt, drawType };
}

// ─── MATCHUP CARD (collapsible) ───
const MatchupCard = memo(function MatchupCard({ game, rank, headline, tags, detail, defaultExpanded }: { game: GameWithPrediction; rank: number; headline: string; tags: string[]; detail: string; defaultExpanded?: boolean }) {
  const { openGame, warmGame } = useGameDetailActions(); const isFirst = rank === 1;
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  return (
    <View style={{ backgroundColor: 'rgba(5,8,13,0.96)', borderRadius: 16, borderWidth: 1, borderColor: isFirst ? hexWithAlpha(MAROON, 0.24) : 'rgba(180,211,235,0.12)', borderLeftWidth: 3, borderLeftColor: isFirst ? MAROON : TEAL, marginBottom: ARENA_CARD_GAP, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 4 }}>
      <LinearGradient pointerEvents="none" colors={[isFirst ? hexWithAlpha(MAROON, 0.13) : hexWithAlpha(TEAL, 0.08), 'rgba(5,8,13,0)', 'rgba(255,255,255,0.025)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
      <Pressable
        onPress={() => { fireSelectionHaptic(); setExpanded(e => !e); }}
        style={{
          padding: 16,
          paddingBottom: expanded ? 8 : 16,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: isFirst ? hexWithAlpha(MAROON, 0.16) : hexWithAlpha(TEAL, 0.13), borderWidth: 1, borderColor: isFirst ? hexWithAlpha(MAROON, 0.26) : hexWithAlpha(TEAL, 0.22), alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0 }}>
            <Text style={{ fontSize: 10.5, lineHeight: 13, fontWeight: '900', color: isFirst ? MAROON : TEAL, includeFontPadding: false }}>{rank}</Text>
          </View>
          <Text numberOfLines={1} style={{ fontSize: 14, lineHeight: 18, fontWeight: '800', color: WHITE, flex: 1, minWidth: 0 }}>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</Text>
          {tags.length > 0 ? <View style={{ backgroundColor: hexWithAlpha(MAROON, 0.12), borderRadius: 7, borderWidth: 1, borderColor: hexWithAlpha(MAROON, 0.18), paddingHorizontal: 7, paddingVertical: 2, marginRight: 8, maxWidth: 108, flexShrink: 0 }}><Text adjustsFontSizeToFit minimumFontScale={0.74} numberOfLines={1} style={{ fontSize: 9, fontWeight: '800', color: MAROON, letterSpacing: 0.3 }}>{tags[0]}</Text></View> : null}
          <Text style={{ width: 16, textAlign: 'center', fontSize: 17, lineHeight: 18, color: TEXT_MUTED, includeFontPadding: false }}>{expanded ? '−' : '+'}</Text>
        </View>
        <Text style={{ fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: TEXT_SECONDARY, marginLeft: 38 }} numberOfLines={expanded ? undefined : 1}>{headline}</Text>
      </Pressable>
      {expanded ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          {tags.length > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 5 }}>
            {tags.slice(1).map((tg, i) => <View key={tg+i} style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 5, marginBottom: 5 }}><Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 0.3, includeFontPadding: false }}>{tg}</Text></View>)}
          </View> : null}
          <Text style={{ fontSize: 11.5, color: TEXT_SECONDARY, lineHeight: 18 }}>{detail}</Text>
          <Pressable
            onPressIn={() => warmGame(game)}
            onPress={() => openGame(game)}
            style={{
              marginTop: 12,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: hexWithAlpha(MAROON, 0.1),
                borderWidth: 1,
                borderColor: hexWithAlpha(MAROON, 0.18),
                borderRadius: 10,
                paddingVertical: 10,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: MAROON, marginRight: 4 }}>Open Game</Text>
              <ChevronRight size={12} color={MAROON} />
            </View>
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
    const m = new Map<string, {w:number;t:number}>();
    for (const p of picks) { const s = p.sport ?? 'Unknown'; if (s==='Unknown') continue; const e = m.get(s)??{w:0, t:0}; if (p.result==='win') e.w++; if (p.result==='win'||p.result==='loss') e.t++; m.set(s, e); }
    return Array.from(m.entries()).filter(([, d])=>d.t>=2).map(([s, d])=>({s, p:Math.round((d.w/d.t)*100)})).sort((a, b)=>b.p-a.p);
  }, [picks]);
  if (!data.length) return <View style={{marginHorizontal:20, marginBottom:ARENA_SECTION_GAP}}><Text style={{fontSize:12, fontWeight:'700', color:WHITE, marginBottom:10}}>Accuracy by Sport</Text><Text style={{fontSize:11, color:TEXT_MUTED}}>Resolved picks will populate sport-level accuracy.</Text></View>;
  return (
    <View style={{marginHorizontal:20, marginBottom:ARENA_SECTION_GAP}}>
      <Text style={{fontSize:12, fontWeight:'700', color:WHITE, marginBottom:12}}>Accuracy by Sport</Text>
      {data.map(i => {
        const bc = i.p>65?TEAL:i.p>=55?MAROON:'rgba(255,255,255,0.08)';
        const tc = i.p>65?TEAL:i.p>=55?MAROON:TEXT_MUTED;
        return <View key={i.s} style={{marginBottom:10}}><View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:4}}><Text style={{fontSize:11, fontWeight:'600', color:WHITE}}>{i.s}</Text><Text style={{fontSize:11, fontWeight:'700', color:tc}}>{i.p}%</Text></View><View style={{height:4, borderRadius:2, backgroundColor:'rgba(255,255,255,0.04)', overflow:'hidden'}}><View style={{height:'100%', width:`${i.p}%`, backgroundColor:bc, borderRadius:2}} /></View></View>;
      })}
    </View>
  );
});

// ─── STREAK CARD ───
const StreakCard = memo(function StreakCard({ stats }: { stats: UserStats|undefined }) {
  return <View style={{backgroundColor:PANEL_DARK, borderWidth:1, borderColor:'rgba(139,10,31,0.12)', borderRadius:18, padding:18, marginHorizontal:20, marginBottom:ARENA_SECTION_GAP}}><Text style={{fontSize:9, fontWeight:'700', color:MAROON, letterSpacing:1.5, marginBottom:6}}>CURRENT RUN</Text><Text style={{fontSize:26, fontWeight:'800', color:WHITE}}>{stats?.currentStreak??0} straight correct</Text><Text style={{fontSize:11, color:TEXT_MUTED, marginTop:4}}>Resolved picks update here as final scores close.</Text></View>;
});

// ─── RESULT CARD ───
const ResultCard = memo(function ResultCard({ game, pick }: { game: GameWithPrediction; pick?: UserPick }) {
  const w = pick?.result === 'win'; const hs = game.homeScore??0; const as2 = game.awayScore??0;
  return (
    <View style={{backgroundColor:PANEL_DARK, borderRadius:14, borderWidth:1, borderColor:BORDER_MED, padding:14, marginBottom:ARENA_CARD_GAP}}>
      <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}>
        <Text style={{fontSize:14, fontWeight:'700', color:WHITE}}>{game.awayTeam.abbreviation} {as2} - {hs} {game.homeTeam.abbreviation}</Text>
        {pick?<View style={{backgroundColor:w?TEAL_DIM:ERROR_DIM, borderRadius:8, paddingHorizontal:8, paddingVertical:3}}><Text style={{fontSize:9, fontWeight:'700', color:w?TEAL:LOSS}}>{w?'CORRECT':'MISSED'}</Text></View>:null}
      </View>
      {pick?<Text style={{fontSize:11, color:TEXT_SECONDARY, marginTop:6}}>{w?`Picked ${pick.pickedTeam==='home'?game.homeTeam.abbreviation:game.awayTeam.abbreviation} · Closed by ${Math.abs(hs-as2)}`:`Picked ${pick.pickedTeam==='home'?game.homeTeam.abbreviation:game.awayTeam.abbreviation} · Closed against the pick`}</Text>:null}
    </View>
  );
});

// ─── GAME DAY ───
const CARD_W = SW - ARENA_SIDE_PADDING * 2;
const LIVE_CARD_SNAP_INTERVAL = CARD_W + ARENA_CARD_GAP;

const GameDay = memo(function GameDay({
  live,
  sched,
  picks,
  followed,
  sh,
  onR,
  isR,
  bottomPadding,
  top,
  afterContent,
  liveIntelLocked = false,
  onProPress,
  horizontalGestureGuard,
}: {
  live: GameWithPrediction[];
  sched: GameWithPrediction[];
  picks: UserPick[];
  followed: GameWithPrediction[];
  sh: any;
  onR: ()=>void;
  isR: boolean;
  bottomPadding: number;
  top?: React.ReactNode;
  afterContent?: React.ReactNode;
  liveIntelLocked?: boolean;
  onProPress?: () => void;
  horizontalGestureGuard?: ArenaHorizontalGestureGuard;
}) {
  const pm = useMemo(() => { const m = new Map<string, UserPick>(); picks.forEach(p => m.set(p.gameId, p)); return m; }, [picks]);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [liveSearch, setLiveSearch] = useState('');
  const [liveSportFilter, setLiveSportFilter] = useState('All');
  const liveSports = useMemo<Set<string>>(() => new Set(live.map(g => g.sport)), [live]);
  const liveSportCounts = useMemo(() => {
    const counts = new Map<string, number>([['All', live.length]]);
    live.forEach((game) => {
      counts.set(game.sport, (counts.get(game.sport) ?? 0) + 1);
    });
    return counts;
  }, [live]);
  const filteredLive = useMemo(() => {
    const q = liveSearch.toLowerCase().trim();
    const sportScoped = liveSportFilter === 'All' ? live : live.filter(g => g.sport === liveSportFilter);
    if (!q) return sportScoped;
    return sportScoped.filter(g =>
      g.homeTeam.name.toLowerCase().includes(q) || g.homeTeam.abbreviation.toLowerCase().includes(q) ||
      g.awayTeam.name.toLowerCase().includes(q) || g.awayTeam.abbreviation.toLowerCase().includes(q) ||
      g.sport.toLowerCase().includes(q)
    );
  }, [live, liveSearch, liveSportFilter]);
  const focusedGame = filteredLive[focusedIdx] ?? filteredLive[0] ?? null;
  const focusedIntel = useMemo(() => liveIntelLocked ? [] : generateLiveIntel(focusedGame), [focusedGame, liveIntelLocked]);
  const liveCardSnapOffsets = useMemo<number[]>(
    () => filteredLive.map((_, index) => index * LIVE_CARD_SNAP_INTERVAL),
    [filteredLive.length],
  );
  const liveInitialRenderCount = Math.min(filteredLive.length, 3);

  useEffect(() => {
    if (liveSportFilter !== 'All' && !liveSports.has(liveSportFilter)) setLiveSportFilter('All');
  }, [liveSportFilter, liveSports]);

  useEffect(() => {
    setFocusedIdx(0);
  }, [liveSearch, liveSportFilter]);

  useEffect(() => {
    if (focusedIdx >= filteredLive.length) setFocusedIdx(0);
  }, [focusedIdx, filteredLive.length]);

  const onLiveScroll = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / LIVE_CARD_SNAP_INTERVAL);
    if (idx >= 0 && idx < filteredLive.length) {
      setFocusedIdx((current) => idx === current ? current : idx);
    }
  }, [filteredLive.length]);

  // No live games
  if (!live.length) return (
    <ArenaScrollView sh={sh} onR={onR} isR={isR} bottomPadding={bottomPadding}>
      {top}
      <ArenaHeader title="Game Day" subtitle="Followed games, upcoming starts, and live state in one slate view." accent={TEAL} />
      <YourGames games={followed} {...horizontalGestureGuard} />
      <View style={{alignItems:'center', paddingTop:28, paddingBottom:24}}><Text style={{fontSize:14, color:TEXT_MUTED}}>No live games on the board</Text></View>
      {sched.length>0?<View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginTop:4, marginBottom:ARENA_SECTION_GAP}}><Text style={{fontSize:16, lineHeight:20, fontWeight:'900', color:WHITE, marginBottom:14}}>Upcoming Slate</Text>{sched.slice(0, 5).map((g, i)=><HorizonCard key={g.id} game={g} index={i} />)}</View>:null}
      {picks.length>0?<View style={{marginTop:8}}><PredStrip picks={picks} /></View>:null}
      {afterContent}
      <Disclaimer />
    </ArenaScrollView>
  );

  // Has live games
  return (
    <ArenaScrollView sh={sh} onR={onR} isR={isR} bottomPadding={bottomPadding}>
      {top}
      {/* 1. Header */}
      <ArenaHeader title="Game Day" subtitle="Monitor followed games and live state as the board changes." accent={LIVE_RED} />

      {/* 2. Your Games */}
      <YourGames games={followed} {...horizontalGestureGuard} />

      {/* 3. Live board search */}
      <View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginTop:0, marginBottom:18}}>
        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'flex-end', marginBottom:14}}>
          <View style={{flex:1, minWidth:0, paddingRight:12}}>
            <Text style={{fontSize:9, fontWeight:'900', color:LIVE_RED, letterSpacing:2.2, marginBottom:4}}>LIVE FEED</Text>
            <Text style={{fontSize:20, lineHeight:24, fontWeight:'900', color:WHITE}}>{liveIntelLocked ? 'Live board' : 'Live intelligence'}</Text>
          </View>
          <View style={{borderRadius:999, paddingHorizontal:10, paddingVertical:6, backgroundColor:'rgba(239,68,68,0.10)', borderWidth:1, borderColor:'rgba(239,68,68,0.20)', flexDirection:'row', alignItems:'center'}}>
            <View style={{width:6, height:6, borderRadius:3, backgroundColor:LIVE_RED, marginRight:6}} />
            <Text style={{fontSize:9, fontWeight:'900', color:LIVE_RED, letterSpacing:1.1}}>{liveSearch.trim() || liveSportFilter !== 'All' ? `${filteredLive.length} MATCH` : `${live.length} LIVE`}</Text>
          </View>
        </View>
        {live.length > 0 ? (
          <LinearGradient
            colors={['rgba(239,68,68,0.26)', 'rgba(180,211,235,0.12)', 'rgba(122,157,184,0.08)']}
            start={{x:0, y:0}}
            end={{x:1, y:1}}
            style={{borderRadius:19, padding:1}}
          >
            <View style={{minHeight:54, flexDirection:'row', alignItems:'center', backgroundColor:'rgba(5,8,13,0.98)', borderRadius:18, borderWidth:1, borderColor:'rgba(255,255,255,0.055)', paddingHorizontal:12, overflow:'hidden'}}>
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(239,68,68,0.10)', 'rgba(5,8,13,0)', 'rgba(122,157,184,0.08)']}
                start={{x:0, y:0}}
                end={{x:1, y:1}}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={{width:34, height:34, borderRadius:12, backgroundColor:'rgba(239,68,68,0.10)', borderWidth:1, borderColor:'rgba(239,68,68,0.22)', alignItems:'center', justifyContent:'center', marginRight:10}}>
                <Search size={16} color={LIVE_RED} strokeWidth={2.4} />
              </View>
              <TextInput
                value={liveSearch}
                onChangeText={setLiveSearch}
                placeholder="Search live teams or matchups"
                placeholderTextColor='rgba(180,211,235,0.36)'
                style={{flex:1, fontSize:14, lineHeight:20, fontWeight:'800', color:WHITE, padding:0}}
                keyboardAppearance="dark"
                returnKeyType="done"
              />
              {liveSearch.length > 0 ? (
                <Pressable
                  onPress={() => setLiveSearch('')}
                  hitSlop={8}
                  style={{
                    width:30,
                    height:30,
                    borderRadius:10,
                    alignItems:'center',
                    justifyContent:'center',
                    backgroundColor:'rgba(255,255,255,0.055)',
                  }}
                >
                  <Text style={{fontSize:15, fontWeight:'900', color:'rgba(224,234,240,0.56)'}}>×</Text>
                </Pressable>
              ) : null}
            </View>
          </LinearGradient>
        ) : null}
        {live.length > 0 ? (
          <View style={{ marginTop: 12 }}>
            <SportPills
              selected={liveSportFilter}
              onSelect={setLiveSportFilter}
              available={liveSports}
              counts={liveSportCounts}
              compact
              alwaysShowSpecialSports={false}
              sidePadding={0}
              bottomMargin={0}
              {...horizontalGestureGuard}
            />
          </View>
        ) : null}
      </View>

      {/* 4. Scrollable live cards */}
      {filteredLive.length === 0 && (liveSearch.trim() || liveSportFilter !== 'All') ? (
        <View style={{alignItems:'center', paddingVertical:20}}>
          <Text style={{fontSize:13, color:TEXT_MUTED}}>{liveSearch.trim() ? `No live games match "${liveSearch}"` : 'No live games match this sport'}</Text>
        </View>
      ) : filteredLive.length === 1 ? (
        <View style={{paddingHorizontal:20, marginBottom:ARENA_CARD_GAP}}>
          <LiveCard
            game={filteredLive[0]}
            pick={pm.get(filteredLive[0].id)}
            cardWidth={CARD_W}
            showModelEdge={!liveIntelLocked}
          />
        </View>
      ) : (
        <Animated.FlatList
          data={filteredLive}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToOffsets={liveCardSnapOffsets}
          snapToAlignment="start"
          disableIntervalMomentum
          decelerationRate="fast"
          contentContainerStyle={{paddingHorizontal:ARENA_SIDE_PADDING}}
          ItemSeparatorComponent={() => <View style={{ width: ARENA_CARD_GAP }} />}
          initialNumToRender={liveInitialRenderCount}
          maxToRenderPerBatch={3}
          updateCellsBatchingPeriod={16}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <LiveCard
              game={item}
              pick={pm.get(item.id)}
              cardWidth={CARD_W}
              showModelEdge={!liveIntelLocked}
            />
          )}
          getItemLayout={(_, index) => ({ length: LIVE_CARD_SNAP_INTERVAL, offset: LIVE_CARD_SNAP_INTERVAL * index, index })}
          style={{flexGrow:0}}
          onTouchStart={horizontalGestureGuard?.onHorizontalGestureStart}
          onTouchEnd={horizontalGestureGuard?.onHorizontalGestureEnd}
          onTouchCancel={horizontalGestureGuard?.onHorizontalGestureEnd}
          onScrollBeginDrag={horizontalGestureGuard?.onHorizontalGestureStart}
          onScrollEndDrag={horizontalGestureGuard?.onHorizontalGestureEnd}
          onMomentumScrollBegin={horizontalGestureGuard?.onHorizontalGestureStart}
          onMomentumScrollEnd={(event) => {
            onLiveScroll(event);
            horizontalGestureGuard?.onHorizontalGestureEnd?.();
          }}
        />
      )}

      {/* 5. Page dots */}
      {filteredLive.length > 1 ? (
        <View style={{flexDirection:'row', justifyContent:'center', marginTop:10, marginBottom:4}}>
          {filteredLive.map((_, i) => <View key={i} style={{width:i===focusedIdx?8:4, height:4, borderRadius:2, backgroundColor:i===focusedIdx?MAROON:'rgba(255,255,255,0.15)', marginHorizontal:2}} />)}
        </View>
      ) : null}

      {/* 6. Intel feed — tied to focused game */}
      {liveIntelLocked ? (
        onProPress ? <LockedLiveIntelStage game={focusedGame} onPress={onProPress} /> : null
      ) : (
        <LiveIntelStage game={focusedGame} intel={focusedIntel} />
      )}

      {/* 7. On the Horizon */}
      {sched.length>0?<View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginTop:6, marginBottom:ARENA_SECTION_GAP}}><Text style={{fontSize:16, lineHeight:20, fontWeight:'900', color:WHITE, marginBottom:14}}>Upcoming Slate</Text>{sched.slice(0, 6).map((g, i)=><HorizonCard key={g.id} game={g} index={i} />)}</View>:null}

      {/* 8. Predictions */}
      {picks.length>0?<View style={{marginTop:0, marginBottom:ARENA_SECTION_GAP}}><PredStrip picks={picks} /></View>:null}

      {afterContent}

      {/* 9. Disclaimer */}
      <Disclaimer />
    </ArenaScrollView>
  );
});

// ─── PREP SUB-TABS ───
const PREP_TABS = ['Ranked', 'Underdogs'] as const;
const PREP_MATCHUP_LIMIT = 16;

// ─── PREP MODE ───
const Prep = memo(function Prep({
  sched,
  picks,
  stats,
  sh,
  onR,
  isR,
  bottomPadding,
  top,
  horizontalGestureGuard,
}: {
  sched: GameWithPrediction[];
  picks: UserPick[];
  stats: UserStats|undefined;
  sh: any;
  onR: ()=>void;
  isR: boolean;
  bottomPadding: number;
  top?: React.ReactNode;
  horizontalGestureGuard?: ArenaHorizontalGestureGuard;
}) {
  const [prepTab, setPrepTab] = useState<0|1>(0);
  const tonightNarrative = useMemo(() => generateTonightNarrative(sched), [sched]);
  const ranked = useMemo(() => {
    const withPred = sched.filter(g => g.prediction);
    const sorted = withPred.sort((a, b) => {
      const s = (g: GameWithPrediction) => getCanonicalConfidence(g.prediction)*0.6+(g.prediction!.edgeRating??5)*2.5+(g.prediction!.valueRating??5)*1.5;
      return s(b)-s(a);
    }).slice(0, PREP_MATCHUP_LIMIT);
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
        const pw = getCanonicalFinalPick(r.game.prediction);
        return !!mf && (pw === 'home' || pw === 'away') && mf !== pw;
      })
      .map(r => {
        const pick = getCanonicalFinalPick(r.game.prediction);
        const dog = pick === 'home' ? r.game.homeTeam : r.game.awayTeam;
        const fav = pick === 'home' ? r.game.awayTeam : r.game.homeTeam;
        const conf = Math.round(getCanonicalConfidence(r.game.prediction));
        return {
          ...r,
          udHeadline: `Market favors ${fav.abbreviation}; model prefers ${dog.abbreviation}`,
          udTags: ['UNDERDOG PICK', `${conf}% MODEL CONF`],
        };
      });
  }, [ranked]);

  const { openGame, warmGame } = useGameDetailActions();
  const top3 = ranked.slice(0, 3);

  return (
    <ArenaScrollView sh={sh} onR={onR} isR={isR} bottomPadding={bottomPadding}>
      {top}
      {/* Header */}
      <ArenaHeader title="Prep Mode" subtitle="Rank matchups by conviction, edge, and value before the slate opens." accent={MAROON} />

      {/* Slate context card */}
      <View style={{backgroundColor:PANEL_DARK, borderRadius:18, borderWidth:1, borderColor:BORDER_MED, padding:18, marginHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}>
        <Text style={{fontSize:9, fontWeight:'700', color:MAROON, letterSpacing:1.5, marginBottom:8}}>SLATE CONTEXT</Text>
        <Text style={{fontSize:15, fontWeight:'600', color:WHITE, lineHeight:23}}>{tonightNarrative}</Text>
      </View>

      {/* Top 3 quick-glance strip */}
      {top3.length > 0 ? (
        <View style={{marginBottom:ARENA_SECTION_GAP}}>
          <Text style={{fontSize:10, fontWeight:'700', color:TEXT_MUTED, letterSpacing:1.5, paddingHorizontal:ARENA_SIDE_PADDING, marginBottom:12}}>TOP MODEL GRADES</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{paddingLeft:ARENA_SIDE_PADDING, paddingRight:ARENA_SIDE_PADDING, paddingBottom:2, flexDirection:'row'}}
            style={{flexGrow:0}}
            onTouchStart={horizontalGestureGuard?.onHorizontalGestureStart}
            onTouchEnd={horizontalGestureGuard?.onHorizontalGestureEnd}
            onTouchCancel={horizontalGestureGuard?.onHorizontalGestureEnd}
            onScrollBeginDrag={horizontalGestureGuard?.onHorizontalGestureStart}
            onScrollEndDrag={horizontalGestureGuard?.onHorizontalGestureEnd}
            onMomentumScrollBegin={horizontalGestureGuard?.onHorizontalGestureStart}
            onMomentumScrollEnd={horizontalGestureGuard?.onHorizontalGestureEnd}
          >
            {top3.map((r, i) => {
              const conf = Math.round(getCanonicalConfidence(r.game.prediction));
              const predictionDisplay = getGamePredictionDisplay(r.game);
              return (
                <Pressable
                  key={r.game.id}
                  onPressIn={() => warmGame(r.game)}
                  onPress={() => openGame(r.game)}
                  style={{
                    marginRight: i === top3.length - 1 ? 0 : ARENA_CARD_GAP,
                  }}
                >
                  <View
                    style={{
                      width: 156,
                      minHeight: 104,
                      backgroundColor: PANEL_DARK,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: i === 0 ? 'rgba(139,10,31,0.25)' : BORDER_MED,
                      padding: 14,
                    }}
                  >
                    <View style={{flexDirection:'row', alignItems:'center', marginBottom:8}}>
                      <Text numberOfLines={1} style={{fontSize:10, lineHeight:13, fontWeight:'600', color:TEXT_MUTED}}>{displaySport(r.game.sport)}</Text>
                    </View>
                    <Text numberOfLines={2} style={{fontSize:13, lineHeight:17, fontWeight:'800', color:WHITE, marginBottom:6}}>{r.game.awayTeam.abbreviation} vs {r.game.homeTeam.abbreviation}</Text>
                    <Text numberOfLines={1} style={{fontSize:10.5, lineHeight:14, fontWeight:'600', color:TEAL, marginBottom:3}}>Model: {predictionDisplay.badgeLabel}</Text>
                    <Text numberOfLines={1} style={{fontSize:10.5, lineHeight:14, color:TEXT_MUTED}}>{conf}% confidence</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Sub-tab toggle: Ranked / Underdogs */}
      <View style={{minHeight:54, flexDirection:'row', marginHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP, backgroundColor:'rgba(255,255,255,0.04)', borderRadius:18, padding:4, borderWidth:1, borderColor:'rgba(180,211,235,0.10)'}}>
        {PREP_TABS.map((label, idx) => {
          const active = prepTab === idx;
          const count = idx === 0 ? ranked.length : underdogPlays.length;
          return (
            <Pressable key={label} onPress={() => { if (!active) fireSelectionHaptic(); setPrepTab(idx as 0|1); }} style={{flex:1, minWidth:0, marginRight: idx === PREP_TABS.length - 1 ? 0 : 6}}>
              <LinearGradient
                colors={active
                  ? [hexWithAlpha(MAROON, 0.48), 'rgba(180,211,235,0.12)', hexWithAlpha(MAROON, 0.26)]
                  : ['rgba(122,157,184,0.09)', 'rgba(122,157,184,0.025)']}
                start={{x:0, y:0}}
                end={{x:1, y:1}}
                style={{minHeight:46, borderRadius:14, padding:1}}
              >
                <View style={{flex:1, borderRadius:13, alignItems:'center', justifyContent:'center', paddingHorizontal:8, backgroundColor:active?'rgba(7,10,16,0.50)':'rgba(7,10,16,0.46)'}}>
                  <View style={{flexDirection:'row', alignItems:'center', justifyContent:'center', minWidth:0, maxWidth:'100%'}}>
                  <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{fontSize:12.5, lineHeight:16, fontWeight:'900', color:active?WHITE:TEXT_MUTED, includeFontPadding:false, flexShrink:1}}>{label}</Text>
                  {count > 0 ? (
                    <View style={{minWidth:22, height:20, borderRadius:10, alignItems:'center', justifyContent:'center', paddingHorizontal:6, backgroundColor:active?hexWithAlpha(MAROON, 0.20):'rgba(122,157,184,0.10)', borderWidth:1, borderColor:active?hexWithAlpha(MAROON, 0.26):'rgba(122,157,184,0.12)', flexShrink:0, marginLeft:8}}>
                      <Text style={{fontSize:9.5, lineHeight:12, fontWeight:'900', color:active?WHITE:TEAL, includeFontPadding:false}}>{count}</Text>
                    </View>
                  ) : null}
                  </View>
                </View>
              </LinearGradient>
            </Pressable>
          );
        })}
      </View>

      {/* Ranked tab content */}
      {prepTab === 0 ? (
        ranked.length > 0 ? (
          <View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}>
            <Text style={{fontSize:10, fontWeight:'600', color:TEXT_MUTED, letterSpacing:1, marginBottom:12}}>Open a matchup for factors and context</Text>
            {ranked.map((r, i)=><MatchupCard key={r.game.id} game={r.game} rank={i+1} headline={r.headline} tags={r.tags} detail={r.detail} defaultExpanded={i === 0} />)}
          </View>
        ) : (
          <View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}><Text style={{fontSize:12, color:TEXT_MUTED}}>No model-ready scheduled games.</Text></View>
        )
      ) : null}

      {/* Underdogs tab content */}
      {prepTab === 1 ? (
        <View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}>
          <Text style={{fontSize:11, color:TEXT_MUTED, lineHeight:16, marginBottom:12}}>Games where the model disagrees with the market favorite.</Text>
          {underdogPlays.length > 0
            ? underdogPlays.map((r, i)=><MatchupCard key={`ud-${r.game.id}`} game={r.game} rank={i+1} headline={r.udHeadline} tags={[...r.udTags, ...r.tags]} detail={r.detail} defaultExpanded={i === 0} />)
            : <View style={{backgroundColor:PANEL_DARK, borderRadius:14, borderWidth:1, borderColor:BORDER_MED, padding:14}}><Text style={{fontSize:11, color:TEXT_MUTED, lineHeight:16}}>No underdog disagreements on this slate. The model is aligned with the market favorites.</Text></View>}
        </View>
      ) : null}

      <AccBySport picks={picks} />
      <StreakCard stats={stats} />
      <Disclaimer />
    </ArenaScrollView>
  );
});

// ─── REVIEW ───
const Review = memo(function Review({ final: fg, picks, stats, sh, onR, isR, bottomPadding, top }: { final: GameWithPrediction[]; picks: UserPick[]; stats: UserStats|undefined; sh: any; onR: ()=>void; isR: boolean; bottomPadding: number; top?: React.ReactNode }) {
  const pm = useMemo(() => { const m = new Map<string, UserPick>(); picks.forEach(p => m.set(p.gameId, p)); return m; }, [picks]);
  const pfg = useMemo(() => fg.filter(g => pm.has(g.id)), [fg, pm]);
  const w = pfg.filter(g => pm.get(g.id)?.result==='win').length;
  const l = pfg.filter(g => pm.get(g.id)?.result==='loss').length;
  const t = w+l; const a = t>0?Math.round((w/t)*100):0;
  return (
    <ArenaScrollView sh={sh} onR={onR} isR={isR} bottomPadding={bottomPadding}>
      {top}
      <ArenaHeader title="Review" subtitle="Audit settled picks, sport trends, and model calls after final scores." accent={SILVER} />
      {t>0?(
        <View style={{backgroundColor:PANEL_DARK, borderRadius:22, borderWidth:1, borderColor:'rgba(139,10,31,0.12)', paddingVertical:26, paddingHorizontal:20, marginHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP, alignItems:'center'}}>
          <Text style={{fontSize:9.5, lineHeight:13, fontWeight:'700', color:MAROON, letterSpacing:1.5, marginBottom:8, includeFontPadding:false}}>SETTLED PICKS</Text>
          <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{fontSize:50, lineHeight:56, fontWeight:'800', color:WHITE, includeFontPadding:false}}>{w}-{l}</Text>
          <Text style={{fontSize:14, lineHeight:18, fontWeight:'700', color:MAROON, marginTop:5}}>{a}% accuracy</Text>
          <View style={{flexDirection:'row', marginTop:14}}>{pfg.map((g, index)=><View key={g.id} style={{width:48, height:5, borderRadius:2.5, backgroundColor:pm.get(g.id)?.result==='win'?TEAL:LOSS, opacity:pm.get(g.id)?.result==='win'?0.9:0.4, marginRight:index===pfg.length-1?0:3}} />)}</View>
        </View>
      ):<View style={{alignItems:'center', paddingVertical:32, paddingHorizontal:18, marginHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}><Text style={{fontSize:13, lineHeight:19, color:TEXT_MUTED, textAlign:'center'}}>Settled picks will appear after final scores.</Text></View>}
      {pfg.length>0?<View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}><Text style={{fontSize:12, fontWeight:'700', color:WHITE, marginBottom:14}}>Results</Text>{pfg.map(g=><ResultCard key={g.id} game={g} pick={pm.get(g.id)} />)}</View>:null}
      {fg.length>0?<View style={{backgroundColor:PANEL_DARK, borderRadius:18, borderWidth:1, borderColor:BORDER_MED, padding:18, marginHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}>
        <Text style={{fontSize:12.5, lineHeight:16, fontWeight:'700', color:WHITE, marginBottom:14}}>Model Notes</Text>
        {fg.slice(0, 3).map(g=>{const p=g.prediction;if(!p) return null;const pick=getCanonicalFinalPick(p);const conf=getCanonicalConfidence(p);const predictionDisplay=getGamePredictionDisplay(g);const ok=(pick==='home'&&(g.homeScore??0)>(g.awayScore??0))||(pick==='away'&&(g.awayScore??0)>(g.homeScore??0))||(pick==='draw'&&(g.homeScore??0)===(g.awayScore??0));return <View key={g.id} style={{marginBottom:12, paddingLeft:12, borderLeftWidth:3, borderLeftColor:ok?TEAL:LOSS}}><Text style={{fontSize:11.5, lineHeight:15, fontWeight:'600', color:WHITE, marginBottom:4}}>{g.awayTeam.abbreviation} vs {g.homeTeam.abbreviation}</Text><Text style={{fontSize:11.5, color:TEXT_SECONDARY, lineHeight:18}}>{(() => { const tl = predictionDisplay.isTossUp ? 'a Toss-Up' : conf < 60 ? 'a Solid Pick' : conf < 72 ? 'a Strong Pick' : 'a Prime Pick'; const tm = predictionDisplay.badgeLabel; return ok ? `Model correctly predicted ${tm} as ${tl}.` : `Model missed — rated ${tm} as ${tl} but the upset came through.`; })()}</Text></View>;})}
      </View>:null}
      <View style={{backgroundColor:PANEL_DARK, borderWidth:1, borderColor:'rgba(139,10,31,0.12)', borderRadius:18, padding:18, marginHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP, flexDirection:'row', justifyContent:'space-between', alignItems:'center'}}>
        <View style={{flex:1, minWidth:0}}><Text style={{fontSize:9, fontWeight:'700', color:MAROON, letterSpacing:1.5, marginBottom:4}}>SEASON RECORD</Text><Text adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={{fontSize:28, fontWeight:'800', color:WHITE}}>{stats?.wins??0}-{stats?.losses??0}</Text></View>
        <Text adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={{fontSize:30, fontWeight:'800', color:MAROON, maxWidth:120, marginLeft:12}}>{stats?.winRate?`${Math.round(stats.winRate)}%`:'—'}</Text>
      </View>
      <Disclaimer />
    </ArenaScrollView>
  );
});

const FreeFinalScores = memo(function FreeFinalScores({ final }: { final: GameWithPrediction[] }) {
  if (final.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: ARENA_SIDE_PADDING, marginBottom: ARENA_SECTION_GAP }}>
      <Text style={{ fontSize: 16, lineHeight: 20, fontWeight: '900', color: WHITE, marginBottom: 14 }}>Final Scores</Text>
      {final.slice(0, 5).map(game => (
        <ResultCard key={game.id} game={game} />
      ))}
    </View>
  );
});

const ProFeatureGate = memo(function ProFeatureGate({
  title,
  eyebrow,
  description,
  accent,
  bullets,
  onPress,
}: {
  title: string;
  eyebrow: string;
  description: string;
  accent: string;
  bullets: string[];
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ marginHorizontal: ARENA_SIDE_PADDING, marginBottom: ARENA_CARD_GAP }}>
      <LinearGradient
        colors={['rgba(122,157,184,0.24)', 'rgba(224,234,240,0.10)', 'rgba(139,10,31,0.18)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 20, padding: 1.2 }}
      >
        <View style={{ minHeight: 154, borderRadius: 18.8, backgroundColor: 'rgba(5,8,13,0.96)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.10)', padding: 16, overflow: 'hidden' }}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(122,157,184,0.15)', 'rgba(255,255,255,0.025)', 'rgba(139,10,31,0.08)', 'rgba(5,8,13,0.96)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 1 }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(122,157,184,0.11)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.28)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Lock size={16} color="#9AB8CC" strokeWidth={2.6} />
            </View>
            <View style={{ flex: 1, minWidth: 0, marginLeft: 11 }}>
              <Text style={{ fontSize: 8.5, lineHeight: 11, fontWeight: '900', color: '#7A9DB8', letterSpacing: 1.8, includeFontPadding: false }}>{eyebrow}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={{ fontSize: 17, lineHeight: 22, fontWeight: '900', color: WHITE, marginTop: 2, includeFontPadding: false }}>{title}</Text>
            </View>
            <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(139,10,31,0.14)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.30)', marginLeft: 10 }}>
              <Text style={{ fontSize: 9, lineHeight: 11, fontWeight: '900', color: 'rgba(255,255,255,0.82)', letterSpacing: 1.1, includeFontPadding: false }}>PRO</Text>
            </View>
          </View>
          <Text style={{ fontSize: 12, lineHeight: 18, fontWeight: '700', color: TEXT_SECONDARY, marginBottom: 12 }}>{description}</Text>
          <View style={{ marginBottom: 14 }}>
            {bullets.map((item, index) => (
              <View key={item} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 28, borderRadius: 10, backgroundColor: 'rgba(122,157,184,0.055)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.10)', paddingHorizontal: 10, marginBottom: index === bullets.length - 1 ? 0 : 7 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: index === 0 ? '#9AB8CC' : index === 1 ? 'rgba(139,10,31,0.78)' : 'rgba(224,234,240,0.55)', marginRight: 8, flexShrink: 0 }} />
                <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 14, fontWeight: '800', color: 'rgba(224,234,240,0.72)' }}>{item}</Text>
              </View>
            ))}
          </View>
          <LinearGradient
            colors={['rgba(122,157,184,0.24)', 'rgba(139,10,31,0.18)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ height: 44, borderRadius: 14, padding: 1 }}
          >
            <View style={{ flex: 1, borderRadius: 13, backgroundColor: 'rgba(5,8,13,0.78)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}>
              <Text style={{ fontSize: 13, lineHeight: 16, fontWeight: '900', color: WHITE, includeFontPadding: false }}>Preview Pro</Text>
              <ChevronRight size={15} color="#9AB8CC" strokeWidth={2.8} style={{ marginLeft: 6 }} />
            </View>
          </LinearGradient>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

const FreeProPreviewStack = memo(function FreeProPreviewStack({ final, onPress }: { final: GameWithPrediction[]; onPress: () => void }) {
  return (
    <View style={{ marginTop: 2, marginBottom: ARENA_SECTION_GAP }}>
      <FreeFinalScores final={final} />
      <View style={{ paddingHorizontal: ARENA_SIDE_PADDING, marginBottom: 12 }}>
        <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '900', color: MAROON, letterSpacing: 2.1, includeFontPadding: false }}>PRO TOOLS</Text>
        <Text style={{ fontSize: 20, lineHeight: 25, fontWeight: '900', color: WHITE, marginTop: 5 }}>Keep the arena, reveal the deeper reads</Text>
      </View>
      <ProFeatureGate
        title="Prep Mode"
        eyebrow="MODEL BOARD"
        description="The same slate, upgraded with model-ranked matchups, context, and conviction before games open."
        accent={MAROON}
        bullets={['Ranked board with model confidence', 'Underdog disagreement watchlist', 'Slate context and matchup factors']}
        onPress={onPress}
      />
      <ProFeatureGate
        title="Review"
        eyebrow="POSTGAME AUDIT"
        description="After scores settle, Pro keeps your record, misses, trends, and model notes in one polished recap."
        accent={TEAL}
        bullets={['Settled pick history and accuracy', 'Model notes after final scores', 'Season record and sport-level trends']}
        onPress={onPress}
      />
    </View>
  );
});

// ─── FREE ARENA — Game Day lite + locked Prep/Review previews ───
function FreeArena({ games, sportFilter, router, sh, onR, isR, followed, bottomPadding, top }: { games: GameWithPrediction[]; sportFilter: string; router: ReturnType<typeof useRouter>; sh: any; onR: () => void; isR: boolean; followed: GameWithPrediction[]; bottomPadding: number; top?: React.ReactNode }) {
  const filtered = useMemo(() => {
    if (sportFilter === 'All') return games;
    return games.filter(g => g.sport === sportFilter);
  }, [games, sportFilter]);

  const live = useMemo(() => filtered.filter(g => g.status === GameStatus.LIVE || (g.status as string) === 'in_progress' || (g.status as string) === 'halftime'), [filtered]);
  const sched = useMemo(() => filtered.filter(g => g.status === GameStatus.SCHEDULED).sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()), [filtered]);
  const final = useMemo(() => filtered.filter(g => g.status === GameStatus.FINAL).slice(0, 5), [filtered]);

  const openPaywall = useCallback(() => {
    fireLightHaptic();
    router.push('/paywall');
  }, [router]);

  return (
    <GameDay
      live={live}
      sched={sched}
      picks={[]}
      followed={followed}
      sh={sh}
      onR={onR}
      isR={isR}
      bottomPadding={bottomPadding}
      top={top}
      liveIntelLocked
      onProPress={openPaywall}
      afterContent={<FreeProPreviewStack final={final} onPress={openPaywall} />}
    />
  );
}

// ─── MAIN ───
export default function MyArenaScreen() {
  const router = useRouter();
  const { isPremium } = useSubscription();
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<React.ElementRef<typeof PagerView>>(null);
  const pagerUnlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sf, setSf] = useState('All');
  const [am, setAm] = useState(0);
  const [arenaPagerEnabled, setArenaPagerEnabled] = useState(true);
  const [contentReady, setContentReady] = useState(false);
  const [fgi, setFgi] = useState<Set<string>>(new Set());
  const {data:allGames, isLoading, refetch} = useGames();
  const {data:userPicks} = useUserPicks(isPremium && contentReady);
  const {data:userStats} = useUserStats(isPremium && contentReady && am !== 0);
  const {data:teamFollows} = useTeamFollows(contentReady);
  const sh = useHideOnScroll();
  const { refreshing: isR, onRefresh: onR } = useSmoothRefresh(refetch);
  const deferredSf = useDeferredValue(sf);
  const arenaBottomPadding = useMemo(() => getArenaBottomPadding(insets.bottom), [insets.bottom]);

  const loadFollowedGames = useCallback(async () => {
    try {
      const parsed = await readFollowedGameIds();
      const next = new Set<string>(parsed);
      setFgi((prev) => {
        if (prev.size === next.size && Array.from(prev).every((id) => next.has(id))) return prev;
        return next;
      });
    } catch {
      setFgi(new Set());
    }
  }, []);

  useEffect(() => {
    if (!contentReady || !allGames?.length) return;
    let cancelled = false;
    void pruneFollowedGamesForReset(allGames).then((ids) => {
      if (cancelled) return;
      const next = new Set(ids);
      setFgi((prev) => {
        if (prev.size === next.size && Array.from(prev).every((id) => next.has(id))) return prev;
        return next;
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [allGames, contentReady]);

  useFocusEffect(useCallback(() => {
    let active = true;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!active) return;
      setContentReady(true);
      void loadFollowedGames();
    });
    return () => {
      active = false;
      task.cancel?.();
    };
  }, [loadFollowedGames]));

  useEffect(() => () => {
    if (pagerUnlockTimer.current) clearTimeout(pagerUnlockTimer.current);
  }, []);

  const games = useMemo(() => { if (!allGames) return []; return deferredSf==='All'?allGames:allGames.filter(g=>g.sport===deferredSf); }, [allGames, deferredSf]);
  const availableSports = useMemo(() => new Set((allGames ?? []).map(g => g.sport)), [allGames]);
  const followed = useMemo(() => { if (!allGames) return []; const ta = new Set((teamFollows??[]).map(t=>t.teamAbbreviation.toUpperCase())); return allGames.filter(g=>fgi.has(g.id)||ta.has(g.homeTeam.abbreviation.toUpperCase())||ta.has(g.awayTeam.abbreviation.toUpperCase())); }, [allGames, fgi, teamFollows]);
  const live = useMemo(() => games.filter(g=>g.status===GameStatus.LIVE), [games]);
  const sched = useMemo(() => games.filter(g=>g.status===GameStatus.SCHEDULED), [games]);
  const final = useMemo(() => games.filter(g=>g.status===GameStatus.FINAL), [games]);

  const lockArenaPager = useCallback(() => {
    if (pagerUnlockTimer.current) clearTimeout(pagerUnlockTimer.current);
    setArenaPagerEnabled((current) => current ? false : current);
  }, []);

  const unlockArenaPager = useCallback(() => {
    if (pagerUnlockTimer.current) clearTimeout(pagerUnlockTimer.current);
    pagerUnlockTimer.current = setTimeout(() => {
      setArenaPagerEnabled((current) => current ? current : true);
    }, 120);
  }, []);

  const horizontalGestureGuard = useMemo<ArenaHorizontalGestureGuard>(() => ({
    onHorizontalGestureStart: lockArenaPager,
    onHorizontalGestureEnd: unlockArenaPager,
  }), [lockArenaPager, unlockArenaPager]);

  const hmc = useCallback((m:number) => {
    if (m === am) return;
    fireSelectionHaptic();
    pagerRef.current?.setPage(m);
    setAm(m);
  }, [am]);

  const onArenaPageSelected = useCallback((event: any) => {
    const next = event.nativeEvent.position;
    if (typeof next !== 'number' || next === am) return;
    fireSelectionHaptic();
    setAm(next);
  }, [am]);

  const renderPremiumArenaChrome = useCallback(() => (
    <ArenaChrome
      selected={sf}
      onSelect={setSf}
      available={availableSports}
      showModes
      active={am}
      onChange={hmc}
      hasLive={live.length>0}
      {...horizontalGestureGuard}
    />
  ), [am, availableSports, hmc, horizontalGestureGuard, live.length, sf]);
  const isInitialArenaLoading = isLoading && !(allGames?.length);

  if (isInitialArenaLoading || !contentReady) {
    return (
      <SafeAreaView edges={['top']} style={{flex:1, backgroundColor:BG}}>
        <ErrorBoundary>
          <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ minHeight: '100%', paddingBottom: arenaBottomPadding }} scrollIndicatorInsets={{ bottom: arenaBottomPadding }}>
            <ArenaChrome selected={sf} onSelect={setSf} available={availableSports} showModes={false} active={am} onChange={hmc} hasLive={live.length>0} />
            <ArenaLoadingWarmup />
          </Animated.ScrollView>
        </ErrorBoundary>
      </SafeAreaView>
    );
  }

  if (!isPremium) {
    return (
      <SafeAreaView edges={['top']} style={{flex:1, backgroundColor:BG}}>
        <ErrorBoundary>
        <FreeArena
          games={allGames ?? []}
          sportFilter={deferredSf}
          router={router}
          sh={sh}
          onR={onR}
          isR={isR}
          followed={followed}
          bottomPadding={arenaBottomPadding}
          top={<ArenaChrome selected={sf} onSelect={setSf} available={availableSports} showModes={false} active={am} onChange={hmc} hasLive={live.length>0} />}
        />
        </ErrorBoundary>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{flex:1, backgroundColor:BG}}>
      <ErrorBoundary>
        <PagerView
          ref={pagerRef}
          style={{ flex: 1 }}
          initialPage={am}
          scrollEnabled={arenaPagerEnabled}
          overdrag
          offscreenPageLimit={1}
          onPageSelected={onArenaPageSelected}
        >
          <View key="arena-game-day" style={{ width: SW, flex: 1 }}>
            <GameDay
              live={live}
              sched={sched}
              picks={userPicks??[]}
              followed={followed}
              sh={sh}
              onR={onR}
              isR={isR}
              bottomPadding={arenaBottomPadding}
              top={renderPremiumArenaChrome()}
              horizontalGestureGuard={horizontalGestureGuard}
            />
          </View>
          <View key="arena-prep" style={{ width: SW, flex: 1 }}>
            <Prep
              sched={sched}
              picks={userPicks??[]}
              stats={userStats}
              sh={sh}
              onR={onR}
              isR={isR}
              bottomPadding={arenaBottomPadding}
              top={renderPremiumArenaChrome()}
              horizontalGestureGuard={horizontalGestureGuard}
            />
          </View>
          <View key="arena-review" style={{ width: SW, flex: 1 }}>
            <Review
              final={final}
              picks={userPicks??[]}
              stats={userStats}
              sh={sh}
              onR={onR}
              isR={isR}
              bottomPadding={arenaBottomPadding}
              top={renderPremiumArenaChrome()}
            />
          </View>
        </PagerView>
      </ErrorBoundary>
    </SafeAreaView>
  );
}
