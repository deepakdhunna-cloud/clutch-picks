import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  StyleSheet,
  Modal,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame } from '@/hooks/useGames';
import { displayConfidence, displayWinProbability, displayEdgeRating, getConfidenceTierLabel, displaySport, formatGameTime, getConfidenceTier } from '@/lib/display-confidence';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, {
  Path,
  Line,
  Text as SvgText,
  Defs,
  LinearGradient as SvgGradient,
  Stop,
  Rect,
  Circle,
} from 'react-native-svg';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { Sport } from '@/types/sports';
import { useGamePick, useMakePick } from '@/hooks/usePicks';
import { AnalysisIcon } from '@/components/icons/AnalysisIcon';
import { getTeamColors } from '@/lib/team-colors';
import { MLBTeamRoleBlock, MLBLiveCenterStack } from '@/components/sports/MLBLiveState';
import { ScorePop } from '@/components/sports/ScorePop';
import { getGameStartLabel } from '@/lib/game-start-label';
import { useSubscription } from '@/lib/subscription-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Tappable Jersey component for hero section - matches GameCard style
const TappableJerseyHero = React.memo(function TappableJerseyHero({
  team,
  isSelected,
  onSelect,
  isDisabled,
  jerseyType,
  sport,
}: {
  team: GameTeam;
  isSelected: boolean;
  onSelect: () => void;
  isDisabled: boolean;
  jerseyType: ReturnType<typeof sportEnumToJersey>;
  sport: string;
}) {
  const scale = useSharedValue(1);
  const selectionProgress = useSharedValue(isSelected ? 1 : 0);
  const teamColors = getTeamColors(team.abbreviation, sport as any, team.color);

  useEffect(() => {
    selectionProgress.value = withTiming(isSelected ? 1 : 0, {
      duration: 300, easing: Easing.inOut(Easing.ease),
    });
  }, [isSelected]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const jerseyLiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(selectionProgress.value, [0, 1], [0, -4]) }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: selectionProgress.value,
    transform: [{ scale: interpolate(selectionProgress.value, [0, 1], [0.8, 1]) }],
  }));

  const handlePress = useCallback(() => {
    if (isDisabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    scale.value = withTiming(0.95, { duration: 150, easing: Easing.out(Easing.ease) }, () => {
      scale.value = withTiming(1, { duration: 200, easing: Easing.inOut(Easing.ease) });
    });
    onSelect();
  }, [isDisabled, onSelect, scale]);

  const shadowStyle = useMemo(() => ({
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 16,
  }), []);

  return (
    <Pressable onPress={handlePress} disabled={isDisabled}>
      <Animated.View style={[containerStyle, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ position: 'relative', alignItems: 'center' }}>
          <Animated.View style={[shadowStyle, jerseyLiftStyle]}>
            <JerseyIcon
              teamCode={team.abbreviation}
              primaryColor={teamColors.primary}
              secondaryColor={teamColors.secondary}
              size={72}
              sport={jerseyType}
            />
          </Animated.View>

          {/* "YOUR PICK" label — fades in smoothly */}
          <Animated.View style={[{
            marginTop: 2,
            backgroundColor: `${teamColors.primary}20`,
            paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6,
            borderWidth: 1, borderColor: `${teamColors.primary}40`,
          }, labelStyle]}>
            <Text style={{ fontSize: 8, fontWeight: '900', color: teamColors.primary, letterSpacing: 1.5 }}>YOUR PICK</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Pressable>
  );
});

const FieldGoalU = React.memo(function FieldGoalU({ color, size = 42 }: { color: string; size?: number }) {
  const isBlack = color === '#000000';
  return (
    <Svg width={size * 0.65} height={size} viewBox="0 0 26 40" fill="none">
      <Path d="M4 0 L4 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <Path d="M22 0 L22 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <Path d="M4 30 L22 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <Path d="M13 30 L13 40" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <Path d="M8 15 Q13 10 18 15 Q13 20 8 15" fill={color} transform="rotate(-35 13 15)" />
      <Path d="M13 13 L13 17" stroke={isBlack ? '#000000' : '#0D0D0D'} strokeWidth="1.2" strokeLinecap="round" transform="rotate(-35 13 15)" />
      <Path d="M11.5 14 L14.5 14" stroke={isBlack ? '#000000' : '#0D0D0D'} strokeWidth="0.8" transform="rotate(-35 13 15)" />
      <Path d="M11.5 16 L14.5 16" stroke={isBlack ? '#000000' : '#0D0D0D'} strokeWidth="0.8" transform="rotate(-35 13 15)" />
    </Svg>
  );
});

interface GameTeam {
  id: string;
  name: string;
  abbreviation: string;
  city: string;
  record: string;
  color: string;
  logo?: string;
}

interface PredictionFactor {
  name: string;
  weight: number;
  homeScore: number;
  awayScore: number;
  description: string;
}

interface GamePrediction {
  id: string;
  gameId: string;
  predictedWinner: 'home' | 'away';
  confidence: number;
  analysis: string;
  predictedSpread: number;
  predictedTotal: number;
  marketFavorite: 'home' | 'away';
  spread: number;
  overUnder: number;
  createdAt: string;
  homeWinProbability: number;
  awayWinProbability: number;
  factors: PredictionFactor[];
  edgeRating: number;
  valueRating: number;
  recentFormHome: string;
  recentFormAway: string;
  homeStreak: number;
  awayStreak: number;
  isTossUp?: boolean;
}

interface Game {
  id: string;
  sport: 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'MLS' | 'NCAAF' | 'NCAAB' | 'EPL';
  homeTeam: GameTeam;
  awayTeam: GameTeam;
  gameTime: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL' | 'POSTPONED' | 'CANCELLED';
  venue: string;
  tvChannel?: string;
  homeScore?: number;
  awayScore?: number;
  spread?: number;
  overUnder?: number;
  marketFavorite?: 'home' | 'away';
  quarter?: string;
  clock?: string;
  homeLinescores?: number[];
  awayLinescores?: number[];
  liveState?: {
    balls: number;
    strikes: number;
    outs: number;
    onFirst: boolean;
    onSecond: boolean;
    onThird: boolean;
    inningHalf: 'top' | 'bottom' | null;
    inningNumber: number | null;
    betweenInnings: boolean;
    pitcher: { name: string | null; teamAbbr: string } | null;
    batter: { name: string | null; teamAbbr: string } | null;
  };
  prediction?: GamePrediction;
}

const hexToRgba = (hex: string, alpha: number): string => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

function LivePulseDot() {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.6, { duration: 700, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 700, easing: Easing.in(Easing.ease) })
      ),
      -1
    );
  }, []);
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 2 - scale.value,
  }));
  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(255,59,48,0.3)' }, ringStyle]} />
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#FF3B30' }} />
    </View>
  );
}

interface ScoringData { h: number[]; a: number[]; }

