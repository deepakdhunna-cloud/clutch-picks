import React, { useState, useCallback, useMemo, useEffect, memo } from 'react';
import {
  View, Text, Pressable, ScrollView,
  ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Search, ChevronRight, TrendingUp, Tv, AlertTriangle,
  Zap, Target, BarChart3,
} from 'lucide-react-native';
import { useGames } from '@/hooks/useGames';
import { useLiveScores } from '@/hooks/useLiveScores';
import { useSubscription } from '@/lib/subscription-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameStatus, GameWithPrediction } from '@/types/sports';

// ─── PALETTE ─────────────────────────────────────────────────────
const BG = '#040608';
const TEAL = '#7A9DB8';
const CORAL = '#E8936A';
const GREEN = '#4ADE80';
const RED = '#EF4444';
const WHITE = '#FFFFFF';

// ─── Helpers ─────────────────────────────────────────────────────
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatTimeShort(iso: string): { time: string; ampm: string } {
  const d = new Date(iso);
  const str = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const parts = str.split(' ');
  return { time: parts[0] ?? str, ampm: parts[1] ?? '' };
}

function getStatusText(game: GameWithPrediction): string {
  if (game.status === GameStatus.LIVE) {
    const parts: string[] = [];
    if (game.quarter) parts.push(game.quarter);
    if (game.clock) parts.push(game.clock);
    return parts.join(' ') || 'LIVE';
  }
  return formatTime(game.gameTime);
}

function getWinPct(record: string): number {
  const parts = record.split('-');
  const w = parseInt(parts[0] ?? '0', 10);
  const l = parseInt(parts[1] ?? '0', 10);
  if (isNaN(w) || isNaN(l) || w + l === 0) return 0.5;
  return w / (w + l);
}

type TagType = 'nailbiter' | 'upset' | 'blowout' | 'streak';

function getGameTag(game: GameWithPrediction): { type: TagType; label: string } | null {
  const pred = game.prediction;
  if (!pred) return null;
  const conf = pred.confidence ?? 55;

  // Nail-biter
  if (conf >= 48 && conf <= 55 && (game.status === GameStatus.SCHEDULED || game.status === GameStatus.LIVE)) {
    return { type: 'nailbiter', label: 'NAIL-BITER' };
  }
  // Upset
  if (conf >= 55 && conf <= 65) {
    const homeWinPct = getWinPct(game.homeTeam.record);
    const awayWinPct = getWinPct(game.awayTeam.record);
    const predictedWinnerPct = pred.predictedWinner === 'home' ? homeWinPct : awayWinPct;
    const otherPct = pred.predictedWinner === 'home' ? awayWinPct : homeWinPct;
    if (predictedWinnerPct < otherPct) {
      return { type: 'upset', label: 'UPSET ALERT' };
    }
  }
  // Blowout
  if (conf > 75) {
    return { type: 'blowout', label: 'BLOWOUT' };
  }
  // Streak
  if ((pred.homeStreak != null && pred.homeStreak >= 4) || (pred.awayStreak != null && pred.awayStreak >= 4)) {
    return { type: 'streak', label: 'STREAK' };
  }
  return null;
}

const TAG_STYLES: Record<TagType, { bg: string; border: string; color: string; Icon: typeof Zap }> = {
  nailbiter: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.25)', color: RED, Icon: Zap },
  upset: { bg: 'rgba(232,147,106,0.12)', border: 'rgba(232,147,106,0.25)', color: CORAL, Icon: AlertTriangle },
  blowout: { bg: 'rgba(122,157,184,0.12)', border: 'rgba(122,157,184,0.2)', color: TEAL, Icon: TrendingUp },
  streak: { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.25)', color: GREEN, Icon: Target },
};


// ─── PULSING DOT ─────────────────────────────────────────────────
const PulsingDot = memo(function PulsingDot({ size = 8, color = RED }: { size?: number; color?: string }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.3, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
});

