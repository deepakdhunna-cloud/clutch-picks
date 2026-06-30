import React, { useState, useMemo, useCallback, useEffect, memo, useRef } from 'react';
import {
  View, Text, Pressable, Dimensions, ActivityIndicator, RefreshControl, ScrollView, TextInput, StyleSheet, InteractionManager, FlatList, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopInsetView } from '@/components/TopInsetView';
import { useRouter, useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withRepeat, Easing, cancelAnimation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import PagerView from 'react-native-pager-view';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { Search, ChevronRight, Plus, Zap, Lock, WifiOff, RefreshCw } from 'lucide-react-native';
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
import { isLiveGameLike, isSuspendedGame, sortSuspendedGamesLast, suspendedLabel, suspendedReasonText, suspendedResumeText } from '@/lib/game-status';
import { cricketLedScoreText, cricketOversText, cricketPlayersCompactText, cricketRequiredText, cricketRoleText, teamScoreText } from '@/lib/cricket-score';
import {
  getCanonicalConfidence,
  getCanonicalFinalPick,
  getCanonicalWinProbabilities,
} from '@/lib/canonical-result';
import { getGamePredictionDisplay } from '@/lib/prediction-display';
import { pruneFollowedGamesForReset, readFollowedGameIds } from '@/lib/followed-games';
import { claimGameNavigation } from '@/lib/game-navigation-guard';
import { guardedRouterPush, guardedRouterReplace } from '@/lib/navigation-guard';
import { useScrollPressGuard } from '@/hooks/useScrollPressGuard';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';
import { SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS } from '@/lib/scroll-performance';
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
import { TennisScoreGrid } from '@/components/sports/TennisScoreGrid';

// ─── COLORS ───
const ERROR_DIM = 'rgba(239,68,68,0.10)';

const { width: SW } = Dimensions.get('window');
const SPORTS = ['All', 'NBA', 'NFL', 'MLB', 'NHL', 'IPL', 'TENNIS', 'NCAAF', 'NCAAB', 'MLS', 'EPL', 'UCL', 'WORLDCUP'] as const;
const ALWAYS_VISIBLE_SPORT_FILTERS = new Set<string>(['IPL', 'TENNIS']);
const SPORT_DISPLAY: Record<string, string> = { NCAAF: 'CFB', NCAAB: 'CBB', TENNIS: 'Tennis', WORLDCUP: 'World Cup', IPL: 'T20' };
const ARENA_SIDE_PADDING = 20;
const ARENA_SECTION_GAP = 28;
const ARENA_CARD_GAP = 18;
const LIVE_INTEL_CARD_GAP = 22;
const INTEL_BODY_COLLAPSE_THRESHOLD = 220;
const MODE_SEGMENT_GAP = 8;
const MODES = ['Game Day', 'Prep Mode', 'Review'] as const;
type LiveIntelType = 'alert' | 'shift' | 'trend' | 'pulse';
type LiveIntelItem = { type: LiveIntelType; title: string; body: string };


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
    guardedRouterPush(router, { pathname: '/game/[id]', params: { id: game.id } });
    fireLightHaptic();
  }, [router, warmGame]);

  return { openGame, warmGame };
}

// ─── DISCLAIMER ───
const Disclaimer = memo(function Disclaimer() {
  return <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.08)', textAlign: 'center', lineHeight: 14, marginTop: 10, paddingHorizontal: ARENA_SIDE_PADDING, marginBottom: 32 }}>AI predictions are for entertainment purposes only. Not financial advice.</Text>;
});

// ─── SECTION HEADING ───
// Shared eyebrow + title + accent-edge heading so every section reads with the
// same hierarchy instead of a mix of bare 12/16px titles. The accent edge ties
// each section to its meaning (live=red, model/upcoming=teal, review=maroon).
const ArenaSectionHeading = memo(function ArenaSectionHeading({
  eyebrow,
  title,
  accent = TEAL,
  right,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'stretch', flex: 1, minWidth: 0, paddingRight: right ? 12 : 0 }}>
        <View style={{ width: 3, borderRadius: 2, backgroundColor: accent, marginRight: 12 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 9.5, fontWeight: '900', color: hexWithAlpha(accent, 0.92), letterSpacing: 2, marginBottom: 4 }} numberOfLines={1}>{eyebrow}</Text>
          <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: '900', color: WHITE }} numberOfLines={1}>{title}</Text>
        </View>
      </View>
      {right ?? null}
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
        marginHorizontal: ARENA_SIDE_PADDING,
        marginTop: 2,
        marginBottom: ARENA_SECTION_GAP,
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'rgba(180,211,235,0.12)',
        backgroundColor: '#05080d',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.34,
        shadowRadius: 26,
        elevation: 14,
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

function ArenaTitlePulse({ color }: { color: string }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - pulse.value),
    transform: [{ scale: 0.8 + pulse.value * 1.75 }],
  }));

  return (
    <View style={{ width: 15, height: 15, alignItems: 'center', justifyContent: 'center', marginRight: 9 }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 13,
            height: 13,
            borderRadius: 6.5,
            backgroundColor: color,
          },
          ringStyle,
        ]}
      />
      <View
        style={{
          width: 9,
          height: 9,
          borderRadius: 4.5,
          backgroundColor: color,
          shadowColor: color,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.9,
          shadowRadius: 6,
        }}
      />
    </View>
  );
}

const ARENA_MODE_BANNER_TOP_LINE_ALPHA = 0.58;
const ARENA_MODE_BANNER_BOTTOM_LINE_ALPHA = 0.36;
const ARENA_MODE_BANNER_TOP_LINE_HEIGHT = 1.5;
const ARENA_MODE_BANNER_BOTTOM_LINE_HEIGHT = 1.25;

const ArenaModeTitleBanner = memo(function ArenaModeTitleBanner({
  title,
  subtitle,
  accent,
  showPulse = false,
  subtitleOpacity = 0.78,
}: {
  title: string;
  subtitle: string;
  accent: string;
  showPulse?: boolean;
  subtitleOpacity?: number;
}) {
  return (
    <View
      style={{
        marginHorizontal: ARENA_SIDE_PADDING,
        marginTop: 2,
        marginBottom: 16,
        paddingVertical: 13,
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0)', hexWithAlpha(accent, ARENA_MODE_BANNER_TOP_LINE_ALPHA), 'rgba(255,255,255,0)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: ARENA_MODE_BANNER_TOP_LINE_HEIGHT }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0)', hexWithAlpha(accent, ARENA_MODE_BANNER_BOTTOM_LINE_ALPHA), 'rgba(255,255,255,0)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 18, right: 18, bottom: 0, height: ARENA_MODE_BANNER_BOTTOM_LINE_HEIGHT }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        {showPulse ? <ArenaTitlePulse color={accent} /> : null}
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          numberOfLines={1}
          style={{
            color: WHITE,
            fontFamily: 'BebasNeue_400Regular',
            fontSize: 38,
            lineHeight: 40,
            letterSpacing: 1.2,
            includeFontPadding: false,
          }}
        >
          {title.toUpperCase()}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          color: hexWithAlpha(accent, subtitleOpacity),
          fontSize: 10,
          lineHeight: 13,
          fontWeight: '900',
          letterSpacing: 1.5,
          marginTop: 4,
          includeFontPadding: false,
        }}
      >
        {subtitle}
      </Text>
    </View>
  );
});

const GameDayTitleBanner = memo(function GameDayTitleBanner({ liveCount }: { liveCount: number }) {
  const accent = liveCount > 0 ? LIVE_RED : TEAL;
  const subtitle = 'TODAY\'S SLATE COMMAND CENTER';

  return (
    <ArenaModeTitleBanner
      title="Game Day"
      subtitle={subtitle}
      accent={accent}
      showPulse={liveCount > 0}
      subtitleOpacity={liveCount > 0 ? 0.92 : 0.78}
    />
  );
});

// ─── SEARCH BAR ───
const ARENA_CHROME_ACCENT = TEAL;
const ARENA_TITLE_FONT_SIZE = 24;
const ARENA_TITLE_LINE_HEIGHT = 28;
const SEARCH_BAR_ICON_SIZE = 26;
const SEARCH_BAR_ICON_RADIUS = 9;
const SEARCH_BAR_TEXT_SIZE = 12.8;
const searchBarOuter = {
  paddingHorizontal: ARENA_SIDE_PADDING,
  paddingTop: 8,
  marginBottom: 9,
} as const;
const searchBarInner = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  backgroundColor: 'rgba(5,8,13,0.96)',
  borderWidth: 1.5,
  borderColor: hexWithAlpha(ARENA_CHROME_ACCENT, 0.26),
  borderRadius: 13,
  paddingVertical: 7,
  paddingHorizontal: 11,
} as const;
const SearchBar = memo(function SearchBar() {
  const router = useRouter();
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(),
    []
  );
  return (
    <View style={searchBarOuter}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text adjustsFontSizeToFit minimumFontScale={0.88} numberOfLines={1} style={{ color: WHITE, fontSize: ARENA_TITLE_FONT_SIZE, lineHeight: ARENA_TITLE_LINE_HEIGHT, fontWeight: '900', letterSpacing: 0 }}>
            My Arena
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', paddingBottom: 2 }}>
          <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: hexWithAlpha(ARENA_CHROME_ACCENT, 0.10), borderWidth: 1, borderColor: hexWithAlpha(ARENA_CHROME_ACCENT, 0.18) }}>
            <Text style={{ color: ARENA_CHROME_ACCENT, fontSize: 8.8, fontWeight: '900', letterSpacing: 1.35 }}>{dateLabel}</Text>
          </View>
        </View>
      </View>
      <Pressable
        onPress={() => {
          fireLightHaptic();
          guardedRouterPush(router, '/search-explore');
        }}
        accessibilityRole="button"
        accessibilityLabel="Open arena search"
        accessibilityHint="Opens the full arena search screen"
        style={({ pressed }) => ({
          opacity: pressed ? 0.86 : 1,
          transform: [{ scale: pressed ? 0.995 : 1 }],
        })}
      >
        <LinearGradient
          colors={[hexWithAlpha(ARENA_CHROME_ACCENT, 0.30), hexWithAlpha(ARENA_CHROME_ACCENT, 0.12), 'rgba(255,255,255,0.045)', hexWithAlpha(ARENA_CHROME_ACCENT, 0.18)]}
          locations={[0, 0.44, 0.58, 1]}
          start={{ x: 0.05, y: 0 }}
          end={{ x: 0.95, y: 1 }}
          style={{
            borderRadius: 14,
            padding: 1.25,
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.26,
            shadowRadius: 15,
            elevation: 8,
          }}
        >
          <View style={searchBarInner}>
            <View style={{ width: SEARCH_BAR_ICON_SIZE, height: SEARCH_BAR_ICON_SIZE, borderRadius: SEARCH_BAR_ICON_RADIUS, backgroundColor: hexWithAlpha(ARENA_CHROME_ACCENT, 0.11), borderWidth: 1.5, borderColor: hexWithAlpha(ARENA_CHROME_ACCENT, 0.34), alignItems: 'center', justifyContent: 'center' }}>
              <Search size={14} color={ARENA_CHROME_ACCENT} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
              <Text style={{ fontSize: SEARCH_BAR_TEXT_SIZE, color: 'rgba(248,250,252,0.92)', fontWeight: '800' }}>
                Search the slate
              </Text>
            </View>
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
});

