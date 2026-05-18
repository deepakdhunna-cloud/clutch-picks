type ProjectionDisplayInput = {
  sport?: string;
  homeAbbr: string;
  awayAbbr: string;
  predictedWinner?: 'home' | 'away' | null;
  predictedOutcome?: 'home' | 'away' | 'draw' | null;
  confidence?: number | null;
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

function projectionSide(input: ProjectionDisplayInput): 'home' | 'away' | 'draw' | null {
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

  if (input.predictedOutcome === 'home' || input.predictedOutcome === 'away' || input.predictedOutcome === 'draw') {
    return input.predictedOutcome;
  }
  if (input.predictedWinner === 'home' || input.predictedWinner === 'away') return input.predictedWinner;
  return null;
}

export function getProjectionDisplay(input: ProjectionDisplayInput) {
  const side = projectionSide(input);
  const leanAbbr = side === 'home' ? input.homeAbbr : side === 'away' ? input.awayAbbr : 'Draw';
  const projectionConfidence =
    side === 'home'
      ? normalizeProbability(input.projection.homeWinProbability)
      : side === 'away'
        ? normalizeProbability(input.projection.awayWinProbability)
        : normalizeProbability(input.projection.drawProbability);
  const confidence = Math.round((projectionConfidence ?? ((input.confidence ?? 0) / 100)) * 100);
  const confidenceText = confidence > 0 ? ` ${confidence}%` : '';

  return {
    label: 'Expected Avg',
    homeScore: formatDecimal(input.projection.projectedHomeScore),
    awayScore: formatDecimal(input.projection.projectedAwayScore),
    total: formatDecimal(input.projection.projectedTotal),
    spread: formatDecimal(input.projection.projectedSpread),
    spreadValue: input.projection.projectedSpread,
    leanText: side === 'draw' ? `Projection draw${confidenceText}` : `Projection lean ${leanAbbr}${confidenceText}`,
    contextText: `${input.projection.iterations.toLocaleString()} simulated game scripts`,
  };
}
