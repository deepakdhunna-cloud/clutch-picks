/**
 * GlassBottomNav — Premium bottom navigation with glowing underline indicator
 */

import React from 'react';
import { View, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
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

const TEAL = '#7A9DB8';
const CORAL = '#E8936A';

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
    return { transform: [{ translateY }] };
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
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={80}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
        )}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8, 10, 16, 0.65)' }]} pointerEvents="none" />
        {/* Top edge highlight */}
        <View style={styles.topEdge} pointerEvents="none" />

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
              navigation.emit({ type: 'tabLongPress', target: route.key });
            };

            const label = options.tabBarLabel ?? options.title ?? route.name;
            const icon = options.tabBarIcon?.({
              focused: isFocused,
              color: isFocused ? '#FFFFFF' : 'rgba(255, 255, 255, 0.35)',
              size: 22,
            });
            const labelValue = typeof label === 'string' ? label : route.name;

            return (
              <TabButton
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

function TabButton({
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
  const focus = useSharedValue(isFocused ? 1 : 0);

  React.useEffect(() => {
    focus.value = withSpring(isFocused ? 1 : 0, { damping: 18, stiffness: 280 });
  }, [isFocused]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Label opacity (avoids interpolateColor which can crash in worklets)
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focus.value, [0, 1], [0.35, 1]),
  }));

  // Glowing underline bar
  const barStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
    transform: [
      { scaleX: interpolate(focus.value, [0, 1], [0, 1]) },
    ],
  }));

  // Icon glow
  const iconGlowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focus.value, [0, 1], [0, 0.5]),
    transform: [{ scale: interpolate(focus.value, [0, 1], [0.5, 1]) }],
  }));

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withSpring(0.88, { damping: 15, stiffness: 400 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 350 });
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tabButton}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
    >
      <Animated.View style={[styles.tabContent, pressStyle]}>
        {/* Icon with glow behind it when active */}
        <View style={styles.iconArea}>
          <Animated.View style={[styles.iconGlow, iconGlowStyle]} />
          <View style={styles.iconWrapper}>{icon}</View>
        </View>

        <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
          {label}
        </Animated.Text>

        {/* Glowing underline bar */}
        <Animated.View style={[styles.barContainer, barStyle]}>
          <LinearGradient
            colors={['transparent', TEAL, TEAL, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.bar}
          />
          {/* Glow beneath the bar */}
          <View style={styles.barGlow} />
        </Animated.View>
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
    paddingHorizontal: 20,
  },
  glassWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '100%',
    maxWidth: 400,
    minHeight: 64,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 9999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.65,
        shadowRadius: 40,
      },
      android: { elevation: 20 },
    }),
  },
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  tabRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  tabButton: {
    flex: 1,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  iconArea: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  iconGlow: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: TEAL,
    ...Platform.select({
      ios: {
        shadowColor: TEAL,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 10,
      },
      android: {},
    }),
  },
  iconWrapper: {
    zIndex: 1,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  barContainer: {
    width: 24,
    height: 3,
    alignItems: 'center',
  },
  bar: {
    width: 24,
    height: 2,
    borderRadius: 1,
  },
  barGlow: {
    position: 'absolute',
    top: -2,
    width: 20,
    height: 6,
    borderRadius: 3,
    backgroundColor: TEAL,
    opacity: 0.4,
    ...Platform.select({
      ios: {
        shadowColor: TEAL,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 8,
      },
      android: {},
    }),
  },
});
