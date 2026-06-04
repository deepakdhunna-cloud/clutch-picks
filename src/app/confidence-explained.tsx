import React from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { HapticPressable } from '@/components/HapticPressable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { BG, MAROON, TEAL, TEXT_MUTED } from '@/lib/theme';
import { CONFIDENCE_TIER_DEFINITIONS, displayWinProbability, getConfidenceTier } from '@/lib/display-confidence';

type ConfidenceParams = {
  id?: string;
  confidence?: string;
  pickLabel?: string;
  homeAbbr?: string;
  awayAbbr?: string;
  homeProb?: string;
  awayProb?: string;
  drawProb?: string;
  isTossUp?: string;
};

const TIERS = CONFIDENCE_TIER_DEFINITIONS;

const FACTORS = [
  { num: '1', title: 'Team Strength', detail: 'Elo power ratings, season win rate, and strength of schedule.' },
  { num: '2', title: 'Recent Form', detail: 'Last 10 games, scoring trends, point differential, and current streaks.' },
  { num: '3', title: 'Matchup Context', detail: 'Home/away splits, rest days, injuries, head-to-head history.' },
  { num: '4', title: 'Data Completeness', detail: 'Missing factors reduce confidence — the model knows what it doesn\'t know.' },
  { num: '5', title: 'Model Agreement', detail: 'Three sub-models vote independently. Disagreement lowers confidence.' },
];

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
          <HapticPressable hapticStyle="light" onPress={onBack} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke="#FFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </HapticPressable>
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

function parseNumberParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolParam(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '1' || raw === 'true';
}

export default function ConfidenceExplainedScreen() {
  const params = useLocalSearchParams<ConfidenceParams>();
  const router = useRouter();

  const confidence = parseNumberParam(params.confidence);
  const homeProb = parseNumberParam(params.homeProb);
  const awayProb = parseNumberParam(params.awayProb);
  const drawProb = parseNumberParam(params.drawProb);
  const pickLabel = Array.isArray(params.pickLabel) ? params.pickLabel[0] : params.pickLabel;
  const homeAbbr = Array.isArray(params.homeAbbr) ? params.homeAbbr[0] : params.homeAbbr;
  const awayAbbr = Array.isArray(params.awayAbbr) ? params.awayAbbr[0] : params.awayAbbr;
  const isTossUp = parseBoolParam(params.isTossUp);

  if (confidence === null || homeProb === null || awayProb === null || !homeAbbr || !awayAbbr) {
    return (
      <ConfidenceFallback
        title="Confidence unavailable"
        message="This game did not include enough confidence data to show the breakdown."
        onBack={() => router.back()}
      />
    );
  }

  const tier = getConfidenceTier(confidence, isTossUp);
  const currentTierIdx = TIERS.findIndex((item) => item.label === tier.label);
  const dp = displayWinProbability(homeProb, awayProb, drawProb ?? undefined);
  const hasDraw = typeof dp.draw === 'number';
  const drawColor = '#C9BDA8';

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <LinearGradient colors={['rgba(139,10,31,0.12)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.5, y: 0.3 }} style={[StyleSheet.absoluteFill, { height: 200 }]} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 }}>
          <HapticPressable hapticStyle="light" hitSlop={12} onPress={() => router.back()} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke="#FFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </HapticPressable>
          <View>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: -0.5 }}>Pick Confidence</Text>
            <Text style={{ fontSize: 11, color: TEXT_MUTED }}>{awayAbbr} vs {homeAbbr}</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {/* Summary card */}
          <View style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <View>
                <Text style={{ fontSize: 9, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 1.5 }}>CLUTCH PICK</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFF', marginTop: 2 }}>{pickLabel ?? 'Current Pick'}</Text>
              </View>
              <View style={{ backgroundColor: `${tier.color}20`, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: `${tier.color}40` }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: tier.color }}>{tier.label}</Text>
              </View>
            </View>

            <Text style={{ fontSize: 28, fontWeight: '900', color: '#FFF', marginBottom: 12 }}>{Math.round(confidence)}%</Text>

            {/* Mini win prob bar */}
            <View style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ flex: 1, fontSize: 9, fontWeight: '700', color: TEAL }} numberOfLines={1}>{homeAbbr} {dp.home}%</Text>
                {hasDraw ? (
                  <Text style={{ flex: 1, fontSize: 9, fontWeight: '700', color: drawColor, textAlign: 'center' }} numberOfLines={1}>Draw {dp.draw}%</Text>
                ) : null}
                <Text style={{ flex: 1, fontSize: 9, fontWeight: '700', color: MAROON, textAlign: 'right' }} numberOfLines={1}>{dp.away}% {awayAbbr}</Text>
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
          </View>

          {/* Tier legend */}
          <View style={{ marginBottom: 24 }}>
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
          </View>

          {/* What goes into confidence */}
          <View style={{ marginBottom: 24 }}>
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
          </View>

          {/* Disclaimer */}
          <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
            Confidence reflects the model's self-assessed certainty, not a guarantee.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
