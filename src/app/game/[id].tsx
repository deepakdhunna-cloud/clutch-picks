import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
  Modal,
  StyleSheet,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame } from '@/hooks/useGames';
import { useSmoothRefresh } from '@/hooks/useSmoothRefresh';
import { displayWinProbability, displaySport, formatGameTime, getConfidenceTier } from '@/lib/display-confidence';
import { SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS } from '@/lib/scroll-performance';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
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
  cancelAnimation,
} from 'react-native-reanimated';
import { haptics } from '@/lib/haptics';
import { PressableScale } from '@/components/shared/PressableScale';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { Sport, type CanonicalPredictionResult, type Prediction } from '@/types/sports';
import { useGamePick, useMakePick, useRemovePick } from '@/hooks/usePicks';
import { AnalysisIcon } from '@/components/icons/AnalysisIcon';
import { getTeamColors } from '@/lib/team-colors';
import { MLBLiveCenterStack } from '@/components/sports/MLBLiveState';
import { ArenaScoreboard } from '@/components/sports/ArenaScoreboard';
import { TennisHeroSetScores, TennisScoreGrid } from '@/components/sports/TennisScoreGrid';
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
  formatAnalysisLinkSubtitle,
  getDisplayProjection,
  getValueSignalDisplay,
  isStoredPregamePrediction,
} from '@/lib/stored-pregame-display';
import {
  cricketBattingSide,
  cricketInningsContext,
  cricketInningsRuns,
  cricketLedScoreText,
  cricketOversText,
  cricketRequiredText,
  cricketRoleText,
  cricketStatusText,
  teamScoreText,
} from '@/lib/cricket-score';
import { isLiveGameLike, isSuspendedGame, suspendedLabel, suspendedReasonText, suspendedResumeText } from '@/lib/game-status';
import { parseGameTime } from '@/lib/game-time';
import { getFeaturedWatchOption } from '@/lib/watch-options';
import { getWatchSourceAppUrl, getWatchSourceUrl } from '@/lib/watch-url';
import { readFollowedGameIds, toggleFollowedGame } from '@/lib/followed-games';
import { firstRouteParam } from '@/lib/route-params';
import { ExternalLink, Globe, Smartphone, Tv } from 'lucide-react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { guardedRouterBack, guardedRouterPush } from '@/lib/navigation-guard';

function openWatchInWeb(source: string) {
  void Linking.openURL(getWatchSourceUrl(source)).catch(() => undefined);
}

function openWatchInApp(source: string) {
  const appUrl = getWatchSourceAppUrl(source);
  if (!appUrl) {
    openWatchInWeb(source);
    return;
  }
  // Try the app scheme; if the app isn't installed Linking.openURL rejects
  // and we silently fall back to the web URL so the user always lands somewhere.
  void Linking.openURL(appUrl).catch(() => openWatchInWeb(source));
}

