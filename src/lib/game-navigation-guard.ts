const GAME_NAVIGATION_LOCK_MS = 1200;

let lockedUntil = 0;
let lockedGameId: string | null = null;

export function claimGameNavigation(gameId: string): boolean {
  const now = Date.now();
  if (now < lockedUntil) {
    return false;
  }

  lockedGameId = gameId;
  lockedUntil = now + GAME_NAVIGATION_LOCK_MS;
  return true;
}

export function releaseGameNavigationForTests(): void {
  lockedUntil = 0;
  lockedGameId = null;
}

export function currentGameNavigationLockForTests(): string | null {
  return Date.now() < lockedUntil ? lockedGameId : null;
}
