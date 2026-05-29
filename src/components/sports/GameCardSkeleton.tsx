import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  cancelAnimation,
} from 'react-native-reanimated';

// Single skeleton shape — a rounded rectangle with pulse animation.
// Reads a single shared pulse value driven once at the list level (no
// per-instance animation loop) so a full skeleton list runs one UI-thread loop.
function SkeletonRect({
  width,
  height,
  borderRadius = 6,
  style,
  pulse,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: object;
  pulse: Animated.SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.4, 0.8]),
  }));

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: '#2A2A2A',
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

export function GameCardSkeleton({ pulse }: { pulse: Animated.SharedValue<number> }) {
  return (
    <View style={styles.card}>
      {/* Header row: sport badge pill (left) + status badge pill (right) */}
      <View style={styles.headerRow}>
        <SkeletonRect pulse={pulse} width={48} height={20} borderRadius={5} />
        <SkeletonRect pulse={pulse} width={56} height={20} borderRadius={5} />
      </View>

      {/* Teams section */}
      <View style={styles.teamsRow}>
        {/* Away team: jersey circle + abbrev text + record text */}
        <View style={styles.teamCol}>
          <SkeletonRect pulse={pulse} width={52} height={52} borderRadius={10} />
          <SkeletonRect pulse={pulse} width={36} height={12} borderRadius={4} style={{ marginTop: 8 }} />
          <SkeletonRect pulse={pulse} width={28} height={10} borderRadius={4} style={{ marginTop: 4 }} />
        </View>

        {/* Center: VS block */}
        <View style={styles.centerCol}>
          <SkeletonRect pulse={pulse} width={48} height={40} borderRadius={10} />
        </View>

        {/* Home team: jersey circle + abbrev text + record text */}
        <View style={styles.teamCol}>
          <SkeletonRect pulse={pulse} width={52} height={52} borderRadius={10} />
          <SkeletonRect pulse={pulse} width={36} height={12} borderRadius={4} style={{ marginTop: 8 }} />
          <SkeletonRect pulse={pulse} width={28} height={10} borderRadius={4} style={{ marginTop: 4 }} />
        </View>
      </View>

      {/* Bottom section: confidence badge strip */}
      <View style={styles.bottomSection}>
        <SkeletonRect pulse={pulse} width="100%" height={38} borderRadius={10} />
      </View>

      {/* Spread/odds row */}
      <View style={styles.oddsRow}>
        <SkeletonRect pulse={pulse} width={90} height={28} borderRadius={8} />
        <View style={styles.oddsRight}>
          <SkeletonRect pulse={pulse} width={64} height={28} borderRadius={8} />
          <SkeletonRect pulse={pulse} width={56} height={28} borderRadius={8} />
        </View>
      </View>
    </View>
  );
}

export function GameCardSkeletonList() {
  // Single UI-thread shimmer driver shared by every skeleton rect in the list.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  return (
    <View>
      <GameCardSkeleton pulse={pulse} />
      <View style={styles.spacer} />
      <GameCardSkeleton pulse={pulse} />
      <View style={styles.spacer} />
      <GameCardSkeleton pulse={pulse} />
      <View style={styles.spacer} />
      <GameCardSkeleton pulse={pulse} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 12,
    marginBottom: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  teamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  teamCol: {
    flex: 1,
    alignItems: 'center',
  },
  centerCol: {
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomSection: {
    marginBottom: 8,
  },
  oddsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  oddsRight: {
    flexDirection: 'row',
    gap: 6,
  },
  spacer: {
    height: 20,
  },
});
