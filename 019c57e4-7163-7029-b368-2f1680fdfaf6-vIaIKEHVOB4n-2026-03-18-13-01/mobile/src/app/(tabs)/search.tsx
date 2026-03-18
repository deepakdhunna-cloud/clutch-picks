import React, { useState, useCallback, useMemo, useEffect, memo, useRef } from 'react';
import {
  View, Text, TextInput, Pressable,
  ActivityIndicator, RefreshControl, StyleSheet, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  FadeInDown, useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, withSequence, Easing, interpolate,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGames, useLiveGames } from '@/hooks/useGames';
import { Sport, SPORT_META, GameStatus, GameWithPrediction } from '@/types/sports';
import { useHideOnScroll } from '@/contexts/ScrollContext';

const { width: SCREEN_W } = Dimensions.get('window');
const BG = '#040608';
const TEAL = '#7A9DB8';
const TEAL_DARK = '#5A7A8A';
const CORAL = '#E8936A';
const GREEN = '#4ADE80';
const STORAGE_KEY = 'clutch_followed_games';

// ─── Followed Games Hook ─────────────────────────────────────────
function useFollowedGames(allGames: GameWithPrediction[] | undefined) {
  const [followedIds, setFollowedIds] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val) setFollowedIds(JSON.parse(val));
    });
    // Re-check when tab is focused
    const interval = setInterval(() => {
      AsyncStorage.getItem(STORAGE_KEY).then((val) => {
        if (val) setFollowedIds(JSON.parse(val));
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const followedGames = useMemo(() => {
    if (!allGames || followedIds.length === 0) return [];
    return followedIds
      .map((id) => allGames.find((g) => g.id === id))
      .filter(Boolean) as GameWithPrediction[];
  }, [allGames, followedIds]);

  return { followedGames, followedIds };
}

// ─── Game Pulse Logic ────────────────────────────────────────────
function useGamePulse(liveGames: GameWithPrediction[]) {
  return useMemo(() => {
    if (!liveGames || liveGames.length === 0) return { closest: null, upset: null, blowout: null };
    const withDiff = liveGames
      .filter((g) => g.homeScore != null && g.awayScore != null)
      .map((g) => ({ game: g, diff: Math.abs((g.homeScore ?? 0) - (g.awayScore ?? 0)) }));
    if (withDiff.length === 0) return { closest: null, upset: null, blowout: null };
    const sorted = [...withDiff].sort((a, b) => a.diff - b.diff);
    const closest = sorted[0] || null;
    const upset = withDiff.find((g) => {
      const fav = g.game.marketFavorite;
      if (!fav) return false;
      const favScore = fav === 'home' ? g.game.homeScore : g.game.awayScore;
      const dogScore = fav === 'home' ? g.game.awayScore : g.game.homeScore;
      return (dogScore ?? 0) > (favScore ?? 0) && g.diff >= 5;
    }) || null;
    const blowoutSorted = [...withDiff].sort((a, b) => b.diff - a.diff);
    const blowout = blowoutSorted[0]?.diff >= 15 ? blowoutSorted[0] : null;
    return { closest, upset, blowout };
  }, [liveGames]);
}

// ─── Must Watch Logic ────────────────────────────────────────────
function useMustWatch(allGames: GameWithPrediction[]) {
  return useMemo(() => {
    if (!allGames) return [];
    return allGames
      .filter((g) => g.status === GameStatus.SCHEDULED && g.prediction)
      .map((g) => {
        const edge = g.prediction?.edgeRating ?? 5;
        const conf = g.prediction?.confidence ?? 55;
        const confSpread = Math.abs(conf - 50);
        const score = edge * 0.5 + confSpread * 0.3 + (g.prediction?.isTossUp ? 2 : 0);
        return { game: g, score, watchScore: Math.min(5, Math.max(1, Math.round(score / 2))) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [allGames]);
}

// ─── Helpers ─────────────────────────────────────────────────────
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function getGameStatus(game: GameWithPrediction): string {
  if (game.status === GameStatus.LIVE) {
    const parts: string[] = [];
    if (game.quarter) parts.push(game.quarter);
    if (game.clock) parts.push(game.clock);
    return parts.join(' ') || 'LIVE';
  }
  return formatTime(game.gameTime);
}

// ─── SVG Icons ───────────────────────────────────────────────────
const SearchIcon = memo(function SearchIcon() {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={7} stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
      <Path d="M16 16L21 21" stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
});

// ─── STORY CIRCLE — single followed game ─────────────────────────
const StoryCircle = memo(function StoryCircle({
  game, onPress,
}: { game: GameWithPrediction; onPress: () => void }) {
  const isLive = game.status === GameStatus.LIVE;
  const isFinal = game.status === GameStatus.FINAL;

  const spin = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    if (isLive) {
      spin.value = withRepeat(withTiming(360, { duration: 4000, easing: Easing.linear }), -1, false);
      glow.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.ease) })
        ), -1, false
      );
    }
  }, [isLive]);

  const ringStyle = useAnimatedStyle(() => {
    if (!isLive) return {};
    return { transform: [{ rotate: `${spin.value}deg` }] };
  });

  const glowStyle = useAnimatedStyle(() => {
    if (!isLive) return { opacity: 0 };
    return {
      opacity: interpolate(glow.value, [0, 1], [0, 0.35]),
      transform: [{ scale: interpolate(glow.value, [0, 1], [1, 1.15]) }],
    };
  });

  const score = isLive || isFinal
    ? `${game.awayScore ?? 0}-${game.homeScore ?? 0}`
    : formatTime(game.gameTime);

  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', width: 72 }}>
      <View style={{ width: 64, height: 64, position: 'relative' }}>
        {/* Pulsing outer glow — only on live */}
        {isLive ? (
          <Animated.View style={[{
            position: 'absolute', top: -4, left: -4, right: -4, bottom: -4,
            borderRadius: 36, borderWidth: 2, borderColor: CORAL,
          }, glowStyle]} />
        ) : null}

        {/* Ring */}
        <Animated.View style={[{ width: 64, height: 64, borderRadius: 32, padding: 2.5 }, ringStyle]}>
          <View style={{
            width: '100%', height: '100%', borderRadius: 32,
            borderWidth: isLive ? 2.5 : isFinal ? 1 : 2,
            borderColor: isFinal ? 'rgba(255,255,255,0.06)' : isLive ? CORAL : `${TEAL_DARK}60`,
            borderTopColor: isFinal ? 'rgba(255,255,255,0.06)' : CORAL,
            borderRightColor: isFinal ? 'rgba(255,255,255,0.06)' : TEAL,
            borderBottomColor: isFinal ? 'rgba(255,255,255,0.06)' : CORAL,
            borderLeftColor: isFinal ? 'rgba(255,255,255,0.06)' : TEAL,
            backgroundColor: BG,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Text style={st.circleAbbr}>{game.awayTeam.abbreviation}</Text>
            <Text style={st.circleVs}>vs</Text>
            <Text style={st.circleAbbr}>{game.homeTeam.abbreviation}</Text>
          </View>
        </Animated.View>

        {/* Live badge */}
        {isLive ? (
          <View style={st.liveBadge}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' }} />
            <Text style={st.liveBadgeText}>LIVE</Text>
          </View>
        ) : null}
      </View>

      {/* Label */}
      <Text style={[st.circleLabel, {
        color: isLive ? CORAL : isFinal ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.3)',
        marginTop: 6,
      }]}>
        {isLive ? score : isFinal ? 'FINAL' : score}
      </Text>
    </Pressable>
  );
});

