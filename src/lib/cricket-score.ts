import { Sport, type CricketScoreState, type Team } from '@/types/sports';
import { isLiveGameStatus } from '@/lib/game-status';

type Side = 'home' | 'away';
type CricketGameLike = {
  sport: Sport | string;
  homeTeam: Pick<Team, 'abbreviation'>;
  awayTeam: Pick<Team, 'abbreviation'>;
  homeScore?: number;
  awayScore?: number;
  homeScoreDisplay?: string;
  awayScoreDisplay?: string;
  cricketState?: CricketScoreState;
  clock?: string;
  quarter?: string;
  status?: string;
  statusDetail?: string;
};

function normalizeCricketScoreText(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  const scoreMatch = trimmed.match(/(\d+)\s*\/\s*(\d+)/);
  return scoreMatch ? `${scoreMatch[1]}/${scoreMatch[2]}` : trimmed;
}

export function isCricketGame(game: { sport: Sport | string }): boolean {
  return game.sport === Sport.IPL || String(game.sport) === 'IPL';
}

// Sentinel shown when a side has no genuine score data yet (e.g. an innings
// that has not begun, or a feed that has not published a score). We must NOT
// fabricate "0/0" in this case — that was the cause of the bogus "0/0 - 0/0"
// LED board on domestic cricket matches whose ESPN feed returns empty scores.
export const CRICKET_NO_SCORE = '—';

/**
 * Returns true when a side has any genuine score signal from the feed:
 * a slash score display, a parsed innings score, or a numeric run total > 0.
 * A bare numeric 0 with no innings object is treated as "no data".
 */
export function cricketSideHasScore(game: CricketGameLike, side: Side): boolean {
  const display = normalizeCricketScoreText(side === 'home' ? game.homeScoreDisplay : game.awayScoreDisplay);
  if (display && (display.includes('/') || /\d/.test(display))) return true;
  const state = game.cricketState?.[side];
  if (state) {
    if (typeof state.runs === 'number') return true;
    if (typeof state.wickets === 'number') return true;
    if (typeof state.overs === 'number') return true;
    if (normalizeCricketScoreText(state.scoreText)?.includes('/')) return true;
  }
  const numeric = side === 'home' ? game.homeScore : game.awayScore;
  if (typeof numeric === 'number' && numeric > 0) return true;
  return false;
}

export function cricketHasAnyScore(game: CricketGameLike): boolean {
  return cricketSideHasScore(game, 'home') || cricketSideHasScore(game, 'away');
}

export function cricketTeamScoreText(game: CricketGameLike, side: Side): string {
  const display = normalizeCricketScoreText(side === 'home' ? game.homeScoreDisplay : game.awayScoreDisplay);
  const state = game.cricketState?.[side];
  const stateScore = normalizeCricketScoreText(state?.scoreText);
  const numeric = side === 'home' ? game.homeScore : game.awayScore;
  const runs = state?.runs ?? numeric;
  const wickets =
    typeof state?.wickets === 'number'
      ? state.wickets
      : typeof runs === 'number' && runs === 0 && state
        ? 0
        : undefined;
  const wicketScore =
    typeof runs === 'number' && typeof wickets === 'number'
      ? `${runs}/${wickets}`
      : null;

  if (display?.includes('/')) return display;
  if (stateScore?.includes('/')) return stateScore;
  // No genuine score signal for this side — show the sentinel instead of a
  // fabricated 0/0 so "yet to bat" / empty-feed states read cleanly.
  if (!cricketSideHasScore(game, side)) return CRICKET_NO_SCORE;
  return wicketScore ?? display ?? stateScore ?? (typeof numeric === 'number' ? String(numeric) : CRICKET_NO_SCORE);
}

export function teamScoreText(game: CricketGameLike, side: Side): string {
  if (isCricketGame(game)) return cricketTeamScoreText(game, side);
  const numeric = side === 'home' ? game.homeScore : game.awayScore;
  return typeof numeric === 'number' ? String(numeric) : '0';
}

