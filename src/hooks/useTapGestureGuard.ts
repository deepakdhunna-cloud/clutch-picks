import { useCallback, useRef } from 'react';
import type { GestureResponderEvent, NativeTouchEvent } from 'react-native';

const DEFAULT_MOVEMENT_THRESHOLD = 8;
const DEFAULT_MAX_TAP_DURATION_MS = 700;

function getPrimaryTouch(event: GestureResponderEvent): NativeTouchEvent {
  return event.nativeEvent.touches[0] ?? event.nativeEvent.changedTouches[0] ?? event.nativeEvent;
}

export function useTapGestureGuard(
  movementThreshold = DEFAULT_MOVEMENT_THRESHOLD,
  maxTapDurationMs = DEFAULT_MAX_TAP_DURATION_MS,
) {
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const movedBeyondTapRef = useRef(false);

  const onTouchStart = useCallback((event: GestureResponderEvent) => {
    const touch = getPrimaryTouch(event);
    startPointRef.current = { x: touch.pageX, y: touch.pageY };
    startTimeRef.current = Date.now();
    movedBeyondTapRef.current = false;
  }, []);

  const onTouchMove = useCallback((event: GestureResponderEvent) => {
    const startPoint = startPointRef.current;
    if (!startPoint) return;

    const touch = getPrimaryTouch(event);
    const deltaX = touch.pageX - startPoint.x;
    const deltaY = touch.pageY - startPoint.y;

    if (Math.hypot(deltaX, deltaY) > movementThreshold) {
      movedBeyondTapRef.current = true;
    }
  }, [movementThreshold]);

  const onTouchCancel = useCallback(() => {
    movedBeyondTapRef.current = true;
    startPointRef.current = null;
    startTimeRef.current = null;
  }, []);

  const shouldHandlePress = useCallback(() => {
    const touchDuration = startTimeRef.current === null ? 0 : Date.now() - startTimeRef.current;
    const shouldHandle = !movedBeyondTapRef.current && touchDuration <= maxTapDurationMs;
    movedBeyondTapRef.current = false;
    startPointRef.current = null;
    startTimeRef.current = null;
    return shouldHandle;
  }, [maxTapDurationMs]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchCancel,
    shouldHandlePress,
  };
}
