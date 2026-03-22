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
  TouchableWithoutFeedback,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { useGamePick, useMakePick } from '@/hooks/usePicks';
import { AnalysisIcon } from '@/components/icons/AnalysisIcon';
import { getTeamColors } from '@/lib/team-colors';
import { useSubscription } from '@/lib/subscription-context';

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
  const teamColors = getTeamColors(team.abbreviation, sport as any, team.color);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    if (isDisabled) return;

    // Premium haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Bounce animation matching GameCard
    scale.value = withSpring(0.92, { damping: 15 }, () => {
      scale.value = withSpring(1.03, { damping: 12 }, () => {
        scale.value = withSpring(1, { damping: 10 });
      });
    });

    onSelect();
  }, [isDisabled, onSelect, scale]);

  const shadowStyle = useMemo(() => {
    const baseStyle = {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.8,
      shadowRadius: 16,
      elevation: 16,
    };

    if (isSelected) {
      return {
        ...baseStyle,
        shadowColor: '#E8936A',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 16,
        elevation: 14,
      };
    }

    return baseStyle;
  }, [isSelected]);

  return (
    <Pressable onPress={handlePress} disabled={isDisabled}>
      <Animated.View style={[containerStyle, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ position: 'relative' }}>
          <View style={shadowStyle}>
            <JerseyIcon
              teamCode={team.abbreviation}
              primaryColor={teamColors.primary}
              secondaryColor={teamColors.secondary}
              size={92}
              sport={jerseyType}
            />
          </View>

          {/* Checkmark badge when selected */}
          {isSelected ? (
            <View style={{
              position: 'absolute',
              bottom: -4,
              right: -4,
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: '#E8936A',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: '#080810',
            }}>
              <Text style={{ color: '#000', fontSize: 11, fontWeight: '900' }}>✓</Text>
            </View>
          ) : null}
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

function QuarterTable({ game }: { game: Game }) {
  const { homeTeam, awayTeam } = game;
  const isLive = game.status === 'LIVE', isFinal = game.status === 'FINAL';
  const getQScore = (score: number | undefined) => score === undefined ? '' : (isLive || isFinal) ? String(Math.round(score / 4)) : '';
  return (
    <View style={styles.tableContainer}>
      <View style={styles.tableRow}>
        <View style={styles.tableTeamCell} />
        {['Q1', 'Q2', 'Q3', 'Q4', 'T'].map(q => <View key={q} style={styles.tableScoreCell}><Text style={[styles.tableHeaderText, q === 'T' && { color: 'rgba(255,255,255,0.45)' }]}>{q}</Text></View>)}
      </View>
      {[{ team: homeTeam, total: game.homeScore }, { team: awayTeam, total: game.awayScore }].map(({ team, total }, ri) => (
        <View key={team.id} style={[styles.tableRow, ri === 0 && { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' }]}>
          <View style={styles.tableTeamCell}>
            {team.logo ? <Image source={{ uri: team.logo }} style={styles.tableTeamLogo} /> : null}
            <Text style={[styles.tableTeamAbbr, { color: team.color }]}>{team.abbreviation}</Text>
          </View>
          {[0, 1, 2, 3].map(qi => <View key={qi} style={styles.tableScoreCell}><Text style={styles.tableScoreText}>{getQScore(total)}</Text></View>)}
          <View style={styles.tableScoreCell}><Text style={styles.tableTotalText}>{total ?? ''}</Text></View>
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
      <View style={styles.predictionContainer}>
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
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(232,147,106,0.12)', borderWidth: 1, borderColor: 'rgba(232,147,106,0.2)' }}>
              <Text style={{ fontSize: 8, fontWeight: '800', color: '#E8936A', letterSpacing: 0.8 }}>PRO</Text>
            </View>
          </View>

          {/* Confidence bar — shows shape but hides the actual number */}
          <View style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 0.8, textTransform: 'uppercase' }}>Confidence</Text>
              <View style={{ width: 32, height: 14, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)' }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 2.5 }}>
              {Array.from({ length: 12 }).map((_, i) => (
                <View key={i} style={{ flex: 1, height: 5, borderRadius: 2.5, backgroundColor: i < 7 ? 'rgba(232,147,106,0.15)' : 'rgba(255,255,255,0.04)' }} />
              ))}
            </View>
          </View>

          {/* Analysis text — redacted shimmer lines, not real text */}
          <View style={{ marginBottom: 16, gap: 6 }}>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.05)', width: '95%' }} />
            <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.04)', width: '88%' }} />
            <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.035)', width: '72%' }} />
          </View>

          {/* Stat tiles — visible labels, redacted values */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <View style={[styles.statTile, { flex: 1 }]}>
              <Text style={styles.statTileLabel}>Edge Rating</Text>
              <View style={{ width: 36, height: 16, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 4 }} />
            </View>
            <View style={[styles.statTile, { flex: 1 }]}>
              <Text style={styles.statTileLabel}>Value Signal</Text>
              <View style={{ width: 52, height: 16, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 4 }} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={[styles.statTile, { flex: 1 }]}>
              <Text style={styles.statTileLabel}>Spread</Text>
              <View style={{ width: 28, height: 16, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 4 }} />
            </View>
            <View style={[styles.statTile, { flex: 1 }]}>
              <Text style={styles.statTileLabel}>Over/Under</Text>
              <View style={{ width: 40, height: 16, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 4 }} />
            </View>
          </View>

          {/* Unlock CTA inside the card */}
          <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(232,147,106,0.1)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(232,147,106,0.08)', borderWidth: 1, borderColor: 'rgba(232,147,106,0.15)' }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(232,147,106,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 8, fontWeight: '900', color: '#E8936A', letterSpacing: 0.5 }}>PRO</Text>
              </View>
              <View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>Unlock Full Analysis</Text>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Confidence, stats, and detailed breakdown</Text>
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
  return (
    <Pressable onPress={onUnlock}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ fontSize: 9, fontWeight: '800', color: homeTeam.color, letterSpacing: 0.4 }}>{homeTeam.abbreviation}</Text>
          <Text style={{ fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.2, textTransform: 'uppercase' }}>Win Probability</Text>
          <Text style={{ fontSize: 9, fontWeight: '800', color: awayTeam.color, letterSpacing: 0.4 }}>{awayTeam.abbreviation}</Text>
        </View>
        {/* Bar with equal split — doesn't reveal the actual probability */}
        <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.07)', flexDirection: 'row', overflow: 'hidden', position: 'relative' }}>
          <View style={{ flex: 1, backgroundColor: `${homeTeam.color}30`, borderRadius: 5 }} />
          <View style={{ flex: 1, backgroundColor: `${awayTeam.color}30`, borderRadius: 5 }} />
          {/* Centered lock */}
          <View style={{ position: 'absolute', top: -5, left: '50%', marginLeft: -10, width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(4,6,8,0.9)', borderWidth: 1, borderColor: 'rgba(232,147,106,0.3)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 6, fontWeight: '900', color: '#E8936A' }}>PRO</Text>
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
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(232,147,106,0.12)', borderWidth: 1, borderColor: 'rgba(232,147,106,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 9, fontWeight: '900', color: '#E8936A', letterSpacing: 0.5 }}>PRO</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>Unlock with PRO</Text>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Tap to subscribe</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}


function WinProbBar({ prediction, homeTeam, awayTeam }: { prediction: GamePrediction; homeTeam: GameTeam; awayTeam: GameTeam }) {
  const hp = prediction.homeWinProbability, ap = prediction.awayWinProbability;
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', color: homeTeam.color, letterSpacing: 0.4 }}>{homeTeam.abbreviation} {hp}%</Text>
        <Text style={{ fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.2, textTransform: 'uppercase' }}>Win Probability</Text>
        <Text style={{ fontSize: 9, fontWeight: '800', color: awayTeam.color, letterSpacing: 0.4 }}>{ap}% {awayTeam.abbreviation}</Text>
      </View>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.07)', flexDirection: 'row', overflow: 'hidden' }}>
        <View style={{ flex: hp, backgroundColor: homeTeam.color, borderRadius: 5 }} />
        <View style={{ flex: ap, backgroundColor: awayTeam.color, borderRadius: 5 }} />
      </View>
    </View>
  );
}