// ─── SPORT PILLS ───
const SPORT_PILL_COMPACT_HEIGHT = 25;
const SPORT_PILL_DEFAULT_HEIGHT = 28;
const SPORT_PILL_COMPACT_MARGIN = 8;
const SPORT_PILL_DEFAULT_MARGIN = 10;
const SportPills = memo(function SportPills({
  selected,
  onSelect,
  available,
  counts,
  compact = false,
  alwaysShowSpecialSports = true,
  sidePadding = ARENA_SIDE_PADDING,
  bottomMargin = 14,
}: {
  selected: string;
  onSelect: (s: string) => void;
  available?: Set<string>;
  counts?: Map<string, number>;
  compact?: boolean;
  alwaysShowSpecialSports?: boolean;
  sidePadding?: number;
  bottomMargin?: number;
}) {
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
  const {
    onTouchStart: onPillTouchStart,
    onTouchMove: onPillTouchMove,
    onTouchCancel: onPillTouchCancel,
    shouldHandlePress: shouldHandlePillPress,
  } = useTapGestureGuard(6, 500);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, marginBottom: bottomMargin }}
      contentContainerStyle={{ paddingLeft: sidePadding, paddingRight: sidePadding, paddingVertical: 2, flexDirection: 'row', alignItems: 'center' }}

    >
      {visible.map((s, index) => {
        const on = selected === s;
        const count = counts?.get(s);
        const label = count !== undefined && counts ? `${SPORT_DISPLAY[s] ?? s} ${count}` : (SPORT_DISPLAY[s] ?? s);
        return (
          <Pressable
            key={s}
            onPress={() => {
              if (!shouldHandlePillPress()) return;
              if (!on) fireSelectionHaptic();
              onSelect(s);
            }}
            onTouchStart={onPillTouchStart}
            onTouchMove={onPillTouchMove}
            onTouchCancel={onPillTouchCancel}
            pressRetentionOffset={6}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${SPORT_DISPLAY[s] ?? s}${count !== undefined && counts ? `, ${count} games` : ''} filter`}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              marginRight: index === visible.length - 1 ? 0 : (compact ? SPORT_PILL_COMPACT_MARGIN : SPORT_PILL_DEFAULT_MARGIN),
            }}
          >
            <LinearGradient
              colors={on
                ? [hexWithAlpha(ARENA_CHROME_ACCENT, 0.58), hexWithAlpha(ARENA_CHROME_ACCENT, 0.24), 'rgba(255,255,255,0.065)', hexWithAlpha(ARENA_CHROME_ACCENT, 0.32)]
                : [hexWithAlpha(ARENA_CHROME_ACCENT, 0.34), hexWithAlpha(ARENA_CHROME_ACCENT, 0.14)]}
              locations={on ? [0, 0.42, 0.6, 1] : undefined}
              start={{ x: 0.05, y: 0 }}
              end={{ x: 0.95, y: 1 }}
              style={{
                borderRadius: 15,
                height: compact ? SPORT_PILL_COMPACT_HEIGHT : SPORT_PILL_DEFAULT_HEIGHT,
                minWidth: compact ? (s === 'All' ? 40 : s === 'TENNIS' ? 64 : 50) : (s === 'All' ? 44 : s === 'TENNIS' ? 74 : 56),
                padding: 1.5,
                shadowColor: '#000000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.2,
                shadowRadius: 8,
                elevation: 4,
              }}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? 'rgba(7,10,16,0.58)' : 'rgba(7,10,16,0.88)',
                  paddingHorizontal: compact ? 8 : 10,
                }}
              >
                <Text numberOfLines={1} style={{ fontSize: compact ? 10.2 : 11, lineHeight: compact ? 12.5 : 13.5, fontWeight: on ? '800' : '600', color: on ? WHITE : ARENA_CHROME_ACCENT, letterSpacing: on ? 0 : 0.25, includeFontPadding: false }}>{label}</Text>
              </View>
            </LinearGradient>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

// ─── SEGMENTED PILL ───
// Vertical footprint of the segmented mode pill: raised gradient rim (2 top +
// 2 bottom) + inner minHeight (44) + tightened gap below (8) = 52px. Reserved
// in the loading state so the page does not jump up when modes appear after data
// resolves. Kept as a constant so the loading spacer always tracks the pill.
const SEG_PILL_INNER_MIN_HEIGHT = 44;
const SEG_PILL_BOTTOM_MARGIN = 8;
const SEG_PILL_RESERVED_HEIGHT = SEG_PILL_INNER_MIN_HEIGHT + 4 + SEG_PILL_BOTTOM_MARGIN;
const ARENA_SEGMENT_ACTIVE_GRADIENT = [hexWithAlpha(ARENA_CHROME_ACCENT, 0.52), hexWithAlpha(ARENA_CHROME_ACCENT, 0.17), 'rgba(255,255,255,0.055)', hexWithAlpha(ARENA_CHROME_ACCENT, 0.28)] as const;
const ARENA_SEGMENT_INACTIVE_GRADIENT = [hexWithAlpha(ARENA_CHROME_ACCENT, 0.11), hexWithAlpha(ARENA_CHROME_ACCENT, 0.035)] as const;
const ARENA_SEGMENT_ACTIVE_LOCATIONS = [0, 0.42, 0.6, 1] as const;
const ARENA_SEGMENT_ACTIVE_BACKGROUND = 'rgba(7,10,16,0.54)';
const ARENA_SEGMENT_INACTIVE_BACKGROUND = 'rgba(7,10,16,0.70)';
const SegPill = memo(function SegPill({ active, onChange }: { active: number; onChange: (n: number) => void; hasLive: boolean }) {
  return (
    <View style={{ paddingHorizontal: ARENA_SIDE_PADDING, marginBottom: SEG_PILL_BOTTOM_MARGIN }}>
      <LinearGradient
        colors={[hexWithAlpha(ARENA_CHROME_ACCENT, 0.24), 'rgba(255,255,255,0.055)', 'rgba(255,255,255,0.055)', hexWithAlpha(ARENA_CHROME_ACCENT, 0.16)]}
        locations={[0, 0.44, 0.58, 1]}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={{
          borderRadius: 20,
          padding: 2,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.24,
          shadowRadius: 14,
          elevation: 8,
        }}
      >
        <View style={{ minHeight: SEG_PILL_INNER_MIN_HEIGHT, backgroundColor: 'rgba(5,8,13,0.78)', borderRadius: 18, padding: 4, flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden' }}>
          {MODES.map((l, i) => {
            const isActive = active === i;
            return (
              <Pressable
                key={l}
                onPress={() => onChange(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`${l} view`}
                style={{
                  flex: 1,
                  minHeight: 44,
                  justifyContent: 'center',
                  marginRight: i === MODES.length - 1 ? 0 : MODE_SEGMENT_GAP,
                  minWidth: 0,
                }}
              >
                <LinearGradient
                  colors={isActive ? ARENA_SEGMENT_ACTIVE_GRADIENT : ARENA_SEGMENT_INACTIVE_GRADIENT}
                  locations={isActive ? ARENA_SEGMENT_ACTIVE_LOCATIONS : undefined}
                  start={{ x: 0.05, y: 0 }}
                  end={{ x: 0.95, y: 1 }}
                  style={{ minHeight: 34, borderRadius: 15, padding: 1 }}
                >
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      overflow: 'hidden',
                      backgroundColor: isActive ? ARENA_SEGMENT_ACTIVE_BACKGROUND : ARENA_SEGMENT_INACTIVE_BACKGROUND,
                      paddingHorizontal: 6,
                    }}
                  >
                    <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={{ flexShrink: 1, fontSize: 11.8, lineHeight: 15, fontWeight: isActive ? '900' : '800', color: isActive ? WHITE : hexWithAlpha(ARENA_CHROME_ACCENT, 0.84), letterSpacing: 0, includeFontPadding: false }}>
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
}: {
  selected: string;
  onSelect: (s: string) => void;
  available?: Set<string>;
  showModes?: boolean;
  active: number;
  onChange: (n: number) => void;
  hasLive: boolean;
}) {
  return (
    <>
      <SearchBar />
      {showModes ? <SegPill active={active} onChange={onChange} hasLive={hasLive} /> : null}
      <SportPills
        selected={selected}
        onSelect={onSelect}
        available={available}
        compact={showModes}
        bottomMargin={showModes ? 10 : 14}
      />
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

// Shown when the slate fetch fails and there is no cached board to fall back
// on. Without this the screen would silently render empty placeholders with no
// explanation and no retry path other than an undiscoverable pull-to-refresh.
const ArenaErrorState = memo(function ArenaErrorState({ onRetry, isRetrying }: { onRetry: () => void; isRetrying: boolean }) {
  return (
    <View style={{ paddingHorizontal: ARENA_SIDE_PADDING, paddingTop: 8, paddingBottom: 80, gap: 16 }}>
      <View
        style={{
          borderRadius: 18,
          borderWidth: 2,
          borderColor: 'rgba(180,211,235,0.12)',
          backgroundColor: 'rgba(5,8,13,0.96)',
          padding: 22,
          alignItems: 'center',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.3,
          shadowRadius: 22,
          elevation: 12,
        }}
      >
        <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(122,157,184,0.1)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.2)', marginBottom: 16 }}>
          <WifiOff size={22} color={TEAL} strokeWidth={2.4} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: '900', color: WHITE, textAlign: 'center' }}>Couldn’t load the slate</Text>
        <Text style={{ fontSize: 12.5, lineHeight: 19, fontWeight: '700', color: TEXT_SECONDARY, textAlign: 'center', marginTop: 8, maxWidth: 280 }}>
          We couldn’t reach the live board. Check your connection and try again.
        </Text>
        <Pressable
          onPress={onRetry}
          disabled={isRetrying}
          accessibilityRole="button"
          accessibilityLabel="Retry loading games"
          accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
          style={({ pressed }) => ({
            marginTop: 18,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 46,
            paddingHorizontal: 22,
            borderRadius: 14,
            backgroundColor: 'rgba(122,157,184,0.12)',
            borderWidth: 1,
            borderColor: 'rgba(122,157,184,0.28)',
            opacity: isRetrying ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          {isRetrying ? (
            <ActivityIndicator size="small" color={TEAL} />
          ) : (
            <RefreshCw size={15} color={TEAL} strokeWidth={2.6} />
          )}
          <Text style={{ fontSize: 13, fontWeight: '900', color: TEAL, letterSpacing: 0.4, marginLeft: 9 }}>
            {isRetrying ? 'Retrying…' : 'Try again'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

const ArenaScrollView = memo(function ArenaScrollView({
  sh,
  onR,
  isR,
  bottomPadding,
  resetSignal,
  children,
}: {
  sh: any;
  onR: () => void;
  isR: boolean;
  bottomPadding: number;
  resetSignal?: number;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<ScrollView | null>(null);
  const animatedScrollRef = scrollRef as unknown as React.Ref<React.ElementRef<typeof Animated.ScrollView>>;

  useEffect(() => {
    if (typeof resetSignal !== 'number') return undefined;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo?.({ y: 0, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [resetSignal]);

  return (
    <Animated.ScrollView
      ref={animatedScrollRef}
      onScroll={sh}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      scrollIndicatorInsets={{ bottom: bottomPadding }}
      refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}
    >
      {children}
    </Animated.ScrollView>
  );
});

type FinalTeamResult = 'winner' | 'loser' | 'neutral';
const FOLLOWED_CARD_W = Math.min(360, Math.max(320, SW - 36));
const FOLLOWED_CARD_SIDE_PADDING = Math.max(ARENA_SIDE_PADDING, (SW - FOLLOWED_CARD_W) / 2);

const FollowedCard = memo(function FollowedCard({ game }: { game: GameWithPrediction }) {
  const { openGame, warmGame } = useGameDetailActions();
  // Per-item guard: this card lives in a horizontal FlatList, so a swipe across
  // it must not fire a tap and open the wrong game.
  const { onTouchStart, onTouchMove, onTouchCancel, shouldHandlePress } = useTapGestureGuard(6, 500);
  const live = isLiveGameLike(game);
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
  const tier = prediction ? getConfidenceTier(getCanonicalConfidence(prediction), predictionDisplay?.isTossUp, predictionDisplay?.marketType) : null;
  const startLabel =
    game.sport === Sport.MLB ? 'First Pitch' :
    game.sport === Sport.IPL ? 'First Ball' :
    game.sport === Sport.TENNIS ? 'First Serve' :
    game.sport === Sport.NBA || game.sport === Sport.NCAAB ? 'Tipoff' :
    game.sport === Sport.NHL ? 'Puck Drop' :
    game.sport === Sport.MLS || game.sport === Sport.EPL || game.sport === Sport.UCL || game.sport === Sport.WORLDCUP ? 'Kickoff' :
    'Starts';
  const centerLabel = live ? (formatGameTime(game.sport, game.quarter, game.clock) ?? 'Live Now') : final ? 'Final' : startLabel;
  const finalOutcomeLabel = winningTeam ? `${winningTeam.name} WINS` : tiedFinal ? 'DRAW' : null;
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
          <Text adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: result === 'winner' ? '#FFFFFF' : WHITE, fontSize: 14, fontWeight: '900', letterSpacing: 0 }} numberOfLines={1}>
            {team.name}
          </Text>
          <Text style={{ color: result === 'winner' ? hexWithAlpha(accent, 0.9) : 'rgba(255,255,255,0.48)', fontSize: 9.5, fontWeight: '800', marginTop: 1 }} numberOfLines={1}>
            {team.abbreviation}
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
      onPress={() => { if (!shouldHandlePress()) return; openGame(game); }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}
      accessibilityHint="Opens game details"
      pressRetentionOffset={6}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      style={({ pressed }) => ({
        width: FOLLOWED_CARD_W,
        borderRadius: 30,
        overflow: 'hidden',
        // Skinny hairline edge — a single cool-blue line that reads as a crisp
        // border without the heavy 2px frame.
        borderWidth: 1,
        borderColor: 'rgba(180,211,235,0.38)',
        backgroundColor: '#0b1119',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 13 },
        shadowOpacity: 0.34,
        shadowRadius: 26,
        elevation: 14,
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View style={{ padding: 12, minHeight: 162, borderRadius: 28, backgroundColor: '#0b1119', overflow: 'hidden' }}>
        {/* Team-color wash so the card carries its teams' identity instead of
            blending into the dark page: away color bleeds from the top-left, home
            from the bottom-right, with a bottom darken to keep names/scores crisp. */}
        <LinearGradient pointerEvents="none" colors={[hexWithAlpha(awayColors.accent, 0.30), hexWithAlpha(awayColors.accent, 0.10), 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.72, y: 0.85 }} style={StyleSheet.absoluteFillObject} />
        <LinearGradient pointerEvents="none" colors={[hexWithAlpha(homeColors.accent, 0.30), hexWithAlpha(homeColors.accent, 0.10), 'transparent']} start={{ x: 1, y: 1 }} end={{ x: 0.28, y: 0.15 }} style={StyleSheet.absoluteFillObject} />
        <LinearGradient pointerEvents="none" colors={['rgba(5,8,13,0)', 'rgba(5,8,13,0.5)']} start={{ x: 0.5, y: 0.35 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFillObject} />
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
}: { games: GameWithPrediction[] }) {
  const router = useRouter();
  const orderedGames = useMemo(() => {
    const priority = (game: GameWithPrediction) =>
      isLiveGameLike(game) ? (isSuspendedGame(game) ? 1 : 0) :
      game.status === GameStatus.SCHEDULED ? 2 :
      game.status === GameStatus.FINAL ? 3 :
      3;
    return [...games].sort((a, b) => {
      const p = priority(a) - priority(b);
      if (p !== 0) return p;
      return new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime();
    });
  }, [games]);

  if (games.length === 0) return (
    <View style={{ marginHorizontal: 20, marginBottom: ARENA_SECTION_GAP }}>
      <Pressable
        onPress={() => { fireLightHaptic(); guardedRouterReplace(router, '/(tabs)'); }}
        accessibilityRole="button"
        accessibilityLabel="Track games"
        accessibilityHint="Opens the main slate to add games to your arena"
        style={{
          borderRadius: 30,
          overflow: 'hidden',
          backgroundColor: 'rgba(10,15,22,0.98)',
          borderWidth: 2,
          borderColor: 'rgba(122,157,184,0.16)',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 13 },
          shadowOpacity: 0.32,
          shadowRadius: 24,
          elevation: 12,
        }}
      >
        <View style={{ padding: 16, borderRadius: 30, backgroundColor: 'rgba(10,15,22,0.98)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: TEAL }} />
                <Text style={{ color: 'rgba(224,234,240,0.46)', fontSize: 8.5, fontWeight: '900', letterSpacing: 1.8, marginLeft: 7 }}>WATCHLIST</Text>
              </View>
              <Text style={{ color: WHITE, fontSize: 20, fontWeight: '900', letterSpacing: 0 }}>Track your games</Text>
              <Text style={{ color: TEXT_SECONDARY, fontSize: 12.5, lineHeight: 18, marginTop: 4 }}>Add games or teams to keep scores, starts, and recaps in one focused view.</Text>
            </View>
            <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(122,157,184,0.11)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.2)', flexShrink: 0 }}>
              <Plus size={20} color={TEAL} strokeWidth={2.7} />
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
  return (
    <View style={{ marginBottom: ARENA_SECTION_GAP }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginBottom: 8 }}>
        <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2 }}>WATCHLIST {orderedGames.length}</Text>
        <Pressable
          onPress={() => { fireLightHaptic(); guardedRouterReplace(router, '/(tabs)'); }}
          accessibilityRole="button"
          accessibilityLabel="Browse games"
          accessibilityHint="Opens the main slate to add games to your arena"
          hitSlop={8}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: 'rgba(122,157,184,0.09)',
            borderWidth: 1,
            borderColor: 'rgba(122,157,184,0.18)',
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '900', color: TEAL }}>Browse</Text>
          <View style={{ marginLeft: 6 }}>
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
        contentContainerStyle={{ paddingHorizontal: FOLLOWED_CARD_SIDE_PADDING, paddingBottom: 4 }}
        ItemSeparatorComponent={() => <View style={{ width: ARENA_CARD_GAP }} />}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FollowedCard game={item} />}
        getItemLayout={(_, index) => ({ length: FOLLOWED_CARD_W + ARENA_CARD_GAP, offset: (FOLLOWED_CARD_W + ARENA_CARD_GAP) * index, index })}
        style={{ flexGrow: 0 }}
      />
    </View>
  );
});

// ─── LIVE CARD (My Arena) ───────────────────────────────────────
// Refined live card that ties My Arena visually to the home-page LED design
// language: team-color washes flank a dark base, an inline LED scoreboard sits
// in the middle, and three compact stat tiles sit below a hairline divider.

// Maps the existing confidence ladder to the user-facing strength labels
// used by this card. Distinct from getConfidenceTier (which is the global
// neutral palette) — these labels and colors only appear here.
function getPickStrengthDisplay(confidence: number, isTossUp?: boolean, marketType?: 'moneyline' | 'three_way_result' | null): { label: string; color: string } {
  if (isTossUp) return { label: 'Avoid',  color: '#ef4444' };
  if (marketType === 'three_way_result' || confidence < 50) {
    if (confidence < 37) return { label: 'Avoid',  color: '#ef4444' };
    if (confidence < 43) return { label: 'Lean',   color: '#facc15' };
    if (confidence < 50) return { label: 'Solid',  color: '#4ade80' };
    if (confidence < 58) return { label: 'Strong', color: '#86efac' };
    return                      { label: 'Lock',   color: '#f8fafc' };
  }
  if (confidence < 53) return { label: 'Avoid',  color: '#ef4444' };
  if (confidence < 60)             return { label: 'Lean',   color: '#facc15' };
  if (confidence < 67)             return { label: 'Solid',  color: '#4ade80' };
  if (confidence < 75)             return { label: 'Strong', color: '#86efac' };
  return                                  { label: 'Lock',   color: '#f8fafc' };
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

// Soft black radial shadow that grounds the jerseys and scoreboard against the
// team-color wash — mirrors the one used on the "Live Now" LiveArenaCard. A
// many-stop ease-out curve fades fully to transparent at the edge, so it spreads
// smoothly with no hard line or banding. Rendered once and static (no per-frame
// work), so it stays cheap inside the scrolling live board.
const SoftGlow = memo(function SoftGlow({ width, height, intensity }: { width: number; height: number; intensity: number }) {
  return (
    <Svg width={width} height={height} pointerEvents="none">
      <Defs>
        <RadialGradient id="liveCardSoftGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#000000" stopOpacity={intensity} />
          <Stop offset="12%" stopColor="#000000" stopOpacity={intensity * 0.92} />
          <Stop offset="24%" stopColor="#000000" stopOpacity={intensity * 0.8} />
          <Stop offset="36%" stopColor="#000000" stopOpacity={intensity * 0.65} />
          <Stop offset="48%" stopColor="#000000" stopOpacity={intensity * 0.5} />
          <Stop offset="60%" stopColor="#000000" stopOpacity={intensity * 0.35} />
          <Stop offset="72%" stopColor="#000000" stopOpacity={intensity * 0.21} />
          <Stop offset="82%" stopColor="#000000" stopOpacity={intensity * 0.11} />
          <Stop offset="90%" stopColor="#000000" stopOpacity={intensity * 0.05} />
          <Stop offset="96%" stopColor="#000000" stopOpacity={intensity * 0.018} />
          <Stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill="url(#liveCardSoftGlow)" />
    </Svg>
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

// ─── MATCHUP TITLE WRAP ───
// Builds a matchup title that only ever breaks at SENSIBLE points: between the two
// sides (" vs ") and between doubles partners (" / "). Inside each person/team name
// the regular spaces are swapped for non-breaking spaces (U+00A0) so a name like
// "Aidan Mayo" or "Johannus Monday" can never split mid-name or strand a trailing
// word. Result: singles break cleanly at " vs "; doubles can break at " / " or " vs "
// while every name stays intact. Pairs with numberOfLines={2} + a gentle
// adjustsFontSizeToFit floor for the longest doubles sides. Never abbreviates.
const NBSP = String.fromCharCode(0x00a0); // U+00A0 non-breaking space
// Within each person, swap regular spaces for NBSP so "Aidan Mayo" never splits.
// Keep " / " (doubles partners) breakable so partners can wrap cleanly.
function protectName(name: string): string {
  return name
    .split(' / ')
    .map((person) => person.trim().replace(/ /g, NBSP))
    .join(' / ');
}
function matchupTitle(awayName: string, homeName: string): string {
  return `${protectName(awayName)} vs ${protectName(homeName)}`;
}

function compactTennisPlayerName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const parts = trimmed.split(' ').filter(Boolean);
  if (parts.length < 2) return trimmed;
  return `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`;
}

const LiveCard = memo(function LiveCard({
  game,
  pick,
  cardWidth,
  showModelEdge = true,
  showMomentum = true,
  canOpen,
}: {
  game: GameWithPrediction;
  pick?: UserPick;
  cardWidth: number;
  showModelEdge?: boolean;
  showMomentum?: boolean;
  canOpen?: () => boolean;
}) {
  const { openGame, warmGame } = useGameDetailActions();
  // Per-item guard: this card lives in a horizontal snap FlatList, so a swipe
  // must not register as a tap and open the wrong live game.
  const { onTouchStart, onTouchMove, onTouchCancel, shouldHandlePress } = useTapGestureGuard(6, 500);
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
  const isTennis = game.sport === Sport.TENNIS;
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
    livePredictionDisplay?.marketType,
  );
  const homeLeading = hs > as2;
  const awayLeading = as2 > hs;
  const leaderColor = homeLeading ? homeAccent : awayLeading ? awayAccent : TEAL;
  const scoreGap = Math.abs(hs - as2);
  const pickStatusColor = !pick ? '#6b7280' : lead ? '#4ade80' : ps === os ? '#facc15' : LIVE_RED;
  const pickStatusText = !pick ? 'No pick set' : lead ? `Up ${scoreGap}` : ps === os ? 'Even' : `Down ${scoreGap}`;
  const innerPadX = 14;
  const borderWidth = 2.5;
  const bodyGap = 8;
  const scoreColumnWidth = Math.min(130, Math.max(110, cardWidth * 0.36));
  const teamColumnWidth = (cardWidth - borderWidth * 2 - innerPadX * 2 - scoreColumnWidth - bodyGap * 2) / 2;
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

  const tennisScoreScale = 0.82;
  const tennisScoreWidth = scoreColumnWidth;

  const renderTennisTeam = (
    side: 'home' | 'away',
    colors: { primary: string; secondary: string; accent?: string },
    leading: boolean,
    otherLeading: boolean,
  ) => {
    const team = side === 'home' ? game.homeTeam : game.awayTeam;
    const record = team.record?.trim();

    return (
      <View style={{ width: teamColumnWidth, alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
        <View style={{ height: 78, alignItems: 'center', justifyContent: 'center', opacity: leading || !otherLeading ? 1 : 0.66, transform: [{ scale: leading ? 1.04 : 1 }] }}>
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <SoftGlow width={62 * 1.72} height={62 * 1.72} intensity={0.72} />
          </View>
          <TeamJersey
            teamAbbreviation={team.abbreviation}
            teamName={team.name}
            primaryColor={colors.primary}
            secondaryColor={colors.secondary}
            size={62}
            sport={game.sport as Sport}
          />
        </View>
        {record ? (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={{
              alignSelf: 'stretch',
              color: leading ? '#d1d5db' : '#8b95a5',
              fontSize: 9.5,
              fontWeight: '800',
              lineHeight: 12,
              marginTop: 4,
              textAlign: 'center',
            }}
          >
            {record}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          style={{
            alignSelf: 'stretch',
            color: '#f8fafc',
            fontSize: 12.4,
            fontWeight: '900',
            lineHeight: 15,
            marginTop: record ? 2 : 5,
            minHeight: 15,
            textAlign: 'center',
          }}
        >
          {compactTennisPlayerName(team.name)}
        </Text>
      </View>
    );
  };

  const renderTennisBody = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 1, paddingBottom: 16, minHeight: 148 }}>
      {renderTennisTeam('home', homeColors, homeLeading, awayLeading)}

      <View style={{ width: tennisScoreWidth, flexShrink: 0, alignItems: 'center', justifyContent: 'center', marginHorizontal: bodyGap / 2 }}>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <SoftGlow width={tennisScoreWidth * 1.08} height={(59.16 * tennisScoreScale + 2) * 1.62} intensity={0.6} />
          </View>
          <SharedArenaScoreboard
            awayScore={as2}
            homeScore={hs}
            awayColor={awayAccent}
            homeColor={homeAccent}
            scale={tennisScoreScale}
            label={suspended ? 'SUSPENDED' : undefined}
            subLabel={suspended ? suspensionReason : undefined}
            detailLabel={suspended ? suspensionTime : undefined}
          />
        </View>
        {!suspended ? (
          <View style={{ marginTop: 8, alignItems: 'center', justifyContent: 'center' }}>
            <TennisScoreGrid
              game={game}
              variant="rail"
              homeColor={homeAccent}
              awayColor={awayAccent}
              showTeams={false}
            />
          </View>
        ) : null}
      </View>

      {renderTennisTeam('away', awayColors, awayLeading, homeLeading)}
    </View>
  );

  return (
    <Pressable
      onPressIn={() => warmGame(game)}
      onPress={() => { if (!shouldHandlePress() || (canOpen && !canOpen())) return; openGame(game); }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}
      accessibilityHint="Opens game details"
      pressRetentionOffset={6}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      style={({ pressed }) => ({
        width: cardWidth,
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View
        style={{
          borderRadius: 28,
          backgroundColor: '#05080d',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 15 },
          shadowOpacity: 0.36,
          shadowRadius: 28,
          elevation: 16,
        }}
      >
        <LinearGradient
          colors={[
            'rgba(224,234,240,0.92)',
            hexWithAlpha(homeAccent, 0.6),
            'rgba(49,63,78,0.34)',
            hexWithAlpha(awayAccent, 0.6),
            'rgba(224,234,240,0.74)',
          ]}
          locations={[0, 0.24, 0.52, 0.78, 1]}
          start={{ x: 0.08, y: 0 }}
          end={{ x: 0.92, y: 1 }}
          style={{ borderRadius: 28, padding: 2.5 }}
        >
          <View
            style={{
              borderRadius: 25.5,
              overflow: 'hidden',
              paddingTop: 14,
              paddingBottom: 15,
              paddingHorizontal: innerPadX,
              backgroundColor: 'rgba(5,8,13,0.96)',
            }}
          >
        {/* Dark glass base — keeps the card cheap to mount during tab switches. */}
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(4,6,11,0.9)' }]} />

        {/* Home team color — vivid corner bleed from the top-left (home side). */}
        <LinearGradient
          colors={[hexWithAlpha(homeAccent, 0.93), hexWithAlpha(homeAccent, 0.5), hexWithAlpha(homeAccent, 0.18), 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.74, y: 0.85 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {/* Away team color — vivid corner bleed from the bottom-right (away side). */}
        <LinearGradient
          colors={[hexWithAlpha(awayAccent, 0.93), hexWithAlpha(awayAccent, 0.5), hexWithAlpha(awayAccent, 0.18), 'transparent']}
          start={{ x: 1, y: 1 }}
          end={{ x: 0.26, y: 0.15 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {/* Center crush — keeps the LED scoreboard column crisp against the colors. */}
        <LinearGradient
          colors={['transparent', 'rgba(2,3,8,0.62)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {/* Lower darken — keeps team names, records, and stat tiles readable. */}
        <LinearGradient
          colors={['transparent', 'rgba(3,5,10,0.5)']}
          start={{ x: 0.5, y: 0.42 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {/* Subtle glass gloss. */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.05)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {/* Side rails tinted to each team (home left, away right). */}
        <LinearGradient
          colors={['transparent', hexWithAlpha(homeAccent, 0.6), 'transparent']}
          style={{ position: 'absolute', left: 1, top: 32, bottom: 32, width: 1.6 }}
        />
        <LinearGradient
          colors={['transparent', hexWithAlpha(awayAccent, 0.6), 'transparent']}
          style={{ position: 'absolute', right: 1, top: 32, bottom: 32, width: 1.6 }}
        />

        {/* Polished top rail — home → white → away. */}
        <LinearGradient
          colors={['transparent', hexWithAlpha(homeAccent, 0.78), 'rgba(255,255,255,0.72)', hexWithAlpha(awayAccent, 0.78), 'transparent']}
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
            <Text style={{ color: '#ff5a52', fontSize: 10, fontWeight: '900', letterSpacing: 1.7 }}>IN PLAY</Text>
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

        {/* C) Match body — tennis uses player metadata + set scores; other sports keep the team-versus-team layout. */}
        {isTennis ? renderTennisBody() : (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: 1, paddingBottom: 16 }}>
            {/* Home block (left) */}
            <View style={{ width: teamColumnWidth, alignItems: 'center', minWidth: 0 }}>
              <View style={{ height: 78, alignItems: 'center', justifyContent: 'center', opacity: homeLeading || !awayLeading ? 1 : 0.66, transform: [{ scale: homeLeading ? 1.04 : 1 }] }}>
                {/* Soft black shadow grounds the jersey against the team color. */}
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <SoftGlow width={62 * 1.72} height={62 * 1.72} intensity={0.72} />
                </View>
                <TeamJersey
                  teamAbbreviation={game.homeTeam.abbreviation}
                  teamName={game.homeTeam.name}
                  primaryColor={homeColors.primary}
                  secondaryColor={homeColors.secondary}
                  size={62}
                  sport={game.sport as Sport}
                />
              </View>
              <Text adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: '#f8fafc', fontSize: 12.5, fontWeight: '900', lineHeight: 15, textAlign: 'center', marginTop: 5, minHeight: 30, maxWidth: teamColumnWidth }} numberOfLines={2}>
                {game.homeTeam.name}
              </Text>
              {isCricket ? (
                renderCricketTeamMeta(homeScoreLabel, homeCricketRole, homeColors)
              ) : (
                <Text style={{ color: homeLeading ? '#d1d5db' : '#8b95a5', fontSize: 11, fontWeight: '700', marginTop: 3 }}>{game.homeTeam.record}</Text>
              )}
            </View>

            {/* D) LED score panel — same primitives + soft grounding glow as the "Live Now" card. */}
            <View style={{ width: scoreColumnWidth, flexShrink: 0, alignItems: 'center', justifyContent: 'center', marginHorizontal: bodyGap }}>
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                {/* Soft black shadow grounds the LED panel against the team color. */}
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <SoftGlow width={scoreColumnWidth * 1.14} height={(59.16 + 2) * 1.72} intensity={0.62} />
                </View>
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
              </View>
              {!suspended && matchTime ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
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
              <View style={{ height: 78, alignItems: 'center', justifyContent: 'center', opacity: awayLeading || !homeLeading ? 1 : 0.66, transform: [{ scale: awayLeading ? 1.04 : 1 }] }}>
                {/* Soft black shadow grounds the jersey against the team color. */}
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <SoftGlow width={62 * 1.72} height={62 * 1.72} intensity={0.72} />
                </View>
                <TeamJersey
                  teamAbbreviation={game.awayTeam.abbreviation}
                  teamName={game.awayTeam.name}
                  primaryColor={awayColors.primary}
                  secondaryColor={awayColors.secondary}
                  size={62}
                  sport={game.sport as Sport}
                />
              </View>
              <Text adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: '#f8fafc', fontSize: 12.5, fontWeight: '900', lineHeight: 15, textAlign: 'center', marginTop: 5, minHeight: 30, maxWidth: teamColumnWidth }} numberOfLines={2}>
                {game.awayTeam.name}
              </Text>
              {isCricket ? (
                renderCricketTeamMeta(awayScoreLabel, awayCricketRole, awayColors)
              ) : (
                <Text style={{ color: awayLeading ? '#d1d5db' : '#8b95a5', fontSize: 11, fontWeight: '700', marginTop: 3 }}>{game.awayTeam.record}</Text>
              )}
            </View>
          </View>
        )}

        {/* E) Hairline divider */}
        <LinearGradient
          colors={['transparent', 'rgba(122,157,184,0.18)', 'rgba(255,255,255,0.1)', 'rgba(255,255,255,0.1)', 'rgba(139,10,31,0.16)', 'transparent']}
          locations={[0, 0.28, 0.46, 0.56, 0.74, 1]}
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
              borderRadius: 14,
              minHeight: 58,
              justifyContent: 'center',
              paddingVertical: 7,
              paddingHorizontal: 7,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#8a95a6', fontSize: 8, fontWeight: '900', letterSpacing: 1.7, marginBottom: 6 }}>YOUR PICK</Text>
            <Text style={{ color: pick ? '#f8fafc' : '#7a8392', fontSize: 12, fontWeight: '800' }}>
              {pick ? (pt?.abbreviation ?? '--') : 'None'}
            </Text>
            <Text style={{ color: pickStatusColor, fontSize: 9, fontWeight: '800', marginTop: 3 }} numberOfLines={1}>{pickStatusText}</Text>
          </View>

          {/* Tile 2 — MOMENTUM (Pro only) */}
          {showMomentum ? (
            <View
              style={{
                flex: 1,
                backgroundColor: 'rgba(2,5,12,0.72)',
                borderWidth: 1,
                borderColor: 'rgba(122,157,184,0.2)',
                borderRadius: 14,
                minHeight: 58,
                justifyContent: 'center',
                paddingVertical: 7,
                paddingHorizontal: 7,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#8a95a6', fontSize: 8, fontWeight: '900', letterSpacing: 1.7, marginBottom: 4 }}>MOMENTUM</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 14 }}>
                {momentumBars.map((v, i) => {
                  const isPeak = i === peakIndex;
                  const c = isPeak ? LIVE_RED : v >= 0.75 ? '#c8d4df' : v >= 0.5 ? '#7A9DB8' : '#4b5563';
                  return (
                    <View
                      key={i}
                      style={{
                        width: 5,
                        height: Math.max(3, Math.round(v * 14)),
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
          ) : null}

          {showModelEdge ? (
            <View
              style={{
                flex: 1,
                backgroundColor: 'rgba(2,5,12,0.72)',
                borderWidth: 1,
                borderColor: hexWithAlpha(strength.color, 0.26),
                borderRadius: 14,
                minHeight: 58,
                justifyContent: 'center',
                paddingVertical: 7,
                paddingHorizontal: 7,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#8a95a6', fontSize: 8, fontWeight: '900', letterSpacing: 1.7, marginBottom: 6 }}>MODEL EDGE</Text>
              <Text style={{ color: strength.color, fontSize: 13, fontWeight: '900' }}>{strength.label}</Text>
              <View style={{ width: 30, height: 3, borderRadius: 2, backgroundColor: hexWithAlpha(strength.color, 0.65), marginTop: 5 }} />
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
  if (sport === Sport.NHL || sport === Sport.MLS || sport === Sport.EPL || sport === Sport.UCL || sport === Sport.WORLDCUP) return `goal${plural}`;
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
    return `${batter}. ${count}. ${bases ? `Traffic on ${bases}.` : 'Bases clear.'} ${isTied ? 'One clean swing changes the whole inning.' : `${trailer?.name ?? 'The trailing side'} needs contact before the inning gets away.`}`;
  }

  if (game.sport === Sport.NBA || game.sport === Sport.NCAAB) {
    return isTied
      ? 'The next two trips are the swing point: get a clean look, avoid the live-ball turnover, then force a half-court shot.'
      : `${trailer?.name ?? 'The trailer'} needs a stop-and-score burst before ${leader?.name ?? 'the leader'} turns this into a possession-control game.`;
  }

  if (game.sport === Sport.NFL || game.sport === Sport.NCAAF) {
    return isTied
      ? 'Field position is the hidden scoreboard now. The next drive decides who gets to play downhill.'
      : `${trailer?.name ?? 'The trailer'} needs a drive that steals time and points; ${leader?.name ?? 'the leader'} wants a long, clean answer.`;
  }

  if (game.sport === Sport.NHL) {
    return isTied
      ? 'Watch the next clean entry and special-teams chance. One mistake at the blue line can become the whole game.'
      : `${trailer?.name ?? 'The trailer'} needs zone time, not just shots. ${scoreDiff} ${unit} is still reachable if they tilt the ice now.`;
  }

  if (game.sport === Sport.IPL) {
    return isTied
      ? 'The next over has to create separation. Dot balls and boundary control are setting the pressure profile right now.'
      : `${trailer?.name ?? 'The chasing side'} needs a clean over soon; ${leader?.name ?? 'the leader'} is trying to make the required rate bite.`;
  }

  if (game.sport === Sport.TENNIS) {
    return isTied
      ? 'The next service game is the pressure window. First serves and return depth decide who has to defend the match.'
      : `${trailer?.name ?? 'The trailing player'} needs a break window soon; ${leader?.name ?? 'the leader'} is trying to keep every point on serve.`;
  }

  if (game.sport === Sport.MLS || game.sport === Sport.EPL || game.sport === Sport.UCL || game.sport === Sport.WORLDCUP) {
    return isTied
      ? 'Set pieces, turnovers in midfield, and the next transition chance are where this one opens up.'
      : `${trailer?.name ?? 'The trailing side'} has to commit numbers forward without giving ${leader?.name ?? 'the leader'} the counter.`;
  }

  return isTied
    ? 'The next clean sequence breaks the tie. Watch who controls tempo before the scoreboard moves.'
    : `${trailer?.name ?? 'The trailer'} needs the next response. ${scoreDiff} ${unit} is the gap, but the momentum window is smaller than the score.`;
}

function modelWatchBody(game: GameWithPrediction, leader: GameWithPrediction['homeTeam'] | null, isTied: boolean): string {
  const pred = game.prediction;
  if (!pred) {
    return 'No model read is attached to this game yet, so the live board is staying with verified scoreboard state only.';
  }

  const predictionDisplay = getGamePredictionDisplay(game);
  const predictedTeam = predictionDisplay.team;
  const conf = Math.round(displayConfidence(getCanonicalConfidence(pred)));
  const tier = getConfidenceTier(conf, predictionDisplay.isTossUp, predictionDisplay.marketType).label;

  if (predictionDisplay.outcome === 'draw') {
    return isTied
      ? `The model expected a draw-type fight, and the scoreboard is still matching that read. Watch for the first side that can hold pressure for more than one sequence.`
      : `The model leaned draw before kickoff, but ${leader?.name ?? 'one side'} has broken that script. The next response tells us whether this becomes a true swing.`;
  }

  if (predictionDisplay.outcome === 'toss_up') {
    return isTied
      ? `The model called this a toss-up, and the scoreboard is still matching that read. Watch for the first side that can create real separation.`
      : `${leader?.name ?? 'One side'} has the first live edge in a game the model called a toss-up. The next response decides whether this becomes separation or just noise.`;
  }

  if (isTied) {
    return `${predictedTeam?.name ?? 'The model side'} was the ${tier} at ${conf}%. The read is still waiting for separation, so the next score matters more than the current tie.`;
  }

  if (leader && predictedTeam && leader.abbreviation === predictedTeam.abbreviation) {
    if (game.sport === Sport.TENNIS) {
      return `${predictedTeam.name} was the ${tier} at ${conf}%, and the live score is backing the pregame read. Watch whether the next service game keeps that edge intact.`;
    }
    return `${predictedTeam.name} was the ${tier} at ${conf}%, and the live score is backing the pregame read. Watch whether the next pressure moment keeps that edge intact.`;
  }

  return `${predictedTeam?.name ?? 'The model side'} was the ${tier} at ${conf}%, but ${leader?.name ?? 'the opponent'} is pushing against it. This is where the model read gets stress-tested.`;
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
  const scoreText = `${game.awayTeam.name} ${awayScore}, ${game.homeTeam.name} ${homeScore}`;
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
        : `${moment}: ${leader?.name ?? 'The leader'} is up by ${scoreDiff} ${unit}, ${scoreText}. ${trailer?.name ?? 'The trailer'} is chasing the next momentum window.`,
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
        : predictedTeam?.name ?? 'the model side';
    const conf = Math.round(displayConfidence(getCanonicalConfidence(pred)));
    intel.push({
      type: 'alert',
      title: 'Upset Watch',
      body: `${leader.name} is currently breaking the pregame script. The model expected ${expected}${predictionDisplay?.outcome === 'draw' || predictionDisplay?.outcome === 'toss_up' ? '' : ` at ${conf}%`}, so the next response decides whether this is a live scare or a real flip.`,
    });
  }

  intel.push(...runtimeAlertIntel(game));
  return intel;
}

// ─── INTEL CARD ───
const IntelCard = memo(function IntelCard({ type, title, body }: LiveIntelItem) {
  const [expanded, setExpanded] = useState(false);
  const isLong = body.length > INTEL_BODY_COLLAPSE_THRESHOLD;
  // Truncate on a word boundary (never mid-word) and use the ellipsis glyph, so the
  // collapsed preview never strands a fragment like "…the current tie." mid-word.
  const truncated = useMemo(() => {
    const slice = body.substring(0, INTEL_BODY_COLLAPSE_THRESHOLD);
    const lastSpace = slice.lastIndexOf(' ');
    return (lastSpace > 0 ? slice.substring(0, lastSpace) : slice).replace(/[\s.,;:]+$/, '') + '…';
  }, [body]);
  const displayBody = expanded || !isLong ? body : truncated;
  const bc = type === 'pulse' ? '#8B0A1F' : type === 'alert' ? LIVE_RED : type === 'shift' ? TEAL_DARK : SILVER;
  const bl = type === 'pulse' ? 'PULSE' : type === 'alert' ? 'ALERT' : type === 'shift' ? 'SHIFT' : 'TREND';
  return (
    <Pressable
      onPress={() => { if (isLong) { fireSelectionHaptic(); setExpanded(!expanded); } }}
      disabled={!isLong}
      accessibilityRole={isLong ? 'button' : undefined}
      accessibilityLabel={isLong ? (expanded ? `Collapse ${title} live intel` : `Read full ${title} live intel`) : undefined}
      accessibilityState={isLong ? { expanded } : undefined}
      style={({ pressed }) => ({
        borderRadius: 14,
        opacity: pressed && isLong ? 0.9 : 1,
        transform: [{ scale: pressed && isLong ? 0.992 : 1 }],
      })}
    >
      <LinearGradient
        colors={[hexWithAlpha(bc, 0.56), 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.03)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 14,
          padding: 1.5,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 12,
          elevation: 5,
        }}
      >
        <View style={{ backgroundColor: 'rgba(5,6,12,0.94)', borderRadius: 12.5, padding: 12, paddingLeft: 14, overflow: 'hidden' }}>
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
          <View style={{ position: 'absolute', left: 0, top: 11, bottom: 11, width: 3.5, backgroundColor: bc, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 23, height: 23, borderRadius: 8, backgroundColor: hexWithAlpha(bc, 0.16), alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: hexWithAlpha(bc, 0.26) }}>
                <Zap size={11} color={bc} fill={hexWithAlpha(bc, 0.26)} />
              </View>
              <View style={{ backgroundColor: hexWithAlpha(bc, 0.16), borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 8 }}>
                <Text style={{ fontSize: 8, fontWeight: '900', color: bc, letterSpacing: 1 }}>{bl}</Text>
              </View>
            </View>
          </View>
          <Text style={{ fontSize: 14.5, lineHeight: 18, fontWeight: '800', color: WHITE, marginBottom: 5 }}>{title}</Text>
          <Text style={{ fontSize: 12.3, color: TEXT_SECONDARY, lineHeight: 18.5 }}>{displayBody}</Text>
          {isLong && !expanded ? <Text style={{ fontSize: 11, color: bc, fontWeight: '800', marginTop: 7 }}>Tap to read more</Text> : null}
        </View>
      </LinearGradient>
    </Pressable>
  );
});

const LiveIntelStage = memo(function LiveIntelStage({ game, intel }: { game: GameWithPrediction | null; intel: LiveIntelItem[] }) {
  if (!game || intel.length === 0) return null;
  // Header intentionally omitted — the "Live intelligence" heading above the live
  // game card already opens this section; the word cards flow under it as one unit.
  return (
    <View style={{ paddingHorizontal: ARENA_SIDE_PADDING, marginTop: 12, marginBottom: ARENA_SECTION_GAP }}>
      {intel.map((item, i) => (
        <View key={`${game.id}-${item.title}-${i}`} style={{ marginBottom: i === intel.length - 1 ? 0 : LIVE_INTEL_CARD_GAP }}>
          <IntelCard type={item.type} title={item.title} body={item.body} />
        </View>
      ))}
    </View>
  );
});

const LockedLiveIntelStage = memo(function LockedLiveIntelStage({ game, onPress }: { game: GameWithPrediction | null; onPress: () => void }) {
  if (!game) return null;
  // Header intentionally omitted — the "Live intelligence" heading above the live
  // game card already opens this section; the locked card flows under it as one unit.
  return (
    <View style={{ paddingHorizontal: ARENA_SIDE_PADDING, marginTop: 6, marginBottom: ARENA_SECTION_GAP }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Preview Live Intelligence Pro"
        accessibilityHint="Opens Clutch Picks Pro"
      >
        <LinearGradient
          colors={['rgba(122,157,184,0.24)', 'rgba(224,234,240,0.10)', 'rgba(224,234,240,0.10)', 'rgba(139,10,31,0.18)']}
          locations={[0, 0.44, 0.58, 1]}
          start={{ x: 0.05, y: 0 }}
          end={{ x: 0.95, y: 1 }}
          style={{
            borderRadius: 20,
            padding: 2.5,
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.32,
            shadowRadius: 22,
            elevation: 12,
          }}
        >
          <View style={{ borderRadius: 17.5, backgroundColor: 'rgba(5,8,13,0.96)', borderWidth: 2, borderColor: 'rgba(122,157,184,0.10)', padding: 16, overflow: 'hidden' }}>
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(122,157,184,0.15)', 'rgba(255,255,255,0.025)', 'rgba(255,255,255,0.025)', 'rgba(139,10,31,0.08)', 'rgba(5,8,13,0.96)']}
              locations={[0, 0.3, 0.42, 0.66, 1]}
              start={{ x: 0.05, y: 0 }}
              end={{ x: 0.95, y: 1 }}
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
                <Text style={{ fontSize: 8.5, lineHeight: 11, fontWeight: '900', color: '#7A9DB8', letterSpacing: 1.7 }}>LIVE INTELLIGENCE</Text>
                <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: '900', color: WHITE, marginTop: 2 }}>Read the game like a pro</Text>
              </View>
            </View>
            <Text style={{ fontSize: 12.5, lineHeight: 19, fontWeight: '700', color: TEXT_SECONDARY, marginBottom: 13 }}>
              The full read on every game in progress — real-time pulse, the pressure point that decides it, how the model line is holding, upset alerts, and injury & ejection news. All updating as it plays.
            </Text>
            <View style={{ marginBottom: 14 }}>
              {[
                { label: 'Real-time game pulse', dot: '#9AB8CC', bar: 76 },
                { label: 'Pressure point read', dot: 'rgba(139,10,31,0.78)', bar: 96 },
                { label: 'Model vs. live watch', dot: 'rgba(224,234,240,0.55)', bar: 84 },
                { label: 'Upset watch', dot: LIVE_RED, bar: 62 },
                { label: 'Injury & ejection alerts', dot: '#9AB8CC', bar: 104 },
              ].map((item, index, arr) => (
                <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 30, borderRadius: 10, backgroundColor: 'rgba(122,157,184,0.055)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.10)', paddingHorizontal: 10, marginBottom: index === arr.length - 1 ? 0 : 7 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: item.dot, marginRight: 8 }} />
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 14, fontWeight: '800', color: 'rgba(224,234,240,0.72)' }} numberOfLines={1}>{item.label}</Text>
                  <View style={{ width: item.bar, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.055)' }} />
                </View>
              ))}
            </View>
            <LinearGradient
              colors={['rgba(122,157,184,0.24)', 'rgba(224,234,240,0.10)', 'rgba(139,10,31,0.18)']}
              locations={[0, 0.5, 1]}
              start={{ x: 0.05, y: 0 }}
              end={{ x: 0.95, y: 1 }}
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

// ─── MATCHUP GENERATION ───
type DrawType = 'streak_clash'|'dominant_favorite'|'upset_brewing'|'toss_up'|'high_value'|'model_conflict'|'hot_team'|'cold_team'|'record_mismatch'|'default';

function genMatchup(game: GameWithPrediction, usedTypes: Set<DrawType>): { tags: string[]; headline: string; detail: string; drawType: DrawType } {
  const p = game.prediction!;
  const home = game.homeTeam; const away = game.awayTeam;
  const finalPick = getCanonicalFinalPick(p);
  const predictionDisplay = getGamePredictionDisplay(game);
  const tags: string[] = [];
  const conf = getCanonicalConfidence(p) || 55; const edge = p.edgeRating ?? 5; const value = p.valueRating ?? 5;
  const mTier = getConfidenceTier(conf, predictionDisplay.isTossUp, predictionDisplay.marketType).label;
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
    hl = `Two win streaks collide — W${hStreak} meets W${aStreak}`;
    tags.push('FORM WATCH', 'STREAK CLASH');
    dt = `Both sides enter in sustained form. ${home.name} has won ${hStreak} straight, while ${away.name} brings a ${aStreak}-game run into this matchup. The first clean separation should matter.`;
  }

  // 2. DOMINANT FAVORITE — the model sees a clear mismatch
  if (!hl && conf >= 64 && edge >= 5 && trySet('dominant_favorite')) {
    hl = `Model favors the ${winnerIsHome ? 'home' : 'road'} side at ${Math.max(homeWP, awayWP)}%`;
    tags.push(mTier.toUpperCase(), `${Math.max(homeWP, awayWP)}% WIN PROB`);
    dt = `The model gives ${winner.name} a ${Math.max(homeWP, awayWP)}% chance to win, backed by ${edge >= 7 ? 'a broad' : 'a meaningful'} factor edge. ${loser.name} needs a clean, high-efficiency game to close the gap.`;
  }

  // 3. UPSET CASE — the underdog has a live path
  if (!hl && conf >= 55 && conf <= 65 && trySet('upset_brewing')) {
    const favHome = finalPick === 'home';
    const underdog = favHome ? away : home;
    const uForm = favHome ? af : hf;
    if (uForm.wins >= 4 && uForm.total >= 5) {
      hl = `Live upset case — underdog is ${uForm.wins}-${uForm.total - uForm.wins} of late`;
      tags.push('UPSET CASE', `${underdog.abbreviation} ${uForm.wins}-${uForm.total - uForm.wins} RECENT`);
      dt = `${underdog.name} has won ${uForm.wins} of their last ${uForm.total}, giving the board a credible upset profile. ${winner.name} is still favored, but recent form keeps this from reading like a routine spot.`;
    } else { hl = ''; drawType = 'default'; }
  }

  // 4. TOSS-UP — close model split
  if (!hl && (predictionDisplay.isTossUp || (predictionDisplay.marketType !== 'three_way_result' && conf >= 48 && conf <= 53)) && trySet('toss_up')) {
    hl = 'True toss-up profile';
    tags.push('TOSS-UP', `${homeWP}-${awayWP} SPLIT`);
    const separator = predictionDisplay.teamSide === 'home'
      ? 'Home environment is the small separator.'
      : predictionDisplay.teamSide === 'away'
        ? 'Road composure is the small separator.'
        : 'No side has a clean separator yet.';
    dt = `The model ran every angle and could not separate them. ${home.name} (${home.record}) vs ${away.name} (${away.record}) is close to even, with late-game execution likely deciding the edge. ${separator}`;
  }

  // 5. MODEL CONFLICT — the ensemble is divided
  if (!hl && p.ensembleDivergence && trySet('model_conflict')) {
    hl = 'Models are split';
    tags.push('MODELS SPLIT', 'VOLATILE');
    dt = `The 3-model ensemble is not fully aligned. The composite read favors ${winner.name}, while supporting models are less decisive. Treat this as a higher-volatility matchup.`;
  }

  // 6. HOT TEAM — riding momentum
  if (!hl && (hStreak >= 3 || aStreak >= 3) && trySet('hot_team')) {
    const hot = hStreak >= aStreak ? home : away; const cold = hot === home ? away : home;
    const streak = Math.max(hStreak, aStreak);
    const isHotOnRoad = hot === away;
    hl = `${isHotOnRoad ? 'Road' : 'Home'} side rides a ${streak}-game win streak`;
    tags.push(`W${streak} STREAK`, isHotOnRoad ? 'ROAD ROLL' : 'HOME FORTRESS');
    dt = `${hot.name} has won ${streak} straight${isHotOnRoad ? ' with road form that travels' : ' while protecting home court well'}. ${cold.name} needs to slow the first wave and force this game into a lower-variance script.`;
  }

  // 7. HIGH VALUE — the sharpest edge on the board
  if (!hl && edge >= 7 && trySet('high_value')) {
    hl = 'Strongest signal on tonight’s slate';
    tags.push('STANDOUT', `EDGE ${edge}/10`);
    dt = `${winner.name} grades out at ${edge}/10 on edge rating, which means the model is seeing a real statistical gap in this matchup. ${loser.name} needs to cover that weakness early.`;
  }

  // 8. COLD TEAM — fading fast
  if (!hl && (hf.wins <= 3 || af.wins <= 3) && hf.total >= 5 && trySet('cold_team')) {
    const cold = hf.wins <= af.wins ? home : away;
    const hot = cold === home ? away : home;
    const cW = cold === home ? hf.wins : af.wins;
    const cT = cold === home ? hf.total : af.total;
    hl = `One side is fading — ${cW}-${cT - cW} over its last ${cT}`;
    tags.push(`${cold.abbreviation} ${cW}-${cT - cW} L${cT}`, 'COLD STREAK');
    dt = `${cold.name} has won just ${cW} of their last ${cT}. The trend matters here: ${hot.name} can pressure them early and force another difficult game state.`;
  }

  // 9. RECORD MISMATCH — talent gap
  if (!hl && trySet('record_mismatch')) {
    if (Math.abs(hPct - aPct) > 0.15) {
      const better = hPct > aPct ? home : away;
      const worse = better === home ? away : home;
      hl = `Records split by a ${Math.round(Math.abs(hPct - aPct) * 100)}% win-rate gap`;
      tags.push(`${better.abbreviation} ${better.record}`, `${worse.abbreviation} ${worse.record}`);
      dt = `${better.name} enters with a stronger season profile: ${better.record} against ${worse.name}'s ${worse.record}. That is a ${Math.round(Math.abs(hPct - aPct) * 100)}% win-rate gap, so ${worse.name} needs an above-baseline performance.`;
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
      hl = `Edge across the board — ${Math.max(homeWP, awayWP)}% to win`;
      tags.push('FULL BOARD EDGE');
      dt = `Form, fundamentals, and matchup advantages all point to ${winner.name}. The model found edge in ${edge >= 6 ? 'multiple categories' : 'the key areas'}, with ${loser.name} facing a difficult stylistic setup.`;
    } else if (spread !== undefined && Math.abs(spread) >= 7) {
      hl = `Projected to win by about ${Math.abs(spread)}`;
      tags.push('PROJECTED MARGIN');
      dt = `The model projects ${winner.name} winning by around ${Math.abs(spread)} points, backed by multiple matchup factors. ${loser.name} needs to keep the early margin controlled.`;
    } else if (overUnder && overUnder >= (sport === 'NBA' ? 230 : sport === 'NFL' ? 50 : sport === 'MLB' ? 9 : sport === 'NHL' ? 6.5 : sport === 'IPL' ? 330 : sport === 'TENNIS' ? 2.5 : 3.5)) {
      hl = 'Elevated scoring profile';
      tags.push('HIGH-SCORING PROJECTION');
      dt = `The model projects a combined ${overUnder}-point total, putting pace, shot quality, and conversion efficiency at the center of this matchup.`;
    } else if (winnerIsHome && hPct > 0.55 && isNightGame) {
      hl = `Primetime home edge in the model’s read`;
      tags.push('HOME ADVANTAGE');
      dt = `Primetime at ${venue !== 'TBD' ? venue : 'home'}. ${home.name} (${home.record}) grades well in this environment, and the model has them favored tonight. ${away.name} needs a composed opening stretch.`;
    } else if (!winnerIsHome && aPct > 0.55) {
      hl = `Road favorite — the visitor’s profile travels`;
      tags.push('ROAD PICK');
      dt = `${away.name} (${away.record}) is favored ${sportAction} despite being the visitor. The road profile is strong enough that ${home.name} needs more than venue edge.`;
    } else if (Math.abs(formDiff) >= 2 && hf.total >= 5) {
      const hotter = formDiff > 0 ? home : away;
      const colder = formDiff > 0 ? away : home;
      const hotW = formDiff > 0 ? hf.wins : af.wins;
      const hotT = formDiff > 0 ? hf.total : af.total;
      hl = `Recent form tilts the matchup — ${hotW}-${hotT - hotW} lately`;
      tags.push(`${hotter.abbreviation} ${hotW}-${hotT - hotW} RECENT`);
      dt = `${hotter.name} is ${hotW}-${hotT - hotW} over the last ${hotT}, while ${colder.name} has been less stable. Recent form is giving ${hotter.name} a cleaner path into this matchup.`;
    } else if (isMatinee) {
      hl = `Early window, clean setup`;
      tags.push(displaySport(sport));
      dt = isDrawRead
        ? `Matinee matchup: ${away.name} at ${home.name}. The model has draw as the top result at ${drawProbabilityLabel}, with both sides close enough to stay live.`
        : `Matinee matchup: ${away.name} at ${home.name}. The model leans ${winner.name} with a ${Math.max(homeWP, awayWP)}% win probability.`;
    } else {
      hl = isDrawRead
        ? `Model leans draw at ${drawProbabilityLabel}`
        : `Model leans the ${winnerIsHome ? 'home' : 'road'} side at ${Math.max(homeWP, awayWP)}%`;
      tags.push(displaySport(sport), isDrawRead ? `${drawProbabilityLabel} DRAW` : `${Math.max(homeWP, awayWP)}% WIN PROB`);
      dt = isDrawRead
        ? `${away.name} (${away.record}) travels to face ${home.name} (${home.record}) tonight. The model has the draw as the top outcome, so finishing quality and late pressure matter more than a straight side lean.`
        : `${away.name} (${away.record}) travels to face ${home.name} (${home.record}) tonight. The model sees a ${conf >= 60 ? 'clear' : 'slight'} edge for ${winner.name}. ${conf < 58 ? 'Tight matchup; late information still matters.' : 'The data is leaning one direction.'}`;
    }
  }

  return { tags, headline: hl, detail: dt, drawType };
}

// ─── MATCHUP CARD (collapsible) ───
// Redesigned to match the Signature Calls (Profile) / Review summary look:
// near-black panel, subtle white hairline border, a thin accent rail on the
// left edge, and a tight, properly-aligned internal grid.
const MATCHUP_CARD_BACKGROUND = '#000000';
const MATCHUP_CARD_BORDER = 'rgba(255,255,255,0.12)';
const MATCHUP_RANK_BACKGROUND = 'rgba(255,255,255,0.05)';
const MATCHUP_RANK_BORDER = 'rgba(255,255,255,0.12)';
const MATCHUP_CHIP_BACKGROUND = 'rgba(255,255,255,0.04)';
const MATCHUP_CHIP_BORDER = 'rgba(255,255,255,0.10)';
const MATCHUP_CTA_BACKGROUND = 'rgba(255,255,255,0.05)';
const MATCHUP_CTA_BORDER = 'rgba(255,255,255,0.12)';
// Generous interior padding so card content (rank chip, headline, tag chips,
// chevron) never crowds the rounded border. X padding is intentionally larger
// than the maroon accent rail width so text starts clear of the rail.
const MATCHUP_CARD_CONTENT_PADDING_X = 20;
const MATCHUP_CARD_CONTENT_PADDING_Y = 20;
// Minimum collapsed-card height so cards feel substantial and never skinny.
// Content is vertically centered within this footprint via the Pressable. Sized
// to comfortably contain the rank chip + two-line headline + a tag row with
// breathing room above and below.
const MATCHUP_CARD_MIN_HEIGHT = 0;
const MATCHUP_RANK_SIZE = 30;
const MATCHUP_RANK_GAP = 12;
const MATCHUP_ACTION_SIZE = 30;
const MATCHUP_ACTION_GAP = 10;
const MATCHUP_ACCENT_COLOR = ARENA_CHROME_ACCENT;
const MATCHUP_ACCENT_RAIL = MAROON;
const MATCHUP_CARD_RADIUS = 16;
const MATCHUP_ACCENT_RAIL_WIDTH = 3;

const MatchupCard = memo(function MatchupCard({ game, rank, headline, tags, detail, resetSignal }: { game: GameWithPrediction; rank: number; headline: string; tags: string[]; detail: string; resetSignal?: number }) {
  const { openGame, warmGame } = useGameDetailActions();
  const [expanded, setExpanded] = useState(false);
  // Start time differentiates same-team games (e.g. an MLB doubleheader = two game
  // IDs that would otherwise render identical titles). Always-truthful tip-off meta.
  const startTime = useMemo(() => new Date(game.gameTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), [game.gameTime]);

  useEffect(() => {
    setExpanded(false);
  }, [game.id, resetSignal]);

  return (
    <View style={{ backgroundColor: MATCHUP_CARD_BACKGROUND, borderRadius: MATCHUP_CARD_RADIUS, borderWidth: 1, borderColor: MATCHUP_CARD_BORDER, marginBottom: PREP_MATCHUP_CARD_GAP, overflow: 'hidden', position: 'relative', shadowColor: '#000000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 8 }}>
      {/* Left accent rail — matches the Signature Calls card treatment */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: MATCHUP_ACCENT_RAIL_WIDTH, backgroundColor: MATCHUP_ACCENT_RAIL }} />
      <Pressable
        onPress={() => { fireSelectionHaptic(); setExpanded(e => !e); }}
        accessibilityRole="button"
        accessibilityLabel={expanded ? `Collapse matchup ${rank}: ${matchupTitle(game.awayTeam.name, game.homeTeam.name)}` : `Expand matchup ${rank}: ${matchupTitle(game.awayTeam.name, game.homeTeam.name)}`}
        accessibilityState={{ expanded }}
        style={({ pressed }) => ({
          paddingHorizontal: MATCHUP_CARD_CONTENT_PADDING_X,
          paddingTop: MATCHUP_CARD_CONTENT_PADDING_Y,
          paddingBottom: MATCHUP_CARD_CONTENT_PADDING_Y,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ width: MATCHUP_RANK_SIZE, height: MATCHUP_RANK_SIZE, borderRadius: 9, backgroundColor: MATCHUP_RANK_BACKGROUND, borderWidth: 1, borderColor: MATCHUP_RANK_BORDER, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: MATCHUP_RANK_GAP }}>
            <Text style={{ fontSize: 12, lineHeight: 15, fontWeight: '900', color: MATCHUP_ACCENT_COLOR, includeFontPadding: false }}>{rank}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, paddingRight: 12, paddingBottom: MATCHUP_CARD_CONTENT_PADDING_Y }}>
            <Text adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={2} style={{ fontSize: 15.5, lineHeight: 21, fontWeight: '700', color: WHITE, letterSpacing: -0.2 }}>{matchupTitle(game.awayTeam.name, game.homeTeam.name)}</Text>
            <Text style={{ fontSize: 11.5, lineHeight: 16.5, fontWeight: '500', color: TEXT_SECONDARY, marginTop: 8 }} numberOfLines={expanded ? undefined : 2}>
              <Text style={{ color: MATCHUP_ACCENT_COLOR, fontWeight: '800' }}>{startTime}</Text>
              <Text style={{ color: TEXT_MUTED }}>{'  ·  '}</Text>
              {headline}
            </Text>
            {tags.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: MATCHUP_TAG_ROW_GAP, marginTop: 12 }}>
                {tags.slice(0, expanded ? tags.length : 2).map((tg, i) => (
                  <View key={`${tg}-${i}`} style={{ backgroundColor: MATCHUP_CHIP_BACKGROUND, borderRadius: 7, borderWidth: 1, borderColor: MATCHUP_CHIP_BORDER, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{ fontSize: 9, lineHeight: 12, fontWeight: '900', color: TEXT_SECONDARY, letterSpacing: 0.5, includeFontPadding: false }}>{tg}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          <View style={{ width: MATCHUP_ACTION_SIZE, height: MATCHUP_ACTION_SIZE, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: MATCHUP_ACTION_GAP, marginTop: 2, transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>
            <ChevronRight size={14} color={TEXT_MUTED} strokeWidth={2.4} />
          </View>
        </View>
      </Pressable>
      {expanded ? (
        <View style={{ paddingHorizontal: MATCHUP_CARD_CONTENT_PADDING_X, paddingBottom: MATCHUP_CARD_CONTENT_PADDING_Y }}>
          <View style={{ marginLeft: MATCHUP_RANK_SIZE + MATCHUP_RANK_GAP, marginRight: MATCHUP_ACTION_SIZE + MATCHUP_ACTION_GAP }}>
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: 11 }} />
            <Text style={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 18.5 }}>{detail}</Text>
            <Pressable
              onPressIn={() => warmGame(game)}
              onPress={() => openGame(game)}
              accessibilityRole="button"
              accessibilityLabel={`Open game details for ${game.awayTeam.name} at ${game.homeTeam.name}`}
              accessibilityHint="Opens game details"
              style={({ pressed }) => ({
                marginTop: 12,
                opacity: pressed ? 0.88 : 1,
                transform: [{ scale: pressed ? 0.992 : 1 }],
              })}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: MATCHUP_CTA_BACKGROUND,
                  borderWidth: 1,
                  borderColor: MATCHUP_CTA_BORDER,
                  borderRadius: 11,
                  height: MATCHUP_CARD_CTA_HEIGHT,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: TEXT_SECONDARY, marginRight: 4 }}>Open Game</Text>
                <ChevronRight size={12} color={TEXT_MUTED} />
              </View>
            </Pressable>
          </View>
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
      <ArenaSectionHeading eyebrow="BY LEAGUE" title="Accuracy by Sport" accent={TEAL} />
      {data.map(i => {
        const bc = i.p>65?TEAL:i.p>=55?MAROON:'rgba(255,255,255,0.08)';
        const tc = i.p>65?TEAL:i.p>=55?MAROON:TEXT_MUTED;
        return <View key={i.s} style={{marginBottom:10}}><View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:4}}><Text style={{fontSize:11, fontWeight:'600', color:WHITE}}>{i.s}</Text><Text style={{fontSize:11, fontWeight:'700', color:tc}}>{i.p}%</Text></View><View style={{height:4, borderRadius:2, backgroundColor:'rgba(255,255,255,0.04)', overflow:'hidden'}}><View style={{height:'100%', width:`${i.p}%`, backgroundColor:bc, borderRadius:2}} /></View></View>;
      })}
    </View>
  );
});

// ─── RESULT CARD ───
const REVIEW_RESULT_CARD_GAP = 10;
const REVIEW_PROGRESS_SEGMENT_GAP = 3;

const ResultCard = memo(function ResultCard({ game, pick }: { game: GameWithPrediction; pick?: UserPick }) {
  const w = pick?.result === 'win'; const hs = game.homeScore??0; const as2 = game.awayScore??0;
  const pickedTeam = pick?.pickedTeam === 'home' ? game.homeTeam.name : game.awayTeam.name;
  return (
    <View style={{backgroundColor:PANEL_DARK, borderRadius:13, borderWidth:1.5, borderColor:BORDER_MED, padding:12, marginBottom: REVIEW_RESULT_CARD_GAP, shadowColor:'#000000', shadowOffset:{ width:0, height:7 }, shadowOpacity:0.22, shadowRadius:13, elevation:6}}>
      <View style={{flexDirection:'row', alignItems:'flex-start'}}>
        <View style={{flex:1, minWidth:0, paddingRight:pick ? 10 : 0}}>
          <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{fontSize:13.2, lineHeight:17, fontWeight:'800', color:WHITE, fontVariant: ['tabular-nums']}}>{game.awayTeam.abbreviation} {as2} - {hs} {game.homeTeam.abbreviation}</Text>
          {pick?<Text style={{fontSize:10.8, color:TEXT_SECONDARY, marginTop:5, lineHeight:15}} numberOfLines={2}>{w?`Picked ${pickedTeam} · Closed by ${Math.abs(hs-as2)}`:`Picked ${pickedTeam} · Closed against the pick`}</Text>:null}
        </View>
        {pick?<View style={{backgroundColor:w?TEAL_DIM:ERROR_DIM, borderRadius:8, paddingHorizontal:8, paddingVertical:4, borderWidth:1, borderColor:w?hexWithAlpha(TEAL, 0.18):hexWithAlpha(LOSS, 0.18), flexShrink:0}}><Text style={{fontSize:8.5, lineHeight:11, fontWeight:'900', color:w?TEAL:LOSS, letterSpacing:0.65, includeFontPadding:false}}>{w?'CORRECT':'MISSED'}</Text></View>:null}
      </View>
    </View>
  );
});

