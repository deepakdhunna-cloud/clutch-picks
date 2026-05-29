import { type GameWithPrediction } from '@/types/sports';
import { filterVerifiedGames } from './verified-games';

export function mergeGameData(
  previous: GameWithPrediction,
  incoming: GameWithPrediction,
): GameWithPrediction {
  return {
    ...previous,
    ...incoming,
    homeTeam: { ...previous.homeTeam, ...incoming.homeTeam },
    awayTeam: { ...previous.awayTeam, ...incoming.awayTeam },
    prediction: incoming.prediction ?? previous.prediction,
    seasonContext: incoming.seasonContext ?? previous.seasonContext,
    watchSources: incoming.watchSources ?? previous.watchSources,
    homeLinescores: incoming.homeLinescores ?? previous.homeLinescores,
    awayLinescores: incoming.awayLinescores ?? previous.awayLinescores,
    cricketState: incoming.cricketState ?? previous.cricketState,
    liveState: incoming.liveState ?? previous.liveState,
  };
}

export function mergeGameLists(
  incomingGames: GameWithPrediction[],
  previousGames?: GameWithPrediction[],
): GameWithPrediction[] {
  const incoming = filterVerifiedGames(incomingGames);
  const previous = filterVerifiedGames(previousGames);
  if (previous.length === 0) return incoming;

  const previousById = new Map(previous.map((game) => [game.id, game]));
  const incomingIds: string[] = [];
  const mergedById = new Map<string, GameWithPrediction>();

  for (const game of incoming) {
    if (!mergedById.has(game.id)) incomingIds.push(game.id);
    const existing = mergedById.get(game.id) ?? previousById.get(game.id);
    mergedById.set(game.id, existing ? mergeGameData(existing, game) : game);
  }

  const stableIds = previous
    .map((game) => game.id)
    .filter((id) => mergedById.has(id));
  const newIds = incomingIds.filter((id) => !previousById.has(id));

  return [...stableIds, ...newIds]
    .map((id) => mergedById.get(id))
    .filter((game): game is GameWithPrediction => Boolean(game));
}
