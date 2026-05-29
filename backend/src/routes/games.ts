/**
 * Real-time Sports Games API Routes
 * Fetches live game data from ESPN's unofficial API with AI predictions
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { LRUCache } from "lru-cache";
import type { PredictionResult as StoredPredictionResult } from "@prisma/client";
import { cleanOldShadowLogs } from "../prediction/shadow";
import { runNewEnginePrediction, isMarketAwareTossUp } from "../prediction/newEngineAdapter";
import { deriveSeasonContext, type NarrativeSeasonContext } from "../prediction/seasonContext";
import { buildDeterministicNarrative, buildNarrativeInput } from "../prediction/narrative";
import { getConfidenceBand, type CanonicalEngineRead, type CanonicalPredictionResult, type FactorContribution } from "../prediction/types";
import { getSportSimulationProfile } from "../prediction/simulators/profiles";
import {
  canonicalFromLegacyPrediction,
  canonicalPickFromProbabilities,
  normalizeCanonicalProbabilities,
  probabilityForPick,
} from "../prediction/canonical";
import { fetchMarketConsensus } from "../lib/sharpApi";
import {
  extractTennisAthleteId,
  fetchTennisRankings,
  type TennisRankingEntry,
  type TennisTour,
} from "../lib/tennisStats";
import { fetchTennisExplorerLiveMatches, type TennisExplorerLiveMatch } from "../lib/tennisExplorer";
import { fetchIPLStandings, type IPLStandingEntry } from "../lib/iplStandings";
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
  UCL: "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard",
  IPL: "https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard",
  TENNIS: "https://www.espn.com/tennis/scoreboard/_/date",
} as const;

export type SportKey = keyof typeof ESPN_ENDPOINTS;

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
  seed?: number;
  rankingPoints?: number;
  tour?: TennisTour;
  tennisRankSource?: "espn-rankings";
  standingsRank?: number;
  standingsPoints?: number;
  netRunRate?: number;
  runRateFor?: number;
  runRateAgainst?: number;
  matchesPlayed?: number;
}

export interface CricketInningsScore {
  runs?: number;
  wickets?: number;
  overs?: number;
  maxOvers?: number;
  isBatting?: boolean;
  description?: string;
  scoreText: string;
  detailText?: string;
}

export interface CricketScoreState {
  home?: CricketInningsScore;
  away?: CricketInningsScore;
  battingSide?: "home" | "away";
  innings?: number | null;
  summary?: string;
  target?: number;
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
  canonicalResult?: CanonicalPredictionResult;
  predictedWinner: "home" | "away";
  predictedOutcome?: "home" | "away" | "draw";
  confidence: number;
  analysis: string;
  predictedSpread: number;
  predictedTotal: number;
  marketFavorite?: "home" | "away";
  spread?: number;
  overUnder?: number;
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
  lowDataWarning?: boolean;
  ensembleDivergence?: boolean;
  drawProbability?: number;
  modelVersion?: string;
  snapshotType?: "stored-pregame";
  wasCorrect?: boolean | null;
  actualOutcome?: "home" | "away" | "draw" | "unavailable" | null;
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
  source?: "espn" | "tennis-explorer";
  homeTeam: GameTeam;
  awayTeam: GameTeam;
  gameTime: string;
  status: "SCHEDULED" | "LIVE" | "FINAL" | "POSTPONED" | "CANCELLED";
  venue: string;
  tvChannel?: string;
  watchSources?: string[];
  homeScore?: number;
  awayScore?: number;
  homeScoreDisplay?: string;
  awayScoreDisplay?: string;
  spread?: number;
  overUnder?: number;
  marketFavorite?: "home" | "away";
  quarter?: string;
  clock?: string;
  statusLabel?: string;
  statusDetail?: string;
  suspension?: {
    display: string;
    resumeText: string;
    reasonText: string;
    source?: string;
  };
  seasonContext?: NarrativeSeasonContext | null;
  homeLinescores?: number[];
  awayLinescores?: number[];
  cricketState?: CricketScoreState;
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
  linescores?: Array<{
    value?: number;
    displayValue?: string;
    period?: number;
    runs?: number;
    wickets?: number;
    overs?: number;
    maxOvers?: number;
    isBatting?: boolean | number;
    isCurrent?: boolean | number;
    description?: string;
  }>;
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
  rnk?: number; // tournament seed from ESPN scoreboard, not world rank
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
// Secondary index: gameId → Game, for O(1) lookups in /id/:id
const gameById = new Map<string, Game>();
// In-flight request deduplication: prevents parallel requests for the same key
// from all hitting ESPN simultaneously. Second caller waits for the first's promise.
const inFlight = new Map<string, Promise<Game[]>>();

type ScoreboardGameIdentity = {
  id: string;
  sport: string;
  source?: string;
  status?: string;
  homeScore?: number;
  awayScore?: number;
};

const TRUSTED_SCOREBOARD_SPORTS = new Set<string>(Object.keys(ESPN_ENDPOINTS));

function isTrustedEspnEventId(id: string): boolean {
  return /^\d+$/.test(id);
}

function isTrustedTennisSupplementalGame(game: ScoreboardGameIdentity): boolean {
  return (
    game.sport === "TENNIS" &&
    game.source === "tennis-explorer" &&
    /^tennis-explorer-\d+$/.test(game.id) &&
    (game.status === "LIVE" || game.status === "SCHEDULED")
  );
}

export function isVerifiedScoreboardGame(game: ScoreboardGameIdentity): boolean {
  if (!TRUSTED_SCOREBOARD_SPORTS.has(game.sport)) return false;
  if (!isTrustedEspnEventId(game.id) && !isTrustedTennisSupplementalGame(game)) return false;

  if (game.status === "LIVE" || game.status === "FINAL") {
    const scores = [game.homeScore, game.awayScore].filter((score): score is number => score !== undefined);
    if (scores.some((score) => !Number.isFinite(score) || score < 0)) return false;
  }

  return true;
}

function filterVerifiedScoreboardGames<T extends ScoreboardGameIdentity>(games: T[]): T[] {
  return games.filter(isVerifiedScoreboardGame);
}

function getCachedData(cacheKey: string): Game[] | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  const verifiedData = filterVerifiedScoreboardGames(entry.data);
  if (verifiedData.length !== entry.data.length) {
    cache.set(cacheKey, { data: verifiedData, timestamp: entry.timestamp });
  }
  const now = Date.now();
  // Adaptive TTL: shorter when entry contains any live game so scores/situation
  // refresh on a near-real-time cadence. Falls back to the 60s default otherwise.
  const ttl = verifiedData.some((g) => g.status === "LIVE") ? LIVE_CACHE_TTL_MS : CACHE_TTL_MS;
  if (now - entry.timestamp > ttl) {
    cache.delete(cacheKey);
    return null;
  }
  return verifiedData;
}

function setCacheData(cacheKey: string, data: Game[]): void {
  const verifiedData = filterVerifiedScoreboardGames(data);
  cache.set(cacheKey, { data: verifiedData, timestamp: Date.now() });
  // Keep secondary game-ID index fresh
  for (const game of verifiedData) {
    gameById.set(game.id, game);
  }
}

// Prediction cache - predictions don't change as often as scores
const PREDICTION_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PREDICTION_NARRATIVE_VERSION = "bar-friend-v10-stable-50k-simulation";
type PredictionCacheEntry = { prediction: GamePrediction; timestamp: number };
const predictionCache = new LRUCache<string, PredictionCacheEntry>({ max: 500 });

function predictionCacheKey(gameId: string): string {
  return `${gameId}:${PREDICTION_NARRATIVE_VERSION}`;
}

function readCachedPredictionEntry(gameId: string): PredictionCacheEntry | null {
  return predictionCache.get(predictionCacheKey(gameId)) ?? null;
}

function isPredictionCacheEntryFresh(entry: PredictionCacheEntry): boolean {
  return Date.now() - entry.timestamp <= PREDICTION_CACHE_TTL_MS;
}

function getCachedPrediction(
  gameId: string,
  opts: { allowExpired?: boolean } = {},
): GamePrediction | null {
  const entry = readCachedPredictionEntry(gameId);
  if (!entry) return null;
  if (!isPredictionCacheEntryFresh(entry)) {
    if (opts.allowExpired) return entry.prediction;
    return null;
  }
  return entry.prediction;
}

function setCachedPrediction(gameId: string, prediction: GamePrediction): void {
  predictionCache.set(predictionCacheKey(gameId), { prediction, timestamp: Date.now() });
}

const STALE_NARRATIVE_REGEX =
  /the data points toward|biggest driver|clear separation|Expected score rounds to|Average scoring is basically level|Projected finish rounds to|Home\s+[A-Z0-9]{2,5}\s+Elo|Away\s+[A-Z0-9]{2,5}\s+Elo|Home\s+L10:|Away\s+L10:|\bthe model\b|\bthe algorithm\b|\bget the call\b|\busable edges\b|\bpower-rating (?:case|setup)\b|\bworking against the pick\b|\bexpected-score projection adds context\b|\bstart here\b|\bgets? the nod\b|\bgot (?:a |the )?(?:slight |solid |clear )?edge\b|don['’]t sleep|\brather grim\b|\blighting up\b|The main reason:|The clearest starting point|The first thing that stands out|Additional support:|There is backup for it too|The concern:|are the lean over|get the narrow nod|The next layer supports/i;

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

  // Narrate the canonical pick (the single source of truth). Draw/none → no
  // single winner; fall back to the legacy field only if canonical is absent.
  const finalPick = prediction.canonicalResult?.finalPick;
  const winnerAbbr =
    finalPick === "home"
      ? game.homeTeam.abbreviation
      : finalPick === "away"
        ? game.awayTeam.abbreviation
        : finalPick === "draw" || finalPick === "none"
          ? null
          : prediction.predictedWinner === "home"
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

export function attachPredictionToGame(game: Game, prediction: GamePrediction): Game {
  if (!predictionMatchesGame(game, prediction)) {
    return game;
  }

  const displayPrediction = sanitizePredictionForGame(
    game,
    ensureCanonicalPredictionResult(game, prediction),
  );
  return {
    ...game,
    prediction: displayPrediction,
  };
}

const TOP_PICK_MIN_CONFIDENCE = 56;
// Fallback floor used only when a sport has no pick that clears the strict 56
// bar. A relaxed pick must still be a genuine lean (above a coin flip) and must
// pass every quality gate below — it just may be a 53-55 lean rather than a
// high-conviction read. This keeps the board populated on thin/offseason slates
// without ever surfacing a pick the engine itself flagged as unreliable.
const TOP_PICK_RELAXED_MIN_CONFIDENCE = 53;
const TOP_PICK_LIMIT = 8;
const TOP_PICK_MAX_CANDIDATES = 48;
const TOP_PICK_MAX_CANDIDATES_PER_SPORT = 6;
const TOP_PICK_BLOCKED_DECISION_TAGS = new Set(["thin-data", "low-conviction"]);
const TOP_PICK_BLOCKED_WARNING_REGEX =
  /reliability reserve|missing critical|data coverage is thin|source unavailable|confidence compressed/i;
const TOP_PICK_SPORT_ORDER: Game["sport"][] = [
  "NBA",
  "NFL",
  "NCAAF",
  "NCAAB",
  "MLB",
  "NHL",
  "IPL",
  "TENNIS",
  "MLS",
  "EPL",
  "UCL",
];

// Every quality gate a featured pick must clear, parameterized only by the
// confidence floor. Both the strict and relaxed gates share this so a relaxed
// fallback pick can never bypass the blocked-tag / low-data / toss-up /
// reliability-warning checks — the exact defect that let a 44.5% thin-data pick
// reach Top Picks. The ONLY difference between strict and relaxed is the floor.
function passesTopPickQualityGates(game: Game, minConfidence: number): boolean {
  const prediction = game.prediction;
  const canonical = prediction?.canonicalResult;
  if (!prediction || !canonical) return false;
  if (game.status !== "SCHEDULED") return false;
  if (prediction.snapshotType === "stored-pregame") return false;
  if (prediction.lowDataWarning || prediction.isTossUp) return false;

  const confidence = canonical.confidence ?? prediction.confidence;
  if (!Number.isFinite(confidence) || confidence < minConfidence) return false;
  if (canonical.decisionProfile?.lowDataWarning) return false;

  const tags = canonical.decisionProfile?.tags ?? [];
  if (tags.some((tag) => TOP_PICK_BLOCKED_DECISION_TAGS.has(tag))) return false;

  const warnings = canonical.warnings ?? [];
  if (warnings.some((warning) => TOP_PICK_BLOCKED_WARNING_REGEX.test(warning))) return false;

  return true;
}

export function isTopPickEligible(game: Game): boolean {
  return passesTopPickQualityGates(game, TOP_PICK_MIN_CONFIDENCE);
}

// Relaxed fallback: same quality gates, lower confidence floor. Used only when
// no strict-eligible pick exists for a sport.
export function isRelaxedTopPickEligible(game: Game): boolean {
  return passesTopPickQualityGates(game, TOP_PICK_RELAXED_MIN_CONFIDENCE);
}

function isDisplayableTopPickCandidate(game: Game): boolean {
  const prediction = game.prediction;
  const canonical = prediction?.canonicalResult;
  if (!prediction || !canonical) return false;
  if (game.status !== "SCHEDULED") return false;
  if (prediction.snapshotType === "stored-pregame") return false;

  const awayName = game.awayTeam?.name?.trim();
  const homeName = game.homeTeam?.name?.trim();
  if (!awayName || !homeName || awayName === "TBD" || homeName === "TBD" || awayName === "—" || homeName === "—") {
    return false;
  }

  const confidence = canonical.confidence ?? prediction.confidence;
  return Number.isFinite(confidence);
}

function topPickScore(game: Game): number {
  const prediction = game.prediction;
  const canonical = prediction?.canonicalResult;
  if (!prediction || !canonical) return Number.NEGATIVE_INFINITY;

  const confidence = canonical.confidence ?? prediction.confidence;
  const edge = prediction.edgeRating ?? 5;
  const value = prediction.valueRating ?? 5;
  const tags = canonical.decisionProfile?.tags ?? [];
  const warnings = canonical.warnings ?? [];

  let score = confidence + (edge - 5) * 2 + (value - 5) * 1.25;
  if (prediction.isTossUp) score -= 12;
  if (prediction.lowDataWarning || canonical.decisionProfile?.lowDataWarning) score -= 10;
  if (tags.some((tag) => TOP_PICK_BLOCKED_DECISION_TAGS.has(tag))) score -= 14;
  if (warnings.some((warning) => TOP_PICK_BLOCKED_WARNING_REGEX.test(warning))) score -= 10;
  return score;
}

export function selectTopPicksForDisplay(games: Game[]): Game[] {
  const gamesBySport = new Map<Game["sport"], Game[]>();
  for (const game of games.filter(isDisplayableTopPickCandidate)) {
    const existing = gamesBySport.get(game.sport) ?? [];
    existing.push(game);
    gamesBySport.set(game.sport, existing);
  }

  return [...gamesBySport.entries()]
    .map(([sport, sportGames]) => {
      const strict = sportGames.filter(isTopPickEligible);
      // Fallback to relaxed-but-still-clean picks (never the ungated sportGames,
      // which let blocked/low-data/below-coin-flip picks through). A sport with
      // no acceptable pick contributes none rather than a pick we distrust.
      const pool = strict.length > 0 ? strict : sportGames.filter(isRelaxedTopPickEligible);
      const best = [...pool].sort((a, b) => topPickScore(b) - topPickScore(a))[0];
      return { sport, game: best };
    })
    .filter((entry): entry is { sport: Game["sport"]; game: Game } => Boolean(entry.game))
    .sort((a, b) => {
      const orderA = TOP_PICK_SPORT_ORDER.indexOf(a.sport);
      const orderB = TOP_PICK_SPORT_ORDER.indexOf(b.sport);
      const rankA = orderA === -1 ? TOP_PICK_SPORT_ORDER.length : orderA;
      const rankB = orderB === -1 ? TOP_PICK_SPORT_ORDER.length : orderB;
      if (rankA !== rankB) return rankA - rankB;
      return topPickScore(b.game) - topPickScore(a.game);
    })
    .map((entry) => entry.game)
    .slice(0, TOP_PICK_LIMIT);
}

function selectTopPickCandidates(games: Game[]): Game[] {
  const gamesBySport = new Map<string, Game[]>();
  for (const game of games) {
    const existing = gamesBySport.get(game.sport) ?? [];
    existing.push(game);
    gamesBySport.set(game.sport, existing);
  }

  return [...gamesBySport.values()]
    .flatMap((sportGames) =>
      sportGames
        .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
        .slice(0, TOP_PICK_MAX_CANDIDATES_PER_SPORT)
    )
    .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
    .slice(0, TOP_PICK_MAX_CANDIDATES);
}

function isFinalGame(game: Game): boolean {
  return game.status === "FINAL";
}

function normalizedStoredProbabilities(row: {
  predictedOutcome: string | null;
  predictedWinner?: string | null;
  confidence?: number | null;
  homeWinProb: number | null;
  awayWinProb: number | null;
  drawProb: number | null;
}): {
  home: number;
  away: number;
  draw?: number;
} {
  const predictedOutcome =
    row.predictedOutcome === "home" || row.predictedOutcome === "away" || row.predictedOutcome === "draw"
      ? row.predictedOutcome
      : row.predictedWinner === "away"
        ? "away"
        : "home";
  const includeDraw = predictedOutcome === "draw" || typeof row.drawProb === "number";
  const confidenceProbability =
    typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? clampNumber(row.confidence / 100, 0, 1)
      : null;

  let home = typeof row.homeWinProb === "number" ? row.homeWinProb : null;
  let away = typeof row.awayWinProb === "number" ? row.awayWinProb : null;
  let draw = includeDraw ? (typeof row.drawProb === "number" ? row.drawProb : null) : undefined;

  if (home === null && away === null && (draw === null || draw === undefined) && confidenceProbability !== null) {
    if (predictedOutcome === "home") {
      home = confidenceProbability;
      away = 1 - confidenceProbability;
    } else if (predictedOutcome === "away") {
      away = confidenceProbability;
      home = 1 - confidenceProbability;
    } else {
      draw = confidenceProbability;
      home = (1 - confidenceProbability) / 2;
      away = (1 - confidenceProbability) / 2;
    }
  }

  if (!includeDraw) {
    if (home === null && away !== null) home = 1 - away;
    if (away === null && home !== null) away = 1 - home;
  }

  home ??= includeDraw ? 0.375 : 0.5;
  away ??= includeDraw ? 0.375 : 0.5;
  if (includeDraw) draw ??= 0.25;

  const total = home + away + (draw ?? 0);
  if (total <= 0) {
    return includeDraw ? { home: 0.375, away: 0.375, draw: 0.25 } : { home: 0.5, away: 0.5 };
  }
  return {
    home: home / total,
    away: away / total,
    ...(includeDraw ? { draw: (draw ?? 0) / total } : {}),
  };
}

function lockedPregameStartPhrase(sport: Game["sport"]): string {
  switch (sport) {
    case "NBA":
    case "NCAAB":
      return "before tipoff";
    case "NFL":
    case "NCAAF":
      return "before kickoff";
    case "MLB":
      return "before first pitch";
    case "NHL":
      return "before puck drop";
    case "TENNIS":
      return "before first serve";
    case "IPL":
      return "before the toss and opening ball";
    default:
      return "before the match started";
  }
}

function buildStoredPregameAnalysis(
  game: Game,
  predictedOutcome: "home" | "away" | "draw",
  probabilities: { home: number; away: number; draw?: number },
): string {
  const selectedTeam =
    predictedOutcome === "home"
      ? game.homeTeam.name
      : predictedOutcome === "away"
        ? game.awayTeam.name
        : "a draw";
  const selectedProbability = probabilityForPick(probabilities, predictedOutcome);
  const probabilityText = Number.isFinite(selectedProbability)
    ? ` at ${Math.round(selectedProbability * 100)}%`
    : "";
  const startPhrase = lockedPregameStartPhrase(game.sport);

  if (predictedOutcome === "draw") {
    return `The pregame read flagged a draw profile${probabilityText} ${startPhrase}. This pick is locked now that the event has started, so the live score is shown separately and does not rewrite the recommendation.`;
  }

  return `The pregame read favored ${selectedTeam}${probabilityText} ${startPhrase}. This pick is locked now that the event has started, so the live score is shown separately and does not rewrite the recommendation.`;
}

type StoredPredictionSnapshotRow = Omit<
  StoredPredictionResult,
  "analysisSnapshot" | "projectionJson" | "canonicalResultJson"
> &
  Partial<Pick<StoredPredictionResult, "analysisSnapshot" | "projectionJson" | "canonicalResultJson">>;

function safeJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseStoredProjection(value: string | null | undefined): GamePrediction["projection"] | undefined {
  const raw = safeJsonObject(value);
  if (!raw) return undefined;
  const projectedHomeScore = finiteNumber(raw.projectedHomeScore);
  const projectedAwayScore = finiteNumber(raw.projectedAwayScore);
  const projectedSpread = finiteNumber(raw.projectedSpread);
  const projectedTotal = finiteNumber(raw.projectedTotal);
  const homeWinProbability = finiteNumber(raw.homeWinProbability);
  const awayWinProbability = finiteNumber(raw.awayWinProbability);
  const volatility = finiteNumber(raw.volatility);
  const upsetRisk = finiteNumber(raw.upsetRisk);
  if (
    projectedHomeScore === null ||
    projectedAwayScore === null ||
    projectedSpread === null ||
    projectedTotal === null ||
    homeWinProbability === null ||
    awayWinProbability === null ||
    volatility === null ||
    upsetRisk === null
  ) {
    return undefined;
  }

  const drawProbability = finiteNumber(raw.drawProbability) ?? undefined;
  const signals = Array.isArray(raw.signals)
    ? raw.signals
        .map((signal): NonNullable<GamePrediction["projection"]>["signals"][number] | null => {
          if (!signal || typeof signal !== "object") return null;
          const record = signal as Record<string, unknown>;
          const key = typeof record.key === "string" ? record.key : "stored-signal";
          const label = typeof record.label === "string" ? record.label : "Stored projection signal";
          const value = finiteNumber(record.value) ?? 0;
          const evidence = typeof record.evidence === "string" ? record.evidence : "Stored pregame projection signal";
          return { key, label, value, evidence };
        })
        .filter((signal): signal is NonNullable<GamePrediction["projection"]>["signals"][number] => signal !== null)
    : [];

  return {
    engine: typeof raw.engine === "string" ? raw.engine : "game-script-v1",
    iterations: finiteNumber(raw.iterations) ?? 0,
    homeWinProbability,
    awayWinProbability,
    drawProbability,
    projectedHomeScore,
    projectedAwayScore,
    projectedSpread,
    projectedTotal,
    volatility,
    upsetRisk,
    signals,
  };
}

function parseStoredCanonicalResult(value: string | null | undefined): CanonicalPredictionResult | undefined {
  const raw = safeJsonObject(value);
  if (!raw) return undefined;
  const finalPick = raw.finalPick;
  const probabilities = raw.probabilities;
  if (
    finalPick !== "home" &&
    finalPick !== "away" &&
    finalPick !== "draw" &&
    finalPick !== "none"
  ) {
    return undefined;
  }
  if (!probabilities || typeof probabilities !== "object") return undefined;
  return raw as unknown as CanonicalPredictionResult;
}

function normalizeTeamSnapshot(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function storedTeamSnapshotMatches(team: GameTeam, snapshot: string | null | undefined): boolean {
  const normalized = normalizeTeamSnapshot(snapshot);
  if (!normalized) return true;
  return normalized === normalizeTeamSnapshot(team.abbreviation) || normalized === normalizeTeamSnapshot(team.name);
}

function storedPredictionRowMatchesGame(game: Game, row: StoredPredictionSnapshotRow): boolean {
  const canonical = parseStoredCanonicalResult(row.canonicalResultJson);
  if (canonical) {
    const inputs = canonical.modelInputs;
    if (inputs?.homeTeamId && inputs.homeTeamId !== game.homeTeam.id) return false;
    if (inputs?.awayTeamId && inputs.awayTeamId !== game.awayTeam.id) return false;
  }

  return (
    storedTeamSnapshotMatches(game.homeTeam, row.homeTeam) &&
    storedTeamSnapshotMatches(game.awayTeam, row.awayTeam)
  );
}

function withStoredSnapshotWarning(
  canonical: CanonicalPredictionResult,
  warning: string,
): CanonicalPredictionResult {
  const warnings = canonical.warnings ?? [];
  return {
    ...canonical,
    warnings: warnings.includes(warning) ? warnings : [...warnings, warning],
  };
}

function finiteTeamProjectionNumber(
  team: GameTeam,
  field: "runRateFor" | "runRateAgainst",
): number | null {
  const value = team[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function t20RunsFromRunRate(rate: number | null): number | null {
  if (rate === null) return null;
  return clampNumber(rate * 20, 80, 240);
}

function averageFiniteNumbers(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function tennisRankValue(team: GameTeam | undefined): number | null {
  if (typeof team?.rank === "number" && Number.isFinite(team.rank)) return team.rank;
  const match = team?.record?.match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

function tennisGameLineForPick(
  game: Game,
  winner: "home" | "away",
  selectedProbability: number,
): { home: number; away: number; spread: number; total: number } {
  const winnerRank = tennisRankValue(winner === "home" ? game.homeTeam : game.awayTeam);
  const opponentRank = tennisRankValue(winner === "home" ? game.awayTeam : game.homeTeam);
  const rankAdvantage =
    winnerRank !== null && opponentRank !== null
      ? opponentRank - winnerRank
      : 0;
  const probability = clampNumber(
    selectedProbability > 1 ? selectedProbability / 100 : selectedProbability,
    0,
    1,
  );
  const dominance = clampNumber((probability - 0.5) * 4 + rankAdvantage / 90, 0, 1.6);
  const projectedTotal = roundTenth(clampNumber(26.5 - dominance * 4.5, 18.5, 30.5));
  const maxMargin = Math.max(1.2, projectedTotal - 12);
  const margin = roundTenth(clampNumber(1.6 + dominance * 5.2, 1.2, Math.min(8.5, maxMargin)));
  const spread = winner === "home" ? margin : -margin;
  const home = roundTenth((projectedTotal + spread) / 2);
  const away = roundTenth((projectedTotal - spread) / 2);

  return {
    home,
    away,
    spread: roundTenth(home - away),
    total: roundTenth(home + away),
  };
}

function iplRunRateScoreLine(game: Game): { home: number; away: number } | null {
  if (game.sport !== "IPL") return null;

  const home = averageFiniteNumbers([
    t20RunsFromRunRate(finiteTeamProjectionNumber(game.homeTeam, "runRateFor")),
    t20RunsFromRunRate(finiteTeamProjectionNumber(game.awayTeam, "runRateAgainst")),
  ]);
  const away = averageFiniteNumbers([
    t20RunsFromRunRate(finiteTeamProjectionNumber(game.awayTeam, "runRateFor")),
    t20RunsFromRunRate(finiteTeamProjectionNumber(game.homeTeam, "runRateAgainst")),
  ]);

  if (home === null || away === null) return null;
  return {
    home: Math.round(home),
    away: Math.round(away),
  };
}

function alignScoreLineToOutcome(args: {
  home: number;
  away: number;
  pick: "home" | "away";
  minMargin: number;
  minScore: number;
}): { home: number; away: number } {
  const total = args.home + args.away;
  const currentSpread = args.home - args.away;
  const targetSpread =
    args.pick === "home"
      ? Math.max(currentSpread, args.minMargin)
      : Math.min(currentSpread, -args.minMargin);
  let home = (total + targetSpread) / 2;
  let away = (total - targetSpread) / 2;

  if (home < args.minScore) {
    away += args.minScore - home;
    home = args.minScore;
  }
  if (away < args.minScore) {
    home += args.minScore - away;
    away = args.minScore;
  }

  return {
    home: Math.round(home),
    away: Math.round(away),
  };
}

function buildProbabilityProjection(
  game: Game,
  predictedOutcome: "home" | "away" | "draw",
  probabilities: { home: number; away: number; draw?: number },
): NonNullable<GamePrediction["projection"]> {
  const profile = getSportSimulationProfile(game.sport);
  const baseline = profile.baseline;

  if (game.sport === "TENNIS") {
    const tennisPick =
      predictedOutcome === "home" || predictedOutcome === "away"
        ? predictedOutcome
        : probabilities.home >= probabilities.away ? "home" : "away";
    const selectedProbability = probabilityForPick(probabilities, tennisPick);
    const scoreLine = tennisGameLineForPick(game, tennisPick, selectedProbability);
    const projectedHomeScore = scoreLine.home;
    const projectedAwayScore = scoreLine.away;
    const projectedTotal = scoreLine.total;
    const projectedSpread = scoreLine.spread;
    const volatility = Math.round(clampNumber(baseline.marginSd / Math.max(projectedTotal, 1), 0.05, 0.95) * 1000) / 1000;

    return {
      engine: "stored-pregame-projection-v1",
      iterations: 0,
      homeWinProbability: roundPercentTenth(probabilities.home * 100),
      awayWinProbability: roundPercentTenth(probabilities.away * 100),
      drawProbability:
        probabilities.draw !== undefined
          ? roundPercentTenth(probabilities.draw * 100)
          : undefined,
      projectedHomeScore,
      projectedAwayScore,
      projectedSpread,
      projectedTotal,
      volatility,
      upsetRisk: Math.round(clampNumber(1 - selectedProbability, 0.05, 0.49) * 1000) / 1000,
      signals: [
        {
          key: "stored-pregame-probability",
          label: "Stored pregame probability",
          value: roundPercentTenth(selectedProbability * 100),
          evidence: "Projected match games rebuilt from the locked pregame probability snapshot and player-rank context; live/final score was not used",
        },
        {
          key: "league-scoring-profile",
          label: "League scoring profile",
          value: projectedTotal,
          evidence: "Tennis scoring uses expected match games instead of recycled set scores",
        },
      ],
    };
  }

  if (game.sport === "IPL") {
    const runRateLine = iplRunRateScoreLine(game);
    if (runRateLine) {
      const cricketPick =
        predictedOutcome === "home" || predictedOutcome === "away"
          ? predictedOutcome
          : probabilities.home >= probabilities.away ? "home" : "away";
      const selectedProbability = probabilityForPick(probabilities, cricketPick);
      const minDirectionalMargin = Math.min(profile.meaningfulMarginThreshold, (runRateLine.home + runRateLine.away) * 0.08);
      const alignedLine = alignScoreLineToOutcome({
        ...runRateLine,
        pick: cricketPick,
        minMargin: minDirectionalMargin,
        minScore: baseline.minScore,
      });
      const projectedHomeScore = alignedLine.home;
      const projectedAwayScore = alignedLine.away;
      const projectedTotal = projectedHomeScore + projectedAwayScore;
      const projectedSpread = projectedHomeScore - projectedAwayScore;
      const volatility = Math.round(clampNumber(baseline.marginSd / Math.max(projectedTotal, 1), 0.05, 0.95) * 1000) / 1000;

      return {
        engine: "stored-pregame-projection-v1",
        iterations: 0,
        homeWinProbability: roundPercentTenth(probabilities.home * 100),
        awayWinProbability: roundPercentTenth(probabilities.away * 100),
        drawProbability:
          probabilities.draw !== undefined
            ? roundPercentTenth(probabilities.draw * 100)
            : undefined,
        projectedHomeScore,
        projectedAwayScore,
        projectedSpread,
        projectedTotal,
        volatility,
        upsetRisk: Math.round(clampNumber(1 - selectedProbability, 0.05, 0.49) * 1000) / 1000,
        signals: [
          {
            key: "ipl-run-rate-projection",
            label: "IPL run-rate projection",
            value: projectedSpread,
            evidence: "Projected IPL runs rebuilt from team season run rates instead of a generic T20 baseline",
          },
          {
            key: "stored-pregame-probability",
            label: "Stored pregame probability",
            value: roundPercentTenth(selectedProbability * 100),
            evidence: "Projected line rebuilt from the locked pregame probability snapshot; live/final score was not used",
          },
        ],
      };
    }
  }

  const marketTotal =
    typeof game.overUnder === "number" && Number.isFinite(game.overUnder)
      ? game.overUnder
      : baseline.total;
  const projectedTotal = Math.round(clampNumber(marketTotal, baseline.totalMin, baseline.totalMax) * 10) / 10;
  const probabilityMargin = probabilities.home - probabilities.away;
  const minDirectionalMargin =
    predictedOutcome === "draw" ? 0 : Math.min(profile.meaningfulMarginThreshold, projectedTotal * 0.08);
  let projectedSpread = probabilityMargin * baseline.marginSd;
  if (predictedOutcome === "home") {
    projectedSpread = Math.max(projectedSpread, minDirectionalMargin);
  } else if (predictedOutcome === "away") {
    projectedSpread = Math.min(projectedSpread, -minDirectionalMargin);
  } else {
    projectedSpread = 0;
  }

  const maxSpread = Math.max(0, projectedTotal - baseline.minScore * 2);
  projectedSpread = clampNumber(projectedSpread, -maxSpread, maxSpread);
  const projectedHomeScore = Math.round(((projectedTotal + projectedSpread) / 2) * 10) / 10;
  const projectedAwayScore = Math.round(((projectedTotal - projectedSpread) / 2) * 10) / 10;
  const selectedProbability = probabilityForPick(probabilities, predictedOutcome);
  const volatility = Math.round(clampNumber(baseline.marginSd / Math.max(projectedTotal, 1), 0.05, 0.95) * 1000) / 1000;

  return {
    engine: "stored-pregame-projection-v1",
    iterations: 0,
    homeWinProbability: roundPercentTenth(probabilities.home * 100),
    awayWinProbability: roundPercentTenth(probabilities.away * 100),
    drawProbability:
      probabilities.draw !== undefined
        ? roundPercentTenth(probabilities.draw * 100)
        : undefined,
    projectedHomeScore,
    projectedAwayScore,
    projectedSpread: Math.round((projectedHomeScore - projectedAwayScore) * 10) / 10,
    projectedTotal: Math.round((projectedHomeScore + projectedAwayScore) * 10) / 10,
    volatility,
    upsetRisk: Math.round(clampNumber(1 - selectedProbability, 0.05, 0.49) * 1000) / 1000,
    signals: [
      {
        key: "stored-pregame-probability",
        label: "Stored pregame probability",
        value: roundPercentTenth(selectedProbability * 100),
        evidence: "Projected line rebuilt from the locked pregame probability snapshot; live/final score was not used",
      },
      {
        key: "league-scoring-profile",
        label: "League scoring profile",
        value: projectedTotal,
        evidence: `${game.sport} scoring baseline used when the older stored row did not persist a full projection payload`,
      },
    ],
  };
}

export function buildStoredPregamePrediction(
  game: Game,
  row: StoredPredictionSnapshotRow,
): GamePrediction {
  const probabilities = normalizedStoredProbabilities(row);
  const predictedOutcome =
    row.predictedOutcome === "home" || row.predictedOutcome === "away" || row.predictedOutcome === "draw"
      ? row.predictedOutcome
      : row.predictedWinner === "away"
        ? "away"
        : "home";
  const predictedWinner = row.predictedWinner === "away" ? "away" : "home";
  const modelVersion = row.modelVersion ?? "stored-pregame-snapshot";
  const projection =
    parseStoredProjection(row.projectionJson) ??
    buildProbabilityProjection(game, predictedOutcome, probabilities);
  const analysisSnapshot = row.analysisSnapshot?.trim();

  const prediction: GamePrediction = {
    id: `stored-${row.id}`,
    gameId: row.gameId,
    predictedWinner,
    predictedOutcome,
    confidence: row.confidence,
    analysis: analysisSnapshot || buildStoredPregameAnalysis(game, predictedOutcome, probabilities),
    predictedSpread: projection.projectedSpread,
    predictedTotal: projection.projectedTotal,
    createdAt: row.createdAt.toISOString(),
    homeWinProbability: Math.round(probabilities.home * 1000) / 10,
    awayWinProbability: Math.round(probabilities.away * 1000) / 10,
    drawProbability:
      probabilities.draw !== undefined
        ? Math.round(probabilities.draw * 1000) / 10
        : undefined,
    factors: [],
    edgeRating: row.edgeRating ?? 1,
    valueRating: row.valueRating ?? 1,
    recentFormHome: "",
    recentFormAway: "",
    homeStreak: 0,
    awayStreak: 0,
    isTossUp: row.isTossUp,
    modelVersion,
    snapshotType: "stored-pregame",
    wasCorrect: row.wasCorrect,
    actualOutcome:
      row.actualOutcome === "home" ||
      row.actualOutcome === "away" ||
      row.actualOutcome === "draw" ||
      row.actualOutcome === "unavailable"
        ? row.actualOutcome
        : null,
    projection,
  };

  const storedCanonical = parseStoredCanonicalResult(row.canonicalResultJson);
  const storedWarning = projection.engine === "stored-pregame-projection-v1"
    ? "Stored pregame prediction snapshot; projection rebuilt from stored probabilities, not recomputed after start."
    : "Stored pregame prediction snapshot; not recomputed after final.";

  return {
    ...prediction,
    canonicalResult: storedCanonical
      ? withStoredSnapshotWarning(storedCanonical, storedWarning)
      : canonicalFromLegacyPrediction(prediction, game.sport, {
          timestamp: row.createdAt.toISOString(),
          dataVersion: modelVersion,
          warning: storedWarning,
        }),
  };
}

async function loadStoredPregamePredictionMap(games: Game[]): Promise<Map<string, GamePrediction>> {
  const lockedGames = games.filter((game) => game.status === "LIVE" || isFinalGame(game));
  if (lockedGames.length === 0) return new Map();

  const gameById = new Map(lockedGames.map((game) => [game.id, game]));
  const rows = await prisma.predictionResult.findMany({
    where: {
      gameId: { in: lockedGames.map((game) => game.id) },
    },
  });

  const predictions = new Map<string, GamePrediction>();
  for (const row of rows) {
    const game = gameById.get(row.gameId);
    if (!game) continue;
    if (!storedPredictionRowMatchesGame(game, row)) continue;
    predictions.set(row.gameId, buildStoredPregamePrediction(game, row));
  }
  return predictions;
}

async function getStoredPregamePrediction(game: Game): Promise<GamePrediction | null> {
  if (game.status !== "LIVE" && !isFinalGame(game)) return null;
  const map = await loadStoredPregamePredictionMap([game]);
  return map.get(game.id) ?? null;
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
 * For LIVE games, keep using the pregame model call. Live score should update
 * the scoreboard, not rewrite the betting-facing prediction every time the
 * score moves.
 *
 * Every place that reads cached predictions (transformESPNEvent, the list
 * endpoint, the detail endpoint, etc.) MUST go through this helper. Any
 * place that reads the caches directly will create card↔detail-page
 * inconsistencies (the badge and the detail screen disagreeing on who's
 * favored), which is exactly the bug this helper exists to prevent.
 */
