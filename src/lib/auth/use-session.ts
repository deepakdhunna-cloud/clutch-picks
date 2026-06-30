import { useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authClient, getBearerToken } from "./auth-client";
import {
  AuthSessionSnapshotOptions,
  authSessionFromPayload,
} from "./auth-user";

export const SESSION_QUERY_KEY = ['auth-session'] as const;

// The shape the app actually reads off the session. Better Auth's getSession()
// is typed loosely (unknown), which previously forced every `session?.user`
// access to error. We type the query result explicitly here so consumers get
// safe, correct optional-chaining without changing any runtime behavior.
export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

export type SessionData = {
  session?: { token?: string | null } | null;
  user?: SessionUser | null;
} | null;

// ── Persisted session snapshot ────────────────────────────────────────────
// On a cold launch React Query has no cached session, so the very first frame
// would render a signed-out / empty-user state and then "restore" the real user
// once the network getSession() resolves. That produces the reported
// "user data appears wiped then restores" flash. To kill it, we persist the
// last-known session snapshot to AsyncStorage and synchronously seed React
// Query with it on boot via initialData, so the previous user is present on the
// first frame and the app opens straight into the correct authenticated state.
const PERSISTED_SESSION_KEY = 'clutch_session_snapshot_v1';

// In-memory mirror of the persisted snapshot. Hydrated once at module load so
// useSession() can hand React Query an initialData value synchronously on the
// first render (AsyncStorage is async and would be too late for frame 1).
let bootstrapSession: unknown | undefined;
let bootstrapHydrated = false;

// Kick off the async read immediately at import time. The result lands before
// (or shortly after) the first useSession() call; either way we also expose a
// promise so callers can await it if needed.
const bootstrapHydration: Promise<void> = AsyncStorage.getItem(PERSISTED_SESSION_KEY)
  .then((raw) => {
    if (raw) {
      try {
        bootstrapSession = JSON.parse(raw);
      } catch {
        bootstrapSession = undefined;
      }
    }
  })
  .catch(() => {
    bootstrapSession = undefined;
  })
  .finally(() => {
    bootstrapHydrated = true;
  });

export const sessionBootstrapReady = bootstrapHydration;

const hasSessionUser = (session: unknown): boolean => {
  return Boolean((session as any)?.user);
};

function persistSessionSnapshot(session: unknown): void {
  try {
    if (hasSessionUser(session)) {
      bootstrapSession = session;
      void AsyncStorage.setItem(PERSISTED_SESSION_KEY, JSON.stringify(session)).catch(() => {});
    } else if (session === null) {
      // Explicit signed-out result — clear the snapshot so we don't resurrect a
      // stale user on the next launch.
      bootstrapSession = null;
      void AsyncStorage.removeItem(PERSISTED_SESSION_KEY).catch(() => {});
    }
  } catch {
    // Persistence must never break auth.
  }
}

export const useSession = () => {
  return useQuery<SessionData>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      const result = await authClient.getSession();
      const next = (result.data ?? null) as SessionData;
      persistSessionSnapshot(next);
      return next;
    },
    staleTime: 1000 * 60 * 5, // 5 min cache
    // Seed the first frame with the last-known session so the UI never paints a
    // signed-out / empty-user flash before the network session resolves. Only
    // provide initialData when we actually have a hydrated snapshot with a user;
    // otherwise let the query show its normal loading state.
    initialData: () => (bootstrapHydrated && hasSessionUser(bootstrapSession) ? (bootstrapSession as SessionData) : undefined),
    // Treat the seeded snapshot as just-stale so React Query still revalidates
    // against the server in the background, but does not block the first frame.
    initialDataUpdatedAt: () => (bootstrapHydrated && hasSessionUser(bootstrapSession) ? Date.now() - 1000 : 0),
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
    const next = queryClient.getQueryData(SESSION_QUERY_KEY) ?? null;
    persistSessionSnapshot(next);
    return next;
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
      persistSessionSnapshot(primedSession);
      void authClient.getSession().then((result) => {
        if (hasSessionUser(result.data)) {
          queryClient.setQueryData(SESSION_QUERY_KEY, result.data);
          persistSessionSnapshot(result.data);
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
      persistSessionSnapshot(primedSession);
      return primedSession;
    }

    return currentSession;
  };
};
