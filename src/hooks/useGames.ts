import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api/api';
import { GameWithPrediction, GameStatus } from '@/types/sports';
import { useCallback, useEffect, useMemo } from 'react';
import { sseConnectedRef } from './useLiveScores';
import { enrichCricketLiveGame, enrichCricketLiveGames } from '@/lib/cricket-live-enrichment';
import { filterVerifiedGames, isUnverifiedScoreboardGame } from '@/lib/verified-games';
import { getHomeGamesRequestPlan } from '@/lib/home-games-request-plan';
import { prepareHomeGamesFirstPaint } from '@/lib/home-games-first-paint';
import { HOME_GAMES_CACHE_KEY, selectPersistableHomeGames } from '@/lib/home-games-cache';
import { GAME_DETAIL_STALE_TIME_MS, shouldRefetchGameDetailOnMount } from '@/lib/game-detail-load-stability';
import { mergeGameData, mergeGameLists } from '@/lib/game-cache-merge';

// Polling intervals for different contexts
const LIVE_POLLING_INTERVAL = 3000; // fast fallback when SSE drops, without hammering JS/network
const DEFAULT_POLLING_INTERVAL = 60000; // background freshness; SSE handles live score pushes
// Burst-poll while ANY visible game is missing its prediction. Keep this
// responsive without creating a startup/network storm on large slates.
const PREDICTION_BURST_INTERVAL = 8000;
const STALE_TIME = 30000; // avoid refetching the whole board on every fast tab/screen hop
const scheduledGameDetailWarmups = new Set<string>();

function runAfterNavigationStart(task: () => void) {
  const run = () => setTimeout(task, 0);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
    return;
  }
  run();
}

function findGameInData(data: unknown, gameId: string): GameWithPrediction | undefined {
  if (!data) return undefined;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findGameInData(item, gameId);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof data !== 'object') return undefined;

  const record = data as Record<string, unknown>;
  if (record.id === gameId && record.homeTeam && record.awayTeam) {
    const game = data as GameWithPrediction;
    return isUnverifiedScoreboardGame(game) ? undefined : game;
  }

  const nestedGames = record.games;
  if (Array.isArray(nestedGames)) return findGameInData(nestedGames, gameId);

  const nestedGame = record.game;
  if (nestedGame) return findGameInData(nestedGame, gameId);

  const nestedData = record.data;
  if (nestedData) return findGameInData(nestedData, gameId);

  return undefined;
}

function findCachedGame(queryClient: ReturnType<typeof useQueryClient>, gameId: string): GameWithPrediction | undefined {
  const seeded = queryClient.getQueryData<GameWithPrediction | null>(['game', gameId]);
  if (seeded) return seeded;

  const direct = findGameInData(queryClient.getQueryData<GameWithPrediction[]>(['games']), gameId);
  if (direct) return direct;

  const queries = queryClient.getQueryCache().findAll();
  for (const query of queries) {
    const found = findGameInData(query.state.data, gameId);
    if (found) return found;
  }
  return undefined;
}

function seedGameDetailCache(queryClient: ReturnType<typeof useQueryClient>, gameId: string, game?: GameWithPrediction) {
  if (!game || isUnverifiedScoreboardGame(game)) return;
  queryClient.setQueryData<GameWithPrediction | null>(['game', gameId], (current) => current ?? game);
}

function scheduleGameDetailWarmup(
  queryClient: ReturnType<typeof useQueryClient>,
  gameId: string,
  sourceGame?: GameWithPrediction,
) {
  // If the caller already has the card's game object, seed it immediately so
  // the detail screen can paint from cache. Defer broader cache scans/network
  // prefetches until after the tap has started navigation.
  seedGameDetailCache(queryClient, gameId, sourceGame);

  if (scheduledGameDetailWarmups.has(gameId)) return;
  scheduledGameDetailWarmups.add(gameId);

  runAfterNavigationStart(() => {
    try {
      const cachedGame = sourceGame ?? findCachedGame(queryClient, gameId);
      seedGameDetailCache(queryClient, gameId, cachedGame);

      const detailState = queryClient.getQueryState(['game', gameId]);
      if (detailState?.fetchStatus !== 'fetching') {
        void queryClient.prefetchQuery({
          // queryClient is cache plumbing, not part of the server identity for this request.
          // eslint-disable-next-line @tanstack/query/exhaustive-deps
          queryKey: ['game', gameId],
          queryFn: async () => {
            const result = await api.get<GameWithPrediction>(`/api/games/id/${gameId}`);
            const enriched = await enrichCricketLiveGame(result ?? null);
            const current = findCachedGame(queryClient, gameId);
            if (!enriched) return current ?? null;
            if (isUnverifiedScoreboardGame(enriched)) return null;
            return current ? mergeGameData(current, enriched) : enriched;
          },
          staleTime: GAME_DETAIL_STALE_TIME_MS,
        });
      }

      if (cachedGame) {
        void prefetchNewsForGame(queryClient, cachedGame);
      }
    } finally {
      scheduledGameDetailWarmups.delete(gameId);
    }
  });
}

