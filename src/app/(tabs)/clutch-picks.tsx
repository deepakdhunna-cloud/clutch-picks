import { View, Text, RefreshControl, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolate } from 'react-native-reanimated';
import React, { useState, useCallback, memo, useMemo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { useResponsive } from '@/hooks/useResponsive';
import Svg, { Path, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { Clock } from 'lucide-react-native';

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
import { GameWithPrediction } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { useTopPicks } from '@/hooks/useGames';
import GridBackground from '@/components/GridBackground';
import { useSubscription } from '@/lib/subscription-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';

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

// Format game time for display
function formatGameTime(dateString: string): { date: string; time: string } {
  const date = new Date(dateString);
  const now = new Date();
  const gameYear = date.getFullYear();
  const gameMonth = date.getMonth();
  const gameDay = date.getDate();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDay = now.getDate();
  const isToday = gameYear === todayYear && gameMonth === todayMonth && gameDay === todayDay;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = gameYear === tomorrow.getFullYear() && gameMonth === tomorrow.getMonth() && gameDay === tomorrow.getDate();
  let dateStr: string;
  if (isToday) {
    dateStr = 'Today';
  } else if (isTomorrow) {
    dateStr = 'Tomorrow';
  } else {
    dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return { date: dateStr, time: timeStr };
}

// Premium accent color
const ACCENT_ORANGE = '#E8936A';
const PREMIUM_BLUE = '#7A9DB8';

// Top Pick Card Component — Premium luxury redesign
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

  const isAwayPick = game.prediction?.predictedWinner === 'away';

  // Border shimmer — smooth glide on UI thread
  const shimmer = useSharedValue(0);
  React.useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 4500, easing: Easing.bezier(0.25, 0.1, 0.25, 1) }),
      -1, false
    );
  }, []);
  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 0.1, 0.5, 0.9, 1], [0, 0.6, 1, 0.6, 0]),
    transform: [
      { translateX: interpolate(shimmer.value, [0, 1], [-160, 520]) },
      { rotate: '20deg' },
    ],
  }));

  return (
    <Animated.View entering={FadeInDown.delay(index * 100).duration(400)} style={{ paddingBottom: 44 }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] })}
      >
        {/* Outer glow — teal ambient light around the card */}
        <View style={{
          borderRadius: 24,
          shadowColor: PREMIUM_BLUE,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 30,
          elevation: 16,
        }}>
        {/* Depth shadow */}
        <View style={{
          borderRadius: 24,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.6,
          shadowRadius: 20,
          elevation: 20,
        }}>
          {/* Border wrapper — teal & chrome, 3px */}
          <View style={{ borderRadius: 24, padding: 3 }}>
            {/* Border gradient — sits behind, visible around card edges */}
            <LinearGradient
              colors={[
                PREMIUM_BLUE,
                '#C0C8D0',
                PREMIUM_BLUE,
                '#D4D8DC',
                PREMIUM_BLUE,
              ]}
              locations={[0, 0.25, 0.5, 0.75, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24 }}
            />
            {/* Border shimmer — wide soft gradient beam */}
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24, overflow: 'hidden' }} pointerEvents="none">
              <Animated.View
                style={[{
                  position: 'absolute', top: -100, width: 80, height: 900,
                }, shimmerStyle]}
              >
                <LinearGradient
                  colors={[
                    'transparent',
                    'rgba(255,255,255,0.05)',
                    'rgba(200,220,240,0.25)',
                    'rgba(255,255,255,0.5)',
                    'rgba(200,220,240,0.25)',
                    'rgba(255,255,255,0.05)',
                    'transparent',
                  ]}
                  locations={[0, 0.15, 0.3, 0.5, 0.7, 0.85, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ flex: 1 }}
                />
              </Animated.View>
            </View>

            {/* Card body — sits on top, clips the shimmer from bleeding in */}
            <View style={{ borderRadius: 21, overflow: 'hidden', backgroundColor: '#0c1218' }}>
              {/* Coral radial glow — top right */}
              <View style={{ position: 'absolute', top: 0, right: 0, width: '100%', height: '100%' }} pointerEvents="none">
                <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
                  <Defs>
                    <RadialGradient id={`coral_${index}`} cx="85%" cy="15%" rx="50%" ry="50%">
                      <Stop offset="0%" stopColor="#E8936A" stopOpacity={0.5} />
                      <Stop offset="60%" stopColor="#E8936A" stopOpacity={0.1} />
                      <Stop offset="100%" stopColor="#E8936A" stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Rect x="0" y="0" width="100%" height="100%" fill={`url(#coral_${index})`} />
                </Svg>
              </View>
              {/* Steel blue radial glow — bottom left */}
              <View style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} pointerEvents="none">
                <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
                  <Defs>
                    <RadialGradient id={`blue_${index}`} cx="15%" cy="85%" rx="60%" ry="60%">
                      <Stop offset="0%" stopColor="#4E606F" stopOpacity={1} />
                      <Stop offset="50%" stopColor="#4E606F" stopOpacity={0.3} />
                      <Stop offset="100%" stopColor="#4E606F" stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Rect x="0" y="0" width="100%" height="100%" fill={`url(#blue_${index})`} />
                </Svg>
              </View>

              {/* ── Top bar: rank + sport + time ── */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {/* Rank badge */}
                  <View style={{ backgroundColor: ACCENT_ORANGE, width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#000', fontSize: 12, fontWeight: '900' }}>#{index + 1}</Text>
                  </View>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.5 }}>CLUTCH PICK</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ backgroundColor: `${PREMIUM_BLUE}18`, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: `${PREMIUM_BLUE}20` }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: PREMIUM_BLUE, letterSpacing: 0.5 }}>{game.sport}</Text>
                  </View>
                  {game.gameTime ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                      <Clock size={10} color="rgba(255,255,255,0.5)" />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)' }}>
                        {(() => { const { date, time } = formatGameTime(game.gameTime); return `${date} ${time}`; })()}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* ── Teams matchup — stacked, centered ── */}
              <View style={{ paddingHorizontal: 18, paddingBottom: 16 }}>
                {/* Away team */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <TeamJerseyCompact
                    teamAbbreviation={game.awayTeam.abbreviation}
                    primaryColor={awayColors.primary}
                    secondaryColor={awayColors.secondary}
                    size={44}
                    isHighlighted={isAwayPick}
                    sport={game.sport}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: isAwayPick ? ACCENT_ORANGE : '#FFF' }} numberOfLines={1}>
                      {game.awayTeam.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{game.awayTeam.record}</Text>
                  </View>
                  {isAwayPick ? (
                    <View style={{ backgroundColor: `${ACCENT_ORANGE}18`, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: `${ACCENT_ORANGE}25` }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: ACCENT_ORANGE, letterSpacing: 0.5 }}>AI PICK</Text>
                    </View>
                  ) : null}
                </View>

                {/* Divider with VS */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingLeft: 56 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                  <Text style={{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.15)', marginHorizontal: 10 }}>VS</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                </View>

                {/* Home team */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <TeamJerseyCompact
                    teamAbbreviation={game.homeTeam.abbreviation}
                    primaryColor={homeColors.primary}
                    secondaryColor={homeColors.secondary}
                    size={44}
                    isHighlighted={!isAwayPick}
                    sport={game.sport}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: !isAwayPick ? ACCENT_ORANGE : '#FFF' }} numberOfLines={1}>
                      {game.homeTeam.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{game.homeTeam.record}</Text>
                  </View>
                  {!isAwayPick ? (
                    <View style={{ backgroundColor: `${ACCENT_ORANGE}18`, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: `${ACCENT_ORANGE}25` }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: ACCENT_ORANGE, letterSpacing: 0.5 }}>AI PICK</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* ── Confidence + Win Probability ── */}
              <View style={{ marginHorizontal: 18, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 14, padding: 14, marginBottom: 14 }}>
                {/* Confidence row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>CONFIDENCE</Text>
                  <Text style={{ fontSize: 22, fontWeight: '900', color: conf >= 80 ? ACCENT_ORANGE : PREMIUM_BLUE }}>{conf}%</Text>
                </View>
                {/* Confidence bar */}
                <View style={{ height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 14 }}>
                  <LinearGradient
                    colors={conf >= 80 ? [ACCENT_ORANGE, '#D4806A'] : [PREMIUM_BLUE, '#5A7A8A']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ height: '100%', width: `${conf}%`, borderRadius: 2.5 }}
                  />
                </View>

                {/* Win probability */}
                <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5, marginBottom: 8 }}>WIN PROBABILITY</Text>
                <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <LinearGradient
                    colors={[chartColors.away, `${chartColors.away}CC`]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ width: `${awayPct}%`, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }}
                  />
                  <View style={{ width: 2, backgroundColor: 'rgba(0,0,0,0.9)' }} />
                  <LinearGradient
                    colors={[`${chartColors.home}CC`, chartColors.home]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flex: 1, borderTopRightRadius: 3, borderBottomRightRadius: 3 }}
                  />
                </View>
                {/* Labels */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: chartColors.away }} />
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>{game.awayTeam.abbreviation}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }}>{awayPct}%</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }}>{homePct}%</Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>{game.homeTeam.abbreviation}</Text>
                    <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: chartColors.home }} />
                  </View>
                </View>
              </View>

              {/* ── Analysis ── */}
              <View style={{ paddingHorizontal: 18, paddingBottom: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <View style={{ width: 3, height: 12, borderRadius: 1.5, backgroundColor: ACCENT_ORANGE }} />
                  <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>WHY THIS PICK</Text>
                </View>
                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 20 }} numberOfLines={3}>
                  {game.prediction?.analysis}
                </Text>

                {/* View details CTA */}
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: PREMIUM_BLUE }}>Full breakdown</Text>
                    <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
                      <Path d="M9 18l6-6-6-6" stroke={PREMIUM_BLUE} strokeWidth={2.5} strokeLinecap="round" />
                    </Svg>
                  </View>
                </View>
              </View>
            </View>
          </View>
          </View>
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

  // Filter out games with missing/TBD team names — these have no valid prediction
  const validPicks = useMemo(() => {
    if (!topPicks) return [];
    return topPicks.filter((g) => {
      const away = g.awayTeam?.name?.trim();
      const home = g.homeTeam?.name?.trim();
      if (!away || !home || away === 'TBD' || home === 'TBD' || away === '—' || home === '—') return false;
      if (!g.prediction) return false;
      return true;
    });
  }, [topPicks]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchPicks();
    setRefreshing(false);
  }, [refetchPicks]);

  const handleGamePress = useCallback((gameId: string) => {
    router.push(`/game/${gameId}` as any);
  }, [router]);

  const headerComponent = (
    <View style={{ paddingTop: 16, paddingBottom: 28 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* Logo icon */}
        <View style={{ marginRight: 14, position: 'relative' }}>
          <View style={{ position: 'absolute', top: -6, left: -6, right: -6, bottom: -6, borderRadius: 20, backgroundColor: ACCENT_ORANGE, opacity: 0.25 }} />
          <View style={{ position: 'absolute', top: -3, left: -3, right: -3, bottom: -3, borderRadius: 17, backgroundColor: ACCENT_ORANGE, opacity: 0.35 }} />
          <LinearGradient
            colors={[ACCENT_ORANGE, `${ACCENT_ORANGE}80`, PREMIUM_BLUE]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: 52, height: 52, borderRadius: 14, padding: 2, shadowColor: ACCENT_ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 10 }}
          >
            <View style={{ flex: 1, borderRadius: 12, backgroundColor: '#0D0D0D', alignItems: 'center', justifyContent: 'center' }}>
              <FieldGoalU size={30} color={ACCENT_ORANGE} />
            </View>
          </LinearGradient>
        </View>
        <View>
          <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>Clutch Picks</Text>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Best pick per sport today</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#040608' }}>
      <GridBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ErrorBoundary onGoBack={() => router.back()}>

        {/* Content */}
        {isLoadingPicks ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color="#5A7A8A" />
            <Text style={{ color: 'rgba(255,255,255,0.4)', marginTop: 14 }}>Loading picks...</Text>
          </View>
        ) : !isPremium ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 60 }}>
            {headerComponent}
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
        ) : validPicks.length > 0 ? (
          <Animated.FlatList
            key={responsive.numColumns}
            data={validPicks}
            keyExtractor={(item) => item.id}
            numColumns={responsive.numColumns}
            columnWrapperStyle={responsive.numColumns === 2 ? { gap: 16, paddingHorizontal: responsive.contentPadding } : undefined}
            ListHeaderComponent={headerComponent}
            renderItem={({ item, index }) => (
              <View style={responsive.numColumns === 2 ? { flex: 1 } : undefined}>
                <TopPickCard
                  game={item}
                  index={index}
                  onPress={() => handleGamePress(item.id)}
                />
              </View>
            )}
            contentContainerStyle={[{ paddingHorizontal: 20, paddingBottom: 120 }, responsive.isTablet && { maxWidth: 700, alignSelf: 'center', width: '100%' }]}
            showsVerticalScrollIndicator={false}
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#5A7A8A" />
            }
            removeClippedSubviews={true}
            maxToRenderPerBatch={3}
            windowSize={5}
            initialNumToRender={3}
            ListFooterComponent={
              <View style={{ paddingTop: 16, paddingBottom: 20 }}>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
                  AI predictions are for entertainment purposes only. Not financial advice.
                </Text>
              </View>
            }
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {headerComponent}
            <View style={{ position: 'relative', marginBottom: 20 }}>
              <View style={{ position: 'absolute', top: -8, left: -8, right: -8, bottom: -8, borderRadius: 48, backgroundColor: ACCENT_ORANGE, opacity: 0.15 }} />
              <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(232,147,106,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: `${ACCENT_ORANGE}30` }}>
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
