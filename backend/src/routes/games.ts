/**
 * Real-time Sports Games API Routes
 * Fetches live game data from ESPN's unofficial API with AI predictions
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { LRUCache } from "lru-cache";
import { generatePrediction, bustAIAnalysisCache } from "../lib/predictions";
import { runShadowPrediction, useNewEngine, cleanOldShadowLogs } from "../prediction/shadow";
import { Sport as SportEnum, League, GameStatus as SportsGameStatus } from "../types/sports";
import type { Game as SportsGame } from "../types/sports";
import { resolvePicksInBackground } from "../lib/resolve-picks";
import { notifyWinnerFlip } from "../lib/notification-jobs";
import { prisma } from "../prisma";

// ESPN API base URLs for each sport
const ESPN_ENDPOINTS = {
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  MLS: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard",
  NCAAF: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
  NCAAB: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
  EPL: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
} as const;

type SportKey = keyof typeof ESPN_ENDPOINTS;

// Batch process with concurrency limit
async function batchProcess<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number = 5): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// Our app's Game type
export interface GameTeam {
  id: string;
  name: string;
  abbreviation: string;
  city: string;
  record: string;
  color: string;
  logo?: string;
}

export interface PredictionFactor {
  name: string;
  weight: number;
  homeScore: number;
  awayScore: number;
  description: string;
}

export interface GamePrediction {
  id: string;
  gameId: string;
  predictedWinner: "home" | "away";
  confidence: number;
  analysis: string;
  predictedSpread: number;
  predictedTotal: number;
  marketFavorite: "home" | "away";
  spread: number;
  overUnder: number;
  createdAt: string;
  // Advanced fields
  homeWinProbability: number;
  awayWinProbability: number;
  factors: PredictionFactor[];
  edgeRating: number;
  valueRating: number;
  recentFormHome: string;
  recentFormAway: string;
  homeStreak: number;
  awayStreak: number;
  isTossUp?: boolean;
  drawProbability?: number;
}

export interface Game {
  id: string;
  sport: "NFL" | "NBA" | "MLB" | "NHL" | "MLS" | "NCAAF" | "NCAAB" | "EPL";
  homeTeam: GameTeam;
  awayTeam: GameTeam;
  gameTime: string;
  status: "SCHEDULED" | "LIVE" | "FINAL" | "POSTPONED" | "CANCELLED";
  venue: string;
  tvChannel?: string;
  homeScore?: number;
  awayScore?: number;
  spread?: number;
  overUnder?: number;
  marketFavorite?: "home" | "away";
  quarter?: string;
  clock?: string;
  homeLinescores?: number[];
  awayLinescores?: number[];
  liveState?: {
    balls: number;
    strikes: number;
    outs: number;
    onFirst: boolean;
    onSecond: boolean;
    onThird: boolean;
    inningHalf: "top" | "bottom" | null;
    inningNumber: number | null;
    pitcher: { name: string | null; teamAbbr: string } | null;
    batter: { name: string | null; teamAbbr: string } | null;
  };
  prediction?: GamePrediction;
}

// ESPN API response types (partial, only what we need)
interface ESPNTeam {
  id: string;
  name: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  color?: string;
  alternateColor?: string;
  logo?: string;
  logos?: Array<{ href: string }>;
}

interface ESPNCompetitor {
  id: string;
  homeAway: "home" | "away";
  team: ESPNTeam;
  score?: string;
  records?: Array<{ summary: string; type: string }>;
  linescores?: Array<{ value?: number; displayValue?: string; period?: number }>;
}

interface ESPNOdds {
  details?: string;
  overUnder?: number;
  spread?: number;
  homeTeamOdds?: {
    favorite?: boolean;
  };
  awayTeamOdds?: {
    favorite?: boolean;
  };
}

interface ESPNBroadcast {
  names?: string[];
  market?: string;
}

interface ESPNStatus {
  type: {
    id: string;
    name: string;
    state: string;
    completed: boolean;
    description: string;
    detail: string;
    shortDetail: string;
  };
  period?: number;
  displayClock?: string;
}

interface ESPNSituationAthlete {
  athlete?: {
    displayName?: string;
    fullName?: string;
  };
}

interface ESPNSituation {
  balls?: number;
  strikes?: number;
  outs?: number;
  onFirst?: boolean;
  onSecond?: boolean;
  onThird?: boolean;
  pitcher?: ESPNSituationAthlete;
  batter?: ESPNSituationAthlete;
}

interface ESPNCompetition {
  id: string;
  date: string;
  venue?: {
    fullName: string;
    city?: string;
    state?: string;
  };
  competitors: ESPNCompetitor[];
  odds?: ESPNOdds[];
  broadcasts?: ESPNBroadcast[];
  status: ESPNStatus;
  situation?: ESPNSituation;
}

interface ESPNEvent {
  id: string;
  date: string;
  name: string;
  shortName: string;
  competitions: ESPNCompetition[];
}

interface ESPNScoreboardResponse {
  events: ESPNEvent[];
}

// Cache structure
interface CacheEntry {
  data: Game[];
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 1000; // 60 seconds — used when no games in entry are live
const LIVE_CACHE_TTL_MS = 10 * 1000; // 10 seconds — used when ≥1 game in entry is live
const cache = new LRUCache<string, CacheEntry>({ max: 100 });
// Secondary index: gameId → Game, for O(1) lookups in /id/:id
const gameById = new Map<string, Game>();
// In-flight request deduplication: prevents parallel requests for the same key
// from all hitting ESPN simultaneously. Second caller waits for the first's promise.
const inFlight = new Map<string, Promise<Game[]>>();

function getCachedData(cacheKey: string): Game[] | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  const now = Date.now();
  // Adaptive TTL: shorter when entry contains any live game so scores/situation
  // refresh on a near-real-time cadence. Falls back to the 60s default otherwise.
  const ttl = entry.data.some((g) => g.status === "LIVE") ? LIVE_CACHE_TTL_MS : CACHE_TTL_MS;
  if (now - entry.timestamp > ttl) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function setCacheData(cacheKey: string, data: Game[]): void {
  cache.set(cacheKey, { data, timestamp: Date.now() });
  // Keep secondary game-ID index fresh
  for (const game of data) {
    gameById.set(game.id, game);
  }
}

// Prediction cache - predictions don't change as often as scores
const PREDICTION_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const predictionCache = new LRUCache<string, { prediction: GamePrediction; timestamp: number }>({ max: 500 });

function getCachedPrediction(gameId: string): GamePrediction | null {
  const entry = predictionCache.get(gameId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > PREDICTION_CACHE_TTL_MS) {
    predictionCache.delete(gameId);
    return null;
  }
  return entry.prediction;
}

function setCachedPrediction(gameId: string, prediction: GamePrediction): void {
  predictionCache.set(gameId, { prediction, timestamp: Date.now() });
}

// ─── Live game data type ──────────────────────────────────────────────────────

export interface LiveGameData {
  currentHomeScore: number;
  currentAwayScore: number;
  // Period/quarter/inning number (1-based)
  period: number;
  // Seconds remaining in the current period (null = unknown)
  clockSeconds: number | null;
  // Total periods in a regulation game (4 for NFL/NBA, 3 for NHL, 9 for MLB, 2 for soccer)
  totalPeriods: number;
}

// ─── Live prediction cache (2-minute TTL — must refresh frequently) ───────────

const LIVE_PREDICTION_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const livePredictionCache = new LRUCache<string, { prediction: GamePrediction; timestamp: number }>({ max: 200 });

function getCachedLivePrediction(gameId: string): GamePrediction | null {
  const entry = livePredictionCache.get(gameId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > LIVE_PREDICTION_CACHE_TTL_MS) {
    livePredictionCache.delete(gameId);
    return null;
  }
  return entry.prediction;
}

function setCachedLivePrediction(gameId: string, prediction: GamePrediction): void {
  livePredictionCache.set(gameId, { prediction, timestamp: Date.now() });
}

/**
 * Single source of truth for reading the freshest cached prediction for a game.
 * For LIVE games, prefers the live-adjusted cache (which reflects mid-game
 * win-probability shifts) and falls back to the pregame cache. For non-live
 * games, only the pregame cache is used.
 *
 * Every place that reads cached predictions (transformESPNEvent, the list
 * endpoint, the detail endpoint, etc.) MUST go through this helper. Any
 * place that reads the caches directly will create card↔detail-page
 * inconsistencies (the badge and the detail screen disagreeing on who's
 * favored), which is exactly the bug this helper exists to prevent.
 */
