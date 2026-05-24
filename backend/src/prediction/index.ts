/**
 * Honest Prediction Engine — Public API
 *
 * predictGame(ctx) → HonestPrediction
 *
 * This is the single entry point. It:
 *   1. Runs base factors (universal)
 *   2. Runs sport-specific factors
 *   3. Redistributes weight from unavailable factors
 *   4. Sums weighted deltas into a total rating advantage
 *   5. Converts to probability via the Elo logistic
 *   6. Blends in game-script simulation + a small market calibration anchor
 *   7. Harmonizes the public projection to the final consensus outcome
 *   8. Returns the prediction with all factors, projection, confidence, and band
 *
 * GROUND RULES (Section 0):
 * - No confidence floor above 50%
 * - No confidence ceiling below 100%
 * - No sigmoid scaling multipliers
 * - No probability clamps beyond [0, 1]
 * - No fabricated data
 * - Market can calibrate probability, but never overrides the model vote
 */

import type { GameContext, FactorContribution, HonestPrediction, LeagueKey, SimulationProjection, CanonicalEngineWeights } from "./types";
import { getConfidenceBand } from "./types";
import { ratingDeltaToHomeWinProb, applySoccerDrawAdjustment } from "./probability";
import { simulateGameProjection } from "./simulation";
import { computeBaseFactors } from "./factors/base";
import { computeNFLFactors } from "./factors/nfl";
import { computeNBAFactors } from "./factors/nba";
import { computeMLBFactors } from "./factors/mlb";
import { computeNHLFactors } from "./factors/nhl";
import { computeMLSFactors } from "./factors/mls";
import { computeEPLFactors } from "./factors/epl";
import { computeUCLFactors } from "./factors/ucl";
import { computeIPLFactors } from "./factors/ipl";
import { computeTennisFactors } from "./factors/tennis";
import { computeNCAAFBFactors } from "./factors/ncaafb";
import { computeNCAAMBFactors } from "./factors/ncaamb";
import {
  buildCanonicalPredictionResult,
  normalizeCanonicalProbabilities,
  traceCanonicalDecision,
} from "./canonical";

export const MODEL_VERSION = "2.5.1-coverage-form-weather-calibration";

// ─── Sport → factor function map ────────────────────────────────────────

const SPORT_FACTORS: Record<string, (ctx: GameContext) => FactorContribution[]> = {
  NFL: computeNFLFactors,
  NBA: computeNBAFactors,
  MLB: computeMLBFactors,
  NHL: computeNHLFactors,
  MLS: computeMLSFactors,
  EPL: computeEPLFactors,
  UCL: computeUCLFactors,
  IPL: computeIPLFactors,
  TENNIS: computeTennisFactors,
  NCAAF: computeNCAAFBFactors,
  NCAAB: computeNCAAMBFactors,
};

const SOCCER_LEAGUES = new Set(["MLS", "EPL", "UCL"]);

type ConsensusOutcome = "home" | "away" | "draw";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeTwoWay(home: number, away: number): [number, number] {
  const total = home + away;
  if (total <= 0) return [0.5, 0.5];
  return [home / total, away / total];
}

function normalizeThreeWay(home: number, draw: number, away: number): [number, number, number] {
  const total = home + draw + away;
  if (total <= 0) return [0.375, 0.25, 0.375];
  return [home / total, draw / total, away / total];
}

function dataCoverage(factors: FactorContribution[]): number {
  const total = factors.reduce((sum, f) => sum + f.weight, 0);
  if (total <= 0) return 0;
  const available = factors
    .filter((f) => f.available)
    .reduce((sum, f) => sum + f.weight, 0);
  return available / total;
}

function factorByKey(factors: FactorContribution[], key: string): FactorContribution | undefined {
  return factors.find((f) => f.key === key);
}