const ScoringFlowChartWatermark = React.memo(function ScoringFlowChartWatermark({
  homeColor,
  awayColor,
  homeAbbr,
  awayAbbr,
  isLive,
}: {
  homeColor: string;
  awayColor: string;
  homeAbbr: string;
  awayAbbr: string;
  isLive: boolean;
}) {
  // Generate mock scoring data - cumulative scores over time
  const [data, setData] = useState<ScoringData>(() => {
    const h: number[] = [0];
    const a: number[] = [0];
    let hScore = 0, aScore = 0;
    for (let i = 1; i <= 48; i++) {
      hScore += Math.random() < 0.36 ? (Math.random() < 0.28 ? 3 : 2) : 0;
      aScore += Math.random() < 0.30 ? (Math.random() < 0.22 ? 3 : 2) : 0;
      h.push(hScore);
      a.push(aScore);
    }
    return { h, a };
  });

  // Live updates
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => {
      setData(prev => {
        if (prev.h.length >= 100) return prev;
        const lastH = prev.h[prev.h.length - 1];
        const lastA = prev.a[prev.a.length - 1];
        return {
          h: [...prev.h, lastH + (Math.random() < 0.36 ? (Math.random() < 0.28 ? 3 : 2) : 0)],
          a: [...prev.a, lastA + (Math.random() < 0.30 ? (Math.random() < 0.22 ? 3 : 2) : 0)],
        };
      });
    }, 2000);
    return () => clearInterval(id);
  }, [isLive]);

  // Pulsing dot animation
  const pulseScale = useSharedValue(3);
  const pulseOpacity = useSharedValue(0.9);

  useEffect(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(6, { duration: 1000, easing: Easing.out(Easing.ease) }),
        withTiming(3, { duration: 1000, easing: Easing.in(Easing.ease) })
      ),
      -1
    );
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 1000, easing: Easing.out(Easing.ease) }),
        withTiming(0.9, { duration: 1000, easing: Easing.in(Easing.ease) })
      ),
      -1
    );
  }, []);

  const homePulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value / 4 }],
    opacity: pulseOpacity.value,
  }));

  const awayPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: (pulseScale.value - 0.5) / 3.5 }],
    opacity: pulseOpacity.value * 0.9,
  }));

  // Chart dimensions
  const W = 380, H = 220;
  const padT = 22, padR = 90, padB = 28, padL = 90;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxY = 120;

  // Helper functions
  const toX = (index: number, total: number) => padL + (index / Math.max(total - 1, 1)) * chartW;
  const toY = (value: number) => padT + chartH - (value / maxY) * chartH;

  // Build smooth bezier path
  const buildBezierPath = useMemo(() => (scores: number[]) => {
    if (scores.length === 0) return '';
    const total = scores.length;
    let path = `M${toX(0, total).toFixed(1)},${toY(scores[0]).toFixed(1)}`;
    for (let i = 1; i < total; i++) {
      const x0 = toX(i - 1, total);
      const x1 = toX(i, total);
      const midX = (x0 + x1) / 2;
      path += ` C${midX.toFixed(1)},${toY(scores[i - 1]).toFixed(1)} ${midX.toFixed(1)},${toY(scores[i]).toFixed(1)} ${x1.toFixed(1)},${toY(scores[i]).toFixed(1)}`;
    }
    return path;
  }, []);

  // Build area path (closed for gradient fill)
  const buildAreaPath = useMemo(() => (scores: number[]) => {
    if (scores.length === 0) return '';
    const total = scores.length;
    const linePath = buildBezierPath(scores);
    const lastX = toX(total - 1, total);
    const firstX = toX(0, total);
    const baseline = toY(0);
    return `${linePath} L${lastX.toFixed(1)},${baseline.toFixed(1)} L${firstX.toFixed(1)},${baseline.toFixed(1)} Z`;
  }, [buildBezierPath]);

  // Quarter positions
  const quarterPositions = useMemo(() => {
    const total = data.h.length;
    return [
      { label: 'Q1', x: toX(0, total) },
      { label: 'Q2', x: toX(Math.floor(total * 0.25), total) },
      { label: 'Q3', x: toX(Math.floor(total * 0.5), total) },
      { label: 'Q4', x: toX(Math.floor(total * 0.75), total) },
    ];
  }, [data.h.length]);

  const lastIndex = data.h.length - 1;
  const lastHomeScore = data.h[lastIndex] || 0;
  const lastAwayScore = data.a[lastIndex] || 0;
  const lastX = toX(lastIndex, data.h.length);
  const lastHomeY = toY(lastHomeScore);
  const lastAwayY = toY(lastAwayScore);

  return (
    <View style={{ width: W, height: H }} pointerEvents="none">
      <Svg width={W} height={H}>
        <Defs>
          <SvgGradient id="homeAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={homeColor} stopOpacity="0.5" />
            <Stop offset="70%" stopColor={homeColor} stopOpacity="0.05" />
            <Stop offset="100%" stopColor={homeColor} stopOpacity="0" />
          </SvgGradient>
          <SvgGradient id="awayAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={awayColor} stopOpacity="0.35" />
            <Stop offset="70%" stopColor={awayColor} stopOpacity="0.03" />
            <Stop offset="100%" stopColor={awayColor} stopOpacity="0" />
          </SvgGradient>
        </Defs>

        {/* Y-axis ticks and labels — removed, no left/right borders */}

        {/* X-axis quarter ticks and labels */}
        {quarterPositions.map((q: { label: string; x: number }, i: number) => (
          <React.Fragment key={q.label}>
            <Line x1={q.x} y1={padT + chartH} x2={q.x} y2={padT + chartH + 4} stroke="white" strokeWidth={0.6} opacity={0.3} />
            <SvgText x={q.x} y={H - 8} fontSize={8} fill="white" opacity={0.35} textAnchor="middle" fontWeight="600" fontFamily="monospace">
              {q.label}
            </SvgText>
          </React.Fragment>
        ))}

        {/* END label */}
        <SvgText x={padL + chartW} y={H - 8} fontSize={7} fill="white" opacity={0.25} textAnchor="middle">
          END
        </SvgText>

        {/* Horizontal grid lines */}
        {[30, 60, 90].map(val => (
          <Line
            key={`hgrid-${val}`}
            x1={padL}
            y1={toY(val)}
            x2={padL + chartW}
            y2={toY(val)}
            stroke="white"
            strokeWidth={0.4}
            opacity={0.15}
            strokeDasharray="4,3"
          />
        ))}

        {/* Vertical grid lines at quarter boundaries */}
        {quarterPositions.map((q: { label: string; x: number }, i: number) => (
          <Line
            key={`vgrid-${i}`}
            x1={q.x}
            y1={padT}
            x2={q.x}
            y2={padT + chartH}
            stroke="white"
            strokeWidth={0.5}
            opacity={0.2}
            strokeDasharray="3,4"
          />
        ))}

        {/* Minor vertical grid lines (midpoints) */}
        {quarterPositions.slice(0, -1).map((q: { label: string; x: number }, i: number) => {
          const nextX = quarterPositions[i + 1]?.x ?? padL + chartW;
          const midX = (q.x + nextX) / 2;
          return (
            <Line
              key={`vgrid-minor-${i}`}
              x1={midX}
              y1={padT}
              x2={midX}
              y2={padT + chartH}
              stroke="white"
              strokeWidth={0.3}
              opacity={0.07}
              strokeDasharray="3,4"
            />
          );
        })}

        {/* Area fills (render before lines) */}
        <Path d={buildAreaPath(data.a)} fill="url(#awayAreaGrad)" opacity={0.25} />
        <Path d={buildAreaPath(data.h)} fill="url(#homeAreaGrad)" opacity={0.35} />

        {/* Data lines */}
        <Path
          d={buildBezierPath(data.a)}
          stroke={awayColor}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeDasharray="5,3"
        />
        <Path
          d={buildBezierPath(data.h)}
          stroke={homeColor}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
        />

        {/* Current point markers */}
        {data.h.length > 0 && (
          <>
            {/* Home dot */}
            <Circle cx={lastX} cy={lastHomeY} r={4} fill={homeColor} />
            {/* Home score pill */}
            <Rect x={lastX - 14} y={lastHomeY - 18} width={28} height={12} rx={3} fill={homeColor} opacity={0.7} />
            <SvgText x={lastX} y={lastHomeY - 9} fontSize={7.5} fill="#1a1a2e" fontWeight="800" textAnchor="middle" fontFamily="monospace">
              {lastHomeScore}
            </SvgText>

            {/* Away dot */}
            <Circle cx={lastX} cy={lastAwayY} r={3.5} fill={awayColor} />
            {/* Away score pill */}
            <Rect x={lastX - 14} y={lastAwayY + 6} width={28} height={12} rx={3} fill={awayColor} opacity={0.7} />
            <SvgText x={lastX} y={lastAwayY + 15} fontSize={7.5} fill="#1a1a2e" fontWeight="800" textAnchor="middle" fontFamily="monospace">
              {lastAwayScore}
            </SvgText>
          </>
        )}

        {/* Legend (top-left inside chart) */}
        <Line x1={padL + 8} y1={padT + 12} x2={padL + 22} y2={padT + 12} stroke={homeColor} strokeWidth={2} opacity={0.6} />
        <SvgText x={padL + 26} y={padT + 15} fontSize={7} fill="white" opacity={0.5}>
          {homeAbbr}
        </SvgText>
        <Line x1={padL + 8} y1={padT + 24} x2={padL + 22} y2={padT + 24} stroke={awayColor} strokeWidth={1.5} strokeDasharray="4,2" opacity={0.5} />
        <SvgText x={padL + 26} y={padT + 27} fontSize={7} fill="white" opacity={0.45}>
          {awayAbbr}
        </SvgText>
      </Svg>

      {/* Pulsing dot overlays using Reanimated */}
      {data.h.length > 0 && (
        <>
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: lastX - 6,
                top: lastHomeY - 6,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: homeColor,
              },
              homePulseStyle,
            ]}
          />
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: lastX - 5,
                top: lastAwayY - 5,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: awayColor,
              },
              awayPulseStyle,
            ]}
          />
        </>
      )}
    </View>
  );
});

