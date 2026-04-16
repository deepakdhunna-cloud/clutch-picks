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
 * - Unavailable factors contribute 0 delta
 * - Their weight budget is redistributed so available factors don't get diluted
 * - The total effective weight still sums to the original total
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

  if (availableWeight === 0 || availableWeight === totalWeight) {
    return factors; // Nothing to redistribute (or all unavailable)
  }

  const scale = totalWeight / availableWeight;

  return factors.map((f) => ({
    ...f,
    // Available factors get scaled up; unavailable stay at their original weight
    // (for display) but their delta is already 0
    weight: f.available ? f.weight * scale : f.weight,
  }));
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

  // 2. Redistribute weight from unavailable factors
  const adjustedFactors = redistributeWeights(allFactors);

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
  // Confidence = max(home, away) * 100, rounded to 1 decimal. No manipulation.
  const winnerProb = Math.max(homeWinProb, awayWinProb);
  const confidence = Math.round(winnerProb * 1000) / 10; // 1 decimal place

  // If exactly 50/50 (or within floating-point epsilon), it's a true pick'em
  const isPickem = Math.abs(homeWinProb - awayWinProb) < 0.001;

  let predictedWinner: { teamId: string; abbr: string } | null = null;
  if (!isPickem) {
    const isHome = homeWinProb > awayWinProb;
    predictedWinner = {
      teamId: isHome ? ctx.game.homeTeam.id : ctx.game.awayTeam.id,
      abbr: isHome ? ctx.game.homeTeam.abbreviation : ctx.game.awayTeam.abbreviation,
    };
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
  if (ctx.homeXG || ctx.awayXG) {
    dataSources.push("Understat xG");
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

  return {
    gameId: ctx.game.id,
    league: ctx.sport,
    predictedWinner,
    homeWinProbability: homeWinProb,
    awayWinProbability: awayWinProb,
    drawProbability: drawProb,
    confidence,
    confidenceBand: getConfidenceBand(winnerProb),
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