// ─── DRAMA CARD ──────────────────────────────────────────────────
const DramaCard = memo(function DramaCard({
  type, game, headline, onPress,
}: {
  type: 'thriller' | 'upset' | 'comeback' | 'blowout';
  game: GameWithPrediction;
  headline: string;
  onPress: () => void;
}) {
  const config: Record<string, { label: string; icon: string; accent: string }> = {
    thriller: { label: 'NAIL BITER', icon: '◆', accent: CORAL },
    upset:    { label: 'UPSET ALERT', icon: '△', accent: CORAL },
    comeback: { label: 'COMEBACK', icon: '↑', accent: GREEN },
    blowout:  { label: 'BLOWOUT', icon: '▽', accent: 'rgba(255,255,255,0.2)' },
  };
  const cfg = config[type] ?? config.thriller;
  const isBlowout = type === 'blowout';
  const status = getGameStatus(game);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <View style={[st.dramaCard, {
        backgroundColor: isBlowout ? 'rgba(255,255,255,0.02)' : `${cfg.accent}06`,
        borderColor: isBlowout ? 'rgba(255,255,255,0.04)' : `${cfg.accent}12`,
        opacity: isBlowout ? 0.5 : 1,
      }]}>
        <View style={{ position: 'absolute', top: 0, left: 20, right: 20, height: 1, backgroundColor: `${cfg.accent}20` }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 10, color: cfg.accent }}>{cfg.icon}</Text>
            <Text style={{ fontSize: 9, fontWeight: '800', color: cfg.accent, letterSpacing: 2 }}>{cfg.label}</Text>
          </View>
          <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontWeight: '600' }}>{status}</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: '#FFF' }}>{game.awayTeam.abbreviation}</Text>
          <View style={st.scoreChip}>
            <Text style={st.scoreChipText}>{game.awayScore ?? 0} - {game.homeScore ?? 0}</Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '900', color: '#FFF' }}>{game.homeTeam.abbreviation}</Text>
          <View style={{ marginLeft: 'auto' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.15)' }}>{game.sport}</Text>
          </View>
        </View>

        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 18 }}>{headline}</Text>
      </View>
    </Pressable>
  );
});

