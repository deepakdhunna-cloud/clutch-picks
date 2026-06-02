import React, { useState, useCallback, useMemo, memo } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, ScrollView, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TopInsetView } from '@/components/TopInsetView';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Path, Circle as SvgCircle, Defs, LinearGradient as SvgGradient, Stop, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useSession, useInvalidateSession } from '@/lib/auth/use-session';
import { clearAuthStorage } from '@/lib/auth/auth-storage';
import { useUserStats, useUserPicks } from '@/hooks/usePicks';
import { useGames, usePrefetchGame } from '@/hooks/useGames';
import { getSignatureCalls, type SignatureCall, type SignatureCallReason } from '@/lib/signature-calls';
import { useHideOnScroll } from '@/contexts/ScrollContext';
import { api } from '@/lib/api/api';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { getTeamColors } from '@/lib/team-colors';
import { displaySport } from '@/lib/display-confidence';
import { authClient } from '@/lib/auth/auth-client';
import { isRevenueCatEnabled, logoutUser } from '@/lib/revenuecatClient';
import { ConfirmModal } from '@/components/ConfirmModal';
import { FeedbackModal } from '@/components/FeedbackModal';
import { unregisterCurrentDeviceForPushNotifications } from '@/hooks/useNotifications';
import { getAppVersionLabel } from '@/lib/app-version';
import { claimGameNavigation } from '@/lib/game-navigation-guard';
import { resolvePickResultForDisplay } from '@/lib/pick-resolution-display';
import { profileDisplayName } from '@/lib/profile-presentation';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';
import { ProfileAvatarImage } from '@/components/ProfileAvatarImage';
import type { GameWithPrediction } from '@/types/sports';

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

const PROFILE_RECENT_PICK_LIMIT = 10;
const RECENT_PICK_CARD_W = 124;
const RECENT_PICK_CARD_GAP = 10;
const RECENT_PICK_SNAP_INTERVAL = RECENT_PICK_CARD_W + RECENT_PICK_CARD_GAP;
const RECENT_PICK_RAIL_EDGE_PADDING = RECENT_PICK_CARD_GAP;

const ProfileLoadingState = memo(function ProfileLoadingState() {
  return (
    <TopInsetView style={{ flex: 1, backgroundColor: C.BG }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 28, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <View>
            <View style={{ width: 132, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 8 }} />
            <View style={{ width: 88, height: 10, borderRadius: 5, backgroundColor: 'rgba(122,157,184,0.12)' }} />
          </View>
          <ActivityIndicator size="small" color={C.TEAL} />
        </View>
        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: C.BORDER, backgroundColor: C.GLASS, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(122,157,184,0.10)', marginRight: 14 }} />
            <View style={{ flex: 1 }}>
              <View style={{ width: '58%', height: 16, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 10 }} />
              <View style={{ width: '42%', height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.045)' }} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[0, 1, 2].map((item) => (
              <View key={item} style={{ flex: 1, height: 58, borderRadius: 14, backgroundColor: item === 1 ? C.TEAL_DIM : C.MAROON_DIM, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }} />
            ))}
          </View>
        </View>
        {[0, 1, 2].map((item) => (
          <View key={item} style={{ height: 72, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: C.BORDER, marginBottom: 10 }} />
        ))}
      </View>
    </TopInsetView>
  );
});

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

