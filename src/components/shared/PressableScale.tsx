import { forwardRef, useCallback } from 'react';
import { Pressable } from 'react-native';
import type {
  GestureResponderEvent,
  PressableProps,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SPRING, PRESS_SCALE } from '@/lib/motion';
import { haptics, type HapticIntent } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends PressableProps {
  /** Pressed-scale target. Defaults to the standard PRESS_SCALE token. */
  pressedScale?: number;
  /**
   * Haptic intent to fire once, on press-in, when the press begins.
   * Omit (or pass null) for no haptic. Keep haptics for *meaningful* taps.
   */
  haptic?: HapticIntent | null;
  /** NativeWind className passthrough. */
  className?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * One shared press primitive for the whole app.
 *
 * Why: tap feedback was inconsistent — some surfaces did a springy scale with
 * a haptic, others only a flat `active:opacity`, and many felt dead on tap.
 * This gives every primary tappable the *same* fast, UI-thread press response
 * (Reanimated spring, no JS-thread work) and an optional semantic haptic, as a
 * drop-in replacement for `Pressable`. It changes feel, never layout.
 *
 * - Scale animates on the native thread via `withSpring(SPRING.press)`.
 * - Honors `disabled` (no scale, no haptic).
 * - Forwards all Pressable props/handlers (onPress, onPressIn/Out, hitSlop,
 *   pressRetentionOffset, accessibility, etc.) so existing guards keep working.
 */
export const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  {
    pressedScale = PRESS_SCALE,
    haptic = null,
    disabled,
    onPressIn,
    onPressOut,
    style,
    children,
    ...rest
  },
  ref,
) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (!disabled) {
        scale.value = withSpring(pressedScale, SPRING.press);
        if (haptic) haptics[haptic]();
      }
      onPressIn?.(e);
    },
    [disabled, pressedScale, haptic, onPressIn, scale],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      scale.value = withSpring(1, SPRING.press);
      onPressOut?.(e);
    },
    [onPressOut, scale],
  );

  return (
    <AnimatedPressable
      ref={ref}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animatedStyle, style]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
});
