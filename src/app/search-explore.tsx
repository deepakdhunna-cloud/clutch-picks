import React, { useState, useMemo, useCallback, useEffect, useDeferredValue, useRef, memo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Keyboard, StyleSheet, InteractionManager, FlatList, Platform } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Search, Clock, X, ChevronRight, Trophy, Radio, Flame, CalendarClock } from 'lucide-react-native';
import { haptics } from '@/lib/haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGames, usePrefetchGame } from '@/hooks/useGames';
import { GameWithPrediction, GameStatus, Sport, SPORT_META } from '@/types/sports';
import { displayConfidence, displaySport, formatGameTime, getConfidenceTier } from '@/lib/display-confidence';
import {
  getCanonicalConfidence,
} from '@/lib/canonical-result';
import { getGamePredictionDisplay } from '@/lib/prediction-display';
import { compareSuspendedGamePriority, isLiveGameLike, sortSuspendedGamesLast } from '@/lib/game-status';
import { getTeamColors } from '@/lib/team-colors';
import { SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS } from '@/lib/scroll-performance';
import { TeamJersey } from '@/components/sports/TeamJersey';
import { useSubscription } from '@/lib/subscription-context';
import { claimGameNavigation } from '@/lib/game-navigation-guard';
import { guardedRouterBack, guardedRouterPush } from '@/lib/navigation-guard';
import { useScrollPressGuard } from '@/hooks/useScrollPressGuard';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';
import {
  MAROON, TEAL, LIVE_RED, BG, PANEL_DARK, BORDER_MED,
  WHITE, TEXT_SECONDARY, TEXT_MUTED,
} from '@/lib/theme';

function fmtTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function hexWithAlpha(hex: string | undefined, alpha: number): string {
  if (!hex || hex[0] !== '#') return `rgba(122,157,184,${alpha})`;
  const a = Math.max(0, Math.min(1, alpha));
  const aHex = Math.round(a * 255).toString(16).padStart(2, '0');
  if (hex.length === 7) return `${hex}${aHex}`;
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}${aHex}`;
  return hex;
}

function fireLightHaptic() {
  haptics.tap();
}

function fireSelectionHaptic() {
  haptics.selection();
}

type StatusFilter = 'all' | 'live' | 'scheduled' | 'final';
const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Upcoming' },
  { key: 'final', label: 'Final' },
];
const SPORT_BADGE_LABELS: Record<string, string> = {
  TENNIS: 'TEN',
  NCAAF: 'CFB',
  NCAAB: 'CBB',
};
type StoryTone = 'live' | 'upset' | 'tossup' | 'soon' | 'final' | 'model';
const RESULT_INITIAL_RENDER_COUNT = 8;
const RESULT_RENDER_BATCH_SIZE = 6;
const RESULT_ROW_HEIGHT = 98;
const SEARCH_DEBOUNCE_MS = 180;
const EXPLORE_RAIL_SIDE_PADDING = 20;

function afterFrame(task: () => void) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(task);
    return;
  }
  setTimeout(task, 0);
}

function isLiveGame(game: GameWithPrediction): boolean {
  return isLiveGameLike(game);
}

function compareExploreGames(a: GameWithPrediction, b: GameWithPrediction): number {
  const aRank = isLiveGame(a) ? 0 : a.status === GameStatus.SCHEDULED ? 1 : a.status === GameStatus.FINAL ? 2 : 3;
  const bRank = isLiveGame(b) ? 0 : b.status === GameStatus.SCHEDULED ? 1 : b.status === GameStatus.FINAL ? 2 : 3;
  if (aRank !== bRank) return aRank - bRank;
  if (aRank === 0) {
    const suspendedOrder = compareSuspendedGamePriority(a, b);
    if (suspendedOrder !== 0) return suspendedOrder;
  }

  const aTime = new Date(a.gameTime).getTime();
  const bTime = new Date(b.gameTime).getTime();
  return aRank === 2 ? bTime - aTime : aTime - bTime;
}

// ─── LIVE DOT ───
const LiveDot = memo(function LiveDot() {
  const op = useSharedValue(1);
  useEffect(() => { op.value = withRepeat(withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true); return () => cancelAnimation(op); }, [op]);
  const s = useAnimatedStyle(() => ({ opacity: op.value }));
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: LIVE_RED }, s]} />;
});

// ─── SPORT BROWSE CARD ───
const SPORT_CARD_W = 130;
const SPORT_CARD_GAP = 14;
const SPORT_CARD_SNAP_INTERVAL = SPORT_CARD_W + SPORT_CARD_GAP;

const SportCard = memo(function SportCard({ sport, count, onSelect }: { sport: string; count: number; onSelect: (sport: string) => void }) {
  const meta = SPORT_META[sport as Sport];
  const color = meta?.color ?? TEXT_MUTED;
  const badgeLabel = SPORT_BADGE_LABELS[sport] ?? displaySport(sport);
  const { onTouchStart, onTouchMove, onTouchCancel, shouldHandlePress } = useTapGestureGuard(6, 500);
  const handlePress = useCallback(() => {
    if (!shouldHandlePress()) return;
    onSelect(sport);
  }, [onSelect, shouldHandlePress, sport]);
  return (
    <Pressable
      onPress={handlePress}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      pressRetentionOffset={6}
      accessibilityRole="button"
      accessibilityLabel={`Browse ${displaySport(sport)}, ${count} game${count !== 1 ? 's' : ''}`}
      accessibilityHint="Shows games for this sport"
      style={{ width: SPORT_CARD_W }}
    >
      <LinearGradient
        colors={[hexWithAlpha(color, 0.36), 'rgba(180,211,235,0.10)', 'rgba(255,255,255,0.04)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, padding: 1 }}
      >
        <View style={{ minHeight: 110, borderRadius: 17, padding: 14, overflow: 'hidden', backgroundColor: 'rgba(5,8,13,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.055)', justifyContent: 'space-between' }}>
          <LinearGradient pointerEvents="none" colors={[hexWithAlpha(color, 0.17), 'rgba(5,8,13,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
          <View style={{ width: 40, height: 34, borderRadius: 12, backgroundColor: hexWithAlpha(color, 0.16), borderWidth: 1, borderColor: hexWithAlpha(color, 0.26), alignItems: 'center', justifyContent: 'center' }}>
            <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={{ fontSize: 10, fontWeight: '900', color, letterSpacing: 0.2, maxWidth: 32 }}>{badgeLabel}</Text>
          </View>
          <View>
            <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{ fontSize: 14, fontWeight: '900', color: WHITE }}>{displaySport(sport)}</Text>
            <Text style={{ fontSize: 10.5, fontWeight: '700', color: 'rgba(180,211,235,0.58)', marginTop: 3 }}>{count} game{count !== 1 ? 's' : ''}</Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

// ─── GAME CARD BAR ───
// Fixed-height card so live, scheduled, and final all render at the same size.
// Center column reserves a slot for the prediction badge so the layout doesn't
// shift between cards with and without model output.
const GAME_BAR_MIN_HEIGHT = 158;
const GAME_BAR_CENTER_W = 112;

const GameBar = memo(function GameBar({ game, onPress, showModelSignals = false }: { game: GameWithPrediction; onPress: () => void; showModelSignals?: boolean }) {
  const live = isLiveGame(game);
  const final = game.status === GameStatus.FINAL;
  const awayC = getTeamColors(game.awayTeam.abbreviation, game.sport as Sport, game.awayTeam.color);
  const homeC = getTeamColors(game.homeTeam.abbreviation, game.sport as Sport, game.homeTeam.color);
  const awayAccent = awayC.accent;
  const homeAccent = homeC.accent;
  const sportMeta = SPORT_META[game.sport as Sport];
  const sportColor = sportMeta?.color ?? TEXT_MUTED;
  const timeStr = live ? null : final ? null : fmtTime(game.gameTime);
  const predictionDisplay = showModelSignals ? getGamePredictionDisplay(game) : null;
  const confidence = showModelSignals && game.prediction ? Math.round(displayConfidence(getCanonicalConfidence(game.prediction))) : null;
  const tier = showModelSignals && game.prediction ? getConfidenceTier(confidence ?? 50, predictionDisplay?.isTossUp, predictionDisplay?.marketType) : null;
  const statusLabel = live ? (formatGameTime(game.sport, game.quarter, game.clock) ?? 'LIVE') : final ? 'FINAL' : (timeStr ?? 'TBD');
  const showScores = live || final;
  const awayScore = game.awayScore ?? 0;
  const homeScore = game.homeScore ?? 0;
  const awayWon = final && awayScore > homeScore;
  const homeWon = final && homeScore > awayScore;
  const showBadge = predictionDisplay && predictionDisplay.outcome !== 'none' && confidence !== null;
  const badgeLabelText = showBadge ? `${predictionDisplay!.badgeLabel} ${confidence}%` : null;
  const { onTouchStart, onTouchMove, onTouchCancel, shouldHandlePress } = useTapGestureGuard(6, 500);

  return (
    <Pressable
      onPress={() => { if (!shouldHandlePress()) return; onPress(); }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      pressRetentionOffset={6}
      accessibilityRole="button"
      accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}
      accessibilityHint="Opens game details"
    >
      <LinearGradient
        colors={[hexWithAlpha(sportColor, 0.32), 'rgba(180,211,235,0.08)', live ? 'rgba(239,68,68,0.22)' : 'rgba(139,10,31,0.10)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, padding: 1 }}
      >
        <View style={{ minHeight: GAME_BAR_MIN_HEIGHT, borderRadius: 17, overflow: 'hidden', backgroundColor: 'rgba(5,8,13,0.97)', paddingVertical: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.055)' }}>
          <LinearGradient
            pointerEvents="none"
            colors={[hexWithAlpha(awayAccent, 0.12), 'rgba(5,8,13,0)', hexWithAlpha(homeAccent, 0.12)]}
            start={{ x: 0, y: 0.4 }}
            end={{ x: 1, y: 0.7 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, minWidth: 0 }}>
              <View style={{ backgroundColor: hexWithAlpha(sportColor, 0.16), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: hexWithAlpha(sportColor, 0.26) }}>
                <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{ fontSize: 9.5, fontWeight: '900', color: sportColor, letterSpacing: 1.1, maxWidth: 88 }}>{displaySport(game.sport)}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: live ? 'rgba(239,68,68,0.12)' : final ? 'rgba(148,163,184,0.08)' : 'rgba(255,255,255,0.045)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: live ? 'rgba(239,68,68,0.22)' : final ? 'rgba(148,163,184,0.16)' : 'rgba(255,255,255,0.07)' }}>
                {live ? <LiveDot /> : null}
                <Text style={{ fontSize: 9, fontWeight: '900', color: live ? LIVE_RED : final ? '#94a3b8' : TEXT_MUTED, letterSpacing: 0.8 }} numberOfLines={1}>{statusLabel}</Text>
              </View>
            </View>
            <ChevronRight size={16} color="rgba(224,234,240,0.38)" strokeWidth={2.5} />
          </View>

          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start', opacity: final && homeWon ? 0.58 : 1 }}>
              <TeamJersey teamAbbreviation={game.awayTeam.abbreviation} teamName={game.awayTeam.name} primaryColor={awayC.primary} secondaryColor={awayC.secondary} size={34} sport={game.sport as Sport} />
              <Text adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 15, fontWeight: '900', color: WHITE, marginTop: 6 }} numberOfLines={2}>{game.awayTeam.name}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(196,219,240,0.70)', marginTop: 2 }} numberOfLines={1}>{game.awayTeam.city}</Text>
            </View>
            <View style={{ width: GAME_BAR_CENTER_W, alignItems: 'center', justifyContent: 'center' }}>
              {showScores ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 24, lineHeight: 26, fontWeight: '900', color: awayWon ? WHITE : final ? 'rgba(255,255,255,0.62)' : WHITE, fontFamily: 'VT323_400Regular', letterSpacing: 1, minWidth: 32, textAlign: 'right' }}>{awayScore}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: 'rgba(180,211,235,0.42)', marginHorizontal: 6 }}>-</Text>
                  <Text style={{ fontSize: 24, lineHeight: 26, fontWeight: '900', color: homeWon ? WHITE : final ? 'rgba(255,255,255,0.62)' : WHITE, fontFamily: 'VT323_400Regular', letterSpacing: 1, minWidth: 32, textAlign: 'left' }}>{homeScore}</Text>
                </View>
              ) : (
                <Text style={{ fontSize: 14, lineHeight: 18, fontWeight: '900', color: 'rgba(180,211,235,0.62)', letterSpacing: 1.4 }}>VS</Text>
              )}
              <View style={{ height: 22, marginTop: 8, alignItems: 'center', justifyContent: 'center' }}>
                {badgeLabelText ? (
                  <View style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: hexWithAlpha(tier?.color ?? TEAL, 0.14), borderWidth: 1, borderColor: hexWithAlpha(tier?.color ?? TEAL, 0.24) }}>
                    <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{ fontSize: 9, fontWeight: '900', color: tier?.color ?? TEAL, letterSpacing: 0.3, maxWidth: 92 }}>{badgeLabelText}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end', opacity: final && awayWon ? 0.58 : 1 }}>
              <TeamJersey teamAbbreviation={game.homeTeam.abbreviation} teamName={game.homeTeam.name} primaryColor={homeC.primary} secondaryColor={homeC.secondary} size={34} sport={game.sport as Sport} />
              <Text adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 15, fontWeight: '900', color: WHITE, marginTop: 6, textAlign: 'right' }} numberOfLines={2}>{game.homeTeam.name}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(196,219,240,0.70)', marginTop: 2, textAlign: 'right' }} numberOfLines={1}>{game.homeTeam.city}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

const ResultGameRow = memo(function ResultGameRow({
  game,
  onSelect,
  onWarm,
  showModelSignals = false,
  canOpen,
}: {
  game: GameWithPrediction;
  onSelect: (game: GameWithPrediction) => void;
  onWarm?: (game: GameWithPrediction) => void;
  showModelSignals?: boolean;
  canOpen?: () => boolean;
}) {
  const live = isLiveGame(game);
  const final = game.status === GameStatus.FINAL;
  const sportMeta = SPORT_META[game.sport as Sport];
  const sportColor = sportMeta?.color ?? TEXT_MUTED;
  const predictionDisplay = showModelSignals ? getGamePredictionDisplay(game) : null;
  const confidence = showModelSignals && game.prediction ? Math.round(displayConfidence(getCanonicalConfidence(game.prediction))) : null;
  const tier = showModelSignals && game.prediction ? getConfidenceTier(confidence ?? 50, predictionDisplay?.isTossUp, predictionDisplay?.marketType) : null;
  const statusLabel = live
    ? (formatGameTime(game.sport, game.quarter, game.clock) ?? 'LIVE')
    : final
      ? 'FINAL'
      : (fmtTime(game.gameTime) ?? 'TBD');
  const showScores = live || final;
  const awayScore = game.awayScore ?? 0;
  const homeScore = game.homeScore ?? 0;
  const showBadge = predictionDisplay && predictionDisplay.outcome !== 'none' && confidence !== null;
  const handlePress = useCallback(() => {
    if (canOpen && !canOpen()) return;
    onSelect(game);
  }, [canOpen, game, onSelect]);
  const handlePressIn = useCallback(() => onWarm?.(game), [game, onWarm]);

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}
      accessibilityHint="Opens game details"
      style={{
        height: RESULT_ROW_HEIGHT,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: 'rgba(255,255,255,0.045)',
        borderWidth: 1,
        borderColor: live ? 'rgba(239,68,68,0.18)' : 'rgba(122,157,184,0.14)',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0, flexShrink: 1 }}>
          <View style={{ maxWidth: 112, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: hexWithAlpha(sportColor, 0.14), borderWidth: 1, borderColor: hexWithAlpha(sportColor, 0.22) }}>
            <Text adjustsFontSizeToFit minimumFontScale={0.78} style={{ fontSize: 9, fontWeight: '900', color: sportColor, letterSpacing: 1 }} numberOfLines={1}>
              {displaySport(game.sport)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {live ? <LiveDot /> : null}
            <Text style={{ fontSize: 9.5, fontWeight: '900', color: live ? LIVE_RED : final ? '#94a3b8' : TEXT_MUTED, letterSpacing: 0.7 }} numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
        </View>
        {showBadge ? (
          <View style={{ maxWidth: 98, flexShrink: 0, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: hexWithAlpha(tier?.color ?? TEAL, 0.12), borderWidth: 1, borderColor: hexWithAlpha(tier?.color ?? TEAL, 0.22) }}>
            <Text adjustsFontSizeToFit minimumFontScale={0.78} style={{ fontSize: 9, fontWeight: '900', color: tier?.color ?? TEAL }} numberOfLines={1}>
              {predictionDisplay!.badgeLabel} {confidence}%
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 15, lineHeight: 18, fontWeight: '900', color: WHITE }} numberOfLines={1}>
            {game.awayTeam.name}
          </Text>
          <Text style={{ fontSize: 10.5, lineHeight: 14, fontWeight: '700', color: 'rgba(196,219,240,0.72)', marginTop: 2 }} numberOfLines={1}>
            {game.awayTeam.city}
          </Text>
        </View>

        <View style={{ minWidth: 86, alignItems: 'center' }}>
          {showScores ? (
            <Text style={{ fontSize: 23, lineHeight: 24, fontWeight: '900', color: WHITE, fontFamily: 'VT323_400Regular', letterSpacing: 1 }} numberOfLines={1}>
              {awayScore} - {homeScore}
            </Text>
          ) : (
            <Text style={{ fontSize: 13, lineHeight: 16, fontWeight: '900', color: 'rgba(180,211,235,0.62)', letterSpacing: 1.1 }}>
              VS
            </Text>
          )}
        </View>

        <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
          <Text adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 15, lineHeight: 18, fontWeight: '900', color: WHITE, textAlign: 'right' }} numberOfLines={1}>
            {game.homeTeam.name}
          </Text>
          <Text style={{ fontSize: 10.5, lineHeight: 14, fontWeight: '700', color: 'rgba(196,219,240,0.72)', marginTop: 2, textAlign: 'right' }} numberOfLines={1}>
            {game.homeTeam.city}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

const SectionHeader = memo(function SectionHeader({ label, title, icon, accent = TEAL }: { label?: string; title: string; icon?: React.ReactNode; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14, position: 'relative', zIndex: 1 }}>
      {/* Accent edge anchors the section to its meaning (live=red, model/prep=teal). */}
      <View style={{ width: 3, alignSelf: 'stretch', minHeight: 30, borderRadius: 2, backgroundColor: accent, marginRight: 11 }} />
      {icon ? <View style={{ marginRight: 8 }}>{icon}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {label ? <Text style={{ fontSize: 9.5, lineHeight: 13, fontWeight: '900', color: hexWithAlpha(accent, 0.92), letterSpacing: 2, marginBottom: 3 }} numberOfLines={1}>{label}</Text> : null}
        <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: '900', color: WHITE }} numberOfLines={1}>{title}</Text>
      </View>
    </View>
  );
});

const StateCard = memo(function StateCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ marginHorizontal: 20, borderRadius: 18, padding: 18, alignItems: 'center', backgroundColor: PANEL_DARK, borderWidth: 1, borderColor: BORDER_MED }}>
      <Text style={{ fontSize: 14, lineHeight: 18, fontWeight: '900', color: WHITE, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontSize: 11, lineHeight: 17, fontWeight: '700', color: TEXT_MUTED, textAlign: 'center', marginTop: 6 }}>{body}</Text>
    </View>
  );
});

const RecentSearchRow = memo(function RecentSearchRow({
  term,
  onSelect,
  onRemove,
}: {
  term: string;
  onSelect: (term: string) => void;
  onRemove: (term: string) => void | Promise<void>;
}) {
  const handleSelect = useCallback(() => onSelect(term), [onSelect, term]);
  const handleRemove = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    void onRemove(term);
  }, [onRemove, term]);

  return (
    <Pressable
      onPress={handleSelect}
      accessibilityRole="button"
      accessibilityLabel={`Search recent term ${term}`}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, borderRadius: 14, paddingHorizontal: 13, backgroundColor: 'rgba(255,255,255,0.035)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}
    >
      <Clock size={14} color={TEXT_MUTED} />
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: TEXT_SECONDARY, marginLeft: 10 }} numberOfLines={1}>{term}</Text>
      <Pressable
        onPress={handleRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove recent search ${term}`}
        style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: -9 }}
      >
        <X size={14} color={TEXT_MUTED} />
      </Pressable>
    </Pressable>
  );
});

