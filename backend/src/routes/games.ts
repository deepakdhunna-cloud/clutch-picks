/**
 * Real-time Sports Games API Routes
 * Fetches live game data from ESPN's unofficial API with AI predictions
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { LRUCache } from "lru-cache";
import { cleanOldShadowLogs } from "../prediction/shadow";
import { runNewEnginePrediction } from "../prediction/newEngineAdapter";
import { deriveSeasonContext, type NarrativeSeasonContext } from "../prediction/seasonContext";
import { buildDeterministicNarrative, buildNarrativeInput } from "../prediction/narrative";
import { getConfidenceBand, type FactorContribution } from "../prediction/types";
import { notifyWinnerFlip } from "../lib/notification-jobs";
import { fetchMarketConsensus } from "../lib/sharpApi";

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
  UCL: "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard",
  IPL: "https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard",
  TENNIS: "https://www.espn.com/tennis/scoreboard/_/date",
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
  rank?: number;
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
  predictedOutcome?: "home" | "away" | "draw";
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
  projection?: {
    engine: string;
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
    signals: Array<{
      key: string;
      label: string;
      value: number;
      evidence: string;
    }>;
  };
  // Comparison to SharpAPI market consensus. Market gets a small calibration
  // vote in the new engine, then this object reports the remaining gap.
  marketComparison?: {
    modelHomeProb: number;     // 0..1
    marketHomeProb: number;    // 0..1 (Pinnacle de-vigged)
    divergence: number;        // 0..1, absolute
    isDivergent: boolean;      // divergence > 0.10
    bestBook?: { sportsbook: string; american: number } | null;
  };
}

export interface Game {
  id: string;
  sport: "NFL" | "NBA" | "MLB" | "NHL" | "MLS" | "NCAAF" | "NCAAB" | "EPL" | "UCL" | "IPL" | "TENNIS";
  homeTeam: GameTeam;
  awayTeam: GameTeam;
  gameTime: string;
  status: "SCHEDULED" | "LIVE" | "FINAL" | "POSTPONED" | "CANCELLED";
  venue: string;
  tvChannel?: string;
  watchSources?: string[];
  homeScore?: number;
  awayScore?: number;
  spread?: number;
  overUnder?: number;
  marketFavorite?: "home" | "away";
  quarter?: string;
  clock?: string;
  seasonContext?: NarrativeSeasonContext | null;
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
    betweenInnings: boolean;
    inningTransition: "mid" | "end" | null;
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
    name?: string;
    state: string;
    completed?: boolean;
    description: string;
    detail: string;
    shortDetail: string;
  };
  period?: number;
  displayClock?: string;
  summary?: string;
}

interface ESPNSituationAthlete {
  athlete?: {
    displayName?: string;
    fullName?: string;
    team?: {
      id?: string;
    };
  };
}

interface ESPNSituation {
  lastPlay?: {
    text?: string;
    summaryType?: string;
    team?: {
      id?: string;
    };
    type?: {
      text?: string;
      abbreviation?: string;
      type?: string;
    };
  };
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
  notes?: Array<{ type?: string; headline?: string }>;
}

type MlbInningTransition = "mid" | "end" | null;

function normalizeStatusText(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function textMentionsTopHalf(text: string): boolean {
  return /\btop\b/.test(text);
}

function textMentionsBottomHalf(text: string): boolean {
  return /\b(bot|bottom)\b/.test(text);
}

function textIndicatesMidInning(text: string): boolean {
  return /^(mid|middle)\b/.test(text) || /\bmiddle of\b/.test(text);
}

function textIndicatesEndBreak(text: string): boolean {
  return /^end\b/.test(text) || /\bend of\b/.test(text) || /\bend\s+\d/.test(text);
}

function teamId(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function resolveMlbInningTransitionForStatus({
  detailTexts,
  homeTeamId,
  awayTeamId,
  pitcherTeamId,
  batterTeamId,
  lastPlayTeamId,
  homeHasLineScoreForPeriod,
  awayHasLineScoreForPeriod,
}: {
  detailTexts: Array<string | null | undefined>;
  homeTeamId?: string | number | null;
  awayTeamId?: string | number | null;
  pitcherTeamId?: string | number | null;
  batterTeamId?: string | number | null;
  lastPlayTeamId?: string | number | null;
  homeHasLineScoreForPeriod?: boolean;
  awayHasLineScoreForPeriod?: boolean;
}): MlbInningTransition {
  let sawGenericEndBreak = false;

  for (const rawText of detailTexts) {
    const text = normalizeStatusText(rawText);
    if (!text) continue;

    if (textIndicatesMidInning(text)) return "mid";

    if (textIndicatesEndBreak(text)) {
      if (textMentionsTopHalf(text) && !textMentionsBottomHalf(text)) return "mid";
      if (textMentionsBottomHalf(text)) return "end";
      sawGenericEndBreak = true;
    }
  }

  if (!sawGenericEndBreak) return null;

  const homeId = teamId(homeTeamId);
  const awayId = teamId(awayTeamId);
  const pitcherId = teamId(pitcherTeamId);
  const batterId = teamId(batterTeamId);
  const lastPlayId = teamId(lastPlayTeamId);

  // Generic "End 8th" is ambiguous during the top→bottom handoff. ESPN often
  // still carries the last batter/pitcher context, which tells us which half
  // just ended: home pitcher + away batter means the top half ended.
  if ((pitcherId && pitcherId === homeId) || (batterId && batterId === awayId)) {
    return "mid";
  }
  if ((pitcherId && pitcherId === awayId) || (batterId && batterId === homeId)) {
    return "end";
  }

  // Last-play team is a weaker fallback because pitch/out events usually tag
  // the fielding team. It still beats showing END during a top-half switch.
  if (lastPlayId && lastPlayId === homeId) return "mid";
  if (lastPlayId && lastPlayId === awayId) return "end";

  if (awayHasLineScoreForPeriod && !homeHasLineScoreForPeriod) return "mid";
  if (awayHasLineScoreForPeriod && homeHasLineScoreForPeriod) return "end";

  return "end";
}

interface ESPNEvent {
  id: string;
  date: string;
  name: string;
  shortName: string;
  competitions: ESPNCompetition[];
  season?: {
    type?: number | string;
    slug?: string;
    name?: string;
    year?: number;
  };
}

interface ESPNScoreboardResponse {
  events: ESPNEvent[];
}

interface ESPNStandingsResponse {
  children?: Array<{
    standings?: {
      entries?: ESPNStandingEntry[];
    };
  }>;
}

interface ESPNStandingEntry {
  team?: {
    id?: string;
    abbreviation?: string;
  };
  stats?: Array<{
    name?: string;
    type?: string;
    value?: number;
    displayValue?: string;
  }>;
}

interface ESPNFitTennisState {
  page?: {
    content?: {
      scoreboard?: TennisScoreboard;
    };
  };
}

interface TennisScoreboard {
  competitions?: Record<string, TennisCompetition>;
  tournaments?: TennisTournament[];
}

interface TennisTournament {
  id?: string;
  name?: string;
  groupings?: TennisGrouping[];
}

interface TennisGrouping {
  id?: string;
  name?: string;
  competitionIds?: string[];
}

interface TennisStatus {
  id?: string;
  description?: string;
  detail?: string;
  state?: string;
  completed?: boolean;
}

interface TennisLineScore {
  v?: string | number;
  w?: boolean;
  t?: string | number;
  p?: number;
}

interface TennisRosterPlayer {
  nm?: string;
  logo?: string;
  srv?: boolean;
}

interface TennisCompetitor {
  id?: string;
  uid?: string;
  homeAway?: "home" | "away";
  logo?: string;
  nm?: string;
  rnk?: number;
  wnr?: boolean;
  srv?: boolean;
  lnescrs?: TennisLineScore[];
  rstr?: TennisRosterPlayer[];
}

interface TennisCompetition {
  id?: string;
  date?: string;
  note?: string;
  dbls?: boolean;
  status?: TennisStatus;
  competitors?: TennisCompetitor[];
}

// Cache structure
interface CacheEntry {
  data: Game[];
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 1000; // 60 seconds — used when no games in entry are live
const LIVE_CACHE_TTL_MS = 3 * 1000; // 3 seconds — used when ≥1 game in entry is live
const cache = new LRUCache<string, CacheEntry>({ max: 100 });
const IPL_STANDINGS_URL = "https://site.web.api.espn.com/apis/v2/sports/cricket/8048/standings";
const IPL_STANDINGS_CACHE_TTL_MS = 10 * 60 * 1000;
let iplStandingsRecordCache: { data: Map<string, string>; timestamp: number } | null = null;
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
const PREDICTION_NARRATIVE_VERSION = "bar-friend-v9-projection-consensus";
const predictionCache = new LRUCache<string, { prediction: GamePrediction; timestamp: number }>({ max: 500 });

function predictionCacheKey(gameId: string): string {
  return `${gameId}:${PREDICTION_NARRATIVE_VERSION}`;
}

function getCachedPrediction(gameId: string): GamePrediction | null {
  const key = predictionCacheKey(gameId);
  const entry = predictionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > PREDICTION_CACHE_TTL_MS) {
    predictionCache.delete(key);
    return null;
  }
  return entry.prediction;
}

function setCachedPrediction(gameId: string, prediction: GamePrediction): void {
  predictionCache.set(predictionCacheKey(gameId), { prediction, timestamp: Date.now() });
}

const STALE_NARRATIVE_REGEX =
  /the data points toward|biggest driver|clear separation|Expected score rounds to|Average scoring is basically level|Projected finish rounds to|Home\s+[A-Z0-9]{2,5}\s+Elo|Away\s+[A-Z0-9]{2,5}\s+Elo|Home\s+L10:|Away\s+L10:|\bthe model\b|\bthe algorithm\b/i;

function predictionFactorToContribution(factor: PredictionFactor): FactorContribution {
  const homeScore = Number.isFinite(factor.homeScore) ? factor.homeScore : 0.5;
  const awayScore = Number.isFinite(factor.awayScore) ? factor.awayScore : 0.5;
  return {
    key: factor.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "factor",
    label: factor.name,
    homeDelta: (homeScore - awayScore) * 100,
    weight: Number.isFinite(factor.weight) ? factor.weight : 0,
    available: true,
    hasSignal: Math.abs(homeScore - awayScore) > 0.01,
    evidence: factor.description || `${factor.name} favors neither side clearly`,
  };
}

function rebuildNarrativeFromPrediction(game: Game, prediction: GamePrediction): string | null {
  if (!prediction.factors || prediction.factors.length === 0) return null;

  const winnerAbbr =
    prediction.predictedWinner === "home"
      ? game.homeTeam.abbreviation
      : game.awayTeam.abbreviation;
  const winnerProb = Math.max(
    (prediction.homeWinProbability ?? 50) / 100,
    (prediction.awayWinProbability ?? 50) / 100,
  );
  const input = buildNarrativeInput(
    prediction.factors.map(predictionFactorToContribution),
    getConfidenceBand(winnerProb),
    prediction.confidence,
    game.homeTeam.abbreviation,
    game.awayTeam.abbreviation,
    winnerAbbr,
    game.sport,
    [],
    game.seasonContext ?? deriveSeasonContext({ sport: game.sport, gameTime: game.gameTime }),
    game.homeTeam.name,
    game.awayTeam.name,
  );

  return buildDeterministicNarrative(input);
}

function shouldRewritePredictionNarrative(_game: Game, prediction: GamePrediction): boolean {
  return STALE_NARRATIVE_REGEX.test(prediction.analysis ?? "");
}

export function sanitizePredictionForGame(game: Game, prediction: GamePrediction): GamePrediction {
  if (!shouldRewritePredictionNarrative(game, prediction)) return prediction;
  const rebuilt = rebuildNarrativeFromPrediction(game, prediction);
  if (!rebuilt) return prediction;
  return {
    ...prediction,
    analysis: rebuilt,
  };
}

function attachPredictionToGame(game: Game, prediction: GamePrediction): Game {
  const displayPrediction = sanitizePredictionForGame(game, prediction);
  return {
    ...game,
    spread: game.spread ?? displayPrediction.spread,
    overUnder: game.overUnder ?? displayPrediction.overUnder,
    marketFavorite: game.marketFavorite ?? displayPrediction.marketFavorite,
    prediction: displayPrediction,
  };
}

// ─── Live game data type ──────────────────────────────────────────────────────

export interface LiveGameData {
  currentHomeScore: number;
  currentAwayScore: number;
  // Period/quarter/inning number (1-based)
  period: number;
  // Seconds remaining in the current period (null = unknown)
  clockSeconds: number | null;
  // Seconds elapsed in regulation for count-up clock sports such as soccer.
  elapsedSeconds?: number | null;
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
  UCL:  90 * 60,
  IPL:  40 * 6 * 60,    // T20: two 20-over innings, roughly six minutes per over
  TENNIS: 3 * 45 * 60,  // best-of-three proxy for live probability blending
};

const LIVE_SOCCER_SPORTS = new Set(["MLS", "EPL", "UCL"]);

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundPercentTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

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
    UCL: 0.033,
    IPL: 1.35,    // ~160 runs per innings across roughly 120 minutes
    TENNIS: 0.02, // set-based scoring; live score is useful but intentionally dampened
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

  if (
    live.elapsedSeconds !== undefined &&
    live.elapsedSeconds !== null &&
    Number.isFinite(live.elapsedSeconds)
  ) {
    return clampNumber(live.elapsedSeconds / totalSeconds, 0, 1);
  }

  if (LIVE_SOCCER_SPORTS.has(sport)) {
    // Soccer feeds use count-up clocks ("23'", "67:10") rather than quarters.
    // If the exact minute is unavailable, only apply second-half context.
    return live.period > 1 ? 0.5 : 0;
  }

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

function computeLiveSoccerDrawProb(margin: number, gameProgress: number): number {
  if (margin === 0) {
    return clampNumber(0.24 + gameProgress * 0.48, 0.24, 0.72);
  }

  const marginPenalty = 1 + Math.abs(margin);
  return clampNumber(0.28 * (1 - gameProgress * 0.75) / marginPenalty, 0.03, 0.26);
}

function formatLivePredictionLabel(live: LiveGameData, sport: string): string {
  if (
    LIVE_SOCCER_SPORTS.has(sport) &&
    live.elapsedSeconds !== undefined &&
    live.elapsedSeconds !== null
  ) {
    return `${Math.floor(live.elapsedSeconds / 60)}'`;
  }
  if (sport === "NHL") return `P${live.period}`;
  if (sport === "MLB") return `Inning ${live.period}`;
  return `Q${live.period}`;
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

  if (LIVE_SOCCER_SPORTS.has(sport)) {
    const pregameDrawProb =
      typeof pregame.drawProbability === "number" && Number.isFinite(pregame.drawProbability)
        ? pregame.drawProbability / 100
        : 0.25;
    const liveDrawProb = computeLiveSoccerDrawProb(
      live.currentHomeScore - live.currentAwayScore,
      gameProgress,
    );
    const liveNonDrawProb = 1 - liveDrawProb;
    const liveHomeThreeWay = liveHomeWinProb * liveNonDrawProb;
    const liveAwayThreeWay = liveAwayWinProb * liveNonDrawProb;

    const blendedHomeProb = pregameHomeProb * (1 - gameProgress) + liveHomeThreeWay * gameProgress;
    const blendedAwayProb = pregameAwayProb * (1 - gameProgress) + liveAwayThreeWay * gameProgress;
    const blendedDrawProb = pregameDrawProb * (1 - gameProgress) + liveDrawProb * gameProgress;
    const total = blendedHomeProb + blendedAwayProb + blendedDrawProb;

    const newHomeProb = roundPercentTenth((blendedHomeProb / total) * 100);
    const newAwayProb = roundPercentTenth((blendedAwayProb / total) * 100);
    const newDrawProb = Math.max(0, roundPercentTenth(100 - newHomeProb - newAwayProb));
    const maxProb = Math.max(newHomeProb, newAwayProb, newDrawProb);
    const predictedOutcome: "home" | "away" | "draw" =
      newDrawProb >= newHomeProb && newDrawProb >= newAwayProb
        ? "draw"
        : newHomeProb >= newAwayProb
          ? "home"
          : "away";
    const newPredictedWinner: "home" | "away" =
      predictedOutcome === "away" ? "away" : newHomeProb >= newAwayProb ? "home" : "away";

    return {
      ...pregame,
      predictedWinner: newPredictedWinner,
      predictedOutcome,
      confidence: maxProb,
      homeWinProbability: newHomeProb,
      awayWinProbability: newAwayProb,
      drawProbability: newDrawProb,
      isTossUp: maxProb < 53 || Math.abs(newHomeProb - newAwayProb) < 5,
      analysis: pregame.analysis +
        ` [LIVE ${formatLivePredictionLabel(live, sport)}: ${live.currentHomeScore}-${live.currentAwayScore}, ${Math.round(gameProgress * 100)}% elapsed]`,
    };
  }

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
      ` [LIVE ${formatLivePredictionLabel(live, sport)}: ${live.currentHomeScore}–${live.currentAwayScore}, ${Math.round(gameProgress * 100)}% elapsed]`,
  };
}

// ─── Live helper utilities ────────────────────────────────────────────────────

/** Total regulation periods by sport. */
const SPORT_TOTAL_PERIODS: Record<string, number> = {
  NBA: 4, NFL: 4, NCAAF: 4, NCAAB: 2, NHL: 3, MLB: 9, MLS: 2, EPL: 2, UCL: 2, IPL: 2, TENNIS: 3,
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

function parseSoccerElapsedSeconds(display: string): number | null {
  const text = display.trim().toLowerCase();
  if (!text) return null;
  if (text.includes("half") || text === "ht") return 45 * 60;

  const clock = text.match(/^(\d{1,3}):(\d{2})$/);
  if (clock) {
    const mins = parseInt(clock[1]!, 10);
    const secs = parseInt(clock[2]!, 10);
    if (Number.isFinite(mins) && Number.isFinite(secs)) return mins * 60 + secs;
  }

  const stoppage = text.match(/(\d{1,3})\s*(?:'|’)?\s*\+\s*(\d{1,2})/);
  if (stoppage) {
    const mins = parseInt(stoppage[1]!, 10);
    const added = parseInt(stoppage[2]!, 10);
    if (Number.isFinite(mins) && Number.isFinite(added)) return (mins + added) * 60;
  }

  const minute = text.match(/(\d{1,3})\s*(?:'|’)/);
  if (minute) {
    const mins = parseInt(minute[1]!, 10);
    if (Number.isFinite(mins)) return mins * 60;
  }

  return null;
}

function parseSoccerPeriod(display: string): number {
  const text = display.toLowerCase();
  const elapsed = parseSoccerElapsedSeconds(display);
  if (elapsed !== null) return elapsed >= 45 * 60 ? 2 : 1;
  if (text.includes("2nd") || text.includes("second")) return 2;
  return 1;
}

function applyLiveAdjustmentIfNeeded(game: Game, pregamePrediction: GamePrediction): GamePrediction {
  if (game.status !== "LIVE" || game.homeScore === undefined || game.awayScore === undefined) {
    return pregamePrediction;
  }

  const isSoccer = LIVE_SOCCER_SPORTS.has(game.sport);
  const soccerElapsedSeconds = isSoccer
    ? parseSoccerElapsedSeconds(game.clock ?? game.quarter ?? "")
    : null;

  const liveData: LiveGameData = {
    currentHomeScore: game.homeScore,
    currentAwayScore: game.awayScore,
    period: isSoccer
      ? parseSoccerPeriod(game.clock ?? game.quarter ?? "")
      : parsePeriodNumber(game.quarter ?? "") ?? 1,
    clockSeconds: isSoccer ? null : parseClockSeconds(game.clock ?? ""),
    elapsedSeconds: soccerElapsedSeconds,
    totalPeriods: SPORT_TOTAL_PERIODS[game.sport] ?? 4,
  };

  const finalPrediction = updateLivePrediction(pregamePrediction, liveData, game.sport);
  if (finalPrediction === pregamePrediction) {
    return pregamePrediction;
  }
  if (pregamePrediction.predictedWinner !== finalPrediction.predictedWinner) {
    console.log(
      `[LiveFlip] ${game.id}: ${pregamePrediction.predictedWinner} -> ${finalPrediction.predictedWinner} (live score shift)`,
    );
    notifyWinnerFlip(
      game.id,
      game.homeTeam.abbreviation,
      game.awayTeam.abbreviation,
      game.sport,
      finalPrediction.predictedWinner,
      finalPrediction.confidence,
    ).catch((err) => console.error("[LiveFlip] Notify failed:", err));
  }

  setCachedLivePrediction(game.id, finalPrediction);
  return finalPrediction;
}

async function annotateMarketComparison(game: Game, prediction: GamePrediction): Promise<void> {
  try {
    const market = await fetchMarketConsensus(
      game.sport,
      game.homeTeam.name,
      game.awayTeam.name,
      new Date(game.gameTime),
    );
    if (!market || !Number.isFinite(market.noVigHomeProb)) return;

    const modelHomeProb = (prediction.homeWinProbability ?? 50) / 100;
    const divergence = Math.abs(modelHomeProb - market.noVigHomeProb);
    const pickedSide: "home" | "away" = prediction.predictedWinner;
    const bestBook = market.lines
      .slice()
      .sort((a, b) =>
        pickedSide === "home"
          ? b.homeAmerican - a.homeAmerican
          : b.awayAmerican - a.awayAmerican,
      )[0];

    prediction.marketComparison = {
      modelHomeProb,
      marketHomeProb: market.noVigHomeProb,
      divergence,
      isDivergent: divergence > 0.10,
      bestBook: bestBook
        ? {
            sportsbook: bestBook.sportsbook,
            american: pickedSide === "home" ? bestBook.homeAmerican : bestBook.awayAmerican,
          }
        : null,
    };
  } catch (err) {
    console.warn("[market] annotation failed:", err instanceof Error ? err.message : err);
  }
}

// Generate prediction for an ESPN game, with live adjustment when in-progress.
async function addPredictionToGame(game: Game): Promise<Game> {
  const isLive = game.status === "LIVE";

  if (isLive) {
    const cachedLive = getCachedLivePrediction(game.id);
    if (cachedLive) {
      return attachPredictionToGame(game, cachedLive);
    }
  }

  const cachedPrediction = getCachedPrediction(game.id);
  if (cachedPrediction && !isLive) {
    return attachPredictionToGame(game, cachedPrediction);
  }

  if (cachedPrediction && isLive) {
    const finalPrediction = applyLiveAdjustmentIfNeeded(game, cachedPrediction);
    return attachPredictionToGame(game, finalPrediction);
  }

  try {
    const newPrediction = await runNewEnginePrediction(game);
    await annotateMarketComparison(game, newPrediction);

    const displayPrediction = sanitizePredictionForGame(game, newPrediction);
    setCachedPrediction(game.id, displayPrediction);
    const finalPrediction = applyLiveAdjustmentIfNeeded(game, displayPrediction);

    return attachPredictionToGame(game, finalPrediction);
  } catch (err) {
    console.error(
      `[engine] New engine failed for ${game.id} (${game.sport}); no legacy fallback served:`,
      err instanceof Error ? err.message : err,
    );
    return game;
  }
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
  const name = (status.type.name ?? status.type.description ?? status.type.detail ?? "").toLowerCase();
  if (name.includes("postponed")) return "POSTPONED";
  if (name.includes("canceled") || name.includes("cancelled")) return "CANCELLED";
  if (state === "in") return "LIVE";
  if (state === "post" || status.type.completed) return "FINAL";
  return "SCHEDULED";
}

function getPeriodDisplay(status: ESPNStatus, sport: SportKey): string | undefined {
  if (status.type.state.toLowerCase() !== "in") return undefined;
  if (sport === "IPL") {
    return status.type.shortDetail || status.type.detail || status.summary || undefined;
  }
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
  if (sport === "MLS" || sport === "EPL" || sport === "UCL") {
    const detail = status.type.shortDetail || "";
    return detail;
  }
  return `Period ${period}`;
}

function ordinalInning(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function getMlbPeriodDisplay(liveState: Game["liveState"] | undefined): string | undefined {
  const inning = liveState?.inningNumber;
  if (!inning) return undefined;

  if (liveState.betweenInnings) {
    if (liveState.inningTransition === "mid") return `Mid ${ordinalInning(inning)}`;
    if (liveState.inningTransition === "end") return `End ${ordinalInning(inning)}`;
    return `Between ${ordinalInning(inning)}`;
  }

  if (liveState.inningHalf === "top") return `Top ${ordinalInning(inning)}`;
  if (liveState.inningHalf === "bottom") return `Bot ${ordinalInning(inning)}`;
  return undefined;
}

function standingsStat(entry: ESPNStandingEntry, names: string[]): number | null {
  const targets = new Set(names.map((name) => name.toLowerCase()));
  const stat = entry.stats?.find((candidate) =>
    targets.has((candidate.name ?? "").toLowerCase()) ||
    targets.has((candidate.type ?? "").toLowerCase()),
  );
  if (typeof stat?.value === "number" && Number.isFinite(stat.value)) {
    return stat.value;
  }
  const parsed = Number(stat?.displayValue);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchIPLStandingsRecords(): Promise<Map<string, string>> {
  if (
    iplStandingsRecordCache &&
    Date.now() - iplStandingsRecordCache.timestamp < IPL_STANDINGS_CACHE_TTL_MS
  ) {
    return iplStandingsRecordCache.data;
  }

  try {
    const response = await fetch(IPL_STANDINGS_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return new Map();
    const data = (await response.json()) as ESPNStandingsResponse;
    const entries = data.children?.flatMap((child) => child.standings?.entries ?? []) ?? [];
    const records = new Map<string, string>();

    for (const entry of entries) {
      const wins = standingsStat(entry, ["matchesWon", "matcheswon", "wins"]);
      const losses = standingsStat(entry, ["matchesLost", "matcheslost", "losses"]);
      const tied = standingsStat(entry, ["matchesTied", "matchestied", "ties"]) ?? 0;
      const noResult = standingsStat(entry, ["noresult", "noResult"]) ?? 0;
      if (wins === null || losses === null) continue;

      const extra = tied + noResult;
      const record = extra > 0 ? `${wins}-${losses}-${extra}` : `${wins}-${losses}`;
      const keys = [entry.team?.id, entry.team?.abbreviation].filter(Boolean) as string[];
      for (const key of keys) {
        records.set(key.toUpperCase(), record);
      }
    }

    iplStandingsRecordCache = { data: records, timestamp: Date.now() };
    return records;
  } catch (error) {
    console.warn("[ipl-standings] failed to fetch standings records:", error instanceof Error ? error.message : error);
    return iplStandingsRecordCache?.data ?? new Map();
  }
}

function parseMlbLiveState({
  sport,
  status,
  competition,
  homeAbbr,
  awayAbbr,
  gameId,
}: {
  sport: SportKey;
  status: Game["status"];
  competition: ESPNCompetition;
  homeAbbr: string;
  awayAbbr: string;
  gameId: string;
}): Game["liveState"] | undefined {
  if (sport !== "MLB" || status !== "LIVE") return undefined;

  try {
    const s = competition.situation;
    const homeCompetitor = competition.competitors.find((c) => c.homeAway === "home");
    const awayCompetitor = competition.competitors.find((c) => c.homeAway === "away");
    const statusTexts = [
      competition.status.type.shortDetail,
      competition.status.type.detail,
      competition.status.type.description,
      competition.status.type.name,
    ];
    const normalizedStatusTexts = statusTexts.map(normalizeStatusText);
    const inningTransition = resolveMlbInningTransitionForStatus({
      detailTexts: statusTexts,
      homeTeamId: homeCompetitor?.team.id,
      awayTeamId: awayCompetitor?.team.id,
      pitcherTeamId: s?.pitcher?.athlete?.team?.id,
      batterTeamId: s?.batter?.athlete?.team?.id,
      lastPlayTeamId: s?.lastPlay?.team?.id,
      homeHasLineScoreForPeriod: homeCompetitor?.linescores?.some((ls) => ls.period === competition.status.period),
      awayHasLineScoreForPeriod: awayCompetitor?.linescores?.some((ls) => ls.period === competition.status.period),
    });
    const betweenInnings = inningTransition !== null;
    const inningHalf: "top" | "bottom" | null = betweenInnings
      ? null
      : normalizedStatusTexts.some((text) => text.startsWith("top"))
      ? "top"
      : normalizedStatusTexts.some((text) => text.startsWith("bot") || text.startsWith("bottom"))
      ? "bottom"
      : null;
    const battingAbbr = inningHalf === "bottom" ? homeAbbr : awayAbbr;
    const pitchingAbbr = inningHalf === "bottom" ? awayAbbr : homeAbbr;
    const pitcherName =
      s?.pitcher?.athlete?.displayName ?? s?.pitcher?.athlete?.fullName ?? null;
    const batterName =
      s?.batter?.athlete?.displayName ?? s?.batter?.athlete?.fullName ?? null;

    return {
      balls: s?.balls ?? 0,
      strikes: s?.strikes ?? 0,
      outs: s?.outs ?? 0,
      onFirst: s?.onFirst === true,
      onSecond: s?.onSecond === true,
      onThird: s?.onThird === true,
      inningHalf,
      inningNumber: typeof competition.status.period === "number" ? competition.status.period : null,
      betweenInnings,
      inningTransition,
      pitcher: s?.pitcher ? { name: pitcherName, teamAbbr: pitchingAbbr } : null,
      batter: s?.batter ? { name: batterName, teamAbbr: battingAbbr } : null,
    };
  } catch (err) {
    console.warn(`[mlb-livestate] failed to parse situation for game ${gameId}:`, err);
    return undefined;
  }
}

async function transformESPNEvent(event: ESPNEvent, sport: SportKey): Promise<Game | null> {
  const competition = event.competitions[0];
  if (!competition) return null;

  const homeCompetitor = competition.competitors.find((c) => c.homeAway === "home");
  const awayCompetitor = competition.competitors.find((c) => c.homeAway === "away");
  if (!homeCompetitor || !awayCompetitor) return null;

  const homeTeam = homeCompetitor.team;
  const awayTeam = awayCompetitor.team;
  const iplRecords = sport === "IPL" ? await fetchIPLStandingsRecords() : null;

  const getRecord = (competitor: ESPNCompetitor): string => {
    const overallRecord = competitor.records?.find(
      (r) => r.type === "total" || r.type === "overall"
    );
    const feedRecord = overallRecord?.summary?.trim();
    if (feedRecord) return feedRecord;
    if (sport === "IPL") {
      const teamId = competitor.team.id.toUpperCase();
      const abbr = competitor.team.abbreviation.toUpperCase();
      return iplRecords?.get(teamId) ?? iplRecords?.get(abbr) ?? "0-0";
    }
    return "0-0";
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

  const watchSources = Array.from(
    new Set(
      (competition.broadcasts ?? [])
        .flatMap((broadcast) => broadcast.names ?? [])
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );
  const tvChannel = watchSources[0];
  const gameStatus = mapGameStatus(competition.status);
  const rawQuarter = getPeriodDisplay(competition.status, sport);
  const clock = gameStatus === "LIVE" ? competition.status.displayClock : undefined;
  const seasonContext = deriveSeasonContext({
    sport,
    gameTime: event.date,
    seasonType: event.season?.type ?? null,
    seasonSlug: event.season?.slug ?? null,
    seasonName: event.season?.name ?? null,
    eventName: [event.name, event.shortName].filter(Boolean).join(" "),
    competitionNotes: competition.notes?.map((note) =>
      [note.type, note.headline].filter(Boolean).join(" "),
    ),
  });

  const homeScore = homeCompetitor.score ? parseInt(homeCompetitor.score, 10) : undefined;
  const awayScore = awayCompetitor.score ? parseInt(awayCompetitor.score, 10) : undefined;

  const extractLinescores = (c: ESPNCompetitor): number[] | undefined => {
    if (!c.linescores || c.linescores.length === 0) return undefined;
    return c.linescores.map((ls) => (typeof ls.value === "number" ? ls.value : 0));
  };
  const homeLinescores = extractLinescores(homeCompetitor);
  const awayLinescores = extractLinescores(awayCompetitor);

  const liveState = parseMlbLiveState({
    sport,
    status: gameStatus,
    competition,
    homeAbbr: homeTeam.abbreviation,
    awayAbbr: awayTeam.abbreviation,
    gameId: event.id,
  });
  const quarter = sport === "MLB" ? getMlbPeriodDisplay(liveState) ?? rawQuarter : rawQuarter;
  const normalizeTeamColor = (color: string | undefined): string =>
    color ? (color.startsWith("#") ? color : `#${color}`) : "#333333";

  const game: Game = {
    id: event.id,
    sport,
    homeTeam: {
      id: homeTeam.id,
      name: homeTeam.displayName || homeTeam.name,
      abbreviation: homeTeam.abbreviation,
      city: homeTeam.shortDisplayName || homeTeam.name.split(" ")[0] || "",
      record: getRecord(homeCompetitor),
      color: normalizeTeamColor(homeTeam.color),
      logo: getTeamLogo(homeTeam),
    },
    awayTeam: {
      id: awayTeam.id,
      name: awayTeam.displayName || awayTeam.name,
      abbreviation: awayTeam.abbreviation,
      city: awayTeam.shortDisplayName || awayTeam.name.split(" ")[0] || "",
      record: getRecord(awayCompetitor),
      color: normalizeTeamColor(awayTeam.color),
      logo: getTeamLogo(awayTeam),
    },
    gameTime: event.date,
    status: gameStatus,
    venue: competition.venue?.fullName || "TBD",
    tvChannel,
    watchSources,
    homeScore: homeScore !== undefined && !isNaN(homeScore) ? homeScore : undefined,
    awayScore: awayScore !== undefined && !isNaN(awayScore) ? awayScore : undefined,
    spread,
    overUnder,
    marketFavorite,
    quarter,
    clock,
    seasonContext,
    homeLinescores,
    awayLinescores,
    liveState,
  };

  // Attach freshest cached prediction if available, don't block on generating
  // new ones. Use the shared helper so live games pick the live-adjusted cache
  // (matching what the list/detail endpoints will return).
  const cachedPrediction = pickFreshestPrediction(game.id, gameStatus === "LIVE");
  if (cachedPrediction) {
    return attachPredictionToGame(game, cachedPrediction);
  }
  return game;
}

const TENNIS_COUNTRY_COLORS: Record<string, string> = {
  ARG: "#75AADB",
  AUS: "#006B3F",
  AUT: "#ED2939",
  BEL: "#FAE042",
  CAN: "#D52B1E",
  CHN: "#DE2910",
  COL: "#FCD116",
  CRO: "#171796",
  CZE: "#11457E",
  EGY: "#CE1126",
  ESP: "#AA151B",
  FIN: "#002F6C",
  FRA: "#0055A4",
  GBR: "#012169",
  GER: "#000000",
  GRE: "#0D5EAF",
  HKG: "#DE2910",
  ITA: "#008C45",
  JPN: "#BC002D",
  KAZ: "#00AFCA",
  NOR: "#BA0C2F",
  ROM: "#002B7F",
  RUS: "#0033A0",
  SLO: "#005DA4",
  SUI: "#D52B1E",
  SWE: "#006AA7",
  TPE: "#000095",
  UKR: "#0057B7",
  USA: "#1D4ED8",
};

function tennisDateParam(date?: string): string {
  const iso = date ?? new Date().toISOString().slice(0, 10);
  return iso.replace(/-/g, "");
}

function parseEspnFitTennisState(html: string): ESPNFitTennisState | null {
  const marker = /window\['__espnfitt__'\]\s*=\s*/.exec(html);
  if (!marker || marker.index === undefined) return null;

  const start = marker.index + marker[0].length;
  const end = html.indexOf(";</script>", start);
  const fallbackEnd = html.indexOf("</script>", start);
  const sliceEnd = end >= 0 ? end : fallbackEnd;
  if (sliceEnd < 0) return null;

  const raw = html.slice(start, sliceEnd).replace(/;\s*$/, "");
  try {
    return JSON.parse(raw) as ESPNFitTennisState;
  } catch (error) {
    console.warn("[tennis] failed to parse ESPN page state:", error);
    return null;
  }
}

function buildTennisTournamentIndex(scoreboard: TennisScoreboard): Map<string, { tournament: string; grouping?: string }> {
  const index = new Map<string, { tournament: string; grouping?: string }>();
  for (const tournament of scoreboard.tournaments ?? []) {
    for (const grouping of tournament.groupings ?? []) {
      for (const competitionId of grouping.competitionIds ?? []) {
        index.set(competitionId, {
          tournament: tournament.name ?? "Tennis",
          grouping: grouping.name,
        });
      }
    }
  }
  return index;
}

function mapTennisStatus(status?: TennisStatus): Game["status"] {
  const state = (status?.state ?? "").toLowerCase();
  const text = [status?.description, status?.detail].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("postponed") || text.includes("suspended")) return "POSTPONED";
  if (text.includes("canceled") || text.includes("cancelled")) return "CANCELLED";
  if (state === "in") return "LIVE";
  if (state === "post" || status?.completed) return "FINAL";
  return "SCHEDULED";
}

function countryCodeFromLogo(logo?: string): string | undefined {
  return logo?.match(/countries\/500\/([a-z]{3})\.png/i)?.[1]?.toUpperCase();
}

export function isTennisPlaceholderName(value: string | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text) return true;
  const lower = text.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]+/g, "");
  return (
    lower === "tbd" ||
    lower === "to be determined" ||
    lower === "to be decided" ||
    compact === "tbd" ||
    compact === "tobedetermined" ||
    compact === "tobedecided" ||
    /^(tbd)+$/.test(compact) ||
    /^-?\d+$/.test(lower) ||
    /^s:\d+~l:\d+~a:-?\d+$/.test(lower)
  );
}

function tennisFallbackName(isDoubles: boolean): string {
  return isDoubles ? "Doubles Team To Be Decided" : "Player To Be Decided";
}

export function tennisCompetitorName(competitor: TennisCompetitor, isDoubles: boolean): string {
  if (!isTennisPlaceholderName(competitor.nm)) return competitor.nm!.trim();

  const rosterNames = (competitor.rstr ?? [])
    .map((player) => player.nm?.trim())
    .filter((name): name is string => !isTennisPlaceholderName(name));
  return rosterNames.length > 0 ? rosterNames.join(" / ") : tennisFallbackName(isDoubles);
}

function tennisCompetitorLogo(competitor: TennisCompetitor): string | undefined {
  return competitor.logo ?? competitor.rstr?.find((player) => player.logo)?.logo;
}

export function tennisAbbreviation(name: string, roster?: TennisRosterPlayer[]): string {
  if (roster && roster.length > 0) {
    const initials = roster
      .filter((player) => !isTennisPlaceholderName(player.nm))
      .map((player) => player.nm?.split(/\s+/).filter(Boolean).at(-1)?.[0])
      .filter(Boolean)
      .join("");
    if (initials) return initials.slice(0, 4).toUpperCase();
  }
  if (isTennisPlaceholderName(name) || name.endsWith("To Be Decided")) {
    return "TBA";
  }
  const normalized = name.replace(/[^a-z0-9\s]/gi, " ").trim();
  const lastName = normalized.split(/\s+/).filter(Boolean).at(-1) ?? "TBA";
  return lastName.slice(0, 4).toUpperCase();
}

function tennisLineValue(line: TennisLineScore | undefined): number | null {
  if (!line) return null;
  const parsed = Number(line.v);
  return Number.isFinite(parsed) ? parsed : null;
}

function tennisSetScores(competitor: TennisCompetitor): number[] | undefined {
  const scores = (competitor.lnescrs ?? [])
    .map((line) => tennisLineValue(line))
    .filter((value): value is number => value !== null);
  return scores.length > 0 ? scores : undefined;
}

function tennisSetsWon(competitor: TennisCompetitor, opponent: TennisCompetitor): number {
  const explicitSetWins = (competitor.lnescrs ?? []).filter((line) => line.w === true).length;
  if (explicitSetWins > 0) return explicitSetWins;

  const ownScores = tennisSetScores(competitor) ?? [];
  const opponentScores = tennisSetScores(opponent) ?? [];
  if (ownScores.length === 0 && opponentScores.length === 0) {
    if (competitor.wnr === true) return 1;
    if (opponent.wnr === true) return 0;
  }
  let sets = 0;
  const count = Math.min(ownScores.length, opponentScores.length);
  for (let i = 0; i < count; i++) {
    const own = ownScores[i]!;
    const opp = opponentScores[i]!;
    if (own > opp) sets++;
  }
  return sets;
}

function tennisTeamFromCompetitor(competitor: TennisCompetitor, isDoubles: boolean): GameTeam {
  const name = tennisCompetitorName(competitor, isDoubles);
  const logo = tennisCompetitorLogo(competitor);
  const country = countryCodeFromLogo(logo);
  const rank = typeof competitor.rnk === "number" ? competitor.rnk : undefined;
  return {
    id: competitor.uid ?? competitor.id ?? name,
    name,
    abbreviation: tennisAbbreviation(name, competitor.rstr),
    city: name,
    record: rank ? `Rank #${rank}` : isDoubles ? "Doubles" : "Singles",
    color: country ? TENNIS_COUNTRY_COLORS[country] ?? "#2E7D5B" : "#2E7D5B",
    logo,
    rank,
  };
}

function tennisVenueText(meta: { tournament: string; grouping?: string } | undefined, competition: TennisCompetition): string {
  const parts = [
    meta?.tournament ?? "Tennis",
    meta?.grouping,
    competition.note,
  ].filter(Boolean);
  return parts.join(" · ");
}

function transformTennisCompetition(
  competition: TennisCompetition,
  meta: { tournament: string; grouping?: string } | undefined,
): Game | null {
  const competitors = competition.competitors ?? [];
  const homeCompetitor = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
  const awayCompetitor = competitors.find((c) => c.homeAway === "away") ?? competitors.find((c) => c !== homeCompetitor);
  if (!competition.id || !competition.date || !homeCompetitor || !awayCompetitor) return null;

  const gameStatus = mapTennisStatus(competition.status);
  const homeTeam = tennisTeamFromCompetitor(homeCompetitor, competition.dbls === true);
  const awayTeam = tennisTeamFromCompetitor(awayCompetitor, competition.dbls === true);
  const homeLinescores = tennisSetScores(homeCompetitor);
  const awayLinescores = tennisSetScores(awayCompetitor);
  const hasSetScores = Boolean(homeLinescores?.length || awayLinescores?.length || gameStatus === "LIVE" || gameStatus === "FINAL");
  const homeScore = hasSetScores ? tennisSetsWon(homeCompetitor, awayCompetitor) : undefined;
  const awayScore = hasSetScores ? tennisSetsWon(awayCompetitor, homeCompetitor) : undefined;
  const statusDetail = competition.status?.detail || competition.status?.description;
  const quarter = gameStatus === "LIVE"
    ? statusDetail
    : gameStatus === "FINAL"
      ? competition.status?.description ?? "Final"
      : undefined;
  const venue = tennisVenueText(meta, competition);

  const game: Game = {
    id: competition.id,
    sport: "TENNIS",
    homeTeam,
    awayTeam,
    gameTime: competition.date,
    status: gameStatus,
    venue,
    homeScore,
    awayScore,
    quarter,
    clock: gameStatus === "LIVE" ? statusDetail : undefined,
    seasonContext: deriveSeasonContext({
      sport: "TENNIS",
      gameTime: competition.date,
      eventName: venue,
      competitionNotes: [competition.note, meta?.grouping].filter(Boolean) as string[],
    }),
    homeLinescores,
    awayLinescores,
  };

  const cachedPrediction = pickFreshestPrediction(game.id, gameStatus === "LIVE");
  return cachedPrediction ? attachPredictionToGame(game, cachedPrediction) : game;
}

async function fetchTennisGamesFromESPN(date?: string): Promise<Game[]> {
  const url = date
    ? `${ESPN_ENDPOINTS.TENNIS}/${tennisDateParam(date)}`
    : ESPN_ENDPOINTS.TENNIS.replace("/_/date", "");

  if (!circuitAllowsRequest()) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.error(`ESPN API error for TENNIS: ${response.status}`);
      recordESPNFailure();
      return [];
    }

    const html = await response.text();
    const state = parseEspnFitTennisState(html);
    const scoreboard = state?.page?.content?.scoreboard;
    if (!scoreboard?.competitions) {
      recordESPNFailure();
      return [];
    }

    recordESPNSuccess();
    const tournamentIndex = buildTennisTournamentIndex(scoreboard);
    const games = Object.values(scoreboard.competitions)
      .map((competition) => transformTennisCompetition(
        competition,
        competition.id ? tournamentIndex.get(competition.id) : undefined,
      ))
      .filter((game): game is Game => game !== null)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    for (const game of games) {
      gameIdToSport.set(game.id, "TENNIS");
    }
    return games;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`[ESPN] fetch timed out for TENNIS:`, url);
      recordESPNFailure();
      return [];
    }
    console.error("Error fetching TENNIS games from ESPN:", error);
    recordESPNFailure();
    return [];
  }
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
  if (sport === "TENNIS") {
    return fetchTennisGamesFromESPN(date);
  }

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
  } else if (sport === "IPL") {
    params.set("limit", fullList ? "100" : "25");
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
    const sports: SportKey[] = ["NFL", "NBA", "MLB", "NHL", "MLS", "NCAAF", "NCAAB", "EPL", "UCL", "IPL", "TENNIS"];

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

const gamesRouter = new Hono<{
  Variables: {
    user: any;
  };
}>();

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

    // Fetch today + tomorrow + day-after-tomorrow in parallel. The third day is
    // needed because Railway runs in UTC and a US-PST user's "tomorrow night"
    // games (e.g. 7pm PST) have a gameTime in the UTC day-after-tomorrow.
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const dayAfter = new Date(now);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const dayAfterStr = dayAfter.toISOString().split("T")[0];

    const [todayGames, tomorrowGames, dayAfterGames] = await Promise.all([
      fetchAllGames(todayStr),
      fetchAllGames(tomorrowStr),
      fetchAllGames(dayAfterStr),
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

    const allGames = [...extraGames, ...todayGames, ...tomorrowGames, ...dayAfterGames];

    // Deduplicate by game ID
    const uniqueGames = Array.from(
      new Map(allGames.map((game) => [game.id, game])).values()
    );

    // Keep games whose gameTime is at most ~2 calendar days out in UTC. This
    // covers a US-PST user's "tomorrow night" slate (which spills into the UTC
    // day-after-tomorrow) without leaking far-future games into the response.
    const endOfToday = new Date(now);
    endOfToday.setDate(endOfToday.getDate() + 2);
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
        filteredGames[i] = attachPredictionToGame(game, cached);
      }
    }

    // Generate missing predictions entirely in background — the client will
    // pick them up on the next poll (6-10 seconds later)
    const gamesNeedingPredictions = filteredGames.filter(g => !g.prediction);
    if (gamesNeedingPredictions.length > 0) {
      generatePredictionsInBackground(gamesNeedingPredictions);
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

    // Select the first scheduled/live game per sport.
    const topPickGames: Game[] = [];
    for (const games of gamesBySport.values()) {
      // Sort by game time and take the first scheduled one
      const sorted = games.sort(
        (a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()
      );
      if (sorted[0]) {
        topPickGames.push(sorted[0]);
      }
    }

    // Generate predictions SYNCHRONOUSLY for these top picks (max ~8 games)
    const gamesWithPredictions = await batchProcess(
      topPickGames,
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

    // Attach any cached predictions inline so first paint shows them when warm.
    const gamesWithCached = games.map((g) => {
      if (g.prediction) return g;
      const cached = getCachedPrediction(g.id);
      return cached ? attachPredictionToGame(g, cached) : g;
    });

    // Kick off background generation for the rest so the next poll returns them.
    const missing = gamesWithCached.filter((g) => !g.prediction);
    if (missing.length > 0) {
      generatePredictionsInBackground(missing);
    }

    return c.json({ data: gamesWithCached });
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
        return attachPredictionToGame(game, cached);
      }
      // No cache at all — generate on-demand (fast, uses AI cache).
      return addPredictionToGame(game);
    };

    // First, check secondary game-ID index — O(1) lookup across all cached data.
    // Skip the fast-path for LIVE games: gameById has no TTL, so a stale entry
    // would freeze score/situation. Fall through to fetchAllGames so the 3s
    // adaptive list cache (LIVE_CACHE_TTL_MS) governs freshness.
    const indexedGame = gameById.get(gameId);
    if (indexedGame && indexedGame.status !== "LIVE") {
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

// SSE endpoint: streams live scores/situation every 1 second. Keep this above
// /:sport so "live-stream" is not interpreted as a sport slug.
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

    // Loop every second; send a heartbeat every 10th tick (~10s) to keep NAT/proxy alive
    let ticksSinceHeartbeat = 0;
    while (!aborted) {
      try {
        await stream.sleep(LIVE_POLL_INTERVAL);
      } catch {
        break;
      }
      if (aborted) break;
      ticksSinceHeartbeat++;
      if (ticksSinceHeartbeat >= 10) {
        ticksSinceHeartbeat = 0;
        try { await stream.writeSSE({ data: "", event: "heartbeat" }); } catch { break; }
        if (aborted) break;
      }
      if (!(await sendScores())) break;
    }
  });
});

gamesRouter.get("/:sport", async (c) => {
  const rawSportParam = c.req.param("sport").toUpperCase();
  const sportParam = (
    rawSportParam === "CRICKET" ? "IPL" :
    rawSportParam === "ATP" || rawSportParam === "WTA" ? "TENNIS" :
    rawSportParam
  ) as SportKey;

  if (!ESPN_ENDPOINTS[sportParam]) {
    return c.json(
      {
        error: {
          message: `Invalid sport: ${rawSportParam}. Valid options: NFL, NBA, MLB, NHL, MLS, NCAAF, NCAAB, EPL, UCL, IPL, TENNIS`,
          code: "INVALID_SPORT",
        },
      },
      400
    );
  }

  const dateQuery = c.req.query("date");

  try {
    const games = await fetchGamesBySport(sportParam, dateQuery || undefined, true);
    const gamesWithCached = games.map((game) => {
      if (game.prediction) return game;
      const cached = getCachedPrediction(game.id);
      return cached ? attachPredictionToGame(game, cached) : game;
    });
    const missing = gamesWithCached.filter((game) => !game.prediction);
    if (missing.length > 0) {
      generatePredictionsInBackground(missing);
    }
    return c.json({ data: gamesWithCached });
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
  status: "LIVE" | "FINAL";
  liveState?: Game["liveState"];
}

let liveGamesCache: { data: LiveScore[]; timestamp: number } | null = null;
const LIVE_POLL_INTERVAL = 1_000; // 1 second — fastest practical ESPN polling for live scores/situation

// Fix 3: track which sports currently have live games so SSE skips idle ones
let activeSports: Set<SportKey> = new Set();
let trackedLiveGameIds: Set<string> = new Set();
let lastFullScanTime = 0;
const FULL_SCAN_INTERVAL_MS = 10_000; // 10s — discover newly live games quickly

// Fix 4: gameId → sport for targeted /id/:id fallback searches
const gameIdToSport = new Map<string, SportKey>();

async function fetchLiveGamesOnce(): Promise<LiveScore[]> {
  const now = Date.now();
  if (liveGamesCache && now - liveGamesCache.timestamp < LIVE_POLL_INTERVAL) {
    return liveGamesCache.data;
  }

  const allSports: SportKey[] = ["NFL", "NBA", "MLB", "NHL", "MLS", "NCAAF", "NCAAB", "EPL", "UCL", "IPL", "TENNIS"];

  // Poll sports known to have live games every tick; do a bounded full scan to
  // discover newly-started games without hammering every league when nothing is live.
  const doFullScan =
    lastFullScanTime === 0 ||
    now - lastFullScanTime > FULL_SCAN_INTERVAL_MS;
  const sportsToCheck = doFullScan ? allSports : allSports.filter((s) => activeSports.has(s));
  if (doFullScan) lastFullScanTime = now;
  if (sportsToCheck.length === 0) {
    liveGamesCache = { data: [], timestamp: now };
    return [];
  }

  const results = await Promise.all(
    sportsToCheck.map(async (sport): Promise<LiveScore[]> => {
      try {
        if (!circuitAllowsRequest()) return [];

        if (sport === "TENNIS") {
          const tennisGames = await fetchTennisGamesFromESPN();
          return tennisGames
            .filter((game) => game.status === "LIVE" || (game.status === "FINAL" && trackedLiveGameIds.has(game.id)))
            .map((game): LiveScore => ({
              id: game.id,
              sport,
              homeTeam: {
                abbreviation: game.homeTeam.abbreviation,
                name: game.homeTeam.name,
              },
              awayTeam: {
                abbreviation: game.awayTeam.abbreviation,
                name: game.awayTeam.name,
              },
              homeScore: game.homeScore ?? 0,
              awayScore: game.awayScore ?? 0,
              clock: game.clock ?? null,
              period: parsePeriodNumber(game.quarter ?? "") ?? null,
              quarter: game.quarter ?? null,
              status: game.status === "FINAL" ? "FINAL" : "LIVE",
            }));
        }

        // Keep SSE polling snappy; one slow ESPN sport should not stall all live updates.
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
          .map((ev): LiveScore | null => {
            const comp = ev.competitions[0];
            if (!comp) return null;
            const status = mapGameStatus(comp.status);
            if (status !== "LIVE" && !(status === "FINAL" && trackedLiveGameIds.has(ev.id))) {
              return null;
            }
            const liveStatus: LiveScore["status"] = status === "FINAL" ? "FINAL" : "LIVE";
            const home = comp.competitors.find((c) => c.homeAway === "home");
            const away = comp.competitors.find((c) => c.homeAway === "away");
            if (!home || !away) return null;
            const liveState = parseMlbLiveState({
              sport,
              status: liveStatus,
              competition: comp,
              homeAbbr: home.team.abbreviation,
              awayAbbr: away.team.abbreviation,
              gameId: ev.id,
            });
            const rawQuarter = getPeriodDisplay(comp.status, sport) ?? null;

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
              quarter: sport === "MLB" ? getMlbPeriodDisplay(liveState) ?? rawQuarter : rawQuarter,
              status: liveStatus,
              liveState,
            };
          })
          .filter((s): s is LiveScore => s !== null);
      } catch {
        return [];
      }
    })
  );

  const data = results.flat();

  // Update activeSports to only sports with games still in-progress. FINAL
  // updates are sent once for games that were live on the previous tick.
  const newActive = new Set<SportKey>();
  const nextTrackedLiveIds = new Set<string>();
  for (const score of data) {
    if (score.status === "LIVE") {
      newActive.add(score.sport as SportKey);
      nextTrackedLiveIds.add(score.id);
    }
  }
  activeSports = newActive;
  trackedLiveGameIds = nextTrackedLiveIds;

  liveGamesCache = { data, timestamp: now };
  return data;
}

// ─── Public lookup helpers (used by the intelligence route) ──────────────

/**
 * Resolve a game by ID using the same lookup strategy as GET /api/games/id/:id.
 * Order: secondary index → today's games → ±3 days fallback. Always returns
 * with a fresh prediction attached (cache-first, falls back to on-demand).
 *
 * Returns null when the game is not found within the search window.
 */
export async function lookupGameById(gameId: string): Promise<Game | null> {
  const ensurePrediction = async (game: Game): Promise<Game> => {
    const cached = pickFreshestPrediction(game.id, game.status === "LIVE");
    if (cached) return attachPredictionToGame(game, cached);
    return addPredictionToGame(game);
  };

  const indexedGame = gameById.get(gameId);
  if (indexedGame && indexedGame.status !== "LIVE") {
    return ensurePrediction(indexedGame);
  }

  const todayStr = new Date().toISOString().split("T")[0]!;
  const todays = await fetchAllGames(todayStr);
  const found = todays.find((g) => g.id === gameId);
  if (found) return ensurePrediction(found);

  const today = new Date();
  const dates: string[] = [];
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]!);
  }

  const knownSport = gameIdToSport.get(gameId);
  const dateResults = await Promise.all(
    dates.map(async (date) => {
      const games = knownSport
        ? await fetchGamesBySport(knownSport, date)
        : await fetchAllGames(date);
      return games.find((g) => g.id === gameId) ?? null;
    }),
  );
  const fallback = dateResults.find((g) => g !== null) ?? null;
  return fallback ? ensurePrediction(fallback) : null;
}

/**
 * Best-effort: scan the next 7 days for an upcoming SCHEDULED game involving
 * either team from `game`. Used by the intelligence route's FINAL-state
 * "nextOpportunity" box. Returns null when no rematch / next-game found.
 */
export async function findSimilarUpcomingGame(game: Game): Promise<Game | null> {
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]!);
  }

  const sport = game.sport as SportKey;
  const homeId = game.homeTeam.id;
  const awayId = game.awayTeam.id;

  for (const date of dates) {
    let candidates: Game[] = [];
    try {
      candidates = await fetchGamesBySport(sport, date);
    } catch {
      candidates = [];
    }
    const next = candidates.find((g) => {
      if (g.id === game.id) return false;
      if (g.status !== "SCHEDULED") return false;
      return (
        g.homeTeam.id === homeId ||
        g.awayTeam.id === homeId ||
        g.homeTeam.id === awayId ||
        g.awayTeam.id === awayId
      );
    });
    if (next) return next;
  }
  return null;
}

export { gamesRouter };
