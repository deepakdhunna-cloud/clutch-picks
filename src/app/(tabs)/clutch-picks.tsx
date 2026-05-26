import { View, Text, RefreshControl, Pressable, ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolate, cancelAnimation } from 'react-native-reanimated';
import React, { useState, useCallback, memo, useMemo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { useResponsive } from '@/hooks/useResponsive';
import Svg, { Path, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { Clock } from 'lucide-react-native';
import { TeamJerseyCompact } from '@/components/sports';
import { GameWithPrediction } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { usePrefetchGame, useTopPicks } from '@/hooks/useGames';
import { useSmoothRefresh } from '@/hooks/useSmoothRefresh';
import ClutchPicksBackground from '@/components/ClutchPicksBackground';
import { useSubscription } from '@/lib/subscription-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { displayWinProbability, displaySport, getConfidenceTier } from '@/lib/display-confidence';
import { displayPredictionAnalysis } from '@/lib/narrative-display';
import {
  getCanonicalConfidence,
  getCanonicalWinProbabilities,
} from '@/lib/canonical-result';
import { getGamePredictionDisplay } from '@/lib/prediction-display';
import {
  GLASS_BOTTOM_NAV_FADE_HEIGHT,
  GLASS_BOTTOM_NAV_HEIGHT,
  GLASS_BOTTOM_NAV_MIN_BOTTOM_PADDING,
  GLASS_BOTTOM_NAV_SCROLL_PADDING,
} from '@/components/GlassBottomNav';
import { MAROON, TEAL } from '@/lib/theme';
import { claimGameNavigation } from '@/lib/game-navigation-guard';

function getClutchPicksBottomPadding(bottomInset: number) {
  return GLASS_BOTTOM_NAV_HEIGHT
    + GLASS_BOTTOM_NAV_FADE_HEIGHT
    + Math.max(bottomInset, GLASS_BOTTOM_NAV_MIN_BOTTOM_PADDING)
    + GLASS_BOTTOM_NAV_SCROLL_PADDING
    + 36;
}

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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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

// Premium accent color imported from theme

// Top Pick Card Component — Premium luxury redesign
const TopPickCard = memo(function TopPickCard({
  game,
  index,
  onPress,
  onPressIn,
  animationsEnabled,
}: {
  game: GameWithPrediction;
  index: number;
  onPress: () => void;
  onPressIn?: () => void;
  animationsEnabled: boolean;
}) {
  const router = useRouter();
  const awayColors = getTeamColors(game.awayTeam.abbreviation, game.sport);
  const homeColors = getTeamColors(game.homeTeam.abbreviation, game.sport);
  const chartColors = getDistinctColors(awayColors.primary, homeColors.primary);
  const conf = game.prediction ? getCanonicalConfidence(game.prediction) : 70;
  const predictionDisplay = getGamePredictionDisplay(game);
  const tier = getConfidenceTier(conf, predictionDisplay.isTossUp);
  // Use real model probabilities — same data as game detail and analysis pages
  const canonicalProbabilities = getCanonicalWinProbabilities(game.prediction);
  const realHome = canonicalProbabilities.home;
  const realAway = canonicalProbabilities.away;
  const dp = displayWinProbability(realHome, realAway, canonicalProbabilities.draw);
  const hasDraw = typeof dp.draw === 'number';
  const drawColor = '#C9BDA8';
  const awayPct = dp.away;
  const homePct = dp.home;
  const drawPct = dp.draw ?? 0;
  const confidenceParams = {
    id: game.id,
    confidence: String(Math.round(conf)),
    pickLabel: predictionDisplay.label,
    homeAbbr: game.homeTeam.abbreviation,
    awayAbbr: game.awayTeam.abbreviation,
    homeProb: String(realHome),
    awayProb: String(realAway),
    ...(hasDraw ? { drawProb: String(drawPct) } : {}),
    isTossUp: predictionDisplay.isTossUp ? '1' : '0',
  };

  const isAwayPick = predictionDisplay.outcome === 'away';
  const isHomePick = predictionDisplay.outcome === 'home';
  const matchupCenterLabel = predictionDisplay.outcome === 'draw' || predictionDisplay.outcome === 'toss_up'
    ? predictionDisplay.badgeLabel
    : 'VS';

  // Rotating shimmer border — traces around the card
  const rotation = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  const pressProgress = useSharedValue(0);
  React.useEffect(() => {
    if (!animationsEnabled) {
      cancelAnimation(rotation);
      cancelAnimation(glowPulse);
      cancelAnimation(pressProgress);
      rotation.value = 0;
      glowPulse.value = 0;
      pressProgress.value = 0;
      return;
    }
    rotation.value = 0;
    glowPulse.value = 0;
    rotation.value = withRepeat(withTiming(360, { duration: 6800, easing: Easing.linear }), -1, false);
    glowPulse.value = withRepeat(
      withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => { cancelAnimation(rotation); cancelAnimation(glowPulse); cancelAnimation(pressProgress); };
  }, [animationsEnabled, glowPulse, pressProgress, rotation]);
  const rotatingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value % 360}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(glowPulse.value, [0, 1], [0.24, 0.48]),
    shadowRadius: interpolate(glowPulse.value, [0, 1], [14, 30]),
  }));
  const pressStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pressProgress.value, [0, 1], [1, 0.96]),
    transform: [
      { translateY: interpolate(pressProgress.value, [0, 1], [0, 1.5]) },
      { scale: interpolate(pressProgress.value, [0, 1], [1, 0.988]) },
    ],
  }));

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index * 80, 240)).duration(650).easing(Easing.out(Easing.cubic))} style={{ paddingBottom: 44 }}>
      <AnimatedPressable
        onPress={onPress}
        onPressIn={() => {
          onPressIn?.();
          pressProgress.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
        }}
        onPressOut={() => {
          pressProgress.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
        }}
        style={pressStyle}
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
              colors={['rgba(192,200,208,0.92)', 'rgba(122,157,184,0.5)', 'rgba(255,255,255,0.95)', 'rgba(139,10,31,0.58)', 'rgba(192,200,208,0.86)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            {/* Rotating beam — teal + maroon same as before */}
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
              <Animated.View style={[rotatingStyle, { width: 800, height: 800, position: 'absolute' }]}>
                <LinearGradient
                  colors={['transparent', 'transparent', 'rgba(122,157,184,0.9)', 'rgba(255,255,255,0.78)', 'rgba(122,157,184,0.9)', 'transparent', 'transparent']}
                  start={{ x: 0.3, y: 0 }}
                  end={{ x: 0.7, y: 0 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400 }}
                />
                <LinearGradient
                  colors={['transparent', 'transparent', 'rgba(90,6,20,0.8)', 'rgba(139,10,31,0.98)', 'rgba(90,6,20,0.8)', 'transparent', 'transparent']}
                  start={{ x: 0.3, y: 0 }}
                  end={{ x: 0.7, y: 0 }}
                  style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 400 }}
                />
              </Animated.View>
            </View>

            {/* Card body — inset to reveal rotating border */}
            <View style={{ margin: 4.25, borderRadius: 19.75, overflow: 'hidden', backgroundColor: '#182028' }}>
              {/* Coral radial glow — top right */}
              <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
                  <Defs>
                    <RadialGradient id={`coral_${index}`} cx="85" cy="15" rx="50" ry="50" gradientUnits="userSpaceOnUse">
                      <Stop offset="0%" stopColor="#8B0A1F" stopOpacity={0.56} />
                      <Stop offset="60%" stopColor="#8B0A1F" stopOpacity={0.12} />
                      <Stop offset="100%" stopColor="#8B0A1F" stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Rect x="0" y="0" width="100" height="100" fill={`url(#coral_${index})`} />
                </Svg>
              </View>
              {/* Steel blue radial glow — bottom left */}
              <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
                  <Defs>
                    <RadialGradient id={`blue_${index}`} cx="15" cy="85" rx="60" ry="60" gradientUnits="userSpaceOnUse">
                      <Stop offset="0%" stopColor="#4E606F" stopOpacity={0.96} />
                      <Stop offset="50%" stopColor="#4E606F" stopOpacity={0.3} />
                      <Stop offset="100%" stopColor="#4E606F" stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Rect x="0" y="0" width="100" height="100" fill={`url(#blue_${index})`} />
                </Svg>
              </View>

              {/* ── Top bar: rank + sport + time ── */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {/* Rank badge */}
                  <View style={{ backgroundColor: MAROON, width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '900' }}>#{index + 1}</Text>
                  </View>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.5 }}>CLUTCH PICK</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ backgroundColor: `${TEAL}18`, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: `${TEAL}20` }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: TEAL, letterSpacing: 0.5 }}>{displaySport(game.sport)}</Text>
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
                    teamName={game.awayTeam.name}
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
                  <Text style={{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.45)', marginHorizontal: 8 }}>{matchupCenterLabel}</Text>
                  <LinearGradient colors={['rgba(255,255,255,0.35)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 1 }} />
                </View>

                {/* Home team */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <TeamJerseyCompact
                    teamAbbreviation={game.homeTeam.abbreviation}
                    teamName={game.homeTeam.name}
                    primaryColor={homeColors.primary}
                    secondaryColor={homeColors.secondary}
                    size={44}
                    isHighlighted={isHomePick}
                    sport={game.sport}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: '#FFF' }} numberOfLines={1}>
                      {game.homeTeam.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{game.homeTeam.record}</Text>
                  </View>
                  {isHomePick ? (
                    <View style={{ backgroundColor: 'rgba(122,157,184,0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(122,157,184,0.3)' }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>AI PICK</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* ── Pick Strength + Win Probability ── */}
              <View style={{ marginHorizontal: 18, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 14, padding: 14, marginBottom: 14 }}>
                {/* Pick strength row — tier label only, no raw % (matches the rest of the app) */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>PICK STRENGTH</Text>
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      router.push({ pathname: '/confidence-explained', params: confidenceParams });
                    }}
                    hitSlop={8}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}
                  >
                    <Text style={{ fontSize: 18, fontWeight: '800', color: tier.color, letterSpacing: 0.3 }}>{tier.label}</Text>
                    <Text style={{ fontSize: 12, color: `${tier.color}99` }}>›</Text>
                  </Pressable>
                </View>

                {/* Win probability */}
                <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5, marginBottom: 8 }}>WIN PROBABILITY</Text>
                <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <LinearGradient
                    colors={[chartColors.away, `${chartColors.away}CC`]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flex: awayPct, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }}
                  />
                  <View style={{ width: 2, backgroundColor: 'rgba(0,0,0,0.9)' }} />
                  {hasDraw ? (
                    <>
                      <View style={{ flex: drawPct, backgroundColor: drawColor }} />
                      <View style={{ width: 2, backgroundColor: 'rgba(0,0,0,0.9)' }} />
                    </>
                  ) : null}
                  <LinearGradient
                    colors={[`${chartColors.home}CC`, chartColors.home]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flex: homePct, borderTopRightRadius: 3, borderBottomRightRadius: 3 }}
                  />
                </View>
                {/* Labels */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: chartColors.away }} />
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>{game.awayTeam.abbreviation}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }}>{dp.away}%</Text>
                  </View>
                  {hasDraw ? (
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 0 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: drawColor }} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>Draw</Text>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }}>{dp.draw}%</Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, minWidth: 0 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }}>{dp.home}%</Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>{game.homeTeam.abbreviation}</Text>
                    <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: chartColors.home }} />
                  </View>
                </View>
              </View>

              {/* ── Analysis ── */}
              <View style={{ paddingHorizontal: 18, paddingBottom: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <View style={{ width: 3, height: 12, borderRadius: 1.5, backgroundColor: MAROON }} />
                  <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>WHY THIS PICK</Text>
                </View>
                <ExpandableText text={displayPredictionAnalysis(game)} />

                {/* View details CTA */}
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(122,157,184,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(122,157,184,0.25)' }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: TEAL }}>Full breakdown</Text>
                    <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
                      <Path d="M9 18l6-6-6-6" stroke={TEAL} strokeWidth={2.5} strokeLinecap="round" />
                    </Svg>
                  </View>
                </View>
              </View>
            </View>
          </View>
          </View>
        </Animated.View>
      </AnimatedPressable>
    </Animated.View>
  );
});