function PredictionBlock({ prediction, homeTeam, awayTeam, sport }: { prediction: GamePrediction; homeTeam: GameTeam; awayTeam: GameTeam; sport: Game['sport'] }) {
  const winner = prediction.predictedWinner === 'home' ? homeTeam : awayTeam;
  const SEGS = 12, filledSegs = Math.round((prediction.confidence / 100) * SEGS);

  // Value signal based on valueRating (1-10) not edgeRating
  const valueLabel = prediction.valueRating >= 7 ? 'High Value' : prediction.valueRating >= 4 ? 'Fair Value' : 'Low Value';
  const valueColor = prediction.valueRating >= 7 ? '#4ADE80' : prediction.valueRating >= 4 ? '#E8936A' : 'rgba(255,255,255,0.4)';

  return (
    <View style={styles.predictionContainer}>
      <View style={{ padding: 16 }}>
        {/* Clean header — no emoji, no icon clutter */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <View>
            <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Clutch Pick</Text>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.3 }}>{winner.city} {winner.name}</Text>
          </View>
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(232,147,106,0.12)', borderWidth: 1, borderColor: 'rgba(232,147,106,0.2)' }}>
            <Text style={{ fontSize: 8, fontWeight: '800', color: '#E8936A', letterSpacing: 0.8 }}>PRO</Text>
          </View>
        </View>

        {/* Confidence bar */}
        <View style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 0.8, textTransform: 'uppercase' }}>Confidence</Text>
            <Text style={{ fontSize: 15, fontWeight: '900', color: '#FFFFFF' }}>{prediction.confidence}%</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 2.5 }}>
            {Array.from({ length: SEGS }).map((_, i) => (
              <View key={i} style={{ flex: 1, height: 5, borderRadius: 2.5, backgroundColor: i < filledSegs ? '#E8936A' : 'rgba(255,255,255,0.07)' }} />
            ))}
          </View>
        </View>

        {/* Analysis text */}
        <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 20, marginBottom: 16 }}>{prediction.analysis}</Text>

        {/* Stat tiles — clean 2-column */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
          <View style={[styles.statTile, { flex: 1 }]}>
            <Text style={styles.statTileLabel}>Edge Rating</Text>
            <Text style={[styles.statTileValue, { color: '#FFFFFF' }]}>{prediction.edgeRating}/10</Text>
          </View>
          <View style={[styles.statTile, { flex: 1 }]}>
            <Text style={styles.statTileLabel}>Value Signal</Text>
            <Text style={[styles.statTileValue, { color: valueColor }]}>{valueLabel}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={[styles.statTile, { flex: 1 }]}>
            <Text style={styles.statTileLabel}>Spread</Text>
            <Text style={[styles.statTileValue, { color: '#FFFFFF' }]}>{prediction.spread > 0 ? '+' : ''}{prediction.spread}</Text>
          </View>
          <View style={[styles.statTile, { flex: 1 }]}>
            <Text style={styles.statTileLabel}>Over/Under</Text>
            <Text style={[styles.statTileValue, { color: '#FFFFFF' }]}>{prediction.overUnder}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function MarketOdds({ game }: { game: Game }) {
  const { homeTeam, awayTeam, prediction } = game;
  if (!prediction) return null;
  const items = [{ label: `${homeTeam.abbreviation} ML`, value: prediction.marketFavorite === 'home' ? '145' : '+122', delta: '5', dc: '#FF5C5C' }, { label: `${awayTeam.abbreviation} ML`, value: prediction.marketFavorite === 'away' ? '145' : '+122', delta: '3', dc: '#4ADE80' }, { label: 'Spread', value: String(prediction.spread), delta: '', dc: 'rgba(255,255,255,0.2)' }, { label: 'O/U', value: String(prediction.overUnder), delta: '', dc: 'rgba(255,255,255,0.2)' }];
  return (
    <View>
      <Text style={styles.sectionLabel}>Market Odds</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
        {items.map(({ label, value, delta, dc }) => (
          <View key={label} style={[styles.oddsRow, { width: '48%' }]}>
            <View><Text style={styles.oddsRowLabel}>{label}</Text><Text style={styles.oddsRowValue}>{value}</Text></View>
            <Text style={[styles.oddsDelta, { color: dc }]}>{delta}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function RecentForm({ game }: { game: Game }) {
  const { homeTeam, awayTeam, prediction } = game;
  if (!prediction) return null;
  return (
    <View>
      <Text style={styles.sectionLabel}>Recent Performance</Text>
      <View style={{ gap: 7 }}>
        {[{ team: homeTeam, form: prediction.recentFormHome }, { team: awayTeam, form: prediction.recentFormAway }].map(({ team, form }) => (
          <View key={team.id} style={styles.formCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              {team.logo ? <Image source={{ uri: team.logo }} style={{ width: 16, height: 16 }} resizeMode="contain" /> : null}
              <Text style={[styles.formAbbr, { color: team.color }]}>{team.abbreviation}</Text>
              <Text style={styles.formRecord}>{team.record}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }} scrollEventThrottle={16} removeClippedSubviews={true} decelerationRate="fast">
              {form.split('').filter(c => c === 'W' || c === 'L').slice(0, 10).map((r, i) => (
                <View key={i} style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: r === 'W' ? 'rgba(122,157,184,0.2)' : 'rgba(232,147,106,0.2)',
                  borderWidth: 1,
                  borderColor: r === 'W' ? 'rgba(122,157,184,0.4)' : 'rgba(232,147,106,0.4)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Text style={{
                    color: '#FFFFFF',
                    fontSize: 11,
                    fontWeight: '900',
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
  isChanging,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  team: GameTeam | null;
  teamColor: string;
  jerseyType: ReturnType<typeof sportEnumToJersey>;
  isChanging?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const modalScale = useSharedValue(0.9);
  const jerseyScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);
  const checkmarkScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      modalScale.value = withSpring(1, { damping: 15, stiffness: 200 });
      setIsConfirming(false);
      setShowCheckmark(false);
      glowOpacity.value = 0;
      checkmarkScale.value = 0;
      jerseyScale.value = 1;
    } else {
      modalScale.value = 0.9;
    }
  }, [visible]);

  const modalStyle = useAnimatedStyle(() => ({ transform: [{ scale: modalScale.value }] }));
  const jerseyStyle = useAnimatedStyle(() => ({ transform: [{ scale: jerseyScale.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ shadowOpacity: glowOpacity.value }));
  const checkmarkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkmarkScale.value }],
    opacity: checkmarkScale.value,
  }));

  const handleConfirm = useCallback(() => {
    setIsConfirming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    jerseyScale.value = withSpring(0.92, { damping: 15 }, () => {
      jerseyScale.value = withSpring(1.03, { damping: 12 }, () => {
        jerseyScale.value = withSpring(1, { damping: 10 });
      });
    });
    glowOpacity.value = withTiming(0.9, { duration: 250 });
    setTimeout(() => {
      setShowCheckmark(true);
      checkmarkScale.value = withSpring(1, { damping: 12, stiffness: 300 });
    }, 150);
    setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 300);
    setTimeout(() => { onConfirm(); }, 500);
  }, [onConfirm]);

  if (!team) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.88)' }}>
        <TouchableWithoutFeedback onPress={isConfirming ? undefined : onCancel}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>
        <Animated.View style={modalStyle}>
          <View style={styles.pickModal}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <Animated.View style={[jerseyStyle, glowStyle, { shadowColor: '#E8936A', shadowOffset: { width: 0, height: 0 }, shadowRadius: 15, elevation: 12 }]}>
                <JerseyIcon teamCode={team.abbreviation} sport={jerseyType} size={80} primaryColor={team.color} />
              </Animated.View>
              {showCheckmark ? (
                <Animated.View style={[checkmarkStyle, { position: 'absolute', bottom: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#E8936A', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#000' }]}>
                  <Text style={{ color: '#000', fontSize: 11, fontWeight: '900' }}>✓</Text>
                </Animated.View>
              ) : null}
            </View>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 5, textAlign: 'center' }}>{team.city} {team.name}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 24, textAlign: 'center' }}>
              {isConfirming ? (isChanging ? 'Pick changed!' : 'Winner selected!') : (isChanging ? 'Switch your pick?' : 'Select as winner?')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={onCancel} disabled={isConfirming} activeOpacity={0.7}
                style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center', opacity: isConfirming ? 0.3 : 1 }}>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleConfirm} disabled={isConfirming} activeOpacity={0.8}
                style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: isConfirming ? '#4CAF50' : '#E8936A', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: isConfirming ? '#fff' : '#000', fontSize: 15, fontWeight: '700' }}>{isConfirming ? 'Done' : (isChanging ? 'Switch' : 'Confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
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
  const { data: game, isLoading, error } = useQuery<Game>({
    queryKey: ['game', id],
    queryFn: async () => {
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
      const res = await fetch(`${baseUrl}/api/games/id/${id}`);
      if (!res.ok) throw new Error('Failed to fetch game');
      const json = await res.json();
      return json.data ?? json;
    },
    enabled: !!id,
    refetchInterval: (query) => (query.state.data as Game | undefined)?.status === 'LIVE' ? 30000 : false,
  });
  if (isLoading) return <View style={{ flex: 1, backgroundColor: '#080810', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#7A9DB8" /></View>;
  if (error || !game) return (
    <View style={{ flex: 1, backgroundColor: '#080810', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center' }}>Unable to load game data.</Text>
      <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: '#7A9DB8', fontSize: 14, fontWeight: '700' }}>Go Back</Text></Pressable>
    </View>
  );
  const { homeTeam, awayTeam, prediction } = game;
  const isLive = game.status === 'LIVE';
  const gameStarted = game.status === 'LIVE' || game.status === 'FINAL';
  const jerseyType = sportEnumToJersey(game.sport);
  return (
    <View style={{ flex: 1, backgroundColor: '#080810' }} onLayout={e => setScreenWidth(e.nativeEvent.layout.width)}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }} scrollEventThrottle={16} removeClippedSubviews={true} bounces={true} overScrollMode="never" decelerationRate="normal">
        <View style={{ overflow: 'hidden' }}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0D0D18' }]} />
          <LinearGradient colors={[hexToRgba(homeTeam.color, 0.5), hexToRgba(homeTeam.color, 0.28), 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.6 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['transparent', hexToRgba(awayTeam.color, 0.22), hexToRgba(awayTeam.color, 0.45)]} start={{ x: 0.45, y: 0.4 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['transparent', '#080810']} start={{ x: 0, y: 0.5 }} end={{ x: 0, y: 1 }} style={[StyleSheet.absoluteFill, { top: '55%' }]} />
          <View style={{ height: insets.top + 10 }} />
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}><Text style={{ fontSize: 20, color: '#fff', lineHeight: 22 }}>‹</Text></Pressable>
            <View style={styles.livePill}>
              {isLive ? (<><LivePulseDot /><Text style={styles.liveText}>LIVE</Text><View style={styles.pillDivider} /></>) : null}
              <Text style={styles.pillMeta}>{game.sport}{isLive && game.quarter ? ` · ${game.quarter}` : ''}{isLive && game.clock ? ` · ${game.clock}` : ''}</Text>
            </View>
            <Pressable onPress={toggleFollow} style={[styles.followBtn, followed && { backgroundColor: hexToRgba(homeTeam.color, 0.22), borderColor: hexToRgba(homeTeam.color, 0.5) }]}>
              <Text style={[styles.followIcon, { color: followed ? homeTeam.color : '#fff' }]}>{followed ? '✓' : '+'}</Text>
              <Text style={[styles.followText, { color: '#fff' }]}>{followed ? 'Added' : 'Follow'}</Text>
            </Pressable>
          </View>
          <View style={styles.teamNamesRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamName} numberOfLines={1}>{homeTeam.name}</Text>
              <Text style={styles.teamRecord}>{homeTeam.record}</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={[styles.teamName, { color: '#fff' }]} numberOfLines={1}>{awayTeam.name}</Text>
              <Text style={[styles.teamRecord, { color: '#ffffff' }]}>{awayTeam.record}</Text>
            </View>
          </View>
          <View style={{ position: 'relative' }}>
            {/* Scoring Flow Chart Watermark - behind jerseys */}
            <View style={styles.scoringWatermark} pointerEvents="none">
              <ScoringFlowChartWatermark
                homeColor={homeTeam.color}
                awayColor={awayTeam.color}
                homeAbbr={homeTeam.abbreviation}
                awayAbbr={awayTeam.abbreviation}
                isLive={isLive}
              />
            </View>
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
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={[styles.scoreNumber, { color: '#fff', textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 }]}>{game.homeScore ?? ''}</Text>
                    <Text style={styles.scoreSep}>–</Text>
                    <Text style={[styles.scoreNumber, { color: 'rgba(255,255,255,0.75)', textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 }]}>{game.awayScore ?? ''}</Text>
                  </View>
                  {isLive && game.quarter && game.clock
                    ? <Text style={[styles.scoreClock, { textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 }]}>{game.quarter} · {game.clock}</Text>
                    : <Text style={[styles.scoreClock, { textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 }]}>{game.status}</Text>}
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
          </View>
          {prediction ? <View style={{ paddingTop: 20 }}><WinProbBar prediction={prediction} homeTeam={homeTeam} awayTeam={awayTeam} /></View> : null}
        </View>
        <View style={styles.content}>
          <View style={styles.venueRow}>
            <Text style={styles.venueText}>{game.venue}</Text>
            {game.tvChannel ? <View style={styles.tvBadge}><Text style={styles.tvText}>{game.tvChannel}</Text></View> : null}
          </View>
          <View style={{ marginBottom: 22 }}>
            <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Box Score</Text>
            <QuarterTable game={game} />
          </View>
          {prediction && isPremium ? (
            <>
              <View style={{ paddingTop: 20 }}><WinProbBar prediction={prediction} homeTeam={homeTeam} awayTeam={awayTeam} /></View>
              <View style={{ marginBottom: 22 }}><Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Our Prediction</Text><PredictionBlock prediction={prediction} homeTeam={homeTeam} awayTeam={awayTeam} sport={game.sport} /></View>
              <View style={{ marginBottom: 22 }}><MarketOdds game={game} /></View>
              <View style={{ marginBottom: 22 }}><RecentForm game={game} /></View>
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
              <View style={{ marginBottom: 22 }}>
                <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Our Prediction</Text>
                <RedactedPrediction homeTeam={homeTeam} awayTeam={awayTeam} prediction={prediction} onUnlock={() => router.push('/paywall')} />
              </View>

              {/* ═══ MARKET ODDS ═══ */}
              <RedactedSection title="Market Odds" height={120} onUnlock={() => router.push('/paywall')} />

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
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(232,147,106,0.12)', borderWidth: 1, borderColor: 'rgba(232,147,106,0.2)' }}>
                  <Text style={{ fontSize: 8, fontWeight: '800', color: '#E8936A', letterSpacing: 0.5 }}>PRO</Text>
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
        isChanging={!!userPick && userPick.pickedTeam !== pendingPick}
        onConfirm={() => {
          if (pendingPick && id) {
            makePick.mutate({ gameId: id, pickedTeam: pendingPick });
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
  scoreNumber: { fontSize: 34, fontWeight: '900', lineHeight: 48, letterSpacing: -1.5 },
  scoreSep: { fontSize: 14, color: 'rgba(255,255,255,0.2)', fontWeight: '300', lineHeight: 48 },
  scoreClock: { fontSize: 15, color: '#ffffff', fontWeight: '700', marginTop: 4, letterSpacing: 0.6, textTransform: 'uppercase' },
  content: { paddingHorizontal: 16, paddingTop: 4 },
  venueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  venueText: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '500' },
  tvBadge: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  tvText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.35)' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' },
  sectionMicroLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' },
  chartLegendText: { fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: '700' },
  chartContainer: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  tableContainer: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  tableRow: { flexDirection: 'row', alignItems: 'center' },
  tableTeamCell: { width: 80, paddingVertical: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tableTeamLogo: { width: 20, height: 20 },
  tableTeamAbbr: { fontSize: 13, fontWeight: '800' },
  tableScoreCell: { flex: 1, alignItems: 'center', paddingVertical: 11 },
  tableHeaderText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: 'rgba(255,255,255,0.4)' },
  tableScoreText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  tableTotalText: { fontSize: 17, fontWeight: '900', color: '#fff' },
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
  formCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 9, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
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