// Sport → period column headers + regulation length. Linescores beyond
// regulation (extra innings, OT periods) extend the column count dynamically.
function getPeriodConfig(sport: Game['sport'], periodCount: number): { headers: string[]; totalLabel: string } {
  if (sport === 'MLB') {
    const reg = Math.max(9, periodCount);
    const headers = Array.from({ length: reg }, (_, i) => String(i + 1));
    return { headers, totalLabel: 'R' };
  }
  if (sport === 'NHL') {
    const reg = Math.max(3, periodCount);
    const headers: string[] = [];
    for (let i = 0; i < reg; i++) {
      headers.push(i < 3 ? String(i + 1) : i === 3 ? 'OT' : `OT${i - 2}`);
    }
    return { headers, totalLabel: 'T' };
  }
  if (sport === 'NCAAB' || sport === 'MLS' || sport === 'EPL') {
    const reg = Math.max(2, periodCount);
    const headers: string[] = [];
    for (let i = 0; i < reg; i++) {
      headers.push(i < 2 ? `${i + 1}H` : i === 2 ? 'OT' : `OT${i - 1}`);
    }
    return { headers, totalLabel: 'T' };
  }
  // NBA / NFL / NCAAF — quarters
  const reg = Math.max(4, periodCount);
  const headers: string[] = [];
  for (let i = 0; i < reg; i++) {
    headers.push(i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `OT${i - 3}`);
  }
  return { headers, totalLabel: 'T' };
}