function pickFreshestPrediction(gameId: string, isLive: boolean): GamePrediction | null {
  return getCachedPrediction(gameId, { allowExpired: isLive });
}

function canonicalInputsMatchGame(game: Game, prediction: GamePrediction): boolean {
  const inputs = prediction.canonicalResult?.modelInputs;
  if (!inputs) return true;
  if (inputs.homeTeamId && inputs.homeTeamId !== game.homeTeam.id) return false;
  if (inputs.awayTeamId && inputs.awayTeamId !== game.awayTeam.id) return false;
  return true;
}

function predictionMatchesGame(game: Game, prediction: GamePrediction): boolean {
  if (prediction.gameId && prediction.gameId !== game.id) return false;
  if (prediction.canonicalResult?.eventId && prediction.canonicalResult.eventId !== game.id) return false;
  return canonicalInputsMatchGame(game, prediction);
}

function pickFreshestPredictionForGame(game: Game): GamePrediction | null {
  const prediction = pickFreshestPrediction(game.id, game.status === "LIVE");
  if (!prediction) return null;
  return predictionMatchesGame(game, prediction) ? prediction : null;
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

function legacyProbabilitiesForCanonical(prediction: GamePrediction) {
  const includeDraw =
    prediction.predictedOutcome === "draw" ||
    typeof prediction.drawProbability === "number" ||
    prediction.canonicalResult?.marketType === "three_way_result";
  return normalizeCanonicalProbabilities({
    home: (prediction.homeWinProbability ?? 50) / 100,
    away: (prediction.awayWinProbability ?? 50) / 100,
    draw: includeDraw ? (prediction.drawProbability ?? 0) / 100 : undefined,
  });
}

function canonicalSignalValue(pick: "home" | "away" | "draw" | "none"): number {
  if (pick === "home") return 1;
  if (pick === "away") return -1;
  return 0;
}

function alignProjectionToCanonical(
  prediction: GamePrediction,
  signal: {
    key: string;
    label: string;
    evidence: string;
  },
): GamePrediction["projection"] {
  if (!prediction.projection) return undefined;

  const canonicalProbabilities = legacyProbabilitiesForCanonical(prediction);
  const pick = canonicalPickFromProbabilities(canonicalProbabilities);
  const nextSignal = {
    key: signal.key,
    label: signal.label,
    value: canonicalSignalValue(pick),
    evidence: signal.evidence,
  };

  return {
    ...prediction.projection,
    homeWinProbability: roundPercentTenth(canonicalProbabilities.home * 100),
    awayWinProbability: roundPercentTenth(canonicalProbabilities.away * 100),
    drawProbability:
      canonicalProbabilities.draw !== undefined
        ? roundPercentTenth(canonicalProbabilities.draw * 100)
        : undefined,
    signals: [
      nextSignal,
      ...prediction.projection.signals.filter((s) => s.key !== signal.key && s.key !== "engine-consensus"),
    ].slice(0, 5),
  };
}

function withCanonicalPredictionResult(
  prediction: GamePrediction,
  sport: string,
  opts: {
    liveEngineRead?: CanonicalEngineRead;
    warning?: string;
    projectionSignal?: {
      key: string;
      label: string;
      evidence: string;
    };
  } = {},
): GamePrediction {
  const projection = alignProjectionToCanonical(
    prediction,
    opts.projectionSignal ?? {
      key: "canonical-consensus",
      label: "Canonical consensus",
      evidence: "Prediction, projection, and display cards consume the same canonical final answer",
    },
  );
  const next = { ...prediction, projection };
  return {
    ...next,
    canonicalResult: canonicalFromLegacyPrediction(next, sport, {
      timestamp: new Date().toISOString(),
      liveEngineRead: opts.liveEngineRead,
      warning: opts.warning,
    }),
  };
}

/**
 * Force the legacy mirror fields (predictedWinner/predictedOutcome/confidence/
 * win probabilities/isTossUp) to equal the canonical result, so EVERY surface —
 * prediction card, AI pick badge, projection lean, projected score line, and
 * narration — shows the same winner. canonicalResult.finalPick is the single
 * source of truth. Without this, self-learning (which recomputes finalPick but
 * kept the stale predictedWinner) and other paths could ship mirror fields that
 * disagree with the canonical pick.
 */
function reconcileLegacyFieldsToCanonical(prediction: GamePrediction): GamePrediction {
  const canonical = prediction.canonicalResult;
  if (!canonical) return prediction;
  const probs = canonical.probabilities;
  const homePct = Math.round((probs.home ?? 0) * 100);
  const awayPct = Math.round((probs.away ?? 0) * 100);
  const drawPct = probs.draw !== undefined ? Math.round(probs.draw * 100) : undefined;
  const leader: "home" | "away" = homePct >= awayPct ? "home" : "away";
  const predictedWinner: "home" | "away" =
    canonical.finalPick === "home" || canonical.finalPick === "away" ? canonical.finalPick : leader;
  const predictedOutcome: "home" | "away" | "draw" =
    canonical.finalPick === "draw"
      ? "draw"
      : canonical.finalPick === "home" || canonical.finalPick === "away"
        ? canonical.finalPick
        : drawPct !== undefined && drawPct >= homePct && drawPct >= awayPct
          ? "draw"
          : leader;
  return {
    ...prediction,
    predictedWinner,
    predictedOutcome,
    confidence: Math.round(canonical.confidence),
    homeWinProbability: homePct,
    awayWinProbability: awayPct,
    drawProbability: drawPct,
    isTossUp: isMarketAwareTossUp(canonical),
  };
}

function ensureCanonicalPredictionResult(game: Game, prediction: GamePrediction): GamePrediction {
  if (prediction.canonicalResult) return reconcileLegacyFieldsToCanonical(prediction);
  return withCanonicalPredictionResult(prediction, game.sport);
}

function buildLiveEngineRead(args: {
  live: LiveGameData;
  sport: string;
  gameProgress: number;
  probabilities: ReturnType<typeof legacyProbabilitiesForCanonical>;
  liveHomeWinProb: number;
  liveAwayWinProb: number;
}): CanonicalEngineRead {
  const pick = canonicalPickFromProbabilities(args.probabilities);
  const probability = probabilityForPick(args.probabilities, pick);
  return {
    engine: "live-score-v1",
    pick,
    probability,
    confidence: roundPercentTenth(probability * 100),
    probabilities: args.probabilities,
    weight: args.gameProgress,
    inputs: {
      sport: args.sport,
      homeScore: args.live.currentHomeScore,
      awayScore: args.live.currentAwayScore,
      period: args.live.period,
      elapsedShare: Math.round(args.gameProgress * 1000) / 1000,
      liveHomeWinProb: Math.round(args.liveHomeWinProb * 1000) / 1000,
      liveAwayWinProb: Math.round(args.liveAwayWinProb * 1000) / 1000,
    },
  };
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
 * Keep the betting-facing prediction stable once the game is live.
 *
 * The model answer is the pregame simulation/projection result. Live score
 * movement belongs in the scoreboard surface; it should not cause the app to
 * flip the pick or confidence as a team trails/leads in-game.
 */
export function updateLivePrediction(
  pregame: GamePrediction,
  _live: LiveGameData,
  _sport: string
): GamePrediction {
  return pregame;
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

async function annotateMarketComparison(game: Game, prediction: GamePrediction): Promise<void> {
  // New-engine predictions already carry the exact market snapshot used by
  // the engine in translateNewEnginePrediction. Do not re-fetch here and risk
  // showing a comparison that was not part of the canonical decision.
  if (prediction.marketComparison || prediction.canonicalResult) return;

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

type PredictionOutcome = "home" | "away" | "draw";

const MATERIAL_PREDICTION_PROBABILITY_MOVE_PP = 3;
const MATERIAL_CONFIDENCE_MOVE_PP = 4;
const MATERIAL_PICK_FLIP_LEAD_PP = 5;
const MATERIAL_MARKET_DIVERGENCE_MOVE_PP = 7;

function predictionOutcome(prediction: GamePrediction): PredictionOutcome {
  const canonicalPick = prediction.canonicalResult?.finalPick;
  if (canonicalPick === "home" || canonicalPick === "away" || canonicalPick === "draw") {
    return canonicalPick;
  }
  if (prediction.predictedOutcome === "draw") return "draw";
  return prediction.predictedWinner;
}

function predictionOutcomeLead(prediction: GamePrediction): number {
  const values = [
    prediction.homeWinProbability ?? 0,
    prediction.awayWinProbability ?? 0,
  ];
  if (prediction.drawProbability !== undefined || prediction.predictedOutcome === "draw") {
    values.push(prediction.drawProbability ?? 0);
  }
  const sorted = values.sort((a, b) => b - a);
  return (sorted[0] ?? 0) - (sorted[1] ?? 0);
}

function maxProbabilityMove(previous: GamePrediction, candidate: GamePrediction): number {
  return Math.max(
    Math.abs((candidate.homeWinProbability ?? 0) - (previous.homeWinProbability ?? 0)),
    Math.abs((candidate.awayWinProbability ?? 0) - (previous.awayWinProbability ?? 0)),
    Math.abs((candidate.drawProbability ?? 0) - (previous.drawProbability ?? 0)),
  );
}

function projectionProbabilityMove(previous: GamePrediction, candidate: GamePrediction): number {
  if (!previous.projection || !candidate.projection) return 0;
  return Math.max(
    Math.abs(candidate.projection.homeWinProbability - previous.projection.homeWinProbability),
    Math.abs(candidate.projection.awayWinProbability - previous.projection.awayWinProbability),
    Math.abs((candidate.projection.drawProbability ?? 0) - (previous.projection.drawProbability ?? 0)),
  );
}

function projectionSpreadMoveThreshold(sport: string): number {
  if (sport === "NBA" || sport === "NCAAB") return 2.5;
  if (sport === "NFL" || sport === "NCAAF") return 1.5;
  if (sport === "IPL") return 8;
  if (sport === "MLB" || sport === "NHL" || sport === "MLS" || sport === "EPL" || sport === "UCL") return 0.5;
  if (sport === "TENNIS") return 0.25;
  return 1;
}

function projectionTotalMoveThreshold(sport: string): number {
  if (sport === "NBA" || sport === "NCAAB") return 4;
  if (sport === "NFL" || sport === "NCAAF") return 3;
  if (sport === "IPL") return 15;
  if (sport === "MLB") return 1;
  if (sport === "NHL" || sport === "MLS" || sport === "EPL" || sport === "UCL") return 0.75;
  if (sport === "TENNIS") return 0.25;
  return 2;
}

function projectionMovedMaterially(game: Game, previous: GamePrediction, candidate: GamePrediction): boolean {
  if (!previous.projection || !candidate.projection) return Boolean(candidate.projection && !previous.projection);
  return (
    projectionProbabilityMove(previous, candidate) >= MATERIAL_PREDICTION_PROBABILITY_MOVE_PP ||
    Math.abs(candidate.projection.projectedSpread - previous.projection.projectedSpread) >=
      projectionSpreadMoveThreshold(game.sport) ||
    Math.abs(candidate.projection.projectedTotal - previous.projection.projectedTotal) >=
      projectionTotalMoveThreshold(game.sport)
  );
}

function marketMovedMaterially(previous: GamePrediction, candidate: GamePrediction): boolean {
  if (!candidate.marketComparison) return false;
  if (!previous.marketComparison) return candidate.marketComparison.isDivergent;
  if (candidate.marketComparison.isDivergent !== previous.marketComparison.isDivergent) return true;
  return (
    Math.abs(candidate.marketComparison.divergence - previous.marketComparison.divergence) * 100 >=
    MATERIAL_MARKET_DIVERGENCE_MOVE_PP
  );
}

/**
 * Bettor-safe update gate.
 *
 * A fresh model run is allowed to replace the visible prediction only when the
 * output moved enough to matter. That lets new injury/lineup/market information
 * through, while suppressing tiny simulation/cache jitter that makes users feel
 * like the app is chasing noise.
 */
export function shouldPromotePredictionUpdate(
  game: Game,
  previous: GamePrediction | null,
  candidate: GamePrediction,
): boolean {
  if (game.status !== "SCHEDULED") return false;
  if (!previous) return true;

  const previousOutcome = predictionOutcome(previous);
  const candidateOutcome = predictionOutcome(candidate);
  if (candidateOutcome !== previousOutcome) {
    return predictionOutcomeLead(candidate) >= MATERIAL_PICK_FLIP_LEAD_PP;
  }

  return (
    maxProbabilityMove(previous, candidate) >= MATERIAL_PREDICTION_PROBABILITY_MOVE_PP ||
    Math.abs(candidate.confidence - previous.confidence) >= MATERIAL_CONFIDENCE_MOVE_PP ||
    projectionMovedMaterially(game, previous, candidate) ||
    marketMovedMaterially(previous, candidate)
  );
}

function choosePredictionUpdate(
  game: Game,
  previous: GamePrediction | null,
  candidate: GamePrediction,
): GamePrediction {
  if (shouldPromotePredictionUpdate(game, previous, candidate)) return candidate;
  return sanitizePredictionForGame(game, ensureCanonicalPredictionResult(game, previous!));
}

// Generate prediction for an ESPN game. The prediction remains the stable
// model/simulation call even when the game is in progress.
async function addPredictionToGame(game: Game): Promise<Game> {
  const cachedPrediction = pickFreshestPredictionForGame(game);
  if (cachedPrediction) {
    return attachPredictionToGame(game, cachedPrediction);
  }

  const storedPregamePrediction = await getStoredPregamePrediction(game);
  if (storedPregamePrediction) {
    return attachPredictionToGame(game, storedPregamePrediction);
  }

  if (game.status !== "SCHEDULED") {
    return game;
  }

  try {
    const newPrediction = await runNewEnginePrediction(game);
    await annotateMarketComparison(game, newPrediction);

    const candidatePrediction = sanitizePredictionForGame(game, newPrediction);
    const previousPredictionRaw = getCachedPrediction(game.id, { allowExpired: true });
    const previousPrediction =
      previousPredictionRaw && predictionMatchesGame(game, previousPredictionRaw)
        ? previousPredictionRaw
        : null;
    const displayPrediction = choosePredictionUpdate(game, previousPrediction, candidatePrediction);
    setCachedPrediction(game.id, displayPrediction);

    return attachPredictionToGame(game, displayPrediction);
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
  const gamesNeedingPredictions = games.filter(g => !g.prediction && g.status === "SCHEDULED");
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
  const name = [
    status.type.name,
    status.type.description,
    status.type.detail,
    status.type.shortDetail,
    status.summary,
  ].filter(Boolean).join(" ").toLowerCase();
  if (name.includes("postponed")) return "POSTPONED";
  if (name.includes("canceled") || name.includes("cancelled")) return "CANCELLED";
  if (isSuspendedStatusText(name)) return "LIVE";
  if (state === "in") return "LIVE";
  if (state === "post" || status.type.completed) return "FINAL";
  return "SCHEDULED";
}

function isSuspendedStatusText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("suspended") ||
    normalized.includes("interrupted") ||
    normalized.includes("weather delay") ||
    normalized.includes("rain delay") ||
    normalized.includes("lightning delay") ||
    normalized.includes("delayed")
  );
}

function parseResumeAnnouncement(text: string): string {
  const match = text.match(/\b(?:resume|resumes|restart|restarts|play|scheduled|start)\b[^0-9]{0,40}(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?(?:\s*[A-Z]{2,4})?)/i);
  return match?.[1] ? `Est. ${match[1].trim()}` : "No time announced";
}

function parseSuspensionReason(text: string): string {
  const normalized = text.toLowerCase();
  if (/\blightning\b/.test(normalized)) return "Lightning delay";
  if (/\brain\b|\brained\b/.test(normalized)) return "Rain delay";
  if (/\bweather\b/.test(normalized)) return "Weather delay";
  if (/\bbad light\b/.test(normalized)) return "Bad light";
  if (/\bdarkness\b/.test(normalized)) return "Darkness";
  if (/\bcourt\b/.test(normalized) && /\bcondition/.test(normalized)) return "Court conditions";
  if (/\bmedical\b/.test(normalized)) return "Medical delay";
  return "Reason not reported";
}

function getSuspensionInfoFromESPN(status: ESPNStatus): Game["suspension"] | undefined {
  const text = [
    status.type.shortDetail,
    status.type.detail,
    status.type.description,
    status.type.name,
    status.summary,
  ].filter(Boolean).join(" ");
  if (!isSuspendedStatusText(text)) return undefined;
  return {
    display: "Suspended",
    resumeText: parseResumeAnnouncement(text),
    reasonText: parseSuspensionReason(text),
    source: "espn",
  };
}

function getPeriodDisplay(status: ESPNStatus, sport: SportKey): string | undefined {
  const suspension = getSuspensionInfoFromESPN(status);
  if (suspension) return suspension.display;
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

type ParsedCricketScore = {
  runs?: number;
  wickets?: number;
  overs?: number;
  maxOvers?: number;
  target?: number;
};

function parseCricketScoreText(raw: string | undefined): ParsedCricketScore {
  if (!raw) return {};
  const result: ParsedCricketScore = {};

  const scoreMatch = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (scoreMatch) {
    const runs = Number(scoreMatch[1]);
    const wickets = Number(scoreMatch[2]);
    if (Number.isFinite(runs)) result.runs = runs;
    if (Number.isFinite(wickets)) result.wickets = wickets;
  } else {
    const runs = Number.parseInt(raw, 10);
    if (Number.isFinite(runs)) result.runs = runs;
  }

  const oversMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*ov/i);
  if (oversMatch) {
    const overs = Number(oversMatch[1]);
    const maxOvers = oversMatch[2] !== undefined ? Number(oversMatch[2]) : undefined;
    if (Number.isFinite(overs)) result.overs = overs;
    if (maxOvers !== undefined && Number.isFinite(maxOvers)) result.maxOvers = maxOvers;
  }

  const targetMatch = raw.match(/target\s+(\d+)/i);
  if (targetMatch) {
    const target = Number(targetMatch[1]);
    if (Number.isFinite(target)) result.target = target;
  }

  return result;
}

function formatCricketNumber(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function cricketBool(value: boolean | number | undefined): boolean {
  return value === true || value === 1;
}

function extractCricketInnings(competitor: ESPNCompetitor): CricketInningsScore | undefined {
  const parsed = parseCricketScoreText(competitor.score);
  const lines = competitor.linescores ?? [];
  const currentBattingLine = lines.find((ls) => cricketBool(ls.isCurrent) && cricketBool(ls.isBatting));
  const activeBattingLine = currentBattingLine ?? lines.find((ls) =>
    cricketBool(ls.isBatting) && !/complete/i.test(ls.description ?? "")
  );
  const matchingScoreLine = lines.find((ls) =>
    typeof parsed.runs === "number" &&
    ls.runs === parsed.runs &&
    (typeof parsed.wickets !== "number" || ls.wickets === parsed.wickets)
  );
  const line =
    activeBattingLine ??
    matchingScoreLine ??
    [...lines].reverse().find((ls) =>
      typeof ls.runs === "number" ||
      typeof ls.wickets === "number" ||
      typeof ls.overs === "number" ||
      typeof ls.value === "number" ||
      typeof ls.displayValue === "string",
    );

  const runs =
    typeof line?.runs === "number" ? line.runs :
    typeof line?.value === "number" ? line.value :
    parsed.runs;
  const wickets = typeof line?.wickets === "number" ? line.wickets : parsed.wickets;
  const overs = typeof line?.overs === "number" ? line.overs : parsed.overs;
  const maxOvers = typeof line?.maxOvers === "number" ? line.maxOvers : parsed.maxOvers;

  if (runs === undefined && wickets === undefined && overs === undefined && !competitor.score) {
    return undefined;
  }

  const scoreText =
    runs !== undefined && wickets !== undefined
      ? `${runs}/${wickets}`
      : competitor.score?.split("(")[0]?.trim() || (runs !== undefined ? String(runs) : "0");
  const oversText = formatCricketNumber(overs);
  const maxOversText = formatCricketNumber(maxOvers);

  return {
    runs,
    wickets,
    overs,
    maxOvers,
    isBatting: Boolean(activeBattingLine),
    description: line?.description,
    scoreText,
    detailText: oversText ? `${oversText}${maxOversText ? `/${maxOversText}` : ""} ov` : undefined,
  };
}

export function buildCricketScoreState(
  home: ESPNCompetitor,
  away: ESPNCompetitor,
  status: ESPNStatus,
): CricketScoreState | undefined {
  const homeInnings = extractCricketInnings(home);
  const awayInnings = extractCricketInnings(away);
  if (!homeInnings && !awayInnings) return undefined;

  const parsedTarget = parseCricketScoreText(`${home.score ?? ""} ${away.score ?? ""}`).target;
  const battingSide =
    homeInnings?.isBatting ? "home" :
    awayInnings?.isBatting ? "away" :
    undefined;
  const summary = [
    status.summary,
    status.type.shortDetail,
    status.type.detail,
  ].find((text) => text && text.trim().length > 0)?.trim();

  return {
    home: homeInnings,
    away: awayInnings,
    battingSide,
    innings: status.period ?? null,
    summary,
    target: parsedTarget,
  };
}

function cricketStatusLine(
  cricketState: CricketScoreState | undefined,
  homeAbbr: string,
  awayAbbr: string,
): string | undefined {
  if (!cricketState?.battingSide) return undefined;
  const innings = cricketState[cricketState.battingSide];
  if (!innings) return undefined;
  const abbr = cricketState.battingSide === "home" ? homeAbbr : awayAbbr;
  return [abbr, innings.scoreText, innings.detailText].filter(Boolean).join(" ");
}

export function extractESPNLinescores(
  competitor: { linescores?: Array<{ value?: number; runs?: number }> },
  sport: SportKey,
): number[] | undefined {
  if (!competitor.linescores || competitor.linescores.length === 0) return undefined;
  return competitor.linescores.map((line) => (
    sport === "IPL" && typeof line.runs === "number" ? line.runs :
    typeof line.value === "number" ? line.value :
    typeof line.runs === "number" ? line.runs :
    0
  ));
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
  const iplStandings = sport === "IPL" ? await fetchIPLStandings() : null;

  const getStanding = (competitor: ESPNCompetitor): IPLStandingEntry | undefined => {
    if (sport !== "IPL") return undefined;
    const teamId = competitor.team.id.toUpperCase();
    const abbr = competitor.team.abbreviation.toUpperCase();
    return iplStandings?.get(teamId) ?? iplStandings?.get(abbr);
  };

  const getRecord = (competitor: ESPNCompetitor): string => {
    const overallRecord = competitor.records?.find(
      (r) => r.type === "total" || r.type === "overall"
    );
    const feedRecord = overallRecord?.summary?.trim();
    if (feedRecord) return feedRecord;
    if (sport === "IPL") {
      return getStanding(competitor)?.record ?? "0-0";
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
  const suspension = getSuspensionInfoFromESPN(competition.status);
  const rawQuarter = getPeriodDisplay(competition.status, sport);
  const clock = gameStatus === "LIVE"
    ? suspension?.resumeText ?? competition.status.displayClock
    : undefined;
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
  const cricketState = sport === "IPL"
    ? buildCricketScoreState(homeCompetitor, awayCompetitor, competition.status)
    : undefined;
  const cricketHomeScore = cricketState?.home?.runs;
  const cricketAwayScore = cricketState?.away?.runs;
  const cricketClock = sport === "IPL"
    ? (cricketState?.battingSide ? cricketState[cricketState.battingSide]?.detailText : undefined)
    : undefined;
  const cricketQuarter = sport === "IPL"
    ? cricketStatusLine(cricketState, homeTeam.abbreviation, awayTeam.abbreviation) ?? rawQuarter
    : undefined;

  const homeLinescores = extractESPNLinescores(homeCompetitor, sport);
  const awayLinescores = extractESPNLinescores(awayCompetitor, sport);

  const liveState = parseMlbLiveState({
    sport,
    status: gameStatus,
    competition,
    homeAbbr: homeTeam.abbreviation,
    awayAbbr: awayTeam.abbreviation,
    gameId: event.id,
  });
  const quarter = sport === "MLB"
    ? getMlbPeriodDisplay(liveState) ?? rawQuarter
    : sport === "IPL"
      ? cricketQuarter
      : rawQuarter;
  const normalizeTeamColor = (color: string | undefined): string =>
    color ? (color.startsWith("#") ? color : `#${color}`) : "#333333";
  const homeStanding = getStanding(homeCompetitor);
  const awayStanding = getStanding(awayCompetitor);

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
      standingsRank: homeStanding?.rank ?? undefined,
      standingsPoints: homeStanding?.matchPoints ?? undefined,
      netRunRate: homeStanding?.netRunRate ?? undefined,
      runRateFor: homeStanding?.runRateFor ?? undefined,
      runRateAgainst: homeStanding?.runRateAgainst ?? undefined,
      matchesPlayed: homeStanding?.matchesPlayed ?? undefined,
    },
    awayTeam: {
      id: awayTeam.id,
      name: awayTeam.displayName || awayTeam.name,
      abbreviation: awayTeam.abbreviation,
      city: awayTeam.shortDisplayName || awayTeam.name.split(" ")[0] || "",
      record: getRecord(awayCompetitor),
      color: normalizeTeamColor(awayTeam.color),
      logo: getTeamLogo(awayTeam),
      standingsRank: awayStanding?.rank ?? undefined,
      standingsPoints: awayStanding?.matchPoints ?? undefined,
      netRunRate: awayStanding?.netRunRate ?? undefined,
      runRateFor: awayStanding?.runRateFor ?? undefined,
      runRateAgainst: awayStanding?.runRateAgainst ?? undefined,
      matchesPlayed: awayStanding?.matchesPlayed ?? undefined,
    },
    gameTime: event.date,
    status: gameStatus,
    venue: competition.venue?.fullName || "TBD",
    tvChannel,
    watchSources,
    homeScore: cricketHomeScore !== undefined ? cricketHomeScore : homeScore !== undefined && !isNaN(homeScore) ? homeScore : undefined,
    awayScore: cricketAwayScore !== undefined ? cricketAwayScore : awayScore !== undefined && !isNaN(awayScore) ? awayScore : undefined,
    homeScoreDisplay: cricketState?.home?.scoreText,
    awayScoreDisplay: cricketState?.away?.scoreText,
    spread,
    overUnder,
    marketFavorite,
    quarter,
    clock: sport === "IPL" ? cricketClock ?? clock : clock,
    statusLabel: suspension?.display,
    statusDetail: sport === "IPL" ? cricketState?.summary ?? suspension?.resumeText : suspension?.resumeText,
    suspension,
    seasonContext,
    homeLinescores,
    awayLinescores,
    cricketState,
    liveState,
  };

  // Attach freshest cached prediction if available, don't block on generating
  // new ones. Live games still use the stable pregame model call.
  const cachedPrediction = pickFreshestPredictionForGame(game);
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
  BRA: "#009C3B",
  BUL: "#00966E",
  CAN: "#D52B1E",
  CHI: "#D52B1E",
  CHN: "#DE2910",
  COL: "#FCD116",
  CRO: "#171796",
  CZE: "#11457E",
  DEN: "#C60C30",
  EGY: "#CE1126",
  ESP: "#AA151B",
  FIN: "#002F6C",
  FRA: "#0055A4",
  GBR: "#012169",
  GER: "#000000",
  GRE: "#0D5EAF",
  HKG: "#DE2910",
  IND: "#FF9933",
  ITA: "#008C45",
  JPN: "#BC002D",
  KAZ: "#00AFCA",
  KOR: "#1F4E9E",
  NED: "#FF4F00",
  NZL: "#00247D",
  NOR: "#BA0C2F",
  POL: "#DC143C",
  POR: "#D00000",
  ROM: "#002B7F",
  RUS: "#0033A0",
  RSA: "#007A4D",
  SRB: "#0C4076",
  SLO: "#005DA4",
  SUI: "#D52B1E",
  SWE: "#006AA7",
  THA: "#2D2A4A",
  TPE: "#000095",
  UKR: "#0057B7",
  USA: "#1D4ED8",
};

const TENNIS_PLAYER_COLOR_PALETTE = [
  "#7A9DB8", // Clutch teal
  "#8B0A1F", // Clutch maroon
  "#2563EB",
  "#D97706",
  "#9333EA",
  "#DC2626",
  "#0891B2",
  "#E11D48",
  "#4F46E5",
  "#B45309",
  "#BE185D",
  "#0F766E",
];

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function tennisDisplayColor(
  seed: string,
  opts: { country?: string; tour?: TennisTour; side?: "home" | "away"; offset?: number } = {},
): string {
  const country = opts.country?.toUpperCase();
  if (country && TENNIS_COUNTRY_COLORS[country]) return TENNIS_COUNTRY_COLORS[country];

  const hashSeed = [
    seed.trim().toLowerCase() || "tennis",
    opts.tour ?? "TENNIS",
    opts.side ?? "player",
  ].join("|");
  const index = (stableHash(hashSeed) + (opts.offset ?? 0)) % TENNIS_PLAYER_COLOR_PALETTE.length;
  return TENNIS_PLAYER_COLOR_PALETTE[index]!;
}

function sameHexColor(a: string | undefined, b: string | undefined): boolean {
  return a?.toLowerCase() === b?.toLowerCase();
}

function ensureDistinctTennisColors(homeTeam: GameTeam, awayTeam: GameTeam): { homeTeam: GameTeam; awayTeam: GameTeam } {
  if (!sameHexColor(homeTeam.color, awayTeam.color)) return { homeTeam, awayTeam };

  return {
    homeTeam,
    awayTeam: {
      ...awayTeam,
      color: tennisDisplayColor(`${awayTeam.id}-${awayTeam.name}`, {
        tour: awayTeam.tour,
        side: "away",
        offset: 5,
      }),
    },
  };
}

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
  if (text.includes("postponed")) return "POSTPONED";
  if (text.includes("canceled") || text.includes("cancelled")) return "CANCELLED";
  if (isSuspendedStatusText(text)) return "LIVE";
  if (state === "in") return "LIVE";
  if (state === "post" || status?.completed) return "FINAL";
  return "SCHEDULED";
}

function getSuspensionInfoFromTennis(status?: TennisStatus): Game["suspension"] | undefined {
  const text = [status?.description, status?.detail].filter(Boolean).join(" ");
  if (!isSuspendedStatusText(text)) return undefined;
  return {
    display: "Suspended",
    resumeText: parseResumeAnnouncement(text),
    reasonText: parseSuspensionReason(text),
    source: "espn",
  };
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

function tennisTeamFromCompetitor(
  competitor: TennisCompetitor,
  isDoubles: boolean,
  rankings: Map<string, TennisRankingEntry>,
): GameTeam {
  const name = tennisCompetitorName(competitor, isDoubles);
  const logo = tennisCompetitorLogo(competitor);
  const country = countryCodeFromLogo(logo);
  const athleteId = extractTennisAthleteId(competitor.id) ?? extractTennisAthleteId(competitor.uid);
  const ranking = !isDoubles && athleteId ? rankings.get(athleteId) : undefined;
  const seed = typeof competitor.rnk === "number" ? competitor.rnk : undefined;
  const rank = ranking?.rank;
  const colorSeed = [athleteId, competitor.uid, competitor.id, name].filter(Boolean).join("|");
  return {
    id: athleteId ?? competitor.uid ?? competitor.id ?? name,
    name,
    abbreviation: tennisAbbreviation(name, competitor.rstr),
    city: name,
    record: rank ? `${ranking.tour} Rank #${rank}` : seed ? `Seed #${seed}` : isDoubles ? "Doubles" : "Singles",
    color: tennisDisplayColor(colorSeed, { country, tour: ranking?.tour }),
    logo,
    rank,
    seed,
    rankingPoints: ranking?.points,
    tour: ranking?.tour,
    tennisRankSource: ranking ? "espn-rankings" : undefined,
  };
}

function tennisTeamFromExplorer(match: TennisExplorerLiveMatch, side: "home" | "away"): GameTeam {
  const isHome = side === "home";
  const name = isHome ? match.homeName : match.awayName;
  const rank = isHome ? match.homeRank : match.awayRank;
  const seed = isHome ? match.homeSeed : match.awaySeed;
  return {
    id: `${match.id}-${side}`,
    name,
    abbreviation: isHome ? match.homeAbbreviation : match.awayAbbreviation,
    city: name,
    record: rank ? `${match.tour} Rank #${rank}` : seed ? `Seed #${seed}` : "Singles",
    color: tennisDisplayColor(`${match.id}-${name}`, { tour: match.tour, side }),
    rank,
    seed,
    tour: match.tour,
  };
}

function transformTennisExplorerMatch(match: TennisExplorerLiveMatch): Game {
  const teams = ensureDistinctTennisColors(
    tennisTeamFromExplorer(match, "home"),
    tennisTeamFromExplorer(match, "away"),
  );
  const game: Game = {
    id: match.id,
    sport: "TENNIS",
    source: "tennis-explorer",
    homeTeam: teams.homeTeam,
    awayTeam: teams.awayTeam,
    gameTime: match.gameTime,
    status: match.status,
    venue: match.venue,
    homeScore: match.status === "LIVE" ? match.homeSets : undefined,
    awayScore: match.status === "LIVE" ? match.awaySets : undefined,
    quarter: match.status === "LIVE" ? match.quarter : undefined,
    clock: match.status === "LIVE" ? match.clock : undefined,
    statusLabel: match.status === "LIVE" ? match.suspension?.display : undefined,
    statusDetail: match.status === "LIVE" ? match.suspension?.resumeText : undefined,
    suspension: match.status === "LIVE" ? match.suspension : undefined,
    seasonContext: deriveSeasonContext({
      sport: "TENNIS",
      gameTime: match.gameTime,
      eventName: match.venue,
      competitionNotes: [match.quarter].filter(Boolean),
    }),
    homeLinescores: match.homeLinescores,
    awayLinescores: match.awayLinescores,
  };
  const cachedPrediction = pickFreshestPredictionForGame(game);
  return cachedPrediction ? attachPredictionToGame(game, cachedPrediction) : game;
}

function tennisGameSignature(game: Game): string {
  const names = [game.homeTeam.name, game.awayTeam.name]
    .map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).sort().join(" "))
    .sort();
  return names.join("|");
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
  rankings: Map<string, TennisRankingEntry>,
): Game | null {
  const competitors = competition.competitors ?? [];
  const homeCompetitor = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
  const awayCompetitor = competitors.find((c) => c.homeAway === "away") ?? competitors.find((c) => c !== homeCompetitor);
  if (!competition.id || !competition.date || !homeCompetitor || !awayCompetitor) return null;

  const gameStatus = mapTennisStatus(competition.status);
  const suspension = getSuspensionInfoFromTennis(competition.status);
  const tennisTeams = ensureDistinctTennisColors(
    tennisTeamFromCompetitor(homeCompetitor, competition.dbls === true, rankings),
    tennisTeamFromCompetitor(awayCompetitor, competition.dbls === true, rankings),
  );
  const homeTeam = tennisTeams.homeTeam;
  const awayTeam = tennisTeams.awayTeam;
  const homeLinescores = tennisSetScores(homeCompetitor);
  const awayLinescores = tennisSetScores(awayCompetitor);
  const hasSetScores = Boolean(homeLinescores?.length || awayLinescores?.length || gameStatus === "LIVE" || gameStatus === "FINAL");
  const homeScore = hasSetScores ? tennisSetsWon(homeCompetitor, awayCompetitor) : undefined;
  const awayScore = hasSetScores ? tennisSetsWon(awayCompetitor, homeCompetitor) : undefined;
  const statusDetail = competition.status?.detail || competition.status?.description;
  const quarter = gameStatus === "LIVE"
    ? suspension?.display ?? statusDetail
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
    clock: gameStatus === "LIVE" ? suspension?.resumeText ?? statusDetail : undefined,
    statusLabel: suspension?.display,
    statusDetail: suspension?.resumeText,
    suspension,
    seasonContext: deriveSeasonContext({
      sport: "TENNIS",
      gameTime: competition.date,
      eventName: venue,
      competitionNotes: [competition.note, meta?.grouping].filter(Boolean) as string[],
    }),
    homeLinescores,
    awayLinescores,
  };

  const cachedPrediction = pickFreshestPredictionForGame(game);
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
    const rankings = await fetchTennisRankings().catch(() => new Map<string, TennisRankingEntry>());
    const tournamentIndex = buildTennisTournamentIndex(scoreboard);
    const espnGames = Object.values(scoreboard.competitions)
      .map((competition) => transformTennisCompetition(
        competition,
        competition.id ? tournamentIndex.get(competition.id) : undefined,
        rankings,
      ))
      .filter((game): game is Game => game !== null)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());
    const espnSignatures = new Set(espnGames.map(tennisGameSignature));
    const supplementalGames = (await fetchTennisExplorerLiveMatches(date).catch(() => []))
      .map(transformTennisExplorerMatch)
      .filter((game) => !espnSignatures.has(tennisGameSignature(game)));
    const games = filterVerifiedScoreboardGames([...espnGames, ...supplementalGames])
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
    const games: Game[] = filterVerifiedScoreboardGames(resolved.filter((g): g is Game => g !== null));
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

function formatUtcDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

function utcDateWithOffset(base: Date, offsetDays: number): string {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatUtcDate(date);
}

export function buildHomeGamesDateWindow(now = new Date()): {
  fetchDates: string[];
  coverageStart: Date;
  scheduledCutoff: Date;
} {
  const coverageStart = new Date(now);
  coverageStart.setUTCHours(coverageStart.getUTCHours() - 30);

  const scheduledCutoff = new Date(now);
  scheduledCutoff.setUTCDate(scheduledCutoff.getUTCDate() + 2);
  scheduledCutoff.setUTCHours(23, 59, 59, 999);

  return {
    fetchDates: [-1, 0, 1, 2].map((offset) => utcDateWithOffset(now, offset)),
    coverageStart,
    scheduledCutoff,
  };
}

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
    const { fetchDates, coverageStart, scheduledCutoff } = buildHomeGamesDateWindow(new Date());

    // Fetch previous UTC day + today + two days out in parallel. The previous
    // day keeps US evening users from losing same-local-day finals after the
    // Railway server has already crossed into tomorrow UTC.
    const allGames = (await Promise.all(fetchDates.map((date) => fetchAllGames(date)))).flat();

    // Deduplicate by game ID
    const uniqueGames = Array.from(
      new Map(allGames.map((game) => [game.id, game])).values()
    );

    // Keep games whose gameTime is in the rolling Home coverage window. This
    // covers a US-PST user's "tomorrow night" slate (which spills into the UTC
    // day-after-tomorrow) without leaking stale scheduled games into the response.
    const filteredGames = uniqueGames.filter((game) => {
      const gameTime = new Date(game.gameTime);
      if (game.status === "LIVE") return true;
      if (game.status === "FINAL") return gameTime >= coverageStart;
      return gameTime >= coverageStart && gameTime <= scheduledCutoff;
    });
    filteredGames.sort(
      (a, b) =>
        new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()
    );

    const storedPregamePredictions = await loadStoredPregamePredictionMap(filteredGames);

    // Attach the stored pregame snapshot for live/final games, otherwise attach
    // the freshest cached prediction — never block the response for
    // generation. ALWAYS overwrite any prediction the indexed/transformed game
    // already had: that earlier value may have been computed against an older
    // cache snapshot, and only the current cache value is guaranteed to match
    // what the detail endpoint will return for the same game.
    for (let i = 0; i < filteredGames.length; i++) {
      const game = filteredGames[i]!;
      const storedPregamePrediction = storedPregamePredictions.get(game.id);
      if (storedPregamePrediction) {
        filteredGames[i] = attachPredictionToGame(game, storedPregamePrediction);
        continue;
      }
      const cached = pickFreshestPredictionForGame(game);
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

    // Top picks must be pregame only. Do not force a pick per sport if the
    // available inputs are thin; returning fewer picks is better than promoting
    // a weak read.
    const scheduledGames = uniqueGames.filter((g) => g.status === "SCHEDULED");
    const topPickGames = selectTopPickCandidates(scheduledGames);

    // Generate predictions synchronously for a bounded candidate pool, then
    // keep only picks with enough source quality and conviction.
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

    // Show the strongest scheduled pick per sport. Strict source-quality picks
    // win first; if a sport has no strict candidate, keep the best transparent
    // model read so the board does not collapse to one league or zero picks.
    const topPicksBySport = selectTopPicksForDisplay(gamesWithPredictions);

    return c.json({ data: topPicksBySport });
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

    const storedPregamePredictions = await loadStoredPregamePredictionMap(games);

    // Attach stored pregame snapshots for live/final games and cached predictions
    // for active/upcoming games so first paint shows them when warm.
    const gamesWithCached = games.map((g) => {
      const storedPregamePrediction = storedPregamePredictions.get(g.id);
      if (storedPregamePrediction) return attachPredictionToGame(g, storedPregamePrediction);
      if (g.prediction) return g;
      const cached = pickFreshestPredictionForGame(g);
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
      const storedPregamePrediction = await getStoredPregamePrediction(game);
      if (storedPregamePrediction) {
        return attachPredictionToGame(game, storedPregamePrediction);
      }

      const cached = pickFreshestPredictionForGame(game);
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
      if (isVerifiedScoreboardGame(indexedGame)) {
        const gameWithPrediction = await ensurePrediction(indexedGame);
        return c.json({ data: gameWithPrediction });
      }
      gameById.delete(gameId);
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
    const storedPregamePredictions = await loadStoredPregamePredictionMap(games);
    const gamesWithCached = games.map((game) => {
      if (game.prediction) return game;
      const storedPregamePrediction = storedPregamePredictions.get(game.id);
      if (storedPregamePrediction) return attachPredictionToGame(game, storedPregamePrediction);
      const cached = pickFreshestPredictionForGame(game);
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
  source?: Game["source"];
  homeTeam: { abbreviation: string; name: string };
  awayTeam: { abbreviation: string; name: string };
  homeScore: number;
  awayScore: number;
  homeScoreDisplay?: string;
  awayScoreDisplay?: string;
  clock: string | null;
  period: number | null;
  quarter: string | null;
  status: "LIVE" | "FINAL";
  statusLabel?: string;
  statusDetail?: string;
  suspension?: Game["suspension"];
  cricketState?: Game["cricketState"];
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
              source: game.source,
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
              statusLabel: game.statusLabel,
              statusDetail: game.statusDetail,
              suspension: game.suspension,
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
            const suspension = getSuspensionInfoFromESPN(comp.status);
            const home = comp.competitors.find((c) => c.homeAway === "home");
            const away = comp.competitors.find((c) => c.homeAway === "away");
            if (!home || !away) return null;
            const cricketState = sport === "IPL"
              ? buildCricketScoreState(home, away, comp.status)
              : undefined;
            const cricketHomeScore = cricketState?.home?.runs;
            const cricketAwayScore = cricketState?.away?.runs;
            const cricketClock = sport === "IPL"
              ? (cricketState?.battingSide ? cricketState[cricketState.battingSide]?.detailText : undefined)
              : undefined;
            const liveState = parseMlbLiveState({
              sport,
              status: liveStatus,
              competition: comp,
              homeAbbr: home.team.abbreviation,
              awayAbbr: away.team.abbreviation,
              gameId: ev.id,
            });
            const rawQuarter = getPeriodDisplay(comp.status, sport) ?? null;
            const cricketQuarter = sport === "IPL"
              ? cricketStatusLine(cricketState, home.team.abbreviation, away.team.abbreviation) ?? rawQuarter
              : null;

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
              homeScore: cricketHomeScore ?? parseInt(home.score ?? "0", 10),
              awayScore: cricketAwayScore ?? parseInt(away.score ?? "0", 10),
              homeScoreDisplay: cricketState?.home?.scoreText,
              awayScoreDisplay: cricketState?.away?.scoreText,
              clock: sport === "IPL"
                ? cricketClock ?? suspension?.resumeText ?? comp.status.displayClock ?? null
                : suspension?.resumeText ?? comp.status.displayClock ?? null,
              period: comp.status.period ?? null,
              quarter: sport === "MLB"
                ? getMlbPeriodDisplay(liveState) ?? rawQuarter
                : sport === "IPL"
                  ? cricketQuarter
                  : rawQuarter,
              status: liveStatus,
              statusLabel: suspension?.display,
              statusDetail: sport === "IPL" ? cricketState?.summary ?? suspension?.resumeText : suspension?.resumeText,
              suspension,
              cricketState,
              liveState,
            };
          })
          .filter((s): s is LiveScore => s !== null);
      } catch {
        return [];
      }
    })
  );

  const data = filterVerifiedScoreboardGames(results.flat());

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
    const cached = pickFreshestPredictionForGame(game);
    if (cached) return attachPredictionToGame(game, cached);
    const storedPregamePrediction = await getStoredPregamePrediction(game);
    if (storedPregamePrediction) return attachPredictionToGame(game, storedPregamePrediction);
    if (game.status !== "SCHEDULED") return game;
    return addPredictionToGame(game);
  };

  const indexedGame = gameById.get(gameId);
  if (indexedGame && indexedGame.status !== "LIVE") {
    if (isVerifiedScoreboardGame(indexedGame)) return ensurePrediction(indexedGame);
    gameById.delete(gameId);
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
