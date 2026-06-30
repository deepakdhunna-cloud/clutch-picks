import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameStatus, type GameWithPrediction } from '@/types/sports';
import { parseGameTime } from '@/lib/game-time';

export const FOLLOWED_GAMES_STORAGE_KEY = 'clutch_followed_games';

export type FollowedGameEntry = {
  id: string;
  followedAt?: string;
};

type FollowedGameStorage = string[] | FollowedGameEntry[];

const CLEARABLE_STATUSES = new Set<string>([
  GameStatus.FINAL,
  GameStatus.CANCELLED,
  GameStatus.POSTPONED,
]);

function normalizeEntries(value: unknown): FollowedGameEntry[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, FollowedGameEntry>();

  value.forEach((item) => {
    if (typeof item === 'string') {
      if (item.trim()) byId.set(item, { id: item });
      return;
    }
    if (!item || typeof item !== 'object') return;
    const record = item as Partial<FollowedGameEntry>;
    if (typeof record.id !== 'string' || !record.id.trim()) return;
    byId.set(record.id, {
      id: record.id,
      followedAt: typeof record.followedAt === 'string' ? record.followedAt : undefined,
    });
  });

  return Array.from(byId.values());
}

export function nextLocalTwoAmAfterGameDay(gameTime: string): Date | null {
  const start = parseGameTime(gameTime);
  if (!start) return null;
  const reset = new Date(start);
  reset.setDate(reset.getDate() + 1);
  reset.setHours(2, 0, 0, 0);
  return reset;
}

function shouldClearTrackedGame(game: GameWithPrediction | undefined, now: Date): boolean {
  if (!game || !CLEARABLE_STATUSES.has(String(game.status))) return false;
  const resetAt = nextLocalTwoAmAfterGameDay(game.gameTime);
  return Boolean(resetAt && now >= resetAt);
}

export function filterFollowedEntriesForReset(
  entries: readonly FollowedGameEntry[],
  games: readonly GameWithPrediction[] | null | undefined,
  now = new Date(),
): FollowedGameEntry[] {
  const gameById = new Map((games ?? []).map((game) => [game.id, game]));
  return entries.filter((entry) => !shouldClearTrackedGame(gameById.get(entry.id), now));
}

async function writeEntries(entries: FollowedGameEntry[]): Promise<void> {
  await AsyncStorage.setItem(FOLLOWED_GAMES_STORAGE_KEY, JSON.stringify(entries));
}

export async function readFollowedGameEntries(): Promise<FollowedGameEntry[]> {
  const raw = await AsyncStorage.getItem(FOLLOWED_GAMES_STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) as FollowedGameStorage : [];
  return normalizeEntries(parsed);
}

export async function readFollowedGameIds(): Promise<string[]> {
  return (await readFollowedGameEntries()).map((entry) => entry.id);
}

export async function toggleFollowedGame(id: string): Promise<string[]> {
  const entries = await readFollowedGameEntries();
  const exists = entries.some((entry) => entry.id === id);
  const next = exists
    ? entries.filter((entry) => entry.id !== id)
    : [...entries, { id, followedAt: new Date().toISOString() }];
  await writeEntries(next);
  return next.map((entry) => entry.id);
}

export async function pruneFollowedGamesForReset(
  games: readonly GameWithPrediction[] | null | undefined,
  now = new Date(),
): Promise<string[]> {
  const entries = await readFollowedGameEntries();
  const kept = filterFollowedEntriesForReset(entries, games, now);

  if (kept.length !== entries.length) {
    await writeEntries(kept);
  } else if (entries.some((entry) => !entry.followedAt)) {
    await writeEntries(entries.map((entry) => entry.followedAt ? entry : {
      ...entry,
      followedAt: now.toISOString(),
    }));
  }

  return kept.map((entry) => entry.id);
}
