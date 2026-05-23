import type { CanonicalFinalPick, GameWithPrediction, Prediction, Team } from '@/types/sports';
import { getCanonicalConfidence, getCanonicalFinalPick } from './canonical-result';

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

export function isPredictionTossUpForDisplay(
  prediction: Prediction | null | undefined,
  confidence: number,
  finalPick: CanonicalFinalPick | null,
): boolean {
  return finalPick === 'none' || Boolean(prediction?.isTossUp) || confidence < TOSS_UP_CONFIDENCE_THRESHOLD;
}

export function getPredictionDisplay(input: PredictionDisplayInput): PredictionDisplay {
  const { prediction, homeTeam, awayTeam } = input;
  const finalPick = getCanonicalFinalPick(prediction);
  const confidence = getCanonicalConfidence(prediction);

  if (!prediction) {
    return {
      outcome: 'none',
      finalPick,
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
      team: null,
      teamSide: null,
      confidence,
      isTossUp: false,
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