// ─── TAG BADGE ───────────────────────────────────────────────────
function TagBadge({ tag, absolute }: { tag: { type: TagType; label: string }; absolute?: boolean }) {
  const s = TAG_STYLES[tag.type];
  const IconComp = s.Icon;
  return (
    <View
      style={[
        {
          flexDirection: 'row', alignItems: 'center', gap: 3,
          paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
          backgroundColor: s.bg, borderWidth: 1, borderColor: s.border,
        },
        absolute && { position: 'absolute', top: 8, right: 8, zIndex: 10 },
      ]}
    >
      <IconComp size={8} color={s.color} strokeWidth={2.5} />
      <Text style={{ fontSize: 7, fontWeight: '800', color: s.color, letterSpacing: 0.3 }}>{tag.label}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: HEADER + SEARCH
// ═══════════════════════════════════════════════════════════════════
function HeaderSection({ liveCount }: { liveCount: number }) {
  return (
    <Animated.View entering={FadeInDown.duration(400)} style={{ paddingHorizontal: 20 }}>
      {/* Row 1: Title + Live count */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: '900', color: WHITE }}>My Arena</Text>
        {liveCount > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <PulsingDot size={8} color={RED} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: RED }}>{liveCount} LIVE</Text>
          </View>
        ) : null}
      </View>

      {/* Row 2: Search bar */}
      <Pressable
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingVertical: 13, paddingHorizontal: 16, borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <Search size={16} color="rgba(255,255,255,0.2)" strokeWidth={2} />
        <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.2)' }}>Search teams, players, games...</Text>
      </Pressable>
      <View style={{ height: 4 }} />
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: YOUR GAMES
// ═══════════════════════════════════════════════════════════════════
const FollowedGameCard = memo(function FollowedGameCard({
  game, onPress,
}: {
  game: GameWithPrediction;
  onPress: () => void;
}) {
  const isLive = game.status === GameStatus.LIVE;
  const tag = getGameTag(game);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <View style={{ minWidth: 145, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 16, overflow: 'hidden' }}>
        {isLive ? (
          <LinearGradient
            colors={['rgba(239,68,68,0.06)', 'rgba(4,6,8,0.9)']}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.03)' }]} />
        )}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderWidth: 1,
              borderColor: isLive ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
              borderRadius: 16,
            },
          ]}
          pointerEvents="none"
        />

        {tag ? <TagBadge tag={tag} absolute /> : null}

        <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>{game.sport}</Text>
        <Text style={{ fontSize: 17, fontWeight: '900', color: WHITE }}>{game.awayTeam.abbreviation}</Text>
        <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', marginVertical: 2 }}>vs</Text>
        <Text style={{ fontSize: 17, fontWeight: '900', color: WHITE }}>{game.homeTeam.abbreviation}</Text>

        <View style={{ marginTop: 8 }}>
          {isLive ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <PulsingDot size={5} color={RED} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: RED, fontVariant: ['tabular-nums'] }}>
                {game.awayScore ?? 0}-{game.homeScore ?? 0}
              </Text>
              <Text style={{ fontSize: 9, color: `${RED}80` }}>{game.quarter ?? null}</Text>
            </View>
          ) : (
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>{formatTime(game.gameTime)}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
});

function YourGamesSection({
  games, router, followedGameIds,
}: {
  games: GameWithPrediction[];
  router: ReturnType<typeof useRouter>;
  followedGameIds: Set<string>;
}) {
  // Filter to only games the user has followed
  const todayGames = useMemo(() => {
    if (followedGameIds.size === 0) return [];
    return (games ?? []).filter(
      (g) => followedGameIds.has(g.id)
    ).slice(0, 10);
  }, [games, followedGameIds]);

  return (
    <Animated.View entering={FadeInDown.delay(100).duration(400)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE }}>Your Games</Text>
        <Pressable onPress={() => router.push('/(tabs)')}>
          <Text style={{ fontSize: 11, fontWeight: '600', color: TEAL }}>Browse +</Text>
        </Pressable>
      </View>

      {todayGames.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 8, gap: 10 }}
          style={{ flexGrow: 0 }}
        >
          {todayGames.map(game => (
            <FollowedGameCard
              key={game.id}
              game={game}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: '/game/[id]', params: { id: game.id } });
              }}
            />
          ))}
          {/* Add card */}
          <View style={{
            minWidth: 65, minHeight: 120, borderRadius: 16,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
          }}>
            <View style={{
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 18, fontWeight: '400', color: 'rgba(255,255,255,0.15)' }}>+</Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <View style={{ paddingHorizontal: 20, paddingVertical: 24 }}>
          <View style={{
            padding: 20, borderRadius: 16,
            backgroundColor: 'rgba(255,255,255,0.02)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
            alignItems: 'center',
          }}>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>Tap Follow on any game to add it here</Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: YOUR NIGHT PLAN
