import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { GameWithPrediction, GameStatus, SPORT_META, Sport } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { displaySport, formatGameTime } from '@/lib/display-confidence';
import { isSuspendedGame, suspendedLabel, suspendedReasonText, suspendedResumeText } from '@/lib/game-status';
import { displayPredictionAnalysis } from '@/lib/narrative-display';
import { getProjectionDisplay, getProjectionRiskTier } from '@/lib/projection-display';
import {
  getCanonicalConfidence,
  getCanonicalResult,
  traceCanonicalUiConsumption,
} from '@/lib/canonical-result';
import { getGamePredictionDisplay } from '@/lib/prediction-display';
import { cricketRequiredText, cricketRoleText, cricketStatusText, scorePairText, teamScoreText } from '@/lib/cricket-score';
import { getFeaturedWatchOption } from '@/lib/watch-options';
import { getWatchSourceUrl } from '@/lib/watch-url';
import { claimGameNavigation } from '@/lib/game-navigation-guard';
import { PredictionBadge } from './PredictionBadge';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { Calendar, Clock, Tv, TrendingUp, ChevronRight, Lock } from 'lucide-react-native';
import { useMakePick, useRemovePick, useGamePick, useGamePickStats } from '@/hooks/usePicks';
import { useSubscription } from '@/lib/subscription-context';
import * as Haptics from 'expo-haptics';
import { usePrefetchGame } from '@/hooks/useGames';
import { PickConfirmationModal } from '@/components/sports/PickConfirmationModal';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';

interface GameCardProps {
  game: GameWithPrediction;
  index?: number;
}

// Compact Pulsing Live Badge component
const PulsingLiveBadge = memo(function PulsingLiveBadge({ label = 'LIVE' }: { label?: string }) {
  return (
    <View style={{ position: 'relative' }}>
      {/* Main badge - white with red dot and text */}
      <View style={styles.liveBadgeContainer}>
        {/* Live dot - red */}
        <View style={styles.liveDot} />
        <Text style={{ fontSize: 10, fontWeight: '700', color: '#DC2626' }}>{label}</Text>
      </View>
    </View>
  );
});

function formatScheduledTime(dateString: string): { date: string; time: string } {
  const date = new Date(dateString);
  const now = new Date();

  // Compare dates in local timezone by getting year/month/day
  const gameYear = date.getFullYear();
  const gameMonth = date.getMonth();
  const gameDay = date.getDate();

  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDay = now.getDate();

  const isToday = gameYear === todayYear && gameMonth === todayMonth && gameDay === todayDay;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = gameYear === tomorrow.getFullYear() && gameMonth === tomorrow.getMonth() && gameDay === tomorrow.getDate();

  let dateStr: string;
  if (isToday) {
    dateStr = 'Today';
  } else if (isTomorrow) {
    dateStr = 'Tomorrow';
  } else {
    dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return { date: dateStr, time: timeStr };
}

function getStatusBadge(status: GameStatus) {
  switch (status) {
    case GameStatus.LIVE:
      return { text: 'LIVE', colors: ['#FFFFFF', '#FFFFFF'] as const, textColor: 'text-red-600' };
    case GameStatus.FINAL:
      return { text: 'FINAL', colors: ['#3F3F46', '#27272A'] as const, textColor: 'text-zinc-300' };
    case GameStatus.POSTPONED:
      return { text: 'PPD', colors: ['#F59E0B', '#D97706'] as const, textColor: 'text-white' };
    case GameStatus.CANCELLED:
      return { text: 'CANC', colors: ['#3F3F46', '#27272A'] as const, textColor: 'text-zinc-500' };
    default:
      return null;
  }
}

// Handle TV channel press
function handleWatchSourcePress(channel: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  const url = getWatchSourceUrl(channel);
  Linking.openURL(url);
}

// Animated tappable jersey component with premium feel
const TappableJersey = memo(function TappableJersey({
  team,
  teamColors,
  sport,
  isSelected,
  onSelect,
  isDisabled,
  side: _side,
  isLoser,
  isWinner,
  size = 48,
}: {
  team: { abbreviation: string; name: string; record: string };
  teamColors: { primary: string; secondary: string };
  sport: Sport;
  isSelected: boolean;
  onSelect: () => void;
  isDisabled: boolean;
  side: 'away' | 'home';
  isLoser?: boolean;
  isWinner?: boolean;
  size?: number;
}) {
  const scale = useSharedValue(1);
  const selectionProgress = useSharedValue(isSelected ? 1 : 0);
  const {
    onTouchStart,
    onTouchMove,
    onTouchCancel,
    shouldHandlePress,
  } = useTapGestureGuard();

  useEffect(() => {
    selectionProgress.value = withTiming(isSelected && !isLoser && !isWinner ? 1 : 0, {
      duration: 300, easing: Easing.inOut(Easing.ease),
    });
  }, [isSelected, isLoser, isWinner]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const jerseyLiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(selectionProgress.value, [0, 1], [0, -3]) }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: selectionProgress.value,
    transform: [{ scale: interpolate(selectionProgress.value, [0, 1], [0.8, 1]) }],
  }));

  const handlePress = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    if (isDisabled || !shouldHandlePress()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    scale.value = withTiming(0.95, { duration: 150, easing: Easing.out(Easing.ease) }, () => {
      scale.value = withTiming(1, { duration: 200, easing: Easing.inOut(Easing.ease) });
    });
    onSelect();
  }, [isDisabled, onSelect, scale, shouldHandlePress]);

  const shadowStyle = useMemo(() => ({
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 12,
  }), []);

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      pressRetentionOffset={4}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
    >
      <Animated.View style={[containerStyle, styles.jerseyAnimatedContainer]}>
        <View style={{ position: 'relative', alignItems: 'center' }}>
          {/* Jersey — smoothly lifts when selected */}
          <Animated.View style={[shadowStyle, isLoser ? { opacity: 0.35 } : undefined, isWinner ? { shadowColor: '#22C55E', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 14 } : undefined, jerseyLiftStyle]}>
            <JerseyIcon
              teamCode={team.abbreviation}
              teamName={team.name}
              primaryColor={teamColors.primary}
              secondaryColor={teamColors.secondary}
              size={size}
              sport={sportEnumToJersey(sport)}
            />
          </Animated.View>

          {/* Grayscale overlay for loser */}
          {isLoser ? (
            <View pointerEvents="none" style={styles.loserOverlay} />
          ) : null}

          {/* "YOUR PICK" label — fades in smoothly */}
          <Animated.View style={[{
            marginTop: 2,
            backgroundColor: teamColors.primary,
            paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
          }, labelStyle]}>
            <Text style={{ fontSize: 6, fontWeight: '900', color: '#040608', letterSpacing: 0.8 }}>{isDisabled ? 'YOUR PICK' : 'REMOVE'}</Text>
          </Animated.View>

          {/* Winner badge */}
          {isWinner ? (
            <View style={styles.winnerBadge}>
              <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '900' }}>W</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Pressable>
  );
});

