/**
 * College Football (NCAAF) specific factors.
 *
 * Mirrors the NFL factor file structure exactly. QB status dominates outcomes
 * in college football the same way it dominates the NFL, so the weight
 * distribution copies NFL rather than inventing sport-specific weightings.
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 * Breakdown:
 *   - Starting QB status: 0.20
 *   - Weather: 0.05
 *   - Rest edge / bye week: 0.04
 *   - Non-QB injuries: 0.08
 *   - Recent scoring trend: 0.05
 *
 * Weight check: 0.20 + 0.05 + 0.04 + 0.08 + 0.05 = 0.42 ✓
 *
 * Deferred (not implemented — documented for future revisits):
 *   - Yards per play differential — NFL chose not to consume this field
 *     despite the data pipeline populating it; following NFL's lead
 *   - Turnover differential — same reasoning as YPP
 *   - Third down conversion differential — same reasoning as YPP
 *   - Recruiting / talent rankings — no ESPN data source
 *   - Conference strength adjustment — no ESPN data source
 *
 * All deltas in rating points (positive = favors home).
 */

import type { GameContext, FactorContribution } from "../types";

// QB position weight is 2.8x a typical skill player.
// Source: Chase Stuart's Approximate Value research (2006-2020);
// 538's QB-adjusted Elo gives QBs ~80% of the team adjustment.
// College starting QB is at least as critical as NFL — copying NFL constant.
const QB_IMPACT_ELOS = 120;

// Non-QB position impact in Elo points when a key player is out.
// Source: approximate PFF WAR-to-win conversions scaled to Elo.
// Copied verbatim from nfl.ts.
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

export function computeNCAAFBFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // ── 1. Starting QB status ─────────────────────────────────────────────
  // Direct copy of nfl.ts starting_qb factor.
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
    key: "starting_qb_ncaaf",
    label: "Starting QB status",
    homeDelta: qbDelta,
    weight: 0.20,
    available: true,
    evidence: qbParts.length > 0 ? qbParts.join("; ") : "Both starting QBs appear healthy",
  });

  // ── 2. Weather ────────────────────────────────────────────────────────
  // Direct copy of nfl.ts weather factor.
  // Source: Sharp Football Analysis (2012-2023): wind > 15 mph reduces
  // passing efficiency ~12%, heavy precipitation reduces it ~8%.
  let weatherDelta = 0;
  let weatherEvidence = "Indoor or mild conditions — no weather impact";
  const weatherAvailable = ctx.weather !== null;

  if (ctx.weather && !ctx.weather.isDomed) {
    const parts: string[] = [];
    if (ctx.weather.windSpeed > 15) {
      weatherDelta -= 10;
      parts.push(`wind ${Math.round(ctx.weather.windSpeed)} mph`);
    }
    if (ctx.weather.precipitation > 0.5) {
      weatherDelta -= 8;
      parts.push(`rain probability ${Math.round(ctx.weather.precipitation * 100)}%`);
    }
    if (ctx.weather.temperature < 30) {
      weatherDelta += 5;
      parts.push(`temp ${Math.round(ctx.weather.temperature)}°F`);
    }
    weatherEvidence =
      parts.length > 0
        ? `Outdoor conditions: ${parts.join(", ")}`
        : `Outdoor, mild conditions (${Math.round(ctx.weather.temperature)}°F, wind ${Math.round(ctx.weather.windSpeed)} mph)`;
  }

  factors.push({
    key: "weather_ncaaf",
    label: "Weather conditions",
    homeDelta: weatherDelta,
    weight: 0.05,
    available: weatherAvailable,
    evidence: weatherEvidence,
  });

  // ── 3. Rest edge / bye week ───────────────────────────────────────────
  // Adapted from nfl.ts rest_edge_nfl factor. College football also has bye
  // weeks and the occasional Tuesday/Wednesday MAC midweek game, so the
  // short-week logic still applies.
  // Weight reduced from NFL's 0.05 to 0.04 to free budget for scoring trend.
  const homeRest = ctx.homeExtended.restDays ?? 7;
  const awayRest = ctx.awayExtended.restDays ?? 7;
  let restEdgeDelta = 0;
  let restEdgeEvidence = "Standard rest schedule";

  if (homeRest >= 10 && awayRest < 10) {
    restEdgeDelta = 35;
    restEdgeEvidence = `${ctx.game.homeTeam.abbreviation} coming off bye week (${homeRest} days rest)`;
  } else if (awayRest >= 10 && homeRest < 10) {
    restEdgeDelta = -35;
    restEdgeEvidence = `${ctx.game.awayTeam.abbreviation} coming off bye week (${awayRest} days rest)`;
  } else if (homeRest <= 4 && awayRest > homeRest) {
    restEdgeDelta = -15;
    restEdgeEvidence = `Short week for ${ctx.game.homeTeam.abbreviation} (${homeRest} days rest)`;
  } else if (awayRest <= 4 && homeRest > awayRest) {
    restEdgeDelta = 15;
    restEdgeEvidence = `Short week for ${ctx.game.awayTeam.abbreviation} (${awayRest} days rest)`;
  }

  factors.push({
    key: "rest_edge_ncaaf",
    label: "Bye / short week",
    homeDelta: restEdgeDelta,
    weight: 0.04,
    available: true,
    evidence: restEdgeEvidence,
  });

  // ── 4. Non-QB injuries ────────────────────────────────────────────────
  // Direct copy of nfl.ts injuries_nfl factor.
  let injuryDelta = 0;
  const injuryParts: string[] = [];

  for (const player of ctx.homeInjuries.out) {
    if (player.position === "QB") continue;
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
    key: "injuries_ncaaf",
    label: "Non-QB injury report",
    homeDelta: injuryDelta,
    weight: 0.08,
    available: true,
    evidence:
      injuryParts.length > 0
        ? injuryParts.slice(0, 4).join("; ") + (injuryParts.length > 4 ? ` (+${injuryParts.length - 4} more)` : "")
        : "No significant non-QB injuries reported",
  });

  // ── 5. Recent scoring trend ───────────────────────────────────────────
  // scoringTrend is in [-1, 1], positive = offense trending up. The ×30
  // multiplier matches NBA's net rating calibration (see nba.ts net_rating)
  // — a full +1 vs -1 swing produces 60 Elo points, comparable to a 2-pt
  // net rating swing in NBA.
  //
  // Defensive note: scoringTrend is non-optional `number` and defaults to 0
  // when the upstream extended-stats fetch fails. We can't distinguish "real
  // flat trend" from "fetch failed" — log a warning when one side is exactly
  // 0 while the other is non-zero so we can spot systematic data gaps.
  const homeTrend = ctx.homeExtended.scoringTrend;
  const awayTrend = ctx.awayExtended.scoringTrend;
  if ((homeTrend === 0) !== (awayTrend === 0)) {
    console.warn(
      `[ncaaf-factors] scoring trend imbalance for game ${ctx.game.id}: ` +
      `home=${homeTrend.toFixed(2)} away=${awayTrend.toFixed(2)} — ` +
      `one side may have failed to fetch extended stats`
    );
  }
  const trendDelta = (homeTrend - awayTrend) * 30;

  factors.push({
    key: "scoring_trend_ncaaf",
    label: "Recent scoring trend",
    homeDelta: trendDelta,
    weight: 0.05,
    available: true,
    evidence: `Home scoring trend ${homeTrend > 0 ? "+" : ""}${homeTrend.toFixed(2)} vs Away ${awayTrend > 0 ? "+" : ""}${awayTrend.toFixed(2)}`,
  });

  return factors;
}
