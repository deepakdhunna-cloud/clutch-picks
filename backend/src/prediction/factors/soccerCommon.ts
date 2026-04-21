/**
 * Shared soccer factor primitives.
 *
 * EPL, MLS, and UCL all use the same math for:
 *   - Fixture congestion penalty
 *   - Key-player availability (out + doubtful)
 *   - Manager-bounce window
 *
 * xG factor removed — Understat and FBRef are both Cloudflare-blocked from
 * Railway. If we add a proxy service or paid xG API later, re-add this
 * factor and rebalance weights.
 *
 * Keeping these in one place means any calibration tweak lands in all
 * three sports at once. The league-specific files compose these with
 * their own factors (stakes for EPL/MLS, pedigree + travel for UCL).
 */

import type { GameContext, FactorContribution } from "../types";

// ─── 1. Fixture congestion ──────────────────────────────────────────────────
// Soccer teams playing 3+ games in 7 days show measurable fatigue. Penalty:
// -20 Elo per excess game applied to the congested team; max ±40.

export function fixtureCongestionFactor(
  ctx: GameContext,
  weight: number,
): FactorContribution {
  const home = ctx.homeFixtureCongestion ?? null;
  const away = ctx.awayFixtureCongestion ?? null;
  const available = home !== null || away !== null;

  const homeExcess = home ? Math.max(0, home.gamesLast7Days - 2) : 0;
  const awayExcess = away ? Math.max(0, away.gamesLast7Days - 2) : 0;

  // Positive = favors home. Away congested → favors home.
  const raw = awayExcess * 20 - homeExcess * 20;
  const delta = Math.max(-40, Math.min(40, raw));

  const parts: string[] = [];
  if (home && home.gamesLast7Days >= 3) {
    parts.push(`${ctx.game.homeTeam.abbreviation} played ${home.gamesLast7Days} matches in last 7 days`);
  }
  if (away && away.gamesLast7Days >= 3) {
    parts.push(`${ctx.game.awayTeam.abbreviation} played ${away.gamesLast7Days} matches in last 7 days`);
  }
  const evidence =
    parts.length > 0
      ? parts.join("; ") + " — fatigue factor"
      : available
        ? `Neither team exceeded 2 matches in last 7 days — no congestion signal`
        : "Fixture congestion data unavailable";

  return {
    key: "fixture_congestion",
    label: "Fixture congestion (recent matches)",
    homeDelta: delta,
    weight,
    available,
    hasSignal: available && delta !== 0,
    evidence,
  };
}

// ─── 3. Key-player availability ─────────────────────────────────────────────
// Soccer-specific weighting: OUT = 25 Elo, DOUBTFUL = 12 Elo. Cap ±75 per
// team. Always available (we treat "no injuries listed" as a valid signal).

export function keyPlayerFactor(
  ctx: GameContext,
  weight: number,
): FactorContribution {
  const impact = (list: GameContext["homeInjuries"]): number =>
    Math.min(75, list.out.length * 25 + list.doubtful.length * 12);

  const homeImpact = impact(ctx.homeInjuries);
  const awayImpact = impact(ctx.awayInjuries);
  const delta = awayImpact - homeImpact;

  const topNames = (list: GameContext["homeInjuries"]): string[] => {
    const out = list.out.slice(0, 3).map((p) => `${p.name} (OUT)`);
    const remaining = Math.max(0, 3 - out.length);
    const dou = list.doubtful.slice(0, remaining).map((p) => `${p.name} (DOUBTFUL)`);
    return [...out, ...dou];
  };

  const homeList = topNames(ctx.homeInjuries);
  const awayList = topNames(ctx.awayInjuries);
  const parts: string[] = [];
  if (homeList.length) parts.push(`${ctx.game.homeTeam.abbreviation}: ${homeList.join(", ")}`);
  if (awayList.length) parts.push(`${ctx.game.awayTeam.abbreviation}: ${awayList.join(", ")}`);

  const evidence =
    parts.length > 0
      ? parts.join("; ")
      : "No significant availability concerns reported for either team";

  return {
    key: "key_player_availability",
    label: "Key player availability",
    homeDelta: delta,
    weight,
    available: true,
    hasSignal: delta !== 0,
    evidence,
  };
}

// ─── 4. Manager change bounce ───────────────────────────────────────────────
// 15 Elo to the team inside its 30-day new-manager window.

export function managerChangeFactor(
  ctx: GameContext,
  weight: number,
): FactorContribution {
  const home = ctx.homeManagerChange ?? null;
  const away = ctx.awayManagerChange ?? null;

  const homeBounce = home && home.daysSinceChange < 30 ? 15 : 0;
  const awayBounce = away && away.daysSinceChange < 30 ? 15 : 0;
  const delta = homeBounce - awayBounce;

  const available = home !== null || away !== null;

  const parts: string[] = [];
  if (home && home.daysSinceChange < 30) {
    parts.push(`${ctx.game.homeTeam.abbreviation} under ${home.newManager} (${home.daysSinceChange} days)`);
  }
  if (away && away.daysSinceChange < 30) {
    parts.push(`${ctx.game.awayTeam.abbreviation} under ${away.newManager} (${away.daysSinceChange} days)`);
  }
  const evidence =
    parts.length > 0
      ? parts.join("; ") + " — typical new-manager bounce window"
      : "No recent manager change affecting this match";

  return {
    key: "manager_change",
    label: "New manager bounce",
    homeDelta: delta,
    weight,
    available,
    hasSignal: delta !== 0,
    evidence,
  };
}