// ─── TONIGHT CARD ────────────────────────────────────────────────
function TonightCard({ game, watchScore, onPress }: {
  game: GameWithPrediction;
  watchScore: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <View style={st.tonightCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#FFF' }}>
              {game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}
            </Text>
            <View style={st.sportPill}>
              <Text style={st.sportPillText}>{game.sport}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '600' }}>
              {formatTime(game.gameTime)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 }}>
              {[1,2,3,4,5].map(n => (
                <View key={n} style={{
                  width: 2.5, height: 2 + n * 2, borderRadius: 1.5,
                  backgroundColor: n <= watchScore ? TEAL : 'rgba(255,255,255,0.06)',
                }} />
              ))}
            </View>
          </View>
        </View>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 6, lineHeight: 16 }} numberOfLines={1}>
          {game.awayTeam.record} vs {game.homeTeam.record}{game.tvChannel ? ` · ${game.tvChannel}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── YOUR PULSE ──────────────────────────────────────────────────
function YourPulse() {
  return (
    <View style={st.pulseCard}>
      <View style={[st.pulseCircle, { backgroundColor: `${TEAL}12`, borderColor: `${TEAL}25` }]}>
        <Text style={[st.pulseCircleText, { color: TEAL }]}>--</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFF' }}>Your Streak</Text>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
          Make picks to start tracking
        </Text>
      </View>
    </View>
  );
}

// ─── SECTION DIVIDER ─────────────────────────────────────────────
function Divider({ label }: { label?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginVertical: 14 }}>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      {label ? <Text style={{ fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.12)', letterSpacing: 2 }}>{label}</Text> : null}
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.06)' }} />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════
export default function MyArenaScreen() {
  const router = useRouter();
  const scrollHandler = useHideOnScroll();
  const { data: allGames, isLoading, refetch } = useGames();
  const { data: liveGames } = useLiveGames();
  const { followedGames } = useFollowedGames(allGames);
  const pulse = useGamePulse(liveGames ?? []);
  const mustWatch = useMustWatch(allGames ?? []);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const liveCount = liveGames?.length ?? 0;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !allGames) return [];
    const q = searchQuery.toLowerCase();
    return allGames.filter(
      (g) =>
        g.homeTeam.name.toLowerCase().includes(q) ||
        g.awayTeam.name.toLowerCase().includes(q) ||
        g.homeTeam.abbreviation.toLowerCase().includes(q) ||
        g.awayTeam.abbreviation.toLowerCase().includes(q) ||
        g.sport.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [searchQuery, allGames]);

  const dramaCards = useMemo(() => {
    const cards: { type: 'thriller' | 'upset' | 'comeback' | 'blowout'; game: GameWithPrediction; headline: string }[] = [];
    if (pulse.closest) {
      const g = pulse.closest.game;
      const diff = pulse.closest.diff;
      cards.push({
        type: 'thriller',
        game: g,
        headline: diff <= 3
          ? `${diff}-point game. This one could go either way.`
          : `Close game with a ${diff}-point margin. Heating up.`,
      });
    }
    if (pulse.upset) {
      const g = pulse.upset.game;
      const fav = g.marketFavorite === 'home' ? g.homeTeam : g.awayTeam;
      const dog = g.marketFavorite === 'home' ? g.awayTeam : g.homeTeam;
      cards.push({
        type: 'upset',
        game: g,
        headline: `${dog.abbreviation} leading the favored ${fav.abbreviation} by ${pulse.upset.diff}. The underdog is on a run.`,
      });
    }
    if (pulse.blowout) {
      const g = pulse.blowout.game;
      const leader = (g.homeScore ?? 0) > (g.awayScore ?? 0) ? g.homeTeam : g.awayTeam;
      cards.push({
        type: 'blowout',
        game: g,
        headline: `${leader.abbreviation} up by ${pulse.blowout.diff}. This one's done.`,
      });
    }
    return cards;
  }, [pulse]);

  const featuredTonight = mustWatch[0] ?? null;
  const otherTonight = mustWatch.slice(1);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={TEAL} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />
          }
        >
          {/* ═══ HEADER ═══ */}
          <Animated.View entering={FadeInDown.duration(400)} style={st.header}>
            <Text style={st.headerTitle}>My Arena</Text>
            {liveCount > 0 ? (
              <View style={st.liveChip}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: CORAL }} />
                <Text style={st.liveChipText}>{liveCount} LIVE</Text>
              </View>
            ) : null}
          </Animated.View>

          {/* ═══ SEARCH BAR ═══ */}
          <Animated.View entering={FadeInDown.delay(50).duration(400)} style={{ paddingHorizontal: 20, marginBottom: 6 }}>
            <View style={st.searchBar}>
              <SearchIcon />
              <TextInput
                style={st.searchInput}
                placeholder="Search teams, games, sports..."
                placeholderTextColor="rgba(255,255,255,0.15)"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={12}>
                  <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>×</Text>
                </Pressable>
              ) : null}
            </View>
          </Animated.View>

          {/* Search results */}
          {searchQuery.trim() && searchResults.length > 0 ? (
            <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
              {searchResults.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => { setSearchQuery(''); router.push(`/game/${g.id}`); }}
                  style={st.searchResult}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>
                    {g.awayTeam.abbreviation} vs {g.homeTeam.abbreviation}
                  </Text>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{g.sport} · {formatTime(g.gameTime)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* ═══ MAIN CONTENT ═══ */}
          {!searchQuery.trim() ? (
            <>
              {/* YOUR GAMES — Story Circles */}
              <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ paddingHorizontal: 20, marginTop: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFF' }}>Your Games</Text>
                  <Pressable onPress={() => router.push('/(tabs)')}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: TEAL }}>Browse</Text>
                  </Pressable>
                </View>
              </Animated.View>

              {/* TEMPORARY: Show mock followed games for screenshots */}
              {followedGames.length === 0 ? (
                <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
                  <View style={st.emptyFollowed}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.3)' }}>No games followed yet</Text>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', marginTop: 4 }}>Tap the follow button on any game to track it here</Text>
                  </View>
                </View>
              ) : (
                <Animated.ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 4 }}
                  entering={FadeInDown.delay(150).duration(400)}
                >
                  {followedGames.map((game) => (
                    <StoryCircle
                      key={game.id}
                      game={game}
                      onPress={() => router.push(`/game/${game.id}`)}
                    />
                  ))}
                  {/* Add circle */}
                  <Pressable onPress={() => router.push('/(tabs)')} style={{ alignItems: 'center', width: 72 }}>
                    <View style={st.addCircle}>
                      <Text style={{ fontSize: 22, color: `${CORAL}50`, fontWeight: '300' }}>+</Text>
                    </View>
                    <Text style={{ fontSize: 9, fontWeight: '600', color: 'rgba(255,255,255,0.12)', marginTop: 6 }}>Add</Text>
                  </Pressable>
                </Animated.ScrollView>
              )}

              <Divider />

              {/* YOUR PULSE */}
              <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ paddingHorizontal: 20 }}>
                <YourPulse />
              </Animated.View>

              {/* DRAMA FEED */}
              {dramaCards.length > 0 ? (
                <>
                  <Divider label="HAPPENING NOW" />
                  <Animated.View entering={FadeInDown.delay(250).duration(400)} style={{ paddingHorizontal: 20, gap: 10 }}>
                    {dramaCards.map((card, i) => (
                      <DramaCard
                        key={`drama-${i}`}
                        type={card.type}
                        game={card.game}
                        headline={card.headline}
                        onPress={() => router.push(`/game/${card.game.id}`)}
                      />
                    ))}
                  </Animated.View>
                </>
              ) : null}

              {/* TONIGHT / UPCOMING */}
              {mustWatch.length > 0 ? (
                <>
                  <Divider label="TONIGHT" />

                  {featuredTonight ? (
                    <Animated.View entering={FadeInDown.delay(300).duration(400)} style={{ paddingHorizontal: 20, marginBottom: 10 }}>
                      <Pressable onPress={() => router.push(`/game/${featuredTonight.game.id}`)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                        <View style={st.featuredCard}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: TEAL }} />
                            <Text style={{ fontSize: 9, fontWeight: '800', color: TEAL, letterSpacing: 2.5 }}>TONIGHT'S STORY</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                            <View>
                              <Text style={{ fontSize: 28, fontWeight: '900', color: '#FFF', letterSpacing: -1 }}>{featuredTonight.game.awayTeam.abbreviation}</Text>
                              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>
                                {featuredTonight.game.awayTeam.city} · {featuredTonight.game.awayTeam.record}
                              </Text>
                            </View>
                            <View style={st.vsBox}>
                              <Text style={{ fontSize: 10, fontWeight: '900', color: 'rgba(255,255,255,0.12)', letterSpacing: 2 }}>VS</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={{ fontSize: 28, fontWeight: '900', color: '#FFF', letterSpacing: -1 }}>{featuredTonight.game.homeTeam.abbreviation}</Text>
                              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>
                                {featuredTonight.game.homeTeam.city} · {featuredTonight.game.homeTeam.record}
                              </Text>
                            </View>
                          </View>
                          <View style={st.narrativeBox}>
                            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 19 }} numberOfLines={3}>
                              {featuredTonight.game.awayTeam.abbreviation} ({featuredTonight.game.awayTeam.record}) visits {featuredTonight.game.homeTeam.abbreviation} ({featuredTonight.game.homeTeam.record}) at {featuredTonight.game.venue || 'TBD'}.{featuredTonight.game.tvChannel ? ` Watch on ${featuredTonight.game.tvChannel}.` : ''}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              <View style={st.sportPill}><Text style={st.sportPillText}>{featuredTonight.game.sport}</Text></View>
                              <View style={st.sportPill}><Text style={st.sportPillText}>{formatTime(featuredTonight.game.gameTime)}</Text></View>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 16 }}>
                              {[1,2,3,4,5].map(n => (
                                <View key={n} style={{
                                  width: 3.5, height: 3 + n * 2.5, borderRadius: 2,
                                  backgroundColor: n <= featuredTonight.watchScore ? TEAL : 'rgba(255,255,255,0.06)',
                                }} />
                              ))}
                            </View>
                          </View>
                        </View>
                      </Pressable>
                    </Animated.View>
                  ) : null}

                  {otherTonight.length > 0 ? (
                    <Animated.View entering={FadeInDown.delay(350).duration(400)} style={{ paddingHorizontal: 20, gap: 6 }}>
                      {otherTonight.map(({ game, watchScore }) => (
                        <TonightCard
                          key={game.id}
                          game={game}
                          watchScore={watchScore}
                          onPress={() => router.push(`/game/${game.id}`)}
                        />
                      ))}
                    </Animated.View>
                  ) : null}
                </>
              ) : null}

              {/* Subtle PRO hint — just a line, not a banner */}
              {mustWatch.length > 0 ? (
                <Pressable onPress={() => router.push('/paywall')} style={{ paddingHorizontal: 20, marginTop: 16 }}>
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', textAlign: 'center', lineHeight: 16 }}>
                    Pro members see AI confidence ratings and predictions for every game ›
                  </Text>
                </Pressable>
              ) : null}

              {/* DISCLAIMER */}
              <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.1)', textAlign: 'center', lineHeight: 15 }}>
                  AI predictions are for entertainment purposes only. Not financial advice.
                </Text>
              </View>
            </>
          ) : null}
        </Animated.ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────
