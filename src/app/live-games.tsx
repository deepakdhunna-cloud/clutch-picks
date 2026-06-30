import { View, Text, ScrollView, RefreshControl, StyleSheet, FlatList, useWindowDimensions } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useState, useCallback, useMemo, useEffect } from 'react';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  interpolate,
  cancelAnimation,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, Zap } from 'lucide-react-native';
import { haptics } from '@/lib/haptics';
import { PressableScale } from '@/components/shared/PressableScale';
import { LiveArenaCard } from '@/components/sports/LiveArenaCard';
import { Sport, SPORT_META, GameWithPrediction } from '@/types/sports';
import { useGames } from '@/hooks/useGames';
import { useSmoothRefresh } from '@/hooks/useSmoothRefresh';
import { useScrollPressGuard } from '@/hooks/useScrollPressGuard';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';
import { guardedRouterBack, guardedRouterPush } from '@/lib/navigation-guard';
import { TEAL, MAROON, BG, LIVE_RED } from '@/lib/theme';
import { SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS } from '@/lib/scroll-performance';
import { isLiveGameLike, sortSuspendedGamesLast } from '@/lib/game-status';

// Broadcast-style pulsing live indicator: a solid dot with a ring that
// expands and fades on a loop. One shared value, UI thread, cleaned up.
function LivePulse() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withDelay(
      200,
      withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.ease) }), -1, false)
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.7, 2.6]) }],
    opacity: interpolate(pulse.value, [0, 0.15, 1], [0, 0.55, 0]),
  }));

  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, ringStyle]} />
      <View style={styles.pulseDot} />
    </View>
  );
}

