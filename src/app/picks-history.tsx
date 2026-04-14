import React, { useMemo, useState, memo } from 'react';
import { View, Text, Pressable, SectionList, ActivityIndicator, Dimensions, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle as SvgCircle, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useUserPicks } from '@/hooks/usePicks';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { getTeamColors } from '@/lib/team-colors';
import { Sport } from '@/types/sports';
import { displaySport } from '@/lib/display-confidence';

const { width: SW } = Dimensions.get('window');

// ─── PALETTE ───
const C = {
  BG: '#040608',
  GLASS: 'rgba(8,8,12,0.95)',
  GLASS_INNER: 'rgba(2,3,8,0.92)',
  BORDER: 'rgba(255,255,255,0.08)',
  BORDER_HI: 'rgba(255,255,255,0.14)',
  MAROON: '#8B0A1F',
  MAROON_DIM: 'rgba(139,10,31,0.15)',
  MAROON_GLOW: 'rgba(139,10,31,0.30)',
  TEAL: '#7A9DB8',
  TEAL_DIM: 'rgba(122,157,184,0.12)',
  TEAL_DARK: '#5A7A8A',
  ERROR: '#EF4444',
  ERROR_DIM: 'rgba(239,68,68,0.15)',
  TEXT: '#FFFFFF',
  TEXT2: '#A1B3C9',
  MUTED: '#6B7C94',
} as const;

// ─── TYPES ───
interface PickTile {
  id: string;
  gameId: string;
  abbreviation: string;
  opponentAbbr: string;
  sport: string;
  result: string;
  createdAt: string;
  time: string;
}

interface PickSection {
  title: string;
  subtitle: string;
  record: { w: number; l: number };
  data: PickTile[];
}

// ─── HELPERS ───
function formatDateHeader(dateStr: string): { title: string; subtitle: string } {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const pickDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (pickDate.getTime() === today.getTime()) return { title: 'Today', subtitle: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) };
  if (pickDate.getTime() === yesterday.getTime()) return { title: 'Yesterday', subtitle: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) };

  const diffDays = Math.round((today.getTime() - pickDate.getTime()) / 86400000);
  if (diffDays < 7) {
    return { title: date.toLocaleDateString('en-US', { weekday: 'long' }), subtitle: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) };
  }

  return {
    title: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    subtitle: date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric' }),
  };
}

function getDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─── PICK CARD ───
const PickCard = memo(function PickCard({ item, index }: { item: PickTile; index: number }) {
  const router = useRouter();
  const teamColors = getTeamColors(item.abbreviation, item.sport as Sport);
  const jerseyType = sportEnumToJersey(item.sport);
  const isWin = item.result === 'win';
  const isLoss = item.result === 'loss';

  const accentColor = isWin ? C.TEAL : isLoss ? C.MAROON : C.MUTED;
  const accentDim = isWin ? C.TEAL_DIM : isLoss ? C.MAROON_DIM : 'rgba(255,255,255,0.04)';

  return (
    <Animated.View entering={FadeInDown.duration(300).delay(Math.min(index * 40, 200))}>
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/game/${item.gameId}`); }}
        style={({ pressed }) => [s.pickCard, {
          borderColor: isWin ? 'rgba(122,157,184,0.12)' : isLoss ? 'rgba(139,10,31,0.12)' : C.BORDER,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        }]}
      >
        {/* Left accent line */}
        <View style={[s.accentLine, { backgroundColor: accentColor }]} />

        {/* Team color wash */}
        <LinearGradient
          colors={[`${teamColors.primary}15`, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={s.pickCardInner}>
          {/* Jersey */}
          <View style={s.jerseyWrap}>
            <View style={[s.jerseyGlow, { backgroundColor: accentDim }]} />
            <JerseyIcon teamCode={item.abbreviation} primaryColor={teamColors.primary} secondaryColor={teamColors.secondary} size={42} sport={jerseyType} />
          </View>

          {/* Team info */}
          <View style={s.pickInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.pickTeam}>{item.abbreviation}</Text>
              <View style={[s.sportPill, { borderColor: `${accentColor}30` }]}>
                <Text style={[s.sportPillText, { color: accentColor }]}>{displaySport(item.sport)}</Text>
              </View>
            </View>
            <Text style={s.pickVs}>vs {item.opponentAbbr} <Text style={{ color: 'rgba(255,255,255,0.15)' }}> {item.time}</Text></Text>
          </View>

          {/* Result badge */}
          <View style={s.resultWrap}>
            {isWin ? (
              <View style={s.resultBadge}>
                <LinearGradient colors={[C.TEAL, C.TEAL_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
                <Text style={s.resultText}>W</Text>
              </View>
            ) : isLoss ? (
              <View style={s.resultBadge}>
                <LinearGradient colors={[C.MAROON, '#6A0818']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
                <Text style={s.resultText}>L</Text>
              </View>
            ) : (
              <View style={[s.resultBadge, { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }]}>
                <Text style={[s.resultText, { color: C.MUTED, fontSize: 9 }]}>Pending</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

// ─── STAT RING ───
function StatRing({ value, label, color, total }: { value: number; label: string; color: string; total: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? value / total : 0;
  const offset = circ * (1 - pct);

  return (
    <View style={s.statRing}>
      <View style={{ width: 52, height: 52, marginBottom: 4 }}>
        <Svg width={52} height={52} viewBox="0 0 52 52">
          <SvgCircle cx={26} cy={26} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth={3.5} fill="none" />
          <SvgCircle cx={26} cy={26} r={r} stroke={color} strokeWidth={3.5} fill="none"
            strokeDasharray={`${circ}`} strokeDashoffset={`${offset}`} strokeLinecap="round"
            transform="rotate(-90 26 26)" opacity={0.9} />
        </Svg>
        <View style={s.statRingCenter}>
          <Text style={[s.statRingValue, { color }]}>{value}</Text>
        </View>
      </View>
      <Text style={s.statRingLabel}>{label}</Text>
    </View>
  );
}

// ─── MAIN SCREEN ───
export default function PicksHistoryScreen() {
  const router = useRouter();
  const { data: picks, isLoading } = useUserPicks();
  const [filter, setFilter] = useState<'all' | 'win' | 'loss' | 'pending'>('all');

  const allTiles = useMemo<PickTile[]>(() => {
    if (!picks || picks.length === 0) return [];
    return [...picks]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((p) => ({
        id: p.id,
        gameId: p.gameId,
        abbreviation: p.pickedTeam === 'home' ? (p.homeTeam ?? '??') : (p.awayTeam ?? '??'),
        opponentAbbr: p.pickedTeam === 'home' ? (p.awayTeam ?? '??') : (p.homeTeam ?? '??'),
        sport: p.sport ?? 'NBA',
        result: p.result ?? 'pending',
        createdAt: p.createdAt,
        time: formatTime(p.createdAt),
      }));
  }, [picks]);

  const sections = useMemo<PickSection[]>(() => {
    const filtered = filter === 'all' ? allTiles : allTiles.filter(t => t.result === filter);
    const grouped = new Map<string, PickSection>();

    for (const t of filtered) {
      const key = getDateKey(t.createdAt);
      if (!grouped.has(key)) {
        const { title, subtitle } = formatDateHeader(t.createdAt);
        grouped.set(key, { title, subtitle, record: { w: 0, l: 0 }, data: [] });
      }
      const section = grouped.get(key)!;
      section.data.push(t);
      if (t.result === 'win') section.record.w++;
      if (t.result === 'loss') section.record.l++;
    }

    return Array.from(grouped.values());
  }, [allTiles, filter]);

  const summary = useMemo(() => {
    if (!picks) return { total: 0, wins: 0, losses: 0, pending: 0, rate: 0 };
    const wins = picks.filter(p => p.result === 'win').length;
    const losses = picks.filter(p => p.result === 'loss').length;
    const decided = wins + losses;
    return { total: picks.length, wins, losses, pending: picks.length - decided, rate: decided > 0 ? Math.round((wins / decided) * 100) : 0 };
  }, [picks]);

  const filters: { key: typeof filter; label: string; count: number; color: string }[] = [
    { key: 'all', label: 'All', count: summary.total, color: C.TEXT },
    { key: 'win', label: 'Wins', count: summary.wins, color: C.TEAL },
    { key: 'loss', label: 'Losses', count: summary.losses, color: C.MAROON },
    { key: 'pending', label: 'Pending', count: summary.pending, color: C.TEXT2 },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      {/* Top gradient wash */}
      <LinearGradient
        colors={[C.MAROON_GLOW, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 0.3 }}
        style={[StyleSheet.absoluteFill, { height: 300 }]}
      />
      <LinearGradient
        colors={[C.TEAL_DIM, 'transparent']}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.5, y: 0.3 }}
        style={[StyleSheet.absoluteFill, { height: 300 }]}
      />

      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* ── HEADER ── */}
        <View style={s.header}>
          <Pressable
            onPress={() => router.back()}
            style={s.backBtn}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Pick History</Text>
            <Text style={s.headerSub}>{summary.total} picks  {summary.rate}% win rate</Text>
          </View>
        </View>

        {/* ── STAT RINGS ── */}
        <Animated.View entering={FadeInDown.duration(400)} style={s.statsRow}>
          <StatRing value={summary.wins} label="WINS" color={C.TEAL} total={summary.total} />
          <StatRing value={summary.losses} label="LOSSES" color={C.MAROON} total={summary.total} />
          <StatRing value={summary.pending} label="PENDING" color={C.TEXT2} total={summary.total} />

          {/* Accuracy */}
          <View style={s.statRing}>
            <View style={{ width: 52, height: 52, marginBottom: 4, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={52} height={52} viewBox="0 0 52 52">
                <Defs>
                  <SvgGrad id="accGrad" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0" stopColor={C.MAROON} />
                    <Stop offset="1" stopColor={C.TEAL} />
                  </SvgGrad>
                </Defs>
                <SvgCircle cx={26} cy={26} r={22} stroke="rgba(255,255,255,0.06)" strokeWidth={3.5} fill="none" />
                <SvgCircle cx={26} cy={26} r={22} stroke="url(#accGrad)" strokeWidth={3.5} fill="none"
                  strokeDasharray={`${2 * Math.PI * 22}`} strokeDashoffset={`${2 * Math.PI * 22 * (1 - summary.rate / 100)}`}
                  strokeLinecap="round" transform="rotate(-90 26 26)" />
              </Svg>
              <View style={s.statRingCenter}>
                <Text style={[s.statRingValue, { fontSize: 13 }]}>{summary.rate}%</Text>
              </View>
            </View>
            <Text style={s.statRingLabel}>RATE</Text>
          </View>
        </Animated.View>

        {/* ── FILTER PILLS ── */}
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.filterRow}>
          {filters.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFilter(f.key); }}
                style={[s.filterPill, active && { borderColor: f.color, backgroundColor: `${f.color}10` }]}
              >
                <Text style={[s.filterPillText, active && { color: f.color }]}>{f.label}</Text>
                <View style={[s.filterPillCount, active && { backgroundColor: `${f.color}20` }]}>
                  <Text style={[s.filterPillCountText, active && { color: f.color }]}>{f.count}</Text>
                </View>
              </Pressable>
            );
          })}
        </Animated.View>

        {/* ── LIST ── */}
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={C.TEAL} />
          </View>
        ) : sections.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.TEAL_DIM, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                <Path d="M9 5H5v4m14-4h-4m4 0v4M5 15v4h4m10 0h-4m4 0v-4" stroke={C.TEAL} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            </View>
            <Text style={{ fontSize: 15, fontWeight: '700', color: C.TEXT, marginBottom: 6, textAlign: 'center' }}>
              {filter === 'all' ? 'No picks yet' : `No ${filter === 'pending' ? 'pending' : filter === 'win' ? 'winning' : 'losing'} picks`}
            </Text>
            <Text style={{ fontSize: 12, color: C.MUTED, textAlign: 'center' }}>
              {filter === 'all' ? 'Head to the home page to make your first pick.' : 'Try a different filter to see your picks.'}
            </Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => <PickCard item={item} index={index} />}
            renderSectionHeader={({ section }) => (
              <View style={s.sectionHeader}>
                <View style={s.sectionHeaderLeft}>
                  <View style={[s.sectionDot, {
                    backgroundColor: section.record.w > section.record.l ? C.TEAL : section.record.l > section.record.w ? C.MAROON : C.MUTED,
                  }]} />
                  <Text style={s.sectionTitle}>{section.title}</Text>
                  <Text style={s.sectionSub}>{section.subtitle}</Text>
                </View>
                <View style={s.sectionRecord}>
                  {section.record.w > 0 ? <Text style={[s.sectionRecordText, { color: C.TEAL }]}>{section.record.w}W</Text> : null}
                  {section.record.l > 0 ? <Text style={[s.sectionRecordText, { color: C.MAROON }]}>{section.record.l}L</Text> : null}
                  {section.data.filter(d => d.result === 'pending').length > 0 ? (
                    <Text style={[s.sectionRecordText, { color: C.MUTED }]}>{section.data.filter(d => d.result === 'pending').length}P</Text>
                  ) : null}
                </View>
              </View>
            )}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 50 }}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── STYLES ───
const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: C.TEXT,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 11,
    color: C.MUTED,
    marginTop: 1,
    letterSpacing: 0.3,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  statRing: {
    alignItems: 'center',
  },
  statRingCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statRingValue: {
    fontSize: 15,
    fontWeight: '800',
    color: C.TEXT,
  },
  statRingLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: C.MUTED,
    letterSpacing: 1.2,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  filterPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.BORDER,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: C.MUTED,
  },
  filterPillCount: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  filterPillCountText: {
    fontSize: 9,
    fontWeight: '700',
    color: C.MUTED,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: C.TEXT,
    letterSpacing: -0.2,
  },
  sectionSub: {
    fontSize: 11,
    color: C.MUTED,
  },
  sectionRecord: {
    flexDirection: 'row',
    gap: 6,
  },
  sectionRecordText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pickCard: {
    marginHorizontal: 16,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: C.GLASS,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  accentLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  pickCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingLeft: 14,
  },
  jerseyWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  jerseyGlow: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  pickInfo: {
    flex: 1,
  },
  pickTeam: {
    fontSize: 15,
    fontWeight: '800',
    color: C.TEXT,
    letterSpacing: -0.3,
  },
  pickVs: {
    fontSize: 11,
    color: C.MUTED,
    marginTop: 2,
  },
  sportPill: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  sportPillText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  resultWrap: {
    marginLeft: 8,
  },
  resultBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  resultText: {
    fontSize: 13,
    fontWeight: '900',
    color: C.TEXT,
    letterSpacing: 0.5,
  },
});
