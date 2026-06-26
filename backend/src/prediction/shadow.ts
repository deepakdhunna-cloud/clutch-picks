/**
 * Shadow comparison logger.
 *
 * Historical shadow comparison logger.
 *
 * User-facing predictions now always use the new engine. This module remains
 * only for old diagnostic logs and should not run on the response path.
 *
 * A shadow-engine failure NEVER affects the user-facing response.
 * Writes are append-only, async, fire-and-forget.
 */

import { appendFile, readdir, unlink } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { predictGame } from "./index";
import { prisma } from "../prisma";
import type { GameContext } from "./types";
import type { Game, Team } from "../types/sports";
import { Sport, League, GameStatus } from "../types/sports";
import { getEloRating } from "../lib/elo";
import {
  fetchTeamRecentForm,
  fetchTeamExtendedStats,
  fetchAdvancedMetrics,
  fetchStartingLineup,
  fetchGameWeather,
  fetchFixtureCongestion,
  type TeamRecentForm,
} from "../lib/espnStats";
import { fetchGameInjuries, toTeamInjuryReport, mergePlayerAvailability } from "../lib/espnInjuries";
import {
  fetchSportsDataIOAdvancedMetrics,
  fetchSportsDataIOLineup,
  fetchSportsDataIOInjuries,
  mergeAdvancedMetrics,
  mergeInjuryReports,
} from "../lib/sportsDataIO";
import {
  fetchFreeAdvancedMetrics,
  fetchFreeIPLVenueSplit,
  fetchFreeTennisProfileByName,
} from "../lib/freeDataSources";
// fetchTeamShootingRecent removed — stats.nba.com IP-blocks Railway
import { fetchNHLStartingGoalie } from "../lib/nhlGoalieApi";
import { recordEloSnapshot } from "../lib/eloSnapshot";
import { fetchTeamXgMetrics } from "../lib/soccerXg";
import { detectSurface, fetchPlayerSurfaceProfile, computeSurfaceAdjustment } from "../lib/tennisSurface";
import { extractTennisAthleteId } from "../lib/tennisStats";
import { lookupHomePlateUmpireBias } from "../lib/mlbUmpireApi";
import {
  fetchLeagueStandings,
  computeStakes,
  type SoccerLeague,
} from "../lib/soccerStandings";
import { lookupManagerChange } from "../lib/soccerManagerChanges";
import {
  lookupUclPedigreePair,
  lookupUclTravelInfo,
} from "../lib/uclVerifiedData";
import { fetchMarketConsensus } from "../lib/sharpApi";
import { fetchEspnMarketConsensus } from "../lib/espnOdds";
import { buildMarketConsensusFromGameOdds } from "./market";
import { deriveSeasonContext, type NarrativeSeasonContext } from "./seasonContext";
import type { SoccerStakes } from "./types";
import { createInitialVersion } from "../lib/ingestion/predictionVersions";
import { useNewPredictionEngine } from "../env";

// ─── Paths ──────────────────────────────────────────────────────────────

const LOGS_DIR = process.env.LOGS_DIR ?? join(__dirname, "../../logs");

