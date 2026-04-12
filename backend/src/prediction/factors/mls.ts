/**
 * MLS-specific factors — STUB.
 *
 * TODO: Implement full MLS factors:
 *   - Midweek congestion (games in last 7 days > 2): 0.08
 *   - Key striker / keeper availability: 0.14
 *   - Current form streak (last 5 weighted more): 0.10
 *   - Standings stakes (playoff race late season): 0.05
 *   - Expected goals (xG) differential over last 10: 0.05
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 */

import type { GameContext, FactorContribution } from "../types";

export function computeMLSFactors(_ctx: GameContext): FactorContribution[] {
  // TODO: Implement. For now, return empty array so base factors carry all weight.
  return [];
}
