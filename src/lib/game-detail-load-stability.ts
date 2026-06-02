import { GameStatus, Sport } from '@/types/sports';
import { isLiveGameStatus } from '@/lib/game-status';

export const GAME_DETAIL_STALE_TIME_MS = 10_000;

type GameDetailMountData = {
  sport?: Sport | string | null;
  status?: GameStatus | string | null;
};

export function shouldRefetchGameDetailOnMount(
  game: GameDetailMountData | null | undefined,
  dataUpdatedAt: number | undefined,
  now = Date.now(),
): boolean {
  if (!game) return true;
  if (game.sport === Sport.IPL && isLiveGameStatus(game.status)) return true;
  if (!dataUpdatedAt) return true;
  return now - dataUpdatedAt >= GAME_DETAIL_STALE_TIME_MS;
}
