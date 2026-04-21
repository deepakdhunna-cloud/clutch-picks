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
 * Pedigree and city coords live in seed JSON files in lib/data/.
 */

import type { GameContext, FactorContribution } from "../types";
import { fixtureCongestionFactor, keyPlayerFactor } from "./soccerCommon";
import pedigreeRaw from "../../lib/data/uclPedigree.json" assert { type: "json" };
import cityCoordsRaw from "../../lib/data/uclCityCoords.json" assert { type: "json" };

// ─── Seed data ──────────────────────────────────────────────────────────────

interface PedigreeFile {
  _meta?: unknown;
  pedigree: Record<string, number>;
}
interface CityCoordsFile {
  _meta?: unknown;
  cities: Record<string, [number, number]>;   // [lat, lon]
  teamCity: Record<string, string>;
}

const PEDIGREE = (pedigreeRaw as unknown as PedigreeFile).pedigree ?? {};
const COORDS = cityCoordsRaw as unknown as CityCoordsFile;

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
// Use the seeded 5-year UCL Elo-like rating to reward recent European
// experience. Each 100 pts of pedigree difference ≈ 8 Elo, capped ±25.

function pedigreeFactor(ctx: GameContext): FactorContribution {
  const weight = 0.084;
  const homePed = PEDIGREE[ctx.game.homeTeam.name];
  const awayPed = PEDIGREE[ctx.game.awayTeam.name];

  if (homePed === undefined || awayPed === undefined) {
    return {
      key: "ucl_pedigree",
      label: "UCL competition stage / pedigree",
      homeDelta: 0,
      weight,
      available: false,
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
    evidence,
  };
}

// ─── Continental travel ─────────────────────────────────────────────────────
// Haversine distance between home and away cities. If >1500km AND the two
// cities are in different countries (approximated by "different city
// entries"), we dock 15 Elo from the away side (which is home-positive).

function travelFactor(ctx: GameContext): FactorContribution {
  const weight = 0.056;
  const homeCity = COORDS.teamCity[ctx.game.homeTeam.name];
  const awayCity = COORDS.teamCity[ctx.game.awayTeam.name];
  if (!homeCity || !awayCity) {
    return {
      key: "ucl_travel",
      label: "Continental travel burden",
      homeDelta: 0,
      weight,
      available: false,
      evidence: `City coordinates unavailable for ${homeCity ? ctx.game.awayTeam.name : ctx.game.homeTeam.name} — travel factor inactive`,
    };
  }

  const homeCoord = COORDS.cities[homeCity];
  const awayCoord = COORDS.cities[awayCity];
  if (!homeCoord || !awayCoord) {
    return {
      key: "ucl_travel",
      label: "Continental travel burden",
      homeDelta: 0,
      weight,
      available: false,
      evidence: "City coordinate lookup failed — travel factor inactive",
    };
  }

  const km = haversineKm(homeCoord, awayCoord);
  if (homeCity === awayCity || km < 1500) {
    return {
      key: "ucl_travel",
      label: "Continental travel burden",
      homeDelta: 0,
      weight,
      available: true,
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
    evidence: `${ctx.game.awayTeam.name} traveled ~${Math.round(km)}km to ${homeCity} — long-travel fatigue factor (+${delta} Elo home)`,
  };
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
