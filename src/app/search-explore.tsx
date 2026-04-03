import React, { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import { ArrowLeft, Search, Clock, X, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGames } from '@/hooks/useGames';
import { GameWithPrediction, GameStatus, Sport, SPORT_META } from '@/types/sports';
import { displaySport } from '@/lib/display-confidence';
import { getTeamColors } from '@/lib/team-colors';

const MAROON = '#8B0A1F';
const MAROON_DIM = 'rgba(139,10,31,0.15)';
const TEAL = '#7A9DB8';
const LIVE_RED = '#DC2626';
const BG = '#040608';
const GLASS = 'rgba(8,8,12,0.95)';
const BORDER = 'rgba(255,255,255,0.08)';
const WHITE = '#FFFFFF';
const TEXT_SECONDARY = '#A1B3C9';
const TEXT_MUTED = '#6B7C94';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─── LIVE DOT ───
const LiveDot = memo(function LiveDot() {
  const op = useSharedValue(1);
  useEffect(() => { op.value = withRepeat(withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true); return () => cancelAnimation(op); }, []);
  const s = useAnimatedStyle(() => ({ opacity: op.value }));
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: LIVE_RED }, s]} />;
});

// ─── SPORT BROWSE CARD ───
const SportCard = memo(function SportCard({ sport, count, onPress }: { sport: string; count: number; onPress: () => void }) {
  const meta = SPORT_META[sport as Sport];
  const color = meta?.color ?? TEXT_MUTED;
  return (
    <Pressable onPress={onPress} style={{ minWidth: 110, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: color, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>{displaySport(sport)}</Text>
      </View>
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 }}>{displaySport(sport)}</Text>
      <Text style={{ fontSize: 10, color: '#6B7C94' }}>{count} game{count !== 1 ? 's' : ''} today</Text>
    </Pressable>
  );
});

// ─── GAME CARD BAR ───
const GameBar = memo(function GameBar({ game, onPress }: { game: GameWithPrediction; onPress: () => void }) {
  const live = game.status === GameStatus.LIVE;
  const final = game.status === GameStatus.FINAL;
  const awayC = getTeamColors(game.awayTeam.abbreviation, game.sport as Sport);
  const homeC = getTeamColors(game.homeTeam.abbreviation, game.sport as Sport);
  const sportMeta = SPORT_META[game.sport as Sport];
  const sportColor = sportMeta?.color ?? TEXT_MUTED;
  const timeStr = live ? null : final ? null : fmtTime(game.gameTime);

  return (
    <Pressable onPress={onPress} style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {/* Sport color accent bar */}
      <View style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 1.5, backgroundColor: sportColor }} />
      {/* Sport badge */}
      <View style={{ backgroundColor: `${sportColor}20`, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', minWidth: 42, marginLeft: 4 }}>
        <Text style={{ fontSize: 10, fontWeight: '800', color: sportColor, letterSpacing: 0.5 }}>{displaySport(game.sport)}</Text>
      </View>
      {/* Teams */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: awayC.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 8, fontWeight: '800', color: WHITE }}>{game.awayTeam.abbreviation}</Text>
          </View>
          <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE }}>{game.awayTeam.abbreviation}</Text>
          <Text style={{ fontSize: 9, color: TEXT_MUTED }}>@</Text>
          <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE }}>{game.homeTeam.abbreviation}</Text>
          <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: homeC.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 8, fontWeight: '800', color: WHITE }}>{game.homeTeam.abbreviation}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          {live ? (
            <><LiveDot /><Text style={{ fontSize: 11, fontWeight: '700', color: LIVE_RED }}>LIVE</Text><Text style={{ fontSize: 10, color: TEXT_MUTED }}>{game.quarter ?? null}</Text></>
          ) : final ? (
            <><View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ fontSize: 8, fontWeight: '700', color: TEXT_MUTED }}>FINAL</Text></View><Text style={{ fontSize: 11, color: TEXT_SECONDARY }}>{game.awayScore ?? 0} - {game.homeScore ?? 0}</Text></>
          ) : (
            <Text style={{ fontSize: 11, color: TEXT_MUTED }}>{timeStr}</Text>
          )}
        </View>
      </View>
      <ChevronRight size={16} color={TEXT_MUTED} />
    </Pressable>
  );
});

