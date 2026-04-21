/**
 * MLS-specific factors.
 *
 * Same four factors as EPL, same redistribution (0.112 / 0.168 / 0.056 / 0.084
 * = 0.42).
 *
 * xG factor removed — no viable xG data source works from Railway.
 * If we add an ASA integration or paid xG API later, re-add and rebalance.
 *
 * Stakes mapping for MLS:
 *   - "title race" = top-of-conference / Supporters' Shield chase (rank ≤ 3)
 *   - "relegation race" = there is no relegation in MLS, but the flag is
 *     reused by soccerStandings.computeStakes to signal bottom-4 teams
 *     fighting for a playoff spot. Kept under the same key for consistency.
 *   - "Europe race" flag is unused (stays false).
 */

import type { GameContext, FactorContribution, SoccerStakes } from "../types";
import {
  fixtureCongestionFactor,
  keyPlayerFactor,
  managerChangeFactor,
} from "./soccerCommon";

export function computeMLSFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  factors.push(fixtureCongestionFactor(ctx, 0.112));   // 0.112
  factors.push(keyPlayerFactor(ctx, 0.168));           // 0.168
  factors.push(managerChangeFactor(ctx, 0.056));       // 0.056
  factors.push(stakesFactor(ctx));                     // 0.084

  return factors;
}

// ─── MLS-specific stakes ────────────────────────────────────────────────────
// Same signal shape as EPL but lightly relabeled so the evidence string
// doesn't mention "relegation" (MLS doesn't relegate).

function stakesFactor(ctx: GameContext): FactorContribution {
  const weight = 0.084;
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
    evidence,
  };
}

function motivationScore(s: SoccerStakes): number {
  // MLS re-uses the "relegation race" flag for playoff-bubble teams.
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
