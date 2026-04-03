import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSubscription } from '@/lib/subscription-context';

const BG = '#040608';
const MAROON = '#8B0A1F';
const TEAL = '#7A9DB8';
const MUTED = '#6B7C94';

interface Game {
  id: string;
  homeTeam: { name: string; abbreviation: string };
  awayTeam: { name: string; abbreviation: string };
  prediction?: {
    predictedWinner: 'home' | 'away';
    confidence: number;
    homeWinProbability: number;
    awayWinProbability: number;
    isTossUp?: boolean;
  };
}

const TIERS = [
  { label: 'Toss-Up', color: '#6B7C94', range: '< 53%', desc: 'The model can\'t separate these teams. Data is too close or too thin to lean either way.' },
  { label: 'Solid Pick', color: '#7A9DB8', range: '53–59%', desc: 'A clear advantage found across key factors. The model leans one way with moderate certainty.' },
  { label: 'Strong Pick', color: '#4ECDC4', range: '60–71%', desc: 'Multiple prediction factors align. Elo, form, and matchup context all point the same direction.' },
  { label: 'Lock', color: '#FFD700', range: '72%+', desc: 'Dominant edge across nearly every factor. All sub-models agree and data coverage is strong.' },
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

export default function ConfidenceExplainedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isPremium } = useSubscription();

  const { data: game, isLoading } = useQuery<Game>({
    queryKey: ['game', id],
    queryFn: async () => {
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
      const res = await fetch(`${baseUrl}/api/games/id/${id}`);
      if (!res.ok) throw new Error('Failed');
      const json = await res.json();
      return json.data ?? json;
    },
    enabled: !!id,
  });

  if (!isPremium) { router.back(); return null; }

  if (isLoading || !game?.prediction) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={TEAL} />
      </View>
    );
  }

  const pred = game.prediction;
  const winner = pred.predictedWinner === 'home' ? game.homeTeam : game.awayTeam;
  const tier = getTier(pred.confidence, pred.isTossUp);
  const currentTierIdx = TIERS.indexOf(tier);

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
            <Text style={{ fontSize: 11, color: MUTED }}>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {/* Summary card */}
          <Animated.View entering={FadeInDown.duration(400)} style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <View>
                <Text style={{ fontSize: 9, fontWeight: '700', color: MUTED, letterSpacing: 1.5 }}>CLUTCH PICK</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFF', marginTop: 2 }}>{winner.name}</Text>
              </View>
              <View style={{ backgroundColor: `${tier.color}20`, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: `${tier.color}40` }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: tier.color }}>{tier.label}</Text>
              </View>
            </View>

            <Text style={{ fontSize: 28, fontWeight: '900', color: '#FFF', marginBottom: 12 }}>{pred.confidence}%</Text>

            {/* Mini win prob bar */}
            <View style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: TEAL }}>{game.homeTeam.abbreviation} {pred.homeWinProbability}%</Text>
                <Text style={{ fontSize: 9, fontWeight: '700', color: MAROON }}>{pred.awayWinProbability}% {game.awayTeam.abbreviation}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)', flexDirection: 'row', overflow: 'hidden' }}>
                <View style={{ flex: pred.homeWinProbability, backgroundColor: TEAL, borderRadius: 3 }} />
                <View style={{ flex: pred.awayWinProbability, backgroundColor: MAROON, borderRadius: 3 }} />
              </View>
            </View>

            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 17 }}>
              Win probability is the model's estimate of who wins. Confidence is how much the model trusts that estimate — based on data quality, factor coverage, and model agreement.
            </Text>
          </Animated.View>

          {/* Tier legend */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: MUTED, letterSpacing: 1.5, marginBottom: 12 }}>TIER LEGEND</Text>
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
            <Text style={{ fontSize: 10, fontWeight: '700', color: MUTED, letterSpacing: 1.5, marginBottom: 12 }}>WHAT GOES INTO CONFIDENCE</Text>
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
