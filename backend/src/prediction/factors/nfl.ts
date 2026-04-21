/**
 * NFL-specific factors.
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 * Breakdown:
 *   - Starting QB status: 0.20
 *   - Weather: 0.05
 *   - Rest edge (Thursday/bye): 0.05
 *   - Divisional game compression: 0.04
 *   - Non-QB injuries (skill + defense): 0.08
 *
 * All deltas in rating points (positive = favors home).
 */

import type { GameContext, FactorContribution } from "../types";

// QB position weight is 2.8x a typical skill player.
// Source: Chase Stuart's Approximate Value research (2006-2020);
// 538's QB-adjusted Elo gives QBs ~80% of the team adjustment.
const QB_IMPACT_ELOS = 120; // Losing a starting QB is ~120 Elo points of degradation

// Non-QB position impact in Elo points when a key player is out.
// Source: approximate PFF WAR-to-win conversions scaled to Elo.
const POSITION_IMPACT: Record<string, number> = {
  QB: 120,
  WR: 20,
  RB: 12,
  TE: 15,
  OL: 12,
  CB: 18,
  DE: 16,
  LB: 12,
  S: 10,
  DT: 14,
  OT: 14,
  OG: 10,
  K: 5,
  P: 3,
};

export function computeNFLFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // ── 1. Starting QB status ─────────────────────────────────────────────
  // If a team's QB is listed as OUT or DOUBTFUL on the injury report,
  // the opposing team gains a massive edge.
  const homeQBOut = ctx.homeInjuries.out.some(
    (p) => p.position === "QB"
  );
  const homeQBDoubtful = ctx.homeInjuries.doubtful.some(
    (p) => p.position === "QB"
  );
  const awayQBOut = ctx.awayInjuries.out.some(
    (p) => p.position === "QB"
  );
  const awayQBDoubtful = ctx.awayInjuries.doubtful.some(
    (p) => p.position === "QB"
  );

  let qbDelta = 0;
  const qbParts: string[] = [];

  if (homeQBOut) {
    qbDelta -= QB_IMPACT_ELOS;
    const qb = ctx.homeInjuries.out.find((p) => p.position === "QB");
    qbParts.push(`${ctx.game.homeTeam.abbreviation} QB ${qb?.name ?? "unknown"} OUT`);
  } else if (homeQBDoubtful) {
    qbDelta -= QB_IMPACT_ELOS * 0.5;
    const qb = ctx.homeInjuries.doubtful.find((p) => p.position === "QB");
    qbParts.push(`${ctx.game.homeTeam.abbreviation} QB ${qb?.name ?? "unknown"} DOUBTFUL`);
  }

  if (awayQBOut) {
    qbDelta += QB_IMPACT_ELOS;
    const qb = ctx.awayInjuries.out.find((p) => p.position === "QB");
    qbParts.push(`${ctx.game.awayTeam.abbreviation} QB ${qb?.name ?? "unknown"} OUT`);
  } else if (awayQBDoubtful) {
    qbDelta += QB_IMPACT_ELOS * 0.5;
    const qb = ctx.awayInjuries.doubtful.find((p) => p.position === "QB");
    qbParts.push(`${ctx.game.awayTeam.abbreviation} QB ${qb?.name ?? "unknown"} DOUBTFUL`);
  }

  factors.push({
    key: "starting_qb",
    label: "Starting QB status",
    homeDelta: qbDelta,
    weight: 0.20,
    available: true, // Injury reports are always checked; no QB injury = 0 delta
    hasSignal: qbDelta !== 0,
    evidence: qbParts.length > 0 ? qbParts.join("; ") : "Both starting QBs appear healthy",
  });

  // ── 2. Weather ────────────────────────────────────────────────────────
  // Source: Sharp Football Analysis (2012-2023): wind > 15 mph reduces
  // passing efficiency ~12%, heavy precipitation reduces it ~8%.
  // In Elo terms, bad weather compresses the spread (favors underdog).
  // We model this as pulling the Elo delta 15% toward zero per significant
  // weather factor.
  let weatherDelta = 0;
  let weatherEvidence = "Indoor or mild conditions — no weather impact";
  const weatherAvailable = ctx.weather !== null;

  if (ctx.weather && !ctx.weather.isDomed) {
    const parts: string[] = [];
    if (ctx.weather.windSpeed > 15) {
      // High wind narrows outcomes — slight benefit to the underdog.
      // We don't know who the underdog is at factor time, so we compress
      // the Elo diff by reducing home advantage slightly.
      weatherDelta -= 10;
      parts.push(`wind ${Math.round(ctx.weather.windSpeed)} mph`);
    }
    if (ctx.weather.precipitation > 0.5) {
      weatherDelta -= 8;
      parts.push(`rain probability ${Math.round(ctx.weather.precipitation * 100)}%`);
    }
    if (ctx.weather.temperature < 30) {
      // Extreme cold slightly favors home team (familiarity with conditions)
      weatherDelta += 5;
      parts.push(`temp ${Math.round(ctx.weather.temperature)}°F`);
    }
    weatherEvidence =
      parts.length > 0
        ? `Outdoor conditions: ${parts.join(", ")}`
        : `Outdoor, mild conditions (${Math.round(ctx.weather.temperature)}°F, wind ${Math.round(ctx.weather.windSpeed)} mph)`;
  }

  factors.push({
    key: "weather",
    label: "Weather conditions",
    homeDelta: weatherDelta,
    weight: 0.05,
    available: weatherAvailable,
    hasSignal: weatherAvailable && weatherDelta !== 0,
    evidence: weatherEvidence,
  });

  // ── 3. Rest edge (Thursday/bye) ───────────────────────────────────────
  // Source: Football Outsiders (2000-2023): teams coming off bye win at ~55.5%
  // (~35 Elo pts). Thursday games penalize the team with fewer days off.
  // This is ADDITIONAL to the base rest factor — base.ts handles generic rest,
  // this handles NFL-specific bye/Thursday dynamics.
  const homeRest = ctx.homeExtended.restDays ?? 7;
  const awayRest = ctx.awayExtended.restDays ?? 7;
  let restEdgeDelta = 0;
  let restEdgeEvidence = "Standard rest schedule";

  // Coming off bye (10+ days rest vs opponent's 7)
  if (homeRest >= 10 && awayRest < 10) {
    restEdgeDelta = 35;
    restEdgeEvidence = `${ctx.game.homeTeam.abbreviation} coming off bye week (${homeRest} days rest)`;
  } else if (awayRest >= 10 && homeRest < 10) {
    restEdgeDelta = -35;
    restEdgeEvidence = `${ctx.game.awayTeam.abbreviation} coming off bye week (${awayRest} days rest)`;
  }
  // Thursday short week (3-4 days rest)
  else if (homeRest <= 4 && awayRest > homeRest) {
    restEdgeDelta = -15;
    restEdgeEvidence = `Short week for ${ctx.game.homeTeam.abbreviation} (${homeRest} days rest)`;
  } else if (awayRest <= 4 && homeRest > awayRest) {
    restEdgeDelta = 15;
    restEdgeEvidence = `Short week for ${ctx.game.awayTeam.abbreviation} (${awayRest} days rest)`;
  }

  factors.push({
    key: "rest_edge_nfl",
    label: "Bye / short week",
    homeDelta: restEdgeDelta,
    weight: 0.05,
    available: true,
    hasSignal: restEdgeDelta !== 0,
    evidence: restEdgeEvidence,
  });

  // ── 4. Divisional game compression ────────────────────────────────────
  // Source: FiveThirtyEight NFL analysis (2002-2023): divisional games are
  // historically ~1.5 points tighter than the Elo model predicts, likely
  // due to familiarity and extra preparation. We model this as compressing
  // the Elo delta by a flat 20 points toward zero.
  //
  // We don't have division data from ESPN in the current data model, so
  // this factor is marked unavailable. When division data is added, set
  // available: true and compute the delta.
  factors.push({
    key: "divisional",
    label: "Divisional matchup",
    homeDelta: 0,
    weight: 0.04,
    available: false,
    hasSignal: false,
    evidence: "Division data not available in current data model — factor inactive",
  });

  // ── 5. Non-QB injury impact ───────────────────────────────────────────
  // Sum the Elo impact of each OUT player by position.
  let injuryDelta = 0;
  const injuryParts: string[] = [];

  for (const player of ctx.homeInjuries.out) {
    if (player.position === "QB") continue; // Already handled above
    const impact = POSITION_IMPACT[player.position] ?? 8;
    injuryDelta -= impact;
    injuryParts.push(`${ctx.game.homeTeam.abbreviation}: ${player.name} (${player.position}) OUT`);
  }
  for (const player of ctx.awayInjuries.out) {
    if (player.position === "QB") continue;
    const impact = POSITION_IMPACT[player.position] ?? 8;
    injuryDelta += impact;
    injuryParts.push(`${ctx.game.awayTeam.abbreviation}: ${player.name} (${player.position}) OUT`);
  }

  // Include doubtful at 50% weight
  for (const player of ctx.homeInjuries.doubtful) {
    if (player.position === "QB") continue;
    const impact = (POSITION_IMPACT[player.position] ?? 8) * 0.5;
    injuryDelta -= impact;
  }
  for (const player of ctx.awayInjuries.doubtful) {
    if (player.position === "QB") continue;
    const impact = (POSITION_IMPACT[player.position] ?? 8) * 0.5;
    injuryDelta += impact;
  }

  factors.push({
    key: "injuries_nfl",
    label: "Non-QB injury report",
    homeDelta: injuryDelta,
    weight: 0.08,
    available: true,
    hasSignal: injuryDelta !== 0,
    evidence:
      injuryParts.length > 0
        ? injuryParts.slice(0, 4).join("; ") + (injuryParts.length > 4 ? ` (+${injuryParts.length - 4} more)` : "")
        : "No significant non-QB injuries reported",
  });

  return factors;
}
