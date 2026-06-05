/**
 * UCL-specific factors.
 *
 * Weight budget: 0.42. Five factors:
 *   - xG differential (strongest predictor):      0.12
 *   - Key player availability:                    0.10
 *   - Fixture congestion (heavier — double duty): 0.10
 *   - Competition stage / pedigree:               0.06
 *   - Continental travel burden:                  0.04
 *   → 0.42 exactly
 *
 * xG factor RE-ADDED (2026-06-05): Using FBref/Understat pipeline.
 * For UCL, xG data comes from the team's domestic league performance
 * (since UCL-only xG is sparse). This is a reasonable proxy because
 * UCL teams' attacking quality correlates strongly with domestic xG.
 *
 * Pedigree and travel factors use verified JSON tables in lib/data/.
 * When those tables are empty, the factors stay unavailable.
 */

import type { GameContext, FactorContribution } from "../types";
import type { TeamXgMetrics } from "../../lib/soccerXg";
import { xgDifferentialFactor, fixtureCongestionFactor, keyPlayerFactor } from "./soccerCommon";

// ─── Public entrypoint ──────────────────────────────────────────────────────

export function computeUCLFactors(
  ctx: GameContext,
  homeXg?: TeamXgMetrics | null,
  awayXg?: TeamXgMetrics | null,
): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // 1. xG differential — strongest signal
  factors.push(xgDifferentialFactor(ctx, 0.12, homeXg ?? null, awayXg ?? null));

  // 2. Key-player availability
  factors.push(keyPlayerFactor(ctx, 0.10));

  // 3. Fixture congestion — higher weight because UCL teams pull double duty
  factors.push(fixtureCongestionFactor(ctx, 0.10));

  // 4. Pedigree (competition stage)
  factors.push(pedigreeFactor(ctx));

  // 5. Continental travel
  factors.push(travelFactor(ctx));

  return factors;
}

// ─── Pedigree ──────────────────────────────────────────────────────────────
// Use verified UCL pedigree ratings only. Each 100 pts of pedigree difference
// is worth ≈8 Elo, capped ±25. Empty data keeps this factor unavailable.

function pedigreeFactor(ctx: GameContext): FactorContribution {
  const weight = 0.06;
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
// cities are in different countries, we dock 15 Elo from the away side.

function travelFactor(ctx: GameContext): FactorContribution {
  const weight = 0.04;
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
