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

// ─── Haptics ─────────────────────────────────────────────────────────────────

function triggerArrivalHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

function triggerExitHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

interface AnimatedSplashProps {
  isLoading: boolean;
  onAnimationComplete: () => void;
  children: React.ReactNode;
}

export function AnimatedSplash({ isLoading, onAnimationComplete, children }: AnimatedSplashProps) {
  const hasStartedRef = useRef(false);

  // Logo
  const logoScale   = useSharedValue(0.82);
  const logoOpacity = useSharedValue(0);

  // Ambient glow ring behind logo
  const glowScale   = useSharedValue(0.6);
  const glowOpacity = useSharedValue(0);

  // Full-screen flash on exit
  const flashOpacity = useSharedValue(0);

  // Background overlay
  const bgOpacity = useSharedValue(1);

  // App content
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isLoading && !hasStartedRef.current) {
      hasStartedRef.current = true;

      // ── Phase 1: Logo arrives (0 – 520ms) ──────────────────────────────────
      // Soft ease-in from slightly below scale, fades in with a gentle
      // deceleration — feels like it floats into place.
      logoOpacity.value = withTiming(1, {
        duration: 480,
        easing: Easing.out(Easing.cubic),
      });

      logoScale.value = withTiming(1, {
        duration: 560,
        easing: Easing.out(Easing.back(1.06)),
      });

      // Haptic fires just as the logo settles
      const arrivalHaptic = setTimeout(triggerArrivalHaptic, 420);

      // ── Phase 2: Ambient glow blooms (80 – 700ms) ──────────────────────────
      // A soft teal ring expands behind the logo — premium, not flashy.
      glowOpacity.value = withDelay(
        80,
        withSequence(
          withTiming(0.28, { duration: 420, easing: Easing.out(Easing.cubic) }),
          withDelay(260, withTiming(0, { duration: 380, easing: Easing.in(Easing.cubic) }))
        )
      );

      glowScale.value = withDelay(
        80,
        withTiming(1.15, { duration: 900, easing: Easing.out(Easing.cubic) })
      );

      // ── Phase 3: Hold (logo visible 560 – 1100ms) ──────────────────────────
      // The logo sits confidently for ~540ms — gives the user a moment to
      // register the brand before the exit begins.

      // ── Phase 4: Exit (1100 – 1560ms) ──────────────────────────────────────
      // Logo scales up slightly and fades — cinematic, not a hard cut.
      // A very subtle flash punctuates the transition.
      logoOpacity.value = withDelay(
        1060,
        withTiming(0, { duration: 340, easing: Easing.in(Easing.cubic) })
      );

      logoScale.value = withDelay(
        1060,
        withTiming(1.08, { duration: 380, easing: Easing.in(Easing.cubic) })
      );

      // Subtle exit flash — barely perceptible, just adds a premium feel
      flashOpacity.value = withDelay(
        1080,
        withSequence(
          withTiming(0.18, { duration: 60, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) })
        )
      );

      // Haptic fires at the moment of exit flash
      const exitHaptic = setTimeout(triggerExitHaptic, 1100);

      // Background dissolves away, content fades in simultaneously
      bgOpacity.value = withDelay(
        1080,
        withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) })
      );

      contentOpacity.value = withDelay(
        1100,
        withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }, () => {
          runOnJS(onAnimationComplete)();
        })
      );

      return () => {
        clearTimeout(arrivalHaptic);
        clearTimeout(exitHaptic);
      };
    }
  }, [bgOpacity, contentOpacity, flashOpacity, glowOpacity, glowScale, isLoading, logoOpacity, logoScale, onAnimationComplete]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
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

      {/* Ambient glow ring — blooms behind logo on arrival */}
      <Animated.View style={styles.glowCenter} pointerEvents="none">
        <Animated.View style={[styles.glow, glowStyle]} />
      </Animated.View>

      {/* Exit flash — full screen, very subtle */}
      <Animated.View style={[styles.flash, flashStyle]} pointerEvents="none" />

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
  glowCenter: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    width: SCREEN_WIDTH * 1.4,
    height: SCREEN_WIDTH * 1.4,
    borderRadius: SCREEN_WIDTH * 0.7,
    backgroundColor: 'rgba(122, 157, 184, 0.55)',
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 75,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  logoWrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AnimatedSplash;
