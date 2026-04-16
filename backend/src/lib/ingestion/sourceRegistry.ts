/**
 * Source registry — who the ingestion pipeline listens to and how much
 * weight each source carries.
 *
 * Credibility tiers translate to a 0..1 multiplier applied to every
 * extracted signal. A Woj/Shams tweet ("tier1") lands with ~0.95, a beat
 * writer scoop ("tier2") ~0.75, a Reddit rumor ("tier3") ~0.40. The
 * stateStore uses this score to decide which of two competing signals
 * about the same player wins.
 *
 * NBA is the pilot; other sports get their own *Sources.json file later.
 */

import nbaRaw from "./data/nbaSources.json" assert { type: "json" };

export type SourceType = "rss" | "twitter" | "official_report";
export type CredibilityTier = "tier1" | "tier2" | "tier3";

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  url: string;                 // RSS URL or Twitter profile URL
  sport: string;               // "NBA", "NFL", etc.
  teams?: string[];            // team abbrs this source covers; empty = league-wide
  credibility: CredibilityTier;
  enabled: boolean;
  pollIntervalMs: number;
  lastPolledAt?: string;
}

export const CREDIBILITY_SCORES: Record<CredibilityTier, number> = {
  tier1: 0.95,
  tier2: 0.75,
  tier3: 0.40,
};

export function credibilityScore(tier: CredibilityTier): number {
  return CREDIBILITY_SCORES[tier];
}

interface RawSourceFile {
  _meta?: unknown;
  sources: Source[];
}

export function loadNBASources(): Source[] {
  const file = nbaRaw as unknown as RawSourceFile;
  return (file.sources ?? []).filter((s) => s.enabled);
}
