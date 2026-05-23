import { ActivityIndicator, FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { memo } from 'react';
import { useGame } from '@/hooks/useGames';
import { displayConfidence, displayWinProbability } from '@/lib/display-confidence';
import { displayPredictionAnalysis } from '@/lib/narrative-display';
import { cleanProjectionCopy, getProjectionDisplay, getProjectionRiskTier } from '@/lib/projection-display';
import { getPredictionDisplay } from '@/lib/prediction-display';
import {
  getCanonicalConfidence,
  getCanonicalResult,
  getCanonicalWinProbabilities,
} from '@/lib/canonical-result';
import type { CanonicalPredictionResult, Prediction } from '@/types/sports';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { useSubscription } from '@/lib/subscription-context';

const MAROON = '#8B0A1F';
const MAROON_DIM = 'rgba(139,10,31,0.12)';
const TEAL = '#7A9DB8';
const BG = '#040608';

interface PredictionFactor {
  name: string;
  weight: number;
  homeScore: number;
  awayScore: number;
  description: string;
}

interface GameTeam {
  id: string;
  name: string;
  abbreviation: string;
  city: string;
  record: string;
  color: string;
  logo?: string;
}

interface GamePrediction {
  canonicalResult?: CanonicalPredictionResult;
  predictedWinner: 'home' | 'away';
  predictedOutcome?: 'home' | 'away' | 'draw';
  confidence: number;
  analysis: string;
  spread: number;
  overUnder: number;
  edgeRating: number;
  valueRating: number;
  homeWinProbability: number;
  awayWinProbability: number;
  factors: PredictionFactor[];
  isTossUp?: boolean;
  projection?: {
    engine: string;
    iterations: number;
    homeWinProbability: number;
    awayWinProbability: number;
    drawProbability?: number;
    projectedHomeScore: number;
    projectedAwayScore: number;
    projectedSpread: number;
    projectedTotal: number;
    volatility: number;
    upsetRisk: number;
    signals: Array<{
      key: string;
      label: string;
      value: number;
      evidence: string;
    }>;
  };
}

interface Game {
  id: string;
  sport?: string;
  homeTeam: GameTeam;
  awayTeam: GameTeam;
  seasonContext?: {
    phase: string;
    label: string;
    detail: string;
    source: string;
  } | null;
  prediction?: GamePrediction;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function factorDelta(factor: PredictionFactor): number {
  return factor.homeScore - factor.awayScore;
}

function factorImpactPercent(factor: PredictionFactor): number {
  const scoreImpact = Math.abs(factorDelta(factor)) * 42;
  const weightImpact = factor.weight * 100;
  return Math.round(clampPercent(Math.max(scoreImpact, weightImpact)));
}

function scoreShare(left: number, right: number): number {
  const total = Math.abs(left) + Math.abs(right);
  if (total <= 0) return 50;
  return clampPercent((Math.abs(left) / total) * 100);
}

// SVG Factor Icons - clean line art, no emojis
function FactorSvgIcon({ name, size = 18 }: { name: string; size?: number }) {
  const color = 'rgba(255,255,255,0.5)';
  const n = name.toLowerCase();

  if (n.includes('home') && n.includes('away'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M3 12L12 3l9 9" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><Path d="M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9" stroke={color} strokeWidth="1.8" /></Svg>;

  if (n.includes('injur'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" stroke={color} strokeWidth="1.8" strokeLinecap="round" /><Path d="M12 11v5m-2.5-2.5h5" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  if (n.includes('form') || n.includes('recent'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M3 17l4-4 4 4 4-8 6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  if (n.includes('head'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  if (n.includes('streak'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  if (n.includes('elo'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" /><Path d="M12 7v5l3 3" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  if (n.includes('win'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M6 9H3a1 1 0 01-1-1V5a1 1 0 011-1h3m12 5h3a1 1 0 001-1V5a1 1 0 00-1-1h-3M6 4h12v7a6 6 0 01-12 0V4zm3 17h6m-3-3v3" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  if (n.includes('point') || n.includes('diff'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M18 20V10M12 20V4M6 20v-6" stroke={color} strokeWidth="2" strokeLinecap="round" /></Svg>;

  if (n.includes('strength') || n.includes('schedule'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" /></Svg>;

  if (n.includes('trend') || n.includes('defense') || n.includes('scoring'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M3 3v18h18" stroke={color} strokeWidth="1.8" strokeLinecap="round" /><Path d="M7 14l4-4 4 4 5-5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  if (n.includes('advanced') || n.includes('metric'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.8" /><Circle cx="12" cy="12" r="4" stroke={color} strokeWidth="1.8" /><Line x1="12" y1="2" x2="12" y2="6" stroke={color} strokeWidth="1.8" /><Line x1="12" y1="18" x2="12" y2="22" stroke={color} strokeWidth="1.8" /></Svg>;

  if (n.includes('weather'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M17 18a5 5 0 10-1.92-9.61A7 7 0 104 18h13z" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  if (n.includes('rest'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  if (n.includes('situational') || n.includes('clutch'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.8" /><Path d="M12 6v6l4 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" /><Circle cx="12" cy="12" r="3" fill={color} fillOpacity="0.3" /></Svg>;
}

// Factor tile
const FactorTile = memo(function FactorTile({
  factor,
  homeTeam,
  awayTeam,
  index,
}: {
  factor: PredictionFactor;
  homeTeam: GameTeam;
  awayTeam: GameTeam;
  index: number;
}) {
  const isHomeEdge = factor.homeScore > factor.awayScore + 0.3;
  const isAwayEdge = factor.awayScore > factor.homeScore + 0.3;
  const hasEdge = isHomeEdge || isAwayEdge;
  const edgeTeam = isHomeEdge ? homeTeam : isAwayEdge ? awayTeam : null;
  const edgeColor = isHomeEdge ? TEAL : isAwayEdge ? MAROON : '#6B7C94';
  const edgeBg = hasEdge ? (isHomeEdge ? 'rgba(122,157,184,0.08)' : MAROON_DIM) : 'rgba(255,255,255,0.022)';
  const edgeBorder = hasEdge ? (isHomeEdge ? 'rgba(122,157,184,0.18)' : 'rgba(139,10,31,0.18)') : 'rgba(255,255,255,0.065)';
  const homeShare = scoreShare(factor.homeScore, factor.awayScore);
  const awayShare = 100 - homeShare;
  const impact = factorImpactPercent(factor);

  return (
    <View style={[s.factorTile, { backgroundColor: edgeBg, borderColor: edgeBorder }]}>
      <View style={[s.factorAccent, { backgroundColor: edgeColor }]} />
      <View style={s.factorInner}>
        <View style={s.factorTopRow}>
          <View style={[s.factorIconWrap, { backgroundColor: hasEdge ? `${edgeColor}18` : 'rgba(255,255,255,0.04)' }]}>
            <FactorSvgIcon name={factor.name} size={18} />
          </View>
          <View style={s.factorTitleCopy}>
            <Text style={s.factorIndex}>Factor {index + 1}</Text>
            <Text style={s.factorName} numberOfLines={2}>
              {factor.name}
            </Text>
          </View>
          <View style={[s.edgeBadge, {
            backgroundColor: hasEdge ? `${edgeColor}18` : 'rgba(255,255,255,0.04)',
            borderColor: hasEdge ? `${edgeColor}35` : 'rgba(255,255,255,0.06)',
          }]}>
            <Text style={[s.edgeBadgeText, { color: edgeColor }]}>
              {edgeTeam ? edgeTeam.abbreviation : 'EVEN'}
            </Text>
          </View>
        </View>

        <Text style={s.factorDesc}>
          {factor.description}
        </Text>

        <View style={s.factorMeterHeader}>
          <Text style={[s.barLabel, { color: TEAL }]}>{homeTeam.abbreviation}</Text>
          <Text style={s.impactText}>{impact}% impact</Text>
          <Text style={[s.barLabel, { color: MAROON, textAlign: 'right' }]}>{awayTeam.abbreviation}</Text>
        </View>

        <View style={s.comparisonRail}>
          <View style={[s.comparisonFill, { flex: homeShare, backgroundColor: TEAL }]} />
          <View style={s.comparisonDivider} />
          <View style={[s.comparisonFill, { flex: awayShare, backgroundColor: MAROON }]} />
        </View>

        <View style={s.factorScoreRow}>
          <View style={s.factorScorePill}>
            <Text style={s.factorScoreLabel}>Home</Text>
            <Text style={s.factorScoreValue}>{factor.homeScore.toFixed(1)}</Text>
          </View>
          <View style={s.factorScorePill}>
            <Text style={s.factorScoreLabel}>Away</Text>
            <Text style={s.factorScoreValue}>{factor.awayScore.toFixed(1)}</Text>
          </View>
          <View style={s.factorScorePill}>
            <Text style={s.factorScoreLabel}>Weight</Text>
            <Text style={s.factorScoreValue}>{Math.round(factor.weight * 100)}%</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

// Main screen
export default function GameAnalysisScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPremium } = useSubscription();

  const { data: game, isLoading, isFetching, error } = useGame(id ?? '') as {
    data: Game | null | undefined;
    isLoading: boolean;
    isFetching: boolean;
    error: unknown;
  };

  if (isLoading && !game) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={TEAL} />
        <Text style={{ color: '#6B7C94', fontSize: 14, marginTop: 12 }}>Loading analysis...</Text>
      </View>
    );
  }

  if (error || !game) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)' }}>‹</Text>
            </Pressable>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 80 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '900', textAlign: 'center' }}>Analysis unavailable</Text>
            <Text style={{ color: '#6B7C94', fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: 'center' }}>We could not load this game right now.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!game.prediction) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)' }}>‹</Text>
            </Pressable>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 80 }}>
            {isFetching ? <ActivityIndicator color={TEAL} /> : null}
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '900', marginTop: isFetching ? 14 : 0, textAlign: 'center' }}>{isFetching ? 'Analysis is warming up' : 'Analysis unavailable'}</Text>
            <Text style={{ color: '#6B7C94', fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: 'center' }}>{isFetching ? 'The pick is still being prepared for this game.' : 'There is no prediction available for this game yet.'}</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!isPremium) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)' }}>‹</Text>
            </Pressable>
          </View>
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
            <LinearGradient
              colors={['rgba(122,157,184,0.24)', 'rgba(224,234,240,0.10)', 'rgba(139,10,31,0.18)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 24, padding: 1.2 }}
            >
              <View style={{ borderRadius: 22.8, backgroundColor: 'rgba(5,8,13,0.96)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.10)', padding: 22, overflow: 'hidden' }}>
                <LinearGradient
                  pointerEvents="none"
                  colors={['rgba(122,157,184,0.15)', 'rgba(255,255,255,0.025)', 'rgba(139,10,31,0.08)', 'rgba(5,8,13,0.96)']}
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
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: 'rgba(122,157,184,0.11)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.28)', alignItems: 'center', justifyContent: 'center', marginRight: 13 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: '#9AB8CC', letterSpacing: 1.2 }}>PRO</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '900', color: TEAL, letterSpacing: 2, marginBottom: 5 }}>FULL BREAKDOWN</Text>
                    <Text style={{ fontSize: 22, lineHeight: 27, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0 }}>AI analysis is queued</Text>
                  </View>
                  <View style={{ borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: 'rgba(139,10,31,0.14)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.30)' }}>
                    <Text style={{ fontSize: 9, lineHeight: 11, fontWeight: '900', color: 'rgba(255,255,255,0.82)', letterSpacing: 1.3 }}>PRO</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 13, color: '#A1B3C9', lineHeight: 20, marginBottom: 18 }}>
                  Reveal edge ratings, factor analysis, and model confidence when you want the complete read.
                </Text>
                <View style={{ marginBottom: 18 }}>
                  {['Edge ratings', 'Factor analysis', 'Prediction confidence'].map((label, index) => (
                    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, borderRadius: 11, backgroundColor: 'rgba(122,157,184,0.055)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.10)', paddingHorizontal: 10, marginBottom: index === 2 ? 0 : 8 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: index === 0 ? '#9AB8CC' : index === 1 ? 'rgba(139,10,31,0.78)' : 'rgba(224,234,240,0.55)', marginRight: 9 }} />
                      <Text style={{ flex: 1, fontSize: 11, lineHeight: 14, color: 'rgba(224,234,240,0.74)', fontWeight: '800' }}>{label}</Text>
                      <View style={{ width: index === 0 ? 58 : index === 1 ? 78 : 66, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.055)' }} />
                    </View>
                  ))}
                </View>
                <Pressable onPress={() => router.push('/paywall')} style={{ width: '100%' }}>
                  <LinearGradient colors={['rgba(122,157,184,0.24)', 'rgba(139,10,31,0.18)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 52, borderRadius: 15, padding: 1 }}>
                    <View style={{ flex: 1, borderRadius: 14, backgroundColor: 'rgba(5,8,13,0.78)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 15, fontWeight: '900', color: '#FFFFFF' }}>Preview Pro</Text>
                    </View>
                  </LinearGradient>
                </Pressable>
              </View>
            </LinearGradient>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const { homeTeam, awayTeam, prediction } = game;
  const factors = prediction.factors ?? [];
  const sorted = [...factors]
    .filter(f => f.weight > 0)
    .sort((a, b) => {
      const aDelta = Math.abs(a.homeScore - a.awayScore);
      const bDelta = Math.abs(b.homeScore - b.awayScore);
      const aIsEdge = aDelta > 0.3;
      const bIsEdge = bDelta > 0.3;
      if (aIsEdge && !bIsEdge) return -1;
      if (!aIsEdge && bIsEdge) return 1;
      return bDelta - aDelta;
    });

  const homeEdgeCount = sorted.filter(f => f.homeScore > f.awayScore + 0.3).length;
  const awayEdgeCount = sorted.filter(f => f.awayScore > f.homeScore + 0.3).length;
  const neutralCount = sorted.length - homeEdgeCount - awayEdgeCount;
  const canonical = getCanonicalResult(prediction as unknown as Prediction);
  const predictionDisplay = getPredictionDisplay({
    prediction: prediction as unknown as Prediction,
    homeTeam,
    awayTeam,
  });
  const winnerName = predictionDisplay.label;
  const canonicalConfidence = getCanonicalConfidence(prediction as unknown as Prediction);
  const projectionDisplay = prediction.projection
    ? getProjectionDisplay({
        sport: game.sport,
        homeAbbr: homeTeam.abbreviation,
        awayAbbr: awayTeam.abbreviation,
        canonicalResult: canonical,
        predictedWinner: prediction.predictedWinner,
        predictedOutcome: prediction.predictedOutcome,
        confidence: canonicalConfidence,
        isTossUp: predictionDisplay.isTossUp,
        projection: prediction.projection,
      })
    : null;
  const projectionRiskTier = prediction.projection ? getProjectionRiskTier(prediction.projection.upsetRisk) : null;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Header */}
      <View style={[s.headerWrap, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Text style={{ fontSize: 22, color: '#FFF', lineHeight: 24 }}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Analysis Breakdown</Text>
            <Text style={s.headerSub}>
              {homeTeam.abbreviation} vs {awayTeam.abbreviation} · unified engine · {sorted.length} factors
            </Text>
          </View>
        </View>
      </View>

      <FlatList
        showsVerticalScrollIndicator={false}
        data={sorted}
        keyExtractor={(factor, index) => `${factor.name}-${index}`}
        renderItem={({ item, index }) => (
          <FactorTile
            factor={item}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            index={index}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={
          <>
        {/* Pick Summary */}
        <View style={{ position: 'relative' }}>
          <View style={s.pickCard}>
            <View style={s.pickCardInner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <View>
                  <Text style={s.pickLabel}>UNIFIED ENGINE PICK</Text>
                  <Text style={s.pickTeam}>{winnerName}</Text>
                </View>
                <View style={s.confBadge}>
                  <Text style={s.confValue}>{displayConfidence(canonicalConfidence)}%</Text>
                  <Text style={s.confLabel}>CONF</Text>
                </View>
              </View>

              {/* Win probability bar */}
              {(() => {
                const canonicalProbabilities = getCanonicalWinProbabilities(prediction as unknown as Prediction);
                const dp = displayWinProbability(canonicalProbabilities.home, canonicalProbabilities.away);
                return (
                  <View style={s.probRow}>
                    <Text style={[s.probTeam, { color: TEAL }]}>{homeTeam.abbreviation} {dp.home}%</Text>
                    <View style={s.probBar}>
                      <View style={[s.probFill, { flex: dp.home, backgroundColor: TEAL }]} />
                      <View style={{ width: 2 }} />
                      <View style={[s.probFill, { flex: dp.away, backgroundColor: MAROON }]} />
                    </View>
                    <Text style={[s.probTeam, { color: MAROON, textAlign: 'right' }]}>{dp.away}% {awayTeam.abbreviation}</Text>
                  </View>
                );
              })()}
            </View>
          </View>
        </View>

        {/* Edge Summary */}
        <View style={s.edgeRow}>
          <View style={[s.edgeTile, { backgroundColor: 'rgba(122,157,184,0.08)' }]}>
            <Text style={[s.edgeCount, { color: TEAL }]}>{homeEdgeCount}</Text>
            <Text style={s.edgeTileLabel}>{homeTeam.abbreviation} Edges</Text>
          </View>
          <View style={[s.edgeTile, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
            <Text style={[s.edgeCount, { color: '#6B7C94' }]}>{neutralCount}</Text>
            <Text style={s.edgeTileLabel}>Neutral</Text>
          </View>
          <View style={[s.edgeTile, { backgroundColor: MAROON_DIM }]}>
            <Text style={[s.edgeCount, { color: MAROON }]}>{awayEdgeCount}</Text>
            <Text style={s.edgeTileLabel}>{awayTeam.abbreviation} Edges</Text>
          </View>
        </View>

        {/* Model Summary */}
        <View style={s.summaryCard}>
          <Text style={s.sectionLabel}>Unified Model Summary</Text>
          <Text style={s.summaryText}>{displayPredictionAnalysis({
            sport: (game.sport ?? 'UNKNOWN') as any,
            homeTeam,
            awayTeam,
            seasonContext: game.seasonContext,
            prediction: prediction as any,
          } as any)}</Text>
        </View>

        {prediction.projection ? (
          <View style={s.projectionCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <View>
                <Text style={s.sectionLabel}>{projectionDisplay?.label ?? 'Expected Score'}</Text>
              </View>
              <View style={s.upsetBadge}>
                <Text style={s.upsetValue}>{projectionRiskTier}</Text>
                <Text style={s.upsetLabel}>UPSET RISK</Text>
              </View>
            </View>

            <View style={s.projectionScoreRow}>
              <View style={s.projectionScoreTile}>
                <Text style={[s.projectionTeam, { color: TEAL }]}>{homeTeam.abbreviation}</Text>
                <Text style={s.projectionScore}>{projectionDisplay?.homeScore ?? Math.round(prediction.projection.projectedHomeScore)}</Text>
              </View>
              <View style={s.projectionMid}>
                <Text style={s.projectionMidLabel}>{projectionDisplay?.label ?? 'Unified Projection'}</Text>
                <Text style={s.projectionMidValue}>{projectionDisplay?.leanText ?? predictionDisplay.leanLabel}</Text>
                <Text style={s.projectionMidValue}>Total {projectionDisplay?.total ?? Math.round(prediction.projection.projectedTotal)}</Text>
                <Text style={s.projectionMidValue}>Spread {(projectionDisplay?.spreadValue ?? prediction.projection.projectedSpread) >= 0 ? '+' : ''}{projectionDisplay?.spread ?? Math.round(prediction.projection.projectedSpread)}</Text>
              </View>
              <View style={s.projectionScoreTile}>
                <Text style={[s.projectionTeam, { color: MAROON }]}>{awayTeam.abbreviation}</Text>
                <Text style={s.projectionScore}>{projectionDisplay?.awayScore ?? Math.round(prediction.projection.projectedAwayScore)}</Text>
              </View>
            </View>

            {prediction.projection.signals.length > 0 ? (
              <View style={{ gap: 8, marginTop: 14 }}>
                {prediction.projection.signals.slice(0, 3).map((signal) => (
                  <View key={signal.key} style={s.projectionSignal}>
                    <Text style={s.projectionSignalTitle}>{signal.label}</Text>
                    <Text style={s.projectionSignalBody}>{cleanProjectionCopy(signal.evidence)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Factors */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={s.sectionLabel}>Analysis Factors</Text>
          <Text style={{ fontSize: 10, color: '#6B7C94' }}>Sorted by impact</Text>
        </View>
          </>
        }
        ListEmptyComponent={
          <View style={s.emptyFactors}>
            <Text style={s.emptyFactorsText}>No factor breakdown is available for this game yet.</Text>
          </View>
        }
        ListFooterComponent={
          <View style={{ marginTop: 20, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
            AI predictions are for entertainment purposes only. Not financial advice.
          </Text>
          </View>
        }
      />
    </View>
  );
}

// Styles
const s = StyleSheet.create({
  headerWrap: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0 },
  headerSub: { fontSize: 11, color: '#6B7C94', marginTop: 3 },

  pickCard: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  pickCardInner: { padding: 16 },
  pickLabel: { fontSize: 9, fontWeight: '700', color: MAROON, letterSpacing: 2, marginBottom: 4 },
  pickTeam: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0 },
  confBadge: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: MAROON_DIM,
    borderWidth: 1,
    borderColor: 'rgba(139,10,31,0.2)',
    alignItems: 'center',
  },
  confValue: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', lineHeight: 26 },
  confLabel: { fontSize: 7, fontWeight: '700', color: '#6B7C94', letterSpacing: 0.8, marginTop: 2 },
  probRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  probTeam: { fontSize: 10, fontWeight: '800', width: 50 },
  probBar: { flex: 1, height: 6, borderRadius: 3, flexDirection: 'row', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.04)' },
  probFill: { height: '100%', borderRadius: 3 },

  edgeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  edgeTile: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  edgeCount: { fontSize: 26, fontWeight: '900', lineHeight: 30 },
  edgeTileLabel: { fontSize: 9, fontWeight: '700', color: '#6B7C94', marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase' },

  summaryCard: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 20,
  },
  summaryText: { fontSize: 13, color: '#A1B3C9', lineHeight: 21, marginTop: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5, textTransform: 'uppercase' },

  projectionCard: {
    backgroundColor: 'rgba(122,157,184,0.06)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(122,157,184,0.16)',
    marginBottom: 20,
  },
  upsetBadge: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  upsetValue: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', lineHeight: 22 },
  upsetLabel: { fontSize: 7, fontWeight: '800', color: '#6B7C94', letterSpacing: 0.6, marginTop: 2 },
  projectionScoreRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  projectionScoreTile: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  projectionTeam: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  projectionScore: { fontSize: 26, fontWeight: '900', color: '#FFFFFF', marginTop: 4 },
  projectionMid: {
    width: 96,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  projectionMidLabel: { fontSize: 9, fontWeight: '800', color: '#6B7C94', marginBottom: 6, textTransform: 'uppercase' },
  projectionMidValue: { fontSize: 10, fontWeight: '800', color: '#A1B3C9', lineHeight: 16 },
  projectionSignal: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  projectionSignalTitle: { fontSize: 11, fontWeight: '900', color: '#FFFFFF', marginBottom: 3 },
  projectionSignalBody: { fontSize: 11, color: '#A1B3C9', lineHeight: 16 },

  factorTile: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  factorAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  factorInner: {
    padding: 14,
    paddingLeft: 17,
  },
  factorTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  factorIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  factorTitleCopy: {
    flex: 1,
    minWidth: 0,
  },
  factorIndex: {
    fontSize: 8,
    color: '#6B7C94',
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  factorName: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    flex: 1,
    lineHeight: 18,
    letterSpacing: 0,
  },
  edgeBadge: {
    minWidth: 48,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    alignItems: 'center',
    flexShrink: 0,
  },
  edgeBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  factorDesc: {
    fontSize: 12,
    color: '#A1B3C9',
    lineHeight: 18,
    marginBottom: 12,
  },
  factorMeterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  impactText: {
    fontSize: 9,
    color: '#6B7C94',
    fontWeight: '800',
    letterSpacing: 0.45,
    textTransform: 'uppercase',
  },
  comparisonRail: {
    height: 7,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  comparisonFill: {
    height: '100%',
  },
  comparisonDivider: {
    width: 2,
    backgroundColor: BG,
  },
  factorScoreRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  factorScorePill: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
  },
  factorScoreLabel: {
    fontSize: 7,
    color: '#6B7C94',
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  factorScoreValue: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '900',
  },
  barLabel: {
    fontSize: 10,
    fontWeight: '900',
    width: 42,
    letterSpacing: 0.3,
  },
  emptyFactors: {
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  emptyFactorsText: {
    fontSize: 12,
    color: '#6B7C94',
    textAlign: 'center',
    lineHeight: 18,
  },
});