// ═══════════════════════════════════════════════════════════════════
interface TimelineEntry {
  game: GameWithPrediction;
  time: { time: string; ampm: string };
  note: string;
  isFirst: boolean;
}

function NightPlanSection({ games, router }: { games: GameWithPrediction[]; router: ReturnType<typeof useRouter> }) {
  const entries = useMemo<TimelineEntry[]>(() => {
    // Include scheduled and final games — API returns today's slate
    const upcoming = (games ?? [])
      .filter(g => g.status === GameStatus.SCHEDULED || g.status === GameStatus.LIVE)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
      .slice(0, 6);

    if (upcoming.length === 0) return [];
    const scheduled = upcoming;

    return scheduled.map((game, i) => {
      let note = 'Check in on this one';
      if (i === 0) note = 'Start here';
      else {
        const prev = scheduled[i - 1];
        if (prev?.prediction && (prev.prediction.confidence ?? 0) > 70) {
          note = `Switch from ${prev.awayTeam.abbreviation}/${prev.homeTeam.abbreviation} if it's a blowout`;
        } else if (game.prediction?.isTossUp || (game.prediction?.confidence ?? 50) <= 55) {
          note = "Don't miss this one";
        }
      }
      return {
        game,
        time: formatTimeShort(game.gameTime),
        note,
        isFirst: i === 0,
      };
    });
  }, [games]);

  if (entries.length === 0) {
    return (
      <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ paddingHorizontal: 20, marginTop: 20 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', color: TEAL, letterSpacing: 2, marginBottom: 6 }}>YOUR NIGHT PLAN</Text>
        <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', textAlign: 'center', paddingVertical: 16 }}>
          Follow games to build your night plan
        </Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginTop: 20 }}>
      <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', color: TEAL, letterSpacing: 2, marginBottom: 4 }}>YOUR NIGHT PLAN</Text>
        <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE }}>What to watch and when</Text>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Based on tonight's schedule</Text>
      </View>

      <View style={{ paddingLeft: 20, position: 'relative' }}>
        {/* Vertical line */}
        <View style={{ position: 'absolute', left: 6, top: 8, bottom: 8, width: 2, overflow: 'hidden' }}>
          <LinearGradient
            colors={['rgba(122,157,184,0.3)', 'rgba(122,157,184,0.05)']}
            style={{ flex: 1 }}
          />
        </View>

        {entries.map((entry) => (
          <Pressable
            key={entry.game.id}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: '/game/[id]', params: { id: entry.game.id } });
            }}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 14, paddingRight: 20 }}
          >
            {/* Timeline dot */}
            <View
              style={{
                width: 10, height: 10, borderRadius: 5, marginTop: 12,
                backgroundColor: entry.isFirst ? TEAL : 'rgba(255,255,255,0.1)',
                borderWidth: entry.isFirst ? 2 : 0,
                borderColor: entry.isFirst ? TEAL : 'transparent',
                ...(entry.isFirst ? {
                  shadowColor: TEAL,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.5,
                  shadowRadius: 6,
                } : {}),
              }}
            />

            {/* Time */}
            <View style={{ width: 40, alignItems: 'flex-end', marginTop: 8 }}>
              <Text style={{
                fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'],
                color: entry.isFirst ? WHITE : 'rgba(255,255,255,0.3)',
              }}>
                {entry.time.time}
              </Text>
              <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{entry.time.ampm}</Text>
            </View>

            {/* Card */}
            <View
              style={{
                flex: 1, padding: 12, paddingHorizontal: 14, borderRadius: 14,
                backgroundColor: entry.isFirst ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                borderWidth: 1,
                borderColor: entry.isFirst ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
              }}
            >
              <Text style={{
                fontSize: 14, fontWeight: '800',
                color: entry.isFirst ? WHITE : 'rgba(255,255,255,0.5)',
              }}>
                {entry.game.awayTeam.abbreviation} @ {entry.game.homeTeam.abbreviation}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                {entry.game.tvChannel ? (
                  <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>{entry.game.tvChannel}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{
                fontSize: 11, fontStyle: 'italic', marginTop: 6,
                color: entry.isFirst ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)',
              }}>
                {entry.note}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 4: LIVE ARENA
