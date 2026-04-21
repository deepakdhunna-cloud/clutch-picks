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
import type { UnderstatTeam } from "../lib/fbrefApi";
import type { MarketConsensus } from "../lib/sharpApi";
import type { LeagueStandingsRow } from "../lib/soccerStandings";

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

  // Soccer (EPL/UCL): live FBRef xG. null for MLS and for teams FBRef
  // doesn't cover. null on fetch failure.
  homeXG?: UnderstatTeam | null;
  awayXG?: UnderstatTeam | null;

  // Soccer: count of matches in the last 7 / 14 days — fixture-congestion
  // signal. null when we couldn't derive it from the ESPN schedule.
  homeFixtureCongestion?: { gamesLast7Days: number; gamesLast14Days: number } | null;
  awayFixtureCongestion?: { gamesLast7Days: number; gamesLast14Days: number } | null;

  // Soccer: new-manager bounce window (<30 days since change). null when no
  // recent change or team not in our seeded list.
  homeManagerChange?: { daysSinceChange: number; newManager: string } | null;
  awayManagerChange?: { daysSinceChange: number; newManager: string } | null;

  // Soccer domestic leagues: stakes flags derived from current table + games
  // remaining. null when standings unavailable or pre-season.
  homeStakes?: SoccerStakes | null;
  awayStakes?: SoccerStakes | null;

  // Soccer: raw standings rows for the league (same data that produced the
  // stakes flags). Useful for evidence strings that want "vs mid-table".
  leagueStandings?: LeagueStandingsRow[] | null;

  // Market consensus (SharpAPI). Never used as a prediction input — only as
  // a post-prediction calibration anchor (see prediction/index.ts divergence
  // check). null when SHARPAPI_KEY unset or fetch failed.
  marketConsensus?: MarketConsensus | null;

  /** ISO date string of the game */
  gameDate: string;
};

export interface SoccerStakes {
  inTitleRace: boolean;
  inRelegationRace: boolean;
  inEuropeRace: boolean;
  gamesRemaining: number;
}

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
  // Post-hoc market comparison. NOT used as a prediction input — populated
  // after the model already decided. isDivergent === true when model and
  // market differ by more than 10 percentage points on the home-win prob.
  marketComparison?: {
    modelHomeProb: number;
    marketHomeProb: number;
    divergence: number;    // absolute delta, 0..1
    isDivergent: boolean;
  };
};
