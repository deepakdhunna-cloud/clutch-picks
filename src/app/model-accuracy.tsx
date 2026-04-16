import React from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { api } from '@/lib/api/api';
import { MAROON, TEAL, GREEN_UP, LOSS, BG } from '@/lib/theme';
import { useCalibration, type LeagueCalibration, type ReliabilityBucket } from '@/hooks/useCalibration';

const AMBER = '#F59E0B'; // warning / mid-tier badge — not in theme exports


interface AccuracyBucket {
  bucket: string;
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number | null;
}

interface SportAccuracy {
  sport: string;
  total: number;
  correct: number;
  accuracy: number | null;
}

interface AccuracyData {
  buckets: AccuracyBucket[];
  overall: { totalResolved: number; totalCorrect: number; overallAccuracy: number | null };
  perSport: SportAccuracy[];
  tossUp: { total: number; correct: number; accuracy: number | null };
}

interface DriftData {
  isDrifting: boolean;
  rollingAccuracy7d: number | null;
  rollingAccuracy30d: number | null;
  allTimeAccuracy: number | null;
  sample: { total: number; last7d: number; last30d: number };
}

export default function ModelAccuracyScreen() {
  const router = useRouter();

  const { data: accuracy, isLoading: loadingAcc } = useQuery<AccuracyData>({
    queryKey: ['model-accuracy'],
    queryFn: () => api.get<AccuracyData>('/api/predictions/accuracy'),
    staleTime: 60_000,
  });

  const { data: drift, isLoading: loadingDrift } = useQuery<DriftData>({
    queryKey: ['model-drift'],
    queryFn: () => api.get<DriftData>('/api/predictions/drift'),
    staleTime: 60_000,
  });

  const { data: calibration, isLoading: loadingCalibration } = useCalibration();

  const isLoading = loadingAcc || loadingDrift || loadingCalibration;
  const hasEnoughData = (accuracy?.overall.totalResolved ?? 0) >= 50;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <ArrowLeft size={20} color="#FFFFFF" />
          </Pressable>
          <Text style={s.headerTitle}>Model Performance</Text>
        </View>

        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={TEAL} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
            {/* Overall Accuracy */}
            <Animated.View entering={FadeInDown.delay(100).duration(400)} style={s.card}>
              <Text style={s.cardTitle}>Overall Accuracy</Text>
              {hasEnoughData ? (
                <View style={{ alignItems: 'center', marginTop: 8 }}>
                  <Text style={[s.bigNumber, { color: (accuracy?.overall.overallAccuracy ?? 0) >= 55 ? GREEN_UP : LOSS }]}>
                    {accuracy?.overall.overallAccuracy ?? 0}%
                  </Text>
                  <Text style={s.subtitle}>
                    {accuracy?.overall.totalCorrect} correct out of {accuracy?.overall.totalResolved} resolved
                  </Text>
                </View>
              ) : (
                <View style={{ alignItems: 'center', marginTop: 8 }}>
                  <Text style={s.bigNumber}>--</Text>
                  <Text style={s.subtitle}>
                    Building track record... ({accuracy?.overall.totalResolved ?? 0}/50 predictions resolved)
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* Drift Detection */}
            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={s.card}>
              <Text style={s.cardTitle}>Drift Detection</Text>
              {drift ? (
                <View style={{ marginTop: 8 }}>
                  <View style={[s.statusBadge, { backgroundColor: drift.isDrifting ? `${LOSS}20` : `${GREEN_UP}20` }]}>
                    <View style={[s.statusDot, { backgroundColor: drift.isDrifting ? LOSS : GREEN_UP }]} />
                    <Text style={[s.statusText, { color: drift.isDrifting ? LOSS : GREEN_UP }]}>
                      {drift.isDrifting ? 'Performance declining' : 'Stable'}
                    </Text>
                  </View>
                  <View style={s.statRow}>
                    <StatItem label="7-day" value={drift.rollingAccuracy7d != null ? `${drift.rollingAccuracy7d}%` : '--'} count={drift.sample.last7d} />
                    <StatItem label="30-day" value={drift.rollingAccuracy30d != null ? `${drift.rollingAccuracy30d}%` : '--'} count={drift.sample.last30d} />
                    <StatItem label="All-time" value={drift.allTimeAccuracy != null ? `${drift.allTimeAccuracy}%` : '--'} count={drift.sample.total} />
                  </View>
                </View>
              ) : null}
            </Animated.View>

            {/* Calibration Buckets */}
            <Animated.View entering={FadeInDown.delay(300).duration(400)} style={s.card}>
              <Text style={s.cardTitle}>Calibration by Confidence</Text>
              <Text style={s.cardSubtitle}>Does 70% confidence actually win 70% of the time?</Text>
              {accuracy?.buckets.filter(b => b.totalPredictions > 0).map((bucket) => (
                <View key={bucket.bucket} style={s.bucketRow}>
                  <Text style={s.bucketLabel}>{bucket.bucket}%</Text>
                  <View style={s.bucketBarBg}>
                    <View
                      style={[s.bucketBarFill, {
                        width: `${Math.min(bucket.accuracy ?? 0, 100)}%`,
                        backgroundColor: bucket.accuracy != null
                          ? Math.abs(bucket.accuracy - parseInt(bucket.bucket)) <= 10 ? GREEN_UP : MAROON
                          : 'rgba(255,255,255,0.1)',
                      }]}
                    />
                  </View>
                  <Text style={s.bucketValue}>
                    {bucket.accuracy != null ? `${bucket.accuracy}%` : '--'}
                  </Text>
                  <Text style={s.bucketCount}>({bucket.totalPredictions})</Text>
                </View>
              )) ?? null}
              {accuracy?.buckets.every(b => b.totalPredictions === 0) ? (
                <Text style={s.subtitle}>No resolved predictions yet</Text>
              ) : null}
            </Animated.View>

            {/* Per Sport */}
            <Animated.View entering={FadeInDown.delay(400).duration(400)} style={s.card}>
              <Text style={s.cardTitle}>Accuracy by Sport</Text>
              {accuracy?.perSport.map((sport) => (
                <View key={sport.sport} style={s.sportRow}>
                  <Text style={s.sportName}>{sport.sport}</Text>
                  <Text style={[s.sportAccuracy, { color: (sport.accuracy ?? 0) >= 55 ? GREEN_UP : (sport.accuracy ?? 0) >= 50 ? TEAL : LOSS }]}>
                    {sport.accuracy != null ? `${sport.accuracy}%` : '--'}
                  </Text>
                  <Text style={s.sportCount}>{sport.total} games</Text>
                </View>
              )) ?? null}
            </Animated.View>

            {/* Toss-Up */}
            <Animated.View entering={FadeInDown.delay(500).duration(400)} style={s.card}>
              <Text style={s.cardTitle}>Toss-Up Performance</Text>
              <Text style={s.cardSubtitle}>Games where the model said "too close to call"</Text>
              {(accuracy?.tossUp.total ?? 0) > 0 ? (
                <View style={{ alignItems: 'center', marginTop: 8 }}>
                  <Text style={[s.bigNumber, { fontSize: 28 }]}>
                    {accuracy?.tossUp.accuracy ?? 0}%
                  </Text>
                  <Text style={s.subtitle}>
                    {accuracy?.tossUp.correct}/{accuracy?.tossUp.total} correct (expected ~50%)
                  </Text>
                </View>
              ) : (
                <Text style={s.subtitle}>No toss-up predictions resolved yet</Text>
              )}
            </Animated.View>

            {/* Model Calibration (per-league reliability curves) */}
            <Animated.View entering={FadeInDown.delay(600).duration(400)} style={[s.card, { marginTop: 24 }]}>
              <Text style={s.cardTitle}>Model Calibration</Text>
              <Text style={s.cardSubtitle}>
                Brier score, log loss, and per-bucket reliability by league
              </Text>
              {calibration?.generatedAt ? (
                <Text style={s.calTimestamp}>Updated {formatUpdatedAgo(calibration.generatedAt)}</Text>
              ) : null}

              {calibration?.warnings && calibration.warnings.length > 0 ? (
                <View style={s.warningBanner}>
                  {calibration.warnings.map((w, i) => (
                    <Text key={i} style={s.warningText}>{w}</Text>
                  ))}
                </View>
              ) : null}
            </Animated.View>

            {(calibration?.perLeague ?? []).map((league, i) => (
              <LeagueCalibrationCard key={league.league} league={league} delayMs={700 + i * 50} />
            ))}

            {calibration && (calibration.perLeague ?? []).length === 0 ? (
              <Animated.View entering={FadeInDown.delay(650).duration(400)} style={s.card}>
                <Text style={s.subtitle}>No calibration data yet.</Text>
              </Animated.View>
            ) : null}

            {/* Disclaimer */}
            <Text style={s.disclaimer}>
              This data reflects real model performance on resolved predictions. Past accuracy does not guarantee future results.
            </Text>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Calibration helpers ────────────────────────────────────────────────────

function brierBadge(brier: number, sampleSize: number): { color: string; bg: string; label: string } {
  if (sampleSize < 100) {
    return { color: 'rgba(255,255,255,0.6)', bg: 'rgba(255,255,255,0.08)', label: 'insufficient data' };
  }
  if (brier < 0.22) return { color: GREEN_UP, bg: `${GREEN_UP}20`, label: 'well-calibrated' };
  if (brier < 0.24) return { color: AMBER, bg: `${AMBER}20`, label: 'borderline' };
  return { color: LOSS, bg: `${LOSS}20`, label: 'miscalibrated' };
}

function errorColor(errPts: number | null): string {
  if (errPts === null) return 'rgba(255,255,255,0.3)';
  const abs = Math.abs(errPts);
  if (abs < 2) return GREEN_UP;
  if (abs <= 5) return AMBER;
  return LOSS;
}

function formatUpdatedAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const diffH = Math.floor(diffMs / (60 * 60 * 1000));
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function LeagueCalibrationCard({
  league,
  delayMs,
}: {
  league: LeagueCalibration;
  delayMs: number;
}) {
  const badge = brierBadge(league.brierScore, league.sampleSize);
  const populated = league.reliabilityCurve.filter((b) => b.count > 0);

  return (
    <Animated.View entering={FadeInDown.delay(delayMs).duration(400)} style={s.card}>
      <View style={s.calHeaderRow}>
        <Text style={s.calLeague}>{league.league}</Text>
        <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
          <View style={[s.statusDot, { backgroundColor: badge.color }]} />
          <Text style={[s.statusText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>

      <View style={s.calBigRow}>
        <View style={{ alignItems: 'flex-start', flex: 1 }}>
          <Text style={[s.bigNumber, { fontSize: 32, color: badge.color }]}>
            {league.brierScore.toFixed(3)}
          </Text>
          <Text style={s.calMetricLabel}>Brier score</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.calSampleSize}>n = {league.sampleSize}</Text>
          <Text style={s.calSecondary}>
            log loss {league.logLoss.toFixed(3)}
          </Text>
          <Text style={s.calSecondary}>
            accuracy {league.overallAccuracy != null ? `${league.overallAccuracy.toFixed(1)}%` : '--'}
          </Text>
        </View>
      </View>

      {populated.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          {populated.map((b) => (
            <ReliabilityRow key={b.bucket} bucket={b} />
          ))}
        </View>
      ) : (
        <Text style={[s.subtitle, { marginTop: 8 }]}>No populated buckets yet.</Text>
      )}

      {league.note ? <Text style={[s.subtitle, { marginTop: 8 }]}>{league.note}</Text> : null}
    </Animated.View>
  );
}

function ReliabilityRow({ bucket }: { bucket: ReliabilityBucket }) {
  const predictedPct = bucket.predictedWinRate * 100;
  const actualPct = bucket.actualWinRate * 100;
  const errText =
    bucket.calibrationErrorPts === null
      ? '—'
      : `${bucket.calibrationErrorPts >= 0 ? '+' : ''}${bucket.calibrationErrorPts.toFixed(1)}pt`;
  return (
    <View style={s.reliabRow}>
      <Text style={s.reliabLabel}>{bucket.bucket}</Text>
      <View style={s.reliabBars}>
        <View style={s.reliabBarBg}>
          <View style={[s.reliabBarFill, { width: `${Math.min(100, predictedPct)}%`, backgroundColor: TEAL }]} />
        </View>
        <View style={s.reliabBarBg}>
          <View style={[s.reliabBarFill, { width: `${Math.min(100, actualPct)}%`, backgroundColor: MAROON }]} />
        </View>
      </View>
      <Text style={[s.reliabError, { color: errorColor(bucket.calibrationErrorPts) }]}>
        {errText}
      </Text>
      <Text style={s.reliabCount}>({bucket.count})</Text>
    </View>
  );
}

function StatItem({ label, value, count }: { label: string; value: string; count: number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '600', marginTop: 2 }}>{label}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9, marginTop: 1 }}>{count} games</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginLeft: 16 },
  card: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  cardTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  cardSubtitle: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 },
  bigNumber: { fontSize: 40, fontWeight: '900', color: '#FFFFFF' },
  subtitle: { color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 4, textAlign: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusText: { fontSize: 12, fontWeight: '700' },
  statRow: { flexDirection: 'row', marginTop: 12 },
  bucketRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  bucketLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600', width: 48 },
  bucketBarBg: { flex: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden', marginHorizontal: 8 },
  bucketBarFill: { height: '100%', borderRadius: 4 },
  bucketValue: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', width: 32, textAlign: 'right' },
  bucketCount: { color: 'rgba(255,255,255,0.25)', fontSize: 9, width: 30, textAlign: 'right' },
  sportRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingVertical: 4 },
  sportName: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', flex: 1 },
  sportAccuracy: { fontSize: 14, fontWeight: '800', marginRight: 8 },
  sportCount: { color: 'rgba(255,255,255,0.25)', fontSize: 10, width: 60, textAlign: 'right' },
  disclaimer: { color: 'rgba(255,255,255,0.2)', fontSize: 10, textAlign: 'center', marginTop: 20, lineHeight: 15 },
  calTimestamp: { color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 4 },
  warningBanner: { marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)' },
  warningText: { color: '#F59E0B', fontSize: 11, lineHeight: 16, marginTop: 2 },
  calHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calLeague: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  calBigRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  calMetricLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '600', marginTop: 2 },
  calSampleSize: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  calSecondary: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 },
  reliabRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  reliabLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600', width: 42 },
  reliabBars: { flex: 1, marginHorizontal: 8 },
  reliabBarBg: { height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginVertical: 1 },
  reliabBarFill: { height: '100%', borderRadius: 3 },
  reliabError: { fontSize: 10, fontWeight: '700', width: 46, textAlign: 'right' },
  reliabCount: { color: 'rgba(255,255,255,0.25)', fontSize: 9, width: 30, textAlign: 'right' },
});