const ReviewSummaryCard = memo(function ReviewSummaryCard({
  wins,
  losses,
  accuracy,
  games,
  picks,
}: {
  wins: number;
  losses: number;
  accuracy: number;
  games: GameWithPrediction[];
  picks: Map<string, UserPick>;
}) {
  const progressGames = games.slice(0, 8);
  return (
    <View style={{backgroundColor:PANEL_DARK, borderRadius:18, borderWidth:1.5, borderColor:'rgba(180,211,235,0.12)', padding:15, marginHorizontal:ARENA_SIDE_PADDING, marginBottom:18, overflow:'hidden', shadowColor:'#000000', shadowOffset:{ width:0, height:10 }, shadowOpacity:0.26, shadowRadius:18, elevation:9}}>
      <LinearGradient pointerEvents="none" colors={['rgba(122,157,184,0.12)', 'rgba(5,8,13,0)', 'rgba(139,10,31,0.08)']} start={{x:0, y:0}} end={{x:1, y:1}} style={StyleSheet.absoluteFillObject} />
      <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}>
        <View style={{flex:1, minWidth:0}}>
          <Text style={{fontSize:9, lineHeight:12, fontWeight:'900', color:TEAL, letterSpacing:1.6, marginBottom:5, includeFontPadding:false}}>SETTLED PICKS</Text>
          <Text adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={{fontSize:34, lineHeight:38, fontWeight:'900', color:WHITE, includeFontPadding:false, fontVariant: ['tabular-nums']}}>{wins}-{losses}</Text>
        </View>
        <View style={{minWidth:84, borderRadius:14, paddingHorizontal:11, paddingVertical:9, backgroundColor:hexWithAlpha(MAROON, 0.12), borderWidth:1, borderColor:hexWithAlpha(MAROON, 0.22), alignItems:'center', marginLeft:12}}>
          <Text style={{fontSize:18, lineHeight:22, fontWeight:'900', color:MAROON, includeFontPadding:false, fontVariant: ['tabular-nums']}}>{accuracy}%</Text>
          <Text style={{fontSize:8.5, lineHeight:11, fontWeight:'900', color:TEXT_MUTED, letterSpacing:1.05, marginTop:2, includeFontPadding:false}}>ACCURACY</Text>
        </View>
      </View>
      {progressGames.length > 0 ? (
        <View style={{flexDirection:'row', marginTop:13}}>
          {progressGames.map((game, index) => {
            const won = picks.get(game.id)?.result === 'win';
            return (
              <View key={game.id} style={{flex:1, height:4, borderRadius:2, backgroundColor:won?TEAL:LOSS, opacity:won?0.88:0.42, marginRight:index===progressGames.length-1?0:REVIEW_PROGRESS_SEGMENT_GAP}} />
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

// ─── GAME DAY ───
const LIVE_CARD_SIDE_PEEK = 6;
const LIVE_CARD_SIDE_SPACE = ARENA_CARD_GAP + LIVE_CARD_SIDE_PEEK;
const LIVE_CARD_MIN_W = 260;
const LIVE_RAIL_VISUAL_CENTER_CORRECTION = 3;

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
  resetSignal,
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
  resetSignal?: number;
}) {
  const pm = useMemo(() => { const m = new Map<string, UserPick>(); picks.forEach(p => m.set(p.gameId, p)); return m; }, [picks]);
  const liveRailRef = useRef<FlatList<GameWithPrediction> | null>(null);
  const liveRailPressGuard = useScrollPressGuard();
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [liveSearch, setLiveSearch] = useState('');
  const [liveSportFilter, setLiveSportFilter] = useState('All');
  const [liveRailWidth, setLiveRailWidth] = useState(SW);
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
    const matches = !q ? sportScoped : sportScoped.filter(g =>
      g.homeTeam.name.toLowerCase().includes(q) || g.homeTeam.abbreviation.toLowerCase().includes(q) ||
      g.awayTeam.name.toLowerCase().includes(q) || g.awayTeam.abbreviation.toLowerCase().includes(q) ||
      g.sport.toLowerCase().includes(q)
    );
    return sortSuspendedGamesLast(matches);
  }, [live, liveSearch, liveSportFilter]);
  const focusedGame = filteredLive[focusedIdx] ?? filteredLive[0] ?? null;
  const focusedIntel = useMemo(() => liveIntelLocked ? [] : generateLiveIntel(focusedGame), [focusedGame, liveIntelLocked]);
  const liveInitialRenderCount = Math.min(filteredLive.length, 3);
  const liveVisibleRailWidth = Math.min(liveRailWidth, SW);
  const liveCardWidth = Math.max(LIVE_CARD_MIN_W, liveVisibleRailWidth - LIVE_CARD_SIDE_SPACE * 2);
  const liveCardSidePadding = Math.max(0, (liveVisibleRailWidth - liveCardWidth) / 2);
  const liveRailSidePadding = Math.max(0, liveCardSidePadding - LIVE_RAIL_VISUAL_CENTER_CORRECTION);
  const liveCardSnapInterval = liveCardWidth + ARENA_CARD_GAP;
  const liveSnapOffsets = useMemo(
    () => filteredLive.map((_, index) => index * liveCardSnapInterval),
    [filteredLive, liveCardSnapInterval],
  );
  const onLiveRailLayout = useCallback((event: any) => {
    const width = Math.round(event?.nativeEvent?.layout?.width ?? 0);
    if (width <= 0) return;
    setLiveRailWidth((current) => current === width ? current : width);
  }, []);
  const canOpenLiveCard = liveRailPressGuard.canPress;
  const markLiveRailScrollStart = useCallback(() => {
    liveRailPressGuard.onScrollBeginDrag();
  }, [liveRailPressGuard.onScrollBeginDrag]);
  const markLiveRailScrollEnd = useCallback(() => {
    liveRailPressGuard.onScrollEndDrag();
  }, [liveRailPressGuard.onScrollEndDrag]);
  useEffect(() => {
    if (liveSportFilter !== 'All' && !liveSports.has(liveSportFilter)) setLiveSportFilter('All');
  }, [liveSportFilter, liveSports]);

  useEffect(() => {
    setFocusedIdx(0);
    requestAnimationFrame(() => {
      liveRailRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    });
  }, [liveSearch, liveSportFilter]);

  useEffect(() => {
    if (focusedIdx >= filteredLive.length) setFocusedIdx(0);
  }, [focusedIdx, filteredLive.length]);

  useEffect(() => {
    if (!filteredLive.length) return;
    const idx = Math.max(0, Math.min(filteredLive.length - 1, focusedIdx));
    requestAnimationFrame(() => {
      liveRailRef.current?.scrollToOffset?.({ offset: idx * liveCardSnapInterval, animated: false });
    });
  }, [filteredLive.length, focusedIdx, liveCardSnapInterval]);

  const updateFocusedIdx = useCallback((e: any) => {
    if (!filteredLive.length) return;
    const rawOffset = Number(e?.nativeEvent?.contentOffset?.x ?? 0);
    const idx = Math.max(0, Math.min(filteredLive.length - 1, Math.round(rawOffset / liveCardSnapInterval)));
    setFocusedIdx((current) => idx === current ? current : idx);
  }, [filteredLive.length, liveCardSnapInterval]);

  // No live games
  if (!live.length) return (
    <ArenaScrollView sh={sh} onR={onR} isR={isR} bottomPadding={bottomPadding} resetSignal={resetSignal}>
      {top}
      <GameDayTitleBanner liveCount={live.length} />
      <YourGames games={followed} />
      <View style={{alignItems:'center', paddingTop:28, paddingBottom:24}}><Text style={{fontSize:14, color:TEXT_MUTED}}>No games on the board right now</Text></View>
      {afterContent}
      <Disclaimer />
    </ArenaScrollView>
  );

  // Has live games
  return (
    <ArenaScrollView sh={sh} onR={onR} isR={isR} bottomPadding={bottomPadding} resetSignal={resetSignal}>
      {top}
      {/* 1. Header */}
      <GameDayTitleBanner liveCount={live.length} />

      {/* 2. Your Games */}
      <YourGames games={followed} />

      {/* 3. Live intelligence search */}
      <View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginTop:0, marginBottom:14}}>
        <View style={{flexDirection:'row', alignItems:'center', marginBottom:10}}>
          <View style={{width:3, height:24, borderRadius:2, backgroundColor:LIVE_RED, marginRight:11}} />
          <Text style={{fontSize:18, lineHeight:22, fontWeight:'900', color:WHITE}} numberOfLines={1}>Live intelligence</Text>
        </View>
        {live.length > 0 ? (
          <LinearGradient
            colors={['rgba(239,68,68,0.26)', 'rgba(180,211,235,0.12)', 'rgba(122,157,184,0.08)']}
            start={{x:0, y:0}}
            end={{x:1, y:1}}
            style={{
              borderRadius:18,
              padding:1.25,
              shadowColor:'#000000',
              shadowOffset:{ width:0, height:6 },
              shadowOpacity:0.26,
              shadowRadius:14,
              elevation:8,
            }}
          >
            <View style={{minHeight:44, flexDirection:'row', alignItems:'center', backgroundColor:'rgba(5,8,13,0.98)', borderRadius:16.75, borderWidth:1, borderColor:'rgba(255,255,255,0.055)', paddingHorizontal:11, overflow:'hidden'}}>
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(239,68,68,0.10)', 'rgba(5,8,13,0)', 'rgba(122,157,184,0.08)']}
                start={{x:0, y:0}}
                end={{x:1, y:1}}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={{width:28, height:28, borderRadius:9, backgroundColor:'rgba(239,68,68,0.10)', borderWidth:1, borderColor:'rgba(239,68,68,0.22)', alignItems:'center', justifyContent:'center', marginRight:9}}>
                <Search size={15} color={LIVE_RED} strokeWidth={2.4} />
              </View>
              <TextInput
                value={liveSearch}
                onChangeText={setLiveSearch}
                placeholder="Find a game or team"
                placeholderTextColor='rgba(180,211,235,0.42)'
                style={{flex:1, fontSize:13.5, lineHeight:18, fontWeight:'800', color:WHITE, padding:0}}
                keyboardAppearance="dark"
                selectionColor={LIVE_RED}
                cursorColor={LIVE_RED}
                returnKeyType="done"
                accessibilityLabel="Search teams or matchups"
              />
              {liveSearch.length > 0 ? (
                <Pressable
                  onPress={() => setLiveSearch('')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  style={{
                    width:26,
                    height:26,
                    borderRadius:9,
                    alignItems:'center',
                    justifyContent:'center',
                    backgroundColor:'rgba(255,255,255,0.055)',
                  }}
                >
                  <Text style={{fontSize:14, fontWeight:'900', color:'rgba(224,234,240,0.56)'}}>×</Text>
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
            />
          </View>
        ) : null}
      </View>

      {/* 4. Scrollable live cards */}
      {filteredLive.length === 0 && (liveSearch.trim() || liveSportFilter !== 'All') ? (
        <View style={{alignItems:'center', paddingVertical:20}}>
          <Text style={{fontSize:13, color:TEXT_MUTED}}>{liveSearch.trim() ? `No games match "${liveSearch}"` : 'No games match this sport'}</Text>
        </View>
      ) : filteredLive.length === 1 ? (
        <View onLayout={onLiveRailLayout} style={{paddingHorizontal:liveRailSidePadding, marginBottom:ARENA_CARD_GAP}}>
          <LiveCard
            game={filteredLive[0]}
            pick={pm.get(filteredLive[0].id)}
            cardWidth={liveCardWidth}
            showModelEdge={!liveIntelLocked}
            showMomentum={!liveIntelLocked}
            canOpen={canOpenLiveCard}
          />
        </View>
      ) : (
        <View onLayout={onLiveRailLayout} style={{ width: '100%', overflow: 'visible' }}>
          <FlatList
            key={`live-rail-${Math.round(liveCardWidth)}`}
            ref={liveRailRef}
            data={filteredLive}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToOffsets={liveSnapOffsets}
            snapToAlignment="start"
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: liveRailSidePadding }}
            ItemSeparatorComponent={() => <View style={{ width: ARENA_CARD_GAP }} />}
            initialNumToRender={liveInitialRenderCount}
            maxToRenderPerBatch={3}
            updateCellsBatchingPeriod={16}
            windowSize={5}
            removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <LiveCard
                game={item}
                pick={pm.get(item.id)}
                cardWidth={liveCardWidth}
                showModelEdge={!liveIntelLocked}
                showMomentum={!liveIntelLocked}
                canOpen={canOpenLiveCard}
              />
            )}
            getItemLayout={(_, index) => ({ length: liveCardSnapInterval, offset: liveCardSnapInterval * index, index })}
            style={{flexGrow:0}}
            onScrollBeginDrag={markLiveRailScrollStart}
            onScrollEndDrag={(event) => {
              updateFocusedIdx(event);
              markLiveRailScrollEnd();
            }}
            onMomentumScrollEnd={(event) => {
              updateFocusedIdx(event);
              markLiveRailScrollEnd();
            }}
          />
        </View>
      )}

      {/* 5. Page dots */}
      {filteredLive.length > 1 ? (
        <View style={{flexDirection:'row', justifyContent:'center', marginTop:12, marginBottom:12}}>
          {filteredLive.map((_, i) => <View key={i} style={{width:i===focusedIdx?8:4, height:4, borderRadius:2, backgroundColor:i===focusedIdx?MAROON:'rgba(255,255,255,0.15)', marginHorizontal:2}} />)}
        </View>
      ) : null}

      {/* 6. Intel feed — tied to focused game */}
      {liveIntelLocked ? (
        onProPress ? <LockedLiveIntelStage game={focusedGame} onPress={onProPress} /> : null
      ) : (
        <LiveIntelStage game={focusedGame} intel={focusedIntel} />
      )}

      {afterContent}

      {/* 9. Disclaimer */}
      <Disclaimer />
    </ArenaScrollView>
  );
});