// ═══════════════════════════════════════════════════════════════════
const LiveGameCard = memo(function LiveGameCard({
  game, onPress,
}: {
  game: GameWithPrediction;
  onPress: () => void;
}) {
  const awayScore = game.awayScore ?? 0;
  const homeScore = game.homeScore ?? 0;
  const diff = Math.abs(awayScore - homeScore);
  const awayLeading = awayScore > homeScore;
  const homeLeading = homeScore > awayScore;
  const tag = getGameTag(game);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <View style={{ marginBottom: 10, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(239,68,68,0.1)' }}>
        <LinearGradient
          colors={['rgba(239,68,68,0.03)', 'rgba(4,6,8,0.95)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Left accent */}
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: RED, opacity: 0.6 }} />

        <View style={{ padding: 14, paddingLeft: 18 }}>
          {/* Row 1: Sport + tag + period */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)' }}>{game.sport}</Text>
              </View>
              {tag ? <TagBadge tag={tag} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <PulsingDot size={6} color={RED} />
              <Text style={{ fontSize: 10, fontWeight: '700', color: RED }}>{getStatusText(game)}</Text>
            </View>
          </View>

          {/* Row 2: Scores */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 10 }}>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: awayLeading ? WHITE : 'rgba(255,255,255,0.25)', marginBottom: 4 }}>
                {game.awayTeam.abbreviation}
              </Text>
              <Text style={{
                fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -1,
                color: awayLeading ? WHITE : 'rgba(255,255,255,0.25)',
              }}>
                {awayScore}
              </Text>
            </View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.08)' }}>-</Text>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: homeLeading ? WHITE : 'rgba(255,255,255,0.25)', marginBottom: 4 }}>
                {game.homeTeam.abbreviation}
              </Text>
              <Text style={{
                fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -1,
                color: homeLeading ? WHITE : 'rgba(255,255,255,0.25)',
              }}>
                {homeScore}
              </Text>
            </View>
          </View>

          {/* Row 3: Momentum indicator */}
          {diff <= 5 ? (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center',
              paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8,
              backgroundColor: 'rgba(255,255,255,0.02)',
            }}>
              <Zap size={10} color={TEAL} strokeWidth={2} />
              <Text style={{ fontSize: 10, fontWeight: '600', color: TEAL }}>
                Close game — within {diff} {diff === 1 ? 'point' : 'points'}
              </Text>
            </View>
          ) : (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center',
              paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8,
              backgroundColor: 'rgba(255,255,255,0.02)',
            }}>
              <TrendingUp size={10} color="rgba(255,255,255,0.2)" strokeWidth={2} />
              <Text style={{ fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.3)' }}>
                {awayLeading ? game.awayTeam.abbreviation : game.homeTeam.abbreviation} leading by {diff}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
});

function LiveArenaSection({ games, router }: { games: GameWithPrediction[]; router: ReturnType<typeof useRouter> }) {
  const liveGames = useMemo(() =>
    (games ?? []).filter(g => g.status === GameStatus.LIVE),
    [games]
  );

  if (liveGames.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.delay(300).duration(400)} style={{ marginTop: 20, paddingHorizontal: 20 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PulsingDot size={8} color={RED} />
          <Text style={{ fontSize: 14, fontWeight: '900', color: WHITE }}>Live Arena</Text>
        </View>
        <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{liveGames.length} active</Text>
      </View>

      {liveGames.map(game => (
        <LiveGameCard
          key={game.id}
          game={game}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: '/game/[id]', params: { id: game.id } });
          }}
        />
      ))}
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: TONIGHT'S STORYLINES
// ═══════════════════════════════════════════════════════════════════
function generateHeadline(game: GameWithPrediction): string {
  const pred = game.prediction;
  if (!pred) return `${game.awayTeam.abbreviation} at ${game.homeTeam.abbreviation}`;
  const conf = pred.confidence ?? 55;
  const winner = pred.predictedWinner === 'home' ? game.homeTeam.abbreviation : game.awayTeam.abbreviation;
  const location = pred.predictedWinner === 'home' ? 'at home' : 'on the road';

  if (conf > 70) return `${winner} heavy favorites ${location}`;
  if (pred.isTossUp) return 'Too close to call — anything can happen';
  if ((pred.homeStreak ?? 0) >= 4) return `${game.homeTeam.abbreviation} riding a ${pred.homeStreak}-game streak`;
  if ((pred.awayStreak ?? 0) >= 4) return `${game.awayTeam.abbreviation} riding a ${pred.awayStreak}-game streak`;
  return `${game.awayTeam.abbreviation} at ${game.homeTeam.abbreviation} — key ${game.sport} matchup`;
}

