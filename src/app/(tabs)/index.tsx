import { View, Text, Image, ScrollView, FlatList, RefreshControl, Pressable, Modal, TextInput, Platform, StyleSheet } from 'react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import Animated, {
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import React, { useState, useCallback, useEffect, useMemo, memo, useRef } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, X, Search } from 'lucide-react-native';
import { TopInsetView } from '@/components/TopInsetView';
import { SportCard, GameCard, LedBarPanel, LedMiniPanel } from '@/components/sports';
import { CompactLiveCard } from '@/components/sports/CompactLiveCard';
import { GameCardSkeletonList } from '@/components/sports/GameCardSkeleton';
import { Sport, SPORT_META, GameStatus, GameWithPrediction } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { useGames } from '@/hooks/useGames';
import { useSmoothRefresh } from '@/hooks/useSmoothRefresh';
import { useTabBarVisible } from '@/contexts/ScrollContext';
import { useResponsive } from '@/hooks/useResponsive';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';
import { useScrollPressGuard } from '@/hooks/useScrollPressGuard';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import GridBackground from '@/components/GridBackground';
import { displaySport, formatGameTime } from '@/lib/display-confidence';
import { isLiveGameLike, sortSuspendedGamesLast } from '@/lib/game-status';
import { MAROON, TEAL, TEAL_DARK } from '@/lib/theme';
import { teamScoreText } from '@/lib/cricket-score';
import { claimGameNavigation } from '@/lib/game-navigation-guard';
import { guardedRouterPush } from '@/lib/navigation-guard';
import { SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS } from '@/lib/scroll-performance';
import { PressableScale } from '@/components/shared/PressableScale';
import { haptics } from '@/lib/haptics';

// Memoize all sports array
const allSports = Object.values(Sport);
// Curated default ordering for the cold-start loading window. Until real game
// counts arrive, the count-based sort has no signal and would otherwise fall
// back to raw enum order (NFL/NBA/MLB/NHL), which then visibly swaps to the
// app's actual active sports once data lands. Ordering the loading placeholders
// by the sports this app actually runs keeps the first page stable through the
// load and eliminates the label swap.
const ACTIVE_SPORT_PRIORITY: Sport[] = [
  Sport.TENNIS,
  Sport.MLB,
  Sport.WORLDCUP,
  Sport.IPL,
  Sport.MLS,
  Sport.UCL,
  Sport.EPL,
  Sport.NFL,
  Sport.NBA,
  Sport.NHL,
  Sport.NCAAF,
  Sport.NCAAB,
];
const HOME_SPORT_INITIAL_GAME_COUNT = 10;
const HOME_SPORT_GAME_BATCH_COUNT = 10;
const HOME_BOARD_SCROLL_OFFSET = 300;
const SEARCH_RESULT_ITEM_HEIGHT = 88;
const HOME_LIVE_CARD_WIDTH = 300;
const HOME_LIVE_CARD_GAP = 10;
const HOME_LIVE_CARD_SNAP_INTERVAL = HOME_LIVE_CARD_WIDTH + HOME_LIVE_CARD_GAP;
const HOME_FILTER_PILL_HEIGHT = 44;
const HOME_FILTER_PILL_RADIUS = 22;
const HOME_FILTER_PILL_BLUR_INTENSITY = 18;
const HOME_FILTER_PILL_ACTIVE_GRADIENT = ['rgba(139,10,31,0.84)', 'rgba(122,157,184,0.74)'] as const;

const HomeLiveRailSeparator = memo(function HomeLiveRailSeparator() {
  return <View style={{ width: HOME_LIVE_CARD_GAP }} />;
});

const HomeFilterPillSurface = memo(function HomeFilterPillSurface({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <View style={{ minHeight: HOME_FILTER_PILL_HEIGHT, borderRadius: HOME_FILTER_PILL_RADIUS, overflow: 'hidden', justifyContent: 'center' }}>
      <BlurView intensity={HOME_FILTER_PILL_BLUR_INTENSITY} tint="dark" style={StyleSheet.absoluteFillObject} />
      {active ? (
        <LinearGradient
          colors={HOME_FILTER_PILL_ACTIVE_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ minHeight: HOME_FILTER_PILL_HEIGHT, paddingHorizontal: 16, borderRadius: HOME_FILTER_PILL_RADIUS, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}
        >
          {children}
        </LinearGradient>
      ) : (
        <View style={{ minHeight: HOME_FILTER_PILL_HEIGHT, paddingHorizontal: 16, borderRadius: HOME_FILTER_PILL_RADIUS, backgroundColor: 'rgba(122,157,184,0.075)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.16)', justifyContent: 'center' }}>
          {children}
        </View>
      )}
    </View>
  );
});

const RefreshPill = memo(function RefreshPill({ visible, label }: { visible: boolean; label: string }) {
  if (!visible) return null;
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOut.duration(140)}
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 90,
        alignSelf: 'center',
        zIndex: 30,
        borderRadius: 999,
        overflow: 'hidden',
        shadowColor: TEAL,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 18,
      }}
    >
      <LinearGradient
        colors={['rgba(139,10,31,0.50)', 'rgba(122,157,184,0.34)', 'rgba(4,7,12,0.96)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 999, padding: 1 }}
      >
        <View style={{ minHeight: 34, borderRadius: 999, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(4,7,12,0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: TEAL }} />
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.2 }}>{label}</Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
});

// ─── Paginated sport tile carousel ──────────────────────────────────
const SportTileCarousel = memo(function SportTileCarousel({
  sports,
  gameCounts,
  selectedSportFilter,
  setSelectedSportFilter,
  responsive,
  loadingCounts = false,
}: {
  sports: Sport[];
  gameCounts: Partial<Record<Sport, number>>;
  selectedSportFilter: Sport | null;
  setSelectedSportFilter: (s: Sport | null) => void;
  responsive: ReturnType<typeof useResponsive>;
  loadingCounts?: boolean;
}) {
  const PAGE_SIZE = 4;
  const GAP = 8;
  const hPad = responsive.isTablet ? responsive.contentPadding : 16;
  const pageWidth = responsive.width;
  const tileWidth = (pageWidth - 2 * hPad - (PAGE_SIZE - 1) * GAP) / PAGE_SIZE;

  const pages = useMemo(() => {
    const out: Sport[][] = [];
    for (let i = 0; i < sports.length; i += PAGE_SIZE) {
      out.push(sports.slice(i, i + PAGE_SIZE));
    }
    return out;
  }, [sports]);

  // Stable per-sport press handlers, cached by ref, so tapping one tile doesn't
  // hand every SportCard a brand-new onPress closure (which would defeat its
  // memo and re-render every LED tile). The handler reads the latest selection +
  // setter through a ref, so its reference stays constant but it never goes stale.
  const sportSelectRef = useRef({ selectedSportFilter, setSelectedSportFilter });
  sportSelectRef.current = { selectedSportFilter, setSelectedSportFilter };
  const sportPressHandlersRef = useRef<Map<Sport, () => void>>(new Map());
  const getSportPressHandler = (sport: Sport) => {
    const cache = sportPressHandlersRef.current;
    let handler = cache.get(sport);
    if (!handler) {
      handler = () => {
        const { selectedSportFilter: current, setSelectedSportFilter: select } = sportSelectRef.current;
        select(current === sport ? null : sport);
      };
      cache.set(sport, handler);
    }
    return handler;
  };

  const scrollX = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  // LED scoreboard-style segment bar geometry
  const SEG_W = 18;
  const SEG_H = 5;
  const SEG_GAP = 5;
  const SEG_RADIUS = 1.5;
  const litOverlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (scrollX.value / pageWidth) * (SEG_W + SEG_GAP) }],
  }));

  return (
    <View>
      <Animated.FlatList
        data={pages}
        keyExtractor={(_, i) => `sportpage-${i}`}
        horizontal
        pagingEnabled
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={2}
        removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}
        getItemLayout={(_, index) => ({
          length: pageWidth,
          offset: pageWidth * index,
          index,
        })}
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={pageWidth}
        decelerationRate="fast"
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <View
            style={{
              width: pageWidth,
              paddingHorizontal: hPad,
              paddingVertical: 6,
              flexDirection: 'row',
              gap: GAP,
            }}
          >
            {item.map((sport, idx) => {
              const isSelected = selectedSportFilter === sport;
              return (
                <SportCard
                  key={sport}
                  sport={sport}
                  gameCount={loadingCounts ? '--' : (gameCounts?.[sport] ?? 0)}
                  index={idx}
                  tile
                  tileSize={tileWidth}
                  onPress={getSportPressHandler(sport)}
                  isSelected={isSelected}
                  hasActiveFilter={selectedSportFilter !== null}
                />
              );
            })}
          </View>
        )}
      />
      {pages.length > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 2 }}>
          <View
            style={{
              flexDirection: 'row',
              gap: SEG_GAP,
              position: 'relative',
            }}
          >
            {pages.map((_, i) => (
              <View
                key={i}
                style={{
                  width: SEG_W,
                  height: SEG_H,
                  borderRadius: SEG_RADIUS,
                  backgroundColor: 'rgba(255,255,255,0.10)',
                  borderWidth: 0.5,
                  borderColor: 'rgba(255,255,255,0.18)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-evenly',
                  overflow: 'hidden',
                }}
              >
                {[0, 1, 2, 3].map((d) => (
                  <View
                    key={d}
                    style={{
                      width: 1.5,
                      height: 1.5,
                      borderRadius: 0.75,
                      backgroundColor: 'rgba(255,255,255,0.45)',
                    }}
                  />
                ))}
              </View>
            ))}
            {/* Sliding lit segment — solid brand color + specular highlight + bright LED bulbs */}
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: SEG_W,
                  height: SEG_H,
                  borderRadius: SEG_RADIUS,
                  backgroundColor: TEAL_DARK,
                  shadowColor: TEAL_DARK,
                  shadowOpacity: 0.95,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 8,
                  overflow: 'hidden',
                },
                litOverlayStyle,
              ]}
            >
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 1,
                  backgroundColor: 'rgba(255,255,255,0.55)',
                }}
              />
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-evenly',
                }}
              >
                {[0, 1, 2, 3].map((d) => (
                  <View
                    key={d}
                    style={{
                      width: 1.5,
                      height: 1.5,
                      borderRadius: 0.75,
                      backgroundColor: 'rgba(235,245,255,0.95)',
                    }}
                  />
                ))}
              </View>
            </Animated.View>
          </View>
        </View>
      ) : null}
    </View>
  );
});

