import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, StatusBar,
  ActivityIndicator, Image, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming,
  Easing, interpolate, FadeInDown, FadeIn,
} from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useSession } from '@/lib/auth/use-session';
import { useUserStats, useUserPicks } from '@/hooks/usePicks';

import { useGames } from '@/hooks/useGames';
import { api } from '@/lib/api/api';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { getTeamColors } from '@/lib/team-colors';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W - 32;

// ─── DESIGN TOKENS ───────────────────────────────────────────────
const BG = '#040608';
const CORAL = '#E8936A';
const TEAL = '#7A9DB8';
const TEAL_DARK = '#5A7A8A';
const GREEN = '#4ADE80';
const RED = '#EF4444';

// ─── CARD THEME ────────────────────────────────────────────────────
interface Rarity {
  color: string;
  colorDim: string;
  gradColors: [string, string, string, string, string];
  innerBg: string;
  glowColor: string;
}

// Single neutral card theme — no fake tiers
const CARD_THEME: Rarity = {
  color: TEAL, colorDim: TEAL_DARK,
  gradColors: [TEAL, TEAL_DARK, TEAL, '#4A6A7A', TEAL],
  innerBg: '#0A0C0E', glowColor: 'rgba(122,157,184,0.12)',
};

// ─── SVG ICONS ─────────────────────────────────────────────────────
function SettingsGear({ size = 20, color = 'rgba(255,255,255,0.5)' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 15a3 3 0 100-6 3 3 0 000 6z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function FlipSvg({ size = 16, color = 'rgba(255,255,255,0.5)' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M17 1l4 4-4 4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 11V9a4 4 0 014-4h14" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M7 23l-4-4 4-4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M21 13v2a4 4 0 01-4 4H3" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function EditSvg({ size = 14, color = 'rgba(255,255,255,0.3)' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}



// ─── CARD BORDER COMPONENT ─────────────────────────────────
function HolographicBorder({ rarity, children }: { rarity: Rarity; children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: 24, padding: 3, overflow: 'hidden', backgroundColor: 'transparent' }}>
      {/* Gradient border */}
      <LinearGradient
        colors={rarity.gradColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Inner card */}
      <View style={[s.cardInner, { backgroundColor: rarity.innerBg || '#080610' }]}>
        {children}
      </View>
    </View>
  );
}

// ─── CARD SLAB WRAPPER ──────────────────────────────────────────
function GradingSlab({
  children,
  totalPicks
}: {
  children: React.ReactNode;
  winRate: number;
  totalPicks: number;
}) {
  const certNum = String(totalPicks).padStart(3, '0');

  return (
    <View style={slabStyles.slabOuter}>
      <LinearGradient
        colors={['transparent', `${BG}90`, BG, BG, `${BG}90`, 'transparent']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Slab Header */}
      <View style={slabStyles.slabHeader}>
        <Text style={slabStyles.slabBrand}>CLUTCH PICKS</Text>
      </View>

      {/* Inner Card Container */}
      <View style={slabStyles.innerCardWrapper}>
        {children}
      </View>

      {/* Slab Footer */}
      <View style={slabStyles.slabFooter}>
        <Text style={slabStyles.certText}>CERT #{certNum}</Text>
      </View>
    </View>
  );
}

const slabStyles = StyleSheet.create({
  slabOuter: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    overflow: 'hidden',
  },
  slabHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  slabBrand: {
    fontSize: 8,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 2,
  },
  gradeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gradeLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 1,
  },
  gradeBadge: {
    backgroundColor: CORAL,
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  gradeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  innerCardWrapper: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  slabFooter: {
    paddingTop: 10,
    alignItems: 'flex-end',
  },
  certText: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.1)',
    letterSpacing: 1,
  },
});