// Live game layout component - horizontal row layout matching CompactLiveCard
const LiveGameLayout = memo(function LiveGameLayout({
  game,
  awayTeamColors,
  homeTeamColors,
  sportMeta,
}: {
  game: GameWithPrediction;
  awayTeamColors: { primary: string; secondary: string; accent?: string };
  homeTeamColors: { primary: string; secondary: string; accent?: string };
  sportMeta: typeof SPORT_META[Sport];
}) {
  const router = useRouter();
  const prefetchGame = usePrefetchGame();
  const isNavigatingRef = useRef(false);

  const awayScore = game.awayScore ?? 0;
  const homeScore = game.homeScore ?? 0;
  const awayScoreLabel = teamScoreText(game, 'away');
  const homeScoreLabel = teamScoreText(game, 'home');
  const cricketStatus = cricketStatusText(game);
  const cricketRequired = cricketRequiredText(game);
  const isCricket = game.sport === Sport.IPL;
  const awayCricketRole = isCricket ? cricketRoleText(game, 'away') : null;
  const homeCricketRole = isCricket ? cricketRoleText(game, 'home') : null;
  const awayBatting = awayCricketRole === 'BATTING';
  const homeBatting = homeCricketRole === 'BATTING';
  const awayWinning = awayScore > homeScore;
  const homeWinning = homeScore > awayScore;
  const suspended = isSuspendedGame(game);
  const suspensionTime = suspendedResumeText(game);
  const suspensionReason = suspendedReasonText(game);
  const watchOption = useMemo(() => getFeaturedWatchOption(game.tvChannel, game.watchSources), [game.tvChannel, game.watchSources]);
  const awayAccent = awayTeamColors.accent ?? awayTeamColors.primary;
  const homeAccent = homeTeamColors.accent ?? homeTeamColors.primary;
  const {
    onTouchStart: onCardTouchStart,
    onTouchMove: onCardTouchMove,
    onTouchCancel: onCardTouchCancel,
    shouldHandlePress: shouldHandleCardPress,
  } = useTapGestureGuard();

  const warmGame = useCallback(() => {
    prefetchGame(game.id, game);
  }, [game, prefetchGame]);

  const handlePress = useCallback(() => {
    if (!shouldHandleCardPress()) return;
    if (isNavigatingRef.current) return;
    if (!claimGameNavigation(game.id)) return;
    isNavigatingRef.current = true;
    warmGame();
    router.push(`/game/${game.id}` as any);
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 700);
  }, [game.id, router, shouldHandleCardPress, warmGame]);

  return (
    <View style={{ position: 'relative', marginBottom: 16 }}>
      <Pressable
        onPress={handlePress}
        onPressIn={warmGame}
        className="active:opacity-85"
        pressRetentionOffset={6}
        onTouchStart={onCardTouchStart}
        onTouchMove={onCardTouchMove}
        onTouchCancel={onCardTouchCancel}
      >
        {/* Red glow for live */}
        <View style={{
          borderRadius: 22,
          shadowColor: '#DC2626',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.18,
          shadowRadius: 22,
          elevation: 6,
        }}>
        {/* Depth shadow */}
        <View style={{
          borderRadius: 22,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 16 },
          shadowOpacity: 0.95,
          shadowRadius: 32,
          elevation: 30,
        }}>
        {/* Glass border — dark reflective with team colors */}
        <View style={{ borderRadius: 22, padding: 3, overflow: 'hidden' }}>
          <LinearGradient
            colors={[
              `${awayAccent}90`,
              `${awayAccent}50`,
              '#0D1118',
              '#080C12',
              '#0D1118',
              `${homeAccent}50`,
              `${homeAccent}90`,
            ]}
            locations={[0, 0.15, 0.35, 0.5, 0.65, 0.85, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22 }}
          />
          {/* Inner bevel — specular highlight top, deep shadow bottom */}
          <View style={{ borderRadius: 19, padding: 1, overflow: 'hidden' }}>
            <LinearGradient
              colors={[
                `${awayAccent}60`,
                'rgba(255,255,255,0.12)',
                '#080C12',
                'rgba(0,0,0,0.6)',
                `${homeAccent}50`,
              ]}
              locations={[0, 0.2, 0.5, 0.8, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 19 }}
            />
          {/* Card body */}
          <View style={{ borderRadius: 18, overflow: 'hidden' }}>
          {/* Dark base */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,10,0.85)' }} />

          {/* Away team color bleed */}
          <LinearGradient
            colors={[`${awayAccent}CC`, `${awayAccent}66`, `${awayAccent}22`, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.7, y: 0.8 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />

          {/* Home team color bleed */}
          <LinearGradient
            colors={[`${homeAccent}CC`, `${homeAccent}66`, `${homeAccent}22`, 'transparent']}
            start={{ x: 1, y: 1 }}
            end={{ x: 0.3, y: 0.2 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />

          {/* Black center crush */}
          <LinearGradient
            colors={['transparent', 'rgba(2,3,8,0.75)', 'transparent']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />

          <View style={{ padding: 14, position: 'relative', zIndex: 10 }}>
            {/* Header: Sport badge + LIVE + TV */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={{
                    backgroundColor: 'rgba(122,157,184,0.15)',
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: 5,
                    marginRight: 6,
                    borderWidth: 1,
                    borderColor: 'rgba(122,157,184,0.3)',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '700' }}>
                    {displaySport(game.sport)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-start' }}>
                  <PulsingLiveBadge label={suspended ? suspendedLabel(game).toUpperCase() : 'LIVE'} />
                  {suspended ? (
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.72}
                      style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800', marginTop: 4, maxWidth: 150 }}
                    >
                      {suspensionReason}
                    </Text>
                  ) : null}
                </View>
              </View>

              {watchOption ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    handleWatchSourcePress(watchOption.name);
                  }}

                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'rgba(122,157,184,0.15)',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 7,
                    borderWidth: 1,
                    borderColor: 'rgba(122,157,184,0.3)',
                  }}
                >
                  <Tv size={10} color="#FFFFFF" />
                  <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginLeft: 4, maxWidth: 104 }}>
                    {watchOption.name}
                  </Text>
                </Pressable>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600' }}>IN PROGRESS</Text>
                </View>
              )}
            </View>

            {/* Away team row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <JerseyIcon
                teamCode={game.awayTeam.abbreviation}
                teamName={game.awayTeam.name}
                primaryColor={awayTeamColors.primary}
                secondaryColor={awayTeamColors.secondary}
                size={40}
                sport={sportEnumToJersey(game.sport)}
              />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text
                  style={{
                    color: isCricket
                      ? awayBatting ? '#FFFFFF' : 'rgba(255,255,255,0.66)'
                      : awayWinning ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
                    fontSize: 14,
                    fontWeight: awayWinning || awayBatting ? '800' : '500',
                    letterSpacing: 0.3,
                  }}
                  numberOfLines={1}
                >
                  {game.awayTeam.name}
                </Text>
                {game.awayTeam.record ? (
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, fontWeight: '500', marginTop: 1 }}>
                    {game.awayTeam.record}
                  </Text>
                ) : null}
                {awayCricketRole ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: awayBatting ? awayAccent : 'rgba(255,255,255,0.38)', marginRight: 4 }} />
                    <Text style={{ color: awayBatting ? '#FFFFFF' : 'rgba(255,255,255,0.46)', fontSize: 8, fontWeight: '900', letterSpacing: 1 }}>
                      {awayCricketRole}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={{
                color: isCricket
                  ? awayBatting ? '#FFFFFF' : 'rgba(255,255,255,0.74)'
                  : awayWinning ? '#FFFFFF' : 'rgba(255,255,255,0.25)',
                fontSize: 22,
                fontFamily: 'VT323_400Regular',
                letterSpacing: -0.5,
                minWidth: 30,
                textAlign: 'right',
                opacity: suspended ? 0.55 : isCricket ? awayBatting ? 1 : 0.72 : awayWinning ? 1 : 0.35,
              }}>
                {awayScoreLabel}
              </Text>
            </View>

            {/* Home team row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <JerseyIcon
                teamCode={game.homeTeam.abbreviation}
                teamName={game.homeTeam.name}
                primaryColor={homeTeamColors.primary}
                secondaryColor={homeTeamColors.secondary}
                size={40}
                sport={sportEnumToJersey(game.sport)}
              />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text
                  style={{
                    color: isCricket
                      ? homeBatting ? '#FFFFFF' : 'rgba(255,255,255,0.66)'
                      : homeWinning ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
                    fontSize: 14,
                    fontWeight: homeWinning || homeBatting ? '800' : '500',
                    letterSpacing: 0.3,
                  }}
                  numberOfLines={1}
                >
                  {game.homeTeam.name}
                </Text>
                {game.homeTeam.record ? (
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, fontWeight: '500', marginTop: 1 }}>
                    {game.homeTeam.record}
                  </Text>
                ) : null}
                {homeCricketRole ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: homeBatting ? homeAccent : 'rgba(255,255,255,0.38)', marginRight: 4 }} />
                    <Text style={{ color: homeBatting ? '#FFFFFF' : 'rgba(255,255,255,0.46)', fontSize: 8, fontWeight: '900', letterSpacing: 1 }}>
                      {homeCricketRole}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={{
                color: isCricket
                  ? homeBatting ? '#FFFFFF' : 'rgba(255,255,255,0.74)'
                  : '#FFFFFF',
                fontSize: 22,
                fontFamily: 'VT323_400Regular',
                letterSpacing: -0.5,
                minWidth: 30,
                textAlign: 'right',
                opacity: suspended ? 0.55 : isCricket ? homeBatting ? 1 : 0.72 : homeWinning ? 1 : 0.35,
              }}>
                {homeScoreLabel}
              </Text>
            </View>

            {/* Bottom bar */}
            <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {(() => {
                    const timeStr = suspended ? suspensionTime : cricketRequired ?? cricketStatus ?? formatGameTime(game.sport, game.quarter, game.clock);
                    if (timeStr) {
                      return (
                        <View style={{
                          backgroundColor: suspended ? 'rgba(220,38,38,0.13)' : 'rgba(255,255,255,0.12)',
                          paddingHorizontal: 8,
                          paddingVertical: suspended ? 4 : 3,
                          borderRadius: 5,
                          borderWidth: 1,
                          borderColor: suspended ? 'rgba(220,38,38,0.28)' : 'rgba(255,255,255,0.18)',
                        }}>
                          <Text numberOfLines={1} style={{ color: suspended ? '#DC2626' : '#FFFFFF', fontSize: 11, fontWeight: '700' }}>{timeStr}</Text>
                        </View>
                      );
                    }
                    return <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600' }}>IN PROGRESS</Text>;
                  })()}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '500', marginRight: 2 }}>Details</Text>
                  <ChevronRight size={10} color="#FFFFFF" />
                </View>
              </View>
            </View>
          </View>
        </View>
        </View>
        </View>
        </View>
        </View>
      </Pressable>
    </View>
  );
});

