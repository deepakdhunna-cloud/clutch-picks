import { View, Text, Image, ScrollView, FlatList, RefreshControl, Pressable, Modal, TextInput, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import React, { useState, useCallback, useEffect, useMemo, memo, useRef } from 'react';
import { ChevronRight, X, Search } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { PicksBadge } from '@/components/shared/PicksBadge';
import { SportCard, GameCard, getTicketColor } from '@/components/sports';
import CompactLiveCard from '@/components/sports/CompactLiveCard';
import { GameCardSkeletonList } from '@/components/sports/GameCardSkeleton';
import { Sport, SPORT_META, GameStatus, GameWithPrediction } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { useGames } from '@/hooks/useGames';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { useResponsive } from '@/hooks/useResponsive';
import { LinearGradient } from 'expo-linear-gradient';
import GridBackground from '@/components/GridBackground';

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
}: HomeHeaderProps) {
  return (
    <>
      {/* App Header - Clutch Branding */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        className="px-5 pt-5 pb-3"
        style={{ alignItems: 'center' }}
      >
        <View style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 12 }}>
          <Image
            source={require('@/assets/clutch-logo-horizontal.png')}
            style={{ width: 300, height: 300 * (523 / 3352) }}
            resizeMode="contain"
          />
        </View>
      </Animated.View>

      {/* Today Games Bar — Ticket Style */}
      <Animated.View
        entering={FadeInDown.delay(150).duration(500)}
        style={{ paddingHorizontal: responsive.isTablet ? responsive.contentPadding : 20, marginTop: 16, marginBottom: 20 }}
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
            const hasFilter = !!selectedSportFilter;
            const barColor = hasFilter ? getTicketColor(selectedSportFilter!) : '#1C2A3A';
            const barCount = hasFilter
              ? (gameCounts?.[selectedSportFilter!] ?? 0)
              : Object.values(gameCounts ?? {}).reduce((s: number, c) => s + ((c as number) ?? 0), 0);

            if (!hasFilter) {
              // ── DEFAULT STATE: dark glass with blur ──
              return (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 12,
                    paddingHorizontal: 16,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.2)',
                    overflow: 'hidden',
                  }}
                >
                  <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.03)' }]} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4 }}>
                    {/* Mini ticket — glass style */}
                    <View style={{
                      width: 26, height: 32, borderRadius: 6, overflow: 'hidden',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
                      backgroundColor: 'rgba(255,255,255,0.03)',
                    }}>
                      {/* Top accent */}
                      <View style={{ height: 2, backgroundColor: '#5A7A8A' }} />
                      {/* Number */}
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFFFFF' }}>{barCount}</Text>
                      </View>
                      {/* Perforation */}
                      <View style={{ marginHorizontal: 2, height: 0, borderBottomWidth: 1, borderStyle: 'dashed', borderBottomColor: 'rgba(255,255,255,0.1)' }} />
                      {/* Zigzag */}
                      <View style={{ height: 4, backgroundColor: '#040608', flexDirection: 'row' }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <View key={i} style={{ width: 0, height: 0, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderTopWidth: 3, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#040608', marginTop: -3 }} />
                        ))}
                      </View>
                    </View>
                    <View>
                      <Text style={{ fontSize: 15, fontWeight: '800', color: '#FFFFFF' }}>Today's Games</Text>
                      <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>
                        {barCount} games on the board
                      </Text>
                    </View>
                  </View>
                  <View
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: 'rgba(90,122,138,0.15)',
                      borderWidth: 1,
                      borderColor: 'rgba(90,122,138,0.25)',
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#7A9DB8', letterSpacing: 0.5 }}>VIEW ALL</Text>
                  </View>
                </View>
              );
            }

            // ── FILTERED STATE: dark glass with maroon accent ──
            return (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 12,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.2)',
                  overflow: 'hidden',
                }}
              >
                <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(139,10,31,0.06)' }]} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4 }}>
                  {/* Mini ticket — glass style with maroon accent */}
                  <View style={{
                    width: 26, height: 32, borderRadius: 6, overflow: 'hidden',
                    borderWidth: 1, borderColor: 'rgba(139,10,31,0.35)',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                  }}>
                    {/* Top accent */}
                    <View style={{ height: 2, backgroundColor: '#8B0A1F' }} />
                    {/* Number */}
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFFFFF' }}>{barCount}</Text>
                    </View>
                    {/* Perforation */}
                    <View style={{ marginHorizontal: 2, height: 0, borderBottomWidth: 1, borderStyle: 'dashed', borderBottomColor: 'rgba(255,255,255,0.1)' }} />
                    {/* Zigzag */}
                    <View style={{ height: 4, backgroundColor: '#040608', flexDirection: 'row' }}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <View key={i} style={{ width: 0, height: 0, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderTopWidth: 3, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#040608', marginTop: -3 }} />
                      ))}
                    </View>
                  </View>
                  <View>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#FFFFFF' }}>Today's Games</Text>
                    <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>
                      {selectedSportFilter} · {barCount} matchups
                    </Text>
                  </View>
                </View>
                <View
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 8,
                    backgroundColor: 'rgba(139,10,31,0.15)',
                    borderWidth: 1,
                    borderColor: 'rgba(139,10,31,0.3)',
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>VIEW ALL</Text>
                </View>
              </View>
            );
          })()}
        </Pressable>
      </Animated.View>

      {/* Sports Categories */}
      <Animated.View
        entering={FadeInDown.delay(100).duration(500)}
        style={{ paddingTop: 4, paddingBottom: 8 }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: responsive.isTablet ? responsive.contentPadding : 16, paddingVertical: 10, gap: 10 }}
          style={{ flexGrow: 0 }}
          scrollEventThrottle={16}
          removeClippedSubviews={true}
          decelerationRate="fast"
        >
          {[...allSports].sort((a, b) => (gameCounts?.[b] ?? 0) - (gameCounts?.[a] ?? 0)).map((sport, index) => {
            const isSelected = selectedSportFilter === sport;
            return (
              <SportCard
                key={sport}
                sport={sport}
                gameCount={gameCounts?.[sport] ?? 0}
                index={index}
                compact
                onPress={() => setSelectedSportFilter(isSelected ? null : sport)}
                isSelected={isSelected}
              />
            );
          })}
        </ScrollView>
      </Animated.View>

      {/* Live Games Horizontal Scroll Section */}
      {liveGamesPreview && liveGamesPreview.length > 0 ? (
        <Animated.View
          entering={FadeInDown.delay(100).duration(500)}
          style={{ marginBottom: 24, marginTop: 16 }}
        >
          <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                  <Animated.View
                    style={[ring1Style, {
                      position: 'absolute', width: 14, height: 14, borderRadius: 7,
                      borderWidth: 1, borderColor: '#DC2626',
                    }]}
                  />
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#DC2626' }} />
                </View>
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 }}>
                  Live Now
                </Text>
              </View>
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>
                {liveGamesPreview.length}
              </Text>
            </View>
            <View style={{ width: 40, height: 2.5, borderRadius: 1.5, backgroundColor: 'rgba(220,38,38,0.8)', marginTop: 6 }} />
          </View>

          {/* Sport filter pills */}
          {availableLiveSports.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 14, paddingTop: 6 }}
              style={{ flexGrow: 0 }}
              decelerationRate="fast"
            >
              {/* All pill */}
              <Pressable onPress={() => setSelectedLiveSportFilter(null)}>
                <View style={{
                  paddingHorizontal: 18, paddingVertical: 9, borderRadius: 22,
                  backgroundColor: !selectedLiveSportFilter ? MAROON : 'rgba(122,157,184,0.08)',
                  borderWidth: !selectedLiveSportFilter ? 0 : 1,
                  borderColor: !selectedLiveSportFilter ? 'transparent' : 'rgba(122,157,184,0.12)',
                }}>
                  <Text style={{ fontSize: 13, fontWeight: !selectedLiveSportFilter ? '700' : '600', color: !selectedLiveSportFilter ? '#FFFFFF' : TEAL }}>
                    All ({liveGamesPreview.length})
                  </Text>
                </View>
              </Pressable>

              {/* Per-sport pills */}
              {availableLiveSports.map((sport) => {
                const isChipSelected = selectedLiveSportFilter === sport;
                const count = liveSportCounts.get(sport) ?? 0;
                const displayName = sport === 'NCAAF' ? 'CFB' : sport === 'NCAAB' ? 'CBB' : sport;
                return (
                  <Pressable key={sport} onPress={() => setSelectedLiveSportFilter(isChipSelected ? null : sport)}>
                    <View style={{
                      paddingHorizontal: 18, paddingVertical: 9, borderRadius: 22,
                      backgroundColor: isChipSelected ? MAROON : 'rgba(122,157,184,0.08)',
                      borderWidth: isChipSelected ? 0 : 1,
                      borderColor: isChipSelected ? 'transparent' : 'rgba(122,157,184,0.12)',
                    }}>
                      <Text style={{ fontSize: 13, fontWeight: isChipSelected ? '700' : '600', color: isChipSelected ? '#FFFFFF' : TEAL }}>
                        {displayName} ({count})
                      </Text>
                    </View>
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
              onPress={() => setShowAllLive(true)}
              className="active:opacity-75"
              style={{
                height: 56,
                alignSelf: 'center',
                marginRight: 20,
                marginLeft: 4,
                borderRadius: 10,
                overflow: 'hidden',
                borderWidth: 2,
                borderColor: '#F5A896',
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                gap: 5,
                backgroundColor: 'rgba(159,171,184,0.2)',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>View All</Text>
              <ChevronRight size={14} color="#FFFFFF" />
            </Pressable>
            ) : null}
          </ScrollView>
        </Animated.View>
      ) : null}

      {/* Games Section Header */}
      {isLoadingGames ? (
        <View className="px-4 pt-2">
          <GameCardSkeletonList />
        </View>
      ) : nonLiveGames.length > 0 ? (
        <>
          {/* "Today's Games" / Sport Name header */}
          <Animated.View entering={FadeInRight.delay(280).duration(500)} style={{ paddingHorizontal: responsive.isTablet ? responsive.contentPadding : 20, marginBottom: 14, marginTop: 8 }}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {selectedSportFilter ? (
                    <View style={{
                      width: 26, height: 32, borderRadius: 6, overflow: 'hidden',
                      borderWidth: 1, borderColor: 'rgba(139,10,31,0.35)',
                      backgroundColor: 'rgba(255,255,255,0.03)',
                    }}>
                      <View style={{ height: 2, backgroundColor: getTicketColor(selectedSportFilter) }} />
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFFFFF' }}>{gameCounts?.[selectedSportFilter] ?? 0}</Text>
                      </View>
                      <View style={{ marginHorizontal: 2, height: 0, borderBottomWidth: 1, borderStyle: 'dashed', borderBottomColor: 'rgba(255,255,255,0.1)' }} />
                      <View style={{ height: 4, backgroundColor: '#040608', flexDirection: 'row' }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <View key={i} style={{ width: 0, height: 0, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderTopWidth: 3, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#040608', marginTop: -3 }} />
                        ))}
                      </View>
                    </View>
                  ) : null}
                  <Text style={{ color: '#FFFFFF', fontSize: responsive.isTablet ? responsive.headerSize : headerFontSize, fontWeight: '800', letterSpacing: 0.5 }}>
                    {selectedSportFilter ? (selectedSportFilter === 'NCAAF' ? 'CFB' : selectedSportFilter === 'NCAAB' ? 'CBB' : selectedSportFilter) : "Today"}
                  </Text>
                </View>
              </View>
              <View style={{ width: 40, height: 2.5, borderRadius: 1.5, backgroundColor: selectedSportFilter ? getTicketColor(selectedSportFilter) : 'rgba(255,255,255,0.3)', marginTop: 6 }} />
            </View>
          </Animated.View>
        </>
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
      const parts: string[] = [];
      if (game.quarter) parts.push(game.quarter);
      if (game.clock) parts.push(game.clock);
      return parts.length > 0 ? parts.join(' ') : 'LIVE';
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
              {game.sport}
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
    () => (todaysGames ?? []).filter((g: any) => g.status === 'in_progress' || g.status === 'halftime'),
    [todaysGames]
  );

  // Gate pulse animations — only run when there are live games
  useEffect(() => {
    const hasLive = liveGamesPreview.length > 0;

    if (hasLive && !animationsActiveRef.current) {
      animationsActiveRef.current = true;
      // First ring - expands outward
      pulseScale1.value = withRepeat(
        withTiming(1.8, { duration: 1500, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
      pulseOpacity1.value = withRepeat(
        withTiming(0, { duration: 1500, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );

      // Second ring - delayed, creates ripple effect
      const timeoutId = setTimeout(() => {
        pulseScale2.value = withRepeat(
          withTiming(1.8, { duration: 1500, easing: Easing.out(Easing.ease) }),
          -1,
          false
        );
        pulseOpacity2.value = withRepeat(
          withTiming(0, { duration: 1500, easing: Easing.out(Easing.ease) }),
          -1,
          false
        );
      }, 750);

      return () => {
        clearTimeout(timeoutId);
      };
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
    if (!selectedLiveSportFilter) return liveGamesPreview;
    return liveGamesPreview.filter((game) => game.sport === selectedLiveSportFilter);
  }, [liveGamesPreview, selectedLiveSportFilter]);

  // Compute game counts by sport from the games data
  const gameCounts = useMemo(() => {
    const counts: Partial<Record<Sport, number>> = {};
    if (todaysGames) {
      todaysGames.forEach((game) => {
        const sport = game.sport as Sport;
        counts[sport] = (counts[sport] || 0) + 1;
      });
    }
    return counts;
  }, [todaysGames]);

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
    if (!nonLiveGames.length || isLoadingGames) return [];

    const filteredGames = selectedSportFilter
      ? nonLiveGames.filter((game) => game.sport === selectedSportFilter)
      : nonLiveGames;

    const allGames = filteredGames ?? [];

    const grouped = new Map<Sport, GameWithPrediction[]>();
    allGames.forEach((game) => {
      const sport = game.sport as Sport;
      if (!grouped.has(sport)) grouped.set(sport, []);
      grouped.get(sport)!.push(game);
    });

    grouped.forEach((games) => {
      games.sort((a, b) => {
        const statusOrder: Record<string, number> = { LIVE: 0, SCHEDULED: 1, FINAL: 2, POSTPONED: 3, CANCELLED: 4 };
        const aOrder = statusOrder[a.status] ?? 5;
        const bOrder = statusOrder[b.status] ?? 5;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime();
      });
    });

    const sportPriority: Sport[] = [
      Sport.NFL, Sport.NBA, Sport.MLB, Sport.NHL,
      Sport.MLS, Sport.EPL, Sport.NCAAF, Sport.NCAAB,
    ];

    const sortedEntries = Array.from(grouped.entries()).sort(
      ([a], [b]) => {
        const pa = sportPriority.indexOf(a);
        const pb = sportPriority.indexOf(b);
        return (pa === -1 ? sportPriority.length : pa) - (pb === -1 ? sportPriority.length : pb);
      }
    );

    const MAX_GAMES_PER_SPORT = 40;
    const items: FlatListItem[] = [];

    if (selectedSportFilter) {
      // Live games for this sport (show at top)
      const liveForSport = (liveGamesPreview ?? []).filter(g => g.sport === selectedSportFilter);

      // Get today's date string for filtering
      const today = new Date();
      const todayStr = today.toDateString();

      // Tomorrow's date for filtering
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toDateString();

      // Today's scheduled games (exclude tomorrow's games)
      const todayScheduled = (nonLiveGames ?? []).filter((g) => {
        if (g.sport !== selectedSportFilter) return false;
        if (g.status !== GameStatus.SCHEDULED) return false;
        const gameDate = new Date(g.gameTime).toDateString();
        return gameDate === todayStr; // Only include today's games
      }).sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());
      const tomorrowGames = (todaysGames ?? []).filter(g => {
        if (g.sport !== selectedSportFilter) return false;
        if (g.status !== GameStatus.SCHEDULED) return false;
        return new Date(g.gameTime).toDateString() === tomorrowStr;
      }).sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

      // Today's final results
      const todayFinals = (todaysGames ?? []).filter((g) =>
        g.sport === selectedSportFilter && g.status === GameStatus.FINAL
      ).sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime());

      // Add live games first
      if (liveForSport.length > 0) {
        items.push({ type: 'date-header', label: 'LIVE NOW', count: liveForSport.length, key: 'live-header' });
      }
      liveForSport.forEach((game, idx) => {
        items.push({ type: 'game', game, index: idx, key: `live-${game.id}` });
      });

      // Add today's scheduled games
      todayScheduled.forEach((game, idx) => {
        items.push({ type: 'game', game, index: liveForSport.length + idx, key: game.id });
      });

      // Tomorrow section
      if (tomorrowGames.length > 0) {
        items.push({ type: 'date-header', label: 'TOMORROW', count: tomorrowGames.length, key: 'tomorrow-header' });
        tomorrowGames.forEach((game, idx) => {
          items.push({ type: 'game', game, index: idx, key: `tomorrow-${game.id}` });
        });
      }

      // Finals section
      if (todayFinals.length > 0) {
        items.push({ type: 'date-header', label: 'FINAL RESULTS', count: todayFinals.length, key: 'finals-header' });
        todayFinals.forEach((game, idx) => {
          items.push({ type: 'game', game, index: idx, key: `final-${game.id}` });
        });
      }
    } else {
      sortedEntries.forEach(([sport, games]) => {
        const capped = games.slice(0, MAX_GAMES_PER_SPORT);
        items.push({ type: 'sport-header', sport, gameCount: capped.length, key: `header-${sport}` });
        capped.forEach((game, idx) => {
          items.push({ type: 'game', game, index: idx, key: game.id });
        });
      });
    }

    return items;
  }, [nonLiveGames, selectedSportFilter, isLoadingGames, liveGamesPreview, todaysGames]);


  // Render item for FlatList
  const renderGameListItem = useCallback(({ item }: { item: FlatListItem }) => {
    if (item.type === 'sport-header') {
      const headerColor = getTicketColor(item.sport);
      const isLight = headerColor === '#C2C4C8';
      const textColor = isLight ? '#1C2A3A' : '#FFFFFF';
      const textDimColor = isLight ? 'rgba(28,42,58,0.5)' : 'rgba(255,255,255,0.5)';
      const perfColor = isLight ? 'rgba(28,42,58,0.2)' : 'rgba(255,255,255,0.2)';
      return (
        <View style={numColumns > 1 ? { width: '100%', paddingHorizontal: responsive.contentPadding, marginTop: 24, marginBottom: 10 } : { paddingHorizontal: 20, marginTop: 24, marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
            {/* Full ticket stub — matches filter button exactly */}
            <View
              style={{
                width: 50,
                height: 62,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 46,
                  height: 58,
                  borderTopLeftRadius: 10,
                  borderTopRightRadius: 10,
                  borderBottomLeftRadius: 4,
                  borderBottomRightRadius: 4,
                  overflow: 'hidden',
                  position: 'relative',
                  backgroundColor: headerColor,
                }}
              >
                {/* Zigzag torn edge */}
                <View
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 6,
                    backgroundColor: '#040608',
                  }}
                >
                  <View style={{ flexDirection: 'row', position: 'absolute', top: -3, left: 0, right: 0 }}>
                    {Array.from({ length: 11 }).map((_, i) => (
                      <View
                        key={i}
                        style={{
                          width: 0,
                          height: 0,
                          borderLeftWidth: 3,
                          borderRightWidth: 3,
                          borderTopWidth: 5,
                          borderLeftColor: 'transparent',
                          borderRightColor: 'transparent',
                          borderTopColor: '#040608',
                        }}
                      />
                    ))}
                  </View>
                </View>

                {/* Perforation line */}
                <View
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    left: 4,
                    right: 4,
                    height: 0,
                    borderBottomWidth: 1,
                    borderStyle: 'dashed',
                    borderBottomColor: perfColor,
                  }}
                />

                {/* Stripe texture */}
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.06 }}>
                  {Array.from({ length: 11 }).map((_, i) => (
                    <View
                      key={i}
                      style={{
                        position: 'absolute',
                        left: i * 6,
                        top: 0,
                        bottom: 0,
                        width: 0.5,
                        backgroundColor: isLight ? '#000' : '#FFF',
                      }}
                    />
                  ))}
                </View>

                {/* Sport name */}
                <View style={{ alignItems: 'center', paddingTop: 6 }}>
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '900',
                      letterSpacing: 0.5,
                      color: textColor,
                    }}
                  >
                    {item.sport}
                  </Text>
                </View>

                {/* Game count */}
                <View style={{ alignItems: 'center', marginTop: 1 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '900',
                      color: textColor,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {item.gameCount}
                  </Text>
                </View>
              </View>
            </View>

            {/* Sport label + faded divider bar */}
            <View style={{ flex: 1, paddingBottom: 8 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: 0.2, marginBottom: 8 }}>
                {SPORT_META[item.sport].name}
              </Text>
              {/* Faded bar */}
              <View
                style={{
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: headerColor,
                  opacity: 0.25,
                }}
              />
            </View>
          </View>
        </View>
      );
    }

    if (item.type === 'date-header') {
      const isLive = item.label === 'LIVE NOW';
      const accentColor =
        isLive ? '#DC2626' :
        item.label === 'TODAY' ? '#F5A896' :
        item.label === 'TOMORROW' ? '#60A5FA' :
        item.label === 'FINAL RESULTS' ? '#4ADE80' :
        '#FFFFFF';
      return (
        <View style={numColumns > 1 ? { width: '100%', paddingHorizontal: responsive.contentPadding, marginTop: 24, marginBottom: 14 } : { paddingHorizontal: 20, marginTop: 24, marginBottom: 14 }}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {isLive ? (
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#DC2626' }} />
                ) : (
                  <View style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: accentColor }} />
                )}
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 }}>
                  {isLive ? 'Live Now' : item.label}
                </Text>
              </View>
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>{item.count}</Text>
            </View>
            <View style={{ width: 56, height: 3, borderRadius: 1.5, backgroundColor: accentColor, marginTop: 8, shadowColor: accentColor, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }} />
          </View>
        </View>
      );
    }

    if (item.type === 'game') {
      return (
        <View style={numColumns > 1 ? { flex: 1, maxWidth: '50%' } : { paddingHorizontal: 20, marginBottom: 6 }}>
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
        maxToRenderPerBatch={10}
        windowSize={11}
        initialNumToRender={6}
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
          />
        }
        ListEmptyComponent={
          !isLoadingGames && nonLiveGames.length === 0 && liveGamesPreview.length === 0 ? (
            <Animated.View entering={FadeInRight.delay(300).duration(500)} className="px-5">
              <Text className="text-zinc-200 text-xs font-semibold uppercase tracking-wider mb-3">
                Today's Games
              </Text>
              <View className="bg-zinc-800 rounded-2xl p-8 items-center">
                <Text className="text-zinc-400 text-center">
                  No games scheduled for today
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
            maxToRenderPerBatch={10}
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
                    No games found
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
                    Try a different search term
                  </Text>
                </View>
              )
            }
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}
