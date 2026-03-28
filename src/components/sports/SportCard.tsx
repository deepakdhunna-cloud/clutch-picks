import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect } from 'react';
import Animated, {
  FadeInRight,
  withSpring,
  withTiming,
  withSequence,
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Sport, SPORT_META } from '@/types/sports';
import Svg, { Path, Circle, Ellipse, Line } from 'react-native-svg';
interface SportCardProps {
  sport: Sport;
  gameCount: number;
  index?: number;
  compact?: boolean;
  onPress?: () => void;
  isSelected?: boolean;
}

// NFL Icon - Football oval with laces, 3D shading - memoized
const FootballHelmetIcon = memo(function FootballHelmetIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Cast shadow on ground */}
      <Ellipse cx="25" cy="40" rx="10" ry="2.5" fill="black" fillOpacity="0.25" />
      {/* Dark edge / depth offset */}
      <Ellipse cx="24.6" cy="24.6" rx="14" ry="9.5" stroke={color} strokeWidth="2.5" strokeOpacity="0.25" />
      {/* Main ball */}
      <Ellipse cx="24" cy="24" rx="14" ry="9.5" stroke={color} strokeWidth="2.5" />
      {/* Highlight crescent */}
      <Path d="M12 20C14 17 18 15.5 22 15.5" stroke={color} strokeWidth="1.5" strokeOpacity="0.5" strokeLinecap="round" />
      {/* Seam */}
      <Line x1="24" y1="14.5" x2="24" y2="33.5" stroke={color} strokeWidth="2" strokeOpacity="0.85" />
      {/* Lace top */}
      <Line x1="20" y1="19" x2="28" y2="19" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      {/* Lace mid */}
      <Line x1="20" y1="24" x2="28" y2="24" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.7" />
      {/* Lace bot */}
      <Line x1="20" y1="29" x2="28" y2="29" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.4" />
      {/* Hot spot */}
      <Ellipse cx="18" cy="18" rx="3" ry="1.8" fill={color} fillOpacity="0.18" />
    </Svg>
  );
});

// NBA Icon - Basketball circle with seams, 3D - memoized
const BasketballHoopIcon = memo(function BasketballHoopIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Cast shadow */}
      <Ellipse cx="25" cy="41" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      {/* Dark edge offset */}
      <Circle cx="24.6" cy="24.6" r="14" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      {/* Main ball */}
      <Circle cx="24" cy="24" r="14" stroke={color} strokeWidth="2.5" />
      {/* Crescent highlight */}
      <Path d="M13 16C16 12 20 11 24 11" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      {/* Vertical seam */}
      <Line x1="24" y1="10" x2="24" y2="38" stroke={color} strokeWidth="1.8" strokeOpacity="0.8" />
      {/* Horizontal seam */}
      <Line x1="10" y1="24" x2="38" y2="24" stroke={color} strokeWidth="1.8" strokeOpacity="0.7" />
      {/* Left curve */}
      <Path d="M16 12C19 18 19 30 16 36" stroke={color} strokeWidth="1.6" strokeOpacity="0.7" />
      {/* Right curve */}
      <Path d="M32 12C29 18 29 30 32 36" stroke={color} strokeWidth="1.6" strokeOpacity="0.35" />
      {/* Hot spot */}
      <Circle cx="17" cy="16" r="3.5" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

// MLB Icon - Baseball with stitching, 3D - memoized
const BaseballBatIcon = memo(function BaseballBatIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Cast shadow */}
      <Ellipse cx="25" cy="41" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      {/* Dark edge offset */}
      <Circle cx="24.6" cy="24.6" r="14" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      {/* Main ball */}
      <Circle cx="24" cy="24" r="14" stroke={color} strokeWidth="2.5" />
      {/* Crescent highlight */}
      <Path d="M13 16C16 12 20 11 24 11" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      {/* Left stitch curve */}
      <Path d="M14 13C18 18 18 30 14 35" stroke={color} strokeWidth="1.6" strokeOpacity="0.75" />
      {/* Right stitch curve */}
      <Path d="M34 13C30 18 30 30 34 35" stroke={color} strokeWidth="1.6" strokeOpacity="0.4" />
      {/* Left stitch marks */}
      <Line x1="12.5" y1="17" x2="16" y2="16" stroke={color} strokeWidth="1.2" strokeOpacity="0.8" />
      <Line x1="12" y1="21" x2="15.5" y2="20.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.7" />
      <Line x1="12" y1="25" x2="15.5" y2="25" stroke={color} strokeWidth="1.2" strokeOpacity="0.6" />
      <Line x1="12" y1="29" x2="15.5" y2="29.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.5" />
      <Line x1="12.5" y1="33" x2="16" y2="33.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.4" />
      {/* Right stitch marks */}
      <Line x1="35.5" y1="17" x2="32" y2="16" stroke={color} strokeWidth="1.2" strokeOpacity="0.45" />
      <Line x1="36" y1="21" x2="32.5" y2="20.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.38" />
      <Line x1="36" y1="25" x2="32.5" y2="25" stroke={color} strokeWidth="1.2" strokeOpacity="0.3" />
      <Line x1="36" y1="29" x2="32.5" y2="29.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.25" />
      <Line x1="35.5" y1="33" x2="32" y2="33.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.2" />
      {/* Hot spot */}
      <Circle cx="17" cy="16" r="3.5" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