interface HomeHeaderProps {
  filteredLiveGames: GameWithPrediction[];
  availableLiveSports: Sport[];
  liveSportCounts: Map<Sport, number>;
  selectedLiveSportFilter: Sport | null;
  setSelectedLiveSportFilter: (sport: Sport | null) => void;
  selectedSportFilter: Sport | null;
  setSelectedSportFilter: (sport: Sport | null) => void;
  showAllLive: boolean;
  onViewAll: () => void;
  gameCounts: Partial<Record<Sport, number>>;
  totalGameCounts: Partial<Record<Sport, number>>;
  isLoadingGames: boolean;
  onOpenLiveGames: () => void;
  onOpenGame: (game: GameWithPrediction) => void;
  onWarmGame: (game: GameWithPrediction) => void;
  responsive: ReturnType<typeof useResponsive>;
  statusFilter: 'all' | 'upcoming' | 'final';
}

const StatusFilterRail = memo(function StatusFilterRail({
  statusFilter,
  setStatusFilter,
}: {
  statusFilter: 'all' | 'upcoming' | 'final';
  setStatusFilter: (filter: 'all' | 'upcoming' | 'final') => void;
}) {
  const {
    onTouchStart,
    onTouchMove,
    onTouchCancel,
    shouldHandlePress,
  } = useTapGestureGuard();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, marginBottom: 20 }}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 6, flexGrow: 1, justifyContent: 'center' }}
    >
      {([
        { key: 'all' as const, label: 'Today' },
        { key: 'final' as const, label: 'Final' },
        { key: 'upcoming' as const, label: 'Scheduled' },
      ]).map((f) => {
        const active = statusFilter === f.key;
        const hasFilter = statusFilter !== 'all';
        const dimmed = hasFilter && !active;
        return (
          <PressableScale
            key={f.key}
            accessibilityRole="button"
            accessibilityLabel={`${f.label} games filter`}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!shouldHandlePress()) return;
              haptics.selection();
              setStatusFilter(active ? 'all' : f.key);
            }}
            pressRetentionOffset={6}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchCancel={onTouchCancel}
            style={{ minHeight: 44, borderRadius: 22, overflow: 'hidden' as const, opacity: dimmed ? 0.5 : 1, justifyContent: 'center' }}
          >
            <HomeFilterPillSurface active={active}>
              <Text style={{ fontSize: 12, fontWeight: active ? '700' : '600', color: active ? '#FFFFFF' : TEAL }}>{f.label}</Text>
            </HomeFilterPillSurface>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
});

const TodaysGamesBar = memo(function TodaysGamesBar({
  selectedSportFilter,
  setSelectedSportFilter,
  gameCounts,
  statusFilter,
  onViewAll,
  responsive,
  isLoadingGames,
}: {
  selectedSportFilter: Sport | null;
  setSelectedSportFilter: (sport: Sport | null) => void;
  gameCounts: Partial<Record<Sport, number>>;
  statusFilter: 'all' | 'upcoming' | 'final';
  onViewAll: () => void;
  responsive: ReturnType<typeof useResponsive>;
  isLoadingGames?: boolean;
}) {
  return (
    <View style={{ paddingTop: 0 }}>
      <View style={{ paddingHorizontal: responsive.isTablet ? responsive.contentPadding : 16, marginTop: 0, marginBottom: 12 }}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={selectedSportFilter ? `Clear ${displaySport(selectedSportFilter)} filter` : 'View game board'}
          accessibilityHint={selectedSportFilter ? 'Shows all sports on the game board' : 'Scrolls to the game board'}
          onPress={() => {
            if (selectedSportFilter) {
              setSelectedSportFilter(null);
            } else {
              onViewAll();
            }
          }}
          style={{ minHeight: 44 }}
        >
          {(() => {
            const rawCount = selectedSportFilter
              ? (gameCounts?.[selectedSportFilter] ?? 0)
              : Object.values(gameCounts ?? {}).reduce((sum: number, count) => sum + (count ?? 0), 0);
            // Show '--' while the first load is in progress so the LED board
            // never flashes a misleading 0 before data arrives.
            const barCount: number | string = isLoadingGames ? '--' : rawCount;
            const sportLabel = selectedSportFilter
              ? displaySport(selectedSportFilter)
              : null;
            const barLabel = selectedSportFilter
              ? statusFilter === 'all' ? `${sportLabel!} TODAY` : statusFilter === 'final' ? `${sportLabel!} FINALS` : `${sportLabel!} SCHEDULED`
              : statusFilter === 'all' ? "TODAY'S GAMES" : statusFilter === 'final' ? "FINAL RESULTS" : "SCHEDULED GAMES";
            return (
              <LedBarPanel
                label={barLabel}
                count={barCount}
                leftSport={selectedSportFilter}
              />
            );
          })()}
        </PressableScale>
      </View>
    </View>
  );
});

