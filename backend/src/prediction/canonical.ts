import type {
  CanonicalEngineRead,
  CanonicalFinalPick,
  CanonicalEngineWeights,
  CanonicalMarketType,
  CanonicalPredictionResult,
  CanonicalProbabilities,
  FactorContribution,
  GameContext,
  SimulationProjection,
} from "./types";
import { buildDecisionProfile } from "./decisionProfile";

export const CANONICAL_RECONCILIATION_METHOD =
  "factor-simulation-market-consensus-v1";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundConfidence(value: number): number {
  return Math.round(clamp(value, 0, 100) * 10) / 10;
}

function normalizeTwoWay(home: number, away: number): [number, number] {
  const safeHome = Number.isFinite(home) ? clamp(home, 0, 1) : 0;
  const safeAway = Number.isFinite(away) ? clamp(away, 0, 1) : 0;
  const total = safeHome + safeAway;
  if (total <= 0) return [0.5, 0.5];
  return [safeHome / total, safeAway / total];
}

function normalizeThreeWay(home: number, draw: number, away: number): [number, number, number] {
  const safeHome = Number.isFinite(home) ? clamp(home, 0, 1) : 0;
  const safeDraw = Number.isFinite(draw) ? clamp(draw, 0, 1) : 0;
  const safeAway = Number.isFinite(away) ? clamp(away, 0, 1) : 0;
  const total = safeHome + safeDraw + safeAway;
  if (total <= 0) return [0.375, 0.25, 0.375];
  return [safeHome / total, safeDraw / total, safeAway / total];
}

export function normalizeCanonicalProbabilities(input: {
  home: number;
  away: number;
  draw?: number;
}): CanonicalProbabilities {
  if (input.draw !== undefined) {
    const [home, draw, away] = normalizeThreeWay(input.home, input.draw, input.away);
    return { home: roundTo(home), away: roundTo(away), draw: roundTo(draw) };
  }

  const [home, away] = normalizeTwoWay(input.home, input.away);
  return { home: roundTo(home), away: roundTo(away) };
}

export function canonicalPickFromProbabilities(
  probabilities: CanonicalProbabilities,
): CanonicalFinalPick {
  const draw = probabilities.draw;
  if (draw !== undefined && draw >= probabilities.home && draw >= probabilities.away) {
    return "draw";
  }
  if (Math.abs(probabilities.home - probabilities.away) < 0.001 && draw === undefined) {
    return "none";
  }
  return probabilities.home >= probabilities.away ? "home" : "away";
}

export function probabilityForPick(
  probabilities: CanonicalProbabilities,
  pick: CanonicalFinalPick,
): number {
  if (pick === "home") return probabilities.home;
  if (pick === "away") return probabilities.away;
  if (pick === "draw") return probabilities.draw ?? 0;
  return Math.max(probabilities.home, probabilities.away, probabilities.draw ?? 0);
}

function engineRead(args: {
  engine: string;
  probabilities: CanonicalProbabilities;
  weight?: number;
  inputs?: CanonicalEngineRead["inputs"];
  warnings?: string[];
}): CanonicalEngineRead {
  const pick = canonicalPickFromProbabilities(args.probabilities);
  const probability = probabilityForPick(args.probabilities, pick);
  return {
    engine: args.engine,
    pick,
    probability: roundTo(probability),
    confidence: roundConfidence(probability * 100),
    weight: args.weight,
    probabilities: args.probabilities,
    inputs: args.inputs,
    warnings: args.warnings,
  };
}

function marketTypeForProbabilities(probabilities: CanonicalProbabilities): CanonicalMarketType {
  return probabilities.draw === undefined ? "moneyline" : "three_way_result";
}

function warningList(args: {
  ctx: GameContext;
  factors: FactorContribution[];
  final: CanonicalProbabilities;
  projection?: SimulationProjection;
  extraWarnings?: string[];
}): string[] {
  const warnings: string[] = [];
  const availableFactors = args.factors.filter((f) => f.available).length;
  if (args.factors.length > 0 && availableFactors / args.factors.length < 0.6) {
    warnings.push("Low factor coverage; missing inputs were redistributed before final aggregation.");
  }
  if (args.factors.some((f) => f.key === "data_quality_guard")) {
    warnings.push("Missing critical league inputs triggered a reliability reserve instead of amplifying rating/home-field.");
  }
  if (!Number.isFinite(args.final.home) || !Number.isFinite(args.final.away)) {
    warnings.push("Invalid final probability encountered; canonical normalizer repaired the output.");
  }
  if (args.projection) {
    const projectionPick = canonicalPickFromProbabilities(
      normalizeCanonicalProbabilities({
        home: args.projection.homeWinProbability,
        away: args.projection.awayWinProbability,
        draw: args.projection.drawProbability,
      }),
    );
    const finalPick = canonicalPickFromProbabilities(args.final);
    if (projectionPick !== finalPick) {
      warnings.push("Projection engine disagreed before reconciliation; final pick uses orchestrator output.");
    }
  }
  if (!args.ctx.game.id || !args.ctx.game.homeTeam.id || !args.ctx.game.awayTeam.id) {
    warnings.push("Event/team mapping is incomplete.");
  }
  return Array.from(new Set([...warnings, ...(args.extraWarnings ?? [])]));
}

