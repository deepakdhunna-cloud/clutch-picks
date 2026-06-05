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
 *   6. Blends factor, game-script simulation, and small market calibration reads
 *   7. Reconciles public projection to the final pick while preserving raw
 *      simulator disagreement in canonical engineBreakdown
 *   8. Returns the prediction with all factors, projection, confidence, and band
 *
 * GROUND RULES (Section 0):
 * - No confidence floor above 50%
 * - No confidence ceiling below 100%
 * - No sigmoid scaling multipliers
 * - No probability clamps beyond [0, 1]
 * - No fabricated data
 * - Market can calibrate probability, but never overrides the model vote
 * - Displayed odds metadata must be part of the engine context or marked absent
 */

import type { GameContext, FactorContribution, HonestPrediction, LeagueKey, SimulationProjection, CanonicalEngineWeights } from "./types";
import { getConfidenceBand } from "./types";
import { ratingDeltaToHomeWinProb, applySoccerDrawAdjustment } from "./probability";
import { isFullScaleRatingEnabled } from "./flags";
import { simulateGameProjection } from "./simulation";
import { getSportSimulationProfile } from "./simulators/profiles";
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

export const MODEL_VERSION = "3.0.0-unified-simulation-engine";

// ─── Sport → factor function map ────────────────────────────────────────

const SPORT_FACTORS: Record<string, (ctx: GameContext) => FactorContribution[]> = {
  NFL: computeNFLFactors,
  NBA: computeNBAFactors,
  MLB: computeMLBFactors,
  NHL: computeNHLFactors,
  MLS: (ctx) => computeMLSFactors(ctx, ctx.homeXg, ctx.awayXg),
  EPL: (ctx) => computeEPLFactors(ctx, ctx.homeXg, ctx.awayXg),
  UCL: (ctx) => computeUCLFactors(ctx, ctx.homeXg, ctx.awayXg),
  IPL: computeIPLFactors,
  TENNIS: (ctx) => computeTennisFactors(ctx, ctx.surfaceAdjustment),
  NCAAF: computeNCAAFBFactors,
  NCAAB: computeNCAAMBFactors,
};

const SOCCER_LEAGUES = new Set(["MLS", "EPL", "UCL"]);
// Sports whose projected scores stay as ONE decimal (the real expected value):
// runs/goals are small, so the projected margin is often sub-1 and rounding to a
// whole number would either collapse the lean to a tie or distort the total.
const LOW_SCORING_SPORTS = new Set(["MLB", "NHL", "MLS", "EPL", "UCL"]);

