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

// Hook to fetch all user picks with real-time updates
export function useUserPicks() {
  return useQuery({
    queryKey: ['picks'],
    queryFn: async () => {
      const result = await api.get<Pick[]>('/api/picks');
      return result ?? [];
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 60 seconds for pick updates
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
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 60 seconds for stats updates
    refetchIntervalInBackground: false,
  });
}

// Hook to make a pick with optimistic updates
export function useMakePick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { gameId: string; pickedTeam: 'home' | 'away' }) =>
      api.post<Pick>('/api/picks', data),
    onSuccess: () => {
      // Immediately invalidate picks and stats queries to refetch
      queryClient.invalidateQueries({ queryKey: ['picks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      // Also refresh games to show updated pick status
      queryClient.invalidateQueries({ queryKey: ['games'] });
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
    ]);
  };

  return { refresh };
}

// Hook to fetch pick stats for a specific game
export function useGamePickStats(gameId: string) {
  return useQuery({
    queryKey: ['gamePickStats', gameId],
    queryFn: async () => {
      const result = await api.get<GamePickStats>(`/api/picks/game/${gameId}/stats`);
      return result ?? {
        gameId,
        homePicks: 0,
        awayPicks: 0,
        totalPicks: 0,
        homePercentage: 50,
        awayPercentage: 50,
      };
    },
    staleTime: 30000, // 30 seconds
    refetchIntervalInBackground: false,
    enabled: !!gameId,
  });
}
