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

  // Logo starts small and invisible — arrives cinematically
  const logoScale   = useSharedValue(0.78);
  const logoOpacity = useSharedValue(0);

  // Background overlay
  const bgOpacity = useSharedValue(1);

  // App content
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isLoading && !hasStartedRef.current) {
      hasStartedRef.current = true;

      // ── Phase 1: Arrival (0 – 680ms) ───────────────────────────────────────
      // Logo fades in and scales up from 0.78 → 1.0 with a gentle ease-out-back
      // curve — just enough spring to feel alive and intentional.
      logoOpacity.value = withTiming(1, {
        duration: 600,
        easing: Easing.out(Easing.cubic),
      });

      logoScale.value = withTiming(1, {
        duration: 680,
        easing: Easing.out(Easing.back(1.08)),
      });

      // Haptic fires as the logo settles into place
      const arrivalHaptic = setTimeout(triggerArrivalHaptic, 560);

      // ── Phase 2: Hold (680 – 1200ms) ───────────────────────────────────────
      // Logo sits confidently for ~520ms — the brand gets its moment.

      // ── Phase 3: Exit (1200 – 1660ms) ──────────────────────────────────────
      // Logo scales up slightly and dissolves — cinematic, not a hard cut.
      logoOpacity.value = withDelay(
        1160,
        withTiming(0, { duration: 380, easing: Easing.in(Easing.cubic) })
      );

      logoScale.value = withDelay(
        1160,
        withTiming(1.1, { duration: 420, easing: Easing.in(Easing.cubic) })
      );

      const exitHaptic = setTimeout(triggerExitHaptic, 1180);

      // Background and content cross-fade simultaneously
      bgOpacity.value = withDelay(
        1140,
        withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) })
      );

      contentOpacity.value = withDelay(
        1180,
        withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }, () => {
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

      {/* Centered logo */}
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
