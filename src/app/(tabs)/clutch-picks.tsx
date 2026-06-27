import { View, Text, RefreshControl, Pressable, ScrollView, StyleSheet, InteractionManager, type GestureResponderEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import Animated, { FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolate, cancelAnimation } from 'react-native-reanimated';
import React, { useState, useCallback, memo, useMemo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopInsetView } from '@/components/TopInsetView';
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
import { deepEqual } from '@/lib/deep-equal';
import { guardedRouterBack, guardedRouterPush } from '@/lib/navigation-guard';

function getClutchPicksBottomPadding(bottomInset: number) {
  return GLASS_BOTTOM_NAV_HEIGHT
    + GLASS_BOTTOM_NAV_FADE_HEIGHT
    + Math.max(bottomInset, GLASS_BOTTOM_NAV_MIN_BOTTOM_PADDING)
    + GLASS_BOTTOM_NAV_SCROLL_PADDING
    + 36;
}

// Analysis text height-accordion. We measure the real collapsed (3-line) and full
// heights with two off-layout copies, then drive ONE animated `height` on the
// visible clip. A real animated height reflows the card body — and therefore the
// glowing border frame — every frame via Yoga, so the frame opens *with* the text
// instead of two competing `layout` snapshots tearing the border at top/bottom.
const ANALYSIS_LINE_HEIGHT = 20;
const MEASURE_STYLE = { position: 'absolute' as const, left: 0, right: 0, opacity: 0, zIndex: -1 };

const ExpandableText = memo(function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [collapsedH, setCollapsedH] = useState(0);
  const [fullH, setFullH] = useState(0);
  const progress = useSharedValue(0);
  const measured = collapsedH > 0 && fullH > 0;
  const canExpand = measured && fullH > collapsedH + 1;

  const clipStyle = useAnimatedStyle(() => {
    if (!measured) return {};
    return { height: collapsedH + (fullH - collapsedH) * progress.value };
  });

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      progress.value = withTiming(next ? 1 : 0, { duration: 300, easing: Easing.inOut(Easing.cubic) });
      return next;
    });
  }, [progress]);
  const handlePress = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    toggle();
  }, [toggle]);

  const textStyle = { fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: ANALYSIS_LINE_HEIGHT };

  return (
    <Pressable
      accessibilityRole={canExpand ? 'button' : undefined}
      accessibilityLabel={canExpand ? (expanded ? 'Collapse pick analysis' : 'Read full pick analysis') : undefined}
      accessibilityHint={canExpand ? 'Expands or collapses the pick explanation' : undefined}
      onPress={canExpand ? handlePress : undefined}
      hitSlop={6}
    >
      {/* Off-layout measurers — never painted, never shift the card */}
      <Text
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[textStyle, MEASURE_STYLE]}
        numberOfLines={3}
        onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0 && Math.abs(h - collapsedH) > 0.5) setCollapsedH(h); }}
      >
        {text}
      </Text>
      <Text
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[textStyle, MEASURE_STYLE]}
        onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0 && Math.abs(h - fullH) > 0.5) setFullH(h); }}
      >
        {text}
      </Text>

      {/* Visible clip — height animates between the two measured heights */}
      <Animated.View style={[{ overflow: 'hidden' }, clipStyle]}>
        <Text style={textStyle} numberOfLines={expanded ? undefined : 3} ellipsizeMode="tail">
          {text}
        </Text>
      </Animated.View>
      {canExpand ? (
        <Animated.Text
          key={expanded ? 'less' : 'more'}
          entering={FadeIn.duration(180)}
          style={{ fontSize: 11, fontWeight: '600', color: '#7A9DB8', marginTop: 6 }}
        >
          {expanded ? 'Show less' : 'Read more'}
        </Animated.Text>
      ) : null}
    </Pressable>
  );
});

