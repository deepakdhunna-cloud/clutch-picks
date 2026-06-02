import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import EventSource, { CustomEvent } from 'react-native-sse';
import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { GameStatus, type GameWithPrediction } from '@/types/sports';
import { filterVerifiedGames, isUnverifiedScoreboardGame } from '@/lib/verified-games';
import { isLiveGameStatus } from '@/lib/game-status';

type SSEEvents = 'scores';

export interface LiveScore {
  id: string;
  sport: string;
  source?: GameWithPrediction['source'];
  homeTeam: { abbreviation: string; name: string };
  awayTeam: { abbreviation: string; name: string };
  homeScore: number;
  awayScore: number;
  homeScoreDisplay?: string;
  awayScoreDisplay?: string;
  clock: string | null;
  period: number | null;
  quarter: string | null;
  status: GameStatus.LIVE | GameStatus.FINAL;
  statusLabel?: string;
  statusDetail?: string;
  suspension?: GameWithPrediction['suspension'];
  cricketState?: GameWithPrediction['cricketState'];
  liveState?: GameWithPrediction['liveState'];
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
const MIN_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;
const LIVE_STREAM_STALE_MS = 6_500;
const LIVE_STREAM_WATCHDOG_MS = 2_500;
const WATCHDOG_RECONNECT_COOLDOWN_MS = 10_000;

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

function sameCricketState(
  left: GameWithPrediction['cricketState'],
  right: GameWithPrediction['cricketState'],
): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  const sameInnings = (side: 'home' | 'away') => (
    (left[side]?.scoreText ?? null) === (right[side]?.scoreText ?? null) &&
    (left[side]?.detailText ?? null) === (right[side]?.detailText ?? null) &&
    (left[side]?.runs ?? null) === (right[side]?.runs ?? null) &&
    (left[side]?.wickets ?? null) === (right[side]?.wickets ?? null) &&
    (left[side]?.overs ?? null) === (right[side]?.overs ?? null) &&
    (left[side]?.maxOvers ?? null) === (right[side]?.maxOvers ?? null) &&
      (left[side]?.isBatting ?? false) === (right[side]?.isBatting ?? false)
  );
  const sameBatters = (
    left.currentBatters?.length ?? 0
  ) === (
    right.currentBatters?.length ?? 0
  ) && (left.currentBatters ?? []).every((batter, index) => {
    const next = right.currentBatters?.[index];
    return (
      batter.name === next?.name &&
      batter.role === next?.role &&
      (batter.runs ?? null) === (next?.runs ?? null) &&
      (batter.balls ?? null) === (next?.balls ?? null)
    );
  });
  const sameBowler = (
    (left.currentBowler?.name ?? null) === (right.currentBowler?.name ?? null) &&
    (left.currentBowler?.overs ?? null) === (right.currentBowler?.overs ?? null) &&
    (left.currentBowler?.runsConceded ?? null) === (right.currentBowler?.runsConceded ?? null) &&
    (left.currentBowler?.wickets ?? null) === (right.currentBowler?.wickets ?? null)
  );
  const sameOverTrack = (
    left.overTrack?.length ?? 0
  ) === (
    right.overTrack?.length ?? 0
  ) && (left.overTrack ?? []).every((over, index) => {
    const next = right.overTrack?.[index];
    return (
      over.over === next?.over &&
      over.runs === next?.runs &&
      over.wickets === next?.wickets &&
      (over.complete ?? false) === (next?.complete ?? false)
    );
  });
  const sameCurrentOver = (
    (left.currentOver?.over ?? null) === (right.currentOver?.over ?? null) &&
    (left.currentOver?.runs ?? null) === (right.currentOver?.runs ?? null) &&
    (left.currentOver?.wickets ?? null) === (right.currentOver?.wickets ?? null) &&
    (left.currentOver?.complete ?? false) === (right.currentOver?.complete ?? false) &&
    (left.currentOver?.balls.length ?? 0) === (right.currentOver?.balls.length ?? 0) &&
    (left.currentOver?.balls ?? []).every((ball, index) => {
      const next = right.currentOver?.balls[index];
      return (
        ball.ball === next?.ball &&
        ball.label === next?.label &&
        ball.runs === next?.runs &&
        (ball.wicket ?? false) === (next?.wicket ?? false) &&
        (ball.extra ?? null) === (next?.extra ?? null)
      );
    })
  );
  return (
    sameInnings('home') &&
    sameInnings('away') &&
    (left.battingSide ?? null) === (right.battingSide ?? null) &&
    (left.innings ?? null) === (right.innings ?? null) &&
    (left.summary ?? null) === (right.summary ?? null) &&
    (left.target ?? null) === (right.target ?? null) &&
    sameBatters &&
    sameBowler &&
    sameOverTrack &&
    sameCurrentOver
  );
}

