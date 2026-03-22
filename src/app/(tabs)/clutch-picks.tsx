import { View, Text, RefreshControl, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import React, { useState, useCallback, memo, useMemo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { useResponsive } from '@/hooks/useResponsive';
import Svg, { Circle, Ellipse, Path, Line } from 'react-native-svg';

// Field goal post U symbol - memoized
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
import { TeamJerseyCompact } from '@/components/sports';
import { SPORT_META, GameWithPrediction } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { useTopPicks } from '@/hooks/useGames';
import GridBackground from '@/components/GridBackground';
import { useSubscription } from '@/lib/subscription-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Mini sport icons for Top Pick card - memoized for performance
const MiniFootball = memo(function MiniFootball({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Ellipse cx="12" cy="12" rx="8" ry="5" stroke={color} strokeWidth="2" fill="none" />
      <Line x1="12" y1="7.5" x2="12" y2="16.5" stroke={color} strokeWidth="1.5" />
    </Svg>
  );
});

const MiniBasketball = memo(function MiniBasketball({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8" stroke={color} strokeWidth="2" fill="none" />
      <Line x1="12" y1="4" x2="12" y2="20" stroke={color} strokeWidth="1.5" />
      <Line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth="1.5" />
    </Svg>
  );
});

const MiniBaseball = memo(function MiniBaseball({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8" stroke={color} strokeWidth="2" fill="none" />
      <Path d="M6 7C8.5 10 8.5 14 6 17" stroke={color} strokeWidth="1.5" fill="none" />
      <Path d="M18 7C15.5 10 15.5 14 18 17" stroke={color} strokeWidth="1.5" fill="none" />
    </Svg>
  );
});

const MiniHockey = memo(function MiniHockey({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path d="M6 5L6 15L10 15" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx="16" cy="15" r="4" stroke={color} strokeWidth="2" fill="none" />
    </Svg>
  );
});

const MiniSoccer = memo(function MiniSoccer({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8" stroke={color} strokeWidth="2" fill="none" />
      <Path d="M12 8L9 10L10 14L14 14L15 10Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </Svg>
  );
});

// Helper to ensure two colors are visually distinct
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};

const getDistinctColors = (color1: string, color2: string): { away: string; home: string } => {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  const diff = Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  );

  if (diff < 80) {
    const brightness = (rgb2.r * 299 + rgb2.g * 587 + rgb2.b * 114) / 1000;
    return {
      away: color1,
      home: brightness > 128 ? '#3B82F6' : '#F59E0B'
    };
  }

  return { away: color1, home: color2 };
};

// Premium accent color
const ACCENT_ORANGE = '#E8936A';
const PREMIUM_BLUE = '#7A9DB8';

