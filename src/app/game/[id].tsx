import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
  StyleSheet,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame } from '@/hooks/useGames';
import { useSmoothRefresh } from '@/hooks/useSmoothRefresh';
import { displayWinProbability, displaySport, formatGameTime, getConfidenceTier } from '@/lib/display-confidence';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeInDown,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { Sport, type CanonicalPredictionResult, type Prediction } from '@/types/sports';
import { useGamePick, useMakePick, useRemovePick } from '@/hooks/usePicks';
import { AnalysisIcon } from '@/components/icons/AnalysisIcon';
import { getTeamColors } from '@/lib/team-colors';
import { MLBLiveCenterStack } from '@/components/sports/MLBLiveState';
import { ArenaScoreboard } from '@/components/sports/ArenaScoreboard';
import { PickConfirmationModal } from '@/components/sports/PickConfirmationModal';
import { getGameStartLabel } from '@/lib/game-start-label';
import { useSubscription } from '@/lib/subscription-context';
import { displayPredictionAnalysis } from '@/lib/narrative-display';
import { getProjectionDisplay, getProjectionRiskTier } from '@/lib/projection-display';
import { getPredictionDisplay } from '@/lib/prediction-display';
import {
  getCanonicalConfidence,
  getCanonicalResult,
  getCanonicalWinProbabilities,
} from '@/lib/canonical-result';
import {
  cricketInningsContext,
  cricketLedScoreText,
  cricketOversText,
  cricketRequiredText,
  cricketRoleText,
  cricketStatusText,
  teamScoreText,
} from '@/lib/cricket-score';
import { isSuspendedGame, suspendedReasonText, suspendedResumeText } from '@/lib/game-status';
import { getWatchSourceUrl } from '@/lib/watch-url';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExternalLink, Tv } from 'lucide-react-native';

type WatchOptionKind = 'broadcast' | 'streaming';
type WatchOption = {
  name: string;
  kind: WatchOptionKind;
  note?: string;
};
type StreamingRule = {
  match: RegExp;
  options: WatchOption[];
};

const UNKNOWN_WATCH_LABELS = new Set([
  'tbd',
  'tba',
  'n/a',
  'na',
  'none',
  'not listed',
  'broadcast info not listed',
  'watch info tbd',
]);

const DIRECT_STREAMING_SOURCE_RE = /(mlb\.tv|espn\+|espn plus|peacock|paramount\+|prime video|amazon prime|apple tv\+|youtube tv|hulu|fubo|sling|directv stream|nba league pass|league pass|nfl\+|willow)/i;

const WATCH_POPULARITY_ORDER: Array<{ match: RegExp; rank: number }> = [
  { match: /youtube tv/i, rank: 10 },
  { match: /hulu/i, rank: 20 },
  { match: /peacock/i, rank: 30 },
  { match: /prime video|amazon/i, rank: 40 },
  { match: /espn\+|espn plus/i, rank: 45 },
  { match: /paramount/i, rank: 50 },
  { match: /apple tv/i, rank: 55 },
  { match: /\bmax\b/i, rank: 60 },
  { match: /fubo/i, rank: 70 },
  { match: /directv/i, rank: 80 },
  { match: /sling/i, rank: 90 },
  { match: /mlb\.tv|mlb app/i, rank: 100 },
  { match: /nba league pass|league pass/i, rank: 105 },
  { match: /nfl\+/i, rank: 110 },
  { match: /fox sports/i, rank: 120 },
  { match: /nbc sports/i, rank: 125 },
  { match: /cbs sports/i, rank: 130 },
  { match: /abc app/i, rank: 135 },
  { match: /regional sports/i, rank: 145 },
  { match: /willow/i, rank: 150 },
];

const STREAMING_RULES: StreamingRule[] = [
  {
    match: /\bmlb\.tv\b/i,
    options: [{ name: 'MLB.TV', kind: 'streaming', note: 'Official stream' }],
  },
  {
    match: /\bmlb network\b/i,
    options: [
      { name: 'MLB app', kind: 'streaming', note: 'TV provider stream' },
      { name: 'YouTube TV', kind: 'streaming', note: 'Live TV' },
      { name: 'Fubo', kind: 'streaming', note: 'Live TV' },
    ],
  },
  {
    match: /\bespn\+|espn plus\b/i,
    options: [{ name: 'ESPN+', kind: 'streaming', note: 'Official stream' }],
  },
  {
    match: /\bespn|espn2|espnu|acc network|sec network\b/i,
    options: [
      { name: 'ESPN app', kind: 'streaming', note: 'TV provider stream' },
      { name: 'YouTube TV', kind: 'streaming', note: 'Live TV' },
      { name: 'Hulu + Live TV', kind: 'streaming', note: 'Live TV' },
      { name: 'Sling TV', kind: 'streaming', note: 'Live TV' },
    ],
  },
  {
    match: /\bfox|fs1|fs2|big ten network|btn\b/i,
    options: [
      { name: 'FOX Sports app', kind: 'streaming', note: 'TV provider stream' },
      { name: 'YouTube TV', kind: 'streaming', note: 'Live TV' },
      { name: 'Fubo', kind: 'streaming', note: 'Live TV' },
      { name: 'Hulu + Live TV', kind: 'streaming', note: 'Live TV' },
    ],
  },
  {
    match: /\babc\b/i,
    options: [
      { name: 'ABC app', kind: 'streaming', note: 'TV provider stream' },
      { name: 'YouTube TV', kind: 'streaming', note: 'Live TV' },
      { name: 'Hulu + Live TV', kind: 'streaming', note: 'Live TV' },
    ],
  },
  {
    match: /\bnbc|usa network|peacock\b/i,
    options: [
      { name: 'Peacock', kind: 'streaming', note: 'Official stream' },
      { name: 'NBC Sports app', kind: 'streaming', note: 'TV provider stream' },
      { name: 'YouTube TV', kind: 'streaming', note: 'Live TV' },
    ],
  },
  {
    match: /\bcbs|paramount\+\b/i,
    options: [
      { name: 'Paramount+', kind: 'streaming', note: 'Official stream' },
      { name: 'CBS Sports app', kind: 'streaming', note: 'TV provider stream' },
      { name: 'YouTube TV', kind: 'streaming', note: 'Live TV' },
    ],
  },
  {
    match: /\btnt|tbs|tru tv|trutv\b/i,
    options: [
      { name: 'Max', kind: 'streaming', note: 'Sports add-on' },
      { name: 'YouTube TV', kind: 'streaming', note: 'Live TV' },
      { name: 'Hulu + Live TV', kind: 'streaming', note: 'Live TV' },
      { name: 'Sling TV', kind: 'streaming', note: 'Live TV' },
    ],
  },
  {
    match: /\bprime video|amazon\b/i,
    options: [{ name: 'Prime Video', kind: 'streaming', note: 'Official stream' }],
  },
  {
    match: /\bapple|apple tv\+\b/i,
    options: [{ name: 'Apple TV+', kind: 'streaming', note: 'Official stream' }],
  },
  {
    match: /\bnba tv\b/i,
    options: [
      { name: 'NBA League Pass', kind: 'streaming', note: 'League stream' },
      { name: 'YouTube TV', kind: 'streaming', note: 'Live TV' },
    ],
  },
  {
    match: /\bnfl network|nfl\+\b/i,
    options: [
      { name: 'NFL+', kind: 'streaming', note: 'Official stream' },
      { name: 'YouTube TV', kind: 'streaming', note: 'Live TV' },
    ],
  },
  {
    match: /\bwillow\b/i,
    options: [{ name: 'Willow TV', kind: 'streaming', note: 'Cricket stream' }],
  },
  {
    match: /\bfanduel|bally sports|yes network|\byes\b|sny|nesn|masn|marquee|root sports|altitude|monumental|sportsnet\b/i,
    options: [
      { name: 'Regional sports app', kind: 'streaming', note: 'TV provider stream' },
      { name: 'DIRECTV Stream', kind: 'streaming', note: 'Live TV' },
      { name: 'Fubo', kind: 'streaming', note: 'Live TV' },
    ],
  },
];

function openWatchSource(source: string) {
  void Linking.openURL(getWatchSourceUrl(source)).catch(() => undefined);
}

function getWatchPopularityRank(option: WatchOption): number {
  if (option.kind === 'broadcast') return 0;
  const match = WATCH_POPULARITY_ORDER.find((rule) => rule.match.test(option.name));
  return match?.rank ?? 999;
}

function sortWatchOptions(options: WatchOption[]): WatchOption[] {
  return [...options].sort((a, b) => {
    const kindDelta = a.kind === b.kind ? 0 : a.kind === 'broadcast' ? -1 : 1;
    if (kindDelta !== 0) return kindDelta;
    const rankDelta = getWatchPopularityRank(a) - getWatchPopularityRank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.name.localeCompare(b.name);
  });
}

function watchKindForName(name: string): WatchOptionKind {
  return DIRECT_STREAMING_SOURCE_RE.test(name) ? 'streaming' : 'broadcast';
}

function splitWatchString(value: string): string[] {
  if (/^https?:\/\//i.test(value.trim())) return [value.trim()];
  return value
    .split(/\s*(?:,|;|\||\/)\s*/g)
    .map((source) => source.trim())
    .filter(Boolean);
}

function collectWatchNames(source: unknown): string[] {
  if (!source) return [];
  if (typeof source === 'string') return splitWatchString(source);
  if (Array.isArray(source)) return source.flatMap((item) => collectWatchNames(item));
  if (typeof source === 'object') {
    const maybe = source as {
      name?: unknown;
      displayName?: unknown;
      shortName?: unknown;
      label?: unknown;
      names?: unknown;
    };
    const direct = [maybe.name, maybe.displayName, maybe.shortName, maybe.label].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return direct ? splitWatchString(direct) : collectWatchNames(maybe.names);
  }
  return [];
}

function makeUniqueWatchOptions(options: WatchOption[]): WatchOption[] {
  const seen = new Set<string>();
  return options.reduce<WatchOption[]>((result, option) => {
    const cleaned = option.name.replace(/\s+/g, ' ').trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || UNKNOWN_WATCH_LABELS.has(key)) return result;
    if (seen.has(key)) return result;
    seen.add(key);
    result.push({ ...option, name: cleaned });
    return result;
  }, []);
}

function inferStreamingOptions(names: string[]): WatchOption[] {
  return makeUniqueWatchOptions(
    names.flatMap((name) => (
      STREAMING_RULES
        .filter((rule) => rule.match.test(name))
        .flatMap((rule) => rule.options)
    ))
  );
}

function getWatchOptions(primaryChannel?: string | null, watchSources?: unknown): WatchOption[] {
  const names = [...collectWatchNames(primaryChannel), ...collectWatchNames(watchSources)];
  const listedOptions = names.map((name) => ({
    name,
    kind: watchKindForName(name),
    note: watchKindForName(name) === 'streaming' ? 'Listed stream' : 'Listed broadcast',
  }));
  return sortWatchOptions(makeUniqueWatchOptions([...listedOptions, ...inferStreamingOptions(names)]));
}

function getTopStreamingOption(primaryChannel?: string | null, watchSources?: unknown): WatchOption | null {
  const streamingOptions = sortWatchOptions(
    getWatchOptions(primaryChannel, watchSources).filter((option) => option.kind === 'streaming')
  );
  return streamingOptions.find((option) => /youtube tv/i.test(option.name)) ?? streamingOptions[0] ?? null;
}

