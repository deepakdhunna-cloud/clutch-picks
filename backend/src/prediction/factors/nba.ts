/**
 * NBA-specific factors.
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 * Breakdown:
 *   - Star player injuries (top-3 by usage): 0.18
 *   - Back-to-back penalty: 0.07
 *   - Pace-adjusted off/def rating differential: 0.10
 *   - Rotation fatigue (>4 games in 6 nights): 0.04
 *   - Three-point variance regression: 0.03
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
const STAR_IMPACT: Record<string, number> = {
  PG: 60,
  SG: 45,
  SF: 55,
  PF: 50,
  C:  60,
  G:  50,
  F:  50,
};

export function computeNBAFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // ── 1. Star player injuries ───────────────────────────────────────────
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
    key: "injuries_nba",
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
    key: "back_to_back",
    label: "Back-to-back fatigue",
    homeDelta: b2bDelta,
    weight: 0.07,
    available: homeRest !== null || awayRest !== null,
    evidence: b2bEvidence,
  });

  // ── 3. Pace-adjusted offensive/defensive rating ───────────────────────
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
    key: "net_rating",
    label: "Pace-adjusted net rating",
    homeDelta: netRatingDelta,
    weight: 0.10,
    available: netRatingAvailable,
    evidence: netRatingEvidence,
  });

  // ── 4. Rotation fatigue (schedule density) ────────────────────────────
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
    key: "rotation_fatigue",
    label: "Schedule density / fatigue",
    homeDelta: fatigueDelta,
    weight: 0.04,
    available: true,
    evidence: fatigueEvidence,
  });

  // ── 5. Three-point variance regression ────────────────────────────────
  // Source: Basketball Reference shooting variance studies — team 3P%
  // regresses heavily toward season mean. If a team is shooting significantly
  // above their season average in recent games, expect regression.
  // We don't have per-game 3P% data from ESPN, so this factor is
  // currently unavailable and its weight redistributes to available factors.
  factors.push({
    key: "three_point_regression",
    label: "Three-point shooting regression",
    homeDelta: 0,
    weight: 0.03,
    available: false,
    evidence: "Per-game 3P% data not available from ESPN — factor inactive, weight redistributed",
  });

  return factors;
}