// Top Pick Card Component - Premium styling matching Game Detail prediction cards
const TopPickCard = memo(function TopPickCard({
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
  const chartColors = getDistinctColors(awayColors.primary, homeColors.primary);
  const conf = game.prediction?.confidence ?? 70;
  const awayPct = game.prediction?.predictedWinner === 'away'
    ? Math.min(78, Math.max(52, Math.round(50 + (conf - 60) * 0.8)))
    : Math.min(48, Math.max(22, Math.round(50 - (conf - 60) * 0.8)));
  const homePct = 100 - awayPct;

  const predictedWinnerTeam = game.prediction?.predictedWinner === 'home'
    ? game.homeTeam
    : game.awayTeam;

  return (
    <Animated.View entering={FadeInDown.delay(index * 100).duration(400)}>
      <Pressable
        onPress={onPress}
        className="active:opacity-90"
        style={{ marginBottom: 20 }}
      >
        {/* Premium card with orange glow shadow - matching game detail */}
        <View
          style={{
            borderRadius: 20,
            overflow: 'hidden',
            shadowColor: ACCENT_ORANGE,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.25,
            shadowRadius: 20,
            elevation: 14,
          }}
        >
          {/* Gradient border - matching game detail prediction card */}
          <LinearGradient
            colors={[
              `${ACCENT_ORANGE}60`,
              `${ACCENT_ORANGE}30`,
              `${PREMIUM_BLUE}20`,
              'rgba(0,0,0,0.3)',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 20,
              padding: 1.5,
            }}
          >
            <View style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: '#0F141E' }}>
                {/* Background gradient - matching game detail */}
                <LinearGradient
                  colors={[`${ACCENT_ORANGE}18`, `${PREMIUM_BLUE}10`, '#0F141E']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                  }}
                />
                {/* Glass shine effect */}
                <LinearGradient
                  colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.04)', 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 80,
                  }}
                />

                {/* Content */}
                <View style={{ padding: 18 }}>
                  {/* Header with badges - matching game detail layout */}
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center">
                      {/* Clutch Pick badge */}
                      <View
                        style={{
                          backgroundColor: `${ACCENT_ORANGE}25`,
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 8,
                          marginRight: 8,
                        }}
                      >
                        <Text style={{ color: ACCENT_ORANGE, fontSize: 11, fontWeight: '700' }}>
                          CLUTCH PICK
                        </Text>
                      </View>
                      {/* Sport badge */}
                      <View
                        style={{
                          backgroundColor: SPORT_META[game.sport].color,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 6,
                        }}
                      >
                        <Text
                          style={{ color: SPORT_META[game.sport].accentColor, fontSize: 10, fontWeight: '700' }}
                        >
                          {game.sport}
                        </Text>
                      </View>
                    </View>

                    {/* #1 Pick badge */}
                    <View
                      style={{
                        backgroundColor: ACCENT_ORANGE,
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 8,
                      }}
                    >
                      <Text style={{ color: '#000', fontSize: 11, fontWeight: '800' }}>#1 {game.sport} PICK</Text>
                    </View>
                  </View>

                  {/* Our Pick section - matching game detail */}
                  <View className="flex-row items-center mb-4">
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Our Pick:</Text>
                    <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginLeft: 8 }}>
                      {predictedWinnerTeam.name}
                    </Text>
                  </View>

                  {/* Confidence bar - premium style */}
                  <View
                    style={{
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 14,
                    }}
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 }}>
                        CONFIDENCE
                      </Text>
                      <Text
                        style={{
                          color: conf >= 80 ? ACCENT_ORANGE : PREMIUM_BLUE,
                          fontSize: 20,
                          fontWeight: '800',
                        }}
                      >
                        {conf}%
                      </Text>
                    </View>
                    {/* Progress bar */}
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <LinearGradient
                        colors={conf >= 80 ? [ACCENT_ORANGE, '#D4806A'] : [PREMIUM_BLUE, '#5A7A8A']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={{
                          height: '100%',
                          width: `${conf}%`,
                          borderRadius: 3,
                        }}
                      />
                    </View>
                  </View>

                  {/* Teams matchup - Clean layout with jersey icons */}
                  <View className="flex-row items-center justify-between mb-4">
                    {/* Away Team */}
                    <View className="flex-row items-center flex-1">
                      <View className="mr-3">
                        <TeamJerseyCompact
                          teamAbbreviation={game.awayTeam.abbreviation}
                          primaryColor={awayColors.primary}
                          secondaryColor={awayColors.secondary}
                          size={40}
                          isHighlighted={game.prediction?.predictedWinner === 'away'}
                          sport={game.sport}
                        />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="font-semibold text-base"
                          style={{
                            color: game.prediction?.predictedWinner === 'away' ? ACCENT_ORANGE : '#FFFFFF'
                          }}
                          numberOfLines={1}
                        >
                          {game.awayTeam.name}
                        </Text>
                        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{game.awayTeam.record}</Text>
                      </View>
                    </View>

                    {/* VS */}
                    <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginHorizontal: 8 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700' }}>VS</Text>
                    </View>

                    {/* Home Team */}
                    <View className="flex-row items-center flex-1 justify-end">
                      <View className="items-end mr-3 flex-1">
                        <Text
                          className="font-semibold text-base"
                          style={{
                            color: game.prediction?.predictedWinner === 'home' ? ACCENT_ORANGE : '#FFFFFF'
                          }}
                          numberOfLines={1}
                        >
                          {game.homeTeam.name}
                        </Text>
                        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{game.homeTeam.record}</Text>
                      </View>
                      <TeamJerseyCompact
                        teamAbbreviation={game.homeTeam.abbreviation}
                        primaryColor={homeColors.primary}
                        secondaryColor={homeColors.secondary}
                        size={40}
                        isHighlighted={game.prediction?.predictedWinner === 'home'}
                        sport={game.sport}
                      />
                    </View>
                  </View>

                  {/* Analysis section with separator - matching game detail */}
                  <View
                    style={{
                      paddingTop: 14,
                      borderTopWidth: 1,
                      borderTopColor: `${ACCENT_ORANGE}20`,
                    }}
                  >
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600', marginBottom: 6, letterSpacing: 0.5 }}>
                      WHY THIS PICK
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 20 }} numberOfLines={3}>
                      {game.prediction?.analysis}
                    </Text>
                  </View>

                  {/* Win Probability bar - matching game detail */}
                  <View
                    style={{
                      marginTop: 14,
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5 }}>
                      WIN PROBABILITY
                    </Text>
                    {/* Probability bar */}
                    <View style={{ position: 'relative' }}>
                      <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' }}>
                        {/* Away team portion */}
                        <LinearGradient
                          colors={[chartColors.away, `${chartColors.away}CC`]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={{
                            width: `${awayPct}%`,
                            borderTopLeftRadius: 4,
                            borderBottomLeftRadius: 4,
                          }}
                        />
                        {/* Separator */}
                        <View style={{ width: 2, backgroundColor: 'rgba(0,0,0,0.9)' }} />
                        {/* Home team portion */}
                        <LinearGradient
                          colors={[`${chartColors.home}CC`, chartColors.home]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={{
                            flex: 1,
                            borderTopRightRadius: 4,
                            borderBottomRightRadius: 4,
                          }}
                        />
                      </View>
                    </View>

                    {/* Team labels with percentages */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            backgroundColor: chartColors.away,
                            marginRight: 6,
                          }}
                        />
                        <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>
                          {game.awayTeam.abbreviation}
                        </Text>
                        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600', marginLeft: 4 }}>
                          {awayPct}%
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600', marginRight: 4 }}>
                          {homePct}%
                        </Text>
                        <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>
                          {game.homeTeam.abbreviation}
                        </Text>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            backgroundColor: chartColors.home,
                            marginLeft: 6,
                          }}
                        />
                      </View>
                    </View>
                  </View>
                </View>
            </View>
          </LinearGradient>
        </View>
      </Pressable>
    </Animated.View>
  );
});