// NHL Icon - Hockey stick + puck, 3D - memoized
const HockeyStickIcon = memo(function HockeyStickIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Stick shadow offset */}
      <Path d="M16.5 7L16.5 31L11.5 35.5L11.5 39L23.5 39L23.5 35.5L18.5 31L18.5 7" stroke="black" strokeWidth="2.5" strokeOpacity="0.15" strokeLinejoin="round" />
      {/* Stick */}
      <Path d="M15 6L15 30L10 34.5L10 38L22 38L22 34.5L17 30L17 6" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {/* Tape lines */}
      <Line x1="15" y1="10" x2="17" y2="10" stroke={color} strokeWidth="1.8" strokeOpacity="0.7" />
      <Line x1="15" y1="13" x2="17" y2="13" stroke={color} strokeWidth="1.8" strokeOpacity="0.55" />
      <Line x1="15" y1="16" x2="17" y2="16" stroke={color} strokeWidth="1.8" strokeOpacity="0.4" />
      {/* Puck shadow */}
      <Ellipse cx="35" cy="40" rx="8" ry="2" fill="black" fillOpacity="0.2" />
      {/* Puck dark bottom edge */}
      <Ellipse cx="34.5" cy="36.5" rx="8" ry="3.5" stroke={color} strokeWidth="2" strokeOpacity="0.3" />
      {/* Puck sides */}
      <Line x1="26.5" y1="33" x2="26.5" y2="36.5" stroke={color} strokeWidth="2" strokeOpacity="0.5" />
      <Line x1="42.5" y1="33" x2="42.5" y2="36.5" stroke={color} strokeWidth="2" strokeOpacity="0.2" />
      {/* Puck top */}
      <Ellipse cx="34" cy="32.5" rx="8" ry="3.5" stroke={color} strokeWidth="2.2" />
      {/* Puck shine */}
      <Ellipse cx="30" cy="31.5" rx="3.5" ry="1.2" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

// MLS Icon - Soccer ball, 3D - memoized
const SoccerCleatIcon = memo(function SoccerCleatIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Cast shadow */}
      <Ellipse cx="25" cy="41" rx="9.5" ry="2" fill="black" fillOpacity="0.25" />
      {/* Dark edge offset */}
      <Circle cx="24.6" cy="24.6" r="14.5" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      {/* Main ball */}
      <Circle cx="24" cy="24" r="14.5" stroke={color} strokeWidth="2.5" />
      {/* Crescent highlight */}
      <Path d="M12 16C15 12 19 10.5 23 10.5" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      {/* Center pentagon */}
      <Path d="M24 15L18.5 19L20.5 26L27.5 26L29.5 19Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeOpacity="0.85" />
      {/* Lines from pentagon to edge */}
      <Line x1="24" y1="15" x2="24" y2="9.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.8" />
      <Line x1="18.5" y1="19" x2="11" y2="16" stroke={color} strokeWidth="1.2" strokeOpacity="0.7" />
      <Line x1="29.5" y1="19" x2="37" y2="16" stroke={color} strokeWidth="1.2" strokeOpacity="0.45" />
      <Line x1="20.5" y1="26" x2="15" y2="34" stroke={color} strokeWidth="1.2" strokeOpacity="0.5" />
      <Line x1="27.5" y1="26" x2="33" y2="34" stroke={color} strokeWidth="1.2" strokeOpacity="0.3" />
      {/* Hot spot */}
      <Circle cx="17" cy="16" r="3.5" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

