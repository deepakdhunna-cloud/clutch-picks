import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';

/**
 * Returns a `push` function that prevents double-navigation.
 * If called again within 600ms of the last successful push, it no-ops.
 * Use this for all non-game navigation (game navigation uses claimGameNavigation).
 */
const LOCK_MS = 600;

export function useGuardedPush() {
  const router = useRouter();
  const lockedUntilRef = useRef(0);

  const push = useCallback(
    (...args: Parameters<typeof router.push>) => {
      const now = Date.now();
      if (now < lockedUntilRef.current) return;
      lockedUntilRef.current = now + LOCK_MS;
      router.push(...args);
    },
    [router]
  );

  return push;
}
