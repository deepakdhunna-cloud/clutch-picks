import { useCallback, useRef } from 'react';
import type { GestureResponderEvent, NativeTouchEvent } from 'react-native';

const DEFAULT_MOVEMENT_THRESHOLD = 8;

function getPrimaryTouch(event: GestureResponderEvent): NativeTouchEvent {
  return event.nativeEvent.touches[0] ?? event.nativeEvent.changedTouches[0] ?? event.nativeEvent;
}

export function useTapGestureGuard(movementThreshold = DEFAULT_MOVEMENT_THRESHOLD) {
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const movedBeyondTapRef = useRef(false);

  const onTouchStart = useCallback((event: GestureResponderEvent) => {
    const touch = getPrimaryTouch(event);
    startPointRef.current = { x: touch.pageX, y: touch.pageY };
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
  }, []);

  const shouldHandlePress = useCallback(() => {
    const shouldHandle = !movedBeyondTapRef.current;
    movedBeyondTapRef.current = false;
    startPointRef.current = null;
    return shouldHandle;
  }, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchCancel,
    shouldHandlePress,
  };
}
