import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { GameWithPrediction, GameStatus } from '@/types/sports';
import { useCallback, useMemo } from 'react';
import { sseConnectedRef } from './useLiveScores';

// Polling intervals for different contexts
const LIVE_POLLING_INTERVAL = 5000; // 5 seconds — fast fallback when SSE drops
const DEFAULT_POLLING_INTERVAL = 20000; // 20 seconds — keeps cards fresh even without live games
// Burst-poll while ANY visible game is missing its prediction. The backend
// generates predictions in the background and returns games without them on
// first request, so we poll fast (~1.5s) to pick them up the moment they
// finish — instead of waiting up to 20s for the next default poll. As soon as
// every game has a prediction we drop back to LIVE/DEFAULT cadence.
const PREDICTION_BURST_INTERVAL = 1500;
const STALE_TIME = 5000; // 5 seconds — quick staleness for snappy tab switches
const GAME_DETAIL_STALE_TIME = 3000; // 3 seconds — game detail stays very fresh

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
      // Workaround: /api/games aggregator was silently dropping today's
      // non-LIVE games + EPL. Fetch today + tomorrow + day-after via the
      // date-specific endpoint (which returns full slates) and merge here
      // until the aggregator bug is root-caused.
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const today = new Date();
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
      const dates = [fmt(today), fmt(tomorrow), fmt(dayAfter)];
      const results = await Promise.all(
        dates.map((d) =>
          api.get<GameWithPrediction[]>(`/api/games/date/${d}`).catch(() => [] as GameWithPrediction[])
        )
      );
      const merged = results.flat();
      // Dedupe by id (last write wins, matches backend dedupe semantics)
      const byId = new Map<string, GameWithPrediction>();
      for (const g of merged) byId.set(g.id, g);
      return Array.from(byId.values());
    },
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const games = query.state.data;
      // Burst-poll while predictions are still being generated server-side.
      // This is the dominant case right after first paint / sport-filter
      // changes — without it the user stares at empty cards for up to 20s.
      const hasMissingPredictions = games?.some((g) => !g.prediction);
      if (hasMissingPredictions) return PREDICTION_BURST_INTERVAL;
      // When SSE is connected it pushes live scores, so no need for aggressive polling.
      // Fall back to fast polling only when SSE is disconnected and there are live games.
      if (sseConnectedRef.current) return DEFAULT_POLLING_INTERVAL;
      const hasLive = games?.some((g) => g.status === GameStatus.LIVE);
      return hasLive ? LIVE_POLLING_INTERVAL : DEFAULT_POLLING_INTERVAL;
    },
    refetchIntervalInBackground: false,
  });

  // Prefetch game details and news for visible games to make navigation instant
  const prefetchGame = useCallback((gameId: string) => {
    // First check if we have game data in cache to get team IDs
    const games = queryClient.getQueryData<GameWithPrediction[]>(['games']);
    const cachedGame = games?.find(g => g.id === gameId);

    // Prefetch game details with prediction eagerly
    queryClient.prefetchQuery({
      queryKey: ['game', gameId],
      queryFn: async () => {
        const result = await api.get<GameWithPrediction>(`/api/games/id/${gameId}`);
        return result ?? null;
      },
      staleTime: GAME_DETAIL_STALE_TIME,
    });

    // If we already have cached game data, prefetch news immediately
    if (cachedGame) {
      prefetchNewsForGame(queryClient, cachedGame);
    }
  }, [queryClient]);

  return { ...query, prefetchGame };
}

// Shared adaptive interval — burst while predictions are missing, otherwise default.
function predictionAwareInterval(games: GameWithPrediction[] | undefined): number {
  if (games?.some((g) => !g.prediction)) return PREDICTION_BURST_INTERVAL;
  return DEFAULT_POLLING_INTERVAL;
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
      return result ?? [];
    },
    enabled: !!sport,
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => predictionAwareInterval(query.state.data),
    refetchIntervalInBackground: false,
  });
}

