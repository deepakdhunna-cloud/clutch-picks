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
  /**
   * true when the factor has actual evidence pushing the delta in a direction
   * (injuries reported, net rating computed, goalie confirmed, etc.) or a real
   * non-directional volatility signal that should retain its weight. false
   * when it's a neutral / no-data / "no change" fallback. Effectively neutral
   * factors donate their weight to the strongest directional anchor during
   * aggregation instead of diluting the pick with a zero contribution.
   *
   * Invariants:
   *   - available=false ⇒ hasSignal=false
   *   - rating_diff usually acts as the anchor when it has a non-zero edge
   */
  hasSignal: boolean;
  /** One-sentence factual justification with concrete numbers, no adjectives */
  evidence: string;
};

// ─── Projection / simulation layer ─────────────────────────────────────────

export type ProjectionSignal = {
  key: string;
  label: string;
  value: number;
  evidence: string;
};

export type SimulationProjection = {
  engine: "game-script-v1";
  iterations: number;
  homeWinProbability: number;
  awayWinProbability: number;
  drawProbability?: number;
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedSpread: number;
  projectedTotal: number;
  volatility: number;
  upsetRisk: number;
  signals: ProjectionSignal[];
};

// ─── Canonical result object ───────────────────────────────────────────────
// One user-facing final answer for every event/market. Prediction factors,
// game-script simulation, projection, and market calibration can disagree
// internally, but every API/UI card should read this object for the final pick,
// final probability, and confidence.

export type CanonicalMarketType = "moneyline" | "three_way_result";
export type CanonicalFinalPick = "home" | "away" | "draw" | "none";

export type CanonicalProbabilities = {
  home: number; // 0..1
  away: number; // 0..1
  draw?: number; // 0..1, three-way sports only
};

export type CanonicalEngineRead = {
  engine: string;
  pick: CanonicalFinalPick;
  probability: number; // 0..1 probability for pick
  confidence?: number; // 0..100 display confidence for this read
  weight?: number;
  probabilities?: CanonicalProbabilities;
  inputs?: Record<string, string | number | boolean | null>;
  warnings?: string[];
};

export type CanonicalEngineWeights = {
  factor: number;
  projection: number;
  market: number;
};

export type CanonicalDecisionTag =
  | "model-consensus"
  | "hidden-edge"
  | "upset-watch"
  | "market-disagreement"
  | "thin-data"
  | "volatile-script"
  | "low-conviction"
  | "chalk";

export type CanonicalDecisionProfile = {
  version: "unified-decision-profile-v1";
  pick: CanonicalFinalPick;
  probability: number;
  confidence: number;
  dataCoverage: number;
  signalCoverage: number;
  agreementScore: number;
  hiddenEdgeScore: number;
  upsetScore: number;
  riskScore: number;
  edgeRating: number;
  valueRating: number;
  lowDataWarning: boolean;
  engineDivergence: boolean;
  factorPick: CanonicalFinalPick;
  projectionPick: CanonicalFinalPick;
  marketPick?: CanonicalFinalPick;
  marketDelta?: number;
  tags: CanonicalDecisionTag[];
  thesis: string[];
  watchouts: string[];
};

export type CanonicalPredictionResult = {
  eventId: string;
  marketType: CanonicalMarketType;
  finalPick: CanonicalFinalPick;
  finalProbability: number; // 0..1
  confidence: number; // 0..100, rounded to one decimal
  probabilities: CanonicalProbabilities;
  decisionProfile?: CanonicalDecisionProfile;
  projectedScore?: {
    home: number;
    away: number;
    spread: number;
    total: number;
  };
  simulationSummary?: {
    engine: string;
    iterations: number;
    probabilities: CanonicalProbabilities;
    volatility: number;
    upsetRisk: number;
  };
  modelInputs: {
    sport: string;
    homeTeamId: string;
    awayTeamId: string;
    gameTime: string;
    factorCount: number;
    availableFactorCount: number;
    marketConsensusIncluded: boolean;
  };
  engineBreakdown: CanonicalEngineRead[];
  reconciliation: {
    method: string;
    notes: string[];
  };
  timestamp: string;
  dataVersion: string;
  warnings: string[];
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

  // UCL-only verified feeds. null when the provider URLs are unset or the
  // teams are missing, so these factors redistribute instead of guessing.
  uclPedigree?: { home: number; away: number } | null;
  uclTravel?: { distanceKm: number; homeCity: string; awayCity: string } | null;

  // Market consensus (SharpAPI). Used as a small calibration anchor by the
  // new engine, plus for final model-vs-market divergence reporting. null
  // when SHARPAPI_KEY unset or fetch failed.
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
  | "IPL"
  | "TENNIS"
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
  canonicalResult: CanonicalPredictionResult;
  predictedWinner: { teamId: string; abbr: string } | null; // null = true 50/50
  homeWinProbability: number;   // 0..1
  awayWinProbability: number;   // 0..1
  drawProbability?: number;     // 0..1, soccer only
  confidence: number;           // max(home, away) * 100, rounded to 1 decimal
  confidenceBand: ConfidenceBand;
  factors: FactorContribution[];
  projection?: SimulationProjection;
  unavailableFactors: string[];
  narrative: string;            // 80-150 words, factor-driven (filled by narrative.ts)
  modelVersion: string;
  generatedAt: string;          // ISO timestamp
  dataSources: string[];
  // Market comparison from the same consensus snapshot used by the engine
  // when available. If no market snapshot was available to the engine, this
  // stays undefined rather than inventing a comparison.
  marketComparison?: {
    modelHomeProb: number;
    marketHomeProb: number;
    divergence: number;    // absolute delta, 0..1
    isDivergent: boolean;
  };
};
