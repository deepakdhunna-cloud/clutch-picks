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
import { MAROON } from '@/lib/theme';

export const GLASS_BOTTOM_NAV_HEIGHT = 72;
export const GLASS_BOTTOM_NAV_FADE_HEIGHT = 18;
export const GLASS_BOTTOM_NAV_MIN_BOTTOM_PADDING = 10;
export const GLASS_BOTTOM_NAV_SCROLL_PADDING = 26;

export function GlassBottomNav({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, GLASS_BOTTOM_NAV_MIN_BOTTOM_PADDING);
  const tabBarVisible = useTabBarVisible();
  const [optimisticIndex, setOptimisticIndex] = React.useState(state.index);

  // Sync optimistic index when navigation state confirms
  React.useEffect(() => {
    setOptimisticIndex(state.index);
  }, [state.index]);

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
              // Optimistic: update visual focus immediately
              setOptimisticIndex(index);
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

            const isOptimisticallyFocused = optimisticIndex === index;

            return (
              <TabButton
                key={route.key}
                isFocused={isOptimisticallyFocused}
                onPress={onPress}
                onLongPress={onLongPress}
                icon={icon}
                label={labelValue}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? labelValue}
                accessibilityRole="button"
                accessibilityState={{ selected: isOptimisticallyFocused }}
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
    height: GLASS_BOTTOM_NAV_FADE_HEIGHT,
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
    height: GLASS_BOTTOM_NAV_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  tabButton: {
    flex: 1,
    minWidth: 44,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabContent: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
    paddingTop: 8,
    paddingBottom: 6,
  },
  iconGlow: {
    position: 'absolute',
    top: 7,
    width: 36,
    height: 40,
    borderRadius: 20,
    backgroundColor: MAROON,
  },
  iconWrap: {
    height: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    zIndex: 1,
    transform: [{ scale: 1 }],
  },
  label: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: '#FFFFFF',
    marginBottom: 5,
    includeFontPadding: false,
    zIndex: 1,
  },
  pip: {
    height: 5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  pipDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
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