const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 22, fontWeight: '900', color: '#FFF' },
  liveChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: `${CORAL}10`, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: `${CORAL}18` },
  liveChipText: { fontSize: 10, fontWeight: '800', color: CORAL },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  searchInput: { flex: 1, fontSize: 13, color: '#FFF', padding: 0 },
  searchResult: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 4 },

  circleAbbr: { fontSize: 12, fontWeight: '900', color: '#FFF', letterSpacing: -0.5, lineHeight: 14 },
  circleVs: { fontSize: 6, color: 'rgba(255,255,255,0.12)', lineHeight: 8 },
  circleLabel: { fontSize: 9, fontWeight: '700' },
  liveBadge: { position: 'absolute', bottom: -2, left: '50%', marginLeft: -18, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  liveBadgeText: { fontSize: 7, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5 },

  addCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderStyle: 'dashed', borderColor: `${TEAL}25`, alignItems: 'center', justifyContent: 'center' },
  emptyFollowed: { padding: 20, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', alignItems: 'center' },

  pulseCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', padding: 14 },
  pulseCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pulseCircleText: { fontSize: 16, fontWeight: '900' },

  dramaCard: { borderRadius: 18, borderWidth: 1, padding: 16, position: 'relative', overflow: 'hidden' },
  scoreChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  scoreChipText: { fontSize: 16, fontWeight: '900', color: '#FFF', letterSpacing: 1, fontVariant: ['tabular-nums'] },

  featuredCard: { borderRadius: 22, padding: 20, backgroundColor: 'rgba(28,42,58,0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  vsBox: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  narrativeBox: { padding: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },

  tonightCard: { padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  sportPill: { backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  sportPillText: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.2)' },
});
