/**
 * Universal base factors — applied to ALL leagues.
 *
 * These output rating-point deltas (positive = favors home).
 * They are NOT probabilities. Probability conversion happens once in probability.ts.
 *
 * Weight baselines (total: 0.58):
 *   - Elo rating differential: 0.40
 *   - Rest differential: 0.05
 *   - Recent form (opponent-adjusted): 0.10
 *   - Travel / time zone: 0.03
 */

import type { GameContext, FactorContribution } from "../types";
import { getHomeBonus } from "../../lib/elo";

// ─── Home-field baselines ───────────────────────────────────────────────────
// Added to home Elo before computing rating differential.
// Sources:
//   NFL: FiveThirtyEight NFL Elo model (2015-2023 avg ~2.5 pts → ~48 Elo)
//   NBA: FiveThirtyEight NBA RAPTOR/Elo (home court ~3.5 pts → ~90 Elo)
//   MLB: Baseball Reference HFA (2010-2023 avg ~54% → ~24 Elo)
//   NHL: Hockey Reference HFA (2010-2023 avg ~55% → ~33 Elo)
//   MLS: American Soccer Analysis (2012-2023 avg ~58-60% → ~70 Elo)
//   EPL: Transfermarkt/WhoScored (2010-2023 avg ~46% home wins → ~65 Elo)
//   NCAAFB: Bill Connelly SP+ (bigger crowds → ~65 Elo)
//   NCAAMB: Kenpom (home court enormous → ~100 Elo)
//
// These constants match the values already in elo.ts HOME_BONUSES.
// We read them from elo.ts to avoid duplication.

export function computeBaseFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // ── 1. Elo rating differential ────────────────────────────────────────
  // The home-field bonus is part of the Elo framework: home Elo is treated
  // as (actual Elo + home bonus) for expected-score purposes.
  // homeDelta = (homeElo + homeBonus) - awayElo
  const homeBonus = getHomeBonus(ctx.sport);
  const eloDelta = (ctx.homeElo + homeBonus) - ctx.awayElo;

  factors.push({
    key: "rating_diff",
    label: "Elo rating differential",
    homeDelta: eloDelta,
    weight: 0.40,
    available: true, // Elo is always available (default 1500 for new teams)
    evidence: `Home ${ctx.game.homeTeam.abbreviation} Elo ${Math.round(ctx.homeElo)} + ${homeBonus} HFA vs Away ${ctx.game.awayTeam.abbreviation} Elo ${Math.round(ctx.awayElo)} = ${Math.round(eloDelta)} pt differential`,
  });

  // ── 2. Rest differential ──────────────────────────────────────────────
  // Source: NBA back-to-back studies (Huizinga & Weil, 2009) show 1-2% win
  // probability drop per day of rest disadvantage. Converted to Elo points
  // at ~15 pts per 1% probability near the midpoint.
  const homeRest = ctx.homeExtended.restDays;
  const awayRest = ctx.awayExtended.restDays;
  const restAvailable = homeRest !== null && awayRest !== null;

  let restDelta = 0;
  let restEvidence = "Rest data unavailable";

  if (restAvailable) {
    const diff = homeRest! - awayRest!;
    // Each day of rest advantage ≈ 15 Elo points (conservative estimate).
    // Cap at ±3 days (±45 pts) to prevent extreme values from long breaks.
    const cappedDiff = Math.max(-3, Math.min(3, diff));
    restDelta = cappedDiff * 15;
    restEvidence =
      diff === 0
        ? `Both teams on equal rest (${homeRest} days)`
        : `Home ${homeRest} days rest vs Away ${awayRest} days rest (${diff > 0 ? "+" : ""}${diff} day advantage home)`;
  }

  factors.push({
    key: "rest_diff",
    label: "Rest differential",
    homeDelta: restDelta,
    weight: 0.05,
    available: restAvailable,
    evidence: restEvidence,
  });

  // ── 3. Recent form (opponent-adjusted) ────────────────────────────────
  // For each of the last 10 games, the "residual" is (actual result) minus
  // (Elo-expected result). Positive residual = team exceeding expectations.
  // We approximate this with W/L over last 10 since we don't have per-game
  // Elo expected scores stored. Win rate minus 0.5 gives a [-0.5, 0.5] range.
  // Scaled to Elo points: each 0.1 above .500 ≈ 40 Elo points of form signal.
  //
  // Source: FiveThirtyEight's Elo model uses a similar "team quality + recent
  // adjustment" structure, though they bake it into K-factor rather than
  // separating it as a factor.
  const homeFormWinRate = ctx.homeForm.wins / Math.max(ctx.homeForm.results.length, 1);
  const awayFormWinRate = ctx.awayForm.wins / Math.max(ctx.awayForm.results.length, 1);
  const formDiff = homeFormWinRate - awayFormWinRate;
  // Scale: 0.1 win-rate difference → 40 Elo points
  const formDelta = formDiff * 400;

  const homeResults = ctx.homeForm.results.length;
  const awayResults = ctx.awayForm.results.length;
  const formAvailable = homeResults >= 3 && awayResults >= 3;

  factors.push({
    key: "recent_form",
    label: "Recent form (L10)",
    homeDelta: formAvailable ? formDelta : 0,
    weight: 0.10,
    available: formAvailable,
    evidence: formAvailable
      ? `Home L10: ${ctx.homeForm.wins}-${ctx.homeForm.losses} (${(homeFormWinRate * 100).toFixed(0)}%), Away L10: ${ctx.awayForm.wins}-${ctx.awayForm.losses} (${(awayFormWinRate * 100).toFixed(0)}%)`
      : `Insufficient recent games (home: ${homeResults}, away: ${awayResults})`,
  });

  // ── 4. Travel / time zone ─────────────────────────────────────────────
  // Source: "Effects of Jet Lag on Performance in Professional Football"
  // (Steenland & Deddens, 1997; updated by Song et al., 2017 for NBA).
  // Crossing 2+ time zones west-to-east adds ~10-20 Elo points to home.
  // We use consecutive away games as a proxy for travel burden since we
  // don't have actual city-to-city flight data.
  const awayConsecAway = ctx.awayExtended.consecutiveAwayGames;
  let travelDelta = 0;
  let travelEvidence = "No significant travel differential";

  if (awayConsecAway >= 3) {
    // Extended road trip: fatigue compounds. ~10 pts per game beyond 2.
    travelDelta = Math.min(30, (awayConsecAway - 2) * 10);
    travelEvidence = `Away team on game ${awayConsecAway} of road trip — travel fatigue factor`;
  }

  factors.push({
    key: "travel",
    label: "Travel / road trip fatigue",
    homeDelta: travelDelta,
    weight: 0.03,
    available: true, // always available, contributes 0 if no travel differential
    evidence: travelEvidence,
  });

  return factors;
}
