import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { useMemo } from 'react';

// Types for picks
export interface Pick {
  id: string;
  userId: string;
  gameId: string;
  pickedTeam: 'home' | 'away';
  result?: 'win' | 'loss' | 'pending';
  homeTeam?: string | null;
  awayTeam?: string | null;
  sport?: string | null;
  createdAt: string;
}

export interface UserStats {
  picksMade: number;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
}

export interface GamePickStats {
  gameId: string;
  homePicks: number;
  awayPicks: number;
  totalPicks: number;
  homePercentage: number;
  awayPercentage: number;
}

type AllPickStatsMap = Record<string, GamePickStats>;

const DEFAULT_STATS: GamePickStats = {
  gameId: '',
  homePicks: 0,
  awayPicks: 0,
  totalPicks: 0,
  homePercentage: 50,
  awayPercentage: 50,
};

// Hook to fetch all user picks with real-time updates
export function useUserPicks() {
  return useQuery({
    queryKey: ['picks'],
    queryFn: async () => {
      const result = await api.get<Pick[]>('/api/picks');
      return result ?? [];
    },
    staleTime: 30000,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });
}

// Hook to fetch user stats with real-time updates
export function useUserStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      const result = await api.get<UserStats>('/api/picks/stats');
      return result ?? {
        picksMade: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        currentStreak: 0,
      };
    },
    staleTime: 30000,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });
}

// Hook to make a pick with optimistic updates
export function useMakePick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { gameId: string; pickedTeam: 'home' | 'away'; homeTeam?: string; awayTeam?: string; sport?: string }) =>
      api.post<Pick>('/api/picks', data),
    onSuccess: (_data, variables) => {
      // Invalidate picks and stats
      queryClient.invalidateQueries({ queryKey: ['picks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      // Invalidate batch pick stats (single query, not per-game)
      queryClient.invalidateQueries({ queryKey: ['allPickStats'] });
      // DON'T invalidate ['games'] — it's expensive and unnecessary for a pick action
    },
  });
}

// Helper to find a pick for a specific game — uses select so only rerenders when this game's pick changes
export function useGamePick(gameId: string) {
  const selector = useMemo(() => (picks: Pick[] | undefined) => picks?.find((p) => p.gameId === gameId), [gameId]);
  return useQuery({
    queryKey: ['picks'],
    queryFn: async () => {
      const result = await api.get<Pick[]>('/api/picks');
      return result ?? [];
    },
    select: selector,
    staleTime: 30000,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });
}

// Hook to refresh all picks data
export function useRefreshPicks() {
  const queryClient = useQueryClient();

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['picks'] }),
      queryClient.invalidateQueries({ queryKey: ['stats'] }),
      queryClient.invalidateQueries({ queryKey: ['allPickStats'] }),
    ]);
  };

  return { refresh };
}

// ─── BATCH PICK STATS (single query for ALL games, replaces per-card queries) ───

// Single query that fetches stats for ALL games at once
function useAllPickStats() {
  return useQuery({
    queryKey: ['allPickStats'],
    queryFn: async () => {
      const result = await api.get<AllPickStatsMap>('/api/picks/all-stats');
      return result ?? {};
    },
    staleTime: 60000, // 1 minute — pick stats don't change fast
    refetchInterval: 120000, // 2 minutes
    refetchIntervalInBackground: false,
  });
}

// Per-card hook: reads from the single batch query via selector (no extra network calls)
export function useGamePickStats(gameId: string) {
  const selector = useMemo(
    () => (data: AllPickStatsMap | undefined) => data?.[gameId] ?? { ...DEFAULT_STATS, gameId },
    [gameId]
  );
  return useQuery({
    queryKey: ['allPickStats'],
    queryFn: async () => {
      const result = await api.get<AllPickStatsMap>('/api/picks/all-stats');
      return result ?? {};
    },
    select: selector,
    staleTime: 60000,
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
  });
}