// Shimmering load skeleton — mirrors the real TopPickCard footprint so the
// hard-swap to real cards has no shape/size flash. One shared value drives the
// pulse on the UI thread; every bar reads it (no per-bar animation = cheap).
const SkeletonCard = memo(function SkeletonCard({ rank, pulse }: { rank: number; pulse: Animated.SharedValue<number> }) {
  const isLead = rank === 0;
  const barStyle = useAnimatedStyle(() => ({ opacity: interpolate(pulse.value, [0, 1], [0.4, 1]) }));
  const Bar = ({ w, h, mt }: { w: number | `${number}%`; h: number; mt?: number }) => (
    <Animated.View style={[barStyle, { width: w, height: h, borderRadius: h / 2, backgroundColor: 'rgba(255,255,255,0.07)', marginTop: mt }]} />
  );
  return (
    <View
      style={{
        marginBottom: 14,
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: isLead ? 'rgba(122,157,184,0.22)' : 'rgba(255,255,255,0.08)',
        backgroundColor: isLead ? 'rgba(122,157,184,0.05)' : 'rgba(255,255,255,0.022)',
        padding: 16,
      }}
    >
      {/* Top bar: rank badge + sport chip */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Animated.View style={[barStyle, { width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(139,10,31,0.45)' }]} />
          <Bar w={76} h={10} />
        </View>
        <Bar w={54} h={20} />
      </View>
      {/* Two stacked team rows */}
      {[0, 1].map((row) => (
        <View key={row} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: row === 0 ? 12 : 0 }}>
          <Animated.View style={[barStyle, { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' }]} />
          <View style={{ flex: 1 }}>
            <Bar w={row === 0 ? '64%' : '52%'} h={15} />
            <Bar w={42} h={8} mt={6} />
          </View>
        </View>
      ))}
      {/* Strength / prob block */}
      <View style={{ marginTop: 14, height: 56, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.28)', padding: 12, justifyContent: 'center' }}>
        <Bar w={'40%'} h={10} />
        <Bar w={'100%'} h={6} mt={12} />
      </View>
      {/* Analysis lines (lead card only — mirrors collapsed 3-line text) */}
      {isLead ? (
        <View style={{ marginTop: 14 }}>
          <Bar w={'92%'} h={9} />
          <Bar w={'86%'} h={9} mt={7} />
          <Bar w={'58%'} h={9} mt={7} />
        </View>
      ) : null}
    </View>
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
}: {
  game: GameWithPrediction;
  index: number;
  onPress: (game: GameWithPrediction) => void;
  onPressIn?: (game: GameWithPrediction) => void;
}) {
  const router = useRouter();
  // All per-card prediction display math derives from `game` only — compute it
  // once and reuse across renders so a live tick that doesn't change the game
  // (gated by the deep-equal memo below) never re-runs this work.
  const {
    awayColors,
    homeColors,
    chartColors,
    tier,
    dp,
    hasDraw,
    drawColor,
    awayPct,
    homePct,
    drawPct,
    confidenceParams,
    isAwayPick,
    isHomePick,
    matchupCenterLabel,
  } = useMemo(() => {
    const awayColors = getTeamColors(game.awayTeam.abbreviation, game.sport);
    const homeColors = getTeamColors(game.homeTeam.abbreviation, game.sport);
    const chartColors = getDistinctColors(awayColors.primary, homeColors.primary);
    const conf = game.prediction ? getCanonicalConfidence(game.prediction) : 70;
    const predictionDisplay = getGamePredictionDisplay(game);
    const tier = getConfidenceTier(conf, predictionDisplay.isTossUp, predictionDisplay.marketType);
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
      marketType: predictionDisplay.marketType ?? 'moneyline',
    };

    const isAwayPick = predictionDisplay.outcome === 'away';
    const isHomePick = predictionDisplay.outcome === 'home';
    const matchupCenterLabel = predictionDisplay.outcome === 'draw' || predictionDisplay.outcome === 'toss_up'
      ? predictionDisplay.badgeLabel
      : 'VS';

    return {
      awayColors,
      homeColors,
      chartColors,
      tier,
      dp,
      hasDraw,
      drawColor,
      awayPct,
      homePct,
      drawPct,
      confidenceParams,
      isAwayPick,
      isHomePick,
      matchupCenterLabel,
    };
  }, [game]);

  // Rotating beam border — matches the game-detail prediction card. The spinning
  // square is sized to the card's MEASURED diagonal so it always covers the border
  // (collapsed or expanded) — the game-detail card uses a fixed 800 because it never
  // grows; these cards do, so we measure. Deferred + focus-gated like game-detail.
  const isFocused = useIsFocused();
  // Spinning-square size = card diagonal (measured), snapped to a 100px step so it
  // only commits at a boundary — an expand never churns re-renders, and every
  // collapsed card lands on the same value (consistent beam across all cards).
  const [beam, setBeam] = useState(700);
  const rotation = useSharedValue(0);
  React.useEffect(() => {
    if (!isFocused) {
      cancelAnimation(rotation);
      rotation.value = 0;
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => {
      rotation.value = withRepeat(withTiming(360, { duration: 4500, easing: Easing.linear }), -1, false);
    });
    return () => {
      task.cancel();
      cancelAnimation(rotation);
    };
  }, [isFocused, rotation]);
  const rotatingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const pressProgress = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pressProgress.value, [0, 1], [1, 0.96]),
    transform: [
      { translateY: interpolate(pressProgress.value, [0, 1], [0, 1.5]) },
      { scale: interpolate(pressProgress.value, [0, 1], [1, 0.988]) },
    ],
  }));

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index * 70, 210)).duration(560).easing(Easing.out(Easing.cubic))}
      style={{ paddingBottom: 44 }}
    >
      <AnimatedPressable
        accessible={false}
        onPress={() => onPress(game)}
        onPressIn={() => {
          onPressIn?.(game);
          pressProgress.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
        }}
        onPressOut={() => {
          pressProgress.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
        }}
        style={pressStyle}
      >
        {/* Outer glow — static silver halo */}
        <View style={{
          borderRadius: 24,
          shadowColor: '#C0C8D0',
          shadowOffset: { width: 0, height: 0 },
          shadowRadius: 22,
          shadowOpacity: 0.26,
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
          {/* Border wrapper. onLayout feeds the spinning square the card's live size. */}
          <View
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              const needed = Math.ceil((Math.hypot(width, height) + 40) / 100) * 100;
              setBeam((prev) => (prev === needed ? prev : needed));
            }}
            style={{ borderRadius: 24, overflow: 'hidden', position: 'relative' }}
          >
            {/* Static metallic base — silver/chrome, visible where the beam isn't */}
            <LinearGradient
              colors={['rgba(210,216,224,0.95)', 'rgba(165,174,186,0.6)', 'rgba(255,255,255,0.96)', 'rgba(165,174,186,0.6)', 'rgba(210,216,224,0.92)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />

            {/* Rotating beam — same as the game-detail prediction card (teal/white +
                maroon). The square is sized to the card's diagonal so the beam wraps
                the ENTIRE border, every corner, collapsed or expanded. */}
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
              <Animated.View style={[rotatingStyle, { position: 'absolute', top: '50%', left: '50%', width: beam, height: beam, marginTop: -beam / 2, marginLeft: -beam / 2 }]}>
                <LinearGradient
                  colors={['transparent', 'transparent', '#7A9DB8', 'rgba(255,255,255,0.85)', '#7A9DB8', 'transparent', 'transparent']}
                  start={{ x: 0.3, y: 0 }}
                  end={{ x: 0.7, y: 0 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: beam / 2 }}
                />
                <LinearGradient
                  colors={['transparent', 'transparent', '#5A0614', '#8B0A1F', '#5A0614', 'transparent', 'transparent']}
                  start={{ x: 0.3, y: 0 }}
                  end={{ x: 0.7, y: 0 }}
                  style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: beam / 2 }}
                />
              </Animated.View>
            </View>

            {/* Card body — inset to reveal the rotating border */}
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
                      guardedRouterPush(router, { pathname: '/confidence-explained', params: confidenceParams });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Explain pick strength: ${tier.label}`}
                    accessibilityHint="Opens the confidence explanation"
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
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }} numberOfLines={1}>{game.awayTeam.abbreviation}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }} numberOfLines={1}>{dp.away}%</Text>
                  </View>
                  {hasDraw ? (
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 0 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: drawColor }} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }} numberOfLines={1}>Draw</Text>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }} numberOfLines={1}>{dp.draw}%</Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, minWidth: 0 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }} numberOfLines={1}>{dp.home}%</Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }} numberOfLines={1}>{game.homeTeam.abbreviation}</Text>
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open full breakdown: ${game.awayTeam.name} at ${game.homeTeam.name}`}
                    accessibilityHint="Opens game details with the full prediction breakdown"
                    hitSlop={8}
                    onPress={(e) => {
                      e.stopPropagation();
                      onPress(game);
                    }}
                    onPressIn={(e) => {
                      e.stopPropagation();
                      onPressIn?.(game);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: pressed ? 'rgba(122,157,184,0.16)' : 'rgba(122,157,184,0.08)',
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: 'rgba(122,157,184,0.25)',
                    })}
                  >
                    <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '600', color: TEAL, includeFontPadding: false }}>Full breakdown</Text>
                    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none" style={{ marginTop: 0.5 }}>
                      <Path d="M9 18l6-6-6-6" stroke={TEAL} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
          </View>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}, (prev, next) =>
  prev.index === next.index &&
  prev.onPress === next.onPress &&
  prev.onPressIn === next.onPressIn &&
  deepEqual(prev.game, next.game)
);