function pickFreshestPrediction(gameId: string, isLive: boolean): GamePrediction | null {
  if (isLive) {
    return getCachedLivePrediction(gameId) ?? getCachedPrediction(gameId);
  }
  return getCachedPrediction(gameId);
}

// Clear all prediction caches — forces regeneration with current engine parameters
export function clearAllPredictionCaches(): void {
  predictionCache.clear();
  livePredictionCache.clear();
}

// ─── Live prediction logic ────────────────────────────────────────────────────

/**
 * Total regulation seconds by sport (used for gameProgress calculation).
 * NBA/NFL/NCAAB/NCAAF: clock counts down each period.
 * MLB: inning-based (no clock) — use period fraction instead.
 * Soccer: 90 min regulation.
 */
const SPORT_REGULATION_SECONDS: Record<string, number> = {
  NBA:   4 * 12 * 60,   // 48 min
  NFL:   4 * 15 * 60,   // 60 min
  NHL:   3 * 20 * 60,   // 60 min
  NCAAB: 2 * 20 * 60,   // 40 min
  NCAAF: 4 * 15 * 60,   // 60 min
  MLB:   9 * 3 * 60,    // proxy: 9 innings × ~3 min each side
  MLS:   90 * 60,
  EPL:   90 * 60,
};

/**
 * Derive the implied win probability for the leading team based purely on
 * current score margin and how much game time remains.
 *
 * Uses a simplified model:
 *   - A lead at full time = 100% confidence (obviously)
 *   - A lead at the start = no additional signal (0% extra confidence)
 *   - In between: the lead's predictive value scales with game progress
 *     and is dampened by score uncertainty (bigger leads are more decisive)
 *
 * Returns homeImpliedWinProb in [0.05, 0.95].
 */
function computeLiveScoreImpliedProb(
  homeScore: number,
  awayScore: number,
  gameProgress: number,
  sport: string
): number {
  const margin = homeScore - awayScore; // positive = home leading

  if (margin === 0) {
    // Tied game — slight lean toward status quo (neither team advantaged)
    return 0.50;
  }

  // Sport-specific "points per minute" scale to judge how meaningful a lead is.
  // A "decisive" lead is ~2× typical scoring rate for remaining time.
  const paceScale: Record<string, number> = {
    NBA: 2.3,    // ~100 pts/48 min ≈ 2.08 pts/min; 2.3 is a bit conservative
    NFL: 0.55,   // ~24 pts/60 min
    NHL: 0.05,   // ~3 goals/60 min — single-goal leads are huge
    NCAAB: 1.6,
    NCAAF: 0.60,
    MLB: 0.06,   // ~5 runs/9 innings; per-inning is small
    MLS: 0.033,  // ~2.5 goals/90 min
    EPL: 0.033,
  };
  const pace = paceScale[sport] ?? 1.0;
  const remainingTime = (1 - gameProgress);

  // Expected total scoring per team in remaining time
  const expectedRemainingScore = pace * remainingTime * 60; // rough: pace × seconds ÷ 60

  // A margin of `expectedRemainingScore` means the trailing team would need
  // to outperform their rate by 2× — roughly a 75% win prob for the leader.
  // Normalize margin to a probability signal.
  const normalizedMargin = expectedRemainingScore > 0
    ? Math.abs(margin) / expectedRemainingScore
    : Math.abs(margin);

  // Sigmoid-style: normalizedMargin of 1.0 → ~73% win prob; 2.0 → ~88%; 0.5 → ~62%
  const sigma = 1 / (1 + Math.exp(-normalizedMargin * 1.5));
  const rawProb = 0.5 + (sigma - 0.5);

  // Apply game-progress weighting — a lead early is weak signal, late is strong
  const progressWeighted = 0.5 + (rawProb - 0.5) * Math.pow(gameProgress, 0.7);

  // Assign to home or away
  const homeWinProb = margin > 0 ? progressWeighted : 1 - progressWeighted;
  return Math.max(0.05, Math.min(0.95, homeWinProb));
}

/**
 * Compute what fraction of regulation time has elapsed.
 * Returns 0.0 (game not started) to 1.0 (game complete / OT).
 */
function computeGameProgress(live: LiveGameData, sport: string): number {
  const totalSeconds = SPORT_REGULATION_SECONDS[sport];
  if (!totalSeconds) return 0;

  const completedPeriods = Math.max(0, live.period - 1);
  const secondsPerPeriod = totalSeconds / live.totalPeriods;

  const completedSeconds = completedPeriods * secondsPerPeriod;

  // Clock remaining in current period
  let elapsedInCurrentPeriod = secondsPerPeriod; // default = full period elapsed
  if (live.clockSeconds !== null && live.clockSeconds >= 0) {
    elapsedInCurrentPeriod = secondsPerPeriod - live.clockSeconds;
  }

  const totalElapsed = completedSeconds + Math.max(0, elapsedInCurrentPeriod);
  return Math.min(1.0, totalElapsed / totalSeconds);
}

