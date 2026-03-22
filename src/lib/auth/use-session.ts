import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";

export const SESSION_QUERY_KEY = ['auth-session'] as const;

export const useSession = () => {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      const result = await authClient.getSession();
      return result.data ?? null;
    },
    staleTime: 1000 * 60 * 5, // 5 min cache
  });
};

/**
 * Call this after any auth action (sign-in, sign-up, sign-out)
 * to refresh the session state and trigger navigation guards.
 */
export const useInvalidateSession = () => {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    await queryClient.refetchQueries({ queryKey: SESSION_QUERY_KEY });
  };
};
