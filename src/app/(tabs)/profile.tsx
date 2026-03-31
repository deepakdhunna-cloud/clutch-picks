import React, { useState, useCallback, useMemo, memo } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, Image, Alert, Dimensions, ScrollView, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Path, Circle as SvgCircle, Defs, LinearGradient as SvgGradient, Stop, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useSession, useInvalidateSession } from '@/lib/auth/use-session';
import { useUserStats, useUserPicks } from '@/hooks/usePicks';
import { useGames } from '@/hooks/useGames';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { api } from '@/lib/api/api';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { getTeamColors } from '@/lib/team-colors';
import { authClient } from '@/lib/auth/auth-client';
import { GameWithPrediction, GameStatus } from '@/types/sports';
import { isRevenueCatEnabled, logoutUser } from '@/lib/revenuecatClient';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── COLORS ───
const C = {
  MAROON: '#8B0A1F',
  MAROON_DIM: 'rgba(139,10,31,0.15)',
  MAROON_GLOW: 'rgba(139,10,31,0.30)',
  TEAL: '#7A9DB8',
  TEAL_DIM: 'rgba(122,157,184,0.12)',
  TEAL_DARK: '#5A7A8A',
  LIVE_RED: '#DC2626',
  ERROR: '#EF4444',
  ERROR_DIM: 'rgba(239,68,68,0.15)',
  SILVER: '#C9CED6',
  BG: '#040608',
  GLASS: 'rgba(8,8,12,0.95)',
  GLASS_INNER: 'rgba(2,3,8,0.92)',
  BORDER: 'rgba(255,255,255,0.08)',
  BORDER_HI: 'rgba(255,255,255,0.14)',
  TEXT_PRIMARY: '#FFFFFF',
  TEXT_SECONDARY: '#A1B3C9',
  TEXT_MUTED: '#6B7C94',
} as const;

