/**
 * Factor-driven narrative generator — STUB.
 *
 * TODO (Section 6): Implement the full narrative pipeline:
 *   1. Sort factors by abs(homeDelta * weight) descending
 *   2. Extract top 3 contributing factors + counterpoint
 *   3. Build structured narrative object
 *   4. Feed to GPT-4o-mini with strict prompt (80-150 words, no hype)
 *   5. Word count enforcement with deterministic fallback
 *   6. Cache per (gameId, factorHash)
 *
 * For now, returns a simple template built from the factor list.
 */

import type { FactorContribution, ConfidenceBand } from "./types";

export function buildNarrative(
  factors: FactorContribution[],
  confidenceBand: ConfidenceBand,
  homeTeamAbbr: string,
  awayTeamAbbr: string,
  winnerAbbr: string | null,
): string {
  // Sort by impact (abs delta * weight), descending
  const sorted = [...factors]
    .filter((f) => f.available)
    .sort((a, b) => Math.abs(b.homeDelta * b.weight) - Math.abs(a.homeDelta * a.weight));

  const top3 = sorted.slice(0, 3);
  const counterpoint = sorted.find(
    (f) =>
      winnerAbbr !== null &&
      ((winnerAbbr === homeTeamAbbr && f.homeDelta < 0) ||
        (winnerAbbr === awayTeamAbbr && f.homeDelta > 0))
  );

  if (winnerAbbr === null) {
    return `This projects as a toss-up. ${homeTeamAbbr} and ${awayTeamAbbr} are essentially indistinguishable by the model. ${top3[0]?.evidence ?? "No dominant factor."} Either side could win without it being a surprise.`;
  }

  const lines: string[] = [];

  // Lead with top factor
  if (top3[0]) {
    lines.push(`${top3[0].label}: ${top3[0].evidence}.`);
  }

  // Supporting factors
  for (const f of top3.slice(1)) {
    lines.push(`${f.label}: ${f.evidence}.`);
  }

  // Counterpoint
  if (counterpoint) {
    lines.push(`Counter: ${counterpoint.evidence}.`);
  }

  // Band framing
  const bandFraming: Record<ConfidenceBand, string> = {
    coinflip: `This is essentially a coin flip with a slight lean toward ${winnerAbbr}.`,
    "slight edge": `${winnerAbbr} has a modest edge but this could go either way.`,
    "clear edge": `The data clearly favors ${winnerAbbr} here.`,
    "strong edge": `Strong separation in the data — ${winnerAbbr} is the clear call.`,
  };
  lines.push(bandFraming[confidenceBand]);

  return lines.join(" ");
}