export function scorePairText(game: CricketGameLike): string {
  if (isCricketGame(game)) {
    if (!cricketHasAnyScore(game)) return CRICKET_NO_SCORE;
    return `${cricketTeamScoreText(game, 'away')} - ${cricketTeamScoreText(game, 'home')}`;
  }
  return `${game.awayScore ?? 0} - ${game.homeScore ?? 0}`;
}

function sideRuns(game: CricketGameLike, side: Side): number | undefined {
  return game.cricketState?.[side]?.runs ?? (side === 'home' ? game.homeScore : game.awayScore);
}

function oppositeSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

function cricketOversToBalls(overs: number | undefined): number | null {
  if (overs === undefined || !Number.isFinite(overs)) return null;
  const completedOvers = Math.trunc(overs);
  const ballsInCurrentOver = Math.min(6, Math.max(0, Math.round((overs - completedOvers) * 10)));
  return completedOvers * 6 + ballsInCurrentOver;
}

function cricketBallsLimit(maxOvers: number | undefined): number {
  return Math.round((maxOvers ?? 20) * 6);
}

function cricketInningsComplete(innings: CricketScoreState[Side] | undefined): boolean {
  if (!innings) return false;
  if (/complete/i.test(innings.description ?? '')) return true;
  if (typeof innings.wickets === 'number' && innings.wickets >= 10) return true;
  const ballsBowled = cricketOversToBalls(innings.overs);
  return ballsBowled !== null && ballsBowled >= cricketBallsLimit(innings.maxOvers);
}

export function cricketFirstInningsSide(game: CricketGameLike): Side | null {
  if (!isCricketGame(game)) return null;
  const target = game.cricketState?.target;
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 1) return null;

  const targetRuns = target - 1;
  const homeRuns = sideRuns(game, 'home');
  const awayRuns = sideRuns(game, 'away');
  const homeMatchesTarget = homeRuns === targetRuns;
  const awayMatchesTarget = awayRuns === targetRuns;

  if (homeMatchesTarget && !awayMatchesTarget) return 'home';
  if (awayMatchesTarget && !homeMatchesTarget) return 'away';

  const homeComplete = cricketInningsComplete(game.cricketState?.home);
  const awayComplete = cricketInningsComplete(game.cricketState?.away);
  if (homeComplete && !awayComplete) return 'home';
  if (awayComplete && !homeComplete) return 'away';

  return null;
}

export function cricketBattingSide(game: CricketGameLike): Side | null {
  if (!isCricketGame(game)) return null;

  const firstInningsSide = cricketFirstInningsSide(game);
  if (firstInningsSide) return oppositeSide(firstInningsSide);

  const activeByFlag = (['home', 'away'] as const).filter((side) => (
    game.cricketState?.[side]?.isBatting === true &&
    !cricketInningsComplete(game.cricketState?.[side])
  ));
  if (activeByFlag.length === 1) return activeByFlag[0] ?? null;

  return game.cricketState?.battingSide ?? inferCricketBattingSide(game);
}

export function cricketStatusText(game: CricketGameLike): string | null {
  if (!isCricketGame(game)) return null;

  const side = cricketBattingSide(game);
  if (side) {
    const innings = game.cricketState?.[side];
    const team = side === 'home' ? game.homeTeam : game.awayTeam;
    const scoreText = cricketTeamScoreText(game, side);
    if (innings && scoreText) {
      return [team.abbreviation, scoreText, innings.detailText].filter(Boolean).join(' · ');
    }
  }

  return game.statusDetail ?? game.quarter ?? game.clock ?? null;
}

export function cricketOversText(game: CricketGameLike): string | null {
  if (!isCricketGame(game)) return null;
  const side = cricketBattingSide(game);
  const innings = side ? game.cricketState?.[side] : undefined;
  return innings?.detailText ?? game.clock ?? null;
}

