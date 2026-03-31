import { View, Text, RefreshControl, Pressable, ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolate, cancelAnimation } from 'react-native-reanimated';
import React, { useState, useCallback, memo, useMemo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { useResponsive } from '@/hooks/useResponsive';
import Svg, { Path, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { Clock } from 'lucide-react-native';
import { TeamJerseyCompact } from '@/components/sports';
import { GameWithPrediction } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { useTopPicks } from '@/hooks/useGames';
import GridBackground from '@/components/GridBackground';
import { useSubscription } from '@/lib/subscription-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Expandable analysis text — tap to show full, tap again to collapse
const ExpandableText = memo(function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable onPress={() => setExpanded(!expanded)}>
      <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 20 }} numberOfLines={expanded ? undefined : 3}>
        {text}
      </Text>
      {!expanded && text.length > 120 ? (
        <Text style={{ fontSize: 11, fontWeight: '600', color: '#7A9DB8', marginTop: 4 }}>Read more</Text>
      ) : expanded ? (
        <Text style={{ fontSize: 11, fontWeight: '600', color: '#7A9DB8', marginTop: 4 }}>Show less</Text>
      ) : null}
    </Pressable>
  );
});

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
const ACCENT_ORANGE = '#8B0A1F';
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

  // Rotating shimmer border — traces around the card
  const rotation = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  React.useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 4500, easing: Easing.linear }), -1, false);
    glowPulse.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => { cancelAnimation(rotation); cancelAnimation(glowPulse); };
  }, []);
  const rotatingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value % 360}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(glowPulse.value, [0, 1], [0.25, 0.5]),
    shadowRadius: interpolate(glowPulse.value, [0, 1], [10, 22]),
  }));

  return (
    <Animated.View entering={FadeInDown.delay(index * 100).duration(400)} style={{ paddingBottom: 44 }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] })}
      >
        {/* Outer glow — breathing silver pulse */}
        <Animated.View style={[glowStyle, {
          borderRadius: 24,
          shadowColor: '#C0C8D0',
          shadowOffset: { width: 0, height: 0 },
        }]}>
        {/* Depth shadow */}
        <View style={{
          borderRadius: 24,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.6,
          shadowRadius: 20,
          elevation: 20,
        }}>
          {/* Border wrapper — rotating shimmer */}
          <View style={{ borderRadius: 24, overflow: 'hidden', position: 'relative' }}>
            {/* Static silver gradient base */}
            <LinearGradient
              colors={['#C0C8D0', '#8A929A', '#D4D8DC', '#8A929A', '#C0C8D0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            {/* Rotating beam — teal + maroon same as before */}
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
              <Animated.View style={[rotatingStyle, { width: 800, height: 800, position: 'absolute' }]}>
                <LinearGradient
                  colors={['transparent', 'transparent', '#7A9DB8', 'rgba(255,255,255,0.5)', '#7A9DB8', 'transparent', 'transparent']}
                  start={{ x: 0.3, y: 0 }}
                  end={{ x: 0.7, y: 0 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400 }}
                />
                <LinearGradient
                  colors={['transparent', 'transparent', '#5A0614', '#8B0A1F', '#5A0614', 'transparent', 'transparent']}
                  start={{ x: 0.3, y: 0 }}
                  end={{ x: 0.7, y: 0 }}
                  style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 400 }}
                />
              </Animated.View>
            </View>

            {/* Card body — inset to reveal rotating border */}
            <View style={{ margin: 3.5, borderRadius: 20.5, overflow: 'hidden', backgroundColor: '#182028' }}>
              {/* Coral radial glow — top right */}
              <View style={{ position: 'absolute', top: 0, right: 0, width: '100%', height: '100%' }} pointerEvents="none">
                <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
                  <Defs>
                    <RadialGradient id={`coral_${index}`} cx="85%" cy="15%" rx="50%" ry="50%">
                      <Stop offset="0%" stopColor="#8B0A1F" stopOpacity={0.5} />
                      <Stop offset="60%" stopColor="#8B0A1F" stopOpacity={0.1} />
                      <Stop offset="100%" stopColor="#8B0A1F" stopOpacity={0} />
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
                    <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '900' }}>#{index + 1}</Text>
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
                    <Text style={{ fontSize: 17, fontWeight: '800', color: '#FFF' }} numberOfLines={1}>
                      {game.awayTeam.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{game.awayTeam.record}</Text>
                  </View>
                  {isAwayPick ? (
                    <View style={{ backgroundColor: 'rgba(122,157,184,0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(122,157,184,0.3)' }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>AI PICK</Text>
                    </View>
                  ) : null}
                </View>

                {/* Divider with VS */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingLeft: 56 }}>
                  <LinearGradient colors={['transparent', 'rgba(255,255,255,0.35)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 1 }} />
                  <Text style={{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.45)', marginHorizontal: 8 }}>VS</Text>
                  <LinearGradient colors={['rgba(255,255,255,0.35)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 1 }} />
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
                    <Text style={{ fontSize: 17, fontWeight: '800', color: '#FFF' }} numberOfLines={1}>
                      {game.homeTeam.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{game.homeTeam.record}</Text>
                  </View>
                  {!isAwayPick ? (
                    <View style={{ backgroundColor: 'rgba(122,157,184,0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(122,157,184,0.3)' }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>AI PICK</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* ── Confidence + Win Probability ── */}
              <View style={{ marginHorizontal: 18, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 14, padding: 14, marginBottom: 14 }}>
                {/* Confidence row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>CONFIDENCE</Text>
                  <Text style={{ fontSize: 22, fontWeight: '900', color: '#FFFFFF' }}>{conf}%</Text>
                </View>
                {/* Confidence bar */}
                <View style={{ height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 14 }}>
                  <LinearGradient
                    colors={conf >= 80 ? ['#8B0A1F', '#5A0614'] : [PREMIUM_BLUE, '#5A7A8A']}
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
                <ExpandableText text={game.prediction?.analysis ?? ''} />

                {/* View details CTA */}
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(122,157,184,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(122,157,184,0.25)' }}>
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
        </Animated.View>
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
          <View style={{ position: 'absolute', top: -10, left: -10, right: -10, bottom: -10, borderRadius: 24, shadowColor: '#7A9DB8', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 14 }} />
          <View style={{ position: 'absolute', top: -5, left: -5, right: -5, bottom: -5, borderRadius: 19, backgroundColor: '#8B0A1F', opacity: 0.2 }} />
          <View style={{ position: 'absolute', top: -2, left: -2, right: -2, bottom: -2, borderRadius: 16, backgroundColor: '#7A9DB8', opacity: 0.12 }} />
          <LinearGradient
            colors={['#7A9DB8', '#8B0A1F', '#5A0614', '#7A9DB8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: 52, height: 52, borderRadius: 14, padding: 2, shadowColor: '#7A9DB8', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 10 }}
          >
            <View style={{ flex: 1, borderRadius: 12, backgroundColor: '#040608', alignItems: 'center', justifyContent: 'center' }}>
              <FieldGoalU size={30} color="#C0C8D0" />
            </View>
          </LinearGradient>
        </View>
        <View>
          <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>Clutch Picks</Text>
          <Text style={{ color: '#7A9DB8', fontSize: 13 }}>Best pick per sport today</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#010101' }}>
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
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            {headerComponent}

            {/* Ghost pick cards — look like real picks but blurred out */}
            {[1, 2, 3].map((rank) => (
              <View key={rank} style={{ marginBottom: 14, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: rank === 1 ? 'rgba(139,10,31,0.25)' : 'rgba(255,255,255,0.06)', opacity: rank === 1 ? 1 : rank === 2 ? 0.85 : 0.65 }}>
                <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFillObject} />
                <LinearGradient colors={rank === 1 ? ['rgba(139,10,31,0.12)', 'rgba(4,6,8,0.85)'] : ['rgba(255,255,255,0.04)', 'rgba(4,6,8,0.85)']} style={StyleSheet.absoluteFillObject} />
                <View style={{ padding: 16 }}>
                  {/* Header row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                    <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: rank === 1 ? 'rgba(139,10,31,0.20)' : 'rgba(122,157,184,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '900', color: rank === 1 ? '#8B0A1F' : 'rgba(122,157,184,0.5)' }}>#{rank}</Text>
                    </View>
                    <View style={{ marginLeft: 8, flex: 1 }}>
                      <View style={{ width: 80, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                    </View>
                    <View style={{ backgroundColor: 'rgba(139,10,31,0.12)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(139,10,31,0.18)' }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: '#8B0A1F', letterSpacing: 1.2 }}>PRO</Text>
                    </View>
                  </View>
                  {/* Fake matchup row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <View style={{ width: 40, height: 44, borderRadius: 10, backgroundColor: 'rgba(122,157,184,0.08)' }} />
                      <View>
                        <View style={{ width: 70, height: 13, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: 5 }} />
                        <View style={{ width: 45, height: 9, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.04)' }} />
                      </View>
                    </View>
                    <View style={{ alignItems: 'center', paddingHorizontal: 12 }}>
                      <Text style={{ fontSize: 10, fontWeight: '600', color: 'rgba(122,157,184,0.3)', letterSpacing: 1 }}>VS</Text>
                    </View>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flex: 1 }}>
                      <View style={{ width: 40, height: 44, borderRadius: 10, backgroundColor: 'rgba(139,10,31,0.08)' }} />
                      <View style={{ alignItems: 'flex-end' }}>
                        <View style={{ width: 70, height: 13, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: 5 }} />
                        <View style={{ width: 45, height: 9, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.04)' }} />
                      </View>
                    </View>
                  </View>
                  {/* Fake confidence bar */}
                  {rank <= 2 ? (
                    <View style={{ marginTop: 14 }}>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                        <View style={{ width: rank === 1 ? '72%' : '58%', height: '100%', borderRadius: 3, backgroundColor: rank === 1 ? 'rgba(139,10,31,0.25)' : 'rgba(122,157,184,0.15)' }} />
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>
            ))}

            {/* Lock overlay + CTA card */}
            <View style={{ borderRadius: 22, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(122,157,184,0.15)', marginTop: 8 }}>
              <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFillObject} />
              <LinearGradient colors={['rgba(122,157,184,0.08)', 'rgba(139,10,31,0.08)', 'rgba(4,6,8,0.9)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFillObject} />
              <View style={{ padding: 28, alignItems: 'center' }}>
                {/* Lock icon */}
                <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(122,157,184,0.10)', borderWidth: 1.5, borderColor: 'rgba(122,157,184,0.20)', alignItems: 'center', justifyContent: 'center', marginBottom: 20, shadowColor: '#7A9DB8', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 16 }}>
                  <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                    <Path d="M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z" fill="rgba(122,157,184,0.3)" stroke="#7A9DB8" strokeWidth="1.5" />
                    <Path d="M7 11V7a5 5 0 0110 0v4" stroke="#7A9DB8" strokeWidth="1.5" strokeLinecap="round" />
                    <Path d="M12 16v2" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
                  </Svg>
                </View>

                <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', marginBottom: 8, letterSpacing: -0.3 }}>Unlock Clutch Picks</Text>
                <Text style={{ fontSize: 13, color: '#7A9DB8', textAlign: 'center', lineHeight: 20, marginBottom: 24, opacity: 0.8 }}>AI-powered picks ranked by confidence, updated daily across every sport.</Text>

                {/* Feature bullets */}
                <View style={{ width: '100%', gap: 12, marginBottom: 28 }}>
                  {[
                    { text: 'Confidence-ranked picks for every sport' },
                    { text: 'Edge analysis & full breakdowns' },
                    { text: 'Updated daily before games start' },
                  ].map((item, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(122,157,184,0.06)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(122,157,184,0.12)' }}>
                      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(122,157,184,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                          <Path d="M20 6L9 17l-5-5" stroke="#7A9DB8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)', flex: 1 }}>{item.text}</Text>
                    </View>
                  ))}
                </View>

                {/* CTA button */}
                <Pressable onPress={() => router.push('/paywall')} style={{ width: '100%' }}>
                  <LinearGradient colors={['#8B0A1F', '#5A0614']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: '#8B0A1F', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 }}>Start Free Trial</Text>
                  </LinearGradient>
                </Pressable>

                <Text style={{ fontSize: 11, color: 'rgba(122,157,184,0.5)', marginTop: 12, textAlign: 'center' }}>Cancel anytime · No commitment</Text>
              </View>
            </View>
          </ScrollView>
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
            initialNumToRender={2}
            ListFooterComponent={
              <View style={{ paddingTop: 16, paddingBottom: 20 }}>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
                  All predictions are AI-generated for entertainment purposes only. Not gambling advice.
                </Text>
              </View>
            }
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {headerComponent}
            <View style={{ position: 'relative', marginBottom: 20 }}>
              <View style={{ position: 'absolute', top: -8, left: -8, right: -8, bottom: -8, borderRadius: 48, backgroundColor: ACCENT_ORANGE, opacity: 0.15 }} />
              <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(139,10,31,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: `${ACCENT_ORANGE}30` }}>
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
