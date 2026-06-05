/**
 * MLS-specific factors.
 *
 * Weight budget: 0.42 (remaining after 0.58 base). Five factors:
 *   - xG differential (strongest predictor):      0.14
 *   - Key player availability:                    0.12
 *   - Fixture congestion:                         0.07
 *   - Manager-change bounce:                      0.03
 *   - Stakes (playoff race / Shield):             0.06
 *   → 0.42 exactly
 *
 * xG factor RE-ADDED (2026-06-05): Using FBref/Understat pipeline.
 *
 * Stakes mapping for MLS:
 *   - "title race" = top-of-conference / Supporters' Shield chase (rank ≤ 3)
 *   - "relegation race" = reused for bottom-4 teams fighting for playoff spot
 *   - "Europe race" flag is unused (stays false).
 */

import type { GameContext, FactorContribution, SoccerStakes } from "../types";
import type { TeamXgMetrics } from "../../lib/soccerXg";
import {
  xgDifferentialFactor,
  fixtureCongestionFactor,
  keyPlayerFactor,
  managerChangeFactor,
} from "./soccerCommon";

export function computeMLSFactors(
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

// ─── MLS-specific stakes ────────────────────────────────────────────────────

function stakesFactor(ctx: GameContext): FactorContribution {
  const weight = 0.06;
  const home = ctx.homeStakes ?? null;
  const away = ctx.awayStakes ?? null;
  const lateSeason =
    (home && home.gamesRemaining < 10) || (away && away.gamesRemaining < 10);

  if (!home || !away || !lateSeason) {
    return {
      key: "stakes",
      label: "Playoff-race stakes",
      homeDelta: 0,
      weight,
      available: false,
      hasSignal: false,
      evidence: !home || !away
        ? "Standings data unavailable — stakes factor inactive, weight redistributed"
        : "Too early in season for stakes signal — factor inactive",
    };
  }

  const delta = motivationScore(home) - motivationScore(away);
  const evidence = describe(ctx, home, away);

  return {
    key: "stakes",
    label: "Playoff-race stakes",
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
  return 0;
}

function describe(ctx: GameContext, home: SoccerStakes, away: SoccerStakes): string {
  const h = tag(home);
  const a = tag(away);
  if (!h && !a) return "Both teams comfortably mid-table — no stakes edge";
  const parts: string[] = [];
  if (h) parts.push(`${ctx.game.homeTeam.abbreviation} ${h} (${home.gamesRemaining} games left)`);
  if (a) parts.push(`${ctx.game.awayTeam.abbreviation} ${a} (${away.gamesRemaining} games left)`);
  return parts.join(" vs ") + " — motivation edge";
}

function tag(s: SoccerStakes): string | null {
  if (s.inRelegationRace) return "fighting for playoff spot";
  if (s.inTitleRace) return "chasing Supporters' Shield";
  return null;
}
