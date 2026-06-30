import { useCallback, useEffect, useRef, useState } from 'react';
import { haptics } from '@/lib/haptics';

type RefreshAction = () => Promise<unknown> | unknown;

interface SmoothRefreshOptions {
  minVisibleMs?: number;
  maxVisibleMs?: number;
}

const DEFAULT_MIN_VISIBLE_MS = 450;
const DEFAULT_MAX_VISIBLE_MS = 1200;

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

export function useSmoothRefresh(
  refreshAction: RefreshAction,
  options: SmoothRefreshOptions = {},
) {
  const [refreshing, setRefreshing] = useState(false);
  const actionRef = useRef(refreshAction);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const visibleRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  actionRef.current = refreshAction;

  const minVisibleMs = options.minVisibleMs ?? DEFAULT_MIN_VISIBLE_MS;
  const maxVisibleMs = options.maxVisibleMs ?? DEFAULT_MAX_VISIBLE_MS;

  const clearTimers = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  const hideRefreshing = useCallback(() => {
    if (!mountedRef.current) return;
    visibleRef.current = false;
    setRefreshing(false);
  }, []);

  const onRefresh = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    clearTimers();
    visibleRef.current = true;
    if (mountedRef.current) setRefreshing(true);

    const startedAt = Date.now();
    let didFail = false;
    maxTimerRef.current = setTimeout(() => {
      maxTimerRef.current = null;
      hideRefreshing();
    }, maxVisibleMs);

    Promise.resolve()
      .then(waitForNextFrame)
      .then(() => actionRef.current())
      .catch((error) => {
        didFail = true;
      })
      .finally(() => {
        inFlightRef.current = false;
        if (maxTimerRef.current) {
          clearTimeout(maxTimerRef.current);
          maxTimerRef.current = null;
        }

        if (!visibleRef.current) return;

        const elapsed = Date.now() - startedAt;
        const wait = Math.max(0, minVisibleMs - elapsed);
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          if (didFail) haptics.error();
          else haptics.success();
          hideRefreshing();
        }, wait);
      });
  }, [clearTimers, hideRefreshing, maxVisibleMs, minVisibleMs]);

  return { refreshing, onRefresh };
}