function shouldBurstForMissingPrediction(game: GameWithPrediction): boolean {
  if (game.prediction) return false;
  if (game.status === GameStatus.LIVE) return true;
  if (game.status !== GameStatus.SCHEDULED) return false;
  return formatLocalDate(new Date(game.gameTime)) === formatLocalDate(new Date());
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Prefetch news for a game's teams
async function prefetchNewsForGame(queryClient: ReturnType<typeof useQueryClient>, game: GameWithPrediction) {
  // Prefetch news for both teams in parallel
  const homeTeamId = game.homeTeam?.id;
  const awayTeamId = game.awayTeam?.id;

  if (!homeTeamId || !awayTeamId) return;

  // Prefetch game news query
  queryClient.prefetchQuery({
    queryKey: ['gameNews', game.id, homeTeamId, awayTeamId],
    queryFn: async () => {
      const [homeNews, awayNews] = await Promise.all([
        api.get<{ news: any[]; pagination: any }>(`/api/news/team/${homeTeamId}`).catch(() => ({ news: [] })),
        api.get<{ news: any[]; pagination: any }>(`/api/news/team/${awayTeamId}`).catch(() => ({ news: [] })),
      ]);

      const allNews = [
        ...(homeNews?.news || []),
        ...(awayNews?.news || []),
      ];

      // Deduplicate by ID
      return Array.from(
        new Map(allNews.map((item) => [item.id, item])).values()
      );
    },
    staleTime: STALE_TIME,
  });
}

// Hook to fetch all games for today with auto-refresh
export function useGames() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    if (queryClient.getQueryData<GameWithPrediction[]>(['games'])) return;

    void AsyncStorage.getItem(HOME_GAMES_CACHE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return;
        const games = prepareHomeGamesFirstPaint(parsed as GameWithPrediction[]);
        if (games.length > 0) {
          queryClient.setQueryData<GameWithPrediction[]>(['games'], games);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const query = useQuery({
    queryKey: ['games'],
    queryFn: async () => {
      const plan = getHomeGamesRequestPlan();
      const fullGames = prepareHomeGamesFirstPaint(
        await api.get<GameWithPrediction[]>(plan.firstPaintPath),
      );
      const currentGames = queryClient.getQueryData<GameWithPrediction[]>(['games']);
      const firstPaintGames = mergeGameLists(fullGames, currentGames);
      const publishGames = (games: GameWithPrediction[]) => {
        const merged = mergeGameLists(games, queryClient.getQueryData<GameWithPrediction[]>(['games']));
        queryClient.setQueryData<GameWithPrediction[]>(['games'], merged);
        return merged;
      };
      const enrichAndPublish = (games: GameWithPrediction[]) => {
        void enrichCricketLiveGames(games)
          .then((enriched) => {
            if (enriched === games) return;
            publishGames(enriched);
          })
          .catch(() => {});
      };

      if (firstPaintGames.length > 0) {
        void AsyncStorage.setItem(
          HOME_GAMES_CACHE_KEY,
          JSON.stringify(selectPersistableHomeGames(firstPaintGames)),
        ).catch(() => {});
      }

      enrichAndPublish(firstPaintGames);

      return firstPaintGames;
    },
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    select: filterVerifiedGames,
    refetchInterval: (query) => {
      const games = filterVerifiedGames(query.state.data);
      // Burst-poll while predictions are still being generated server-side.
      // This is the dominant case right after first paint / sport-filter
      // changes — without it the user stares at empty cards for up to 20s.
      const hasMissingPredictions = games?.some(shouldBurstForMissingPrediction);
      if (hasMissingPredictions) return PREDICTION_BURST_INTERVAL;
      // When SSE is connected globally it pushes live scores into every game cache,
      // so no need for aggressive polling.
      // Fall back to fast polling only when SSE is disconnected and there are live games.
      if (sseConnectedRef.current) return DEFAULT_POLLING_INTERVAL;
      const hasLive = games?.some((g) => g.status === GameStatus.LIVE);
      return hasLive ? LIVE_POLLING_INTERVAL : DEFAULT_POLLING_INTERVAL;
    },
    refetchIntervalInBackground: false,
  });

  // Prefetch game details and news for visible games to make navigation instant
  const prefetchGame = useCallback((gameId: string, sourceGame?: GameWithPrediction) => {
    scheduleGameDetailWarmup(queryClient, gameId, sourceGame);
  }, [queryClient]);

  return {
    data: query.data,
    dataUpdatedAt: query.dataUpdatedAt,
    error: query.error,
    errorUpdatedAt: query.errorUpdatedAt,
    failureCount: query.failureCount,
    failureReason: query.failureReason,
    fetchStatus: query.fetchStatus,
    isError: query.isError,
    isFetched: query.isFetched,
    isFetchedAfterMount: query.isFetchedAfterMount,
    isFetching: query.isFetching,
    isInitialLoading: query.isInitialLoading,
    isLoading: query.isLoading,
    isLoadingError: query.isLoadingError,
    isPaused: query.isPaused,
    isPending: query.isPending,
    isPlaceholderData: query.isPlaceholderData,
    isRefetchError: query.isRefetchError,
    isRefetching: query.isRefetching,
    isStale: query.isStale,
    isSuccess: query.isSuccess,
    prefetchGame,
    refetch: query.refetch,
    status: query.status,
  };
}

// Shared adaptive interval — burst while predictions are missing, then keep
// live score fallback polling consistent anywhere the app renders score data.
function liveAwareInterval(games: GameWithPrediction[] | undefined): number {
  if (games?.some(shouldBurstForMissingPrediction)) return PREDICTION_BURST_INTERVAL;
  if (sseConnectedRef.current) return DEFAULT_POLLING_INTERVAL;
  if (games?.some((g) => g.status === GameStatus.LIVE)) return LIVE_POLLING_INTERVAL;
  return DEFAULT_POLLING_INTERVAL;
}

function liveAwareBucketInterval(
  buckets: Array<{ games: GameWithPrediction[] }> | undefined,
): number {
  return liveAwareInterval(buckets?.flatMap((bucket) => bucket.games ?? []));
}

// Hook to fetch games for a specific sport, with optional date filter
export function useGamesBySport(sport: string, date?: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['games', 'sport', sport, date],
    queryFn: async () => {
      const url = date
        ? `/api/games/${sport.toLowerCase()}?date=${date}`
        : `/api/games/${sport.toLowerCase()}`;
      const result = await api.get<GameWithPrediction[]>(url);
      const enriched = filterVerifiedGames(await enrichCricketLiveGames(result ?? []));
      return mergeGameLists(
        enriched,
        queryClient.getQueryData<GameWithPrediction[]>(['games', 'sport', sport, date]),
      );
    },
    enabled: !!sport,
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    select: filterVerifiedGames,
    refetchInterval: (query) => liveAwareInterval(filterVerifiedGames(query.state.data)),
    refetchIntervalInBackground: false,
  });
}

