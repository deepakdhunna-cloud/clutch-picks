import { View, Text, ScrollView, FlatList, RefreshControl, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useState, useCallback, useMemo, useEffect, useDeferredValue, memo } from 'react';
import Animated, {
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Filter, Calendar, Trophy, Zap } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { GameCard } from '@/components/sports';
import { Sport, SPORT_META, type GameWithPrediction } from '@/types/sports';
import { useWeekGamesBySport } from '@/hooks/useGames';
import { useSmoothRefresh } from '@/hooks/useSmoothRefresh';
import { useScrollPressGuard } from '@/hooks/useScrollPressGuard';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';
import { guardedRouterBack } from '@/lib/navigation-guard';
import { SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS } from '@/lib/scroll-performance';
import { isLiveGameLike, sortSuspendedGamesLast } from '@/lib/game-status';

type FilterStatus = 'live' | 'today' | 'tomorrow' | 'results';

// Filter button component with icon
const FilterButton = memo(function FilterButton({
  filter,
  isSelected,
  onSelect,
  index,
  sportColor,
  count,
  onTouchStart,
  onTouchMove,
  onTouchCancel,
  shouldHandlePress,
}: {
  filter: { key: FilterStatus; label: string; icon: React.ReactNode };
  isSelected: boolean;
  onSelect: () => void;
  index: number;
  sportColor: string;
  count: number;
  onTouchStart: (event: GestureResponderEvent) => void;
  onTouchMove: (event: GestureResponderEvent) => void;
  onTouchCancel: (event: GestureResponderEvent) => void;
  shouldHandlePress: () => boolean;
}) {
  const scale = useSharedValue(isSelected ? 1.02 : 1);

  useEffect(() => {
    scale.value = withTiming(isSelected ? 1.02 : 1, {
      duration: 200,
      easing: Easing.out(Easing.quad)
    });
  }, [isSelected, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    if (!shouldHandlePress()) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSelect();
  }, [onSelect, shouldHandlePress]);

  // Different colors for each filter type
  const getFilterColors = () => {
    if (isSelected) {
      switch (filter.key) {
        case 'live':
          return { bg: '#DC2626', accent: '#FFFFFF' };
        case 'today':
          return { bg: sportColor, accent: '#FFFFFF' };
        case 'tomorrow':
          return { bg: '#3B82F6', accent: '#FFFFFF' };
        case 'results':
          return { bg: '#10B981', accent: '#FFFFFF' };
        default:
          return { bg: sportColor, accent: '#FFFFFF' };
      }
    }
    return { bg: 'rgba(39, 39, 42, 0.8)', accent: 'rgba(255, 255, 255, 0.6)' };
  };

  const colors = getFilterColors();

  return (
    <Animated.View
      entering={FadeInRight.delay(index * 60).duration(300)}
      style={animatedStyle}
    >
      <Pressable
        onPress={handlePress}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchCancel={onTouchCancel}
        pressRetentionOffset={6}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${filter.label}, ${count} ${count === 1 ? 'game' : 'games'}`}
        accessibilityHint="Filters this sport screen"
        accessibilityState={{ selected: isSelected }}
        style={({ pressed }) => [
          styles.filterButton,
          { opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <View
          style={[
            styles.filterButtonGradient,
            {
              backgroundColor: isSelected ? colors.bg : 'rgba(30, 30, 35, 0.95)',
            },
            isSelected ? { borderColor: 'rgba(255,255,255,0.3)' } : {},
          ]}
        >
          {/* Icon container */}
          <View style={[
            styles.filterIconContainer,
            { backgroundColor: isSelected ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)' }
          ]}>
            {filter.icon}
          </View>

          {/* Label and count */}
          <View style={styles.filterTextContainer}>
            <Text style={[
              styles.filterLabel,
              { color: isSelected ? '#FFFFFF' : 'rgba(255,255,255,0.7)' }
            ]}>
              {filter.label}
            </Text>
            <Text style={[
              styles.filterCount,
              { color: isSelected ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)' }
            ]}>
              {count} {count === 1 ? 'game' : 'games'}
            </Text>
          </View>

          {/* Selected indicator */}
          {isSelected ? (
            <View style={styles.filterSelectedDot} />
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
});

export default function SportDetailScreen() {
  const { sport } = useLocalSearchParams<{ sport: string }>();
  const router = useRouter();
  const [filter, setFilter] = useState<FilterStatus>('today');
  const deferredFilter = useDeferredValue(filter);
  const gameListPressGuard = useScrollPressGuard();
  const {
    onTouchStart: onFilterTouchStart,
    onTouchMove: onFilterTouchMove,
    onTouchCancel: onFilterTouchCancel,
    shouldHandlePress: shouldHandleFilterPress,
  } = useTapGestureGuard();

  const sportEnum = sport as Sport;
  const sportMeta = SPORT_META[sportEnum];

  // Use real API hook
  const { data: weekData, refetch, isLoading } = useWeekGamesBySport(sport ?? '');
  const { refreshing, onRefresh } = useSmoothRefresh(refetch);

  const allGames = useMemo(() => {
    if (!weekData) return [];
    return weekData.flatMap(d => d.games);
  }, [weekData]);

  const { todayStr, tomorrowStr } = useMemo(() => {
    const now = new Date();
    const tomorrowDate = new Date(now);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    return {
      todayStr: now.toDateString(),
      tomorrowStr: tomorrowDate.toDateString(),
    };
  }, []);

  // Calculate counts for each filter
  const filterCounts = useMemo(() => {
    if (!allGames.length) return { live: 0, today: 0, tomorrow: 0, results: 0 };
    const counts = { live: 0, today: 0, tomorrow: 0, results: 0 };
    for (const game of allGames) {
      if (isLiveGameLike(game)) {
        counts.live += 1;
        continue;
      }
      if (game.status === 'FINAL') {
        counts.results += 1;
        continue;
      }
      if (game.status !== 'SCHEDULED') continue;
      const gameDate = new Date(game.gameTime).toDateString();
      if (gameDate === todayStr) counts.today += 1;
      if (gameDate === tomorrowStr) counts.tomorrow += 1;
    }
    return counts;
  }, [allGames, todayStr, tomorrowStr]);

  // Filter games by status
  const filteredGames = useMemo(() => {
    if (!allGames.length) return [];
    const compareGameTime = (a: GameWithPrediction, b: GameWithPrediction) =>
      new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime();
    const filtered = allGames.filter(game => {
      const gameDate = new Date(game.gameTime).toDateString();
      if (deferredFilter === 'live') return isLiveGameLike(game);
      if (deferredFilter === 'today') return game.status === 'SCHEDULED' && gameDate === todayStr;
      if (deferredFilter === 'tomorrow') return game.status === 'SCHEDULED' && gameDate === tomorrowStr;
      if (deferredFilter === 'results') return game.status === 'FINAL';
      return true;
    });
    return deferredFilter === 'live'
      ? sortSuspendedGamesLast(filtered, compareGameTime)
      : filtered.sort(compareGameTime);
  }, [allGames, deferredFilter, todayStr, tomorrowStr]);

  // Filters with icons
  const filters = useMemo<{ key: FilterStatus; label: string; icon: React.ReactNode }[]>(
    () => [
      { key: 'live', label: 'Live Now', icon: <Zap size={20} color="#FFFFFF" /> },
      { key: 'today', label: 'Today', icon: <Calendar size={20} color="#FFFFFF" /> },
      { key: 'tomorrow', label: 'Tomorrow', icon: <Calendar size={20} color="#FFFFFF" /> },
      { key: 'results', label: 'Results', icon: <Trophy size={20} color="#FFFFFF" /> },
    ],
    [],
  );

  const handleFilterSelect = useCallback((nextFilter: FilterStatus) => {
    setFilter(nextFilter);
  }, []);

  const renderGame = useCallback(({ item, index }: { item: GameWithPrediction; index: number }) => (
    <View style={styles.gameItem}>
      <GameCard game={item} index={index} canOpen={gameListPressGuard.canPress} />
    </View>
  ), [gameListPressGuard.canPress]);

  const renderEmpty = useCallback(() => (
    <View style={styles.emptyState}>
      {isLoading ? (
        <>
          <ActivityIndicator size="large" color={sportMeta?.color ?? '#FFFFFF'} />
          <Text style={styles.emptyText}>
            Loading games...
          </Text>
        </>
      ) : (
        <>
          <Filter size={32} color="#71717a" />
          <Text style={styles.emptyText}>
            No {filter} games found
          </Text>
        </>
      )}
    </View>
  ), [filter, isLoading, sportMeta?.color]);

  const listHeader = useMemo(() => {
    if (!sportMeta) return null;
    return (
      <>
        {/* Header */}
        <Animated.View
          entering={FadeInDown.duration(500)}
          style={styles.header}
        >
          <View style={styles.headerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => guardedRouterBack(router)}
              style={styles.backButton}
            >
              <ChevronLeft size={28} color="#fff" />
            </Pressable>
            <View
              style={[styles.sportIcon, { backgroundColor: sportMeta.color }]}
            >
              <Text style={[styles.sportIconText, { color: sportMeta.accentColor }]}>
                {sportEnum.substring(0, 2)}
              </Text>
            </View>
            <View>
              <Text style={styles.sportName}>{sportMeta.name}</Text>
              <Text style={styles.gameCount}>
                {allGames.length} game{allGames.length !== 1 ? 's' : null}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Filters - Horizontal Scrollable */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterScrollContent}
        >
          {filters.map((f, index) => (
            <FilterButton
              key={f.key}
              filter={f}
              isSelected={filter === f.key}
              onSelect={() => handleFilterSelect(f.key)}
              index={index}
              sportColor={sportMeta.color}
              count={filterCounts[f.key]}
              onTouchStart={onFilterTouchStart}
              onTouchMove={onFilterTouchMove}
              onTouchCancel={onFilterTouchCancel}
              shouldHandlePress={shouldHandleFilterPress}
            />
          ))}
        </ScrollView>
      </>
    );
  }, [allGames.length, filter, filterCounts, filters, handleFilterSelect, onFilterTouchCancel, onFilterTouchMove, onFilterTouchStart, router, shouldHandleFilterPress, sportEnum, sportMeta]);

  if (!sportMeta) {
    return (
      <View style={styles.notFoundContainer}>
        <Text style={styles.notFoundText}>Sport not found</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <SafeAreaView style={styles.container} edges={['top']}>
        <FlatList
          style={styles.scrollView}
          data={filteredGames}
          renderItem={renderGame}
          keyExtractor={(game) => game.id}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={[
            styles.scrollContent,
            filteredGames.length === 0 ? styles.emptyScrollContent : null,
          ]}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          onScrollBeginDrag={gameListPressGuard.onScrollBeginDrag}
          onScrollEndDrag={gameListPressGuard.onScrollEndDrag}
          onMomentumScrollBegin={gameListPressGuard.onMomentumScrollBegin}
          onMomentumScrollEnd={gameListPressGuard.onMomentumScrollEnd}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#fff"
            />
          }
        />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  emptyScrollContent: {
    flexGrow: 1,
  },
  notFoundContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    color: '#FFFFFF',
    fontSize: 16,
  },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 16,
    marginLeft: -8,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sportIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sportIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  sportName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  gameCount: {
    color: '#71717a',
    fontSize: 14,
  },

  // Filter Scroll
  filterScroll: {
    marginBottom: 20,
  },
  filterScrollContent: {
    paddingHorizontal: 20,
    gap: 12,
  },

  // Filter Button
  // Spacing between buttons is owned by `filterScrollContent.gap`; no per-button
  // marginRight here or the gaps would be additive (24px) with a stray trailing margin.
  filterButton: {},
  filterButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    minWidth: 130,
    position: 'relative',
    overflow: 'hidden',
  },
  filterIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  filterTextContainer: {
    flex: 1,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  filterCount: {
    fontSize: 11,
    fontWeight: '500',
  },
  filterSelectedDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },

  gameItem: {
    paddingHorizontal: 20,
  },
  emptyState: {
    backgroundColor: 'rgba(39, 39, 42, 0.5)',
    borderRadius: 16,
    padding: 32,
    marginHorizontal: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: '#71717a',
    textAlign: 'center',
    marginTop: 12,
    fontSize: 14,
  },
});
