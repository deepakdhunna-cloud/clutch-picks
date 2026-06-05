import type { CanonicalFinalPick, GameWithPrediction, Prediction, Team } from '@/types/sports';
import { getCanonicalConfidence, getCanonicalFinalPick, getCanonicalResult } from './canonical-result';

export type PredictionDisplayOutcome = 'home' | 'away' | 'draw' | 'toss_up' | 'none';
export type PredictionDisplayTeam = Pick<Team, 'name' | 'abbreviation'>;

type PredictionDisplayInput = {
  prediction?: Prediction | null;
  homeTeam: PredictionDisplayTeam;
  awayTeam: PredictionDisplayTeam;
};

export type PredictionDisplay = {
  outcome: PredictionDisplayOutcome;
  finalPick: CanonicalFinalPick | null;
  marketType: 'moneyline' | 'three_way_result' | null;
  team: PredictionDisplayTeam | null;
  teamSide: 'home' | 'away' | null;
  confidence: number;
  isTossUp: boolean;
  label: string;
  shortLabel: string;
  badgeLabel: string;
  leanLabel: string;
};

const TOSS_UP_CONFIDENCE_THRESHOLD = 53;

function formatConfidence(confidence: number): string {
  if (!Number.isFinite(confidence) || confidence <= 0) return '';
  return ` ${Math.round(confidence)}%`;
}

function isCanonicalTossUp(prediction: Prediction | null | undefined, finalPick: CanonicalFinalPick | null, confidence: number): boolean {
  if (finalPick === 'none') return true;
  const canonical = getCanonicalResult(prediction);
  if (!canonical) {
    // No canonical result available — fall back to the legacy isTossUp flag or
    // the displayed confidence threshold. This path only fires for very old
    // predictions that predate the canonical result system.
    const displayedConfidence = Math.round(confidence);
    return Boolean(prediction?.isTossUp) || displayedConfidence < TOSS_UP_CONFIDENCE_THRESHOLD;
  }

  // Mirror the backend isMarketAwareTossUp EXACTLY so the badge, tier label,
  // and projected score line never contradict each other. The single source of
  // truth is the ROUNDED displayed leader probability (what the user sees).
  const entries = [
    { outcome: 'home' as const, probability: canonical.probabilities.home },
    { outcome: 'away' as const, probability: canonical.probabilities.away },
    ...(canonical.probabilities.draw !== undefined
      ? [{ outcome: 'draw' as const, probability: canonical.probabilities.draw }]
      : []),
  ].sort((a, b) => b.probability - a.probability);
  const leader = entries[0];
  const runnerUp = entries[1];
  if (!leader || !runnerUp) return true;

  const displayedLeader = Math.round(leader.probability * 100);
  const lead = leader.probability - runnerUp.probability;
  if (canonical.marketType === 'three_way_result') {
    return displayedLeader < 37 || lead < 0.025;
  }

  // For moneyline sports: toss-up when the displayed leader is below 53% OR
  // the raw probability gap is under 6%. This matches the backend exactly.
  // Previously the frontend also OR'd in prediction.isTossUp and a separate
  // displayedConfidence check, which caused games the backend marked as a
  // valid lean (53%+) to be overridden to toss-up on the client.
  return displayedLeader < 53 || lead < 0.06;
}

export function isPredictionTossUpForDisplay(
  prediction: Prediction | null | undefined,
  confidence: number,
  finalPick: CanonicalFinalPick | null,
): boolean {
  return isCanonicalTossUp(prediction, finalPick, confidence);
}

export function getPredictionDisplay(input: PredictionDisplayInput): PredictionDisplay {
  const { prediction, homeTeam, awayTeam } = input;
  const finalPick = getCanonicalFinalPick(prediction);
  const confidence = getCanonicalConfidence(prediction);

  if (!prediction) {
    return {
      outcome: 'none',
      finalPick,
      marketType: null,
      team: null,
      teamSide: null,
      confidence,
      isTossUp: false,
      label: 'No Pick',
      shortLabel: 'No Pick',
      badgeLabel: 'PICK',
      leanLabel: 'No model pick',
    };
  }

  if (finalPick === 'draw' || (!prediction.canonicalResult && prediction.predictedOutcome === 'draw')) {
    const confidenceText = formatConfidence(confidence);
    return {
      outcome: 'draw',
      finalPick: 'draw',
      marketType: getCanonicalResult(prediction)?.marketType ?? 'three_way_result',
      team: null,
      teamSide: null,
      confidence,
      isTossUp: isPredictionTossUpForDisplay(prediction, confidence, 'draw'),
      label: 'Draw',
      shortLabel: 'Draw',
      badgeLabel: 'DRAW',
      leanLabel: `Draw${confidenceText}`,
    };
  }

  const isTossUp = isPredictionTossUpForDisplay(prediction, confidence, finalPick);
  if (isTossUp) {
    const confidenceText = formatConfidence(confidence);
    return {
      outcome: 'toss_up',
      finalPick,
      marketType: getCanonicalResult(prediction)?.marketType ?? null,
      team: null,
      teamSide: null,
      confidence,
      isTossUp: true,
      label: 'Toss-Up',
      shortLabel: 'Toss-Up',
      badgeLabel: 'TOSS-UP',
      leanLabel: `Toss-Up${confidenceText}`,
    };
  }

  const teamSide =
    finalPick === 'home' || finalPick === 'away'
      ? finalPick
      : prediction.predictedWinner === 'away'
        ? 'away'
        : 'home';
  const team = teamSide === 'home' ? homeTeam : awayTeam;
  const confidenceText = formatConfidence(confidence);

  return {
    outcome: teamSide,
    finalPick,
    marketType: getCanonicalResult(prediction)?.marketType ?? null,
    team,
    teamSide,
    confidence,
    isTossUp: false,
    label: team.name,
    shortLabel: team.abbreviation,
    badgeLabel: team.abbreviation,
    leanLabel: `Lean ${team.abbreviation}${confidenceText}`,
  };
}

export function getGamePredictionDisplay(game: GameWithPrediction): PredictionDisplay {
  return getPredictionDisplay({
    prediction: game.prediction,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
  });
}