/**
 * Apply live game state to a pregame prediction.
 *
 * Blend formula:
 *   liveConfidence = pregameConf * (1 - progress) + liveScoreImplied * progress
 *
 * - If the live score leader matches the pregame pick, confidence is boosted.
 * - If the live score leader is the opposite team, confidence is reduced and
 *   predictedWinner may flip once the live signal is dominant enough.
 * - If it's a blowout (>2× expected margin), the live model takes over fully.
 *
 * This function does NOT modify the factors array — it annotates the returned
 * prediction with `isLiveAdjusted: true` so the client can display it.
 */
export function updateLivePrediction(
  pregame: GamePrediction,
  live: LiveGameData,
  sport: string
): GamePrediction {
  const gameProgress = computeGameProgress(live, sport);

  // Very early in the game (< 5% elapsed) — don't adjust yet, score is noise
  if (gameProgress < 0.05) return pregame;

  const liveHomeWinProb = computeLiveScoreImpliedProb(
    live.currentHomeScore,
    live.currentAwayScore,
    gameProgress,
    sport
  );
  const liveAwayWinProb = 1 - liveHomeWinProb;

  // Pregame probabilities on 0–1 scale
  const pregameHomeProb = pregame.homeWinProbability / 100;
  const pregameAwayProb = pregame.awayWinProbability / 100;

  // Blend: more game elapsed = more weight on live score signal
  const blendedHomeProb = pregameHomeProb * (1 - gameProgress) + liveHomeWinProb * gameProgress;
  const blendedAwayProb = pregameAwayProb * (1 - gameProgress) + liveAwayWinProb * gameProgress;

  // Normalize to sum to 100
  const total = blendedHomeProb + blendedAwayProb;
  const newHomeProb = Math.round((blendedHomeProb / total) * 100);
  const newAwayProb = 100 - newHomeProb;

  // Derive new winner and confidence
  const newPredictedWinner: "home" | "away" = newHomeProb >= 50 ? "home" : "away";
  const newWinnerProb = newPredictedWinner === "home" ? newHomeProb : newAwayProb;
  // Confidence: clamp to [50, 95] — live model can be more aggressive than pregame
  const newConfidence = Math.max(50, Math.min(95, newWinnerProb));

  return {
    ...pregame,
    predictedWinner: newPredictedWinner,
    confidence: newConfidence,
    homeWinProbability: newHomeProb,
    awayWinProbability: newAwayProb,
    // Surface live context in analysis suffix
    analysis: pregame.analysis +
      ` [LIVE Q${live.period}: ${live.currentHomeScore}–${live.currentAwayScore}, ${Math.round(gameProgress * 100)}% elapsed]`,
  };
}

// Parse record string (e.g., "10-3" or "10-3-1") into TeamRecord format
function parseRecord(record: string): { wins: number; losses: number; ties?: number } {
  const parts = record.split('-').map(Number);
  return {
    wins: parts[0] || 0,
    losses: parts[1] || 0,
    ties: parts[2] !== undefined ? parts[2] : undefined,
  };
}

// Sport string to enum mappings
const sportEnumMap: Record<string, SportEnum> = {
  NFL: SportEnum.NFL, NBA: SportEnum.NBA, MLB: SportEnum.MLB, NHL: SportEnum.NHL,
  MLS: SportEnum.MLS, NCAAF: SportEnum.NCAAF, NCAAB: SportEnum.NCAAB, EPL: SportEnum.EPL,
};

const leagueMap: Record<string, League> = {
  NFL: League.Pro, NBA: League.Pro, MLB: League.Pro, NHL: League.Pro,
  MLS: League.Pro, NCAAF: League.College, NCAAB: League.College, EPL: League.Pro,
};

// ─── Live helper utilities ────────────────────────────────────────────────────

/** Total regulation periods by sport. */
const SPORT_TOTAL_PERIODS: Record<string, number> = {
  NBA: 4, NFL: 4, NCAAF: 4, NCAAB: 2, NHL: 3, MLB: 9, MLS: 2, EPL: 2,
};

/**
 * Parse a period/quarter string like "Q2", "2nd Period", "1st Half", "Top 5th"
 * into a 1-based integer. Returns null if unparseable.
 */
function parsePeriodNumber(quarter: string): number | null {
  if (!quarter) return null;
  // Match leading digit (e.g. "2nd Period" → 2, "Q3" → 3)
  const m = quarter.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0]!, 10);
  return isNaN(n) ? null : Math.max(1, n);
}

/**
 * Parse a game-clock string like "12:34" or "0:45" into total seconds remaining.
 * Returns null if unparseable.
 */
function parseClockSeconds(clock: string): number | null {
  if (!clock) return null;
  const parts = clock.split(":");
  if (parts.length !== 2) return null;
  const mins = parseInt(parts[0]!, 10);
  const secs = parseInt(parts[1]!, 10);
  if (isNaN(mins) || isNaN(secs)) return null;
  return mins * 60 + secs;
}

