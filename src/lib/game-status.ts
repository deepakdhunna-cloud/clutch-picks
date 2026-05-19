import { GameStatus, type GameWithPrediction } from '@/types/sports';

type SuspendedGameLike = {
  status: GameStatus | string;
  quarter?: string;
  clock?: string;
  statusLabel?: string;
  statusDetail?: string;
  suspension?: GameWithPrediction['suspension'];
};

export function isSuspendedGame(game: SuspendedGameLike): boolean {
  if (game.suspension) return true;
  if (game.status !== GameStatus.LIVE && game.status !== 'LIVE') return false;
  const text = [game.statusLabel, game.statusDetail, game.quarter, game.clock].filter(Boolean).join(' ').toLowerCase();
  return text.includes('suspended') || text.includes('interrupted') || text.includes('weather delay') || text.includes('rain delay');
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
