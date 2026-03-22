import React, { useEffect, useRef } from 'react';
import { View, Text, Dimensions, StyleSheet } from 'react-native';
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
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Field goal post for splash screen
function SplashFieldGoalU({ color, size = 42 }: { color: string; size?: number }) {
  const isBlack = color === '#000000';
  return (
    <Svg width={size * 0.65} height={size} viewBox="0 0 26 40" fill="none">
      <Path d="M4 0 L4 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <Path d="M22 0 L22 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <Path d="M4 30 L22 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <Path d="M13 30 L13 40" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <Path d="M8 15 Q13 10 18 15 Q13 20 8 15" fill={color} transform="rotate(-35 13 15)" />
      <Path d="M13 13 L13 17" stroke={isBlack ? '#000000' : '#0D0D0D'} strokeWidth="1.2" strokeLinecap="round" transform="rotate(-35 13 15)" />
      <Path d="M11.5 14 L14.5 14" stroke={isBlack ? '#000000' : '#0D0D0D'} strokeWidth="0.8" transform="rotate(-35 13 15)" />
      <Path d="M11.5 16 L14.5 16" stroke={isBlack ? '#000000' : '#0D0D0D'} strokeWidth="0.8" transform="rotate(-35 13 15)" />
    </Svg>
  );
}

// Centered splash logo
function SplashLogo({ size = 48 }: { size?: number }) {
  return (
    <View style={styles.logoContainer}>
      <View style={styles.clutchRow}>
        <View style={styles.relative}>
          <Text style={[styles.letterShadow, { fontSize: size }]}>CL</Text>
          <Text style={[styles.letterMid, { fontSize: size }]}>CL</Text>
          <Text style={[styles.letterMain, { fontSize: size }]}>CL</Text>
        </View>
        <View style={styles.fieldGoalContainer}>
          <View style={styles.fieldGoalShadow}>
            <SplashFieldGoalU color="#000000" size={size} />
          </View>
          <View style={styles.fieldGoalMid}>
            <SplashFieldGoalU color="#7A9DB8" size={size} />
          </View>
          <SplashFieldGoalU color="#FFFFFF" size={size} />
        </View>
        <View style={styles.relative}>
          <Text style={[styles.letterShadow, { fontSize: size }]}>TCH</Text>
          <Text style={[styles.letterMid, { fontSize: size }]}>TCH</Text>
          <Text style={[styles.letterMain, { fontSize: size }]}>TCH</Text>
        </View>
      </View>
      <View style={styles.picksBadge}>
        <Text style={styles.picksText}>PICKS</Text>
      </View>
    </View>
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
        duration: 300,
        easing: Easing.out(Easing.cubic),
      });

      // Phase 2: After logo fades in and sits, start the burst animation
      const burstTimeout = setTimeout(() => {
        // Fire haptic at the burst moment (after squeeze)
        setTimeout(() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }, 180);

        // Logo squeezes inward then bursts outward and fades
        logoScale.value = withSequence(
          withTiming(0.85, {
            duration: 180,
            easing: Easing.bezier(0.4, 0, 1, 1),
          }),
          withTiming(2.8, {
            duration: 450,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })
        );

        logoOpacity.value = withDelay(
          100,
          withTiming(0, {
            duration: 350,
            easing: Easing.out(Easing.quad),
          })
        );

        // Flash burst — appears then fades as it expands with blur
        flashOpacity.value = withDelay(
          180,
          withTiming(0.85, {
            duration: 180,
            easing: Easing.out(Easing.quad),
          })
        );
        flashScale.value = withDelay(
          120,
          withTiming(1, {
            duration: 500,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })
        );

        // Flash fades out slowly after appearing
        setTimeout(() => {
          flashOpacity.value = withTiming(0, {
            duration: 400,
            easing: Easing.out(Easing.cubic),
          });
        }, 300);

        // Background dissolves
        bgOpacity.value = withDelay(
          200,
          withTiming(0, {
            duration: 400,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
          })
        );

        // Content fades in
        contentOpacity.value = withDelay(
          250,
          withTiming(1, {
            duration: 350,
            easing: Easing.out(Easing.cubic),
          }, () => {
            runOnJS(onAnimationComplete)();
          })
        );
      }, 600); // Wait for logo fade in (300ms) + sit time (300ms)

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
        <SplashLogo size={48} />
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
  logoContainer: {
    alignItems: 'center',
  },
  clutchRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  relative: {
    position: 'relative',
  },
  letterShadow: {
    position: 'absolute',
    fontWeight: '900',
    letterSpacing: 2,
    color: '#000000',
    left: 3,
    top: 3,
    textTransform: 'uppercase',
  },
  letterMid: {
    position: 'absolute',
    fontWeight: '900',
    letterSpacing: 2,
    color: '#7A9DB8',
    left: 1.5,
    top: 1.5,
    textTransform: 'uppercase',
  },
  letterMain: {
    fontWeight: '900',
    letterSpacing: 2,
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  fieldGoalContainer: {
    marginBottom: 4,
    marginHorizontal: -1,
    position: 'relative',
  },
  fieldGoalShadow: {
    position: 'absolute',
    left: 3,
    top: 3,
  },
  fieldGoalMid: {
    position: 'absolute',
    left: 1.5,
    top: 1.5,
  },
  picksBadge: {
    marginTop: 12,
    backgroundColor: 'rgba(90, 122, 138, 0.4)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#5A7A8A',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 6,
  },
  picksText: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 8,
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
});

export default AnimatedSplash;