export default function ClutchPicksScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const scrollHandler = useHideOnScroll();
  const responsive = useResponsive();
  const { isPremium } = useSubscription();

  // Get top picks with guaranteed predictions from dedicated endpoint
  const { data: topPicks, isLoading: isLoadingPicks, refetch: refetchPicks } = useTopPicks();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchPicks();
    setRefreshing(false);
  }, [refetchPicks]);

  const handleGamePress = useCallback((gameId: string) => {
    router.push(`/game/${gameId}` as any);
  }, [router]);

  return (
    <View className="flex-1" style={{ backgroundColor: '#040608' }}>
      <SafeAreaView className="flex-1" edges={['top']}>
        <ErrorBoundary onGoBack={() => router.back()}>
        <GridBackground />
        {/* Header with premium U icon */}
        <Animated.View
          entering={FadeInDown.duration(400)}
          className="px-5 pt-4 pb-4"
        >
          <View className="flex-row items-center">
            {/* Premium Statement U Icon with glow */}
            <View
              style={{
                marginRight: 14,
                position: 'relative',
              }}
            >
              {/* Outer glow effect */}
              <View
                style={{
                  position: 'absolute',
                  top: -6,
                  left: -6,
                  right: -6,
                  bottom: -6,
                  borderRadius: 20,
                  backgroundColor: ACCENT_ORANGE,
                  opacity: 0.25,
                }}
              />
              {/* Secondary glow */}
              <View
                style={{
                  position: 'absolute',
                  top: -3,
                  left: -3,
                  right: -3,
                  bottom: -3,
                  borderRadius: 17,
                  backgroundColor: ACCENT_ORANGE,
                  opacity: 0.35,
                }}
              />
              {/* Main icon container with gradient border */}
              <LinearGradient
                colors={[ACCENT_ORANGE, `${ACCENT_ORANGE}80`, PREMIUM_BLUE]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  padding: 2,
                  shadowColor: ACCENT_ORANGE,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.5,
                  shadowRadius: 12,
                  elevation: 10,
                }}
              >
                <View
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    backgroundColor: '#0D0D0D',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FieldGoalU size={30} color={ACCENT_ORANGE} />
                </View>
              </LinearGradient>
            </View>
            <View>
              <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>Clutch Picks</Text>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Best pick per sport today</Text>
            </View>
          </View>
        </Animated.View>

        {/* Content */}
        {isLoadingPicks ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#5A7A8A" />
            <Text className="text-zinc-400 mt-4">Loading picks...</Text>
          </View>
        ) : !isPremium ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 60 }}>
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(232,147,106,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderWidth: 2, borderColor: 'rgba(232,147,106,0.2)' }}>
              <Text style={{ fontSize: 32 }}>🔒</Text>
            </View>
            <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}>Unlock Clutch Picks</Text>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 24 }}>
              Get AI-powered picks, confidence ratings, and full analysis for every game.
            </Text>
            <Pressable onPress={() => router.push('/paywall')} style={{ width: '100%', height: 54, borderRadius: 14, backgroundColor: '#E8936A', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>Subscribe to Unlock</Text>
            </Pressable>
          </View>
        ) : topPicks && topPicks.length > 0 ? (
          <Animated.FlatList
            key={responsive.numColumns}
            data={topPicks}
            keyExtractor={(item) => item.id}
            numColumns={responsive.numColumns}
            columnWrapperStyle={responsive.numColumns === 2 ? { gap: 16, paddingHorizontal: responsive.contentPadding } : undefined}
            renderItem={({ item, index }) => (
              <View style={responsive.numColumns === 2 ? { flex: 1 } : undefined}>
                <TopPickCard
                  game={item}
                  index={index}
                  onPress={() => handleGamePress(item.id)}
                />
              </View>
            )}
            contentContainerStyle={[{ padding: 20, paddingBottom: 120 }, responsive.isTablet && { maxWidth: 700, alignSelf: 'center', width: '100%' }]}
            showsVerticalScrollIndicator={false}
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#5A7A8A"
              />
            }
            removeClippedSubviews={true}
            maxToRenderPerBatch={3}
            windowSize={5}
            initialNumToRender={3}
            getItemLayout={(_, index) => ({
              length: 420,
              offset: 420 * index,
              index,
            })}
            ListFooterComponent={
              <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
                  AI predictions are for entertainment purposes only. Not financial advice.
                </Text>
              </View>
            }
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            {/* Premium empty state icon */}
            <View style={{ position: 'relative', marginBottom: 20 }}>
              {/* Outer glow */}
              <View
                style={{
                  position: 'absolute',
                  top: -8,
                  left: -8,
                  right: -8,
                  bottom: -8,
                  borderRadius: 48,
                  backgroundColor: ACCENT_ORANGE,
                  opacity: 0.15,
                }}
              />
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: 'rgba(232, 147, 106, 0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: `${ACCENT_ORANGE}30`,
                }}
              >
                <FieldGoalU size={44} color={`${ACCENT_ORANGE}60`} />
              </View>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>No Picks Available</Text>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center', paddingHorizontal: 32 }}>
              Check back later for today's top picks across all sports
            </Text>
            <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, position: 'absolute', bottom: 100 }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
                AI predictions are for entertainment purposes only. Not financial advice.
              </Text>
            </View>
          </View>
        )}
        </ErrorBoundary>
      </SafeAreaView>
    </View>
  );
}
