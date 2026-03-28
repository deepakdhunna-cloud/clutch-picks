/**
 * Fade Rail — Premium bottom navigation
 * Content dissolves into the nav via gradient. Active tab has a maroon glow pip.
 */

import React from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useAnimatedProps,
  useSharedValue,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTabBarVisible } from '@/contexts/ScrollContext';

const MAROON = '#8B0A1F';

export function GlassBottomNav({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 16);
  const tabBarVisible = useTabBarVisible();

  const animatedContainerStyle = useAnimatedStyle(() => {
    const translateY = interpolate(tabBarVisible.value, [0, 1], [120, 0], Extrapolation.CLAMP);
    return { transform: [{ translateY }] };
  });

  const animatedContainerProps = useAnimatedProps(() => ({
    pointerEvents: (tabBarVisible.value === 0 ? 'none' : 'box-none') as 'none' | 'box-none',
  }));

  return (
    <Animated.View
      style={[styles.container, animatedContainerStyle]}
      animatedProps={animatedContainerProps}
    >
      {/* Gradient fade — content dissolves into nav */}
      <LinearGradient
        colors={['transparent', 'rgba(4,6,8,0.4)', 'rgba(4,6,8,0.8)', '#040608']}
        style={styles.fade}
        pointerEvents="none"
      />

      {/* Nav area */}
      <View style={[styles.bar, { paddingBottom: bottomPadding }]}>
        {/* Accent line */}
        <LinearGradient
          colors={[
            'transparent',
            'rgba(255,255,255,0.02)',
            'rgba(139,10,31,0.18)',
            'rgba(122,157,184,0.12)',
            'rgba(255,255,255,0.02)',
            'transparent',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.accentLine}
        />

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
              color: '#FFFFFF',
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

  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focus.value, [0, 1], [0.35, 1]),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focus.value, [0, 1], [0.4, 1]),
  }));

  // Maroon glow pip
  const pipStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
    transform: [{ scale: interpolate(focus.value, [0, 1], [0, 1]) }],
  }));

  // Radial glow behind active icon
  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focus.value, [0, 1], [0, 0.05]),
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
        {/* Radial glow behind icon */}
        <Animated.View style={[styles.iconGlow, glowStyle]} />

        {/* Icon */}
        <Animated.View style={[styles.iconWrap, iconStyle]}>
          {icon}
        </Animated.View>

        {/* Label */}
        <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
          {label}
        </Animated.Text>

        {/* Maroon glow pip */}
        <Animated.View style={[styles.pip, pipStyle]}>
          <View style={styles.pipDot} />
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
  },
  fade: {
    height: 10,
  },
  bar: {
    backgroundColor: '#040608',
  },
  accentLine: {
    height: 0.5,
    marginHorizontal: 32,
    marginBottom: 0,
  },
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  tabButton: {
    flex: 1,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    position: 'relative',
    paddingVertical: 2,
  },
  iconGlow: {
    position: 'absolute',
    top: -4,
    width: 36,
    height: 40,
    borderRadius: 20,
    backgroundColor: MAROON,
  },
  iconWrap: {
    marginBottom: 5,
    zIndex: 1,
    transform: [{ scale: 1 }],
  },
  label: {
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: '#FFFFFF',
    marginBottom: 6,
    zIndex: 1,
  },
  pip: {
    alignItems: 'center',
    zIndex: 1,
  },
  pipDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: MAROON,
    ...Platform.select({
      ios: {
        shadowColor: MAROON,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 4,
      },
      android: {},
    }),
  },
});