// Generate AI prediction for an ESPN game, with live adjustment when in-progress
async function addPredictionToGame(game: Game): Promise<Game> {
  const isLive = game.status === "LIVE";

  // For live games: check the 2-minute live cache first
  if (isLive) {
    const cachedLive = getCachedLivePrediction(game.id);
    if (cachedLive) {
      return {
        ...game,
        spread: game.spread ?? cachedLive.spread,
        overUnder: game.overUnder ?? cachedLive.overUnder,
        marketFavorite: game.marketFavorite ?? cachedLive.marketFavorite,
        prediction: cachedLive,
      };
    }
  }

  // Check pregame prediction cache (15 min TTL)
  const cachedPrediction = getCachedPrediction(game.id);
  if (cachedPrediction && !isLive) {
    return {
      ...game,
      spread: game.spread ?? cachedPrediction.spread,
      overUnder: game.overUnder ?? cachedPrediction.overUnder,
      marketFavorite: game.marketFavorite ?? cachedPrediction.marketFavorite,
      prediction: cachedPrediction,
    };
  }

  const homeRecord = parseRecord(game.homeTeam.record);
  const awayRecord = parseRecord(game.awayTeam.record);

  const sportsGame: SportsGame = {
    id: game.id,
    sport: sportEnumMap[game.sport] || SportEnum.NFL,
    league: leagueMap[game.sport] || League.Pro,
    homeTeam: {
      id: game.homeTeam.id,
      name: game.homeTeam.name,
      abbreviation: game.homeTeam.abbreviation,
      logo: game.homeTeam.logo || '',
      record: homeRecord,
    },
    awayTeam: {
      id: game.awayTeam.id,
      name: game.awayTeam.name,
      abbreviation: game.awayTeam.abbreviation,
      logo: game.awayTeam.logo || '',
      record: awayRecord,
    },
    dateTime: game.gameTime,
    venue: game.venue,
    tvChannel: game.tvChannel || '',
    status: game.status === 'LIVE' ? SportsGameStatus.InProgress
           : game.status === 'FINAL' ? SportsGameStatus.Final
           : game.status === 'POSTPONED' ? SportsGameStatus.Postponed
           : SportsGameStatus.Scheduled,
  };

  const prediction = await generatePrediction(sportsGame, game.spread, game.overUnder);

  const predictionResult: GamePrediction = {
    id: `pred-${game.id}`,
    gameId: game.id,
    predictedWinner: prediction.predictedWinner,
    confidence: prediction.confidence,
    analysis: prediction.aiAnalysis,
    predictedSpread: prediction.spread,
    predictedTotal: prediction.overUnder,
    marketFavorite: prediction.marketFavorite,
    spread: prediction.spread,
    overUnder: prediction.overUnder,
    createdAt: new Date().toISOString(),
    homeWinProbability: prediction.homeWinProbability,
    awayWinProbability: prediction.awayWinProbability,
    factors: prediction.factors,
    edgeRating: prediction.edgeRating,
    valueRating: prediction.valueRating,
    recentFormHome: prediction.recentFormHome,
    recentFormAway: prediction.recentFormAway,
    homeStreak: prediction.homeStreak,
    awayStreak: prediction.awayStreak,
    isTossUp: prediction.isTossUp ?? false,
  };

  // ── Winner-change detection ─────────────────────────────────────────────────
  // Compare new prediction with previous cached version. If the predicted winner
  // flipped, notify users and update the database record so the app always shows
  // the latest pick — never stale data.
  if (cachedPrediction && cachedPrediction.predictedWinner !== predictionResult.predictedWinner) {
    console.log(`[PredictionFlip] ${game.id}: ${cachedPrediction.predictedWinner} → ${predictionResult.predictedWinner} (${predictionResult.confidence}%)`);
    // Bust the AI analysis cache so it regenerates text for the new winner
    bustAIAnalysisCache(game.id);
    // Update DB record to reflect the new winner
    prisma.predictionResult.updateMany({
      where: { gameId: game.id },
      data: {
        predictedWinner: predictionResult.predictedWinner,
        confidence: predictionResult.confidence,
        isTossUp: predictionResult.isTossUp ?? false,
      },
    }).catch(err => console.error('[PredictionFlip] DB update failed:', err));

    // Fire notification in background — don't block the response
    notifyWinnerFlip(
      game.id,
      game.homeTeam.abbreviation,
      game.awayTeam.abbreviation,
      game.sport,
      predictionResult.predictedWinner,
      predictionResult.confidence
    ).catch(err => console.error('[PredictionFlip] Notify failed:', err));
  }

  // Cache the pregame prediction (15-min TTL)
  setCachedPrediction(game.id, predictionResult);

  // ── Shadow: run new engine in background (fire-and-forget) ────────────────
  // When USE_NEW_PREDICTION_ENGINE is false, the old prediction above is served
  // to users. The new engine runs in parallel for comparison logging only.
  // A failure here NEVER affects the user-facing response.
  if (!useNewEngine()) {
    runShadowPrediction(
      game,
      {
        predictedWinner: prediction.predictedWinner,
        homeWinProbability: prediction.homeWinProbability,
        confidence: prediction.confidence,
      },
    );
  }

  // ── Live adjustment ────────────────────────────────────────────────────────
  // When the game is in progress and scores are available, blend the pregame
  // model with live score signal. Cache the result for 2 minutes.
  let finalPrediction = predictionResult;
  if (isLive && game.homeScore !== undefined && game.awayScore !== undefined) {
    const period = parsePeriodNumber(game.quarter ?? "");
    const clockSec = parseClockSeconds(game.clock ?? "");
    const totalPeriods = SPORT_TOTAL_PERIODS[game.sport] ?? 4;

    const liveData: LiveGameData = {
      currentHomeScore: game.homeScore,
      currentAwayScore: game.awayScore,
      period: period ?? 1,
      clockSeconds: clockSec,
      totalPeriods,
    };

    finalPrediction = updateLivePrediction(predictionResult, liveData, game.sport);

    // Check if the live adjustment flipped the winner vs the pregame prediction
    if (predictionResult.predictedWinner !== finalPrediction.predictedWinner) {
      console.log(`[LiveFlip] ${game.id}: ${predictionResult.predictedWinner} → ${finalPrediction.predictedWinner} (live score shift)`);
      notifyWinnerFlip(
        game.id,
        game.homeTeam.abbreviation,
        game.awayTeam.abbreviation,
        game.sport,
        finalPrediction.predictedWinner,
        finalPrediction.confidence
      ).catch(err => console.error('[LiveFlip] Notify failed:', err));
    }

    setCachedLivePrediction(game.id, finalPrediction);
  }

  return {
    ...game,
    spread: game.spread ?? prediction.spread,
    overUnder: game.overUnder ?? prediction.overUnder,
    marketFavorite: game.marketFavorite ?? prediction.marketFavorite,
    prediction: finalPrediction,
  };
}

// Background prediction generation - non-blocking
function generatePredictionsInBackground(games: Game[]): void {
  const gamesNeedingPredictions = games.filter(g => !g.prediction);
  if (gamesNeedingPredictions.length === 0) return;

  // Run in background, don't await
  (async () => {
    try {
      await batchProcess(
        gamesNeedingPredictions,
        async (game) => {
          try {
            await addPredictionToGame(game);
          } catch (e) {
            // Silently fail for individual predictions
          }
        },
        3 // Lower concurrency for background work
      );
    } catch (e) {
      console.error("Background prediction generation failed:", e);
    }
  })();
}

// Map ESPN status to our status
function mapGameStatus(
  status: ESPNStatus
): "SCHEDULED" | "LIVE" | "FINAL" | "POSTPONED" | "CANCELLED" {
  const state = status.type.state.toLowerCase();
  const name = status.type.name.toLowerCase();
  if (name.includes("postponed")) return "POSTPONED";
  if (name.includes("canceled") || name.includes("cancelled")) return "CANCELLED";
  if (state === "in") return "LIVE";
  if (state === "post" || status.type.completed) return "FINAL";
  return "SCHEDULED";
}