function ArrowRightIcon({ size = 16, color = C.TEAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14M13 6l6 6-6 6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
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
const REASON_LABELS: Record<SignatureCallReason, string> = {
  high_confidence: 'HIGH CONVICTION CALL',
  underdog: 'UNDERDOG CALL',
  bold: 'AGAINST THE MODEL',
  underdog_and_bold: 'SIGNATURE CALL OF THE WEEK',
};

const SignatureCallCard = memo(function SignatureCallCard({
  call,
  game,
}: {
  call: SignatureCall;
  game?: GameWithPrediction;
}) {
  const isHighConfidence = call.primaryReason === 'high_confidence';
  const accentColor = isHighConfidence ? C.TEAL : C.MAROON;
  const Icon = isHighConfidence ? StarIcon : BoltIcon;
  const label = REASON_LABELS[call.primaryReason];

  const pick = call.pick;
  // Prefer the full team name from the matched game; fall back to the
  // abbreviation stored on the pick when the game isn't in the loaded slate.
  const homeLabel = game?.homeTeam?.name ?? pick.homeTeam ?? 'Home';
  const awayLabel = game?.awayTeam?.name ?? pick.awayTeam ?? 'Away';
  const sport = pick.sport ?? '';
  const dateStr = new Date(pick.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const matchupLine = `${awayLabel} vs ${homeLabel}${sport ? ` · ${sport}` : ''} · ${dateStr}`;

  return (
    <View style={{ backgroundColor: C.GLASS, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginBottom: 8, position: 'relative', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: accentColor }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        <Icon size={12} color={accentColor} />
        <Text style={{ fontSize: 8, fontWeight: '700', color: accentColor, letterSpacing: 1.5 }}>{label}</Text>
      </View>
      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 12, fontWeight: '700', color: C.TEXT_MUTED, letterSpacing: 0.4, marginBottom: 8 }}>{matchupLine}</Text>
      <Text style={{ fontSize: 13, color: C.TEXT_SECONDARY, lineHeight: 19 }}>{call.narrative}</Text>
    </View>
  );
});

// ─── SIGNATURE CALL SKELETON ───
// Mirrors the exact box (padding 16, border, radius 16, marginBottom 8) and
// internal stack of a loaded SignatureCallCard so the section reserves its
// final height while picks load — no empty→card height pop.
const SignatureCallSkeleton = memo(function SignatureCallSkeleton() {
  return (
    <View style={{ backgroundColor: C.GLASS, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginBottom: 8, position: 'relative', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)' }} />
        <View style={{ width: 120, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      </View>
      <View style={{ height: 16, justifyContent: 'center', marginBottom: 8 }}>
        <View style={{ width: '62%', height: 11, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.05)' }} />
      </View>
      <View style={{ height: 19, justifyContent: 'center' }}>
        <View style={{ width: '100%', height: 9, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.04)' }} />
      </View>
      <View style={{ height: 19, justifyContent: 'center' }}>
        <View style={{ width: '78%', height: 9, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.04)' }} />
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
        <Pressable
          onPress={() => router.replace('/sign-in')}
          accessibilityRole="button"
          accessibilityLabel="Sign in to Clutch Picks"
          accessibilityHint="Opens sign in"
          style={({ pressed }) => ({
            width: '100%',
            borderRadius: 14,
            overflow: 'hidden',
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.992 : 1 }],
          })}
        >
          <LinearGradient colors={[C.TEAL, C.TEAL_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 16, alignItems: 'center', borderRadius: 14 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.TEXT_PRIMARY }}>Sign In</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </SafeAreaView>
  );
});

const RecentPicksSummaryTile = memo(function RecentPicksSummaryTile({
  totalPicks,
  onPress,
}: {
  totalPicks: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${totalPicks} predictions`}
      style={({ pressed }) => ({
        width: RECENT_PICK_CARD_W,
        height: 140,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <LinearGradient
        colors={[`${C.MAROON}70`, 'rgba(122,157,184,0.08)', `${C.TEAL}28`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, borderRadius: 19, padding: 1.2 }}
      >
        <View style={{ flex: 1, borderRadius: 17.8, backgroundColor: C.GLASS, borderWidth: 1, borderColor: 'rgba(122,157,184,0.07)', padding: 10, overflow: 'hidden' }}>
          <LinearGradient
            pointerEvents="none"
            colors={[C.MAROON_DIM, 'rgba(255,255,255,0.018)', 'rgba(122,157,184,0.08)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ fontSize: 8, lineHeight: 10, fontWeight: '900', color: C.TEXT_MUTED, letterSpacing: 1.1, includeFontPadding: false }}>PICKS</Text>
            <View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: 'rgba(139,10,31,0.20)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.55)', alignItems: 'center', justifyContent: 'center' }}>
              <GridIcon size={15} color={C.TEXT_PRIMARY} />
            </View>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text adjustsFontSizeToFit numberOfLines={1} style={{ maxWidth: 88, fontSize: 42, lineHeight: 46, fontWeight: '900', color: C.TEXT_PRIMARY, includeFontPadding: false }}>{totalPicks}</Text>
          </View>
          <View style={{ alignItems: 'center', paddingTop: 7 }}>
            <Text numberOfLines={1} style={{ fontSize: 9, lineHeight: 11, fontWeight: '900', color: C.TEXT_SECONDARY, letterSpacing: 1.2, includeFontPadding: false }}>PREDICTIONS</Text>
            <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 8, lineHeight: 10, fontWeight: '800', color: C.TEXT_MUTED, includeFontPadding: false }}>ALL TIME</Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

const RecentPicksViewAllTile = memo(function RecentPicksViewAllTile({
  remainingCount,
  onPress,
}: {
  remainingCount: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="View all predictions"
      style={({ pressed }) => ({
        width: RECENT_PICK_CARD_W,
        height: 140,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <LinearGradient
        colors={[`${C.TEAL}54`, 'rgba(122,157,184,0.08)', `${C.MAROON}28`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, borderRadius: 19, padding: 1.2 }}
      >
        <View style={{ flex: 1, borderRadius: 17.8, backgroundColor: C.GLASS, borderWidth: 1, borderColor: 'rgba(122,157,184,0.07)', padding: 10, overflow: 'hidden', alignItems: 'center' }}>
          <LinearGradient
            pointerEvents="none"
            colors={[C.TEAL_DIM, 'rgba(255,255,255,0.018)', 'rgba(139,10,31,0.08)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
          <Text style={{ alignSelf: 'flex-start', fontSize: 8, lineHeight: 10, fontWeight: '900', color: C.TEXT_MUTED, letterSpacing: 1.1, includeFontPadding: false }}>HISTORY</Text>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: C.TEAL_DIM, borderWidth: 1, borderColor: 'rgba(122,157,184,0.34)', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowRightIcon size={20} color={C.TEAL} />
            </View>
          </View>
          <View style={{ alignItems: 'center', paddingTop: 7 }}>
            <Text numberOfLines={1} style={{ fontSize: 11, lineHeight: 13, fontWeight: '900', color: C.TEXT_PRIMARY, includeFontPadding: false }}>View All</Text>
            <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 8, lineHeight: 10, fontWeight: '800', color: C.TEXT_MUTED, letterSpacing: 0.8, includeFontPadding: false }}>
              {remainingCount > 0 ? `${remainingCount} MORE` : 'PICKS'}
            </Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

// ─── RECENT PICK TILE ───
// One tile per recent pick in the horizontal rail. Pulled out into its own
// component so each tile owns an independent useTapGestureGuard instance — a
// single shared guard across the .map() siblings would race (one tile's
// onTouchMove would clear another's start point), so we give every tile its
// own guard. Without this guard a horizontal swipe over a tile fires a tap and
// opens the wrong game / navigates by accident.
type RecentPickTileData = {
  id: string;
  gameId: string;
  abbreviation: string;
  opponentAbbr: string;
  color: string;
  result: 'win' | 'loss' | 'pending';
  sport: string;
  game?: GameWithPrediction;
};

const RecentPickTile = memo(function RecentPickTile({
  pick,
  onPress,
  onWarm,
}: {
  pick: RecentPickTileData;
  onPress: (gameId: string, game?: GameWithPrediction) => void;
  onWarm: (gameId: string, game?: GameWithPrediction) => void;
}) {
  const { onTouchStart, onTouchMove, onTouchCancel, shouldHandlePress } = useTapGestureGuard(6, 500);
  const teamColors = getTeamColors(pick.abbreviation, pick.sport as any, pick.color);
  const jerseyType = sportEnumToJersey(pick.sport);
  const isWin = pick.result === 'win';
  const isLoss = pick.result === 'loss';
  const statusColor = isWin ? C.TEAL : isLoss ? C.MAROON : C.TEXT_MUTED;
  const statusLabel = isWin ? 'Won' : isLoss ? 'Missed' : 'Pending';

  return (
    <Pressable
      onPress={() => {
        if (!shouldHandlePress()) return;
        onPress(pick.gameId, pick.game);
      }}
      onPressIn={() => onWarm(pick.gameId, pick.game)}
      pressRetentionOffset={6}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      accessibilityRole="button"
      accessibilityLabel={`Open ${pick.abbreviation} versus ${pick.opponentAbbr}`}
      style={({ pressed }) => ({
        width: RECENT_PICK_CARD_W,
        height: 140,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <LinearGradient
        colors={[`${teamColors.primary}52`, `${teamColors.secondary}20`, statusColor === C.MAROON ? 'rgba(139,10,31,0.28)' : 'rgba(122,157,184,0.18)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, borderRadius: 19, padding: 1.2 }}
      >
        <View style={{ flex: 1, borderRadius: 17.8, backgroundColor: C.GLASS, borderWidth: 1, borderColor: `${teamColors.primary}18`, padding: 10, overflow: 'hidden' }}>
          <LinearGradient
            pointerEvents="none"
            colors={[`${teamColors.primary}24`, `${teamColors.secondary}0E`, 'rgba(0,0,0,0)']}
            locations={[0, 0.48, 1]}
            start={{ x: 0, y: 0.12 }}
            end={{ x: 0.9, y: 0.82 }}
            style={{ position: 'absolute', left: -24, right: 0, top: -18, bottom: -18 }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 8, lineHeight: 10, fontWeight: '900', color: C.TEXT_MUTED, letterSpacing: 1.1, includeFontPadding: false }}>{displaySport(pick.sport)}</Text>
            <View style={{ borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: `${statusColor}22`, borderWidth: 1, borderColor: `${statusColor}44`, marginLeft: 6 }}>
              <Text style={{ fontSize: 7.5, lineHeight: 9, fontWeight: '900', color: statusColor, includeFontPadding: false }}>{statusLabel}</Text>
            </View>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 62 }}>
            <View style={{ width: 70, height: 58, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(122,157,184,0.075)', borderWidth: 1, borderColor: `${teamColors.primary}20` }}>
              <JerseyIcon teamCode={pick.abbreviation} primaryColor={teamColors.primary} secondaryColor={teamColors.secondary} size={54} sport={jerseyType} />
            </View>
          </View>
          <View style={{ alignItems: 'center', paddingTop: 7 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={{ maxWidth: '100%', fontSize: 14, lineHeight: 17, fontWeight: '900', color: C.TEXT_PRIMARY, includeFontPadding: false }}>{pick.abbreviation}</Text>
            <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 9, lineHeight: 11, fontWeight: '700', color: C.TEXT_MUTED, includeFontPadding: false }}>vs {pick.opponentAbbr}</Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

// ─── MAIN SCREEN ───
export default function ProfileScreen() {
  const router = useRouter();
  const appVersionLabel = getAppVersionLabel();
  const isFocused = useIsFocused();
  const { data: session, isLoading: sessionLoading } = useSession();
  const userId = session?.user?.id;
  const hasUser = Boolean(userId);
  const activeProfileData = hasUser && isFocused;
  const { data: stats, refetch: refetchStats } = useUserStats({
    enabled: activeProfileData,
    subscribed: isFocused,
  });
  const { data: picks, isLoading: picksLoading } = useUserPicks({
    enabled: activeProfileData,
    subscribed: isFocused,
  });
  const { data: allGames, isLoading: gamesLoading } = useGames({
    enabled: activeProfileData,
    subscribed: isFocused,
  });
  const prefetchGame = usePrefetchGame();
  const invalidateSession = useInvalidateSession();
  const scrollHandler = useHideOnScroll();
  const [signOutConfirmVisible, setSignOutConfirmVisible] = useState(false);
  const [feedback, setFeedback] = useState<{ title: string; message: string; variant?: 'success' | 'error' | 'info' } | null>(null);

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ id: string; name: string; email: string | null; image: string | null; bio: string | null }>('/api/profile'),
    enabled: activeProfileData,
    subscribed: isFocused,
  });

  useFocusEffect(useCallback(() => {
    if (hasUser) void refetchStats();
  }, [hasUser, refetchStats]));

  // Derived
  const userName = profileDisplayName({
    profileName: profile?.name,
    sessionName: session?.user?.name,
  });
  const userImage = profile?.image ?? session?.user?.image ?? null;
  const initial = userName.charAt(0).toUpperCase();
  const userEmail = (profile?.email ?? session?.user?.email ?? null) as string | null;
  const handle = userEmail ?? `@clutch${userName.toLowerCase().replace(/\s/g, '')}`;

  // Shared id→game lookup so the signature-call matchup line can resolve full
  // team names (the pick row only stores abbreviations).
  const gamesById = useMemo(
    () => new Map((allGames ?? []).map((g) => [g.id, g])),
    [allGames],
  );

  const displayPicks = useMemo(() => {
    if (!picks) return [];
    const gameMap = new Map((allGames ?? []).map((g) => [g.id, g]));
    return picks.map((p) => {
      const game = gameMap.get(p.gameId);
      return {
        ...p,
        result: resolvePickResultForDisplay(p, game),
      };
    });
  }, [picks, allGames]);

  // True while the picks/games queries are still resolving for a signed-in user.
  // Used to reserve final section heights with skeletons so nothing pops in.
  const dataLoading = hasUser && (picksLoading || gamesLoading) && displayPicks.length === 0;

  const wins = displayPicks.length > 0 ? displayPicks.filter((p) => p.result === 'win').length : stats?.wins ?? 0;
  const losses = displayPicks.length > 0 ? displayPicks.filter((p) => p.result === 'loss').length : stats?.losses ?? 0;
  const totalPicks = picks?.length ?? stats?.picksMade ?? 0;
  const accuracy = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
  const streak = stats?.currentStreak ?? 0;

  // Form line
  // Recent picks with game data for jersey tiles — works even for old games not in today's list
  const recentPickTiles = useMemo(() => {
    if (displayPicks.length === 0) return [];
    const gameMap = new Map((allGames ?? []).map((g) => [g.id, g]));
    const tiles = [...displayPicks]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, PROFILE_RECENT_PICK_LIMIT)
      .map((p) => {
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
          gameId: p.gameId,
          abbreviation: pickedAbbr,
          opponentAbbr,
          color: pickedTeamObj?.color ?? '#5A7A8A',
          result: p.result ?? 'pending',
          sport,
          game,
        };
      });
    return tiles;
  }, [displayPicks, allGames]);

  const hiddenPickCount = Math.max((picks?.length ?? 0) - recentPickTiles.length, 0);

  const handleRecentPickPress = useCallback((gameId: string, game?: GameWithPrediction) => {
    if (!claimGameNavigation(gameId)) return;
    prefetchGame(gameId, game);
    router.push(`/game/${gameId}` as any);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [prefetchGame, router]);

  // Warm the detail cache on press-in. prefetchGame tolerates an undefined
  // source game (older picks not in today's slate) and still seeds/loads by id.
  const handleRecentPickWarm = useCallback((gameId: string, game?: GameWithPrediction) => {
    prefetchGame(gameId, game);
  }, [prefetchGame]);

  const formLine = useMemo(() => {
    return [...displayPicks].reverse().slice(0, 10).map((p) => p.result ?? 'pending');
  }, [displayPicks]);

  const formRecord = useMemo(() => {
    const w = formLine.filter((r) => r === 'win').length;
    const l = formLine.filter((r) => r === 'loss').length;
    return { w, l };
  }, [formLine]);

  // Best streak ever
  const bestStreak = useMemo(() => {
    if (displayPicks.length === 0) return 0;
    let best = 0, cur = 0;
    for (const p of [...displayPicks].reverse()) {
      if (p.result === 'win') { cur++; best = Math.max(best, cur); } else cur = 0;
    }
    return best;
  }, [displayPicks]);

  // Tier badge
  const tierBadge = useMemo(() => {
    if (accuracy >= 75) return { label: 'Elite', bg: C.MAROON_DIM, color: C.MAROON };
    if (accuracy >= 65) return { label: 'Expert', bg: C.TEAL_DIM, color: C.TEAL };
    if (accuracy >= 55) return { label: 'Analyst', bg: 'rgba(255,255,255,0.06)', color: C.TEXT_MUTED };
    return null;
  }, [accuracy]);

  // Weekly trend
  const weekTrend = useMemo(() => {
    if (displayPicks.length < 5) return null;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const recentPicks = displayPicks.filter((p) => new Date(p.createdAt) >= weekAgo && (p.result === 'win' || p.result === 'loss'));
    if (recentPicks.length < 3) return null;
    const recentWins = recentPicks.filter((p) => p.result === 'win').length;
    const recentAcc = Math.round((recentWins / recentPicks.length) * 100);
    const diff = recentAcc - accuracy;
    if (diff === 0) return null;
    return diff > 0 ? `+${diff}% this week` : `${diff}% this week`;
  }, [displayPicks, accuracy]);

  // Signature calls — eligibility + narrative live in src/lib/signature-calls.ts.
  // Reads enriched fields directly off the pick row, so it works for any
  // settled win regardless of whether the game is still in `allGames`.
  const signatureCalls = useMemo(() => getSignatureCalls(displayPicks), [displayPicks]);

  // Weekly rhythm
  // Always build the full 7-day scaffold (even with zero picks) so the grid
  // reserves its space in the loading/empty state instead of collapsing and
  // popping in. With no picks this renders the same 7-cell "-" grid that a
  // signed-in user with no picks *this week* already sees — no design change.
  const weeklyRhythm = useMemo(() => {
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
      const dayPicks = displayPicks.filter((p) => {
        const d = new Date(p.createdAt);
        return d >= dayStart && d < dayEnd && (p.result === 'win' || p.result === 'loss');
      });
      const w = dayPicks.filter((p) => p.result === 'win').length;
      const l = dayPicks.filter((p) => p.result === 'loss').length;
      return { label, w, l, total: w + l, isFuture };
    });
  }, [displayPicks]);

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
  const handleSignOut = useCallback(() => {
    setSignOutConfirmVisible(true);
  }, []);

  const handleConfirmSignOut = useCallback(async () => {
    setSignOutConfirmVisible(false);
    try {
      await unregisterCurrentDeviceForPushNotifications();
      await authClient.signOut();
      if (isRevenueCatEnabled()) { try { await logoutUser(); } catch {} }
      await clearAuthStorage();
      await invalidateSession();
      router.replace('/welcome');
    } catch {
      setFeedback({
        title: 'Sign Out Failed',
        message: 'Failed to sign out. Please try again.',
        variant: 'error',
      });
    }
  }, [invalidateSession, router]);

  // Loading
  if (sessionLoading) {
    return <ProfileLoadingState />;
  }

  if (!session) return <SignedOutState />;

  // Accuracy markers
  const markers = [50, 60, 70, 80];

  return (
    <TopInsetView style={{ flex: 1, backgroundColor: C.BG }}>
      <ConfirmModal
        visible={signOutConfirmVisible}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign Out"
        destructive
        onConfirm={handleConfirmSignOut}
        onCancel={() => setSignOutConfirmVisible(false)}
      />
      <FeedbackModal
        visible={!!feedback}
        title={feedback?.title ?? ''}
        message={feedback?.message ?? ''}
        variant={feedback?.variant}
        onDismiss={() => setFeedback(null)}
      />
      <Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>

        {/* ── PAGE HEADER ── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 28, paddingBottom: 20 }}>
          <Svg width={240} height={42} viewBox="0 0 240 42">
            <Defs>
              <SvgGradient id="headerGrad" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#BE1E36" />
                <Stop offset="0.35" stopColor="#BF6878" />
                <Stop offset="0.65" stopColor="#C8B6C0" />
                <Stop offset="1" stopColor={C.TEAL} />
              </SvgGradient>
            </Defs>
            <SvgText x="0" y="33" fontSize="34" fontWeight="800" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">Analyst Card</SvgText>
            <SvgText x="0" y="33" fontSize="34" fontWeight="800" fill="url(#headerGrad)" stroke="none" strokeWidth={0}>Analyst Card</SvgText>
          </Svg>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={() => { router.push('/settings'); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            hitSlop={10}
            style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            <GearIcon size={18} color={C.TEXT_PRIMARY} />
          </Pressable>
        </View>

        {/* ── 1. ANALYST CARD HERO ── */}
        <Animated.View entering={FadeInDown.duration(500)} style={{ marginHorizontal: 16 }}>
<View style={{ borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(122,157,184,0.26)', position: 'relative' }}>

            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.GLASS }} />
            <LinearGradient colors={['rgba(139,10,31,0.40)', 'transparent', 'transparent', 'rgba(122,157,184,0.18)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

            <View style={{ padding: 22, paddingTop: 16 }}>
              <View />

              {/* Avatar + Identity */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, padding: 3, overflow: 'hidden' }}>
                  <LinearGradient colors={[C.MAROON, C.TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 36 }} />
                  <View style={{ flex: 1, borderRadius: 33, backgroundColor: C.BG, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <ProfileAvatarImage
                      uri={userImage}
                      style={{ width: '100%', height: '100%' }}
                      recyclingKey={userId}
                    >
                      <Text style={{ fontSize: 24, fontWeight: '800', color: C.TEXT_PRIMARY }}>{initial}</Text>
                    </ProfileAvatarImage>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: '800', color: C.TEXT_PRIMARY, letterSpacing: -0.3 }}>{userName}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: C.TEXT_MUTED, marginTop: 2 }}>{handle}</Text>
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
                <LinearGradient colors={['transparent', 'rgba(122,157,184,0.07)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', top: 0, left: 18, right: 18, height: 1 }} />
                {/* Bottom divider — visible in middle, fades outward */}
                <LinearGradient colors={['transparent', 'rgba(122,157,184,0.06)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', bottom: 0, left: 18, right: 18, height: 1 }} />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            hitSlop={6}
            onPress={() => { router.push('/edit-profile'); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={{ flex: 1, minHeight: 44, backgroundColor: C.MAROON, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: C.TEXT_PRIMARY }}>Edit Profile</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share analyst card"
            hitSlop={6}
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              try {
                await Share.share({
                  message: `Check out my Clutch Picks analyst card!\n\n${userName} — ${accuracy}% accuracy\n${wins}W - ${losses}L | ${streak} streak\n\nDownload Clutch Picks to build yours.`,
                });
              } catch {}
            }}
            style={{ flex: 1, minHeight: 44, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <ShareIcon size={14} color={C.TEXT_SECONDARY} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: C.TEXT_SECONDARY }}>Share Card</Text>
          </Pressable>
        </Animated.View>

        {/* ── 3. PREDICTIONS + RECENT PICKS ROW ── */}
        <Animated.View entering={FadeInDown.duration(500).delay(200)} style={{ marginTop: 28 }}>
          <View style={{ height: 146, flexDirection: 'row', marginHorizontal: 16, overflow: 'visible' }}>
            <RecentPicksSummaryTile
              totalPicks={totalPicks}
              onPress={() => { router.push('/picks-history'); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            />

            <View style={{ flex: 1, height: 146, overflow: 'hidden', position: 'relative' }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flex: 1, height: 146 }}
                contentContainerStyle={{ paddingLeft: RECENT_PICK_RAIL_EDGE_PADDING, paddingRight: 16, gap: RECENT_PICK_CARD_GAP }}
                snapToInterval={RECENT_PICK_SNAP_INTERVAL}
                snapToAlignment="start"
                disableIntervalMomentum
                decelerationRate="fast"
              >
                {recentPickTiles.map((p) => (
                  <RecentPickTile
                    key={p.id}
                    pick={p}
                    onPress={handleRecentPickPress}
                    onWarm={handleRecentPickWarm}
                  />
                ))}

                {recentPickTiles.length === 0 ? (
                  <View style={{ width: RECENT_PICK_CARD_W, height: 140, backgroundColor: C.GLASS, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 10, color: C.TEXT_MUTED, textAlign: 'center' }}>Make picks to see them here</Text>
                  </View>
                ) : (
                  <RecentPicksViewAllTile
                    remainingCount={hiddenPickCount}
                    onPress={() => { router.push('/picks-history'); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  />
                )}
              </ScrollView>
              <LinearGradient
                pointerEvents="none"
                colors={[C.BG, 'rgba(4,6,8,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 18 }}
              />
            </View>
          </View>
        </Animated.View>

        {/* ── 4. SIGNATURE CALLS ── */}
        <Animated.View entering={FadeInDown.duration(500).delay(300)} style={{ marginHorizontal: 16, marginTop: 32 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: C.TEXT_MUTED, letterSpacing: 2 }}>SIGNATURE CALLS</Text>
          </View>
          {signatureCalls.length > 0
            ? signatureCalls.map((call) => <SignatureCallCard key={call.pick.id} call={call} game={gamesById.get(call.pick.gameId)} />)
            : dataLoading
              ? <SignatureCallSkeleton />
              : (
                <Text style={{ fontSize: 12, color: C.TEXT_MUTED, textAlign: 'center', paddingVertical: 24 }}>Make winning picks to see your signature calls here</Text>
              )}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            accessibilityHint="Signs you out of Clutch Picks"
            onPress={handleSignOut}
            hitSlop={{ top: 14, bottom: 14, left: 24, right: 24 }}
            style={{ minHeight: 44, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.ERROR }}>Sign Out</Text>
          </Pressable>
          <Text style={{ fontSize: 9, color: '#2A3444', marginTop: 8 }}>{appVersionLabel}</Text>
        </View>

      </Animated.ScrollView>
    </TopInsetView>
  );
}
