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

function formatDecimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function normalizeProbability(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value > 1 ? value / 100 : value;
}

export function cleanProjectionCopy(text: string | null | undefined): string {
  if (!text) return 'Expected-score model aligned to the final pick';
  const cleaned = text
    .replace(/\b[\d,]+\s+simulated\s+(?:game\s+)?scripts(?:\s+aligned to the final pick)?/gi, 'Expected-score model aligned to the final pick')
    .replace(/\bafter\s+[\d,]+\s+(?:simulated\s+)?(?:game\s+)?scripts;?\s*(?=upset\/draw risk)/gi, 'with ')
    .replace(/\bafter\s+[\d,]+\s+(?:simulated\s+)?(?:game\s+)?scripts;?\s*/gi, '')
    .replace(/\bsimulation lean\b/gi, 'projection lean')
    .replace(/\bsimulated score margin\b/gi, 'projected score margin')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || 'Expected-score model aligned to the final pick';
}

function projectionSide(input: ProjectionDisplayInput): 'home' | 'away' | 'draw' | 'toss_up' | null {
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

export function getProjectionDisplay(input: ProjectionDisplayInput) {
  const side = projectionSide(input);
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
    label: 'Unified Projection',
    homeScore: formatDecimal(input.projection.projectedHomeScore),
    awayScore: formatDecimal(input.projection.projectedAwayScore),
    total: formatDecimal(input.projection.projectedTotal),
    spread: formatDecimal(input.projection.projectedSpread),
    spreadValue: input.projection.projectedSpread,
    leanText: side === 'draw' || side === 'toss_up' ? `${leanAbbr}${confidenceText}` : `Lean ${leanAbbr}${confidenceText}`,
    contextText: cleanProjectionCopy('Expected-score model aligned to the final pick'),
  };
}
