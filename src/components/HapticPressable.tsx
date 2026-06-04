import React, { useCallback, useRef } from "react";
import {
  Pressable,
  type PressableProps,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const SPRING_CONFIG = { damping: 15, stiffness: 400, mass: 0.4 };

export type HapticStyle = "light" | "medium" | "heavy" | "selection" | "none";

interface HapticPressableProps extends Omit<PressableProps, "style"> {
  /** Haptic feedback style. Defaults to "light". */
  hapticStyle?: HapticStyle;
  /** Scale factor when pressed. Defaults to 0.97. Set to 1 to disable scale. */
  pressedScale?: number;
  /** Opacity when pressed. Defaults to 0.85. */
  pressedOpacity?: number;
  /** Throttle in ms to prevent double-fires. Defaults to 400. */
  throttleMs?: number;
  /** Style prop - supports both static ViewStyle and Pressable-style function form */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  children?: React.ReactNode;
}

function fireHaptic(style: HapticStyle) {
  switch (style) {
    case "light":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case "medium":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case "heavy":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      break;
    case "selection":
      Haptics.selectionAsync();
      break;
    case "none":
      break;
  }
}

export function HapticPressable({
  hapticStyle = "light",
  pressedScale = 0.97,
  pressedOpacity = 0.85,
  throttleMs = 400,
  onPress,
  onPressIn,
  onPressOut,
  style,
  disabled,
  children,
  ...rest
}: HapticPressableProps) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const lastPressRef = useRef(0);
  const pressedRef = useRef(false);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const handlePressIn = useCallback(
    (e: any) => {
      pressedRef.current = true;
      scale.value = withSpring(pressedScale, SPRING_CONFIG);
      opacity.value = withSpring(pressedOpacity, SPRING_CONFIG);
      fireHaptic(hapticStyle);
      onPressIn?.(e);
    },
    [hapticStyle, pressedScale, pressedOpacity, onPressIn]
  );

  const handlePressOut = useCallback(
    (e: any) => {
      pressedRef.current = false;
      scale.value = withSpring(1, SPRING_CONFIG);
      opacity.value = withSpring(1, SPRING_CONFIG);
      onPressOut?.(e);
    },
    [onPressOut]
  );

  const handlePress = useCallback(
    (e: any) => {
      const now = Date.now();
      if (now - lastPressRef.current < throttleMs) return;
      lastPressRef.current = now;
      onPress?.(e);
    },
    [onPress, throttleMs]
  );

  // Resolve style - if it's a function, call it with pressed=false
  // (HapticPressable handles press visuals itself via Reanimated)
  const resolvedStyle = typeof style === "function" ? style({ pressed: false }) : style;

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[resolvedStyle as StyleProp<ViewStyle>, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

export default HapticPressable;
