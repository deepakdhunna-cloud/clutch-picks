/**
 * EPL-specific factors.
 *
 * Weight budget: 0.42 (remaining after 0.58 base). Five factors:
 *   - xG differential (Understat):              0.12
 *   - Fixture congestion (midweek cups / UCL):  0.08
 *   - Key player availability:                  0.12
 *   - Manager-change bounce:                    0.04
 *   - Stakes (title / Europe / relegation):     0.06
 *   → 0.42 exactly
 *
 * Data sources:
 *   - understat.com for xG (6h cache)
 *   - ESPN schedule for fixture congestion
 *   - ./data/soccerManagerChanges.json for new-manager windows
 *   - ESPN standings for stakes flags (6h cache)
 *
 * All deltas in rating points; positive = favors home.
 */

import type { GameContext, FactorContribution, SoccerStakes } from "../types";
import {
  xGFactor,
  fixtureCongestionFactor,
  keyPlayerFactor,
  managerChangeFactor,
} from "./soccerCommon";

export function computeEPLFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  factors.push(xGFactor(ctx));                         // 0.12
  factors.push(fixtureCongestionFactor(ctx, 0.08));    // 0.08
  factors.push(keyPlayerFactor(ctx, 0.12));            // 0.12
  factors.push(managerChangeFactor(ctx, 0.04));        // 0.04
  factors.push(stakesFactor(ctx));                     // 0.06

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
  const weight = 0.06;
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
