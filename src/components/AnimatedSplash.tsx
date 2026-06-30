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

function triggerSplashHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
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

  // Keep the clutch moment, but avoid expensive blur layers during cold start.
  const logoScale = useSharedValue(1);
  const logoOpacity = useSharedValue(1);
  const bgOpacity = useSharedValue(1);
  const flashScale = useSharedValue(0.15);
  const flashOpacity = useSharedValue(0);
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isLoading && !hasStartedRef.current) {
      hasStartedRef.current = true;

      // Haptic fires as the logo begins its punch — feels like impact
      const hapticTimeout = setTimeout(triggerSplashHaptic, 200);

      // ── Logo: squeeze in, hold a beat, then punch out ──────────────────────
      // Squeeze down to 0.88 over 200ms, then punch up to 1.22 over 420ms.
      // The hold between squeeze and punch is baked into the easing curves —
      // the inOut cubic on the squeeze naturally decelerates into a pause.
      logoScale.value = withSequence(
        withTiming(0.88, {
          duration: 200,
          easing: Easing.inOut(Easing.cubic),
        }),
        withTiming(1.22, {
          duration: 420,
          easing: Easing.out(Easing.cubic),
        })
      );

      // Logo fades out as it punches — starts a touch later so the punch
      // registers before it dissolves. Total logo visible: ~600ms.
      logoOpacity.value = withDelay(
        280,
        withTiming(0, {
          duration: 380,
          easing: Easing.out(Easing.cubic),
        })
      );

      // ── Flash ring: expands from center as the logo punches ────────────────
      // Starts slightly after the squeeze completes, blooms outward over 560ms.
      flashScale.value = withDelay(
        160,
        withTiming(1, {
          duration: 560,
          easing: Easing.out(Easing.cubic),
        })
      );

      // Flash opacity: quick rise to 0.34, then long graceful fade to 0
      flashOpacity.value = withDelay(
        160,
        withSequence(
          withTiming(0.34, {
            duration: 120,
            easing: Easing.out(Easing.quad),
          }),
          withTiming(0, {
            duration: 460,
            easing: Easing.out(Easing.cubic),
          })
        )
      );

      // ── Background + content cross-fade ───────────────────────────────────
      // Background starts clearing as the logo exits, content rises underneath.
      bgOpacity.value = withDelay(
        300,
        withTiming(0, {
          duration: 420,
          easing: Easing.out(Easing.cubic),
        })
      );

      contentOpacity.value = withDelay(
        280,
        withTiming(1, {
          duration: 400,
          easing: Easing.out(Easing.cubic),
        }, () => {
          runOnJS(onAnimationComplete)();
        })
      );

      return () => clearTimeout(hapticTimeout);
    }
  }, [bgOpacity, contentOpacity, flashOpacity, flashScale, isLoading, logoOpacity, logoScale, onAnimationComplete]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const bgStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
    transform: [{ scale: flashScale.value }],
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

      {/* Lightweight pop flash — no blur view during app startup */}
      <Animated.View style={styles.flashCenter} pointerEvents="none">
        <Animated.View style={[styles.flash, flashStyle]} />
      </Animated.View>

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
  flashCenter: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 75,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flash: {
    width: SCREEN_WIDTH * 1.9,
    height: SCREEN_WIDTH * 1.9,
    borderRadius: SCREEN_WIDTH * 0.95,
    backgroundColor: 'rgba(122, 157, 184, 0.42)',
  },
  logoWrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AnimatedSplash;
