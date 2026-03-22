import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

// Types for social features
export interface SocialUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  bio: string | null;
}

export interface SocialStats {
  followersCount: number;
  followingCount: number;
}

export interface FollowResponse {
  success: boolean;
}

export interface IsFollowingResponse {
  isFollowing: boolean;
}

// Hook to follow a user
export function useFollowUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      api.post<FollowResponse>(`/api/social/follow/${userId}`, {}),
    onSuccess: (_, userId) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['social', 'followers', userId] });
      queryClient.invalidateQueries({ queryKey: ['social', 'following'] });
      queryClient.invalidateQueries({ queryKey: ['social', 'stats', userId] });
      queryClient.invalidateQueries({ queryKey: ['social', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['social', 'is-following', userId] });
      queryClient.invalidateQueries({ queryKey: ['user-profile', userId] });
    },
  });
}

// Hook to unfollow a user
export function useUnfollowUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      api.delete<FollowResponse>(`/api/social/unfollow/${userId}`),
    onSuccess: (_, userId) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['social', 'followers', userId] });
      queryClient.invalidateQueries({ queryKey: ['social', 'following'] });
      queryClient.invalidateQueries({ queryKey: ['social', 'stats', userId] });
      queryClient.invalidateQueries({ queryKey: ['social', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['social', 'is-following', userId] });
      queryClient.invalidateQueries({ queryKey: ['user-profile', userId] });
    },
  });
}

// Hook to get followers list
export function useFollowers(userId: string | undefined) {
  return useQuery({
    queryKey: ['social', 'followers', userId],
    queryFn: async () => {
      const result = await api.get<{ followers: SocialUser[] }>(`/api/social/followers/${userId}`);
      return result?.followers ?? [];
    },
    enabled: !!userId,
    staleTime: 15000, // 15 seconds
    refetchIntervalInBackground: false,
  });
}

// Hook to get following list
export function useFollowing(userId: string | undefined) {
  return useQuery({
    queryKey: ['social', 'following', userId],
    queryFn: async () => {
      const result = await api.get<{ following: SocialUser[] }>(`/api/social/following/${userId}`);
      return result?.following ?? [];
    },
    enabled: !!userId,
    staleTime: 15000, // 15 seconds
    refetchIntervalInBackground: false,
  });
}

// Hook to get social stats (follower/following counts)
export function useSocialStats(userId: string | undefined) {
  return useQuery({
    queryKey: ['social', 'stats', userId],
    queryFn: async () => {
      const result = await api.get<SocialStats>(`/api/social/stats/${userId}`);
      // Ensure we never return undefined - React Query requires a defined value
      return result ?? { followersCount: 0, followingCount: 0 };
    },
    enabled: !!userId,
    staleTime: 10000, // 10 seconds
    refetchIntervalInBackground: false,
  });
}

// Hook to check if current user follows a specific user
export function useIsFollowing(userId: string | undefined) {
  return useQuery({
    queryKey: ['social', 'is-following', userId],
    queryFn: async () => {
      const result = await api.get<IsFollowingResponse>(`/api/social/is-following/${userId}`);
      return result?.isFollowing ?? false;
    },
    enabled: !!userId,
    staleTime: 10000, // 10 seconds
    refetchIntervalInBackground: false,
  });
}

// Hook to get another user's profile
export function useUserProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-profile', userId],
    queryFn: async () => {
      const result = await api.get<{
        id: string;
        name: string;
        email: string | null;
        image: string | null;
        bio: string | null;
        isPrivate: boolean;
        followersCount: number;
        followingCount: number;
        isFollowing?: boolean;
      }>(`/api/profile/${userId}`);
      return result ?? null;
    },
    enabled: !!userId,
    staleTime: 15000, // 15 seconds
    refetchIntervalInBackground: false,
  });
}

// Hook to get user's pick stats
export function useUserPickStats(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-pick-stats', userId],
    queryFn: async () => {
      const result = await api.get<{
        picksMade: number;
        wins: number;
        losses: number;
        winRate: number;
        currentStreak: number;
      }>(`/api/picks/stats/${userId}`);
      return result ?? {
        picksMade: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        currentStreak: 0,
      };
    },
    enabled: !!userId,
    staleTime: 15000, // 15 seconds
    refetchInterval: 60000, // 1 minute for stats
    refetchIntervalInBackground: false,
  });
}
