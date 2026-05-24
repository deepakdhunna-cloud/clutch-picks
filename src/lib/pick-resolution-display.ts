type PickLike = {
  pickedTeam: 'home' | 'away';
  result?: 'win' | 'loss' | 'pending' | null;
};

type FinalGameLike = {
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
};

export function resolvePickResultForDisplay(
  pick: PickLike,
  game?: FinalGameLike | null,
): 'win' | 'loss' | 'pending' {
  if (pick.result === 'win' || pick.result === 'loss') return pick.result;
  if (game?.status !== 'FINAL') return 'pending';
  if (typeof game.homeScore !== 'number' || typeof game.awayScore !== 'number') return 'pending';
  if (!Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore)) return 'pending';

  if (game.homeScore === game.awayScore) return 'loss';
  const homeWon = game.homeScore > game.awayScore;
  return pick.pickedTeam === 'home'
    ? homeWon ? 'win' : 'loss'
    : homeWon ? 'loss' : 'win';
}
