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

      // ── Exit sequence (fires as soon as loading is done) ──────────────────
      // Brief pause so the logo doesn't immediately vanish, then cinematic exit:
      // logo scales up slightly and dissolves — feels premium, not abrupt.

      const hapticTimer = setTimeout(triggerExitHaptic, 80);

      // Logo: hold for 320ms, then scale up to 1.1 and fade out over 420ms
      logoOpacity.value = withDelay(
        320,
        withTiming(0, { duration: 420, easing: Easing.in(Easing.cubic) })
      );
      logoScale.value = withDelay(
        320,
        withTiming(1.1, { duration: 460, easing: Easing.in(Easing.cubic) })
      );

      // Background overlay fades out simultaneously with the logo exit
      bgOpacity.value = withDelay(
        300,
        withTiming(0, { duration: 440, easing: Easing.out(Easing.cubic) })
      );

      // App content fades in as the overlay clears
      contentOpacity.value = withDelay(
        340,
        withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }, () => {
          runOnJS(onAnimationComplete)();
        })
      );

      return () => {
        clearTimeout(hapticTimer);
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
