/**
 * College Football (NCAAF) specific factors — STUB.
 *
 * TODO: Implement full NCAAF factors:
 *   - Talent gap proxy (recruiting class ranking): 0.10
 *   - Home crowd factor (known hostile stadiums): 0.05
 *   - Rivalry / bowl / CFP stakes motivation: 0.05
 *   - Starting QB status: 0.15
 *   - Pace / tempo mismatch: 0.03
 *   - Conference strength (folded into Elo): included in base
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 */

import type { GameContext, FactorContribution } from "../types";

export function computeNCAAFBFactors(_ctx: GameContext): FactorContribution[] {
  // TODO: Implement. For now, return empty array so base factors carry all weight.
  return [];
}