function ensureLogsDir(): void {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function shadowLogPath(date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return join(LOGS_DIR, `prediction_shadow_${d}.jsonl`);
}

function errorLogPath(date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return join(LOGS_DIR, `prediction_shadow_errors_${d}.jsonl`);
}

// ─── Log entry shapes ───────────────────────────────────────────────────

interface ShadowEntry {
  timestamp: string;
  gameId: string;
  league: string;
  matchup: string;
  scheduledStart: string;
  old: {
    predictedWinner: string;
    homeWinProb: number;
    confidence: number;
  };
  new: {
    predictedWinner: string | null;
    homeWinProb: number;
    confidence: number;
    confidenceBand: string;
    unavailableFactors: string[];
  };
  agreement: boolean;
  confidenceDelta: number;
}

interface ShadowErrorEntry {
  timestamp: string;
  gameId: string;
  league: string;
  error: string;
  stack?: string;
}

// ─── Feature flag ───────────────────────────────────────────────────────

export function useNewEngine(): boolean {
  return useNewPredictionEngine;
}

function finiteTeamNumber(team: Team | null | undefined, field: "runRateFor" | "runRateAgainst"): number | null {
  const value = team?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function t20RunsFromRate(rate: number | null): number | null {
  if (rate === null) return null;
  return Math.max(80, Math.min(240, rate * 20));
}

function averageFinite(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function resolveIPLScoringForm(
  sport: string,
  form: TeamRecentForm,
  team: Team,
  opponent: Team,
): TeamRecentForm {
  if (sport !== "IPL") return form;

  const estimatedScore = averageFinite([
    t20RunsFromRate(finiteTeamNumber(team, "runRateFor")),
    t20RunsFromRate(finiteTeamNumber(opponent, "runRateAgainst")),
  ]);
  const estimatedAllowed = averageFinite([
    t20RunsFromRate(finiteTeamNumber(team, "runRateAgainst")),
    t20RunsFromRate(finiteTeamNumber(opponent, "runRateFor")),
  ]);

  if (estimatedScore === null && estimatedAllowed === null) return form;

  return {
    ...form,
    avgScore: form.avgScore > 0 ? form.avgScore : estimatedScore ?? form.avgScore,
    avgAllowed: form.avgAllowed > 0 ? form.avgAllowed : estimatedAllowed ?? form.avgAllowed,
  };
}

// ─── Log rotation (keep last 14 days) ───────────────────────────────────

export async function cleanOldShadowLogs(): Promise<void> {
  try {
    ensureLogsDir();
    const files = await readdir(LOGS_DIR);
    const now = Date.now();
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith("prediction_shadow")) continue;
      // Extract date from filename: prediction_shadow_2026-04-12.jsonl
      const match = file.match(/(\d{4}-\d{2}-\d{2})/);
      if (!match) continue;
      const fileDate = new Date(match[1]!).getTime();
      if (now - fileDate > FOURTEEN_DAYS_MS) {
        await unlink(join(LOGS_DIR, file));
        console.log(`[shadow] Deleted old log: ${file}`);
      }
    }
  } catch (e) {
    console.error("[shadow] Log cleanup failed:", e);
  }
}

// ─── Build GameContext from route-level game data ────────────────────────

/**
 * Exported so the ingestion re-predict trigger can rebuild a fresh
 * GameContext for an affected game without re-implementing the 20+
 * parallel fetches this function orchestrates.
 */
export async function buildGameContext(
  game: {
    id: string;
    sport: string;
    homeTeam: any;
    awayTeam: any;
    gameTime: string;
    venue: string;
    spread?: number;
    overUnder?: number;
    marketFavorite?: "home" | "away";
    seasonContext?: NarrativeSeasonContext | null;
  },
): Promise<GameContext> {
  const sport = game.sport;
  const gameDate = new Date(game.gameTime);
  const seasonContext =
    game.seasonContext ??
    deriveSeasonContext({ sport, gameTime: game.gameTime });

  const isSoccer = ["EPL", "MLS", "UCL", "WORLDCUP"].includes(sport);

  // PlayerAvailability recency window — rows older than 72h are treated as
  // stale (the ingestion pipeline writes expiresAt at +48h, so 72h is a
  // safe upper bound). Wrap each query with a .catch so a DB hiccup never
  // blocks prediction generation.
  const PA_RECENCY_MS = 72 * 60 * 60 * 1000;
  const paSinceDate = new Date(Date.now() - PA_RECENCY_MS);

  const [
    homeElo, awayElo,
    homeForm, awayForm,
    homeExtended, awayExtended,
    gameInjuries,
    homeAdvancedEspn, awayAdvancedEspn,
    homeFreeAdvanced, awayFreeAdvanced,
    homeLineupEspn, awayLineupEspn,
    homeSportsDataIOAdvanced, awaySportsDataIOAdvanced,
    homeSportsDataIOLineup, awaySportsDataIOLineup,
    homeSportsDataIOInjuries, awaySportsDataIOInjuries,
    weather,
    homePlateUmpire,
    homeFixtureCongestion, awayFixtureCongestion,
    leagueStandings,
    sharpMarketConsensus,
    homeAvailability, awayAvailability,
    uclPedigree,
    uclTravel,
    homeTennisProfile, awayTennisProfile,
    iplVenueSplit,
  ] = await Promise.all([
    getEloRating(game.homeTeam.id, sport),
    getEloRating(game.awayTeam.id, sport),
    fetchTeamRecentForm(game.homeTeam.id, sport, 10, gameDate),
    fetchTeamRecentForm(game.awayTeam.id, sport, 10, gameDate),
    fetchTeamExtendedStats(game.homeTeam.id, sport, game.awayTeam.id, gameDate),
    fetchTeamExtendedStats(game.awayTeam.id, sport, game.homeTeam.id, gameDate),
    // Per-game injuries via ESPN summary endpoint. Soccer/NFL/NCAA return
    // source="unavailable" with empty arrays — no network call is made.
    fetchGameInjuries(sport, game.id, game.homeTeam.id, game.awayTeam.id),
    fetchAdvancedMetrics(game.homeTeam.id, sport),
    fetchAdvancedMetrics(game.awayTeam.id, sport),
    fetchFreeAdvancedMetrics({
      sport,
      gameId: game.id,
      teamId: game.homeTeam.id,
      teamName: game.homeTeam.name,
      teamAbbreviation: game.homeTeam.abbreviation,
      gameDate,
    }),
    fetchFreeAdvancedMetrics({
      sport,
      gameId: game.id,
      teamId: game.awayTeam.id,
      teamName: game.awayTeam.name,
      teamAbbreviation: game.awayTeam.abbreviation,
      gameDate,
    }),
    fetchStartingLineup(game.homeTeam.id, sport, gameDate),
    fetchStartingLineup(game.awayTeam.id, sport, gameDate),
    fetchSportsDataIOAdvancedMetrics(sport, String(game.homeTeam.abbreviation ?? ""), gameDate),
    fetchSportsDataIOAdvancedMetrics(sport, String(game.awayTeam.abbreviation ?? ""), gameDate),
    fetchSportsDataIOLineup(sport, String(game.homeTeam.abbreviation ?? "")),
    fetchSportsDataIOLineup(sport, String(game.awayTeam.abbreviation ?? "")),
    fetchSportsDataIOInjuries(sport, String(game.homeTeam.abbreviation ?? "")),
    fetchSportsDataIOInjuries(sport, String(game.awayTeam.abbreviation ?? "")),
    fetchGameWeather(game.venue ?? "", gameDate, sport),
    sport === "MLB" ? lookupHomePlateUmpireBias(game.homeTeam.id, gameDate) : Promise.resolve(null),
    // Fixture congestion — only soccer; other sports ignore.
    isSoccer ? fetchFixtureCongestion(game.homeTeam.id, sport, gameDate) : Promise.resolve(null),
    isSoccer ? fetchFixtureCongestion(game.awayTeam.id, sport, gameDate) : Promise.resolve(null),
    // Standings — EPL and MLS only (UCL has group+knockout, handled in-factor).
    sport === "EPL" || sport === "MLS"
      ? fetchLeagueStandings(sport as SoccerLeague)
      : Promise.resolve(null),
    // Market consensus — SharpAPI is preferred. If unavailable, route-level
    // ESPN odds metadata is converted to a conservative fallback below.
    fetchMarketConsensus(sport, game.homeTeam.name, game.awayTeam.name, gameDate),
    // PlayerAvailability rows from Apify ingestion. ESPN summary returns
    // empty for soccer; PA is the sole source there. For NBA/NHL/MLB it
    // fills gaps in ESPN's feed. Failure -> empty array; never throws.
    prisma.playerAvailability
      .findMany({
        where: {
          sport,
          teamId: game.homeTeam.id,
          updatedAt: { gte: paSinceDate },
        },
      })
      .catch(() => [] as Array<{ playerName: string; status: string }>),
    prisma.playerAvailability
      .findMany({
        where: {
          sport,
          teamId: game.awayTeam.id,
          updatedAt: { gte: paSinceDate },
        },
      })
      .catch(() => [] as Array<{ playerName: string; status: string }>),
    sport === "UCL" || sport === "WORLDCUP"
      ? lookupUclPedigreePair(game.homeTeam.name, game.awayTeam.name)
      : Promise.resolve(null),
    sport === "UCL" || sport === "WORLDCUP"
      ? lookupUclTravelInfo(game.homeTeam.name, game.awayTeam.name)
      : Promise.resolve(null),
    sport === "TENNIS"
      ? fetchFreeTennisProfileByName(game.homeTeam.name, game.homeTeam.tour, 10, gameDate)
      : Promise.resolve(null),
    sport === "TENNIS"
      ? fetchFreeTennisProfileByName(game.awayTeam.name, game.awayTeam.tour, 10, gameDate)
      : Promise.resolve(null),
    sport === "IPL"
      ? fetchFreeIPLVenueSplit(game.id, game.homeTeam.id, game.awayTeam.id)
      : Promise.resolve(null),
  ]);

  // Record point-in-time Elo snapshots for leak-free backtesting.
  // Fire-and-forget: never blocks the prediction path.
  recordEloSnapshot(sport, game.homeTeam.id, homeElo, gameDate, game.id);
  recordEloSnapshot(sport, game.awayTeam.id, awayElo, gameDate, game.id);

  // Translate PlayerInjury[] → TeamInjuryReport, then merge SportsDataIO and
  // PlayerAvailability rows. Each provider is conservative: no source is
  // allowed to invent availability, and duplicate players collapse to the
  // highest-severity bucket once.
  const homeInjuriesEspn = {
    ...toTeamInjuryReport(gameInjuries.homeTeamInjuries),
    source: gameInjuries.source,
  };
  const awayInjuriesEspn = {
    ...toTeamInjuryReport(gameInjuries.awayTeamInjuries),
    source: gameInjuries.source,
  };
  const homeInjuriesSportsDataIO = mergeInjuryReports(homeInjuriesEspn, homeSportsDataIOInjuries);
  const awayInjuriesSportsDataIO = mergeInjuryReports(awayInjuriesEspn, awaySportsDataIOInjuries);
  const homeInjuries = mergePlayerAvailability(homeInjuriesSportsDataIO, homeAvailability);
  const awayInjuries = mergePlayerAvailability(awayInjuriesSportsDataIO, awayAvailability);

  const homeAdvancedFree = mergeAdvancedMetrics(homeAdvancedEspn, homeFreeAdvanced);
  const awayAdvancedFree = mergeAdvancedMetrics(awayAdvancedEspn, awayFreeAdvanced);
  const homeAdvanced = mergeAdvancedMetrics(homeAdvancedFree, homeSportsDataIOAdvanced);
  const awayAdvanced = mergeAdvancedMetrics(awayAdvancedFree, awaySportsDataIOAdvanced);
  let homeLineup = homeSportsDataIOLineup ?? homeLineupEspn;
  let awayLineup = awaySportsDataIOLineup ?? awayLineupEspn;

  // NHL: Enrich lineup with confirmed starting goalie + individual stats.
  // This runs AFTER the base lineup is resolved so we can attach goalie
  // data to the existing lineup structure.
  if (sport === "NHL") {
    const [homeGoalie, awayGoalie] = await Promise.all([
      fetchNHLStartingGoalie(
        game.homeTeam.id,
        String(game.homeTeam.abbreviation ?? ""),
        gameDate,
        "home"
      ),
      fetchNHLStartingGoalie(
        game.awayTeam.id,
        String(game.awayTeam.abbreviation ?? ""),
        gameDate,
        "away"
      ),
    ]);

    if (homeGoalie) {
      if (!homeLineup) homeLineup = { sport: "NHL", starters: [] };
      homeLineup.startingGoalie = homeGoalie;
    }
    if (awayGoalie) {
      if (!awayLineup) awayLineup = { sport: "NHL", starters: [] };
      awayLineup.startingGoalie = awayGoalie;
    }
  }
  const resolvedHomeForm =
    sport === "TENNIS" && homeTennisProfile?.form?.results.length
      ? homeTennisProfile.form
      : homeForm;
  const resolvedAwayForm =
    sport === "TENNIS" && awayTennisProfile?.form?.results.length
      ? awayTennisProfile.form
      : awayForm;
  // Market consensus priority: paid SharpAPI (if configured) > FREE ESPN
  // moneyline consensus (real DraftKings line de-vigged to a win probability) >
  // the weak spread-only fallback derived from the game shell. The ESPN
  // moneyline path is the no-cost market anchor when SHARPAPI_KEY is unset; it
  // is gated behind ENGINE_ESPN_MARKET so its accuracy lift can be A/B'd on the
  // backtest before it carries weight in production.
  const espnMarketConsensus =
    sharpMarketConsensus || process.env.ENGINE_ESPN_MARKET === "false"
      ? null
      : await fetchEspnMarketConsensus(sport, game.id);
  const marketConsensus =
    sharpMarketConsensus ??
    espnMarketConsensus ??
    buildMarketConsensusFromGameOdds({
      sport,
      marketFavorite: game.marketFavorite,
      spread: game.spread,
      overUnder: game.overUnder,
      fetchedAt: new Date().toISOString(),
    });

  // Manager-change data comes from an optional verified feed. If it is not
  // configured, both values resolve null and the factor is redistributed.
  const [homeManagerChange, awayManagerChange] = isSoccer
    ? await Promise.all([
        lookupManagerChange(sport, game.homeTeam.name, gameDate),
        lookupManagerChange(sport, game.awayTeam.name, gameDate),
      ])
    : [null, null];

  // Stakes derived from standings (EPL / MLS only; UCL handled separately).
  let homeStakes: SoccerStakes | null = null;
  let awayStakes: SoccerStakes | null = null;
  if (leagueStandings && (sport === "EPL" || sport === "MLS")) {
    homeStakes = computeStakes({
      standings: leagueStandings,
      teamId: game.homeTeam.id,
      league: sport as SoccerLeague,
    });
    awayStakes = computeStakes({
      standings: leagueStandings,
      teamId: game.awayTeam.id,
      league: sport as SoccerLeague,
    });
  }

  const sportsGame: import("../types/sports").Game = {
    id: game.id,
    sport: sport as Sport,
    league: ["NCAAF", "NCAAB"].includes(sport) ? League.College : League.Pro,
    homeTeam: {
      id: game.homeTeam.id,
      name: game.homeTeam.name,
      abbreviation: game.homeTeam.abbreviation,
      logo: game.homeTeam.logo || "",
      rank: game.homeTeam.rank ?? homeTennisProfile?.rank,
      seed: game.homeTeam.seed,
      rankingPoints: game.homeTeam.rankingPoints ?? homeTennisProfile?.rankingPoints,
      tour: game.homeTeam.tour ?? homeTennisProfile?.tour,
      standingsRank: game.homeTeam.standingsRank,
      standingsPoints: game.homeTeam.standingsPoints,
      netRunRate: game.homeTeam.netRunRate,
      runRateFor: game.homeTeam.runRateFor,
      runRateAgainst: game.homeTeam.runRateAgainst,
      matchesPlayed: game.homeTeam.matchesPlayed,
      record: {
        wins: typeof game.homeTeam.record === "string"
          ? parseInt(game.homeTeam.record.split("-")[0] ?? "0")
          : game.homeTeam.record?.wins ?? 0,
        losses: typeof game.homeTeam.record === "string"
          ? parseInt(game.homeTeam.record.split("-")[1] ?? "0")
          : game.homeTeam.record?.losses ?? 0,
      },
    },
    awayTeam: {
      id: game.awayTeam.id,
      name: game.awayTeam.name,
      abbreviation: game.awayTeam.abbreviation,
      logo: game.awayTeam.logo || "",
      rank: game.awayTeam.rank ?? awayTennisProfile?.rank,
      seed: game.awayTeam.seed,
      rankingPoints: game.awayTeam.rankingPoints ?? awayTennisProfile?.rankingPoints,
      tour: game.awayTeam.tour ?? awayTennisProfile?.tour,
      standingsRank: game.awayTeam.standingsRank,
      standingsPoints: game.awayTeam.standingsPoints,
      netRunRate: game.awayTeam.netRunRate,
      runRateFor: game.awayTeam.runRateFor,
      runRateAgainst: game.awayTeam.runRateAgainst,
      matchesPlayed: game.awayTeam.matchesPlayed,
      record: {
        wins: typeof game.awayTeam.record === "string"
          ? parseInt(game.awayTeam.record.split("-")[0] ?? "0")
          : game.awayTeam.record?.wins ?? 0,
        losses: typeof game.awayTeam.record === "string"
          ? parseInt(game.awayTeam.record.split("-")[1] ?? "0")
          : game.awayTeam.record?.losses ?? 0,
      },
    },
    dateTime: game.gameTime,
    venue: game.venue ?? "Unknown",
    tvChannel: "",
    status: GameStatus.Scheduled,
    seasonContext,
  };

  // Soccer: Fetch xG metrics from FBref/Understat for EPL/MLS/UCL.
  // Fire in parallel — non-blocking, null on failure.
  let homeXg: import("../lib/soccerXg").TeamXgMetrics | null = null;
  let awayXg: import("../lib/soccerXg").TeamXgMetrics | null = null;
  if (isSoccer) {
    [homeXg, awayXg] = await Promise.all([
      fetchTeamXgMetrics(sport, game.homeTeam.name),
      fetchTeamXgMetrics(sport, game.awayTeam.name),
    ]);
  }

  // Tennis: Compute surface-specific performance adjustment.
  let surfaceAdjustment: import("../lib/tennisSurface").SurfaceAdjustment | null = null;
  if (sport === "TENNIS") {
    try {
      const tournamentContext = [
        sportsGame.venue,
        sportsGame.seasonContext?.label,
        sportsGame.seasonContext?.detail,
      ].filter(Boolean).join(" ");
      const matchSurface = detectSurface(sportsGame.venue, tournamentContext);

      // Extract athlete IDs for surface profile fetch
      const homeAthleteId = extractTennisAthleteId(game.homeTeam.id);
      const awayAthleteId = extractTennisAthleteId(game.awayTeam.id);

      if (homeAthleteId && awayAthleteId) {
        const [homeProfile, awayProfile] = await Promise.all([
          fetchPlayerSurfaceProfile(homeAthleteId),
          fetchPlayerSurfaceProfile(awayAthleteId),
        ]);
        surfaceAdjustment = computeSurfaceAdjustment(matchSurface, homeProfile, awayProfile);
      } else {
        surfaceAdjustment = computeSurfaceAdjustment(matchSurface, null, null);
      }
    } catch {
      // Surface data fetch failed — factor will be unavailable
      surfaceAdjustment = null;
    }
  }

  return {
    game: sportsGame,
    sport,
    homeElo,
    awayElo,
    homeForm: resolveIPLScoringForm(sport, resolvedHomeForm, sportsGame.homeTeam, sportsGame.awayTeam),
    awayForm: resolveIPLScoringForm(sport, resolvedAwayForm, sportsGame.awayTeam, sportsGame.homeTeam),
    homeExtended,
    awayExtended,
    homeInjuries,
    awayInjuries,
    homeAdvanced,
    awayAdvanced,
    homeLineup,
    awayLineup,
    weather,
    homePlateUmpire,
    homeFixtureCongestion,
    awayFixtureCongestion,
    homeManagerChange,
    awayManagerChange,
    homeStakes,
    awayStakes,
    leagueStandings,
    uclPedigree,
    uclTravel,
    marketConsensus,
    // The score-projection anchors (simulation.ts margin + total) read these
    // three fields. They MUST prefer the fresh ESPN consensus line (real de-vigged
    // DraftKings spread + over/under, fetched per game) over the route-level
    // game.* values — which are frequently absent (ESPN's *site* scoreboard, the
    // replay's source, posts no totals, so game.overUnder is ~always null and the
    // total anchor never fired). Falling back to game.* preserves the old behavior
    // when no consensus line exists. The margin anchor takes |spread| and applies
    // the favorite's sign, so favorite + spread are sourced together for coherence.
    marketFavorite: marketConsensus?.marketFavorite ?? game.marketFavorite,
    marketSpread: marketConsensus?.spread ?? game.spread,
    marketOverUnder: marketConsensus?.overUnder ?? game.overUnder,
    sportsDataIO: {
      homeAdvanced: !!homeSportsDataIOAdvanced,
      awayAdvanced: !!awaySportsDataIOAdvanced,
      homeLineup: !!homeSportsDataIOLineup,
      awayLineup: !!awaySportsDataIOLineup,
      homeInjuries: !!homeSportsDataIOInjuries,
      awayInjuries: !!awaySportsDataIOInjuries,
    },
    freeDataSources: {
      homeAdvanced: !!homeFreeAdvanced,
      awayAdvanced: !!awayFreeAdvanced,
      homeTennisProfile: !!homeTennisProfile,
      awayTennisProfile: !!awayTennisProfile,
      iplVenueSplit: !!iplVenueSplit,
    },
    iplVenueSplit,
    homeXg,
    awayXg,
    surfaceAdjustment,
    gameDate: gameDate.toISOString(),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Run the new engine in shadow mode for a game and log the comparison.
 *
 * Historical diagnostic helper. This function:
 * 1. Builds a GameContext from the game data
 * 2. Runs predictGame() from the new engine
 * 3. Logs both predictions to the daily shadow JSONL file
 * 4. If the new engine throws, logs to the error file instead
 *
 * CRITICAL: This is fire-and-forget. It must NEVER be awaited on the
 * response path.
 */
export function runShadowPrediction(
  game: {
    id: string;
    sport: string;
    homeTeam: any;
    awayTeam: any;
    gameTime: string;
    venue: string;
    spread?: number;
    overUnder?: number;
    marketFavorite?: "home" | "away";
  },
  oldPrediction: {
    predictedWinner: string;
    homeWinProbability: number;
    confidence: number;
  },
): void {
  // Fire and forget — no await, no blocking
  (async () => {
    try {
      ensureLogsDir();

      const ctx = await buildGameContext(game);
      const newPred = predictGame(ctx);

      // Record v1 "initial" prediction-version row for the timeline
      // audit trail. Idempotent (no-op if a version already exists for
      // this game), fire-and-forget (never blocks the shadow path).
      void createInitialVersion(game.id, game.sport, newPred);

      const entry: ShadowEntry = {
        timestamp: new Date().toISOString(),
        gameId: game.id,
        league: game.sport,
        matchup: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
        scheduledStart: game.gameTime,
        old: {
          predictedWinner: oldPrediction.predictedWinner,
          homeWinProb: oldPrediction.homeWinProbability / 100, // Old engine uses 0-100
          confidence: oldPrediction.confidence,
        },
        new: {
          predictedWinner: newPred.predictedWinner?.abbr ?? "PICKEM",
          homeWinProb: newPred.homeWinProbability,
          confidence: newPred.confidence,
          confidenceBand: newPred.confidenceBand,
          unavailableFactors: newPred.unavailableFactors,
        },
        agreement:
          oldPrediction.predictedWinner ===
          (newPred.predictedWinner
            ? (newPred.homeWinProbability > newPred.awayWinProbability ? "home" : "away")
            : ""),
        confidenceDelta: newPred.confidence - oldPrediction.confidence,
      };

      await appendFile(shadowLogPath(), JSON.stringify(entry) + "\n", "utf-8");

      // Persist to Postgres so comparisons survive Railway redeploys.
      // Fire-and-forget — DB failure never blocks the shadow path.
      void prisma.shadowComparison.create({
        data: {
          gameId: entry.gameId,
          league: entry.league,
          matchup: entry.matchup,
          scheduledStart: new Date(entry.scheduledStart),
          oldPredictedWinner: entry.old.predictedWinner,
          oldHomeWinProb: entry.old.homeWinProb,
          oldConfidence: entry.old.confidence,
          newPredictedWinner: entry.new.predictedWinner === "PICKEM" ? null : entry.new.predictedWinner,
          newHomeWinProb: entry.new.homeWinProb,
          newAwayWinProb: newPred.awayWinProbability,
          newDrawProb: newPred.drawProbability ?? null,
          newConfidence: entry.new.confidence,
          newConfidenceBand: entry.new.confidenceBand,
          unavailableFactorsJson: JSON.stringify(entry.new.unavailableFactors),
          agreement: entry.agreement,
          confidenceDelta: entry.confidenceDelta,
        },
      }).catch((dbErr: any) => {
        console.error(`[shadow] DB write failed for game ${entry.gameId}:`, dbErr?.message);
      });
    } catch (e: any) {
      // Log error — never propagate
      try {
        ensureLogsDir();
        const errEntry: ShadowErrorEntry = {
          timestamp: new Date().toISOString(),
          gameId: game.id,
          league: game.sport,
          error: e?.message ?? String(e),
          stack: e?.stack,
        };
        await appendFile(errorLogPath(), JSON.stringify(errEntry) + "\n", "utf-8");
      } catch {
        // Even error logging failed — silently continue
        console.error(`[shadow] Failed to log error for game ${game.id}:`, e?.message);
      }
    }
  })();
}