// ─── CARD CONTENT STYLES ──────────────────────────────────────────
const cardStyles = StyleSheet.create({
  // Photo/Avatar Area
  photoArea: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: 'transparent',
  },
  tierBadgePhoto: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tierBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 2,
  },
  avatarContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallbackNew: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 40,
    fontWeight: '900',
  },

  // Name Plate
  namePlate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  playerName: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  playerBio: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
    fontStyle: 'italic',
    marginTop: 2,
  },
  ovrContainer: {
    alignItems: 'center',
  },
  ovrValue: {
    fontSize: 28,
    fontWeight: '900',
    color: CORAL,
    lineHeight: 28,
  },
  ovrLabel: {
    fontSize: 7,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.2)',
    marginTop: 1,
  },

  // Social Cells
  socialCells: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  socialCellLeft: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  socialCellRight: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  socialCellDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  socialCellLabel: {
    fontSize: 7,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.15)',
    letterSpacing: 2,
    marginBottom: 4,
  },
  socialCellValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
  },

  // Stat Line
  statLine: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  statCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: 10,
  },
  statCellBorder: {
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.04)',
  },
  statCellLabel: {
    fontSize: 7,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.12)',
    letterSpacing: 1,
    marginBottom: 4,
  },
  statCellValue: {
    fontSize: 14,
    fontWeight: '900',
  },
});

// ─── FLIPPABLE CARD ──────────────────────────────────────────────────
function FlippableCard({
  front, back, rarity, winRate, totalPicks,
}: { front: React.ReactNode; back: React.ReactNode; rarity: Rarity; winRate: number; totalPicks: number }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const rotation = useSharedValue(0);

  const flipCard = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const target = isFlipped ? 0 : 180;
    rotation.value = withTiming(target, { duration: 600, easing: Easing.inOut(Easing.ease) });
    setIsFlipped(!isFlipped);
  }, [isFlipped, rotation]);

  const frontStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [0, 180]);
    return {
      transform: [{ perspective: 1200 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden' as const,
      zIndex: rotation.value < 90 ? 2 : 0,
    };
  });

  const backStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [180, 360]);
    return {
      transform: [{ perspective: 1200 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden' as const,
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      zIndex: rotation.value >= 90 ? 2 : 0,
    };
  });

  return (
    <View>
      {/* Atmospheric glows behind card */}
      <View style={[s.cardGlow, s.cardGlowTop, { backgroundColor: rarity.glowColor }]} />
      <View style={[s.cardGlow, s.cardGlowBottom, { backgroundColor: `${rarity.color}08` }]} />

      <View style={{ position: 'relative', backgroundColor: 'transparent' }}>
        {/* Front */}
        <Animated.View style={[frontStyle, { backgroundColor: 'transparent' }]}>
          <GradingSlab winRate={winRate} totalPicks={totalPicks}>
            <HolographicBorder rarity={rarity}>
              {front}
              <Pressable onPress={flipCard} style={s.flipBtn}>
                <FlipSvg size={15} color={`${rarity.color}90`} />
                <Text style={[s.flipText, { color: `${rarity.color}90` }]}>Flip card</Text>
              </Pressable>
            </HolographicBorder>
          </GradingSlab>
        </Animated.View>

        {/* Back */}
        <Animated.View style={[backStyle, { backgroundColor: 'transparent' }]}>
          <GradingSlab winRate={winRate} totalPicks={totalPicks}>
            <HolographicBorder rarity={rarity}>
              {back}
              <Pressable onPress={flipCard} style={s.flipBtn}>
                <FlipSvg size={15} color={`${rarity.color}90`} />
                <Text style={[s.flipText, { color: `${rarity.color}90` }]}>Flip to front</Text>
              </Pressable>
            </HolographicBorder>
          </GradingSlab>
        </Animated.View>
      </View>
    </View>
  );
}

