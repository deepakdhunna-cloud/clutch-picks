import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import EventSource, { CustomEvent } from 'react-native-sse';
import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { GameStatus, type GameWithPrediction } from '@/types/sports';

type SSEEvents = 'scores';

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
  status: GameStatus.LIVE | GameStatus.FINAL;
  statusLabel?: string;
  statusDetail?: string;
  suspension?: GameWithPrediction['suspension'];
  liveState?: GameWithPrediction['liveState'];
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
const MIN_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;

// Module-level ref so useGames can read SSE connection state without subscribing
export const sseConnectedRef = { current: false };

function sameLiveState(
  left: GameWithPrediction['liveState'],
  right: GameWithPrediction['liveState'],
): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  return (
    left.balls === right.balls &&
    left.strikes === right.strikes &&
    left.outs === right.outs &&
    left.onFirst === right.onFirst &&
    left.onSecond === right.onSecond &&
    left.onThird === right.onThird &&
    left.inningHalf === right.inningHalf &&
    (left.inning ?? left.inningNumber ?? null) === (right.inning ?? right.inningNumber ?? null) &&
    (left.betweenInnings ?? false) === (right.betweenInnings ?? false) &&
    (left.inningTransition ?? null) === (right.inningTransition ?? null) &&
    (left.pitcher?.name ?? null) === (right.pitcher?.name ?? null) &&
    (left.pitcher?.teamAbbr ?? null) === (right.pitcher?.teamAbbr ?? null) &&
    (left.batter?.name ?? null) === (right.batter?.name ?? null) &&
    (left.batter?.teamAbbr ?? null) === (right.batter?.teamAbbr ?? null)
  );
}

function mergeLiveScore(game: GameWithPrediction, scoreMap: Map<string, LiveScore>): GameWithPrediction {
  const live = scoreMap.get(game.id);
  if (!live) return game;
  const nextLiveState =
    live.liveState ?? (live.status === GameStatus.FINAL ? undefined : game.liveState);
  if (
    game.homeScore === live.homeScore &&
    game.awayScore === live.awayScore &&
    (game.clock ?? null) === live.clock &&
    (game.quarter ?? null) === live.quarter &&
    game.status === live.status &&
    (game.statusLabel ?? null) === (live.statusLabel ?? null) &&
    (game.statusDetail ?? null) === (live.statusDetail ?? null) &&
    (game.suspension?.display ?? null) === (live.suspension?.display ?? null) &&
    (game.suspension?.resumeText ?? null) === (live.suspension?.resumeText ?? null) &&
    (game.suspension?.reasonText ?? null) === (live.suspension?.reasonText ?? null) &&
    sameLiveState(game.liveState, nextLiveState)
  ) {
    return game;
  }
  return {
    ...game,
    homeScore: live.homeScore,
    awayScore: live.awayScore,
    clock: live.clock ?? undefined,
    quarter: live.quarter ?? undefined,
    status: live.status,
    statusLabel: live.statusLabel,
    statusDetail: live.statusDetail,
    suspension: live.suspension,
    liveState: nextLiveState,
  };
}

function mergeLiveScoresIntoArray<T extends GameWithPrediction>(
  games: T[],
  scoreMap: Map<string, LiveScore>,
): T[] {
  let changed = false;
  const updated = games.map((game) => {
    const next = mergeLiveScore(game, scoreMap);
    if (next !== game) changed = true;
    return next as T;
  });
  return changed ? updated : games;
}

function mergeLiveScoresIntoQueryData(old: unknown, scoreMap: Map<string, LiveScore>): unknown {
  if (!Array.isArray(old)) return old;

  if (old.every((item) => item && typeof item === 'object' && Array.isArray((item as { games?: unknown }).games))) {
    let changed = false;
    const updatedBuckets = old.map((bucket) => {
      const typedBucket = bucket as { games: GameWithPrediction[] };
      const nextGames = mergeLiveScoresIntoArray(typedBucket.games, scoreMap);
      if (nextGames === typedBucket.games) return bucket;
      changed = true;
      return { ...typedBucket, games: nextGames };
    });
    return changed ? updatedBuckets : old;
  }

  return mergeLiveScoresIntoArray(old as GameWithPrediction[], scoreMap);
}

export function useLiveScores(options: { trackState?: boolean } = {}) {
  const queryClient = useQueryClient();
  const [liveScores, setLiveScores] = useState<LiveScore[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const trackStateRef = useRef(options.trackState ?? true);
  trackStateRef.current = options.trackState ?? true;

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
    const scoreMap = new Map(scores.map((s) => [s.id, s]));

    notifyManager.batch(() => {
      queryClient.setQueriesData({ queryKey: ['games'] }, (old) =>
        mergeLiveScoresIntoQueryData(old, scoreMap)
      );
      queryClient.setQueryData(['topPicks'], (old) =>
        mergeLiveScoresIntoQueryData(old, scoreMap)
      );

      for (const score of scores) {
        queryClient.setQueryData(['game', score.id], (old) => {
          if (!old) return old;
          return mergeLiveScore(old as GameWithPrediction, scoreMap);
        });
      }
    });

    for (const score of scores) {
      if (score.status === GameStatus.FINAL) {
        queryClient.invalidateQueries({
          queryKey: ['game', score.id],
          refetchType: 'active',
        });
      }
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
      if (trackStateRef.current) setIsConnected(true);
      sseConnectedRef.current = true;
      reconnectDelay.current = MIN_RECONNECT_MS;
    });

    es.addEventListener('scores', (event: CustomEvent<'scores'>) => {
      if (!mountedRef.current) return;
      try {
        const scores: LiveScore[] = JSON.parse(event.data ?? '[]');
        // Always update cache immediately (cheap — only writes if data changed)
        applyScoresRef.current?.(scores);
        if (!trackStateRef.current) return;
        // Throttle setState to max once per 500ms to avoid render storms
        pendingScores.current = scores;
        if (!throttleTimer.current) {
          throttleTimer.current = setTimeout(() => {
            throttleTimer.current = null;
            if (pendingScores.current && mountedRef.current) {
              setLiveScores(pendingScores.current);
              pendingScores.current = null;
            }
          }, 200);
        }
      } catch {
        // malformed payload — ignore
      }
    });

    es.addEventListener('error', () => {
      if (!mountedRef.current) return;
      if (trackStateRef.current) setIsConnected(false);
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
    if (throttleTimer.current) {
      clearTimeout(throttleTimer.current);
      throttleTimer.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (trackStateRef.current) setIsConnected(false);
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