type ConsensusOutcome = "home" | "away" | "draw";
type ProjectionOutcome = ConsensusOutcome | "none";

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
    const formAvailable = ctx.homeForm.results.length >= 5 && ctx.awayForm.results.length >= 5;

    // Only compress significantly when BOTH starter AND form are missing.
    // If we have solid form data, the Elo + form signal is still valuable.
    if (!starter?.available) {
      multiplier *= formAvailable ? 0.88 : 0.72;
      warnings.push("MLB starter matchup missing; confidence compressed toward pick'em.");
    } else if (Math.abs(starter.homeDelta) < 18) {
      multiplier *= 0.92;
      warnings.push("MLB starter matchup is close; avoiding a team-stats overclaim.");
    }

    if (!positionInjuries?.available) {
      multiplier *= formAvailable ? 0.97 : 0.94;
    }
    if (!ctx.marketConsensus) {
      multiplier *= 0.96;
    }
    if (coverage < 0.78 && !formAvailable) {
      multiplier *= 0.92;
      warnings.push("MLB data coverage is thin; confidence compressed.");
    }

    multiplier = Math.max(0.72, multiplier);
  } else if (ctx.sport === "TENNIS") {
    const ranking = factorByKey(factors, "tennis_ranking_edge");
    const form = factorByKey(factors, "tennis_recent_form");
    const hasRankingSignal = Boolean(ranking?.available && ranking.hasSignal);

    // Tennis has no true home field and ESPN often lacks enough player-level
    // context. Rankings remain the best public pre-match anchor, so a clear
    // rank edge should not be crushed back into the toss-up band just because
    // recent-form or market feeds are missing.
    multiplier *= hasRankingSignal ? 0.88 : 0.78;
    if (!hasRankingSignal) {
      multiplier *= 0.60;
      warnings.push("Tennis ranking signal missing or neutral; confidence compressed.");
    }
    if (!form?.available) {
      multiplier *= hasRankingSignal ? 0.96 : 0.86;
    }
    if (!ctx.marketConsensus) {
      multiplier *= hasRankingSignal ? 0.98 : 0.92;
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

function topOutcome(home: number, away: number, draw?: number): ConsensusOutcome {
  if (draw !== undefined && draw >= home && draw >= away) return "draw";
  return home >= away ? "home" : "away";
}

function finalOutcomeFromProbabilities(
  home: number,
  away: number,
  draw?: number,
): ProjectionOutcome {
  if (draw !== undefined && draw >= home && draw >= away) return "draw";
  // Only return "none" for true dead-heat (< 0.1pp difference = 50.0% vs 50.0%)
  if (draw === undefined && Math.abs(home - away) < 0.005) return "none";
  return home >= away ? "home" : "away";
}

function roundTo(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function meaningfulProjectionSpreadThreshold(sport: string): number {
  if (sport === "NBA" || sport === "NCAAB") return 0.6;
  if (sport === "NFL" || sport === "NCAAF") return 0.45;
  if (sport === "IPL") return 3;
  if (sport === "MLB" || sport === "NHL" || SOCCER_LEAGUES.has(sport)) return 0.12;
  if (sport === "TENNIS") return 0.8;
  return 0.25;
}

function projectionMinimumScore(sport: string): number {
  if (sport === "NBA") return 75;
  if (sport === "NCAAB") return 45;
  if (sport === "IPL") return 80;
  if (sport === "TENNIS") return 6;
  return 0;
}

/**
 * Inverse of the standard normal CDF (probit): returns z such that Φ(z) = p.
 * Acklam's rational approximation, accurate to ~1.15e-9 over (0,1). Pure math,
 * no dependency. This is the inverse of the normalCdf the simulator samples
 * against, so it lets us recover the margin a given win probability implies.
 */
function inverseNormalCdf(p: number): number {
  // Coefficients for Acklam's rational approximation.
  const a0 = -3.969683028665376e1, a1 = 2.209460984245205e2, a2 = -2.759285104469687e2,
    a3 = 1.38357751867269e2, a4 = -3.066479806614716e1, a5 = 2.506628277459239e0;
  const b0 = -5.447609879822406e1, b1 = 1.615858368580409e2, b2 = -1.556989798598866e2,
    b3 = 6.680131188771972e1, b4 = -1.328068155288572e1;
  const c0 = -7.784894002430293e-3, c1 = -3.223964580411365e-1, c2 = -2.400758277161838e0,
    c3 = -2.549732539343734e0, c4 = 4.374664141464968e0, c5 = 2.938163982698783e0;
  const d0 = 7.784695709041462e-3, d1 = 3.224671290700398e-1, d2 = 2.445134137142996e0,
    d3 = 3.754408661907416e0;
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  const x = clamp(p, 1e-9, 1 - 1e-9);
  if (x < pLow) {
    const q = Math.sqrt(-2 * Math.log(x));
    return (
      (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
      ((((d0 * q + d1) * q + d2) * q + d3) * q + 1)
    );
  }
  if (x <= pHigh) {
    const q = x - 0.5;
    const r = q * q;
    return (
      ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) /
      (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - x));
  return -(
    (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
    ((((d0 * q + d1) * q + d2) * q + d3) * q + 1)
  );
}

/**
 * The projected MARGIN a displayed win probability implies, so the public score
 * line and the public confidence always tell the same story. Under the
 * simulator's Gaussian margin model, P(favorite wins) = Φ(margin / sd), so the
 * margin a probability `p` implies is Φ⁻¹(p) · sd. We anchor on the sport's
 * calibrated BASELINE margin SD (the documented spread↔probability relationship)
 * rather than a single game's realized volatility, which keeps the mapping
 * stable, monotonic, and immune to a pathologically low per-game variance that
 * would shrink a confident pick back toward a near-tie. Clamped to the sport's
 * meaningful-margin floor and to a value the total can physically hold.
 *
 * Soccer (3-way) note: the home-vs-away GOAL margin is orthogonal to the draw,
 * so we condition on the two SIDES only — p_pick / (p_pick + p_opponent) — which
 * is >0.5 whenever the pick genuinely leads its opponent. Feeding the raw 3-way
 * win probability (often <50% because the draw absorbs 20-30%) would collapse
 * every sub-50% pick to the same floor line. For 2-outcome sports the opponent
 * probability is 1-p_pick, so the conditional equals the win probability exactly.
 */
function displayMarginSd(sport: string, baselineMarginSd: number): number {
  // IPL run-margin SD (36) is realistic for the SIMULATION but, mapped through
  // the confidence→margin curve, prints implausible 30-46 run blowouts at high
  // confidence. Cap the DISPLAY SD only — the simulation/model is untouched, so
  // win probabilities and calibration do not change.
  if (sport === "IPL") return Math.min(baselineMarginSd, 18);
  return baselineMarginSd;
}

function impliedMarginForProbability(
  sport: string,
  finalProbabilities: { home: number; away: number; draw?: number },
  finalPick: ProjectionOutcome,
  total: number,
): number {
  const baseline = getSportSimulationProfile(sport).baseline;
  const marginSd = displayMarginSd(sport, baseline.marginSd);
  const threshold = meaningfulProjectionSpreadThreshold(sport);
  const minScore = projectionMinimumScore(sport);
  // Reserve a small loser floor on low-scoring sports (minScore is 0 there) so an
  // extreme-confidence pick projects e.g. 3.5-0.5 rather than a literal 4.0-0.0
  // shutout pinned to the total floor — the loser almost always scores something.
  const loserFloor = LOW_SCORING_SPORTS.has(sport) ? Math.max(minScore, 0.5) : minScore;
  const maxMargin = Math.max(threshold, total - loserFloor * 2);
  // Head-to-head favorite probability (see soccer note above).
  let pPick = 0.5;
  let pOther = 0.5;
  if (finalPick === "home") {
    pPick = finalProbabilities.home;
    pOther = finalProbabilities.away;
  } else if (finalPick === "away") {
    pPick = finalProbabilities.away;
    pOther = finalProbabilities.home;
  }
  const denom = pPick + pOther;
  const conditional = denom > 0 ? pPick / denom : 0.5;
  const p = clamp(Number.isFinite(conditional) ? conditional : 0.5, 0.5, 0.999);
  const z = inverseNormalCdf(p); // >= 0 for p >= 0.5
  return roundTo(clamp(z * marginSd, threshold, maxMargin), 2);
}

function projectedScoreOutcome(
  sport: string,
  homeScore: number,
  awayScore: number,
): ProjectionOutcome {
  const margin = homeScore - awayScore;
  if (Math.abs(margin) < meaningfulProjectionSpreadThreshold(sport)) {
    return SOCCER_LEAGUES.has(sport) ? "draw" : "none";
  }
  return margin > 0 ? "home" : "away";
}

function scoresForTargetSpread(args: {
  sport: string;
  total: number;
  spread: number;
}): { home: number; away: number } {
  const minScore = projectionMinimumScore(args.sport);
  let home = (args.total + args.spread) / 2;
  let away = (args.total - args.spread) / 2;

  if (home < minScore) {
    away += minScore - home;
    home = minScore;
  }
  if (away < minScore) {
    home += minScore - away;
    away = minScore;
  }

  return {
    home: roundTo(home, 1),
    away: roundTo(away, 1),
  };
}

function tennisProjectionDominance(selectedProbability?: number): number {
  const probability =
    typeof selectedProbability === "number" && Number.isFinite(selectedProbability)
      ? clamp(selectedProbability > 1 ? selectedProbability / 100 : selectedProbability, 0, 1)
      : 0.55;
  return clamp((probability - 0.5) * 4, 0, 1.4);
}

function tennisGameMarginForProbability(selectedProbability?: number, total?: number): number {
  const dominance = tennisProjectionDominance(selectedProbability);
  const maxMargin =
    typeof total === "number" && Number.isFinite(total)
      ? Math.max(1.2, total - 12)
      : 7.5;
  return roundTo(clamp(1.6 + dominance * 4.8, 1.2, Math.min(7.5, maxMargin)), 1);
}

function tennisGameLineForPick(
  finalPick: "home" | "away",
  selectedProbability?: number,
  currentTotal?: number,
): { home: number; away: number; spread: number; total: number } {
  const dominance = tennisProjectionDominance(selectedProbability);
  const hasUsableTotal =
    typeof currentTotal === "number" &&
    Number.isFinite(currentTotal) &&
    currentTotal >= 16 &&
    currentTotal <= 40;
  const total = roundTo(
    hasUsableTotal
      ? clamp(currentTotal, 16, 40)
      : clamp(26.5 - dominance * 4.5, 18.5, 30.5),
    1,
  );
  const margin = tennisGameMarginForProbability(selectedProbability, total);
  const spread = finalPick === "home" ? margin : -margin;
  const home = roundTo((total + spread) / 2, 1);
  const away = roundTo((total - spread) / 2, 1);

  return {
    home,
    away,
    spread: roundTo(home - away, 1),
    total: roundTo(home + away, 1),
  };
}

function isPlausibleTennisGameLine(home: number, away: number): boolean {
  if (!Number.isFinite(home) || !Number.isFinite(away)) return false;
  const total = home + away;
  return total >= 16 && total <= 40 && home >= 5 && away >= 5;
}

function probabilityForFinalPick(
  probabilities: { home: number; away: number; draw?: number },
  pick: ProjectionOutcome,
): number | undefined {
  if (pick === "home") return probabilities.home;
  if (pick === "away") return probabilities.away;
  if (pick === "draw") return probabilities.draw;
  return undefined;
}

function reconciledScoreLineForPick(args: {
  sport: string;
  total: number;
  finalPick: Exclude<ProjectionOutcome, "none">;
  selectedProbability?: number;
  targetMargin?: number;
}): { home: number; away: number; spread: number; total: number } {
  if (args.sport === "TENNIS" && (args.finalPick === "home" || args.finalPick === "away")) {
    return tennisGameLineForPick(args.finalPick, args.selectedProbability, args.total);
  }

  if (args.finalPick === "draw") {
    const scores = scoresForTargetSpread({
      sport: args.sport,
      total: args.total,
      spread: 0,
    });
    return {
      home: scores.home,
      away: scores.away,
      spread: roundTo(scores.home - scores.away, 1),
      total: roundTo(scores.home + scores.away, 1),
    };
  }

  const direction = args.finalPick === "home" ? 1 : -1;
  const threshold = meaningfulProjectionSpreadThreshold(args.sport);
  // Start from the margin the win probability implies (so the line matches the
  // confidence), never below the meaningful-margin floor. The loop below only
  // nudges UP if rounding to one decimal would collapse the winner.
  let targetMagnitude = Math.max(threshold, args.targetMargin ?? threshold);
  let fallback: { home: number; away: number; spread: number; total: number } | null = null;

  // Public score projections are displayed to one decimal. Small raw spreads
  // can round back into a tie, so verify the displayed line before returning it.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const scores = scoresForTargetSpread({
      sport: args.sport,
      total: args.total,
      spread: direction * targetMagnitude,
    });
    const line = {
      home: scores.home,
      away: scores.away,
      spread: roundTo(scores.home - scores.away, 1),
      total: roundTo(scores.home + scores.away, 1),
    };

    fallback = line;
    if (projectedScoreOutcome(args.sport, line.home, line.away) === args.finalPick) {
      return line;
    }

    targetMagnitude = roundTo(targetMagnitude + 0.1, 2);
  }

  return fallback ?? {
    home: args.total / 2,
    away: args.total / 2,
    spread: 0,
    total: args.total,
  };
}

/**
 * Quantize the projected score line for display truthfulness + consistency:
 * integer-scored sports (everything except tennis) show WHOLE numbers — a team
 * cannot score 4.5 runs — and the winner of the score line always matches the
 * final pick. When rounding the expected means would collapse a real sub-unit
 * lean into a tie (common in low-scoring MLB/NHL/soccer), the favorite is nudged
 * +1 so the line never contradicts the pick. Spread/total are derived from the
 * rounded scores so the three numbers always reconcile. Tennis keeps one decimal
 * (expected games) everywhere.
 */
function quantizeProjectedScoreLine(
  sport: string,
  home: number,
  away: number,
  finalPick: ProjectionOutcome,
): { home: number; away: number; spread: number; total: number } {
  if (sport === "TENNIS") {
    const h = roundTo(home, 1);
    const a = roundTo(away, 1);
    return { home: h, away: a, spread: roundTo(h - a, 1), total: roundTo(h + a, 1) };
  }
  // Low-scoring sports keep ONE decimal. The reconciliation step above already
  // sized the margin to match the confidence, so the scores should already show
  // the picked side leading. Just round to display precision.
  if (LOW_SCORING_SPORTS.has(sport)) {
    if (finalPick === "draw") {
      const each = roundTo((home + away) / 2, 1);
      return { home: each, away: each, spread: 0, total: roundTo(each * 2, 1) };
    }
    const h = roundTo(home, 1);
    const a = roundTo(away, 1);
    return { home: h, away: a, spread: roundTo(h - a, 1), total: roundTo(h + a, 1) };
  }
  // High-scoring / discrete sports (NBA/NCAAB/NFL/NCAAF/IPL): whole numbers.
  // The MARGIN carries the confidence, so we preserve the rounded margin EXACTLY
  // and absorb any integer-parity mismatch into the TOTAL (a +/-1 shift on a
  // 100+/300+ total is negligible). This keeps the displayed spread equal to the
  // implied margin for every game — strictly monotonic in confidence, with no
  // parity stairstep where one game's total silently bumps the margin by 1.
  const baseTotal = Math.round(home + away);
  if (finalPick === "draw") {
    const each = Math.round(baseTotal / 2);
    return { home: each, away: each, spread: 0, total: each * 2 };
  }
  let margin = Math.round(Math.abs(home - away));
  if ((finalPick === "home" || finalPick === "away") && margin < 1) margin = 1; // favorite must lead the line
  // total and margin must share parity for integer team scores that sum exactly.
  let total = (baseTotal - margin) % 2 === 0 ? baseTotal : baseTotal + 1;
  const { totalMin, totalMax } = getSportSimulationProfile(sport).baseline;
  if (total > totalMax) total -= 2; // -2 keeps parity while staying in bound
  if (total < totalMin) total += 2;
  const favorite = (total + margin) / 2;
  const underdog = total - favorite;
  const homeIsFavorite =
    finalPick === "home" || (finalPick !== "away" && home >= away);
  const h = homeIsFavorite ? favorite : underdog;
  const a = homeIsFavorite ? underdog : favorite;
  return { home: h, away: a, spread: h - a, total: h + a };
}

const GRAND_SLAM_VENUE_RE = /grand slam|australian open|roland garros|french open|wimbledon|us open/i;

/**
 * Sets needed to WIN a tennis match: men's Grand Slam main draw is best-of-5
 * (3 sets to win); everything else (all WTA, all non-Slam ATP) is best-of-3.
 * Defaults to best-of-3 when the tour is unknown.
 */
export function tennisWinSets(venue: string | undefined, tour: string | undefined): number {
  return GRAND_SLAM_VENUE_RE.test(venue ?? "") && tour === "ATP" ? 3 : 2;
}

/**
 * Tennis projects a real SET score (e.g. 2-0 / 2-1, or 3-x at a men's Slam) —
 * the natural unit for a tennis result — instead of a synthetic games total.
 * The winner takes the full set count; the loser's sets reflect how close the
 * match is (a clear favorite wins in straight sets; a tight pick drops one).
 */
function tennisSetProjection(
  projection: SimulationProjection,
  finalPick: ProjectionOutcome,
  finalProbabilities: { home: number; away: number; draw?: number },
  winSets: number,
): SimulationProjection {
  const favSide: "home" | "away" =
    finalPick === "home" || finalPick === "away"
      ? finalPick
      : finalProbabilities.home >= finalProbabilities.away
        ? "home"
        : "away";
  const favProb = favSide === "home" ? finalProbabilities.home : finalProbabilities.away;
  const loserSets =
    winSets >= 3
      ? favProb >= 0.68
        ? 0
        : favProb >= 0.56
          ? 1
          : 2
      : favProb >= 0.6
        ? 0
        : 1;
  const home = favSide === "home" ? winSets : loserSets;
  const away = favSide === "home" ? loserSets : winSets;
  return {
    ...projection,
    homeWinProbability: roundTo(finalProbabilities.home, 4),
    awayWinProbability: roundTo(finalProbabilities.away, 4),
    drawProbability: undefined,
    projectedHomeScore: home,
    projectedAwayScore: away,
    projectedSpread: home - away,
    projectedTotal: home + away,
    signals: projection.signals.slice(0, 5),
  };
}

export function reconcileProjectionToFinal(args: {
  sport: string;
  projection: SimulationProjection;
  finalProbabilities: { home: number; away: number; draw?: number };
  tennisWinSets?: number;
}): SimulationProjection {
  const finalPick = finalOutcomeFromProbabilities(
    args.finalProbabilities.home,
    args.finalProbabilities.away,
    args.finalProbabilities.draw,
  );
  // Tennis: project a set score directly (and bypass the games/quantize path).
  if (args.sport === "TENNIS") {
    return tennisSetProjection(args.projection, finalPick, args.finalProbabilities, args.tennisWinSets ?? 2);
  }
  let projectedHomeScore = args.projection.projectedHomeScore;
  let projectedAwayScore = args.projection.projectedAwayScore;
  let projectedSpread = roundTo(projectedHomeScore - projectedAwayScore, 1);
  let projectedTotal = roundTo(projectedHomeScore + projectedAwayScore, 1);
  let scoreAdjusted =
    Math.abs(projectedSpread - args.projection.projectedSpread) > 0.001 ||
    Math.abs(projectedTotal - args.projection.projectedTotal) > 0.001;
  const selectedProbability = probabilityForFinalPick(args.finalProbabilities, finalPick);

  // Align the DISPLAYED projected margin to the DISPLAYED win probability so the
  // score line and the confidence always tell the same story. The simulator's
  // raw mean margin reflects its OWN win probability, but the public confidence
  // is the orchestrator's calibrated probability — the two can disagree in
  // magnitude, which is how a 59% lean used to show a 1-point near-tie. We keep
  // the simulator's TOTAL and re-size only the margin to Φ⁻¹(p)·volatility, so
  // higher confidence always shows a bigger margin (monotonic) and the winner of
  // the line always matches the pick. The raw simulator line stays in
  // engineBreakdown for transparency. Tennis returns above with a real set score.
  if (finalPick !== "none") {
    const targetMargin = impliedMarginForProbability(
      args.sport,
      args.finalProbabilities,
      finalPick,
      projectedTotal,
    );
    const reconciledScores = reconciledScoreLineForPick({
      sport: args.sport,
      total: projectedTotal,
      finalPick,
      selectedProbability,
      targetMargin,
    });
    projectedHomeScore = reconciledScores.home;
    projectedAwayScore = reconciledScores.away;
    projectedSpread = reconciledScores.spread;
    projectedTotal = reconciledScores.total;
    scoreAdjusted = true;
  }

  const probabilityAdjusted =
    Math.abs(args.projection.homeWinProbability - args.finalProbabilities.home) > 0.005 ||
    Math.abs(args.projection.awayWinProbability - args.finalProbabilities.away) > 0.005 ||
    (
      args.finalProbabilities.draw !== undefined &&
      Math.abs((args.projection.drawProbability ?? 0) - args.finalProbabilities.draw) > 0.005
    );
  const signals = [...args.projection.signals];
  if (probabilityAdjusted || scoreAdjusted) {
    signals.unshift({
      key: "orchestrator-projection-reconciliation",
      label: "Projection reconciliation",
      value: roundTo(args.finalProbabilities.home - args.finalProbabilities.away, 3),
      evidence: "Public projection is aligned to the orchestrator final pick; raw simulator disagreement remains in engineBreakdown",
    });
  }

  const quantized = quantizeProjectedScoreLine(args.sport, projectedHomeScore, projectedAwayScore, finalPick);

  return {
    ...args.projection,
    homeWinProbability: roundTo(args.finalProbabilities.home, 4),
    awayWinProbability: roundTo(args.finalProbabilities.away, 4),
    drawProbability:
      args.finalProbabilities.draw !== undefined
        ? roundTo(args.finalProbabilities.draw, 4)
        : undefined,
    projectedHomeScore: quantized.home,
    projectedAwayScore: quantized.away,
    projectedSpread: quantized.spread,
    projectedTotal: quantized.total,
    signals: signals.slice(0, 5),
  };
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

/**
 * Decide the final blended outcome. By DEFAULT the factor/projection favorite is
 * preserved — the market can only shrink or grow the gap, never flip the pick.
 * That default makes a wrong factor pick impossible for the market to correct,
 * which caps accuracy. When the (free, ESPN-sourced) market anchor is enabled
 * AND the market is CONFIDENT in a favorite that disagrees with the factor lean,
 * we let the market flip the pick — that is exactly where a real line fixes a
 * wrong factor pick (the accuracy win). Gated + thresholded via env so the flip
 * behavior is A/B-validated on the backtest before it ships.
 */
function resolveBlendOutcome(args: {
  home: number;
  away: number;
  draw?: number;
  nonMarketHome: number;
  nonMarketAway: number;
  nonMarketDraw?: number;
  marketHome: number;
  marketAway: number;
  marketDraw?: number;
  marketWeight: number;
}): { home: number; away: number; draw?: number } {
  const preserve = () =>
    preserveNonMarketOutcome({
      home: args.home,
      away: args.away,
      draw: args.draw,
      nonMarketHome: args.nonMarketHome,
      nonMarketAway: args.nonMarketAway,
      nonMarketDraw: args.nonMarketDraw,
    });
  if (process.env.ENGINE_ESPN_MARKET === "false" || args.marketWeight <= 0) return preserve();
  const flipMinRaw = Number(process.env.ENGINE_MARKET_FLIP_MIN);
  // Default 0.52 (2026-06-05): the market is allowed to flip the model's pick
  // when it confidently disagrees. This is where the market's accuracy edge
  // lives — especially in MLB (+4pp) and NHL where the factor model is weak.
  // The downstream pick-stability lock (7pp commit gate) prevents oscillation.
  // Set ENGINE_MARKET_FLIP_ENABLED=false to disable market flips entirely.
  const flipEnabled = process.env.ENGINE_MARKET_FLIP_ENABLED !== "false";
  if (!flipEnabled) return preserve();
  const flipMin = Number.isFinite(flipMinRaw) && flipMinRaw > 0.5 ? flipMinRaw : 0.52;
  const nmTop = topOutcome(args.nonMarketHome, args.nonMarketAway, args.nonMarketDraw);
  const mTop = topOutcome(args.marketHome, args.marketAway, args.marketDraw);
  const mTopProb = Math.max(args.marketHome, args.marketAway, args.marketDraw ?? 0);
  // Let the market override when it confidently picks a different side.
  // The blended probabilities already incorporate the market weight, so when
  // the market is strong enough to flip the blend naturally, allow it through
  // rather than forcing the non-market outcome back on top.
  if (mTop !== nmTop && mTopProb >= flipMin) {
    // Market is confident and disagrees — allow the natural blend through
    // (which already incorporates market weight). This lets the market
    // correct wrong factor picks in weak-signal leagues.
    return { home: args.home, away: args.away, draw: args.draw };
  }
  // Market agrees or isn't confident enough to flip — preserve model pick.
  return preserve();
}

/**
 * League-aware market weight (only when the free ESPN market anchor is enabled).
 * The market is not uniformly better than our factor model — the backtest shows
 * it BEATS our model where our signal is weak and LOSES to it where our signal
 * is strong. So we lean on the market heavily in weak-factor leagues and lightly
 * in strong-factor leagues, instead of one blanket weight.
 *
 * Calibrated on a leak-aware, SEQUENTIAL historical replay (concurrency=1 so the
 * single-book ESPN/DraftKings line attaches on every game; running it wide
 * starves the odds fetch and silently understates the market). n=110/league:
 *   - MLB: blind 52.7% → 0.65 54.5% → 0.80 59.1% → 0.90 59.1%. Accuracy climbs
 *     with market weight and PEAKS at 0.80 (0.90 identical), so MLB sits at 0.80.
 *   - NBA: blind 67.3% → 0.15 68.2% → 0.40 68.2%. Factor model is strong and
 *     market-insensitive — keep the market a light 0.15 calibrator.
 *   - EPL: 0.60 50.9% → 0.80 49.1%. Leaning harder does NOT help 3-way soccer
 *     (draws don't sharpen by over-following) — hold at 0.60.
 *   - NHL: 0.40 54.5% → 0.65 55.5% (+1 game = noise) — hold at 0.40.
 * Tunable per env (ENGINE_MARKET_WEIGHT) for future sweeps.
 */
function marketWeightForSport(sport: string): number {
  switch (sport) {
    // Our model is at/above the line here — keep the market a light calibrator.
    case "NBA":
    case "NCAAB":
      return 0.15;
    // Weak factor model + high single-game variance: the DraftKings line is the
    // single best free predictor and accuracy peaks here (validated +4.6pp).
    case "MLB":
      return 0.8;
    case "MLS":
    case "EPL":
    case "UCL":
      return 0.6;
    case "NHL":
      return 0.4;
    case "NFL":
    case "NCAAF":
      return 0.45;
    default:
      return 0.4;
  }
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
  // Market weight. The legacy default treats the market as a tiny ~6-10%
  // calibration nudge. When the (free, ESPN-sourced) market anchor is enabled,
  // the market — the most predictive single signal — gets real weight so it can
  // actually move the pick. Both are env-tunable for backtest sweeps.
  const espnMarketEnabled = process.env.ENGINE_ESPN_MARKET !== "false";
  const marketWeightRaw = Number(process.env.ENGINE_MARKET_WEIGHT);
  const marketWeightOverride =
    Number.isFinite(marketWeightRaw) && marketWeightRaw > 0 ? clamp(marketWeightRaw, 0, 0.9) : null;
  const marketWeight = hasMarket
    ? marketWeightOverride ??
      (espnMarketEnabled
        ? marketWeightForSport(ctx.sport)
        : clamp(0.06 + coverage * 0.04, 0.06, 0.1))
    : 0;
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
    const preserved = resolveBlendOutcome({
      home,
      away,
      draw,
      nonMarketHome,
      nonMarketAway,
      nonMarketDraw,
      marketHome,
      marketAway,
      marketDraw: marketDrawNorm,
      marketWeight,
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
  const preserved = resolveBlendOutcome({
    home,
    away,
    nonMarketHome,
    nonMarketAway,
    marketHome,
    marketAway,
    marketWeight,
  });
  return { ...preserved, weights };
}

/**
 * Redistribute weight from unavailable factors to available ones.
 *
 * Revised (2026-06-05): The old proportional redistribution had a critical flaw:
 * when multiple sport-specific factors were unavailable, rating_diff (the largest
 * single factor at 0.40) would absorb most of the freed weight, sometimes reaching
 * 0.65-0.75 effective weight. This made the engine overconfident on Elo alone.
 *
 * New approach:
 * 1. rating_diff can absorb at most 15% additional weight (capped at 0.55 total).
 * 2. Non-rating available factors absorb their proportional share normally.
 * 3. Any remaining weight that can't be absorbed becomes a neutral "confidence
 *    drag" factor (homeDelta=0, available=true, hasSignal=false) that dilutes
 *    the final probability toward 50% without changing the pick direction.
 *
 * This ensures that missing data REDUCES confidence rather than INFLATING it
 * by concentrating all weight onto the Elo differential.
 */
function redistributeWeights(factors: FactorContribution[]): FactorContribution[] {
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const availableWeight = factors
    .filter((f) => f.available)
    .reduce((sum, f) => sum + f.weight, 0);

  if (availableWeight === 0) {
    return factors; // All factors unavailable — nothing to redistribute onto.
  }

  const unavailableWeight = totalWeight - availableWeight;
  if (unavailableWeight <= 0.001) {
    // Nothing to redistribute
    return factors.map((f) => ({
      ...f,
      weight: f.available ? f.weight : 0,
    }));
  }

  // Cap how much rating_diff can grow
  const RATING_MAX_TOTAL_WEIGHT = 0.55;
  const ratingFactor = factors.find((f) => f.key === "rating_diff" && f.available);
  const ratingBaseWeight = ratingFactor?.weight ?? 0;
  const ratingMaxAbsorb = Math.max(0, RATING_MAX_TOTAL_WEIGHT - ratingBaseWeight);

  // Non-rating available factors
  const nonRatingAvailable = factors.filter(
    (f) => f.available && f.key !== "rating_diff"
  );
  const nonRatingWeight = nonRatingAvailable.reduce((sum, f) => sum + f.weight, 0);

  // Proportional redistribution with rating cap
  const naiveScale = totalWeight / availableWeight;
  const ratingNaiveNew = ratingBaseWeight * naiveScale;
  const ratingExcess = Math.max(0, ratingNaiveNew - (ratingBaseWeight + ratingMaxAbsorb));

  // If rating would exceed its cap, the excess becomes confidence drag
  const confidenceDragWeight = ratingExcess;
  const ratingFinalWeight = Math.min(ratingBaseWeight * naiveScale, ratingBaseWeight + ratingMaxAbsorb);

  // Non-rating factors get their proportional share (slightly more if rating is capped)
  const nonRatingBudget = totalWeight - ratingFinalWeight - confidenceDragWeight;
  const nonRatingScale = nonRatingWeight > 0 ? nonRatingBudget / nonRatingWeight : 1;

  const result = factors.map((f) => {
    if (!f.available) {
      return { ...f, weight: 0 };
    }
    if (f.key === "rating_diff") {
      return { ...f, weight: ratingFinalWeight };
    }
    return { ...f, weight: f.weight * nonRatingScale };
  });

  // Add confidence drag as a neutral factor if there's excess weight
  if (confidenceDragWeight > 0.005) {
    result.push({
      key: "redistribution_drag",
      label: "Missing-data confidence reduction",
      homeDelta: 0,
      weight: confidenceDragWeight,
      available: true,
      hasSignal: false,
      evidence: `${Math.round(confidenceDragWeight * 100)}% of model weight parked as neutral drag due to missing factors (prevents Elo inflation)`,
    });
  }

  return result;
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

function isNbaHighLeverageWindow(ctx: GameContext): boolean {
  if (ctx.sport !== "NBA") return false;

  const phase = ctx.game.seasonContext?.phase?.toLowerCase() ?? "";
  if (phase.includes("playoff") || phase.includes("final") || phase.includes("title")) {
    return true;
  }

  const date = new Date(ctx.game.dateTime);
  if (Number.isNaN(date.getTime())) return false;
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const monthDay = month * 100 + day;
  return monthDay >= 415 && monthDay <= 625;
}

const CRITICAL_FACTOR_KEYS: Record<string, string[]> = {
  NBA: ["injuries_nba", "net_rating"],
  NCAAB: ["injuries_ncaamb", "net_rating_ncaamb"],
  NFL: ["starting_qb", "injuries_nfl"],
  NCAAF: ["starting_qb_ncaaf", "injuries_ncaaf"],
  MLB: ["starting_pitcher", "injuries_mlb"],
  NHL: ["starting_goalie", "special_teams", "injuries_nhl"],
  MLS: ["fixture_congestion", "key_player_availability", "stakes"],
  EPL: ["fixture_congestion", "key_player_availability", "stakes"],
  UCL: ["fixture_congestion", "key_player_availability", "ucl_pedigree", "ucl_travel"],
  IPL: ["ipl_table_strength", "ipl_venue_split"],
  TENNIS: ["tennis_ranking_edge", "tennis_recent_form"],
};

const MIN_NON_RATING_SIGNAL_WEIGHT: Record<string, number> = {
  NBA: 0.28,
  NCAAB: 0.24,
  NFL: 0.24,
  NCAAF: 0.24,
  MLB: 0.26,
  NHL: 0.24,
  MLS: 0.18,
  EPL: 0.18,
  UCL: 0.18,
  IPL: 0.20,
  TENNIS: 0.18,
};

const RATING_WEIGHT_CAP_WHEN_THIN: Record<string, number> = {
  NBA: 0.35,
  NCAAB: 0.36,
  NFL: 0.34,
  NCAAF: 0.34,
  MLB: 0.30,
  NHL: 0.32,
  MLS: 0.30,
  EPL: 0.30,
  UCL: 0.30,
  IPL: 0.32,
  TENNIS: 0.25,
};

function applyLeagueReliabilityGuards(
  ctx: GameContext,
  factors: FactorContribution[],
): FactorContribution[] {
  const rating = factors.find((factor) => factor.key === "rating_diff");
  if (!rating || rating.homeDelta === 0) {
    return factors;
  }

  const criticalKeys = CRITICAL_FACTOR_KEYS[ctx.sport] ?? [];
  const criticalMissing = criticalKeys
    .map((key) => ({
      key,
      factor: factors.find((candidate) => candidate.key === key),
    }))
    .filter((entry) => !entry.factor || !entry.factor.available);
  const nonRatingSignalWeight = factors
    .filter((factor) => factor.key !== "rating_diff" && factor.available && factor.hasSignal)
    .reduce((sum, factor) => sum + factor.weight, 0);
  const signalFloor = MIN_NON_RATING_SIGNAL_WEIGHT[ctx.sport] ?? 0.22;
  const thinSignal = nonRatingSignalWeight < signalFloor;

  if (criticalMissing.length === 0 && !thinSignal) {
    return factors;
  }

  // If we have solid form data (both teams have 5+ results), the Elo + form
  // signal is meaningful even without critical sport-specific factors.
  // In this case, only apply the guard if MOST critical factors are missing.
  const formAvailable = ctx.homeForm.results.length >= 5 && ctx.awayForm.results.length >= 5;
  const formFactor = factors.find((f) => f.key === "form" || f.key === "recent_form");
  const hasFormSignal = formAvailable || (formFactor?.available && formFactor?.hasSignal);
  if (hasFormSignal && criticalMissing.length <= 2 && !thinSignal) {
    // Form + Elo is enough to make a pick — skip the heavy guard
    return factors;
  }

  const ratingCap = RATING_WEIGHT_CAP_WHEN_THIN[ctx.sport] ?? 0.32;
  if (rating.weight <= ratingCap) {
    return factors;
  }

  const ratingDirection = Math.sign(rating.homeDelta);
  const counterTargets = factors.filter((factor) =>
    factor.available &&
    factor.hasSignal &&
    factor.key !== "rating_diff" &&
    Math.sign(factor.homeDelta) === -ratingDirection &&
    factor.weight > 0
  );
  const supportingTargets = factors.filter((factor) =>
    factor.available &&
    factor.hasSignal &&
    factor.key !== "rating_diff" &&
    Math.sign(factor.homeDelta) === ratingDirection &&
    factor.weight > 0
  );
  const redistributionTargets =
    counterTargets.length > 0
      ? counterTargets
      : thinSignal
        ? []
        : supportingTargets;
  const targetWeight = redistributionTargets.reduce((sum, factor) => sum + factor.weight, 0);
  const excess = rating.weight - ratingCap;
  const redistributingToCounter = counterTargets.length > 0;
  const redistributionShare =
    redistributionTargets.length > 0
      ? redistributingToCounter
        ? isNbaHighLeverageWindow(ctx) ? 0.75 : 0.55
        : isNbaHighLeverageWindow(ctx) ? 0.65 : 0.45
      : 0;
  const redistributedExcess = excess * redistributionShare;
  const reserveWeight = excess - redistributedExcess;
  const targetKeys = new Set(redistributionTargets.map((factor) => factor.key));
  const missingLabels = criticalMissing
    .map(({ key, factor }) => factor?.label ?? key)
    .filter(Boolean);
  const marketAnchorEvidence = ctx.marketConsensus
    ? `${ctx.marketConsensus.sourceLabel ?? "Market consensus"} anchor available`
    : "No market consensus anchor available";
  const guardEvidence = [
    missingLabels.length > 0
      ? `Missing critical ${ctx.sport} inputs: ${missingLabels.join(", ")}`
      : null,
    thinSignal
      ? `Only ${(nonRatingSignalWeight * 100).toFixed(0)}% non-rating signal weight available`
      : null,
    marketAnchorEvidence,
  ].filter(Boolean).join("; ");

  const guarded = factors.map((factor) => {
    if (factor.key === "rating_diff") {
      return {
        ...factor,
        weight: ratingCap,
        evidence: `${factor.evidence}; reliability cap applied because ${guardEvidence}`,
      };
    }
    if (targetWeight > 0 && targetKeys.has(factor.key)) {
      return {
        ...factor,
        weight: factor.weight + (redistributedExcess * factor.weight / targetWeight),
      };
    }
    return factor;
  });

  if (reserveWeight <= 0.001) return guarded;

  return [
    ...guarded,
    {
      key: "data_quality_guard",
      label: "Missing-data confidence reserve",
      homeDelta: 0,
      weight: reserveWeight,
      available: false,
      hasSignal: false,
      evidence: `${guardEvidence}; reserved ${Math.round(reserveWeight * 100)}% of model weight instead of donating it to rating/home-field`,
    },
  ];
}

/**
 * Keep the factor blend honest after unavailable-data redistribution.
 *
 * `hasSignal=false` means the factor has no side-specific evidence. That is
 * different from "missing." A confirmed neutral read like equal rest, no
 * back-to-back, normal travel, or no reported injury edge should remain a
 * neutral vote. Donating that weight into Elo made ordinary games look more
 * certain than the evidence supported.
 *
 * Unavailable factors are already handled by `redistributeWeights()` before
 * this step. This function intentionally preserves the post-redistribution
 * weights so neutral evidence compresses confidence instead of amplifying the
 * nearest directional anchor.
 */
export function blendFactors(factors: FactorContribution[]): FactorContribution[] {
  return factors;
}

/**
 * Sum factor contributions into a single home rating advantage (Elo points).
 *
 * Legacy: a weighted average of every factor's homeDelta, INCLUDING the Elo
 * differential — which shrinks a 100-pt home edge to ~40 effective points and
 * compresses confidence toward 50%.
 *
 * Full-scale (flag): the Elo differential (rating_diff) enters at full scale and
 * the remaining factors are added as weighted adjustments, so earned confidence
 * is preserved while secondary factors still nudge the line.
 */
export function sumRatingDelta(factors: FactorContribution[]): number {
  if (!isFullScaleRatingEnabled()) {
    let total = 0;
    for (const factor of factors) {
      if (factor.available) {
        const delta = factor.homeDelta * factor.weight;
        if (Number.isFinite(delta)) total += delta;
      }
    }
    return total;
  }

  const ratingFactor = factors.find((f) => f.key === "rating_diff");
  let adjustments = 0;
  for (const factor of factors) {
    if (factor.key === "rating_diff") continue;
    if (factor.available) {
      const delta = factor.homeDelta * factor.weight;
      if (Number.isFinite(delta)) adjustments += delta;
    }
  }
  if (!ratingFactor?.available) return adjustments;

  // Full-scale takes the Elo delta at FULL scale (the decompression we want),
  // with two protections so it can't manufacture confident-but-wrong picks:
  //
  // 1. eloScale — honor any thin-data down-weighting of rating_diff. The pipeline
  //    (e.g. the NBA playoff thin-data guard) cuts rating_diff's weight below its
  //    nominal 0.40 when Elo is unreliable; full-scale shrinks the Elo base in
  //    proportion (>=0.40 keeps the full delta).
  // 2. conflict-aware blend — full-scale enters Elo at full magnitude while the
  //    other factors enter weight-diluted, so when the TRUSTED factors point the
  //    OPPOSITE way from Elo (a cold/injured higher-Elo team vs a hot healthy
  //    underdog), the full Elo base would drown them. So when adjustments oppose
  //    the Elo lean, blend the Elo base back toward its legacy (weight-shrunk)
  //    value in proportion to how strongly they oppose it. Agreeing signals keep
  //    the full decompression; strong disagreement falls back to balanced legacy.
  const NOMINAL_RATING_WEIGHT = 0.4;
  const eloScale = Math.min(1, ratingFactor.weight / NOMINAL_RATING_WEIGHT);
  const legacyBase = ratingFactor.homeDelta * ratingFactor.weight;
  let eloBase = ratingFactor.homeDelta * eloScale;
  if (eloBase !== 0 && adjustments * eloBase < 0 && Math.abs(legacyBase) > 1e-9) {
    const opposition = Math.min(1, Math.abs(adjustments) / Math.abs(legacyBase));
    eloBase = eloBase * (1 - opposition) + legacyBase * opposition;
  }
  return eloBase + adjustments;
}

/**
 * Generate an honest prediction for a single game.
 *
 * UNIFIED ENGINE ARCHITECTURE (2026-06-05):
 * The simulation IS the prediction. There is one coherent flow:
 *   1. Compute all factors (base + sport-specific)
 *   2. Redistribute weights, apply reliability guards
 *   3. Sum factor deltas into a total rating advantage
 *   4. Feed factors + rating delta into the Monte Carlo simulation
 *   5. The simulation produces BOTH the win probability AND the projected scores
 *   6. Market consensus calibrates the simulation's probability (not a separate vote)
 *   7. Thin-data guard caps confidence when evidence is insufficient
 *   8. The projected scores come directly from the simulation — no reconciliation
 *
 * The narrative field is left empty ("") — it's filled by narrative.ts
 * in a separate step so this function stays pure and testable.
 */
export function predictGame(ctx: GameContext): HonestPrediction {
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Compute all factors
  // ═══════════════════════════════════════════════════════════════════════════
  const baseFactors = computeBaseFactors(ctx);
  const sportFactorFn = SPORT_FACTORS[ctx.sport];
  const sportFactors = sportFactorFn ? sportFactorFn(ctx) : [];
  const allFactors = [...baseFactors, ...sportFactors];
  const rawCoverage = dataCoverage(allFactors);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Redistribute weights, normalize, apply reliability guards
  // ═══════════════════════════════════════════════════════════════════════════
  const redistributedFactors = redistributeWeights(allFactors);
  const preNormSum = redistributedFactors.reduce((acc, f) => acc + f.weight, 0);
  if (preNormSum > 0 && Math.abs(1 - preNormSum) > 0.01) {
    console.warn(
      `[engine] warning: ${ctx.sport} factor weights sum to ${preNormSum.toFixed(4)}, expected 1.0`,
    );
  }
  const normalizedFactors = normalizeWeightsToOne(redistributedFactors);
  const contextWeightedFactors = applyLeagueReliabilityGuards(ctx, normalizedFactors);
  const adjustedFactors = blendFactors(contextWeightedFactors);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Sum factor deltas → total rating advantage (Elo points)
  // ═══════════════════════════════════════════════════════════════════════════
  let totalRatingDelta = sumRatingDelta(adjustedFactors);
  const weakSportCalibration = applyWeakSportCalibration(ctx, totalRatingDelta, adjustedFactors, rawCoverage);
  totalRatingDelta = weakSportCalibration.ratingDelta;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Run the unified simulation — THIS IS THE PREDICTION
  // The simulation uses the factor-derived rating delta + all game context to
  // produce win probabilities AND projected scores in a single coherent pass.
  // ═══════════════════════════════════════════════════════════════════════════
  const simulation = simulateGameProjection(ctx, totalRatingDelta, adjustedFactors);

  // The simulation's probability IS the base prediction.
  let homeWinProb = simulation.homeWinProbability;
  let awayWinProb = simulation.awayWinProbability;
  let drawProb: number | undefined = simulation.drawProbability;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Market calibration — adjusts probability, NOT scores
  // The market is a calibration signal that nudges the simulation's probability
  // when the betting line has information the model doesn't. It does NOT
  // produce its own separate prediction.
  // ═══════════════════════════════════════════════════════════════════════════
  const hasMarket = ctx.marketConsensus && Number.isFinite(ctx.marketConsensus.noVigHomeProb);
  const marketWeight = hasMarket ? marketWeightForSport(ctx.sport) : 0;

  if (hasMarket && marketWeight > 0) {
    const market = ctx.marketConsensus!;
    if (SOCCER_LEAGUES.has(ctx.sport) && market.noVigDrawProb !== undefined) {
      const [mHome, mDraw, mAway] = normalizeThreeWay(
        market.noVigHomeProb,
        market.noVigDrawProb,
        market.noVigAwayProb,
      );
      homeWinProb = homeWinProb * (1 - marketWeight) + mHome * marketWeight;
      drawProb = (drawProb ?? 0) * (1 - marketWeight) + mDraw * marketWeight;
      awayWinProb = awayWinProb * (1 - marketWeight) + mAway * marketWeight;
      // Renormalize
      const total = homeWinProb + awayWinProb + (drawProb ?? 0);
      if (total > 0) {
        homeWinProb /= total;
        awayWinProb /= total;
        if (drawProb !== undefined) drawProb /= total;
      }
    } else {
      const [mHome, mAway] = normalizeTwoWay(market.noVigHomeProb, market.noVigAwayProb);
      homeWinProb = homeWinProb * (1 - marketWeight) + mHome * marketWeight;
      awayWinProb = awayWinProb * (1 - marketWeight) + mAway * marketWeight;
      // Renormalize
      const [normHome, normAway] = normalizeTwoWay(homeWinProb, awayWinProb);
      homeWinProb = normHome;
      awayWinProb = normAway;
    }
  }

  // Allow market to flip the pick when it confidently disagrees
  // (only when the simulation's own probability was close to 50%)
  if (hasMarket && process.env.ENGINE_MARKET_FLIP_ENABLED !== "false") {
    const market = ctx.marketConsensus!;
    const flipMin = 0.52;
    const simTop = topOutcome(simulation.homeWinProbability, simulation.awayWinProbability, simulation.drawProbability);
    const mTop = topOutcome(market.noVigHomeProb, market.noVigAwayProb, market.noVigDrawProb);
    const mTopProb = Math.max(market.noVigHomeProb, market.noVigAwayProb, market.noVigDrawProb ?? 0);
    // If market disagrees with simulation AND market is confident AND simulation was close
    const simMaxProb = Math.max(simulation.homeWinProbability, simulation.awayWinProbability, simulation.drawProbability ?? 0);
    if (mTop !== simTop && mTopProb >= flipMin && simMaxProb < 0.58) {
      // Market overrides — use market-calibrated probabilities as-is
      // (they already lean toward market from the blend above)
    } else if (mTop !== simTop && mTopProb >= flipMin) {
      // Simulation was confident but market disagrees — don't flip,
      // but the blend above already pulled probability toward market
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Thin-data confidence cap
  // When the engine is missing critical factors, cap the maximum probability
  // so it cannot generate high-confidence picks on thin evidence.
  // ═══════════════════════════════════════════════════════════════════════════
  const criticalKeys = CRITICAL_FACTOR_KEYS[ctx.sport] ?? [];
  const missingCriticalCount = criticalKeys.filter((key) => {
    const factor = adjustedFactors.find((f) => f.key === key);
    return !factor || !factor.available;
  }).length;
  const THIN_DATA_CONFIDENCE_CAP = 0.62;
  const VERY_THIN_DATA_CONFIDENCE_CAP = 0.57;
  let confidenceCapApplied = false;

  const isThinEvidence = missingCriticalCount >= 3 || rawCoverage < 0.40;
  const isVeryThinEvidence = missingCriticalCount >= 4 || (missingCriticalCount >= 3 && rawCoverage < 0.50);

  if (isVeryThinEvidence || isThinEvidence) {
    const cap = isVeryThinEvidence ? VERY_THIN_DATA_CONFIDENCE_CAP : THIN_DATA_CONFIDENCE_CAP;
    const currentMax = Math.max(homeWinProb, awayWinProb, drawProb ?? 0);
    if (currentMax > cap) {
      const compressionRatio = cap / currentMax;
      const center = drawProb !== undefined ? 1 / 3 : 0.5;
      homeWinProb = center + (homeWinProb - center) * compressionRatio;
      awayWinProb = center + (awayWinProb - center) * compressionRatio;
      if (drawProb !== undefined) {
        drawProb = center + (drawProb - center) * compressionRatio;
      }
      // Renormalize
      const total = homeWinProb + awayWinProb + (drawProb ?? 0);
      if (total > 0) {
        homeWinProb /= total;
        awayWinProb /= total;
        if (drawProb !== undefined) drawProb /= total;
      }
      confidenceCapApplied = true;
    }
  }

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

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Reconcile the simulation projection to the final probabilities.
  // The simulation's raw scores reflect its OWN win probability, but the public
  // confidence is the orchestrator's calibrated blend — the two can disagree in
  // magnitude. reconcileProjectionToFinal re-sizes the margin to match the
  // public confidence so the score line and the tier label always tell the same
  // story (e.g. a 59% MLB lean shows ~0.7-run margin, not a near-tie).
  // ═══════════════════════════════════════════════════════════════════════════
  const finalPick = finalOutcomeFromProbabilities(homeWinProb, awayWinProb, drawProb);
  const projection: SimulationProjection = reconcileProjectionToFinal({
    sport: ctx.sport,
    projection: simulation,
    finalProbabilities: {
      home: homeWinProb,
      away: awayWinProb,
      draw: drawProb,
    },
    tennisWinSets: ctx.sport === "TENNIS"
      ? tennisWinSets(
          ctx.game.venue,
          (ctx.game.homeTeam as { tour?: string }).tour ?? (ctx.game.awayTeam as { tour?: string }).tour,
        )
      : undefined,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: Collect metadata
  // ═══════════════════════════════════════════════════════════════════════════
  const unavailableFactors = adjustedFactors
    .filter((f) => !f.available)
    .map((f) => f.evidence);

  const dataSources = ["ESPN scoreboard v2", "ESPN team stats", "internal Elo", "unified Monte Carlo simulation"];
  if (ctx.sport === "MLB" && (ctx.homeLineup?.startingPitcher || ctx.awayLineup?.startingPitcher)) {
    dataSources.push("MLB StatsAPI (probable pitchers)");
  }
  if (ctx.weather && !ctx.weather.isDomed) {
    dataSources.push("Open-Meteo weather");
  }
  if (ctx.marketConsensus) {
    dataSources.push(ctx.marketConsensus.sourceLabel ?? "SharpAPI market consensus");
  }
  if (ctx.sportsDataIO?.homeAdvanced || ctx.sportsDataIO?.awayAdvanced) {
    dataSources.push("SportsDataIO team stats");
  }
  if (ctx.sportsDataIO?.homeLineup || ctx.sportsDataIO?.awayLineup) {
    dataSources.push("SportsDataIO depth charts");
  }
  if (ctx.sportsDataIO?.homeInjuries || ctx.sportsDataIO?.awayInjuries) {
    dataSources.push("SportsDataIO injury feed");
  }
  if (ctx.freeDataSources?.homeAdvanced || ctx.freeDataSources?.awayAdvanced) {
    dataSources.push("public boxscore/team stats enrichment");
  }
  if (ctx.freeDataSources?.homeTennisProfile || ctx.freeDataSources?.awayTennisProfile) {
    dataSources.push("public tennis ranking/form data");
  }
  if (ctx.freeDataSources?.iplVenueSplit) {
    dataSources.push("ESPN Cricinfo IPL matchup splits");
  }

  // Market comparison — reports remaining gap after calibration
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

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 9: Build the canonical result — unified engine, single source of truth
  // ═══════════════════════════════════════════════════════════════════════════
  const generatedAt = new Date().toISOString();
  const marketProbabilities =
    market && Number.isFinite(market.noVigHomeProb)
      ? normalizeCanonicalProbabilities({
          home: market.noVigHomeProb,
          away: market.noVigAwayProb,
          draw: drawProb !== undefined ? market.noVigDrawProb : undefined,
        })
      : undefined;

  // Factor-only probability (for transparency in the breakdown)
  const rawFactorHomeProb = ratingDeltaToHomeWinProb(totalRatingDelta);
  let factorHomeWinProb: number;
  let factorAwayWinProb: number;
  let factorDrawProb: number | undefined;
  if (SOCCER_LEAGUES.has(ctx.sport)) {
    const [adjHome, draw, adjAway] = applySoccerDrawAdjustment(rawFactorHomeProb, ctx.sport);
    factorHomeWinProb = adjHome;
    factorAwayWinProb = adjAway;
    factorDrawProb = draw;
  } else {
    factorHomeWinProb = rawFactorHomeProb;
    factorAwayWinProb = 1 - rawFactorHomeProb;
  }

  // In the unified engine, there is ONE engine weight: the simulation (1.0).
  // Market calibration is applied as a post-processing step, not a separate vote.
  const engineWeights: CanonicalEngineWeights = {
    factor: 0,        // Factors feed INTO the simulation, not a separate read
    projection: 1.0,  // The simulation IS the engine
    market: marketWeight,
  };

  const canonicalResult = buildCanonicalPredictionResult({
    ctx,
    factors: adjustedFactors,
    factorProbabilities: normalizeCanonicalProbabilities({
      home: factorHomeWinProb,
      away: factorAwayWinProb,
      draw: factorDrawProb,
    }),
    projection,
    rawProjection: simulation,
    finalProbabilities: normalizeCanonicalProbabilities({
      home: homeWinProb,
      away: awayWinProb,
      draw: drawProb,
    }),
    confidence,
    generatedAt,
    modelVersion: MODEL_VERSION,
    marketProbabilities,
    engineWeights,
    extraWarnings: [
      ...weakSportCalibration.warnings,
      ...(confidenceCapApplied ? [`Confidence capped due to ${missingCriticalCount} missing critical factors`] : []),
    ],
  });

  traceCanonicalDecision({
    ctx,
    canonicalResult,
    factorProbabilities: normalizeCanonicalProbabilities({
      home: factorHomeWinProb,
      away: factorAwayWinProb,
      draw: factorDrawProb,
    }),
    rawProjection: simulation,
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