// ─── SVG ICONS ───
function GearIcon({ size = 16, color = C.TEXT_MUTED }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function StarIcon({ size = 12, color = C.TEAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}

function BoltIcon({ size = 12, color = C.MAROON }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function TrendIcon({ size = 12, color = C.TEAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 3v18h18" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M7 14l4-4 4 4 5-5" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function GridIcon({ size = 18, color = C.MAROON }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 5H5v4m14-4h-4m4 0v4M5 15v4h4m10 0h-4m4 0v-4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function HeartCheckIcon({ size = 18, color = C.MAROON }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 6C9.5 2 2 2.5 2 8.5 2 14 12 21 12 21s10-7 10-12.5C22 2.5 14.5 2 12 6z" stroke={color} strokeWidth={1.5} fill={C.MAROON_DIM} />
      <Path d="M8.5 10L11 12.5 15.5 8" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function TargetIcon({ size = 18, color = C.MAROON }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <SvgCircle cx={12} cy={12} r={10} stroke={color} strokeWidth={1.5} fill={C.MAROON_DIM} />
      <SvgCircle cx={12} cy={12} r={6} stroke={color} strokeWidth={1} opacity={0.5} />
      <SvgCircle cx={12} cy={12} r={2} fill={color} />
    </Svg>
  );
}

function TrophyIcon({ size = 18, color = C.MAROON }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 9H3a1 1 0 01-1-1V5a1 1 0 011-1h3m12 5h3a1 1 0 001-1V5a1 1 0 00-1-1h-3M6 4h12v7a6 6 0 01-12 0V4z" stroke={color} strokeWidth={1.5} fill={C.MAROON_DIM} />
      <Path d="M9 21h6m-3-3v3" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

function StarOutlineIcon({ size = 18, color = '#2A3444' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2l2.09 6.26L20.18 9l-5.09 3.74L16.18 19 12 15.27 7.82 19l1.09-6.26L3.82 9l6.09-.74L12 2z" stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

function ShareIcon({ size = 14, color = C.TEXT_SECONDARY }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

function UserIcon({ size = 40, color = C.TEAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <SvgCircle cx={12} cy={7} r={4} stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

// ─── SPORT MASTERY RING ───
const SportMasteryRing = memo(function SportMasteryRing({ sport, pct, wins, total }: { sport: string; pct: number; wins: number; total: number }) {
  const r = 21;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  const ringColor = pct > 65 ? C.TEAL : pct >= 55 ? C.MAROON : C.TEAL_DARK;

  return (
    <View style={{ minWidth: 88, backgroundColor: C.GLASS, borderRadius: 16, padding: 14, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center' }}>
      <View style={{ width: 48, height: 48, marginBottom: 6 }}>
        <Svg width={48} height={48} viewBox="0 0 48 48">
          <SvgCircle cx={24} cy={24} r={r} stroke="#2A3444" strokeWidth={3} fill="none" />
          <SvgCircle cx={24} cy={24} r={r} stroke={ringColor} strokeWidth={3} fill="none"
            strokeDasharray={`${circ}`} strokeDashoffset={`${offset}`} strokeLinecap="round"
            transform="rotate(-90 24 24)" />
        </Svg>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: C.TEXT_PRIMARY }}>{pct}%</Text>
        </View>
      </View>
      <Text style={{ fontSize: 10, fontWeight: '700', color: C.TEXT_PRIMARY, marginBottom: 2 }}>{sport}</Text>
      <Text style={{ fontSize: 8, color: C.TEXT_MUTED }}>{wins}-{total - wins}</Text>
    </View>
  );
});

// ─── ACHIEVEMENT BADGE ───
const AchievementBadge = memo(function AchievementBadge({ name, desc, earned, icon }: { name: string; desc: string; earned: boolean; icon: string }) {
  const iconColor = earned ? C.MAROON : '#2A3444';
  const IconComp = icon === 'heart_check' ? HeartCheckIcon : icon === 'target' ? TargetIcon : icon === 'trophy' ? TrophyIcon : StarOutlineIcon;

  return (
    <View style={{ minWidth: 90, backgroundColor: C.GLASS, borderRadius: 14, padding: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center' }}>
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: earned ? C.MAROON_DIM : 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', marginBottom: 8, opacity: earned ? 1 : 0.4 }}>
        <IconComp size={18} color={iconColor} />
      </View>
      <Text style={{ fontSize: 10, fontWeight: '700', color: C.TEXT_PRIMARY, opacity: earned ? 1 : 0.4, marginBottom: 2 }}>{name}</Text>
      <Text style={{ fontSize: 8, color: C.TEXT_MUTED }}>{desc}</Text>
    </View>
  );
});

// ─── SIGNATURE CALL CARD ───
const SignatureCallCard = memo(function SignatureCallCard({ type, data }: {
  type: 'best' | 'boldest';
  data: { away: string; home: string; awayScore: number; homeScore: number; sport: string; date: string; detail: string };
}) {
  const isBest = type === 'best';
  const accentColor = isBest ? C.TEAL : C.MAROON;

  return (
    <View style={{ backgroundColor: C.GLASS, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginBottom: 8, position: 'relative', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: accentColor }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        {isBest ? <StarIcon size={12} color={C.TEAL} /> : <BoltIcon size={12} color={C.MAROON} />}
        <Text style={{ fontSize: 8, fontWeight: '700', color: accentColor, letterSpacing: 1.5 }}>
          {isBest ? 'BEST CALL THIS MONTH' : 'BOLDEST CALL THIS MONTH'}
        </Text>
      </View>
      <Text style={{ fontSize: 14, fontWeight: '700', color: C.TEXT_PRIMARY, marginBottom: 6 }}>
        {data.away} {data.awayScore} - {data.home} {data.homeScore}
      </Text>
      <Text style={{ fontSize: 11, color: C.TEXT_SECONDARY, lineHeight: 16 }}>{data.detail}</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
        <View style={{ backgroundColor: C.TEAL_DIM, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontSize: 9, fontWeight: '700', color: C.TEAL }}>Correct</Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontSize: 9, fontWeight: '600', color: C.TEXT_MUTED }}>{data.sport}</Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontSize: 9, fontWeight: '600', color: C.TEXT_MUTED }}>{data.date}</Text>
        </View>
      </View>
    </View>
  );
});

// ─── SIGNED OUT STATE ───
const SignedOutState = memo(function SignedOutState() {
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.TEAL_DIM, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <UserIcon size={40} color={C.TEAL} />
        </View>
        <Text style={{ fontSize: 20, fontWeight: '800', color: C.TEXT_PRIMARY, marginBottom: 8, textAlign: 'center' }}>Sign in to see your card</Text>
        <Text style={{ fontSize: 14, color: C.TEXT_MUTED, textAlign: 'center', marginBottom: 28 }}>Track your picks, build your analyst record.</Text>
        <Pressable onPress={() => router.replace('/sign-in')} style={{ width: '100%', borderRadius: 14, overflow: 'hidden' }}>
          <LinearGradient colors={[C.TEAL, C.TEAL_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 16, alignItems: 'center', borderRadius: 14 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.TEXT_PRIMARY }}>Sign In</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </SafeAreaView>
  );
});

// ─── MAIN SCREEN ───
export default function ProfileScreen() {
  const router = useRouter();
  const { data: session, isLoading: sessionLoading } = useSession();
  const userId = session?.user?.id;
  const { data: stats, refetch: refetchStats } = useUserStats();
  const { data: picks } = useUserPicks();
  const { data: allGames } = useGames();
  const invalidateSession = useInvalidateSession();
  const scrollHandler = useHideOnScroll();

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ id: string; name: string; email: string | null; image: string | null; bio: string | null }>('/api/profile'),
    enabled: !!userId,
  });

  useFocusEffect(useCallback(() => { refetchStats(); }, [refetchStats]));

  // Derived
  const userName = session?.user?.name ?? 'Player';
  const userImage = profile?.image ?? session?.user?.image ?? null;
  const initial = userName.charAt(0).toUpperCase();
  const userEmail = (profile?.email ?? session?.user?.email ?? null) as string | null;
  const handle = userEmail ?? `@clutch${userName.toLowerCase().replace(/\s/g, '')}`;

  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const totalPicks = stats?.picksMade ?? 0;
  const accuracy = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
  const streak = stats?.currentStreak ?? 0;

  // Form line
  // Recent picks with game data for jersey tiles — works even for old games not in today's list
  const recentPickTiles = useMemo(() => {
    if (!picks || picks.length === 0) return [];
    if (__DEV__) console.log('[Profile] picks count:', picks.length, 'games count:', allGames?.length ?? 0);
    const gameMap = new Map((allGames ?? []).map((g) => [g.id, g]));
    const tiles = [...picks].reverse().slice(0, 15).map((p) => {
      const game = gameMap.get(p.gameId);
      // Use game data if available, fall back to pick's own fields
      const pickedAbbr = p.pickedTeam === 'home'
        ? (game?.homeTeam?.abbreviation ?? p.homeTeam ?? '??')
        : (game?.awayTeam?.abbreviation ?? p.awayTeam ?? '??');
      const opponentAbbr = p.pickedTeam === 'home'
        ? (game?.awayTeam?.abbreviation ?? p.awayTeam ?? '??')
        : (game?.homeTeam?.abbreviation ?? p.homeTeam ?? '??');
      const sport = game?.sport ?? p.sport ?? 'NBA';
      const pickedTeamObj = game
        ? (p.pickedTeam === 'home' ? game.homeTeam : game.awayTeam)
        : null;
      return {
        id: p.id,
        abbreviation: pickedAbbr,
        opponentAbbr,
        color: pickedTeamObj?.color ?? '#5A7A8A',
        result: p.result ?? 'pending',
        sport,
      };
    });
    if (__DEV__) console.log('[Profile] tiles generated:', tiles.length, tiles.slice(0, 3).map(t => `${t.abbreviation} vs ${t.opponentAbbr} (${t.result})`));
    return tiles;
  }, [picks, allGames]);

  const formLine = useMemo(() => {
    if (!picks) return [];
    return [...picks].reverse().slice(0, 10).map((p) => p.result ?? 'pending');
  }, [picks]);

  const formRecord = useMemo(() => {
    const w = formLine.filter((r) => r === 'win').length;
    const l = formLine.filter((r) => r === 'loss').length;
    return { w, l };
  }, [formLine]);

  // Best streak ever
  const bestStreak = useMemo(() => {
    if (!picks) return 0;
    let best = 0, cur = 0;
    for (const p of [...picks].reverse()) {
      if (p.result === 'win') { cur++; best = Math.max(best, cur); } else cur = 0;
    }
    return best;
  }, [picks]);

  // Tier badge
  const tierBadge = useMemo(() => {
    if (accuracy >= 75) return { label: 'Elite', bg: C.MAROON_DIM, color: C.MAROON };
    if (accuracy >= 65) return { label: 'Expert', bg: C.TEAL_DIM, color: C.TEAL };
    if (accuracy >= 55) return { label: 'Analyst', bg: 'rgba(255,255,255,0.06)', color: C.TEXT_MUTED };
    return null;
  }, [accuracy]);

  // Weekly trend
  const weekTrend = useMemo(() => {
    if (!picks || picks.length < 5) return null;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const recentPicks = picks.filter((p) => new Date(p.createdAt) >= weekAgo && (p.result === 'win' || p.result === 'loss'));
    if (recentPicks.length < 3) return null;
    const recentWins = recentPicks.filter((p) => p.result === 'win').length;
    const recentAcc = Math.round((recentWins / recentPicks.length) * 100);
    const diff = recentAcc - accuracy;
    if (diff === 0) return null;
    return diff > 0 ? `+${diff}% this week` : `${diff}% this week`;
  }, [picks, accuracy]);

  // Sport breakdown
  const sportBreakdown = useMemo(() => {
    if (!picks || !allGames) return [];
    const gameMap = new Map(allGames.map((g) => [g.id, g]));
    const map = new Map<string, { wins: number; total: number }>();
    for (const p of picks) {
      const game = gameMap.get(p.gameId);
      const sport = game?.sport ?? p.sport ?? 'Unknown';
      if (sport === 'Unknown') continue;
      const e = map.get(sport) ?? { wins: 0, total: 0 };
      if (p.result === 'win') e.wins++;
      if (p.result === 'win' || p.result === 'loss') e.total++;
      map.set(sport, e);
    }
    return Array.from(map.entries())
      .filter(([, d]) => d.total >= 2)
      .map(([sport, d]) => ({ sport, wins: d.wins, total: d.total, pct: Math.round((d.wins / d.total) * 100) }))
      .sort((a, b) => b.total - a.total);
  }, [picks, allGames]);

  // Signature calls
  const signatureCalls = useMemo(() => {
    if (!picks || !allGames) return { bestCall: null, boldestCall: null };
    const gameMap = new Map(allGames.map((g) => [g.id, g]));
    const wonPicks = picks.filter((p) => p.result === 'win');
    type CallData = { away: string; home: string; awayScore: number; homeScore: number; sport: string; date: string; detail: string };

    let bestCall: CallData | null = null;
    let bestConf = 0;
    for (const p of wonPicks) {
      const game = gameMap.get(p.gameId);
      if (!game?.prediction) continue;
      const conf = game.prediction.confidence ?? 50;
      if (conf > bestConf) {
        bestConf = conf;
        bestCall = {
          away: game.awayTeam.abbreviation, home: game.homeTeam.abbreviation,
          awayScore: game.awayScore ?? 0, homeScore: game.homeScore ?? 0,
          sport: game.sport, date: new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          detail: `Called at ${conf}% confidence. The model's top-rated pick that day.`,
        };
      }
    }

    let boldestCall: CallData | null = null;
    let lowestConf = 100;
    for (const p of wonPicks) {
      const game = gameMap.get(p.gameId);
      if (!game?.prediction) continue;
      const conf = game.prediction.confidence ?? 50;
      const pickedHome = p.pickedTeam === 'home';
      const modelPickedHome = game.prediction.predictedWinner === 'home';
      const wentAgainstModel = pickedHome !== modelPickedHome;
      if (wentAgainstModel || conf < lowestConf) {
        if (wentAgainstModel || conf < 55) {
          lowestConf = wentAgainstModel ? 0 : conf;
          boldestCall = {
            away: game.awayTeam.abbreviation, home: game.homeTeam.abbreviation,
            awayScore: game.awayScore ?? 0, homeScore: game.homeScore ?? 0,
            sport: game.sport, date: new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            detail: wentAgainstModel
              ? `Went against the model and won. ${conf}% said the other side.`
              : `Picked at just ${conf}% confidence. Saw value others missed.`,
          };
        }
      }
    }
    return { bestCall, boldestCall };
  }, [picks, allGames]);

  // Weekly rhythm
  const weeklyRhythm = useMemo(() => {
    if (!picks) return [];
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    return days.map((label, i) => {
      const dayStart = new Date(monday);
      dayStart.setDate(monday.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const isFuture = dayStart > now;
      const dayPicks = picks.filter((p) => {
        const d = new Date(p.createdAt);
        return d >= dayStart && d < dayEnd && (p.result === 'win' || p.result === 'loss');
      });
      const w = dayPicks.filter((p) => p.result === 'win').length;
      const l = dayPicks.filter((p) => p.result === 'loss').length;
      return { label, w, l, total: w + l, isFuture };
    });
  }, [picks]);

  const weekInsight = useMemo(() => {
    const activeDays = weeklyRhythm.filter((d) => d.total > 0);
    if (activeDays.length === 0) return 'Make picks this week to see your rhythm.';
    const best = activeDays.reduce((a, b) => {
      const aRate = a.w / Math.max(a.total, 1);
      const bRate = b.w / Math.max(b.total, 1);
      return bRate > aRate || (bRate === aRate && b.total > a.total) ? b : a;
    });
    return `Your best day this week was ${best.label.charAt(0) + best.label.slice(1).toLowerCase()} — ${best.w}-${best.l} record.`;
  }, [weeklyRhythm]);

  // Achievements
  const achievements = useMemo(() => [
    { id: 'hot_streak', name: 'Hot Streak', desc: '7+ correct', earned: streak >= 7 || bestStreak >= 7, icon: 'heart_check' },
    { id: 'sharpshooter', name: 'Sharpshooter', desc: '70%+ accuracy', earned: accuracy >= 70, icon: 'target' },
    { id: 'century', name: 'Century', desc: '100 picks', earned: totalPicks >= 100, icon: 'trophy' },
    { id: 'diamond', name: 'Diamond', desc: 'Top 5%', earned: false, icon: 'star' },
  ], [streak, bestStreak, accuracy, totalPicks]);

  const earnedCount = achievements.filter((a) => a.earned).length;

  // Sign out
  const handleSignOut = useCallback(async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          try {
            await authClient.signOut();
            if (isRevenueCatEnabled()) { try { await logoutUser(); } catch {} }
            await invalidateSession();
            router.replace('/welcome');
          } catch {
            Alert.alert('Error', 'Failed to sign out. Please try again.');
          }
        },
      },
    ]);
  }, [invalidateSession, router]);

  // Loading
  if (sessionLoading) {
    return <View style={{ flex: 1, backgroundColor: C.BG, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={C.TEAL} /></View>;
  }

  if (!session) return <SignedOutState />;

  // Accuracy markers
  const markers = [50, 60, 70, 80];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.BG }}>
      <Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>

        {/* ── PAGE HEADER ── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}>
          <Svg width={240} height={42} viewBox="0 0 240 42">
            <Defs>
              <SvgGradient id="headerGrad" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#4A0812" />
                <Stop offset="0.35" stopColor="#6B3A4A" />
                <Stop offset="0.65" stopColor="#7A6878" />
                <Stop offset="1" stopColor={C.TEAL_DARK} />
              </SvgGradient>
            </Defs>
            <SvgText x="0" y="33" fontSize="34" fontWeight="800" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">Analyst Card</SvgText>
            <SvgText x="0" y="33" fontSize="34" fontWeight="800" fill="url(#headerGrad)" stroke="none" strokeWidth={0}>Analyst Card</SvgText>
          </Svg>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/settings'); }}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            <GearIcon size={18} color={C.TEXT_PRIMARY} />
          </Pressable>
        </View>

        {/* ── 1. ANALYST CARD HERO ── */}
        <Animated.View entering={FadeInDown.duration(500)} style={{ marginHorizontal: 16 }}>
<View style={{ borderRadius: 24, overflow: 'hidden', borderWidth: 4, borderColor: 'rgba(255,255,255,0.14)', position: 'relative' }}>

            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.GLASS }} />
            <LinearGradient colors={[C.MAROON_GLOW, 'transparent', 'transparent', C.TEAL_DIM]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

            <View style={{ padding: 22, paddingTop: 16 }}>
              <View />

              {/* Avatar + Identity */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, padding: 3, overflow: 'hidden' }}>
                  <LinearGradient colors={[C.MAROON, C.TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 36 }} />
                  <View style={{ flex: 1, borderRadius: 33, backgroundColor: C.BG, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {userImage ? (
                      <Image source={{ uri: userImage }} style={{ width: '100%', height: '100%' }} />
                    ) : (
                      <Text style={{ fontSize: 24, fontWeight: '800', color: C.TEXT_PRIMARY }}>{initial}</Text>
                    )}
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: C.TEXT_PRIMARY, letterSpacing: -0.3 }}>{userName}</Text>
                  <Text style={{ fontSize: 12, color: C.TEXT_MUTED, marginTop: 2 }}>{handle}</Text>
                  {totalPicks >= 10 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.MAROON_DIM, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10, alignSelf: 'flex-start', marginTop: 6 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.MAROON }} />
                      <Text style={{ fontSize: 9, fontWeight: '700', color: C.MAROON, letterSpacing: 1 }}>VERIFIED ANALYST</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Accuracy Rating */}
              <View style={{ paddingVertical: 20 }}>
                {/* Top divider — visible in middle, fades outward */}
                <LinearGradient colors={['transparent', 'rgba(255,255,255,0.15)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1 }} />
                {/* Bottom divider — visible in middle, fades outward */}
                <LinearGradient colors={['transparent', 'rgba(255,255,255,0.15)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1 }} />
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 52, fontWeight: '800', color: '#FFFFFF', lineHeight: 52, letterSpacing: -2 }}>{accuracy}%</Text>
                  <View style={{ alignItems: 'flex-end', paddingBottom: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: C.TEXT_MUTED, letterSpacing: 1.5 }}>ACCURACY</Text>
                    {tierBadge ? (
                      <View style={{ backgroundColor: tierBadge.bg, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3, marginTop: 4 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: tierBadge.color }}>{tierBadge.label}</Text>
                      </View>
                    ) : null}
                    {weekTrend ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 }}>
                        {weekTrend.startsWith('+') ? (
                          <Svg width={8} height={8} viewBox="0 0 24 24" fill="none"><Path d="M12 19V5M5 12l7-7 7 7" stroke={C.TEAL} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /></Svg>
                        ) : null}
                        <Text style={{ fontSize: 10, fontWeight: '700', color: weekTrend.startsWith('+') ? C.TEAL : C.ERROR }}>{weekTrend}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* Accuracy bar */}
                <View style={{ marginTop: 14 }}>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: '#2A3444', overflow: 'hidden' }}>
                    <LinearGradient colors={[C.MAROON, C.TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: '100%', width: `${Math.min(accuracy, 100)}%`, borderRadius: 3 }} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 2 }}>
                    {markers.map((m) => {
                      const closest = markers.reduce((a, b) => Math.abs(b - accuracy) < Math.abs(a - accuracy) ? b : a);
                      return <Text key={m} style={{ fontSize: 8, color: m === closest ? C.TEAL : C.TEXT_MUTED }}>{m}%</Text>;
                    })}
                  </View>
                </View>
              </View>

              {/* Form line */}
              <View style={{ marginTop: 16 }}>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {Array.from({ length: 10 }).map((_, i) => {
                    const result = formLine[i];
                    const isWin = result === 'win';
                    const isLoss = result === 'loss';
                    return <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: isWin ? C.TEAL : isLoss ? C.ERROR : '#2A3444', opacity: isLoss ? 0.5 : 1 }} />;
                  })}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ fontSize: 9, color: C.TEXT_MUTED }}>Last 10 predictions</Text>
                  <Text style={{ fontSize: 9, fontWeight: '600', color: C.TEAL }}>{formRecord.w}-{formRecord.l}</Text>
                </View>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ── 2. EDIT PROFILE + SHARE BUTTONS ── */}
        <Animated.View entering={FadeInDown.duration(500).delay(100)} style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 20 }}>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/edit-profile'); }}
            style={{ flex: 1, backgroundColor: C.MAROON, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: C.TEXT_PRIMARY }}>Edit Profile</Text>
          </Pressable>
          <Pressable onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              try {
                await Share.share({
                  message: `Check out my Clutch Picks analyst card!\n\n${userName} — ${accuracy}% accuracy\n${wins}W - ${losses}L | ${streak} streak\n\nDownload Clutch Picks to build yours.`,
                });
              } catch {}
            }}
            style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <ShareIcon size={14} color={C.TEXT_SECONDARY} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: C.TEXT_SECONDARY }}>Share Card</Text>
          </Pressable>
        </Animated.View>

        {/* ── 3. PREDICTIONS + RECENT PICKS ROW ── */}
        <Animated.View entering={FadeInDown.duration(500).delay(200)} style={{ flexDirection: 'row', marginTop: 28 }}>
          {/* Predictions tile — fixed, doesn't scroll */}
          <View style={{ width: 110, height: 130, marginLeft: 16, backgroundColor: C.GLASS, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.MAROON_DIM, borderWidth: 1, borderColor: C.MAROON, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
              <GridIcon size={18} color={C.TEXT_PRIMARY} />
            </View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.TEXT_PRIMARY }}>{totalPicks}</Text>
            <Text style={{ fontSize: 8, fontWeight: '600', color: C.TEXT_MUTED, letterSpacing: 1.2, marginTop: 2 }}>PREDICTIONS</Text>
          </View>

          {/* Recent pick tiles — scrollable, goes behind predictions tile */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 130, marginLeft: 8 }} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
            {recentPickTiles.map((p) => {
              const teamColors = getTeamColors(p.abbreviation, p.sport as any, p.color);
              const jerseyType = sportEnumToJersey(p.sport);
              const isWin = p.result === 'win';
              const isLoss = p.result === 'loss';
              const ribbonColor = isWin ? C.TEAL : isLoss ? C.MAROON : undefined;
              const ribbonLabel = isWin ? 'W' : isLoss ? 'L' : 'TBD';
              return (
                <View key={p.id} style={{
                  width: 110, height: 130, backgroundColor: C.GLASS, borderRadius: 16, padding: 10, borderWidth: 1,
                  borderColor: isWin ? 'rgba(122,157,184,0.2)' : isLoss ? 'rgba(139,10,31,0.2)' : 'rgba(255,255,255,0.08)',
                  alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {/* Corner ribbon — premium layered */}
                  <View style={{ position: 'absolute', top: 0, right: 0, width: 44, height: 44, zIndex: 10, overflow: 'hidden' }}>
                    {/* Shadow layer */}
                    <View style={{
                      position: 'absolute', top: -2, right: -2,
                      width: 62, height: 22,
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      transform: [{ rotate: '45deg' }, { translateX: 8 }, { translateY: -4 }],
                    }} />
                    {/* Main ribbon */}
                    {ribbonColor ? (
                      <LinearGradient
                        colors={isWin ? [C.TEAL, '#5A8A9A', C.TEAL] : [C.MAROON, '#6A0818', C.MAROON]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={{
                          position: 'absolute', top: 0, right: 0,
                          width: 62, height: 20,
                          transform: [{ rotate: '45deg' }, { translateX: 8 }, { translateY: -5 }],
                          alignItems: 'center', justifyContent: 'center',
                          shadowColor: ribbonColor,
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.4,
                          shadowRadius: 4,
                        }}
                      >
                        <Text style={{ fontSize: 7, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1.5, textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>{ribbonLabel}</Text>
                      </LinearGradient>
                    ) : (
                      <LinearGradient
                        colors={[C.MAROON, '#5A4A5A', C.TEAL]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={{
                          position: 'absolute', top: 0, right: 0,
                          width: 62, height: 20,
                          transform: [{ rotate: '45deg' }, { translateX: 8 }, { translateY: -5 }],
                          alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 6, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1.5, textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>{ribbonLabel}</Text>
                      </LinearGradient>
                    )}
                    {/* Highlight edge — thin white line on top edge */}
                    <View style={{
                      position: 'absolute', top: 0, right: 0,
                      width: 62, height: 1,
                      backgroundColor: 'rgba(255,255,255,0.15)',
                      transform: [{ rotate: '45deg' }, { translateX: 8 }, { translateY: -5 }],
                    }} />
                  </View>
                  <View style={{ marginBottom: 4 }}>
                    <JerseyIcon teamCode={p.abbreviation} primaryColor={teamColors.primary} secondaryColor={teamColors.secondary} size={48} sport={jerseyType} />
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: C.TEXT_PRIMARY, marginBottom: 2 }}>{p.abbreviation}</Text>
                  <Text style={{ fontSize: 8, color: C.TEXT_MUTED }}>vs {p.opponentAbbr}</Text>
                </View>
              );
            })}

            {recentPickTiles.length === 0 ? (
              <View style={{ width: 110, height: 130, backgroundColor: C.GLASS, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 10, color: C.TEXT_MUTED, textAlign: 'center' }}>Make picks to see them here</Text>
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>

        {/* ── 4. SIGNATURE CALLS ── */}
        <Animated.View entering={FadeInDown.duration(500).delay(300)} style={{ marginHorizontal: 16, marginTop: 32 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: C.TEXT_MUTED, letterSpacing: 2 }}>SIGNATURE CALLS</Text>
          </View>
          {signatureCalls.bestCall ? <SignatureCallCard type="best" data={signatureCalls.bestCall} /> : null}
          {signatureCalls.boldestCall ? <SignatureCallCard type="boldest" data={signatureCalls.boldestCall} /> : null}
          {!signatureCalls.bestCall && !signatureCalls.boldestCall ? (
            <Text style={{ fontSize: 12, color: C.TEXT_MUTED, textAlign: 'center', paddingVertical: 24 }}>Make winning picks to see your signature calls here</Text>
          ) : null}
        </Animated.View>

        {/* ── 5. WEEKLY RHYTHM ── */}
        <Animated.View entering={FadeInDown.duration(500).delay(400)} style={{ marginHorizontal: 16, marginTop: 32 }}>
          <Text style={{ fontSize: 9, fontWeight: '700', color: C.TEXT_MUTED, letterSpacing: 2, marginBottom: 14 }}>THIS WEEK</Text>
          <View style={{ backgroundColor: C.GLASS, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
            {/* Day labels */}
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
              {weeklyRhythm.map((d) => (
                <View key={d.label} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 8, fontWeight: '600', color: C.TEXT_MUTED, letterSpacing: 0.5 }}>{d.label}</Text>
                </View>
              ))}
            </View>
            {/* Grid cells */}
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {weeklyRhythm.map((d) => {
                let bg = 'rgba(255,255,255,0.02)';
                let textColor = '#2A3444';
                let borderStyle: 'solid' | 'dashed' = 'solid';
                let borderColor = 'transparent';
                if (d.isFuture) { bg = 'transparent'; borderStyle = 'dashed'; borderColor = '#2A3444'; }
                else if (d.total > 0 && d.w > d.l) { bg = C.TEAL; textColor = C.TEXT_PRIMARY; }
                else if (d.total > 0 && d.w === d.l) { bg = C.TEAL_DIM; textColor = C.TEAL; }
                else if (d.total > 0 && d.w < d.l) { bg = C.ERROR_DIM; textColor = C.ERROR; }
                return (
                  <View key={d.label} style={{ flex: 1, aspectRatio: 1, borderRadius: 6, backgroundColor: bg, borderWidth: d.isFuture ? 1 : 0, borderColor, borderStyle, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 8, fontWeight: '700', color: textColor }}>{d.total > 0 ? `${d.w}-${d.l}` : '-'}</Text>
                  </View>
                );
              })}
            </View>
            {/* Insight */}
            <View style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', padding: 10, paddingHorizontal: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TrendIcon size={12} color={C.TEAL} />
              <Text style={{ fontSize: 10, color: C.TEXT_SECONDARY, lineHeight: 15, flex: 1 }}>{weekInsight}</Text>
            </View>
          </View>
        </Animated.View>

        {/* ── 6. ACHIEVEMENTS ── */}
        <Animated.View entering={FadeInDown.duration(500).delay(500)} style={{ marginTop: 32 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginBottom: 14 }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: C.TEXT_MUTED, letterSpacing: 2 }}>ACHIEVEMENTS</Text>
            <Text style={{ fontSize: 10, color: C.TEAL }}>{earnedCount} of {achievements.length}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {achievements.map((a) => <AchievementBadge key={a.id} name={a.name} desc={a.desc} earned={a.earned} icon={a.icon} />)}
          </ScrollView>
        </Animated.View>

        {/* ── 7. SIGN OUT + VERSION ── */}
        <View style={{ alignItems: 'center', marginTop: 40, marginBottom: 28 }}>
          <Pressable onPress={handleSignOut}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.ERROR }}>Sign Out</Text>
          </Pressable>
          <Text style={{ fontSize: 9, color: '#2A3444', marginTop: 8 }}>Clutch Picks v2.1.0</Text>
        </View>

      </Animated.ScrollView>
    </SafeAreaView>
  );
}
