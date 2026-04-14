import React, { useEffect, useRef, useState } from 'react';
import { View, Text, type TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
  withSpring,
  Easing,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

interface Props {
  value: number;
  textStyle: TextStyle | TextStyle[];
  // Optional alignment of the floating "+N" badge relative to the number.
  // 'right' (default) places it to the upper-right; 'left' for upper-left.
  badgeAlign?: 'left' | 'right';
}

export const ScorePop = React.memo(function ScorePop({ value, textStyle, badgeAlign = 'right' }: Props) {
  const prevRef = useRef<number>(value);
  const popProgress = useSharedValue(0); // 0 = hidden, 1 = peak
  const numberPulse = useSharedValue(1); // base scale of the score number
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    const diff = value - prevRef.current;
    prevRef.current = value;
    if (diff > 0) {
      setDelta(diff);
      // Score number: quick "punch" pulse — overshoot then settle
      numberPulse.value = withSequence(
        withTiming(1.18, { duration: 140, easing: Easing.out(Easing.back(2)) }),
        withSpring(1, { damping: 12, stiffness: 180 })
      );
      // Floating "+N" badge: pop up + fade out
      popProgress.value = 0;
      popProgress.value = withSequence(
        withTiming(1, { duration: 280, easing: Easing.out(Easing.back(1.6)) }),
        withDelay(450, withTiming(0, { duration: 520, easing: Easing.in(Easing.cubic) }))
      );
    }
  }, [value]);

  const numberStyle = useAnimatedStyle(() => ({
    transform: [{ scale: numberPulse.value }],
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(popProgress.value, [0, 0.15, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(popProgress.value, [0, 1], [12, -26], Extrapolation.CLAMP) },
      { scale: interpolate(popProgress.value, [0, 1], [0.55, 1.1], Extrapolation.CLAMP) },
    ],
  }));

  const badgePosition =
    badgeAlign === 'right'
      ? { right: -4, top: -6 }
      : { left: -4, top: -6 };

  return (
    <View style={{ position: 'relative' }}>
      <Animated.View style={numberStyle}>
        <Text style={textStyle}>{value}</Text>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', ...badgePosition },
          badgeStyle,
        ]}
      >
        <Text
          style={{
            fontFamily: 'VT323_400Regular',
            fontSize: 22,
            fontWeight: '800',
            color: '#22C55E',
            letterSpacing: 0.5,
            textShadowColor: 'rgba(34,197,94,0.55)',
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: 10,
          }}
        >
          +{delta}
        </Text>
      </Animated.View>
    </View>
  );
});
