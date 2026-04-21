/**
 * UCL-specific factors.
 *
 * Weight budget: 0.42. Five factors:
 *   - xG differential (FBRef, cross-league):    0.12
 *   - Fixture congestion (heavier than EPL):        0.10
 *   - Key player availability (slightly lighter):   0.10
 *   - Competition stage / pedigree:                 0.06
 *   - Continental travel burden:                    0.04
 *   → 0.42 exactly
 *
 * Note: UCL teams come from multiple domestic leagues, so xG is looked up
 * by trying EPL → La_Liga → Bundesliga → Serie_A → Ligue_1 in order (done
 * upstream in shadow.ts `buildGameContext`). All we see here is the
 * resolved `homeXG` / `awayXG`.
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

  // 1. xG — same shape as EPL but with a cross-league evidence note. We
  //    inline it here (rather than reusing soccerCommon.xGFactor) so the
  //    evidence string can say "xG via {league}" for each team. When both
  //    teams have no FBRef data, the factor is unavailable.
  factors.push(buildUCLxGFactor(ctx));                 // 0.12

  // 2. Fixture congestion — slightly higher weight (0.10 vs EPL's 0.08)
  //    because UCL teams pull double duty (domestic league + UCL + cup).
  factors.push(fixtureCongestionFactor(ctx, 0.10));    // 0.10

  // 3. Key-player availability — 0.10 (vs EPL's 0.12): UCL squads tend to
  //    be deeper so missing one player hurts a little less.
  factors.push(keyPlayerFactor(ctx, 0.10));            // 0.10

  // 4. Pedigree (competition stage) — 0.06
  factors.push(pedigreeFactor(ctx));                   // 0.06

  // 5. Continental travel — 0.04
  factors.push(travelFactor(ctx));                     // 0.04

  return factors;
}

// ─── xG with cross-league evidence ──────────────────────────────────────────

function buildUCLxGFactor(ctx: GameContext): FactorContribution {
  const home = ctx.homeXG ?? null;
  const away = ctx.awayXG ?? null;
  const enoughSample =
    home !== null && away !== null && home.games >= 10 && away.games >= 10;

  let delta = 0;
  let evidence =
    "FBRef xG unavailable for one or both UCL teams — factor inactive, weight redistributed";

  if (enoughSample) {
    const diff = home!.xgDiffPerGame - away!.xgDiffPerGame;
    delta = Math.max(-60, Math.min(60, diff * 30));
    const sign = diff >= 0 ? "+" : "";
    evidence = `${ctx.game.homeTeam.abbreviation} xG diff ${home!.xgDiffPerGame >= 0 ? "+" : ""}${home!.xgDiffPerGame.toFixed(2)}/game (FBRef) vs ${ctx.game.awayTeam.abbreviation} ${away!.xgDiffPerGame >= 0 ? "+" : ""}${away!.xgDiffPerGame.toFixed(2)}/game (${sign}${diff.toFixed(2)} advantage, ~${Math.round(delta)} Elo)`;
  }

  return {
    key: "xg_differential",
    label: "FBRef xG differential (cross-league)",
    homeDelta: delta,
    weight: 0.12,
    available: enoughSample,
    evidence,
  };
}

// ─── Pedigree ──────────────────────────────────────────────────────────────
// Use the seeded 5-year UCL Elo-like rating to reward recent European
// experience. Each 100 pts of pedigree difference ≈ 8 Elo, capped ±25.

function pedigreeFactor(ctx: GameContext): FactorContribution {
  const weight = 0.06;
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
  const weight = 0.04;
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
