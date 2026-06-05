/**
 * NHL-specific factors.
 *
 * NHL IS GOALIE-DOMINATED. The weights reflect this.
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 * Breakdown:
 *   - Starting goalie (individual stats preferred): 0.22
 *   - Back-to-back backup: 0.08
 *   - Special teams differential (PP% vs PK%): 0.06
 *   - Injuries (top-6 forwards, top-4 defense): 0.06
 *
 * Changes (2026-06-05):
 *   - Goalie factor now uses INDIVIDUAL goalie stats (SV%, GAA) from the
 *     confirmed starting goalie when available via the NHL API pipeline.
 *   - Falls back to team-level save% only when individual stats are missing,
 *     and marks the factor as "degraded" (reduced confidence via hasSignal).
 *   - Special teams formula was fixed in the previous commit.
 *
 * All deltas in rating points (positive = favors home).
 */

import type { GameContext, FactorContribution } from "../types";
import type { LineupPlayer } from "../../lib/espnStats";
import { injuryReportsAreVerified, injuryUnavailableEvidence } from "./availability";

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
 * Convert a goalie's individual stats to Elo-point quality relative to
 * league average. Uses a blend of SV% (60%) and GAA (40%).
 *
 * Source: Hockey Reference — a goalie with .920 SV% vs .900 SV% saves ~0.6
 * extra goals per game over a 30-shot average, which is worth ~40-50 Elo pts.
 * Individual stats are FAR more predictive than team-level save% because
 * they isolate the goalie's contribution from team defensive quality.
 */
function goalieQualityFromIndividual(goalie: LineupPlayer): number {
  const sv = goalie.savePercentage;
  const gaa = goalie.goalsAgainstAvg;

  if (sv === undefined && gaa === undefined) return 0;

  if (sv !== undefined && gaa !== undefined) {
    // Blend: SV% is more predictive (less team-dependent)
    const svDelta = (sv - LG_SAVE_PCT) * 2500;
    const gaaDelta = (LG_GAA - gaa) * 30;
    return svDelta * 0.6 + gaaDelta * 0.4;
  }

  if (sv !== undefined) {
    return (sv - LG_SAVE_PCT) * 2500;
  }

  // GAA only
  return (LG_GAA - gaa!) * 30;
}

/**
 * Convert team-level save percentage to Elo-point quality.
 * This is the DEGRADED fallback — less predictive because it blends
 * starter and backup performance.
 */
function goalieQualityFromTeamSV(savePct: number): number {
  // Each 0.01 SV% above league average ≈ 25 Elo points
  // Reduced from individual (2500 multiplier) because team SV% is noisier
  return (savePct - LG_SAVE_PCT) * 2000;
}

/**
 * Extract the starting goalie from the lineup data.
 * Prefers the dedicated startingGoalie field, falls back to first G in starters.
 */
function extractStartingGoalie(lineup: import("../../lib/espnStats").StartingLineup | null): LineupPlayer | null {
  if (!lineup) return null;

  // Prefer the dedicated startingGoalie field (populated by NHL API pipeline)
  if (lineup.startingGoalie) return lineup.startingGoalie;

  // Fallback: first goalie in starters list
  const goalie = lineup.starters.find((p) => p.position === "G");
  return goalie ?? null;
}