function WhereToWatchRow({
  primaryChannel,
  watchSources,
}: {
  primaryChannel?: string | null;
  watchSources?: unknown;
  venue?: string | null;
}) {
  const topStream = useMemo(() => getTopStreamingOption(primaryChannel, watchSources), [primaryChannel, watchSources]);
  const hasStreamInfo = Boolean(topStream);
  const primaryText = topStream?.name ?? 'Watch info TBD';
  const sourceMetaText = hasStreamInfo ? 'Top streaming option' : 'Streaming source not listed yet';

  return (
    <View style={styles.watchStrip}>
      <View style={styles.watchHubBorder}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasStreamInfo ? `Open ${primaryText}` : 'Watch source not listed'}
          disabled={!topStream}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (topStream) openWatchSource(topStream.name);
          }}
          style={({ pressed }) => [
            styles.watchHubCard,
            pressed && styles.infoPillPressed,
          ]}
        >
          <View style={styles.watchHubHeader}>
            <View style={styles.watchHubHeaderIcon}>
              <Tv size={15} color="#DAEEFB" strokeWidth={2.45} />
            </View>
            <View style={styles.watchHubHeaderCopy}>
              <Text style={styles.watchHubEyebrow}>Watch On</Text>
              <Text style={styles.watchHubTitle} numberOfLines={1}>{primaryText}</Text>
              <Text style={styles.watchHubSourceMeta} numberOfLines={1}>{sourceMetaText}</Text>
            </View>
            <View style={styles.watchHubSourcesPill}>
              <Text style={styles.watchHubSourcesPillText}>{hasStreamInfo ? 'Open' : 'TBD'}</Text>
              {hasStreamInfo ? <ExternalLink size={13} color="rgba(226,240,249,0.72)" strokeWidth={2.6} /> : null}
            </View>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// Tappable Jersey component for hero section - matches GameCard style
const TappableJerseyHero = React.memo(function TappableJerseyHero({
  team,
  isSelected,
  onSelect,
  isDisabled,
  jerseyType,
  sport,
}: {
  team: GameTeam;
  isSelected: boolean;
  onSelect: () => void;
  isDisabled: boolean;
  jerseyType: ReturnType<typeof sportEnumToJersey>;
  sport: string;
}) {
  const scale = useSharedValue(1);
  const selectionProgress = useSharedValue(isSelected ? 1 : 0);
  const teamColors = getTeamColors(team.abbreviation, sport as any, team.color);

  useEffect(() => {
    selectionProgress.value = withSpring(isSelected ? 1 : 0, {
      damping: 16,
      stiffness: 210,
    });
  }, [isSelected]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const jerseyLiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(selectionProgress.value, [0, 1], [0, -4]) }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: selectionProgress.value,
    transform: [{ scale: interpolate(selectionProgress.value, [0, 1], [0.8, 1]) }],
  }));

  const handlePress = useCallback(() => {
    if (isDisabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    scale.value = withSequence(
      withTiming(0.92, { duration: 90, easing: Easing.out(Easing.ease) }),
      withSpring(1.06, { damping: 12, stiffness: 260 }),
      withSpring(1, { damping: 14, stiffness: 220 })
    );
    onSelect();
  }, [isDisabled, onSelect, scale]);

  const shadowStyle = useMemo(() => ({
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 16,
  }), []);

  return (
    <Pressable onPress={handlePress} disabled={isDisabled}>
      <Animated.View style={[containerStyle, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ position: 'relative', alignItems: 'center' }}>
          <Animated.View style={[shadowStyle, jerseyLiftStyle]}>
            <JerseyIcon
              teamCode={team.abbreviation}
              teamName={team.name}
              primaryColor={teamColors.primary}
              secondaryColor={teamColors.secondary}
              size={72}
              sport={jerseyType}
            />
          </Animated.View>

          {/* "YOUR PICK" label — fades in smoothly */}
          <Animated.View style={[{
            marginTop: 2,
            backgroundColor: `${teamColors.primary}20`,
            paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6,
            borderWidth: 1, borderColor: `${teamColors.primary}40`,
          }, labelStyle]}>
            <Text style={{ fontSize: 8, fontWeight: '900', color: teamColors.primary, letterSpacing: 1.1 }}>{isDisabled ? 'YOUR PICK' : 'TAP TO REMOVE'}</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Pressable>
  );
});

interface GameTeam {
  id: string;
  name: string;
  abbreviation: string;
  city: string;
  record: string;
  color: string;
  logo?: string;
  rank?: number;
}

interface PredictionFactor {
  name: string;
  weight: number;
  homeScore: number;
  awayScore: number;
  description: string;
}

interface GamePrediction {
  id: string;
  gameId: string;
  canonicalResult?: CanonicalPredictionResult;
  predictedWinner: 'home' | 'away';
  predictedOutcome?: 'home' | 'away' | 'draw';
  confidence: number;
  analysis: string;
  predictedSpread: number;
  predictedTotal: number;
  marketFavorite: 'home' | 'away';
  spread: number;
  overUnder: number;
  createdAt: string;
  homeWinProbability: number;
  awayWinProbability: number;
  factors: PredictionFactor[];
  edgeRating: number;
  valueRating: number;
  recentFormHome: string;
  recentFormAway: string;
  homeStreak: number;
  awayStreak: number;
  isTossUp?: boolean;
  projection?: {
    engine: string;
    iterations: number;
    homeWinProbability: number;
    awayWinProbability: number;
    drawProbability?: number;
    projectedHomeScore: number;
    projectedAwayScore: number;
    projectedSpread: number;
    projectedTotal: number;
    volatility: number;
    upsetRisk: number;
    signals: {
      key: string;
      label: string;
      value: number;
      evidence: string;
    }[];
  };
}

interface Game {
  id: string;
  sport: 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'MLS' | 'NCAAF' | 'NCAAB' | 'EPL' | 'UCL' | 'IPL' | 'TENNIS';
  homeTeam: GameTeam;
  awayTeam: GameTeam;
  gameTime: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL' | 'POSTPONED' | 'CANCELLED';
  venue: string;
  tvChannel?: string;
  broadcasts?: unknown;
  watchSources?: unknown;
  tvChannels?: unknown;
  homeScore?: number;
  awayScore?: number;
  homeScoreDisplay?: string;
  awayScoreDisplay?: string;
  spread?: number;
  overUnder?: number;
  marketFavorite?: 'home' | 'away';
  quarter?: string;
  clock?: string;
  seasonContext?: {
    phase: string;
    label: string;
    detail: string;
    source: string;
  } | null;
  homeLinescores?: number[];
  awayLinescores?: number[];
  cricketState?: {
    home?: {
      runs?: number;
      wickets?: number;
      overs?: number;
      maxOvers?: number;
      isBatting?: boolean;
      scoreText: string;
      detailText?: string;
    };
    away?: {
      runs?: number;
      wickets?: number;
      overs?: number;
      maxOvers?: number;
      isBatting?: boolean;
      scoreText: string;
      detailText?: string;
    };
    battingSide?: 'home' | 'away';
    innings?: number | null;
    summary?: string;
    target?: number;
    currentBatters?: Array<{
      name: string;
      role: 'striker' | 'non-striker';
      runs?: number;
      balls?: number;
    }>;
    currentBowler?: {
      name: string;
      overs?: string;
      runsConceded?: number;
      wickets?: number;
    };
    overTrack?: Array<{
      over: number;
      runs: number;
      wickets: number;
      complete?: boolean;
    }>;
    currentOver?: {
      over: number;
      runs: number;
      wickets: number;
      complete?: boolean;
      balls: Array<{
        ball: number;
        label: string;
        runs: number;
        wicket?: boolean;
        extra?: 'wide' | 'noball' | 'bye' | 'legbye';
      }>;
    };
  };
  liveState?: {
    balls: number;
    strikes: number;
    outs: number;
    onFirst: boolean;
    onSecond: boolean;
    onThird: boolean;
    inningHalf: 'top' | 'bottom' | null;
    inningNumber: number | null;
    betweenInnings: boolean;
    inningTransition?: 'mid' | 'end' | null;
    pitcher: { name: string | null; teamAbbr: string } | null;
    batter: { name: string | null; teamAbbr: string } | null;
  };
  prediction?: GamePrediction;
}

const hexToRgba = (hex: string, alpha: number): string => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

function LivePulseDot() {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.6, { duration: 700, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 700, easing: Easing.in(Easing.ease) })
      ),
      -1
    );
  }, []);
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 2 - scale.value,
  }));
  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(255,59,48,0.3)' }, ringStyle]} />
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#FF3B30' }} />
    </View>
  );
}

// Sport → period column headers + regulation length. Linescores beyond
// regulation (extra innings, OT periods) extend the column count dynamically.
function getPeriodConfig(sport: Game['sport'], periodCount: number): { headers: string[]; totalLabel: string } {
  if (sport === 'MLB') {
    const reg = Math.max(9, periodCount);
    const headers = Array.from({ length: reg }, (_, i) => String(i + 1));
    return { headers, totalLabel: 'R' };
  }
  if (sport === 'IPL') {
    const reg = Math.max(2, periodCount);
    const headers = Array.from({ length: reg }, (_, i) => (i < 2 ? `IN${i + 1}` : `SO${i - 1}`));
    return { headers, totalLabel: 'R' };
  }
  if (sport === 'TENNIS') {
    const reg = Math.max(3, periodCount);
    const headers = Array.from({ length: reg }, (_, i) => `S${i + 1}`);
    return { headers, totalLabel: 'M' };
  }
  if (sport === 'NHL') {
    const reg = Math.max(3, periodCount);
    const headers: string[] = [];
    for (let i = 0; i < reg; i++) {
      headers.push(i < 3 ? String(i + 1) : i === 3 ? 'OT' : `OT${i - 2}`);
    }
    return { headers, totalLabel: 'T' };
  }
  if (sport === 'NCAAB' || sport === 'MLS' || sport === 'EPL' || sport === 'UCL') {
    const reg = Math.max(2, periodCount);
    const headers: string[] = [];
    for (let i = 0; i < reg; i++) {
      headers.push(i < 2 ? `${i + 1}H` : i === 2 ? 'OT' : `OT${i - 1}`);
    }
    return { headers, totalLabel: 'T' };
  }
  // NBA / NFL / NCAAF — quarters
  const reg = Math.max(4, periodCount);
  const headers: string[] = [];
  for (let i = 0; i < reg; i++) {
    headers.push(i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `OT${i - 3}`);
  }
  return { headers, totalLabel: 'T' };
}

