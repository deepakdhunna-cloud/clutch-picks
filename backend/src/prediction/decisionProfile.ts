import type {
  CanonicalDecisionProfile,
  CanonicalDecisionTag,
  CanonicalEngineWeights,
  CanonicalFinalPick,
  CanonicalProbabilities,
  FactorContribution,
  GameContext,
  SimulationProjection,
} from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function ratingFromScore(score: number): number {
  return clamp(Math.round(1 + clamp(score, 0, 100) * 0.09), 1, 10);
}

function pickFromProbabilities(probabilities: CanonicalProbabilities): CanonicalFinalPick {
  if (
    probabilities.draw !== undefined &&
    probabilities.draw >= probabilities.home &&
    probabilities.draw >= probabilities.away
  ) {
    return "draw";
  }
  if (probabilities.draw === undefined && Math.abs(probabilities.home - probabilities.away) < 0.001) {
    return "none";
  }
  return probabilities.home >= probabilities.away ? "home" : "away";
}

function probabilityForPick(probabilities: CanonicalProbabilities, pick: CanonicalFinalPick): number {
  if (pick === "home") return probabilities.home;
  if (pick === "away") return probabilities.away;
  if (pick === "draw") return probabilities.draw ?? 0;
  return Math.max(probabilities.home, probabilities.away, probabilities.draw ?? 0);
}

function sideSign(pick: CanonicalFinalPick): number {
  if (pick === "home") return 1;
  if (pick === "away") return -1;
  return 0;
}

function pickFromRatingFactor(factors: FactorContribution[]): CanonicalFinalPick {
  const rating = factors.find((factor) => factor.key === "rating_diff");
  if (!rating || !rating.available || Math.abs(rating.homeDelta) < 1) return "none";
  return rating.homeDelta > 0 ? "home" : "away";
}

function formatPts(value: number): string {
  const pts = Math.round(Math.abs(value) * 100);
  return `${pts} pts`;
}

function topDirectionalFactor(
  factors: FactorContribution[],
  pick: CanonicalFinalPick,
  supportsPick: boolean,
): FactorContribution | null {
  const sign = sideSign(pick);
  if (sign === 0) return null;

  let best: FactorContribution | null = null;
  let bestImpact = 0;
  for (const factor of factors) {
    if (
      !factor.available ||
      !factor.hasSignal ||
      factor.key === "rating_diff" ||
      Math.abs(factor.homeDelta) <= 0.001
    ) {
      continue;
    }

    const impact = factor.homeDelta * factor.weight;
    const aligned = impact * sign > 0;
    if (aligned !== supportsPick) continue;
    const magnitude = Math.abs(impact);
    if (magnitude > bestImpact) {
      best = factor;
      bestImpact = magnitude;
    }
  }
  return best;
}

function factorHiddenSupport(factors: FactorContribution[], pick: CanonicalFinalPick): number {
  const sign = sideSign(pick);
  if (sign === 0) return 0;
  return factors
    .filter(
      (factor) =>
        factor.available &&
        factor.hasSignal &&
        factor.key !== "rating_diff" &&
        Math.abs(factor.homeDelta) > 0.001,
    )
    .reduce((sum, factor) => sum + factor.homeDelta * factor.weight * sign, 0);
}

function uniqueTags(tags: CanonicalDecisionTag[]): CanonicalDecisionTag[] {
  return Array.from(new Set(tags));
}

