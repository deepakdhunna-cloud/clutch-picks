/**
 * College Basketball (NCAAB) specific factors.
 *
 * Mirrors the NBA factor file structure. Star injuries dominate basketball
 * outcomes and college rosters are even thinner than NBA, so the weight
 * distribution copies NBA with a small rebalance toward scoring trend
 * (since college off/def rating data is less reliable than NBA).
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 * Breakdown:
 *   - Star player injuries: 0.18
 *   - Back-to-back fatigue: 0.07
 *   - Pace-adjusted net rating: 0.05
 *   - Rotation fatigue / schedule density: 0.04
 *   - Recent scoring trend: 0.05
 *   - Three-point variance regression: 0.03 (deferred)
 *
 * Weight check: 0.18 + 0.07 + 0.05 + 0.04 + 0.05 + 0.03 = 0.42 ✓
 *
 * Deferred (not in return array, documented for future revisits):
 *   - Kenpom-style offensive/defensive efficiency — no ESPN data source
 *   - Pace factor — no ESPN data source
 *   - Neutral site detection (tournament games) — would need venue
 *     parsing not present in current data model
 *
 * All deltas in rating points (positive = favors home).
 */

import type { GameContext, FactorContribution } from "../types";

// Star player impact by position.
// Source: NBA advanced stats — top-3 players by usage rate account for
// ~55% of team production. A top player OUT costs ~80-120 Elo pts
// depending on role (Giannis/Jokic vs a 3rd option).
// We don't have usage rate data, so we use position as a proxy and
// count the number of OUT players at key positions.
// Copied verbatim from nba.ts.
const STAR_IMPACT: Record<string, number> = {
  PG: 60,
  SG: 45,
  SF: 55,
  PF: 50,
  C:  60,
  G:  50,
  F:  50,
};

