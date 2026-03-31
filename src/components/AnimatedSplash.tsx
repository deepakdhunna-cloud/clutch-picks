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
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

  // Logo - start hidden, will fade in
  const logoScale = useSharedValue(1);
  const logoOpacity = useSharedValue(0);

  // Background
  const bgOpacity = useSharedValue(1);

  // Burst flash
  const flashScale = useSharedValue(0.01);
  const flashOpacity = useSharedValue(0);

  // Content
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isLoading && !hasStartedRef.current) {
      hasStartedRef.current = true;

      // Hide the native splash screen — our AnimatedSplash takes over from here
      // (hideAsync is called by _layout.tsx before rendering this component)

      // Phase 1: Fade in the logo (starts immediately)
      logoOpacity.value = withTiming(1, {
        duration: 500,
        easing: Easing.out(Easing.cubic),
      });

      // Phase 2: After logo fades in and sits, start the burst animation
      const burstTimeout = setTimeout(() => {
        // Fire haptic at the burst moment (after squeeze)
        setTimeout(() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }, 280);

        // Logo squeezes inward then bursts outward and fades
        logoScale.value = withSequence(
          withTiming(0.85, {
            duration: 280,
            easing: Easing.bezier(0.4, 0, 1, 1),
          }),
          withTiming(2.8, {
            duration: 650,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })
        );

        logoOpacity.value = withDelay(
          150,
          withTiming(0, {
            duration: 500,
            easing: Easing.out(Easing.quad),
          })
        );

        // Flash burst — appears then fades as it expands with blur
        flashOpacity.value = withDelay(
          280,
          withTiming(0.85, {
            duration: 280,
            easing: Easing.out(Easing.quad),
          })
        );
        flashScale.value = withDelay(
          200,
          withTiming(1, {
            duration: 700,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })
        );

        // Flash fades out slowly after appearing
        setTimeout(() => {
          flashOpacity.value = withTiming(0, {
            duration: 600,
            easing: Easing.out(Easing.cubic),
          });
        }, 450);

        // Background dissolves
        bgOpacity.value = withDelay(
          300,
          withTiming(0, {
            duration: 600,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
          })
        );

        // Content fades in
        contentOpacity.value = withDelay(
          400,
          withTiming(1, {
            duration: 500,
            easing: Easing.out(Easing.cubic),
          }, () => {
            runOnJS(onAnimationComplete)();
          })
        );
      }, 1800); // Wait for logo fade in (500ms) + longer sit time (1300ms)

      return () => clearTimeout(burstTimeout);
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

      {/* Burst flash — centered circle that scales up with blur */}
      <Animated.View style={styles.flashCenter} pointerEvents="none">
        <Animated.View
          style={[
            {
              width: SCREEN_WIDTH * 2.5,
              height: SCREEN_WIDTH * 2.5,
              borderRadius: SCREEN_WIDTH * 1.25,
              overflow: 'hidden',
            },
            flashStyle,
          ]}
        >
          <BlurView
            intensity={50}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(122, 157, 184, 0.22)' },
            ]}
          />
        </Animated.View>
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
  logoWrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AnimatedSplash;