function generateStory(game: GameWithPrediction): string {
  const pred = game.prediction;
  if (pred?.analysis) {
    const firstSentence = pred.analysis.split('.')[0];
    if (firstSentence && firstSentence.length > 10) return firstSentence + '.';
  }
  const parts: string[] = [];
  parts.push(`${game.awayTeam.abbreviation} (${game.awayTeam.record}) visit ${game.homeTeam.abbreviation} (${game.homeTeam.record}).`);
  if (game.spread != null) {
    const favored = game.spread > 0 ? game.homeTeam.abbreviation : game.awayTeam.abbreviation;
    parts.push(`${favored} favored by ${Math.abs(game.spread).toFixed(1)}.`);
  }
  return parts.join(' ');
}

const StorylineCard = memo(function StorylineCard({
  game, isPremium, router,
}: {
  game: GameWithPrediction;
  isPremium: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const tag = getGameTag(game);
  const headline = generateHeadline(game);
  const story = generateStory(game);
  const pred = game.prediction;
  const conf = pred?.confidence ?? 55;

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: '/game/[id]', params: { id: game.id } });
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      <View style={{ borderRadius: 20, overflow: 'hidden', marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        <LinearGradient
          colors={['#0C1018', '#08090E']}
          start={{ x: 0.3, y: 0 }}
          end={{ x: 0.7, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Top section */}
        <View style={{ padding: 16, paddingBottom: 0 }}>
          {/* Row 1: Sport + tag + time */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.3)' }}>{game.sport}</Text>
              </View>
              {tag ? <TagBadge tag={tag} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{formatTime(game.gameTime)}</Text>
              {game.tvChannel ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Tv size={9} color="rgba(255,255,255,0.15)" strokeWidth={2} />
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{game.tvChannel}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Row 2: Teams large */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 26, fontWeight: '900', color: WHITE }}>{game.awayTeam.abbreviation}</Text>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>{game.awayTeam.name}</Text>
            </View>
            <View style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.02)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.12)' }}>VS</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 26, fontWeight: '900', color: WHITE, textAlign: 'right' }}>{game.homeTeam.abbreviation}</Text>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2, textAlign: 'right' }}>{game.homeTeam.name}</Text>
            </View>
          </View>

          {/* Row 3: Headline + Story */}
          <Text style={{ fontSize: 15, fontWeight: '800', color: WHITE, marginBottom: 6 }}>{headline}</Text>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 20, marginBottom: 14 }}>{story}</Text>
        </View>

        {/* Bottom bar */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingVertical: 12,
          borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)',
          backgroundColor: 'rgba(255,255,255,0.01)',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* AI Confidence */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8,
              backgroundColor: 'rgba(232,147,106,0.08)',
              borderWidth: 1, borderColor: 'rgba(232,147,106,0.12)',
            }}>
              <Text style={{ fontSize: 8, fontWeight: '800', color: 'rgba(255,255,255,0.25)' }}>AI</Text>
              {isPremium ? (
                <Text style={{ fontSize: 14, fontWeight: '900', color: CORAL, fontVariant: ['tabular-nums'] }}>{Math.round(conf)}%</Text>
              ) : (
                <Text style={{ fontSize: 10, fontWeight: '800', color: CORAL }}>PRO</Text>
              )}
            </View>
            {game.spread != null ? (
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
                {game.spread > 0 ? `${game.homeTeam.abbreviation} -${game.spread}` : `${game.awayTeam.abbreviation} -${Math.abs(game.spread)}`}
              </Text>
            ) : null}
            {game.tvChannel ? (
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{game.tvChannel}</Text>
            ) : null}
          </View>

          {/* Pick button */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: '/game/[id]', params: { id: game.id } });
            }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10,
              backgroundColor: 'rgba(122,157,184,0.08)',
              borderWidth: 1, borderColor: 'rgba(122,157,184,0.15)',
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: TEAL }}>Pick</Text>
            <ChevronRight size={12} color={TEAL} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
});

