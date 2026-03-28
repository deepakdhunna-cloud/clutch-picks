import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { GameWithPrediction, GameStatus } from '@/types/sports';
import { useCallback, useMemo } from 'react';
import { sseConnectedRef } from './useLiveScores';

// Polling intervals for different contexts
const LIVE_POLLING_INTERVAL = 30000; // 30 seconds — SSE handles real-time, this is a fallback
const DEFAULT_POLLING_INTERVAL = 120000; // 2 minutes — no live games, minimal polling
const STALE_TIME = 30000; // 30 seconds — prevents excessive refetches on tab focus
const GAME_DETAIL_STALE_TIME = 15000; // 15 seconds — game detail

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
      const result = await api.get<GameWithPrediction[]>('/api/games');
      return result ?? [];
    },
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      // When SSE is connected it pushes live scores, so no need for aggressive polling.
      // Fall back to fast polling only when SSE is disconnected and there are live games.
      if (sseConnectedRef.current) return DEFAULT_POLLING_INTERVAL;
      const games = query.state.data;
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
    refetchInterval: DEFAULT_POLLING_INTERVAL,
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
    refetchInterval: DEFAULT_POLLING_INTERVAL,
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
    // Adaptive polling: faster for live games
    refetchInterval: (query) => {
      const game = query.state.data;
      if (game?.status === GameStatus.LIVE) {
        // SSE already writes live scores to ['game', id] cache.
        // Only poll as a fallback in case SSE drops. Use longer interval.
        return sseConnectedRef.current ? 30000 : LIVE_POLLING_INTERVAL;
      }
      return DEFAULT_POLLING_INTERVAL; // 45 seconds otherwise
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
    staleTime: 15000, // 15 seconds
    placeholderData: keepPreviousData,
    refetchInterval: 45000, // 45 seconds for week view
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
    staleTime: 60000, // 1 minute - predictions don't change often
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
    refetchIntervalInBackground: false,
  });
}