export function cricketInningsPlateText(game: CricketGameLike): string | null {
  if (!isCricketGame(game)) return null;
  const innings = game.cricketState?.innings;
  if (typeof innings === 'number' && Number.isFinite(innings) && innings > 0) {
    return `IN${innings}`;
  }
  return 'IN';
}

export function cricketLedScoreText(game: CricketGameLike): string | null {
  if (!isCricketGame(game)) return null;
  // No genuine score from the feed yet — let the card fall back to a clean
  // status (e.g. "LIVE" / match time) instead of a fabricated 0/0 board.
  if (!cricketHasAnyScore(game)) return null;
  const battingSide = cricketBattingSide(game);
  if (!battingSide) return cricketScoreboardText(game);
  return cricketTeamScoreText(game, battingSide);
}

export function cricketInningsContext(game: CricketGameLike): { label: string; value: string; detail: string } | null {
  if (!isCricketGame(game)) return null;
  const battingSide = cricketBattingSide(game);
  if (!battingSide) return null;

  const firstInningsSide: Side = cricketFirstInningsSide(game) ?? oppositeSide(battingSide);
  const firstInnings = game.cricketState?.[firstInningsSide];
  if (typeof firstInnings?.runs !== 'number' || firstInnings.runs <= 0) {
    const battingInnings = game.cricketState?.[battingSide];
    const battingTeam = battingSide === 'home' ? game.homeTeam : game.awayTeam;
    const inningsComplete =
      typeof battingInnings?.wickets === 'number' && battingInnings.wickets >= 10
      || (cricketOversToBalls(battingInnings?.overs) ?? -1) >= cricketBallsLimit(battingInnings?.maxOvers);
    if (!inningsComplete) return null;
    return {
      label: '1ST INNS',
      value: cricketTeamScoreText(game, battingSide),
      detail: `${battingTeam.abbreviation} complete`,
    };
  }

  const target = game.cricketState?.target ?? firstInnings.runs + 1;
  const team = firstInningsSide === 'home' ? game.homeTeam : game.awayTeam;
  return {
    label: 'TARGET',
    value: String(target),
    detail: `${team.abbreviation} ${cricketTeamScoreText(game, firstInningsSide)}`,
  };
}

export function cricketRequiredText(game: CricketGameLike): string | null {
  if (!isCricketGame(game)) return null;
  const battingSide = cricketBattingSide(game);
  if (!battingSide) return null;

  const bowlingSide: Side = oppositeSide(battingSide);
  const battingInnings = game.cricketState?.[battingSide];
  const bowlingInnings = game.cricketState?.[bowlingSide];
  const battingRuns = battingInnings?.runs ?? (battingSide === 'home' ? game.homeScore : game.awayScore);
  const target = game.cricketState?.target ?? (typeof bowlingInnings?.runs === 'number' && bowlingInnings.runs > 0 ? bowlingInnings.runs + 1 : undefined);
  if (typeof battingRuns !== 'number' || typeof target !== 'number') return null;

  const runsNeeded = target - battingRuns;
  if (runsNeeded <= 0) return 'Target reached';

  const ballsBowled = cricketOversToBalls(battingInnings?.overs);
  if (ballsBowled === null) return null;

  const ballsRemaining = Math.max(0, cricketBallsLimit(battingInnings?.maxOvers) - ballsBowled);
  return `Need ${runsNeeded} off ${ballsRemaining} ${ballsRemaining === 1 ? 'ball' : 'balls'}`;
}

export function cricketRoleText(game: CricketGameLike, side: Side): 'BATTING' | 'BOWLING' | null {
  if (!isCricketGame(game)) return null;
  const battingSide = cricketBattingSide(game);
  if (!battingSide) return null;
  return side === battingSide ? 'BATTING' : 'BOWLING';
}