function applyWeakSportCalibration(
  ctx: GameContext,
  totalRatingDelta: number,
  factors: FactorContribution[],
  coverage: number,
): { ratingDelta: number; warnings: string[] } {
  let multiplier = 1;
  const warnings: string[] = [];

  if (ctx.sport === "MLB") {
    const starter = factorByKey(factors, "starting_pitcher");
    const positionInjuries = factorByKey(factors, "injuries_mlb");

    // Live calibration showed MLB was generating too many 60%+ reads from
    // noisy team-level context. If the starter matchup is missing, pull the
    // rating edge back toward pick'em instead of letting that weight amplify Elo.
    if (!starter?.available) {
      multiplier *= 0.72;
      warnings.push("MLB starter matchup missing; confidence compressed toward pick'em.");
    } else if (Math.abs(starter.homeDelta) < 18) {
      multiplier *= 0.88;
      warnings.push("MLB starter matchup is close; avoiding a team-stats overclaim.");
    }

    if (!positionInjuries?.available) {
      multiplier *= 0.94;
    }
    if (!ctx.marketConsensus) {
      multiplier *= 0.95;
    }
    if (coverage < 0.78) {
      multiplier *= 0.92;
      warnings.push("MLB data coverage is thin; confidence compressed.");
    }

    multiplier = Math.max(0.58, multiplier);
  } else if (ctx.sport === "TENNIS") {
    const ranking = factorByKey(factors, "tennis_ranking_edge");
    const form = factorByKey(factors, "tennis_recent_form");

    // Tennis has no true home field and ESPN often lacks enough player-level
    // context. Rankings remain useful, but we should not present ranking-only
    // reads as strong model signal.
    multiplier *= 0.78;
    if (!ranking?.available || !ranking.hasSignal) {
      multiplier *= 0.60;
      warnings.push("Tennis ranking signal missing or neutral; confidence compressed.");
    }
    if (!form?.available) {
      multiplier *= 0.86;
    }
    if (!ctx.marketConsensus) {
      multiplier *= 0.92;
    }

    multiplier = Math.max(0.45, multiplier);
  } else if (ctx.sport === "MLS") {
    const fixture = factorByKey(factors, "fixture_congestion");
    const manager = factorByKey(factors, "manager_change");
    const stakes = factorByKey(factors, "stakes");

    // MLS underperformance is partly a tracking issue until draw outcomes are
    // stored correctly, but the league is also high-variance. Keep reads more
    // conservative when the soccer-specific context is thin.
    multiplier *= 0.90;
    if (!fixture?.available && !manager?.available && !stakes?.available) {
      multiplier *= 0.90;
      warnings.push("MLS contextual factors are thin; confidence compressed.");
    }
    if (!ctx.marketConsensus) {
      multiplier *= 0.94;
    }

    multiplier = Math.max(0.70, multiplier);
  }

  if (multiplier >= 0.995) {
    return { ratingDelta: totalRatingDelta, warnings };
  }

  return {
    ratingDelta: totalRatingDelta * multiplier,
    warnings,
  };
}

