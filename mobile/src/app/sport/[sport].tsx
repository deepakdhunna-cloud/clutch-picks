import { View, Text, ScrollView, RefreshControl, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useState, useCallback, useMemo, useEffect, memo } from 'react';
import Animated, {
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Filter, Calendar, Trophy, Layers, Zap } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { GameCard } from '@/components/sports';
import { Sport, SPORT_META, GameStatus } from '@/types/sports';
import { useWeekGamesBySport } from '@/hooks/useGames';

type FilterStatus = 'live' | 'today' | 'tomorrow' | 'results';

// Filter button component with icon
const FilterButton = memo(function FilterButton({
  filter,
  isSelected,
  onSelect,
  index,
  sportColor,
  count,
}: {
  filter: { key: FilterStatus; label: string; icon: React.ReactNode };
  isSelected: boolean;
  onSelect: () => void;
  index: number;
  sportColor: string;
  count: number;
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect();
  }, [onSelect]);

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
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>('today');

  const sportEnum = sport as Sport;
  const sportMeta = SPORT_META[sportEnum];

  // Use real API hook
  const { data: weekData, refetch, isLoading } = useWeekGamesBySport(sport ?? '');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const allGames = useMemo(() => {
    if (!weekData) return [];
    return weekData.flatMap(d => d.games);
  }, [weekData]);

  const todayStr = new Date().toDateString();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toDateString();

  // Calculate counts for each filter
  const filterCounts = useMemo(() => {
    if (!allGames.length) return { live: 0, today: 0, tomorrow: 0, results: 0 };
    return {
      live: allGames.filter(g => g.status === 'LIVE').length,
      today: allGames.filter(g => g.status === 'SCHEDULED' && new Date(g.gameTime).toDateString() === todayStr).length,
      tomorrow: allGames.filter(g => g.status === 'SCHEDULED' && new Date(g.gameTime).toDateString() === tomorrowStr).length,
      results: allGames.filter(g => g.status === 'FINAL').length,
    };
  }, [allGames, todayStr, tomorrowStr]);

  // Filter games by status
  const filteredGames = useMemo(() => {
    if (!allGames.length) return [];
    return allGames.filter(game => {
      const gameDate = new Date(game.gameTime).toDateString();
      if (filter === 'live') return game.status === 'LIVE';
      if (filter === 'today') return game.status === 'SCHEDULED' && gameDate === todayStr;
      if (filter === 'tomorrow') return game.status === 'SCHEDULED' && gameDate === tomorrowStr;
      if (filter === 'results') return game.status === 'FINAL';
      return true;
    }).sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());
  }, [allGames, filter, todayStr, tomorrowStr]);

  // Filters with icons
  const filters: { key: FilterStatus; label: string; icon: React.ReactNode }[] = [
    { key: 'live', label: 'Live Now', icon: <Zap size={20} color="#FFFFFF" /> },
    { key: 'today', label: 'Today', icon: <Calendar size={20} color="#FFFFFF" /> },
    { key: 'tomorrow', label: 'Tomorrow', icon: <Calendar size={20} color="#FFFFFF" /> },
    { key: 'results', label: 'Results', icon: <Trophy size={20} color="#FFFFFF" /> },
  ];

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
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#fff"
            />
          }
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(500)}
            style={styles.header}
          >
            <View style={styles.headerRow}>
              <Pressable
                onPress={() => router.back()}
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
                onSelect={() => setFilter(f.key)}
                index={index}
                sportColor={sportMeta.color}
                count={filterCounts[f.key]}
              />
            ))}
          </ScrollView>

          {/* Games List */}
          <Animated.View
            entering={FadeInDown.delay(100).duration(500)}
            style={styles.gamesList}
          >
            {filteredGames.map((game, index) => (
              <GameCard key={game.id} game={game} index={index} />
            ))}

            {filteredGames.length === 0 ? (
              <View style={styles.emptyState}>
                {isLoading ? (
                  <>
                    <ActivityIndicator size="large" color={sportMeta.color} />
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
            ) : null}
          </Animated.View>
        </ScrollView>
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
    padding: 8,
    marginLeft: -8,
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
  filterButton: {
    marginRight: 12,
  },
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

  // Games List
  gamesList: {
    paddingHorizontal: 20,
  },
  emptyState: {
    backgroundColor: 'rgba(39, 39, 42, 0.5)',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#71717a',
    textAlign: 'center',
    marginTop: 12,
    fontSize: 14,
  },
});