function getPeriodDisplay(status: ESPNStatus, sport: SportKey): string | undefined {
  if (status.type.state.toLowerCase() !== "in") return undefined;
  const period = status.period;
  if (!period) return undefined;

  if (sport === "NHL") {
    if (period === 1) return "1st Period";
    if (period === 2) return "2nd Period";
    if (period === 3) return "3rd Period";
    if (period > 3) return "OT";
    return `Period ${period}`;
  }
  if (sport === "NCAAB") {
    if (period === 1) return "1st Half";
    if (period === 2) return "2nd Half";
    if (period > 2) return "OT";
    return `Half ${period}`;
  }
  if (sport === "NBA") {
    if (period <= 4) return `Q${period}`;
    return "OT";
  }
  if (sport === "NFL") {
    if (period <= 4) return `Q${period}`;
    return "OT";
  }
  if (sport === "NCAAF") {
    if (period <= 4) return `Q${period}`;
    return "OT";
  }
  if (sport === "MLB") {
    const detail = status.type.shortDetail || "";
    return detail;
  }
  if (sport === "MLS" || sport === "EPL") {
    const detail = status.type.shortDetail || "";
    return detail;
  }
  return `Period ${period}`;
}

async function transformESPNEvent(event: ESPNEvent, sport: SportKey): Promise<Game | null> {
  const competition = event.competitions[0];
  if (!competition) return null;

  const homeCompetitor = competition.competitors.find((c) => c.homeAway === "home");
  const awayCompetitor = competition.competitors.find((c) => c.homeAway === "away");
  if (!homeCompetitor || !awayCompetitor) return null;

  const homeTeam = homeCompetitor.team;
  const awayTeam = awayCompetitor.team;

  const getRecord = (competitor: ESPNCompetitor): string => {
    const overallRecord = competitor.records?.find(
      (r) => r.type === "total" || r.type === "overall"
    );
    return overallRecord?.summary || "0-0";
  };

  const getTeamLogo = (team: ESPNTeam): string | undefined => {
    if (team.logo) return team.logo;
    return team.logos?.[0]?.href;
  };

  const odds = competition.odds?.[0];
  let spread: number | undefined;
  let overUnder: number | undefined;
  let marketFavorite: "home" | "away" | undefined;

  if (odds) {
    overUnder = odds.overUnder;
    spread = odds.spread;
    if (odds.homeTeamOdds?.favorite) {
      marketFavorite = "home";
    } else if (odds.awayTeamOdds?.favorite) {
      marketFavorite = "away";
    }
  }

  const tvChannel = competition.broadcasts?.[0]?.names?.[0];
  const gameStatus = mapGameStatus(competition.status);
  const quarter = getPeriodDisplay(competition.status, sport);
  const clock = gameStatus === "LIVE" ? competition.status.displayClock : undefined;

  const homeScore = homeCompetitor.score ? parseInt(homeCompetitor.score, 10) : undefined;
  const awayScore = awayCompetitor.score ? parseInt(awayCompetitor.score, 10) : undefined;

  const extractLinescores = (c: ESPNCompetitor): number[] | undefined => {
    if (!c.linescores || c.linescores.length === 0) return undefined;
    return c.linescores.map((ls) => (typeof ls.value === "number" ? ls.value : 0));
  };
  const homeLinescores = extractLinescores(homeCompetitor);
  const awayLinescores = extractLinescores(awayCompetitor);

  // MLB live state: parse competition.situation when game is live.
  // Wrapped in try/catch so a malformed payload never breaks the response.
  let liveState: Game["liveState"] | undefined;
  if (sport === "MLB" && gameStatus === "LIVE" && competition.situation) {
    try {
      const s = competition.situation;
      const detail = (competition.status.type.detail || competition.status.type.shortDetail || "").toLowerCase();
      const inningHalf: "top" | "bottom" | null =
        detail.startsWith("top") ? "top" : detail.startsWith("bot") ? "bottom" : null;
      const battingAbbr =
        inningHalf === "bottom" ? homeTeam.abbreviation : awayTeam.abbreviation;
      const pitchingAbbr =
        inningHalf === "bottom" ? awayTeam.abbreviation : homeTeam.abbreviation;
      const pitcherName =
        s.pitcher?.athlete?.displayName ?? s.pitcher?.athlete?.fullName ?? null;
      const batterName =
        s.batter?.athlete?.displayName ?? s.batter?.athlete?.fullName ?? null;
      liveState = {
        balls: s.balls ?? 0,
        strikes: s.strikes ?? 0,
        outs: s.outs ?? 0,
        onFirst: s.onFirst === true,
        onSecond: s.onSecond === true,
        onThird: s.onThird === true,
        inningHalf,
        inningNumber: typeof competition.status.period === "number" ? competition.status.period : null,
        pitcher: { name: pitcherName, teamAbbr: pitchingAbbr },
        batter: { name: batterName, teamAbbr: battingAbbr },
      };
    } catch (err) {
      console.warn(`[mlb-livestate] failed to parse situation for game ${event.id}:`, err);
      liveState = undefined;
    }
  }

  const game: Game = {
    id: event.id,
    sport,
    homeTeam: {
      id: homeTeam.id,
      name: homeTeam.displayName || homeTeam.name,
      abbreviation: homeTeam.abbreviation,
      city: homeTeam.shortDisplayName || homeTeam.name.split(" ")[0] || "",
      record: getRecord(homeCompetitor),
      color: homeTeam.color ? `#${homeTeam.color}` : "#333333",
      logo: getTeamLogo(homeTeam),
    },
    awayTeam: {
      id: awayTeam.id,
      name: awayTeam.displayName || awayTeam.name,
      abbreviation: awayTeam.abbreviation,
      city: awayTeam.shortDisplayName || awayTeam.name.split(" ")[0] || "",
      record: getRecord(awayCompetitor),
      color: awayTeam.color ? `#${awayTeam.color}` : "#333333",
      logo: getTeamLogo(awayTeam),
    },
    gameTime: event.date,
    status: gameStatus,
    venue: competition.venue?.fullName || "TBD",
    tvChannel,
    homeScore: homeScore !== undefined && !isNaN(homeScore) ? homeScore : undefined,
    awayScore: awayScore !== undefined && !isNaN(awayScore) ? awayScore : undefined,
    spread,
    overUnder,
    marketFavorite,
    quarter,
    clock,
    homeLinescores,
    awayLinescores,
    liveState,
  };

  // Attach freshest cached prediction if available, don't block on generating
  // new ones. Use the shared helper so live games pick the live-adjusted cache
  // (matching what the list/detail endpoints will return).
  const cachedPrediction = pickFreshestPrediction(game.id, gameStatus === "LIVE");
  if (cachedPrediction) {
    return {
      ...game,
      spread: game.spread ?? cachedPrediction.spread,
      overUnder: game.overUnder ?? cachedPrediction.overUnder,
      marketFavorite: game.marketFavorite ?? cachedPrediction.marketFavorite,
      prediction: cachedPrediction,
    };
  }
  return game;
}