function roundTo(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function topOutcome(home: number, away: number, draw?: number): ConsensusOutcome {
  if (draw !== undefined && draw >= home && draw >= away) return "draw";
  return home >= away ? "home" : "away";
}

function rankedOutcomes(home: number, away: number, draw?: number): Array<{ side: ConsensusOutcome; value: number }> {
  const values: Array<{ side: ConsensusOutcome; value: number }> = [
    { side: "home", value: home },
    { side: "away", value: away },
  ];
  if (draw !== undefined) {
    values.push({ side: "draw", value: draw });
  }
  return values.sort((a, b) => b.value - a.value);
}

function preserveNonMarketOutcome(args: {
  home: number;
  away: number;
  draw?: number;
  nonMarketHome: number;
  nonMarketAway: number;
  nonMarketDraw?: number;
}): { home: number; away: number; draw?: number } {
  const originalTop = topOutcome(args.nonMarketHome, args.nonMarketAway, args.nonMarketDraw);
  const blendedTop = topOutcome(args.home, args.away, args.draw);
  if (originalTop === blendedTop) {
    return { home: args.home, away: args.away, draw: args.draw };
  }

  if (args.draw !== undefined || args.nonMarketDraw !== undefined) {
    const values = {
      home: args.home,
      away: args.away,
      draw: args.draw ?? 0,
    };
    const nextBest = Math.max(
      originalTop === "home" ? 0 : values.home,
      originalTop === "away" ? 0 : values.away,
      originalTop === "draw" ? 0 : values.draw,
    );
    values[originalTop] = nextBest + 0.0001;
    const [home, draw, away] = normalizeThreeWay(values.home, values.draw, values.away);
    return { home, draw, away };
  }

  const homeShouldLead = originalTop === "home";
  if (homeShouldLead) {
    const home = Math.max(args.home, args.away + 0.0001);
    const [normHome, normAway] = normalizeTwoWay(home, args.away);
    return { home: normHome, away: normAway };
  }
  const away = Math.max(args.away, args.home + 0.0001);
  const [normHome, normAway] = normalizeTwoWay(args.home, away);
  return { home: normHome, away: normAway };
}

function blendModelProjectionAndMarket(args: {
  ctx: GameContext;
  factorHomeProb: number;
  factorAwayProb: number;
  factorDrawProb?: number;
  projectionHomeProb: number;
  projectionAwayProb: number;
  projectionDrawProb?: number;
  coverage: number;
}): { home: number; away: number; draw?: number; weights: CanonicalEngineWeights } {
  const {
    ctx,
    factorHomeProb,
    factorAwayProb,
    factorDrawProb,
    projectionHomeProb,
    projectionAwayProb,
    projectionDrawProb,
    coverage,
  } = args;
  const hasMarket = ctx.marketConsensus && Number.isFinite(ctx.marketConsensus.noVigHomeProb);
  const projectionWeight = clamp(0.08 + coverage * 0.06, 0.08, 0.14);
  const marketWeight = hasMarket ? clamp(0.06 + coverage * 0.04, 0.06, 0.10) : 0;
  const factorWeight = 1 - projectionWeight - marketWeight;
  const weights = {
    factor: factorWeight,
    projection: projectionWeight,
    market: marketWeight,
  };

  if (SOCCER_LEAGUES.has(ctx.sport)) {
    const marketDraw =
      hasMarket && ctx.marketConsensus!.noVigDrawProb !== undefined
        ? ctx.marketConsensus!.noVigDrawProb
        : factorDrawProb ?? projectionDrawProb ?? 0.25;
    const [marketHome, marketDrawNorm, marketAway] = hasMarket
      ? normalizeThreeWay(
          ctx.marketConsensus!.noVigHomeProb,
          marketDraw,
          ctx.marketConsensus!.noVigAwayProb,
        )
      : [0, 0, 0];

    const [nonMarketHome, nonMarketDraw, nonMarketAway] = normalizeThreeWay(
      factorHomeProb * factorWeight + projectionHomeProb * projectionWeight,
      (factorDrawProb ?? 0) * factorWeight +
        (projectionDrawProb ?? 0) * projectionWeight,
      factorAwayProb * factorWeight + projectionAwayProb * projectionWeight,
    );
    const [home, draw, away] = normalizeThreeWay(
      nonMarketHome * (1 - marketWeight) + marketHome * marketWeight,
      nonMarketDraw * (1 - marketWeight) + marketDrawNorm * marketWeight,
      nonMarketAway * (1 - marketWeight) + marketAway * marketWeight,
    );
    const preserved = preserveNonMarketOutcome({
      home,
      away,
      draw,
      nonMarketHome,
      nonMarketAway,
      nonMarketDraw,
    });
    return { ...preserved, weights };
  }

  const [marketHome, marketAway] = hasMarket
    ? normalizeTwoWay(ctx.marketConsensus!.noVigHomeProb, ctx.marketConsensus!.noVigAwayProb)
    : [0, 0];
  const [nonMarketHome, nonMarketAway] = normalizeTwoWay(
    factorHomeProb * factorWeight + projectionHomeProb * projectionWeight,
    factorAwayProb * factorWeight + projectionAwayProb * projectionWeight,
  );
  const [home, away] = normalizeTwoWay(
    nonMarketHome * (1 - marketWeight) + marketHome * marketWeight,
    nonMarketAway * (1 - marketWeight) + marketAway * marketWeight,
  );
  const preserved = preserveNonMarketOutcome({
    home,
    away,
    nonMarketHome,
    nonMarketAway,
  });
  return { ...preserved, weights };
}

function projectionScoreThreshold(sport: string): number {
  if (sport === "NBA" || sport === "NCAAB") return 0.5;
  if (sport === "NFL" || sport === "NCAAF") return 0.35;
  if (sport === "IPL") return 2.5;
  return 0.15;
}

function projectionProbabilityRead(
  projection: SimulationProjection,
  includeDraw: boolean,
): { side: ConsensusOutcome; edge: number } | null {
  const ranked = rankedOutcomes(
    projection.homeWinProbability,
    projection.awayWinProbability,
    includeDraw ? projection.drawProbability : undefined,
  );
  const top = ranked[0];
  const second = ranked[1];
  if (!top || !second) return null;

  const edge = top.value - second.value;
  if (edge < 0.015) return null;
  return { side: top.side, edge };
}

function projectionScoreRead(
  sport: string,
  projection: SimulationProjection,
  includeDraw: boolean,
): ConsensusOutcome | null {
  const scoreEdge = projection.projectedSpread;
  if (Math.abs(scoreEdge) < projectionScoreThreshold(sport)) {
    return includeDraw ? "draw" : null;
  }
  return scoreEdge > 0 ? "home" : "away";
}

function coherentProjectionOutcome(
  sport: string,
  projection: SimulationProjection,
  includeDraw: boolean,
): { side: ConsensusOutcome; edge: number } | null {
  const probabilityRead = projectionProbabilityRead(projection, includeDraw);
  const scoreSide = projectionScoreRead(sport, projection, includeDraw);
  if (!probabilityRead || !scoreSide || probabilityRead.side !== scoreSide) {
    return null;
  }
  return probabilityRead;
}

function promoteThreeWayOutcome(args: {
  home: number;
  away: number;
  draw: number;
  side: ConsensusOutcome;
  minEdge: number;
}): { home: number; away: number; draw: number } {
  const values = {
    home: args.home,
    away: args.away,
    draw: args.draw,
  };
  const nextBest = Math.max(
    args.side === "home" ? 0 : values.home,
    args.side === "away" ? 0 : values.away,
    args.side === "draw" ? 0 : values.draw,
  );
  values[args.side] = Math.max(values[args.side], nextBest + args.minEdge);
  const [home, draw, away] = normalizeThreeWay(values.home, values.draw, values.away);
  return { home, away, draw };
}

function reconcileWithProjection(args: {
  sport: string;
  home: number;
  away: number;
  draw?: number;
  projection: SimulationProjection;
  gameId: string;
}): { home: number; away: number; draw?: number } {
  const includeDraw = args.draw !== undefined;
  const projectionRead = coherentProjectionOutcome(args.sport, args.projection, includeDraw);
  if (!projectionRead) return { home: args.home, away: args.away, draw: args.draw };

  const blendedSide = topOutcome(args.home, args.away, args.draw);
  if (projectionRead.side === blendedSide) return { home: args.home, away: args.away, draw: args.draw };

  const reconciledEdge = clamp(projectionRead.edge, 0.002, includeDraw ? 0.12 : 0.18);
  let reconciled: { home: number; away: number; draw?: number };
  if (includeDraw) {
    reconciled = promoteThreeWayOutcome({
      home: args.home,
      away: args.away,
      draw: args.draw ?? 0,
      side: projectionRead.side,
      minEdge: reconciledEdge,
    });
  } else {
    const home = projectionRead.side === "home" ? 0.5 + reconciledEdge / 2 : 0.5 - reconciledEdge / 2;
    reconciled = { home, away: 1 - home };
  }

  console.warn(
    `[projection-consensus] ${args.gameId} ${args.sport}: blended=${blendedSide} ` +
    `but coherent projection=${projectionRead.side}; using projection-backed side ` +
    `(${Math.round(reconciled.home * 1000) / 10}-${Math.round(reconciled.away * 1000) / 10}` +
    `${reconciled.draw !== undefined ? `-${Math.round(reconciled.draw * 1000) / 10}` : ""})`,
  );

  return reconciled;
}

function scoreAlignedWithOutcome(
  sport: string,
  projection: SimulationProjection,
  outcome: ConsensusOutcome,
): boolean {
  if (outcome === "draw") {
    return Math.abs(projection.projectedSpread) < projectionScoreThreshold(sport);
  }
  return outcome === "home"
    ? projection.projectedSpread > 0
    : projection.projectedSpread < 0;
}

function alignProjectedScores(
  sport: string,
  projection: SimulationProjection,
  outcome: ConsensusOutcome,
): Pick<SimulationProjection, "projectedHomeScore" | "projectedAwayScore" | "projectedSpread" | "projectedTotal"> {
  if (scoreAlignedWithOutcome(sport, projection, outcome)) {
    return {
      projectedHomeScore: projection.projectedHomeScore,
      projectedAwayScore: projection.projectedAwayScore,
      projectedSpread: projection.projectedSpread,
      projectedTotal: projection.projectedTotal,
    };
  }

  const total = Math.max(0, projection.projectedHomeScore + projection.projectedAwayScore);
  if (outcome === "draw") {
    const tiedScore = roundTo(total / 2, 1);
    return {
      projectedHomeScore: tiedScore,
      projectedAwayScore: tiedScore,
      projectedSpread: 0,
      projectedTotal: roundTo(tiedScore * 2, 1),
    };
  }

  const side = outcome === "home" ? 1 : -1;
  const minimumSpread = Math.max(0.1, projectionScoreThreshold(sport));
  const spreadMagnitude = Math.max(Math.abs(projection.projectedSpread), minimumSpread);
  const targetSpread = side * spreadMagnitude;
  const projectedHomeScore = roundTo(Math.max(0, (total + targetSpread) / 2), 1);
  const projectedAwayScore = roundTo(Math.max(0, (total - targetSpread) / 2), 1);
  return {
    projectedHomeScore,
    projectedAwayScore,
    projectedSpread: roundTo(projectedHomeScore - projectedAwayScore, 1),
    projectedTotal: roundTo(projectedHomeScore + projectedAwayScore, 1),
  };
}

export function harmonizeProjectionWithConsensus(args: {
  sport: string;
  projection: SimulationProjection;
  homeWinProbability: number;
  awayWinProbability: number;
  drawProbability?: number;
}): SimulationProjection {
  const outcome = topOutcome(args.homeWinProbability, args.awayWinProbability, args.drawProbability);
  const scoreFields = alignProjectedScores(args.sport, args.projection, outcome);
  const alignedHomeProb = roundTo(args.homeWinProbability);
  const alignedAwayProb = roundTo(args.awayWinProbability);
  const alignedDrawProb = args.drawProbability !== undefined ? roundTo(args.drawProbability) : undefined;
  const probabilityChanged =
    Math.abs(args.projection.homeWinProbability - alignedHomeProb) > 0.0005 ||
    Math.abs(args.projection.awayWinProbability - alignedAwayProb) > 0.0005 ||
    (alignedDrawProb !== undefined &&
      Math.abs((args.projection.drawProbability ?? 0) - alignedDrawProb) > 0.0005);
  const scoreChanged =
    scoreFields.projectedHomeScore !== args.projection.projectedHomeScore ||
    scoreFields.projectedAwayScore !== args.projection.projectedAwayScore ||
    scoreFields.projectedSpread !== args.projection.projectedSpread;
  const signals = probabilityChanged || scoreChanged
    ? [
        {
          key: "engine-consensus",
          label: "Engine consensus",
          value: outcome === "home" ? 1 : outcome === "away" ? -1 : 0,
          evidence: "Prediction, projected score, and simulator probability were reconciled to one final outcome",
        },
        ...args.projection.signals.filter((signal) => signal.key !== "engine-consensus"),
      ].slice(0, 5)
    : args.projection.signals;

  return {
    ...args.projection,
    homeWinProbability: alignedHomeProb,
    awayWinProbability: alignedAwayProb,
    drawProbability: alignedDrawProb,
    ...scoreFields,
    signals,
  };
}

/**
 * Redistribute weight from unavailable factors proportionally to available ones.
 *
 * This is the honest way to handle missing data:
 * - Unavailable factors contribute 0 delta and their displayed weight drops
 *   to 0 (they don't count toward the visible factor breakdown).
 * - Their weight budget is redistributed so available factors don't get diluted.
 * - The total effective weight still sums to the original total.
 *
 * Example: if base rating_diff (weight 0.40) and rest (weight 0.05) are available
 * but form (weight 0.10) is not, then rating_diff gets 0.40 * (0.55/0.45) = 0.489
 * and rest gets 0.05 * (0.55/0.45) = 0.061.
 */
function redistributeWeights(factors: FactorContribution[]): FactorContribution[] {
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const availableWeight = factors
    .filter((f) => f.available)
    .reduce((sum, f) => sum + f.weight, 0);

  if (availableWeight === 0) {
    return factors; // All factors unavailable — nothing to redistribute onto.
  }

  const scale = totalWeight / availableWeight;

  return factors.map((f) => ({
    ...f,
    // Available factors absorb the unavailable budget proportionally.
    // Unavailable factors' displayed weight drops to 0 — their contribution
    // was already 0, and we don't want them inflating the visible total.
    weight: f.available ? f.weight * scale : 0,
  }));
}

/**
 * Normalize factor weights so they sum to exactly 1.0. Canonical source
 * weights can drift from 1.0 over time as factors are added/tuned; this
 * is the safety net that keeps the visible breakdown coherent.
 *
 * Returns the factors unchanged if they already sum within 0.001 of 1.0.
 */
export function normalizeWeightsToOne(factors: FactorContribution[]): FactorContribution[] {
  const sum = factors.reduce((acc, f) => acc + f.weight, 0);
  if (sum <= 0) return factors;
  if (Math.abs(1 - sum) <= 0.001) return factors;
  return factors.map((f) => ({ ...f, weight: f.weight / sum }));
}

/**
 * Pool weight from "no-signal" factors into the best available directional
 * anchor so a real edge isn't diluted by empty slots on light-data nights.
 *
 * A factor with hasSignal=false (no evidence pushing in either direction)
 * previously reserved its weight slice and contributed 0 to the weighted
 * Elo delta. That artificially muted the rating_diff signal: for a 200 Elo
 * favorite on a night with no injuries / no b2b / no net rating data, the
 * final probability landed near 60% instead of the 77% Elo itself implies.
 * Tennis exposed the mirror-image bug: many new players start at the same
 * neutral Elo, so pooling into a zero Elo delta drowned out ranking signal.
 *
 * The user-facing math (from the original FIX THE BLEND spec):
 *   final = effectiveEloWeight * eloProb + signaledWeight * factorAvg
 * In rating-delta space the equivalent is: give unsignaled factors' weight to
 * rating_diff when it has a real directional edge, otherwise to the strongest
 * available signaled factor, then aggregate contributions as usual.
 *
 * Non-directional signals with hasSignal=true (for example adverse tennis
 * weather that raises variance without favoring either player) keep their
 * weight as a zero-delta confidence drag instead of donating it to a side.
 *
 * Invariants:
 *   - available=false factors have already been zeroed by redistributeWeights
 *     before this runs — they won't double-count.
 *   - Total weight is preserved (we only move weight, never drop it).
 */
export function blendFactors(factors: FactorContribution[]): FactorContribution[] {
  const ratingIdx = factors.findIndex((f) => f.key === "rating_diff");

  const hasDirectionalSignal = (factor: FactorContribution): boolean =>
    factor.available && factor.hasSignal && Math.abs(factor.homeDelta) > 0.001;
  const retainsNonDirectionalWeight = (factor: FactorContribution): boolean =>
    factor.available && factor.hasSignal && factor.key === "tennis_conditions";

  let anchorIdx =
    ratingIdx >= 0 && hasDirectionalSignal(factors[ratingIdx]!)
      ? ratingIdx
      : -1;

  if (anchorIdx === -1) {
    let bestImpact = 0;
    factors.forEach((factor, index) => {
      if (!hasDirectionalSignal(factor)) return;
      const impact = Math.abs(factor.homeDelta * factor.weight);
      if (impact > bestImpact) {
        bestImpact = impact;
        anchorIdx = index;
      }
    });
  }

  if (anchorIdx === -1) {
    // No directional signal in this set — keep the factors intact so the
    // caller still gets a valid 50/50 output instead of accidental data loss.
    return factors;
  }

  let pooled = 0;
  const result = factors.map((f, i) => {
    if (i === anchorIdx) return { ...f };
    if (f.available && !hasDirectionalSignal(f) && !retainsNonDirectionalWeight(f) && f.weight > 0) {
      pooled += f.weight;
      return { ...f, weight: 0 };
    }
    return { ...f };
  });

  if (pooled > 0) {
    result[anchorIdx] = {
      ...result[anchorIdx]!,
      weight: result[anchorIdx]!.weight + pooled,
    };
  }

  return result;
}

/**
 * Generate an honest prediction for a single game.
 *
 * The narrative field is left empty ("") — it's filled by narrative.ts
 * in a separate step so this function stays pure and testable.
 */
export function predictGame(ctx: GameContext): HonestPrediction {
  // 1. Compute all factors
  const baseFactors = computeBaseFactors(ctx);
  const sportFactorFn = SPORT_FACTORS[ctx.sport];
  const sportFactors = sportFactorFn ? sportFactorFn(ctx) : [];
  const allFactors = [...baseFactors, ...sportFactors];
  const rawCoverage = dataCoverage(allFactors);

  // 2. Redistribute weight from unavailable factors (unavailable → 0,
  //    available factors scale up proportionally to fill the budget).
  const redistributedFactors = redistributeWeights(allFactors);

  // 2b. Safety-net normalization. If canonical source weights drift from
  //     1.0 (e.g. a sport file sums to 1.01 after a factor is added),
  //     divide through so the visible breakdown always sums to 1.0. We want
  //     visibility into drift, not silent correction — log before fixing.
  const preNormSum = redistributedFactors.reduce((acc, f) => acc + f.weight, 0);
  if (preNormSum > 0 && Math.abs(1 - preNormSum) > 0.01) {
    console.warn(
      `[engine] warning: ${ctx.sport} factor weights sum to ${preNormSum.toFixed(4)}, expected 1.0`,
    );
  }
  const normalizedFactors = normalizeWeightsToOne(redistributedFactors);

  // 2c. Pool weight from "no-signal" factors into rating_diff. Without this,
  //     a light-data night with a strong Elo edge compresses toward 50%.
  //     See blendFactors doc-comment for the full math.
  const adjustedFactors = blendFactors(normalizedFactors);

  // 3. Sum weighted deltas → total rating advantage for home
  // Each factor's contribution = homeDelta * weight (if available)
  // The sum is in "Elo rating points in favor of home"
  let totalRatingDelta = 0;
  for (const factor of adjustedFactors) {
    if (factor.available) {
      totalRatingDelta += factor.homeDelta * factor.weight;
    }
  }

  const weakSportCalibration = applyWeakSportCalibration(ctx, totalRatingDelta, adjustedFactors, rawCoverage);
  totalRatingDelta = weakSportCalibration.ratingDelta;

  // 4. Convert to probability using the standard Elo logistic, then blend in
  //    a game-script projection. The factor model still owns the largest vote;
  //    the simulator adds distribution awareness and market data acts as a
  //    modest calibration anchor when available.
  const rawHomeWinProb = ratingDeltaToHomeWinProb(totalRatingDelta);

  // 5. Handle soccer draw probability
  let homeWinProb: number;
  let awayWinProb: number;
  let drawProb: number | undefined;

  let factorHomeWinProb: number;
  let factorAwayWinProb: number;
  let factorDrawProb: number | undefined;

  if (SOCCER_LEAGUES.has(ctx.sport)) {
    const [adjHome, draw, adjAway] = applySoccerDrawAdjustment(rawHomeWinProb, ctx.sport);
    factorHomeWinProb = adjHome;
    factorAwayWinProb = adjAway;
    factorDrawProb = draw;
  } else {
    factorHomeWinProb = rawHomeWinProb;
    factorAwayWinProb = 1 - rawHomeWinProb;
  }

  const rawProjection = simulateGameProjection(ctx, totalRatingDelta, adjustedFactors);

  const blended = blendModelProjectionAndMarket({
    ctx,
    factorHomeProb: factorHomeWinProb,
    factorAwayProb: factorAwayWinProb,
    factorDrawProb,
    projectionHomeProb: rawProjection.homeWinProbability,
    projectionAwayProb: rawProjection.awayWinProbability,
    projectionDrawProb: rawProjection.drawProbability,
    coverage: rawCoverage,
  });

  const reconciled = reconcileWithProjection({
    sport: ctx.sport,
    home: blended.home,
    away: blended.away,
    draw: blended.draw,
    projection: rawProjection,
    gameId: ctx.game.id,
  });
  homeWinProb = reconciled.home;
  awayWinProb = reconciled.away;
  drawProb = reconciled.draw;

  // 6. Determine winner and confidence
  // For soccer: max of home/draw/away. For others: max of home/away.
  // Confidence = max probability * 100, rounded to 1 decimal. No manipulation.
  const maxProb = Math.max(homeWinProb, awayWinProb, drawProb ?? 0);
  const confidence = Math.round(maxProb * 1000) / 10; // 1 decimal place

  // Determine predicted winner based on highest probability
  let predictedWinner: { teamId: string; abbr: string } | null = null;

  if (drawProb !== undefined && drawProb >= homeWinProb && drawProb >= awayWinProb) {
    // Soccer: draw is the most likely outcome → predictedWinner = null (draw)
    predictedWinner = null;
  } else {
    // If exactly 50/50 (or within floating-point epsilon), it's a true pick'em
    const isPickem = Math.abs(homeWinProb - awayWinProb) < 0.001;
    if (!isPickem) {
      const isHome = homeWinProb > awayWinProb;
      predictedWinner = {
        teamId: isHome ? ctx.game.homeTeam.id : ctx.game.awayTeam.id,
        abbr: isHome ? ctx.game.homeTeam.abbreviation : ctx.game.awayTeam.abbreviation,
      };
    }
  }

  const projection = harmonizeProjectionWithConsensus({
    sport: ctx.sport,
    projection: rawProjection,
    homeWinProbability: homeWinProb,
    awayWinProbability: awayWinProb,
    drawProbability: drawProb,
  });

  // 7. Collect unavailable factors for display
  const unavailableFactors = adjustedFactors
    .filter((f) => !f.available)
    .map((f) => f.evidence);

  // 8. Build data sources list
  const dataSources = ["ESPN scoreboard v2", "ESPN team stats", "internal Elo", "game-script simulation"];
  if (ctx.sport === "MLB" && (ctx.homeLineup?.startingPitcher || ctx.awayLineup?.startingPitcher)) {
    dataSources.push("MLB StatsAPI (probable pitchers)");
  }
  if (ctx.weather && !ctx.weather.isDomed) {
    dataSources.push("Open-Meteo weather");
  }
  if (ctx.marketConsensus) {
    dataSources.push("SharpAPI market consensus");
  }

  // 9. Market comparison after the blend. Market consensus already had a
  //    small calibration vote above; this block reports the remaining gap
  //    between the final model probability and Pinnacle's de-vigged number.
  let marketComparison: HonestPrediction["marketComparison"];
  const market = ctx.marketConsensus ?? null;
  if (market && Number.isFinite(market.noVigHomeProb)) {
    const divergence = Math.abs(homeWinProb - market.noVigHomeProb);
    const isDivergent = divergence > 0.10;
    if (isDivergent) {
      console.warn(
        `[divergence] ${ctx.sport} ${ctx.game.homeTeam.abbreviation} vs ${ctx.game.awayTeam.abbreviation}: ` +
          `model=${(homeWinProb * 100).toFixed(1)}%, market=${(market.noVigHomeProb * 100).toFixed(1)}%, ` +
          `delta=${(divergence * 100).toFixed(1)}%`,
      );
    }
    marketComparison = {
      modelHomeProb: homeWinProb,
      marketHomeProb: market.noVigHomeProb,
      divergence,
      isDivergent,
    };
  }

  // ─── Runtime invariant checks (log-only, never crash) ──────────────
  const expectedConfidence = Math.round(maxProb * 1000) / 10;
  if (Math.abs(confidence - expectedConfidence) > 0.1) {
    console.error(
      `[prediction-invariant] Confidence mismatch for ${ctx.game.id} ${ctx.sport}: ` +
      `computed=${confidence} expected=${expectedConfidence} home=${homeWinProb} away=${awayWinProb} draw=${drawProb}`,
    );
  }
  if (predictedWinner) {
    const winnerSide = predictedWinner.teamId === ctx.game.homeTeam.id ? "home" : "away";
    if (winnerSide === "home" && homeWinProb < Math.max(awayWinProb, drawProb ?? 0)) {
      console.error(
        `[prediction-invariant] predictedWinner=home but home is not max prob for ${ctx.game.id} ${ctx.sport}`,
      );
    }
    if (winnerSide === "away" && awayWinProb < Math.max(homeWinProb, drawProb ?? 0)) {
      console.error(
        `[prediction-invariant] predictedWinner=away but away is not max prob for ${ctx.game.id} ${ctx.sport}`,
      );
    }
  }
  const finalOutcome = topOutcome(homeWinProb, awayWinProb, drawProb);
  const projectionOutcome = topOutcome(
    projection.homeWinProbability,
    projection.awayWinProbability,
    projection.drawProbability,
  );
  if (finalOutcome !== projectionOutcome) {
    console.error(
      `[prediction-invariant] projection outcome ${projectionOutcome} does not match final outcome ` +
      `${finalOutcome} for ${ctx.game.id} ${ctx.sport}`,
    );
  }

  const generatedAt = new Date().toISOString();
  const marketProbabilities =
    market && Number.isFinite(market.noVigHomeProb)
      ? normalizeCanonicalProbabilities({
          home: market.noVigHomeProb,
          away: market.noVigAwayProb,
          draw: drawProb !== undefined ? market.noVigDrawProb : undefined,
        })
      : undefined;
  const canonicalResult = buildCanonicalPredictionResult({
    ctx,
    factors: adjustedFactors,
    factorProbabilities: normalizeCanonicalProbabilities({
      home: factorHomeWinProb,
      away: factorAwayWinProb,
      draw: factorDrawProb,
    }),
    projection,
    rawProjection,
    finalProbabilities: normalizeCanonicalProbabilities({
      home: homeWinProb,
      away: awayWinProb,
      draw: drawProb,
    }),
    confidence,
    generatedAt,
    modelVersion: MODEL_VERSION,
    blendedProbabilities: normalizeCanonicalProbabilities({
      home: blended.home,
      away: blended.away,
      draw: blended.draw,
    }),
    marketProbabilities,
    engineWeights: blended.weights,
    extraWarnings: weakSportCalibration.warnings,
  });
  traceCanonicalDecision({
    ctx,
    canonicalResult,
    factorProbabilities: canonicalResult.engineBreakdown.find((read) => read.engine === "factor-model-v1")?.probabilities ?? canonicalResult.probabilities,
    rawProjection,
  });

  return {
    gameId: ctx.game.id,
    league: ctx.sport,
    canonicalResult,
    predictedWinner,
    homeWinProbability: homeWinProb,
    awayWinProbability: awayWinProb,
    drawProbability: drawProb,
    confidence,
    confidenceBand: getConfidenceBand(maxProb),
    factors: adjustedFactors,
    projection,
    unavailableFactors,
    narrative: "", // Filled by narrative.ts in a separate step
    modelVersion: MODEL_VERSION,
    generatedAt,
    dataSources,
    marketComparison,
  };
}

// ─── Re-exports for convenience ─────────────────────────────────────────

export type { GameContext, FactorContribution, HonestPrediction, LeagueKey } from "./types";
export { ratingDeltaToHomeWinProb } from "./probability";