function StorylinesSection({ games, isPremium, router }: { games: GameWithPrediction[]; isPremium: boolean; router: ReturnType<typeof useRouter> }) {
  const storylines = useMemo(() => {
    const scheduled = (games ?? [])
      .filter(g => (g.status === GameStatus.SCHEDULED || g.status === GameStatus.LIVE) && g.prediction)
      .sort((a, b) => {
        const aTag = getGameTag(a) ? 1 : 0;
        const bTag = getGameTag(b) ? 1 : 0;
        if (aTag !== bTag) return bTag - aTag;
        const aConf = Math.abs((a.prediction?.confidence ?? 50) - 50);
        const bConf = Math.abs((b.prediction?.confidence ?? 50) - 50);
        return aConf - bConf;
      })
      .slice(0, 5);
    return scheduled;
  }, [games]);

  if (storylines.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.delay(400).duration(400)} style={{ marginTop: 24, paddingHorizontal: 20 }}>
      <View style={{ marginBottom: 14 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', color: CORAL, letterSpacing: 2, marginBottom: 4 }}>TONIGHT'S STORYLINES</Text>
        <Text style={{ fontSize: 16, fontWeight: '800', color: WHITE }}>The games that matter</Text>
      </View>
      {storylines.map(game => (
        <StorylineCard key={game.id} game={game} isPremium={isPremium} router={router} />
      ))}
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: SPLIT DECISION
// ═══════════════════════════════════════════════════════════════════
interface SplitDecision {
  game: GameWithPrediction;
  aiPick: string;
  aiConf: number;
  crowdPick: string;
  crowdPct: number;
  edge: number;
}

function SplitDecisionSection({ games, isPremium, router }: { games: GameWithPrediction[]; isPremium: boolean; router: ReturnType<typeof useRouter> }) {
  const splits = useMemo<SplitDecision[]>(() => {
    const result: SplitDecision[] = [];
    const scheduled = (games ?? []).filter(g => g.prediction && g.status !== GameStatus.FINAL && g.status !== GameStatus.CANCELLED);

    for (const g of scheduled) {
      const pred = g.prediction!;
      const aiPick = pred.predictedWinner;
      if (!aiPick) continue;

      // Simulate crowd pick as opposite of AI when confidence is moderate
      // In a real app this would come from pick stats
      const conf = pred.confidence ?? 55;
      const edge = pred.edgeRating ?? 5;
      if (conf >= 55 && conf <= 68 && edge >= 5) {
        const aiTeam = aiPick === 'home' ? g.homeTeam.abbreviation : g.awayTeam.abbreviation;
        const crowdTeam = aiPick === 'home' ? g.awayTeam.abbreviation : g.homeTeam.abbreviation;
        const crowdPct = Math.round(100 - conf + 2);
        result.push({
          game: g,
          aiPick: aiTeam,
          aiConf: conf,
          crowdPick: crowdTeam,
          crowdPct: Math.max(51, Math.min(75, crowdPct)),
          edge,
        });
      }
      if (result.length >= 2) break;
    }
    return result;
  }, [games]);

  if (splits.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.delay(500).duration(400)} style={{ marginTop: 24, paddingHorizontal: 20 }}>
      <View style={{ marginBottom: 14 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', color: CORAL, letterSpacing: 2, marginBottom: 4 }}>SPLIT DECISION</Text>
        <Text style={{ fontSize: 15, fontWeight: '800', color: WHITE }}>AI vs the crowd</Text>
      </View>

      {splits.map(split => (
        <Pressable
          key={split.game.id}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: '/game/[id]', params: { id: split.game.id } });
          }}
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <View style={{ borderRadius: 18, overflow: 'hidden', marginBottom: 14, borderWidth: 1, borderColor: 'rgba(232,147,106,0.1)' }}>
            <LinearGradient
              colors={['rgba(232,147,106,0.04)', 'rgba(4,6,8,0.95)']}
              style={StyleSheet.absoluteFill}
            />
            <View style={{ padding: 16 }}>
              {/* Row 1: Matchup + Edge */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 15, fontWeight: '900', color: WHITE }}>
                  {split.game.awayTeam.abbreviation} vs {split.game.homeTeam.abbreviation}
                </Text>
                <View style={{
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
                  backgroundColor: 'rgba(232,147,106,0.15)',
                  borderWidth: 1, borderColor: 'rgba(232,147,106,0.25)',
                }}>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: CORAL }}>EDGE {split.edge}/10</Text>
                </View>
              </View>

              {/* Row 2: Side by side */}
              <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 10, marginBottom: 12 }}>
                {/* Crowd */}
                <View style={{
                  flex: 1, padding: 12, borderRadius: 14,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
                  alignItems: 'center',
                }}>
                  <Text style={{ fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.15)', letterSpacing: 1, marginBottom: 6 }}>THE CROWD</Text>
                  <Text style={{ fontSize: 20, fontWeight: '900', color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>{split.crowdPick}</Text>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{split.crowdPct}% picked</Text>
                </View>

                <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.08)' }}>VS</Text>
                </View>

                {/* AI */}
                <View style={{
                  flex: 1, padding: 12, borderRadius: 14,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderWidth: 1, borderColor: 'rgba(232,147,106,0.12)',
                  alignItems: 'center',
                }}>
                  <Text style={{ fontSize: 8, fontWeight: '700', color: CORAL, letterSpacing: 1, marginBottom: 6 }}>OUR AI</Text>
                  <Text style={{ fontSize: 20, fontWeight: '900', color: CORAL, marginBottom: 4 }}>{split.aiPick}</Text>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{Math.round(split.aiConf)}% confident</Text>
                </View>
              </View>

              {/* Row 3: Analysis (gated) */}
              {isPremium ? (
                split.game.prediction?.analysis ? (
                  <View style={{
                    borderLeftWidth: 3, borderLeftColor: 'rgba(232,147,106,0.3)',
                    paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8,
                    backgroundColor: 'rgba(255,255,255,0.02)',
                  }}>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', lineHeight: 18 }}>
                      {split.game.prediction.analysis.split('.').slice(0, 2).join('.') + '.'}
                    </Text>
                  </View>
                ) : null
              ) : (
                <Pressable
                  onPress={() => router.push('/paywall')}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    paddingVertical: 10, borderRadius: 10,
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
                  }}
                >
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>See why the AI disagrees</Text>
                  <View style={{
                    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
                    backgroundColor: 'rgba(232,147,106,0.12)', borderWidth: 1, borderColor: 'rgba(232,147,106,0.2)',
                  }}>
                    <Text style={{ fontSize: 8, fontWeight: '800', color: CORAL }}>PRO</Text>
                  </View>
                </Pressable>
              )}
            </View>
          </View>
        </Pressable>
      ))}
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 7: QUICK INTEL
// ═══════════════════════════════════════════════════════════════════
type InsightType = 'streak' | 'value' | 'tossup' | 'blowout';

