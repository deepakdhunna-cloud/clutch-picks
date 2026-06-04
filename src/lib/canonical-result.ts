import type {
  CanonicalFinalPick,
  CanonicalPredictionResult,
  CanonicalProbabilities,
  GameWithPrediction,
  Prediction,
  Team,
} from '@/types/sports';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeProbability(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const asProbability = value > 1 ? value / 100 : value;
  return clamp(asProbability, 0, 1);
}

function normalizeProbabilities(input: {
  home?: number;
  away?: number;
  draw?: number;
}): CanonicalProbabilities {
  const includeDraw = typeof input.draw === 'number' && Number.isFinite(input.draw);
  const home = normalizeProbability(input.home, includeDraw ? 0.375 : 0.5);
  const away = normalizeProbability(input.away, includeDraw ? 0.375 : 0.5);
  const draw = includeDraw ? normalizeProbability(input.draw, 0.25) : undefined;
  const total = home + away + (draw ?? 0);

  if (total <= 0) {
    return includeDraw ? { home: 0.375, away: 0.375, draw: 0.25 } : { home: 0.5, away: 0.5 };
  }

  return includeDraw
    ? { home: home / total, away: away / total, draw: (draw ?? 0) / total }
    : { home: home / total, away: away / total };
}

function pickFromProbabilities(probabilities: CanonicalProbabilities): CanonicalFinalPick {
  if (probabilities.draw !== undefined && probabilities.draw >= probabilities.home && probabilities.draw >= probabilities.away) {
    return 'draw';
  }
  if (Math.abs(probabilities.home - probabilities.away) < 0.001 && probabilities.draw === undefined) {
    return 'none';
  }
  return probabilities.home >= probabilities.away ? 'home' : 'away';
}

function probabilityForPick(probabilities: CanonicalProbabilities, pick: CanonicalFinalPick): number {
  if (pick === 'home') return probabilities.home;
  if (pick === 'away') return probabilities.away;
  if (pick === 'draw') return probabilities.draw ?? 0;
  return Math.max(probabilities.home, probabilities.away, probabilities.draw ?? 0);
}

function legacyCanonicalResult(prediction: Prediction): CanonicalPredictionResult {
  const includeDraw = prediction.predictedOutcome === 'draw' || typeof prediction.drawProbability === 'number';
  const probabilities = normalizeProbabilities({
    home: prediction.homeWinProbability,
    away: prediction.awayWinProbability,
    draw: includeDraw ? prediction.drawProbability : undefined,
  });
  const finalPick =
    prediction.predictedOutcome === 'draw'
      ? 'draw'
      : prediction.predictedWinner ?? pickFromProbabilities(probabilities);
  const finalProbability = probabilityForPick(probabilities, finalPick);

  return {
    eventId: prediction.gameId,
    marketType: includeDraw ? 'three_way_result' : 'moneyline',
    finalPick,
    finalProbability,
    confidence: prediction.confidence,
    probabilities,
    projectedScore: prediction.projection
      ? {
          home: prediction.projection.projectedHomeScore,
          away: prediction.projection.projectedAwayScore,
          spread: prediction.projection.projectedSpread,
          total: prediction.projection.projectedTotal,
        }
      : undefined,
    simulationSummary: prediction.projection
      ? {
          engine: prediction.projection.engine,
          iterations: prediction.projection.iterations,
          probabilities: normalizeProbabilities({
            home: prediction.projection.homeWinProbability,
            away: prediction.projection.awayWinProbability,
            draw: includeDraw ? prediction.projection.drawProbability : undefined,
          }),
          volatility: prediction.projection.volatility,
          upsetRisk: prediction.projection.upsetRisk,
        }
      : undefined,
    timestamp: prediction.createdAt,
    dataVersion: 'legacy-client-fallback',
    warnings: ['Canonical result missing from API payload; client used legacy mirrored fields.'],
  };
}

export function getCanonicalResult(prediction?: Prediction | null): CanonicalPredictionResult | null {
  if (!prediction) return null;
  return prediction.canonicalResult ?? legacyCanonicalResult(prediction);
}

export function getCanonicalFinalPick(prediction?: Prediction | null): CanonicalFinalPick | null {
  return getCanonicalResult(prediction)?.finalPick ?? null;
}

export function getCanonicalConfidence(prediction?: Prediction | null): number {
  const canonical = getCanonicalResult(prediction);
  return canonical?.confidence ?? prediction?.confidence ?? 0;
}

export function getCanonicalWinProbabilities(prediction?: Prediction | null): {
  home: number;
  away: number;
  draw?: number;
} {
  const probabilities = getCanonicalResult(prediction)?.probabilities;
  if (!probabilities) return { home: 50, away: 50 };
  const home = Math.round(probabilities.home * 1000) / 10;
  const away = Math.round(probabilities.away * 1000) / 10;
  const draw = probabilities.draw !== undefined ? Math.round(probabilities.draw * 1000) / 10 : undefined;
  return draw !== undefined ? { home, away, draw } : { home, away };
}

export function getCanonicalTeam(game: GameWithPrediction): Team | null {
  const pick = getCanonicalFinalPick(game.prediction);
  if (pick === 'home') return game.homeTeam;
  if (pick === 'away') return game.awayTeam;
  return null;
}

export function traceCanonicalUiConsumption(surface: string, game: GameWithPrediction): void {
  if (!__DEV__ || process.env.EXPO_PUBLIC_PREDICTION_TRACE !== '1') return;
  const canonical = getCanonicalResult(game.prediction);
  if (!canonical) return;
  if (__DEV__) console.log('[prediction-ui-trace]', {
    surface,
    eventId: game.id,
    consumedCanonical: {
      finalPick: canonical.finalPick,
      finalProbability: canonical.finalProbability,
      confidence: canonical.confidence,
      probabilities: canonical.probabilities,
      dataVersion: canonical.dataVersion,
      timestamp: canonical.timestamp,
    },
  });
}
