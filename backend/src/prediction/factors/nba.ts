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
  //
  // Live data: stats.nba.com teamgamelog (see lib/nbaStatsApi.ts) gives us
  // FG3M/FG3A per game. We compare recent 5-game 3P% to season 3P% and
  // apply a regression-to-the-mean delta:
  //   - Home shooting > +3pts hot  → negative home delta (expect cooldown)
  //   - Home shooting < -3pts cold → positive home delta (expect recovery)
  //   - Away shooting hot/cold flips sign.
  // Scale: 1 percentage point of deviation ≈ 8 Elo points. Cap ±25.
  const homeShooting = ctx.homeShooting ?? null;
  const awayShooting = ctx.awayShooting ?? null;
  const shootingAvailable =
    (homeShooting !== null && homeShooting.gamesUsed >= 5) ||
    (awayShooting !== null && awayShooting.gamesUsed >= 5);

  let threePtDelta = 0;
  let threePtEvidence =
    "Per-game 3P% data unavailable from stats.nba.com — factor inactive, weight redistributed";

  function deviationDelta(s: { recent3P: number; season3P: number }): number {
    // recent - season, in percentage points (e.g. 0.421 - 0.358 = 0.063 → 6.3)
    const diffPts = (s.recent3P - s.season3P) * 100;
    // Only apply when deviation exceeds 3 percentage points
    if (Math.abs(diffPts) < 3) return 0;
    // Regression signal: if team is hot (+diff), expect them to cool off
    // → negative contribution for that team. Scale 8 Elo per pt, cap ±25.
    const raw = -diffPts * 8;
    return Math.max(-25, Math.min(25, raw));
  }

  function fmtEvidence(
    label: string,
    s: { recent3P: number; season3P: number; gamesUsed: number },
  ): string {
    const recentPct = (s.recent3P * 100).toFixed(1);
    const seasonPct = (s.season3P * 100).toFixed(1);
    const diff = (s.recent3P - s.season3P) * 100;
    const sign = diff >= 0 ? "+" : "";
    const verdict = diff > 0 ? "expect regression" : "expect rebound";
    return `${label} shooting ${recentPct}% L${s.gamesUsed} vs season ${seasonPct}% (${sign}${diff.toFixed(1)}pts — ${verdict})`;
  }

  if (shootingAvailable) {
    // Positive = favors home. Home hot → negative home delta.
    // Away hot → regression hurts away → positive home delta (flip sign).
    const homeSide = homeShooting && homeShooting.gamesUsed >= 5 ? deviationDelta(homeShooting) : 0;
    const awaySide = awayShooting && awayShooting.gamesUsed >= 5 ? -deviationDelta(awayShooting) : 0;
    threePtDelta = Math.max(-25, Math.min(25, homeSide + awaySide));

    // Only mention a team in the evidence when its deviation actually crossed
    // the 3-pt threshold — otherwise the copy disagrees with the 0 delta.
    const homeDeviates =
      !!homeShooting &&
      homeShooting.gamesUsed >= 5 &&
      Math.abs((homeShooting.recent3P - homeShooting.season3P) * 100) >= 3;
    const awayDeviates =
      !!awayShooting &&
      awayShooting.gamesUsed >= 5 &&
      Math.abs((awayShooting.recent3P - awayShooting.season3P) * 100) >= 3;

    const parts: string[] = [];
    if (homeDeviates) parts.push(fmtEvidence(ctx.game.homeTeam.abbreviation, homeShooting!));
    if (awayDeviates) parts.push(fmtEvidence(ctx.game.awayTeam.abbreviation, awayShooting!));

    threePtEvidence =
      parts.length > 0
        ? parts.join("; ")
        : `${ctx.game.homeTeam.abbreviation} and ${ctx.game.awayTeam.abbreviation} shooting within 3pts of season averages — no regression signal`;
  }

  factors.push({
    key: "three_point_regression",
    label: "Three-point shooting regression",
    homeDelta: threePtDelta,
    weight: 0.03,
    available: shootingAvailable,
    evidence: threePtEvidence,
  });

  return factors;
}
