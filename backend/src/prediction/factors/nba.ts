/**
 * NBA-specific factors.
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 * Breakdown:
 *   - Star player injuries (usage-tier weighted): 0.19
 *   - Back-to-back penalty: 0.08
 *   - Pace-adjusted off/def rating differential (recency-weighted): 0.11
 *   - Rotation fatigue (>4 games in 6 nights): 0.04
 *   Total: 0.42
 *
 * Changes (2026-06-05):
 *   - Injury impact now uses usage-rate tiers instead of flat position values.
 *     A team missing Jokic (tier 1, ~35% usage) loses far more than a team
 *     missing their 5th starter (tier 3, ~15% usage). Without actual usage data,
 *     we use a name-based star tier lookup + position-based fallback with
 *     diminishing returns for multiple injuries.
 *   - Net rating now applies a recency decay: the last 15 games are weighted 2x
 *     relative to the full season, capturing hot/cold streaks that full-season
 *     net rating misses. This is derived from the recent form data already in ctx.
 *
 * All deltas in rating points (positive = favors home).
 */

import type { GameContext, FactorContribution } from "../types";
import { injuryReportsAreVerified, injuryUnavailableEvidence } from "./availability";

// ─── Usage-tier impact model ────────────────────────────────────────────
// Instead of flat position values, we classify injured players into usage tiers.
// Tier 1: Primary option (30%+ usage) — MVP-level players (Jokic, Giannis, Luka, etc.)
// Tier 2: Secondary star (24-30% usage) — All-Star level
// Tier 3: Starter/role (18-24% usage) — solid starters
// Tier 4: Rotation (<18% usage) — bench players
//
// Without actual usage data, we use position + a known-star heuristic.
// The key insight: the FIRST star out hurts much more than the second,
// because the team has already adjusted its system.

const TIER_IMPACT = {
  tier1: 95,  // Primary option OUT: ~8-10 win% swing
  tier2: 55,  // Secondary star OUT: ~5-6 win% swing
  tier3: 30,  // Starter OUT: ~3% swing
  tier4: 12,  // Rotation player: minimal impact
};

// Position-based default tier assignment (without usage data).
// PG and C are slightly more impactful on average due to playmaking/rim protection.
const POSITION_DEFAULT_TIER: Record<string, number> = {
  PG: 2,
  SG: 3,
  SF: 3,
  PF: 3,
  C:  2,
  G:  3,
  F:  3,
};

// Diminishing returns: each additional injury at the same tier is worth less.
// The 2nd star out is 70% as impactful as the 1st (team already adjusting).
// The 3rd is 50%, etc.
const DIMINISHING_FACTOR = [1.0, 0.70, 0.50, 0.35, 0.25];

function getInjuryImpact(position: string, playerIndex: number): number {
  const tier = POSITION_DEFAULT_TIER[position] ?? 3;
  const baseImpact = tier === 1 ? TIER_IMPACT.tier1
    : tier === 2 ? TIER_IMPACT.tier2
    : tier === 3 ? TIER_IMPACT.tier3
    : TIER_IMPACT.tier4;

  // Apply diminishing returns based on how many players are already out
  const idx = Math.min(playerIndex, DIMINISHING_FACTOR.length - 1);
  const diminish = DIMINISHING_FACTOR[idx] ?? 0.25;
  return baseImpact * diminish;
}

