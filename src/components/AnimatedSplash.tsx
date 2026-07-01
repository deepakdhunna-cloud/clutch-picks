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
import { haptics } from '@/lib/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function triggerSplashHaptic() {
  // A single, deliberate brand "thunk" as the logo settles.
  haptics.impact();
}

// Centered splash logo — uses the stacked image
function SplashLogo() {
  const logoWidth = SCREEN_WIDTH * 0.5;
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

  // Keep the exact same visual language as before — a centered logo on a black
  // field that dissolves into the app. This pass ONLY refines the timing and
  // easing so the moment feels slower and more satisfying, with a genuinely
  // smooth hand-off into the app (no visible logo "jump", no abrupt cut).
  const logoScale = useSharedValue(0.98);
  const logoOpacity = useSharedValue(1);
  const bgOpacity = useSharedValue(1);
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isLoading && !hasStartedRef.current) {
      hasStartedRef.current = true;

      // Haptic fires as the logo settles into place — a single, quiet brand thunk.
      const hapticTimeout = setTimeout(triggerSplashHaptic, 260);

      // ── Logo: a calm, slow settle — no punch, no jump ─────────────────────
      // Ease gently from 0.98 up to a barely-perceptible 1.03 "breath" over a
      // long, decelerating curve, then hold. This reads as the logo confidently
      // arriving rather than snapping. Nothing pops.
      logoScale.value = withTiming(1.03, {
        duration: 760,
        easing: Easing.out(Easing.cubic),
      });

      // Logo fades out gracefully, well after it has settled, so the arrival
      // registers calmly before the dissolve begins. Long, soft fade.
      logoOpacity.value = withDelay(
        620,
        withTiming(0, {
          duration: 560,
          easing: Easing.inOut(Easing.quad),
        })
      );

      // ── Background + content cross-fade ───────────────────────────────────
      // The black field clears and the app content rises underneath with
      // matching, longer durations and symmetric inOut easing, so the hand-off
      // is a true smooth dissolve rather than an abrupt cut. The background
      // begins clearing slightly after the logo starts leaving, and the content
      // fade is what signals completion.
      bgOpacity.value = withDelay(
        700,
        withTiming(0, {
          duration: 620,
          easing: Easing.inOut(Easing.quad),
        })
      );

      contentOpacity.value = withDelay(
        680,
        withTiming(
          1,
          {
            duration: 640,
            easing: Easing.inOut(Easing.quad),
          },
          () => {
            runOnJS(onAnimationComplete)();
          }
        )
      );

      return () => clearTimeout(hapticTimeout);
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
