type Clock = () => number;

const DEFAULT_INTERACTION_LOCK_MS = 700;
const DEFAULT_DRAG_BLOCK_MS = 500;
const DEFAULT_SETTLE_BLOCK_MS = 220;

const locks = new Map<string, number>();

export function claimInteractionLock(
  key: string,
  windowMs = DEFAULT_INTERACTION_LOCK_MS,
  now = Date.now(),
): boolean {
  const lockedUntil = locks.get(key) ?? 0;
  if (now < lockedUntil) return false;
  locks.set(key, now + windowMs);
  return true;
}

export function releaseInteractionLock(key: string): void {
  locks.delete(key);
}

export function releaseAllInteractionLocksForTests(): void {
  locks.clear();
}

export function createScrollPressBlocker({
  dragBlockMs = DEFAULT_DRAG_BLOCK_MS,
  settleBlockMs = DEFAULT_SETTLE_BLOCK_MS,
  now = Date.now,
}: {
  dragBlockMs?: number;
  settleBlockMs?: number;
  now?: Clock;
} = {}) {
  let blockedUntil = 0;

  return {
    canPress() {
      return now() >= blockedUntil;
    },
    blockForDrag() {
      blockedUntil = now() + dragBlockMs;
    },
    blockForSettle() {
      blockedUntil = now() + settleBlockMs;
    },
    clear() {
      blockedUntil = 0;
    },
  };
}
