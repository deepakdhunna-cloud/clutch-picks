import type {
  CanonicalFinalPick,
  CanonicalProbabilities,
  GameWithPrediction,
  Prediction,
  Team,
} from '@/types/sports';
import {
  getCanonicalConfidence,
  getCanonicalFinalPick,
  getCanonicalResult,
} from './canonical-result';

type DisplayProjection = NonNullable<Prediction['projection']>;

type SportProjectionBaseline = {
  total: number;
  minTotal: number;
  maxTotal: number;
  marginScale: number;
  minMargin: number;
};

const SPORT_BASELINES: Record<string, SportProjectionBaseline> = {
  NBA: { total: 224, minTotal: 170, maxTotal: 280, marginScale: 14, minMargin: 2.5 },
  NCAAB: { total: 142, minTotal: 95, maxTotal: 190, marginScale: 10, minMargin: 2 },
  NFL: { total: 45, minTotal: 24, maxTotal: 72, marginScale: 9, minMargin: 1.5 },
  NCAAF: { total: 53, minTotal: 28, maxTotal: 86, marginScale: 11, minMargin: 2 },
  MLB: { total: 8.5, minTotal: 4, maxTotal: 14, marginScale: 3, minMargin: 0.4 },
  NHL: { total: 5.8, minTotal: 3, maxTotal: 9, marginScale: 2.2, minMargin: 0.3 },
  MLS: { total: 2.8, minTotal: 1.2, maxTotal: 5.5, marginScale: 1.2, minMargin: 0.2 },
  EPL: { total: 2.8, minTotal: 1.2, maxTotal: 5.5, marginScale: 1.2, minMargin: 0.2 },
  UCL: { total: 3, minTotal: 1.2, maxTotal: 5.8, marginScale: 1.3, minMargin: 0.2 },
  IPL: { total: 335, minTotal: 220, maxTotal: 440, marginScale: 28, minMargin: 6 },
  TENNIS: { total: 24, minTotal: 16, maxTotal: 38, marginScale: 8, minMargin: 0.8 },
};

