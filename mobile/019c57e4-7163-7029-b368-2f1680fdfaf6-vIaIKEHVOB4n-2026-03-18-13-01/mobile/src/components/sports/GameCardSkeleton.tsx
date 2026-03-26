import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

// Single skeleton shape — a rounded rectangle with pulse animation
function SkeletonRect({
  width,
  height,
  borderRadius = 6,
  style,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: object;
}) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.8, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
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

export function GameCardSkeleton() {
  return (
    <View style={styles.card}>
      {/* Header row: sport badge pill (left) + status badge pill (right) */}
      <View style={styles.headerRow}>
        <SkeletonRect width={48} height={20} borderRadius={5} />
        <SkeletonRect width={56} height={20} borderRadius={5} />
      </View>

      {/* Teams section */}
      <View style={styles.teamsRow}>
        {/* Away team: jersey circle + abbrev text + record text */}
        <View style={styles.teamCol}>
          <SkeletonRect width={52} height={52} borderRadius={10} />
          <SkeletonRect width={36} height={12} borderRadius={4} style={{ marginTop: 8 }} />
          <SkeletonRect width={28} height={10} borderRadius={4} style={{ marginTop: 4 }} />
        </View>

        {/* Center: VS block */}
        <View style={styles.centerCol}>
          <SkeletonRect width={48} height={40} borderRadius={10} />
        </View>

        {/* Home team: jersey circle + abbrev text + record text */}
        <View style={styles.teamCol}>
          <SkeletonRect width={52} height={52} borderRadius={10} />
          <SkeletonRect width={36} height={12} borderRadius={4} style={{ marginTop: 8 }} />
          <SkeletonRect width={28} height={10} borderRadius={4} style={{ marginTop: 4 }} />
        </View>
      </View>

      {/* Bottom section: confidence badge strip */}
      <View style={styles.bottomSection}>
        <SkeletonRect width="100%" height={38} borderRadius={10} />
      </View>

      {/* Spread/odds row */}
      <View style={styles.oddsRow}>
        <SkeletonRect width={90} height={28} borderRadius={8} />
        <View style={styles.oddsRight}>
          <SkeletonRect width={64} height={28} borderRadius={8} />
          <SkeletonRect width={56} height={28} borderRadius={8} />
        </View>
      </View>
    </View>
  );
}

export function GameCardSkeletonList() {
  return (
    <View>
      <GameCardSkeleton />
      <View style={styles.spacer} />
      <GameCardSkeleton />
      <View style={styles.spacer} />
      <GameCardSkeleton />
      <View style={styles.spacer} />
      <GameCardSkeleton />
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