function QuarterTable({ game }: { game: Game }) {
  const { homeTeam, awayTeam } = game;
  const homeLine = game.homeLinescores ?? [];
  const awayLine = game.awayLinescores ?? [];
  const periodCount = Math.max(homeLine.length, awayLine.length);
  const { headers, totalLabel } = getPeriodConfig(game.sport, periodCount);

  const homeColors = getTeamColors(homeTeam.abbreviation, game.sport as Sport, homeTeam.color);
  const awayColors = getTeamColors(awayTeam.abbreviation, game.sport as Sport, awayTeam.color);

  const homeWinning = (game.homeScore ?? 0) > (game.awayScore ?? 0);
  const awayWinning = (game.awayScore ?? 0) > (game.homeScore ?? 0);
  const tied = (game.homeScore ?? 0) === (game.awayScore ?? 0);

  const cellValue = (line: number[], i: number): string => {
    if (i >= line.length) return '';
    const v = line[i];
    return typeof v === 'number' ? String(v) : '';
  };

  return (
    <View style={styles.tableContainer}>
      {/* Header row with subtle background */}
      <View style={[styles.tableRow, { backgroundColor: 'rgba(255,255,255,0.03)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }]}>
        <View style={styles.tableTeamCell} />
        {headers.map((h, i) => (
          <View key={`${h}-${i}`} style={styles.tableScoreCell}>
            <Text style={styles.tableHeaderText}>{h}</Text>
          </View>
        ))}
        <View style={[styles.tableScoreCell, { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.06)' }]}>
          <Text style={[styles.tableHeaderText, { color: 'rgba(255,255,255,0.5)' }]}>{totalLabel}</Text>
        </View>
      </View>
      {[
        { team: homeTeam, total: game.homeScore, colors: homeColors, winning: homeWinning, line: homeLine },
        { team: awayTeam, total: game.awayScore, colors: awayColors, winning: awayWinning, line: awayLine },
      ].map(({ team, total, colors, winning, line }, ri) => (
        <View key={team.id} style={[styles.tableRow, ri === 0 && { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' }]}>
          <View style={styles.tableTeamCell}>
            <View style={{
              backgroundColor: colors.primary,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 4,
              minWidth: 42,
              alignItems: 'center' as const,
              justifyContent: 'center' as const,
            }}>
              <Text style={{
                fontSize: 11,
                fontWeight: '800',
                color: '#FFFFFF',
                letterSpacing: 0.5,
              }}>
                {team.abbreviation}
              </Text>
            </View>
          </View>
          {headers.map((_, i) => (
            <View key={i} style={styles.tableScoreCell}>
              <Text style={styles.tableScoreText}>{cellValue(line, i)}</Text>
            </View>
          ))}
          <View style={[styles.tableScoreCell, { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.06)' }]}>
            <Text style={[styles.tableTotalText, winning && !tied && { color: colors.primary }]}>{total ?? ''}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── REDACTED PREDICTION — teaser for free users, reveals NOTHING ─────────
function RedactedPrediction({ homeTeam, awayTeam, prediction, onUnlock }: {
  homeTeam: GameTeam; awayTeam: GameTeam; prediction: GamePrediction; onUnlock: () => void;
}) {
  return (
    <Pressable onPress={onUnlock}>
      <View style={{
        borderRadius: 22,
        padding: 2,
        backgroundColor: 'rgba(139,10,31,0.10)',
        overflow: 'hidden',
      }}>
        <LinearGradient
          colors={['rgba(139,10,31,0.15)', 'rgba(122,157,184,0.08)', 'rgba(139,10,31,0.12)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 22 }]}
        />
        <View style={{
          backgroundColor: '#040608',
          borderRadius: 20,
          overflow: 'hidden',
        }}>
          <View style={{ padding: 16 }}>
            {/* Header — visible, but winner replaced with redacted bar */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <View>
                <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Clutch Pick</Text>
                {/* Redacted team name — blurry bar, not the actual name */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 140, height: 18, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                    <View style={{ position: 'absolute', inset: 0, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                      <View style={{ width: '70%', height: '100%', backgroundColor: 'rgba(255,255,255,0.03)' }} />
                    </View>
                  </View>
                  <View style={{ width: 60, height: 14, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.04)' }} />
                </View>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(139,10,31,0.12)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.2)' }}>
                <Text style={{ fontSize: 8, fontWeight: '800', color: '#8B0A1F', letterSpacing: 0.8 }}>PRO</Text>
              </View>
            </View>

            {/* Confidence bar — shows shape but hides the actual number */}
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 0.8, textTransform: 'uppercase' }}>Pick Strength</Text>
                <View style={{ width: 32, height: 14, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)' }} />
              </View>
              <View style={{ flexDirection: 'row', gap: 2.5 }}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <View key={i} style={{ flex: 1, height: 5, borderRadius: 2.5, backgroundColor: i < 7 ? 'rgba(139,10,31,0.15)' : 'rgba(255,255,255,0.04)' }} />
                ))}
              </View>
            </View>

            {/* Analysis text — redacted shimmer lines, not real text */}
            <View style={{ marginBottom: 16, gap: 6 }}>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.05)', width: '95%' }} />
              <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.04)', width: '88%' }} />
              <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.035)', width: '72%' }} />
            </View>

            {/* Stat tile — visible label, redacted value */}
            <View style={{ marginBottom: 10 }}>
              <View style={[styles.statTile]}>
                <Text style={styles.statTileLabel}>Value Signal</Text>
                <View style={{ width: 52, height: 16, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 4 }} />
              </View>
            </View>
            {/* Unlock CTA inside the card */}
            <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(139,10,31,0.1)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(139,10,31,0.08)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.15)' }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(139,10,31,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 8, fontWeight: '900', color: '#8B0A1F', letterSpacing: 0.5 }}>PRO</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>Unlock Full Analysis</Text>
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Pick strength, analysis, and detailed breakdown</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── REDACTED WIN PROB — shows the bar shape but hides who's winning ──────
function RedactedWinProb({ homeTeam, awayTeam, onUnlock }: {
  homeTeam: GameTeam; awayTeam: GameTeam; onUnlock: () => void;
}) {
  const hColor = safeTeamColor(homeTeam.color);
  const aColor = safeTeamColor(awayTeam.color, '#7A9DB8');
  return (
    <Pressable onPress={onUnlock}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ fontSize: 9, fontWeight: '800', color: hColor, letterSpacing: 0.4 }}>{homeTeam.abbreviation}</Text>
          <Text style={{ fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.2, textTransform: 'uppercase' }}>Win Probability</Text>
          <Text style={{ fontSize: 9, fontWeight: '800', color: aColor, letterSpacing: 0.4 }}>{awayTeam.abbreviation}</Text>
        </View>
        {/* Bar with equal split — doesn't reveal the actual probability */}
        <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.07)', flexDirection: 'row', overflow: 'hidden', position: 'relative' }}>
          <View style={{ flex: 1, backgroundColor: `${hColor}30`, borderRadius: 5 }} />
          <View style={{ flex: 1, backgroundColor: `${aColor}30`, borderRadius: 5 }} />
          {/* Centered lock */}
          <View style={{ position: 'absolute', top: -5, left: '50%', marginLeft: -10, width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(4,6,8,0.9)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.3)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 6, fontWeight: '900', color: '#8B0A1F' }}>PRO</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── REDACTED SECTION — generic blurred section with visible header ───────
function RedactedSection({ title, height, onUnlock }: {
  title: string; height: number; onUnlock: () => void;
}) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>{title}</Text>
      <Pressable onPress={onUnlock}>
        <View style={{
          height,
          borderRadius: 16,
          backgroundColor: 'rgba(255,255,255,0.02)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.05)',
          overflow: 'hidden',
          position: 'relative',
        }}>
          {/* Simulated content shapes inside */}
          <View style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)' }} />
              <View style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)' }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.025)' }} />
              <View style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.025)' }} />
            </View>
            {height > 130 ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[1,2,3,4,5,6].map(n => (
                  <View key={n} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)' }} />
                ))}
              </View>
            ) : null}
          </View>

          {/* Frosted overlay */}
          <View style={{
            ...StyleSheet.absoluteFillObject,
            backgroundColor: 'rgba(4,6,8,0.6)',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(139,10,31,0.12)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 9, fontWeight: '900', color: '#8B0A1F', letterSpacing: 0.5 }}>PRO</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>Unlock with Clutch Pro</Text>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Tap to subscribe</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}


// Ensure a team color is visible on dark backgrounds — swap black/very dark for a fallback
function safeTeamColor(color: string, fallback: string = '#5A7A8A'): string {
  if (!color) return fallback;
  const hex = color.replace('#', '');
  if (hex.length < 6) return fallback;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // If luminance is too low, use fallback
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.15 ? fallback : color;
}

function WinProbBar({ prediction, homeTeam, awayTeam }: { prediction: GamePrediction; homeTeam: GameTeam; awayTeam: GameTeam }) {
  const dp = displayWinProbability(prediction.homeWinProbability, prediction.awayWinProbability);
  const hColor = safeTeamColor(homeTeam.color);
  const aColor = safeTeamColor(awayTeam.color, '#7A9DB8');
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', color: hColor, letterSpacing: 0.4 }}>{homeTeam.abbreviation} {dp.home}%</Text>
        <Text style={{ fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.2, textTransform: 'uppercase' }}>Win Probability</Text>
        <Text style={{ fontSize: 9, fontWeight: '800', color: aColor, letterSpacing: 0.4 }}>{dp.away}% {awayTeam.abbreviation}</Text>
      </View>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.07)', flexDirection: 'row', overflow: 'hidden' }}>
        <View style={{ flex: dp.home, backgroundColor: hColor, borderRadius: 5 }} />
        <View style={{ flex: dp.away, backgroundColor: aColor, borderRadius: 5 }} />
      </View>
    </View>
  );
}

function ConfidenceBarSegment({ index, filled }: { index: number; filled: boolean; totalFilled: number }) {
  // Use rotation on a square gradient to create seamless infinite color cycling
  // Rotation never jumps because 0° and 360° look identical
  const rot = useSharedValue(0);
  useEffect(() => {
    if (!filled) return;
    rot.value = withRepeat(
      withTiming(360, { duration: 4000, easing: Easing.linear }),
      -1,
      false
    );
  }, [filled]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));

  if (!filled) {
    return <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 3, height: 6 }} />;
  }

  // A large square gradient rotates behind the tiny segment window
  // The gradient has maroon on one side, teal on the other
  // As it spins, the colors smoothly cycle through the visible area
  return (
    <View style={{ flex: 1, borderRadius: 3, overflow: 'hidden' as const, height: 6, alignItems: 'center' as const, justifyContent: 'center' as const }}>
      <Animated.View style={[spinStyle, { width: 60, height: 60, position: 'absolute' as const }]}>
        <LinearGradient
          colors={['#5A0614', '#8B0A1F', '#7A9DB8', '#5A7A8A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

function PredictionBlock({ prediction, homeTeam, awayTeam, sport, gameId }: { prediction: GamePrediction; homeTeam: GameTeam; awayTeam: GameTeam; sport: Game['sport']; gameId: string }) {
  const router = useRouter();
  const winner = prediction.predictedWinner === 'home' ? homeTeam : awayTeam;
  const SEGS = 10;
  const conf = prediction.confidence;
  const filledSegs = Math.round((conf / 100) * SEGS);

  // Tier mapping (canonical — single source of truth in display-confidence.ts)
  const isTossUp = prediction.isTossUp || conf < 53;
  const tier = getConfidenceTier(conf, isTossUp);

  const valueLabel = prediction.valueRating >= 7 ? 'High Value' : prediction.valueRating >= 4 ? 'Fair Value' : 'Low Value';
  const valueColor = prediction.valueRating >= 7 ? '#7A9DB8' : prediction.valueRating >= 4 ? '#6B7C94' : 'rgba(255,255,255,0.3)';

  // Continuous rotation — animates from 0 to a huge number so it never resets/jumps
  const rotation = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  useEffect(() => {
    // Animate to a very large value so it spins continuously without resetting
    rotation.value = withTiming(360000, { duration: 360000 / 360 * 4500, easing: Easing.linear });
    glowPulse.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const rotatingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value % 360}deg` }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(glowPulse.value, [0, 1], [0.15, 0.4]),
    shadowRadius: interpolate(glowPulse.value, [0, 1], [8, 20]),
  }));

  const BORDER = 3.5;

  return (
    <Animated.View style={[glowStyle, {
      borderRadius: 22,
      shadowColor: '#7A9DB8',
      shadowOffset: { width: 0, height: 0 },
    }]}>
    <View style={{
      borderRadius: 22,
      overflow: 'hidden',
      position: 'relative' as const,
    }}>
      {/* ── BORDER LAYER ── */}
      {/* Static dim gradient base — visible where the beam isn't */}
      <LinearGradient
        colors={['rgba(139,10,31,0.25)', 'rgba(90,122,138,0.15)', 'rgba(139,10,31,0.25)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Rotating beam — oversized square that spins, clipped by card border radius */}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center' as const, justifyContent: 'center' as const }]} pointerEvents="none">
        <Animated.View
          style={[
            rotatingStyle,
            {
              width: 800,
              height: 800,
              position: 'absolute' as const,
            },
          ]}
        >
          {/* Top half: teal beam */}
          <LinearGradient
            colors={['transparent', 'transparent', '#7A9DB8', 'rgba(255,255,255,0.5)', '#7A9DB8', 'transparent', 'transparent']}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 0 }}
            style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 400 }}
          />
          {/* Bottom half: pure dark maroon beam — no white or teal */}
          <LinearGradient
            colors={['transparent', 'transparent', '#5A0614', '#8B0A1F', '#5A0614', 'transparent', 'transparent']}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 0 }}
            style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 400 }}
          />
        </Animated.View>
      </View>

      {/* ── INNER CARD — inset to reveal the thick border ── */}
      <View style={{
        margin: BORDER,
        backgroundColor: '#040608',
        borderRadius: 22 - BORDER,
        overflow: 'hidden',
        position: 'relative' as const,
        zIndex: 2,
      }}>
        {/* Inner glow — maroon top-left, teal top-right */}
        <View style={[StyleSheet.absoluteFill, { zIndex: 0 }]} pointerEvents="none">
          <LinearGradient
            colors={['rgba(139,10,31,0.08)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.5, y: 0.4 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(122,157,184,0.05)', 'transparent']}
            start={{ x: 1, y: 0 }}
            end={{ x: 0.5, y: 0.4 }}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Content */}
        <View style={{ padding: 22, paddingBottom: 20, position: 'relative' as const, zIndex: 1 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 16 }}>
            <View>
              <Text style={{ fontSize: 9, fontWeight: '700', color: '#8B0A1F', letterSpacing: 2, textTransform: 'uppercase' as const, marginBottom: 6 }}>
                CLUTCH PICK
              </Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 }}>
                {winner.name}
              </Text>
            </View>
            {null}
          </View>

          {/* Pick Strength */}
          <Pressable
            onPress={(e) => { e.stopPropagation(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/confidence-explained', params: { id: gameId } }); }}
            hitSlop={8}
            style={{ flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 8 }}
          >
            <Text style={{ fontSize: 9, fontWeight: '700', color: '#6B7C94', letterSpacing: 1.5, textTransform: 'uppercase' as const }}>
              PICK STRENGTH
            </Text>
            <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 }}>
              <View style={{ backgroundColor: `${tier.color}20`, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: `${tier.color}40` }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: tier.color, letterSpacing: 0.5 }}>{tier.label}</Text>
              </View>
              <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.2)' }}>›</Text>
            </View>
          </Pressable>

          {/* Confidence bar — animated segments with staggered shimmer */}
          <View style={{ flexDirection: 'row' as const, gap: 3, marginBottom: 18 }}>
            {Array.from({ length: SEGS }).map((_, i) => (
              <ConfidenceBarSegment key={i} index={i} filled={i < filledSegs} totalFilled={filledSegs} />
            ))}
          </View>

          {/* Analysis */}
          <Text style={{ fontSize: 12, color: '#A1B3C9', lineHeight: 20, marginBottom: 18 }}>
            {prediction.analysis}
          </Text>

          {/* Value Signal — full width */}
          <View style={{
            backgroundColor: 'rgba(255,255,255,0.02)',
            borderRadius: 12, padding: 14,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
          }}>
            <Text style={{ fontSize: 8, fontWeight: '700', color: '#6B7C94', letterSpacing: 1.2, textTransform: 'uppercase' as const, marginBottom: 6 }}>
              VALUE SIGNAL
            </Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: valueColor }}>
              {valueLabel}
            </Text>
            <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>Model vs. market line gap</Text>
          </View>
        </View>
      </View>
    </View>
    </Animated.View>
  );
}

function RecentForm({ game }: { game: Game }) {
  const { homeTeam, awayTeam, prediction } = game;
  if (!prediction) return null;

  const homeColors = getTeamColors(homeTeam.abbreviation, game.sport as Sport, homeTeam.color);
  const awayColors = getTeamColors(awayTeam.abbreviation, game.sport as Sport, awayTeam.color);

  return (
    <View>
      <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Recent Performance</Text>
      <View style={{ gap: 10 }}>
        {[
          { team: homeTeam, form: prediction.recentFormHome, colors: homeColors },
          { team: awayTeam, form: prediction.recentFormAway, colors: awayColors },
        ].map(({ team, form, colors }) => (
          <View key={team.id} style={styles.formCard}>
            <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 10 }}>
              {/* Team color badge — same as box score */}
              <View style={{
                backgroundColor: colors.primary,
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 4,
                minWidth: 42,
                alignItems: 'center' as const,
                justifyContent: 'center' as const,
              }}>
                <Text style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: '#FFFFFF',
                  letterSpacing: 0.5,
                }}>
                  {team.abbreviation}
                </Text>
              </View>
              <Text style={styles.formRecord}>{team.record}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }} scrollEventThrottle={16} removeClippedSubviews={true} decelerationRate="fast">
              {form.split('').filter((c: string) => c === 'W' || c === 'L').slice(0, 10).map((r: string, i: number) => (
                <View key={i} style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  backgroundColor: r === 'W' ? 'rgba(122,157,184,0.15)' : 'rgba(239,68,68,0.10)',
                  borderWidth: 1,
                  borderColor: r === 'W' ? 'rgba(122,157,184,0.3)' : 'rgba(239,68,68,0.2)',
                  alignItems: 'center' as const,
                  justifyContent: 'center' as const,
                }}>
                  <Text style={{
                    color: r === 'W' ? '#7A9DB8' : '#EF4444',
                    fontSize: 10,
                    fontWeight: '800',
                  }}>{r}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ))}
      </View>
    </View>
  );
}

function PickConfirmModal({
  visible,
  team,
  teamColor,
  jerseyType,
  sport,
  isChanging,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  team: GameTeam | null;
  teamColor: string;
  jerseyType: ReturnType<typeof sportEnumToJersey>;
  sport: Sport;
  isChanging?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const modalScale = useSharedValue(0.95);
  const jerseyScale = useSharedValue(1);
  const checkmarkScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      modalScale.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
      jerseyScale.value = 1;
      setIsConfirming(false);
      setShowCheckmark(false);
      checkmarkScale.value = 0;
    } else {
      modalScale.value = 0.95;
      jerseyScale.value = 1;
      checkmarkScale.value = 0;
    }
  }, [visible]);

  const modalStyle = useAnimatedStyle(() => ({
    transform: [{ scale: modalScale.value }],
    opacity: interpolate(modalScale.value, [0.95, 1], [0, 1]),
  }));
  const jerseyStyle = useAnimatedStyle(() => ({ transform: [{ scale: jerseyScale.value }] }));
  const checkmarkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkmarkScale.value }],
    opacity: checkmarkScale.value,
  }));

  const handleConfirm = useCallback(() => {
    setIsConfirming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Gentle scale up
    jerseyScale.value = withTiming(1.08, { duration: 400, easing: Easing.out(Easing.ease) }, () => {
      jerseyScale.value = withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) });
    });

    // Checkmark after jersey peaks
    setTimeout(() => {
      setShowCheckmark(true);
      checkmarkScale.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
    }, 400);

    // Success haptic
    setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 500);

    // Hold then close
    setTimeout(() => { onConfirm(); }, 1100);
  }, [onConfirm]);

  if (!team) return null;
  const resolvedColors = getTeamColors(team.abbreviation, sport, teamColor);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.85)' }}>
        <Pressable onPress={isConfirming ? undefined : onCancel}>
          <View style={StyleSheet.absoluteFillObject} />
        </Pressable>
        <Animated.View style={modalStyle}>
          <View style={styles.pickModal}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <Animated.View style={[jerseyStyle, { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 12 }]}>
                <JerseyIcon teamCode={team.abbreviation} sport={jerseyType} size={80} primaryColor={resolvedColors.primary} secondaryColor={resolvedColors.secondary} />
              </Animated.View>
              {showCheckmark ? (
                <Animated.View style={[checkmarkStyle, { position: 'absolute', bottom: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#7A9DB8', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#0C1018' }]}>
                  <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '900' }}>✓</Text>
                </Animated.View>
              ) : null}
            </View>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 5, textAlign: 'center' }}>{team.city} {team.name}</Text>
            <Text style={{ color: isConfirming ? '#7A9DB8' : 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: '600', marginBottom: 24, textAlign: 'center' }}>
              {isConfirming ? (isChanging ? 'Pick changed!' : 'Pick locked in') : (isChanging ? 'Switch your pick?' : 'Pick this team to win?')}
            </Text>
            {!isConfirming ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable onPress={onCancel}
                  style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleConfirm}
                  style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: resolvedColors.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700' }}>Lock It In</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const SilkThreads = React.memo(function SilkThreads() {
  // 5 threads, each with independent animation
  const threads = useMemo(() => [
    { top: '8%', rotate: '1.5deg', color: 'rgba(139,10,31,0.06)', duration: 18000, delay: 0 },
    { top: '22%', rotate: '-0.8deg', color: 'rgba(122,157,184,0.04)', duration: 22000, delay: 4000 },
    { top: '42%', rotate: '0.5deg', color: 'rgba(255,255,255,0.02)', duration: 25000, delay: 8000 },
    { top: '62%', rotate: '-1.2deg', color: 'rgba(139,10,31,0.04)', duration: 20000, delay: 12000 },
    { top: '78%', rotate: '0.8deg', color: 'rgba(122,157,184,0.03)', duration: 24000, delay: 6000 },
  ], []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {threads.map((t, i) => (
        <SilkThread key={i} {...t} />
      ))}
    </View>
  );
});

const SilkThread = React.memo(function SilkThread({
  top, rotate, color, duration, delay,
}: {
  top: string; rotate: string; color: string; duration: number; delay: number;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      translateX.value = withRepeat(
        withTiming(20, { duration, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      translateY.value = withRepeat(
        withTiming(25, { duration: duration * 1.2, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: duration * 0.15, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: duration * 0.7 }),
          withTiming(0, { duration: duration * 0.15, easing: Easing.in(Easing.ease) })
        ),
        -1,
        false
      );
    }, delay);
    return () => clearTimeout(timeout);
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        style,
        {
          position: 'absolute',
          top: top as any,
          left: '-50%',
          width: '200%',
          height: 1,
          transform: [{ rotate }],
        },
      ]}
    >
      <LinearGradient
        colors={['transparent', color, color, 'transparent']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
});

// ── Pre-game scoreboard countdown ────────────────────────────────────────────
// Shows ONLY in the 10 minutes before tip-off. After 0:00 the countdown
// disappears and the normal SCHEDULED display takes over until the backend
// flips the game LIVE.
//
// Real delays are still handled correctly: when ESPN pushes a game back, our
// transformESPNEvent picks up the new event.date, the games detail endpoint
// serves it fresh on the next burst poll, useSecondsUntil re-syncs because
// its target useMemo depends on gameTime, and the countdown smoothly restarts
// from the new tip-off. We do NOT show an explicit "DELAYED" label because
// most "SCHEDULED but past start time" cases are stale upstream data, not
// actual delays — labeling all of them DELAYED would be misleading.
const COUNTDOWN_WINDOW_SEC = 60 * 60;

function useSecondsUntil(gameTime: string): number {
  const target = useMemo(() => {
    const t = new Date(gameTime).getTime();
    return Number.isNaN(t) ? null : t;
  }, [gameTime]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target == null) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);
  if (target == null) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((target - now) / 1000));
}

// Scoreboard-style mm:ss formatter (e.g. 9:05, 0:42)
function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// In-flow pre-game countdown. Renders inside the score-panel slot during the
// pre-game window; sport-aware label, VT323 pixel digits, ticking colon.
function PreGameCountdown({ secondsLeft, sport }: { secondsLeft: number; sport?: string | null }) {
  const colonOpacity = useSharedValue(1);
  useEffect(() => {
    colonOpacity.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 500 }),
        withTiming(1.0, { duration: 500 })
      ),
      -1,
      false
    );
  }, []);
  const colonStyle = useAnimatedStyle(() => ({ opacity: colonOpacity.value }));

  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0 || secondsLeft > COUNTDOWN_WINDOW_SEC) return null;
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');

  const digitStyle = {
    fontSize: 64,
    color: '#FFFFFF',
    fontFamily: 'VT323_400Regular',
    letterSpacing: 4,
    lineHeight: 70,
    textShadowColor: 'rgba(255,255,255,0.25)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  } as const;

  return (
    <View style={{ alignItems: 'center', marginBottom: 12 }}>
      <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.45)', letterSpacing: 2.5, marginBottom: 4 }}>
        {getGameStartLabel(sport)}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={digitStyle}>{mm}</Text>
        <Animated.Text style={[digitStyle, colonStyle]}>:</Animated.Text>
        <Text style={digitStyle}>{ss}</Text>
      </View>
    </View>
  );
}

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPremium } = useSubscription();
  const [followed, setFollowed] = useState(false);

  // Load follow state from AsyncStorage on mount
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('clutch_followed_games');
        const list: string[] = raw ? JSON.parse(raw) : [];
        setFollowed(list.includes(id));
      } catch {}
    })();
  }, [id]);

  // Toggle follow with persistence
  const toggleFollow = useCallback(async () => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const raw = await AsyncStorage.getItem('clutch_followed_games');
      const list: string[] = raw ? JSON.parse(raw) : [];
      let updated: string[];
      if (list.includes(id)) {
        updated = list.filter(gId => gId !== id);
      } else {
        updated = [...list, id];
      }
      await AsyncStorage.setItem('clutch_followed_games', JSON.stringify(updated));
      setFollowed(!followed);
    } catch {}
  }, [id, followed]);
  const [screenWidth, setScreenWidth] = useState(375);
  const [pendingPick, setPendingPick] = useState<'home' | 'away' | null>(null);
  const { data: userPick } = useGamePick(id ?? '');
  const makePick = useMakePick();
  const { data: game, isLoading, error, refetch } = useGame(id ?? '') as { data: Game | null | undefined; isLoading: boolean; error: any; refetch: () => Promise<unknown> };
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Enforce a minimum spinner window so the animation is always visible,
    // even when the backend responds instantly from its in-memory cache.
    const MIN_SPINNER_MS = 700;
    try {
      await Promise.all([
        refetch(),
        new Promise((resolve) => setTimeout(resolve, MIN_SPINNER_MS)),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);
  // Tick the pre-game countdown clock — called unconditionally to respect
  // the rules of hooks. Returns +Infinity until we have a valid gameTime
  // and 0 once tip-off has passed.
  const secondsUntilStart = useSecondsUntil(game?.gameTime ?? '');
  if (isLoading) return <View style={{ flex: 1, backgroundColor: '#040608', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#7A9DB8" /></View>;
  if (error || !game) return (
    <View style={{ flex: 1, backgroundColor: '#040608', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center' }}>Unable to load game data.</Text>
      <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: '#7A9DB8', fontSize: 14, fontWeight: '700' }}>Go Back</Text></Pressable>
    </View>
  );
  const { homeTeam, awayTeam, prediction } = game;
  const isLive = game.status === 'LIVE';
  const isLiveMLB = isLive && game.sport === 'MLB' && !!game.liveState;
  const gameStarted = game.status === 'LIVE' || game.status === 'FINAL';
  // Pre-game countdown state — only true while the game is SCHEDULED and
  // tip-off is within the next 10 minutes. Drives both the LED countdown
  // visibility and the shrunk-score / dim-overlay treatment.
  const isCountingDown = game.status === 'SCHEDULED' && secondsUntilStart > 0 && secondsUntilStart <= 600;
  const jerseyType = sportEnumToJersey(game.sport);
  return (
    <View style={{ flex: 1, backgroundColor: '#040608' }} onLayout={e => setScreenWidth(e.nativeEvent.layout.width)}>
      <SilkThreads />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }} scrollEventThrottle={16} removeClippedSubviews={true} bounces={true} overScrollMode="never" decelerationRate="normal" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" colors={['#FFFFFF']} progressViewOffset={insets.top + 40} />}>
        <View style={{ overflow: 'hidden' }}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#040608' }]} />
          <LinearGradient colors={[hexToRgba(homeTeam.color, 0.5), hexToRgba(homeTeam.color, 0.28), 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.6 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['transparent', hexToRgba(awayTeam.color, 0.22), hexToRgba(awayTeam.color, 0.45)]} start={{ x: 0.45, y: 0.4 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['transparent', '#040608']} start={{ x: 0, y: 0.5 }} end={{ x: 0, y: 1 }} style={[StyleSheet.absoluteFill, { top: '55%' }]} />
          <View style={{ height: insets.top + 10 }} />
          {/* Top bar — back (absolute left) + centered combined pill */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginBottom: 10, position: 'relative' }}>
            <Pressable onPress={() => router.back()} style={[styles.backBtn, { position: 'absolute', left: 16 }]}><Text style={{ fontSize: 20, color: '#fff', lineHeight: 22 }}>‹</Text></Pressable>
            {/* Combined pill: LIVE indicator (if live) | sport badge | follow toggle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 7 }}>
              {isLive ? (<><LivePulseDot /><Text style={{ fontSize: 11, fontWeight: '800', color: '#DC2626', letterSpacing: 0.5 }}>LIVE</Text><View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 2 }} /></>) : null}
              <View style={{ backgroundColor: 'rgba(122,157,184,0.2)', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(122,157,184,0.35)' }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>{displaySport(game.sport)}</Text>
              </View>
              <View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 2 }} />
              <Pressable
                onPress={() => { Haptics.impactAsync(followed ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium); toggleFollow(); }}
                hitSlop={8}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ alignItems: 'center', marginRight: 6 }}>
                    <Text style={{ fontSize: 9, fontWeight: '800', color: followed ? '#7A9DB8' : '#FFFFFF', letterSpacing: 0.3, lineHeight: 10 }}>{followed ? 'FOLLOWING' : 'FOLLOW'}</Text>
                    <Text style={{ fontSize: 9, fontWeight: '800', color: followed ? '#7A9DB8' : '#FFFFFF', letterSpacing: 0.3, lineHeight: 10 }}>GAME</Text>
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: followed ? '#7A9DB8' : '#FFFFFF', lineHeight: 18 }}>{followed ? '✓' : '+'}</Text>
                </View>
              </Pressable>
            </View>
          </View>
          {/* Pre-game wrapper — when the game is in the 10-min countdown
              window OR delayed past tip-off, a subtle dim overlay covers the
              team headers + jersey/score area (but stops above the win-prob
              bar) to focus attention on the LED countdown. */}
          <View style={{ position: 'relative' }}>
          <View style={styles.teamNamesRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamName} numberOfLines={1}>{homeTeam.name}</Text>
              <Text style={styles.teamRecord}>{homeTeam.record}</Text>
              {isLiveMLB && game.liveState ? (
                <MLBTeamRoleBlock
                  liveState={game.liveState}
                  teamAbbr={homeTeam.abbreviation}
                  isHome={true}
                  align="left"
                />
              ) : null}
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={[styles.teamName, { color: '#fff' }]} numberOfLines={1}>{awayTeam.name}</Text>
              <Text style={[styles.teamRecord, { color: '#ffffff' }]}>{awayTeam.record}</Text>
              {isLiveMLB && game.liveState ? (
                <MLBTeamRoleBlock
                  liveState={game.liveState}
                  teamAbbr={awayTeam.abbreviation}
                  isHome={false}
                  align="right"
                />
              ) : null}
            </View>
          </View>
          <View style={{ position: 'relative' }}>

            {isLiveMLB && game.liveState ? (
              <MLBLiveCenterStack
                liveState={game.liveState}
                homeTeamAbbr={homeTeam.abbreviation}
                awayTeamAbbr={awayTeam.abbreviation}
                homeScore={game.homeScore ?? 0}
                awayScore={game.awayScore ?? 0}
                homeJersey={
                  <TappableJerseyHero
                    team={homeTeam}
                    isSelected={userPick?.pickedTeam === 'home'}
                    onSelect={() => {}}
                    isDisabled={true}
                    jerseyType={jerseyType}
                    sport={game.sport}
                  />
                }
                awayJersey={
                  <TappableJerseyHero
                    team={awayTeam}
                    isSelected={userPick?.pickedTeam === 'away'}
                    onSelect={() => {}}
                    isDisabled={true}
                    jerseyType={jerseyType}
                    sport={game.sport}
                  />
                }
              />
            ) : (
            <View style={[styles.jerseyRow, { zIndex: 1 }]}>
              <TappableJerseyHero
                team={homeTeam}
                isSelected={userPick?.pickedTeam === 'home'}
                onSelect={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingPick('home'); }}
                isDisabled={gameStarted}
                jerseyType={jerseyType}
                sport={game.sport}
              />
              <View style={styles.scorePanelOuter}>
                <View style={styles.scorePanel}>
                  {isCountingDown ? (
                    <PreGameCountdown secondsLeft={secondsUntilStart} sport={game.sport} />
                  ) : (game.status === 'LIVE' || game.status === 'FINAL') ? (
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                      <ScorePop
                        value={game.homeScore ?? 0}
                        badgeAlign="left"
                        textStyle={[styles.scoreNumber, {
                          color: (game.homeScore ?? 0) > (game.awayScore ?? 0) ? '#FFFFFF' : (game.homeScore ?? 0) === (game.awayScore ?? 0) ? '#FFFFFF' : 'rgba(255,255,255,0.25)',
                        }]}
                      />
                      <Text style={styles.scoreSep}>–</Text>
                      <ScorePop
                        value={game.awayScore ?? 0}
                        badgeAlign="right"
                        textStyle={[styles.scoreNumber, {
                          color: (game.awayScore ?? 0) > (game.homeScore ?? 0) ? '#FFFFFF' : (game.homeScore ?? 0) === (game.awayScore ?? 0) ? '#FFFFFF' : 'rgba(255,255,255,0.25)',
                        }]}
                      />
                    </View>
                  ) : null}
                  {(() => {
                    const timeStr = isLive ? formatGameTime(game.sport, game.quarter, game.clock) : null;
                    if (timeStr) {
                      return <Text style={styles.scoreClock}>{timeStr}</Text>;
                    }
                    // For non-live games, show the status (SCHEDULED / FINAL / etc.)
                    // and — for scheduled games — the actual tip-off time underneath.
                    if (game.status === 'SCHEDULED') {
                      const d = new Date(game.gameTime);
                      const now = new Date();
                      const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
                      const isToday = d.toDateString() === now.toDateString();
                      const isTomorrow = d.toDateString() === tomorrow.toDateString();
                      const dateLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                      const timeLabel = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                      return (
                        <>
                          <Text style={styles.scoreClock}>{game.status}</Text>
                          <Text style={styles.scoreClockSub}>{`${dateLabel} · ${timeLabel}`}</Text>
                        </>
                      );
                    }
                    return <Text style={styles.scoreClock}>{game.status}</Text>;
                  })()}
                </View>
              </View>
              <TappableJerseyHero
                team={awayTeam}
                isSelected={userPick?.pickedTeam === 'away'}
                onSelect={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingPick('away'); }}
                isDisabled={gameStarted}
                jerseyType={jerseyType}
                sport={game.sport}
              />
            </View>
            )}
          </View>
          </View>
          {prediction ? <View style={{ paddingTop: 20 }}><WinProbBar prediction={prediction} homeTeam={homeTeam} awayTeam={awayTeam} /></View> : null}
        </View>
        <View style={styles.content}>
          <View style={styles.venueRow}>
            <Text style={styles.venueText}>{game.venue}</Text>
            {game.tvChannel ? <View style={styles.tvBadge}><Text style={styles.tvText}>{game.tvChannel}</Text></View> : null}
          </View>
          <View style={{ marginBottom: 40 }}>
            <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Box Score</Text>
            <QuarterTable game={game} />
          </View>
          {prediction && isPremium ? (
            <>
              <View style={{ marginBottom: 40 }}><Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Our Prediction</Text><PredictionBlock prediction={prediction} homeTeam={homeTeam} awayTeam={awayTeam} sport={game.sport} gameId={game.id} /></View>
              <View style={{ marginBottom: 40 }}><RecentForm game={game} /></View>
              <Pressable onPress={() => router.push({ pathname: '/game-analysis', params: { id: game.id } })} style={styles.analysisLink}>
                <View style={styles.analysisLinkIcon}>
                  <AnalysisIcon size={20} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.analysisLinkTitle}>Why We Made This Pick</Text>
                  <Text style={styles.analysisLinkSub}>{prediction.factors.length} factors · {prediction.factors.filter(f => Math.abs(f.homeScore - f.awayScore) > 0.3).length} edges identified</Text>
                </View>
                <Text style={{ fontSize: 20, color: 'rgba(255,255,255,0.2)', fontWeight: '600' }}>›</Text>
              </Pressable>
            </>
          ) : prediction && !isPremium ? (
            <>
              {/* ═══ WIN PROBABILITY ═══ */}
              <View style={{ paddingTop: 20 }}>
                <RedactedWinProb homeTeam={homeTeam} awayTeam={awayTeam} onUnlock={() => router.push('/paywall')} />
              </View>

              {/* ═══ OUR PREDICTION ═══ */}
              <View style={{ marginBottom: 40 }}>
                <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Our Prediction</Text>
                <RedactedPrediction homeTeam={homeTeam} awayTeam={awayTeam} prediction={prediction} onUnlock={() => router.push('/paywall')} />
              </View>

              {/* Disclaimer */}
              <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, textAlign: 'center', marginTop: 8, marginBottom: 4 }}>
                AI prediction for entertainment only. Not gambling advice.
              </Text>

              {/* ═══ RECENT PERFORMANCE ═══ */}
              <RedactedSection title="Recent Performance" height={160} onUnlock={() => router.push('/paywall')} />

              {/* ═══ WHY WE MADE THIS PICK ═══ */}
              <Pressable
                onPress={() => router.push('/paywall')}
                style={styles.analysisLink}
              >
                <View style={styles.analysisLinkIcon}>
                  <AnalysisIcon size={20} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.analysisLinkTitle}>Why We Made This Pick</Text>
                  <Text style={styles.analysisLinkSub}>{prediction.factors.length} factors · {prediction.factors.filter(f => Math.abs(f.homeScore - f.awayScore) > 0.3).length} edges identified</Text>
                </View>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(139,10,31,0.12)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.2)' }}>
                  <Text style={{ fontSize: 8, fontWeight: '800', color: '#8B0A1F', letterSpacing: 0.5 }}>PRO</Text>
                </View>
              </Pressable>
            </>
          ) : null}
          <View style={{ marginTop: 16, marginBottom: 8, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', textAlign: 'center', lineHeight: 15 }}>
              AI predictions are for entertainment purposes only. Not financial advice.
            </Text>
          </View>
        </View>
      </ScrollView>
      <PickConfirmModal
        visible={pendingPick !== null}
        team={pendingPick === 'home' ? homeTeam : pendingPick === 'away' ? awayTeam : null}
        teamColor={pendingPick === 'home' ? homeTeam.color : awayTeam.color}
        jerseyType={jerseyType}
        sport={game.sport as Sport}
        isChanging={!!userPick && userPick.pickedTeam !== pendingPick}
        onConfirm={() => {
          if (pendingPick && id) {
            makePick.mutate({
              gameId: id,
              pickedTeam: pendingPick,
              homeTeam: game.homeTeam.abbreviation,
              awayTeam: game.awayTeam.abbreviation,
              sport: game.sport,
            });
          }
          setPendingPick(null);
        }}
        onCancel={() => setPendingPick(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  liveText: { fontSize: 10, fontWeight: '800', color: '#FF3B30', letterSpacing: 0.8 },
  pillDivider: { width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.3)' },
  pillMeta: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.4 },
  followBtn: { height: 36, borderRadius: 10, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  followIcon: { fontSize: 13 },
  followText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  teamNamesRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12, gap: 12 },
  teamName: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: -0.3, lineHeight: 22 },
  teamRecord: { fontSize: 12, color: '#ffffff', marginTop: 2 },
  jerseyRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16 },
  scoringWatermark: { position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -190 }, { translateY: -110 }], zIndex: 0, opacity: 0.5 },
  scorePanelOuter: { flex: 1, alignItems: 'center', paddingBottom: 8 },
  scorePanel: { paddingHorizontal: 22, paddingVertical: 14, alignItems: 'center' },
  scoreNumber: { fontSize: 72, fontFamily: 'VT323_400Regular', lineHeight: 78, letterSpacing: 2 },
  scoreNumberShrunk: { fontSize: 54, lineHeight: 60 },
  scoreSep: { fontSize: 28, color: 'rgba(255,255,255,0.25)', fontWeight: '300', lineHeight: 78 },
  scoreSepShrunk: { fontSize: 22, lineHeight: 60 },
  scoreClock: { fontSize: 16, color: '#FFFFFF', fontFamily: 'VT323_400Regular', marginTop: 6, letterSpacing: 2, textTransform: 'uppercase' },
  scoreClockSub: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontFamily: 'VT323_400Regular', marginTop: 2, letterSpacing: 1.5, textTransform: 'uppercase' },
  content: { paddingHorizontal: 16, paddingTop: 4 },
  venueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  venueText: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '500' },
  tvBadge: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  tvText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.35)' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  sectionMicroLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' },
  chartLegendText: { fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: '700' },
  chartContainer: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  tableContainer: { backgroundColor: 'rgba(255,255,255,0.025)', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  tableRow: { flexDirection: 'row', alignItems: 'center' },
  tableTeamCell: { width: 85, paddingVertical: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  tableTeamLogo: { width: 20, height: 20 },
  tableTeamAbbr: { fontSize: 13, fontWeight: '800' },
  tableScoreCell: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tableHeaderText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' },
  tableScoreText: { fontSize: 22, fontFamily: 'VT323_400Regular', color: 'rgba(255,255,255,0.5)', letterSpacing: 1 },
  tableTotalText: { fontSize: 28, fontFamily: 'VT323_400Regular', color: '#FFFFFF', letterSpacing: 1 },
  predictionContainer: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.06)' },
  predIconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: 'rgba(255,255,255,0.1)' },
  predLabel: { fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.2, textTransform: 'uppercase' },
  exclusiveBadge: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  exclusiveText: { fontSize: 7, fontWeight: '800', color: '#fff', letterSpacing: 0.6 },
  predPickText: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: -0.3 },
  statTile: { flex: 1, minWidth: '45%', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 9, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  statTileLabel: { fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.28)', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  statTileValue: { fontSize: 15, fontWeight: '900', letterSpacing: -0.3 },
  oddsRow: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 9, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  oddsRowLabel: { fontSize: 8, color: 'rgba(255,255,255,0.25)', fontWeight: '700', marginBottom: 2 },
  oddsRowValue: { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: -0.3 },
  oddsDelta: { fontSize: 9, fontWeight: '700' },
  formCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  formAbbr: { fontSize: 11, fontWeight: '800' },
  formRecord: { fontSize: 8, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' },
  formPip: { flex: 1, height: 20, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  formPipText: { fontSize: 8, fontWeight: '900' },
  analysisLink: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  analysisLinkIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(122,157,184,0.15)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  analysisLinkTitle: { fontSize: 14, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },
  analysisLinkSub: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 },
  pickModal: { backgroundColor: '#0a0a0a', borderRadius: 20, padding: 24, width: 300, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
});
