// TODO (Batch 5): Implement sport-specific factors for EPL.
// Currently returns an empty array, meaning EPL predictions run
// on generic base factors only. See audit report for context.

/**
 * EPL-specific factors — STUB.
 *
 * TODO: Implement full EPL factors:
 *   - European competition midweek fixture (UCL/UEL fatigue): 0.10
 *   - xG differential last 10: 0.08
 *   - Key player availability (top 3 by minutes): 0.12
 *   - Manager change in last 4 weeks: 0.02
 *   - Relegation / title race stakes: 0.05
 *   - Form last 5 weighted more: 0.05
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 */

import type { GameContext, FactorContribution } from "../types";

export function computeEPLFactors(_ctx: GameContext): FactorContribution[] {
  // TODO: Implement. For now, return empty array so base factors carry all weight.
  return [];
}
