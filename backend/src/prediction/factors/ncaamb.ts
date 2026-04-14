// TODO (Batch 5): Implement sport-specific factors for NCAAB.
// Currently returns an empty array, meaning NCAAB predictions run
// on generic base factors only. See audit report for context.

/**
 * College Basketball (NCAAB) specific factors — STUB.
 *
 * TODO: Implement full NCAAB factors:
 *   - Kenpom-style adjusted efficiency differential: 0.18
 *   - Home court (massive in college, already in base +100): included in base
 *   - Pace: 0.05
 *   - Key player availability: 0.10
 *   - Rest / travel: 0.05
 *   - Tournament / bracket stakes (March only): 0.04
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 */

import type { GameContext, FactorContribution } from "../types";

export function computeNCAAMBFactors(_ctx: GameContext): FactorContribution[] {
  // TODO: Implement. For now, return empty array so base factors carry all weight.
  return [];
}
