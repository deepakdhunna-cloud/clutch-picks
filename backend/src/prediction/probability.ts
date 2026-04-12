/**
 * Probability conversion — the ONLY place rating points become probabilities.
 *
 * Uses the standard Elo logistic function.
 * Source: Arpad Elo, "The Rating of Chessplayers, Past and Present" (1978),
 * as adapted by FiveThirtyEight for team sports.
 *
 * GROUND RULES (from Section 0):
 * - NO scaling multiplier
 * - NO floor above 0
 * - NO ceiling below 1
 * - NO clamp beyond [0, 1] for numerical safety
 * - Every coefficient must come from a cited source or be a neutral transform
 */

/**
 * Convert a rating-point advantage into a home win probability.
 *
 * @param ratingDelta - Home team's total rating advantage in Elo points,
 *   already including home-field baseline and all factor contributions.
 * @returns Home win probability in [0, 1].
 */
export function ratingDeltaToHomeWinProb(ratingDelta: number): number {
  // Standard Elo logistic: P(home) = 1 / (1 + 10^(-delta / 400))
  // The 400-point scale is the original Elo convention where a 400-point
  // advantage corresponds to ~91% expected score.
  const p = 1 / (1 + Math.pow(10, -ratingDelta / 400));
  // Numerical safety only — the logistic naturally stays in (0, 1) for
  // finite inputs, but floating-point edge cases could theoretically escape.
  return Math.max(0, Math.min(1, p));
}

/**
 * Estimate draw probability for soccer leagues (MLS, EPL).
 *
 * Source: observed draw rates from historical data.
 * - EPL 2010-2024 average: ~25% draws (Transfermarkt, WhoScored)
 * - MLS 2010-2024 average: ~24% draws (MLS stats)
 *
 * Draw probability is highest when teams are evenly matched and decreases
 * as the rating gap grows. The scaling uses a simple quadratic decay based
 * on the closeness of the two-team probability split.
 *
 * @param homeWinProb - Home win probability from the Elo logistic (0..1)
 * @param league - "MLS" or "EPL"
 * @returns Draw probability in [0, 1]
 */
export function estimateDrawProbability(
  homeWinProb: number,
  league: string
): number {
  // Base draw rates from historical averages (cited above)
  const BASE_DRAW_RATES: Record<string, number> = {
    MLS: 0.24,
    EPL: 0.25,
  };

  const baseRate = BASE_DRAW_RATES[league];
  if (baseRate === undefined) return 0; // Non-soccer leagues don't draw

  // "Closeness" is 1.0 when teams are perfectly even (50/50),
  // approaches 0.0 as one team dominates (100/0).
  const closeness = 1 - Math.abs(homeWinProb - (1 - homeWinProb));
  // Using exponent 0.6 to reflect that draws are still meaningful even when
  // one team is moderately favored. Source: fitted to EPL 2015-2024 bucket data
  // showing draw rate stays above 15% even when the favorite is at 65%.
  const drawProb = baseRate * Math.pow(closeness, 0.6);

  return drawProb;
}

/**
 * Adjust home/away probabilities to account for draw probability in soccer.
 * The draw probability is "carved out" proportionally from both sides so
 * home + draw + away = 1.0 exactly.
 *
 * @returns Tuple of [adjustedHome, drawProb, adjustedAway]
 */
export function applySoccerDrawAdjustment(
  rawHomeWinProb: number,
  league: string
): [number, number, number] {
  const drawProb = estimateDrawProbability(rawHomeWinProb, league);
  if (drawProb === 0) return [rawHomeWinProb, 0, 1 - rawHomeWinProb];

  const remaining = 1 - drawProb;
  const adjustedHome = rawHomeWinProb * remaining;
  const adjustedAway = (1 - rawHomeWinProb) * remaining;

  return [adjustedHome, drawProb, adjustedAway];
}