const HomeHeader = React.memo(function HomeHeader({
  filteredLiveGames,
  availableLiveSports,
  liveSportCounts,
  selectedLiveSportFilter,
  setSelectedLiveSportFilter,
  selectedSportFilter,
  setSelectedSportFilter,
  showAllLive,
  onViewAll,
  gameCounts,
  totalGameCounts,
  isLoadingGames,
  onOpenLiveGames,
  onOpenGame,
  onWarmGame,
  responsive,
  statusFilter,
}: HomeHeaderProps) {
  const sortedSports = useMemo(
    () => {
      const enumOrder = new Map(allSports.map((s, i) => [s, i]));
      // Tie-break by curated active-sport priority (not raw enum order) so the
      // cold-start loading window — where every count is 0 — shows the app's
      // real active sports (Tennis/MLB/T20/WC) instead of NFL/NBA/MLB/NHL, and
      // does not visibly re-order when the real counts arrive.
      const priorityOrder = new Map(ACTIVE_SPORT_PRIORITY.map((s, i) => [s, i]));
      const tieBreak = (s: Sport) =>
        priorityOrder.get(s) ?? (ACTIVE_SPORT_PRIORITY.length + (enumOrder.get(s) ?? 0));
      // Order tiles by a status-agnostic total (live + scheduled + final across
      // the loaded window) so an in-season league like the World Cup surfaces on
      // page 1 even when its games fall on tomorrow rather than today.
      const orderCount = (s: Sport) => totalGameCounts?.[s] ?? gameCounts?.[s] ?? 0;
      return [...allSports].sort((a, b) => {
        const hasA = orderCount(a) > 0 ? 1 : 0;
        const hasB = orderCount(b) > 0 ? 1 : 0;
        if (hasA !== hasB) return hasB - hasA;
        const countDiff = orderCount(b) - orderCount(a);
        if (countDiff !== 0) return countDiff;
        // Stable tie-break by curated active-sport priority so tile positions
        // stay consistent across the load and never swap when counts arrive.
        return tieBreak(a) - tieBreak(b);
      });
    },
    [gameCounts, totalGameCounts]
  );
  const {
    onTouchStart: onLiveChipTouchStart,
    onTouchMove: onLiveChipTouchMove,
    onTouchCancel: onLiveChipTouchCancel,
    shouldHandlePress: shouldHandleLiveChipPress,
  } = useTapGestureGuard();
  const liveRailPressGuard = useScrollPressGuard(500, 220);
  const liveCardSidePadding = Math.max(20, (responsive.width - HOME_LIVE_CARD_WIDTH) / 2);
  const liveRailGames = useMemo(
    () => (showAllLive ? filteredLiveGames : filteredLiveGames.slice(0, 5)),
    [filteredLiveGames, showAllLive],
  );
  const showLiveRailViewAll = !showAllLive && filteredLiveGames.length > 5;
  const liveRailInitialRenderCount = Math.min(liveRailGames.length, showAllLive ? 4 : 5);
  const canOpenLiveCard = liveRailPressGuard.canPress;
  const renderLiveRailGame = useCallback(({ item }: { item: GameWithPrediction }) => (
    <CompactLiveCard game={item} onPressIn={onWarmGame} onPress={onOpenGame} canOpen={canOpenLiveCard} />
  ), [canOpenLiveCard, onOpenGame, onWarmGame]);
  const getLiveRailItemLayout = useCallback((_: ArrayLike<GameWithPrediction> | null | undefined, index: number) => ({
    length: HOME_LIVE_CARD_SNAP_INTERVAL,
    offset: HOME_LIVE_CARD_SNAP_INTERVAL * index,
    index,
  }), []);

  return (
    <>
      <TodaysGamesBar
        selectedSportFilter={selectedSportFilter}
        setSelectedSportFilter={setSelectedSportFilter}
        gameCounts={gameCounts}
        statusFilter={statusFilter}
        onViewAll={onViewAll}
        responsive={responsive}
        isLoadingGames={isLoadingGames}
      />

      {/* Sports Categories — paginated carousel of square LED tiles.
          Always rendered so the board never collapses/pops in on cold start;
          tiles show '--' while the first slate loads instead of a misleading 0. */}
      <View style={{ paddingTop: 0, paddingBottom: 24 }}>
        <SportTileCarousel
          sports={sortedSports}
          gameCounts={gameCounts}
          selectedSportFilter={selectedSportFilter}
          setSelectedSportFilter={setSelectedSportFilter}
          responsive={responsive}
          loadingCounts={isLoadingGames}
        />
      </View>

      {/* Live Games Section — header always shows */}
      <View style={{ marginBottom: 24, marginTop: 0 }}>
        <View style={{ paddingHorizontal: 20, marginBottom: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 6 }}>
            <LinearGradient colors={['transparent', 'rgba(122,157,184,0.15)', 'rgba(122,157,184,0.6)']} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 1 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {filteredLiveGames.length > 0 ? (
                <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#DC2626' }} />
              ) : (
                <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(255,255,255,0.15)' }} />
              )}
              <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: -0.3 }}>
                Live Now
              </Text>
              {filteredLiveGames.length > 0 ? (
                <View style={{ backgroundColor: 'rgba(220,38,38,0.15)', borderWidth: 1, borderColor: 'rgba(220,38,38,0.3)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, minWidth: 22, alignItems: 'center' }}>
                  <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '800' }}>
                    {filteredLiveGames.length}
                  </Text>
                </View>
              ) : null}
            </View>
            <LinearGradient colors={['rgba(122,157,184,0.6)', 'rgba(122,157,184,0.15)', 'transparent']} locations={[0, 0.4, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 1 }} />
          </View>
        </View>

      {filteredLiveGames.length > 0 ? (
        <View>

          {/* Sport filter pills — only show when no top sport filter is active */}
          {availableLiveSports.length > 1 && !selectedSportFilter ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 14, paddingTop: 6, flexGrow: 1, justifyContent: 'center' }}
              style={{ flexGrow: 0 }}
              decelerationRate="fast"
            >
              {/* All pill */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`All live games filter`}
                accessibilityState={{ selected: !selectedLiveSportFilter }}
                onPress={() => {
                  if (!shouldHandleLiveChipPress()) return;
                  haptics.selection();
                  setSelectedLiveSportFilter(null);
                }}
                pressRetentionOffset={6}
                onTouchStart={onLiveChipTouchStart}
                onTouchMove={onLiveChipTouchMove}
                onTouchCancel={onLiveChipTouchCancel}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <HomeFilterPillSurface active={!selectedLiveSportFilter}>
                  <Text style={{ fontSize: 12, fontWeight: !selectedLiveSportFilter ? '700' : '600', color: !selectedLiveSportFilter ? '#FFFFFF' : TEAL }}>All ({filteredLiveGames.length})</Text>
                </HomeFilterPillSurface>
              </PressableScale>

              {/* Per-sport pills */}
              {availableLiveSports.map((sport) => {
                const isChipSelected = selectedLiveSportFilter === sport;
                const count = liveSportCounts.get(sport) ?? 0;
                const displayName = displaySport(sport);
                return (
                  <PressableScale
                    key={sport}
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName} live games filter`}
                    accessibilityState={{ selected: isChipSelected }}
                    onPress={() => {
                      if (!shouldHandleLiveChipPress()) return;
                      haptics.selection();
                      setSelectedLiveSportFilter(isChipSelected ? null : sport);
                    }}
                    pressRetentionOffset={6}
                    onTouchStart={onLiveChipTouchStart}
                    onTouchMove={onLiveChipTouchMove}
                    onTouchCancel={onLiveChipTouchCancel}
                    style={{ minHeight: 44, justifyContent: 'center' }}
                  >
                    <HomeFilterPillSurface active={isChipSelected}>
                      <Text style={{ fontSize: 12, fontWeight: isChipSelected ? '700' : '600', color: isChipSelected ? '#FFFFFF' : TEAL }}>{displayName} ({count})</Text>
                    </HomeFilterPillSurface>
                  </PressableScale>
                );
              })}
            </ScrollView>
          ) : null}

          {/* Horizontal scroll of compact live game cards */}
          <FlatList
            data={liveRailGames}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingLeft: liveCardSidePadding, paddingRight: liveCardSidePadding, alignItems: 'center' }}
            style={{ flexGrow: 0 }}
            scrollEventThrottle={16}
            removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}
            snapToInterval={HOME_LIVE_CARD_SNAP_INTERVAL}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            initialNumToRender={liveRailInitialRenderCount}
            maxToRenderPerBatch={4}
            windowSize={5}
            keyExtractor={(item) => item.id}
            renderItem={renderLiveRailGame}
            getItemLayout={getLiveRailItemLayout}
            ItemSeparatorComponent={HomeLiveRailSeparator}
            onScrollBeginDrag={liveRailPressGuard.onScrollBeginDrag}
            onScrollEndDrag={liveRailPressGuard.onScrollEndDrag}
            onMomentumScrollBegin={liveRailPressGuard.onMomentumScrollBegin}
            onMomentumScrollEnd={liveRailPressGuard.onMomentumScrollEnd}
            ListFooterComponent={showLiveRailViewAll ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="View all live games"
                accessibilityHint="Opens the live games screen"
                onPress={() => {
                  if (!shouldHandleLiveChipPress()) return;
                  onOpenLiveGames();
                }}
                pressRetentionOffset={6}
                onTouchStart={onLiveChipTouchStart}
                onTouchMove={onLiveChipTouchMove}
                onTouchCancel={onLiveChipTouchCancel}
                style={{
                  height: 56,
                  alignSelf: 'center',
                  marginRight: 20,
                  marginLeft: 4,
                  borderRadius: 10,
                  overflow: 'hidden',
                  borderWidth: 2,
                  borderColor: TEAL,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  gap: 5,
                  backgroundColor: 'rgba(122,157,184,0.15)',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>View All</Text>
                <ChevronRight size={14} color="#FFFFFF" />
              </PressableScale>
            ) : null}
          />
        </View>
      ) : null}
      </View>

      {/* First-load skeleton only. Keep real content on screen during refreshes. */}
      {isLoadingGames ? (
        <View className="px-4 pt-2">
          <GameCardSkeletonList />
        </View>
      ) : null}
    </>
  );
});

// Search mini game card component
const SearchGameCard = memo(function SearchGameCard({
  game,
  index,
  onPress,
  onPressIn,
}: {
  game: GameWithPrediction;
  index: number;
  onPress: () => void;
  onPressIn?: () => void;
}) {
  const awayColors = getTeamColors(game.awayTeam.abbreviation, game.sport);
  const homeColors = getTeamColors(game.homeTeam.abbreviation, game.sport);
  const awayAccent = awayColors.accent;
  const homeAccent = homeColors.accent;
  const isLive = isLiveGameLike(game);
  const sportMeta = SPORT_META[game.sport];
  const awayScoreLabel = teamScoreText(game, 'away');
  const homeScoreLabel = teamScoreText(game, 'home');

  const gameTimeLabel = useMemo(() => {
    if (isLive) {
      return formatGameTime(game.sport, game.quarter, game.clock) || 'LIVE';
    }
    if (game.status === GameStatus.FINAL) return 'Final';
    const d = new Date(game.gameTime);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, [game, isLive]);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}
        accessibilityHint="Opens game details"
        onPressIn={onPressIn}
        onPress={onPress}
        className="active:opacity-75"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: `${awayAccent}14`,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.10)',
          borderLeftWidth: isLive ? 3 : 1,
          borderLeftColor: isLive ? '#DC2626' : 'rgba(255,255,255,0.10)',
          marginBottom: 16,
          height: 72,
          overflow: 'hidden',
          paddingHorizontal: 14,
        }}
      >
        {/* Left: Full team names stacked with color dots */}
        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 3.5,
                backgroundColor: awayAccent,
                marginRight: 6,
              }}
            />
            <Text
              style={{ flexShrink: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}
              numberOfLines={1}
            >
              {game.awayTeam.name}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 3.5,
                backgroundColor: homeAccent,
                marginRight: 6,
              }}
            />
            <Text
              style={{ flexShrink: 1, color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600', letterSpacing: 0.3 }}
              numberOfLines={1}
            >
              {game.homeTeam.name}
            </Text>
          </View>
        </View>

        {/* Center: Sport badge + status */}
        <View style={{ flexShrink: 0, alignItems: 'center', paddingHorizontal: 10 }}>
          <View
            style={{
              backgroundColor: sportMeta.color,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              marginBottom: 6,
            }}
          >
            <Text style={{ color: sportMeta.accentColor, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }}>
              {displaySport(game.sport)}
            </Text>
          </View>

          {isLive ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 2.5,
                  backgroundColor: '#DC2626',
                  marginRight: 4,
                }}
              />
              <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '700' }}>
                {gameTimeLabel}
              </Text>
            </View>
          ) : (
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '500' }}>
              {gameTimeLabel}
            </Text>
          )}
        </View>

        {/* Right: Score or time */}
        <View style={{ alignItems: 'flex-end', minWidth: 52 }}>
          {isLive && game.awayScore !== undefined && game.homeScore !== undefined ? (
            <>
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', lineHeight: 20, textAlign: 'right' }}>
                {awayScoreLabel}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 16, fontWeight: '800', lineHeight: 20, textAlign: 'right' }}>
                {homeScoreLabel}
              </Text>
            </>
          ) : game.status === GameStatus.FINAL ? (
            <>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '700', lineHeight: 18 }}>
                {game.awayScore ?? '-'}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: '700', lineHeight: 18 }}>
                {game.homeScore ?? '-'}
              </Text>
            </>
          ) : (
            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.07)',
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600' }}>
                {gameTimeLabel}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
});

export default function HomeScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const tabBarVisible = useTabBarVisible();
  const responsive = useResponsive();
  const { isTablet, numColumns } = responsive;
  const flatListRef = useRef<any>(null);
  const homePressGuard = useScrollPressGuard(500, 220);
  const lastDirection = useSharedValue(0);
  const directionAnchor = useSharedValue(0);
  const previousOffset = useSharedValue(0);
  const cooldownUntil = useSharedValue(0);
  const [selectedSportFilter, setSelectedSportFilter] = useState<Sport | null>(null);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [showAllLive] = useState(false);
  const [selectedLiveSportFilter, setSelectedLiveSportFilter] = useState<Sport | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'final'>('all');
  const [visibleSportGameCounts, setVisibleSportGameCounts] = useState<Record<string, number>>({});
  const deferredSelectedSportFilter = selectedSportFilter;
  const deferredSelectedLiveSportFilter = selectedLiveSportFilter;
  const deferredStatusFilter = statusFilter;

  const scrollToHomeBoard = useCallback(() => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToOffset({ offset: HOME_BOARD_SCROLL_OFFSET, animated: true });
    });
  }, []);

  const handleOpenLiveGames = useCallback(() => {
    guardedRouterPush(router, '/live-games' as any);
  }, [router]);

  const canOpenHomeCard = homePressGuard.canPress;

  const applySportFilter = useCallback((nextSport: Sport | null) => {
    const isChanging = nextSport !== selectedSportFilter;
    if (isChanging) {
      haptics.selection();
    }
    // Apply the filter in place — do NOT auto-scroll the board, so selecting a
    // sport never makes the page jump.
    setSelectedSportFilter(nextSport);
  }, [selectedSportFilter]);

  useEffect(() => {
    if (!selectedSportFilter) return;
    if (selectedLiveSportFilter && selectedLiveSportFilter !== selectedSportFilter) {
      setSelectedLiveSportFilter(null);
    }
  }, [selectedLiveSportFilter, selectedSportFilter]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const currentOffset = event.contentOffset.y;

      const diff = currentOffset - previousOffset.value;
      const now = Date.now();
      previousOffset.value = currentOffset;

      if (currentOffset < 20) {
        if (tabBarVisible.value !== 1) {
          tabBarVisible.value = withTiming(1, { duration: 200 });
          cooldownUntil.value = now + 300;
        }
        directionAnchor.value = currentOffset;
        lastDirection.value = 0;
        return;
      }

      if (now < cooldownUntil.value) return;

      const currentDirection = diff > 2 ? 1 : diff < -2 ? -1 : lastDirection.value;
      if (currentDirection !== 0 && currentDirection !== lastDirection.value) {
        directionAnchor.value = currentOffset;
        lastDirection.value = currentDirection;
      }

      const distanceFromAnchor = currentOffset - directionAnchor.value;

      if (distanceFromAnchor > 50 && tabBarVisible.value !== 0) {
        tabBarVisible.value = withTiming(0, { duration: 200 });
        cooldownUntil.value = now + 300;
      } else if (distanceFromAnchor < -30 && tabBarVisible.value !== 1) {
        tabBarVisible.value = withTiming(1, { duration: 200 });
        cooldownUntil.value = now + 300;
      }
    },
    onEndDrag: () => {
      'worklet';
      directionAnchor.value = previousOffset.value;
    },
    onMomentumEnd: () => {
      'worklet';
      if (previousOffset.value < 20) {
        tabBarVisible.value = withTiming(1, { duration: 200 });
      }
    },
  });

  // Status chips are part of the board controls, so keep that reset. Sport
  // filters scroll only when a sport is selected; clearing should not pull the
  // user back down after they have moved elsewhere.
  const didMountFilterRef = useRef(false);
  useEffect(() => {
    if (!didMountFilterRef.current) {
      didMountFilterRef.current = true;
      return;
    }
    scrollToHomeBoard();
  }, [scrollToHomeBoard, statusFilter]);

  // Fetch games from real API - backend already returns today's slate + yesterday's live games
  const {
    data: todaysGames,
    refetch: refetchGames,
    isLoading: isLoadingGames,
    isFetching: isFetchingGames,
    prefetchGame,
  } = useGames({
    enabled: isFocused,
    subscribed: isFocused,
  });
  const hasHomeGameData = (todaysGames?.length ?? 0) > 0;
  // ── First-real-data latch ─────────────────────────────────────────────────
  // The board must show calm '--' placeholders (never a misleading 0) until the
  // first real slate actually arrives. Relying on React Query's isLoading/
  // isFetching is not enough: on a cold start the query can settle
  // isLoading=false AND isFetching=false with an empty result for a beat (the
  // enabled:isFocused gate, a prefetch race, or a fast empty resolve), leaving
  // a window where no flag is set yet hasHomeGameData is still false — which is
  // exactly when the old code flashed 0.
  //
  // So we latch: once we have ever seen real game data, we are no longer in the
  // initial-load state. Until then we stay in the loading ('--') state. A
  // wall-clock safety cap guarantees a genuinely empty day (no games at all)
  // still resolves from '--' to a real 0 instead of holding '--' forever.
  const FIRST_DATA_TIMEOUT_MS = 12000;
  const firstLoadStartedAtRef = useRef<number>(Date.now());
  const [hasEverHadGameData, setHasEverHadGameData] = useState(false);
  const [firstDataTimedOut, setFirstDataTimedOut] = useState(false);

  // Latch "has ever had data" as state so the board re-renders from '--' to real
  // counts the instant the first real slate lands.
  useEffect(() => {
    if (hasHomeGameData && !hasEverHadGameData) setHasEverHadGameData(true);
  }, [hasHomeGameData, hasEverHadGameData]);

  // Wall-clock safety cap: a genuinely empty day (no games anywhere) must still
  // resolve from '--' to a real 0 instead of holding '--' forever.
  useEffect(() => {
    if (hasEverHadGameData || firstDataTimedOut) return;
    const remaining = Math.max(0, FIRST_DATA_TIMEOUT_MS - (Date.now() - firstLoadStartedAtRef.current));
    const t = setTimeout(() => setFirstDataTimedOut(true), remaining);
    return () => clearTimeout(t);
  }, [firstDataTimedOut, hasEverHadGameData]);

  // Loading ('--') while: we have no data right now, have never had data, and
  // the safety timeout hasn't fired. After the timeout (truly empty day) or
  // once any real data has arrived, we show real counts.
  const isInitialHomeLoading =
    !hasHomeGameData && !hasEverHadGameData && !firstDataTimedOut;
  const { refreshing, onRefresh } = useSmoothRefresh(refetchGames, { minVisibleMs: 320, maxVisibleMs: 850 });

  // ── Empty-data self-heal ──────────────────────────────────────────────────
  // If the home tab is focused but ends up with no games and nothing is in
  // flight — e.g. a cold-start prefetch failed and cleared the cache, or a
  // transient empty response slipped through — force exactly one revalidation
  // instead of waiting out the staleTime. This makes a momentary miss recover
  // on its own so the user never sits looking at 0 games. A ref gates it to a
  // single attempt per empty episode and resets once data arrives, so it can
  // never become a refetch loop.
  const selfHealAttemptedRef = useRef(false);
  useEffect(() => {
    if (hasHomeGameData) {
      selfHealAttemptedRef.current = false;
      return;
    }
    if (!isFocused || isLoadingGames || isFetchingGames) return;
    if (selfHealAttemptedRef.current) return;
    selfHealAttemptedRef.current = true;
    void refetchGames();
  }, [hasHomeGameData, isFocused, isLoadingGames, isFetchingGames, refetchGames]);

  const handleOpenGame = useCallback((game: GameWithPrediction) => {
    if (!claimGameNavigation(game.id)) return;
    prefetchGame(game.id, game);
    guardedRouterPush(router, `/game/${game.id}` as any);
  }, [prefetchGame, router]);

  const handleWarmGame = useCallback((game: GameWithPrediction) => {
    prefetchGame(game.id, game);
  }, [prefetchGame]);

  // Derive live games from the same query (no double subscription)
  const liveGamesPreview = useMemo(
    () => sortSuspendedGamesLast((todaysGames ?? []).filter(isLiveGameLike)),
    [todaysGames]
  );

  // Sports that have live games (for compact filter chips)
  const availableLiveSports = useMemo<Sport[]>(() => {
    if (!liveGamesPreview.length) return [];
    const sportsSet = new Set<Sport>();
    liveGamesPreview.forEach((game) => sportsSet.add(game.sport as Sport));
    return Array.from(sportsSet);
  }, [liveGamesPreview]);

  // Live sport counts for chip badges
  const liveSportCounts = useMemo(() => {
    const counts = new Map<Sport, number>();
    liveGamesPreview.forEach((game) => {
      const sport = game.sport as Sport;
      counts.set(sport, (counts.get(sport) ?? 0) + 1);
    });
    return counts;
  }, [liveGamesPreview]);

  // Filtered live games based on selected sport filter
  const filteredLiveGames = useMemo(() => {
    let games = liveGamesPreview;
    // Top sport filter applies to live games too
    if (deferredSelectedSportFilter) {
      games = games.filter((game) => game.sport === deferredSelectedSportFilter);
    }
    // Live-specific sport filter (pills inside Live Now section)
    if (deferredSelectedLiveSportFilter) {
      games = games.filter((game) => game.sport === deferredSelectedLiveSportFilter);
    }
    return games;
  }, [liveGamesPreview, deferredSelectedLiveSportFilter, deferredSelectedSportFilter]);

  // Compute game counts by sport from the games data
  // ─── Date helpers (local timezone) ───
  const getLocalDateStr = useCallback((dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const todayStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const scheduledDateKeys = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    return new Set([
      `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`,
      `${dayAfter.getFullYear()}-${String(dayAfter.getMonth() + 1).padStart(2, '0')}-${String(dayAfter.getDate()).padStart(2, '0')}`,
    ]);
  }, []);

  // Game counts reflect the active tab
  const gameCounts = useMemo(() => {
    const counts: Partial<Record<Sport, number>> = {};
    if (!todaysGames) return counts;
    todaysGames.forEach((game) => {
      const sport = game.sport as Sport;
      const dateStr = getLocalDateStr(game.gameTime);
      let include = false;
      if (deferredStatusFilter === 'all') {
        // Today tab: SCHEDULED only
        include = game.status === GameStatus.SCHEDULED && dateStr === todayStr;
      } else if (deferredStatusFilter === 'final') {
        include = game.status === GameStatus.FINAL && dateStr === todayStr;
      } else if (deferredStatusFilter === 'upcoming') {
        include = game.status === GameStatus.SCHEDULED && scheduledDateKeys.has(dateStr);
      }
      if (include) {
        counts[sport] = (counts[sport] || 0) + 1;
      }
    });
    return counts;
  }, [todaysGames, deferredStatusFilter, todayStr, scheduledDateKeys, getLocalDateStr]);

  // Status-agnostic totals per sport (every non-cancelled game in the loaded
  // window). Used only to order the sport tiles so an in-season league surfaces
  // on page 1 regardless of which tab/day its games fall on.
  const totalGameCounts = useMemo(() => {
    const counts: Partial<Record<Sport, number>> = {};
    if (!todaysGames) return counts;
    todaysGames.forEach((game) => {
      if (game.status === GameStatus.CANCELLED || game.status === GameStatus.POSTPONED) return;
      const sport = game.sport as Sport;
      counts[sport] = (counts[sport] || 0) + 1;
    });
    return counts;
  }, [todaysGames]);

  // Search results: filter todaysGames by query — includes FINAL, excludes POSTPONED/CANCELLED
  // Order: LIVE first, then SCHEDULED, then FINAL at the bottom
  const searchResults = useMemo<GameWithPrediction[]>(() => {
    if (!todaysGames) return [];
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    const statusOrder: Record<string, number> = { LIVE: 0, SCHEDULED: 1, FINAL: 2 };
    return todaysGames
      .filter((game) => {
        if (game.status === GameStatus.POSTPONED || game.status === GameStatus.CANCELLED) {
          return false;
        }
        const sportName = SPORT_META[game.sport as Sport]?.name?.toLowerCase() ?? '';
        const sportKey = (game.sport as string).toLowerCase();
        return (
          game.homeTeam.name.toLowerCase().includes(q) ||
          game.homeTeam.abbreviation.toLowerCase().includes(q) ||
          game.homeTeam.city.toLowerCase().includes(q) ||
          game.awayTeam.name.toLowerCase().includes(q) ||
          game.awayTeam.abbreviation.toLowerCase().includes(q) ||
          game.awayTeam.city.toLowerCase().includes(q) ||
          sportName.includes(q) ||
          sportKey.includes(q)
        );
      })
      .sort((a, b) => {
        const aOrder = statusOrder[a.status] ?? 3;
        const bOrder = statusOrder[b.status] ?? 3;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime();
      });
  }, [todaysGames, debouncedQuery]);

  // Filter out live games for "Today's Games" section (they show in "Live Now")
  // Also filter to only TODAY's games (backend may return finals from yesterday)
  const nonLiveGames = useMemo(() => {
    if (!todaysGames) return [];
    const now = new Date();
    // Use a wide window: yesterday midnight to end of tomorrow
    // The backend already returns only relevant games with timezone buffering,
    // so we just need to avoid dropping games that are "today" in US timezones
    // but technically "tomorrow" in UTC (e.g. NBA 7pm EST = 2026-02-24T00:00Z)
    const startOfYesterday = new Date(now);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(now);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
    endOfTomorrow.setHours(23, 59, 59, 999);

    return todaysGames.filter((game) => {
      if (isLiveGameLike(game)) return false;
      const gameTime = new Date(game.gameTime);
      return gameTime >= startOfYesterday && gameTime <= endOfTomorrow;
    });
  }, [todaysGames]);

  // Build flat list data for virtualized rendering
  type SectionHeaderItem = { type: 'sport-header'; sport: Sport; gameCount: number; key: string };
  type DateSectionItem = { type: 'date-header'; label: string; count: number; key: string };
  type GameItem = { type: 'game'; game: GameWithPrediction; index: number; key: string };
  type SportShowMoreItem = { type: 'sport-show-more'; sport: Sport; total: number; visible: number; key: string };
  type FlatListItem = SectionHeaderItem | DateSectionItem | GameItem | SportShowMoreItem;

  const getSportVisibilityKey = useCallback((sport: Sport) => {
    return `${deferredStatusFilter}:${deferredSelectedSportFilter ?? 'all'}:${sport}`;
  }, [deferredSelectedSportFilter, deferredStatusFilter]);

  const showMoreSportGames = useCallback((sport: Sport, total: number) => {
    setVisibleSportGameCounts((prev) => {
      const key = getSportVisibilityKey(sport);
      const current = prev[key] ?? HOME_SPORT_INITIAL_GAME_COUNT;
      return {
        ...prev,
        [key]: Math.min(total, current + HOME_SPORT_GAME_BATCH_COUNT),
      };
    });
  }, [getSportVisibilityKey]);

  const showLessSportGames = useCallback((sport: Sport) => {
    setVisibleSportGameCounts((prev) => ({
      ...prev,
      [getSportVisibilityKey(sport)]: HOME_SPORT_INITIAL_GAME_COUNT,
    }));
  }, [getSportVisibilityKey]);

  const flatListData = useMemo<FlatListItem[]>(() => {
    if (!todaysGames?.length) return [];

    // Step 1: Filter by tab (date + status)
    let tabGames: GameWithPrediction[] = [];

    if (deferredStatusFilter === 'all') {
      // Today tab: SCHEDULED only, current day (LIVE games are in Live Now section)
      tabGames = todaysGames.filter(g => {
        const dateStr = getLocalDateStr(g.gameTime);
        return dateStr === todayStr && g.status === GameStatus.SCHEDULED;
      });
    } else if (deferredStatusFilter === 'final') {
      // Final tab: FINAL games from today only
      tabGames = todaysGames.filter(g => {
        const dateStr = getLocalDateStr(g.gameTime);
        return dateStr === todayStr && g.status === GameStatus.FINAL;
      });
    } else if (deferredStatusFilter === 'upcoming') {
      tabGames = todaysGames.filter(g => {
        const dateStr = getLocalDateStr(g.gameTime);
        return scheduledDateKeys.has(dateStr) && g.status === GameStatus.SCHEDULED;
      });
    }

    // Step 2: Apply sport filter on top
    if (deferredSelectedSportFilter) {
      tabGames = tabGames.filter(g => g.sport === deferredSelectedSportFilter);
    }

    tabGames = Array.from(new Map(tabGames.map((game) => [game.id, game])).values());

    // Step 3: Sort by gameTime ascending
    tabGames.sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    // Step 4: Build FlatList items
    const items: FlatListItem[] = [];
    const pushLimitedSportGames = (sport: Sport, games: GameWithPrediction[]) => {
      const visibilityKey = getSportVisibilityKey(sport);
      const visibleCount = Math.min(games.length, visibleSportGameCounts[visibilityKey] ?? HOME_SPORT_INITIAL_GAME_COUNT);
      games.slice(0, visibleCount).forEach((game, idx) => {
        items.push({ type: 'game', game, index: idx, key: game.id });
      });
      if (games.length > HOME_SPORT_INITIAL_GAME_COUNT) {
        items.push({
          type: 'sport-show-more',
          sport,
          total: games.length,
          visible: visibleCount,
          key: `more-${visibilityKey}-${visibleCount}-${games.length}`,
        });
      }
    };

    if (deferredSelectedSportFilter) {
      // Sport filter active — no section headers, just the selected sport's board.
      pushLimitedSportGames(deferredSelectedSportFilter, tabGames);
    } else {
      // No sport filter — group by sport with section headers
      const grouped = new Map<Sport, GameWithPrediction[]>();
      tabGames.forEach(game => {
        const sport = game.sport as Sport;
        if (!grouped.has(sport)) grouped.set(sport, []);
        grouped.get(sport)!.push(game);
      });

      // Sort groups by game count (most first)
      const sortedGroups = Array.from(grouped.entries()).sort(
        ([, a], [, b]) => b.length - a.length
      );

      sortedGroups.forEach(([sport, games]) => {
        items.push({ type: 'sport-header', sport, gameCount: games.length, key: `header-${sport}` });
        pushLimitedSportGames(sport, games);
      });
    }

    return items;
  }, [todaysGames, deferredSelectedSportFilter, deferredStatusFilter, todayStr, scheduledDateKeys, getLocalDateStr, getSportVisibilityKey, visibleSportGameCounts]);


  // Render item for FlatList
  const renderGameListItem = useCallback(({ item }: { item: FlatListItem }) => {
    if (item.type === 'sport-header') {
      const sportLabel = displaySport(item.sport);
      return (
        <View style={numColumns > 1 ? { width: '100%', paddingHorizontal: responsive.contentPadding, marginTop: 20, marginBottom: 14 } : { paddingHorizontal: 20, marginTop: 20, marginBottom: 14 }}>
          <LedBarPanel
            label={sportLabel}
            count={item.gameCount}
            leftSport={item.sport}
          />
        </View>
      );
    }

    if (item.type === 'date-header') {
      const isLive = item.label === 'LIVE NOW';
      const accentColor =
        isLive ? '#DC2626' :
        item.label === 'TODAY' ? TEAL :
        item.label === 'TOMORROW' ? '#5A7A8A' :
        item.label === 'FINAL RESULTS' ? '#A1B3C9' :
        '#FFFFFF';
      return (
        <View style={numColumns > 1 ? { width: '100%', paddingHorizontal: responsive.contentPadding, marginTop: 24, marginBottom: 14 } : { paddingHorizontal: 20, marginTop: 24, marginBottom: 14 }}>
          {/* Subtle divider above — fades from edges */}
          {!isLive ? (
            <LinearGradient colors={['transparent', 'rgba(255,255,255,0.06)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 1, marginBottom: 14 }} />
          ) : null}
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {isLive ? (
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#DC2626' }} />
                ) : (
                  <View style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: accentColor }} />
                )}
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 }}>
                  {isLive ? 'Live Now' : item.label === 'TOMORROW' ? 'Tomorrow' : item.label === 'FINAL RESULTS' ? 'Final Results' : item.label}
                </Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '600' }}>{item.count}</Text>
            </View>
            <View style={{ width: 40, height: 2, borderRadius: 1, backgroundColor: accentColor, marginTop: 8, opacity: 0.6 }} />
          </View>
        </View>
      );
    }

    if (item.type === 'sport-show-more') {
      const hasMore = item.visible < item.total;
      const nextCount = Math.min(HOME_SPORT_GAME_BATCH_COUNT, item.total - item.visible);
      const sportLabel = displaySport(item.sport);
      const DirectionIcon = hasMore ? ChevronDown : ChevronUp;
      return (
        <View style={numColumns > 1 ? { width: '100%', paddingHorizontal: responsive.contentPadding, marginBottom: 18 } : { paddingHorizontal: 20, marginBottom: 18 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hasMore ? `View more ${sportLabel} games` : `Show fewer ${sportLabel} games`}
            onPress={() => {
              if (hasMore) {
                showMoreSportGames(item.sport, item.total);
              } else {
                showLessSportGames(item.sport);
              }
            }}
            style={({ pressed }) => ({
              borderRadius: 999,
              overflow: 'hidden',
              opacity: pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.985 : 1 }],
              shadowColor: hasMore ? TEAL : MAROON,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: pressed ? 0.1 : 0.2,
              shadowRadius: 22,
              elevation: 8,
            })}
          >
            <LinearGradient
              colors={['rgba(224,234,240,0.44)', 'rgba(122,157,184,0.34)', 'rgba(139,10,31,0.26)', 'rgba(224,234,240,0.18)']}
              locations={[0, 0.32, 0.74, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 999, padding: 1.15 }}
            >
              <View style={{ minHeight: 54, borderRadius: 999, backgroundColor: 'rgba(4,7,12,0.97)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', paddingLeft: 15, paddingRight: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, overflow: 'hidden' }}>
                <LinearGradient
                  pointerEvents="none"
                  colors={['rgba(122,157,184,0.14)', 'rgba(4,7,12,0)', 'rgba(139,10,31,0.10)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                />
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 18, right: 18, height: 1, backgroundColor: 'rgba(255,255,255,0.14)' }} />
                <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(122,157,184,0.10)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.18)' }}>
                    <Text numberOfLines={1} style={{ color: TEAL, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 }}>{sportLabel}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text adjustsFontSizeToFit minimumFontScale={0.84} numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 14.5, fontWeight: '900', letterSpacing: 0 }}>
                      {hasMore ? 'View more games' : 'Show fewer games'}
                    </Text>
                    <Text numberOfLines={1} style={{ color: 'rgba(180,211,235,0.50)', fontSize: 10.5, fontWeight: '800', marginTop: 2 }}>
                      {item.visible} shown · {item.total - item.visible} remaining
                    </Text>
                  </View>
                </View>
                <LinearGradient
                  colors={hasMore ? ['rgba(122,157,184,0.22)', 'rgba(122,157,184,0.10)'] : ['rgba(139,10,31,0.22)', 'rgba(139,10,31,0.10)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ height: 38, borderRadius: 999, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: hasMore ? 'rgba(122,157,184,0.26)' : 'rgba(139,10,31,0.26)' }}
                >
                  <Text style={{ color: hasMore ? TEAL : MAROON, fontSize: 12, fontWeight: '900', letterSpacing: 0.2 }}>{hasMore ? `+${nextCount}` : 'LESS'}</Text>
                  <DirectionIcon size={15} color={hasMore ? TEAL : MAROON} strokeWidth={2.8} />
                </LinearGradient>
              </View>
            </LinearGradient>
          </Pressable>
        </View>
      );
    }

    if (item.type === 'game') {
      return (
        <View style={numColumns > 1 ? { flex: 1, maxWidth: '50%' } : { paddingHorizontal: 20, marginBottom: 14 }}>
          <GameCard game={item.game} index={item.index} canOpen={canOpenHomeCard} />
        </View>
      );
    }

    return null;
  }, [canOpenHomeCard, numColumns, responsive.contentPadding, showLessSportGames, showMoreSportGames]);

  // Key items by their own stable id so the FlatList REUSES the cards that
  // persist across a filter/sport change instead of unmounting and rebuilding
  // the entire board (which caused a flash + layout shift). Scroll position on a
  // sport change is handled explicitly by scrollToHomeBoard().
  const getItemKey = useCallback((item: FlatListItem) => item.key, []);

  const handleCloseSearchModal = useCallback(() => {
    setSearchModalVisible(false);
    setSearchQuery('');
    setDebouncedQuery('');
  }, []);

  // Navigate to game from search modal - memoized
  const handleSearchGamePress = useCallback((game: GameWithPrediction) => {
    handleCloseSearchModal();
    handleOpenGame(game);
  }, [handleCloseSearchModal, handleOpenGame]);

  const normalizedSearchQuery = searchQuery.trim();
  const normalizedDebouncedSearchQuery = debouncedQuery.trim();
  const isHomeSearchSettling = normalizedSearchQuery !== '' && normalizedDebouncedSearchQuery !== normalizedSearchQuery;
  const searchData = useMemo<GameWithPrediction[]>(
    () => (normalizedSearchQuery === '' ? [] : searchResults),
    [normalizedSearchQuery, searchResults]
  );

  const renderSearchResult = useCallback(({ item, index }: { item: GameWithPrediction; index: number }) => (
    <SearchGameCard
      game={item}
      index={index}
      onPressIn={() => handleWarmGame(item)}
      onPress={() => handleSearchGamePress(item)}
    />
  ), [handleSearchGamePress, handleWarmGame]);

  const getSearchItemLayout = useCallback((_: ArrayLike<GameWithPrediction> | null | undefined, index: number) => ({
    length: SEARCH_RESULT_ITEM_HEIGHT,
    offset: SEARCH_RESULT_ITEM_HEIGHT * index,
    index,
  }), []);

  const homeListHeader = useMemo(() => (
    <>
      <HomeHeader
        filteredLiveGames={filteredLiveGames}
        availableLiveSports={availableLiveSports}
        liveSportCounts={liveSportCounts}
        selectedLiveSportFilter={selectedLiveSportFilter}
        setSelectedLiveSportFilter={setSelectedLiveSportFilter}
        selectedSportFilter={selectedSportFilter}
        setSelectedSportFilter={applySportFilter}
        showAllLive={showAllLive}
        onViewAll={scrollToHomeBoard}
        gameCounts={gameCounts}
        totalGameCounts={totalGameCounts}
        isLoadingGames={isInitialHomeLoading}
        onOpenLiveGames={handleOpenLiveGames}
        onOpenGame={handleOpenGame}
        onWarmGame={handleWarmGame}
        responsive={responsive}
        statusFilter={statusFilter}
      />
      {/* Game Board header + status filter pills */}
      <View style={{ paddingHorizontal: 20, marginBottom: 6, marginTop: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 4 }}>
          <LinearGradient colors={['transparent', 'rgba(122,157,184,0.15)', 'rgba(122,157,184,0.6)']} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 1 }} />
          <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 }}>Game Board</Text>
          <LinearGradient colors={['rgba(122,157,184,0.6)', 'rgba(122,157,184,0.15)', 'transparent']} locations={[0, 0.4, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 1 }} />
        </View>
      </View>
      <StatusFilterRail statusFilter={statusFilter} setStatusFilter={setStatusFilter} />

      {/* Selected sport tile + Clear button — separate */}
      {selectedSportFilter ? (() => {
        const sportLabel = displaySport(selectedSportFilter);
        const count = gameCounts?.[selectedSportFilter] ?? 0;
        return (
          <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginLeft: 20, marginRight: 20, marginTop: 0, marginBottom: 16 }}>
            {/* Sport tile */}
            <LedMiniPanel
              leftSport={selectedSportFilter}
              label={sportLabel}
              count={count}
              sideRail
            />
            {/* Clear button — separate jumbotron tile */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear sport filter"
              accessibilityHint="Shows every sport on the game board"
              onPress={() => applySportFilter(null)}
              style={({ pressed }) => ({
                minHeight: 44,
                opacity: pressed ? 0.84 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <LedMiniPanel label="CLEAR" height={44} />
            </Pressable>
          </View>
        );
      })() : null}
    </>
  ), [
    applySportFilter,
    availableLiveSports,
    filteredLiveGames,
    gameCounts,
    totalGameCounts,
    handleOpenLiveGames,
    handleOpenGame,
    handleWarmGame,
    isInitialHomeLoading,
    liveSportCounts,
    responsive,
    scrollToHomeBoard,
    selectedLiveSportFilter,
    selectedSportFilter,
    showAllLive,
    statusFilter,
  ]);

  const homeListEmpty = useMemo(() => (
    !isLoadingGames && nonLiveGames.length === 0 && liveGamesPreview.length === 0 ? (
      <View className="px-5">
        <Text className="text-zinc-200 text-xs font-semibold uppercase tracking-wider mb-3">
          Today's Games
        </Text>
        <View className="bg-zinc-800 rounded-2xl p-8 items-center">
          <Text className="text-zinc-200 text-center font-semibold mb-1">
            No games today
          </Text>
          <Text className="text-zinc-400 text-center text-sm">
            Tomorrow's slate will appear here when games are scheduled.
          </Text>
        </View>
      </View>
    ) : null
  ), [isLoadingGames, liveGamesPreview.length, nonLiveGames.length]);

  const homeListFooter = useMemo(() => (
    <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 }}>
      <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
        AI predictions are for entertainment purposes only. Not financial advice.
      </Text>
    </View>
  ), []);

  return (
    <TopInsetView style={{ flex: 1, backgroundColor: '#000000' }}>
      <ErrorBoundary>
      {/* Logo */}
      <View style={{ alignItems: 'center', paddingTop: 16, paddingBottom: 16 }}>
        <View style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 12 }}>
          <Image
            source={require('@/assets/clutch-logo-horizontal.png')}
            style={{ width: 300, height: 300 * (523 / 3352) }}
            resizeMode="contain"
          />
        </View>
      </View>
      <GridBackground />
      {/* Subtle coral and teal ambient washes */}
      <LinearGradient
        colors={['rgba(139,10,31,0.04)', 'transparent', 'rgba(122,157,184,0.03)']}
        locations={[0, 0.45, 1]}
        start={{ x: 0.8, y: 0 }}
        end={{ x: 0.2, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        pointerEvents="none"
      />
      <RefreshPill visible={refreshing ? hasHomeGameData : false} label="Updating board" />
      <Animated.FlatList
        key={numColumns}
        ref={flatListRef}
        data={flatListData}
        renderItem={renderGameListItem}
        keyExtractor={getItemKey}
        onScroll={scrollHandler}
        onScrollBeginDrag={homePressGuard.onScrollBeginDrag}
        onScrollEndDrag={homePressGuard.onScrollEndDrag}
        onMomentumScrollBegin={homePressGuard.onMomentumScrollBegin}
        onMomentumScrollEnd={homePressGuard.onMomentumScrollEnd}
        scrollEventThrottle={16}
        removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}
        maxToRenderPerBatch={6}
        windowSize={7}
        initialNumToRender={5}
        updateCellsBatchingPeriod={40}
        decelerationRate="normal"
        numColumns={numColumns > 1 ? numColumns : undefined}
        columnWrapperStyle={numColumns > 1 ? { gap: 16, paddingHorizontal: responsive.contentPadding } : undefined}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          isTablet && numColumns === 1
            ? { paddingBottom: 100, maxWidth: 700, alignSelf: 'center' as const, width: '100%' }
            : { paddingBottom: 100 }
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing ? !hasHomeGameData : false}
            onRefresh={onRefresh}
            tintColor={TEAL}
            colors={[TEAL]}
            progressBackgroundColor="#080C10"
          />
        }
        ListHeaderComponent={homeListHeader}
        ListEmptyComponent={homeListEmpty}
        ListFooterComponent={homeListFooter}
      />

      {/* Search Modal */}
      <Modal
        visible={searchModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCloseSearchModal}
      >
        <View style={{ flex: 1, backgroundColor: '#040608' }}>
          {/* Search Bar Row */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingTop: 20,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: 'rgba(255,255,255,0.08)',
            }}
          >
            {/* Search input with icon */}
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: 'rgba(255,255,255,0.07)',
                borderRadius: 14,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.12)',
                paddingHorizontal: 12,
                height: 46,
                marginRight: 12,
              }}
            >
              <Search size={16} color="rgba(255,255,255,0.4)" style={{ marginRight: 8 }} />
              <TextInput
                autoFocus
                accessibilityLabel="Search teams and sports"
                placeholder="Search teams, sports..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={{
                  flex: 1,
                  color: '#FFFFFF',
                  fontSize: 15,
                  fontWeight: '500',
                }}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearchQuery('')} className="active:opacity-60" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <X size={14} color="rgba(255,255,255,0.4)" />
                </Pressable>
              ) : null}
            </View>

            {/* Cancel button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel search"
              onPress={handleCloseSearchModal}
              className="active:opacity-60"
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ color: '#5A7A8A', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>

          {/* Results */}
          <FlatList
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
            data={searchData}
            keyExtractor={(item) => item.id}
            removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            getItemLayout={getSearchItemLayout}
            renderItem={renderSearchResult}
            ListHeaderComponent={
              normalizedSearchQuery !== '' && searchResults.length > 0 ? (
                <Text
                  style={{
                    color: 'rgba(255,255,255,0.35)',
                    fontSize: 11,
                    fontWeight: '600',
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    marginBottom: 12,
                  }}
                >
                  {isHomeSearchSettling ? 'Updating results' : `${searchResults.length} ${searchResults.length === 1 ? 'game' : 'games'}`}
                </Text>
              ) : null
            }
            ListEmptyComponent={
              normalizedSearchQuery === '' ? (
                /* Empty state - no query */
                <View style={{ alignItems: 'center', paddingTop: 60 }}>
                  <View
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: 30,
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 16,
                    }}
                  >
                    <Search size={26} color="rgba(255,255,255,0.25)" />
                  </View>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, fontWeight: '500', marginBottom: 6 }}>
                    Search Games
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, textAlign: 'center' }}>
                    Search by team name, city, or sport
                  </Text>
                </View>
              ) : isHomeSearchSettling ? (
                <View style={{ alignItems: 'center', paddingTop: 60 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, fontWeight: '500', marginBottom: 6 }}>
                    Searching games
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
                    Updating matches for your search.
                  </Text>
                </View>
              ) : (
                /* No results */
                <View style={{ alignItems: 'center', paddingTop: 60 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, fontWeight: '500', marginBottom: 6 }}>
                    No matches
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
                    Try a different filter or search term.
                  </Text>
                </View>
              )
            }
          />
        </View>
      </Modal>
      </ErrorBoundary>
    </TopInsetView>
  );
}
