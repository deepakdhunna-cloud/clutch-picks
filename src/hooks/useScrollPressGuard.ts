import { useCallback, useRef } from 'react';
import { createScrollPressBlocker } from '@/lib/interaction-guard';

export function useScrollPressGuard(dragBlockMs = 500, settleBlockMs = 220) {
  const blockerRef = useRef(createScrollPressBlocker({ dragBlockMs, settleBlockMs }));

  const canPress = useCallback(() => blockerRef.current.canPress(), []);
  const onScrollBeginDrag = useCallback(() => blockerRef.current.blockForDrag(), []);
  const onMomentumScrollBegin = useCallback(() => blockerRef.current.blockForDrag(), []);
  const onScrollEndDrag = useCallback(() => blockerRef.current.blockForSettle(), []);
  const onMomentumScrollEnd = useCallback(() => blockerRef.current.blockForSettle(), []);
  const clearScrollPressBlock = useCallback(() => blockerRef.current.clear(), []);

  return {
    canPress,
    clearScrollPressBlock,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
  };
}