const STORY_CARD_W = 180;
const STORY_CARD_GAP = 16;
const STORY_CARD_SNAP_INTERVAL = STORY_CARD_W + STORY_CARD_GAP;

const SportCardRail = memo(function SportCardRail({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingLeft: EXPLORE_RAIL_SIDE_PADDING, paddingRight: EXPLORE_RAIL_SIDE_PADDING }}
      snapToInterval={SPORT_CARD_SNAP_INTERVAL}
      snapToAlignment="start"
      disableIntervalMomentum
      decelerationRate="fast"
    >
      {children}
    </ScrollView>
  );
});

const StoryCardRail = memo(function StoryCardRail({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingLeft: EXPLORE_RAIL_SIDE_PADDING, paddingRight: EXPLORE_RAIL_SIDE_PADDING }}
      snapToInterval={STORY_CARD_SNAP_INTERVAL}
      snapToAlignment="start"
      disableIntervalMomentum
      decelerationRate="fast"
    >
      {children}
    </ScrollView>
  );
});

const StoryCard = memo(function StoryCard({ game, tone, title, subtitle, onPress, onWarm }: { game: GameWithPrediction; tone: StoryTone; title: string; subtitle: string; onPress: () => void; onWarm?: () => void }) {
  const live = isLiveGame(game);
  const accent = tone === 'live' ? LIVE_RED : tone === 'upset' ? MAROON : tone === 'soon' ? TEAL : tone === 'final' ? '#94a3b8' : tone === 'tossup' ? '#94a3b8' : TEAL;
  const sportMeta = SPORT_META[game.sport as Sport];
  const sportColor = sportMeta?.color ?? TEXT_MUTED;
  // Per-item guard: every StoryCard lives in a horizontal rail, so a swipe
  // must not register as a tap and open the wrong game.
  const { onTouchStart, onTouchMove, onTouchCancel, shouldHandlePress } = useTapGestureGuard(6, 500);
  return (
    <Pressable
      onPressIn={onWarm}
      onPress={() => { if (!shouldHandlePress()) return; onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}
      accessibilityHint="Opens game details"
      pressRetentionOffset={6}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      style={{ width: STORY_CARD_W }}
    >
      <LinearGradient
        colors={[hexWithAlpha(accent, 0.34), 'rgba(180,211,235,0.08)', 'rgba(255,255,255,0.035)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, padding: 1 }}
      >
        <View style={{ minHeight: 134, borderRadius: 17, overflow: 'hidden', backgroundColor: 'rgba(5,8,13,0.97)', padding: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.055)', justifyContent: 'space-between' }}>
          <LinearGradient pointerEvents="none" colors={[hexWithAlpha(accent, 0.14), 'rgba(5,8,13,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              {live ? <View style={{ marginRight: 6 }}><LiveDot /></View> : null}
              <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 9, fontWeight: '900', color: accent, letterSpacing: 1.2 }}>{title.toUpperCase()}</Text>
            </View>
            <Text style={{ fontSize: 15, lineHeight: 18, fontWeight: '900', color: WHITE }} numberOfLines={2}>{game.awayTeam.name} at {game.homeTeam.name}</Text>
            <Text style={{ fontSize: 10.5, lineHeight: 15, fontWeight: '700', color: 'rgba(224,234,240,0.55)', marginTop: 7 }} numberOfLines={2}>{subtitle}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <View style={{ backgroundColor: hexWithAlpha(sportColor, 0.14), borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: hexWithAlpha(sportColor, 0.22), maxWidth: 112 }}>
              <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={{ fontSize: 9, fontWeight: '900', color: sportColor, letterSpacing: 1 }}>{displaySport(game.sport)}</Text>
            </View>
            <ChevronRight size={14} color="rgba(224,234,240,0.42)" strokeWidth={2.5} />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

function storyRowKey(index: number, total: number): { marginRight: number } {
  return { marginRight: index === total - 1 ? 0 : STORY_CARD_GAP };
}

// ─── MAIN ───
export default function SearchExploreScreen() {
  const router = useRouter();
  const exploreScrollPressGuard = useScrollPressGuard();
  const inputRef = useRef<TextInput>(null);
  const { data: allGames, isLoading: gamesLoading, isFetching: gamesFetching } = useGames();
  const prefetchGame = usePrefetchGame();
  const { isPremium } = useSubscription();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);
  const recentSearchesRef = useRef<string[]>([]);
  const deferredDebouncedQuery = useDeferredValue(debouncedQuery);

  const onChangeText = useCallback((text: string, instant?: boolean) => {
    setQuery(text);
    setSportFilter((current) => current === null ? current : null);
    setStatusFilter((current) => current === 'all' ? current : 'all');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (instant) {
      setDebouncedQuery(text);
    } else {
      debounceRef.current = setTimeout(() => setDebouncedQuery(text), SEARCH_DEBOUNCE_MS);
    }
  }, []);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('clutch_recent_searches')
      .then(raw => {
        if (!active) return;
        const parsed = raw ? JSON.parse(raw) : [];
        const next = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
        recentSearchesRef.current = next;
        setRecentSearches(next);
      })
      .catch(() => {
        if (active) setRecentSearches([]);
      });
    return () => {
      active = false;
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    recentSearchesRef.current = recentSearches;
  }, [recentSearches]);

  const saveRecent = useCallback(async (term: string) => {
    const updated = [term, ...recentSearchesRef.current.filter(s => s !== term)].slice(0, 5);
    recentSearchesRef.current = updated;
    if (mountedRef.current) setRecentSearches(updated);
    await AsyncStorage.setItem('clutch_recent_searches', JSON.stringify(updated)).catch(() => {});
  }, []);

  const removeRecent = useCallback(async (term: string) => {
    const updated = recentSearchesRef.current.filter(s => s !== term);
    recentSearchesRef.current = updated;
    if (mountedRef.current) setRecentSearches(updated);
    await AsyncStorage.setItem('clutch_recent_searches', JSON.stringify(updated)).catch(() => {});
  }, []);

  const clearRecents = useCallback(async () => {
    recentSearchesRef.current = [];
    if (mountedRef.current) setRecentSearches([]);
    await AsyncStorage.setItem('clutch_recent_searches', JSON.stringify([])).catch(() => {});
  }, []);

  const selectRecentSearch = useCallback((term: string) => {
    onChangeText(term, true);
  }, [onChangeText]);

  const handleSportTap = useCallback((sport: string) => {
    setSportFilter(sport);
    setStatusFilter('all');
    setQuery('');
    setDebouncedQuery('');
    afterFrame(fireSelectionHaptic);
  }, []);

  const sportCounts = useMemo(() => {
    if (!allGames) return [];
    const m = new Map<string, number>();
    for (const g of allGames) m.set(g.sport, (m.get(g.sport) ?? 0) + 1);
    return Array.from(m.entries()).map(([s, c]) => ({ sport: s, count: c })).sort((a, b) => b.count - a.count);
  }, [allGames]);

  const searchableGames = useMemo(() => {
    if (!allGames) return [];
    return allGames.map((game) => ({
      game,
      haystack: `${game.homeTeam.name} ${game.homeTeam.abbreviation} ${game.homeTeam.city} ${game.awayTeam.name} ${game.awayTeam.abbreviation} ${game.awayTeam.city} ${game.sport} ${game.venue ?? ''}`.toLowerCase(),
    }));
  }, [allGames]);

  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const localDateKey = useCallback((iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const trendingGames = useMemo(() => {
    if (!isPremium) return [];
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.prediction && g.status !== GameStatus.CANCELLED)
      .sort((a, b) => {
        const sa = ((a.prediction?.edgeRating ?? 5) * 10) + getCanonicalConfidence(a.prediction);
        const sb = ((b.prediction?.edgeRating ?? 5) * 10) + getCanonicalConfidence(b.prediction);
        return sb - sa;
      }).slice(0, 5);
  }, [allGames, isPremium]);

  const liveGames = useMemo(() => {
    if (!allGames) return [];
    return sortSuspendedGamesLast(allGames.filter(isLiveGame))
      .slice(0, 6);
  }, [allGames]);

  const todaySchedule = useMemo(() => {
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.status === GameStatus.SCHEDULED && localDateKey(g.gameTime) === todayKey)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
      .slice(0, 8);
  }, [allGames, localDateKey, todayKey]);

  const finalGames = useMemo(() => {
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.status === GameStatus.FINAL)
      .sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime())
      .slice(0, 6);
  }, [allGames]);

  const startingSoon = useMemo(() => {
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.status === GameStatus.SCHEDULED && localDateKey(g.gameTime) !== todayKey)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
      .slice(0, 6);
  }, [allGames, localDateKey, todayKey]);

  const tossUpGames = useMemo(() => {
    if (!isPremium) return [];
    if (!allGames) return [];
    return [...allGames]
      .filter((g) => {
        if (!g.prediction) return false;
        const display = getGamePredictionDisplay(g);
        const confidence = getCanonicalConfidence(g.prediction);
        return display.isTossUp || (
          display.marketType !== 'three_way_result' &&
          confidence >= 48 &&
          confidence <= 53
        );
      })
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
      .slice(0, 6);
  }, [allGames, isPremium]);

  const baseFilteredGames = useMemo(() => {
    if (!searchableGames.length) return [];
    if (sportFilter) return searchableGames.map(({ game }) => game).filter(g => g.sport === sportFilter).sort(compareExploreGames);
    if (!deferredDebouncedQuery.trim()) return [];
    // Split query into words, filter out "vs"/"at"/"@", match ANY word against game fields
    const words = deferredDebouncedQuery.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0 && !['vs', 'at', '@', '-'].includes(w));
    if (words.length === 0) return [];
    return searchableGames.filter(({ haystack }) => {
      return words.some(w => haystack.includes(w));
    }).map(({ game }) => game).sort(compareExploreGames);
  }, [deferredDebouncedQuery, sportFilter, searchableGames]);

  const filteredGames = useMemo(() => {
    if (statusFilter === 'all') return baseFilteredGames;
    if (statusFilter === 'live') return sortSuspendedGamesLast(baseFilteredGames.filter(isLiveGame), compareExploreGames);
    if (statusFilter === 'scheduled') return baseFilteredGames.filter(g => g.status === GameStatus.SCHEDULED);
    return baseFilteredGames.filter(g => g.status === GameStatus.FINAL);
  }, [baseFilteredGames, statusFilter]);

  const normalizedQuery = query.trim();
  const normalizedDeferredQuery = deferredDebouncedQuery.trim();
  const isSearchSettling = !sportFilter && normalizedQuery.length > 0 && normalizedDeferredQuery !== normalizedQuery;
  const showResults = sportFilter !== null || normalizedQuery.length > 0;
  const resultTitle = sportFilter ? displaySport(sportFilter) : (isSearchSettling && normalizedDeferredQuery ? normalizedDeferredQuery : normalizedQuery);
  const displayedFilteredGames = filteredGames;
  const hasExploreContent = recentSearches.length > 0
    || sportCounts.length > 0
    || liveGames.length > 0
    || todaySchedule.length > 0
    || finalGames.length > 0
    || startingSoon.length > 0
    || trendingGames.length > 0
    || tossUpGames.length > 0;

  const warmGame = useCallback((game: GameWithPrediction) => {
    prefetchGame(game.id, game);
  }, [prefetchGame]);

  const navGame = useCallback((game: GameWithPrediction) => {
    if (!exploreScrollPressGuard.canPress()) return;
    if (!claimGameNavigation(game.id)) return;
    // Fire the navigation FIRST so the push animation starts immediately.
    // Seed the detail cache immediately; haptics and storage writes wait until
    // after the transition so the tap stays responsive.
    const recentTerm = query.trim() || `${game.awayTeam.name} vs ${game.homeTeam.name}`;
    warmGame(game);
    guardedRouterPush(router, { pathname: '/game/[id]', params: { id: game.id } });
    afterFrame(() => {
      Keyboard.dismiss();
      fireLightHaptic();
      InteractionManager.runAfterInteractions(() => {
        void saveRecent(recentTerm);
      });
    });
  }, [exploreScrollPressGuard.canPress, query, router, saveRecent, warmGame]);

  const goBack = useCallback(() => {
    guardedRouterBack(router);
    afterFrame(() => Keyboard.dismiss());
  }, [router]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setSportFilter(null);
    setStatusFilter('all');
  }, []);

  const clearSportFilter = useCallback(() => {
    setSportFilter(null);
    setStatusFilter('all');
  }, []);

  const renderResultGame = useCallback(({ item }: { item: GameWithPrediction }) => (
    <View style={{ paddingHorizontal: 20 }}>
      <ResultGameRow game={item} showModelSignals={isPremium} onSelect={navGame} onWarm={warmGame} canOpen={exploreScrollPressGuard.canPress} />
    </View>
  ), [exploreScrollPressGuard.canPress, isPremium, navGame, warmGame]);

  const resultKeyExtractor = useCallback((item: GameWithPrediction) => item.id, []);
  const resultSeparator = useCallback(() => <View style={{ height: 12 }} />, []);

  const resultsHeader = useMemo(() => {
    if (baseFilteredGames.length === 0) return null;

    return (
      <View style={{ paddingTop: 2, paddingBottom: 14 }}>
        <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 10, fontWeight: '900', color: hexWithAlpha(TEAL, 0.9), letterSpacing: 2, marginBottom: 5 }}>
                {isSearchSettling ? 'UPDATING RESULTS' : sportFilter ? 'BROWSING SPORT' : 'SEARCH RESULTS'}
              </Text>
              <Text style={{ fontSize: 22, lineHeight: 27, fontWeight: '900', color: WHITE }} numberOfLines={1}>
                {resultTitle}
              </Text>
            </View>
            {sportFilter ? (
              <Pressable
                onPress={clearSportFilter}
                accessibilityRole="button"
                accessibilityLabel="Clear sport filter"
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '900', color: TEAL }}>CLEAR</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(196,219,240,0.68)', marginTop: 5 }}>
            {isSearchSettling ? 'Refreshing matches...' : `${baseFilteredGames.length} match${baseFilteredGames.length !== 1 ? 'es' : ''}`}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20 }}>
          {STATUS_OPTIONS.map(({ key, label }, i) => {
            const active = statusFilter === key;
            return (
              <View key={key} style={{ marginRight: i === STATUS_OPTIONS.length - 1 ? 0 : 10, marginBottom: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${label} games filter`}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    if (active) return;
                    setStatusFilter(key);
                    afterFrame(fireSelectionHaptic);
                  }}
                  style={{
                    minHeight: 44,
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? MAROON : 'rgba(122,157,184,0.10)',
                    borderWidth: 1,
                    borderColor: active ? MAROON : 'rgba(122,157,184,0.20)',
                  }}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: active ? WHITE : TEAL, letterSpacing: 0.2 }}>
                    {label}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    );
  }, [baseFilteredGames.length, clearSportFilter, isSearchSettling, resultTitle, sportFilter, statusFilter]);

  const emptyResults = useMemo(() => {
    if (isSearchSettling || gamesLoading) {
      return (
        <StateCard
          title="Searching slate"
          body="Checking the current board for matching teams, sports, and venues."
        />
      );
    }

    if (baseFilteredGames.length > 0) {
      return (
        <StateCard
          title={`No ${STATUS_OPTIONS.find(o => o.key === statusFilter)?.label.toLowerCase()} games`}
          body="Switch the status view to see the rest of the slate."
        />
      );
    }

    return (
      <View style={{ paddingTop: 30 }}>
        <StateCard
          title={`No matches ${sportFilter ? `for ${displaySport(sportFilter)}` : normalizedQuery ? `for "${normalizedQuery}"` : ''}`}
          body="Search another team, league, or venue."
        />
        {sportCounts.length > 0 ? (
          <View style={{ marginTop: 28 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 }}>
              <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: TEAL, marginRight: 11 }} />
              <Text style={{ fontSize: 11, fontWeight: '900', color: TEXT_SECONDARY, letterSpacing: 2 }}>
                BROWSE SPORTS
              </Text>
            </View>
            <SportCardRail>
              {sportCounts.map(({ sport, count }, i) => (
                <View key={sport} style={{ marginRight: i === sportCounts.length - 1 ? 0 : SPORT_CARD_GAP }}>
                  <SportCard sport={sport} count={count} onSelect={handleSportTap} />
                </View>
              ))}
            </SportCardRail>
          </View>
        ) : null}
      </View>
    );
  }, [baseFilteredGames.length, gamesLoading, handleSportTap, isSearchSettling, normalizedQuery, sportCounts, sportFilter, statusFilter]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to My Arena"
            hitSlop={12}
            style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
          >
            <ArrowLeft size={20} color={WHITE} strokeWidth={2.4} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ fontSize: 9.5, fontWeight: '900', color: hexWithAlpha(TEAL, 0.92), letterSpacing: 2.2 }}>ARENA SEARCH</Text>
            <Text style={{ fontSize: 22, lineHeight: 27, fontWeight: '900', color: WHITE, marginTop: 2 }}>Find a matchup</Text>
          </View>
        </View>

        <LinearGradient
          colors={['rgba(180,211,235,0.26)', 'rgba(122,157,184,0.12)', 'rgba(139,10,31,0.16)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 20, padding: 1 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, borderRadius: 19, backgroundColor: 'rgba(5,8,13,0.98)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.055)', paddingHorizontal: 14 }}>
            <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(122,157,184,0.12)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 11 }}>
              <Search size={17} color={TEAL} strokeWidth={2.4} />
            </View>
            <TextInput
              ref={inputRef}
              accessibilityLabel="Search teams, sports, venues"
              autoFocus
              style={{ flex: 1, fontSize: 15, fontWeight: '700', color: WHITE, paddingVertical: 0 }}
              placeholder="Search teams, sports, venues"
              placeholderTextColor="rgba(180,211,235,0.42)"
              keyboardAppearance="dark"
              selectionColor={TEAL}
              cursorColor={TEAL}
              returnKeyType="done"
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              value={query}
              onChangeText={onChangeText}
              onSubmitEditing={() => Keyboard.dismiss()}
            />
            {query.length > 0 || sportFilter ? (
              <Pressable
                onPress={clearSearch}
                accessibilityRole="button"
                accessibilityLabel="Clear arena search"
                style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.045)', marginRight: -7 }}
              >
                <X size={16} color={TEXT_MUTED} />
              </Pressable>
            ) : null}
          </View>
        </LinearGradient>
      </View>

      {showResults ? (
        <FlatList
          data={displayedFilteredGames}
          renderItem={renderResultGame}
          keyExtractor={resultKeyExtractor}
          ItemSeparatorComponent={resultSeparator}
          ListHeaderComponent={resultsHeader}
          ListEmptyComponent={emptyResults}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={{ paddingBottom: 60, flexGrow: 1 }}
          initialNumToRender={RESULT_INITIAL_RENDER_COUNT}
          maxToRenderPerBatch={RESULT_RENDER_BATCH_SIZE}
          updateCellsBatchingPeriod={40}
          windowSize={7}
          removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}
          onScrollBeginDrag={exploreScrollPressGuard.onScrollBeginDrag}
          onScrollEndDrag={exploreScrollPressGuard.onScrollEndDrag}
          onMomentumScrollBegin={exploreScrollPressGuard.onMomentumScrollBegin}
          onMomentumScrollEnd={exploreScrollPressGuard.onMomentumScrollEnd}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
          onScrollBeginDrag={exploreScrollPressGuard.onScrollBeginDrag}
          onScrollEndDrag={exploreScrollPressGuard.onScrollEndDrag}
          onMomentumScrollBegin={exploreScrollPressGuard.onMomentumScrollBegin}
          onMomentumScrollEnd={exploreScrollPressGuard.onMomentumScrollEnd}
        >
          <>
            {recentSearches.length > 0 ? (
              <View style={{ marginBottom: 32 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: TEAL, marginRight: 11 }} />
                    <Text style={{ fontSize: 11, fontWeight: '900', color: TEXT_SECONDARY, letterSpacing: 2 }}>RECENT SEARCHES</Text>
                  </View>
                  <Pressable
                    onPress={clearRecents}
                    accessibilityRole="button"
                    accessibilityLabel="Clear recent searches"
                    style={{ minHeight: 44, justifyContent: 'center' }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '900', color: MAROON }}>CLEAR</Text>
                  </Pressable>
                </View>
                <View style={{ paddingHorizontal: 20, gap: 8 }}>
                  {recentSearches.map(term => (
                    <RecentSearchRow key={term} term={term} onSelect={selectRecentSearch} onRemove={removeRecent} />
                  ))}
                </View>
              </View>
            ) : null}

            {!hasExploreContent ? (
              <StateCard
                title={gamesLoading || gamesFetching ? 'Loading slate' : 'No games available'}
                body={gamesLoading || gamesFetching ? 'Building the latest live, scheduled, and final boards.' : 'Check back shortly for new matchups.'}
              />
            ) : null}

            {liveGames.length > 0 ? (
              <View style={{ marginBottom: 32 }}>
                <SectionHeader icon={<Radio size={14} color={LIVE_RED} />} label="HAPPENING NOW" title="Live games" accent={LIVE_RED} />
                <StoryCardRail>
                  {liveGames.map((game, i) => (
                    <View key={`live-${game.id}`} style={storyRowKey(i, liveGames.length)}>
                      <StoryCard
                        game={game}
                        tone="live"
                        title="Live"
                        subtitle={`${game.awayScore ?? 0}-${game.homeScore ?? 0} · ${formatGameTime(game.sport, game.quarter, game.clock) ?? 'In progress'}`}
                        onWarm={() => warmGame(game)}
                        onPress={() => navGame(game)}
                      />
                    </View>
                  ))}
                </StoryCardRail>
              </View>
            ) : null}

            {sportCounts.length > 0 ? (
              <View style={{ marginBottom: 32 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 }}>
                  <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: TEAL, marginRight: 11 }} />
                  <Text style={{ fontSize: 11, fontWeight: '900', color: TEXT_SECONDARY, letterSpacing: 2 }}>BROWSE THE SLATE</Text>
                </View>
                <SportCardRail>
                  {sportCounts.map(({ sport, count }, i) => (
                    <View key={sport} style={{ marginRight: i === sportCounts.length - 1 ? 0 : SPORT_CARD_GAP }}>
                      <SportCard sport={sport} count={count} onSelect={handleSportTap} />
                    </View>
                  ))}
                </SportCardRail>
              </View>
            ) : null}

            {todaySchedule.length > 0 ? (
              <View style={{ marginBottom: 32 }}>
                <SectionHeader icon={<CalendarClock size={14} color={TEAL} />} label="TODAY" title="Scheduled games" accent={TEAL} />
                <StoryCardRail>
                  {todaySchedule.map((game, i) => (
                    <View key={`today-${game.id}`} style={storyRowKey(i, todaySchedule.length)}>
                      <StoryCard
                        game={game}
                        tone="soon"
                        title={fmtTime(game.gameTime)}
                        subtitle={`${displaySport(game.sport)} · ${game.venue && game.venue !== 'TBD' ? game.venue : 'Scheduled'}`}
                        onWarm={() => warmGame(game)}
                        onPress={() => navGame(game)}
                      />
                    </View>
                  ))}
                </StoryCardRail>
              </View>
            ) : null}

            {finalGames.length > 0 ? (
              <View style={{ marginBottom: 32 }}>
                <SectionHeader icon={<Clock size={14} color={MAROON} />} label="RECENT" title="Final scores" accent={MAROON} />
                <StoryCardRail>
                  {finalGames.map((game, i) => (
                    <View key={`final-${game.id}`} style={storyRowKey(i, finalGames.length)}>
                      <StoryCard
                        game={game}
                        tone="final"
                        title="Final"
                        subtitle={`${game.awayTeam.name} ${game.awayScore ?? 0} · ${game.homeTeam.name} ${game.homeScore ?? 0}`}
                        onWarm={() => warmGame(game)}
                        onPress={() => navGame(game)}
                      />
                    </View>
                  ))}
                </StoryCardRail>
              </View>
            ) : null}

            {tossUpGames.length > 0 ? (
              <View style={{ marginBottom: 32 }}>
                <SectionHeader icon={<Flame size={14} color={TEAL} />} label="CLOSEST READS" title="Toss-up watch" accent={TEAL} />
                <StoryCardRail>
                  {tossUpGames.map((game, i) => (
                    <View key={`toss-${game.id}`} style={storyRowKey(i, tossUpGames.length)}>
                      <StoryCard
                        game={game}
                        tone="tossup"
                        title="Toss-up"
                        subtitle={`Model has this close to even · ${fmtTime(game.gameTime)}`}
                        onWarm={() => warmGame(game)}
                        onPress={() => navGame(game)}
                      />
                    </View>
                  ))}
                </StoryCardRail>
              </View>
            ) : null}

            {startingSoon.length > 0 ? (
              <View style={{ marginBottom: 32 }}>
                <SectionHeader icon={<CalendarClock size={14} color={TEAL} />} label="NEXT WINDOW" title="Starting soon" accent={TEAL} />
                <StoryCardRail>
                  {startingSoon.map((game, i) => (
                    <View key={`soon-${game.id}`} style={storyRowKey(i, startingSoon.length)}>
                      <StoryCard
                        game={game}
                        tone="soon"
                        title={fmtTime(game.gameTime)}
                        subtitle={`${displaySport(game.sport)} · ${game.venue && game.venue !== 'TBD' ? game.venue : 'Scheduled'}`}
                        onWarm={() => warmGame(game)}
                        onPress={() => navGame(game)}
                      />
                    </View>
                  ))}
                </StoryCardRail>
              </View>
            ) : null}

            {trendingGames.length > 0 ? (
              <View style={{ marginBottom: 32 }}>
                <SectionHeader icon={<Trophy size={14} color={TEAL} />} label="MODEL BOARD" title="Top grades" accent={TEAL} />
                <View style={{ paddingHorizontal: 20 }}>
                  {trendingGames.map((game, i) => (
                    <View key={game.id} style={{ marginBottom: i === trendingGames.length - 1 ? 0 : 14 }}>
                      <GameBar game={game} showModelSignals={isPremium} onPress={() => navGame(game)} />
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