export function computeNHLFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // ── 1. Starting goalie ────────────────────────────────────────────────
  // THE single most important NHL factor.
  //
  // Priority chain:
  // 1. Individual goalie stats from confirmed starter (NHL API pipeline)
  // 2. Team-level save% from ESPN/NHL stats (degraded signal)
  // 3. Unavailable (factor redistributes)
  const homeGoalie = extractStartingGoalie(ctx.homeLineup);
  const awayGoalie = extractStartingGoalie(ctx.awayLineup);

  const homeHasIndividual = homeGoalie?.savePercentage !== undefined || homeGoalie?.goalsAgainstAvg !== undefined;
  const awayHasIndividual = awayGoalie?.savePercentage !== undefined || awayGoalie?.goalsAgainstAvg !== undefined;

  // Determine if we're using individual stats (high quality) or team fallback (degraded)
  const homeGoalieConfirmed = homeGoalie?.isConfirmed === true && homeHasIndividual;
  const awayGoalieConfirmed = awayGoalie?.isConfirmed === true && awayHasIndividual;

  let goalieDelta = 0;
  let goalieEvidence = "Starting goalie data unavailable";
  let goalieAvailable = false;
  let goalieHasSignal = false;

  if (homeHasIndividual && awayHasIndividual) {
    // BEST CASE: Both goalies have individual stats
    const homeQuality = goalieQualityFromIndividual(homeGoalie!);
    const awayQuality = goalieQualityFromIndividual(awayGoalie!);
    goalieDelta = homeQuality - awayQuality;
    goalieAvailable = true;
    goalieHasSignal = true;

    const homeLabel = homeGoalieConfirmed ? `${homeGoalie!.name} (confirmed)` : `${homeGoalie!.name} (probable)`;
    const awayLabel = awayGoalieConfirmed ? `${awayGoalie!.name} (confirmed)` : `${awayGoalie!.name} (probable)`;
    const homeSV = homeGoalie!.savePercentage !== undefined ? `${(homeGoalie!.savePercentage * 100).toFixed(1)}% SV` : "";
    const awaySV = awayGoalie!.savePercentage !== undefined ? `${(awayGoalie!.savePercentage * 100).toFixed(1)}% SV` : "";
    const homeGAA = homeGoalie!.goalsAgainstAvg !== undefined ? `${homeGoalie!.goalsAgainstAvg.toFixed(2)} GAA` : "";
    const awayGAA = awayGoalie!.goalsAgainstAvg !== undefined ? `${awayGoalie!.goalsAgainstAvg.toFixed(2)} GAA` : "";

    goalieEvidence = `${homeLabel} [${[homeSV, homeGAA].filter(Boolean).join(", ")}] vs ${awayLabel} [${[awaySV, awayGAA].filter(Boolean).join(", ")}]`;
  } else if (homeHasIndividual || awayHasIndividual) {
    // PARTIAL: One goalie has individual stats, other uses team fallback
    goalieAvailable = true;
    goalieHasSignal = true;

    if (homeHasIndividual) {
      const homeQuality = goalieQualityFromIndividual(homeGoalie!);
      const awayFallback = ctx.awayAdvanced.savePercentage;
      const awayQuality = awayFallback !== undefined ? goalieQualityFromTeamSV(awayFallback) : 0;
      goalieDelta = homeQuality - awayQuality;
      goalieEvidence = `${homeGoalie!.name} [${homeGoalie!.savePercentage !== undefined ? `${(homeGoalie!.savePercentage * 100).toFixed(1)}% SV` : ""}] vs Away team SV% ${awayFallback !== undefined ? `${(awayFallback * 100).toFixed(1)}%` : "unavailable"}`;
    } else {
      const homeFallback = ctx.homeAdvanced.savePercentage;
      const homeQuality = homeFallback !== undefined ? goalieQualityFromTeamSV(homeFallback) : 0;
      const awayQuality = goalieQualityFromIndividual(awayGoalie!);
      goalieDelta = homeQuality - awayQuality;
      goalieEvidence = `Home team SV% ${homeFallback !== undefined ? `${(homeFallback * 100).toFixed(1)}%` : "unavailable"} vs ${awayGoalie!.name} [${awayGoalie!.savePercentage !== undefined ? `${(awayGoalie!.savePercentage * 100).toFixed(1)}% SV` : ""}]`;
    }
  } else {
    // FALLBACK: No individual stats — use team-level save% (degraded)
    const homeSavePct = ctx.homeAdvanced.savePercentage;
    const awaySavePct = ctx.awayAdvanced.savePercentage;
    goalieAvailable = homeSavePct !== undefined || awaySavePct !== undefined;

    if (homeSavePct !== undefined && awaySavePct !== undefined) {
      const homeQuality = goalieQualityFromTeamSV(homeSavePct);
      const awayQuality = goalieQualityFromTeamSV(awaySavePct);
      goalieDelta = homeQuality - awayQuality;
      goalieHasSignal = goalieDelta !== 0;
      goalieEvidence = `Team-level fallback: Home SV% ${(homeSavePct * 100).toFixed(1)}% vs Away SV% ${(awaySavePct * 100).toFixed(1)}% (individual goalie stats unavailable — reduced confidence)`;
    } else if (homeSavePct !== undefined) {
      goalieDelta = goalieQualityFromTeamSV(homeSavePct);
      goalieHasSignal = goalieDelta !== 0;
      goalieEvidence = `Team-level fallback: Home SV% ${(homeSavePct * 100).toFixed(1)}% (away data unavailable)`;
    } else if (awaySavePct !== undefined) {
      goalieDelta = -goalieQualityFromTeamSV(awaySavePct);
      goalieHasSignal = goalieDelta !== 0;
      goalieEvidence = `Team-level fallback: Away SV% ${(awaySavePct * 100).toFixed(1)}% (home data unavailable)`;
    } else {
      goalieEvidence = "Starting goalie/team save data unavailable from any source";
    }
  }

  factors.push({
    key: "starting_goalie",
    label: "Starting goalie quality",
    homeDelta: goalieDelta,
    weight: 0.22,
    available: goalieAvailable,
    hasSignal: goalieHasSignal,
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
  let stEvidence = "Special teams data unavailable from public team feeds";

  if (stAvailable) {
    const LG_PP = 0.215;
    const LG_PK = 0.795;

    const homeSTQuality = (homePP! - LG_PP) + (homePK! - LG_PK);
    const awaySTQuality = (awayPP! - LG_PP) + (awayPK! - LG_PK);
    const netST = homeSTQuality - awaySTQuality;
    stDelta = netST * 100 * 20;
    stDelta = Math.max(-60, Math.min(60, stDelta));
    stEvidence = `Home PP ${(homePP! * 100).toFixed(1)}%/PK ${(homePK! * 100).toFixed(1)}% vs Away PP ${(awayPP! * 100).toFixed(1)}%/PK ${(awayPK! * 100).toFixed(1)}% (net ST quality: ${netST > 0 ? "+" : ""}${(netST * 100).toFixed(1)}%)`;
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
  let injuryDelta = 0;
  const injuryParts: string[] = [];
  const injurySourceVerified = injuryReportsAreVerified(ctx.homeInjuries, ctx.awayInjuries);

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
    available: injurySourceVerified,
    hasSignal: injurySourceVerified && injuryDelta !== 0,
    evidence:
      !injurySourceVerified
        ? injuryUnavailableEvidence()
        :
      injuryParts.length > 0
        ? injuryParts.slice(0, 4).join("; ") + (injuryParts.length > 4 ? ` (+${injuryParts.length - 4} more)` : "")
        : "No significant skater injuries reported",
  });

  return factors;
}
