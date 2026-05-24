import React, { useEffect } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSubscription } from '@/lib/subscription-context';
import { useGame } from '@/hooks/useGames';
import { BG, MAROON, TEAL, TEXT_MUTED } from '@/lib/theme';
import { displayWinProbability } from '@/lib/display-confidence';
import { getCanonicalWinProbabilities } from '@/lib/canonical-result';
import { getPredictionDisplay } from '@/lib/prediction-display';
import type { CanonicalPredictionResult, Prediction } from '@/types/sports';


interface Game {
  id: string;
  homeTeam: { name: string; abbreviation: string };
  awayTeam: { name: string; abbreviation: string };
  prediction?: {
    canonicalResult?: CanonicalPredictionResult;
    predictedWinner: 'home' | 'away';
    predictedOutcome?: 'home' | 'away' | 'draw';
    confidence: number;
    homeWinProbability: number;
    awayWinProbability: number;
    drawProbability?: number;
    isTossUp?: boolean;
  };
}

// Colors come from getConfidenceTier in display-confidence.ts — keep in sync.
const TIERS = [
  { label: 'Toss-Up',     color: '#6B7280', range: '< 53%',   desc: 'The model can\'t separate these teams. Data is too close or too thin to lean either way.' },
  { label: 'Solid Pick',  color: '#94A3B8', range: '53–59%',  desc: 'A clear advantage found across key factors. The model leans one way with moderate certainty.' },
  { label: 'Strong Pick', color: '#CBD5E1', range: '60–71%',  desc: 'Multiple prediction factors align. Elo, form, and matchup context all point the same direction.' },
  { label: 'Lock',        color: '#F1F5F9', range: '72%+',    desc: 'Dominant edge across nearly every factor. All sub-models agree and data coverage is strong.' },
];

const FACTORS = [
  { num: '1', title: 'Team Strength', detail: 'Elo power ratings, season win rate, and strength of schedule.' },
  { num: '2', title: 'Recent Form', detail: 'Last 10 games, scoring trends, point differential, and current streaks.' },
  { num: '3', title: 'Matchup Context', detail: 'Home/away splits, rest days, injuries, head-to-head history.' },
  { num: '4', title: 'Data Completeness', detail: 'Missing factors reduce confidence — the model knows what it doesn\'t know.' },
  { num: '5', title: 'Model Agreement', detail: 'Three sub-models vote independently. Disagreement lowers confidence.' },
];

function getTier(conf: number, isTossUp?: boolean) {
  if (isTossUp || conf < 53) return TIERS[0];
  if (conf < 60) return TIERS[1];
  if (conf < 72) return TIERS[2];
  return TIERS[3];
}

function ConfidenceFallback({
  title,
  message,
  loading = false,
  onBack,
}: {
  title: string;
  message: string;
  loading?: boolean;
  onBack: () => void;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <LinearGradient colors={['rgba(139,10,31,0.12)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.5, y: 0.3 }} style={[StyleSheet.absoluteFill, { height: 200 }]} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 }}>
          <Pressable onPress={onBack} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke="#FFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
          <View>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: -0.5 }}>Pick Confidence</Text>
            <Text style={{ fontSize: 11, color: TEXT_MUTED }}>{title}</Text>
          </View>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 80 }}>
          {loading ? <ActivityIndicator color={TEAL} /> : null}
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '800', marginTop: loading ? 14 : 0, textAlign: 'center' }}>{title}</Text>
          <Text style={{ color: '#6B7C94', fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: 'center' }}>{message}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

