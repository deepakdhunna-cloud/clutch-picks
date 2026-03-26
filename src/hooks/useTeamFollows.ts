import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

export interface TeamFollow {
  id: string;
  userId: string;
  teamId: string;
  teamName: string;
  teamAbbreviation: string;
  sport: string;
  createdAt: string;
}

/** Fetch all teams the current user follows */
export function useTeamFollows() {
  return useQuery({
    queryKey: ['teamFollows'],
    queryFn: () => api.get<TeamFollow[]>('/api/team-follows'),
    staleTime: 60_000,
  });
}

/** Follow a team */
export function useFollowTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (team: { teamId: string; teamName: string; teamAbbreviation: string; sport: string }) =>
      api.post<TeamFollow>('/api/team-follows', team),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teamFollows'] });
    },
  });
}

/** Unfollow a team */
export function useUnfollowTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => api.delete<{ unfollowed: boolean }>(`/api/team-follows/${teamId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teamFollows'] });
    },
  });
}

/** Check if a specific team is followed */
export function useIsTeamFollowed(teamId: string | undefined) {
  const { data: follows } = useTeamFollows();
  if (!teamId || !follows) return false;
  return follows.some((f) => f.teamId === teamId);
}
