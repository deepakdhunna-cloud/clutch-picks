import React, { useState, useMemo, useCallback, useEffect, useDeferredValue, useRef, memo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Keyboard, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Search, Clock, X, ChevronRight, Trophy, Radio, Flame, ShieldAlert, CalendarClock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGames, usePrefetchGame } from '@/hooks/useGames';
import { GameWithPrediction, GameStatus, Sport, SPORT_META } from '@/types/sports';
import { displayConfidence, displaySport, formatGameTime, getConfidenceTier } from '@/lib/display-confidence';
import {
  getCanonicalConfidence,
  getCanonicalFinalPick,
} from '@/lib/canonical-result';
import { getGamePredictionDisplay } from '@/lib/prediction-display';
import { getTeamColors } from '@/lib/team-colors';
import { TeamJersey } from '@/components/sports/TeamJersey';
import { useSubscription } from '@/lib/subscription-context';
import {
  MAROON, MAROON_DIM, TEAL, LIVE_RED, BG, PANEL_DARK, BORDER_MED,
  WHITE, TEXT_SECONDARY, TEXT_MUTED,
} from '@/lib/theme';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function hexWithAlpha(hex: string | undefined, alpha: number): string {
  if (!hex || hex[0] !== '#') return `rgba(122,157,184,${alpha})`;
  const a = Math.max(0, Math.min(1, alpha));
  const aHex = Math.round(a * 255).toString(16).padStart(2, '0');
  if (hex.length === 7) return `${hex}${aHex}`;
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}${aHex}`;
  return hex;
}

function fireLightHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function fireSelectionHaptic() {
  void Haptics.selectionAsync().catch(() => {});
}

type StatusFilter = 'all' | 'live' | 'scheduled' | 'final';
const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Upcoming' },
  { key: 'final', label: 'Final' },
];
const SPORT_BADGE_LABELS: Record<string, string> = {
  TENNIS: 'TEN',
  NCAAF: 'CFB',
  NCAAB: 'CBB',
};
type StoryTone = 'live' | 'upset' | 'tossup' | 'soon' | 'final' | 'model';

// ─── LIVE DOT ───
const LiveDot = memo(function LiveDot() {
  const op = useSharedValue(1);
  useEffect(() => { op.value = withRepeat(withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true); return () => cancelAnimation(op); }, [op]);
  const s = useAnimatedStyle(() => ({ opacity: op.value }));
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: LIVE_RED }, s]} />;
});

// ─── SPORT BROWSE CARD ───
const SportCard = memo(function SportCard({ sport, count, onPress }: { sport: string; count: number; onPress: () => void }) {
  const meta = SPORT_META[sport as Sport];
  const color = meta?.color ?? TEXT_MUTED;
  const badgeLabel = SPORT_BADGE_LABELS[sport] ?? displaySport(sport);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ minWidth: 124, opacity: pressed ? 0.86 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] })}>
      <LinearGradient
        colors={[hexWithAlpha(color, 0.36), 'rgba(180,211,235,0.10)', 'rgba(255,255,255,0.04)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, padding: 1 }}
      >
        <View style={{ minHeight: 104, borderRadius: 17, padding: 14, overflow: 'hidden', backgroundColor: 'rgba(5,8,13,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.055)', justifyContent: 'space-between' }}>
          <LinearGradient pointerEvents="none" colors={[hexWithAlpha(color, 0.17), 'rgba(5,8,13,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
          <View style={{ width: 38, height: 34, borderRadius: 12, backgroundColor: hexWithAlpha(color, 0.16), borderWidth: 1, borderColor: hexWithAlpha(color, 0.26), alignItems: 'center', justifyContent: 'center' }}>
            <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={{ fontSize: 10, fontWeight: '900', color, letterSpacing: 0.2, maxWidth: 30 }}>{badgeLabel}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '900', color: WHITE }}>{displaySport(sport)}</Text>
            <Text style={{ fontSize: 10.5, fontWeight: '700', color: 'rgba(180,211,235,0.58)', marginTop: 3 }}>{count} game{count !== 1 ? 's' : ''}</Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

// ─── GAME CARD BAR ───
const GameBar = memo(function GameBar({ game, onPress, onPressIn, showModelSignals = false }: { game: GameWithPrediction; onPress: () => void; onPressIn?: () => void; showModelSignals?: boolean }) {
  const live = game.status === GameStatus.LIVE;
  const final = game.status === GameStatus.FINAL;
  const awayC = getTeamColors(game.awayTeam.abbreviation, game.sport as Sport, game.awayTeam.color);
  const homeC = getTeamColors(game.homeTeam.abbreviation, game.sport as Sport, game.homeTeam.color);
  const awayAccent = awayC.accent;
  const homeAccent = homeC.accent;
  const sportMeta = SPORT_META[game.sport as Sport];
  const sportColor = sportMeta?.color ?? TEXT_MUTED;
  const timeStr = live ? null : final ? null : fmtTime(game.gameTime);
  const predictionDisplay = showModelSignals ? getGamePredictionDisplay(game) : null;
  const confidence = showModelSignals && game.prediction ? Math.round(displayConfidence(getCanonicalConfidence(game.prediction))) : null;
  const tier = showModelSignals && game.prediction ? getConfidenceTier(confidence ?? 50, predictionDisplay?.isTossUp) : null;
  const statusLabel = live ? (formatGameTime(game.sport, game.quarter, game.clock) ?? 'Live') : final ? 'Final' : timeStr;
  const scoreLabel = live || final ? `${game.awayScore ?? 0} - ${game.homeScore ?? 0}` : 'vs';

  return (
    <Pressable onPressIn={onPressIn} onPress={onPress} style={({ pressed }) => ({ marginBottom: 10, opacity: pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.992 : 1 }] })}>
      <LinearGradient
        colors={[hexWithAlpha(sportColor, 0.32), 'rgba(180,211,235,0.08)', live ? 'rgba(239,68,68,0.22)' : 'rgba(139,10,31,0.10)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, padding: 1 }}
      >
        <View style={{ borderRadius: 17, overflow: 'hidden', backgroundColor: 'rgba(5,8,13,0.97)', padding: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.055)' }}>
          <LinearGradient
            pointerEvents="none"
            colors={[hexWithAlpha(awayAccent, 0.12), 'rgba(5,8,13,0)', hexWithAlpha(homeAccent, 0.12)]}
            start={{ x: 0, y: 0.4 }}
            end={{ x: 1, y: 0.7 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <View style={{ backgroundColor: hexWithAlpha(sportColor, 0.14), borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: hexWithAlpha(sportColor, 0.2) }}>
                <Text style={{ fontSize: 9, fontWeight: '900', color: sportColor, letterSpacing: 1 }}>{displaySport(game.sport)}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: live ? 'rgba(239,68,68,0.10)' : 'rgba(255,255,255,0.045)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: live ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.07)' }}>
                {live ? <LiveDot /> : null}
                <Text style={{ fontSize: 9, fontWeight: '900', color: live ? LIVE_RED : TEXT_MUTED, letterSpacing: 0.8 }}>{statusLabel}</Text>
              </View>
            </View>
            <ChevronRight size={16} color="rgba(224,234,240,0.38)" strokeWidth={2.5} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
              <TeamJersey teamAbbreviation={game.awayTeam.abbreviation} teamName={game.awayTeam.name} primaryColor={awayC.primary} secondaryColor={awayC.secondary} size={34} sport={game.sport as Sport} />
              <Text style={{ fontSize: 15, fontWeight: '900', color: WHITE, marginTop: 6 }} numberOfLines={1}>{game.awayTeam.abbreviation}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(180,211,235,0.52)', marginTop: 2 }} numberOfLines={1}>{game.awayTeam.name}</Text>
            </View>
            <View style={{ width: 76, alignItems: 'center' }}>
              <Text style={{ fontSize: live || final ? 22 : 13, lineHeight: live || final ? 24 : 16, fontWeight: '900', color: WHITE, fontFamily: live || final ? 'VT323_400Regular' : undefined, letterSpacing: live || final ? 1 : 0 }}>{scoreLabel}</Text>
              {predictionDisplay && predictionDisplay.outcome !== 'none' && confidence !== null ? (
                <View style={{ marginTop: 7, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: hexWithAlpha(tier?.color ?? TEAL, 0.12), borderWidth: 1, borderColor: hexWithAlpha(tier?.color ?? TEAL, 0.2) }}>
                  <Text style={{ fontSize: 8, fontWeight: '900', color: tier?.color ?? TEAL }}>{predictionDisplay.badgeLabel} {confidence}%</Text>
                </View>
              ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
              <TeamJersey teamAbbreviation={game.homeTeam.abbreviation} teamName={game.homeTeam.name} primaryColor={homeC.primary} secondaryColor={homeC.secondary} size={34} sport={game.sport as Sport} />
              <Text style={{ fontSize: 15, fontWeight: '900', color: WHITE, marginTop: 6 }} numberOfLines={1}>{game.homeTeam.abbreviation}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: 'rgba(180,211,235,0.52)', marginTop: 2, textAlign: 'right' }} numberOfLines={1}>{game.homeTeam.name}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

const SectionHeader = memo(function SectionHeader({ label, title, icon }: { label?: string; title: string; icon?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginBottom: 10 }}>
      {icon}
      <View>
        {label ? <Text style={{ fontSize: 9, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2, marginBottom: 2 }}>{label}</Text> : null}
        <Text style={{ fontSize: 15, fontWeight: '900', color: WHITE }}>{title}</Text>
      </View>
    </View>
  );
});

const StoryCard = memo(function StoryCard({ game, tone, title, subtitle, onPress, onPressIn }: { game: GameWithPrediction; tone: StoryTone; title: string; subtitle: string; onPress: () => void; onPressIn?: () => void }) {
  const live = game.status === GameStatus.LIVE || (game.status as string) === 'in_progress' || (game.status as string) === 'halftime';
  const accent = tone === 'live' ? LIVE_RED : tone === 'upset' ? MAROON : tone === 'soon' ? TEAL : tone === 'final' ? '#94a3b8' : tone === 'tossup' ? '#94a3b8' : TEAL;
  return (
    <Pressable onPressIn={onPressIn} onPress={onPress} style={({ pressed }) => ({ width: 172, opacity: pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.986 : 1 }] })}>
      <LinearGradient
        colors={[hexWithAlpha(accent, 0.34), 'rgba(180,211,235,0.08)', 'rgba(255,255,255,0.035)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, padding: 1 }}
      >
        <View style={{ minHeight: 126, borderRadius: 17, overflow: 'hidden', backgroundColor: 'rgba(5,8,13,0.97)', padding: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.055)', justifyContent: 'space-between' }}>
          <LinearGradient pointerEvents="none" colors={[hexWithAlpha(accent, 0.14), 'rgba(5,8,13,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              {live ? <LiveDot /> : null}
              <Text style={{ fontSize: 9, fontWeight: '900', color: accent, letterSpacing: 1.2 }}>{title.toUpperCase()}</Text>
            </View>
            <Text style={{ fontSize: 15, lineHeight: 18, fontWeight: '900', color: WHITE }} numberOfLines={2}>{game.awayTeam.abbreviation} at {game.homeTeam.abbreviation}</Text>
            <Text style={{ fontSize: 10.5, lineHeight: 15, fontWeight: '700', color: 'rgba(224,234,240,0.55)', marginTop: 7 }} numberOfLines={2}>{subtitle}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED }}>{displaySport(game.sport)}</Text>
            <ChevronRight size={14} color="rgba(224,234,240,0.42)" strokeWidth={2.5} />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

// ─── MAIN ───
export default function SearchExploreScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const { data: allGames } = useGames();
  const prefetchGame = usePrefetchGame();
  const { isPremium } = useSubscription();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const deferredSportFilter = useDeferredValue(sportFilter);
  const deferredDebouncedQuery = useDeferredValue(debouncedQuery);

  const onChangeText = useCallback((text: string, instant?: boolean) => {
    setQuery(text);
    setSportFilter(null);
    setStatusFilter('all');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (instant) {
      setDebouncedQuery(text);
    } else {
      debounceRef.current = setTimeout(() => setDebouncedQuery(text), 200);
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('clutch_recent_searches').then(raw => setRecentSearches(raw ? JSON.parse(raw) : []));
  }, []);

  const saveRecent = useCallback(async (term: string) => {
    const existing = [...recentSearches];
    const updated = [term, ...existing.filter(s => s !== term)].slice(0, 5);
    await AsyncStorage.setItem('clutch_recent_searches', JSON.stringify(updated));
    setRecentSearches(updated);
  }, [recentSearches]);

  const removeRecent = useCallback(async (term: string) => {
    const updated = recentSearches.filter(s => s !== term);
    await AsyncStorage.setItem('clutch_recent_searches', JSON.stringify(updated));
    setRecentSearches(updated);
  }, [recentSearches]);

  const clearRecents = useCallback(async () => {
    await AsyncStorage.setItem('clutch_recent_searches', JSON.stringify([]));
    setRecentSearches([]);
  }, []);

  const handleSportTap = useCallback((sport: string) => {
    fireSelectionHaptic();
    setSportFilter(sport);
    setStatusFilter('all');
    setQuery('');
    setDebouncedQuery('');
  }, []);

  const sportCounts = useMemo(() => {
    if (!allGames) return [];
    const m = new Map<string, number>();
    for (const g of allGames) m.set(g.sport, (m.get(g.sport) ?? 0) + 1);
    return Array.from(m.entries()).map(([s, c]) => ({ sport: s, count: c })).sort((a, b) => b.count - a.count);
  }, [allGames]);

  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const localDateKey = useCallback((iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const trendingGames = useMemo(() => {
    if (!isPremium) return [];
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.prediction && g.status !== GameStatus.CANCELLED)
      .sort((a, b) => {
        const sa = ((a.prediction?.edgeRating ?? 5) * 10) + getCanonicalConfidence(a.prediction);
        const sb = ((b.prediction?.edgeRating ?? 5) * 10) + getCanonicalConfidence(b.prediction);
        return sb - sa;
      }).slice(0, 5);
  }, [allGames, isPremium]);

  const liveGames = useMemo(() => {
    if (!allGames) return [];
    return allGames
      .filter(g => g.status === GameStatus.LIVE || (g.status as string) === 'in_progress' || (g.status as string) === 'halftime')
      .slice(0, 6);
  }, [allGames]);

  const todaySchedule = useMemo(() => {
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.status === GameStatus.SCHEDULED && localDateKey(g.gameTime) === todayKey)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
      .slice(0, 8);
  }, [allGames, localDateKey, todayKey]);

  const finalGames = useMemo(() => {
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.status === GameStatus.FINAL)
      .sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime())
      .slice(0, 6);
  }, [allGames]);

  const startingSoon = useMemo(() => {
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.status === GameStatus.SCHEDULED && localDateKey(g.gameTime) !== todayKey)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
      .slice(0, 6);
  }, [allGames, localDateKey, todayKey]);

  const upsetWatch = useMemo(() => {
    if (!isPremium) return [];
    if (!allGames) return [];
    return [...allGames]
      .filter(g => {
        const pick = getCanonicalFinalPick(g.prediction);
        return (pick === 'home' || pick === 'away') && g.marketFavorite && pick !== g.marketFavorite;
      })
      .sort((a, b) => getCanonicalConfidence(b.prediction) - getCanonicalConfidence(a.prediction))
      .slice(0, 6);
  }, [allGames, isPremium]);

  const tossUpGames = useMemo(() => {
    if (!isPremium) return [];
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.prediction?.isTossUp || ((g.prediction?.confidence ?? 100) >= 48 && (g.prediction?.confidence ?? 0) <= 53))
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
      .slice(0, 6);
  }, [allGames, isPremium]);

  const baseFilteredGames = useMemo(() => {
    if (!allGames) return [];
    if (deferredSportFilter) return allGames.filter(g => g.sport === deferredSportFilter);
    if (!deferredDebouncedQuery.trim()) return [];
    // Split query into words, filter out "vs"/"at"/"@", match ANY word against game fields
    const words = deferredDebouncedQuery.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0 && !['vs', 'at', '@', '-'].includes(w));
    if (words.length === 0) return [];
    return allGames.filter(g => {
      const haystack = `${g.homeTeam.name} ${g.homeTeam.abbreviation} ${g.homeTeam.city} ${g.awayTeam.name} ${g.awayTeam.abbreviation} ${g.awayTeam.city} ${g.sport} ${g.venue ?? ''}`.toLowerCase();
      return words.some(w => haystack.includes(w));
    });
  }, [deferredDebouncedQuery, deferredSportFilter, allGames]);

  const filteredGames = useMemo(() => {
    if (statusFilter === 'all') return baseFilteredGames;
    if (statusFilter === 'live') return baseFilteredGames.filter(g => g.status === GameStatus.LIVE || (g.status as string) === 'in_progress' || (g.status as string) === 'halftime');
    if (statusFilter === 'scheduled') return baseFilteredGames.filter(g => g.status === GameStatus.SCHEDULED);
    return baseFilteredGames.filter(g => g.status === GameStatus.FINAL);
  }, [baseFilteredGames, statusFilter]);

  const showResults = sportFilter !== null || debouncedQuery.trim().length > 0;
  const resultTitle = sportFilter ? displaySport(sportFilter) : debouncedQuery.trim();

  const warmGame = useCallback((game: GameWithPrediction) => {
    prefetchGame(game.id, game);
  }, [prefetchGame]);

  const navGame = useCallback((game: GameWithPrediction) => {
    Keyboard.dismiss();
    warmGame(game);
    router.push({ pathname: '/game/[id]', params: { id: game.id } });
    fireLightHaptic();
    if (query.trim()) void saveRecent(query.trim());
    else void saveRecent(`${game.awayTeam.abbreviation} vs ${game.homeTeam.abbreviation}`);
  }, [query, router, saveRecent, warmGame]);

  const goBack = useCallback(() => { Keyboard.dismiss(); router.back(); }, [router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
          <Pressable
            onPress={goBack}
            hitSlop={12}
            style={{ width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
          >
            <ArrowLeft size={20} color={WHITE} strokeWidth={2.4} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontSize: 9, fontWeight: '900', color: 'rgba(180,211,235,0.52)', letterSpacing: 2.2 }}>ARENA SEARCH</Text>
            <Text style={{ fontSize: 22, lineHeight: 27, fontWeight: '900', color: WHITE, marginTop: 2 }}>Find a matchup</Text>
          </View>
          <Pressable onPress={goBack} hitSlop={10}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: TEAL }}>Cancel</Text>
          </Pressable>
        </View>

        <LinearGradient
          colors={['rgba(180,211,235,0.26)', 'rgba(122,157,184,0.12)', 'rgba(139,10,31,0.16)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 20, padding: 1 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, borderRadius: 19, backgroundColor: 'rgba(5,8,13,0.98)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.055)', paddingHorizontal: 14 }}>
            <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(122,157,184,0.12)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 11 }}>
              <Search size={17} color={TEAL} strokeWidth={2.4} />
            </View>
            <TextInput
              ref={inputRef}
              style={{ flex: 1, fontSize: 15, fontWeight: '700', color: WHITE, paddingVertical: 0 }}
              placeholder="Search teams, sports, venues"
              placeholderTextColor="rgba(180,211,235,0.42)"
              keyboardAppearance="dark"
              selectionColor={MAROON_DIM}
              returnKeyType="done"
              value={query}
              onChangeText={onChangeText}
              onSubmitEditing={() => Keyboard.dismiss()}
            />
            {query.length > 0 || sportFilter ? (
              <Pressable onPress={() => { setQuery(''); setDebouncedQuery(''); setSportFilter(null); setStatusFilter('all'); }} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.045)' }}>
                <X size={16} color={TEXT_MUTED} />
              </Pressable>
            ) : null}
          </View>
        </LinearGradient>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={Keyboard.dismiss} contentContainerStyle={{ paddingBottom: 60 }}>
        {!showResults ? (
          <>
            {recentSearches.length > 0 ? (
              <View style={{ marginBottom: 24 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 10 }}>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2 }}>RECENT SEARCHES</Text>
                  <Pressable onPress={clearRecents} hitSlop={8}><Text style={{ fontSize: 10, fontWeight: '900', color: MAROON }}>CLEAR</Text></Pressable>
                </View>
                <View style={{ paddingHorizontal: 20, gap: 8 }}>
                  {recentSearches.map(term => (
                    <Pressable key={term} onPress={() => onChangeText(term, true)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, borderRadius: 14, paddingHorizontal: 13, backgroundColor: 'rgba(255,255,255,0.035)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                      <Clock size={14} color={TEXT_MUTED} />
                      <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: TEXT_SECONDARY, marginLeft: 10 }} numberOfLines={1}>{term}</Text>
                      <Pressable onPress={() => removeRecent(term)} hitSlop={8} style={{ width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }}>
                        <X size={14} color={TEXT_MUTED} />
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {liveGames.length > 0 ? (
              <View style={{ marginBottom: 24 }}>
                <SectionHeader icon={<Radio size={14} color={LIVE_RED} />} label="HAPPENING NOW" title="Live games" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
                  {liveGames.map(game => (
                    <StoryCard
                      key={`live-${game.id}`}
                      game={game}
                      tone="live"
                      title="Live"
                      subtitle={`${game.awayScore ?? 0}-${game.homeScore ?? 0} · ${formatGameTime(game.sport, game.quarter, game.clock) ?? 'In progress'}`}
                      onPressIn={() => warmGame(game)}
                      onPress={() => navGame(game)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {sportCounts.length > 0 ? (
              <View style={{ marginBottom: 24 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2, paddingHorizontal: 20, marginBottom: 10 }}>BROWSE THE SLATE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                  {sportCounts.map(({ sport, count }) => <SportCard key={sport} sport={sport} count={count} onPress={() => handleSportTap(sport)} />)}
                </ScrollView>
              </View>
            ) : null}

            {todaySchedule.length > 0 ? (
              <View style={{ marginBottom: 24 }}>
                <SectionHeader icon={<CalendarClock size={14} color={TEAL} />} label="TODAY" title="Scheduled games" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
                  {todaySchedule.map(game => (
                    <StoryCard
                      key={`today-${game.id}`}
                      game={game}
                      tone="soon"
                      title={fmtTime(game.gameTime)}
                      subtitle={`${displaySport(game.sport)} · ${game.venue && game.venue !== 'TBD' ? game.venue : 'Scheduled'}`}
                      onPressIn={() => warmGame(game)}
                      onPress={() => navGame(game)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {finalGames.length > 0 ? (
              <View style={{ marginBottom: 24 }}>
                <SectionHeader icon={<Clock size={14} color="#94a3b8" />} label="RECENT" title="Final scores" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
                  {finalGames.map(game => (
                    <StoryCard
                      key={`final-${game.id}`}
                      game={game}
                      tone="final"
                      title="Final"
                      subtitle={`${game.awayTeam.abbreviation} ${game.awayScore ?? 0} · ${game.homeTeam.abbreviation} ${game.homeScore ?? 0}`}
                      onPressIn={() => warmGame(game)}
                      onPress={() => navGame(game)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {upsetWatch.length > 0 ? (
              <View style={{ marginBottom: 24 }}>
                <SectionHeader icon={<ShieldAlert size={14} color={MAROON} />} label="MARKET DISAGREEMENT" title="Upset watch" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
                  {upsetWatch.map(game => {
                    const pick = getCanonicalFinalPick(game.prediction);
                    const dog = pick === 'home' ? game.homeTeam : game.awayTeam;
                    const fav = pick === 'home' ? game.awayTeam : game.homeTeam;
                    const conf = Math.round(displayConfidence(getCanonicalConfidence(game.prediction)));
                    return (
                      <StoryCard
                        key={`upset-${game.id}`}
                        game={game}
                        tone="upset"
                        title="Upset case"
                        subtitle={`${fav.abbreviation} favored, model prefers ${dog.abbreviation} at ${conf}%`}
                        onPressIn={() => warmGame(game)}
                        onPress={() => navGame(game)}
                      />
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {tossUpGames.length > 0 ? (
              <View style={{ marginBottom: 24 }}>
                <SectionHeader icon={<Flame size={14} color="#94a3b8" />} label="CLOSEST LINES" title="Toss-up watch" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
                  {tossUpGames.map(game => (
                    <StoryCard
                      key={`toss-${game.id}`}
                      game={game}
                      tone="tossup"
                      title="Toss-up"
                      subtitle={`Model has this close to even · ${fmtTime(game.gameTime)}`}
                      onPressIn={() => warmGame(game)}
                      onPress={() => navGame(game)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {startingSoon.length > 0 ? (
              <View style={{ marginBottom: 24 }}>
                <SectionHeader icon={<CalendarClock size={14} color={TEAL} />} label="NEXT WINDOW" title="Starting soon" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
                  {startingSoon.map(game => (
                    <StoryCard
                      key={`soon-${game.id}`}
                      game={game}
                      tone="soon"
                      title={fmtTime(game.gameTime)}
                      subtitle={`${displaySport(game.sport)} · ${game.venue && game.venue !== 'TBD' ? game.venue : 'Scheduled'}`}
                      onPressIn={() => warmGame(game)}
                      onPress={() => navGame(game)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {trendingGames.length > 0 ? (
              <View style={{ marginBottom: 20 }}>
                <SectionHeader icon={<Trophy size={14} color={TEAL} />} label="MODEL BOARD" title="Top grades" />
                <View style={{ paddingHorizontal: 20 }}>
                  {trendingGames.map(game => <GameBar key={game.id} game={game} showModelSignals={isPremium} onPressIn={() => warmGame(game)} onPress={() => navGame(game)} />)}
                </View>
              </View>
            ) : null}
          </>
        ) : baseFilteredGames.length > 0 ? (
          <View>
            <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2, marginBottom: 5 }}>{sportFilter ? 'BROWSING SPORT' : 'SEARCH RESULTS'}</Text>
                  <Text style={{ fontSize: 22, lineHeight: 27, fontWeight: '900', color: WHITE }} numberOfLines={1}>{resultTitle}</Text>
                </View>
                {sportFilter ? <Pressable onPress={() => { setSportFilter(null); setStatusFilter('all'); }} hitSlop={8}><Text style={{ fontSize: 12, fontWeight: '900', color: TEAL }}>CLEAR</Text></Pressable> : null}
              </View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(180,211,235,0.52)', marginTop: 5 }}>{baseFilteredGames.length} match{baseFilteredGames.length !== 1 ? 'es' : ''}</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 14 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
              {STATUS_OPTIONS.map(({ key, label }) => {
                const active = statusFilter === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => { if (!active) fireSelectionHaptic(); setStatusFilter(key); }}
                    style={({ pressed }) => ({ borderRadius: 999, paddingHorizontal: 15, paddingVertical: 8, backgroundColor: active ? MAROON : 'rgba(122,157,184,0.08)', borderWidth: active ? 0 : 1, borderColor: active ? 'transparent' : 'rgba(122,157,184,0.12)', opacity: pressed ? 0.86 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
                  >
                    <Text style={{ fontSize: 12, fontWeight: active ? '800' : '700', color: active ? WHITE : TEAL }}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {filteredGames.length > 0 ? (
              <View style={{ paddingHorizontal: 20 }}>
                {filteredGames.map(game => <GameBar key={game.id} game={game} showModelSignals={isPremium} onPressIn={() => warmGame(game)} onPress={() => navGame(game)} />)}
              </View>
            ) : (
              <View style={{ marginHorizontal: 20, borderRadius: 18, padding: 18, alignItems: 'center', backgroundColor: PANEL_DARK, borderWidth: 1, borderColor: BORDER_MED }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: WHITE }}>No {STATUS_OPTIONS.find(o => o.key === statusFilter)?.label.toLowerCase()} games</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: TEXT_MUTED, marginTop: 5 }}>Switch the status view to see the rest of the slate.</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, paddingTop: 30 }}>
            <View style={{ borderRadius: 20, padding: 20, alignItems: 'center', backgroundColor: PANEL_DARK, borderWidth: 1, borderColor: BORDER_MED }}>
              <Text style={{ fontSize: 15, fontWeight: '900', color: WHITE, marginBottom: 6 }}>
                No matches {sportFilter ? `for ${displaySport(sportFilter)}` : query ? `for "${query}"` : ''}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: TEXT_MUTED, textAlign: 'center', lineHeight: 17 }}>Search another team, league, or venue.</Text>
            </View>
            {sportCounts.length > 0 ? (
              <View style={{ marginTop: 24, marginHorizontal: -20 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: TEXT_MUTED, letterSpacing: 2, paddingHorizontal: 20, marginBottom: 10 }}>BROWSE SPORTS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                  {sportCounts.map(({ sport, count }) => <SportCard key={sport} sport={sport} count={count} onPress={() => handleSportTap(sport)} />)}
                </ScrollView>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