export function buildCanonicalPredictionResult(args: {
  ctx: GameContext;
  factors: FactorContribution[];
  factorProbabilities: CanonicalProbabilities;
  projection: SimulationProjection;
  rawProjection?: SimulationProjection;
  finalProbabilities: CanonicalProbabilities;
  confidence: number;
  generatedAt: string;
  modelVersion: string;
  blendedProbabilities?: CanonicalProbabilities;
  marketProbabilities?: CanonicalProbabilities;
  engineWeights?: CanonicalEngineWeights;
  extraWarnings?: string[];
}): CanonicalPredictionResult {
  const engineProjection = args.rawProjection ?? args.projection;
  const final = normalizeCanonicalProbabilities(args.finalProbabilities);
  const finalPick = canonicalPickFromProbabilities(final);
  const finalProbability = probabilityForPick(final, finalPick);
  const marketType = marketTypeForProbabilities(final);
  const availableFactorCount = args.factors.filter((f) => f.available).length;
  const warnings = warningList({
    ctx: args.ctx,
    factors: args.factors,
    final,
    projection: engineProjection,
    extraWarnings: args.extraWarnings,
  });

  const projectionProbabilities = normalizeCanonicalProbabilities({
    home: engineProjection.homeWinProbability,
    away: engineProjection.awayWinProbability,
    draw: final.draw !== undefined ? engineProjection.drawProbability : undefined,
  });
  const engineWeights = args.engineWeights ?? {
    factor: args.marketProbabilities ? 0.8 : 0.86,
    projection: 0.14,
    market: args.marketProbabilities ? 0.06 : 0,
  };

  const breakdown: CanonicalEngineRead[] = [
    engineRead({
      engine: "factor-model-v1",
      probabilities: normalizeCanonicalProbabilities(args.factorProbabilities),
      weight: roundTo(engineWeights.factor),
      inputs: {
        factorCount: args.factors.length,
        availableFactorCount,
      },
    }),
    engineRead({
      engine: engineProjection.engine,
      probabilities: projectionProbabilities,
      weight: roundTo(engineWeights.projection),
      inputs: {
        iterations: engineProjection.iterations,
        projectedHomeScore: engineProjection.projectedHomeScore,
        projectedAwayScore: engineProjection.projectedAwayScore,
      },
    }),
  ];

  if (args.marketProbabilities) {
    const marketSourceLabel = args.ctx.marketConsensus?.sourceLabel ?? "SharpAPI consensus";
    breakdown.push(
      engineRead({
        engine: "market-calibration",
        probabilities: normalizeCanonicalProbabilities(args.marketProbabilities),
        weight: roundTo(engineWeights.market),
        inputs: {
          source: marketSourceLabel,
          fallback: Boolean(args.ctx.marketConsensus?.isFallback),
          usedAsSmallCalibrationOnly: true,
        },
      }),
    );
  }

  if (args.blendedProbabilities) {
    breakdown.push(
      engineRead({
        engine: "pre-reconciliation-blend",
        probabilities: normalizeCanonicalProbabilities(args.blendedProbabilities),
        inputs: {
          note: "Factor, simulation, and optional market calibration before projection reconciliation",
        },
      }),
    );
  }

  const decisionProfile = buildDecisionProfile({
    ctx: args.ctx,
    factors: args.factors,
    factorProbabilities: normalizeCanonicalProbabilities(args.factorProbabilities),
    projectionProbabilities,
    finalProbabilities: final,
    projection: engineProjection,
    marketProbabilities: args.marketProbabilities
      ? normalizeCanonicalProbabilities(args.marketProbabilities)
      : undefined,
    engineWeights,
    warnings,
    confidence: args.confidence,
  });

  breakdown.push(
    engineRead({
      engine: "orchestrator-v1",
      probabilities: final,
      weight: 1,
      inputs: {
        reconciliationMethod: CANONICAL_RECONCILIATION_METHOD,
      },
      warnings,
    }),
  );

  const projectionPick = canonicalPickFromProbabilities(projectionProbabilities);
  const notes = [
    "Factors provide the primary model read; simulation/projection contributes game-script distribution.",
    args.marketProbabilities
      ? `${args.ctx.marketConsensus?.sourceLabel ?? "Market consensus"} is a small calibration input and never overrides the model vote.`
      : "No market calibration was included for this event.",
  ];
  if (projectionPick !== finalPick) {
    notes.push("Projection disagreement was preserved in engineBreakdown and reconciled by the orchestrator.");
  }

  return {
    eventId: args.ctx.game.id,
    marketType,
    finalPick,
    finalProbability: roundTo(finalProbability),
    confidence: roundConfidence(args.confidence),
    probabilities: final,
    decisionProfile,
    projectedScore: {
      home: args.projection.projectedHomeScore,
      away: args.projection.projectedAwayScore,
      spread: args.projection.projectedSpread,
      total: args.projection.projectedTotal,
    },
    simulationSummary: {
      engine: engineProjection.engine,
      iterations: engineProjection.iterations,
      probabilities: projectionProbabilities,
      volatility: engineProjection.volatility,
      upsetRisk: engineProjection.upsetRisk,
    },
    modelInputs: {
      sport: args.ctx.sport,
      homeTeamId: args.ctx.game.homeTeam.id,
      awayTeamId: args.ctx.game.awayTeam.id,
      gameTime: args.ctx.game.dateTime,
      factorCount: args.factors.length,
      availableFactorCount,
      marketConsensusIncluded: Boolean(args.marketProbabilities),
    },
    engineBreakdown: breakdown,
    reconciliation: {
      method: CANONICAL_RECONCILIATION_METHOD,
      notes,
    },
    timestamp: args.generatedAt,
    dataVersion: args.modelVersion,
    warnings,
  };
}

