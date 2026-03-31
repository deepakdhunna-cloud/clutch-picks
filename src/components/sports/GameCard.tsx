import { View, Text, Pressable, Modal, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  cancelAnimation,
} from 'react-native-reanimated';
import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { GameWithPrediction, GameStatus, SPORT_META, Sport } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { PredictionBadge } from './PredictionBadge';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { Calendar, Clock, Tv, TrendingUp, Star, ChevronRight, Check } from 'lucide-react-native';
import { useMakePick, useGamePick, useGamePickStats } from '@/hooks/usePicks';
import { useSubscription } from '@/lib/subscription-context';
import * as Haptics from 'expo-haptics';
import { usePrefetchGame } from '@/hooks/useGames';

interface GameCardProps {
  game: GameWithPrediction;
  index?: number;
}

// Compact Pulsing Live Badge component
const PulsingLiveBadge = memo(function PulsingLiveBadge() {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.6, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    scale.value = withRepeat(
      withTiming(1.05, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(scale);
    };
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={{ position: 'relative' }}>
      {/* Pulsing glow behind */}
      <Animated.View
        style={[
          styles.pulsingGlow,
          animatedStyle,
        ]}
      />
      {/* Main badge - white with red dot and text */}
      <View style={styles.liveBadgeContainer}>
        {/* Live dot - red */}
        <Animated.View
          style={[
            styles.liveDot,
            animatedStyle,
          ]}
        />
        <Text style={{ fontSize: 10, fontWeight: '700', color: '#DC2626' }}>LIVE</Text>
      </View>
    </View>
  );
});