// Main GameCard component with performance optimizations
export const GameCard = memo(function GameCard({ game, index = 0 }: GameCardProps) {
  const router = useRouter();
  const prefetchGame = usePrefetchGame();
  const isNavigatingRef = useRef(false);
  const {
    onTouchStart: onCardTouchStart,
    onTouchMove: onCardTouchMove,
    onTouchCancel: onCardTouchCancel,
    shouldHandlePress: shouldHandleCardPress,
  } = useTapGestureGuard();
  const { isPremium } = useSubscription();
  const isLive = game.status === GameStatus.LIVE;

  // Memoize derived values
  const sportMeta = useMemo(() => SPORT_META[game.sport], [game.sport]);
  const { date, time } = useMemo(() => formatScheduledTime(game.gameTime), [game.gameTime]);
  const statusBadge = useMemo(() => getStatusBadge(game.status), [game.status]);
  const displayAnalysis = useMemo(() => displayPredictionAnalysis(game), [game]);
  const watchOption = useMemo(() => getFeaturedWatchOption(game.tvChannel, game.watchSources), [game.tvChannel, game.watchSources]);

  // Get team colors - memoized, pass ESPN color as fallback
  const awayTeamColors = useMemo(() => getTeamColors(game.awayTeam.abbreviation, game.sport, game.awayTeam.color), [game.awayTeam.abbreviation, game.sport, game.awayTeam.color]);
  const homeTeamColors = useMemo(() => getTeamColors(game.homeTeam.abbreviation, game.sport, game.homeTeam.color), [game.homeTeam.abbreviation, game.sport, game.homeTeam.color]);
  const awayAccent = awayTeamColors.accent;
  const homeAccent = homeTeamColors.accent;

  // Use backend hooks for picks
  const { mutateAsync: makePick } = useMakePick();
  const { mutateAsync: removePick } = useRemovePick();
  const { data: userPrediction } = useGamePick(game.id);
  const { data: pickStatsData } = useGamePickStats(game.id);

  // Calculate pick stats only from real backend data. Do not synthesize a
  // 50/50 split when the backend has not reported enough picks.
  const pickStats = useMemo(() => {
    const totalPicks = pickStatsData?.totalPicks ?? 0;
    const homePercentage = pickStatsData?.homePercentage;
    const awayPercentage = pickStatsData?.awayPercentage;
    if (
      totalPicks < 10 ||
      typeof homePercentage !== 'number' ||
      typeof awayPercentage !== 'number'
    ) {
      return null;
    }
    const homeWinChance = homePercentage;
    const awayWinChance = awayPercentage;
    return { homePercentage, awayPercentage, totalPicks, homeWinChance, awayWinChance };
  }, [pickStatsData]);

  // Check if game has already started (can't predict)
  const gameStarted = game.status === GameStatus.LIVE || game.status === GameStatus.FINAL;

  // Check if game is upcoming (for faded team colors)
  const isUpcoming = game.status === GameStatus.SCHEDULED;
  const isGameFinal = game.status === GameStatus.FINAL;

  // Determine winning/losing team for final games - memoized
  const { isAwayLoser, isHomeLoser, isAwayWinner, isHomeWinner } = useMemo(() => {
    const awayScore = game.awayScore ?? 0;
    const homeScore = game.homeScore ?? 0;
    return {
      isAwayLoser: isGameFinal && awayScore < homeScore,
      isHomeLoser: isGameFinal && homeScore < awayScore,
      isAwayWinner: isGameFinal && awayScore > homeScore,
      isHomeWinner: isGameFinal && homeScore > awayScore,
    };
  }, [game.awayScore, game.homeScore, isGameFinal]);

  const colorOpacities = useMemo(() => {
    const getTeamColorOpacity = (isLoser: boolean, isWinner: boolean) => {
      if (isUpcoming) return '88';
      if (isLoser) return '66';
      if (isWinner) return 'EE';
      return 'DD';
    };
    const getTeamColorOpacityLight = (isLoser: boolean, isWinner: boolean) => {
      if (isUpcoming) return '44';
      if (isLoser) return '33';
      if (isWinner) return 'AA';
      return '88';
    };
    const getTeamColorOpacityInner = (isLoser: boolean, isWinner: boolean) => {
      if (isUpcoming) return '99';
      if (isLoser) return '55';
      if (isWinner) return 'FF';
      return 'EE';
    };
    const getTeamColorOpacityInnerLight = (isLoser: boolean, isWinner: boolean) => {
      if (isUpcoming) return '55';
      if (isLoser) return '33';
      if (isWinner) return 'BB';
      return '99';
    };

    return {
      away: {
        opacity: getTeamColorOpacity(isAwayLoser, isAwayWinner),
        opacityLight: getTeamColorOpacityLight(isAwayLoser, isAwayWinner),
        opacityInner: getTeamColorOpacityInner(isAwayLoser, isAwayWinner),
        opacityInnerLight: getTeamColorOpacityInnerLight(isAwayLoser, isAwayWinner),
      },
      home: {
        opacity: getTeamColorOpacity(isHomeLoser, isHomeWinner),
        opacityLight: getTeamColorOpacityLight(isHomeLoser, isHomeWinner),
        opacityInner: getTeamColorOpacityInner(isHomeLoser, isHomeWinner),
        opacityInnerLight: getTeamColorOpacityInnerLight(isHomeLoser, isHomeWinner),
      },
      bg: {
        top: isUpcoming ? 0.40 : 0.45,
        mid: isUpcoming ? 0.25 : 0.32,
        bottom: isUpcoming ? 0.12 : 0.20,
      },
    };
  }, [isUpcoming, isAwayLoser, isAwayWinner, isHomeLoser, isHomeWinner]);

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<'home' | 'away' | null>(null);
  const [pendingAction, setPendingAction] = useState<'pick' | 'remove'>('pick');

  const warmGame = useCallback(() => {
    prefetchGame(game.id, game);
  }, [game, prefetchGame]);

  const handlePress = useCallback(() => {
    if (!shouldHandleCardPress()) return;
    if (isNavigatingRef.current) return;
    if (!claimGameNavigation(game.id)) return;
    isNavigatingRef.current = true;
    warmGame();
    router.push(`/game/${game.id}` as any);
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 700);
  }, [game.id, router, shouldHandleCardPress, warmGame]);

  const handleJerseyTap = useCallback((selectedTeam: 'home' | 'away') => {
    if (userPrediction?.pickedTeam === selectedTeam) {
      setPendingAction('remove');
      setPendingSelection(selectedTeam);
      setShowConfirmModal(true);
      return;
    }
    setPendingAction('pick');
    setPendingSelection(selectedTeam);
    setShowConfirmModal(true);
  }, [userPrediction?.pickedTeam]);

  const handleConfirmSelection = useCallback(async () => {
    if (!pendingSelection) return false;
    try {
      if (pendingAction === 'remove') {
        await removePick({ gameId: game.id });
        return true;
      }
      await makePick({
        gameId: game.id,
        pickedTeam: pendingSelection,
        homeTeam: game.homeTeam.abbreviation,
        awayTeam: game.awayTeam.abbreviation,
        sport: game.sport,
      });
      return true;
    } catch {
      return false;
    }
  }, [pendingAction, pendingSelection, game.id, game.homeTeam.abbreviation, game.awayTeam.abbreviation, game.sport, makePick, removePick]);

  const handleCancelSelection = useCallback(() => {
    setShowConfirmModal(false);
    setPendingSelection(null);
    setPendingAction('pick');
  }, []);

  // Memoized derived team values
  const canonicalResult = useMemo(() => getCanonicalResult(game.prediction), [game.prediction]);
  const canonicalConfidence = getCanonicalConfidence(game.prediction);
  const predictionDisplay = useMemo(() => getGamePredictionDisplay(game), [game]);
  const hasPrediction = Boolean(game.prediction);

  useEffect(() => {
    traceCanonicalUiConsumption('GameCard', game);
  }, [game]);

  const projectionDisplay = useMemo(() => {
    if (!game.prediction?.projection) return null;
    return getProjectionDisplay({
      sport: game.sport,
      homeAbbr: game.homeTeam.abbreviation,
      awayAbbr: game.awayTeam.abbreviation,
      canonicalResult,
      predictedWinner: game.prediction.predictedWinner,
      predictedOutcome: game.prediction.predictedOutcome,
      confidence: canonicalConfidence,
      isTossUp: predictionDisplay.isTossUp,
      projection: game.prediction.projection,
    });
  }, [game.sport, game.homeTeam.abbreviation, game.awayTeam.abbreviation, game.prediction, canonicalResult, canonicalConfidence, predictionDisplay.isTossUp]);
  const projectionRiskTier = useMemo(
    () => game.prediction?.projection ? getProjectionRiskTier(game.prediction.projection.upsetRisk) : null,
    [game.prediction?.projection]
  );

  // Get pending team for modal
  const pendingTeam = pendingSelection === 'home' ? game.homeTeam : pendingSelection === 'away' ? game.awayTeam : null;
  const pendingTeamColors = pendingSelection === 'home' ? homeTeamColors : awayTeamColors;

  // If LIVE, render the special live layout
  if (isLive) {
    return (
      <LiveGameLayout
        game={game}
        awayTeamColors={awayTeamColors}
        homeTeamColors={homeTeamColors}
        sportMeta={sportMeta}
      />
    );
  }

  return (
    <View style={{ position: 'relative', marginBottom: 20 }}>
      {/* Confirmation Modal */}
      {showConfirmModal === true && (
        <PickConfirmationModal
          visible={true}
          team={pendingTeam}
          teamColors={pendingTeamColors}
          sport={game.sport}
          action={pendingAction}
          isChanging={pendingAction === 'pick' && !!userPrediction && userPrediction.pickedTeam !== pendingSelection}
          onConfirm={handleConfirmSelection}
          onCancel={handleCancelSelection}
        />
      )}

      <Pressable
        onPress={handlePress}
        onPressIn={warmGame}
        style={{ flex: 1 }}
        pressRetentionOffset={6}
        onTouchStart={onCardTouchStart}
        onTouchMove={onCardTouchMove}
        onTouchCancel={onCardTouchCancel}
      >
      {/* Depth shadow */}
      <View style={styles.cardShadowContainer}>
      {/* Glass border — dark reflective with team colors */}
      <View style={{ borderRadius: 22, padding: 3, overflow: 'hidden' }}>
        <LinearGradient
          colors={[
            `${awayAccent}90`,
            `${awayAccent}50`,
            '#0D1118',
            '#080C12',
            '#0D1118',
            `${homeAccent}50`,
            `${homeAccent}90`,
          ]}
          locations={[0, 0.15, 0.35, 0.5, 0.65, 0.85, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22 }}
        />
        {/* Inner bevel — specular highlight on top edge, deep shadow on bottom */}
        <View style={{ borderRadius: 19, padding: 1, overflow: 'hidden' }}>
          <LinearGradient
            colors={[
              `${awayAccent}60`,
              'rgba(255,255,255,0.12)',
              '#080C12',
              'rgba(0,0,0,0.6)',
              `${homeAccent}50`,
            ]}
            locations={[0, 0.2, 0.5, 0.8, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 19 }}
          />
        {/* Card body */}
        <View style={{ position: 'relative', borderRadius: 18, overflow: 'hidden' }}>
          {/* Away team color - bottom left corner fading up */}
          <LinearGradient
            colors={[`${awayAccent}${colorOpacities.away.opacity}`, `${awayAccent}${colorOpacities.away.opacityLight}`, `${awayAccent}18`, 'transparent']}
            start={{ x: 0, y: 1 }}
            end={{ x: 0.6, y: 0 }}
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1,
            }}
          />
          {/* Home team color - bottom right corner fading up */}
          <LinearGradient
            colors={[`${homeAccent}${colorOpacities.home.opacity}`, `${homeAccent}${colorOpacities.home.opacityLight}`, `${homeAccent}18`, 'transparent']}
            start={{ x: 1, y: 1 }}
            end={{ x: 0.4, y: 0 }}
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1,
            }}
          />

          <View style={styles.cardOverflowContainer}>
            {/* Deep dark glass base - no frost */}
            <View pointerEvents="box-none" style={{ flex: 1, backgroundColor: 'rgba(8,8,12,0.95)' }}>

            {/* Content with elevated z-index */}
            <View style={styles.cardContentPadding}>

          {/* Header: Sport badge, FAV badge, and status */}
          <View className="flex-row items-center justify-between mb-3" style={{ position: 'relative', zIndex: 2 }}>
            <View className="flex-row items-center">
              <View
                style={{
                  backgroundColor: 'rgba(122,157,184,0.15)',
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  marginRight: 6,
                  borderWidth: 1,
                  borderColor: 'rgba(122,157,184,0.3)',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>
                  {displaySport(game.sport)}
                </Text>
              </View>
              {/* Pick Badge — shows the app's predicted winner so the chip
                  matches the Strong/Solid/Lock tier and the detail page. */}
              {isPremium && hasPrediction ? (
                <View
                  style={{
                    backgroundColor: 'rgba(139,10,31,0.25)',
                    paddingHorizontal: 6,
                    paddingVertical: 3,
                    borderRadius: 5,
                    marginRight: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.6)',
                  }}
                >
                  <TrendingUp size={8} color="#FFFFFF" />
                  <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '700', marginLeft: 3 }}>
                    {predictionDisplay.badgeLabel}
                  </Text>
                </View>
              ) : null}
              {statusBadge ? (
                <View
                  style={{
                    backgroundColor: statusBadge.colors[0],
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 5,
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', color: statusBadge.textColor === 'text-white' ? '#FFFFFF' : statusBadge.textColor === 'text-zinc-300' ? '#D4D4D8' : '#71717A' }}>
                    {statusBadge.text}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(2,3,8,0.92)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.6, shadowRadius: 8 }}>
              {game.status === GameStatus.FINAL ? (
                <>
                  <Calendar size={10} color="#E0E0E0" />
                  <Text style={{ color: '#FFFFFF', fontSize: 10, marginLeft: 4, fontWeight: '700' }}>{date}</Text>
                </>
              ) : (
                <>
                  <Clock size={10} color="#E0E0E0" />
                  <Text style={{ color: '#FFFFFF', fontSize: 10, marginLeft: 4, fontWeight: '700' }}>{date ? `${date} ${time}` : time}</Text>
                </>
              )}
            </View>
          </View>

          {/* Teams */}
          <View className="flex-row items-center mb-3" style={{ position: 'relative', zIndex: 100 }}>
            {/* Away Team */}
            <View className="flex-1">
              <View className="flex-row items-center">
                <View style={{ marginRight: 10, zIndex: 200, marginBottom: isAwayWinner ? 5 : 0 }}>
                  <TappableJersey
                    team={game.awayTeam}
                    teamColors={awayTeamColors}
                    sport={game.sport}
                    isSelected={userPrediction?.pickedTeam === 'away'}
                    onSelect={() => handleJerseyTap('away')}
                    isDisabled={gameStarted}
                    side="away"
                    isLoser={isAwayLoser}
                    isWinner={isAwayWinner}
                  />
                </View>
                <View className="flex-1">
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '800',
                      color: userPrediction?.pickedTeam === 'away' ? '#8B0A1F' : '#FFFFFF',
                      letterSpacing: -0.3,
                      lineHeight: 15,
                      ...(isAwayLoser ? { opacity: 0.35, color: '#555' } : {}),
                    }}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {game.awayTeam.name}
                  </Text>
                  <Text
                    style={{ color: '#FFFFFF', fontSize: 9, marginTop: 3, ...(isAwayLoser ? { opacity: 0.35 } : {}) }}
                  >
                    {game.awayTeam.record}
                  </Text>
                </View>
              </View>
            </View>

            {/* Score or VS */}
            <View style={{ paddingHorizontal: 8 }}>
              {game.status === GameStatus.FINAL ? (
                <View style={{ alignItems: 'center', backgroundColor: 'rgba(2,3,8,0.88)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.6, shadowRadius: 8 }}>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#FFFFFF' }}>
                    {scorePairText(game)}
                  </Text>
                  {game.quarter ? (
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: '600', marginTop: 2 }}>
                      {game.quarter}
                    </Text>
                  ) : null}
                </View>
              ) : game.status === GameStatus.LIVE ? (
                <View style={{ alignItems: 'center', backgroundColor: 'rgba(2,3,8,0.88)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(220,38,38,0.3)', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.6, shadowRadius: 8 }}>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#FFFFFF' }}>
                    {scorePairText(game)}
                  </Text>
                  {(() => {
                    const timeStr = cricketStatusText(game) ?? formatGameTime(game.sport, game.quarter, game.clock);
                    return timeStr ? (
                      <Text style={{ color: '#DC2626', fontSize: 9, fontWeight: '700', marginTop: 2 }}>
                        {timeStr}
                      </Text>
                    ) : null;
                  })()}
                </View>
              ) : (
                <View style={{ alignItems: 'center', backgroundColor: 'rgba(2,3,8,0.88)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.6, shadowRadius: 8 }}>
                  <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>VS</Text>
                </View>
              )}
            </View>

            {/* Home Team */}
            <View className="flex-1 items-end">
              <View className="flex-row items-center">
                <View className="flex-1 items-end" style={{ marginRight: 10 }}>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '800',
                      color: userPrediction?.pickedTeam === 'home' ? '#8B0A1F' : '#FFFFFF',
                      letterSpacing: -0.3,
                      lineHeight: 15,
                      textAlign: 'right',
                      ...(isHomeLoser ? { opacity: 0.35, color: '#555' } : {}),
                    }}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {game.homeTeam.name}
                  </Text>
                  <Text
                    style={{ color: '#FFFFFF', fontSize: 9, marginTop: 3, textAlign: 'right', ...(isHomeLoser ? { opacity: 0.35 } : {}) }}
                  >
                    {game.homeTeam.record}
                  </Text>
                </View>
                <View style={{ zIndex: 200, marginBottom: isHomeWinner ? 5 : 0 }}>
                  <TappableJersey
                    team={game.homeTeam}
                    teamColors={homeTeamColors}
                    sport={game.sport}
                    isSelected={userPrediction?.pickedTeam === 'home'}
                    onSelect={() => handleJerseyTap('home')}
                    isDisabled={gameStarted}
                    side="home"
                    isLoser={isHomeLoser}
                    isWinner={isHomeWinner}
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Community Picks — only show when enough data */}
          {pickStats ? (
          <View style={styles.fanMomentumSection}>
              <>
                {/* Header row: away % | label | home % */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: awayAccent, marginRight: 5 }} />
                    <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>
                      {pickStats.awayWinChance.toFixed(0)}%
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '600', marginLeft: 4 }}>
                      {game.awayTeam.abbreviation}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TrendingUp size={10} color="rgba(255,255,255,0.5)" />
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: '700', letterSpacing: 1, marginLeft: 4 }}>
                      {pickStats.totalPicks} PICKS
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '600', marginRight: 4 }}>
                      {game.homeTeam.abbreviation}
                    </Text>
                    <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>
                      {pickStats.homeWinChance.toFixed(0)}%
                    </Text>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: homeAccent, marginLeft: 5 }} />
                  </View>
                </View>

                {/* Animated progress bar with team colors */}
                <View style={styles.progressBarContainer}>
                  {/* Away team bar */}
                  <Animated.View
                    style={{
                      flex: pickStats.awayWinChance,
                      borderTopLeftRadius: 3,
                      borderBottomLeftRadius: 3,
                      backgroundColor: awayAccent,
                      opacity: 1,
                    }}
                  />
                  {/* Divider */}
                  <View style={styles.progressBarDivider} />
                  {/* Home team bar */}
                  <Animated.View
                    style={{
                      flex: pickStats.homeWinChance,
                      borderTopRightRadius: 3,
                      borderBottomRightRadius: 3,
                      backgroundColor: homeAccent,
                      opacity: 1,
                    }}
                  />
                </View>
              </>
          </View>
          ) : null}

          {/* Prediction and Odds - Compact */}
          {game.prediction ? (
            isPremium ? (
              <View
                style={{
                  position: 'relative',
                  zIndex: 2,
                  backgroundColor: 'rgba(2,3,8,0.92)',
                  borderRadius: 10,
                  padding: 8,
                  borderWidth: 1,
                  borderColor: predictionDisplay.isTossUp
                    ? 'rgba(255,255,255,0.14)'
                    : canonicalConfidence >= 75 ? 'rgba(139,10,31,0.35)' : 'rgba(255,255,255,0.16)',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.6,
                  shadowRadius: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  {predictionDisplay.isTossUp || predictionDisplay.outcome === 'draw' ? (
                    <View
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.07)',
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.12)',
                      }}
                    >
                      <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>
                        {predictionDisplay.badgeLabel}
                      </Text>
                    </View>
                  ) : (
                    <PredictionBadge
                      confidence={canonicalConfidence}
                      predictedWinner={predictionDisplay.badgeLabel}
                      size="small"
                      showBar={false}
                      isTossUp={predictionDisplay.isTossUp}
                    />
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {watchOption ? (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleWatchSourcePress(watchOption.name);
                        }}

                        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(122,157,184,0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(122,157,184,0.3)' }}
                      >
                        <Tv size={10} color="#FFFFFF" />
                        <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '600', marginLeft: 4, maxWidth: 112 }}>{watchOption.name}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {game.prediction.projection ? (
                  <View
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTopWidth: 1,
                      borderTopColor: 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#7A9DB8', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }}>
                          {projectionDisplay?.label.toUpperCase() ?? 'EXPECTED SCORE'}
                        </Text>
                        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800', marginTop: 2 }}>
                          {game.homeTeam.abbreviation} {projectionDisplay?.homeScore ?? Math.round(game.prediction.projection.projectedHomeScore)} · {game.awayTeam.abbreviation} {projectionDisplay?.awayScore ?? Math.round(game.prediction.projection.projectedAwayScore)}
                        </Text>
                        <Text style={{ color: 'rgba(255,255,255,0.52)', fontSize: 10, fontWeight: '700', marginTop: 2 }}>
                          {projectionDisplay?.leanText ?? predictionDisplay.leanLabel}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: '700' }}>
                          Upset Risk
                        </Text>
                        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '900', marginTop: 2 }}>
                          {projectionRiskTier}
                        </Text>
                      </View>
                    </View>
                    {projectionDisplay ? (
                      <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.48)', fontSize: 10, lineHeight: 14, marginTop: 5 }}>
                        {projectionDisplay.contextText}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {displayAnalysis ? (
                  <Text
                    numberOfLines={3}
                    style={{
                      color: 'rgba(255,255,255,0.68)',
                      fontSize: 11,
                      lineHeight: 15,
                      fontWeight: '500',
                      marginTop: 8,
                    }}
                  >
                    {displayAnalysis}
                  </Text>
                ) : null}
              </View>
            ) : (
              /* Locked prediction bar for free users */
              <Pressable
                onPress={() => router.push('/paywall')}
                style={{
                  position: 'relative',
                  zIndex: 2,
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <LinearGradient
                  colors={['rgba(180,211,235,0.24)', 'rgba(255,255,255,0.12)', 'rgba(122,157,184,0.18)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ borderRadius: 14, padding: 1 }}
                >
                  <View
                    style={{
                      minHeight: 70,
                      backgroundColor: 'rgba(5,8,13,0.94)',
                      borderRadius: 13,
                      paddingHorizontal: 13,
                      paddingVertical: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      overflow: 'hidden',
                    }}
                    >
                      <LinearGradient
                        pointerEvents="none"
                        colors={['rgba(180,211,235,0.12)', 'rgba(255,255,255,0.035)', 'rgba(5,8,13,0.72)']}
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
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, paddingRight: 10 }}>
                      <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: 'rgba(122,157,184,0.11)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.28)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Lock size={16} color="#9AB8CC" strokeWidth={2.6} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, marginLeft: 11 }}>
                        <Text numberOfLines={1} style={{ color: '#B4D3EB', fontSize: 8.5, lineHeight: 11, fontWeight: '900', letterSpacing: 1.5 }}>CLUTCH PRO</Text>
                        <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 13.5, lineHeight: 17, fontWeight: '900', marginTop: 2 }}>Full matchup read</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7 }}>
                          <View style={{ width: 46, height: 5, borderRadius: 3, backgroundColor: 'rgba(180,211,235,0.48)', marginRight: 5 }} />
                          <View style={{ width: 30, height: 5, borderRadius: 3, backgroundColor: 'rgba(224,234,240,0.28)', marginRight: 5 }} />
                          <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(122,157,184,0.32)' }} />
                        </View>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                      <View style={{ backgroundColor: 'rgba(122,157,184,0.12)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(180,211,235,0.28)' }}>
                        <Text style={{ color: 'rgba(238,247,255,0.90)', fontSize: 9, lineHeight: 11, fontWeight: '900', letterSpacing: 1.2 }}>PRO</Text>
                      </View>
                      <ChevronRight size={15} color="#9AB8CC" strokeWidth={2.8} style={{ marginTop: 7, marginRight: 2 }} />
                    </View>
                  </View>
                </LinearGradient>
              </Pressable>
            )
          ) : null}

          {/* View Details Arrow - Compact */}
          <View style={styles.detailsButtonRow}>
            <View style={styles.detailsButton}>
              <Text style={{ color: '#FFFFFF', fontSize: 10, marginRight: 2, fontWeight: '600' }}>Details</Text>
              <ChevronRight size={12} color="#FFFFFF" />
            </View>
          </View>
            </View>
            </View>
          </View>
        </View>
        </View>
        </View>
      </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  // PulsingLiveBadge
  pulsingGlow: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    backgroundColor: 'rgba(220, 38, 38, 0.3)',
    borderRadius: 6,
  },
  liveBadgeContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#DC2626',
    marginRight: 4,
  },
  // TappableJersey
  jerseyAnimatedContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loserOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(30,30,30,0.6)',
    borderRadius: 8,
  },
  checkmarkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#8B0A1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  winnerBadge: {
    position: 'absolute',
    bottom: -6,
    left: '50%' as unknown as number,
    marginLeft: -12,
    width: 24,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#040608',
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 6,
  },
  // LiveGameLayout
  liveGlowShadowLayer: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 18,
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 0,
  },
  liveCardBorder: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  // GameCard main card — hyper glass raised border
  cardShadowContainer: {
    borderRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.95,
    shadowRadius: 32,
    elevation: 30,
  },
  cardOverflowContainer: {
    overflow: 'hidden',
    borderRadius: 18,
  },
  cardContentPadding: {
    padding: 12,
    position: 'relative',
    zIndex: 10,
  },
  fanMomentumSection: {
    marginBottom: 8,
    position: 'relative',
    zIndex: 2,
    backgroundColor: 'rgba(2,3,8,0.92)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  progressBarContainer: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  progressBarDivider: {
    width: 2,
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  detailsButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    position: 'relative',
    zIndex: 2,
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
});