// ─── PREP SUB-TABS ───
const PREP_TABS = ['Ranked', 'Upsets'] as const;
const PREP_MATCHUP_LIMIT = 16;
const PREP_SUBTAB_MIN_HEIGHT = 34;
const PREP_SUBTAB_GAP = 4;
const PREP_SUBTAB_TRACK_INNER_PADDING = 3;
const MATCHUP_CARD_CTA_HEIGHT = 40;
const MATCHUP_TAG_ROW_GAP = 5;
const PREP_MATCHUP_CARD_GAP = 10;

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
  resetSignal,
}: {
  sched: GameWithPrediction[];
  picks: UserPick[];
  stats: UserStats|undefined;
  sh: any;
  onR: ()=>void;
  isR: boolean;
  bottomPadding: number;
  top?: React.ReactNode;
  resetSignal?: number;
}) {
  const [prepTab, setPrepTab] = useState<0|1>(0);
  const ranked = useMemo(() => {
    // Dedupe ONLY on identical game id (guards against a duplicate id colliding React
    // keys). A real MLB doubleheader has TWO distinct ids → both kept and told apart by
    // the start time shown on each card; we never drop a real game.
    const seenIds = new Set<string>();
    const withPred = sched.filter(g => {
      if (!g.prediction || seenIds.has(g.id)) return false;
      seenIds.add(g.id);
      return true;
    });
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

  const upsetPlays = useMemo(() => {
    return ranked
      .filter(r => {
        // Genuine upsets only. A real upset spot needs (a) the model to flag
        // meaningful upset volatility, AND (b) an actual favorite/underdog
        // structure — i.e. the model leans one side with enough confidence that
        // the OTHER side winning would be an upset. This filters out coin-flip
        // games (which aren't upsets, just toss-ups) and avoids exaggerating a
        // routine spot into an "upset".
        const pred = r.game.prediction;
        if (!pred) return false;
        const profile = pred.canonicalResult?.decisionProfile;
        const risk = pred.projection?.upsetRisk ?? 0;
        const conf = getCanonicalConfidence(pred);
        const flagged = profile?.tags.includes('upset-watch') || risk >= 0.45;
        // Require a clear favorite (conf >= 58) so there is a real underdog to
        // upset, but not a runaway lock (conf <= 80) where calling it an upset
        // would be exaggerated. Toss-ups (conf < 55) are excluded entirely.
        const hasFavoriteStructure = conf >= 58 && conf <= 80;
        return flagged && hasFavoriteStructure;
      })
      // Strongest upset profiles first.
      .sort((a, b) => (b.game.prediction?.projection?.upsetRisk ?? 0) - (a.game.prediction?.projection?.upsetRisk ?? 0))
      .map(r => {
        const pick = getCanonicalFinalPick(r.game.prediction);
        const conf = Math.round(getCanonicalConfidence(r.game.prediction));
        // Surface the upset ANGLE, not the matchup names (the card title already
        // shows who is playing). Lead with the model's real upset-risk read.
        const riskPct = Math.round((r.game.prediction?.projection?.upsetRisk ?? 0) * 100);
        const side = pick === 'home' ? 'home' : pick === 'away' ? 'road' : null;
        const udHeadline = riskPct > 0
          ? `Upset risk runs ${riskPct}% against a ${conf}% read`
          : side
            ? `Volatile spot — model only ${conf}% on the ${side} side`
            : 'Volatile spot — no clean side for the model';
        return {
          ...r,
          udHeadline,
          udTags: ['UPSET WATCH', `${conf}% MODEL CONF`],
        };
      });
  }, [ranked]);

  return (
    <ArenaScrollView sh={sh} onR={onR} isR={isR} bottomPadding={bottomPadding} resetSignal={resetSignal}>
      {top}
      {/* Header */}
      <ArenaModeTitleBanner title="Prep Mode" subtitle="MODEL BOARD" accent={MAROON} />

      {/* Sub-tab toggle: Ranked / Upsets */}
      <View style={{marginHorizontal:ARENA_SIDE_PADDING, marginBottom:12}}>
        <View style={{flexDirection:'row', backgroundColor:'rgba(255,255,255,0.035)', borderRadius:16, padding:PREP_SUBTAB_TRACK_INNER_PADDING, borderWidth:1.5, borderColor:'rgba(180,211,235,0.10)', shadowColor:'#000000', shadowOffset:{ width:0, height:7 }, shadowOpacity:0.22, shadowRadius:12, elevation:6}}>
          {PREP_TABS.map((label, idx) => {
            const active = prepTab === idx;
            const count = idx === 0 ? ranked.length : upsetPlays.length;
            return (
              <View key={label} style={{flex:1, marginRight: idx === PREP_TABS.length - 1 ? 0 : PREP_SUBTAB_GAP}}>
                <Pressable
                  onPress={() => { if (!active) fireSelectionHaptic(); setPrepTab(idx as 0|1); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${label} prep tab, ${count} matchup${count === 1 ? '': 's'}`}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => ({
                    width: '100%',
                    minHeight: 44,
                    minWidth: 0,
                    justifyContent: 'center',
                    opacity: pressed && !active ? 0.9 : 1,
                  })}
                >
                  <LinearGradient
                    colors={active ? ARENA_SEGMENT_ACTIVE_GRADIENT : ARENA_SEGMENT_INACTIVE_GRADIENT}
                    locations={active ? ARENA_SEGMENT_ACTIVE_LOCATIONS : undefined}
                    start={{x:0.05, y:0}}
                    end={{x:0.95, y:1}}
                    style={{width:'100%', flex:1, minHeight:PREP_SUBTAB_MIN_HEIGHT, borderRadius:13, padding:1}}
                  >
                    <View style={{flex:1, borderRadius:12, alignItems:'center', justifyContent:'center', paddingHorizontal:9, backgroundColor:active?ARENA_SEGMENT_ACTIVE_BACKGROUND:ARENA_SEGMENT_INACTIVE_BACKGROUND, overflow:'hidden'}}>
                      <View style={{flexDirection:'row', alignItems:'center', justifyContent:'center', minWidth:0, maxWidth:'100%'}}>
                      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{fontSize:12.2, lineHeight:15, fontWeight:active?'900':'800', color:active?WHITE:hexWithAlpha(ARENA_CHROME_ACCENT, 0.84), includeFontPadding:false, flexShrink:1}}>{label}</Text>
                      {count > 0 ? (
                        <View style={{minWidth:20, height:20, borderRadius:10, alignItems:'center', justifyContent:'center', paddingHorizontal:6, backgroundColor:active?hexWithAlpha(ARENA_CHROME_ACCENT, 0.16):'rgba(122,157,184,0.10)', borderWidth:1, borderColor:active?hexWithAlpha(ARENA_CHROME_ACCENT, 0.28):'rgba(122,157,184,0.12)', flexShrink:0, marginLeft:7}}>
                          <Text style={{fontSize:9.2, lineHeight:12, fontWeight:'900', color:active?WHITE:hexWithAlpha(ARENA_CHROME_ACCENT, 0.84), includeFontPadding:false}}>{count}</Text>
                        </View>
                      ) : null}
                      </View>
                    </View>
                  </LinearGradient>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>

      {/* Ranked tab content */}
      {prepTab === 0 ? (
        ranked.length > 0 ? (
          <View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}>
            {ranked.map((r, i)=><MatchupCard key={r.game.id} game={r.game} rank={i+1} headline={r.headline} tags={r.tags} detail={r.detail} resetSignal={resetSignal} />)}
          </View>
        ) : (
          <View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}><Text style={{fontSize:12, color:TEXT_MUTED}}>No model-ready scheduled games.</Text></View>
        )
      ) : null}

      {/* Upsets tab content */}
      {prepTab === 1 ? (
        <View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}>
          <Text style={{fontSize:11, color:TEXT_MUTED, lineHeight:16, marginBottom:12}}>Model-flagged volatility and upset-risk profiles.</Text>
          {upsetPlays.length > 0
            ? upsetPlays.map((r, i)=><MatchupCard key={`upset-${r.game.id}`} game={r.game} rank={i+1} headline={r.udHeadline} tags={[...r.udTags, ...r.tags]} detail={r.detail} resetSignal={resetSignal} />)
            : <View style={{backgroundColor:PANEL_DARK, borderRadius:14, borderWidth:2, borderColor:BORDER_MED, padding:14, shadowColor:'#000000', shadowOffset:{ width:0, height:9 }, shadowOpacity:0.26, shadowRadius:16, elevation:8}}><Text style={{fontSize:11, color:TEXT_MUTED, lineHeight:16}}>No model upset profiles on this slate.</Text></View>}
        </View>
      ) : null}

      <Disclaimer />
    </ArenaScrollView>
  );
});

// ─── REVIEW ───
const Review = memo(function Review({ final: fg, picks, stats, sh, onR, isR, bottomPadding, top, resetSignal }: { final: GameWithPrediction[]; picks: UserPick[]; stats: UserStats|undefined; sh: any; onR: ()=>void; isR: boolean; bottomPadding: number; top?: React.ReactNode; resetSignal?: number }) {
  const pm = useMemo(() => { const m = new Map<string, UserPick>(); picks.forEach(p => m.set(p.gameId, p)); return m; }, [picks]);
  const pfg = useMemo(() => fg.filter(g => pm.has(g.id)), [fg, pm]);
  const w = pfg.filter(g => pm.get(g.id)?.result==='win').length;
  const l = pfg.filter(g => pm.get(g.id)?.result==='loss').length;
  const t = w+l; const a = t>0?Math.round((w/t)*100):0;
  return (
    <ArenaScrollView sh={sh} onR={onR} isR={isR} bottomPadding={bottomPadding} resetSignal={resetSignal}>
      {top}
      <ArenaModeTitleBanner title="Review" subtitle="POSTGAME AUDIT" accent={SILVER} />
      {t>0?(
        <ReviewSummaryCard wins={w} losses={l} accuracy={a} games={pfg} picks={pm} />
      ):<View style={{alignItems:'center', paddingVertical:32, paddingHorizontal:18, marginHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}><Text style={{fontSize:13, lineHeight:19, color:TEXT_MUTED, textAlign:'center'}}>Settled picks will appear after final scores.</Text></View>}
      {pfg.length>0?<View style={{paddingHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP}}><ArenaSectionHeading eyebrow="POSTGAME" title="Results" accent={MAROON} />{pfg.map(g=><ResultCard key={g.id} game={g} pick={pm.get(g.id)} />)}</View>:null}
      {fg.length>0?<View style={{backgroundColor:PANEL_DARK, borderRadius:18, borderWidth:2, borderColor:BORDER_MED, padding:18, marginHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP, shadowColor:'#000000', shadowOffset:{ width:0, height:11 }, shadowOpacity:0.28, shadowRadius:20, elevation:10}}>
        <Text style={{fontSize:12.5, lineHeight:16, fontWeight:'700', color:WHITE, marginBottom:14}}>Model Notes</Text>
        {fg.slice(0, 3).map(g=>{const p=g.prediction;if(!p) return null;const pick=getCanonicalFinalPick(p);const conf=getCanonicalConfidence(p);const predictionDisplay=getGamePredictionDisplay(g);const ok=(pick==='home'&&(g.homeScore??0)>(g.awayScore??0))||(pick==='away'&&(g.awayScore??0)>(g.homeScore??0))||(pick==='draw'&&(g.homeScore??0)===(g.awayScore??0));return <View key={g.id} style={{marginBottom:12, paddingLeft:12, borderLeftWidth:3, borderLeftColor:ok?TEAL:LOSS}}><Text numberOfLines={2} style={{fontSize:11.5, lineHeight:15, fontWeight:'600', color:WHITE, marginBottom:4}}>{matchupTitle(g.awayTeam.name, g.homeTeam.name)}</Text><Text style={{fontSize:11.5, color:TEXT_SECONDARY, lineHeight:18}}>{(() => { const tl = `a ${getConfidenceTier(conf, predictionDisplay.isTossUp, predictionDisplay.marketType).label}`; const tm = predictionDisplay.badgeLabel; return ok ? `Model correctly predicted ${tm} as ${tl}.` : `Model missed — rated ${tm} as ${tl} but the upset came through.`; })()}</Text></View>;})}
      </View>:null}
      <View style={{backgroundColor:PANEL_DARK, borderWidth:2, borderColor:'rgba(139,10,31,0.12)', borderRadius:18, padding:18, marginHorizontal:ARENA_SIDE_PADDING, marginBottom:ARENA_SECTION_GAP, flexDirection:'row', justifyContent:'space-between', alignItems:'center', shadowColor:'#000000', shadowOffset:{ width:0, height:11 }, shadowOpacity:0.28, shadowRadius:20, elevation:10}}>
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
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Preview Pro: ${title}`}
      accessibilityHint="Opens Clutch Picks Pro"
      style={{ marginHorizontal: ARENA_SIDE_PADDING, marginBottom: ARENA_CARD_GAP }}
    >
      <LinearGradient
        colors={['rgba(122,157,184,0.24)', 'rgba(224,234,240,0.10)', 'rgba(224,234,240,0.10)', 'rgba(139,10,31,0.18)']}
        locations={[0, 0.44, 0.58, 1]}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={{
          borderRadius: 20,
          padding: 2.5,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.32,
          shadowRadius: 22,
          elevation: 12,
        }}
      >
        <View style={{ minHeight: 154, borderRadius: 17.5, backgroundColor: 'rgba(5,8,13,0.96)', borderWidth: 2, borderColor: 'rgba(122,157,184,0.10)', padding: 16, overflow: 'hidden' }}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(122,157,184,0.15)', 'rgba(255,255,255,0.025)', 'rgba(255,255,255,0.025)', 'rgba(139,10,31,0.08)', 'rgba(5,8,13,0.96)']}
            locations={[0, 0.3, 0.42, 0.66, 1]}
            start={{ x: 0.05, y: 0 }}
            end={{ x: 0.95, y: 1 }}
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
            colors={['rgba(122,157,184,0.24)', 'rgba(224,234,240,0.10)', 'rgba(139,10,31,0.18)']}
            locations={[0, 0.5, 1]}
            start={{ x: 0.05, y: 0 }}
            end={{ x: 0.95, y: 1 }}
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

  const live = useMemo(() => sortSuspendedGamesLast(filtered.filter(isLiveGameLike)), [filtered]);
  const sched = useMemo(() => filtered.filter(g => g.status === GameStatus.SCHEDULED).sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()), [filtered]);
  const final = useMemo(() => filtered.filter(g => g.status === GameStatus.FINAL).slice(0, 5), [filtered]);

  const openPaywall = useCallback(() => {
    fireLightHaptic();
    guardedRouterPush(router, '/paywall');
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
  const isFocused = useIsFocused();
  const { isPremium } = useSubscription();
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<React.ElementRef<typeof PagerView>>(null);
  const [sf, setSf] = useState('All');
  const [am, setAm] = useState(0);
  const [arenaPageResetKey, setArenaPageResetKey] = useState<number>(0);
  const [contentReady, setContentReady] = useState(false);
  const [fgi, setFgi] = useState<Set<string>>(new Set());
  const {data:allGames, isLoading, isError, refetch} = useGames({
    enabled: isFocused,
    subscribed: isFocused,
  });
  const {data:userPicks} = useUserPicks({
    enabled: isFocused && isPremium && contentReady,
    subscribed: isFocused,
  });
  const {data:userStats} = useUserStats({
    enabled: isFocused && isPremium && contentReady && am !== 0,
    subscribed: isFocused,
  });
  const {data:teamFollows} = useTeamFollows({
    enabled: isFocused && contentReady,
    subscribed: isFocused,
  });
  const sh = useHideOnScroll();
  const { refreshing: isR, onRefresh: onR } = useSmoothRefresh(refetch);
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



  const games = useMemo(() => { if (!allGames) return []; return sf==='All'?allGames:allGames.filter(g=>g.sport===sf); }, [allGames, sf]);
  const availableSports = useMemo(() => new Set((allGames ?? []).map(g => g.sport)), [allGames]);
  const followed = useMemo(() => { if (!allGames) return []; const ta = new Set((teamFollows??[]).map(t=>t.teamAbbreviation.toUpperCase())); return allGames.filter(g=>fgi.has(g.id)||ta.has(g.homeTeam.abbreviation.toUpperCase())||ta.has(g.awayTeam.abbreviation.toUpperCase())); }, [allGames, fgi, teamFollows]);
  const live = useMemo(() => sortSuspendedGamesLast(games.filter(isLiveGameLike)), [games]);
  const sched = useMemo(() => games.filter(g=>g.status===GameStatus.SCHEDULED), [games]);
  const final = useMemo(() => games.filter(g=>g.status===GameStatus.FINAL), [games]);

  

  const resetArenaPagePlacement = useCallback(() => {
    setArenaPageResetKey((key) => key + 1);
  }, []);

  const handleSportSelect = useCallback((sport: string) => {
    setSf(sport);
    resetArenaPagePlacement();
  }, [resetArenaPagePlacement]);

  const hmc = useCallback((m:number) => {
    if (m === am) return;
    fireSelectionHaptic();
    resetArenaPagePlacement();
    pagerRef.current?.setPage(m);
    setAm(m);
  }, [am, resetArenaPagePlacement]);

  const onArenaPageSelected = useCallback((event: any) => {
    const next = event.nativeEvent.position;
    if (typeof next !== 'number' || next === am) return;
    fireSelectionHaptic();
    resetArenaPagePlacement();
    setAm(next);
  }, [am, resetArenaPagePlacement]);

  const renderPremiumArenaChrome = useCallback(() => (
    <ArenaChrome
      selected={sf}
      onSelect={handleSportSelect}
      available={availableSports}
      showModes
      active={am}
      onChange={hmc}
      hasLive={live.length>0}
    />
  ), [am, availableSports, handleSportSelect, hmc, live.length, sf]);
  const isInitialArenaLoading = isLoading && !(allGames?.length);

  if (isInitialArenaLoading || !contentReady) {
    return (
      <TopInsetView style={{flex:1, backgroundColor:BG}}>
        <ErrorBoundary>
          <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ minHeight: '100%', paddingBottom: arenaBottomPadding }} scrollIndicatorInsets={{ bottom: arenaBottomPadding }}>
            <ArenaChrome selected={sf} onSelect={handleSportSelect} available={availableSports} showModes={false} active={am} onChange={hmc} hasLive={live.length>0} />
            {/* Reserve the segmented mode pill's exact footprint while loading so
                premium content does not jump up 88px when modes appear. Inert
                spacer (no visible controls) to keep the loading state honest. */}
            {isPremium ? <View style={{ height: SEG_PILL_RESERVED_HEIGHT }} /> : null}
            <ArenaLoadingWarmup />
          </Animated.ScrollView>
        </ErrorBoundary>
      </TopInsetView>
    );
  }

  // Hard fetch failure with no cached board to fall back on. With cached games
  // we keep showing the board (refetch/polling recovers silently); only a true
  // empty-and-errored state warrants taking over the screen.
  if (isError && !allGames?.length) {
    return (
      <TopInsetView style={{flex:1, backgroundColor:BG}}>
        <ErrorBoundary>
          <Animated.ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ minHeight: '100%', paddingBottom: arenaBottomPadding }}
            scrollIndicatorInsets={{ bottom: arenaBottomPadding }}
            refreshControl={<RefreshControl refreshing={isR} onRefresh={onR} tintColor={TEAL} />}
          >
            <ArenaChrome selected={sf} onSelect={handleSportSelect} available={availableSports} showModes={false} active={am} onChange={hmc} hasLive={false} />
            <ArenaErrorState onRetry={onR} isRetrying={isR} />
          </Animated.ScrollView>
        </ErrorBoundary>
      </TopInsetView>
    );
  }

  if (!isPremium) {
    return (
      <TopInsetView style={{flex:1, backgroundColor:BG}}>
        <ErrorBoundary>
        <FreeArena
          games={allGames ?? []}
          sportFilter={sf}
          router={router}
          sh={sh}
          onR={onR}
          isR={isR}
          followed={followed}
          bottomPadding={arenaBottomPadding}
          top={<ArenaChrome selected={sf} onSelect={handleSportSelect} available={availableSports} showModes={false} active={am} onChange={hmc} hasLive={live.length>0} />}
        />
        </ErrorBoundary>
      </TopInsetView>
    );
  }

  return (
    <TopInsetView style={{flex:1, backgroundColor:BG}}>
      <ErrorBoundary>
        {/* Pinned controls above the pager — only the page content swipes, so the
            header no longer duplicates and slides, and dragging the sport filters
            no longer fights the page swipe. */}
        {renderPremiumArenaChrome()}
        <PagerView
          ref={pagerRef}
          style={{ flex: 1 }}
          initialPage={am}
          scrollEnabled
          offscreenPageLimit={1}
          onPageSelected={onArenaPageSelected}
        >
          <View key="arena-game-day" style={{ width: '100%', flex: 1 }}>
            <GameDay
              live={live}
              sched={sched}
              picks={userPicks??[]}
              followed={followed}
              sh={sh}
              onR={onR}
              isR={isR}
              bottomPadding={arenaBottomPadding}
              resetSignal={am === 0 ? arenaPageResetKey : undefined}
            />
          </View>
          <View key="arena-prep" style={{ width: '100%', flex: 1 }}>
            <Prep
              sched={sched}
              picks={userPicks??[]}
              stats={userStats}
              sh={sh}
              onR={onR}
              isR={isR}
              bottomPadding={arenaBottomPadding}
              resetSignal={am === 1 ? arenaPageResetKey : undefined}
            />
          </View>
          <View key="arena-review" style={{ width: '100%', flex: 1 }}>
            <Review
              final={final}
              picks={userPicks??[]}
              stats={userStats}
              sh={sh}
              onR={onR}
              isR={isR}
              bottomPadding={arenaBottomPadding}
              resetSignal={am === 2 ? arenaPageResetKey : undefined}
            />
          </View>
        </PagerView>
      </ErrorBoundary>
    </TopInsetView>
  );
}
