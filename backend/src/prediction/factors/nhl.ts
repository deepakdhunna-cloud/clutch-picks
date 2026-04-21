/**
 * NHL-specific factors.
 *
 * NHL IS GOALIE-DOMINATED. The weights reflect this.
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 * Breakdown:
 *   - Starting goalie: 0.22
 *   - Back-to-back backup: 0.08
 *   - Special teams differential (PP% vs PK%): 0.06
 *   - Injuries (top-6 forwards, top-4 defense): 0.06
 *
 * Data source: ESPN scoreboard returns `probableStartingGoalie` with playerId
 * in `competitors[].probables[]`. Individual goalie stats (GAA, SV%, SO)
 * available via ESPN athlete stats endpoint.
 * Verified against live API response 2026-04-12: Vasilevskiy (TB), Swayman (BOS)
 * both returned with full season stats (GP, GAA, SV%, SO).
 *
 * All deltas in rating points (positive = favors home).
 */

import type { GameContext, FactorContribution } from "../types";

// ─── League average baselines (2024-2025) ───────────────────────────────
// Source: Hockey Reference / Natural Stat Trick
const LG_SAVE_PCT = 0.905;
const LG_GAA = 2.90;

// ─── Position impact for skater injuries ────────────────────────────────
// Source: Evolving Hockey WAR data — top-line forwards and #1D pairs are
// worth ~20-30 Elo points each. Depth players are worth less.
const POSITION_IMPACT: Record<string, number> = {
  C:  25,
  LW: 20,
  RW: 20,
  D:  22,
  G:  0, // Goalies handled separately in the starting goalie factor
};

/**
 * Convert a goalie's season save percentage to Elo-point quality relative to
 * league average. Each 0.01 SV% above average ≈ 1 GAA improvement over ~30
 * shots/game ≈ significant edge.
 *
 * Source: Hockey Reference — a goalie with .920 SV% vs .900 SV% saves ~0.6
 * extra goals per game over a 30-shot average, which is worth ~40-50 Elo pts.
 */
function goalieQualityDelta(savePct: number | undefined, gaa: number | undefined): number {
  if (savePct === undefined && gaa === undefined) return 0;

  let delta = 0;
  if (savePct !== undefined) {
    // Each 0.01 SV% above league average ≈ 25 Elo points
    // (0.910 vs 0.900 = 0.01 = +25 pts)
    delta += (savePct - LG_SAVE_PCT) * 2500;
  }
  if (gaa !== undefined) {
    // Each goal below league average GAA ≈ 30 Elo points
    delta += (LG_GAA - gaa) * 30;
  }

  // Blend SV% (60%) and GAA (40%) — SV% is more predictive (less team-dependent)
  // Source: Hockey Reference correlation studies
  if (savePct !== undefined && gaa !== undefined) {
    const svDelta = (savePct - LG_SAVE_PCT) * 2500;
    const gaaDelta = (LG_GAA - gaa) * 30;
    delta = svDelta * 0.6 + gaaDelta * 0.4;
  }

  return delta;
}