// ─── SIGN IN PROMPT ──────────────────────────────────────────────────
function SignInPrompt() {
  const router = useRouter();
  return (
    <View style={s.signInWrap}>
      <View style={s.signInIcon}>
        <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={8} r={4} stroke={TEAL} strokeWidth={1.8} />
          <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={TEAL} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
      </View>
      <Text style={s.signInTitle}>Sign in to see your card</Text>
      <Text style={s.signInSub}>Track your picks, earn your rank, level up.</Text>
      <Pressable onPress={() => router.replace('/sign-in')} style={({ pressed }) => [s.signInBtn, { opacity: pressed ? 0.85 : 1 }]}>
        <LinearGradient colors={[TEAL_DARK, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.signInGrad}>
          <Text style={s.signInBtnText}>Sign In</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const router = useRouter();

  const { data: session, isLoading: sessionLoading } = useSession();
  const userId = session?.user?.id;

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useUserStats();
  const { data: picks } = useUserPicks();
  const socialStats = { followersCount: 0, followingCount: 0 };
  const { data: allGames } = useGames();

  useFocusEffect(
    useCallback(() => {
      refetchStats();
    }, [refetchStats])
  );

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ id: string; name: string; email: string | null; image: string | null; bio: string | null }>('/api/profile'),
    enabled: !!userId,
  });

  const userName = session?.user?.name ?? 'Player';
  const userImage = profile?.image ?? session?.user?.image ?? null;
  const userBio = profile?.bio ?? 'Sports prediction specialist';
  const initial = userName.charAt(0).toUpperCase();

  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const totalPicks = stats?.picksMade ?? 0;
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
  const streak = stats?.currentStreak ?? 0;
  const followersCount = socialStats?.followersCount ?? 0;
  const followingCount = socialStats?.followingCount ?? 0;

  const bestStreak = useMemo(() => {
    if (!picks) return 0;
    let best = 0, cur = 0;
    for (const p of [...picks].reverse()) {
      if (p.result === 'win') { cur++; best = Math.max(best, cur); } else cur = 0;
    }
    return best;
  }, [picks]);

  const rarity = CARD_THEME;

  const gameMap = useMemo(() => {
    if (!allGames) return new Map<string, any>();
    return new Map(allGames.map((g: any) => [g.id, g]));
  }, [allGames]);

  const recentPicks = useMemo(() => {
    if (!picks) return [];
    return [...picks].reverse().slice(0, 10)
      .map((p) => {
        const game = gameMap.get(p.gameId) as any;
        if (!game) return null;
        const pickedTeamData = p.pickedTeam === 'home' ? game.homeTeam : game.awayTeam;
        const vsTeamData = p.pickedTeam === 'home' ? game.awayTeam : game.homeTeam;
        const team = pickedTeamData?.abbreviation || 'TBD';
        const vs = vsTeamData?.abbreviation || '';
        const sport = game?.sport ?? '';
        const teamColors = getTeamColors(team, sport);
        const jerseyType = sportEnumToJersey(sport);
        return { ...p, team, vs, sport, dateStr: formatDate(p.createdAt), teamColor: teamColors.primary, jerseyType };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .slice(0, 3);
  }, [picks, gameMap]);

  const sportBreakdown = useMemo(() => {
    const map = new Map<string, { picks: number; wins: number }>();
    for (const p of picks ?? []) {
      const game = gameMap.get(p.gameId) as any;
      const sport = game?.sport ?? 'OTHER';
      const e = map.get(sport) ?? { picks: 0, wins: 0 };
      e.picks++;
      if (p.result === 'win') e.wins++;
      map.set(sport, e);
    }
    return Array.from(map.entries())
      .map(([sport, d]) => ({ sport, ...d, rate: d.picks > 0 ? Math.round((d.wins / d.picks) * 100) : 0 }))
      .sort((a, b) => b.picks - a.picks)
      .slice(0, 5);
  }, [picks, gameMap]);

  if (sessionLoading) {
    return (
      <View style={s.root}><StatusBar barStyle="light-content" />
        <SafeAreaView style={s.loader} edges={['top']}><ActivityIndicator color={TEAL} size="large" /></SafeAreaView>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={s.root}><StatusBar barStyle="light-content" />
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={s.header}><Text style={s.headerTitle}>My Card</Text></View>
          <SignInPrompt />
        </SafeAreaView>
      </View>
    );
  }

  // ── CARD FRONT ───────────────────────────────────────────────────
  const cardFront = (
    <>
      {/* Photo/Avatar Area */}
      <View style={cardStyles.photoArea}>
        {/* Avatar */}
        <View style={[cardStyles.avatarContainer, { borderColor: rarity.color }]}>
          {userImage ? (
            <Image source={{ uri: userImage }} style={cardStyles.avatarImage} />
          ) : (
            <View style={[cardStyles.avatarFallbackNew, { backgroundColor: '#0A0A0E' }]}>
              <Text style={[cardStyles.avatarInitial, { color: rarity.color }]}>{initial}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Name Plate */}
      <View style={cardStyles.namePlate}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={cardStyles.playerName} numberOfLines={1}>{userName.toUpperCase()}</Text>
            <Pressable onPress={() => router.push('/edit-profile')} hitSlop={12}>
              <EditSvg size={14} color="rgba(255,255,255,0.25)" />
            </Pressable>
          </View>
          <Text style={cardStyles.playerBio} numberOfLines={1}>"{userBio}"</Text>
        </View>
        <View style={cardStyles.ovrContainer}>
          <Text style={cardStyles.ovrValue}>{winRate}</Text>
          <Text style={cardStyles.ovrLabel}>OVR</Text>
        </View>
      </View>

      {/* Stat Line — fixed height to prevent layout shift when loading */}
      <View style={{ minHeight: 58 }}>
        {statsLoading ? (
          <View style={{ height: 58, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={rarity.color} size="small" />
          </View>
        ) : (
          <View style={cardStyles.statLine}>
            {[
              { label: 'PK', value: `${totalPicks}`, color: '#FFFFFF' },
              { label: 'W', value: `${wins}`, color: TEAL },
              { label: 'L', value: `${losses}`, color: CORAL },
              { label: 'PCT', value: `${winRate}%`, color: '#FFFFFF' },
              { label: 'STK', value: streak > 0 ? `W${streak}` : streak < 0 ? `L${Math.abs(streak)}` : '-', color: streak > 0 ? TEAL : streak < 0 ? CORAL : 'rgba(255,255,255,0.3)' },
            ].map((st, i) => (
              <View key={st.label} style={[cardStyles.statCell, i < 4 && cardStyles.statCellBorder]}>
                <Text style={cardStyles.statCellLabel}>{st.label}</Text>
                <Text style={[cardStyles.statCellValue, { color: st.color }]} numberOfLines={1}>{st.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </>
  );

  // ── CARD BACK ────────────────────────────────────────────────────
  const cardBack = (
    <>
      <View style={s.backHeader}>
        <Text style={[s.backTitle, { color: `${rarity.color}90` }]}>CAREER STATS</Text>
      </View>

      {/* Sport breakdown */}
      <View style={{ gap: 6, paddingHorizontal: 16, marginTop: 6 }}>
        {sportBreakdown.length > 0 ? sportBreakdown.map((sr) => (
          <View key={sr.sport} style={s.sportRow}>
            <Text style={[s.sportName, { color: 'rgba(255,255,255,0.5)' }]}>{sr.sport}</Text>
            <View style={s.sportTrack}>
              <View style={[s.sportFill, { width: `${sr.rate}%`, backgroundColor: sr.rate >= 60 ? `${TEAL}80` : sr.rate >= 50 ? `${TEAL}50` : 'rgba(255,255,255,0.15)' }]} />
            </View>
            <Text style={[s.sportRate, { color: sr.rate >= 60 ? `${TEAL}CC` : sr.rate >= 50 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.35)' }]}>{sr.rate}%</Text>
            <Text style={s.sportWins}>{sr.wins}W</Text>
          </View>
        )) : (
          <View style={{ alignItems: 'center', padding: 24 }}>
            <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>No resolved picks yet</Text>
          </View>
        )}
      </View>

      {/* Recent picks */}
      <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
        <Text style={s.backSectionLabel}>RECENT PICKS</Text>
        <View style={{ gap: 4, marginTop: 8 }}>
          {recentPicks.slice(0, 5).map((p) => {
            const isWin = p.result === 'win';
            const isLoss = p.result === 'loss';
            const rc = isWin ? `${TEAL}CC` : isLoss ? `${CORAL}AA` : 'rgba(255,255,255,0.2)';
            return (
              <View key={p.id} style={s.backPick}>
                <Text style={[s.backPickR, { color: rc }]}>{isWin ? 'W' : isLoss ? 'L' : '·'}</Text>
                <Text style={s.backPickTeam} numberOfLines={1}>
                  {p.team} <Text style={s.backPickVs}>vs {p.vs}</Text>
                </Text>
                {p.sport ? <Text style={[s.backPickSport, { color: 'rgba(255,255,255,0.3)' }]}>{p.sport}</Text> : null}
              </View>
            );
          })}
        </View>
      </View>

      {/* Best streak */}
      <View style={s.bestRow}>
        <Text style={s.bestLabel}>BEST STREAK</Text>
        <Text style={[s.bestValue, { color: TEAL }]}>W{bestStreak}</Text>
      </View>
    </>
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      {/* Background atmosphere */}
      <View style={s.bgLayer}>
        <View style={[s.bgGlow, { top: -120, left: '20%', backgroundColor: rarity.glowColor, width: 350, height: 350 }]} />
        <View style={[s.bgGlow, { bottom: -100, right: -60, backgroundColor: `${rarity.color}08`, width: 280, height: 280 }]} />
        <View style={[s.bgGlow, { top: '40%', left: -80, backgroundColor: `${TEAL}05`, width: 200, height: 200 }]} />
      </View>

      <ErrorBoundary onGoBack={() => router.back()}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={s.header}>
            <Text style={s.headerTitle}>My Card</Text>
            <Pressable onPress={() => router.push('/settings')} style={({ pressed }) => [s.headerBtn, { opacity: pressed ? 0.7 : 1 }]}>
              <SettingsGear size={20} />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false} scrollEventThrottle={16} removeClippedSubviews={true}>
            {/* The Card */}
            <Animated.View entering={FadeIn.duration(500)} style={{ paddingHorizontal: 16, marginTop: 6 }}>
              <FlippableCard front={cardFront} back={cardBack} rarity={rarity} winRate={winRate} totalPicks={totalPicks} />
            </Animated.View>

            {/* Recent Picks */}
            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ paddingHorizontal: 16, marginTop: 20 }}>
              <View style={s.picksHeader}>
                <Text style={s.picksTitle}>Recent Picks</Text>
                <Text style={s.picksAll}>View All</Text>
              </View>
              {recentPicks.length === 0 ? (
                <View style={s.emptyPicks}>
                  <Text style={s.emptyTitle}>No picks yet</Text>
                  <Text style={s.emptySub}>Make your first pick from the Home feed</Text>
                </View>
              ) : (
                recentPicks.slice(0, 3).map((p) => {
                  const isWin = p.result === 'win';
                  const isLoss = p.result === 'loss';
                  return (
                    <View key={p.id} style={s.pickCard}>
                      <View style={{ width: 40, height: 44, position: 'relative' }}>
                        <JerseyIcon
                          teamCode={p.team}
                          primaryColor={p.teamColor}
                          secondaryColor="#FFFFFF"
                          sport={p.jerseyType}
                          size={40}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={s.pickTeam}>{p.team}</Text>
                          {p.sport ? <Text style={s.pickSport}>{p.sport}</Text> : null}
                        </View>
                        <Text style={s.pickMeta}>vs {p.vs} · {p.dateStr}</Text>
                      </View>
                      {/* Ribbon badge */}
                      {isWin ? (
                        <View style={s.ribbonWin}>
                          <Text style={s.ribbonText}>WIN</Text>
                        </View>
                      ) : isLoss ? (
                        <View style={s.ribbonLoss}>
                          <Text style={s.ribbonText}>LOSS</Text>
                        </View>
                      ) : (
                        <View style={s.ribbonTbd}>
                          <Text style={s.ribbonTextTbd}>TBD</Text>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </Animated.View>
          </ScrollView>
        </SafeAreaView>
      </ErrorBoundary>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Background
  bgLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 },
  bgGlow: { position: 'absolute', borderRadius: 999 },

  // Card glow
  cardGlow: { position: 'absolute', borderRadius: 50 },
  cardGlowTop: { top: '10%', left: '5%', right: '5%', height: 120 },
  cardGlowBottom: { bottom: '5%', left: '10%', right: '10%', height: 100 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, zIndex: 1 },
  headerTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  headerBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },

  // Sign in
  signInWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  signInIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: `${TEAL}10`, borderWidth: 1, borderColor: `${TEAL}20`, alignItems: 'center', justifyContent: 'center' },
  signInTitle: { color: '#FFF', fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 10 },
  signInSub: { color: 'rgba(255,255,255,0.35)', fontSize: 14, textAlign: 'center' },
  signInBtn: { width: '100%', height: 54, borderRadius: 14, overflow: 'hidden', marginTop: 10 },
  signInGrad: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  signInBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  // Card
  cardInner: { borderRadius: 21, overflow: 'hidden', flex: 1 },

  cardTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 18 },
  tierBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  tierText: { fontSize: 11, fontWeight: '900', letterSpacing: 3 },
  cardNum: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.15)', letterSpacing: 1 },

  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 18, paddingTop: 24, paddingBottom: 20 },
  avatarBox: { width: 92, height: 92, borderRadius: 24, borderWidth: 3, overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 44, fontWeight: '900' },
  ovrBadge: { position: 'absolute', bottom: -8, right: -8, width: 38, height: 38, borderRadius: 12, borderWidth: 3, borderColor: '#0A0A0C', alignItems: 'center', justifyContent: 'center' },
  ovrText: { fontSize: 15, fontWeight: '900', color: '#FFF' },

  userName: { fontSize: 22, fontWeight: '900', color: '#FFF', letterSpacing: 0.5, flexShrink: 1 },
  userBio: { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 4, lineHeight: 17 },
  socialRow: { flexDirection: 'row', gap: 14, marginTop: 10 },
  socialText: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  socialNum: { fontWeight: '800', color: 'rgba(255,255,255,0.7)' },

  // Embossed panel
  embossedPanel: { marginHorizontal: 14, borderRadius: 16, borderWidth: 1, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  embossedInner: { borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },

  statLine: { flexDirection: 'row', overflow: 'hidden' },
  statCell: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  statBorder: { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.04)' },
  statLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.2)', letterSpacing: 1.2, marginBottom: 6 },
  statValue: { fontSize: 18, fontWeight: '900' },

  wlRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 12, marginBottom: 6 },
  wlLabel: { fontSize: 11, fontWeight: '800' },
  wlTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.04)', overflow: 'hidden' },
  wlFill: { height: '100%', borderRadius: 3 },

  flipBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)', marginTop: 8 },
  flipText: { fontSize: 12, fontWeight: '700' },

  // Back
  backHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  backTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  backSectionLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.2)', letterSpacing: 1.2 },
  sportRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
  sportName: { fontSize: 12, fontWeight: '900', width: 44 },
  sportTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.04)', overflow: 'hidden' },
  sportFill: { height: '100%', borderRadius: 2 },
  sportRate: { fontSize: 12, fontWeight: '800', width: 34, textAlign: 'right' },
  sportWins: { fontSize: 10, color: 'rgba(255,255,255,0.2)', width: 24, textAlign: 'right' },
  backPick: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.015)' },
  backPickR: { fontSize: 10, fontWeight: '900', width: 14 },
  backPickTeam: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.7)', flex: 1 },
  backPickVs: { color: 'rgba(255,255,255,0.2)', fontWeight: '500' },
  backPickSport: { fontSize: 9, fontWeight: '700' },
  bestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.03)' },
  bestLabel: { fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: 1.2 },
  bestValue: { fontSize: 20, fontWeight: '900' },

  // Picks below card
  picksHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  picksTitle: { fontSize: 16, fontWeight: '800', color: '#FFF' },
  picksAll: { fontSize: 12, fontWeight: '600', color: TEAL },
  pickCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  pickDot: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pickDotText: { fontSize: 11, fontWeight: '800' },
  pickTeam: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  pickSport: { fontSize: 10, fontWeight: '700', color: CORAL, backgroundColor: `${CORAL}15`, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  pickMeta: { fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 3 },

  emptyPicks: { alignItems: 'center', paddingVertical: 32, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  emptySub: { fontSize: 12, color: 'rgba(255,255,255,0.2)' },

  // Ribbon badges
  ribbonWin: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: `${TEAL}18`, borderWidth: 1, borderColor: `${TEAL}35` },
  ribbonLoss: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: `${CORAL}18`, borderWidth: 1, borderColor: `${CORAL}35` },
  ribbonTbd: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: `${TEAL}20`, borderTopColor: `${TEAL}25`, borderBottomColor: `${CORAL}25`, borderLeftColor: `${TEAL}20`, borderRightColor: `${CORAL}20` },
  ribbonText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1 },
  ribbonTextTbd: { fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.35)', letterSpacing: 1 },
});