// Hook to fetch games for a specific date
export function useGamesByDate(date: string) {
  return useQuery({
    queryKey: ['games', 'date', date],
    queryFn: async () => {
      const result = await api.get<GameWithPrediction[]>(`/api/games/date/${date}`);
      return result ?? [];
    },
    enabled: !!date,
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => predictionAwareInterval(query.state.data),
    refetchIntervalInBackground: false,
  });
}

// Hook to filter to only LIVE status games - polling is handled by useGames
export function useLiveGames() {
  const { data: games, prefetchGame, ...rest } = useGames();

  const liveGames = useMemo(() =>
    games?.filter((game) => game.status === GameStatus.LIVE) ?? [],
    [games]
  );

  return {
    data: liveGames,
    prefetchGame,
    ...rest,
  };
}

// Hook to get a single game by ID - with adaptive polling based on game status
export function useGame(gameId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['game', gameId],
    queryFn: async () => {
      const result = await api.get<GameWithPrediction>(`/api/games/id/${gameId}`);
      return result ?? null;
    },
    enabled: !!gameId,
    staleTime: GAME_DETAIL_STALE_TIME, // Quick stale time to get fresh predictions
    placeholderData: keepPreviousData,
    // Seed from list cache for instant navigation
    initialData: () => {
      const games = queryClient.getQueryData<GameWithPrediction[]>(['games']);
      return games?.find(g => g.id === gameId) ?? undefined;
    },
    initialDataUpdatedAt: () => {
      return queryClient.getQueryState(['games'])?.dataUpdatedAt;
    },
    // Adaptive polling: burst when prediction missing, faster for live games
    refetchInterval: (query) => {
      const game = query.state.data;
      // If the detail page is showing a game without a prediction yet, poll
      // hard so it appears the moment background generation finishes.
      if (game && !game.prediction) return PREDICTION_BURST_INTERVAL;
      if (game?.status === GameStatus.LIVE) {
        // SSE writes live scores directly to the ['game', id] cache. Polling
        // hits a backend cache that lags SSE by a few seconds, which can
        // overwrite the freshest SSE-pushed score with stale HTTP data.
        // Defer to SSE when it's connected; only burst-poll as fallback.
        return sseConnectedRef.current ? DEFAULT_POLLING_INTERVAL : LIVE_POLLING_INTERVAL;
      }
      return DEFAULT_POLLING_INTERVAL;
    },
    refetchIntervalInBackground: false,
    // Refetch immediately on mount if no prediction yet, skip if data is fresh
    refetchOnMount: (query) => {
      const data = query.state.data;
      // If we have cached data but no prediction, refetch immediately
      if (data && !data.prediction) return true;
      // If data is fresh (< 15s old), skip refetch — home screen already has it
      if (data && Date.now() - (query.state.dataUpdatedAt || 0) < 15000) return false;
      return true;
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
          return { date, games: games ?? [] };
        })
      );
    },
    enabled: !!sport,
    staleTime: GAME_DETAIL_STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: DEFAULT_POLLING_INTERVAL,
    refetchIntervalInBackground: false,
  });
}

// Lightweight hook that returns only prefetchGame — no useQuery subscription.
// Use this in list-item components to avoid subscribing every card to ['games'].
export function usePrefetchGame() {
  const queryClient = useQueryClient();

  return useCallback((gameId: string) => {
    const games = queryClient.getQueryData<GameWithPrediction[]>(['games']);
    const cachedGame = games?.find(g => g.id === gameId);

    queryClient.prefetchQuery({
      queryKey: ['game', gameId],
      queryFn: async () => {
        const result = await api.get<GameWithPrediction>(`/api/games/id/${gameId}`);
        return result ?? null;
      },
      staleTime: GAME_DETAIL_STALE_TIME,
    });

    if (cachedGame) {
      prefetchNewsForGame(queryClient, cachedGame);
    }
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
      return result ?? [];
    },
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: 60000, // Refresh every minute
    refetchIntervalInBackground: false,
  });
}
