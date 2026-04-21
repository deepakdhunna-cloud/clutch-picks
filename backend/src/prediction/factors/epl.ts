/**
 * EPL-specific factors.
 *
 * Weight budget: 0.42 (remaining after 0.58 base). Four factors:
 *   - Fixture congestion (midweek cups / UCL):  0.112
 *   - Key player availability:                  0.168
 *   - Manager-change bounce:                    0.056
 *   - Stakes (title / Europe / relegation):     0.084
 *   → 0.42 exactly
 *
 * xG factor removed — Understat and FBRef are both Cloudflare-blocked from
 * Railway. If we add a proxy service or paid xG API later, re-add this
 * factor and rebalance weights.
 *
 * Data sources:
 *   - ESPN schedule for fixture congestion
 *   - ./data/soccerManagerChanges.json for new-manager windows
 *   - ESPN standings for stakes flags (6h cache)
 *
 * All deltas in rating points; positive = favors home.
 */

import type { GameContext, FactorContribution, SoccerStakes } from "../types";
import {
  fixtureCongestionFactor,
  keyPlayerFactor,
  managerChangeFactor,
} from "./soccerCommon";

export function computeEPLFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  factors.push(fixtureCongestionFactor(ctx, 0.112));   // 0.112
  factors.push(keyPlayerFactor(ctx, 0.168));           // 0.168
  factors.push(managerChangeFactor(ctx, 0.056));       // 0.056
  factors.push(stakesFactor(ctx));                     // 0.084

  return factors;
}

// ─── EPL-specific: late-season stakes ───────────────────────────────────────
// Fires only when BOTH teams have stakes data AND gamesRemaining < 10.
// Logic:
//   - Title race: home in top-3 and within 8pts of leader vs mid-table
//     opponent → +20 Elo home. Flipped if the away team is the motivated one.
//   - Relegation battle: home in bottom-6 vs a comfortable opponent → +25
//     Elo home (cornered-animal effect).
//   - Both motivated equally → 0 (signal cancels).

function stakesFactor(ctx: GameContext): FactorContribution {
  const weight = 0.084;
  const home = ctx.homeStakes ?? null;
  const away = ctx.awayStakes ?? null;
  const lateSeason =
    (home && home.gamesRemaining < 10) || (away && away.gamesRemaining < 10);

  if (!home || !away || !lateSeason) {
    return {
      key: "stakes",
      label: "Late-season stakes (title / relegation)",
      homeDelta: 0,
      weight,
      available: false,
      evidence: !home || !away
        ? "Standings data unavailable — stakes factor inactive, weight redistributed"
        : "Too early in season for stakes signal — factor inactive",
    };
  }

  const homeMotivation = motivationScore(home);
  const awayMotivation = motivationScore(away);
  const delta = homeMotivation - awayMotivation;

  const evidence = describeStakes(ctx, home, away);

  return {
    key: "stakes",
    label: "Late-season stakes (title / relegation)",
    homeDelta: delta,
    weight,
    available: true,
    evidence,
  };
}

function motivationScore(s: SoccerStakes): number {
  // Relegation > title > Europe. Only apply full weight in the final stretch.
  if (s.inRelegationRace) return 25;
  if (s.inTitleRace) return 20;
  if (s.inEuropeRace) return 10;
  return 0;
}

function describeStakes(
  ctx: GameContext,
  home: SoccerStakes,
  away: SoccerStakes,
): string {
  const hMark = stakesTag(home);
  const aMark = stakesTag(away);
  if (!hMark && !aMark) return "Both teams mid-table — no stakes edge";
  const parts: string[] = [];
  if (hMark) parts.push(`${ctx.game.homeTeam.abbreviation} ${hMark} (${home.gamesRemaining} games left)`);
  if (aMark) parts.push(`${ctx.game.awayTeam.abbreviation} ${aMark} (${away.gamesRemaining} games left)`);
  return parts.join(" vs ") + " — motivation edge";
}

function stakesTag(s: SoccerStakes): string | null {
  if (s.inRelegationRace) return "fighting relegation";
  if (s.inTitleRace) return "in title race";
  if (s.inEuropeRace) return "chasing European qualification";
  return null;
}
