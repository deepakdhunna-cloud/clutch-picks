/**
 * Shared types for the honest prediction engine.
 *
 * All factors output in the same unit: rating points in favor of home.
 * Probability conversion happens exactly once in probability.ts.
 */

import type { Game, Team } from "../types/sports";
import type {
  TeamRecentForm,
  TeamExtendedStats,
  TeamInjuryReport,
  TeamAdvancedMetrics,
  StartingLineup,
  WeatherData,
} from "../lib/espnStats";
import type { TeamShootingRecent } from "../lib/nbaStatsApi";
import type { UmpireZoneBias } from "../lib/mlbUmpireApi";

// ─── Factor Contribution ────────────────────────────────────────────────────

export type FactorContribution = {
  /** Stable identifier, e.g. "rating_diff", "starting_pitcher" */
  key: string;
  /** Human-readable label for narrative, e.g. "Starting pitcher matchup" */
  label: string;
  /** Positive = favors home, negative = favors away, in rating points */
  homeDelta: number;
  /** Relative importance for this matchup, 0..1 */
  weight: number;
  /** false if required data was missing — contributes 0 and weight is redistributed */
  available: boolean;
  /** One-sentence factual justification with concrete numbers, no adjectives */
  evidence: string;
};

// ─── Game Context ───────────────────────────────────────────────────────────
// Everything a factor function needs to compute its contribution.
// Assembled once from ESPN data, passed to every factor function.

export type GameContext = {
  game: Game;
  sport: string;

  // Elo ratings (without home bonus applied — factors/base.ts applies it)
  homeElo: number;
  awayElo: number;

  // ESPN data — all fetched upstream, factors never fetch
  homeForm: TeamRecentForm;
  awayForm: TeamRecentForm;
  homeExtended: TeamExtendedStats;
  awayExtended: TeamExtendedStats;
  homeInjuries: TeamInjuryReport;
  awayInjuries: TeamInjuryReport;
  homeAdvanced: TeamAdvancedMetrics;
  awayAdvanced: TeamAdvancedMetrics;
  homeLineup: StartingLineup | null;
  awayLineup: StartingLineup | null;
  weather: WeatherData | null;

  // NBA-only: live 3P% from stats.nba.com. null when sport ≠ NBA or fetch failed.
  homeShooting?: TeamShootingRecent | null;
  awayShooting?: TeamShootingRecent | null;

  // MLB-only: home plate umpire + tendency data. null when sport ≠ MLB,
  // umpire unassigned, or umpire not in our tendency file.
  homePlateUmpire?: UmpireZoneBias | null;

  /** ISO date string of the game */
  gameDate: string;
};

// ─── Supported Leagues ──────────────────────────────────────────────────────

export type LeagueKey =
  | "NFL"
  | "NBA"
  | "MLB"
  | "NHL"
  | "MLS"
  | "EPL"
  | "UCL"
  | "NCAAF"
  | "NCAAB";

// ─── Confidence Bands ───────────────────────────────────────────────────────
// Map directly from probability ranges. No manipulation, no theater.

export type ConfidenceBand = "coinflip" | "slight edge" | "clear edge" | "strong edge";

export function getConfidenceBand(winnerProb: number): ConfidenceBand {
  const pct = winnerProb * 100;
  if (pct < 53) return "coinflip";
  if (pct < 58) return "slight edge";
  if (pct < 67) return "clear edge";
  return "strong edge";
}

// ─── Final Prediction Output ────────────────────────────────────────────────
// This is the shape returned by predictGame().

export type HonestPrediction = {
  gameId: string;
  league: string;
  predictedWinner: { teamId: string; abbr: string } | null; // null = true 50/50
  homeWinProbability: number;   // 0..1
  awayWinProbability: number;   // 0..1
  drawProbability?: number;     // 0..1, soccer only
  confidence: number;           // max(home, away) * 100, rounded to 1 decimal
  confidenceBand: ConfidenceBand;
  factors: FactorContribution[];
  unavailableFactors: string[];
  narrative: string;            // 80-150 words, factor-driven (filled by narrative.ts)
  modelVersion: string;
  generatedAt: string;          // ISO timestamp
  dataSources: string[];
};
