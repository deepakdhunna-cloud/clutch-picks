import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import EventSource, { CustomEvent } from 'react-native-sse';

type SSEEvents = 'scores';
import { useQueryClient } from '@tanstack/react-query';

export interface LiveScore {
  id: string;
  sport: string;
  homeTeam: { abbreviation: string; name: string };
  awayTeam: { abbreviation: string; name: string };
  homeScore: number;
  awayScore: number;
  clock: string | null;
  period: number | null;
  quarter: string | null;
  status: 'LIVE';
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
const MIN_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;

// Module-level ref so useGames can read SSE connection state without subscribing
export const sseConnectedRef = { current: false };

export function useLiveScores() {
  const queryClient = useQueryClient();
  const [liveScores, setLiveScores] = useState<LiveScore[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const esRef = useRef<EventSource<SSEEvents> | null>(null);
  const reconnectDelay = useRef(MIN_RECONNECT_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const mountedRef = useRef(true);
  // Stable ref to latest applyScoresToCache — updated below so connect() needs no deps on it
  const applyScoresRef = useRef<((scores: LiveScore[]) => void) | null>(null);
  // Throttle SSE state updates to max once per 500ms
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScores = useRef<LiveScore[] | null>(null);

  const applyScoresToCache = useCallback((scores: LiveScore[]) => {
    if (scores.length === 0) return;

    // Batch all cache writes into a single React Query notification
    queryClient.setQueriesData({ queryKey: ['games'] }, (old: any) => {
      if (!Array.isArray(old)) return old;
      const scoreMap = new Map(scores.map((s) => [s.id, s]));
      let changed = false;
      const updated = old.map((game: any) => {
        const live = scoreMap.get(game.id);
        if (!live) return game;
        // Only update if score actually changed
        if (
          game.homeScore === live.homeScore &&
          game.awayScore === live.awayScore &&
          game.clock === live.clock &&
          game.quarter === live.quarter
        ) return game;
        changed = true;
        return {
          ...game,
          homeScore: live.homeScore,
          awayScore: live.awayScore,
          clock: live.clock,
          quarter: live.quarter,
          status: live.status,
        };
      });
      return changed ? updated : old;
    });

    // Update individual game caches only for games that changed
    for (const score of scores) {
      queryClient.setQueryData(['game', score.id], (old: any) => {
        if (!old) return old;
        if (
          old.homeScore === score.homeScore &&
          old.awayScore === score.awayScore &&
          old.clock === score.clock &&
          old.quarter === score.quarter
        ) return old;
        return {
          ...old,
          homeScore: score.homeScore,
          awayScore: score.awayScore,
          clock: score.clock,
          quarter: score.quarter,
          status: score.status,
        };
      });
    }
  }, [queryClient]);

  // Keep ref pointing at the latest version so connect() closure stays stable
  applyScoresRef.current = applyScoresToCache;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const url = `${BACKEND_URL}/api/games/live-stream`;
    const es = new EventSource<SSEEvents>(url);
    esRef.current = es;

    es.addEventListener('open', () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      sseConnectedRef.current = true;
      reconnectDelay.current = MIN_RECONNECT_MS;
    });

    es.addEventListener('scores', (event: CustomEvent<'scores'>) => {
      if (!mountedRef.current) return;
      try {
        const scores: LiveScore[] = JSON.parse(event.data ?? '[]');
        // Always update cache immediately (cheap — only writes if data changed)
        applyScoresRef.current?.(scores);
        // Throttle setState to max once per 500ms to avoid render storms
        pendingScores.current = scores;
        if (!throttleTimer.current) {
          throttleTimer.current = setTimeout(() => {
            throttleTimer.current = null;
            if (pendingScores.current && mountedRef.current) {
              setLiveScores(pendingScores.current);
              pendingScores.current = null;
            }
          }, 500);
        }
      } catch {
        // malformed payload — ignore
      }
    });

    es.addEventListener('error', () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      sseConnectedRef.current = false;
      es.close();
      esRef.current = null;

      // Exponential backoff reconnect
      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_MS);
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current && appStateRef.current === 'active') {
          connect();
        }
      }, delay);
    });
  }, []); // no deps — all mutable state accessed via refs

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setIsConnected(false);
    sseConnectedRef.current = false;
  }, []);

  const reconnect = useCallback(() => {
    reconnectDelay.current = MIN_RECONNECT_MS;
    disconnect();
    connect();
  }, [connect, disconnect]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  // Pause when app goes to background, resume when foregrounded
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;

      if (next === 'active' && prev !== 'active') {
        reconnectDelay.current = MIN_RECONNECT_MS;
        connect();
      } else if (next !== 'active' && prev === 'active') {
        disconnect();
      }
    });

    return () => sub.remove();
  }, [connect, disconnect]);

  return { liveScores, isConnected, reconnect };
}
