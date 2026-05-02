import { View, Text, Image, ScrollView, FlatList, RefreshControl, Pressable, Modal, TextInput, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRouter } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import React, { useState, useCallback, useEffect, useMemo, memo, useRef } from 'react';
import { ChevronRight, X, Search } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect as SvgRect, Defs, Pattern as SvgPattern, Line as SvgLine } from 'react-native-svg';
import { PicksBadge } from '@/components/shared/PicksBadge';
import { SportCard, GameCard, getTicketColor, getSportIcon, DotMatrixText, DotMatrixIcon, PixelGrid, LedBarPanel } from '@/components/sports';
import CompactLiveCard from '@/components/sports/CompactLiveCard';
import { GameCardSkeletonList } from '@/components/sports/GameCardSkeleton';
import { Sport, SPORT_META, GameStatus, GameWithPrediction } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { useGames } from '@/hooks/useGames';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { useResponsive } from '@/hooks/useResponsive';
import { LinearGradient } from 'expo-linear-gradient';
import GridBackground from '@/components/GridBackground';
import { displaySport, formatGameTime } from '@/lib/display-confidence';
import { MAROON, TEAL, TEAL_DARK } from '@/lib/theme';


// Field goal post to replace "U" - with football going through - memoized
const FieldGoalU = memo(function FieldGoalU({ color, size = 42 }: { color: string; size?: number }) {
  const isBlack = color === '#000000';
  return (
    <Svg width={size * 0.65} height={size} viewBox="0 0 26 40" fill="none">
      {/* Left upright */}
      <Path d="M4 0 L4 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      {/* Right upright */}
      <Path d="M22 0 L22 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      {/* Crossbar */}
      <Path d="M4 30 L22 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      {/* Center post going down */}
      <Path d="M13 30 L13 40" stroke={color} strokeWidth="4" strokeLinecap="round" />
      {/* Football going through - pointed oval shape */}
      <Path
        d="M8 15 Q13 10 18 15 Q13 20 8 15"
        fill={color}
        transform="rotate(-35 13 15)"
      />
      {/* Football laces - vertical line */}
      <Path
        d="M13 13 L13 17"
        stroke={isBlack ? '#000000' : '#0D0D0D'}
        strokeWidth="1.2"
        strokeLinecap="round"
        transform="rotate(-35 13 15)"
      />
      {/* Football laces - horizontal lines */}
      <Path
        d="M11.5 14 L14.5 14"
        stroke={isBlack ? '#000000' : '#0D0D0D'}
        strokeWidth="0.8"
        transform="rotate(-35 13 15)"
      />
      <Path
        d="M11.5 16 L14.5 16"
        stroke={isBlack ? '#000000' : '#0D0D0D'}
        strokeWidth="0.8"
        transform="rotate(-35 13 15)"
      />
    </Svg>
  );
});

// Memoize all sports array
const allSports = Object.values(Sport);