function mergeCricketState(
  current: GameWithPrediction['cricketState'],
  incoming: GameWithPrediction['cricketState'],
): GameWithPrediction['cricketState'] {
  if (!incoming) return current;
  const sameInningsContext =
    (incoming.battingSide ?? null) === (current?.battingSide ?? null) &&
    (incoming.innings ?? null) === (current?.innings ?? null);

  if (!sameInningsContext) return incoming;

  return {
    ...incoming,
    currentBatters: incoming.currentBatters ?? current?.currentBatters,
    currentBowler: incoming.currentBowler ?? current?.currentBowler,
    overTrack: incoming.overTrack ?? current?.overTrack,
    currentOver: incoming.currentOver ?? current?.currentOver,
  };
}

function mergeLiveScore(game: GameWithPrediction, scoreMap: Map<string, LiveScore>): GameWithPrediction {
  const live = scoreMap.get(game.id);
  if (!live) return game;
  const nextLiveState =
    live.liveState ?? (live.status === GameStatus.FINAL ? undefined : game.liveState);
  const nextCricketState = mergeCricketState(game.cricketState, live.cricketState);
  const nextHomeScoreDisplay = live.homeScoreDisplay ?? game.homeScoreDisplay;
  const nextAwayScoreDisplay = live.awayScoreDisplay ?? game.awayScoreDisplay;
  if (
    game.homeScore === live.homeScore &&
    game.awayScore === live.awayScore &&
    (game.homeScoreDisplay ?? null) === (nextHomeScoreDisplay ?? null) &&
    (game.awayScoreDisplay ?? null) === (nextAwayScoreDisplay ?? null) &&
    (game.clock ?? null) === live.clock &&
    (game.quarter ?? null) === live.quarter &&
    game.status === live.status &&
    (game.statusLabel ?? null) === (live.statusLabel ?? null) &&
    (game.statusDetail ?? null) === (live.statusDetail ?? null) &&
    (game.suspension?.display ?? null) === (live.suspension?.display ?? null) &&
    (game.suspension?.resumeText ?? null) === (live.suspension?.resumeText ?? null) &&
    (game.suspension?.reasonText ?? null) === (live.suspension?.reasonText ?? null) &&
    sameCricketState(game.cricketState, nextCricketState) &&
    sameLiveState(game.liveState, nextLiveState)
  ) {
    return game;
  }
  return {
    ...game,
    homeScore: live.homeScore,
    awayScore: live.awayScore,
    homeScoreDisplay: nextHomeScoreDisplay,
    awayScoreDisplay: nextAwayScoreDisplay,
    clock: live.clock ?? undefined,
    quarter: live.quarter ?? undefined,
    status: live.status,
    statusLabel: live.statusLabel,
    statusDetail: live.statusDetail,
    suspension: live.suspension,
    cricketState: nextCricketState,
    liveState: nextLiveState,
  };
}

function dataHasLiveGame(data: unknown): boolean {
  if (!data) return false;
  if (Array.isArray(data)) return data.some(dataHasLiveGame);
  if (typeof data !== 'object') return false;

  const record = data as {
    status?: unknown;
    games?: unknown;
    game?: unknown;
  };

  if (typeof record.status === 'string' && isLiveGameStatus(record.status)) return true;
  return dataHasLiveGame(record.games) || dataHasLiveGame(record.game);
}

function cacheHasLiveGames(queryClient: ReturnType<typeof useQueryClient>): boolean {
  const queries = queryClient.getQueryCache().findAll();
  return queries.some((query) => dataHasLiveGame(query.state.data));
}

function refetchActiveScoreQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['games'], refetchType: 'active' });
  void queryClient.invalidateQueries({ queryKey: ['game'], refetchType: 'active' });
  void queryClient.invalidateQueries({ queryKey: ['topPicks'], refetchType: 'active' });
}