// ─── Circuit breaker for ESPN API ────────────────────────────────────────────
const CIRCUIT_FAILURE_THRESHOLD = 5;   // open after this many consecutive failures
const CIRCUIT_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

type CircuitState = "closed" | "open" | "half-open";

const circuit = {
  state: "closed" as CircuitState,
  consecutiveFailures: 0,
  openedAt: 0,
};

function recordESPNSuccess() {
  if (circuit.state !== "closed") {
    console.log("[circuit-breaker] ESPN API recovered — circuit closed.");
    circuit.state = "closed";
  }
  circuit.consecutiveFailures = 0;
}

function recordESPNFailure() {
  circuit.consecutiveFailures++;
  if (circuit.state === "closed" && circuit.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.state = "open";
    circuit.openedAt = Date.now();
    console.warn(`[circuit-breaker] ESPN API circuit OPENED after ${CIRCUIT_FAILURE_THRESHOLD} consecutive failures. Serving stale cache for 2 minutes.`);
  } else if (circuit.state === "half-open") {
    // Probe failed — reopen
    circuit.state = "open";
    circuit.openedAt = Date.now();
    console.warn("[circuit-breaker] ESPN API probe failed — circuit re-opened.");
  }
}

/** Returns true if we should attempt an ESPN request right now. */
function circuitAllowsRequest(): boolean {
  if (circuit.state === "closed") return true;
  if (circuit.state === "open") {
    if (Date.now() - circuit.openedAt >= CIRCUIT_COOLDOWN_MS) {
      circuit.state = "half-open";
      console.log("[circuit-breaker] Cooldown elapsed — trying one probe request.");
      return true;
    }
    return false; // still cooling down
  }
  // half-open: one probe allowed
  return true;
}
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGamesFromESPN(sport: SportKey, date?: string, fullList = false): Promise<Game[]> {
  const baseUrl = ESPN_ENDPOINTS[sport];
  const params = new URLSearchParams();

  if (date) {
    const formattedDate = date.replace(/-/g, "");
    params.set("dates", formattedDate);
  }

  // College sports: use a smaller default limit for live/main fetches; only expand when
  // a full schedule is explicitly requested (e.g. the dedicated /:sport route).
  if (sport === "NCAAB") {
    params.set("groups", "50");
    params.set("limit", fullList ? "300" : "50");
  } else if (sport === "NCAAF") {
    params.set("groups", "80");
    params.set("limit", fullList ? "300" : "50");
  }

  const queryString = params.toString();
  const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;

  // Circuit breaker: skip the network call when the circuit is open
  if (!circuitAllowsRequest()) {
    return [];
  }

  // 8-second hard timeout on every ESPN request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.error(`ESPN API error for ${sport}: ${response.status}`);
      recordESPNFailure();
      return [];
    }

    const data = (await response.json()) as ESPNScoreboardResponse;
    if (!data.events || !Array.isArray(data.events)) {
      recordESPNFailure();
      return [];
    }

    recordESPNSuccess();
    const resolved = await batchProcess(
      data.events,
      (event) => transformESPNEvent(event, sport),
      8 // Process 8 games at a time
    );
    const games: Game[] = resolved.filter((g): g is Game => g !== null);
    // Populate gameId → sport index for fast /id/:id lookups
    for (const game of games) {
      gameIdToSport.set(game.id, sport);
    }
    return games;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`[ESPN] fetch timed out for ${sport}:`, url);
      recordESPNFailure();
      return [];
    }
    console.error(`Error fetching ${sport} games from ESPN:`, error);
    recordESPNFailure();
    return [];
  }
}

async function fetchAllGames(date?: string): Promise<Game[]> {
  const cacheKey = `all-games-${date || "default"}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  // Circuit open: return stale data rather than empty results
  if (circuit.state === "open") {
    const stale = cache.get(cacheKey);
    if (stale) return stale.data;
  }

  // Deduplicate concurrent requests for the same key
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const sports: SportKey[] = ["NFL", "NBA", "MLB", "NHL", "MLS", "NCAAF", "NCAAB", "EPL"];

    const allGamesPromises: Promise<Game[]>[] = [];
    for (const sport of sports) {
      allGamesPromises.push(fetchGamesFromESPN(sport, date));
    }

    const results = await Promise.all(allGamesPromises);
    const allGames = results.flat();

    const uniqueGames = Array.from(
      new Map(allGames.map((game) => [game.id, game])).values()
    );

    uniqueGames.sort(
      (a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()
    );

    // Don't overwrite good stale data with an empty result from an open circuit
    if (uniqueGames.length === 0 && circuit.state !== "closed") {
      const stale = cache.get(cacheKey);
      if (stale) return stale.data;
    }

    setCacheData(cacheKey, uniqueGames);
    return uniqueGames;
  })();

  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function fetchGamesBySport(sport: SportKey, date?: string, fullList = false): Promise<Game[]> {
  const cacheKey = `${sport}-games-${date || "default"}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  // Circuit open: return stale data rather than empty results
  if (circuit.state === "open") {
    const stale = cache.get(cacheKey);
    if (stale) return stale.data;
  }

  // Deduplicate concurrent requests for the same key
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const games = await fetchGamesFromESPN(sport, date, fullList);

    // Don't overwrite good stale data with an empty result from an open circuit
    if (games.length === 0 && circuit.state !== "closed") {
      const stale = cache.get(cacheKey);
      if (stale) return stale.data;
    }

    setCacheData(cacheKey, games);
    return games;
  })();

  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

const gamesRouter = new Hono();

// Force-refresh all predictions (clears cache so new engine params take effect)
// Admin-only: requires authenticated user whose ID matches ADMIN_USER_ID env var
gamesRouter.post("/refresh-predictions", async (c) => {
  const user = c.get("user") as { id: string } | null;
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }
  const adminId = process.env.ADMIN_USER_ID;
  if (adminId && user.id !== adminId) {
    return c.json({ error: { message: "Forbidden", code: "FORBIDDEN" } }, 403);
  }
  clearAllPredictionCaches();
  return c.json({ data: { cleared: true, message: "Prediction caches cleared. New predictions will generate on next request." } });
});

