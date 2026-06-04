/**
 * Generic navigation guard — prevents double-push on any route.
 * Works alongside the game-specific guard (which has a longer lock for game detail prefetch).
 */
const NAVIGATION_LOCK_MS = 600;
let lockedUntil = 0;

export function claimNavigation(): boolean {
  const now = Date.now();
  if (now < lockedUntil) return false;
  lockedUntil = now + NAVIGATION_LOCK_MS;
  return true;
}
