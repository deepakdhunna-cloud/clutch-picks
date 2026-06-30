import type { GameWithPrediction } from '@/types/sports';

// Bump the version when the persisted shape changes so old payloads are
// ignored rather than mis-parsed. v4 introduces a day-stamped envelope (was a
// bare array in v3) — see HomeGamesCacheEnvelope below.
export const HOME_GAMES_CACHE_KEY = 'clutch.home-games.v4';
const HOME_GAMES_CACHE_LIMIT = 120;

export function selectPersistableHomeGames(games: GameWithPrediction[]): GameWithPrediction[] {
  return games.slice(0, HOME_GAMES_CACHE_LIMIT);
}

// The persisted home slate is only ever a FIRST-PAINT accelerator. It must
// never be authoritative: a live /api/games fetch always runs on mount and
// replaces it. To make that safe we wrap the games in a day-stamped envelope
// so a slate persisted on a previous local day is discarded on load and can
// never paint a stale "yesterday" board (the exact failure we hit: a frozen
// 80-game previous-day slate served from disk while the network was never
// consulted).
export type HomeGamesCacheEnvelope = {
  // Local calendar day the slate was saved on, "YYYY-MM-DD".
  savedLocalDay: string;
  // Epoch ms when saved (for optional age checks/telemetry).
  savedAt: number;
  games: GameWithPrediction[];
};

// Local (device-timezone) calendar day key. Local — not UTC — because the board
// is presented in the user's local day, so cache validity must match what the
// user considers "today".
export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildHomeGamesCacheEnvelope(
  games: GameWithPrediction[],
): HomeGamesCacheEnvelope {
  return {
    savedLocalDay: localDayKey(),
    savedAt: Date.now(),
    games: selectPersistableHomeGames(games),
  };
}

// Parse a persisted payload and return the games ONLY if the envelope is valid
// AND was saved on the current local day. Returns [] for anything stale,
// malformed, or from a previous day. Also accepts a legacy bare-array payload
// but treats it as already-stale (returns []) so old v3 data can never paint.
export function readFreshHomeGamesFromCache(raw: string | null): GameWithPrediction[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  // Legacy bare array (pre-v4): not day-stamped, so we cannot trust its
  // freshness. Discard it — a live fetch will repopulate immediately.
  if (Array.isArray(parsed)) return [];

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as HomeGamesCacheEnvelope).games)
  ) {
    return [];
  }

  const envelope = parsed as HomeGamesCacheEnvelope;
  if (envelope.savedLocalDay !== localDayKey()) return [];

  return envelope.games;
}