gamesRouter.get("/", async (c) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    // Fetch today + tomorrow in parallel (tomorrow needed for western timezone coverage)
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const [todayGames, tomorrowGames] = await Promise.all([
      fetchAllGames(todayStr),
      fetchAllGames(tomorrowStr),
    ]);

    // Check if we need yesterday's live games (only if any might still be running)
    const hour = now.getUTCHours();
    let extraGames: Game[] = [];

    if (hour < 12) {
      // Early in UTC day - yesterday's games might still be live
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      const yesterdayGames = await fetchAllGames(yesterdayStr);
      extraGames = yesterdayGames.filter((g) => g.status === "LIVE");
    }

    const allGames = [...extraGames, ...todayGames, ...tomorrowGames];

    // Deduplicate by game ID
    const uniqueGames = Array.from(
      new Map(allGames.map((game) => [game.id, game])).values()
    );

    // Filter: keep games within today's window (with tomorrow included)
    const endOfToday = new Date(now);
    endOfToday.setDate(endOfToday.getDate() + 1);
    endOfToday.setUTCHours(23, 59, 59, 999);

    const filteredGames = uniqueGames.filter((game) => {
      if (game.status === "LIVE" || game.status === "FINAL") return true;
      return new Date(game.gameTime) <= endOfToday;
    });

    filteredGames.sort(
      (a, b) =>
        new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()
    );

    // Attach the freshest cached prediction — never block the response for
    // generation. ALWAYS overwrite any prediction the indexed/transformed game
    // already had: that earlier value may have been computed against an older
    // cache snapshot, and only the current cache value is guaranteed to match
    // what the detail endpoint will return for the same game.
    for (let i = 0; i < filteredGames.length; i++) {
      const game = filteredGames[i]!;
      const cached = pickFreshestPrediction(game.id, game.status === "LIVE");
      if (cached) {
        filteredGames[i] = { ...game, prediction: cached };
      }
    }

    // Generate missing predictions entirely in background — the client will
    // pick them up on the next poll (6-10 seconds later)
    const gamesNeedingPredictions = filteredGames.filter(g => !g.prediction);
    if (gamesNeedingPredictions.length > 0) {
      generatePredictionsInBackground(gamesNeedingPredictions);
    }

    // Fire-and-forget: resolve any pending picks against final scores (throttled to once/minute)
    if (Date.now() - lastResolveTime > RESOLVE_COOLDOWN_MS) {
      lastResolveTime = Date.now();
      resolvePicksInBackground();
    }

    return c.json({ data: filteredGames });
  } catch (error) {
    console.error("Error fetching all games:", error);
    return c.json(
      { error: { message: "Failed to fetch games", code: "FETCH_FAILED" } },
      500
    );
  }
});

// Special endpoint for top picks - generates predictions synchronously for best picks
gamesRouter.get("/top-picks", async (c) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    // Fetch today's games
    const todayGames = await fetchAllGames(todayStr);

    // Also get tomorrow's early games for timezone coverage
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];
    const tomorrowGames = await fetchAllGames(tomorrowStr);

    const allGames = [...todayGames, ...tomorrowGames];

    // Deduplicate by game ID
    const uniqueGames = Array.from(
      new Map(allGames.map((game) => [game.id, game])).values()
    );

    // Filter to only scheduled games (not finished)
    const scheduledGames = uniqueGames.filter(
      (g) => g.status === "SCHEDULED" || g.status === "LIVE"
    );

    // Group by sport and pick one game per sport
    const gamesBySport = new Map<string, Game[]>();
    for (const game of scheduledGames) {
      const existing = gamesBySport.get(game.sport) || [];
      existing.push(game);
      gamesBySport.set(game.sport, existing);
    }

    // Select one representative game per sport (first scheduled)
    const representativeGames: Game[] = [];
    for (const games of gamesBySport.values()) {
      // Sort by game time and take the first scheduled one
      const sorted = games.sort(
        (a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()
      );
      if (sorted[0]) {
        representativeGames.push(sorted[0]);
      }
    }

    // Generate predictions SYNCHRONOUSLY for these top picks (max ~8 games)
    const gamesWithPredictions = await batchProcess(
      representativeGames,
      async (game) => {
        try {
          return await addPredictionToGame(game);
        } catch (e) {
          console.error(`Failed to generate prediction for ${game.id}:`, e);
          return game;
        }
      },
      4 // Process 4 at a time
    );

    // Sort by confidence descending
    const sortedByConfidence = gamesWithPredictions
      .filter((g) => g.prediction && g.prediction.confidence > 0)
      .sort((a, b) => (b.prediction?.confidence ?? 0) - (a.prediction?.confidence ?? 0));

    return c.json({ data: sortedByConfidence });
  } catch (error) {
    console.error("Error fetching top picks:", error);
    return c.json(
      { error: { message: "Failed to fetch top picks", code: "FETCH_FAILED" } },
      500
    );
  }
});

gamesRouter.get("/date/:date", async (c) => {
  const dateParam = c.req.param("date");
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateParam)) {
    return c.json(
      { error: { message: "Invalid date format. Use YYYY-MM-DD.", code: "INVALID_DATE_FORMAT" } },
      400
    );
  }

  try {
    const games = await fetchAllGames(dateParam);
    return c.json({ data: games });
  } catch (error) {
    console.error(`Error fetching games for date ${dateParam}:`, error);
    return c.json(
      { error: { message: "Failed to fetch games", code: "FETCH_FAILED" } },
      500
    );
  }
});

gamesRouter.get("/id/:id", async (c) => {
  const gameId = c.req.param("id");

  try {
    // Helper to ensure game has the freshest prediction.
    //
    // We do NOT short-circuit on `game.prediction` even if it's already set:
    // the indexed game's prediction may have been attached at transform time
    // when the cache held an older value, and we want this endpoint to return
    // the same value the list endpoint would return right now (otherwise the
    // game card badge and the detail page can disagree on who's favored).
    const ensurePrediction = async (game: Game): Promise<Game> => {
      const cached = pickFreshestPrediction(game.id, game.status === "LIVE");
      if (cached) {
        return { ...game, prediction: cached };
      }
      // No cache at all — generate on-demand (fast, uses AI cache).
      return addPredictionToGame(game);
    };

    // First, check secondary game-ID index — O(1) lookup across all cached data
    const indexedGame = gameById.get(gameId);
    if (indexedGame) {
      const gameWithPrediction = await ensurePrediction(indexedGame);
      return c.json({ data: gameWithPrediction });
    }

    // Fetch today's games (will use cache if available)
    const todayStr = new Date().toISOString().split("T")[0]!;
    const allGames = await fetchAllGames(todayStr);
    const game = allGames.find((g) => g.id === gameId);

    if (game) {
      const gameWithPrediction = await ensurePrediction(game);
      return c.json({ data: gameWithPrediction });
    }

    // Fallback: search nearby dates (+-3 days)
    const today = new Date();
    const dates: string[] = [];
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue; // already checked today
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().split("T")[0]!);
    }

    // Fix 4: if we know which sport this game belongs to, only search that sport
    const knownSport = gameIdToSport.get(gameId);
    const dateResults = await Promise.all(
      dates.map(async (date) => {
        const games = knownSport
          ? await fetchGamesBySport(knownSport, date)
          : await fetchAllGames(date);
        return games.find((g) => g.id === gameId) ?? null;
      })
    );
    const foundGame = dateResults.find((g) => g !== null);
    if (foundGame) {
      const gameWithPrediction = await ensurePrediction(foundGame);
      return c.json({ data: gameWithPrediction });
    }

    return c.json(
      { error: { message: `Game not found: ${gameId}`, code: "GAME_NOT_FOUND" } },
      404
    );
  } catch (error) {
    console.error(`Error fetching game ${gameId}:`, error);
    return c.json(
      { error: { message: "Failed to fetch game", code: "FETCH_FAILED" } },
      500
    );
  }
});

