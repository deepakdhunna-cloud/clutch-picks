import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { useSubscription } from '@/lib/subscription-context';

const CORAL = '#E8936A';
const TEAL = '#7A9DB8';
const GREEN = '#4ADE80';
const BG = '#080810';

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
  predictedWinner: 'home' | 'away';
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
}

interface Game {
  id: string;
  homeTeam: GameTeam;
  awayTeam: GameTeam;
  prediction?: GamePrediction;
}

// ─── SVG Factor Icons — clean line art, no emojis ────────────────
function FactorSvgIcon({ name, size = 18 }: { name: string; size?: number }) {
  const color = 'rgba(255,255,255,0.5)';
  const n = name.toLowerCase();

  // Home/Away Split
  if (n.includes('home') && n.includes('away'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M3 12L12 3l9 9" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><Path d="M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9" stroke={color} strokeWidth="1.8" /></Svg>;

  // Injuries
  if (n.includes('injur'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" stroke={color} strokeWidth="1.8" strokeLinecap="round" /><Path d="M12 11v5m-2.5-2.5h5" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  // Recent Form
  if (n.includes('form') || n.includes('recent'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M3 17l4-4 4 4 4-8 6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  // Head to Head
  if (n.includes('head'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  // Streak
  if (n.includes('streak'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  // Elo Rating
  if (n.includes('elo'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" /><Path d="M12 7v5l3 3" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  // Win %
  if (n.includes('win'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M6 9H3a1 1 0 01-1-1V5a1 1 0 011-1h3m12 5h3a1 1 0 001-1V5a1 1 0 00-1-1h-3M6 4h12v7a6 6 0 01-12 0V4zm3 17h6m-3-3v3" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  // Point Diff
  if (n.includes('point') || n.includes('diff'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M18 20V10M12 20V4M6 20v-6" stroke={color} strokeWidth="2" strokeLinecap="round" /></Svg>;

  // Strength of Schedule
  if (n.includes('strength') || n.includes('schedule'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" /></Svg>;

  // Defense / Scoring Trend
  if (n.includes('trend') || n.includes('defense') || n.includes('scoring'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M3 3v18h18" stroke={color} strokeWidth="1.8" strokeLinecap="round" /><Path d="M7 14l4-4 4 4 5-5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;

  // Advanced Metrics
  if (n.includes('advanced') || n.includes('metric'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.8" /><Circle cx="12" cy="12" r="4" stroke={color} strokeWidth="1.8" /><Line x1="12" y1="2" x2="12" y2="6" stroke={color} strokeWidth="1.8" /><Line x1="12" y1="18" x2="12" y2="22" stroke={color} strokeWidth="1.8" /></Svg>;

  // Weather
  if (n.includes('weather'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M17 18a5 5 0 10-1.92-9.61A7 7 0 104 18h13z" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  // Rest Days
  if (n.includes('rest'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  // Situational / Clutch
  if (n.includes('situational') || n.includes('clutch'))
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.8" /><Path d="M12 6v6l4 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;

  // Default
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" /><Circle cx="12" cy="12" r="3" fill={color} fillOpacity="0.3" /></Svg>;
}

// ─── FACTOR TILE — neutral colors, no team dependency ────────────
function FactorTile({
  factor,
  homeTeam,
  awayTeam,
}: {
  factor: PredictionFactor;
  homeTeam: GameTeam;
  awayTeam: GameTeam;
}) {
  const isHomeEdge = factor.homeScore > factor.awayScore + 0.3;
  const isAwayEdge = factor.awayScore > factor.homeScore + 0.3;
  const hasEdge = isHomeEdge || isAwayEdge;
  const edgeTeam = isHomeEdge ? homeTeam : awayTeam;

  const edgeBg = hasEdge ? 'rgba(232,147,106,0.06)' : 'rgba(255,255,255,0.02)';
  const edgeBorder = hasEdge ? 'rgba(232,147,106,0.12)' : 'rgba(255,255,255,0.06)';

  const homeBarW = Math.max(2, Math.abs(factor.homeScore) * 50);
  const awayBarW = Math.max(2, Math.abs(factor.awayScore) * 50);

  return (
    <View style={[s.factorTile, { backgroundColor: edgeBg, borderColor: edgeBorder }]}>
      {hasEdge ? <View style={[s.factorAccent, { backgroundColor: CORAL }]} /> : null}
      <View style={s.factorInner}>
        <View style={[s.factorIconWrap, { backgroundColor: hasEdge ? 'rgba(232,147,106,0.1)' : 'rgba(255,255,255,0.04)' }]}>
          <FactorSvgIcon name={factor.name} size={18} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.factorTitleRow}>
            <Text style={[s.factorName, { color: hasEdge ? '#FFFFFF' : 'rgba(255,255,255,0.5)' }]}>
              {factor.name}
            </Text>
            <View style={[s.edgeBadge, {
              backgroundColor: hasEdge ? 'rgba(232,147,106,0.15)' : 'rgba(255,255,255,0.04)',
              borderColor: hasEdge ? 'rgba(232,147,106,0.25)' : 'rgba(255,255,255,0.06)',
            }]}>
              <Text style={[s.edgeBadgeText, { color: hasEdge ? CORAL : 'rgba(255,255,255,0.3)' }]}>
                {hasEdge ? `${edgeTeam.abbreviation} EDGE` : 'NEUTRAL'}
              </Text>
            </View>
          </View>

          <Text style={[s.factorDesc, { color: hasEdge ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.4)' }]}>
            {factor.description}
          </Text>

          <View style={s.barsRow}>
            <Text style={[s.barLabel, { color: TEAL }]}>{homeTeam.abbreviation}</Text>
            <View style={s.barTrack}>
              <View style={[s.barFill, { width: `${homeBarW}%`, backgroundColor: TEAL }]} />
            </View>
            <View style={s.barTrack}>
              <View style={[s.barFill, { width: `${awayBarW}%`, backgroundColor: CORAL }]} />
            </View>
            <Text style={[s.barLabel, { color: CORAL }]}>{awayTeam.abbreviation}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────
export default function GameAnalysisScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPremium } = useSubscription();

  const { data: game, isLoading } = useQuery<Game>({
    queryKey: ['game', id],
    queryFn: async () => {
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
      const res = await fetch(`${baseUrl}/api/games/id/${id}`);
      if (!res.ok) throw new Error('Failed to fetch game');
      const json = await res.json();
      return json.data ?? json;
    },
    enabled: !!id,
  });

  if (isLoading || !game || !game.prediction) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading analysis...</Text>
      </View>
    );
  }

  const { homeTeam, awayTeam, prediction } = game;
  const sorted = [...prediction.factors]
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
  const winner = prediction.predictedWinner === 'home' ? homeTeam : awayTeam;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Header — neutral, no team color gradient */}
      <View style={[s.headerWrap, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Text style={{ fontSize: 22, color: '#FFF', lineHeight: 24 }}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Analysis Breakdown</Text>
            <Text style={s.headerSub}>
              {homeTeam.abbreviation} vs {awayTeam.abbreviation} — {sorted.length} factors analyzed
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
      >
        {/* Pick Summary */}
        <View style={{ position: 'relative' }}>
          <View style={s.pickCard}>
            <View style={s.pickCardInner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <View>
                  <Text style={s.pickLabel}>CLUTCH PICK</Text>
                  <Text style={s.pickTeam}>{winner.city} {winner.name}</Text>
                </View>
                <View style={s.confBadge}>
                  <Text style={s.confValue}>{prediction.confidence}%</Text>
                  <Text style={s.confLabel}>CONF</Text>
                </View>
              </View>

              {/* Win probability bar — teal vs coral */}
              <View style={s.probRow}>
              <Text style={[s.probTeam, { color: TEAL }]}>{homeTeam.abbreviation} {prediction.homeWinProbability}%</Text>
              <View style={s.probBar}>
                <View style={[s.probFill, { flex: prediction.homeWinProbability, backgroundColor: TEAL }]} />
                <View style={{ width: 2 }} />
                <View style={[s.probFill, { flex: prediction.awayWinProbability, backgroundColor: CORAL }]} />
              </View>
              <Text style={[s.probTeam, { color: CORAL, textAlign: 'right' }]}>{prediction.awayWinProbability}% {awayTeam.abbreviation}</Text>
              </View>
            </View>
          </View>
          {!isPremium ? (
            <Pressable onPress={() => router.push('/paywall')} style={{
              ...StyleSheet.absoluteFillObject, zIndex: 10,
              backgroundColor: 'rgba(4,6,8,0.7)',
              alignItems: 'center', justifyContent: 'center', borderRadius: 18,
            }}>
              <View style={{ backgroundColor: 'rgba(232,147,106,0.15)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(232,147,106,0.25)' }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#E8936A', letterSpacing: 1 }}>PRO</Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        {/* Edge Summary */}
        <View style={s.edgeRow}>
          <View style={[s.edgeTile, { backgroundColor: 'rgba(122,157,184,0.08)' }]}>
            <Text style={[s.edgeCount, { color: TEAL }]}>{homeEdgeCount}</Text>
            <Text style={s.edgeTileLabel}>{homeTeam.abbreviation} Edges</Text>
          </View>
          <View style={[s.edgeTile, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
            <Text style={[s.edgeCount, { color: 'rgba(255,255,255,0.4)' }]}>{neutralCount}</Text>
            <Text style={s.edgeTileLabel}>Neutral</Text>
          </View>
          <View style={[s.edgeTile, { backgroundColor: 'rgba(232,147,106,0.08)' }]}>
            <Text style={[s.edgeCount, { color: CORAL }]}>{awayEdgeCount}</Text>
            <Text style={s.edgeTileLabel}>{awayTeam.abbreviation} Edges</Text>
          </View>
        </View>

        {/* Model Summary */}
        <View style={s.summaryCard}>
          <Text style={s.sectionLabel}>Model Summary</Text>
          <Text style={s.summaryText}>{prediction.analysis}</Text>
        </View>

        {/* Factors */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={s.sectionLabel}>Analysis Factors</Text>
          <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Sorted by impact</Text>
        </View>

        <View style={{ gap: 10 }}>
          {sorted.map((factor, index) => (
            <View key={factor.name} style={{ position: 'relative' }}>
              <FactorTile
                factor={factor}
                homeTeam={homeTeam}
                awayTeam={awayTeam}
              />
              {!isPremium && index >= 2 ? (
                <Pressable
                  onPress={() => router.push('/paywall')}
                  style={{
                    ...StyleSheet.absoluteFillObject,
                    zIndex: 10,
                    backgroundColor: 'rgba(4,6,8,0.8)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 14,
                  }}
                >
                  {index === 2 ? (
                    <View style={{ alignItems: 'center' }}>
                      <View style={{ backgroundColor: 'rgba(232,147,106,0.15)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(232,147,106,0.25)', marginBottom: 6 }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: '#E8936A', letterSpacing: 1 }}>PRO</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>Unlock all {sorted.length} factors</Text>
                      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Tap to subscribe</Text>
                    </View>
                  ) : null}
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>

        {/* Disclaimer */}
        <View style={{ marginTop: 20, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
            AI predictions are for entertainment purposes only. Not financial advice.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 },

  pickCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  pickCardInner: { padding: 16 },
  pickLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 1.5, marginBottom: 4 },
  pickTeam: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.3 },
  confBadge: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(232,147,106,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(232,147,106,0.2)',
    alignItems: 'center',
  },
  confValue: { fontSize: 22, fontWeight: '900', color: CORAL, lineHeight: 26 },
  confLabel: { fontSize: 7, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 0.8, marginTop: 2 },
  probRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  probTeam: { fontSize: 10, fontWeight: '800', width: 50 },
  probBar: { flex: 1, height: 6, borderRadius: 3, flexDirection: 'row', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)' },
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
  edgeTileLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.3)', marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase' },

  summaryCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 20,
  },
  summaryText: { fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 21, marginTop: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5, textTransform: 'uppercase' },

  factorTile: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, position: 'relative' },
  factorAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: 2 },
  factorInner: { flexDirection: 'row', gap: 12, padding: 14, paddingLeft: 16 },
  factorIconWrap: { width: 36, height: 36, borderRadius: 10, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  factorTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6, gap: 8 },
  factorName: { fontSize: 13, fontWeight: '800', flex: 1, lineHeight: 18 },
  edgeBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, flexShrink: 0 },
  edgeBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  factorDesc: { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  barsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLabel: { fontSize: 10, fontWeight: '800', width: 30 },
  barTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
});