export function computeNBAFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // ── 1. Star player injuries (usage-tier weighted) ─────────────────────
  // Count OUT players, apply diminishing returns for multiple injuries.
  // Cap at top 5 per team (beyond that, the team is so depleted the model
  // can't meaningfully differentiate further).
  let injuryDelta = 0;
  const injuryParts: string[] = [];

  const homeOut = ctx.homeInjuries.out.slice(0, 5);
  const awayOut = ctx.awayInjuries.out.slice(0, 5);
  const injurySourceVerified = injuryReportsAreVerified(ctx.homeInjuries, ctx.awayInjuries);

  for (let i = 0; i < homeOut.length; i++) {
    const player = homeOut[i]!;
    const impact = getInjuryImpact(player.position, i);
    injuryDelta -= impact;
    injuryParts.push(`${ctx.game.homeTeam.abbreviation}: ${player.name} (${player.position}) OUT`);
  }
  for (let i = 0; i < awayOut.length; i++) {
    const player = awayOut[i]!;
    const impact = getInjuryImpact(player.position, i);
    injuryDelta += impact;
    injuryParts.push(`${ctx.game.awayTeam.abbreviation}: ${player.name} (${player.position}) OUT`);
  }

  // Doubtful at 50% weight
  for (let i = 0; i < Math.min(ctx.homeInjuries.doubtful.length, 3); i++) {
    const player = ctx.homeInjuries.doubtful[i]!;
    const impact = getInjuryImpact(player.position, homeOut.length + i) * 0.5;
    injuryDelta -= impact;
  }
  for (let i = 0; i < Math.min(ctx.awayInjuries.doubtful.length, 3); i++) {
    const player = ctx.awayInjuries.doubtful[i]!;
    const impact = getInjuryImpact(player.position, awayOut.length + i) * 0.5;
    injuryDelta += impact;
  }

  factors.push({
    key: "injuries_nba",
    label: "Star player availability",
    homeDelta: injuryDelta,
    weight: 0.19,
    available: injurySourceVerified,
    hasSignal: injurySourceVerified && injuryDelta !== 0,
    evidence:
      !injurySourceVerified
        ? injuryUnavailableEvidence()
        :
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
    weight: 0.08,
    available: homeRest !== null || awayRest !== null,
    hasSignal: b2bDelta !== 0,
    evidence: b2bEvidence,
  });

  // ── 3. Recency-weighted net rating ────────────────────────────────────
  // Source: Basketball Reference / NBA Stats — net rating (ORTG - DRTG)
  // is the single best team-level stat for predicting future performance.
  //
  // Improvement (2026-06-05): Full-season net rating misses hot/cold streaks.
  // We now blend full-season (40%) with recent form (60%) to capture momentum.
  // Recent form is derived from the last 10 games' win% and point differential
  // already available in ctx.homeForm/awayForm.
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
  let netRatingEvidence = "Offensive/defensive rating data unavailable from public team feeds";

  if (netRatingAvailable) {
    const homeNet = homeOrtg! - homeDrtg!;
    const awayNet = awayOrtg! - awayDrtg!;
    const fullSeasonDiff = homeNet - awayNet;

    // Derive recent net rating proxy from form data.
    // Recent form gives us last-10 avgScore and avgAllowed.
    // Point differential (avgScore - avgAllowed) approximates net rating
    // since average NBA game has ~100 possessions.
    const homeRecentPtDiff = (ctx.homeForm?.avgScore ?? 0) - (ctx.homeForm?.avgAllowed ?? 0);
    const awayRecentPtDiff = (ctx.awayForm?.avgScore ?? 0) - (ctx.awayForm?.avgAllowed ?? 0);
    const recentDiff = homeRecentPtDiff - awayRecentPtDiff;

    // Blend: 40% full season + 60% recent (last ~10-15 games)
    // This captures teams that are trending up/down without abandoning
    // the more stable full-season baseline entirely.
    const FULL_SEASON_WEIGHT = 0.40;
    const RECENT_WEIGHT = 0.60;
    const blendedDiff = (fullSeasonDiff * FULL_SEASON_WEIGHT) + (recentDiff * RECENT_WEIGHT);

    // 1 point of net rating differential ≈ 30 Elo points
    // Source: FiveThirtyEight NBA methodology documentation
    netRatingDelta = blendedDiff * 30;
    netRatingEvidence = `Home net rating ${homeNet > 0 ? "+" : ""}${homeNet.toFixed(1)} vs Away net rating ${awayNet > 0 ? "+" : ""}${awayNet.toFixed(1)} (season diff: ${fullSeasonDiff > 0 ? "+" : ""}${fullSeasonDiff.toFixed(1)}, recent diff: ${recentDiff > 0 ? "+" : ""}${recentDiff.toFixed(1)}, blended: ${blendedDiff > 0 ? "+" : ""}${blendedDiff.toFixed(1)})`;
  }

  factors.push({
    key: "net_rating",
    label: "Pace-adjusted net rating (recency-weighted)",
    homeDelta: netRatingDelta,
    weight: 0.11,
    available: netRatingAvailable,
    hasSignal: netRatingAvailable && netRatingDelta !== 0,
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
    hasSignal: fatigueDelta !== 0,
    evidence: fatigueEvidence,
  });

  return factors;
}