export function cricketInningsRuns(game: CricketGameLike, side: Side): (number | null)[] | null {
  if (!isCricketGame(game)) return null;
  const battingSide = cricketBattingSide(game);
  const firstInningsSide = cricketFirstInningsSide(game);
  const runs = sideRuns(game, side);
  if (typeof runs !== 'number') return null;

  if (firstInningsSide && side === firstInningsSide) return [runs, null];
  if (firstInningsSide && side === battingSide) return [null, runs];
  if (side === battingSide) return [runs];
  return null;
}

function formatBatterLine(batter: NonNullable<CricketScoreState['currentBatters']>[number]): string {
  const stats = typeof batter.runs === 'number' && typeof batter.balls === 'number'
    ? ` ${batter.runs} (${batter.balls})`
    : '';
  const strikeMark = batter.role === 'striker' ? '*' : '';
  return `${batter.name}${strikeMark}${stats}`;
}

function currentBatters(game: CricketGameLike): NonNullable<CricketScoreState['currentBatters']> | null {
  const batters = game.cricketState?.currentBatters;
  if (!batters?.length) return null;
  return [...batters].sort((a, b) => {
    if (a.role === b.role) return 0;
    return a.role === 'striker' ? -1 : 1;
  });
}

export function cricketBattersText(game: CricketGameLike): string | null {
  if (!isCricketGame(game)) return null;
  const batters = currentBatters(game);
  if (!batters) return null;
  return `Bat: ${batters.map(formatBatterLine).join(' · ')}`;
}

export function cricketBowlerText(game: CricketGameLike): string | null {
  if (!isCricketGame(game)) return null;
  const bowler = game.cricketState?.currentBowler;
  if (!bowler?.name) return null;

  const details = [
    bowler.overs ? `${bowler.overs} ov` : null,
    typeof bowler.wickets === 'number' && typeof bowler.runsConceded === 'number'
      ? `${bowler.wickets}/${bowler.runsConceded}`
      : null,
  ].filter(Boolean);

  return `Bowl: ${bowler.name}${details.length ? ` · ${details.join(' · ')}` : ''}`;
}

export function cricketPlayersCompactText(game: CricketGameLike): string | null {
  if (!isCricketGame(game)) return null;
  const batters = currentBatters(game);
  const bowler = game.cricketState?.currentBowler;
  const batterNames = batters?.map((batter) => `${batter.name}${batter.role === 'striker' ? '*' : ''}`).join(' / ');

  if (batterNames && bowler?.name) return `${batterNames} · Bowl: ${bowler.name}`;
  if (batterNames) return `Bat: ${batterNames}`;
  if (bowler?.name) return `Bowl: ${bowler.name}`;
  return null;
}

export function inferCricketBattingSide(game: CricketGameLike): Side | null {
  if (!isCricketGame(game)) return null;
  const homeRuns = game.cricketState?.home?.runs ?? game.homeScore ?? 0;
  const awayRuns = game.cricketState?.away?.runs ?? game.awayScore ?? 0;

  if (homeRuns > 0 && awayRuns === 0) return 'home';
  if (awayRuns > 0 && homeRuns === 0) return 'away';
  return null;
}

export function cricketScoreboardText(game: CricketGameLike): string | null {
  if (!isCricketGame(game)) return null;
  if (!cricketHasAnyScore(game)) return null;
  return `${cricketTeamScoreText(game, 'home')}-${cricketTeamScoreText(game, 'away')}`;
}

export function finalScoreLine(game: CricketGameLike): string {
  if (isCricketGame(game)) {
    return `${game.awayTeam.abbreviation} ${cricketTeamScoreText(game, 'away')}, ${game.homeTeam.abbreviation} ${cricketTeamScoreText(game, 'home')}`;
  }
  return `${game.awayTeam.abbreviation} ${game.awayScore ?? 0}, ${game.homeTeam.abbreviation} ${game.homeScore ?? 0}`;
}