// NCAAF Icon - Football + star, 3D - memoized
const CollegeFootballIcon = memo(function CollegeFootballIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Star above */}
      <Path d="M24 2L25.8 6.5L30.5 6.5L26.8 9.2L28 13.5L24 10.8L20 13.5L21.2 9.2L17.5 6.5L22.2 6.5Z" fill={color} />
      {/* Cast shadow */}
      <Ellipse cx="25" cy="43" rx="10" ry="2.5" fill="black" fillOpacity="0.25" />
      {/* Dark edge offset */}
      <Ellipse cx="24.6" cy="28.6" rx="14.5" ry="9.5" stroke={color} strokeWidth="2.5" strokeOpacity="0.25" />
      {/* Main ball */}
      <Ellipse cx="24" cy="28" rx="14.5" ry="9.5" stroke={color} strokeWidth="2.5" />
      {/* Highlight crescent */}
      <Path d="M11 24C13 21 17 19.5 21 19.5" stroke={color} strokeWidth="1.5" strokeOpacity="0.5" strokeLinecap="round" />
      {/* Seam */}
      <Line x1="24" y1="18.5" x2="24" y2="37.5" stroke={color} strokeWidth="2" strokeOpacity="0.85" />
      {/* Lace top */}
      <Line x1="20" y1="23" x2="28" y2="23" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      {/* Lace mid */}
      <Line x1="20" y1="28" x2="28" y2="28" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.7" />
      {/* Lace bot */}
      <Line x1="20" y1="33" x2="28" y2="33" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.4" />
      {/* Hot spot */}
      <Ellipse cx="17" cy="22" rx="3" ry="1.8" fill={color} fillOpacity="0.18" />
    </Svg>
  );
});

// NCAAB Icon - Basketball + star, 3D - memoized
const CollegeBasketballIcon = memo(function CollegeBasketballIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Star */}
      <Path d="M24 0.5L25.5 4L29.5 4L26.2 6.3L27.2 10L24 7.5L20.8 10L21.8 6.3L18.5 4L22.5 4Z" fill={color} />
      {/* Cast shadow */}
      <Ellipse cx="25" cy="43" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      {/* Dark edge offset */}
      <Circle cx="24.6" cy="27.6" r="14" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      {/* Main ball */}
      <Circle cx="24" cy="27" r="14" stroke={color} strokeWidth="2.5" />
      {/* Crescent highlight */}
      <Path d="M13 19C16 15 20 14 24 14" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      {/* Vertical seam */}
      <Line x1="24" y1="13" x2="24" y2="41" stroke={color} strokeWidth="1.8" strokeOpacity="0.8" />
      {/* Horizontal seam */}
      <Line x1="10" y1="27" x2="38" y2="27" stroke={color} strokeWidth="1.8" strokeOpacity="0.7" />
      {/* Left curve */}
      <Path d="M13 15C18 20 18 34 13 39" stroke={color} strokeWidth="1.6" strokeOpacity="0.7" />
      {/* Right curve */}
      <Path d="M35 15C30 20 30 34 35 39" stroke={color} strokeWidth="1.6" strokeOpacity="0.35" />
      {/* Hot spot */}
      <Circle cx="17" cy="19" r="3.5" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

// EPL Icon - Soccer ball + crown, 3D - memoized
const PremierLeagueIcon = memo(function PremierLeagueIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Crown */}
      <Path d="M14 7.5L18 12L24 6.5L30 12L34 7.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Crown jewels */}
      <Circle cx="14" cy="7.5" r="1.3" fill={color} />
      <Circle cx="24" cy="6.5" r="1.3" fill={color} />
      <Circle cx="34" cy="7.5" r="1.3" fill={color} />
      {/* Cast shadow */}
      <Ellipse cx="25" cy="43" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      {/* Dark edge offset */}
      <Circle cx="24.6" cy="27.6" r="13.5" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      {/* Main ball */}
      <Circle cx="24" cy="27" r="13.5" stroke={color} strokeWidth="2.5" />
      {/* Crescent highlight */}
      <Path d="M13 19C16 15 20 14 24 14" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      {/* Center pentagon */}
      <Path d="M24 18.5L18.5 22.5L20.5 29.5L27.5 29.5L29.5 22.5Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeOpacity="0.85" />
      {/* Lines from pentagon to edge */}
      <Line x1="24" y1="18.5" x2="24" y2="13.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.8" />
      <Line x1="18.5" y1="22.5" x2="11" y2="19" stroke={color} strokeWidth="1.2" strokeOpacity="0.7" />
      <Line x1="29.5" y1="22.5" x2="37" y2="19" stroke={color} strokeWidth="1.2" strokeOpacity="0.45" />
      <Line x1="20.5" y1="29.5" x2="15" y2="37" stroke={color} strokeWidth="1.2" strokeOpacity="0.5" />
      <Line x1="27.5" y1="29.5" x2="33" y2="37" stroke={color} strokeWidth="1.2" strokeOpacity="0.3" />
      {/* Hot spot */}
      <Circle cx="17" cy="19" r="3" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

