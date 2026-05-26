/**
 * Game-script projection layer.
 *
 * This is deliberately separate from the factor engine:
 * - Factor model answers: "who owns the matchup edge?"
 * - Simulation answers: "what score distribution does that edge imply?"
 *
 * The simulator is deterministic for a given game/context so tests, caches,
 * and backtests stay reproducible. It uses a seeded PRNG plus sport-specific
 * scoring distributions instead of Math.random().
 */

import type { FactorContribution, GameContext, ProjectionSignal, SimulationProjection } from "./types";

const SOCCER_LEAGUES = new Set(["MLS", "EPL", "UCL"]);

const ITERATIONS = 50000;

const SPORT_BASELINES: Record<string, {
  total: number;
  totalMin: number;
  totalMax: number;
  marginSd: number;
  totalSd: number;
  minScore: number;
  granularity: number;
}> = {
  NBA: { total: 224, totalMin: 185, totalMax: 255, marginSd: 12.5, totalSd: 15, minScore: 75, granularity: 1 },
  NCAAB: { total: 144, totalMin: 108, totalMax: 178, marginSd: 10.5, totalSd: 11, minScore: 45, granularity: 1 },
  NFL: { total: 45, totalMin: 30, totalMax: 63, marginSd: 13.5, totalSd: 10, minScore: 0, granularity: 1 },
  NCAAF: { total: 52, totalMin: 34, totalMax: 78, marginSd: 16, totalSd: 13, minScore: 0, granularity: 1 },
  MLB: { total: 8.6, totalMin: 5.2, totalMax: 13.4, marginSd: 3.2, totalSd: 2.2, minScore: 0, granularity: 1 },
  NHL: { total: 6.1, totalMin: 4.0, totalMax: 8.6, marginSd: 2.2, totalSd: 1.6, minScore: 0, granularity: 1 },
  MLS: { total: 2.7, totalMin: 1.4, totalMax: 4.4, marginSd: 1.55, totalSd: 1.1, minScore: 0, granularity: 1 },
  EPL: { total: 2.8, totalMin: 1.4, totalMax: 4.5, marginSd: 1.55, totalSd: 1.1, minScore: 0, granularity: 1 },
  UCL: { total: 3.0, totalMin: 1.5, totalMax: 4.8, marginSd: 1.65, totalSd: 1.2, minScore: 0, granularity: 1 },
  IPL: { total: 320, totalMin: 245, totalMax: 430, marginSd: 36, totalSd: 44, minScore: 80, granularity: 1 },
  TENNIS: { total: 2.45, totalMin: 2.0, totalMax: 3.0, marginSd: 0.85, totalSd: 0.45, minScore: 0, granularity: 1 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function textHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makePrng(seed: string): () => number {
  let state = textHash(seed) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function normalSample(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function inferTeamAttack(
  scored: number,
  allowedByOpponent: number,
  baselineShare: number,
): number {
  const usableScored = scored > 0 ? scored : baselineShare;
  const usableAllowed = allowedByOpponent > 0 ? allowedByOpponent : baselineShare;
  return baselineShare * 0.45 + usableScored * 0.35 + usableAllowed * 0.20;
}

function factorDelta(factors: FactorContribution[], keyIncludes: string): number {
  return factors
    .filter((f) => f.available && f.key.includes(keyIncludes))
    .reduce((sum, f) => sum + f.homeDelta * f.weight, 0);
}

function splitWinPct(record: { wins: number; losses: number }): number | null {
  const games = record.wins + record.losses;
  if (games < 5) return null;
  return record.wins / games;
}

function signalStrength(factors: FactorContribution[]): number {
  return factors
    .filter((f) => f.available && f.hasSignal)
    .reduce((sum, f) => sum + Math.min(1, Math.abs(f.homeDelta * f.weight) / 80), 0);
}

function meaningfulMarginThreshold(sport: string): number {
  if (sport === "NBA" || sport === "NCAAB") return 0.6;
  if (sport === "NFL" || sport === "NCAAF") return 0.45;
  if (sport === "IPL") return 3;
  if (sport === "MLB" || sport === "NHL" || SOCCER_LEAGUES.has(sport)) return 0.12;
  if (sport === "TENNIS") return 0.08;
  return 0.25;
}

function clampProjectedTotal(
  sport: string,
  total: number,
  signals: ProjectionSignal[],
): number {
  const baseline = SPORT_BASELINES[sport] ?? SPORT_BASELINES.NBA!;
  const bounded = clamp(total, baseline.totalMin, baseline.totalMax);
  if (Math.abs(bounded - total) > 0.05) {
    signals.unshift({
      key: "projection-total-bounds",
      label: "Projection total bounds",
      value: round(bounded - total, 2),
      evidence: `Projected total bounded to ${round(bounded, 1)} for ${sport} scoring scale`,
    });
  }
  return bounded;
}

function boundedProjectedScoreLine(
  sport: string,
  homeScore: number,
  awayScore: number,
  signals: ProjectionSignal[],
): { home: number; away: number } {
  const baseline = SPORT_BASELINES[sport] ?? SPORT_BASELINES.NBA!;
  const rawTotal = homeScore + awayScore;
  const total = clamp(rawTotal, baseline.totalMin, baseline.totalMax);
  let spread = homeScore - awayScore;
  const maxSpread = Math.max(0, total - baseline.minScore * 2);

  if (Math.abs(spread) > maxSpread) {
    spread = Math.sign(spread || 1) * maxSpread;
  }

  if (Math.abs(total - rawTotal) > 0.05) {
    signals.unshift({
      key: "projection-total-bounds",
      label: "Projection total bounds",
      value: round(total - rawTotal, 2),
      evidence: `Projected total bounded to ${round(total, 1)} for ${sport} scoring scale`,
    });
  }

  return {
    home: (total + spread) / 2,
    away: (total - spread) / 2,
  };
}

function tennisWeatherVolatility(ctx: GameContext): { boost: number; evidence: string } | null {
  if (ctx.sport !== "TENNIS" || !ctx.weather || ctx.weather.isDomed) return null;

  const parts: string[] = [];
  let boost = 0;
  if (ctx.weather.windSpeed > 16) {
    boost += 0.08;
    parts.push(`wind ${Math.round(ctx.weather.windSpeed)} mph`);
  }
  if (ctx.weather.temperature > 88) {
    boost += 0.05;
    parts.push(`heat ${Math.round(ctx.weather.temperature)}F`);
  }
  if (ctx.weather.precipitation > 0.35) {
    boost += 0.08;
    parts.push(`rain probability ${Math.round(ctx.weather.precipitation * 100)}%`);
  }
  if (boost <= 0) return null;

  return {
    boost: clamp(boost, 0, 0.18),
    evidence: `Outdoor conditions increase tennis upset variance: ${parts.join(", ")}`,
  };
}

function anchorMarginToRatingEdge(args: {
  sport: string;
  homeMean: number;
  awayMean: number;
  expectedMargin: number;
  signals: ProjectionSignal[];
}): { homeMean: number; awayMean: number } {
  const threshold = meaningfulMarginThreshold(args.sport);
  if (Math.abs(args.expectedMargin) < threshold) {
    return { homeMean: args.homeMean, awayMean: args.awayMean };
  }

  const currentMargin = args.homeMean - args.awayMean;
  const direction = args.expectedMargin > 0 ? 1 : -1;
  const targetMargin = direction * Math.max(Math.abs(args.expectedMargin) * 0.72, threshold);
  const alreadyAligned =
    currentMargin * args.expectedMargin > 0 &&
    Math.abs(currentMargin) >= threshold;

  if (alreadyAligned) {
    return { homeMean: args.homeMean, awayMean: args.awayMean };
  }

  const shift = targetMargin - currentMargin;
  args.signals.unshift({
    key: "rating-consensus-anchor",
    label: "Consensus margin anchor",
    value: round(shift, 2),
    evidence: `Rating edge anchors the projected score margin ${shift >= 0 ? "+" : ""}${round(shift, 1)} toward the model side`,
  });

  return {
    homeMean: args.homeMean + shift / 2,
    awayMean: args.awayMean - shift / 2,
  };
}

function buildScoreModel(
  ctx: GameContext,
  totalRatingDelta: number,
  factors: FactorContribution[],
): { homeMean: number; awayMean: number; marginSd: number; totalMean: number; signals: ProjectionSignal[] } {
  const baseline = SPORT_BASELINES[ctx.sport] ?? SPORT_BASELINES.NBA!;
  const halfTotal = baseline.total / 2;

  let homeMean = inferTeamAttack(ctx.homeForm.avgScore, ctx.awayForm.avgAllowed, halfTotal);
  let awayMean = inferTeamAttack(ctx.awayForm.avgScore, ctx.homeForm.avgAllowed, halfTotal);
  const signals: ProjectionSignal[] = [];

  const netRatingDelta = factorDelta(factors, "net_rating");
  const pitcherDelta = factorDelta(factors, "starting_pitcher");
  const goalieDelta = factorDelta(factors, "starting_goalie");
  const injuryDelta = factorDelta(factors, "injur");
  const restDelta = factorDelta(factors, "rest") + factorDelta(factors, "back_to_back");
  const weatherDelta = factorDelta(factors, "weather");
  const trendDelta =
    (ctx.homeExtended.scoringTrend - ctx.awayExtended.scoringTrend) +
    (ctx.homeExtended.defenseTrend - ctx.awayExtended.defenseTrend);
  const homeVenueWinPct = splitWinPct(ctx.homeExtended.homeRecord);
  const awayRoadWinPct = splitWinPct(ctx.awayExtended.awayRecord);

  // Convert rating edge into a score-margin target. This is intentionally
  // sport-specific: 40 Elo is a real edge in MLB/NHL, but a softer signal in
  // NBA where possessions create wider margins.
  const marginPer100Elo: Record<string, number> = {
    NBA: 4.5, NCAAB: 3.8, NFL: 4.9, NCAAF: 5.8, MLB: 1.15, NHL: 0.8,
    MLS: 0.56, EPL: 0.56, UCL: 0.6, IPL: 15, TENNIS: 0.55,
  };
  let expectedMargin = (totalRatingDelta / 100) * (marginPer100Elo[ctx.sport] ?? 2.5);
  if (
    ctx.marketFavorite &&
    typeof ctx.marketSpread === "number" &&
    Number.isFinite(ctx.marketSpread) &&
    Math.abs(ctx.marketSpread) >= 0.1
  ) {
    const marketMargin =
      ctx.marketFavorite === "home"
        ? Math.abs(ctx.marketSpread)
        : -Math.abs(ctx.marketSpread);
    const previousMargin = expectedMargin;
    expectedMargin = previousMargin * 0.78 + marketMargin * 0.22;
    signals.push({
      key: "market-spread-anchor",
      label: "Market spread anchor",
      value: round(expectedMargin - previousMargin, 2),
      evidence: `Displayed market spread anchors projected margin toward ${ctx.marketFavorite} by ${round(expectedMargin - previousMargin, 1)} points`,
    });
  }

  const currentMargin = homeMean - awayMean;
  const hasScoreBaseline =
    ctx.homeForm.avgScore > 0 &&
    ctx.awayForm.avgScore > 0 &&
    ctx.homeForm.avgAllowed > 0 &&
    ctx.awayForm.avgAllowed > 0;
  const marginBlend = hasScoreBaseline ? 0.72 : 1.0;
  const marginShift = (expectedMargin - currentMargin) * marginBlend;
  homeMean += marginShift / 2;
  awayMean -= marginShift / 2;

  if (Math.abs(netRatingDelta) > 1) {
    const shift = clamp(netRatingDelta / 30, -3, 3);
    homeMean += shift / 2;
    awayMean -= shift / 2;
    signals.push({
      key: "net-rating-script",
      label: "Efficiency script",
      value: round(shift, 2),
      evidence: `Net-rating signal moves projected margin ${shift >= 0 ? "+" : ""}${round(shift, 1)} points toward home`,
    });
  }

  if (ctx.sport === "MLB" && Math.abs(pitcherDelta) > 0.5) {
    const shift = clamp(pitcherDelta / 12, -1.25, 1.25);
    homeMean += shift / 2;
    awayMean -= shift / 2;
    signals.push({
      key: "pitcher-run-suppression",
      label: "Starter run suppression",
      value: round(shift, 2),
      evidence: `Starting pitcher edge shifts the run script ${shift >= 0 ? "+" : ""}${round(shift, 1)} toward home`,
    });
  }

  if (ctx.sport === "NHL" && Math.abs(goalieDelta) > 0.5) {
    const shift = clamp(goalieDelta / 18, -0.9, 0.9);
    homeMean += shift / 2;
    awayMean -= shift / 2;
    signals.push({
      key: "goalie-goal-suppression",
      label: "Goalie leverage",
      value: round(shift, 2),
      evidence: `Goalie signal shifts the goal script ${shift >= 0 ? "+" : ""}${round(shift, 1)} toward home`,
    });
  }

  if (Math.abs(injuryDelta) > 0.5) {
    const shift = clamp(injuryDelta / 24, -4, 4);
    homeMean += shift / 2;
    awayMean -= shift / 2;
    signals.push({
      key: "availability-script",
      label: "Availability script",
      value: round(shift, 2),
      evidence: `Availability changes the projected margin ${shift >= 0 ? "+" : ""}${round(shift, 1)} points toward home`,
    });
  }

  if (Math.abs(restDelta) > 0.5) {
    const shift = clamp(restDelta / 35, -2, 2);
    homeMean += shift / 2;
    awayMean -= shift / 2;
    signals.push({
      key: "fatigue-script",
      label: "Fatigue script",
      value: round(shift, 2),
      evidence: `Rest/fatigue shifts the projected margin ${shift >= 0 ? "+" : ""}${round(shift, 1)} points toward home`,
    });
  }

  if (Math.abs(trendDelta) > 0.04) {
    const shift = clamp(trendDelta * (ctx.sport === "NBA" || ctx.sport === "NCAAB" ? 2.2 : 1.2), -2.5, 2.5);
    homeMean += shift / 2;
    awayMean -= shift / 2;
    signals.push({
      key: "trend-script",
      label: "Trend-adjusted script",
      value: round(shift, 2),
      evidence: `Scoring/defense trend shifts the projected margin ${shift >= 0 ? "+" : ""}${round(shift, 1)} points toward home`,
    });
  }

  if (homeVenueWinPct !== null && awayRoadWinPct !== null) {
    const venueEdge = homeVenueWinPct - awayRoadWinPct;
    if (Math.abs(venueEdge) > 0.08) {
      const shift = clamp(venueEdge * (ctx.sport === "MLB" || ctx.sport === "NHL" ? 1.2 : 3.5), -2, 2);
      homeMean += shift / 2;
      awayMean -= shift / 2;
      signals.push({
        key: "venue-split-script",
        label: "Venue split",
        value: round(shift, 2),
        evidence: `Home/road split shifts projected margin ${shift >= 0 ? "+" : ""}${round(shift, 1)} points toward home`,
      });
    }
  }

  let totalMean = homeMean + awayMean;
  let marginSd = baseline.marginSd;

  if (Math.abs(weatherDelta) > 0.5) {
    const compression = ctx.sport === "NFL" || ctx.sport === "NCAAF" ? 0.06 : 0.03;
    totalMean *= 1 - compression;
    marginSd *= 1.05;
    signals.push({
      key: "weather-volatility",
      label: "Weather volatility",
      value: round(weatherDelta, 2),
      evidence: "Weather compresses scoring and increases upset volatility",
    });
  }

  const tennisWeather = tennisWeatherVolatility(ctx);
  if (tennisWeather) {
    marginSd *= 1 + tennisWeather.boost;
    signals.push({
      key: "tennis-weather-volatility",
      label: "Tennis weather volatility",
      value: round(tennisWeather.boost, 3),
      evidence: tennisWeather.evidence,
    });
  }

  const totalTrend =
    ctx.homeExtended.scoringTrend +
    ctx.awayExtended.scoringTrend -
    ctx.homeExtended.defenseTrend -
    ctx.awayExtended.defenseTrend;
  if (Math.abs(totalTrend) > 0.06) {
    const totalShift = clamp(totalTrend * 0.035, -0.08, 0.08);
    totalMean *= 1 + totalShift;
    signals.push({
      key: "total-trend-script",
      label: "Total environment",
      value: round(totalShift, 3),
      evidence: `Recent offense/defense trend moves projected total ${totalShift >= 0 ? "+" : ""}${round(totalShift * 100, 1)}%`,
    });
  }

  if (
    typeof ctx.marketOverUnder === "number" &&
    Number.isFinite(ctx.marketOverUnder) &&
    ctx.marketOverUnder > 0
  ) {
    const previousTotal = totalMean;
    totalMean = previousTotal * 0.65 + ctx.marketOverUnder * 0.35;
    signals.push({
      key: "market-total-anchor",
      label: "Market total anchor",
      value: round(totalMean - previousTotal, 2),
      evidence: `Displayed total anchors projected scoring environment ${round(totalMean - previousTotal, 1)} points toward ${round(ctx.marketOverUnder, 1)}`,
    });
  }

  totalMean = clampProjectedTotal(ctx.sport, totalMean, signals);

  ({ homeMean, awayMean } = anchorMarginToRatingEdge({
    sport: ctx.sport,
    homeMean,
    awayMean,
    expectedMargin,
    signals,
  }));

  const strength = signalStrength(factors);
  if (strength < 0.75) {
    marginSd *= 1.08;
    signals.push({
      key: "thin-context",
      label: "Thin-context warning",
      value: round(strength, 2),
      evidence: "Few contextual factors have hard signal, so the projection keeps extra variance",
    });
  }

  const minMean = ctx.sport === "NBA" ? 80 : ctx.sport === "NCAAB" ? 48 : 0.15;
  homeMean = Math.max(minMean, homeMean);
  awayMean = Math.max(minMean, awayMean);

  return {
    homeMean,
    awayMean,
    marginSd,
    totalMean: totalMean || homeMean + awayMean,
    signals,
  };
}

function quantizeScore(value: number, sport: string): number {
  const baseline = SPORT_BASELINES[sport] ?? SPORT_BASELINES.NBA!;
  const rounded = Math.round(value / baseline.granularity) * baseline.granularity;
  return Math.max(baseline.minScore, rounded);
}

function sampleScorePair(
  model: { homeMean: number; awayMean: number; marginSd: number; totalMean: number },
  sport: string,
  rand: () => number,
): { home: number; away: number } {
  const baseline = SPORT_BASELINES[sport] ?? SPORT_BASELINES.NBA!;
  const expectedMargin = model.homeMean - model.awayMean;
  const sampledMargin = expectedMargin + normalSample(rand) * model.marginSd;
  const sampledTotal = Math.max(
    0.2,
    model.totalMean + normalSample(rand) * baseline.totalSd,
  );

  let home = (sampledTotal + sampledMargin) / 2;
  let away = (sampledTotal - sampledMargin) / 2;

  if (home < baseline.minScore) {
    away += baseline.minScore - home;
    home = baseline.minScore;
  }
  if (away < baseline.minScore) {
    home += baseline.minScore - away;
    away = baseline.minScore;
  }

  return {
    home: quantizeScore(home, sport),
    away: quantizeScore(away, sport),
  };
}

export function simulateGameProjection(
  ctx: GameContext,
  totalRatingDelta: number,
  factors: FactorContribution[],
): SimulationProjection {
  const rand = makePrng(`${ctx.game.id}|${ctx.sport}|${ctx.homeElo}|${ctx.awayElo}|projection-v2`);
  const model = buildScoreModel(ctx, totalRatingDelta, factors);
  const soccer = SOCCER_LEAGUES.has(ctx.sport);

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let homeScoreSum = 0;
  let awayScoreSum = 0;
  let marginSum = 0;
  let marginSquareSum = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    let { home, away } = sampleScorePair(model, ctx.sport, rand);

    if (!soccer && home === away) {
      // Non-soccer games resolve in overtime/extra innings. Tilt tied samples
      // according to the projected margin rather than coin-flipping blindly.
      const homeTieProb = clamp(0.5 + (model.homeMean - model.awayMean) / (model.marginSd * 4), 0.35, 0.65);
      if (rand() < homeTieProb) home += 1;
      else away += 1;
    }

    const margin = home - away;
    homeScoreSum += home;
    awayScoreSum += away;
    marginSum += margin;
    marginSquareSum += margin ** 2;

    if (home > away) homeWins++;
    else if (away > home) awayWins++;
    else draws++;
  }

  const boundedScores = boundedProjectedScoreLine(
    ctx.sport,
    homeScoreSum / ITERATIONS,
    awayScoreSum / ITERATIONS,
    model.signals,
  );
  const projectedHomeScore = boundedScores.home;
  const projectedAwayScore = boundedScores.away;
  const projectedSpread = projectedHomeScore - projectedAwayScore;
  const projectedTotal = projectedHomeScore + projectedAwayScore;
  const avgMargin = marginSum / ITERATIONS;
  const variance = Math.max(0, marginSquareSum / ITERATIONS - avgMargin ** 2);
  const volatility = Math.sqrt(variance);
  const favoriteWins = Math.max(homeWins, awayWins, draws) / ITERATIONS;
  const upsetRisk = 1 - favoriteWins;

  return {
    engine: "game-script-v1",
    iterations: ITERATIONS,
    homeWinProbability: round(homeWins / ITERATIONS),
    awayWinProbability: round(awayWins / ITERATIONS),
    drawProbability: soccer ? round(draws / ITERATIONS) : undefined,
    projectedHomeScore: round(projectedHomeScore, 1),
    projectedAwayScore: round(projectedAwayScore, 1),
    projectedSpread: round(projectedSpread, 1),
    projectedTotal: round(projectedTotal, 1),
    volatility: round(volatility, 2),
    upsetRisk: round(upsetRisk, 3),
    signals: Array.from(
      new Map(model.signals.map((signal) => [signal.key, signal])).values(),
    ).slice(0, 5),
  };
}
