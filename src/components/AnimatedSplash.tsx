import React, { useEffect, useRef } from 'react';
import { View, Image, Dimensions, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
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
  const hasStartedRef = useRef(false);

  // Logo starts fully visible and at rest — user sees it immediately
  const logoScale   = useSharedValue(1);
  const logoOpacity = useSharedValue(1);

  // Background overlay
  const bgOpacity = useSharedValue(1);

  // App content
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isLoading && !hasStartedRef.current) {
      hasStartedRef.current = true;

      // Haptic fires immediately as the exit begins — confirms the app is ready
      const arrivalHaptic = setTimeout(triggerArrivalHaptic, 80);

      // ── Hold (0 – 600ms) ────────────────────────────────────────────────────
      // Logo sits at full opacity — the user gets a clean, confident brand moment.

      // ── Exit (600 – 1100ms) ─────────────────────────────────────────────────
      // Logo scales up slightly and fades — cinematic dissolve, not a hard cut.
      logoOpacity.value = withDelay(
        600,
        withTiming(0, { duration: 420, easing: Easing.in(Easing.cubic) })
      );

      logoScale.value = withDelay(
        600,
        withTiming(1.1, { duration: 460, easing: Easing.in(Easing.cubic) })
      );

      const exitHaptic = setTimeout(triggerExitHaptic, 620);

      // Background and content cross-fade
      bgOpacity.value = withDelay(
        580,
        withTiming(0, { duration: 440, easing: Easing.out(Easing.cubic) })
      );

      contentOpacity.value = withDelay(
        620,
        withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }, () => {
          runOnJS(onAnimationComplete)();
        })
      );

      return () => {
        clearTimeout(arrivalHaptic);
        clearTimeout(exitHaptic);
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

      {/* Centered logo — always visible, no fade-in delay */}
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
