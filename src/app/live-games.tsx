import { View, Text, ScrollView, RefreshControl, Pressable, ActivityIndicator, StyleSheet, Dimensions } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useState, useCallback, useMemo, useRef } from 'react';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Zap } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GameCard } from '@/components/sports';
import { Sport, SPORT_META, GameWithPrediction } from '@/types/sports';
import { useGames } from '@/hooks/useGames';
import { TEAL } from '@/lib/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.22;
const VELOCITY_THRESHOLD = 500;
const EXIT_DURATION = 180;
const ENTER_DURATION = 260;

export default function LiveGamesScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);

  const translateX = useSharedValue(0);
  const isAnimating = useRef(false);

  const { data: todaysGames, refetch, isLoading } = useGames();

  const liveGames = useMemo<GameWithPrediction[]>(
    () =>
      (todaysGames ?? []).filter(
        (g: any) => g.status === 'in_progress' || g.status === 'halftime' || g.status === 'LIVE'
      ),
    [todaysGames]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

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

  // Order for swipe cycling
  const filterOrder = useMemo<(Sport | null)[]>(
    () => [null, ...availableSports],
    [availableSports]
  );

  // Swap the rendered filter and slide the new content in from the opposite side.
  // direction = 1 means user swiped left (going to next): old exits left, new enters from right.
  // direction = -1 means user swiped right (going to prev): old exits right, new enters from left.
  const commitFilterChange = useCallback(
    (next: Sport | null, direction: 1 | -1) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedSport(next);
      // Snap to opposite off-screen position, then animate back to 0.
      translateX.value = direction === 1 ? SCREEN_WIDTH : -SCREEN_WIDTH;
      translateX.value = withTiming(
        0,
        { duration: ENTER_DURATION, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) {
            isAnimating.current = false;
          }
        }
      );
    },
    [translateX]
  );

  const animateToFilter = useCallback(
    (direction: 1 | -1) => {
      if (filterOrder.length <= 1) {
        translateX.value = withSpring(0, { damping: 20, stiffness: 220, mass: 0.6 });
        isAnimating.current = false;
        return;
      }
      const currentIdx = filterOrder.findIndex((s) => s === selectedSport);
      const nextIdx = (currentIdx + direction + filterOrder.length) % filterOrder.length;
      const next = filterOrder[nextIdx];
      isAnimating.current = true;
      // Fly old content fully off-screen in swipe direction.
      translateX.value = withTiming(
        direction === 1 ? -SCREEN_WIDTH : SCREEN_WIDTH,
        { duration: EXIT_DURATION, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) {
            runOnJS(commitFilterChange)(next, direction);
          }
        }
      );
    },
    [filterOrder, selectedSport, translateX, commitFilterChange]
  );

  const handleChipPress = (sport: Sport | null) => {
    if (sport === selectedSport || isAnimating.current) return;
    const currentIdx = filterOrder.findIndex((s) => s === selectedSport);
    const nextIdx = filterOrder.findIndex((s) => s === sport);
    const direction: 1 | -1 = nextIdx > currentIdx ? 1 : -1;
    Haptics.selectionAsync();
    isAnimating.current = true;
    translateX.value = withTiming(
      direction === 1 ? -SCREEN_WIDTH : SCREEN_WIDTH,
      { duration: EXIT_DURATION, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(commitFilterChange)(sport, direction);
        }
      }
    );
  };

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-15, 15])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          if (isAnimating.current) return;
          // Rubber band resistance past 40% of screen
          const max = SCREEN_WIDTH * 0.5;
          const t = e.translationX;
          if (Math.abs(t) <= max) {
            translateX.value = t;
          } else {
            const overshoot = Math.abs(t) - max;
            const resisted = max + overshoot * 0.35;
            translateX.value = t < 0 ? -resisted : resisted;
          }
        })
        .onEnd((e) => {
          const passedDistance = Math.abs(e.translationX) > SWIPE_THRESHOLD;
          const passedVelocity = Math.abs(e.velocityX) > VELOCITY_THRESHOLD;
          if (passedDistance || passedVelocity) {
            const direction: 1 | -1 = e.translationX < 0 ? 1 : -1;
            runOnJS(animateToFilter)(direction);
          } else {
            translateX.value = withSpring(0, {
              damping: 20,
              stiffness: 220,
              mass: 0.6,
            });
          }
        }),
    [animateToFilter, translateX]
  );

  const animatedListStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    const opacity = interpolate(
      absX,
      [0, SCREEN_WIDTH * 0.6],
      [1, 0],
      Extrapolation.CLAMP
    );
    const scale = interpolate(
      absX,
      [0, SCREEN_WIDTH],
      [1, 0.9],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ translateX: translateX.value }, { scale }],
      opacity,
    };
  });

  // Soft glow that brightens as you cross the commit threshold during a drag
  const hintStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    const opacity = interpolate(
      absX,
      [0, SWIPE_THRESHOLD, SCREEN_WIDTH * 0.45],
      [0, 0.25, 0.5],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
          }
        >
          {/* Header */}
          <Animated.View entering={FadeInDown.duration(180)} style={styles.header}>
            <View style={styles.headerRow}>
              <Pressable onPress={() => router.back()} style={styles.backButton}>
                <ChevronLeft size={28} color="#fff" />
              </Pressable>
              <View style={styles.titleWrap}>
                <View style={styles.titleRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.title}>Live Now</Text>
                </View>
                <Text style={styles.subtitle}>
                  {liveGames.length} game{liveGames.length !== 1 ? 's' : ''} in progress
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Sport filter chips */}
          {availableSports.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipScrollContent}
            >
              <Pressable onPress={() => handleChipPress(null)}>
                <View
                  style={[
                    styles.chip,
                    !selectedSport ? { backgroundColor: TEAL, borderColor: TEAL } : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: !selectedSport ? '#FFFFFF' : 'rgba(255,255,255,0.7)' },
                    ]}
                  >
                    All ({liveGames.length})
                  </Text>
                </View>
              </Pressable>
              {availableSports.map((sport) => {
                const isSelected = selectedSport === sport;
                const count = gamesBySport.get(sport)?.length ?? 0;
                const meta = SPORT_META[sport];
                const bg = meta?.color ?? TEAL;
                return (
                  <Pressable key={sport} onPress={() => handleChipPress(isSelected ? null : sport)}>
                    <View
                      style={[
                        styles.chip,
                        isSelected ? { backgroundColor: bg, borderColor: bg } : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: isSelected ? '#FFFFFF' : 'rgba(255,255,255,0.7)' },
                        ]}
                      >
                        {sport} ({count})
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {/* Swipeable games panel */}
          <View style={styles.swipeArea}>
            {/* Glow hint behind the list */}
            <Animated.View pointerEvents="none" style={[styles.swipeGlow, hintStyle]} />

            <GestureDetector gesture={swipeGesture}>
              <Animated.View style={[styles.swipeContent, animatedListStyle]}>
                <View style={styles.gamesList}>
                  {filteredGames.map((game, index) => (
                    <GameCard key={`${selectedSport ?? 'all'}-${game.id}`} game={game} index={index} />
                  ))}

                  {filteredGames.length === 0 ? (
                    <View style={styles.emptyState}>
                      {isLoading ? (
                        <>
                          <ActivityIndicator size="large" color={TEAL} />
                          <Text style={styles.emptyText}>Loading live games...</Text>
                        </>
                      ) : (
                        <>
                          <Zap size={32} color="#71717a" />
                          <Text style={styles.emptyText}>No live games right now</Text>
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              </Animated.View>
            </GestureDetector>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backButton: { marginRight: 12, padding: 8, marginLeft: -8 },
  titleWrap: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  subtitle: { color: '#71717a', fontSize: 13, marginTop: 2 },
  chipScroll: { marginBottom: 16 },
  chipScrollContent: { paddingHorizontal: 20, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(30,30,35,0.95)',
    marginRight: 8,
  },
  chipText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  swipeArea: {
    position: 'relative',
    overflow: 'hidden',
  },
  swipeContent: {
    width: '100%',
  },
  swipeGlow: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 220,
    borderRadius: 24,
    backgroundColor: TEAL,
    shadowColor: TEAL,
    shadowOpacity: 0.9,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
  gamesList: { paddingHorizontal: 20 },
  emptyState: {
    backgroundColor: 'rgba(39, 39, 42, 0.5)',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: { color: '#71717a', textAlign: 'center', marginTop: 12, fontSize: 14 },
});