function QuarterTable({ game }: { game: Game }) {
  const { homeTeam, awayTeam } = game;
  const homeLine = game.homeLinescores ?? [];
  const awayLine = game.awayLinescores ?? [];
  const periodCount = Math.max(homeLine.length, awayLine.length);
  const { headers, totalLabel } = getPeriodConfig(game.sport, periodCount);

  const homeColors = getTeamColors(homeTeam.abbreviation, game.sport as Sport, homeTeam.color);
  const awayColors = getTeamColors(awayTeam.abbreviation, game.sport as Sport, awayTeam.color);

  const homeWinning = (game.homeScore ?? 0) > (game.awayScore ?? 0);
  const awayWinning = (game.awayScore ?? 0) > (game.homeScore ?? 0);
  const tied = (game.homeScore ?? 0) === (game.awayScore ?? 0);

  const cellValue = (line: number[], i: number): string => {
    if (i >= line.length) return '';
    const v = line[i];
    return typeof v === 'number' ? String(v) : '';
  };

  return (
    <View style={styles.tableContainer}>
      {/* Header row with subtle background */}
      <View style={[styles.tableRow, { backgroundColor: 'rgba(255,255,255,0.03)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }]}>
        <View style={styles.tableTeamCell} />
        {headers.map((h, i) => (
          <View key={`${h}-${i}`} style={styles.tableScoreCell}>
            <Text style={styles.tableHeaderText}>{h}</Text>
          </View>
        ))}
        <View style={[styles.tableScoreCell, { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.06)' }]}>
          <Text style={[styles.tableHeaderText, { color: 'rgba(255,255,255,0.5)' }]}>{totalLabel}</Text>
        </View>
      </View>
      {[
        { team: homeTeam, total: teamScoreText(game, 'home'), accent: homeColors.accent, winning: homeWinning, line: homeLine },
        { team: awayTeam, total: teamScoreText(game, 'away'), accent: awayColors.accent, winning: awayWinning, line: awayLine },
      ].map(({ team, total, accent, winning, line }, ri) => (
        <View key={team.id} style={[styles.tableRow, ri === 0 && { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' }]}>
          <View style={styles.tableTeamCell}>
            <View style={{
              backgroundColor: accent,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 4,
              minWidth: 42,
              alignItems: 'center' as const,
              justifyContent: 'center' as const,
            }}>
              <Text style={{
                fontSize: 11,
                fontWeight: '800',
                color: '#FFFFFF',
                letterSpacing: 0.5,
              }}>
                {team.abbreviation}
              </Text>
            </View>
          </View>
          {headers.map((_, i) => (
            <View key={i} style={styles.tableScoreCell}>
              <Text style={styles.tableScoreText}>{cellValue(line, i)}</Text>
            </View>
          ))}
          <View style={[styles.tableScoreCell, { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.06)' }]}>
            <Text style={[styles.tableTotalText, winning && !tied && { color: accent }]}>{total}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function CricketHeroTeamStack({
  game,
  side,
  colors,
  jersey,
  showScore = true,
}: {
  game: Game;
  side: 'home' | 'away';
  colors: { primary: string; secondary: string; accent?: string };
  jersey: React.ReactNode;
  showScore?: boolean;
}) {
  const role = cricketRoleText(game, side);
  if (!role) return <>{jersey}</>;

  const batting = role === 'BATTING';
  const accent = colors.accent ?? colors.primary;
  const score = teamScoreText(game, side);
  const batters = [...(game.cricketState?.currentBatters ?? [])]
    .sort((a, b) => {
      if (a.role === b.role) return 0;
      return a.role === 'striker' ? -1 : 1;
    });
  const bowlerName = game.cricketState?.currentBowler?.name ?? '';

  return (
    <View style={styles.cricketHeroTeamColumn}>
      {showScore ? (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.74}
          style={[
            styles.cricketHeroScore,
            {
              color: batting ? accent : 'rgba(255,255,255,0.82)',
              opacity: batting ? 1 : 0.72,
            },
          ]}
        >
          {score}
        </Text>
      ) : null}
      {jersey}
      <View style={styles.cricketHeroPlayerBlock}>
        <Text style={[styles.cricketHeroRoleText, { color: batting ? accent : 'rgba(255,255,255,0.52)' }]}>
          {batting ? 'BATTING' : 'BOWLING'}
        </Text>
        {batting ? (
          <View style={styles.cricketHeroBatterStack}>
            {batters.length ? (
              batters.slice(0, 2).map((batter) => (
                <Text
                  key={`${batter.role}-${batter.name}`}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={[styles.cricketHeroPlayerName, batter.role === 'striker' && { color: '#FFFFFF' }]}
                >
                  {batter.name}{batter.role === 'striker' ? '*' : ''}
                </Text>
              ))
            ) : (
              <Text style={[styles.cricketHeroPlayerName, { color: 'rgba(255,255,255,0.48)' }]}>—</Text>
            )}
          </View>
        ) : (
          <Text
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={[styles.cricketHeroPlayerName, { color: batting ? '#FFFFFF' : 'rgba(255,255,255,0.74)' }]}
          >
            {bowlerName || '—'}
          </Text>
        )}
      </View>
    </View>
  );
}

function CricketCurrentOverPanel({
  game,
  homeColor,
  awayColor,
  context,
}: {
  game: Game;
  homeColor: string;
  awayColor: string;
  context: { label: string; value: string; detail: string } | null;
}) {
  const currentOver = game.cricketState?.currentOver;
  if (!currentOver && !context) return null;
  const battingColor = game.cricketState?.battingSide === 'away' ? awayColor : homeColor;
  const ballSlots = currentOver?.balls?.length ? currentOver.balls : [];

  return (
    <View style={styles.cricketLivePanel}>
      {context ? (
        <View style={[styles.cricketTargetBlock, !currentOver && styles.cricketTargetBlockWide]}>
          <Text style={styles.cricketTargetLabel}>{context.label}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={[styles.cricketTargetValue, { color: battingColor }]}>{context.value}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={styles.cricketTargetDetail}>
            {context.detail}
          </Text>
        </View>
      ) : null}
      {currentOver ? (
        <View style={[styles.cricketCurrentOverBlock, !context && { flex: 1 }]}>
          <View style={styles.cricketCurrentOverHeader}>
            <Text style={styles.cricketTrackLabel}>OVER {currentOver.over}</Text>
            <Text style={styles.cricketTrackKey}>
              {currentOver.runs} RUN{currentOver.runs === 1 ? '' : 'S'}{currentOver.wickets ? ` · ${currentOver.wickets} W` : ''}
            </Text>
          </View>
          <View style={styles.cricketBallRow}>
            {ballSlots.map((ball, index) => {
              const boundary = ball.label === '4' || ball.label === '6';
              const wicket = ball.wicket === true;
              const extra = Boolean(ball.extra);
              return (
                <View
                  key={`${ball.ball}-${index}-${ball.label}`}
                  style={[
                    styles.cricketBallChip,
                    {
                      borderColor: wicket ? '#FFFFFF' : boundary ? battingColor : 'rgba(255,255,255,0.14)',
                      backgroundColor: wicket ? '#FFFFFF' : boundary ? `${battingColor}33` : extra ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.24)',
                      shadowColor: wicket ? '#FFFFFF' : battingColor,
                    },
                  ]}
                >
                  <Text style={[styles.cricketBallText, { color: wicket ? battingColor : boundary ? '#FFFFFF' : 'rgba(255,255,255,0.82)' }]}>
                    {ball.label}
                  </Text>
                </View>
              );
            })}
            {Array.from({ length: Math.max(0, 6 - ballSlots.length) }).map((_, index) => (
              <View key={`empty-${index}`} style={styles.cricketBallEmpty} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ─── REDACTED PREDICTION — teaser for free users, reveals NOTHING ─────────
function RedactedPrediction({ homeTeam, awayTeam, prediction, onUnlock }: {
  homeTeam: GameTeam; awayTeam: GameTeam; prediction: GamePrediction; onUnlock: () => void;
}) {
  return (
    <Pressable onPress={onUnlock}>
      <View style={{
        borderRadius: 22,
        padding: 1.2,
        backgroundColor: 'rgba(122,157,184,0.18)',
        overflow: 'hidden',
      }}>
        <LinearGradient
          colors={['rgba(122,157,184,0.24)', 'rgba(224,234,240,0.10)', 'rgba(139,10,31,0.18)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 22 }]}
        />
        <View style={{
          backgroundColor: 'rgba(5,8,13,0.96)',
          borderRadius: 20,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(122,157,184,0.10)',
        }}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(122,157,184,0.15)', 'rgba(255,255,255,0.025)', 'rgba(139,10,31,0.08)', 'rgba(5,8,13,0.96)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 1 }}
          />
          <View style={{ padding: 16 }}>
            {/* Header — visible, but winner replaced with redacted bar */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <View>
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#7A9DB8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Clutch Pick</Text>
                {/* Redacted team name — blurry bar, not the actual name */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 140, height: 18, borderRadius: 6, backgroundColor: 'rgba(180,211,235,0.10)' }}>
                    <View style={{ position: 'absolute', inset: 0, borderRadius: 6, backgroundColor: 'rgba(180,211,235,0.05)', overflow: 'hidden' }}>
                      <View style={{ width: '70%', height: '100%', backgroundColor: 'rgba(180,211,235,0.04)' }} />
                    </View>
                  </View>
                  <View style={{ width: 60, height: 14, borderRadius: 4, backgroundColor: 'rgba(180,211,235,0.07)' }} />
                </View>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(139,10,31,0.14)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.30)' }}>
                <Text style={{ fontSize: 8, fontWeight: '900', color: 'rgba(255,255,255,0.82)', letterSpacing: 1.1 }}>PRO</Text>
              </View>
            </View>

            {/* Confidence bar — shows shape but hides the actual number */}
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(180,211,235,0.52)', letterSpacing: 0.8, textTransform: 'uppercase' }}>Pick Strength</Text>
                <View style={{ width: 32, height: 14, borderRadius: 4, backgroundColor: 'rgba(180,211,235,0.08)' }} />
              </View>
              <View style={{ flexDirection: 'row', gap: 2.5 }}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <View key={i} style={{ flex: 1, height: 5, borderRadius: 2.5, backgroundColor: i < 7 ? 'rgba(122,157,184,0.24)' : 'rgba(255,255,255,0.04)' }} />
                ))}
              </View>
            </View>

            {/* Analysis text — redacted shimmer lines, not real text */}
            <View style={{ marginBottom: 16, gap: 6 }}>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(180,211,235,0.08)', width: '95%' }} />
              <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(180,211,235,0.06)', width: '88%' }} />
              <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(180,211,235,0.045)', width: '72%' }} />
            </View>

            {/* Stat tile — visible label, redacted value */}
            <View style={{ marginBottom: 10 }}>
              <View style={[styles.statTile]}>
                <Text style={styles.statTileLabel}>Value Signal</Text>
                <View style={{ width: 52, height: 16, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 4 }} />
              </View>
            </View>
            {/* Unlock CTA inside the card */}
            <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(122,157,184,0.10)' }}>
              <LinearGradient colors={['rgba(122,157,184,0.20)', 'rgba(139,10,31,0.14)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 12, padding: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(5,8,13,0.78)' }}>
                  <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(122,157,184,0.10)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.22)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 8, fontWeight: '900', color: '#9AB8CC', letterSpacing: 0.5 }}>PRO</Text>
                  </View>
                  <View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>AI pick is ready</Text>
                  <Text style={{ fontSize: 11, color: 'rgba(180,211,235,0.46)' }}>Pick strength, analysis, and detailed breakdown</Text>
                  </View>
                </View>
              </LinearGradient>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── REDACTED SECTION — generic blurred section with visible header ───────
function RedactedSection({ title, height, onUnlock }: {
  title: string; height: number; onUnlock: () => void;
}) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>{title}</Text>
      <Pressable onPress={onUnlock}>
        <View style={{
          height,
          borderRadius: 18,
          backgroundColor: 'rgba(5,8,13,0.96)',
          borderWidth: 1,
          borderColor: 'rgba(122,157,184,0.14)',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(122,157,184,0.13)', 'rgba(255,255,255,0.025)', 'rgba(139,10,31,0.06)', 'rgba(5,8,13,0.95)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          {/* Simulated content shapes inside */}
          <View style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(180,211,235,0.06)' }} />
              <View style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(180,211,235,0.05)' }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(180,211,235,0.045)' }} />
              <View style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: 'rgba(180,211,235,0.04)' }} />
            </View>
            {height > 130 ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <View key={n} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(180,211,235,0.045)' }} />
                ))}
              </View>
            ) : null}
          </View>

          {/* Frosted overlay */}
          <View style={{
            ...StyleSheet.absoluteFillObject,
            backgroundColor: 'rgba(4,6,8,0.58)',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(122,157,184,0.11)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.28)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 9, fontWeight: '900', color: '#9AB8CC', letterSpacing: 0.5 }}>PRO</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>Pro view available</Text>
              <Text style={{ fontSize: 11, color: 'rgba(180,211,235,0.46)', marginTop: 2 }}>Tap to preview</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}


function WinProbBar({ prediction, homeTeam, awayTeam, sport }: { prediction: GamePrediction; homeTeam: GameTeam; awayTeam: GameTeam; sport: Sport }) {
  const canonicalProbabilities = getCanonicalWinProbabilities(prediction as Prediction);
  const dp = displayWinProbability(canonicalProbabilities.home, canonicalProbabilities.away);
  const hColor = getTeamColors(homeTeam.abbreviation, sport, homeTeam.color).accent;
  const aColor = getTeamColors(awayTeam.abbreviation, sport, awayTeam.color).accent;
  return (
    <View style={styles.winProbShell}>
      <LinearGradient
        colors={['rgba(122,157,184,0.20)', 'rgba(255,255,255,0.06)', 'rgba(139,10,31,0.16)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.winProbBorder}
      >
        <View style={styles.winProbCard}>
          <View style={styles.winProbHeader}>
            <Text style={[styles.winProbTeamLabel, { color: hColor }]} numberOfLines={1}>{homeTeam.abbreviation} {dp.home}%</Text>
            <Text style={styles.winProbTitle}>Win Probability</Text>
            <Text style={[styles.winProbTeamLabel, { color: aColor, textAlign: 'right' }]} numberOfLines={1}>{dp.away}% {awayTeam.abbreviation}</Text>
          </View>
          <View style={styles.winProbTrack}>
            <View style={[styles.winProbFill, { flex: dp.home, backgroundColor: hColor }]} />
            <View style={[styles.winProbFill, { flex: dp.away, backgroundColor: aColor }]} />
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

function ConfidenceBarSegment({ index, filled }: { index: number; filled: boolean; totalFilled: number }) {
  // Use rotation on a square gradient to create seamless infinite color cycling
  // Rotation never jumps because 0° and 360° look identical
  const rot = useSharedValue(0);
  useEffect(() => {
    if (!filled) return;
    rot.value = withRepeat(
      withTiming(360, { duration: 4000, easing: Easing.linear }),
      -1,
      false
    );
  }, [filled]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));

  if (!filled) {
    return <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 3, height: 6 }} />;
  }

  // A large square gradient rotates behind the tiny segment window
  // The gradient has maroon on one side, teal on the other
  // As it spins, the colors smoothly cycle through the visible area
  return (
    <View style={{ flex: 1, borderRadius: 3, overflow: 'hidden' as const, height: 6, alignItems: 'center' as const, justifyContent: 'center' as const }}>
      <Animated.View style={[spinStyle, { width: 60, height: 60, position: 'absolute' as const }]}>
        <LinearGradient
          colors={['#5A0614', '#8B0A1F', '#7A9DB8', '#5A7A8A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

function PredictionBlock({ prediction, homeTeam, awayTeam, sport, gameId, seasonContext }: { prediction: GamePrediction; homeTeam: GameTeam; awayTeam: GameTeam; sport: Game['sport']; gameId: string; seasonContext?: Game['seasonContext'] }) {
  const router = useRouter();
  const predictionDisplay = getPredictionDisplay({
    prediction: prediction as Prediction,
    homeTeam,
    awayTeam,
  });
  const winnerName = predictionDisplay.label;
  const displayAnalysis = displayPredictionAnalysis({
    sport,
    homeTeam,
    awayTeam,
    seasonContext,
    prediction: prediction as any,
  } as any);
  const SEGS = 10;
  const conf = getCanonicalConfidence(prediction as Prediction);
  const filledSegs = Math.round((conf / 100) * SEGS);

  // Tier mapping (canonical — single source of truth in display-confidence.ts)
  const tier = getConfidenceTier(conf, predictionDisplay.isTossUp);

  const valueLabel = prediction.valueRating >= 7 ? 'High Value' : prediction.valueRating >= 4 ? 'Fair Value' : 'Low Value';
  const valueColor = prediction.valueRating >= 7 ? '#7A9DB8' : prediction.valueRating >= 4 ? '#6B7C94' : 'rgba(255,255,255,0.3)';

  // Continuous rotation — animates from 0 to a huge number so it never resets/jumps
  const rotation = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  useEffect(() => {
    // Animate to a very large value so it spins continuously without resetting
    rotation.value = withTiming(360000, { duration: 360000 / 360 * 4500, easing: Easing.linear });
    glowPulse.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const rotatingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value % 360}deg` }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(glowPulse.value, [0, 1], [0.15, 0.4]),
    shadowRadius: interpolate(glowPulse.value, [0, 1], [8, 20]),
  }));

  const BORDER = 3.5;

  return (
    <Animated.View style={[glowStyle, {
      borderRadius: 22,
      shadowColor: '#7A9DB8',
      shadowOffset: { width: 0, height: 0 },
    }]}>
    <View style={{
      borderRadius: 22,
      overflow: 'hidden',
      position: 'relative' as const,
    }}>
      {/* ── BORDER LAYER ── */}
      {/* Static dim gradient base — visible where the beam isn't */}
      <LinearGradient
        colors={['rgba(139,10,31,0.25)', 'rgba(90,122,138,0.15)', 'rgba(139,10,31,0.25)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Rotating beam — oversized square that spins, clipped by card border radius */}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center' as const, justifyContent: 'center' as const }]} pointerEvents="none">
        <Animated.View
          style={[
            rotatingStyle,
            {
              width: 800,
              height: 800,
              position: 'absolute' as const,
            },
          ]}
        >
          {/* Top half: teal beam */}
          <LinearGradient
            colors={['transparent', 'transparent', '#7A9DB8', 'rgba(255,255,255,0.5)', '#7A9DB8', 'transparent', 'transparent']}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 0 }}
            style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 400 }}
          />
          {/* Bottom half: pure dark maroon beam — no white or teal */}
          <LinearGradient
            colors={['transparent', 'transparent', '#5A0614', '#8B0A1F', '#5A0614', 'transparent', 'transparent']}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 0 }}
            style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 400 }}
          />
        </Animated.View>
      </View>

      {/* ── INNER CARD — inset to reveal the thick border ── */}
      <View style={{
        margin: BORDER,
        backgroundColor: '#040608',
        borderRadius: 22 - BORDER,
        overflow: 'hidden',
        position: 'relative' as const,
        zIndex: 2,
      }}>
        {/* Inner glow — maroon top-left, teal top-right */}
        <View style={[StyleSheet.absoluteFill, { zIndex: 0 }]} pointerEvents="none">
          <LinearGradient
            colors={['rgba(139,10,31,0.08)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.5, y: 0.4 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(122,157,184,0.05)', 'transparent']}
            start={{ x: 1, y: 0 }}
            end={{ x: 0.5, y: 0.4 }}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Content */}
        <View style={{ padding: 22, paddingBottom: 20, position: 'relative' as const, zIndex: 1 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 16 }}>
            <View>
              <Text style={{ fontSize: 9, fontWeight: '700', color: '#8B0A1F', letterSpacing: 2, textTransform: 'uppercase' as const, marginBottom: 6 }}>
                CLUTCH PICK
              </Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 }}>
                {winnerName}
              </Text>
            </View>
            {null}
          </View>

          {/* Pick Strength */}
          <Pressable
            onPress={(e) => { e.stopPropagation(); router.push({ pathname: '/confidence-explained', params: { id: gameId } }); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            hitSlop={8}
            style={{ flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 8 }}
          >
            <Text style={{ fontSize: 9, fontWeight: '700', color: '#6B7C94', letterSpacing: 1.5, textTransform: 'uppercase' as const }}>
              PICK STRENGTH
            </Text>
            <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 }}>
              <View style={{ backgroundColor: `${tier.color}20`, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: `${tier.color}40` }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: tier.color, letterSpacing: 0.5 }}>{tier.label}</Text>
              </View>
              <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.2)' }}>›</Text>
            </View>
          </Pressable>

          {/* Confidence bar — animated segments with staggered shimmer */}
          <View style={{ flexDirection: 'row' as const, gap: 3, marginBottom: 18 }}>
            {Array.from({ length: SEGS }).map((_, i) => (
              <ConfidenceBarSegment key={i} index={i} filled={i < filledSegs} totalFilled={filledSegs} />
            ))}
          </View>

          {/* Analysis */}
          <Text style={{ fontSize: 12, color: '#A1B3C9', lineHeight: 20, marginBottom: 18 }}>
            {displayAnalysis}
          </Text>

          {/* Value Signal — full width */}
          <View style={{
            backgroundColor: 'rgba(255,255,255,0.02)',
            borderRadius: 12, padding: 14,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
          }}>
            <Text style={{ fontSize: 8, fontWeight: '700', color: '#6B7C94', letterSpacing: 1.2, textTransform: 'uppercase' as const, marginBottom: 6 }}>
              VALUE SIGNAL
            </Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: valueColor }}>
              {valueLabel}
            </Text>
            <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>Model vs. market line gap</Text>
          </View>

          {/* Vegas Market — populated only when backend has SHARPAPI_KEY. */}
          <VegasMarketBlock prediction={prediction} winnerName={predictionDisplay.team?.name ?? null} />
        </View>
      </View>
    </View>
    </Animated.View>
  );
}

function ProjectionTrackerRow({
  label,
  tone,
  expected,
  actual,
}: {
  label: string;
  tone: string;
  expected: number;
  actual?: number;
}) {
  const hasActual = typeof actual === 'number';
  const currentValue = actual ?? 0;
  const fillWidth = hasActual ? Math.min(100, Math.max(0, (currentValue / Math.max(expected, 1)) * 100)) : 0;
  const markerLeft = `${Math.min(94, Math.max(6, fillWidth))}%` as `${number}%`;
  const currentText = Number.isInteger(currentValue) ? `${currentValue}` : currentValue.toFixed(1);

  return (
    <View style={styles.projectionTrackerRow}>
      <View style={styles.projectionTrackerTop}>
        <View style={styles.projectionTrackerNameWrap}>
          <View style={[styles.projectionTrackerSwatch, { backgroundColor: tone }]} />
          <Text style={styles.projectionTrackerTeam}>{label}</Text>
        </View>
        <Text style={styles.projectionTrackerExpected}>Expected</Text>
      </View>
      <View style={styles.projectionTrackerLine}>
        <View style={styles.projectionTrackerRail}>
          <View style={[styles.projectionTrackerFill, { width: `${fillWidth}%` }]} />
          {hasActual ? (
            <View style={[styles.projectionTrackerLiveBadge, { left: markerLeft, borderColor: tone }]}>
              <Text style={[styles.projectionTrackerLiveText, { color: tone }]}>{currentText}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.projectionTrackerTarget}>
          <Text style={styles.projectionTrackerTargetValue} numberOfLines={1}>{expected.toFixed(1)}</Text>
        </View>
      </View>
    </View>
  );
}

function ProjectionEngineBlock({ game }: { game: Game }) {
  const { prediction, homeTeam, awayTeam, sport } = game;
  if (!prediction) return null;
  const projection = prediction.projection;
  if (!projection) return null;

  const homeColors = getTeamColors(homeTeam.abbreviation, sport as Sport, homeTeam.color);
  const awayColors = getTeamColors(awayTeam.abbreviation, sport as Sport, awayTeam.color);
  const isLive = game.status === 'LIVE';
  const hasActualTotals = game.status === 'LIVE' || game.status === 'FINAL';
  const liveHome = game.homeScore ?? 0;
  const liveAway = game.awayScore ?? 0;
  const liveTotal = liveHome + liveAway;
  const projectionRiskTier = getProjectionRiskTier(projection.upsetRisk);
  const projectionDisplay = getProjectionDisplay({
    sport,
    homeAbbr: homeTeam.abbreviation,
    awayAbbr: awayTeam.abbreviation,
    canonicalResult: getCanonicalResult(prediction as Prediction),
    predictedWinner: prediction.predictedWinner,
    predictedOutcome: prediction.predictedOutcome,
    confidence: getCanonicalConfidence(prediction as Prediction),
    isTossUp: getPredictionDisplay({ prediction: prediction as Prediction, homeTeam, awayTeam }).isTossUp,
    projection,
  });

  return (
    <View style={styles.projectionSectionShell}>
      <View style={styles.projectionSectionCard}>
        <View style={styles.projectionHeaderRow}>
          <Text style={styles.projectionEyebrow}>{isLive ? 'Live Projection' : 'Projection Board'}</Text>
        </View>

        <View style={styles.projectionTrackerStack}>
          <ProjectionTrackerRow
            label={homeTeam.abbreviation}
            tone={homeColors.accent}
            expected={projection.projectedHomeScore}
            actual={hasActualTotals ? liveHome : undefined}
          />
          <ProjectionTrackerRow
            label={awayTeam.abbreviation}
            tone={awayColors.accent}
            expected={projection.projectedAwayScore}
            actual={hasActualTotals ? liveAway : undefined}
          />
          <ProjectionTrackerRow
            label="Total"
            tone="#DAEEFB"
            expected={projection.projectedTotal}
            actual={hasActualTotals ? liveTotal : undefined}
          />
        </View>

        <View style={styles.projectionSummaryRow}>
          <Text numberOfLines={1} style={[styles.projectionSummaryText, styles.projectionSummaryLeft]}>Total {projectionDisplay.total}</Text>
          <Text numberOfLines={1} style={styles.projectionSummaryText}>Spread {projectionDisplay.spreadValue >= 0 ? '+' : ''}{projectionDisplay.spread}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={[styles.projectionSummaryText, styles.projectionSummaryRight]}>
            Upset Risk {projectionRiskTier}
          </Text>
        </View>
      </View>
    </View>
  );
}

// Renders the post-hoc SharpAPI market comparison. No-op when marketComparison
// is absent (feature-flag off). Never linked out to sportsbooks — purely
// informational, per Prompt B spec ("no betting affiliate flow").
function VegasMarketBlock({
  prediction,
  winnerName,
}: {
  prediction: Prediction;
  winnerName: string | null;
}) {
  const mc = prediction.marketComparison;
  if (!mc) return null;

  const modelPct = (mc.modelHomeProb * 100).toFixed(1);
  const marketPct = (mc.marketHomeProb * 100).toFixed(1);
  const divergencePct = (mc.divergence * 100).toFixed(1);
  const amber = '#F59E0B';

  const formatAmerican = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  return (
    <View style={{
      marginTop: 12,
      backgroundColor: 'rgba(255,255,255,0.02)',
      borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: mc.isDivergent ? `${amber}40` : 'rgba(255,255,255,0.12)',
    }}>
      <Text style={{ fontSize: 8, fontWeight: '700', color: '#6B7C94', letterSpacing: 1.2, textTransform: 'uppercase' as const, marginBottom: 8 }}>
        VEGAS MARKET
      </Text>

      {/* Side-by-side model vs market */}
      <View style={{ flexDirection: 'row' as const, gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: '700', letterSpacing: 0.8 }}>OUR MODEL</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 2 }}>{modelPct}%</Text>
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>home win</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: '700', letterSpacing: 0.8 }}>MARKET (PINNACLE)</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 2 }}>{marketPct}%</Text>
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>no-vig</Text>
        </View>
      </View>

      {mc.isDivergent ? (
        <View style={{
          marginTop: 10, padding: 8, borderRadius: 8,
          backgroundColor: `${amber}15`, borderWidth: 1, borderColor: `${amber}30`,
        }}>
          <Text style={{ fontSize: 11, color: amber, fontWeight: '700' }}>
            Our model disagrees with Vegas by {divergencePct}%
          </Text>
        </View>
      ) : null}

      {mc.bestBook && winnerName ? (
        <Text style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
          Best line on {winnerName}: {formatAmerican(mc.bestBook.american)} at {mc.bestBook.sportsbook}
        </Text>
      ) : null}
    </View>
  );
}

function RecentForm({ game }: { game: Game }) {
  const { homeTeam, awayTeam, prediction } = game;
  if (!prediction) return null;

  const homeColors = getTeamColors(homeTeam.abbreviation, game.sport as Sport, homeTeam.color);
  const awayColors = getTeamColors(awayTeam.abbreviation, game.sport as Sport, awayTeam.color);

  return (
    <View>
      <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Recent Performance</Text>
      <View style={{ gap: 10 }}>
        {[
          { team: homeTeam, form: prediction.recentFormHome, accent: homeColors.accent },
          { team: awayTeam, form: prediction.recentFormAway, accent: awayColors.accent },
        ].map(({ team, form, accent }) => (
          <View key={team.id} style={styles.formCard}>
            <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 10 }}>
              {/* Team color badge — same as box score */}
              <View style={{
                backgroundColor: accent,
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 4,
                minWidth: 42,
                alignItems: 'center' as const,
                justifyContent: 'center' as const,
              }}>
                <Text style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: '#FFFFFF',
                  letterSpacing: 0.5,
                }}>
                  {team.abbreviation}
                </Text>
              </View>
              <Text style={styles.formRecord}>{team.record}</Text>
            </View>
            {form.split('').filter((c: string) => c === 'W' || c === 'L' || c === 'D').length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }} scrollEventThrottle={16} removeClippedSubviews={true} decelerationRate="fast">
              {form.split('').filter((c: string) => c === 'W' || c === 'L' || c === 'D').slice(0, 10).map((r: string, i: number) => (
                <View key={i} style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  backgroundColor: r === 'W' ? 'rgba(122,157,184,0.15)' : r === 'D' ? 'rgba(255,255,255,0.08)' : 'rgba(239,68,68,0.10)',
                  borderWidth: 1,
                  borderColor: r === 'W' ? 'rgba(122,157,184,0.3)' : r === 'D' ? 'rgba(255,255,255,0.14)' : 'rgba(239,68,68,0.2)',
                  alignItems: 'center' as const,
                  justifyContent: 'center' as const,
                }}>
                  <Text style={{
                    color: r === 'W' ? '#7A9DB8' : r === 'D' ? 'rgba(255,255,255,0.55)' : '#EF4444',
                    fontSize: 10,
                    fontWeight: '800',
                  }}>{r}</Text>
                </View>
              ))}
            </ScrollView>
            ) : (
              <Text style={{ color: 'rgba(255,255,255,0.38)', fontSize: 11, fontWeight: '600' }}>Recent results are warming up for this team.</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const SilkThreads = React.memo(function SilkThreads() {
  // 5 threads, each with independent animation
  const threads = useMemo(() => [
    { top: '8%', rotate: '1.5deg', color: 'rgba(139,10,31,0.06)', duration: 18000, delay: 0 },
    { top: '22%', rotate: '-0.8deg', color: 'rgba(122,157,184,0.04)', duration: 22000, delay: 4000 },
    { top: '42%', rotate: '0.5deg', color: 'rgba(255,255,255,0.02)', duration: 25000, delay: 8000 },
    { top: '62%', rotate: '-1.2deg', color: 'rgba(139,10,31,0.04)', duration: 20000, delay: 12000 },
    { top: '78%', rotate: '0.8deg', color: 'rgba(122,157,184,0.03)', duration: 24000, delay: 6000 },
  ], []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {threads.map((t, i) => (
        <SilkThread key={i} {...t} />
      ))}
    </View>
  );
});

const SilkThread = React.memo(function SilkThread({
  top, rotate, color, duration, delay,
}: {
  top: string; rotate: string; color: string; duration: number; delay: number;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      translateX.value = withRepeat(
        withTiming(20, { duration, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      translateY.value = withRepeat(
        withTiming(25, { duration: duration * 1.2, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: duration * 0.15, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: duration * 0.7 }),
          withTiming(0, { duration: duration * 0.15, easing: Easing.in(Easing.ease) })
        ),
        -1,
        false
      );
    }, delay);
    return () => clearTimeout(timeout);
  }, [delay, duration, opacity, translateX, translateY]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        style,
        {
          position: 'absolute',
          top: top as any,
          left: '-50%',
          width: '200%',
          height: 1,
        },
      ]}
    >
      <LinearGradient
        colors={['transparent', color, color, 'transparent']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
});

// ── Pre-game scoreboard countdown ────────────────────────────────────────────
// Shows ONLY in the 10 minutes before tip-off. After 0:00 the countdown
// disappears and the normal SCHEDULED display takes over until the backend
// flips the game LIVE.
//
// Real delays are still handled correctly: when ESPN pushes a game back, our
// transformESPNEvent picks up the new event.date, the games detail endpoint
// serves it fresh on the next burst poll, useSecondsUntil re-syncs because
// its target useMemo depends on gameTime, and the countdown smoothly restarts
// from the new tip-off. We do NOT show an explicit "DELAYED" label because
// most "SCHEDULED but past start time" cases are stale upstream data, not
// actual delays — labeling all of them DELAYED would be misleading.
const COUNTDOWN_WINDOW_SEC = 60 * 60;

function useSecondsUntil(gameTime: string): number {
  const target = useMemo(() => {
    const t = new Date(gameTime).getTime();
    return Number.isNaN(t) ? null : t;
  }, [gameTime]);
  const getDisplaySeconds = useCallback(() => {
    if (target == null) return Number.POSITIVE_INFINITY;
    const next = Math.max(0, Math.floor((target - Date.now()) / 1000));
    return next > COUNTDOWN_WINDOW_SEC ? Number.POSITIVE_INFINITY : next;
  }, [target]);
  const [secondsLeft, setSecondsLeft] = useState(getDisplaySeconds);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const sync = () => {
      if (target == null) {
        setSecondsLeft(Number.POSITIVE_INFINITY);
        return;
      }

      const rawSeconds = Math.max(0, Math.floor((target - Date.now()) / 1000));
      if (rawSeconds > COUNTDOWN_WINDOW_SEC) {
        setSecondsLeft(Number.POSITIVE_INFINITY);
        const msUntilWindow = Math.max(1000, (rawSeconds - COUNTDOWN_WINDOW_SEC) * 1000);
        timeout = setTimeout(sync, Math.min(msUntilWindow, 60 * 60 * 1000));
        return;
      }

      setSecondsLeft(rawSeconds);
      interval = setInterval(() => {
        const next = Math.max(0, Math.floor((target - Date.now()) / 1000));
        setSecondsLeft(next > COUNTDOWN_WINDOW_SEC ? Number.POSITIVE_INFINITY : next);
        if (next <= 0 && interval) {
          clearInterval(interval);
          interval = null;
        }
      }, 1000);
    };

    sync();

    return () => {
      if (timeout) clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [target]);

  return secondsLeft;
}

// In-flow pre-game countdown. Renders inside the score-panel slot during the
// pre-game window; sport-aware label, VT323 pixel digits, ticking colon.
function PreGameCountdown({ secondsLeft, sport }: { secondsLeft: number; sport?: string | null }) {
  const colonOpacity = useSharedValue(1);
  useEffect(() => {
    colonOpacity.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 500 }),
        withTiming(1.0, { duration: 500 })
      ),
      -1,
      false
    );
  }, [colonOpacity]);
  const colonStyle = useAnimatedStyle(() => ({ opacity: colonOpacity.value }));

  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0 || secondsLeft > COUNTDOWN_WINDOW_SEC) return null;
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');

  const digitStyle = {
    fontSize: 64,
    color: '#FFFFFF',
    fontFamily: 'VT323_400Regular',
    letterSpacing: 4,
    lineHeight: 70,
    textShadowColor: 'rgba(255,255,255,0.25)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  } as const;

  return (
    <View style={{ alignItems: 'center', marginBottom: 12 }}>
      <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.45)', letterSpacing: 2.5, marginBottom: 4 }}>
        {getGameStartLabel(sport)}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={digitStyle}>{mm}</Text>
        <Animated.Text style={[digitStyle, colonStyle]}>:</Animated.Text>
        <Text style={digitStyle}>{ss}</Text>
      </View>
    </View>
  );
}

const DetailRefreshPill = React.memo(function DetailRefreshPill({ visible, top }: { visible: boolean; top: number }) {
  if (!visible) return null;
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOut.duration(140)}
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        alignSelf: 'center',
        zIndex: 60,
        borderRadius: 999,
        overflow: 'hidden',
        shadowColor: '#7A9DB8',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 18,
      }}
    >
      <LinearGradient
        colors={['rgba(139,10,31,0.50)', 'rgba(122,157,184,0.34)', 'rgba(4,7,12,0.96)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 999, padding: 1 }}
      >
        <View style={{ minHeight: 34, borderRadius: 999, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(4,7,12,0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#7A9DB8' }} />
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.2 }}>Updating game</Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
});

function GameDetailLoading() {
  return (
    <View style={{ flex: 1, backgroundColor: '#040608', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
      <LinearGradient
        colors={['rgba(139,10,31,0.26)', 'rgba(122,157,184,0.18)', 'rgba(255,255,255,0.04)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 24, padding: 1, width: '100%', maxWidth: 320 }}
      >
        <View style={{ minHeight: 158, borderRadius: 23, backgroundColor: 'rgba(4,7,12,0.96)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <ActivityIndicator color="#7A9DB8" />
          <Text style={{ marginTop: 16, color: '#FFFFFF', fontSize: 16, fontWeight: '900' }}>Loading matchup</Text>
          <Text style={{ marginTop: 5, color: 'rgba(180,211,235,0.56)', fontSize: 12, fontWeight: '800' }}>Getting the board ready</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPremium } = useSubscription();
  const [followed, setFollowed] = useState(false);
  const [deferredContentReady, setDeferredContentReady] = useState(false);

  useEffect(() => {
    setDeferredContentReady(false);
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) setDeferredContentReady(true);
    });
    const fallback = setTimeout(() => {
      if (!cancelled) setDeferredContentReady(true);
    }, 650);

    return () => {
      cancelled = true;
      task.cancel?.();
      clearTimeout(fallback);
    };
  }, [id]);

  // Load follow state from AsyncStorage on mount
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('clutch_followed_games');
        const list: string[] = raw ? JSON.parse(raw) : [];
        setFollowed(list.includes(id));
      } catch {}
    })();
  }, [id]);

  // Toggle follow with persistence
  const toggleFollow = useCallback(async () => {
    if (!id) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const raw = await AsyncStorage.getItem('clutch_followed_games');
      const list: string[] = raw ? JSON.parse(raw) : [];
      let updated: string[];
      if (list.includes(id)) {
        updated = list.filter(gId => gId !== id);
      } else {
        updated = [...list, id];
      }
      await AsyncStorage.setItem('clutch_followed_games', JSON.stringify(updated));
      setFollowed(updated.includes(id));
    } catch {}
  }, [id]);
  const [pendingPick, setPendingPick] = useState<'home' | 'away' | null>(null);
  const [pendingPickAction, setPendingPickAction] = useState<'pick' | 'remove'>('pick');
  const { data: userPick } = useGamePick(id ?? '');
  const makePick = useMakePick();
  const removePick = useRemovePick();
  const { data: game, dataUpdatedAt, isLoading, error, refetch } = useGame(id ?? '') as { data: Game | null | undefined; dataUpdatedAt: number; isLoading: boolean; error: any; refetch: () => Promise<unknown> };
  const { refreshing, onRefresh } = useSmoothRefresh(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    return refetch();
  }, { minVisibleMs: 320, maxVisibleMs: 850 });
  const hasGameData = !!game;

  useEffect(() => {
    if (!id || !hasGameData || !deferredContentReady) return;
    if (Date.now() - dataUpdatedAt < 8000) return;
    const timeout = setTimeout(() => {
      void refetch();
    }, 120);
    return () => clearTimeout(timeout);
  }, [dataUpdatedAt, deferredContentReady, hasGameData, id, refetch]);
  // Tick the pre-game countdown clock — called unconditionally to respect
  // the rules of hooks. Returns +Infinity until we have a valid gameTime
  // and 0 once tip-off has passed.
  const secondsUntilStart = useSecondsUntil(game?.gameTime ?? '');
  if (isLoading) return <GameDetailLoading />;
  if (error || !game) return (
    <View style={{ flex: 1, backgroundColor: '#040608', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center' }}>Unable to load game data.</Text>
      <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: '#7A9DB8', fontSize: 14, fontWeight: '700' }}>Go Back</Text></Pressable>
    </View>
  );
  const { homeTeam, awayTeam, prediction } = game;
  const predictionFactors = prediction?.factors ?? [];
  const isLive = game.status === 'LIVE';
  const suspended = isSuspendedGame(game);
  const suspensionTime = suspendedResumeText(game);
  const suspensionReason = suspendedReasonText(game);
  const cricketLiveStatus = cricketStatusText(game);
  const cricketOvers = !suspended ? cricketOversText(game) : null;
  const cricketRequired = !suspended ? cricketRequiredText(game) : null;
  const isLiveMLB = isLive && game.sport === 'MLB' && !!game.liveState;
  const isLiveCricket = isLive && game.sport === 'IPL';
  const cricketLedScore = !suspended && isLiveCricket ? cricketLedScoreText(game) : null;
  const cricketContext = !suspended && isLiveCricket ? cricketInningsContext(game) : null;
  const cricketClockText = cricketOvers;
  const gameStarted = game.status === 'LIVE' || game.status === 'FINAL';
  const openPickAction = useCallback((side: 'home' | 'away') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingPickAction(userPick?.pickedTeam === side ? 'remove' : 'pick');
    setPendingPick(side);
  }, [userPick?.pickedTeam]);
  // Pre-game countdown state — true while the game is SCHEDULED and tip-off
  // is within the COUNTDOWN_WINDOW_SEC window (1 hour). Drives both the LED
  // countdown visibility and the shrunk-score / dim-overlay treatment.
  const isCountingDown = game.status === 'SCHEDULED' && secondsUntilStart > 0 && secondsUntilStart <= COUNTDOWN_WINDOW_SEC;
  const jerseyType = sportEnumToJersey(game.sport);
  const homeColors = getTeamColors(homeTeam.abbreviation, game.sport as Sport, homeTeam.color);
  const awayColors = getTeamColors(awayTeam.abbreviation, game.sport as Sport, awayTeam.color);
  const homeAccent = homeColors.accent;
  const awayAccent = awayColors.accent;
  const scoreTextLength = `${game.homeScore ?? 0}-${game.awayScore ?? 0}`.length;
  const detailScoreboardScale = suspended ? 0.7 : isLiveCricket ? 1.22 : scoreTextLength >= 7 ? 1.18 : scoreTextLength >= 6 ? 1.3 : 1.45;
  const detailTopInset = Math.max(insets.top, 58);
  const detailHeaderTopSpacer = 12;
  return (
    <View style={{ flex: 1, backgroundColor: '#040608', overflow: 'hidden' }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#040608' }]} />
        <LinearGradient colors={[hexToRgba(homeAccent, 0.46), hexToRgba(homeAccent, 0.24), 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.6 }} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['transparent', hexToRgba(awayAccent, 0.22), hexToRgba(awayAccent, 0.42)]} start={{ x: 0.45, y: 0.4 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['transparent', '#040608']} start={{ x: 0, y: 0.5 }} end={{ x: 0, y: 1 }} style={[StyleSheet.absoluteFill, { top: '55%' }]} />
      </View>
      <DetailRefreshPill visible={refreshing && hasGameData} top={detailTopInset + 10} />
      {deferredContentReady ? <SilkThreads /> : null}
      <ScrollView style={{ flex: 1, marginTop: detailTopInset }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }} scrollEventThrottle={16} bounces={true} overScrollMode="never" decelerationRate="normal" refreshControl={<RefreshControl refreshing={refreshing && !hasGameData} onRefresh={onRefresh} tintColor="#7A9DB8" colors={['#7A9DB8']} progressBackgroundColor="#080C10" progressViewOffset={40} />}>
        <View style={{ overflow: 'visible', zIndex: 10 }}>
          <View style={{ height: detailHeaderTopSpacer }} />
          {/* Top bar — back (absolute left) + centered combined pill */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginBottom: 10, position: 'relative' }}>
            <Pressable onPress={() => router.back()} style={[styles.backBtn, { position: 'absolute', left: 16 }]}><Text style={{ fontSize: 20, color: '#fff', lineHeight: 22 }}>‹</Text></Pressable>
            {/* Combined pill: LIVE indicator (if live) | sport badge | follow toggle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 7 }}>
              {isLive ? (<><LivePulseDot /><Text style={{ fontSize: 11, fontWeight: '800', color: '#DC2626', letterSpacing: 0.5 }}>LIVE</Text><View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 2 }} /></>) : null}
              <View style={{ backgroundColor: 'rgba(122,157,184,0.2)', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(122,157,184,0.35)' }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>{displaySport(game.sport)}</Text>
              </View>
              <View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 2 }} />
              <Pressable
                onPress={toggleFollow}
                hitSlop={8}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ alignItems: 'center', marginRight: 6 }}>
                    <Text style={{ fontSize: 9, fontWeight: '800', color: followed ? '#7A9DB8' : '#FFFFFF', letterSpacing: 0.3, lineHeight: 10 }}>{followed ? 'FOLLOWING' : 'FOLLOW'}</Text>
                    <Text style={{ fontSize: 9, fontWeight: '800', color: followed ? '#7A9DB8' : '#FFFFFF', letterSpacing: 0.3, lineHeight: 10 }}>GAME</Text>
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: followed ? '#7A9DB8' : '#FFFFFF', lineHeight: 18 }}>{followed ? '✓' : '+'}</Text>
                </View>
              </Pressable>
            </View>
          </View>
          {/* Pre-game wrapper — when the game is in the 10-min countdown
              window OR delayed past tip-off, a subtle dim overlay covers the
              team headers + jersey/score area (but stops above the win-prob
              bar) to focus attention on the LED countdown. */}
          <View style={{ position: 'relative' }}>
          <View style={styles.teamNamesRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamName} numberOfLines={1}>{homeTeam.name}</Text>
              <Text style={styles.teamRecord}>{homeTeam.record}</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={[styles.teamName, { color: '#fff' }]} numberOfLines={1}>{awayTeam.name}</Text>
              <Text style={[styles.teamRecord, { color: '#ffffff' }]}>{awayTeam.record}</Text>
            </View>
          </View>
          <View style={{ position: 'relative' }}>

            {isLiveMLB && game.liveState ? (
              <MLBLiveCenterStack
                liveState={game.liveState}
                homeTeamAbbr={homeTeam.abbreviation}
                awayTeamAbbr={awayTeam.abbreviation}
                homeScore={game.homeScore ?? 0}
                awayScore={game.awayScore ?? 0}
                homeJersey={
                  <TappableJerseyHero
                    team={homeTeam}
                    isSelected={userPick?.pickedTeam === 'home'}
                    onSelect={() => {}}
                    isDisabled={true}
                    jerseyType={jerseyType}
                    sport={game.sport}
                  />
                }
                awayJersey={
                  <TappableJerseyHero
                    team={awayTeam}
                    isSelected={userPick?.pickedTeam === 'away'}
                    onSelect={() => {}}
                    isDisabled={true}
                    jerseyType={jerseyType}
                    sport={game.sport}
                  />
                }
              />
            ) : (
            <View style={[styles.jerseyRow, { zIndex: 1 }]}>
              {isLiveCricket ? (
                <CricketHeroTeamStack
                  game={game}
                  side="home"
                  colors={homeColors}
                  showScore={false}
                  jersey={
                    <TappableJerseyHero
                      team={homeTeam}
                      isSelected={userPick?.pickedTeam === 'home'}
                      onSelect={() => openPickAction('home')}
                      isDisabled={gameStarted}
                      jerseyType={jerseyType}
                      sport={game.sport}
                    />
                  }
                />
              ) : (
                <TappableJerseyHero
                  team={homeTeam}
                  isSelected={userPick?.pickedTeam === 'home'}
                  onSelect={() => openPickAction('home')}
                  isDisabled={gameStarted}
                  jerseyType={jerseyType}
                  sport={game.sport}
                />
              )}
              <View style={styles.scorePanelOuter}>
                <View style={[
                  styles.scorePanel,
                  (game.status === 'LIVE' || game.status === 'FINAL') ? styles.scorePanelBoard : null,
                ]}>
                  {isCountingDown ? (
                    <PreGameCountdown secondsLeft={secondsUntilStart} sport={game.sport} />
                  ) : (game.status === 'LIVE' || game.status === 'FINAL') ? (
                    <ArenaScoreboard
                      homeScore={game.homeScore ?? 0}
                      awayScore={game.awayScore ?? 0}
                      homeColor={homeAccent}
                      awayColor={awayAccent}
                      scale={detailScoreboardScale}
                      label={suspended ? 'SUSPENDED' : undefined}
                      displayText={cricketLedScore ?? undefined}
                      subLabel={suspended ? suspensionReason : undefined}
                      detailLabel={suspended ? suspensionTime : undefined}
                    />
                  ) : null}
                  {(() => {
                    const timeStr = isLive && !suspended
                      ? cricketClockText ?? cricketLiveStatus ?? formatGameTime(game.sport, game.quarter, game.clock)
                      : null;
                    if (timeStr) {
                      return (
                        <>
                          <Text style={styles.scoreClock}>{timeStr}</Text>
                          {cricketRequired ? (
                            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={styles.cricketRequiredLine}>
                              {cricketRequired}
                            </Text>
                          ) : null}
                        </>
                      );
                    }
                    // For non-live games, show the status (SCHEDULED / FINAL / etc.)
                    // and — for scheduled games — the actual tip-off time underneath.
                    if (game.status === 'SCHEDULED') {
                      const d = new Date(game.gameTime);
                      const now = new Date();
                      const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
                      const isToday = d.toDateString() === now.toDateString();
                      const isTomorrow = d.toDateString() === tomorrow.toDateString();
                      const dateLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                      const timeLabel = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                      return (
                        <>
                          <Text style={styles.scoreClock}>{game.status}</Text>
                          <Text style={styles.scoreClockSub}>{`${dateLabel} · ${timeLabel}`}</Text>
                        </>
                      );
                    }
                    return <Text style={styles.scoreClock}>{game.status}</Text>;
                  })()}
                </View>
              </View>
              {isLiveCricket ? (
                <CricketHeroTeamStack
                  game={game}
                  side="away"
                  colors={awayColors}
                  showScore={false}
                  jersey={
                    <TappableJerseyHero
                      team={awayTeam}
                      isSelected={userPick?.pickedTeam === 'away'}
                      onSelect={() => openPickAction('away')}
                      isDisabled={gameStarted}
                      jerseyType={jerseyType}
                      sport={game.sport}
                    />
                  }
                />
              ) : (
                <TappableJerseyHero
                  team={awayTeam}
                  isSelected={userPick?.pickedTeam === 'away'}
                  onSelect={() => openPickAction('away')}
                  isDisabled={gameStarted}
                  jerseyType={jerseyType}
                  sport={game.sport}
                />
              )}
            </View>
            )}
          </View>
          </View>
          {isLiveCricket && !suspended ? (
            <CricketCurrentOverPanel
              game={game}
              homeColor={homeAccent}
              awayColor={awayAccent}
              context={cricketContext}
            />
          ) : null}
          {prediction && isPremium ? <View style={{ paddingTop: 18 }}><WinProbBar prediction={prediction} homeTeam={homeTeam} awayTeam={awayTeam} sport={game.sport as Sport} /></View> : null}
          <WhereToWatchRow
            primaryChannel={game.tvChannel}
            watchSources={[game.watchSources, game.broadcasts, game.tvChannels]}
            venue={game.venue}
          />
        </View>
        <View style={styles.content}>
          {deferredContentReady ? (
            <View style={{ marginBottom: 40 }}>
              <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Box Score</Text>
              <QuarterTable game={game} />
            </View>
          ) : (
            <View style={styles.detailWarmup}>
              <ActivityIndicator color="#7A9DB8" />
            </View>
          )}
          {deferredContentReady && prediction && isPremium ? (
            <>
              {prediction.projection ? (
                <View style={{ marginBottom: 28 }}><Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Projection Center</Text><ProjectionEngineBlock game={game} /></View>
              ) : null}
              <View style={{ marginBottom: 40 }}><Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Our Prediction</Text><PredictionBlock prediction={prediction} homeTeam={homeTeam} awayTeam={awayTeam} sport={game.sport} gameId={game.id} seasonContext={game.seasonContext} /></View>
              <View style={{ marginBottom: 40 }}><RecentForm game={game} /></View>
              <Pressable onPress={() => router.push({ pathname: '/game-analysis', params: { id: game.id } })} style={styles.analysisLink}>
                <View style={styles.analysisLinkIcon}>
                  <AnalysisIcon size={20} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.analysisLinkTitle}>Why We Made This Pick</Text>
                  <Text style={styles.analysisLinkSub}>{predictionFactors.length} factors · {predictionFactors.filter(f => Math.abs(f.homeScore - f.awayScore) > 0.3).length} edges identified</Text>
                </View>
                <Text style={{ fontSize: 20, color: 'rgba(255,255,255,0.2)', fontWeight: '600' }}>›</Text>
              </Pressable>
            </>
          ) : deferredContentReady && prediction && !isPremium ? (
            <>
              {/* ═══ OUR PREDICTION ═══ */}
              <View style={{ marginBottom: 28 }}>
                <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Our Prediction</Text>
                <RedactedPrediction homeTeam={homeTeam} awayTeam={awayTeam} prediction={prediction} onUnlock={() => router.push('/paywall')} />
              </View>

              {/* ═══ RECENT PERFORMANCE ═══ */}
              <RedactedSection title="Recent Performance" height={160} onUnlock={() => router.push('/paywall')} />

              {/* ═══ WHY WE MADE THIS PICK ═══ */}
              <Pressable
                onPress={() => router.push('/paywall')}
                style={styles.analysisLink}
              >
                <View style={styles.analysisLinkIcon}>
                  <AnalysisIcon size={20} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.analysisLinkTitle}>Why We Made This Pick</Text>
                  <Text style={styles.analysisLinkSub}>{predictionFactors.length} factors · {predictionFactors.filter(f => Math.abs(f.homeScore - f.awayScore) > 0.3).length} edges identified</Text>
                </View>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(139,10,31,0.12)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.2)' }}>
                  <Text style={{ fontSize: 8, fontWeight: '800', color: '#8B0A1F', letterSpacing: 0.5 }}>PRO</Text>
                </View>
              </Pressable>
            </>
          ) : null}
          {deferredContentReady ? (
            <View style={{ marginTop: 16, marginBottom: 8, paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', textAlign: 'center', lineHeight: 15 }}>
                AI predictions are for entertainment purposes only. Not financial advice.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <PickConfirmationModal
        visible={pendingPick !== null}
        team={pendingPick === 'home' ? homeTeam : pendingPick === 'away' ? awayTeam : null}
        teamColor={pendingPick === 'home' ? homeTeam.color : awayTeam.color}
        sport={game.sport as Sport}
        action={pendingPickAction}
        isChanging={pendingPickAction === 'pick' && !!userPick && userPick.pickedTeam !== pendingPick}
        onConfirm={async () => {
          if (pendingPick && id) {
            try {
              if (pendingPickAction === 'remove') {
                await removePick.mutateAsync({ gameId: id });
              } else {
                await makePick.mutateAsync({
                  gameId: id,
                  pickedTeam: pendingPick,
                  homeTeam: game.homeTeam.abbreviation,
                  awayTeam: game.awayTeam.abbreviation,
                  sport: game.sport,
                });
              }
              return true;
            } catch {
              return false;
            }
          }
          return false;
        }}
        onCancel={() => {
          setPendingPick(null);
          setPendingPickAction('pick');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  liveText: { fontSize: 10, fontWeight: '800', color: '#FF3B30', letterSpacing: 0.8 },
  pillDivider: { width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.3)' },
  pillMeta: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.4 },
  followBtn: { height: 36, borderRadius: 10, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  followIcon: { fontSize: 13 },
  followText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  detailWarmup: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  teamNamesRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12, gap: 12 },
  teamName: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: -0.3, lineHeight: 22 },
  teamRecord: { fontSize: 12, color: '#ffffff', marginTop: 2 },
  jerseyRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16 },
  cricketHeroTeamColumn: { width: 106, alignItems: 'center' },
  cricketHeroScore: { fontSize: 30, lineHeight: 34, fontFamily: 'VT323_400Regular', letterSpacing: 1, marginBottom: 1 },
  cricketHeroPlayerBlock: { width: 112, minHeight: 43, marginTop: -2, alignItems: 'center', justifyContent: 'flex-start' },
  cricketHeroBatterStack: { width: '100%', marginTop: 2, gap: 1 },
  cricketHeroRoleText: { fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 1.1, textAlign: 'center' },
  cricketHeroPlayerName: { color: 'rgba(255,255,255,0.76)', fontSize: 10.5, lineHeight: 12.5, fontWeight: '800', textAlign: 'center' },
  cricketLivePanel: { marginHorizontal: 16, marginTop: 12, minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(2,3,5,0.32)', padding: 10, flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  cricketTargetBlock: { width: 86, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.34)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  cricketTargetBlockWide: { flex: 1, width: undefined },
  cricketTargetLabel: { color: 'rgba(255,255,255,0.46)', fontSize: 7, lineHeight: 9, fontWeight: '900', letterSpacing: 1.3 },
  cricketTargetValue: { fontSize: 24, lineHeight: 27, fontFamily: 'VT323_400Regular', letterSpacing: 1, marginTop: 1 },
  cricketTargetDetail: { color: 'rgba(255,255,255,0.68)', fontSize: 8, lineHeight: 10, fontWeight: '800', textAlign: 'center' },
  cricketCurrentOverBlock: { flex: 1, minWidth: 0, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.035)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center' },
  cricketCurrentOverHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  cricketTrackLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 8, fontWeight: '900', letterSpacing: 1.7 },
  cricketTrackKey: { color: 'rgba(255,255,255,0.36)', fontSize: 7, fontWeight: '900', letterSpacing: 1.3 },
  cricketBallRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cricketBallChip: { minWidth: 24, height: 24, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 7 },
  cricketBallEmpty: { width: 24, height: 24, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(255,255,255,0.025)' },
  cricketBallText: { fontSize: 9.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.2 },
  scoringWatermark: { position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -190 }, { translateY: -110 }], zIndex: 0, opacity: 0.5 },
  scorePanelOuter: { flex: 1, alignItems: 'center', paddingBottom: 8 },
  scorePanel: { paddingHorizontal: 22, paddingVertical: 14, alignItems: 'center', position: 'relative' },
  scorePanelBoard: { paddingHorizontal: 0, paddingVertical: 10 },
  scoreNumber: { fontSize: 72, fontFamily: 'VT323_400Regular', lineHeight: 78, letterSpacing: 2 },
  scoreNumberShrunk: { fontSize: 54, lineHeight: 60 },
  scoreSep: { fontSize: 28, color: 'rgba(255,255,255,0.25)', fontWeight: '300', lineHeight: 78 },
  scoreSepShrunk: { fontSize: 22, lineHeight: 60 },
  scoreClock: { fontSize: 22, color: '#FFFFFF', fontFamily: 'VT323_400Regular', marginTop: 6, letterSpacing: 2, textTransform: 'uppercase' },
  scoreClockSub: { fontSize: 16, color: 'rgba(255,255,255,0.55)', fontFamily: 'VT323_400Regular', marginTop: 2, letterSpacing: 1.5, textTransform: 'uppercase' },
  cricketRequiredLine: { maxWidth: 188, color: 'rgba(255,255,255,0.82)', fontSize: 10.5, lineHeight: 13, fontWeight: '900', letterSpacing: 0.4, marginTop: 2, textAlign: 'center', textTransform: 'uppercase' },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  winProbShell: {
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  winProbBorder: {
    borderRadius: 15,
    padding: 1,
  },
  winProbCard: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 11,
    backgroundColor: 'rgba(4,7,12,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.10)',
    overflow: 'hidden',
  },
  winProbHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 7,
  },
  winProbTeamLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  winProbTitle: {
    flexShrink: 0,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '900',
    color: 'rgba(224,234,240,0.62)',
    letterSpacing: 1.25,
    textTransform: 'uppercase',
  },
  winProbTrack: {
    height: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  winProbFill: {
    minWidth: 1,
  },
  projectionSectionShell: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#08090C',
    borderWidth: 1,
    borderColor: 'rgba(226,240,249,0.13)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.36,
    shadowRadius: 26,
    elevation: 7,
  },
  projectionSectionCard: {
    paddingHorizontal: 15,
    paddingTop: 14,
    paddingBottom: 13,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#08090C',
  },
  projectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  projectionEyebrow: {
    fontSize: 13,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.94)',
    letterSpacing: 0,
  },
  projectionTrackerStack: {
    paddingTop: 4,
    gap: 12,
  },
  projectionTrackerRow: {
    gap: 6,
  },
  projectionTrackerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  projectionTrackerNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
    flex: 1,
  },
  projectionTrackerSwatch: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  projectionTrackerTeam: {
    fontSize: 11.5,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.1,
    textTransform: 'uppercase',
  },
  projectionTrackerExpected: {
    fontSize: 8,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.34)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  projectionTrackerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  projectionTrackerRail: {
    flex: 1,
    minWidth: 0,
    height: 5,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.13)',
    overflow: 'visible',
  },
  projectionTrackerFill: {
    height: '100%',
    minWidth: 2,
    borderRadius: 3,
    backgroundColor: 'rgba(250,252,255,0.9)',
  },
  projectionTrackerLiveBadge: {
    position: 'absolute',
    top: -13,
    minWidth: 32,
    marginLeft: -16,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111318',
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  projectionTrackerLiveText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: -0.1,
  },
  projectionTrackerTarget: {
    width: 58,
    minWidth: 58,
    alignItems: 'flex-end',
  },
  projectionTrackerTargetValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.35,
    lineHeight: 19,
    includeFontPadding: false,
  },
  projectionSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 13,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  projectionSummaryText: {
    flex: 1,
    fontSize: 8,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.34)',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  projectionSummaryLeft: {
    textAlign: 'left',
  },
  projectionSummaryRight: {
    textAlign: 'right',
  },
  venueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  venueText: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '500' },
  watchStrip: {
    marginHorizontal: 18,
    marginTop: 8,
    marginBottom: 24,
    position: 'relative',
    zIndex: 40,
    elevation: 40,
  },
  watchHubBorder: {
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  watchHubCard: {
    minHeight: 66,
    borderRadius: 17,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.24)',
    backgroundColor: 'rgba(122,157,184,0.08)',
    overflow: 'hidden',
  },
  watchHubHeader: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
  },
  watchHubHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122,157,184,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.20)',
    marginRight: 12,
    flexShrink: 0,
  },
  watchHubHeaderCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  watchHubEyebrow: {
    fontSize: 7.5,
    lineHeight: 9,
    fontWeight: '900',
    color: 'rgba(180,211,235,0.62)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
    includeFontPadding: false,
  },
  watchHubTitle: {
    fontSize: 17,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '900',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  watchHubSourceMeta: {
    fontSize: 8,
    lineHeight: 10,
    color: 'rgba(226,240,249,0.32)',
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 3,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  watchHubSourcesPill: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(122,157,184,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.28)',
    marginLeft: 12,
    flexShrink: 0,
  },
  watchHubSourcesPillText: {
    color: 'rgba(218,238,251,0.76)',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 0.75,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  broadcastCardsRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  broadcastCardSlot: {
    minWidth: 0,
    height: 60,
  },
  broadcastInfoCard: {
    width: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(2,6,10,0.95)',
    borderWidth: 1.2,
    borderColor: 'rgba(148,163,184,0.18)',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.34,
    shadowRadius: 20,
    elevation: 9,
  },
  broadcastWatchCard: {
    borderColor: 'rgba(125,181,219,0.30)',
    backgroundColor: 'rgba(1,7,12,0.96)',
  },
  broadcastCardAccent: {
    position: 'absolute',
    left: 0,
    top: 12,
    bottom: 12,
    width: 3,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: 'rgba(122,157,184,0.78)',
  },
  broadcastCardIcon: {
    width: 34,
    height: 34,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.22)',
    marginRight: 8,
    flexShrink: 0,
  },
  broadcastCardCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  broadcastCardKicker: {
    fontSize: 6.5,
    fontWeight: '900',
    color: 'rgba(148,183,207,0.82)',
    letterSpacing: 0.95,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  broadcastCardTitle: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '900',
    letterSpacing: -0.18,
  },
  broadcastCardChevron: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.08)',
    marginLeft: 5,
    flexShrink: 0,
  },
  watchPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 56,
  },
  watchPillSlot: {
    flex: 1,
    minWidth: 0,
  },
  watchSourceWrap: {
    position: 'relative',
    zIndex: 50,
    elevation: 50,
  },
  gameInfoButton: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(1,4,8,0.94)',
    borderWidth: 1.25,
    borderColor: 'rgba(148,163,184,0.18)',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.36,
    shadowRadius: 18,
    elevation: 8,
  },
  gameInfoButtonEdge: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 2,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: 'rgba(122,157,184,0.72)',
  },
  gameInfoIcon: {
    width: 34,
    height: 34,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.22)',
    marginRight: 9,
    flexShrink: 0,
  },
  gameInfoCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  gameInfoLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: 'rgba(148,183,207,0.82)',
    letterSpacing: 1.25,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  gameInfoText: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.90)',
    fontWeight: '900',
    letterSpacing: -0.22,
  },
  infoPill: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 17,
    paddingHorizontal: 11,
    backgroundColor: 'rgba(1,4,8,0.92)',
    borderWidth: 1.25,
    borderColor: 'rgba(148,163,184,0.20)',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.38,
    shadowRadius: 18,
    elevation: 8,
  },
  watchInfoPill: {
    borderColor: 'rgba(125,181,219,0.28)',
  },
  watchButton: {
    borderColor: 'rgba(125,181,219,0.28)',
  },
  watchInfoPillOpen: {
    borderColor: 'rgba(125,211,252,0.44)',
    shadowColor: '#38BDF8',
    shadowOpacity: 0.2,
  },
  infoPillPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  infoPillSheen: {
    position: 'absolute',
    top: 0,
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: 'rgba(226,240,249,0.18)',
  },
  infoPillEdge: {
    position: 'absolute',
    left: 0,
    top: 9,
    bottom: 9,
    width: 2,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: 'rgba(122,157,184,0.72)',
  },
  infoIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.11)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.24)',
    flexShrink: 0,
    marginRight: 8,
  },
  infoIconBadgeSmall: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: 'rgba(148,163,184,0.08)',
    marginRight: 9,
  },
  infoPillCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  watchPillLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: 'rgba(148,183,207,0.82)',
    letterSpacing: 1.45,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  watchPillText: {
    fontSize: 13.5,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.94)',
    letterSpacing: -0.2,
  },
  watchChevronButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.08)',
    marginLeft: 5,
    flexShrink: 0,
  },
  watchChevronButtonOpen: {
    backgroundColor: 'rgba(56,189,248,0.14)',
  },
  watchVenuePill: {
    flex: 1,
    minWidth: 0,
    borderColor: 'rgba(148,163,184,0.16)',
  },
  watchVenueText: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.86)',
    fontWeight: '900',
    letterSpacing: -0.22,
  },
  watchMenuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
    paddingHorizontal: 16,
  },
  watchMenuSheet: {
    width: '100%',
    maxWidth: 390,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 22,
    maxHeight: '68%',
  },
  watchMenuHandle: {
    alignSelf: 'center',
    width: 34,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(226,240,249,0.20)',
    marginTop: 8,
    marginBottom: 0,
  },
  watchMenuHeader: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.10)',
  },
  watchMenuTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 8,
  },
  watchMenuHeroIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.16)',
    flexShrink: 0,
  },
  watchMenuTitleCopy: {
    flex: 1,
    minWidth: 0,
  },
  watchMenuEyebrow: {
    fontSize: 7,
    fontWeight: '900',
    color: 'rgba(148,183,207,0.78)',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  watchMenuTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 22,
    includeFontPadding: false,
  },
  watchMenuSubtitle: {
    fontSize: 10.5,
    fontWeight: '700',
    color: 'rgba(226,240,249,0.48)',
    marginTop: 3,
  },
  watchMenuClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.12)',
  },
  watchMenuCloseText: {
    fontSize: 28,
    lineHeight: 32,
    color: 'rgba(226,240,249,0.82)',
    fontWeight: '500',
  },
  watchMenuList: {
    maxHeight: 420,
  },
  watchMenuListContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 16,
  },
  watchMenuSection: {
    gap: 8,
  },
  watchMenuSectionHeader: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  watchMenuSectionTitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '900',
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  watchMenuSectionMeta: {
    flexShrink: 0,
    fontSize: 10,
    color: 'rgba(226,240,249,0.46)',
    fontWeight: '800',
  },
  watchMenuSectionCard: {
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.036)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
  },
  watchMenuOptionRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.10)',
  },
  watchMenuOptionRowLast: {
    borderBottomWidth: 0,
  },
  watchMenuPrimaryRow: {
    backgroundColor: 'rgba(122,157,184,0.10)',
  },
  watchMenuOptionPressed: {
    opacity: 0.78,
  },
  watchMenuOptionCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  watchMenuOptionText: {
    fontSize: 15.5,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: 0,
    lineHeight: 18,
    includeFontPadding: false,
  },
  watchMenuOptionSub: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(226,240,249,0.48)',
    letterSpacing: 0,
    marginTop: 5,
  },
  watchMenuSourceIcon: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.16)',
    marginRight: 11,
    flexShrink: 0,
  },
  watchMenuRankIcon: {
    backgroundColor: 'rgba(139,10,31,0.26)',
    borderColor: 'rgba(139,10,31,0.44)',
  },
  watchMenuRankText: {
    color: '#DAEEFB',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  watchMenuActionPill: {
    minWidth: 48,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 9,
    borderRadius: 14,
    backgroundColor: 'rgba(218,238,251,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.13)',
    marginLeft: 10,
    flexShrink: 0,
  },
  watchMenuActionPillPrimary: {
    backgroundColor: 'rgba(122,157,184,0.18)',
    borderColor: 'rgba(218,238,251,0.22)',
  },
  watchMenuActionText: {
    color: 'rgba(218,238,251,0.68)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.25,
  },
  watchMenuActionTextPrimary: {
    color: '#DAEEFB',
  },
  watchMenuVenueRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.024)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.10)',
  },
  watchMenuVenueLabel: {
    fontSize: 10,
    color: 'rgba(148,183,207,0.7)',
    fontWeight: '900',
    letterSpacing: 0.45,
    textTransform: 'uppercase',
  },
  watchMenuVenueText: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontSize: 12,
    color: 'rgba(255,255,255,0.78)',
    fontWeight: '800',
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  sectionMicroLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' },
  chartLegendText: { fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: '700' },
  chartContainer: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  tableContainer: { backgroundColor: 'rgba(255,255,255,0.025)', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  tableRow: { flexDirection: 'row', alignItems: 'center' },
  tableTeamCell: { width: 85, paddingVertical: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  tableTeamLogo: { width: 20, height: 20 },
  tableTeamAbbr: { fontSize: 13, fontWeight: '800' },
  tableScoreCell: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tableHeaderText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' },
  tableScoreText: { fontSize: 22, fontFamily: 'VT323_400Regular', color: 'rgba(255,255,255,0.5)', letterSpacing: 1 },
  tableTotalText: { fontSize: 28, fontFamily: 'VT323_400Regular', color: '#FFFFFF', letterSpacing: 1 },
  predictionContainer: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.06)' },
  predIconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: 'rgba(255,255,255,0.1)' },
  predLabel: { fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.2, textTransform: 'uppercase' },
  exclusiveBadge: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  exclusiveText: { fontSize: 7, fontWeight: '800', color: '#fff', letterSpacing: 0.6 },
  predPickText: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: -0.3 },
  statTile: { flex: 1, minWidth: '45%', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 9, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  statTileLabel: { fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.28)', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  statTileValue: { fontSize: 15, fontWeight: '900', letterSpacing: -0.3 },
  oddsRow: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 9, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  oddsRowLabel: { fontSize: 8, color: 'rgba(255,255,255,0.25)', fontWeight: '700', marginBottom: 2 },
  oddsRowValue: { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: -0.3 },
  oddsDelta: { fontSize: 9, fontWeight: '700' },
  formCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  formAbbr: { fontSize: 11, fontWeight: '800' },
  formRecord: { fontSize: 8, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' },
  formPip: { flex: 1, height: 20, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  formPipText: { fontSize: 8, fontWeight: '900' },
  analysisLink: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  analysisLinkIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(122,157,184,0.15)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  analysisLinkTitle: { fontSize: 14, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },
  analysisLinkSub: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 },
});