export default function ConfidenceExplainedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isPremium } = useSubscription();

  const { data: game, isLoading, isFetching, error } = useGame(id ?? '') as {
    data: Game | null | undefined;
    isLoading: boolean;
    isFetching: boolean;
    error: unknown;
  };

  useEffect(() => {
    if (!isPremium) router.back();
  }, [isPremium, router]);

  if (!isPremium) return null;

  if (isLoading && !game) {
    return (
      <ConfidenceFallback
        title="Loading confidence"
        message="Getting the latest pick context."
        loading
        onBack={() => router.back()}
      />
    );
  }

  if (error || !game) {
    return (
      <ConfidenceFallback
        title="Confidence unavailable"
        message="We could not load this game right now."
        onBack={() => router.back()}
      />
    );
  }

  if (!game.prediction) {
    return (
      <ConfidenceFallback
        title={isFetching ? 'Confidence is warming up' : 'Confidence unavailable'}
        message={isFetching ? 'The pick is still being prepared for this game.' : 'There is no prediction available for this game yet.'}
        loading={isFetching}
        onBack={() => router.back()}
      />
    );
  }

  const pred = game.prediction;
  const predictionDisplay = getPredictionDisplay({
    prediction: pred as unknown as Prediction,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
  });
  const tier = getTier(pred.confidence, predictionDisplay.isTossUp);
  const currentTierIdx = TIERS.indexOf(tier);
  const canonicalProbabilities = getCanonicalWinProbabilities(pred as unknown as Prediction);
  const dp = displayWinProbability(canonicalProbabilities.home, canonicalProbabilities.away, canonicalProbabilities.draw);
  const hasDraw = typeof dp.draw === 'number';
  const drawColor = '#C9BDA8';

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <LinearGradient colors={['rgba(139,10,31,0.12)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.5, y: 0.3 }} style={[StyleSheet.absoluteFill, { height: 200 }]} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 }}>
          <Pressable onPress={() => router.back()} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke="#FFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
          <View>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: -0.5 }}>Pick Confidence</Text>
            <Text style={{ fontSize: 11, color: TEXT_MUTED }}>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {/* Summary card */}
          <Animated.View entering={FadeInDown.duration(400)} style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <View>
                <Text style={{ fontSize: 9, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 1.5 }}>CLUTCH PICK</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFF', marginTop: 2 }}>{predictionDisplay.label}</Text>
              </View>
              <View style={{ backgroundColor: `${tier.color}20`, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: `${tier.color}40` }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: tier.color }}>{tier.label}</Text>
              </View>
            </View>

            <Text style={{ fontSize: 28, fontWeight: '900', color: '#FFF', marginBottom: 12 }}>{pred.confidence}%</Text>

            {/* Mini win prob bar */}
            <View style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ flex: 1, fontSize: 9, fontWeight: '700', color: TEAL }} numberOfLines={1}>{game.homeTeam.abbreviation} {dp.home}%</Text>
                {hasDraw ? (
                  <Text style={{ flex: 1, fontSize: 9, fontWeight: '700', color: drawColor, textAlign: 'center' }} numberOfLines={1}>Draw {dp.draw}%</Text>
                ) : null}
                <Text style={{ flex: 1, fontSize: 9, fontWeight: '700', color: MAROON, textAlign: 'right' }} numberOfLines={1}>{dp.away}% {game.awayTeam.abbreviation}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)', flexDirection: 'row', overflow: 'hidden' }}>
                <View style={{ flex: dp.home, backgroundColor: TEAL, borderRadius: 3 }} />
                {hasDraw ? (
                  <>
                    <View style={{ width: 2, backgroundColor: BG }} />
                    <View style={{ flex: dp.draw, backgroundColor: drawColor }} />
                    <View style={{ width: 2, backgroundColor: BG }} />
                  </>
                ) : null}
                <View style={{ flex: dp.away, backgroundColor: MAROON, borderRadius: 3 }} />
              </View>
            </View>

            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 17 }}>
              Win probability is the model's estimate of who wins. Confidence is how much the model trusts that estimate — based on data quality, factor coverage, and model agreement.
            </Text>
          </Animated.View>

          {/* Tier legend */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 1.5, marginBottom: 12 }}>TIER LEGEND</Text>
            {TIERS.map((t, i) => {
              const isActive = i === currentTierIdx;
              return (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 6,
                  backgroundColor: isActive ? `${t.color}10` : 'rgba(255,255,255,0.02)',
                  borderRadius: 12, borderWidth: 1,
                  borderColor: isActive ? `${t.color}30` : 'rgba(255,255,255,0.04)',
                }}>
                  <View style={{ width: 3, height: '100%', minHeight: 30, backgroundColor: t.color, borderRadius: 1.5, marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: t.color }}>{t.label}</Text>
                      <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{t.range}</Text>
                      {isActive ? <View style={{ backgroundColor: `${t.color}30`, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 8, fontWeight: '700', color: t.color }}>THIS GAME</Text></View> : null}
                    </View>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 16 }}>{t.desc}</Text>
                  </View>
                </View>
              );
            })}
          </Animated.View>

          {/* What goes into confidence */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 1.5, marginBottom: 12 }}>WHAT GOES INTO CONFIDENCE</Text>
            {FACTORS.map((f, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 12, gap: 12 }}>
                <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: 'rgba(122,157,184,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: TEAL }}>{f.num}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF', marginBottom: 2 }}>{f.title}</Text>
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 16 }}>{f.detail}</Text>
                </View>
              </View>
            ))}
          </Animated.View>

          {/* Disclaimer */}
          <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
            Confidence reflects the model's self-assessed certainty, not a guarantee.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
