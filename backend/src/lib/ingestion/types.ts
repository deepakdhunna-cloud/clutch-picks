/**
 * Shared types for the ingestion pipeline.
 *
 * RawNewsItem is the output of the RSS/Twitter workers. It's the common
 * shape the LLM extractor consumes, regardless of origin.
 *
 * ExtractedSignal is what the LLM emits per article/tweet — a
 * structured, validated availability decision. A single RawNewsItem
 * can produce 0..N signals (one per player mentioned).
 */

import type { CredibilityTier } from "./sourceRegistry";

export interface RawNewsItem {
  sourceId: string;
  sourceName: string;
  sourceType: "rss" | "twitter" | "official_report";
  credibilityTier: CredibilityTier;
  credibility: number;      // 0..1 convenience copy of the tier score
  title: string;
  content: string;          // full body (RSS) OR tweet text (Twitter)
  url: string;              // canonical link — used for dedup
  publishedAt: string;      // ISO
  teams?: string[];         // team abbrs the source is dedicated to (null = league-wide)
}

export type PlayerStatus =
  | "out"
  | "doubtful"
  | "questionable"
  | "probable"
  | "available"
  | "minutes_restriction"
  | "game_time_decision";

export type Severity = "critical" | "moderate" | "minor";

export interface ExtractedSignal {
  playerName: string;
  teamAbbreviation: string;
  status: PlayerStatus;
  confidence: number;       // 0..1 — LLM's extraction confidence
  severity: Severity;
  source: string;           // headline or tweet text (bounded)
  sourceCredibility: number;
  reasoning: string;
  gameImpactElo: number;    // -120..+120
}

export const PLAYER_STATUS_VALUES: readonly PlayerStatus[] = [
  "out",
  "doubtful",
  "questionable",
  "probable",
  "available",
  "minutes_restriction",
  "game_time_decision",
];

export const SEVERITY_VALUES: readonly Severity[] = [
  "critical",
  "moderate",
  "minor",
];
