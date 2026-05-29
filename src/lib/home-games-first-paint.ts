import type { GameWithPrediction } from '@/types/sports';
import { filterVerifiedGames } from './verified-games';

export function prepareHomeGamesFirstPaint(games: GameWithPrediction[] | null | undefined): GameWithPrediction[] {
  return filterVerifiedGames(games ?? []);
}
