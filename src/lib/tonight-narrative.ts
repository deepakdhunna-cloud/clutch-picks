import type { GameWithPrediction } from '@/types/sports';
import { GameStatus } from '@/types/sports';
import { displaySport } from './display-confidence';

const HIGH_CONVICTION_THRESHOLD = 65;
const TOSSUP_HIGH_PCT = 0.25;
const SPOTLIGHT_MIN_GAMES = 4;
const DIVERSE_SPORT_COUNT = 5;
const QUIET_SLATE_THRESHOLD = 5;

function countByValue(arr: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

// "Winning recent form" = either an active 2+ game streak, or a recent string
// (e.g. "W-W-L-W-L") with strictly more wins than losses across at least 3 games.
function isWinningForm(form?: string, streak?: number): boolean {
  if ((streak ?? 0) >= 2) return true;
  if (!form) return false;
  let w = 0;
  let l = 0;
  for (const c of form.toUpperCase()) {
    if (c === 'W') w++;
    else if (c === 'L') l++;
  }
  return w + l >= 3 && w > l;
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Build a 3-5 sentence narrative paragraph describing tonight's slate.
 * Pure function — pass it the list of games shown on the page and it returns
 * a string. Selects 2-4 of the most relevant signals and weaves them together.
 * Falls back to a hardcoded "quiet slate" line when there's nothing distinctive
 * to say.
 */
export function generateTonightNarrative(games: GameWithPrediction[]): string {
  // Scope to the upcoming slate — past games and missing predictions add noise.
  const slate = games.filter(g => g.status === GameStatus.SCHEDULED && g.prediction);
  const totalGames = slate.length;

  const sportCounts = countByValue(slate.map(g => g.sport as string));
  const sportsRanked = Array.from(sportCounts.entries()).sort((a, b) => b[1] - a[1]);
  const sportCount = sportCounts.size;

  const highConv = slate.filter(
    g => (g.prediction?.confidence ?? 0) >= HIGH_CONVICTION_THRESHOLD
  );
  const tossups = slate.filter(g => g.prediction?.isTossUp === true);
  const underdogsOnForm = slate.filter(g => {
    const p = g.prediction;
    if (!p || p.homeWinProbability == null) return false;
    const underdogIsHome = p.homeWinProbability < 50;
    const form = underdogIsHome ? p.recentFormHome : p.recentFormAway;
    const streak = underdogIsHome ? p.homeStreak : p.awayStreak;
    return isWinningForm(form, streak);
  });

  // ─── Empty state ──────────────────────────────────────────────────────
  // Per spec: trigger when the slate is genuinely thin or has no
  // distinguishing analytical features.
  if (
    totalGames < QUIET_SLATE_THRESHOLD ||
    highConv.length === 0 ||
    underdogsOnForm.length === 0
  ) {
    const gw = totalGames === 1 ? 'game' : 'games';
    const sw = sportCount === 1 ? 'sport' : 'sports';
    return `A quiet slate tonight — ${totalGames} ${gw} across ${sportCount} ${sw}, no standout matchups or unusually strong model conviction. A good night for longer-shot calls and discovering new teams to follow.`;
  }

  // ─── Build sentences ──────────────────────────────────────────────────
  const sentences: string[] = [];

  const topSport = sportsRanked[0]!;
  const secondSport = sportsRanked[1];
  const hasSpotlight =
    topSport[1] >= SPOTLIGHT_MIN_GAMES &&
    (!secondSport || topSport[1] >= secondSport[1] * 2);

  // Lead — strongest distinctive signal.
  let leadCoversConviction = false;
  if (hasSpotlight) {
    sentences.push(
      `The ${displaySport(topSport[0])} slate is the headline tonight with ${topSport[1]} games.`
    );
  } else if (highConv.length >= 2) {
    sentences.push(
      `The model has ${highConv.length} high-conviction calls on the board.`
    );
    leadCoversConviction = true;
  } else {
    sentences.push(
      `${totalGames} games across ${sportCount} sports tonight.`
    );
  }

  // Conviction sentence (skip if the lead already mentioned it).
  if (!leadCoversConviction) {
    if (highConv.length >= 2) {
      sentences.push(
        `The model has ${highConv.length} high-conviction calls on the board.`
      );
    } else if (highConv.length === 1) {
      sentences.push(`One game stands out as a high-conviction call.`);
    }
  }

  // Underdog form — guaranteed > 0 here because the empty-state check passed.
  if (underdogsOnForm.length >= 2) {
    sentences.push(
      `${underdogsOnForm.length} underdogs are riding winning recent form.`
    );
  } else {
    sentences.push(`One underdog is riding winning recent form.`);
  }

  // Toss-up density — only when unusually high or unusually low.
  const tossupRatio = totalGames > 0 ? tossups.length / totalGames : 0;
  if (tossupRatio > TOSSUP_HIGH_PCT) {
    sentences.push(
      `${tossups.length} of tonight's matchups are math toss-ups — a wide-open evening.`
    );
  } else if (tossups.length === 0 && totalGames >= 8) {
    sentences.push(
      `No math toss-ups on the board — the model is finding separation in every matchup.`
    );
  }

  // Sports breakdown — only when unusually diverse or single-sport.
  if (sportCount >= DIVERSE_SPORT_COUNT) {
    const sportsList = sportsRanked.map(s => displaySport(s[0]));
    sentences.push(`Coverage spans ${sportCount} sports: ${joinNatural(sportsList)}.`);
  } else if (sportCount === 1 && !hasSpotlight) {
    sentences.push(`A single-sport night — all ${displaySport(topSport[0])}.`);
  }

  // Cap at 5 sentences as a safety belt.
  return sentences.slice(0, 5).join(' ');
}
