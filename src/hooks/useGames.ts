import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { GameWithPrediction, GameStatus, Sport } from '@/types/sports';
import { useCallback, useMemo } from 'react';
import { sseConnectedRef } from './useLiveScores';
import { enrichCricketLiveGame, enrichCricketLiveGames } from '@/lib/cricket-live-enrichment';

// Polling intervals for different contexts
const LIVE_POLLING_INTERVAL = 5000; // fast fallback when SSE drops, without hammering JS/network
const DEFAULT_POLLING_INTERVAL = 60000; // background freshness; SSE handles live score pushes
// Burst-poll while ANY visible game is missing its prediction. Keep this
// responsive without creating a startup/network storm on large slates.
const PREDICTION_BURST_INTERVAL = 8000;
const STALE_TIME = 30000; // avoid refetching the whole board on every fast tab/screen hop
const GAME_DETAIL_STALE_TIME = 10000;

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
    return data as GameWithPrediction;
  }

  const nestedGames = record.games;
  if (Array.isArray(nestedGames)) return findGameInData(nestedGames, gameId);

  const nestedGame = record.game;
  if (nestedGame) return findGameInData(nestedGame, gameId);

  return undefined;
}

function findCachedGame(queryClient: ReturnType<typeof useQueryClient>, gameId: string): GameWithPrediction | undefined {
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
  if (!game) return;
  queryClient.setQueryData<GameWithPrediction | null>(['game', gameId], (current) => current ?? game);
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function boardDates() {
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
  return {
    priority: [formatLocalDate(yesterday), formatLocalDate(today)],
    deferred: [formatLocalDate(tomorrow), formatLocalDate(dayAfter)],
  };
}

async function fetchGamesForDates(dates: string[]): Promise<GameWithPrediction[]> {
  const results = await Promise.all(
    dates.map((d) =>
      api.get<GameWithPrediction[]>(`/api/games/date/${d}`).catch(() => [] as GameWithPrediction[])
    )
  );
  return enrichCricketLiveGames(results.flat());
}

function dedupeGames(games: GameWithPrediction[]): GameWithPrediction[] {
  const byId = new Map<string, GameWithPrediction>();
  for (const game of games) byId.set(game.id, game);
  return Array.from(byId.values());
}

function gamesOutsideDates(games: GameWithPrediction[] | undefined, dates: Set<string>): GameWithPrediction[] {
  if (!games) return [];
  return games.filter((game) => !dates.has(formatLocalDate(new Date(game.gameTime))));
}

function shouldBurstForMissingPrediction(game: GameWithPrediction): boolean {
  if (game.prediction) return false;
  if (game.status === GameStatus.LIVE) return true;
  if (game.status !== GameStatus.SCHEDULED) return false;
  return formatLocalDate(new Date(game.gameTime)) === formatLocalDate(new Date());
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

  const query = useQuery({
    queryKey: ['games'],
    queryFn: async () => {
      // Render the first screen from yesterday/today first; future slates are
      // filled in after first paint so cold starts don't wait on four endpoints.
      const dates = boardDates();
      const priorityGames = dedupeGames(await fetchGamesForDates(dates.priority));
      const priorityDateSet = new Set(dates.priority);
      const deferredDateSet = new Set(dates.deferred);
      const currentGames = queryClient.getQueryData<GameWithPrediction[]>(['games']);
      const firstPaintGames = dedupeGames([
        ...priorityGames,
        ...gamesOutsideDates(currentGames, priorityDateSet),
      ]);

      void fetchGamesForDates(dates.deferred)
        .then((futureGames) => {
          queryClient.setQueryData<GameWithPrediction[]>(['games'], (current) => {
            const currentSlate = Array.isArray(current) ? current : firstPaintGames;
            return dedupeGames([
              ...gamesOutsideDates(currentSlate, deferredDateSet),
              ...futureGames,
            ]);
          });
        })
        .catch(() => {});

      return firstPaintGames;
    },
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const games = query.state.data;
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
    // First check if we have game data in cache to get team IDs
    const cachedGame = sourceGame ?? findCachedGame(queryClient, gameId);
    seedGameDetailCache(queryClient, gameId, cachedGame);

    runAfterNavigationStart(() => {
      void queryClient.prefetchQuery({
        queryKey: ['game', gameId],
        queryFn: async () => {
          const result = await api.get<GameWithPrediction>(`/api/games/id/${gameId}`);
          return enrichCricketLiveGame(result ?? null);
        },
        staleTime: GAME_DETAIL_STALE_TIME,
      });

      if (cachedGame) {
        void prefetchNewsForGame(queryClient, cachedGame);
      }
    });
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
  return useQuery({
    queryKey: ['games', 'sport', sport, date],
    queryFn: async () => {
      const url = date
        ? `/api/games/${sport.toLowerCase()}?date=${date}`
        : `/api/games/${sport.toLowerCase()}`;
      const result = await api.get<GameWithPrediction[]>(url);
      return enrichCricketLiveGames(result ?? []);
    },
    enabled: !!sport,
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => liveAwareInterval(query.state.data),
    refetchIntervalInBackground: false,
  });
}

// Hook to fetch games for a specific date
export function useGamesByDate(date: string) {
  return useQuery({
    queryKey: ['games', 'date', date],
    queryFn: async () => {
      const result = await api.get<GameWithPrediction[]>(`/api/games/date/${date}`);
      return enrichCricketLiveGames(result ?? []);
    },
    enabled: !!date,
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => liveAwareInterval(query.state.data),
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
    queryKey: ['game', gameId],
    queryFn: async () => {
      const result = await api.get<GameWithPrediction>(`/api/games/id/${gameId}`);
      return enrichCricketLiveGame(result ?? null);
    },
    enabled: !!gameId,
    staleTime: GAME_DETAIL_STALE_TIME, // Quick stale time to get fresh predictions
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
    // Paint cached game data first. Detail refreshes are scheduled by the
    // screen after the navigation interaction has cleared.
    refetchOnMount: (query) => {
      const data = query.state.data;
      return !data || (data.sport === Sport.IPL && data.status === GameStatus.LIVE);
    },
  });

  return query;
}

// Hook to fetch 3 days of games for a specific sport (today + 2 days)
export function useWeekGamesBySport(sport: string) {
  return useQuery({
    queryKey: ['games', 'week', sport],
    queryFn: async () => {
      const today = new Date();
      const dates: string[] = [];

      // Get dates for today + next 2 days (3 days total for better performance)
      for (let i = 0; i < 3; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        dates.push(date.toISOString().split('T')[0]);
      }

      // Fetch games for each date in parallel
      return Promise.all(
        dates.map(async (date) => {
          const games = await api.get<GameWithPrediction[]>(
            `/api/games/${sport.toLowerCase()}?date=${date}`
          );
          return { date, games: await enrichCricketLiveGames(games ?? []) };
        })
      );
    },
    enabled: !!sport,
    staleTime: GAME_DETAIL_STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => liveAwareBucketInterval(query.state.data),
    refetchIntervalInBackground: false,
  });
}

// Lightweight hook that returns only prefetchGame — no useQuery subscription.
// Use this in list-item components to avoid subscribing every card to ['games'].
export function usePrefetchGame() {
  const queryClient = useQueryClient();

  return useCallback((gameId: string, sourceGame?: GameWithPrediction) => {
    const cachedGame = sourceGame ?? findCachedGame(queryClient, gameId);
    seedGameDetailCache(queryClient, gameId, cachedGame);

    runAfterNavigationStart(() => {
      void queryClient.prefetchQuery({
        queryKey: ['game', gameId],
        queryFn: async () => {
          const result = await api.get<GameWithPrediction>(`/api/games/id/${gameId}`);
          return enrichCricketLiveGame(result ?? null);
        },
        staleTime: GAME_DETAIL_STALE_TIME,
      });

      if (cachedGame) {
        void prefetchNewsForGame(queryClient, cachedGame);
      }
    });
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
  return useQuery({
    queryKey: ['topPicks'],
    queryFn: async () => {
      const result = await api.get<GameWithPrediction[]>('/api/games/top-picks');
      return enrichCricketLiveGames(result ?? []);
    },
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => liveAwareInterval(query.state.data),
    refetchIntervalInBackground: false,
  });
}
