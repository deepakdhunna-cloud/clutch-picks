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

      const hapticTimeout = setTimeout(triggerSplashHaptic, 120);

      logoScale.value = withSequence(
        withTiming(0.9, {
          duration: 120,
          easing: Easing.inOut(Easing.cubic),
        }),
        withTiming(1.18, {
          duration: 240,
          easing: Easing.out(Easing.cubic),
        })
      );

      logoOpacity.value = withDelay(
        170,
        withTiming(0, {
          duration: 230,
          easing: Easing.out(Easing.cubic),
        })
      );

      flashScale.value = withDelay(
        100,
        withTiming(1, {
          duration: 360,
          easing: Easing.out(Easing.cubic),
        })
      );

      flashOpacity.value = withDelay(
        100,
        withSequence(
          withTiming(0.34, {
            duration: 80,
            easing: Easing.out(Easing.quad),
          }),
          withTiming(0, {
            duration: 280,
            easing: Easing.out(Easing.cubic),
          })
        )
      );

      bgOpacity.value = withDelay(
        180,
        withTiming(0, {
          duration: 280,
          easing: Easing.out(Easing.cubic),
        })
      );

      contentOpacity.value = withDelay(
        160,
        withTiming(1, {
          duration: 260,
          easing: Easing.out(Easing.cubic),
        }, () => {
          runOnJS(onAnimationComplete)();
        })
      );

      return () => clearTimeout(hapticTimeout);
    }
  }, [isLoading, onAnimationComplete]);

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