type LegacyProjection = {
  engine: string;
  iterations: number;
  homeWinProbability: number;
  awayWinProbability: number;
  drawProbability?: number;
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedSpread: number;
  projectedTotal: number;
  volatility: number;
  upsetRisk: number;
  signals: Array<{ key: string; label: string; value: number; evidence: string }>;
};

export type LegacyPredictionForCanonical = {
  gameId: string;
  predictedWinner: "home" | "away";
  predictedOutcome?: "home" | "away" | "draw";
  confidence: number;
  homeWinProbability?: number;
  awayWinProbability?: number;
  drawProbability?: number;
  projection?: LegacyProjection;
  factors?: Array<{ weight: number }>;
  canonicalResult?: CanonicalPredictionResult;
};

function percentToProbability(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value > 1 ? value / 100 : value;
}

function normalizeLegacyProjectionProbabilities(
  projection: LegacyProjection | undefined,
  includeDraw: boolean,
): CanonicalProbabilities | undefined {
  if (!projection) return undefined;
  return normalizeCanonicalProbabilities({
    home: percentToProbability(projection.homeWinProbability, 0.5),
    away: percentToProbability(projection.awayWinProbability, 0.5),
    draw: includeDraw ? percentToProbability(projection.drawProbability, 0.25) : undefined,
  });
}