// Get the appropriate sport icon for each sport
export function getSportIcon(sport: Sport, size: number, color: string) {
  switch (sport) {
    case Sport.NFL:
      return <FootballHelmetIcon size={size} color={color} />;
    case Sport.NBA:
      return <BasketballHoopIcon size={size} color={color} />;
    case Sport.MLB:
      return <BaseballBatIcon size={size} color={color} />;
    case Sport.NHL:
      return <HockeyStickIcon size={size} color={color} />;
    case Sport.MLS:
      return <SoccerCleatIcon size={size} color={color} />;
    case Sport.EPL:
      return <PremierLeagueIcon size={size} color={color} />;
    case Sport.NCAAF:
      return <CollegeFootballIcon size={size} color={color} />;
    case Sport.NCAAB:
      return <CollegeBasketballIcon size={size} color={color} />;
    default:
      return <SoccerCleatIcon size={size} color={color} />;
  }
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const SportCard = memo(function SportCard({ sport, gameCount, index = 0, compact = false, onPress, isSelected = false }: SportCardProps) {
  const router = useRouter();
  const meta = SPORT_META[sport];
  const baseColor = meta.color;

  const handlePress = useCallback(() => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/sport/${sport}` as any);
    }
  }, [onPress, router, sport]);

  // Animation values
  const scale = useSharedValue(1);
  const selectionProgress = useSharedValue(isSelected ? 1 : 0);
  const glowPulse = useSharedValue(1);

  // Animate selection state change
  useEffect(() => {
    if (isSelected) {
      // Bounce effect when selected
      scale.value = withSequence(
        withSpring(1.15, { damping: 8, stiffness: 400 }),
        withSpring(1, { damping: 12, stiffness: 300 })
      );
      selectionProgress.value = withSpring(1, { damping: 15, stiffness: 200 });
      // Start glow pulse
      glowPulse.value = withSequence(
        withTiming(1.3, { duration: 200, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) })
      );
    } else {
      selectionProgress.value = withSpring(0, { damping: 15, stiffness: 200 });
    }
  }, [isSelected, scale, selectionProgress, glowPulse]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const orbAnimatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(selectionProgress.value, [0, 1], [0, -3]);
    return {
      transform: [{ translateY }],
    };
  });

  if (compact) {
    // Alternating teal/maroon tint — teal for even index, maroon for odd
    const isTealDefault = index % 2 === 0;
    // When selected, swap: teal defaults become maroon, maroon defaults become teal
    const accentColor = isSelected
      ? (isTealDefault ? '#8B0A1F' : '#7A9DB8')
      : (isTealDefault ? '#7A9DB8' : '#8B0A1F');
    const tintBg = isSelected
      ? (isTealDefault ? 'rgba(139,10,31,0.08)' : 'rgba(122,157,184,0.08)')
      : (isTealDefault ? 'rgba(122,157,184,0.10)' : 'rgba(139,10,31,0.10)');
    const borderC = isSelected
      ? (isTealDefault ? 'rgba(139,10,31,0.30)' : 'rgba(122,157,184,0.30)')
      : (isTealDefault ? 'rgba(122,157,184,0.20)' : 'rgba(139,10,31,0.20)');
    const accentBarColor = isSelected
      ? (isTealDefault ? '#8B0A1F' : '#7A9DB8')
      : (isTealDefault ? 'rgba(122,157,184,0.3)' : 'rgba(139,10,31,0.3)');
    const sportNameColor = isSelected
      ? (isTealDefault ? '#8B0A1F' : '#7A9DB8')
      : accentColor;

    return (
      <AnimatedPressable
        onPress={handlePress}
        onPressIn={() => { scale.value = withSpring(0.92, { damping: 15, stiffness: 300 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 300 }); }}
        style={[animatedStyle, { alignItems: 'center' as const }]}
      >
        <Animated.View style={[orbAnimatedStyle]}>
          <View
            style={{
              width: 62,
              height: 80,
              borderRadius: 14,
              overflow: 'hidden' as const,
              position: 'relative' as const,
              borderWidth: 1,
              borderColor: borderC,
            }}
          >
            <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
            {/* Tint background */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: tintBg }]} />

            {/* Accent line at top */}
            <View
              style={{
                position: 'absolute' as const,
                top: 0,
                left: 0,
                right: 0,
                height: 2.5,
                backgroundColor: accentBarColor,
                shadowColor: isSelected ? accentBarColor : 'transparent',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: isSelected ? 0.4 : 0,
                shadowRadius: isSelected ? 6 : 0,
                }}
              />

            {/* Perforation line near bottom */}
            <View
              style={{
                position: 'absolute' as const,
                bottom: 8,
                left: 4,
                right: 4,
                height: 0,
                borderBottomWidth: 1,
                borderStyle: 'dashed' as const,
                borderBottomColor: 'rgba(255,255,255,0.06)',
              }}
            />

            {/* Zigzag torn edge */}
            <View
              style={{
                position: 'absolute' as const,
                bottom: 0,
                left: 0,
                right: 0,
                height: 6,
                backgroundColor: '#040608',
              }}
            >
              <View style={{ flexDirection: 'row' as const, position: 'absolute' as const, top: -3, left: 0, right: 0 }}>
                {Array.from({ length: 11 }).map((_, i) => (
                  <View
                    key={i}
                    style={{
                      width: 0,
                      height: 0,
                      borderLeftWidth: 3,
                      borderRightWidth: 3,
                      borderTopWidth: 5,
                      borderLeftColor: 'transparent',
                      borderRightColor: 'transparent',
                      borderTopColor: '#040608',
                    }}
                  />
                ))}
              </View>
            </View>

            {/* Sport name */}
            <View style={{ alignItems: 'center' as const, paddingTop: 12 }}>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '800',
                  letterSpacing: 1,
                  color: sportNameColor,
                }}
              >
                {sport === 'NCAAF' ? 'CFB' : sport === 'NCAAB' ? 'CBB' : sport}
              </Text>
            </View>

            {/* Game count */}
            <View style={{ alignItems: 'center' as const, marginTop: 2 }}>
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: '900',
                  color: isSelected ? '#FFFFFF' : '#C8D4E0',
                  fontVariant: ['tabular-nums'] as any,
                }}
              >
                {gameCount}
              </Text>
            </View>

            {/* ADMIT ONE */}
            <View style={{ position: 'absolute' as const, bottom: 10, left: 0, right: 0, alignItems: 'center' as const }}>
              <Text
                style={{
                  fontSize: 5,
                  fontWeight: '900',
                  letterSpacing: 2,
                  color: isSelected ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)',
                }}
              >
                ADMIT ONE
              </Text>
            </View>
          </View>
        </Animated.View>
      </AnimatedPressable>
    );
  }

  // Full-size card with solid color
  return (
    <AnimatedPressable
      entering={FadeInRight.delay(index * 80).duration(500)}
      onPress={handlePress}
      className="mb-3 active:opacity-80"
    >
      <View
        style={{
          borderRadius: 16,
          backgroundColor: baseColor,
          flexDirection: 'row',
          alignItems: 'center',
          padding: 16,
          borderWidth: 3,
          borderColor: 'rgba(0,0,0,0.3)',
        }}
      >
        {/* Icon */}
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 16,
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.2)',
          }}
        >
          {getSportIcon(sport, 26, meta.accentColor)}
        </View>

        <View className="flex-1">
          <Text className="text-white font-semibold text-base">{meta.name}</Text>
          <View className="flex-row items-center mt-1">
            {meta.isCollege ? (
              <View
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 4,
                  marginRight: 8,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '500' }}>College</Text>
              </View>
            ) : null}
            <Text className="text-white/60 text-sm">{gameCount} games today</Text>
          </View>
        </View>

        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.2)',
          }}
        >
          <Text style={{ color: '#FFFFFF' }} className="font-bold text-sm">
            {gameCount}
          </Text>
        </View>
      </View>
    </AnimatedPressable>
  );
});

// Ticket color helper — used by index.tsx for Today's Games bar
export const TICKET_COLORS = ['#8B0A1F', '#8B0A1F', '#8B0A1F'];
export const TICKET_COLOR_MAP: Record<string, number> = {
  NBA: 0, NFL: 1, MLB: 2, NHL: 0, MLS: 1, EPL: 2, NCAAF: 0, NCAAB: 1,
};
export function getTicketColor(sport: string): string {
  return TICKET_COLORS[TICKET_COLOR_MAP[sport] ?? 0];
}
