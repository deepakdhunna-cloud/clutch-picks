/**
 * UCL-specific factors.
 *
 * Weight budget: 0.42. Four factors:
 *   - Fixture congestion (heavier — double duty):   0.14
 *   - Key player availability:                      0.14
 *   - Competition stage / pedigree:                 0.084
 *   - Continental travel burden:                    0.056
 *   → 0.42 exactly
 *
 * xG factor removed — Understat and FBRef are both Cloudflare-blocked from
 * Railway. If we add a proxy service or paid xG API later, re-add this
 * factor and rebalance weights.
 *
 * Pedigree and travel factors use verified JSON tables in lib/data/.
 * When those tables are empty, the factors stay unavailable.
 */

import type { GameContext, FactorContribution } from "../types";
import { fixtureCongestionFactor, keyPlayerFactor } from "./soccerCommon";

// ─── Public entrypoint ──────────────────────────────────────────────────────

export function computeUCLFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // 1. Fixture congestion — higher weight because UCL teams pull double
  //    duty (domestic league + UCL + cup).
  factors.push(fixtureCongestionFactor(ctx, 0.14));    // 0.14

  // 2. Key-player availability — UCL squads tend to be deeper so missing
  //    one player hurts a little less than domestic.
  factors.push(keyPlayerFactor(ctx, 0.14));            // 0.14

  // 3. Pedigree (competition stage) — 0.084
  factors.push(pedigreeFactor(ctx));                   // 0.084

  // 4. Continental travel — 0.056
  factors.push(travelFactor(ctx));                     // 0.056

  return factors;
}

// ─── Pedigree ──────────────────────────────────────────────────────────────
// Use verified UCL pedigree ratings only. Each 100 pts of pedigree difference
// is worth ≈8 Elo, capped ±25. Empty data keeps this factor unavailable.

function pedigreeFactor(ctx: GameContext): FactorContribution {
  const weight = 0.084;
  const homePed = ctx.uclPedigree?.home;
  const awayPed = ctx.uclPedigree?.away;

  if (homePed === undefined || awayPed === undefined) {
    return {
      key: "ucl_pedigree",
      label: "UCL competition stage / pedigree",
      homeDelta: 0,
      weight,
      available: false,
      hasSignal: false,
      evidence: `UCL pedigree data unavailable for ${homePed === undefined ? ctx.game.homeTeam.name : ctx.game.awayTeam.name} — factor inactive`,
    };
  }

  const pedDiff = homePed - awayPed;
  const raw = (pedDiff / 100) * 8;
  const delta = Math.max(-25, Math.min(25, raw));

  const evidence = `${ctx.game.homeTeam.name} (UCL pedigree ${homePed}) vs ${ctx.game.awayTeam.name} (UCL pedigree ${awayPed}) in knockout — ${delta >= 0 ? "+" : ""}${Math.round(delta)} Elo experience edge`;

  return {
    key: "ucl_pedigree",
    label: "UCL competition stage / pedigree",
    homeDelta: delta,
    weight,
    available: true,
    hasSignal: delta !== 0,
    evidence,
  };
}

// ─── Continental travel ─────────────────────────────────────────────────────
// Haversine distance between home and away cities. If >1500km AND the two
// cities are in different countries (approximated by "different city
// entries"), we dock 15 Elo from the away side (which is home-positive).

function travelFactor(ctx: GameContext): FactorContribution {
  const weight = 0.056;
  const travel = ctx.uclTravel;
  if (!travel) {
    return {
      key: "ucl_travel",
      label: "Continental travel burden",
      homeDelta: 0,
      weight,
      available: false,
      hasSignal: false,
      evidence: "Verified UCL team location data unavailable — travel factor inactive",
    };
  }

  const km = travel.distanceKm;
  if (travel.homeCity === travel.awayCity || km < 1500) {
    return {
      key: "ucl_travel",
      label: "Continental travel burden",
      homeDelta: 0,
      weight,
      available: true,
      hasSignal: false,
      evidence: `${ctx.game.awayTeam.name} traveled ~${Math.round(km)}km — under 1500km threshold, no travel penalty`,
    };
  }

  // >1500km → away team fatigued → +15 Elo for home.
  const delta = 15;
  return {
    key: "ucl_travel",
    label: "Continental travel burden",
    homeDelta: delta,
    weight,
    available: true,
    hasSignal: true,
    evidence: `${ctx.game.awayTeam.name} traveled ~${Math.round(km)}km to ${travel.homeCity} — long-travel fatigue factor (+${delta} Elo home)`,
  };
}