gamesRouter.get("/:sport", async (c) => {
  const sportParam = c.req.param("sport").toUpperCase() as SportKey;

  if (!ESPN_ENDPOINTS[sportParam]) {
    return c.json(
      {
        error: {
          message: `Invalid sport: ${sportParam}. Valid options: NFL, NBA, MLB, NHL, MLS, NCAAF, NCAAB, EPL`,
          code: "INVALID_SPORT",
        },
      },
      400
    );
  }

  const dateQuery = c.req.query("date");

  try {
    const games = await fetchGamesBySport(sportParam, dateQuery || undefined, true);
    return c.json({ data: games });
  } catch (error) {
    console.error(`Error fetching ${sportParam} games:`, error);
    return c.json(
      { error: { message: "Failed to fetch games", code: "FETCH_FAILED" } },
      500
    );
  }
});

// ─── Live games SSE cache ────────────────────────────────────────────────────

interface LiveScore {
  id: string;
  sport: string;
  homeTeam: { abbreviation: string; name: string };
  awayTeam: { abbreviation: string; name: string };
  homeScore: number;
  awayScore: number;
  clock: string | null;
  period: number | null;
  quarter: string | null;
  status: "LIVE";
}

let liveGamesCache: { data: LiveScore[]; timestamp: number } | null = null;
const LIVE_POLL_INTERVAL = 4_000; // 4 seconds — fast ESPN polling for live scores

// Fix 1: throttle resolvePicksInBackground — at most once per minute
let lastResolveTime = 0;
const RESOLVE_COOLDOWN_MS = 60_000;

// Fix 3: track which sports currently have live games so SSE skips idle ones
let activeSports: Set<SportKey> = new Set();
let lastFullScanTime = 0;
const FULL_SCAN_INTERVAL_MS = 30_000; // 30s — discover new live games quickly

// Fix 4: gameId → sport for targeted /id/:id fallback searches
const gameIdToSport = new Map<string, SportKey>();

async function fetchLiveGamesOnce(): Promise<LiveScore[]> {
  const now = Date.now();
  if (liveGamesCache && now - liveGamesCache.timestamp < LIVE_POLL_INTERVAL) {
    return liveGamesCache.data;
  }

  const allSports: SportKey[] = ["NFL", "NBA", "MLB", "NHL", "MLS", "NCAAF", "NCAAB", "EPL"];

  // Fix 3: only poll sports known to have live games; do a full scan periodically to rediscover
  const doFullScan = activeSports.size === 0 || (now - lastFullScanTime > FULL_SCAN_INTERVAL_MS);
  const sportsToCheck = doFullScan ? allSports : allSports.filter((s) => activeSports.has(s));
  if (doFullScan) lastFullScanTime = now;

  const results = await Promise.all(
    sportsToCheck.map(async (sport): Promise<LiveScore[]> => {
      try {
        if (!circuitAllowsRequest()) return [];

        // Fix 2: 8-second timeout on SSE ESPN fetches
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        let resp: Response;
        try {
          resp = await fetch(ESPN_ENDPOINTS[sport], { signal: controller.signal });
          clearTimeout(timeoutId);
        } catch (err) {
          clearTimeout(timeoutId);
          if (err instanceof Error && err.name === "AbortError") {
            console.warn(`[ESPN] live fetch timed out for ${sport}`);
          }
          return [];
        }

        if (!resp.ok) return [];
        const data = (await resp.json()) as ESPNScoreboardResponse;
        if (!data.events) return [];

        return data.events
          .filter((ev) => {
            const comp = ev.competitions?.[0];
            if (!comp) return false;
            const state = comp.status?.type?.state?.toLowerCase();
            return state === "in";
          })
          .map((ev): LiveScore | null => {
            const comp = ev.competitions[0];
            if (!comp) return null;
            const home = comp.competitors.find((c) => c.homeAway === "home");
            const away = comp.competitors.find((c) => c.homeAway === "away");
            if (!home || !away) return null;

            return {
              id: ev.id,
              sport,
              homeTeam: {
                abbreviation: home.team.abbreviation,
                name: home.team.shortDisplayName || home.team.name,
              },
              awayTeam: {
                abbreviation: away.team.abbreviation,
                name: away.team.shortDisplayName || away.team.name,
              },
              homeScore: parseInt(home.score ?? "0", 10),
              awayScore: parseInt(away.score ?? "0", 10),
              clock: comp.status.displayClock ?? null,
              period: comp.status.period ?? null,
              quarter: getPeriodDisplay(comp.status, sport) ?? null,
              status: "LIVE",
            };
          })
          .filter((s): s is LiveScore => s !== null);
      } catch {
        return [];
      }
    })
  );

  const data = results.flat();

  // Fix 3: update activeSports to only the sports that returned live games
  const newActive = new Set<SportKey>();
  for (const score of data) {
    newActive.add(score.sport as SportKey);
  }
  activeSports = newActive;

  liveGamesCache = { data, timestamp: now };
  return data;
}

// SSE endpoint: streams live scores every 4 seconds
gamesRouter.get("/live-stream", async (c) => {
  return streamSSE(c, async (stream) => {
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    const sendScores = async (): Promise<boolean> => {
      try {
        const scores = await fetchLiveGamesOnce();
        await stream.writeSSE({ data: JSON.stringify(scores), event: "scores" });
        return true;
      } catch {
        return false;
      }
    };

    // Send immediately
    if (!(await sendScores())) return;

    // Loop every 4 seconds; send a heartbeat every 3rd tick (~12s) to keep NAT/proxy alive
    let ticksSinceHeartbeat = 0;
    while (!aborted) {
      try {
        await stream.sleep(LIVE_POLL_INTERVAL);
      } catch {
        break;
      }
      if (aborted) break;
      ticksSinceHeartbeat++;
      if (ticksSinceHeartbeat >= 3) {
        ticksSinceHeartbeat = 0;
        try { await stream.writeSSE({ data: "", event: "heartbeat" }); } catch { break; }
        if (aborted) break;
      }
      if (!(await sendScores())) break;
    }
  });
});

export { gamesRouter };
