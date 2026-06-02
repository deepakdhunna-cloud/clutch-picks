import { GameStatus, type GameWithPrediction } from '@/types/sports';

type SuspendedGameLike = {
  status: GameStatus | string;
  quarter?: string;
  clock?: string;
  statusLabel?: string;
  statusDetail?: string;
  suspension?: GameWithPrediction['suspension'];
};

export function isLiveGameStatus(status: GameStatus | string | null | undefined): boolean {
  const normalized = String(status).toUpperCase();
  return normalized === GameStatus.LIVE || normalized === 'IN_PROGRESS' || normalized === 'HALFTIME';
}

export function isLiveGameLike(game: Pick<SuspendedGameLike, 'status'>): boolean {
  return isLiveGameStatus(game.status);
}

export function isSuspendedGame(game: SuspendedGameLike): boolean {
  if (game.suspension) return true;
  if (!isLiveGameStatus(game.status)) return false;
  const text = [game.statusLabel, game.statusDetail, game.quarter, game.clock].filter(Boolean).join(' ').toLowerCase();
  return text.includes('suspended') || text.includes('interrupted') || text.includes('weather delay') || text.includes('rain delay');
}

export function compareSuspendedGamePriority(a: SuspendedGameLike, b: SuspendedGameLike): number {
  return Number(isSuspendedGame(a)) - Number(isSuspendedGame(b));
}

export function sortSuspendedGamesLast<T extends SuspendedGameLike>(
  games: readonly T[],
  compareWithinGroup?: (a: T, b: T) => number,
): T[] {
  return games
    .map((game, index) => ({ game, index }))
    .sort((a, b) => {
      const suspensionOrder = compareSuspendedGamePriority(a.game, b.game);
      if (suspensionOrder !== 0) return suspensionOrder;
      const groupOrder = compareWithinGroup?.(a.game, b.game) ?? 0;
      if (groupOrder !== 0) return groupOrder;
      return a.index - b.index;
    })
    .map(({ game }) => game);
}

export function suspendedLabel(game: Pick<SuspendedGameLike, 'statusLabel' | 'suspension'>): string {
  return game.suspension?.display ?? game.statusLabel ?? 'Suspended';
}

export function suspendedResumeText(game: Pick<SuspendedGameLike, 'statusDetail' | 'clock' | 'suspension'>): string {
  return game.suspension?.resumeText ?? game.statusDetail ?? game.clock ?? 'No time announced';
}

function reasonFromExplicitStatusText(text: string): string {
  const normalized = text.toLowerCase();
  if (/\blightning\b/.test(normalized)) return 'Lightning delay';
  if (/\brain\b|\brained\b/.test(normalized)) return 'Rain delay';
  if (/\bweather\b/.test(normalized)) return 'Weather delay';
  if (/\bbad light\b/.test(normalized)) return 'Bad light';
  if (/\bdarkness\b/.test(normalized)) return 'Darkness';
  if (/\bcourt\b/.test(normalized) && /\bcondition/.test(normalized)) return 'Court conditions';
  if (/\bmedical\b/.test(normalized)) return 'Medical delay';
  return 'Reason not reported';
}

export function suspendedReasonText(game: Pick<SuspendedGameLike, 'statusLabel' | 'statusDetail' | 'clock' | 'suspension'>): string {
  if (game.suspension?.reasonText) return game.suspension.reasonText;
  return reasonFromExplicitStatusText([game.statusLabel, game.statusDetail, game.clock].filter(Boolean).join(' '));
}