export function canonicalFromLegacyPrediction(
  prediction: LegacyPredictionForCanonical,
  sport: string,
  opts: {
    timestamp?: string;
    dataVersion?: string;
    liveEngineRead?: CanonicalEngineRead;
    warning?: string;
  } = {},
): CanonicalPredictionResult {
  const includeDraw =
    prediction.predictedOutcome === "draw" ||
    typeof prediction.drawProbability === "number" ||
    prediction.canonicalResult?.marketType === "three_way_result";

  const finalProbabilities = normalizeCanonicalProbabilities({
    home: percentToProbability(prediction.homeWinProbability, 0.5),
    away: percentToProbability(prediction.awayWinProbability, 0.5),
    draw: includeDraw ? percentToProbability(prediction.drawProbability, 0.25) : undefined,
  });

  const finalPick: CanonicalFinalPick =
    prediction.predictedOutcome === "draw"
      ? "draw"
      : prediction.predictedWinner === "home" || prediction.predictedWinner === "away"
        ? prediction.predictedWinner
        : canonicalPickFromProbabilities(finalProbabilities);

  const finalProbability = probabilityForPick(finalProbabilities, finalPick);
  const previous = prediction.canonicalResult;
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const dataVersion = opts.dataVersion ?? previous?.dataVersion ?? "legacy-canonical-sync";
  const projectionProbabilities = normalizeLegacyProjectionProbabilities(
    prediction.projection,
    includeDraw,
  );
  const warnings = Array.from(
    new Set([
      ...(previous?.warnings ?? []),
      ...(opts.warning ? [opts.warning] : []),
    ]),
  );

  const engineBreakdown = [
    ...(previous?.engineBreakdown ?? []).filter((read) =>
      read.engine !== "orchestrator-v1" && read.engine !== "live-score-v1"
    ),
  ];
  if (projectionProbabilities && !engineBreakdown.some((read) => read.engine === prediction.projection!.engine)) {
    engineBreakdown.push(engineRead({ engine: prediction.projection!.engine, probabilities: projectionProbabilities }));
  }
  if (opts.liveEngineRead) {
    engineBreakdown.push(opts.liveEngineRead);
  }
  engineBreakdown.push(
    engineRead({
      engine: "orchestrator-v1",
      probabilities: finalProbabilities,
      weight: 1,
      inputs: {
        reconciliationMethod: opts.liveEngineRead
          ? "live-score-adjusted-consensus-v1"
          : CANONICAL_RECONCILIATION_METHOD,
      },
      warnings,
    }),
  );

  return {
    eventId: previous?.eventId ?? prediction.gameId,
    marketType: includeDraw ? "three_way_result" : "moneyline",
    finalPick,
    finalProbability: roundTo(finalProbability),
    confidence: roundConfidence(prediction.confidence),
    probabilities: finalProbabilities,
    projectedScore: prediction.projection
      ? {
          home: prediction.projection.projectedHomeScore,
          away: prediction.projection.projectedAwayScore,
          spread: prediction.projection.projectedSpread,
          total: prediction.projection.projectedTotal,
        }
      : previous?.projectedScore,
    simulationSummary: prediction.projection
      ? {
          engine: prediction.projection.engine,
          iterations: prediction.projection.iterations,
          probabilities: projectionProbabilities ?? finalProbabilities,
          volatility: prediction.projection.volatility,
          upsetRisk: prediction.projection.upsetRisk,
        }
      : previous?.simulationSummary,
    modelInputs: previous?.modelInputs ?? {
      sport,
      homeTeamId: "",
      awayTeamId: "",
      gameTime: "",
      factorCount: prediction.factors?.length ?? 0,
      availableFactorCount: prediction.factors?.length ?? 0,
      marketConsensusIncluded: false,
    },
    engineBreakdown,
    reconciliation: {
      method: opts.liveEngineRead
        ? "live-score-adjusted-consensus-v1"
        : previous?.reconciliation.method ?? CANONICAL_RECONCILIATION_METHOD,
      notes: [
        ...(previous?.reconciliation.notes ?? []),
        ...(opts.liveEngineRead
          ? ["Live score state adjusted the canonical probabilities; the final pick still comes from this canonical object."]
          : []),
      ],
    },
    timestamp,
    dataVersion,
    warnings,
  };
}

export function traceCanonicalDecision(args: {
  ctx: GameContext;
  canonicalResult: CanonicalPredictionResult;
  factorProbabilities: CanonicalProbabilities;
  rawProjection: SimulationProjection;
}): void {
  if (process.env.NODE_ENV === "production" || process.env.PREDICTION_TRACE !== "1") {
    return;
  }

  console.debug("[prediction-trace]", {
    rawInputs: {
      eventId: args.ctx.game.id,
      sport: args.ctx.sport,
      homeTeamId: args.ctx.game.homeTeam.id,
      awayTeamId: args.ctx.game.awayTeam.id,
      homeElo: args.ctx.homeElo,
      awayElo: args.ctx.awayElo,
      marketConsensusIncluded: Boolean(args.ctx.marketConsensus),
    },
    predictionEngineOutput: {
      engine: "factor-model-v1",
      probabilities: args.factorProbabilities,
    },
    projectionEngineOutput: {
      engine: args.rawProjection.engine,
      probabilities: {
        home: args.rawProjection.homeWinProbability,
        away: args.rawProjection.awayWinProbability,
        draw: args.rawProjection.drawProbability,
      },
      projectedScore: {
        home: args.rawProjection.projectedHomeScore,
        away: args.rawProjection.projectedAwayScore,
        total: args.rawProjection.projectedTotal,
      },
    },
    simulationEngineOutput: {
      iterations: args.rawProjection.iterations,
      volatility: args.rawProjection.volatility,
      upsetRisk: args.rawProjection.upsetRisk,
    },
    aggregatorFinalOutput: {
      finalPick: args.canonicalResult.finalPick,
      finalProbability: args.canonicalResult.finalProbability,
      confidence: args.canonicalResult.confidence,
      probabilities: args.canonicalResult.probabilities,
      decisionProfile: args.canonicalResult.decisionProfile,
    },
    uiCanonicalObject: args.canonicalResult,
  });
}
