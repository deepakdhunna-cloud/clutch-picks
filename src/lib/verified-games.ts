import { Sport } from '@/types/sports';

type GameIdentity = {
  id?: string | number | null;
  sport?: Sport | string | null;
  source?: string | null;
  status?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
};

const TRUSTED_SCOREBOARD_SPORTS = new Set<string>(Object.values(Sport));

function hasTrustedScoreboardId(game: GameIdentity): boolean {
  return /^\d+$/.test(String(game.id ?? ''));
}

function isTrustedTennisSupplementalGame(game: GameIdentity): boolean {
  const sport = String(game.sport ?? '').toUpperCase();
  const source = String(game.source ?? '');
  const status = String(game.status ?? '').toUpperCase();
  return (
    sport === Sport.TENNIS &&
    source === 'tennis-explorer' &&
    /^tennis-explorer-\d+$/.test(String(game.id ?? '')) &&
    (status === 'LIVE' || status === 'SCHEDULED')
  );
}

export function isVerifiedScoreboardGame(game: GameIdentity | null | undefined): boolean {
  if (!game) return false;
  const sport = String(game.sport ?? '').toUpperCase();
  if (!TRUSTED_SCOREBOARD_SPORTS.has(sport)) return false;
  if (!hasTrustedScoreboardId(game) && !isTrustedTennisSupplementalGame(game)) return false;

  const scores = [game.homeScore, game.awayScore].filter((score): score is number => typeof score === 'number');
  return scores.every((score) => Number.isFinite(score) && score >= 0);
}

export function isUnverifiedScoreboardGame(game: GameIdentity | null | undefined): boolean {
  return Boolean(game) && !isVerifiedScoreboardGame(game);
}

export function isUnverifiedTennisGame(game: GameIdentity | null | undefined): boolean {
  return isUnverifiedScoreboardGame(game);
}

export function filterVerifiedGames<T extends GameIdentity>(games: readonly T[] | null | undefined): T[] {
  return (games ?? []).filter(isVerifiedScoreboardGame);
}
