import type { GameWithPrediction, Prediction, PredictionFactor, Sport, Team } from '@/types/sports';
import { getCanonicalFinalPick } from './canonical-result';
import { cleanProjectionCopy } from './projection-display';

const STALE_RAW_NARRATIVE =
  /the data points toward|biggest driver|clear separation|Expected score rounds to|Average scoring is basically level|Projected finish rounds to|Home\s+[A-Z0-9]{2,5}\s+Elo|Away\s+[A-Z0-9]{2,5}\s+Elo|Home\s+L10:|Away\s+L10:|\bthe model\b|\bthe algorithm\b/i;

type NarrativeGame = Pick<GameWithPrediction, 'sport' | 'homeTeam' | 'awayTeam' | 'seasonContext'> & {
  prediction?: Prediction;
};

function teamSubject(sport: Sport | string, team: Team): string {
  if (['NBA', 'NFL', 'MLB', 'NHL', 'NCAAB', 'NCAAF'].includes(String(sport))) {
    return `the ${team.name}`;
  }
  return team.name;
}

function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

function parseEloDifferential(description: string): number | null {
  const match = description.match(/=\s*(-?\d+(?:\.\d+)?)\s*pt/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.round(Math.abs(parsed)) : null;
}

function parseRecentForm(description: string): { home: string; away: string } | null {
  const match = description.match(/Home\s+L10:\s*([^,.;]+(?:\([^)]*\))?)\s*,\s*Away\s+L10:\s*([^,.;]+(?:\([^)]*\))?)/i);
  if (!match) return null;
  return {
    home: match[1]?.trim() ?? '',
    away: match[2]?.trim() ?? '',
  };
}

function findFactor(factors: PredictionFactor[] | undefined, terms: string[]): PredictionFactor | undefined {
  return factors?.find((factor) => {
    const haystack = `${factor.name} ${factor.description}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
}

function rebuildStaleNarrative(game: NarrativeGame, prediction: Prediction): string | null {
  const canonicalPick = getCanonicalFinalPick(prediction);
  if (canonicalPick === 'draw') {
    const seasonLabel = game.seasonContext?.label;
    return `${seasonLabel ? `Given the ${seasonLabel}, ` : ''}${teamSubject(game.sport, game.homeTeam)} and ${teamSubject(game.sport, game.awayTeam)} grade close enough that the canonical read is a draw. The supporting factors are not strong enough to separate one side from the other.`;
  }
  const winnerSide = canonicalPick === 'away' ? 'away' : 'home';
  const winner = winnerSide === 'home' ? game.homeTeam : game.awayTeam;
  const loser = winnerSide === 'home' ? game.awayTeam : game.homeTeam;
  const winnerSubject = teamSubject(game.sport, winner);
  const loserSubject = teamSubject(game.sport, loser);
  const ratingFactor = findFactor(prediction.factors, ['elo', 'rating']);
  const formFactor = findFactor(prediction.factors, ['recent form', 'l10']);
  const diff = ratingFactor ? parseEloDifferential(ratingFactor.description) : null;
  const form = formFactor ? parseRecentForm(formFactor.description) : null;
  const winnerForm = form ? (winnerSide === 'home' ? form.home : form.away) : prediction.recentFormHome;
  const loserForm = form ? (winnerSide === 'home' ? form.away : form.home) : prediction.recentFormAway;
  const seasonLabel = game.seasonContext?.label;

  const sentences = [
    `${seasonLabel ? `Given the ${seasonLabel}, ` : ''}${winnerSubject} have the better case against ${loserSubject}, but this is a real matchup read, not a copy-paste pick.`,
  ];

  if (diff !== null) {
    sentences.push(`The model's main lean is the power-rating setup: with location baked in, ${winnerSubject} show about ${diff} rating points of edge.`);
  } else if (ratingFactor?.description) {
    sentences.push(`The model's main lean comes from the power-rating setup, which points toward ${winner.name}.`);
  }

  if (seasonLabel) {
    sentences.push(`Because this is ${seasonLabel}, regular-season numbers are background and the repeatable matchup edges matter more.`);
  }

  if (winnerForm && loserForm) {
    sentences.push(`The counterpoint is ${possessive(loser.name)} recent form: ${loserForm} lately compared with ${winnerForm} for ${winner.name}.`);
  }

  sentences.push(`For fans, the hook is whether ${possessive(winner.name)} main edge shows up before ${possessive(loser.name)} best counter can make the card uncomfortable.`);

  return sentences.join(' ');
}

export function displayPredictionAnalysis(game: NarrativeGame): string {
  const prediction = game.prediction;
  const analysis = prediction?.analysis ?? '';
  if (!analysis) return analysis;
  if (!STALE_RAW_NARRATIVE.test(analysis)) {
    return cleanProjectionCopy(analysis);
  }

  const rebuilt = prediction ? rebuildStaleNarrative(game, prediction) ?? analysis : analysis;
  return cleanProjectionCopy(rebuilt);
}