function WhereToWatchRow({
  primaryChannel,
  watchSources,
}: {
  primaryChannel?: string | null;
  watchSources?: unknown;
}) {
  const watchOption = useMemo(() => getFeaturedWatchOption(primaryChannel, watchSources), [primaryChannel, watchSources]);
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const hasWatchInfo = Boolean(watchOption);
  const primaryText = watchOption?.name ?? 'Watch info TBD';
  const sourceMetaText = watchOption?.note ?? 'Source not listed yet';
  const hasAppUrl = useMemo(() => Boolean(watchOption && getWatchSourceAppUrl(watchOption.name)), [watchOption]);

  const handleOpenPress = useCallback(() => {
    if (!watchOption) return;
    haptics.tap();
    // If we don't have an app deep link, skip the chooser and open the web URL directly.
    if (!hasAppUrl) {
      openWatchInWeb(watchOption.name);
      return;
    }
    setRoutePickerOpen(true);
  }, [hasAppUrl, watchOption]);

  const handleRouteApp = useCallback(() => {
    if (!watchOption) return;
    haptics.tap();
    setRoutePickerOpen(false);
    openWatchInApp(watchOption.name);
  }, [watchOption]);

  const handleRouteWeb = useCallback(() => {
    if (!watchOption) return;
    haptics.tap();
    setRoutePickerOpen(false);
    openWatchInWeb(watchOption.name);
  }, [watchOption]);

  return (
    <View style={styles.watchStrip}>
      <View style={styles.watchHubBorder}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasWatchInfo ? `Open ${primaryText}` : 'Watch source not listed'}
          accessibilityState={{ disabled: !watchOption }}
          disabled={!watchOption}
          onPress={handleOpenPress}
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
              <Text style={styles.watchHubSourcesPillText}>{hasWatchInfo ? 'Open' : 'TBD'}</Text>
              {hasWatchInfo ? <ExternalLink size={13} color="rgba(226,240,249,0.72)" strokeWidth={2.6} /> : null}
            </View>
          </View>
        </Pressable>
      </View>

      <Modal
        visible={routePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRoutePickerOpen(false)}
        statusBarTranslucent
      >
        <Pressable
          accessible={false}
          onPress={() => setRoutePickerOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}
        >
          <View
            accessibilityViewIsModal
            onStartShouldSetResponder={() => true}
            style={{
              backgroundColor: '#0B1119',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 14,
              paddingBottom: 38,
              borderTopWidth: 1,
              borderColor: 'rgba(218,238,251,0.16)',
            }}
          >
            <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(218,238,251,0.28)', alignSelf: 'center', marginBottom: 14 }} />
            <Text style={{ fontSize: 9, fontWeight: '900', color: 'rgba(180,211,235,0.62)', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 }}>Open {primaryText}</Text>
            <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '900', color: '#FFFFFF', marginBottom: 18 }}>How would you like to watch?</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${primaryText} in the app`}
              onPress={handleRouteApp}
              style={({ pressed }) => ({
                height: 72,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                borderRadius: 16,
                backgroundColor: '#DAEEFB',
                marginBottom: 12,
                opacity: pressed ? 0.86 : 1,
              })}
            >
              <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,17,25,0.14)', marginRight: 14 }}>
                <Smartphone size={18} color="#0B1119" strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '900', color: '#0B1119' }}>Open in App</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(11,17,25,0.62)', marginTop: 2 }}>Launches the native app if installed</Text>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${primaryText} in the browser`}
              onPress={handleRouteWeb}
              style={({ pressed }) => ({
                height: 72,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                borderRadius: 16,
                backgroundColor: '#1B2433',
                borderWidth: 1,
                borderColor: 'rgba(218,238,251,0.20)',
                marginBottom: 12,
                opacity: pressed ? 0.86 : 1,
              })}
            >
              <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(122,157,184,0.22)', marginRight: 14 }}>
                <Globe size={18} color="#DAEEFB" strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '900', color: '#FFFFFF' }}>Open in Browser</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(218,238,251,0.55)', marginTop: 2 }}>Opens the website in Safari</Text>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => setRoutePickerOpen(false)}
              style={({ pressed }) => ({ height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6, opacity: pressed ? 0.86 : 1 })}
            >
              <Text style={{ fontSize: 13, fontWeight: '800', color: 'rgba(218,238,251,0.62)' }}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
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
  showSelectionLabel = true,
  size = 72,
}: {
  team: GameTeam;
  isSelected: boolean;
  onSelect: () => void;
  isDisabled: boolean;
  jerseyType: ReturnType<typeof sportEnumToJersey>;
  sport: string;
  showSelectionLabel?: boolean;
  size?: number;
}) {
  const scale = useSharedValue(1);
  const selectionProgress = useSharedValue(isSelected ? 1 : 0);
  const teamColors = getTeamColors(team.abbreviation, sport as any, team.color);

  useEffect(() => {
    selectionProgress.value = withSpring(isSelected ? 1 : 0, {
      damping: 16,
      stiffness: 210,
    });
  }, [isSelected, selectionProgress]);

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
    // Haptic fires in the pick action handler (onSelect) to avoid a double tick.
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
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole={isDisabled ? 'image' : 'button'}
      accessibilityLabel={isDisabled ? `${team.name} jersey` : isSelected ? `Remove pick for ${team.name}` : `Pick ${team.name}`}
      accessibilityState={{ selected: isSelected, disabled: isDisabled }}
      accessibilityHint={isDisabled ? undefined : 'Opens pick confirmation'}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View style={[containerStyle, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ position: 'relative', alignItems: 'center' }}>
          <Animated.View style={[shadowStyle, jerseyLiftStyle]}>
            <JerseyIcon
              teamCode={team.abbreviation}
              teamName={team.name}
              primaryColor={teamColors.primary}
              secondaryColor={teamColors.secondary}
              size={size}
              sport={jerseyType}
            />
          </Animated.View>

          {showSelectionLabel ? (
            <Animated.View style={[{
              marginTop: 7,
              marginBottom: 5,
              minWidth: isDisabled ? 92 : 116,
              alignItems: 'center',
              backgroundColor: `${teamColors.primary}20`,
              paddingHorizontal: 13, paddingVertical: 4, borderRadius: 8,
              borderWidth: 1, borderColor: `${teamColors.primary}40`,
            }, labelStyle]}>
              <Text style={{ fontSize: 8, lineHeight: 10, fontWeight: '900', color: teamColors.primary, letterSpacing: 1.2 }}>{isDisabled ? 'YOUR PICK' : 'TAP TO REMOVE'}</Text>
            </Animated.View>
          ) : null}
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
  marketFavorite?: 'home' | 'away';
  spread?: number;
  overUnder?: number;
  createdAt: string;
  homeWinProbability: number;
  awayWinProbability: number;
  drawProbability?: number;
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
  sport: 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'MLS' | 'NCAAF' | 'NCAAB' | 'EPL' | 'UCL' | 'WORLDCUP' | 'IPL' | 'TENNIS';
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
  statusLabel?: string;
  statusDetail?: string;
  suspension?: {
    display: string;
    resumeText: string;
    reasonText: string;
    source?: string;
  };
  seasonContext?: {
    phase: string;
    label: string;
    detail: string;
    source: string;
  } | null;
  competitionLabel?: string;
  isWomens?: boolean;
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
    currentBatters?: {
      name: string;
      role: 'striker' | 'non-striker';
      runs?: number;
      balls?: number;
    }[];
    currentBowler?: {
      name: string;
      overs?: string;
      runsConceded?: number;
      wickets?: number;
    };
    overTrack?: {
      over: number;
      runs: number;
      wickets: number;
      complete?: boolean;
    }[];
    currentOver?: {
      over: number;
      runs: number;
      wickets: number;
      complete?: boolean;
      balls: {
        ball: number;
        label: string;
        runs: number;
        wicket?: boolean;
        extra?: 'wide' | 'noball' | 'bye' | 'legbye';
      }[];
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
    return () => cancelAnimation(scale);
  }, [scale]);
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
  if (sport === 'NCAAB' || sport === 'MLS' || sport === 'EPL' || sport === 'UCL' || sport === 'WORLDCUP') {
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
  const homeLine = game.sport === 'IPL' ? cricketInningsRuns(game, 'home') ?? game.homeLinescores ?? [] : game.homeLinescores ?? [];
  const awayLine = game.sport === 'IPL' ? cricketInningsRuns(game, 'away') ?? game.awayLinescores ?? [] : game.awayLinescores ?? [];
  const periodCount = Math.max(homeLine.length, awayLine.length);
  const { headers, totalLabel } = getPeriodConfig(game.sport, periodCount);

  const homeColors = getTeamColors(homeTeam.abbreviation, game.sport as Sport, homeTeam.color);
  const awayColors = getTeamColors(awayTeam.abbreviation, game.sport as Sport, awayTeam.color);

  if (game.sport === 'TENNIS') {
    return (
      <TennisScoreGrid
        game={game}
        variant="detail"
        homeColor={homeColors.accent}
        awayColor={awayColors.accent}
      />
    );
  }

  const homeWinning = (game.homeScore ?? 0) > (game.awayScore ?? 0);
  const awayWinning = (game.awayScore ?? 0) > (game.homeScore ?? 0);
  const tied = (game.homeScore ?? 0) === (game.awayScore ?? 0);

  const cellValue = (line: (number | null)[], i: number): string => {
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
  const battingColor = cricketBattingSide(game) === 'away' ? awayColor : homeColor;
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
    <Pressable
      onPress={onUnlock}
      accessibilityRole="button"
      accessibilityLabel={`Preview Pro pick for ${awayTeam.name} at ${homeTeam.name}`}
      accessibilityHint="Opens Clutch Picks Pro"
    >
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
      <Pressable
        onPress={onUnlock}
        accessibilityRole="button"
        accessibilityLabel={`Preview Pro: ${title}`}
        accessibilityHint="Opens Clutch Picks Pro"
      >
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
  const dp = displayWinProbability(canonicalProbabilities.home, canonicalProbabilities.away, canonicalProbabilities.draw);
  const hasDraw = typeof dp.draw === 'number';
  const drawColor = '#C9BDA8';
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
            <Text style={[styles.winProbTitle, hasDraw ? { color: drawColor } : null]}>{hasDraw ? `Draw ${dp.draw}%` : 'Win Probability'}</Text>
            <Text style={[styles.winProbTeamLabel, { color: aColor, textAlign: 'right' }]} numberOfLines={1}>{dp.away}% {awayTeam.abbreviation}</Text>
          </View>
          <View style={styles.winProbTrack}>
            <View style={[styles.winProbFill, { flex: dp.home, backgroundColor: hColor }]} />
            {hasDraw ? (
              <>
                <View style={{ width: 1, backgroundColor: 'rgba(4,7,12,0.9)' }} />
                <View style={[styles.winProbFill, { flex: dp.draw, backgroundColor: drawColor }]} />
                <View style={{ width: 1, backgroundColor: 'rgba(4,7,12,0.9)' }} />
              </>
            ) : null}
            <View style={[styles.winProbFill, { flex: dp.away, backgroundColor: aColor }]} />
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

function ConfidenceBarSegment({ filled }: { filled: boolean }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    if (!filled) {
      cancelAnimation(rot);
      rot.value = 0;
      return;
    }
    // Defer the spinning gradient until the entrance transition settles so the
    // many segment spinners don't compete with the screen slide-in.
    const interaction = InteractionManager.runAfterInteractions(() => {
      rot.value = withRepeat(
        withTiming(360, { duration: 4000, easing: Easing.linear }),
        -1,
        false
      );
    });
    return () => {
      interaction.cancel();
      cancelAnimation(rot);
    };
  }, [filled, rot]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));

  if (!filled) {
    return <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 3, height: 6 }} />;
  }

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
  const winProbabilities = getCanonicalWinProbabilities(prediction as Prediction);

  // Tier mapping (canonical — single source of truth in display-confidence.ts)
  const tier = getConfidenceTier(conf, predictionDisplay.isTossUp, predictionDisplay.marketType);

  const valueSignal = getValueSignalDisplay(prediction as Prediction);

  const rotation = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  useEffect(() => {
    // Defer these always-running decorative loops (a large rotating gradient +
    // glow pulse) until the push transition has settled, so they don't compete
    // with the entrance animation's frame budget. Visually identical — the loops
    // simply begin a beat after the screen finishes sliding in.
    const interaction = InteractionManager.runAfterInteractions(() => {
      rotation.value = withRepeat(
        withTiming(360, { duration: 4500, easing: Easing.linear }),
        -1,
        false
      );
      glowPulse.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    });
    return () => {
      interaction.cancel();
      cancelAnimation(rotation);
      cancelAnimation(glowPulse);
    };
  }, [glowPulse, rotation]);

  const rotatingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
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
          <LinearGradient
            colors={['transparent', 'transparent', '#7A9DB8', 'rgba(255,255,255,0.5)', '#7A9DB8', 'transparent', 'transparent']}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 0 }}
            style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 400 }}
          />
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
          </View>

          {/* Pick Strength */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Explain pick strength"
            accessibilityHint="Opens confidence explanation"
            onPress={(e) => {
              e.stopPropagation();
              guardedRouterPush(router, {
                pathname: '/confidence-explained',
                params: {
                  id: gameId,
                  confidence: String(Math.round(conf)),
                  pickLabel: winnerName,
                  homeAbbr: homeTeam.abbreviation,
                  awayAbbr: awayTeam.abbreviation,
                  homeProb: String(winProbabilities.home),
                  awayProb: String(winProbabilities.away),
                  ...(winProbabilities.draw !== undefined ? { drawProb: String(winProbabilities.draw) } : {}),
                  isTossUp: predictionDisplay.isTossUp ? '1' : '0',
                  marketType: predictionDisplay.marketType ?? 'moneyline',
                },
              });
              haptics.tap();
            }}
            hitSlop={8}
            style={{ minHeight: 44, flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 8 }}
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

          {/* Confidence bar */}
          <View style={{ flexDirection: 'row' as const, gap: 3, marginBottom: 18 }}>
            {Array.from({ length: SEGS }).map((_, i) => (
              <ConfidenceBarSegment key={i} filled={i < filledSegs} />
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
            <Text style={{ fontSize: 18, fontWeight: '800', color: valueSignal.color }}>
              {valueSignal.label}
            </Text>
            <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>{valueSignal.detail}</Text>
          </View>
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
  expectedText,
}: {
  label: string;
  tone: string;
  expected: number;
  actual?: number;
  expectedText?: string;
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
          <Text style={styles.projectionTrackerTeam} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
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
          <Text style={styles.projectionTrackerTargetValue} numberOfLines={1}>{expectedText ?? (Number.isInteger(expected) ? `${expected}` : expected.toFixed(1))}</Text>
        </View>
      </View>
    </View>
  );
}

function ProjectionEngineBlock({ game }: { game: Game }) {
  const { prediction, homeTeam, awayTeam, sport } = game;
  if (!prediction) return null;
  const projection = getDisplayProjection(game as any);
  if (!projection) return null;

  const homeColors = getTeamColors(homeTeam.abbreviation, sport as Sport, homeTeam.color);
  const awayColors = getTeamColors(awayTeam.abbreviation, sport as Sport, awayTeam.color);
  const isLive = isLiveGameLike(game);
  const hasActualTotals = isLive || game.status === 'FINAL';
  const liveHome = game.homeScore ?? 0;
  const liveAway = game.awayScore ?? 0;
  const liveTotal = liveHome + liveAway;
  const projectionRiskTier = getProjectionRiskTier(projection.upsetRisk);
  const projectionPredictionDisplay = getPredictionDisplay({ prediction: prediction as Prediction, homeTeam, awayTeam });
  const projectionDisplay = getProjectionDisplay({
    sport,
    homeAbbr: homeTeam.abbreviation,
    awayAbbr: awayTeam.abbreviation,
    canonicalResult: getCanonicalResult(prediction as Prediction),
    predictedWinner: prediction.predictedWinner,
    predictedOutcome: prediction.predictedOutcome,
    confidence: getCanonicalConfidence(prediction as Prediction),
    isTossUp: projectionPredictionDisplay.isTossUp,
    leanSide: projectionPredictionDisplay.outcome,
    projection,
  });
  const isTennisProjection = String(sport).toUpperCase() === 'TENNIS';

  return (
    <View style={styles.projectionSectionShell}>
      <View style={styles.projectionSectionCard}>
        <View style={styles.projectionHeaderRow}>
          <Text style={styles.projectionEyebrow}>{isStoredPregamePrediction(prediction as Prediction) ? 'Pregame Projection' : isLive ? 'Live Projection' : 'Projection Board'}</Text>
        </View>

        <View style={styles.projectionTrackerStack}>
          <ProjectionTrackerRow
            label={homeTeam.name}
            tone={homeColors.accent}
            expected={projection.projectedHomeScore}
            expectedText={isTennisProjection ? projectionDisplay.homeScore : undefined}
            actual={hasActualTotals ? liveHome : undefined}
          />
          <ProjectionTrackerRow
            label={awayTeam.name}
            tone={awayColors.accent}
            expected={projection.projectedAwayScore}
            expectedText={isTennisProjection ? projectionDisplay.awayScore : undefined}
            actual={hasActualTotals ? liveAway : undefined}
          />
          <ProjectionTrackerRow
            label="Total"
            tone="#DAEEFB"
            expected={projection.projectedTotal}
            expectedText={isTennisProjection ? String(Math.round(projection.projectedTotal)) : undefined}
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

function RecentForm({ game }: { game: Game }) {
  const { homeTeam, awayTeam, prediction } = game;
  if (!prediction) return null;

  const homeColors = getTeamColors(homeTeam.abbreviation, game.sport as Sport, homeTeam.color);
  const awayColors = getTeamColors(awayTeam.abbreviation, game.sport as Sport, awayTeam.color);
  const emptyFormText = isStoredPregamePrediction(prediction as Prediction)
    ? 'Pregame form detail is not available for this locked snapshot.'
    : 'Recent results are not available yet.';

  return (
    <View>
      <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Recent Performance</Text>
      <View style={{ gap: 10 }}>
        {[
          { team: homeTeam, form: prediction.recentFormHome, accent: homeColors.accent },
          { team: awayTeam, form: prediction.recentFormAway, accent: awayColors.accent },
        ].map(({ team, form, accent }) => {
          const formResults = (typeof form === 'string' ? form : '')
            .split('')
            .filter((c: string) => c === 'W' || c === 'L' || c === 'D');

          return (
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
              {formResults.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 5 }} scrollEventThrottle={16} removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS} decelerationRate="fast">
                {formResults.slice(0, 10).map((r: string, i: number) => (
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
                <Text style={{ color: 'rgba(255,255,255,0.38)', fontSize: 11, fontWeight: '600' }}>{emptyFormText}</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

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
    const parsed = parseGameTime(gameTime);
    return parsed ? parsed.getTime() : null;
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
    return () => cancelAnimation(colonOpacity);
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

function GameDetailContent() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const gameId = firstRouteParam(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPremium } = useSubscription();
  const [followed, setFollowed] = useState(false);
  const followInFlightRef = useRef(false);

  // Load follow state from AsyncStorage on mount
  useEffect(() => {
    if (!gameId) return;
    (async () => {
      try {
        const list = await readFollowedGameIds();
        setFollowed(list.includes(gameId));
      } catch {}
    })();
  }, [gameId]);

  // Toggle follow with persistence
  const toggleFollow = useCallback(async () => {
    if (!gameId || followInFlightRef.current) return;
    followInFlightRef.current = true;
    haptics.selection();
    try {
      const updated = await toggleFollowedGame(gameId);
      setFollowed(updated.includes(gameId));
    } catch {
    } finally {
      followInFlightRef.current = false;
    }
  }, [gameId]);
  const [pendingPick, setPendingPick] = useState<'home' | 'away' | null>(null);
  const [pendingPickAction, setPendingPickAction] = useState<'pick' | 'remove'>('pick');
  const { data: userPick } = useGamePick(gameId);
  const makePick = useMakePick();
  const removePick = useRemovePick();
  const { data: game, isLoading, error, refetch } = useGame(gameId) as { data: Game | null | undefined; isLoading: boolean; error: any; refetch: () => Promise<unknown> };
  const { refreshing, onRefresh } = useSmoothRefresh(() => {
    haptics.tap();
    return refetch();
  }, { minVisibleMs: 320, maxVisibleMs: 850 });
  const hasGameData = !!game;

  const openPickAction = useCallback((side: 'home' | 'away') => {
    haptics.selection();
    setPendingPickAction(userPick?.pickedTeam === side ? 'remove' : 'pick');
    setPendingPick(side);
  }, [userPick?.pickedTeam]);

  // Tick the pre-game countdown clock — called unconditionally to respect
  // the rules of hooks. Returns +Infinity until we have a valid gameTime
  // and 0 once tip-off has passed.
  const secondsUntilStart = useSecondsUntil(game?.gameTime ?? '');
  if (!gameId || (isLoading && !game)) return <GameDetailLoading />;
  if (error || !game) return (
    <View style={{ flex: 1, backgroundColor: '#040608', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Couldn't load this game</Text>
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: 20 }}>Check your connection and try again.</Text>
      <PressableScale
        onPress={() => { void refetch(); }}
        haptic="tap"
        style={{ backgroundColor: 'rgba(122,157,184,0.16)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.32)', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 11, minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: '#9BB8CF', fontSize: 14, fontWeight: '700' }}>Try again</Text>
      </PressableScale>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => guardedRouterBack(router)} style={{ marginTop: 14, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '600' }}>Go back</Text></Pressable>
    </View>
  );
  const { homeTeam, awayTeam, prediction } = game;
  const predictionContextSubtitle = formatAnalysisLinkSubtitle(prediction as Prediction | undefined);
  const isLive = isLiveGameLike(game);
  const suspended = isSuspendedGame(game);
  const suspensionStatus = suspendedLabel(game);
  const suspensionTime = suspendedResumeText(game);
  const suspensionReason = suspendedReasonText(game);
  const cricketLiveStatus = cricketStatusText(game);
  const cricketOvers = !suspended ? cricketOversText(game) : null;
  const cricketRequired = !suspended ? cricketRequiredText(game) : null;
  const isLiveMLB = isLive && game.sport === 'MLB' && !!game.liveState;
  const isLiveCricket = isLive && game.sport === 'IPL';
  const isTennis = game.sport === 'TENNIS';
  const cricketLedScore = !suspended && isLiveCricket ? cricketLedScoreText(game) : null;
  const cricketContext = !suspended && isLiveCricket ? cricketInningsContext(game) : null;
  const cricketClockText = cricketOvers;
  const gameStarted = isLive || game.status === 'FINAL';
  const hasLinescore = (game.homeLinescores?.length ?? 0) > 0 || (game.awayLinescores?.length ?? 0) > 0;
  const hasCricketLinescore =
    game.sport === 'IPL' &&
    ((cricketInningsRuns(game, 'home')?.length ?? 0) > 0 || (cricketInningsRuns(game, 'away')?.length ?? 0) > 0);
  const hasBoxScore = gameStarted || hasLinescore || hasCricketLinescore;
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
  const tennisHeroScoreboardScale = Math.min(detailScoreboardScale, 1.32);
  const detailTopInset = Math.max(insets.top, 58);
  const detailFloatingTop = insets.top + 12;
  const detailHeaderTopSpacer = 66;
  const showDetailRefreshPill = refreshing ? hasGameData : false;
  const showBlockingRefresh = refreshing ? !hasGameData : false;
  return (
    <View style={{ flex: 1, backgroundColor: '#040608', overflow: 'hidden' }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#040608' }]} />
        <LinearGradient colors={[hexToRgba(homeAccent, 0.46), hexToRgba(homeAccent, 0.24), 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.6 }} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['transparent', hexToRgba(awayAccent, 0.22), hexToRgba(awayAccent, 0.42)]} start={{ x: 0.45, y: 0.4 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['transparent', '#040608']} start={{ x: 0, y: 0.5 }} end={{ x: 0, y: 1 }} style={[StyleSheet.absoluteFill, { top: '55%' }]} />
      </View>
      <View pointerEvents="box-none" style={[styles.floatingDetailControls, { top: detailFloatingTop }]}>
        <Pressable
          onPress={() => {
            guardedRouterBack(router);
          }}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={[styles.backBtn, styles.floatingBackBtn]}
        >
          <BlurView pointerEvents="none" intensity={18} tint="dark" style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.58)' }]} />
          <Text style={{ fontSize: 22, color: '#fff', lineHeight: 24, includeFontPadding: false }}>‹</Text>
        </Pressable>
        <View style={styles.floatingDetailPill}>
          <BlurView pointerEvents="none" intensity={18} tint="dark" style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.58)' }]} />
          {isLive ? (
            <>
              <LivePulseDot />
              <Text style={{ fontSize: suspended ? 10 : 11, fontWeight: '800', color: '#DC2626', letterSpacing: 0.5 }}>
                {suspended ? suspensionStatus.toUpperCase() : 'LIVE'}
              </Text>
              <View style={styles.floatingDetailDivider} />
            </>
          ) : null}
          <View style={styles.floatingSportBadge}>
            <Text style={styles.floatingSportText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {displaySport(game.sport)}
            </Text>
          </View>
          {game.sport === 'IPL' && (game.competitionLabel || game.isWomens) ? (
            <>
              <View style={styles.floatingDetailDivider} />
              <View style={styles.floatingSportBadge}>
                <Text style={styles.floatingSportText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {game.isWomens
                    ? (game.competitionLabel && !/women/i.test(game.competitionLabel)
                        ? `Women's ${game.competitionLabel}`
                        : game.competitionLabel || "Women's")
                    : game.competitionLabel}
                </Text>
              </View>
            </>
          ) : null}
          <View style={styles.floatingDetailDivider} />
          <Pressable
            onPress={toggleFollow}
            accessibilityRole="button"
            accessibilityLabel={followed ? 'Unfollow game' : 'Follow game'}
            accessibilityState={{ selected: followed }}
            hitSlop={8}
            style={styles.floatingFollowButton}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ alignItems: 'center', marginRight: 6 }}>
                <Text style={[styles.floatingFollowText, followed ? styles.floatingFollowTextActive : null]}>{followed ? 'FOLLOWING' : 'FOLLOW'}</Text>
                <Text style={[styles.floatingFollowText, followed ? styles.floatingFollowTextActive : null]}>GAME</Text>
              </View>
              <Text style={[styles.floatingFollowIcon, followed ? styles.floatingFollowTextActive : null]}>{followed ? '✓' : '+'}</Text>
            </View>
          </Pressable>
        </View>
      </View>
      <DetailRefreshPill visible={showDetailRefreshPill} top={detailFloatingTop + 54} />
      <ScrollView style={{ flex: 1, marginTop: detailTopInset }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }} scrollEventThrottle={16} bounces={true} overScrollMode="never" decelerationRate="normal" refreshControl={<RefreshControl refreshing={showBlockingRefresh} onRefresh={onRefresh} tintColor="#7A9DB8" colors={['#7A9DB8']} progressBackgroundColor="#080C10" progressViewOffset={40} />}>
        <View style={{ overflow: 'visible', zIndex: 10 }}>
          <View style={{ height: detailHeaderTopSpacer }} />
          {/* Pre-game wrapper — when the game is in the 10-min countdown
              window OR delayed past tip-off, a subtle dim overlay covers the
              team headers + jersey/score area (but stops above the win-prob
              bar) to focus attention on the LED countdown. */}
          <View style={{ position: 'relative' }}>
          <View style={styles.teamNamesRow}>
            <View style={styles.teamNameCell}>
              <Text style={styles.teamName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.74}>{homeTeam.name}</Text>
              <Text style={styles.teamRecord}>{homeTeam.record}</Text>
            </View>
            <View style={[styles.teamNameCell, styles.teamNameCellAway]}>
              <Text style={[styles.teamName, { color: '#fff', textAlign: 'right' }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.74}>{awayTeam.name}</Text>
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
                homeIsSelected={userPick?.pickedTeam === 'home'}
                awayIsSelected={userPick?.pickedTeam === 'away'}
                homeJersey={
                  <TappableJerseyHero
                    team={homeTeam}
                    isSelected={userPick?.pickedTeam === 'home'}
                    onSelect={() => {}}
                    isDisabled={true}
                    showSelectionLabel={false}
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
                    showSelectionLabel={false}
                    jerseyType={jerseyType}
                    sport={game.sport}
                  />
                }
                statusLabel={suspended ? suspensionStatus : undefined}
                statusReason={suspended ? suspensionReason : undefined}
                statusDetail={suspended ? suspensionTime : undefined}
              />
            ) : isTennis && (isLive || game.status === 'FINAL') && !isCountingDown && !suspended ? (
              <View style={styles.tennisHeroRow}>
                <View style={styles.tennisHeroSide}>
                  <TappableJerseyHero
                    team={homeTeam}
                    isSelected={userPick?.pickedTeam === 'home'}
                    onSelect={() => openPickAction('home')}
                    isDisabled={gameStarted}
                    jerseyType={jerseyType}
                    sport={game.sport}
                    showSelectionLabel={false}
                    size={62}
                  />
                  <TennisHeroSetScores game={game} side="home" />
                </View>

                <View style={styles.tennisHeroCenter}>
                  <ArenaScoreboard
                    homeScore={game.homeScore ?? 0}
                    awayScore={game.awayScore ?? 0}
                    homeColor={homeAccent}
                    awayColor={awayAccent}
                    scale={tennisHeroScoreboardScale}
                  />
                  <Text style={[styles.scoreClock, styles.tennisHeroClock]}>
                    {isLive ? formatGameTime(game.sport, game.quarter, game.clock) : 'FINAL'}
                  </Text>
                </View>

                <View style={styles.tennisHeroSide}>
                  <TappableJerseyHero
                    team={awayTeam}
                    isSelected={userPick?.pickedTeam === 'away'}
                    onSelect={() => openPickAction('away')}
                    isDisabled={gameStarted}
                    jerseyType={jerseyType}
                    sport={game.sport}
                    showSelectionLabel={false}
                    size={62}
                  />
                  <TennisHeroSetScores game={game} side="away" />
                </View>
              </View>
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
                  (isLive || game.status === 'FINAL') ? styles.scorePanelBoard : null,
                ]}>
                  {isLive && !suspended && cricketRequired ? (
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={styles.cricketRequiredLineAbove}>
                      {cricketRequired}
                    </Text>
                  ) : null}
                  {isCountingDown ? (
                    <PreGameCountdown secondsLeft={secondsUntilStart} sport={game.sport} />
                  ) : (isLive || game.status === 'FINAL') ? (
                    <>
                      <ArenaScoreboard
                        homeScore={game.homeScore ?? 0}
                        awayScore={game.awayScore ?? 0}
                        homeColor={homeAccent}
                        awayColor={awayAccent}
                        scale={detailScoreboardScale}
                        label={suspended ? suspensionStatus : undefined}
                        displayText={cricketLedScore ?? undefined}
                        subLabel={suspended ? suspensionReason : undefined}
                        detailLabel={suspended ? suspensionTime : undefined}
                      />
                      {game.sport === 'TENNIS' && !suspended ? (
                        <TennisScoreGrid
                          game={game}
                          variant="compact"
                          homeColor={homeAccent}
                          awayColor={awayAccent}
                          showTeams={false}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {(() => {
                    const timeStr = isLive && !suspended
                      ? cricketClockText ?? cricketLiveStatus ?? formatGameTime(game.sport, game.quarter, game.clock)
                      : null;
                    if (timeStr) {
                      return (
                        <Text style={styles.scoreClock}>{timeStr}</Text>
                      );
                    }
                    // For non-live games, show the status (SCHEDULED / FINAL / etc.)
                    // and — for scheduled games — the actual tip-off time underneath.
                    if (game.status === 'SCHEDULED') {
                      const d = parseGameTime(game.gameTime);
                      if (!d) return null;
                      const now = new Date();
                      const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
                      const isToday = d.toDateString() === now.toDateString();
                      const isTomorrow = d.toDateString() === tomorrow.toDateString();
                      const dateLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                      const timeLabel = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                      return (
                        <View style={styles.scheduledHero}>
                          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.scheduledHeroStatus}>
                            Scheduled
                          </Text>
                          <View style={styles.scheduledHeroDivider} />
                          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} style={styles.scheduledHeroDate}>{dateLabel}</Text>
                          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} style={styles.scheduledHeroTime}>{timeLabel}</Text>
                        </View>
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
          />
        </View>
        <View style={styles.content}>
          {hasBoxScore ? (
            <View style={{ marginBottom: 40 }}>
              <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Box Score</Text>
              <QuarterTable game={game} />
            </View>
          ) : null}
          {prediction && isPremium ? (
            <>
              {getDisplayProjection(game as any) ? (
                <View style={{ marginBottom: 28 }}><Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Projection Center</Text><ProjectionEngineBlock game={game} /></View>
              ) : null}
              <View style={{ marginBottom: 40 }}><Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Our Prediction</Text><PredictionBlock prediction={prediction} homeTeam={homeTeam} awayTeam={awayTeam} sport={game.sport} gameId={game.id} seasonContext={game.seasonContext} /></View>
              <View style={{ marginBottom: 40 }}><RecentForm game={game} /></View>
              <PressableScale
                onPress={() => guardedRouterPush(router, { pathname: '/game-analysis', params: { id: game.id } })}
                accessibilityRole="button"
                accessibilityLabel="Open full pick analysis"
                style={styles.analysisLink}
              >
                <View style={styles.analysisLinkIcon}>
                  <AnalysisIcon size={20} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.analysisLinkTitle}>Why We Made This Pick</Text>
                  <Text style={styles.analysisLinkSub}>{predictionContextSubtitle}</Text>
                </View>
                <Text style={{ fontSize: 20, color: 'rgba(255,255,255,0.2)', fontWeight: '600' }}>›</Text>
              </PressableScale>
            </>
          ) : prediction && !isPremium ? (
            <>
              {/* ═══ OUR PREDICTION ═══ */}
              <View style={{ marginBottom: 28 }}>
                <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Our Prediction</Text>
                <RedactedPrediction homeTeam={homeTeam} awayTeam={awayTeam} prediction={prediction} onUnlock={() => guardedRouterPush(router, '/paywall')} />
              </View>

              {/* ═══ RECENT PERFORMANCE ═══ */}
              <RedactedSection title="Recent Performance" height={160} onUnlock={() => guardedRouterPush(router, '/paywall')} />

              {/* ═══ WHY WE MADE THIS PICK ═══ */}
              <PressableScale
                onPress={() => guardedRouterPush(router, '/paywall')}
                accessibilityRole="button"
                accessibilityLabel="Preview Pro: Why We Made This Pick"
                accessibilityHint="Opens Clutch Picks Pro"
                style={styles.analysisLink}
              >
                <View style={styles.analysisLinkIcon}>
                  <AnalysisIcon size={20} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.analysisLinkTitle}>Why We Made This Pick</Text>
                  <Text style={styles.analysisLinkSub}>{predictionContextSubtitle}</Text>
                </View>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(139,10,31,0.12)', borderWidth: 1, borderColor: 'rgba(139,10,31,0.2)' }}>
                  <Text style={{ fontSize: 8, fontWeight: '800', color: '#8B0A1F', letterSpacing: 0.5 }}>PRO</Text>
                </View>
              </PressableScale>
            </>
          ) : null}
          <View style={{ marginTop: 16, marginBottom: 8, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', textAlign: 'center', lineHeight: 15 }}>
              AI predictions are for entertainment purposes only. Not financial advice.
            </Text>
          </View>
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
          if (pendingPick && gameId) {
            try {
              if (pendingPickAction === 'remove') {
                await removePick.mutateAsync({ gameId });
              } else {
                await makePick.mutateAsync({
                  gameId,
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

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const gameId = firstRouteParam(id);
  const router = useRouter();
  if (!gameId) return <GameDetailLoading />;
  return (
    <ErrorBoundary key={gameId} onGoBack={() => guardedRouterBack(router)}>
      <GameDetailContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.68)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  floatingDetailControls: { position: 'absolute', left: 0, right: 0, zIndex: 110, elevation: 110, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  floatingBackBtn: { position: 'absolute', left: 16 },
  floatingDetailPill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.68)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 22, paddingHorizontal: 14, overflow: 'hidden' },
  floatingDetailDivider: { width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 2 },
  floatingSportBadge: { maxWidth: 88, backgroundColor: 'rgba(122,157,184,0.2)', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(122,157,184,0.35)' },
  floatingSportText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
  floatingFollowButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, marginRight: -4 },
  floatingFollowText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3, lineHeight: 10 },
  floatingFollowTextActive: { color: '#7A9DB8' },
  floatingFollowIcon: { fontSize: 16, fontWeight: '900', color: '#FFFFFF', lineHeight: 18 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  liveText: { fontSize: 10, fontWeight: '800', color: '#FF3B30', letterSpacing: 0.8 },
  pillDivider: { width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.3)' },
  pillMeta: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.4 },
  followBtn: { height: 36, borderRadius: 10, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  followIcon: { fontSize: 13 },
  followText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  detailWarmup: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  teamNamesRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 18, gap: 22 },
  teamNameCell: { flex: 1, minWidth: 0 },
  teamNameCellAway: { alignItems: 'flex-end' },
  teamName: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 0, lineHeight: 23 },
  teamRecord: { fontSize: 12, color: '#ffffff', marginTop: 3 },
  jerseyRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16 },
  tennisHeroRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 24, marginTop: 4, marginBottom: 20, zIndex: 1 },
  tennisHeroSide: { width: 80, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 9 },
  tennisHeroCenter: { width: 112, alignItems: 'center', justifyContent: 'flex-start' },
  cricketHeroTeamColumn: { width: 110, alignItems: 'center' },
  cricketHeroScore: { fontSize: 30, lineHeight: 34, fontFamily: 'VT323_400Regular', letterSpacing: 1, marginBottom: 1 },
  cricketHeroPlayerBlock: { width: 124, minHeight: 52, marginTop: 3, alignItems: 'center', justifyContent: 'flex-start' },
  cricketHeroBatterStack: { width: '100%', marginTop: 4, gap: 2 },
  cricketHeroRoleText: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 1.2, textAlign: 'center' },
  cricketHeroPlayerName: { color: 'rgba(255,255,255,0.76)', fontSize: 11, lineHeight: 15, fontWeight: '800', textAlign: 'center' },
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
  tennisHeroClock: { marginTop: 12, fontSize: 21, lineHeight: 24, textAlign: 'center' },
  scoreClockStatus: { minWidth: 116, fontSize: 20, color: '#FFFFFF', fontFamily: 'VT323_400Regular', marginTop: 6, letterSpacing: 1.2, textAlign: 'center', textTransform: 'uppercase' },
  scoreClockSub: { fontSize: 16, color: 'rgba(255,255,255,0.55)', fontFamily: 'VT323_400Regular', marginTop: 2, letterSpacing: 1.5, textTransform: 'uppercase' },
  scheduledHero: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 4, paddingHorizontal: 8 },
  scheduledHeroStatus: { fontSize: 22, lineHeight: 26, color: 'rgba(255,255,255,0.45)', fontFamily: 'VT323_400Regular', letterSpacing: 6, textAlign: 'center', textTransform: 'uppercase' },
  scheduledHeroDivider: { width: 48, height: 1, backgroundColor: 'rgba(255,255,255,0.18)', marginVertical: 6 },
  scheduledHeroDate: { fontSize: 32, lineHeight: 34, color: '#7A9DB8', fontFamily: 'VT323_400Regular', letterSpacing: 4, textAlign: 'center', textTransform: 'uppercase', marginBottom: 2 },
  scheduledHeroTime: { fontSize: 72, lineHeight: 74, color: '#FFFFFF', fontFamily: 'VT323_400Regular', letterSpacing: 3, textAlign: 'center', textTransform: 'uppercase' },
  cricketRequiredLine: { maxWidth: 188, color: 'rgba(255,255,255,0.82)', fontSize: 10.5, lineHeight: 13, fontWeight: '900', letterSpacing: 0.4, marginTop: 2, textAlign: 'center', textTransform: 'uppercase' },
  cricketRequiredLineAbove: { maxWidth: 220, color: '#FFFFFF', fontSize: 11.5, lineHeight: 14, fontWeight: '900', letterSpacing: 1.4, marginBottom: 10, textAlign: 'center', textTransform: 'uppercase' },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  winProbShell: {
    paddingHorizontal: 16,
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
    flexShrink: 1,
    minWidth: 0,
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
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 26,
    position: 'relative',
    zIndex: 40,
    elevation: 40,
  },
  watchHubBorder: {
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  watchHubCard: {
    height: 56,
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.24)',
    backgroundColor: 'rgba(122,157,184,0.08)',
    overflow: 'hidden',
  },
  watchHubHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  watchHubHeaderIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122,157,184,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.20)',
    marginRight: 10,
    flexShrink: 0,
  },
  watchHubHeaderCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  watchHubEyebrow: {
    fontSize: 7,
    lineHeight: 8,
    fontWeight: '900',
    color: 'rgba(180,211,235,0.62)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
    includeFontPadding: false,
  },
  watchHubTitle: {
    fontSize: 15,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '900',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  watchHubSourceMeta: {
    fontSize: 7.5,
    lineHeight: 9,
    color: 'rgba(226,240,249,0.32)',
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 3,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  watchHubSourcesPill: {
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(122,157,184,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.28)',
    marginLeft: 10,
    flexShrink: 0,
  },
  watchHubSourcesPillText: {
    color: 'rgba(218,238,251,0.76)',
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '900',
    letterSpacing: 0.75,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  watchRouteBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  watchRouteSheet: {
    backgroundColor: '#0B1119',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 38,
    borderTopWidth: 1,
    borderColor: 'rgba(218,238,251,0.16)',
  },
  watchRouteGrabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(218,238,251,0.28)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  watchRouteEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    color: 'rgba(180,211,235,0.62)',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  watchRouteTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  watchRouteOption: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: '#1B2433',
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.20)',
    marginBottom: 12,
  },
  watchRouteOptionPrimary: {
    backgroundColor: '#DAEEFB',
    borderColor: '#DAEEFB',
  },
  watchRouteOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122,157,184,0.22)',
    marginRight: 14,
  },
  watchRouteOptionIconPrimary: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,17,25,0.14)',
    marginRight: 14,
  },
  watchRouteOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  watchRouteOptionTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  watchRouteOptionTitlePrimary: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0B1119',
  },
  watchRouteOptionSub: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(218,238,251,0.55)',
    marginTop: 2,
  },
  watchRouteOptionSubPrimary: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(11,17,25,0.62)',
    marginTop: 2,
  },
  watchRouteCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 6,
  },
  watchRouteCancelText: {
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(218,238,251,0.62)',
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