interface Insight {
  type: InsightType;
  text: string;
}

const INSIGHT_STYLES: Record<InsightType, { bg: string; border: string; color: string }> = {
  streak: { bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.15)', color: GREEN },
  value: { bg: 'rgba(232,147,106,0.08)', border: 'rgba(232,147,106,0.15)', color: CORAL },
  tossup: { bg: 'rgba(122,157,184,0.08)', border: 'rgba(122,157,184,0.15)', color: TEAL },
  blowout: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' },
};

function QuickIntelSection({ games }: { games: GameWithPrediction[] }) {
  const insights = useMemo<Insight[]>(() => {
    const result: Insight[] = [];
    const scheduled = (games ?? []).filter(g => g.prediction && g.status !== GameStatus.FINAL && g.status !== GameStatus.CANCELLED);

    for (const g of scheduled) {
      const pred = g.prediction!;
      const conf = pred.confidence ?? 55;
      const winner = pred.predictedWinner === 'home' ? g.homeTeam.abbreviation : g.awayTeam.abbreviation;

      if ((pred.homeStreak ?? 0) >= 4) {
        result.push({ type: 'streak', text: `${g.homeTeam.abbreviation} have won ${pred.homeStreak} straight. They're ${Math.round(conf)}% favorites tonight.` });
      } else if ((pred.awayStreak ?? 0) >= 4) {
        result.push({ type: 'streak', text: `${g.awayTeam.abbreviation} have won ${pred.awayStreak} straight. They're ${Math.round(conf)}% favorites tonight.` });
      }
      if ((pred.edgeRating ?? 0) >= 7) {
        result.push({ type: 'value', text: `High value: ${winner} at ${Math.round(conf)}% with edge rating ${pred.edgeRating}/10.` });
      }
      if (pred.isTossUp) {
        result.push({ type: 'tossup', text: `Coin flip: ${g.awayTeam.abbreviation} vs ${g.homeTeam.abbreviation} at ${Math.round(conf)}%. Save your confidence.` });
      }
      if (conf > 75) {
        result.push({ type: 'blowout', text: `Likely blowout: ${winner} favored at ${Math.round(conf)}%. Consider skipping.` });
      }
      if (result.length >= 4) break;
    }
    return result.slice(0, 4);
  }, [games]);

  if (insights.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.delay(600).duration(400)} style={{ marginTop: 24, paddingHorizontal: 20, marginBottom: 20 }}>
      <Text style={{ fontSize: 9, fontWeight: '800', color: TEAL, letterSpacing: 2, marginBottom: 14 }}>QUICK INTEL</Text>

      {insights.map((insight, i) => {
        const style = INSIGHT_STYLES[insight.type];
        return (
          <View
            key={i}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              paddingVertical: 11, paddingHorizontal: 12, marginBottom: 6,
              backgroundColor: 'rgba(255,255,255,0.02)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', borderRadius: 12,
            }}
          >
            <View style={{
              width: 26, height: 26, borderRadius: 7,
              backgroundColor: style.bg, borderWidth: 1, borderColor: style.border,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <BarChart3 size={12} color={style.color} strokeWidth={2} />
            </View>
            <Text style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 18 }}>{insight.text}</Text>
          </View>
        );
      })}
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════
export default function MyArenaScreen() {
  const router = useRouter();
  const { data: allGames, isLoading, refetch } = useGames();
  // Keep SSE connection alive for live score updates
  useLiveScores();
  const { isPremium } = useSubscription();
  const [followedGameIds, setFollowedGameIds] = useState<Set<string>>(new Set());

  // Load followed game IDs from AsyncStorage
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('clutch_followed_games');
        const list: string[] = raw ? JSON.parse(raw) : [];
        setFollowedGameIds(new Set(list));
      } catch {}
    })();
  }, []);

  // Re-check follows when screen comes into focus (user may have followed/unfollowed from game detail)
  const refreshFollows = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('clutch_followed_games');
      const list: string[] = raw ? JSON.parse(raw) : [];
      setFollowedGameIds(new Set(list));
    } catch {}
  }, []);
  // Refresh followed games when tab comes into focus
  useFocusEffect(useCallback(() => {
    refreshFollows();
  }, [refreshFollows]));

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refreshFollows()]);
    setRefreshing(false);
  }, [refetch, refreshFollows]);

  const liveCount = useMemo(() =>
    (allGames ?? []).filter(g => g.status === GameStatus.LIVE).length,
    [allGames]
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={TEAL} size="large" />
      </View>
    );
  }

  if ((allGames ?? []).length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
            <Text style={{ fontSize: 24, fontWeight: '900', color: WHITE }}>My Arena</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
            <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>No games today</Text>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', textAlign: 'center', marginTop: 6 }}>Check back tomorrow</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />
          }
        >
          {/* Section 1: Header + Search */}
          <HeaderSection liveCount={liveCount} />

          {/* Section 2: Your Games */}
          <YourGamesSection games={allGames ?? []} router={router} followedGameIds={followedGameIds} />

          {/* Section 3: Night Plan */}
          <NightPlanSection games={allGames ?? []} router={router} />

          {/* Section 4: Live Arena */}
          <LiveArenaSection games={allGames ?? []} router={router} />

          {/* Section 5: Tonight's Storylines */}
          <StorylinesSection games={allGames ?? []} isPremium={isPremium} router={router} />

          {/* Section 6: Split Decision */}
          <SplitDecisionSection games={allGames ?? []} isPremium={isPremium} router={router} />

          {/* Section 7: Quick Intel */}
          <QuickIntelSection games={allGames ?? []} />

          {/* Disclaimer */}
          <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
            <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.08)', textAlign: 'center', lineHeight: 14 }}>
              AI predictions are for entertainment purposes only. Not financial advice.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