// Hook to fetch games for a specific date
export function useGamesByDate(date: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['games', 'date', date],
    queryFn: async () => {
      const result = await api.get<GameWithPrediction[]>(`/api/games/date/${date}`);
      const enriched = filterVerifiedGames(await enrichCricketLiveGames(result ?? []));
      return mergeGameLists(
        enriched,
        queryClient.getQueryData<GameWithPrediction[]>(['games', 'date', date]),
      );
    },
    enabled: !!date,
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    select: filterVerifiedGames,
    refetchInterval: (query) => liveAwareInterval(filterVerifiedGames(query.state.data)),
    refetchIntervalInBackground: false,
  });
}

// Hook to filter to only LIVE status games - polling is handled by useGames
export function useLiveGames() {
  const gamesQuery = useGames();
  const {
    data: games,
    prefetchGame,
    dataUpdatedAt,
    error,
    errorUpdatedAt,
    failureCount,
    failureReason,
    fetchStatus,
    isError,
    isFetched,
    isFetchedAfterMount,
    isFetching,
    isInitialLoading,
    isLoading,
    isLoadingError,
    isPaused,
    isPending,
    isPlaceholderData,
    isRefetchError,
    isRefetching,
    isStale,
    isSuccess,
    refetch,
    status,
  } = gamesQuery;

  const liveGames = useMemo(() =>
    games?.filter((game) => game.status === GameStatus.LIVE) ?? [],
    [games]
  );

  return {
    data: liveGames,
    prefetchGame,
    dataUpdatedAt,
    error,
    errorUpdatedAt,
    failureCount,
    failureReason,
    fetchStatus,
    isError,
    isFetched,
    isFetchedAfterMount,
    isFetching,
    isInitialLoading,
    isLoading,
    isLoadingError,
    isPaused,
    isPending,
    isPlaceholderData,
    isRefetchError,
    isRefetching,
    isStale,
    isSuccess,
    refetch,
    status,
  };
}