export function computeNCAAMBFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // ── 1. Star player injuries ───────────────────────────────────────────
  // Direct copy of nba.ts injuries_nba factor.
  // Count OUT players at each position, cap at top 3 per team.
  let injuryDelta = 0;
  const injuryParts: string[] = [];

  const homeOut = ctx.homeInjuries.out.slice(0, 5);
  const awayOut = ctx.awayInjuries.out.slice(0, 5);

  for (const player of homeOut) {
    const impact = STAR_IMPACT[player.position] ?? 30;
    injuryDelta -= impact;
    injuryParts.push(`${ctx.game.homeTeam.abbreviation}: ${player.name} (${player.position}) OUT`);
  }
  for (const player of awayOut) {
    const impact = STAR_IMPACT[player.position] ?? 30;
    injuryDelta += impact;
    injuryParts.push(`${ctx.game.awayTeam.abbreviation}: ${player.name} (${player.position}) OUT`);
  }

  // Doubtful at 50% weight
  for (const player of ctx.homeInjuries.doubtful.slice(0, 3)) {
    const impact = (STAR_IMPACT[player.position] ?? 30) * 0.5;
    injuryDelta -= impact;
  }
  for (const player of ctx.awayInjuries.doubtful.slice(0, 3)) {
    const impact = (STAR_IMPACT[player.position] ?? 30) * 0.5;
    injuryDelta += impact;
  }

  factors.push({
    key: "injuries_ncaamb",
    label: "Star player availability",
    homeDelta: injuryDelta,
    weight: 0.18,
    available: true,
    evidence:
      injuryParts.length > 0
        ? injuryParts.slice(0, 4).join("; ") + (injuryParts.length > 4 ? ` (+${injuryParts.length - 4} more)` : "")
        : "No significant injuries reported for either team",
  });

  // ── 2. Back-to-back ───────────────────────────────────────────────────
  // Direct copy of nba.ts back_to_back factor.
  // Source: Huizinga & Weil (2009), NBA Advanced Stats (2015-2024):
  // Second game of back-to-back drops win probability ~5-7% (~40-55 Elo pts).
  // Road back-to-back is worse (~60 Elo pts).
  const homeRest = ctx.homeExtended.restDays;
  const awayRest = ctx.awayExtended.restDays;
  let b2bDelta = 0;
  let b2bEvidence = "No back-to-back for either team";

  if (homeRest === 0) {
    b2bDelta -= 50;
    b2bEvidence = `${ctx.game.homeTeam.abbreviation} on back-to-back`;
  }
  if (awayRest === 0) {
    b2bDelta += 50; // Favors home when away is on b2b
    b2bEvidence =
      homeRest === 0
        ? `Both teams on back-to-back — advantage neutralized`
        : `${ctx.game.awayTeam.abbreviation} on back-to-back (road)`;
    // Road b2b is worse: extra 10 pts
    if (homeRest !== 0) b2bDelta += 10;
  }

  factors.push({
    key: "back_to_back_ncaamb",
    label: "Back-to-back fatigue",
    homeDelta: b2bDelta,
    weight: 0.07,
    available: homeRest !== null || awayRest !== null,
    evidence: b2bEvidence,
  });

  // ── 3. Pace-adjusted offensive/defensive rating ───────────────────────
  // Direct copy of nba.ts net_rating factor logic.
  // Weight reduced from NBA's 0.10 to 0.05 because college off/def rating
  // data from ESPN is less reliable than NBA (smaller sample, less
  // standardized reporting). The freed 0.05 budget goes to scoring trend.
  // Source: Basketball Reference / NBA Stats — net rating (ORTG - DRTG)
  // is the single best team-level stat for predicting future performance.
  // Each point of net rating ≈ 2.7 wins over 82 games ≈ ~30 Elo pts.
  const homeOrtg = ctx.homeAdvanced.offensiveRating;
  const homeDrtg = ctx.homeAdvanced.defensiveRating;
  const awayOrtg = ctx.awayAdvanced.offensiveRating;
  const awayDrtg = ctx.awayAdvanced.defensiveRating;

  const netRatingAvailable =
    homeOrtg !== undefined &&
    homeDrtg !== undefined &&
    awayOrtg !== undefined &&
    awayDrtg !== undefined;

  let netRatingDelta = 0;
  let netRatingEvidence = "Offensive/defensive rating data unavailable from ESPN";

  if (netRatingAvailable) {
    const homeNet = homeOrtg! - homeDrtg!;
    const awayNet = awayOrtg! - awayDrtg!;
    const netDiff = homeNet - awayNet;
    // 1 point of net rating differential ≈ 30 Elo points
    // Source: FiveThirtyEight NBA methodology documentation
    netRatingDelta = netDiff * 30;
    netRatingEvidence = `Home net rating ${homeNet > 0 ? "+" : ""}${homeNet.toFixed(1)} vs Away net rating ${awayNet > 0 ? "+" : ""}${awayNet.toFixed(1)} (diff: ${netDiff > 0 ? "+" : ""}${netDiff.toFixed(1)})`;
  }

  factors.push({
    key: "net_rating_ncaamb",
    label: "Pace-adjusted net rating",
    homeDelta: netRatingDelta,
    weight: 0.05,
    available: netRatingAvailable,
    evidence: netRatingEvidence,
  });

  // ── 4. Rotation fatigue (schedule density) ────────────────────────────
  // Direct copy of nba.ts rotation_fatigue factor.
  // Source: NBA Advanced Stats schedule research — teams playing 4+ games
  // in 6 nights show measurable fatigue in 4th-quarter execution.
  // We approximate using consecutive away games as a density proxy.
  const homeConsecAway = 0; // Home team is at home, so 0
  const awayConsecAway = ctx.awayExtended.consecutiveAwayGames;

  let fatigueDelta = 0;
  let fatigueEvidence = "Normal schedule density for both teams";

  if (awayConsecAway >= 4) {
    fatigueDelta = 20;
    fatigueEvidence = `${ctx.game.awayTeam.abbreviation} on game ${awayConsecAway} of road trip — accumulated fatigue`;
  }

  factors.push({
    key: "rotation_fatigue_ncaamb",
    label: "Schedule density / fatigue",
    homeDelta: fatigueDelta,
    weight: 0.04,
    available: true,
    evidence: fatigueEvidence,
  });

  // ── 5. Recent scoring trend ───────────────────────────────────────────
  // scoringTrend is in [-1, 1], positive = offense trending up. The ×30
  // multiplier matches NBA's net rating calibration (see nba.ts net_rating)
  // — same pattern used in ncaafb.ts scoring_trend_ncaaf.
  //
  // Defensive note: scoringTrend is non-optional `number` and defaults to 0
  // when the upstream extended-stats fetch fails. We can't distinguish "real
  // flat trend" from "fetch failed" — log a warning when one side is exactly
  // 0 while the other is non-zero so we can spot systematic data gaps.
  const homeTrend = ctx.homeExtended.scoringTrend;
  const awayTrend = ctx.awayExtended.scoringTrend;
  if ((homeTrend === 0) !== (awayTrend === 0)) {
    console.warn(
      `[ncaamb-factors] scoring trend imbalance for game ${ctx.game.id}: ` +
      `home=${homeTrend.toFixed(2)} away=${awayTrend.toFixed(2)} — ` +
      `one side may have failed to fetch extended stats`
    );
  }
  const trendDelta = (homeTrend - awayTrend) * 30;

  factors.push({
    key: "scoring_trend_ncaamb",
    label: "Recent scoring trend",
    homeDelta: trendDelta,
    weight: 0.05,
    available: true,
    evidence: `Home scoring trend ${homeTrend > 0 ? "+" : ""}${homeTrend.toFixed(2)} vs Away ${awayTrend > 0 ? "+" : ""}${awayTrend.toFixed(2)}`,
  });

  // ── 6. Three-point variance regression (DEFERRED) ─────────────────────
  // Direct copy of nba.ts three_point_regression factor — same situation:
  // ESPN doesn't expose per-game 3P% data, so the factor is marked
  // unavailable and its weight redistributes.
  factors.push({
    key: "three_point_regression_ncaamb",
    label: "Three-point shooting regression",
    homeDelta: 0,
    weight: 0.03,
    available: false,
    evidence: "Per-game 3P% data not available from ESPN — factor inactive, weight redistributed",
  });

  return factors;
}
