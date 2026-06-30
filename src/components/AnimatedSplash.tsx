import React, { useEffect, useRef } from 'react';
import { View, Image, Dimensions, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function triggerArrivalHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

function triggerExitHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function SplashLogo() {
  const logoWidth = SCREEN_WIDTH * 0.52;
  return (
    <Image
      source={require('@/assets/clutch-logo.png')}
      style={{ width: logoWidth, height: logoWidth * (1275 / 2017) }}
      resizeMode="contain"
    />
  );
}

interface AnimatedSplashProps {
  isLoading: boolean;
  onAnimationComplete: () => void;
  children: React.ReactNode;
}

export function AnimatedSplash({ isLoading, onAnimationComplete, children }: AnimatedSplashProps) {
  const hasExitedRef = useRef(false);

  // Logo is FULLY VISIBLE from frame 1 — opacity 1, scale 1.
  // It stays visible the entire loading phase.
  // When loading completes, it exits cinematically.
  const logoScale   = useSharedValue(1);
  const logoOpacity = useSharedValue(1);

  // Black overlay covers app content until the exit is done
  const bgOpacity = useSharedValue(1);

  // App content fades in as the overlay fades out
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isLoading && !hasExitedRef.current) {
      hasExitedRef.current = true;

      // ── Arrival haptic fires immediately when loading is done ─────────────
      // This gives the "brand moment" feel — a medium impact as the logo
      // is about to exit, like a stamp of confidence.
      triggerArrivalHaptic();

      // ── Exit sequence ─────────────────────────────────────────────────────
      // Hold for 600ms so the logo gets its moment, then:
      // - Logo scales up to 1.08 and dissolves over 600ms
      // - Background overlay fades out simultaneously
      // - App content fades in underneath
      // Total duration: ~1.3s — cinematic, not rushed.

      // Light haptic fires as the exit begins (at the 600ms hold mark)
      const exitHapticTimer = setTimeout(triggerExitHaptic, 600);

      // Logo exit: hold 600ms, then scale up + fade out over 600ms
      logoOpacity.value = withDelay(
        600,
        withTiming(0, { duration: 600, easing: Easing.in(Easing.cubic) })
      );
      logoScale.value = withDelay(
        600,
        withTiming(1.08, { duration: 650, easing: Easing.in(Easing.cubic) })
      );

      // Background overlay fades out with the logo
      bgOpacity.value = withDelay(
        580,
        withTiming(0, { duration: 640, easing: Easing.out(Easing.cubic) })
      );

      // App content fades in as the overlay clears
      contentOpacity.value = withDelay(
        620,
        withTiming(1, { duration: 580, easing: Easing.out(Easing.cubic) }, () => {
          runOnJS(onAnimationComplete)();
        })
      );

      return () => {
        clearTimeout(exitHapticTimer);
      };
    }
  }, [bgOpacity, contentOpacity, isLoading, logoOpacity, logoScale, onAnimationComplete]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const bgStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  return (
    <View style={styles.container}>
      {/* App content underneath */}
      <Animated.View style={[styles.contentContainer, contentStyle]}>
        {children}
      </Animated.View>

      {/* Black background overlay */}
      <Animated.View style={[styles.splashBg, bgStyle]} pointerEvents="none" />

      {/* Centered logo — always visible during loading */}
      <Animated.View style={[styles.logoWrapper, logoStyle]} pointerEvents="none">
        <SplashLogo />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  contentContainer: {
    flex: 1,
  },
  splashBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 50,
  },
  logoWrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AnimatedSplash;
