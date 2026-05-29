import type { GameWithPrediction } from '@/types/sports';

export const HOME_GAMES_CACHE_KEY = 'clutch.home-games.v3';
const HOME_GAMES_CACHE_LIMIT = 80;

export function selectPersistableHomeGames(games: GameWithPrediction[]): GameWithPrediction[] {
  return games.slice(0, HOME_GAMES_CACHE_LIMIT);
}
