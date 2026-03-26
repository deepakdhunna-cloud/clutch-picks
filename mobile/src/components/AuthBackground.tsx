import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withDelay, withSequence, Easing, interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

const { width: W, height: H } = Dimensions.get('window');
const TEAL = '#7A9DB8';
const CORAL = '#E8936A';

// ─── Neon Streak ────────────────────────────────────────────────
// Static props go in a regular style, only opacity/translate are animated
function NeonStreak({ x, y, length, angle, color, delay, duration, maxOpacity }: {
  x: number; y: number; length: number; angle: number;
  color: string; delay: number; duration: number; maxOpacity: number;
}) {
  const progress = useSharedValue(0);
  // Capture maxOpacity as a shared value so the worklet can safely access it
  const maxOp = useSharedValue(maxOpacity);

  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }), -1, false
    ));
  }, []);

  // Only animate opacity and translate — position/size/rotation are static
  const animStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 0.4, 0.6, 0.85, 1],
      [0, 0.7 * maxOp.value, maxOp.value, maxOp.value, 0.7 * maxOp.value, 0]),
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-20, 20]) },
      { translateY: interpolate(progress.value, [0, 1], [-10, 10]) },
    ],
  }));

  const shadowOp = maxOpacity < 1 ? 0.4 : 0.8;
  const shadowR = maxOpacity < 1 ? 3 : 6;

  return (
    <Animated.View style={[{
      position: 'absolute', left: x, top: y,
      width: length, height: 2, borderRadius: 1,
      transform: [{ rotate: `${angle}deg` }],
    }, animStyle]}>
      <LinearGradient
        colors={['transparent', color, color, 'transparent']}
        locations={[0, 0.3, 0.7, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{
          flex: 1, borderRadius: 1,
          shadowColor: color, shadowOffset: { width: 0, height: 0 },
          shadowOpacity: shadowOp, shadowRadius: shadowR,
        }}
      />
    </Animated.View>
  );
}

// ─── Star Grain ─────────────────────────────────────────────────
// Only opacity and scale animate — position is static
function StarGrain({ x, y, size, delay, duration, maxOpacity }: {
  x: number; y: number; size: number; delay: number; duration: number; maxOpacity: number;
}) {
  const twinkle = useSharedValue(0);
  const maxOp = useSharedValue(maxOpacity);

  useEffect(() => {
    twinkle.value = withDelay(delay, withRepeat(
      withSequence(
        withTiming(1, { duration: duration * 0.4, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: duration * 0.6, easing: Easing.in(Easing.ease) }),
      ), -1, false
    ));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: interpolate(twinkle.value, [0, 1], [0.03, maxOp.value]),
    transform: [{ scale: interpolate(twinkle.value, [0, 1], [0.6, 1.2]) }],
  }));

  return (
    <Animated.View style={[{
      position: 'absolute', left: x, top: y,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: '#FFFFFF',
    }, animStyle]} />
  );
}

/**
 * Shared animated background for auth screens.
 * `faint` makes everything more subtle for sign-in/sign-up screens.
 */
export function AuthBackground({ faint = false }: { faint?: boolean }) {
  const streakOpacity = faint ? 0.5 : 1;
  const starOpacity = faint ? 0.25 : 0.5;

  const streaks = useMemo(() => [
    { x: W * 0.05, y: H * 0.12, length: 45, angle: -25, color: CORAL, delay: 0, duration: 3500 },
    { x: W * 0.75, y: H * 0.08, length: 35, angle: 15, color: CORAL, delay: 1200, duration: 4000 },
    { x: W * 0.55, y: H * 0.28, length: 30, angle: -40, color: CORAL, delay: 2800, duration: 3800 },
    { x: W * 0.15, y: H * 0.52, length: 40, angle: 20, color: CORAL, delay: 800, duration: 4200 },
    { x: W * 0.85, y: H * 0.62, length: 28, angle: -15, color: CORAL, delay: 3500, duration: 3600 },
    { x: W * 0.35, y: H * 0.06, length: 38, angle: 30, color: TEAL, delay: 600, duration: 4500 },
    { x: W * 0.88, y: H * 0.22, length: 32, angle: -35, color: TEAL, delay: 2000, duration: 3700 },
    { x: W * 0.02, y: H * 0.38, length: 42, angle: 10, color: TEAL, delay: 1500, duration: 4100 },
    { x: W * 0.65, y: H * 0.48, length: 25, angle: -20, color: TEAL, delay: 3200, duration: 3900 },
    { x: W * 0.25, y: H * 0.68, length: 35, angle: 35, color: TEAL, delay: 400, duration: 4300 },
    { x: W * 0.45, y: H * 0.78, length: 22, angle: -10, color: CORAL, delay: 2400, duration: 3400 },
    { x: W * 0.10, y: H * 0.85, length: 30, angle: 25, color: TEAL, delay: 1800, duration: 4000 },
  ], []);

  // Reduced to 15 stars instead of 30 for performance
  const stars = useMemo(() => {
    const seeds = [
      [0.08, 0.05], [0.45, 0.04], [0.91, 0.07],
      [0.31, 0.16], [0.82, 0.17],
      [0.12, 0.31], [0.71, 0.29], [0.18, 0.43],
      [0.07, 0.55], [0.63, 0.57],
      [0.27, 0.63], [0.78, 0.65], [0.56, 0.76],
      [0.33, 0.82], [0.81, 0.91],
    ];
    return seeds.map(([sx, sy], i) => ({
      x: W * sx,
      y: H * sy,
      size: 1.2 + (i % 3) * 0.6,
      delay: (i * 400) % 4000,
      duration: 2000 + (i % 5) * 600,
    }));
  }, []);

  return (
    <>
      {/* Base gradient */}
      <LinearGradient
        colors={['#0A0E1A', '#060810', '#040608', '#030406']}
        locations={[0, 0.3, 0.6, 1]}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Stars */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {stars.map((st, i) => <StarGrain key={`s${i}`} {...st} maxOpacity={starOpacity} />)}
      </View>

      {/* Neon streaks */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {streaks.map((sk, i) => <NeonStreak key={`n${i}`} {...sk} maxOpacity={streakOpacity} />)}
      </View>
    </>
  );
}