export default function ClutchPicksScreen() {
  const router = useRouter();
  const screenFocused = useIsFocused();
  const scrollHandler = useHideOnScroll();
  const responsive = useResponsive();
  const { isPremium, isLoading: isSubscriptionLoading } = useSubscription();
  const insets = useSafeAreaInsets();
  const bottomPadding = getClutchPicksBottomPadding(insets.bottom);
  const prefetchGame = usePrefetchGame();

  // Get top picks with guaranteed predictions from dedicated endpoint
  const { data: topPicks, isLoading: isLoadingPicks, refetch: refetchPicks } = useTopPicks({
    enabled: screenFocused,
    subscribed: screenFocused,
  });
  const { refreshing, onRefresh } = useSmoothRefresh(refetchPicks);
  const hasTopPicksData = (topPicks?.length ?? 0) > 0;
  const isInitialPicksLoading = isLoadingPicks && !hasTopPicksData;
  const shouldShowPicksSkeleton = isSubscriptionLoading || (isPremium && isInitialPicksLoading);

  // Single UI-thread shimmer driver shared by all skeleton bars while loading.
  const skeletonPulse = useSharedValue(0);
  React.useEffect(() => {
    if (!shouldShowPicksSkeleton) {
      cancelAnimation(skeletonPulse);
      skeletonPulse.value = 0;
      return;
    }
    skeletonPulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => { cancelAnimation(skeletonPulse); };
  }, [shouldShowPicksSkeleton, skeletonPulse]);

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
    guardedRouterPush(router, `/game/${game.id}` as any);
  }, [handleGameWarm, router]);

  const openPaywall = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    guardedRouterPush(router, '/paywall');
  }, [router]);

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
        onPressIn={handleGameWarm}
        onPress={handleGamePress}
      />
    </View>
  ), [handleGamePress, handleGameWarm, responsive.numColumns]);

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
      {/* transparent so the decorative ClutchPicksBackground behind it stays visible;
          the outer View is already #010101, so there is no white-flash risk. */}
      <TopInsetView style={{ flex: 1 }} backgroundColor="transparent">
        <ErrorBoundary onGoBack={() => guardedRouterBack(router)}>

        {/* Content */}
        {shouldShowPicksSkeleton ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>
            {headerComponent}
            <Animated.View entering={FadeIn.duration(220)}>
              {[0, 1, 2].map((rank) => (
                <SkeletonCard key={rank} rank={rank} pulse={skeletonPulse} />
              ))}
            </Animated.View>
          </ScrollView>
        ) : !isPremium ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>
            {headerComponent}

            {/* Ghost pick cards — premium locked model board */}
            {[1, 2, 3].map((rank) => (
              <Pressable
                key={rank}
                accessibilityRole="button"
                accessibilityLabel={`Unlock Pro pick #${rank}`}
                accessibilityHint="Opens Clutch Picks Pro"
                onPress={openPaywall}
                style={({ pressed }) => ({
                  marginBottom: 14,
                  borderRadius: 20,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: rank === 1 ? 'rgba(122,157,184,0.26)' : 'rgba(122,157,184,0.12)',
                  backgroundColor: 'rgba(4,7,10,0.72)',
                  opacity: (rank === 1 ? 1 : rank === 2 ? 0.78 : 0.56) * (pressed ? 0.86 : 1),
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                })}
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
              </Pressable>
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

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Explore Pro"
                  accessibilityHint="Opens Clutch Picks Pro"
                  onPress={openPaywall}
                  style={{ width: '100%' }}
                >
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
            // OFF: short list (one pick/sport); removeClippedSubviews recycles
            // row subviews from cached frames and clips a row growing mid-expand.
            removeClippedSubviews={false}
            maxToRenderPerBatch={4}
            windowSize={7}
            initialNumToRender={3}
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
      </TopInsetView>
    </View>
  );
}
