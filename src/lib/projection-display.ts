import type { CanonicalPredictionResult } from '@/types/sports';

type ProjectionDisplayInput = {
  sport?: string;
  homeAbbr: string;
  awayAbbr: string;
  canonicalResult?: CanonicalPredictionResult | null;
  predictedWinner?: 'home' | 'away' | null;
  predictedOutcome?: 'home' | 'away' | 'draw' | null;
  confidence?: number | null;
  isTossUp?: boolean | null;
  projection: {
    iterations: number;
    homeWinProbability?: number;
    awayWinProbability?: number;
    drawProbability?: number;
    projectedHomeScore: number;
    projectedAwayScore: number;
    projectedTotal: number;
    projectedSpread: number;
  };
};

type ProjectionSide = 'home' | 'away' | 'draw' | 'toss_up' | null;

function formatDecimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function formatInteger(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : '0';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeProbability(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value > 1 ? value / 100 : value;
}

export function getProjectionRiskTier(value: number | null | undefined): 'Low' | 'Medium' | 'High' {
  const risk = normalizeProbability(value ?? undefined);
  if (risk === null) return 'Medium';
  if (risk < 0.34) return 'Low';
  if (risk < 0.45) return 'Medium';
  return 'High';
}

function isTennisSport(sport: string | undefined): boolean {
  return String(sport ?? '').toUpperCase() === 'TENNIS';
}

function isCricketSport(sport: string | undefined): boolean {
  return String(sport ?? '').toUpperCase() === 'IPL';
}

export function cleanProjectionCopy(text: string | null | undefined): string {
  if (!text) return 'Projected score and margin for the final pick';
  const cleaned = text
    .replace(/\b[\d,]+\s+simulated\s+(?:game\s+)?scripts(?:\s+aligned to the final pick)?/gi, 'Projected score and margin for the final pick')
    .replace(/\bafter\s+[\d,]+\s+(?:simulated\s+)?(?:game\s+)?scripts;?\s*(?=upset\/draw risk)/gi, 'with ')
    .replace(/\bafter\s+[\d,]+\s+(?:simulated\s+)?(?:game\s+)?scripts;?\s*/gi, '')
    .replace(/\bsimulation lean\b/gi, 'projection lean')
    .replace(/\bsimulated score margin\b/gi, 'projected score margin')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || 'Projected score and margin for the final pick';
}

function projectionSide(input: ProjectionDisplayInput): ProjectionSide {
  if (input.canonicalResult?.finalPick === 'draw') return 'draw';
  if (input.canonicalResult?.finalPick === 'none' || input.isTossUp || ((input.confidence ?? 0) > 0 && (input.confidence ?? 0) < 53)) {
    return 'toss_up';
  }
  if (input.canonicalResult?.finalPick === 'home' || input.canonicalResult?.finalPick === 'away') {
    return input.canonicalResult.finalPick;
  }
  if (input.predictedOutcome === 'draw') return 'draw';
  if (input.predictedOutcome === 'home' || input.predictedOutcome === 'away') {
    return input.predictedOutcome;
  }
  if (input.predictedWinner === 'home' || input.predictedWinner === 'away') return input.predictedWinner;

  const homeProb = normalizeProbability(input.projection.homeWinProbability);
  const awayProb = normalizeProbability(input.projection.awayWinProbability);
  const drawProb = normalizeProbability(input.projection.drawProbability);

  if (homeProb !== null && awayProb !== null) {
    const values = [
      { side: 'home' as const, value: homeProb },
      { side: 'away' as const, value: awayProb },
      ...(drawProb !== null ? [{ side: 'draw' as const, value: drawProb }] : []),
    ].sort((a, b) => b.value - a.value);
    return values[0]?.side ?? null;
  }

  const spread = input.projection.projectedSpread;
  if (Number.isFinite(spread) && Math.abs(spread) >= 0.1) {
    return spread > 0 ? 'home' : 'away';
  }

  return null;
}

function probabilityForSide(input: ProjectionDisplayInput, side: 'home' | 'away'): number | null {
  const canonicalProbability =
    side === 'home'
      ? input.canonicalResult?.probabilities.home
      : input.canonicalResult?.probabilities.away;
  const projectionProbability =
    side === 'home'
      ? input.projection.homeWinProbability
      : input.projection.awayWinProbability;

  return (
    normalizeProbability(canonicalProbability) ??
    normalizeProbability(projectionProbability) ??
    normalizeProbability(input.confidence ?? undefined)
  );
}

function tennisWinnerSide(input: ProjectionDisplayInput, side: ProjectionSide): 'home' | 'away' | null {
  if (side === 'home' || side === 'away') return side;
  if (input.canonicalResult?.finalPick === 'home' || input.canonicalResult?.finalPick === 'away') {
    return input.canonicalResult.finalPick;
  }
  if (input.predictedOutcome === 'home' || input.predictedOutcome === 'away') return input.predictedOutcome;
  if (input.predictedWinner === 'home' || input.predictedWinner === 'away') return input.predictedWinner;

  const homeProb = normalizeProbability(input.projection.homeWinProbability);
  const awayProb = normalizeProbability(input.projection.awayWinProbability);
  if (homeProb !== null && awayProb !== null && Math.abs(homeProb - awayProb) >= 0.001) {
    return homeProb >= awayProb ? 'home' : 'away';
  }

  if (Number.isFinite(input.projection.projectedSpread) && Math.abs(input.projection.projectedSpread) >= 0.001) {
    return input.projection.projectedSpread > 0 ? 'home' : 'away';
  }
  if (
    Number.isFinite(input.projection.projectedHomeScore) &&
    Number.isFinite(input.projection.projectedAwayScore) &&
    Math.abs(input.projection.projectedHomeScore - input.projection.projectedAwayScore) >= 0.001
  ) {
    return input.projection.projectedHomeScore > input.projection.projectedAwayScore ? 'home' : 'away';
  }

  return null;
}

function tennisGameMarginForProbability(probability: number | null | undefined, total?: number): number {
  const selectedProbability = probability ?? 0.55;
  const dominance = clamp((selectedProbability - 0.5) * 4, 0, 1.4);
  const maxMargin =
    typeof total === 'number' && Number.isFinite(total)
      ? Math.max(1.2, total - 12)
      : 7.5;
  return roundTenth(clamp(1.6 + dominance * 4.8, 1.2, Math.min(7.5, maxMargin)));
}

function projectedTennisGameLine(
  input: ProjectionDisplayInput,
  side: ProjectionSide,
): { home: number; away: number; total: number; spread: number } | null {
  const home = input.projection.projectedHomeScore;
  const away = input.projection.projectedAwayScore;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const total = home + away;
  if (total < 16 || total > 40 || home < 5 || away < 5) return null;
  const winner = home > away ? 'home' : away > home ? 'away' : null;
  if ((side === 'home' || side === 'away') && winner !== side) return null;
  if ((side === 'home' || side === 'away') && Math.abs(home - away) + 0.001 < tennisGameMarginForProbability(probabilityForSide(input, side), total)) {
    return null;
  }

  return {
    home: roundTenth(home),
    away: roundTenth(away),
    total: roundTenth(total),
    spread: roundTenth(home - away),
  };
}

function tennisProjectionScores(
  input: ProjectionDisplayInput,
  side: ProjectionSide,
): { home: number; away: number; total: number; spread: number } | null {
  const existingScoreLine = projectedTennisGameLine(input, side);
  if (existingScoreLine) return existingScoreLine;

  const winner = tennisWinnerSide(input, side);
  if (!winner) return null;

  const selectedProbability = probabilityForSide(input, winner) ?? 0.55;
  const dominance = clamp((selectedProbability - 0.5) * 4, 0, 1.4);
  const total = roundTenth(clamp(26.5 - dominance * 4.5, 18.5, 30.5));
  const margin = tennisGameMarginForProbability(selectedProbability, total);
  const spread = winner === 'home' ? margin : -margin;
  const home = roundTenth((total + spread) / 2);
  const away = roundTenth((total - spread) / 2);

  return {
    home,
    away,
    total: roundTenth(home + away),
    spread: roundTenth(home - away),
  };
}

export function getProjectionDisplay(input: ProjectionDisplayInput) {
  const side = projectionSide(input);
  const tennisScores = isTennisSport(input.sport) ? tennisProjectionScores(input, side) : null;
  const cricket = !tennisScores && isCricketSport(input.sport);
  const leanAbbr = side === 'home' ? input.homeAbbr : side === 'away' ? input.awayAbbr : side === 'draw' ? 'Draw' : 'Toss-Up';
  const canonicalProbability =
    side === 'home'
      ? input.canonicalResult?.probabilities.home
      : side === 'away'
        ? input.canonicalResult?.probabilities.away
        : side === 'draw'
          ? input.canonicalResult?.probabilities.draw
          : undefined;
  const projectionConfidence =
    side === 'home'
      ? normalizeProbability(input.projection.homeWinProbability)
      : side === 'away'
        ? normalizeProbability(input.projection.awayWinProbability)
        : side === 'draw'
          ? normalizeProbability(input.projection.drawProbability)
          : null;
  const confidence = Math.round((canonicalProbability ?? projectionConfidence ?? ((input.confidence ?? 0) / 100)) * 100);
  const confidenceText = confidence > 0 ? ` ${confidence}%` : '';

  return {
    label: tennisScores ? 'Projected Games' : cricket ? 'Projected Runs' : 'Projected Score',
    homeScore: tennisScores ? formatDecimal(tennisScores.home) : cricket ? formatInteger(input.projection.projectedHomeScore) : formatDecimal(input.projection.projectedHomeScore),
    awayScore: tennisScores ? formatDecimal(tennisScores.away) : cricket ? formatInteger(input.projection.projectedAwayScore) : formatDecimal(input.projection.projectedAwayScore),
    total: tennisScores ? `${formatDecimal(tennisScores.total)} games` : cricket ? `${formatInteger(input.projection.projectedTotal)} runs` : formatDecimal(input.projection.projectedTotal),
    spread: tennisScores ? formatDecimal(tennisScores.spread) : cricket ? formatInteger(input.projection.projectedSpread) : formatDecimal(input.projection.projectedSpread),
    spreadValue: tennisScores ? tennisScores.spread : cricket ? Math.round(input.projection.projectedSpread) : input.projection.projectedSpread,
    leanText: side === 'draw' || side === 'toss_up' ? `${leanAbbr}${confidenceText}` : `Lean ${leanAbbr}${confidenceText}`,
    contextText: tennisScores
      ? 'Indicative games derived from the win-probability model'
      : cricket
        ? 'Projected run score for the final pick'
        : 'Projected score and margin for the final pick',
  };
}