export function buildDecisionProfile(args: {
  ctx: GameContext;
  factors: FactorContribution[];
  factorProbabilities: CanonicalProbabilities;
  projectionProbabilities: CanonicalProbabilities;
  finalProbabilities: CanonicalProbabilities;
  projection: SimulationProjection;
  marketProbabilities?: CanonicalProbabilities;
  engineWeights?: CanonicalEngineWeights;
  warnings: string[];
  confidence: number;
}): CanonicalDecisionProfile {
  const finalPick = pickFromProbabilities(args.finalProbabilities);
  const finalProbability = probabilityForPick(args.finalProbabilities, finalPick);
  const factorPick = pickFromProbabilities(args.factorProbabilities);
  const projectionPick = pickFromProbabilities(args.projectionProbabilities);
  const marketPick = args.marketProbabilities
    ? pickFromProbabilities(args.marketProbabilities)
    : undefined;
  const eloPick = pickFromRatingFactor(args.factors);

  const availableFactorCount = args.factors.filter((factor) => factor.available).length;
  const totalFactorWeight = args.factors.reduce((sum, factor) => sum + factor.weight, 0);
  const availableFactorWeight = args.factors
    .filter((factor) => factor.available)
    .reduce((sum, factor) => sum + factor.weight, 0);
  const signalFactorWeight = args.factors
    .filter((factor) => factor.available && factor.hasSignal)
    .reduce((sum, factor) => sum + factor.weight, 0);
  const dataCoverage = totalFactorWeight > 0 ? availableFactorWeight / totalFactorWeight : 1;
  const signalCoverage = totalFactorWeight > 0 ? signalFactorWeight / totalFactorWeight : 1;

  const weights = args.engineWeights ?? {
    factor: 0,
    projection: 1.0,
    market: args.marketProbabilities ? 0.1 : 0,
  };
  // In the unified engine, the simulation is the single source of truth.
  // Agreement is measured between the simulation pick and the market pick.
  // Factor pick is retained for transparency but has zero weight.
  const reads = [
    { pick: projectionPick, weight: 1.0 },
    ...(marketPick ? [{ pick: marketPick, weight: weights.market }] : []),
  ].filter((read) => read.weight > 0);
  const totalReadWeight = reads.reduce((sum, read) => sum + read.weight, 0) || 1;
  const supportWeight = reads
    .filter((read) => read.pick === finalPick)
    .reduce((sum, read) => sum + read.weight, 0);
  const agreementScore = clamp((supportWeight / totalReadWeight) * 100, 0, 100);
  const engineDivergence = marketPick !== undefined && marketPick !== finalPick;

  const hiddenSupport = factorHiddenSupport(args.factors, finalPick);
  const topSupport = topDirectionalFactor(args.factors, finalPick, true);
  const topCounter = topDirectionalFactor(args.factors, finalPick, false);
  const marketPickProbability =
    args.marketProbabilities && finalPick !== "none"
      ? probabilityForPick(args.marketProbabilities, finalPick)
      : undefined;
  const marketDelta =
    marketPickProbability !== undefined ? finalProbability - marketPickProbability : undefined;

  const hiddenEdgeScore = clamp(
    (hiddenSupport / 28) * 65 +
      (topSupport ? 12 : 0) +
      (projectionPick === finalPick ? 12 : 0) +
      (marketDelta !== undefined && marketDelta > 0.04 ? 11 : 0),
    0,
    100,
  );
  const riskScore = clamp(
    args.projection.upsetRisk * 55 +
      (100 - agreementScore) * 0.25 +
      (1 - dataCoverage) * 65 * 0.2,
    0,
    100,
  );

  const baseline = args.finalProbabilities.draw !== undefined ? 1 / 3 : 0.5;
  const probabilityEdgeScore = clamp(
    ((finalProbability - baseline) / (args.finalProbabilities.draw !== undefined ? 0.22 : 0.26)) * 100,
    0,
    100,
  );
  const convictionScore = clamp(
    probabilityEdgeScore * 0.36 +
      agreementScore * 0.28 +
      hiddenEdgeScore * 0.22 +
      dataCoverage * 100 * 0.14 -
      riskScore * 0.12,
    0,
    100,
  );
  const edgeRating = ratingFromScore(convictionScore);
  const valueRating =
    marketDelta !== undefined
      ? clamp(Math.round(5 + marketDelta * 50 + (hiddenEdgeScore - 50) / 30), 1, 10)
      : clamp(Math.round(4 + hiddenEdgeScore / 25), 1, 8);

  const upsetScore = clamp(
    args.projection.upsetRisk * 45 +
      (marketPick && marketPick !== finalPick ? 24 : 0) +
      (eloPick !== "none" && eloPick !== finalPick ? 18 : 0) +
      (hiddenEdgeScore >= 55 ? 13 : 0) +
      (finalProbability < 0.58 && finalPick !== "draw" ? 8 : 0) -
      (dataCoverage < 0.55 ? 8 : 0),
    0,
    100,
  );
  const lowDataWarning = dataCoverage < 0.6 || args.warnings.some((warning) => /low|thin|missing/i.test(warning));

  const tags: CanonicalDecisionTag[] = [];
  if (agreementScore >= 75) tags.push("model-consensus");
  if (hiddenEdgeScore >= 55) tags.push("hidden-edge");
  if (upsetScore >= 58) tags.push("upset-watch");
  if ((marketPick && marketPick !== finalPick) || (marketDelta !== undefined && Math.abs(marketDelta) >= 0.08)) {
    tags.push("market-disagreement");
  }
  if (lowDataWarning) tags.push("thin-data");
  if (riskScore >= 58 || args.projection.upsetRisk >= 0.45) tags.push("volatile-script");
  if (finalProbability < baseline + 0.035 || agreementScore < 55) tags.push("low-conviction");
  if (marketPick === finalPick && eloPick === finalPick && finalProbability >= 0.58) tags.push("chalk");

  const thesis: string[] = [
    `Unified read: ${finalPick} at ${Math.round(finalProbability * 100)}% with ${Math.round(agreementScore)}% engine agreement.`,
  ];
  if (topSupport) {
    thesis.push(`Hidden support: ${topSupport.label} (${topSupport.evidence}).`);
  }
  if (marketDelta !== undefined) {
    const direction = marketDelta >= 0 ? "above" : "below";
    thesis.push(`Market gap: model is ${formatPts(marketDelta)} ${direction} consensus on the final side.`);
  }
  if (projectionPick === finalPick) {
    thesis.push(`Game-script projection backs the same side with ${Math.round(args.projection.upsetRisk * 100)}% upset/draw risk.`);
  }

  const watchouts: string[] = [];
  if (topCounter) {
    watchouts.push(`Counter-signal: ${topCounter.label} (${topCounter.evidence}).`);
  }
  if (marketPick && marketPick !== finalPick) {
    watchouts.push(`Outside consensus leans ${marketPick}, so this is a disagreement spot.`);
  }
  if (lowDataWarning) {
    watchouts.push(`Data coverage is ${Math.round(dataCoverage * 100)}%; missing inputs limit conviction.`);
  }
  if (riskScore >= 55) {
    watchouts.push(`Volatility profile is elevated at ${Math.round(riskScore)} risk score.`);
  }

  return {
    version: "unified-decision-profile-v1",
    pick: finalPick,
    probability: roundTo(finalProbability),
    confidence: roundTo(args.confidence, 1),
    dataCoverage: roundTo(dataCoverage),
    signalCoverage: roundTo(signalCoverage),
    agreementScore: Math.round(agreementScore),
    hiddenEdgeScore: Math.round(hiddenEdgeScore),
    upsetScore: Math.round(upsetScore),
    riskScore: Math.round(riskScore),
    edgeRating,
    valueRating,
    lowDataWarning,
    engineDivergence,
    factorPick,
    projectionPick,
    marketPick,
    marketDelta: marketDelta !== undefined ? roundTo(marketDelta, 4) : undefined,
    tags: uniqueTags(tags),
    thesis: thesis.slice(0, 4),
    watchouts: watchouts.slice(0, 4),
  };
}