// ─── MAIN ───
export default function SearchExploreScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const { data: allGames } = useGames();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onChangeText = useCallback((text: string, instant?: boolean) => {
    setQuery(text);
    setSportFilter(null);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSportFilter(sport);
    setQuery('');
    setDebouncedQuery('');
  }, []);

  const sportCounts = useMemo(() => {
    if (!allGames) return [];
    const m = new Map<string, number>();
    for (const g of allGames) m.set(g.sport, (m.get(g.sport) ?? 0) + 1);
    return Array.from(m.entries()).map(([s, c]) => ({ sport: s, count: c })).sort((a, b) => b.count - a.count);
  }, [allGames]);

  const trendingGames = useMemo(() => {
    if (!allGames) return [];
    return [...allGames]
      .filter(g => g.prediction && g.status !== GameStatus.CANCELLED)
      .sort((a, b) => {
        const sa = ((a.prediction?.edgeRating ?? 5) * 10) + (a.prediction?.confidence ?? 50);
        const sb = ((b.prediction?.edgeRating ?? 5) * 10) + (b.prediction?.confidence ?? 50);
        return sb - sa;
      }).slice(0, 5);
  }, [allGames]);

  const filteredGames = useMemo(() => {
    if (!allGames) return [];
    if (sportFilter) return allGames.filter(g => g.sport === sportFilter);
    if (!debouncedQuery.trim()) return [];
    // Split query into words, filter out "vs"/"at"/"@", match ANY word against game fields
    const words = debouncedQuery.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0 && !['vs', 'at', '@', '-'].includes(w));
    if (words.length === 0) return [];
    return allGames.filter(g => {
      const haystack = `${g.homeTeam.name} ${g.homeTeam.abbreviation} ${g.homeTeam.city} ${g.awayTeam.name} ${g.awayTeam.abbreviation} ${g.awayTeam.city} ${g.sport} ${g.venue ?? ''}`.toLowerCase();
      return words.some(w => haystack.includes(w));
    });
  }, [debouncedQuery, sportFilter, allGames]);

  const showResults = sportFilter !== null || debouncedQuery.trim().length > 0;

  const navGame = useCallback((game: GameWithPrediction) => {
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (query.trim()) saveRecent(query.trim());
    else saveRecent(`${game.awayTeam.abbreviation} vs ${game.homeTeam.abbreviation}`);
    router.push(`/game/${game.id}`);
  }, [query, router, saveRecent]);

  const goBack = useCallback(() => { Keyboard.dismiss(); router.back(); }, [router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
        <Pressable onPress={goBack} hitSlop={12}><ArrowLeft size={22} color={WHITE} strokeWidth={2} /></Pressable>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: GLASS, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 10 }}>
          <Search size={16} color={TEXT_MUTED} strokeWidth={2} style={{ marginRight: 10 }} />
          <TextInput ref={inputRef} style={{ flex: 1, fontSize: 15, fontWeight: '500', color: WHITE }} placeholder="Search games, teams, sports..." placeholderTextColor={TEXT_MUTED} autoFocus keyboardAppearance="dark" selectionColor={MAROON_DIM} returnKeyType="done" value={query} onChangeText={onChangeText} onSubmitEditing={() => Keyboard.dismiss()} />
          {query.length > 0 ? <Pressable onPress={() => { setQuery(''); setDebouncedQuery(''); setSportFilter(null); }} hitSlop={8}><X size={16} color={TEXT_MUTED} /></Pressable> : null}
        </View>
        <Pressable onPress={goBack}><Text style={{ fontSize: 14, fontWeight: '600', color: TEAL }}>Cancel</Text></Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
        {!showResults ? (
          <>
            {/* Recents */}
            {recentSearches.length > 0 ? (
              <View style={{ marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 10 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 2 }}>RECENT</Text>
                  <Pressable onPress={clearRecents}><Text style={{ fontSize: 10, fontWeight: '700', color: MAROON }}>Clear</Text></Pressable>
                </View>
                {recentSearches.map(term => (
                  <Pressable key={term} onPress={() => onChangeText(term, true)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8 }}>
                    <Clock size={14} color={TEXT_MUTED} />
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: TEXT_SECONDARY, marginLeft: 10 }}>{term}</Text>
                    <Pressable onPress={() => removeRecent(term)} hitSlop={8}><X size={14} color={TEXT_MUTED} /></Pressable>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Browse Sports */}
            {sportCounts.length > 0 ? (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 2, paddingHorizontal: 20, marginBottom: 10 }}>BROWSE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                  {sportCounts.map(({ sport, count }) => <SportCard key={sport} sport={sport} count={count} onPress={() => handleSportTap(sport)} />)}
                </ScrollView>
              </View>
            ) : null}

            {/* Trending */}
            {trendingGames.length > 0 ? (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 2, paddingHorizontal: 20, marginBottom: 10 }}>TRENDING TONIGHT</Text>
                <View style={{ paddingHorizontal: 20 }}>
                  {trendingGames.map(game => <GameBar key={game.id} game={game} onPress={() => navGame(game)} />)}
                </View>
              </View>
            ) : null}
          </>
        ) : filteredGames.length > 0 ? (
          <View>
            {sportFilter ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 4 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: WHITE }}>Showing: {sportFilter}</Text>
                <Pressable onPress={() => setSportFilter(null)}><Text style={{ fontSize: 12, fontWeight: '600', color: TEAL }}>Clear</Text></Pressable>
              </View>
            ) : null}
            <Text style={{ fontSize: 10, color: TEXT_MUTED, paddingHorizontal: 20, marginBottom: 10 }}>{filteredGames.length} game{filteredGames.length !== 1 ? 's' : ''}</Text>
            <View style={{ paddingHorizontal: 20 }}>
              {filteredGames.map(game => <GameBar key={game.id} game={game} onPress={() => navGame(game)} />)}
            </View>
          </View>
        ) : (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: WHITE, marginBottom: 6 }}>
              No results {sportFilter ? `for ${sportFilter} today` : query ? `for '${query}'` : null}
            </Text>
            <Text style={{ fontSize: 11, color: TEXT_MUTED }}>Try a team name or browse a different sport</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