export default function ClutchPicksScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const scrollHandler = useHideOnScroll();
  const responsive = useResponsive();
  const { isPremium } = useSubscription();
  const insets = useSafeAreaInsets();
  const bottomPadding = getClutchPicksBottomPadding(insets.bottom);
  const prefetchGame = usePrefetchGame();

  // Get top picks with guaranteed predictions from dedicated endpoint
  const { data: topPicks, isLoading: isLoadingPicks, refetch: refetchPicks } = useTopPicks();
  const { refreshing, onRefresh } = useSmoothRefresh(refetchPicks);
  const hasTopPicksData = (topPicks?.length ?? 0) > 0;
  const isInitialPicksLoading = isLoadingPicks && !hasTopPicksData;

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

  const handleGameWarm = useCallback((game: GameWithPrediction) => {
    prefetchGame(game.id, game);
  }, [prefetchGame]);

  const handleGamePress = useCallback((game: GameWithPrediction) => {
    if (!claimGameNavigation(game.id)) return;
    handleGameWarm(game);
    router.push(`/game/${game.id}` as any);
  }, [handleGameWarm, router]);

  const headerComponent = useMemo(() => (
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
  ), []);

  const renderTopPick = useCallback(({ item, index }: { item: GameWithPrediction; index: number }) => (
    <View style={responsive.numColumns === 2 ? { flex: 1 } : undefined}>
      <TopPickCard
        game={item}
        index={index}
        animationsEnabled={isFocused}
        onPressIn={() => handleGameWarm(item)}
        onPress={() => handleGamePress(item)}
      />
    </View>
  ), [handleGamePress, handleGameWarm, isFocused, responsive.numColumns]);

  const keyTopPick = useCallback((item: GameWithPrediction) => item.id, []);

  const topPicksFooter = useMemo(() => (
    <View style={{ paddingTop: 16, paddingBottom: 20 }}>
      <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
        All predictions are AI-generated for entertainment purposes only. Not gambling advice.
      </Text>
    </View>
  ), []);

  return (
    <View style={{ flex: 1, backgroundColor: '#010101' }}>
      <StatusBar style="light" hidden={false} />
      <ClutchPicksBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ErrorBoundary onGoBack={() => router.back()}>

        {/* Content */}
        {isInitialPicksLoading ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>
            {headerComponent}
            {[0, 1, 2].map((item) => (
              <View
                key={item}
                style={{
                  marginBottom: 14,
                  minHeight: item === 0 ? 138 : 116,
                  borderRadius: 20,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: item === 0 ? 'rgba(122,157,184,0.20)' : 'rgba(255,255,255,0.08)',
                  backgroundColor: item === 0 ? 'rgba(122,157,184,0.055)' : 'rgba(255,255,255,0.025)',
                  padding: 16,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <View style={{ width: 76, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.08)' }} />
                  {item === 0 ? <ActivityIndicator size="small" color="#7A9DB8" /> : <View style={{ width: 32, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.045)' }} />}
                </View>
                <View style={{ height: 18, width: item === 0 ? '70%' : '58%', borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 12 }} />
                <View style={{ height: 10, width: '92%', borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.045)', marginBottom: 8 }} />
                <View style={{ height: 10, width: item === 2 ? '62%' : '78%', borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.035)' }} />
              </View>
            ))}
          </ScrollView>
        ) : !isPremium ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>
            {headerComponent}

            {/* Ghost pick cards — premium locked model board */}
            {[1, 2, 3].map((rank) => (
              <View
                key={rank}
                style={{
                  marginBottom: 14,
                  borderRadius: 20,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: rank === 1 ? 'rgba(122,157,184,0.26)' : 'rgba(122,157,184,0.12)',
                  backgroundColor: 'rgba(4,7,10,0.72)',
                  opacity: rank === 1 ? 1 : rank === 2 ? 0.78 : 0.56,
                }}
              >
                <BlurView intensity={rank === 1 ? 36 : 28} tint="dark" style={StyleSheet.absoluteFillObject} />
                <LinearGradient
                  colors={rank === 1
                    ? ['rgba(122,157,184,0.13)', 'rgba(255,255,255,0.025)', 'rgba(139,10,31,0.055)']
                    : ['rgba(122,157,184,0.07)', 'rgba(255,255,255,0.018)', 'rgba(4,6,8,0.86)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <LinearGradient
                  pointerEvents="none"
                  colors={['rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.85, y: 1 }}
                  style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 1 }}
                />
                <View style={{ padding: 16, minHeight: 130 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: rank === 1 ? 'rgba(122,157,184,0.16)' : 'rgba(122,157,184,0.10)', borderWidth: 1, borderColor: rank === 1 ? 'rgba(122,157,184,0.24)' : 'rgba(122,157,184,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '900', color: rank === 1 ? '#A9C5D8' : 'rgba(169,197,216,0.48)' }}>#{rank}</Text>
                    </View>
                    <View style={{ marginLeft: 10, flex: 1 }}>
                      <View style={{ width: 104, height: 8, borderRadius: 4, backgroundColor: 'rgba(180,211,235,0.12)' }} />
                      <View style={{ width: 54, height: 5, borderRadius: 3, backgroundColor: 'rgba(180,211,235,0.07)', marginTop: 6 }} />
                    </View>
                    <View style={{ backgroundColor: 'rgba(139,10,31,0.14)', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(139,10,31,0.26)' }}>
                      <Text style={{ fontSize: 9, lineHeight: 11, fontWeight: '900', color: 'rgba(255,255,255,0.78)', letterSpacing: 1.3 }}>PRO</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <View style={{ width: 42, height: 46, borderRadius: 13, backgroundColor: 'rgba(122,157,184,0.09)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.08)' }} />
                      <View style={{ marginLeft: 10 }}>
                        <View style={{ width: 78, height: 12, borderRadius: 5, backgroundColor: 'rgba(224,234,240,0.10)', marginBottom: 6 }} />
                        <View style={{ width: 46, height: 7, borderRadius: 4, backgroundColor: 'rgba(180,211,235,0.08)' }} />
                      </View>
                    </View>
                    <View style={{ alignItems: 'center', paddingHorizontal: 12 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(180,211,235,0.28)', letterSpacing: 1.2 }}>VS</Text>
                    </View>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', flex: 1 }}>
                      <View style={{ width: 42, height: 46, borderRadius: 13, backgroundColor: 'rgba(139,10,31,0.08)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.08)' }} />
                      <View style={{ alignItems: 'flex-end', marginRight: 10 }}>
                        <View style={{ width: 78, height: 12, borderRadius: 5, backgroundColor: 'rgba(224,234,240,0.10)', marginBottom: 6 }} />
                        <View style={{ width: 46, height: 7, borderRadius: 4, backgroundColor: 'rgba(180,211,235,0.08)' }} />
                      </View>
                    </View>
                  </View>

                  {rank <= 2 ? (
                    <View style={{ marginTop: 16 }}>
                      <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.035)', overflow: 'hidden' }}>
                        <LinearGradient
                          colors={rank === 1 ? ['rgba(122,157,184,0.54)', 'rgba(139,10,31,0.28)'] : ['rgba(122,157,184,0.28)', 'rgba(255,255,255,0.08)']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={{ width: rank === 1 ? '72%' : '58%', height: '100%', borderRadius: 3 }}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>
            ))}

            {/* Unified Pro introduction */}
            <View style={{ borderRadius: 26, overflow: 'hidden', borderWidth: 1.2, borderColor: 'rgba(122,157,184,0.24)', backgroundColor: 'rgba(4,7,10,0.86)', marginTop: 8, marginBottom: 6 }}>
              <BlurView intensity={38} tint="dark" style={StyleSheet.absoluteFillObject} />
              <LinearGradient
                colors={['rgba(122,157,184,0.15)', 'rgba(255,255,255,0.025)', 'rgba(139,10,31,0.08)', 'rgba(4,6,8,0.96)']}
                locations={[0, 0.45, 0.78, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 1 }}
              />
              <View style={{ padding: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: 'rgba(122,157,184,0.11)', borderWidth: 1.2, borderColor: 'rgba(122,157,184,0.28)', alignItems: 'center', justifyContent: 'center', marginRight: 13, shadowColor: '#7A9DB8', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.20, shadowRadius: 14 }}>
                    <Svg width={25} height={25} viewBox="0 0 24 24" fill="none">
                      <Path d="M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z" fill="rgba(122,157,184,0.18)" stroke="#9AB8CC" strokeWidth="1.5" />
                      <Path d="M7 11V7a5 5 0 0110 0v4" stroke="#7A9DB8" strokeWidth="1.5" strokeLinecap="round" />
                      <Path d="M12 16v2" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
                    </Svg>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '900', color: '#7A9DB8', letterSpacing: 2, marginBottom: 5 }}>DAILY MODEL BOARD</Text>
                    <Text style={{ fontSize: 22, lineHeight: 27, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0 }}>Today's picks are queued</Text>
                  </View>
                  <View style={{ borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: 'rgba(139,10,31,0.14)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.30)', marginLeft: 12 }}>
                    <Text style={{ fontSize: 9, lineHeight: 11, fontWeight: '900', color: 'rgba(255,255,255,0.82)', letterSpacing: 1.4 }}>PRO</Text>
                  </View>
                </View>

                <Text style={{ fontSize: 13, color: 'rgba(180,211,235,0.76)', lineHeight: 20, marginBottom: 16 }}>
                  Reveal the ranked side, model confidence, and matchup read when you want the full board.
                </Text>

                <View style={{ marginBottom: 18 }}>
                  {['Ranked pick board', 'Model confidence', 'Matchup context'].map((label, itemIndex) => (
                    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, borderRadius: 11, backgroundColor: 'rgba(122,157,184,0.055)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.10)', paddingHorizontal: 10, marginBottom: itemIndex === 2 ? 0 : 8 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: itemIndex === 0 ? '#9AB8CC' : itemIndex === 1 ? 'rgba(139,10,31,0.78)' : 'rgba(224,234,240,0.55)', marginRight: 9 }} />
                      <Text style={{ flex: 1, fontSize: 11, lineHeight: 14, color: 'rgba(224,234,240,0.74)', fontWeight: '800' }}>{label}</Text>
                      <View style={{ width: itemIndex === 0 ? 58 : itemIndex === 1 ? 78 : 66, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.055)' }} />
                    </View>
                  ))}
                </View>

                <Pressable onPress={() => router.push('/paywall')} style={{ width: '100%' }}>
                  <LinearGradient
                    colors={['rgba(122,157,184,0.24)', 'rgba(139,10,31,0.18)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ height: 54, borderRadius: 16, padding: 1, shadowColor: '#7A9DB8', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12 }}
                  >
                    <View style={{ flex: 1, borderRadius: 15, backgroundColor: 'rgba(5,8,13,0.78)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}>
                      <Text style={{ fontSize: 15, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.2 }}>Explore Pro</Text>
                      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={{ marginLeft: 6 }}>
                        <Path d="M9 18l6-6-6-6" stroke="#9AB8CC" strokeWidth={2.7} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    </View>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        ) : validPicks.length > 0 ? (
          <Animated.FlatList
            key={responsive.numColumns}
            data={validPicks}
            keyExtractor={keyTopPick}
            numColumns={responsive.numColumns}
            columnWrapperStyle={responsive.numColumns === 2 ? { gap: 16, paddingHorizontal: responsive.contentPadding } : undefined}
            ListHeaderComponent={headerComponent}
            renderItem={renderTopPick}
            contentContainerStyle={[{ paddingHorizontal: 20, paddingBottom: bottomPadding }, responsive.isTablet && { maxWidth: 700, alignSelf: 'center', width: '100%' }]}
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
            ListFooterComponent={topPicksFooter}
          />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: bottomPadding }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#5A7A8A" />
            }
          >
            {headerComponent}
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 }}>
              <View style={{ position: 'relative', marginBottom: 20 }}>
                <View style={{ position: 'absolute', top: -8, left: -8, right: -8, bottom: -8, borderRadius: 48, backgroundColor: MAROON, opacity: 0.15 }} />
                <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(139,10,31,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: `${MAROON}30` }}>
                  <FieldGoalU size={44} color={`${MAROON}60`} />
                </View>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>No top picks yet</Text>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center', paddingHorizontal: 12 }}>
                New predictions populate throughout the day. Pull to refresh or check back soon.
              </Text>
            </View>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
              AI predictions are for entertainment purposes only. Not financial advice.
            </Text>
          </ScrollView>
        )}
        </ErrorBoundary>
      </SafeAreaView>
    </View>
  );
}
