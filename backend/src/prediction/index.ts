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
 *   5. Converts to probability via the Elo logistic (once, here)
 *   6. Returns the prediction with all factors, confidence, and band
 *
 * GROUND RULES (Section 0):
 * - No confidence floor above 50%
 * - No confidence ceiling below 100%
 * - No sigmoid scaling multipliers
 * - No probability clamps beyond [0, 1]
 * - No fabricated data
 */

import type { GameContext, FactorContribution, HonestPrediction, LeagueKey } from "./types";
import { getConfidenceBand } from "./types";
import { ratingDeltaToHomeWinProb, applySoccerDrawAdjustment } from "./probability";
import { computeBaseFactors } from "./factors/base";
import { computeNFLFactors } from "./factors/nfl";
import { computeNBAFactors } from "./factors/nba";
import { computeMLBFactors } from "./factors/mlb";
import { computeNHLFactors } from "./factors/nhl";
import { computeMLSFactors } from "./factors/mls";
import { computeEPLFactors } from "./factors/epl";
import { computeUCLFactors } from "./factors/ucl";
import { computeNCAAFBFactors } from "./factors/ncaafb";
import { computeNCAAMBFactors } from "./factors/ncaamb";

const MODEL_VERSION = "2.0.0-honest";

// ─── Sport → factor function map ────────────────────────────────────────

const SPORT_FACTORS: Record<string, (ctx: GameContext) => FactorContribution[]> = {
  NFL: computeNFLFactors,
  NBA: computeNBAFactors,
  MLB: computeMLBFactors,
  NHL: computeNHLFactors,
  MLS: computeMLSFactors,
  EPL: computeEPLFactors,
  UCL: computeUCLFactors,
  NCAAF: computeNCAAFBFactors,
  NCAAB: computeNCAAMBFactors,
};

const SOCCER_LEAGUES = new Set(["MLS", "EPL", "UCL"]);

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
 * Pool weight from "no-signal" factors into the Elo rating_diff factor so a
 * strong Elo edge isn't diluted by empty slots on light-data nights.
 *
 * A factor with hasSignal=false (no evidence pushing in either direction)
 * previously reserved its weight slice and contributed 0 to the weighted
 * Elo delta. That artificially muted the rating_diff signal: for a 200 Elo
 * favorite on a night with no injuries / no b2b / no net rating data, the
 * final probability landed near 60% instead of the 77% Elo itself implies.
 *
 * The user-facing math (from the FIX THE BLEND spec):
 *   final = effectiveEloWeight * eloProb + signaledWeight * factorAvg
 * In Elo-delta space the equivalent is: give unsignaled factors' weight to
 * rating_diff, then aggregate Elo-delta contributions as usual.
 *
 * Invariants:
 *   - rating_diff (Elo) always hasSignal=true, so it never gets pooled away.
 *   - available=false factors have already been zeroed by redistributeWeights
 *     before this runs — they won't double-count.
 *   - Total weight is preserved (we only move weight, never drop it).
 */
export function blendFactors(factors: FactorContribution[]): FactorContribution[] {
  const ratingIdx = factors.findIndex((f) => f.key === "rating_diff");
  if (ratingIdx === -1) {
    // No Elo factor in this set — nowhere to pool. Return unchanged so the
    // caller still gets a valid array (prevents accidental data loss).
    return factors;
  }

  let pooled = 0;
  const result = factors.map((f, i) => {
    if (i === ratingIdx) return { ...f };
    if (f.available && !f.hasSignal && f.weight > 0) {
      pooled += f.weight;
      return { ...f, weight: 0 };
    }
    return { ...f };
  });

  if (pooled > 0) {
    result[ratingIdx] = {
      ...result[ratingIdx]!,
      weight: result[ratingIdx]!.weight + pooled,
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

  // 4. Convert to probability — ONCE, using the standard Elo logistic
  const rawHomeWinProb = ratingDeltaToHomeWinProb(totalRatingDelta);

  // 5. Handle soccer draw probability
  let homeWinProb: number;
  let awayWinProb: number;
  let drawProb: number | undefined;

  if (SOCCER_LEAGUES.has(ctx.sport)) {
    const [adjHome, draw, adjAway] = applySoccerDrawAdjustment(rawHomeWinProb, ctx.sport);
    homeWinProb = adjHome;
    awayWinProb = adjAway;
    drawProb = draw;
  } else {
    homeWinProb = rawHomeWinProb;
    awayWinProb = 1 - rawHomeWinProb;
  }

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

  // 7. Collect unavailable factors for display
  const unavailableFactors = adjustedFactors
    .filter((f) => !f.available)
    .map((f) => f.evidence);

  // 8. Build data sources list
  const dataSources = ["ESPN scoreboard v2", "ESPN team stats", "internal Elo"];
  if (ctx.sport === "MLB" && (ctx.homeLineup?.startingPitcher || ctx.awayLineup?.startingPitcher)) {
    dataSources.push("MLB StatsAPI (probable pitchers)");
  }
  if (ctx.weather && !ctx.weather.isDomed) {
    dataSources.push("Open-Meteo weather");
  }
  if (ctx.marketConsensus) {
    dataSources.push("SharpAPI market consensus");
  }

  // 9. Post-hoc market comparison (NOT a prediction input).
  //    We compare the model's home-win probability to Pinnacle's de-vigged
  //    number and flag divergences > 10 percentage points. The prediction
  //    itself already decided above; this block just annotates it.
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

  return {
    gameId: ctx.game.id,
    league: ctx.sport,
    predictedWinner,
    homeWinProbability: homeWinProb,
    awayWinProbability: awayWinProb,
    drawProbability: drawProb,
    confidence,
    confidenceBand: getConfidenceBand(maxProb),
    factors: adjustedFactors,
    unavailableFactors,
    narrative: "", // Filled by narrative.ts in a separate step
    modelVersion: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    dataSources,
    marketComparison,
  };
}

// ─── Re-exports for convenience ─────────────────────────────────────────

export type { GameContext, FactorContribution, HonestPrediction, LeagueKey } from "./types";
export { ratingDeltaToHomeWinProb } from "./probability";