// Hook to get a single game by ID - with adaptive polling based on game status
export function useGame(gameId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    // queryClient is only used to seed/merge cached detail data for smoother navigation.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: ['game', gameId],
    queryFn: async () => {
      const result = await api.get<GameWithPrediction>(`/api/games/id/${gameId}`);
      const enriched = await enrichCricketLiveGame(result ?? null);
      const current = findCachedGame(queryClient, gameId);
      if (!enriched) return current ?? null;
      if (isUnverifiedScoreboardGame(enriched)) return null;
      return current ? mergeGameData(current, enriched) : enriched;
    },
    enabled: !!gameId,
    staleTime: GAME_DETAIL_STALE_TIME_MS, // Quick stale time to get fresh predictions
    placeholderData: keepPreviousData,
    // Seed from list cache for instant navigation
    initialData: () => {
      return findCachedGame(queryClient, gameId) ?? undefined;
    },
    initialDataUpdatedAt: () => {
      return queryClient.getQueryState(['game', gameId])?.dataUpdatedAt
        ?? queryClient.getQueryState(['games'])?.dataUpdatedAt
        ?? Date.now();
    },
    // Adaptive polling: burst when prediction missing, faster for live games
    refetchInterval: (query) => {
      const game = query.state.data;
      // If the detail page is showing a game without a prediction yet, poll
      // hard so it appears the moment background generation finishes.
      if (game && !game.prediction) return PREDICTION_BURST_INTERVAL;
      if (game?.status === GameStatus.LIVE) {
        // SSE pushes live updates into detail caches, so avoid duplicate
        // polling churn unless the stream is disconnected.
        return sseConnectedRef.current ? DEFAULT_POLLING_INTERVAL : LIVE_POLLING_INTERVAL;
      }
      return DEFAULT_POLLING_INTERVAL;
    },
    refetchIntervalInBackground: false,
    refetchOnMount: (query) => {
      return shouldRefetchGameDetailOnMount(query.state.data, query.state.dataUpdatedAt);
    },
  });

  return query;
}

// Hook to fetch 3 days of games for a specific sport (today + 2 days)
export function useWeekGamesBySport(sport: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['games', 'week', sport],
    queryFn: async () => {
      const today = new Date();
      const dates: string[] = [];

      // Get dates for today + next 2 days (3 days total for better performance)
      for (let i = 0; i < 3; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        dates.push(formatLocalDate(date));
      }

      // Fetch games for each date in parallel
      return Promise.all(
        dates.map(async (date) => {
          const games = await api.get<GameWithPrediction[]>(
            `/api/games/${sport.toLowerCase()}?date=${date}`
          );
          const enriched = filterVerifiedGames(await enrichCricketLiveGames(games ?? []));
          const previousBuckets = queryClient.getQueryData<Array<{ date: string; games: GameWithPrediction[] }>>([
            'games',
            'week',
            sport,
          ]);
          const previousGames = previousBuckets?.find((bucket) => bucket.date === date)?.games;
          return { date, games: mergeGameLists(enriched, previousGames) };
        })
      );
    },
    enabled: !!sport,
    staleTime: GAME_DETAIL_STALE_TIME_MS,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => liveAwareBucketInterval(query.state.data?.map((bucket) => ({
      ...bucket,
      games: filterVerifiedGames(bucket.games),
    }))),
    refetchIntervalInBackground: false,
  });
}

// Lightweight hook that returns only prefetchGame — no useQuery subscription.
// Use this in list-item components to avoid subscribing every card to ['games'].
export function usePrefetchGame() {
  const queryClient = useQueryClient();

  return useCallback((gameId: string, sourceGame?: GameWithPrediction) => {
    scheduleGameDetailWarmup(queryClient, gameId, sourceGame);
  }, [queryClient]);
}

// Hook to manually trigger refresh across all game queries
export function useRefreshGames() {
  const queryClient = useQueryClient();

  const refreshAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['games'] }),
      queryClient.invalidateQueries({ queryKey: ['game'] }),
    ]);
  }, [queryClient]);

  const refreshGame = useCallback(async (gameId: string) => {
    await queryClient.invalidateQueries({ queryKey: ['game', gameId] });
  }, [queryClient]);

  return { refreshAll, refreshGame };
}

// Hook to fetch top picks with guaranteed predictions
export function useTopPicks() {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['topPicks'],
    queryFn: async () => {
      const result = await api.get<GameWithPrediction[]>('/api/games/top-picks');
      const enriched = filterVerifiedGames(await enrichCricketLiveGames(result ?? []));
      return mergeGameLists(enriched, queryClient.getQueryData<GameWithPrediction[]>(['topPicks']));
    },
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    select: filterVerifiedGames,
    refetchInterval: (query) => liveAwareInterval(filterVerifiedGames(query.state.data)),
    refetchIntervalInBackground: false,
  });
}
