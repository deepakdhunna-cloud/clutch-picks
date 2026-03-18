/**
 * GlassBottomNav — Modern glassmorphism-style bottom navigation
 *
 * DESIGN SPEC
 * -----------
 * • Frosted glass: BlurView (intensity 60–80) + semi-transparent dark overlay
 * • Dark tint: rgba(0,0,0,0.25) overlay for dark-theme optimization
 * • Depth: Inner highlight (top border rgba(255,255,255,0.08)), outer shadow
 * • Radius: 24px (2xl) or 9999 (pill)
 * • Blur: Native UIVisualEffectView on iOS (performant); semi-transparent fallback on Android
 *
 * STYLE VALUES
 * ------------
 * blur: intensity 70, tint "dark"
 * overlay: rgba(0,0,0,0.25)
 * innerHighlight: 1px top border rgba(255,255,255,0.08)
 * shadow: iOS 0 4 24 rgba(0,0,0,0.35) | Android elevation 12
 * borderRadius: 24
 * activeTab: scale 1.05, subtle glow
 * tapTarget: min 44x44
 */

import React from 'react';
import { View, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useAnimatedStyle,
  useAnimatedProps,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTabBarVisible } from '@/contexts/ScrollContext';

const GLASS_STYLES = {
  blur: { intensity: 100, tint: 'dark' as const },
  overlay: 'rgba(0, 0, 0, 0.55)',
  innerHighlight: 'rgba(255, 255, 255, 0.12)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  frostOverlay: 'rgba(15, 15, 20, 0.45)',
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 12 },
  shadowOpacity: 0.65,
  shadowRadius: 40,
  elevation: 20,
  borderRadius: 9999,
  marginHorizontal: 20,
  paddingHorizontal: 8,
  paddingVertical: 8,
  minTapTarget: 44,
} as const;

export function GlassBottomNav({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 12);
  const tabBarVisible = useTabBarVisible();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const animatedContainerStyle = useAnimatedStyle(() => {
    const translateY = interpolate(tabBarVisible.value, [0, 1], [120, 0], Extrapolation.CLAMP);
    return {
      transform: [{ translateY }],
    };
  });

  const animatedContainerProps = useAnimatedProps(() => ({
    pointerEvents: (tabBarVisible.value === 0 ? 'none' : 'box-none') as 'none' | 'box-none',
  }));

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingBottom: bottomPadding },
        isTablet && { paddingHorizontal: 40 },
        animatedContainerStyle,
      ]}
      animatedProps={animatedContainerProps}
    >
      <View style={[styles.glassWrapper, isTablet && { maxWidth: 500, alignSelf: 'center' }]}>
        {/* Blur layer — native on iOS only; Android uses solid overlays */}
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={GLASS_STYLES.blur.intensity}
            tint={GLASS_STYLES.blur.tint}
            style={StyleSheet.absoluteFill}
          />
        )}
        {/* Dark frost overlay for deeper effect */}
        <View
          style={[StyleSheet.absoluteFill, styles.frostOverlay]}
          pointerEvents="none"
        />
        {/* Dark tint overlay */}
        <View
          style={[StyleSheet.absoluteFill, styles.overlay]}
          pointerEvents="none"
        />
        {/* Inner highlight (top edge) */}
        <View style={styles.innerHighlight} pointerEvents="none" />
        {/* Tab buttons */}
        <View style={styles.tabRow}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;

            if ((options as { href?: string | null }).href === null) return null;

            const onPress = () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            const label = options.tabBarLabel ?? options.title ?? route.name;
            const icon = options.tabBarIcon?.({
              focused: isFocused,
              color: isFocused ? '#FFFFFF' : 'rgba(255, 255, 255, 0.55)',
              size: 24,
            });

            const labelValue = typeof label === 'string' ? label : route.name;

            return (
              <GlassTabButton
                key={route.key}
                isFocused={isFocused}
                onPress={onPress}
                onLongPress={onLongPress}
                icon={icon}
                label={labelValue}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? labelValue}
                accessibilityRole="button"
                accessibilityState={{ selected: isFocused }}
              />
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

function GlassTabButton({
  isFocused,
  onPress,
  onLongPress,
  icon,
  label,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
}: {
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  icon: React.ReactNode;
  label: string;
  accessibilityLabel?: string;
  accessibilityRole?: 'button';
  accessibilityState?: { selected?: boolean };
}) {
  const scale = useSharedValue(1);
  const glow = useSharedValue(isFocused ? 1 : 0);

  React.useEffect(() => {
    glow.value = withTiming(isFocused ? 1 : 0, { duration: 200 });
  }, [isFocused, glow]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.15,
  }));

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withSpring(0.95, { damping: 15, stiffness: 400 });
      }}
      onPressOut={() => {
        scale.value = withSpring(isFocused ? 1.05 : 1, {
          damping: 15,
          stiffness: 400,
        });
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tabButton}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
    >
      <Animated.View style={[styles.tabContent, animatedStyle]}>
        {isFocused ? (
          <Animated.View style={[styles.activeGlow, glowStyle]} />
        ) : null}
        <View style={styles.iconWrapper}>{icon}</View>
        <Animated.Text
          style={[
            styles.label,
            isFocused ? styles.labelActive : styles.labelInactive,
          ]}
          numberOfLines={1}
        >
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: GLASS_STYLES.marginHorizontal,
  },
  glassWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '100%',
    maxWidth: 400,
    minHeight: 64,
    paddingHorizontal: GLASS_STYLES.paddingHorizontal,
    paddingVertical: GLASS_STYLES.paddingVertical,
    borderRadius: GLASS_STYLES.borderRadius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GLASS_STYLES.borderColor,
    // Outer shadow
    ...Platform.select({
      ios: {
        shadowColor: GLASS_STYLES.shadowColor,
        shadowOffset: GLASS_STYLES.shadowOffset,
        shadowOpacity: GLASS_STYLES.shadowOpacity,
        shadowRadius: GLASS_STYLES.shadowRadius,
      },
      android: {
        elevation: GLASS_STYLES.elevation,
      },
    }),
  },
  overlay: {
    backgroundColor: GLASS_STYLES.overlay,
  },
  frostOverlay: {
    backgroundColor: GLASS_STYLES.frostOverlay,
  },
  innerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: GLASS_STYLES.innerHighlight,
  },
  tabRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    gap: 4,
  },
  tabButton: {
    flex: 1,
    minWidth: GLASS_STYLES.minTapTarget,
    minHeight: GLASS_STYLES.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeGlow: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  iconWrapper: {
    marginBottom: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  labelActive: {
    color: '#FFFFFF',
  },
  labelInactive: {
    color: 'rgba(255, 255, 255, 0.55)',
  },
});
