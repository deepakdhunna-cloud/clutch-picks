/**
 * EPL-specific factors.
 *
 * Weight budget: 0.42 (remaining after 0.58 base). Five factors:
 *   - xG differential (strongest predictor):      0.14
 *   - Key player availability:                    0.12
 *   - Fixture congestion (midweek cups / UCL):    0.07
 *   - Manager-change bounce:                      0.03
 *   - Stakes (title / Europe / relegation):       0.06
 *   → 0.42 exactly
 *
 * xG factor RE-ADDED (2026-06-05): Using FBref/Understat pipeline.
 * xG is the single best predictor in soccer — far better than actual goals.
 *
 * Data sources:
 *   - FBref/Understat for xG (via soccerXg.ts)
 *   - ESPN schedule for fixture congestion
 *   - ./data/soccerManagerChanges.json for new-manager windows
 *   - ESPN standings for stakes flags (6h cache)
 *
 * All deltas in rating points; positive = favors home.
 */

import type { GameContext, FactorContribution, SoccerStakes } from "../types";
import type { TeamXgMetrics } from "../../lib/soccerXg";
import {
  xgDifferentialFactor,
  fixtureCongestionFactor,
  keyPlayerFactor,
  managerChangeFactor,
} from "./soccerCommon";

export function computeEPLFactors(
  ctx: GameContext,
  homeXg?: TeamXgMetrics | null,
  awayXg?: TeamXgMetrics | null,
): FactorContribution[] {
  const factors: FactorContribution[] = [];

  factors.push(xgDifferentialFactor(ctx, 0.14, homeXg ?? null, awayXg ?? null));
  factors.push(keyPlayerFactor(ctx, 0.12));
  factors.push(fixtureCongestionFactor(ctx, 0.07));
  factors.push(managerChangeFactor(ctx, 0.03));
  factors.push(stakesFactor(ctx));

  return factors;
}

// ─── EPL-specific: late-season stakes ───────────────────────────────────────

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
      hasSignal: false,
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
    hasSignal: delta !== 0,
    evidence,
  };
}

function motivationScore(s: SoccerStakes): number {
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
