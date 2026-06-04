/**
 * Shimmer — Reusable skeleton loading placeholder with animated shimmer effect.
 * Use for full-page or inline loading states to feel instant and intentional.
 */
import { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

interface ShimmerBarProps {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/** Single shimmer bar — a rounded rectangle with a sweeping highlight */
export function ShimmerBar({ width, height, borderRadius = 8, style }: ShimmerBarProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-120, 120]) }],
  }));

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: 'rgba(255,255,255,0.04)',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: 120 }, animatedStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.06)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

/** Full-page skeleton for list screens (e.g., followers, live-games) */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={{ flex: 1, padding: 16, gap: 14 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ShimmerBar width={44} height={44} borderRadius={22} />
          <View style={{ flex: 1, gap: 8 }}>
            <ShimmerBar width="70%" height={14} />
            <ShimmerBar width="45%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Full-page skeleton for card-based screens (e.g., game analysis) */
export function CardSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <View style={{ flex: 1, padding: 16, gap: 16 }}>
      {Array.from({ length: cards }).map((_, i) => (
        <View key={i} style={{ borderRadius: 16, padding: 16, backgroundColor: 'rgba(255,255,255,0.02)', gap: 12 }}>
          <ShimmerBar width="60%" height={16} />
          <ShimmerBar width="100%" height={80} borderRadius={12} />
          <ShimmerBar width="40%" height={12} />
        </View>
      ))}
    </View>
  );
}