// ─── Paginated sport tile carousel ──────────────────────────────────
const SportTileCarousel = memo(function SportTileCarousel({
  sports,
  gameCounts,
  selectedSportFilter,
  setSelectedSportFilter,
  responsive,
}: {
  sports: Sport[];
  gameCounts: Partial<Record<Sport, number>>;
  selectedSportFilter: Sport | null;
  setSelectedSportFilter: (s: Sport | null) => void;
  responsive: ReturnType<typeof useResponsive>;
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
                  gameCount={gameCounts?.[sport] ?? 0}
                  index={idx}
                  tile
                  tileSize={tileWidth}
                  onPress={() => setSelectedSportFilter(isSelected ? null : sport)}
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
  liveGamesPreview: GameWithPrediction[];
  filteredLiveGames: GameWithPrediction[];
  availableLiveSports: Sport[];
  liveSportCounts: Map<Sport, number>;
  selectedLiveSportFilter: Sport | null;
  setSelectedLiveSportFilter: (sport: Sport | null) => void;
  selectedSportFilter: Sport | null;
  setSelectedSportFilter: (sport: Sport | null) => void;
  showAllLive: boolean;
  setShowAllLive: (val: boolean) => void;
  onViewAll: () => void;
  nonLiveGames: GameWithPrediction[];
  gameCounts: Partial<Record<Sport, number>>;
  isLoadingGames: boolean;
  ring1Style: any;
  ring2Style: any;
  router: ReturnType<typeof useRouter>;
  horizontalPadding: number;
  headerFontSize: number;
  responsive: ReturnType<typeof useResponsive>;
  statusFilter: 'all' | 'upcoming' | 'final';
}

const HomeHeader = React.memo(function HomeHeader({
  liveGamesPreview,
  filteredLiveGames,
  availableLiveSports,
  liveSportCounts,
  selectedLiveSportFilter,
  setSelectedLiveSportFilter,
  selectedSportFilter,
  setSelectedSportFilter,
  showAllLive,
  setShowAllLive,
  onViewAll,
  nonLiveGames,
  gameCounts,
  isLoadingGames,
  ring1Style,
  ring2Style,
  router,
  horizontalPadding,
  headerFontSize,
  responsive,
  statusFilter,
}: HomeHeaderProps) {
  return (
    <>
      {/* TODAY'S GAMES bar — real-LED panel (same renderer as the sport tiles below) */}
      <Animated.View
        entering={FadeInDown.delay(150).duration(500)}
        style={{ paddingHorizontal: responsive.isTablet ? responsive.contentPadding : 16, marginTop: 0, marginBottom: 12 }}
      >
        <Pressable
          onPress={() => {
            if (selectedSportFilter) {
              setSelectedSportFilter(null);
            } else {
              onViewAll();
            }
          }}
          style={({ pressed }) => ({
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          {(() => {
            const barCount = selectedSportFilter
              ? (gameCounts?.[selectedSportFilter] ?? 0)
              : Object.values(gameCounts ?? {}).reduce((s: number, c) => s + ((c as number) ?? 0), 0);
            const sportLabel = selectedSportFilter
              ? (displaySport(selectedSportFilter!))
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
        </Pressable>
      </Animated.View>

      {/* Sports Categories — paginated carousel of square LED tiles */}
      <Animated.View
        entering={FadeInDown.delay(100).duration(500)}
        style={{ paddingTop: 0, paddingBottom: 24 }}
      >
        <SportTileCarousel
          sports={[...allSports].sort((a, b) => (gameCounts?.[b] ?? 0) - (gameCounts?.[a] ?? 0))}
          gameCounts={gameCounts}
          selectedSportFilter={selectedSportFilter}
          setSelectedSportFilter={setSelectedSportFilter}
          responsive={responsive}
        />
      </Animated.View>

      {/* Live Games Section — header always shows */}
      <Animated.View
        entering={FadeInDown.delay(100).duration(500)}
        style={{ marginBottom: 24, marginTop: 0 }}
      >
        <View style={{ paddingHorizontal: 20, marginBottom: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 6 }}>
            <LinearGradient colors={['transparent', 'rgba(122,157,184,0.15)', 'rgba(122,157,184,0.6)']} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 1 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {filteredLiveGames.length > 0 ? (
                <Animated.View style={[ring1Style, { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#DC2626' }]} />
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
              <Pressable onPress={() => setSelectedLiveSportFilter(null)}>
                {!selectedLiveSportFilter ? (
                  <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>All ({filteredLiveGames.length})</Text>
                  </LinearGradient>
                ) : (
                  <View style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(122,157,184,0.08)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.12)' }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: TEAL }}>All ({filteredLiveGames.length})</Text>
                  </View>
                )}
              </Pressable>

              {/* Per-sport pills */}
              {availableLiveSports.map((sport) => {
                const isChipSelected = selectedLiveSportFilter === sport;
                const count = liveSportCounts.get(sport) ?? 0;
                const displayName = displaySport(sport);
                return (
                  <Pressable key={sport} onPress={() => setSelectedLiveSportFilter(isChipSelected ? null : sport)}>
                    {isChipSelected ? (
                      <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>{displayName} ({count})</Text>
                      </LinearGradient>
                    ) : (
                      <View style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(122,157,184,0.08)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.12)' }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: TEAL }}>{displayName} ({count})</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {/* Horizontal scroll of compact live game cards */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingLeft: 20, paddingRight: 8, alignItems: 'center' }}
            style={{ flexGrow: 0 }}
            scrollEventThrottle={16}
            removeClippedSubviews={true}
            decelerationRate="fast"
          >
            {(showAllLive ? filteredLiveGames : filteredLiveGames.slice(0, 5)).map((game) => (
              <CompactLiveCard key={game.id} game={game} onPress={() => router.push(`/game/${game.id}` as any)} />
            ))}

            {/* View All button — only show when there are more than 5 and not yet expanded */}
            {!showAllLive && filteredLiveGames.length > 5 ? (
            <Pressable
              onPressIn={() => router.push('/live-games' as any)}
              className="active:opacity-75"
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
            </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
      </Animated.View>

      {/* Loading skeleton */}
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
}: {
  game: GameWithPrediction;
  index: number;
  onPress: () => void;
}) {
  const awayColors = getTeamColors(game.awayTeam.abbreviation, game.sport);
  const homeColors = getTeamColors(game.homeTeam.abbreviation, game.sport);
  const isLive = game.status === GameStatus.LIVE;
  const sportMeta = SPORT_META[game.sport];

  const gameTimeLabel = useMemo(() => {
    if (isLive) {
      return formatGameTime(game.sport, game.quarter, game.clock) || 'LIVE';
    }
    if (game.status === GameStatus.FINAL) return 'Final';
    const d = new Date(game.gameTime);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, [game, isLive]);

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index * 30, 300)).duration(250)}>
      <Pressable
        onPress={onPress}
        className="active:opacity-75"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: `${awayColors.primary}14`,
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
        {/* Left: Team abbreviations stacked with color dots */}
        <View style={{ width: 64, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 3.5,
                backgroundColor: awayColors.primary,
                marginRight: 6,
              }}
            />
            <Text
              style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}
              numberOfLines={1}
            >
              {game.awayTeam.abbreviation}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 3.5,
                backgroundColor: homeColors.primary,
                marginRight: 6,
              }}
            />
            <Text
              style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600', letterSpacing: 0.3 }}
              numberOfLines={1}
            >
              {game.homeTeam.abbreviation}
            </Text>
          </View>
        </View>

        {/* Center: Sport badge + status */}
        <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>
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
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', lineHeight: 20 }}>
                {game.awayScore}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 16, fontWeight: '800', lineHeight: 20 }}>
                {game.homeScore}
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
    </Animated.View>
  );
});

export default function HomeScreen() {
  const router = useRouter();
  const scrollHandler = useHideOnScroll();
  const responsive = useResponsive();
  const { isTablet, contentPadding: horizontalPadding, headerSize: headerFontSize, numColumns } = responsive;
  const flatListRef = useRef<any>(null);
  const lastRefreshRef = useRef<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSportFilter, setSelectedSportFilter] = useState<Sport | null>(null);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [showAllLive, setShowAllLive] = useState(false);
  const [selectedLiveSportFilter, setSelectedLiveSportFilter] = useState<Sport | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'final'>('all');

  // Scroll to top when sport filter changes
  useEffect(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [selectedSportFilter]);

  // Pulsating animation for live games - multiple rings
  // Shared values declared here (before liveGamesPreview) so useAnimatedStyle can reference them
  const pulseScale1 = useSharedValue(1);
  const pulseOpacity1 = useSharedValue(0.8);
  const pulseScale2 = useSharedValue(1);
  const pulseOpacity2 = useSharedValue(0.6);
  const animationsActiveRef = useRef(false);

  // Fetch games from real API - backend already returns today's slate + yesterday's live games
  const { data: todaysGames, refetch: refetchGames, isLoading: isLoadingGames } = useGames();

  // Derive live games from the same query (no double subscription)
  const liveGamesPreview = useMemo(
    () => (todaysGames ?? []).filter((g: any) => g.status === 'in_progress' || g.status === 'halftime' || g.status === 'LIVE'),
    [todaysGames]
  );

  // Gate pulse animations — only run when there are live games
  useEffect(() => {
    const hasLive = liveGamesPreview.length > 0;

    if (hasLive && !animationsActiveRef.current) {
      animationsActiveRef.current = true;
      // Gentle breathing glow — scale subtly and pulse opacity
      pulseScale1.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 1200, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      pulseOpacity1.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.5, { duration: 1200, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else if (!hasLive && animationsActiveRef.current) {
      animationsActiveRef.current = false;
      cancelAnimation(pulseScale1);
      cancelAnimation(pulseOpacity1);
      cancelAnimation(pulseScale2);
      cancelAnimation(pulseOpacity2);
      pulseScale1.value = 1;
      pulseOpacity1.value = 0.8;
      pulseScale2.value = 1;
      pulseOpacity2.value = 0.6;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveGamesPreview.length]);

  const ring1Style = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale1.value }],
    opacity: pulseOpacity1.value,
  }));

  const ring2Style = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale2.value }],
    opacity: pulseOpacity2.value,
  }));

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
    if (selectedSportFilter) {
      games = games.filter((game) => game.sport === selectedSportFilter);
    }
    // Live-specific sport filter (pills inside Live Now section)
    if (selectedLiveSportFilter) {
      games = games.filter((game) => game.sport === selectedLiveSportFilter);
    }
    return games;
  }, [liveGamesPreview, selectedLiveSportFilter, selectedSportFilter]);

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

  // Game counts reflect the active tab
  const gameCounts = useMemo(() => {
    const counts: Partial<Record<Sport, number>> = {};
    if (!todaysGames) return counts;
    todaysGames.forEach((game) => {
      const sport = game.sport as Sport;
      const dateStr = getLocalDateStr(game.gameTime);
      let include = false;
      if (statusFilter === 'all') {
        // Today tab: SCHEDULED only
        include = game.status === GameStatus.SCHEDULED && dateStr === todayStr;
      } else if (statusFilter === 'final') {
        include = game.status === GameStatus.FINAL && dateStr === todayStr;
      } else if (statusFilter === 'upcoming') {
        // Scheduled tab: every SCHEDULED game in the slate, regardless of date.
        // Backend returns today + tomorrow + day-after — the user expects this
        // tab to show all upcoming games, including today's not-yet-started
        // ones, not just future days. Today's already-final games are still
        // excluded because their status is FINAL, not SCHEDULED.
        include = game.status === GameStatus.SCHEDULED;
      }
      if (include) {
        counts[sport] = (counts[sport] || 0) + 1;
      }
    });
    return counts;
  }, [todaysGames, statusFilter, todayStr, getLocalDateStr]);

  // Search results: filter todaysGames by query — includes FINAL, excludes POSTPONED/CANCELLED
  // Order: LIVE first, then SCHEDULED, then FINAL at the bottom
  const searchResults = useMemo<GameWithPrediction[]>(() => {
    if (!todaysGames) return [];
    const q = debouncedQuery.trim().toLowerCase();
    const statusOrder: Record<string, number> = { LIVE: 0, SCHEDULED: 1, FINAL: 2 };
    return todaysGames
      .filter((game) => {
        if (game.status === GameStatus.POSTPONED || game.status === GameStatus.CANCELLED) {
          return false;
        }
        if (!q) return true;
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
      if (game.status === GameStatus.LIVE) return false;
      const gameTime = new Date(game.gameTime);
      return gameTime >= startOfYesterday && gameTime <= endOfTomorrow;
    });
  }, [todaysGames]);

  // Build flat list data for virtualized rendering
  type SectionHeaderItem = { type: 'sport-header'; sport: Sport; gameCount: number; key: string };
  type DateSectionItem = { type: 'date-header'; label: string; count: number; key: string };
  type GameItem = { type: 'game'; game: GameWithPrediction; index: number; key: string };
  type FlatListItem = SectionHeaderItem | DateSectionItem | GameItem;

  const flatListData = useMemo<FlatListItem[]>(() => {
    if (!todaysGames?.length || isLoadingGames) return [];

    // Step 1: Filter by tab (date + status)
    let tabGames: GameWithPrediction[] = [];

    if (statusFilter === 'all') {
      // Today tab: SCHEDULED only, current day (LIVE games are in Live Now section)
      tabGames = todaysGames.filter(g => {
        const dateStr = getLocalDateStr(g.gameTime);
        return dateStr === todayStr && g.status === GameStatus.SCHEDULED;
      });
    } else if (statusFilter === 'final') {
      // Final tab: FINAL games from today only
      tabGames = todaysGames.filter(g => {
        const dateStr = getLocalDateStr(g.gameTime);
        return dateStr === todayStr && g.status === GameStatus.FINAL;
      });
    } else if (statusFilter === 'upcoming') {
      // Scheduled tab: every SCHEDULED game in the slate, regardless of date.
      // Same definition as the per-sport count above — show the full upcoming
      // slate so a sport-filter + Scheduled combo doesn't silently hide today's
      // games that haven't kicked off yet.
      tabGames = todaysGames.filter(g => g.status === GameStatus.SCHEDULED);
    }

    // Step 2: Apply sport filter on top
    if (selectedSportFilter) {
      tabGames = tabGames.filter(g => g.sport === selectedSportFilter);
    }

    // Step 3: Sort by gameTime ascending
    tabGames.sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    // Step 4: Build FlatList items
    const items: FlatListItem[] = [];

    if (selectedSportFilter) {
      // Sport filter active — no section headers, just games
      tabGames.forEach((game, idx) => {
        items.push({ type: 'game', game, index: idx, key: game.id });
      });
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
        games.forEach((game, idx) => {
          items.push({ type: 'game', game, index: idx, key: game.id });
        });
      });
    }

    return items;
  }, [todaysGames, selectedSportFilter, isLoadingGames, statusFilter, todayStr, getLocalDateStr]);


  // Render item for FlatList
  const renderGameListItem = useCallback(({ item }: { item: FlatListItem }) => {
    if (item.type === 'sport-header') {
      const sportLabel = displaySport(item.sport);
      return (
        <View style={{ marginHorizontal: 16, marginTop: 20, marginBottom: 14 }}>
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

    if (item.type === 'game') {
      return (
        <View style={numColumns > 1 ? { flex: 1, maxWidth: '50%' } : { paddingHorizontal: 20, marginBottom: 14 }}>
          <GameCard game={item.game} index={item.index} />
        </View>
      );
    }

    return null;
  }, [numColumns, responsive.contentPadding, router]);

  const getItemKey = useCallback((item: FlatListItem) => item.key, []);

  const onRefresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < 3000) return; // debounce: 3s minimum between refreshes
    lastRefreshRef.current = now;
    setRefreshing(true);
    await refetchGames();
    setRefreshing(false);
  }, [refetchGames]);

  // Navigate to game from search modal - memoized
  const handleSearchGamePress = useCallback((gameId: string) => {
    setSearchModalVisible(false);
    router.push(`/game/${gameId}` as any);
  }, [router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
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
      <Animated.FlatList
        key={numColumns}
        ref={flatListRef}
        data={flatListData}
        renderItem={renderGameListItem}
        keyExtractor={getItemKey}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        removeClippedSubviews={true}
        maxToRenderPerBatch={4}
        windowSize={5}
        initialNumToRender={3}
        updateCellsBatchingPeriod={50}
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
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#fff"
          />
        }
        ListHeaderComponent={
        <>
        <HomeHeader
            liveGamesPreview={liveGamesPreview}
            filteredLiveGames={filteredLiveGames}
            availableLiveSports={availableLiveSports}
            liveSportCounts={liveSportCounts}
            selectedLiveSportFilter={selectedLiveSportFilter}
            setSelectedLiveSportFilter={setSelectedLiveSportFilter}
            selectedSportFilter={selectedSportFilter}
            setSelectedSportFilter={setSelectedSportFilter}
            showAllLive={showAllLive}
            setShowAllLive={setShowAllLive}
            onViewAll={() => flatListRef.current?.scrollToOffset({ offset: 300, animated: true })}
            nonLiveGames={nonLiveGames}
            gameCounts={gameCounts}
            isLoadingGames={isLoadingGames}
            ring1Style={ring1Style}
            ring2Style={ring2Style}
            router={router}
            horizontalPadding={horizontalPadding}
            headerFontSize={headerFontSize}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 6, flexGrow: 1, justifyContent: 'center' }}>
            {([
              { key: 'all' as const, label: 'Today' },
              { key: 'final' as const, label: 'Final' },
              { key: 'upcoming' as const, label: 'Scheduled' },
            ]).map(f => {
              const active = statusFilter === f.key;
              const hasFilter = statusFilter !== 'all';
              const dimmed = hasFilter && !active;
              return (
                <Pressable key={f.key} onPress={() => setStatusFilter(active ? 'all' : f.key)}
                  style={{ borderRadius: 20, overflow: 'hidden' as const, opacity: dimmed ? 0.5 : 1 }}>
                  {active ? (
                    <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>{f.label}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={{ paddingHorizontal: 16, paddingVertical: 7, backgroundColor: 'rgba(122,157,184,0.08)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.12)', borderRadius: 20 }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: TEAL }}>{f.label}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Selected sport tile + Clear button — separate */}
          {selectedSportFilter ? (() => {
            const sportLabel = displaySport(selectedSportFilter!);
            const count = gameCounts?.[selectedSportFilter] ?? 0;
            return (
              <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginLeft: 20, marginRight: 20, marginTop: 0, marginBottom: 16 }}>
                {/* Sport tile */}
                <View style={{ position: 'relative' as const, overflow: 'hidden' as const, borderRadius: 3, backgroundColor: '#080c10', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', height: 36, paddingHorizontal: 10, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 }}>
                  <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                    <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
                      <Defs>
                        <SvgPattern id="secGridSelected" width="2" height="2" patternUnits="userSpaceOnUse">
                          <SvgRect width="2" height="2" fill="transparent" />
                          <SvgRect x="0" y="0" width="1.5" height="1.5" rx="0.2" fill="rgba(255,255,255,0.04)" />
                        </SvgPattern>
                      </Defs>
                      <SvgRect width="100%" height="100%" fill="url(#secGridSelected)" />
                    </Svg>
                  </View>
                  <View style={{ position: 'absolute' as const, left: 0, top: 0, bottom: 0, width: 3, backgroundColor: '#7A9DB8', opacity: 0.6, zIndex: 4 }} />
                  <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, zIndex: 4, marginLeft: 4 }}>
                    <DotMatrixIcon sport={selectedSportFilter} litColor="#FFFFFF" pixelSize={1.5} />
                    <DotMatrixText text={sportLabel} litColor="#9BB8CF" pixelSize={1.5} />
                    <DotMatrixText text={String(count)} litColor="#FFFFFF" pixelSize={1.5} />
                  </View>
                </View>
                {/* Clear button — separate jumbotron tile */}
                <Pressable onPress={() => setSelectedSportFilter(null)}>
                  <View style={{ position: 'relative' as const, overflow: 'hidden' as const, borderRadius: 3, backgroundColor: '#080c10', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', height: 36, paddingHorizontal: 10, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const }}>
                    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                      <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
                        <Defs>
                          <SvgPattern id="secGridClear" width="2" height="2" patternUnits="userSpaceOnUse">
                            <SvgRect width="2" height="2" fill="transparent" />
                            <SvgRect x="0" y="0" width="1.5" height="1.5" rx="0.2" fill="rgba(255,255,255,0.04)" />
                          </SvgPattern>
                        </Defs>
                        <SvgRect width="100%" height="100%" fill="url(#secGridClear)" />
                      </Svg>
                    </View>
                    <View style={{ zIndex: 4 }}>
                      <DotMatrixText text="CLEAR" litColor="#FFFFFF" pixelSize={1.5} />
                    </View>
                  </View>
                </Pressable>
              </View>
            );
          })() : null}
        </>
        }
        ListEmptyComponent={
          !isLoadingGames && nonLiveGames.length === 0 && liveGamesPreview.length === 0 ? (
            <Animated.View entering={FadeInRight.delay(300).duration(500)} className="px-5">
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
            </Animated.View>
          ) : null
        }
        ListFooterComponent={
          <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 }}>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
              AI predictions are for entertainment purposes only. Not financial advice.
            </Text>
          </View>
        }
      />

      {/* Search Modal */}
      <Modal
        visible={searchModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSearchModalVisible(false)}
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
                <Pressable onPress={() => setSearchQuery('')} className="active:opacity-60" style={{ padding: 4 }}>
                  <X size={14} color="rgba(255,255,255,0.4)" />
                </Pressable>
              ) : null}
            </View>

            {/* Cancel button */}
            <Pressable
              onPress={() => setSearchModalVisible(false)}
              className="active:opacity-60"
            >
              <Text style={{ color: '#5A7A8A', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>

          {/* Results */}
          <FlatList
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
            data={searchQuery.trim() === '' ? [] : searchResults}
            keyExtractor={(item) => item.id}
            removeClippedSubviews={true}
            maxToRenderPerBatch={4}
            windowSize={5}
            renderItem={({ item, index }) => (
              <SearchGameCard
                game={item}
                index={index}
                onPress={() => handleSearchGamePress(item.id)}
              />
            )}
            ListHeaderComponent={
              searchQuery.trim() !== '' && searchResults.length > 0 ? (
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
                  {searchResults.length} {searchResults.length === 1 ? 'game' : 'games'}
                </Text>
              ) : null
            }
            ListEmptyComponent={
              searchQuery.trim() === '' ? (
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
    </SafeAreaView>
  );
}