const DEFAULT_BASELINE: SportProjectionBaseline = {
  total: 10,
  minTotal: 1,
  maxTotal: 100,
  marginScale: 3,
  minMargin: 0.3,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeProbability(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(value > 1 ? value / 100 : value, 0, 1);
}

function normalizeProbabilities(prediction: Prediction): CanonicalProbabilities {
  const canonical = getCanonicalResult(prediction);
  if (canonical?.probabilities) return canonical.probabilities;

  const includeDraw = prediction.predictedOutcome === 'draw' || typeof prediction.drawProbability === 'number';
  const home = normalizeProbability(prediction.homeWinProbability, includeDraw ? 0.375 : 0.5);
  const away = normalizeProbability(prediction.awayWinProbability, includeDraw ? 0.375 : 0.5);
  const draw = includeDraw ? normalizeProbability(prediction.drawProbability, 0.25) : undefined;
  const total = home + away + (draw ?? 0);

  if (total <= 0) {
    return includeDraw ? { home: 0.375, away: 0.375, draw: 0.25 } : { home: 0.5, away: 0.5 };
  }

  return includeDraw
    ? { home: home / total, away: away / total, draw: (draw ?? 0) / total }
    : { home: home / total, away: away / total };
}

function probabilityForPick(probabilities: CanonicalProbabilities, pick: CanonicalFinalPick | null): number {
  if (pick === 'home') return probabilities.home;
  if (pick === 'away') return probabilities.away;
  if (pick === 'draw') return probabilities.draw ?? 0;
  return Math.max(probabilities.home, probabilities.away, probabilities.draw ?? 0);
}

function pickFromPrediction(prediction: Prediction): CanonicalFinalPick | null {
  const canonicalPick = getCanonicalFinalPick(prediction);
  if (canonicalPick) return canonicalPick;
  if (prediction.predictedOutcome === 'draw') return 'draw';
  return prediction.predictedWinner === 'away' ? 'away' : 'home';
}

function finiteScore(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteTeamRate(team: Team | undefined, field: 'runRateFor' | 'runRateAgainst'): number | null {
  const value = team?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function t20RunsFromRunRate(rate: number | null): number | null {
  if (rate === null) return null;
  return clamp(rate * 20, 80, 240);
}

function averageFinite(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function projectionFromScore(
  prediction: Prediction,
  home: number,
  away: number,
  engine: string,
): DisplayProjection {
  const probabilities = normalizeProbabilities(prediction);
  const pick = pickFromPrediction(prediction);
  const selectedProbability = probabilityForPick(probabilities, pick);

  return {
    engine,
    iterations: 0,
    homeWinProbability: roundTenth(probabilities.home * 100),
    awayWinProbability: roundTenth(probabilities.away * 100),
    drawProbability: probabilities.draw !== undefined ? roundTenth(probabilities.draw * 100) : undefined,
    projectedHomeScore: roundTenth(home),
    projectedAwayScore: roundTenth(away),
    projectedSpread: roundTenth(home - away),
    projectedTotal: roundTenth(home + away),
    volatility: 0.35,
    upsetRisk: roundTenth(clamp(1 - selectedProbability, 0.05, 0.49) * 10) / 10,
    signals: [
      {
        key: 'stored-pregame-score',
        label: 'Stored pregame projection',
        value: roundTenth(selectedProbability * 100),
        evidence: 'Projected line displayed from the locked pregame prediction snapshot',
      },
    ],
  };
}

function isTennisSport(sport: unknown): boolean {
  return String(sport ?? '').toUpperCase() === 'TENNIS';
}

function isCricketSport(sport: unknown): boolean {
  return String(sport ?? '').toUpperCase() === 'IPL';
}

function isPlausibleTennisGameProjection(projection: DisplayProjection): boolean {
  const home = projection.projectedHomeScore;
  const away = projection.projectedAwayScore;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return false;
  const total = home + away;
  return total >= 16 && total <= 40 && home >= 5 && away >= 5;
}

function tennisGameMarginForProbability(selectedProbability: number, total?: number): number {
  const dominance = clamp((selectedProbability - 0.5) * 4, 0, 1.6);
  const maxMargin =
    typeof total === 'number' && Number.isFinite(total)
      ? Math.max(1.2, total - 12)
      : 8.5;
  return roundTenth(clamp(1.6 + dominance * 5.2, 1.2, Math.min(8.5, maxMargin)));
}

function isWeakTennisGameProjection(projection: DisplayProjection, prediction: Prediction): boolean {
  const pick = pickFromPrediction(prediction);
  if (pick !== 'home' && pick !== 'away') return false;

  const spread = projection.projectedHomeScore - projection.projectedAwayScore;
  if ((pick === 'home' && spread <= 0) || (pick === 'away' && spread >= 0)) return true;

  const selectedProbability = probabilityForPick(normalizeProbabilities(prediction), pick);
  const total = projection.projectedHomeScore + projection.projectedAwayScore;
  return Math.abs(spread) + 0.001 < tennisGameMarginForProbability(selectedProbability, total);
}

function tennisRankValue(team: Pick<Team, 'rank' | 'record'> | undefined): number | null {
  if (typeof team?.rank === 'number' && Number.isFinite(team.rank)) return team.rank;
  const match = team?.record?.match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

function tennisGameLineForPrediction(
  prediction: Prediction,
  game?: GameWithPrediction | null,
): { home: number; away: number; spread: number; total: number } {
  const probabilities = normalizeProbabilities(prediction);
  const pick = pickFromPrediction(prediction);
  const winner =
    pick === 'home' || pick === 'away'
      ? pick
      : probabilities.home >= probabilities.away ? 'home' : 'away';
  const selectedProbability = probabilityForPick(probabilities, winner);
  const winnerRank = tennisRankValue(winner === 'home' ? game?.homeTeam : game?.awayTeam);
  const opponentRank = tennisRankValue(winner === 'home' ? game?.awayTeam : game?.homeTeam);
  const rankAdvantage =
    winnerRank !== null && opponentRank !== null
      ? opponentRank - winnerRank
      : 0;
  const dominance = clamp((selectedProbability - 0.5) * 4 + rankAdvantage / 90, 0, 1.6);
  const total = roundTenth(clamp(26.5 - dominance * 4.5, 18.5, 30.5));
  const margin = tennisGameMarginForProbability(selectedProbability, total);
  const spread = winner === 'home' ? margin : -margin;
  const home = roundTenth((total + spread) / 2);
  const away = roundTenth((total - spread) / 2);

  return {
    home,
    away,
    spread: roundTenth(home - away),
    total: roundTenth(home + away),
  };
}

function tennisGameProjectionFromPrediction(
  prediction: Prediction,
  engine: string,
  game?: GameWithPrediction | null,
): DisplayProjection {
  const line = tennisGameLineForPrediction(prediction, game);
  return {
    ...projectionFromScore(prediction, line.home, line.away, engine),
    volatility: roundTenth(clamp(4.2 / Math.max(line.total, 1), 0.05, 0.95) * 10) / 10,
    signals: [
      {
        key: 'tennis-match-game-projection',
        label: 'Tennis projected games',
        value: line.spread,
        evidence: 'Projected tennis line uses expected match games from the locked pregame probability and player-rank context',
      },
    ],
  };
}

function cricketRunRateScoreLine(game: GameWithPrediction): { home: number; away: number } | null {
  if (!isCricketSport(game.sport)) return null;

  const home = averageFinite([
    t20RunsFromRunRate(finiteTeamRate(game.homeTeam, 'runRateFor')),
    t20RunsFromRunRate(finiteTeamRate(game.awayTeam, 'runRateAgainst')),
  ]);
  const away = averageFinite([
    t20RunsFromRunRate(finiteTeamRate(game.awayTeam, 'runRateFor')),
    t20RunsFromRunRate(finiteTeamRate(game.homeTeam, 'runRateAgainst')),
  ]);

  if (home === null || away === null) return null;
  return {
    home: Math.round(home),
    away: Math.round(away),
  };
}

function alignCricketScoreLineToPick(
  scores: { home: number; away: number },
  pick: CanonicalFinalPick | null,
): { home: number; away: number } {
  if (pick !== 'home' && pick !== 'away') return scores;

  const total = scores.home + scores.away;
  const minMargin = Math.min(SPORT_BASELINES.IPL.minMargin, total * 0.08);
  const currentSpread = scores.home - scores.away;
  const targetSpread = pick === 'home'
    ? Math.max(currentSpread, minMargin)
    : Math.min(currentSpread, -minMargin);
  let home = (total + targetSpread) / 2;
  let away = (total - targetSpread) / 2;

  if (home < 80) {
    away += 80 - home;
    home = 80;
  }
  if (away < 80) {
    home += 80 - away;
    away = 80;
  }

  return {
    home: Math.round(home),
    away: Math.round(away),
  };
}

function cricketRunRateProjectionFromPrediction(
  game: GameWithPrediction,
  prediction: Prediction,
  engine: string,
): DisplayProjection | null {
  const scoreLine = cricketRunRateScoreLine(game);
  if (!scoreLine) return null;

  const aligned = alignCricketScoreLineToPick(scoreLine, pickFromPrediction(prediction));
  return {
    ...projectionFromScore(prediction, aligned.home, aligned.away, engine),
    volatility: roundTenth(clamp(SPORT_BASELINES.IPL.marginScale / Math.max(aligned.home + aligned.away, 1), 0.05, 0.95) * 10) / 10,
    signals: [
      {
        key: 'ipl-run-rate-projection',
        label: 'IPL run-rate projection',
        value: roundTenth(aligned.home - aligned.away),
        evidence: 'Projected IPL runs rebuilt from team season run rates instead of a generic T20 baseline',
      },
    ],
  };
}

function isGenericCricketProjection(
  projection: DisplayProjection,
  runRateProjection: DisplayProjection,
): boolean {
  const nearGenericTotal =
    Math.abs(projection.projectedTotal - 320) <= 20 ||
    Math.abs(projection.projectedTotal - SPORT_BASELINES.IPL.total) <= 20;
  const muchDifferentFromRunRates =
    Math.abs(projection.projectedHomeScore - runRateProjection.projectedHomeScore) >= 12 ||
    Math.abs(projection.projectedAwayScore - runRateProjection.projectedAwayScore) >= 12 ||
    Math.abs(projection.projectedTotal - runRateProjection.projectedTotal) >= 20;

  return nearGenericTotal && muchDifferentFromRunRates;
}

export function isStoredPregamePrediction(prediction: Prediction | null | undefined): boolean {
  if (!prediction) return false;
  if (prediction.snapshotType === 'stored-pregame') return true;
  return Boolean(
    prediction.canonicalResult?.warnings?.some((warning) =>
      warning.toLowerCase().includes('stored pregame prediction snapshot'),
    ),
  );
}

export function getDisplayProjection(game: GameWithPrediction | null | undefined): DisplayProjection | undefined {
  const prediction = game?.prediction;
  if (!prediction) return undefined;
  const cricketRunRateProjection = game && isCricketSport(game.sport)
    ? cricketRunRateProjectionFromPrediction(game, prediction, prediction.projection?.engine ?? 'stored-pregame-projection-v1')
    : null;

  if (prediction.projection) {
    if (
      isTennisSport(game?.sport) &&
      (!isPlausibleTennisGameProjection(prediction.projection) || isWeakTennisGameProjection(prediction.projection, prediction))
    ) {
      return tennisGameProjectionFromPrediction(prediction, prediction.projection.engine, game);
    }
    if (
      cricketRunRateProjection &&
      isGenericCricketProjection(prediction.projection, cricketRunRateProjection)
    ) {
      return cricketRunRateProjection;
    }
    return prediction.projection;
  }

  const canonicalScore = getCanonicalResult(prediction)?.projectedScore;
  if (canonicalScore) {
    if (isTennisSport(game?.sport)) {
      return tennisGameProjectionFromPrediction(prediction, 'canonical-projected-score-v1', game);
    }
    return projectionFromScore(prediction, canonicalScore.home, canonicalScore.away, 'canonical-projected-score-v1');
  }

  const predictedTotal = finiteScore(prediction.predictedTotal);
  const predictedSpread = finiteScore(prediction.predictedSpread);
  if (predictedTotal !== null && predictedTotal > 0 && predictedSpread !== null) {
    return projectionFromScore(
      prediction,
      (predictedTotal + predictedSpread) / 2,
      (predictedTotal - predictedSpread) / 2,
      'legacy-predicted-line-v1',
    );
  }

  if (!isStoredPregamePrediction(prediction)) return undefined;

  const probabilities = normalizeProbabilities(prediction);
  const pick = pickFromPrediction(prediction);
  if (isTennisSport(game?.sport)) {
    return tennisGameProjectionFromPrediction(prediction, 'stored-pregame-projection-v1', game);
  }
  if (cricketRunRateProjection) {
    return cricketRunRateProjection;
  }

  const baseline = SPORT_BASELINES[String(game.sport)] ?? DEFAULT_BASELINE;
  const projectedTotal = roundTenth(clamp(baseline.total, baseline.minTotal, baseline.maxTotal));
  const probabilityMargin = probabilities.home - probabilities.away;
  let projectedSpread = probabilityMargin * baseline.marginScale;

  if (pick === 'home') {
    projectedSpread = Math.max(projectedSpread, baseline.minMargin);
  } else if (pick === 'away') {
    projectedSpread = Math.min(projectedSpread, -baseline.minMargin);
  } else if (pick === 'draw') {
    projectedSpread = 0;
  }

  projectedSpread = roundTenth(projectedSpread);
  const projectedHomeScore = roundTenth((projectedTotal + projectedSpread) / 2);
  const projectedAwayScore = roundTenth((projectedTotal - projectedSpread) / 2);
  const selectedProbability = probabilityForPick(probabilities, pick);

  return {
    engine: 'stored-pregame-projection-v1',
    iterations: 0,
    homeWinProbability: roundTenth(probabilities.home * 100),
    awayWinProbability: roundTenth(probabilities.away * 100),
    drawProbability: probabilities.draw !== undefined ? roundTenth(probabilities.draw * 100) : undefined,
    projectedHomeScore,
    projectedAwayScore,
    projectedSpread: roundTenth(projectedHomeScore - projectedAwayScore),
    projectedTotal: roundTenth(projectedHomeScore + projectedAwayScore),
    volatility: roundTenth(clamp(baseline.marginScale / Math.max(projectedTotal, 1), 0.05, 0.95) * 10) / 10,
    upsetRisk: roundTenth(clamp(1 - selectedProbability, 0.05, 0.49) * 10) / 10,
    signals: [
      {
        key: 'stored-pregame-probability',
        label: 'Stored pregame probability',
        value: roundTenth(selectedProbability * 100),
        evidence: 'Projected line rebuilt from the locked pregame probability snapshot; live score was not used',
      },
      {
        key: 'sport-scoring-profile',
        label: 'Sport scoring profile',
        value: projectedTotal,
        evidence: `${game.sport} scoring baseline fills older snapshots that did not persist projection detail`,
      },
    ],
  };
}

function formatProbability(probability: number): string {
  const percent = roundTenth(probability * 100);
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

function rankValue(team: Pick<Team, 'rank' | 'record'>): number | null {
  if (typeof team.rank === 'number' && Number.isFinite(team.rank)) return team.rank;
  const match = team.record?.match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

function matchupContext(game: GameWithPrediction, winnerSide: 'home' | 'away'): string {
  const winner = winnerSide === 'home' ? game.homeTeam : game.awayTeam;
  const opponent = winnerSide === 'home' ? game.awayTeam : game.homeTeam;
  const winnerRank = rankValue(winner);
  const opponentRank = rankValue(opponent);

  if (game.sport === 'TENNIS' && winnerRank !== null && opponentRank !== null) {
    return `The visible player context is ${winner.name} at ATP Rank #${winnerRank} against ${opponent.name} at #${opponentRank}.`;
  }

  return 'The available pregame signal is close, so this should be treated as a lean with real upset risk.';
}

export function buildStoredPregameNarrative(game: GameWithPrediction): string | null {
  const prediction = game.prediction;
  if (!prediction || !isStoredPregamePrediction(prediction)) return null;

  const pick = pickFromPrediction(prediction);
  if (pick !== 'home' && pick !== 'away') {
    const probabilities = normalizeProbabilities(prediction);
    const probability = probabilityForPick(probabilities, pick);
    return `This is the original pregame draw profile at ${formatProbability(probability)}%. The available pregame signal did not separate either side enough, and the live score is tracked separately from that original read.`;
  }

  const winner = pick === 'home' ? game.homeTeam : game.awayTeam;
  const probabilities = normalizeProbabilities(prediction);
  const probability = probabilityForPick(probabilities, pick);

  return `${winner.name} is the original pregame lean at ${formatProbability(probability)}%, so this should read as a narrow edge rather than a runaway call. ${matchupContext(game, pick)} The live score is tracked separately, keeping this card honest about the original pre-match read.`;
}

export function getValueSignalDisplay(prediction: Prediction | null | undefined): {
  label: string;
  color: string;
  detail: string;
} {
  const confidence = getCanonicalConfidence(prediction);
  const factorCount = prediction?.factors?.length ?? 0;

  if (isStoredPregamePrediction(prediction) && factorCount === 0) {
    return {
      label: confidence < 56 ? 'Lean Edge' : 'Stored Edge',
      color: confidence < 56 ? '#6B7C94' : '#7A9DB8',
      detail: 'Stored pregame signal',
    };
  }

  const valueRating = prediction?.valueRating ?? 0;
  if (valueRating >= 7 && confidence >= 57) {
    return { label: 'High Value', color: '#7A9DB8', detail: 'Model edge signal' };
  }
  if (valueRating >= 4) {
    return { label: 'Fair Value', color: '#6B7C94', detail: 'Model edge signal' };
  }
  return { label: 'Low Value', color: 'rgba(255,255,255,0.3)', detail: 'Model edge signal' };
}

export function formatAnalysisLinkSubtitle(prediction: Prediction | null | undefined): string {
  const factors = prediction?.factors ?? [];
  if (factors.length > 0) {
    const edgeCount = factors.filter((factor) => Math.abs(factor.homeScore - factor.awayScore) > 0.3).length;
    return `${factors.length} factors · ${edgeCount} edges identified`;
  }

  if (isStoredPregamePrediction(prediction)) {
    return `Pregame snapshot · ${Math.round(getCanonicalConfidence(prediction))}% lean`;
  }

  return 'Factor details pending';
}