function formatGameTime(dateString: string): { date: string; time: string } {
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

// Get streaming URL for TV channel - memoized outside component
const tvChannelUrls: Record<string, string> = {
  espn: 'https://www.espn.com/watch/',
  fox: 'https://www.foxsports.com/live',
  fs1: 'https://www.foxsports.com/live',
  fs2: 'https://www.foxsports.com/live',
  nbc: 'https://www.peacocktv.com/sports',
  peacock: 'https://www.peacocktv.com/sports',
  cbs: 'https://www.paramountplus.com/sports/',
  'paramount+': 'https://www.paramountplus.com/sports/',
  tnt: 'https://www.tntdrama.com/watchtnt',
  tbs: 'https://www.tntdrama.com/watchtnt',
  abc: 'https://abc.com/watch-live',
  nfl: 'https://www.nfl.com/network/watch/',
  mlb: 'https://www.mlb.com/tv',
  nba: 'https://www.nba.com/watch',
  nhl: 'https://www.nhl.com/tv',
  prime: 'https://www.amazon.com/primevideo',
  amazon: 'https://www.amazon.com/primevideo',
  apple: 'https://tv.apple.com/',
  youtube: 'https://tv.youtube.com/',
};

function getTvChannelUrl(channel: string): string {
  const channelLower = channel.toLowerCase().trim();

  for (const [key, url] of Object.entries(tvChannelUrls)) {
    if (channelLower.includes(key)) {
      return url;
    }
  }

  return `https://www.google.com/search?q=watch+${encodeURIComponent(channel)}+live+stream`;
}

// Handle TV channel press
function handleTvChannelPress(channel: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  const url = getTvChannelUrl(channel);
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

  const handlePress = useCallback(() => {
    if (isDisabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    scale.value = withTiming(0.95, { duration: 150, easing: Easing.out(Easing.ease) }, () => {
      scale.value = withTiming(1, { duration: 200, easing: Easing.inOut(Easing.ease) });
    });
    onSelect();
  }, [isDisabled, onSelect, scale]);

  const shadowStyle = useMemo(() => ({
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 12,
  }), []);

  return (
    <Pressable onPress={handlePress} disabled={isDisabled}>
      <Animated.View style={[containerStyle, styles.jerseyAnimatedContainer]}>
        <View style={{ position: 'relative', alignItems: 'center' }}>
          {/* Jersey — smoothly lifts when selected */}
          <Animated.View style={[shadowStyle, isLoser ? { opacity: 0.5 } : undefined, jerseyLiftStyle]}>
            <JerseyIcon
              teamCode={team.abbreviation}
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
            <Text style={{ fontSize: 6, fontWeight: '900', color: '#040608', letterSpacing: 1 }}>YOUR PICK</Text>
          </Animated.View>

          {/* Winner badge */}
          {isWinner ? (
            <View style={styles.winnerBadge}>
              <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '900' }}>W</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Pressable>
  );
});

// Premium confirmation modal component - black, centered on screen
const SelectionConfirmModal = memo(function SelectionConfirmModal({
  visible,
  team,
  teamColors,
  sport,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  team: { abbreviation: string; name: string; record: string } | null;
  teamColors: { primary: string; secondary: string };
  sport: Sport;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const modalScale = useSharedValue(0.9);
  const jerseyScale = useSharedValue(1);
  const checkmarkScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      modalScale.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
      jerseyScale.value = 1;
      setIsConfirming(false);
      setShowCheckmark(false);
      checkmarkScale.value = 0;
    } else {
      modalScale.value = 0.95;
      jerseyScale.value = 1;
      checkmarkScale.value = 0;
    }
  }, [visible]);

  const modalStyle = useAnimatedStyle(() => ({
    transform: [{ scale: modalScale.value }],
    opacity: interpolate(modalScale.value, [0.95, 1], [0, 1]),
  }));

  const jerseyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: jerseyScale.value }],
  }));

  const checkmarkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkmarkScale.value }],
    opacity: checkmarkScale.value,
  }));

  const handleConfirm = useCallback(() => {
    setIsConfirming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Gentle scale up — smooth and slow
    jerseyScale.value = withTiming(1.08, { duration: 400, easing: Easing.out(Easing.ease) }, () => {
      jerseyScale.value = withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) });
    });

    // Checkmark fades in after jersey peaks
    setTimeout(() => {
      setShowCheckmark(true);
      checkmarkScale.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
    }, 400);

    // Success haptic at the peak
    setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 500);

    // Hold for a moment so user sees the confirmation, then close
    setTimeout(() => {
      onConfirm();
    }, 1100);
  }, [onConfirm, jerseyScale, checkmarkScale]);

  if (!team) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.85)' }}>
        <Pressable onPress={isConfirming ? undefined : onCancel}>
          <View style={styles.modalFullscreenOverlay} />
        </Pressable>

        <Animated.View style={[modalStyle]}>
          <View style={{
            backgroundColor: '#0C1018',
            borderRadius: 24, padding: 28, paddingTop: 32,
            width: 280, alignItems: 'center',
            borderWidth: 1.5, borderColor: `${teamColors.primary}30`,
            shadowColor: teamColors.primary, shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.2, shadowRadius: 30,
          }}>
            {/* Team color accent line at top */}
            <View style={{ position: 'absolute', top: 0, left: 40, right: 40, height: 3, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }}>
              <LinearGradient
                colors={['transparent', teamColors.primary, 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ flex: 1 }}
              />
            </View>

            {/* Jersey */}
            <View style={{ position: 'relative', alignItems: 'center', marginBottom: 20 }}>
              <Animated.View style={[jerseyStyle, isConfirming ? { transform: [{ translateY: -6 }] } : undefined]}>
                <JerseyIcon
                  teamCode={team.abbreviation}
                  primaryColor={teamColors.primary}
                  secondaryColor={teamColors.secondary}
                  size={85}
                  sport={sportEnumToJersey(sport)}
                />
              </Animated.View>

              {/* Confirmed checkmark */}
              {showCheckmark ? (
                <Animated.View style={[checkmarkStyle, {
                  position: 'absolute', bottom: -6, right: 0,
                  width: 22, height: 22, borderRadius: 11,
                  backgroundColor: '#7A9DB8', alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: '#0C1018',
                }]}>
                  <Check size={10} color="#FFF" strokeWidth={3} />
                </Animated.View>
              ) : null}
            </View>

            {/* Team name */}
            <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginBottom: 4, textAlign: 'center' }}>
              {team.name}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginBottom: 4 }}>
              {team.record}
            </Text>
            <Text style={{ color: isConfirming ? '#7A9DB8' : 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: '600', marginBottom: 24 }}>
              {isConfirming ? 'Pick locked in' : 'Pick this team to win?'}
            </Text>

            {/* Buttons */}
            {!isConfirming ? (
              <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                <Pressable
                  onPress={onCancel}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center' }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleConfirm}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: teamColors.primary, alignItems: 'center' }}
                >
                  <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700' }}>Lock It In</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
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
  awayTeamColors: { primary: string; secondary: string };
  homeTeamColors: { primary: string; secondary: string };
  sportMeta: typeof SPORT_META[Sport];
}) {
  const router = useRouter();
  const prefetchGame = usePrefetchGame();

  const awayScore = game.awayScore ?? 0;
  const homeScore = game.homeScore ?? 0;
  const awayWinning = awayScore > homeScore;
  const homeWinning = homeScore > awayScore;

  const handlePress = useCallback(() => {
    prefetchGame(game.id);
    router.push(`/game/${game.id}` as any);
  }, [game.id, router, prefetchGame]);

  return (
    <View style={{ position: 'relative', marginBottom: 16 }}>
      <Pressable onPress={handlePress} className="active:opacity-85">
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
              `${awayTeamColors.primary}90`,
              `${awayTeamColors.primary}50`,
              '#0D1118',
              '#080C12',
              '#0D1118',
              `${homeTeamColors.primary}50`,
              `${homeTeamColors.primary}90`,
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
                `${awayTeamColors.primary}60`,
                'rgba(255,255,255,0.12)',
                '#080C12',
                'rgba(0,0,0,0.6)',
                `${homeTeamColors.primary}50`,
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
            colors={[`${awayTeamColors.primary}CC`, `${awayTeamColors.primary}66`, `${awayTeamColors.primary}22`, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.7, y: 0.8 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />

          {/* Home team color bleed */}
          <LinearGradient
            colors={[`${homeTeamColors.primary}CC`, `${homeTeamColors.primary}66`, `${homeTeamColors.primary}22`, 'transparent']}
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
                    {game.sport === 'NCAAF' ? 'CFB' : game.sport === 'NCAAB' ? 'CBB' : game.sport}
                  </Text>
                </View>
                <PulsingLiveBadge />
              </View>

              {game.tvChannel ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    handleTvChannelPress(game.tvChannel!);
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
                  <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginLeft: 4 }}>
                    {game.tvChannel}
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
                primaryColor={awayTeamColors.primary}
                secondaryColor={awayTeamColors.secondary}
                size={40}
                sport={sportEnumToJersey(game.sport)}
              />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text
                  style={{
                    color: awayWinning ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
                    fontSize: 14,
                    fontWeight: awayWinning ? '800' : '500',
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
              </View>
              <Text style={{
                color: awayWinning ? '#FFFFFF' : 'rgba(255,255,255,0.25)',
                fontSize: 22,
                fontWeight: awayWinning ? '900' : '500',
                letterSpacing: -0.5,
                minWidth: 30,
                textAlign: 'right',
              }}>
                {awayScore}
              </Text>
            </View>

            {/* Home team row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <JerseyIcon
                teamCode={game.homeTeam.abbreviation}
                primaryColor={homeTeamColors.primary}
                secondaryColor={homeTeamColors.secondary}
                size={40}
                sport={sportEnumToJersey(game.sport)}
              />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text
                  style={{
                    color: homeWinning ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
                    fontSize: 14,
                    fontWeight: homeWinning ? '800' : '500',
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
              </View>
              <Text style={{
                color: homeWinning ? '#FFFFFF' : 'rgba(255,255,255,0.25)',
                fontSize: 22,
                fontWeight: homeWinning ? '900' : '500',
                letterSpacing: -0.5,
                minWidth: 30,
                textAlign: 'right',
              }}>
                {homeScore}
              </Text>
            </View>

            {/* Bottom bar */}
            <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {game.quarter ? (
                    <View style={{
                      backgroundColor: 'rgba(255,255,255,0.12)',
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 5,
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.18)',
                    }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>{game.quarter}</Text>
                    </View>
                  ) : null}
                  {game.clock ? (
                    <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '700', letterSpacing: 0.3 }}>
                      {game.clock}
                    </Text>
                  ) : null}
                  {!game.quarter && !game.clock ? (
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600' }}>IN PROGRESS</Text>
                  ) : null}
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
  const { isPremium } = useSubscription();
  const isLive = game.status === GameStatus.LIVE;

  // Memoize derived values
  const sportMeta = useMemo(() => SPORT_META[game.sport], [game.sport]);
  const { date, time } = useMemo(() => formatGameTime(game.gameTime), [game.gameTime]);
  const statusBadge = useMemo(() => getStatusBadge(game.status), [game.status]);

  // Get team colors - memoized, pass ESPN color as fallback
  const awayTeamColors = useMemo(() => getTeamColors(game.awayTeam.abbreviation, game.sport, game.awayTeam.color), [game.awayTeam.abbreviation, game.sport, game.awayTeam.color]);
  const homeTeamColors = useMemo(() => getTeamColors(game.homeTeam.abbreviation, game.sport, game.homeTeam.color), [game.homeTeam.abbreviation, game.sport, game.homeTeam.color]);

  // Use backend hooks for picks
  const { mutate: makePick } = useMakePick();
  const { data: userPrediction } = useGamePick(game.id);
  const { data: pickStatsData } = useGamePickStats(game.id);

  // Calculate pick stats from real backend data, fallback to 50/50
  const pickStats = useMemo(() => {
    const homePercentage = pickStatsData?.homePercentage ?? 50;
    const awayPercentage = pickStatsData?.awayPercentage ?? 50;
    const totalPicks = pickStatsData?.totalPicks ?? 0;
    const homeWinChance = pickStatsData?.homePercentage ?? 50;
    const awayWinChance = pickStatsData?.awayPercentage ?? 50;
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

  const handlePress = useCallback(() => {
    // Prefetch data immediately on tap for faster loading
    prefetchGame(game.id);
    router.push(`/game/${game.id}` as any);
  }, [game.id, router, prefetchGame]);

  const handleJerseyTap = useCallback((selectedTeam: 'home' | 'away') => {
    if (userPrediction?.pickedTeam === selectedTeam) {
      return;
    }
    setPendingSelection(selectedTeam);
    setShowConfirmModal(true);
  }, [userPrediction?.pickedTeam]);

  const handleConfirmSelection = useCallback(() => {
    if (pendingSelection) {
      makePick({
        gameId: game.id,
        pickedTeam: pendingSelection,
        homeTeam: game.homeTeam.abbreviation,
        awayTeam: game.awayTeam.abbreviation,
        sport: game.sport,
      });
    }
    setShowConfirmModal(false);
    setPendingSelection(null);
  }, [pendingSelection, game.id, game.homeTeam.abbreviation, game.awayTeam.abbreviation, game.sport, makePick]);

  const handleCancelSelection = useCallback(() => {
    setShowConfirmModal(false);
    setPendingSelection(null);
  }, []);

  // Memoized derived team values
  const { predictedWinnerTeam, marketFavoriteTeam, isFavoriteAway, isFavoriteHome } = useMemo(() => {
    return {
      predictedWinnerTeam: game.prediction?.predictedWinner === 'home' ? game.homeTeam : game.awayTeam,
      marketFavoriteTeam: game.marketFavorite === 'home' ? game.homeTeam : game.awayTeam,
      isFavoriteAway: game.marketFavorite === 'away',
      isFavoriteHome: game.marketFavorite === 'home',
    };
  }, [game.prediction?.predictedWinner, game.marketFavorite, game.homeTeam, game.awayTeam]);

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
    <Animated.View
      entering={index < 3 ? FadeInUp.duration(300) : undefined}
      style={{ position: 'relative', marginBottom: 20 }}
    >
      {/* Confirmation Modal */}
      {showConfirmModal === true && (
        <SelectionConfirmModal
          visible={true}
          team={pendingTeam}
          teamColors={pendingTeamColors}
          sport={game.sport}
          onConfirm={handleConfirmSelection}
          onCancel={handleCancelSelection}
        />
      )}

      <Pressable onPress={handlePress} style={{ flex: 1 }}>
      {/* Depth shadow */}
      <View style={styles.cardShadowContainer}>
      {/* Glass border — dark reflective with team colors */}
      <View style={{ borderRadius: 22, padding: 3, overflow: 'hidden' }}>
        <LinearGradient
          colors={[
            `${awayTeamColors.primary}90`,
            `${awayTeamColors.primary}50`,
            '#0D1118',
            '#080C12',
            '#0D1118',
            `${homeTeamColors.primary}50`,
            `${homeTeamColors.primary}90`,
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
              `${awayTeamColors.primary}60`,
              'rgba(255,255,255,0.12)',
              '#080C12',
              'rgba(0,0,0,0.6)',
              `${homeTeamColors.primary}50`,
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
            colors={[`${awayTeamColors.primary}${colorOpacities.away.opacity}`, `${awayTeamColors.primary}${colorOpacities.away.opacityLight}`, `${awayTeamColors.primary}18`, 'transparent']}
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
            colors={[`${homeTeamColors.primary}${colorOpacities.home.opacity}`, `${homeTeamColors.primary}${colorOpacities.home.opacityLight}`, `${homeTeamColors.primary}18`, 'transparent']}
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
                  {game.sport === 'NCAAF' ? 'CFB' : game.sport === 'NCAAB' ? 'CBB' : game.sport}
                </Text>
              </View>
              {/* FAV Badge - maroon with white text */}
              {(isFavoriteAway || isFavoriteHome) ? (
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
                    borderColor: 'rgba(139,10,31,0.4)',
                  }}
                >
                  <Star size={8} color="#FFFFFF" fill="#8B0A1F" />
                  <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '700', marginLeft: 3 }}>
                    {isFavoriteAway ? game.awayTeam.abbreviation : game.homeTeam.abbreviation}
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
                      fontSize: 14,
                      fontWeight: '900',
                      color: userPrediction?.pickedTeam === 'away' ? '#8B0A1F' : '#FFFFFF',
                      letterSpacing: -0.2,
                      lineHeight: 17,
                      ...(isAwayLoser ? { opacity: 0.35, color: '#555' } : {}),
                    }}
                    numberOfLines={2}
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
                    {game.awayScore} - {game.homeScore}
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
                    {game.awayScore ?? 0} - {game.homeScore ?? 0}
                  </Text>
                  {game.quarter ? (
                    <Text style={{ color: '#DC2626', fontSize: 9, fontWeight: '700', marginTop: 2 }}>
                      {game.quarter}{game.clock ? ` · ${game.clock}` : null}
                    </Text>
                  ) : null}
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
                      fontSize: 14,
                      fontWeight: '900',
                      color: userPrediction?.pickedTeam === 'home' ? '#8B0A1F' : '#FFFFFF',
                      letterSpacing: -0.2,
                      lineHeight: 17,
                      textAlign: 'right',
                      ...(isHomeLoser ? { opacity: 0.35, color: '#555' } : {}),
                    }}
                    numberOfLines={2}
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
          {pickStats.totalPicks >= 10 ? (
          <View style={styles.fanMomentumSection}>
              <>
                {/* Header row: away % | label | home % */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: awayTeamColors.primary, marginRight: 5 }} />
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
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: homeTeamColors.primary, marginLeft: 5 }} />
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
                      backgroundColor: awayTeamColors.primary,
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
                      backgroundColor: homeTeamColors.primary,
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
                  borderColor: game.prediction.isTossUp
                    ? 'rgba(255,255,255,0.14)'
                    : game.prediction.confidence >= 75 ? 'rgba(139,10,31,0.35)' : 'rgba(255,255,255,0.16)',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.6,
                  shadowRadius: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  {game.prediction.isTossUp ? (
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
                        TOSS-UP
                      </Text>
                    </View>
                  ) : (
                    <PredictionBadge
                      confidence={game.prediction.confidence}
                      predictedWinner={predictedWinnerTeam.abbreviation}
                      size="small"
                      showBar={false}
                    />
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {game.tvChannel ? (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleTvChannelPress(game.tvChannel!);
                        }}
      
                        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(122,157,184,0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(122,157,184,0.3)' }}
                      >
                        <Tv size={10} color="#FFFFFF" />
                        <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '600', marginLeft: 4 }}>{game.tvChannel}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {/* Data quality indicators */}
                {game.prediction.lowDataWarning ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <Text style={{ color: 'rgba(255,200,100,0.6)', fontSize: 9, fontWeight: '600' }}>⚠ Limited data</Text>
                  </View>
                ) : null}
                {game.prediction.ensembleDivergence ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: game.prediction.lowDataWarning ? 2 : 4 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: '600' }}>Models disagree</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              /* Locked prediction bar for free users */
              <Pressable
                onPress={() => router.push('/paywall')}
                style={{
                  position: 'relative',
                  zIndex: 2,
                  backgroundColor: 'rgba(2,3,8,0.92)',
                  borderRadius: 10,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.08)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(139,10,31,0.10)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 14 }}>🔒</Text>
                  </View>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700' }}>AI Pick Available</Text>
                </View>
                <View style={{ backgroundColor: '#8B0A1F', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>PRO</Text>
                </View>
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
    </Animated.View>
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
    bottom: -8,
    left: '50%' as unknown as number,
    marginLeft: -10,
    width: 20,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
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
  // SelectionConfirmModal
  modalFullscreenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    backgroundColor: '#000000',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    minWidth: 260,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modalJerseyRelative: {
    position: 'relative',
    marginBottom: 20,
  },
  modalCheckmarkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#8B0A1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modalConfirmButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
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