function mergeLiveScoresIntoArray<T extends GameWithPrediction>(
  games: T[],
  scoreMap: Map<string, LiveScore>,
): T[] {
  let changed = false;
  const verifiedGames = filterVerifiedGames(games);
  if (verifiedGames.length !== games.length) changed = true;
  const updated = verifiedGames.map((game) => {
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
      const nextGames = mergeLiveScoresIntoArray(typedBucket.games ?? [], scoreMap);
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
  const lastUsefulScoresAt = useRef(Date.now());
  const lastWatchdogReconnectAt = useRef(0);
  // Stable ref to latest applyScoresToCache — updated below so connect() needs no deps on it
  const applyScoresRef = useRef<((scores: LiveScore[]) => void) | null>(null);
  // Throttle SSE state updates to max once per 500ms
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScores = useRef<LiveScore[] | null>(null);

  const applyScoresToCache = useCallback((scores: LiveScore[]) => {
    if (scores.length === 0) return;
    const verifiedScores = scores.filter((score) => !isUnverifiedScoreboardGame(score));
    const hasUnverifiedScores = verifiedScores.length !== scores.length;
    if (verifiedScores.length === 0 && !hasUnverifiedScores) return;
    const scoreMap = new Map(verifiedScores.map((s) => [s.id, s]));

    // Track which FINAL detail caches need invalidation only on the LIVE->FINAL
    // transition, so we don't refetch the detail query on every final-status tick.
    const finalTransitionIds: string[] = [];

    notifyManager.batch(() => {
      queryClient.setQueriesData({ queryKey: ['games'], type: 'active' }, (old) =>
        mergeLiveScoresIntoQueryData(old, scoreMap)
      );
      queryClient.setQueryData(['topPicks'], (old) =>
        mergeLiveScoresIntoQueryData(old, scoreMap)
      );

      for (const score of scores) {
        if (isUnverifiedScoreboardGame(score)) {
          queryClient.setQueryData(['game', score.id], null);
          continue;
        }
        // Only touch the detail cache for games that have actually been opened —
        // never create a detail-cache entry for an unopened game.
        if (!queryClient.getQueryState(['game', score.id])) continue;
        const prior = queryClient.getQueryData(['game', score.id]) as
          | GameWithPrediction
          | null
          | undefined;
        const wasFinal = prior?.status === GameStatus.FINAL;
        queryClient.setQueryData(['game', score.id], (old) => {
          if (!old) return old;
          return mergeLiveScore(old as GameWithPrediction, scoreMap);
        });
        if (score.status === GameStatus.FINAL && !wasFinal) {
          finalTransitionIds.push(score.id);
        }
      }
    });

    for (const id of finalTransitionIds) {
      queryClient.invalidateQueries({
        queryKey: ['game', id],
        refetchType: 'active',
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
      if (trackStateRef.current) setIsConnected(true);
      sseConnectedRef.current = true;
      reconnectDelay.current = MIN_RECONNECT_MS;
    });

    es.addEventListener('scores', (event: CustomEvent<'scores'>) => {
      if (!mountedRef.current) return;
      try {
        const scores: LiveScore[] = JSON.parse(event.data ?? '[]');
        if (scores.length > 0) {
          lastUsefulScoresAt.current = Date.now();
        }
        // Buffer the latest scores and coalesce BOTH the cache write and the
        // setState flush into a single ~200ms throttled timer with a trailing
        // flush, so bursts of ticks collapse to one cache write + one render.
        // The latest scores always win — the final update is never dropped.
        pendingScores.current = scores;
        if (!throttleTimer.current) {
          throttleTimer.current = setTimeout(() => {
            throttleTimer.current = null;
            const latest = pendingScores.current;
            pendingScores.current = null;
            if (!latest || !mountedRef.current) return;
            // Cache write (cheap — only writes if data changed) always runs.
            applyScoresRef.current?.(latest);
            // setState only when this hook is tracking component state.
            if (trackStateRef.current) {
              setLiveScores(latest);
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
      // Flush any buffered scores to the cache so the latest update is never
      // dropped when a disconnect interrupts the throttle window.
      if (pendingScores.current) {
        applyScoresRef.current?.(pendingScores.current);
        pendingScores.current = null;
      }
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

  // If the socket stays technically open but stops delivering live scores, keep
  // the board moving with active-query polling and force a clean reconnect.
  useEffect(() => {
    const watchdog = setInterval(() => {
      if (!mountedRef.current || appStateRef.current !== 'active') return;

      // Cheap staleness check first — bail before the expensive cache scan.
      const now = Date.now();
      const streamIsStale = now - lastUsefulScoresAt.current > LIVE_STREAM_STALE_MS;
      if (!streamIsStale) return;

      // Only scan the full cache once the stream is actually suspected stale.
      if (!cacheHasLiveGames(queryClient)) return;

      refetchActiveScoreQueries(queryClient);

      if (now - lastWatchdogReconnectAt.current < WATCHDOG_RECONNECT_COOLDOWN_MS) return;
      lastWatchdogReconnectAt.current = now;
      reconnectDelay.current = MIN_RECONNECT_MS;
      disconnect();
      connect();
    }, LIVE_STREAM_WATCHDOG_MS);

    return () => clearInterval(watchdog);
  }, [connect, disconnect, queryClient]);

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