// Shimmering skeleton that mirrors the LiveArenaCard footprint so the loading
// state has shape (not a lone spinner on a blank screen) and the swap to real
// cards causes no layout pop. One shared value drives a calm opacity pulse on
// the UI thread.
function LiveCardSkeleton({ cardWidth, pulse }: { cardWidth: number; pulse: Animated.SharedValue<number> }) {
  const shimmer = useAnimatedStyle(() => ({ opacity: interpolate(pulse.value, [0, 1], [0.35, 0.7]) }));
  const Block = ({ w, h, mt = 0, radius = 6 }: { w: number; h: number; mt?: number; radius?: number }) => (
    <Animated.View style={[{ width: w, height: h, marginTop: mt, borderRadius: radius, backgroundColor: 'rgba(255,255,255,0.07)' }, shimmer]} />
  );
  return (
    <View style={{ width: cardWidth, marginBottom: 16 }}>
      <View style={{ borderRadius: 28, padding: 3, backgroundColor: 'rgba(255,255,255,0.04)' }}>
        <View style={{ borderRadius: 25, paddingHorizontal: 16, paddingVertical: 16, backgroundColor: 'rgba(5,8,13,0.96)', height: 210 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Block w={60} h={24} radius={12} />
            <Block w={56} h={24} radius={12} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 }}>
            <View style={{ alignItems: 'center', width: 80 }}>
              <Block w={58} h={58} radius={14} />
              <Block w={56} h={12} mt={12} />
            </View>
            <Block w={112} h={58} radius={14} />
            <View style={{ alignItems: 'center', width: 80 }}>
              <Block w={58} h={58} radius={14} />
              <Block w={56} h={12} mt={12} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function LiveGamesScreen() {
  const router = useRouter();
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const liveListPressGuard = useScrollPressGuard();
  const {
    onTouchStart: onChipTouchStart,
    onTouchMove: onChipTouchMove,
    onTouchCancel: onChipTouchCancel,
    shouldHandlePress: shouldHandleChipPress,
  } = useTapGestureGuard();

  const { data: todaysGames, refetch, isLoading, prefetchGame } = useGames();
  const { refreshing, onRefresh } = useSmoothRefresh(refetch);
  const { width } = useWindowDimensions();
  const cardWidth = width - 40; // list padding is 20 each side

  // Calm shimmer for loading skeletons (UI thread, looped, cleaned up).
  const skeletonPulse = useSharedValue(0);
  useEffect(() => {
    skeletonPulse.value = withRepeat(withTiming(1, { duration: 950, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(skeletonPulse);
  }, [skeletonPulse]);

  const onWarmGame = useCallback((game: GameWithPrediction) => {
    prefetchGame(game.id, game);
  }, [prefetchGame]);

  const onOpenGame = useCallback((game: GameWithPrediction) => {
    if (!liveListPressGuard.canPress()) return;
    prefetchGame(game.id, game);
    guardedRouterPush(router, `/game/${game.id}` as any);
  }, [liveListPressGuard, prefetchGame, router]);

  const liveGames = useMemo<GameWithPrediction[]>(
    () => sortSuspendedGamesLast((todaysGames ?? []).filter(isLiveGameLike)),
    [todaysGames]
  );

  const gamesBySport = useMemo(() => {
    const map = new Map<Sport, GameWithPrediction[]>();
    liveGames.forEach((g) => {
      const sport = g.sport as Sport;
      const arr = map.get(sport) ?? [];
      arr.push(g);
      map.set(sport, arr);
    });
    return map;
  }, [liveGames]);

  const availableSports = useMemo(() => Array.from(gamesBySport.keys()), [gamesBySport]);

  const filteredGames = useMemo(() => {
    if (!selectedSport) return liveGames;
    return gamesBySport.get(selectedSport) ?? [];
  }, [liveGames, selectedSport, gamesBySport]);

  const handleChipPress = useCallback((sport: Sport | null) => {
    if (!shouldHandleChipPress()) return;
    haptics.selection();
    setSelectedSport(sport);
  }, [shouldHandleChipPress]);

  const renderLiveGame = useCallback(
    ({ item }: { item: GameWithPrediction; index: number }) => (
      <LiveArenaCard game={item} cardWidth={cardWidth} variant="full" onPress={onOpenGame} onPressIn={onWarmGame} canOpen={liveListPressGuard.canPress} />
    ),
    [cardWidth, liveListPressGuard.canPress, onOpenGame, onWarmGame]
  );
  const keyExtractor = useCallback((g: GameWithPrediction) => g.id, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        {/* Ambient broadcast backdrop — maroon energy up top fading cleanly into
            black. Vertical so the bottom edge is uniformly transparent (no line). */}
        <LinearGradient
          colors={['rgba(139,10,31,0.32)', 'rgba(139,10,31,0.12)', 'rgba(139,10,31,0.03)', 'transparent']}
          locations={[0, 0.4, 0.72, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.backdrop}
          pointerEvents="none"
        />

        <SafeAreaView style={styles.safe} edges={['top']}>
          {/* Header */}
          <Animated.View entering={FadeInDown.duration(300)} style={styles.header}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => guardedRouterBack(router)}
              style={styles.backButton}
              hitSlop={10}
            >
              <View style={styles.backCircle}>
                <ChevronLeft size={24} color="#fff" />
              </View>
            </PressableScale>

            <View style={styles.titleWrap}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>LIVE NOW</Text>
                <LivePulse />
              </View>
              <Text style={styles.subtitle}>
                {liveGames.length} GAME{liveGames.length !== 1 ? 'S' : ''} IN PROGRESS
              </Text>
            </View>
          </Animated.View>

          {/* Sport filter chips */}
          {availableSports.length > 1 ? (
            <Animated.View entering={FadeInDown.duration(300).delay(80)}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipScrollContent}
              >
                <ChipButton
                  label={`All ${liveGames.length}`}
                  color={MAROON}
                  active={!selectedSport}
                  onPress={() => handleChipPress(null)}
                  onTouchStart={onChipTouchStart}
                  onTouchMove={onChipTouchMove}
                  onTouchCancel={onChipTouchCancel}
                />
                {availableSports.map((sport) => {
                  const isSelected = selectedSport === sport;
                  const count = gamesBySport.get(sport)?.length ?? 0;
                  const meta = SPORT_META[sport];
                  return (
                    <ChipButton
                      key={sport}
                      label={`${sport} ${count}`}
                      color={meta?.color ?? TEAL}
                      active={isSelected}
                      onPress={() => handleChipPress(isSelected ? null : sport)}
                      onTouchStart={onChipTouchStart}
                      onTouchMove={onChipTouchMove}
                      onTouchCancel={onChipTouchCancel}
                    />
                  );
                })}
              </ScrollView>
            </Animated.View>
          ) : null}

          {/* Live game cards — clean vertical scroll */}
          <FlatList
            data={filteredGames}
            renderItem={renderLiveGame}
            keyExtractor={keyExtractor}
            style={styles.gamesListContainer}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.gamesList}
            removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={7}
            onScrollBeginDrag={liveListPressGuard.onScrollBeginDrag}
            onScrollEndDrag={liveListPressGuard.onScrollEndDrag}
            onMomentumScrollBegin={liveListPressGuard.onMomentumScrollBegin}
            onMomentumScrollEnd={liveListPressGuard.onMomentumScrollEnd}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
            }
            ListEmptyComponent={
              isLoading ? (
                <View>
                  <LiveCardSkeleton cardWidth={cardWidth} pulse={skeletonPulse} />
                  <LiveCardSkeleton cardWidth={cardWidth} pulse={skeletonPulse} />
                  <LiveCardSkeleton cardWidth={cardWidth} pulse={skeletonPulse} />
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <View style={styles.emptyIcon}>
                    <Zap size={26} color={TEAL} />
                  </View>
                  <Text style={styles.emptyTitle}>No live games right now</Text>
                  <Text style={styles.emptyText}>Check back when games tip off.</Text>
                </View>
              )
            }
          />
        </SafeAreaView>
      </View>
    </>
  );
}

// Premium filter chip: glass when idle, a vivid color-gradient with a soft glow
// when active.
function ChipButton({
  label,
  color,
  active,
  onPress,
  onTouchStart,
  onTouchMove,
  onTouchCancel,
}: {
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
  onTouchStart: (event: GestureResponderEvent) => void;
  onTouchMove: (event: GestureResponderEvent) => void;
  onTouchCancel: (event: GestureResponderEvent) => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label} live games filter`}
      accessibilityHint="Filters live games by sport"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      pressRetentionOffset={6}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      style={styles.chipButton}
    >
      {active ? (
        <LinearGradient
          colors={[color, 'rgba(0,0,0,0.32)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.chip,
            { borderColor: color, shadowColor: color, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
          ]}
        >
          <Text style={[styles.chipText, { color: '#FFFFFF' }]}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={[styles.chip, styles.chipIdle]}>
          <Text style={[styles.chipText, { color: 'rgba(255,255,255,0.66)' }]}>{label}</Text>
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 440,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 18,
  },
  backButton: { width: 44, height: 44, marginRight: 14 },
  backCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  titleWrap: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  title: {
    color: '#FFFFFF',
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 40,
    letterSpacing: 1.5,
    lineHeight: 42,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginTop: 1,
  },

  // Live pulse — sits to the RIGHT of the LIVE NOW title. The left margin gives
  // it breathing room from the wordmark; the small downward nudge optically
  // centers the 14px dot against the Bebas cap-height (the glyph box sits high).
  pulseWrap: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    marginTop: 6,
  },
  pulseRing: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: LIVE_RED,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: LIVE_RED,
    shadowColor: LIVE_RED,
    shadowOpacity: 0.95,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },

  // Chips
  chipScroll: { marginBottom: 16, flexGrow: 0 },
  chipScrollContent: { paddingHorizontal: 20, gap: 8 },
  chipButton: { minHeight: 44, justifyContent: 'center' },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1.5,
  },
  chipIdle: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  chipText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },

  // List
  gamesListContainer: { flex: 1 },
  gamesList: { paddingHorizontal: 20, paddingBottom: 100 },

  // Empty / loading
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122,157,184,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(122,157,184,0.22)',
    marginBottom: 16,
  },
  emptyTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  emptyText: { color: '#71717a', textAlign: 'center', marginTop: 6, fontSize: 13 },
});
