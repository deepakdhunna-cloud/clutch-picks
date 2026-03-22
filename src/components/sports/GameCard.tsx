import { View, Text, Pressable, TouchableOpacity, TouchableWithoutFeedback, Modal, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
  interpolate,
  cancelAnimation,
} from 'react-native-reanimated';
import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { cn } from '@/lib/cn';
import { GameWithPrediction, GameStatus, SPORT_META, Sport } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { PredictionBadge } from './PredictionBadge';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { Calendar, Clock, Tv, TrendingUp, Star, ChevronRight, Check } from 'lucide-react-native';
import { useMakePick, useGamePick, useGamePickStats } from '@/hooks/usePicks';
import { useSubscription } from '@/lib/subscription-context';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Ellipse, Path, Line } from 'react-native-svg';
import { usePrefetchGame } from '@/hooks/useGames';

interface GameCardProps {
  game: GameWithPrediction;
  index?: number;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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

// Mini sport icons for team badges
function MiniFootball({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Ellipse cx="12" cy="12" rx="8" ry="5" stroke={color} strokeWidth="2" fill="none" />
      <Line x1="12" y1="7.5" x2="12" y2="16.5" stroke={color} strokeWidth="1.5" />
    </Svg>
  );
}

function MiniBasketball({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8" stroke={color} strokeWidth="2" fill="none" />
      <Line x1="12" y1="4" x2="12" y2="20" stroke={color} strokeWidth="1.5" />
      <Line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth="1.5" />
    </Svg>
  );
}

function MiniBaseball({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8" stroke={color} strokeWidth="2" fill="none" />
      <Path d="M6 7C8.5 10 8.5 14 6 17" stroke={color} strokeWidth="1.5" fill="none" />
      <Path d="M18 7C15.5 10 15.5 14 18 17" stroke={color} strokeWidth="1.5" fill="none" />
    </Svg>
  );
}

function MiniHockey({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M6 5L6 15L10 15" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx="16" cy="15" r="4" stroke={color} strokeWidth="2" fill="none" />
    </Svg>
  );
}

function MiniSoccer({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8" stroke={color} strokeWidth="2" fill="none" />
      <Path d="M12 8L9 10L10 14L14 14L15 10Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

function getSportMiniIcon(sport: Sport, color: string) {
  switch (sport) {
    case Sport.NFL:
    case Sport.NCAAF:
      return <MiniFootball color={color} />;
    case Sport.NBA:
    case Sport.NCAAB:
      return <MiniBasketball color={color} />;
    case Sport.MLB:
      return <MiniBaseball color={color} />;
    case Sport.NHL:
      return <MiniHockey color={color} />;
    case Sport.MLS:
    case Sport.EPL:
      return <MiniSoccer color={color} />;
    default:
      return <MiniSoccer color={color} />;
  }
}

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

// Helper to adjust color brightness
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

// Animated tappable jersey component with premium feel
const TappableJersey = memo(function TappableJersey({
  team,
  teamColors,
  sport,
  isSelected,
  onSelect,
  isDisabled,
  side,
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

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    if (isDisabled) return;

    // Premium haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Bounce animation
    scale.value = withSpring(0.92, { damping: 15 }, () => {
      scale.value = withSpring(1.03, { damping: 12 }, () => {
        scale.value = withSpring(1, { damping: 10 });
      });
    });

    onSelect();
  }, [isDisabled, onSelect, scale]);

  const shadowStyle = useMemo(() => {
    const baseStyle = {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 12,
      elevation: 12,
    };

    if (isSelected) {
      return {
        ...baseStyle,
        shadowColor: '#E8936A',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 12,
        elevation: 10,
      };
    }

    return baseStyle;
  }, [isSelected]);

  return (
    <TouchableWithoutFeedback onPress={handlePress} disabled={isDisabled}>
      <Animated.View style={[containerStyle, styles.jerseyAnimatedContainer]}>
        <View style={{ position: 'relative' }}>
          {/* Jersey with subtle dim for loser - keeps design visible */}
          <View
            style={[
              shadowStyle,
              isLoser ? { opacity: 0.5 } : undefined,
            ]}
          >
            <JerseyIcon
              teamCode={team.abbreviation}
              primaryColor={teamColors.primary}
              secondaryColor={teamColors.secondary}
              size={size}
              sport={sportEnumToJersey(sport)}
            />
          </View>

          {/* Grayscale overlay for loser - follows jersey shape */}
          {isLoser ? (
            <View
              pointerEvents="none"
              style={styles.loserOverlay}
            />
          ) : null}

          {/* Small checkmark badge when selected (only if game not final) */}
          {isSelected && !isLoser && !isWinner ? (
            <View style={styles.checkmarkBadge}>
              <Check size={8} color="#000" strokeWidth={3} />
            </View>
          ) : null}

          {/* Winner "W" badge - positioned below jersey */}
          {isWinner ? (
            <View style={styles.winnerBadge}>
              <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '900' }}>W</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
});

// Animated pulsing score for live games - simplified for performance
const AnimatedLiveScore = memo(function AnimatedLiveScore({ score }: { score: number }) {
  return (
    <Text
      style={{
        fontSize: 26,
        fontWeight: '900',
        color: '#FFFFFF',
        textAlign: 'center',
      }}
    >
      {score}
    </Text>
  );
});

// Live game card glow effect - white glow to indicate live
const LiveCardGlow = memo(function LiveCardGlow({ glowColor = 'rgba(255, 255, 255, 0.6)' }: { glowColor?: string }) {
  const borderOpacity = useSharedValue(0.3);

  useEffect(() => {
    borderOpacity.value = withRepeat(
      withTiming(0.9, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => {
      cancelAnimation(borderOpacity);
    };
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: borderOpacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: -3,
          left: -3,
          right: -3,
          bottom: -3,
          borderRadius: 20,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderColor: glowColor,
        },
        animatedStyle,
      ]}
    />
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
  const glowOpacity = useSharedValue(0);
  const checkmarkScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      modalScale.value = withSpring(1, { damping: 15, stiffness: 200 });
      setIsConfirming(false);
      setShowCheckmark(false);
      glowOpacity.value = 0;
      checkmarkScale.value = 0;
    } else {
      modalScale.value = 0.9;
      jerseyScale.value = 1;
      glowOpacity.value = 0;
      checkmarkScale.value = 0;
    }
  }, [visible]);

  const modalStyle = useAnimatedStyle(() => ({
    transform: [{ scale: modalScale.value }],
  }));

  const jerseyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: jerseyScale.value }],
  }));

  const glowContainerStyle = useAnimatedStyle(() => ({
    shadowOpacity: glowOpacity.value,
  }));

  const checkmarkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkmarkScale.value }],
    opacity: checkmarkScale.value,
  }));

  const handleConfirm = useCallback(() => {
    setIsConfirming(true);

    // Same haptic as game card
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Same bounce animation as game card jersey: 0.92 -> 1.03 -> 1
    jerseyScale.value = withSpring(0.92, { damping: 15 }, () => {
      jerseyScale.value = withSpring(1.03, { damping: 12 }, () => {
        jerseyScale.value = withSpring(1, { damping: 10 });
      });
    });

    // Fade in the glow (same as game card selected state)
    glowOpacity.value = withTiming(0.9, { duration: 250 });

    // Show checkmark badge after bounce starts
    setTimeout(() => {
      setShowCheckmark(true);
      checkmarkScale.value = withSpring(1, { damping: 12, stiffness: 300 });
    }, 150);

    // Success haptic when complete
    setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 300);

    // Delay closing to show the full animation
    setTimeout(() => {
      onConfirm();
    }, 500);
  }, [onConfirm, jerseyScale, glowOpacity, checkmarkScale]);

  if (!team) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.9)' }}>
        <TouchableWithoutFeedback onPress={isConfirming ? undefined : onCancel}>
          <View style={styles.modalFullscreenOverlay} />
        </TouchableWithoutFeedback>

        {/* Modal - Pure black */}
        <Animated.View style={[modalStyle]}>
          <View style={styles.modalContainer}>
            {/* Team Jersey with glow - same style as game card */}
            <View style={styles.modalJerseyRelative}>
              {/* Jersey with glow shadow (same as game card selected state) */}
              <Animated.View
                style={[
                  jerseyStyle,
                  glowContainerStyle,
                  {
                    shadowColor: '#E8936A',
                    shadowOffset: { width: 0, height: 0 },
                    shadowRadius: 15,
                    elevation: 12,
                  },
                ]}
              >
                <JerseyIcon
                  teamCode={team.abbreviation}
                  primaryColor={teamColors.primary}
                  secondaryColor={teamColors.secondary}
                  size={75}
                  sport={sportEnumToJersey(sport)}
                />
              </Animated.View>

              {/* Checkmark badge - same as game card */}
              {showCheckmark ? (
                <Animated.View
                  style={[
                    checkmarkStyle,
                    styles.modalCheckmarkBadge,
                  ]}
                >
                  <Check size={11} color="#000" strokeWidth={3} />
                </Animated.View>
              ) : null}
            </View>

            {/* Team name */}
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginBottom: 6, textAlign: 'center' }}>
              {team.name}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 24 }}>
              {isConfirming ? 'Winner selected!' : 'Select as winner?'}
            </Text>

            {/* Buttons */}
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                onPress={onCancel}
                activeOpacity={0.7}
                disabled={isConfirming}
                style={[styles.modalCancelButton, { opacity: isConfirming ? 0.3 : 1 }]}
              >
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleConfirm}
                activeOpacity={0.8}
                disabled={isConfirming}
                style={[styles.modalConfirmButton, { backgroundColor: isConfirming ? '#4CAF50' : '#E8936A' }]}
              >
                <Text style={{ color: isConfirming ? '#FFF' : '#000', fontSize: 15, fontWeight: '700' }}>
                  {isConfirming ? 'Done' : 'Confirm'}
                </Text>
              </TouchableOpacity>
            </View>
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
  pickStats,
}: {
  game: GameWithPrediction;
  awayTeamColors: { primary: string; secondary: string };
  homeTeamColors: { primary: string; secondary: string };
  sportMeta: typeof SPORT_META[Sport];
  pickStats: { homeWinChance: number; awayWinChance: number };
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
        <View
          style={{
            borderRadius: 18,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            shadowColor: '#000',
            shadowOpacity: 0.4,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
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
                    backgroundColor: sportMeta.color,
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: 5,
                    marginRight: 6,
                    borderWidth: 1,
                    borderColor: '#FFFFFF40',
                  }}
                >
                  <Text style={{ color: sportMeta.accentColor, fontSize: 9, fontWeight: '700' }}>
                    {game.sport}
                  </Text>
                </View>
                <PulsingLiveBadge />
              </View>

              {game.tvChannel ? (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    handleTvChannelPress(game.tvChannel!);
                  }}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'rgba(90, 122, 138, 0.6)',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 7,
                    borderWidth: 1,
                    borderColor: 'rgba(90, 122, 138, 0.8)',
                  }}
                >
                  <Tv size={10} color="#FFFFFF" />
                  <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginLeft: 4 }}>
                    {game.tvChannel}
                  </Text>
                </TouchableOpacity>
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
                    color: awayWinning ? '#FFFFFF' : 'rgba(255,255,255,0.6)',
                    fontSize: 14,
                    fontWeight: awayWinning ? '800' : '600',
                    letterSpacing: 0.3,
                  }}
                  numberOfLines={1}
                >
                  {game.awayTeam.name}
                </Text>
                {game.awayTeam.record ? (
                  <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '500', marginTop: 1 }}>
                    {game.awayTeam.record}
                  </Text>
                ) : null}
              </View>
              <Text style={{
                color: awayWinning ? '#FFFFFF' : 'rgba(255,255,255,0.45)',
                fontSize: 22,
                fontWeight: awayWinning ? '900' : '600',
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
                    color: homeWinning ? '#FFFFFF' : 'rgba(255,255,255,0.6)',
                    fontSize: 14,
                    fontWeight: homeWinning ? '800' : '600',
                    letterSpacing: 0.3,
                  }}
                  numberOfLines={1}
                >
                  {game.homeTeam.name}
                </Text>
                {game.homeTeam.record ? (
                  <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '500', marginTop: 1 }}>
                    {game.homeTeam.record}
                  </Text>
                ) : null}
              </View>
              <Text style={{
                color: homeWinning ? '#FFFFFF' : 'rgba(255,255,255,0.45)',
                fontSize: 22,
                fontWeight: homeWinning ? '900' : '600',
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
      });
    }
    setShowConfirmModal(false);
    setPendingSelection(null);
  }, [pendingSelection, game.id, makePick]);

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
        pickStats={pickStats}
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
      {/* Premium dark glass container with deep shadows */}
      <View style={styles.cardShadowContainer}>
        {/* Inner card with subtle glass border */}
        <View style={styles.cardInnerBorder}>
        {/* Premium dark glass card */}
        <View style={{ position: 'relative' }}>
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
                  backgroundColor: sportMeta.color,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  marginRight: 6,
                  borderWidth: 1,
                  borderColor: '#FFFFFF40',
                }}
              >
                <Text style={{ color: sportMeta.accentColor, fontSize: 10, fontWeight: '700' }}>
                  {game.sport}
                </Text>
              </View>
              {/* FAV Badge - moved to header */}
              {(isFavoriteAway || isFavoriteHome) ? (
                <View
                  style={{
                    backgroundColor: 'rgba(232, 147, 106, 0.3)',
                    paddingHorizontal: 6,
                    paddingVertical: 3,
                    borderRadius: 5,
                    marginRight: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: '#E8936A',
                  }}
                >
                  <Star size={8} color="#E8936A" fill="#E8936A" />
                  <Text style={{ color: '#E8936A', fontSize: 9, fontWeight: '700', marginLeft: 3 }}>
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
                      fontSize: 13,
                      fontWeight: '700',
                      color: userPrediction?.pickedTeam === 'away' ? '#E8936A' : '#FFFFFF',
                      ...(isAwayLoser ? { opacity: 0.35, color: '#555' } : {}),
                    }}
                    numberOfLines={1}
                  >
                    {game.awayTeam.name}
                  </Text>
                  <Text
                    style={{ color: 'rgba(255,255,255,0.75)', fontSize: 9, marginTop: 1, ...(isAwayLoser ? { opacity: 0.35 } : {}) }}
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
                      fontSize: 13,
                      fontWeight: '700',
                      color: userPrediction?.pickedTeam === 'home' ? '#E8936A' : '#FFFFFF',
                      ...(isHomeLoser ? { opacity: 0.35, color: '#555' } : {}),
                    }}
                    numberOfLines={1}
                  >
                    {game.homeTeam.name}
                  </Text>
                  <Text
                    style={{ color: 'rgba(255,255,255,0.75)', fontSize: 9, marginTop: 1, ...(isHomeLoser ? { opacity: 0.35 } : {}) }}
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

          {/* Pick Split - Real community data */}
          <View style={styles.fanMomentumSection}>
            {pickStats.totalPicks > 0 ? (
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
                      PICK SPLIT
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
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <TrendingUp size={10} color="rgba(255,255,255,0.3)" />
                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: '600', marginLeft: 6 }}>
                  Be first to pick
                </Text>
              </View>
            )}
          </View>

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
                    : game.prediction.confidence >= 75 ? '#E8936A60' : 'rgba(255,255,255,0.16)',
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
                        EVEN
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
                    {game.spread !== undefined ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                        <TrendingUp size={10} color="#E0E0E0" />
                        <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginLeft: 4 }}>
                          {marketFavoriteTeam.abbreviation} {game.spread > 0 ? '-' : '+'}{Math.abs(game.spread)}
                        </Text>
                      </View>
                    ) : null}

                    {game.overUnder !== undefined ? (
                      <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                        <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>
                          O/U {game.overUnder}
                        </Text>
                      </View>
                    ) : null}

                    {game.tvChannel ? (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          handleTvChannelPress(game.tvChannel!);
                        }}
                        activeOpacity={0.7}
                        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(90,122,138,0.6)', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(90,122,138,0.8)' }}
                      >
                        <Tv size={10} color="#FFFFFF" />
                        <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '600', marginLeft: 4 }}>{game.tvChannel}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
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
                  <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(232,147,106,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 14 }}>🔒</Text>
                  </View>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700' }}>AI Pick Available</Text>
                </View>
                <View style={{ backgroundColor: '#E8936A', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
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
    backgroundColor: '#E8936A',
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
    backgroundColor: '#E8936A',
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
  // GameCard main card
  cardShadowContainer: {
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.8,
    shadowRadius: 24,
    elevation: 24,
  },
  cardInnerBorder: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  cardOverflowContainer: {
    overflow: 'hidden',
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
