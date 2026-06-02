import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient, getBearerToken } from "./auth-client";
import {
  AuthSessionSnapshotOptions,
  authSessionFromPayload,
} from "./auth-user";

export const SESSION_QUERY_KEY = ['auth-session'] as const;

const hasSessionUser = (session: unknown): boolean => {
  return Boolean((session as any)?.user);
};

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
    return queryClient.getQueryData(SESSION_QUERY_KEY) ?? null;
  };
};

/**
 * Complete a native auth flow without giving the route guard a stale signed-out
 * frame. Better Auth may return a valid token/user before the immediate
 * getSession refetch has caught up, so we prime the shared session cache first
 * and let the server session reconcile after that.
 */
export const useFinalizeAuthSession = () => {
  const queryClient = useQueryClient();
  const invalidateSession = useInvalidateSession();

  return async (payload: unknown, options: AuthSessionSnapshotOptions = {}) => {
    const bearerToken = getBearerToken();
    const primedSession =
      authSessionFromPayload(payload, options) ??
      (bearerToken ? authSessionFromPayload({ token: bearerToken }, options) : null);
    await queryClient.cancelQueries({ queryKey: SESSION_QUERY_KEY });
    if (primedSession) {
      queryClient.setQueryData(SESSION_QUERY_KEY, primedSession);
      void authClient.getSession().then((result) => {
        if (hasSessionUser(result.data)) {
          queryClient.setQueryData(SESSION_QUERY_KEY, result.data);
        }
      }).catch(() => {});
      return primedSession;
    }

    let refreshedSession: unknown = null;
    try {
      refreshedSession = await invalidateSession();
    } catch {
      refreshedSession = null;
    }

    const currentSession = refreshedSession ?? queryClient.getQueryData(SESSION_QUERY_KEY) ?? null;
    if (!hasSessionUser(currentSession) && primedSession) {
      queryClient.setQueryData(SESSION_QUERY_KEY, primedSession);
      return primedSession;
    }

    return currentSession;
  };
};