export function computeNHLFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // ── 1. Starting goalie ────────────────────────────────────────────────
  // THE single most important NHL factor.
  // ESPN scoreboard provides probable starting goalie with playerId.
  // Team save percentage from advanced metrics serves as a proxy for the
  // starter's quality when individual stats aren't available.
  //
  // We use team-level save% from ESPN's statistics endpoint as the primary
  // signal. When individual goalie stats become available via the athlete
  // endpoint, this can be upgraded.
  const homeSavePct = ctx.homeAdvanced.savePercentage;
  const awaySavePct = ctx.awayAdvanced.savePercentage;
  const goalieAvailable = homeSavePct !== undefined || awaySavePct !== undefined;

  let goalieDelta = 0;
  let goalieEvidence = "Starting goalie data unavailable";

  if (homeSavePct !== undefined && awaySavePct !== undefined) {
    const homeQuality = goalieQualityDelta(homeSavePct, undefined);
    const awayQuality = goalieQualityDelta(awaySavePct, undefined);
    goalieDelta = homeQuality - awayQuality;
    goalieEvidence = `Home team SV% ${(homeSavePct * 100).toFixed(1)}% vs Away SV% ${(awaySavePct * 100).toFixed(1)}% (league avg ${(LG_SAVE_PCT * 100).toFixed(1)}%)`;
  } else if (homeSavePct !== undefined) {
    goalieDelta = goalieQualityDelta(homeSavePct, undefined);
    goalieEvidence = `Home team SV% ${(homeSavePct * 100).toFixed(1)}% (away data unavailable)`;
  } else if (awaySavePct !== undefined) {
    goalieDelta = -goalieQualityDelta(awaySavePct, undefined);
    goalieEvidence = `Away team SV% ${(awaySavePct * 100).toFixed(1)}% (home data unavailable)`;
  }

  factors.push({
    key: "starting_goalie",
    label: "Starting goalie quality",
    homeDelta: goalieDelta,
    weight: 0.22,
    available: goalieAvailable,
    hasSignal: goalieAvailable && goalieDelta !== 0,
    evidence: goalieEvidence,
  });

  // ── 2. Back-to-back backup goalie ─────────────────────────────────────
  // Source: Hockey Reference — teams on back-to-back nights typically start
  // their backup goalie, who is on average ~15-20 Elo pts worse.
  // Combined with fatigue effects, the total penalty is ~30-40 Elo pts.
  const homeRest = ctx.homeExtended.restDays;
  const awayRest = ctx.awayExtended.restDays;
  let b2bDelta = 0;
  let b2bEvidence = "No back-to-back for either team";

  if (homeRest === 0) {
    // Home team on b2b: likely starting backup
    b2bDelta -= 35;
    b2bEvidence = `${ctx.game.homeTeam.abbreviation} on back-to-back — likely backup goalie`;
  }
  if (awayRest === 0) {
    b2bDelta += 35;
    b2bEvidence =
      homeRest === 0
        ? "Both teams on back-to-back — advantage neutralized"
        : `${ctx.game.awayTeam.abbreviation} on back-to-back — likely backup goalie`;
  }

  factors.push({
    key: "b2b_backup",
    label: "Back-to-back (backup goalie)",
    homeDelta: b2bDelta,
    weight: 0.08,
    available: homeRest !== null || awayRest !== null,
    hasSignal: b2bDelta !== 0,
    evidence: b2bEvidence,
  });

  // ── 3. Special teams differential ─────────────────────────────────────
  // Source: Natural Stat Trick / Hockey Reference — power play and penalty
  // kill percentages are moderately predictive. The differential between
  // team A's PP% and team B's PK% (and vice versa) creates scoring edges.
  const homePP = ctx.homeAdvanced.powerPlayPct;
  const homePK = ctx.homeAdvanced.penaltyKillPct;
  const awayPP = ctx.awayAdvanced.powerPlayPct;
  const awayPK = ctx.awayAdvanced.penaltyKillPct;

  const stAvailable =
    homePP !== undefined &&
    homePK !== undefined &&
    awayPP !== undefined &&
    awayPK !== undefined;

  let stDelta = 0;
  let stEvidence = "Special teams data unavailable";

  if (stAvailable) {
    // Home PP vs Away PK: positive = home has edge on power play
    const homePPvsAwayPK = homePP! - (1 - awayPK!);
    // Away PP vs Home PK: positive = away has edge on power play
    const awayPPvsHomePK = awayPP! - (1 - homePK!);
    // Net special teams edge for home
    const netST = homePPvsAwayPK - awayPPvsHomePK;
    // Each 1% net special teams edge ≈ 15 Elo points
    stDelta = netST * 100 * 15;
    stEvidence = `Home PP ${(homePP! * 100).toFixed(1)}%/PK ${(homePK! * 100).toFixed(1)}% vs Away PP ${(awayPP! * 100).toFixed(1)}%/PK ${(awayPK! * 100).toFixed(1)}%`;
  }

  factors.push({
    key: "special_teams",
    label: "Special teams differential",
    homeDelta: stDelta,
    weight: 0.06,
    available: stAvailable,
    hasSignal: stAvailable && stDelta !== 0,
    evidence: stEvidence,
  });

  // ── 4. Skater injuries ────────────────────────────────────────────────
  // Top-6 forwards and top-4 defense by TOI matter most.
  // We don't have TOI data, so we use all OUT skaters and weight by position.
  let injuryDelta = 0;
  const injuryParts: string[] = [];

  for (const player of ctx.homeInjuries.out) {
    if (player.position === "G") continue;
    const impact = POSITION_IMPACT[player.position] ?? 15;
    injuryDelta -= impact;
    injuryParts.push(`${ctx.game.homeTeam.abbreviation}: ${player.name} (${player.position}) OUT`);
  }
  for (const player of ctx.awayInjuries.out) {
    if (player.position === "G") continue;
    const impact = POSITION_IMPACT[player.position] ?? 15;
    injuryDelta += impact;
    injuryParts.push(`${ctx.game.awayTeam.abbreviation}: ${player.name} (${player.position}) OUT`);
  }

  // Doubtful at 50%
  for (const player of ctx.homeInjuries.doubtful) {
    if (player.position === "G") continue;
    injuryDelta -= (POSITION_IMPACT[player.position] ?? 15) * 0.5;
  }
  for (const player of ctx.awayInjuries.doubtful) {
    if (player.position === "G") continue;
    injuryDelta += (POSITION_IMPACT[player.position] ?? 15) * 0.5;
  }

  factors.push({
    key: "injuries_nhl",
    label: "Skater injuries",
    homeDelta: injuryDelta,
    weight: 0.06,
    available: true,
    hasSignal: injuryDelta !== 0,
    evidence:
      injuryParts.length > 0
        ? injuryParts.slice(0, 4).join("; ") + (injuryParts.length > 4 ? ` (+${injuryParts.length - 4} more)` : "")
        : "No significant skater injuries reported",
  });

  return factors;
}
