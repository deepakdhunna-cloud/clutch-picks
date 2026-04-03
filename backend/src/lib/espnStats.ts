/**
 * ESPN Team Stats Fetcher
 * Fetches real team data from ESPN's public API for use in predictions.
 */

// ESPN sport path mappings
import { LRUCache } from "lru-cache";

const ESPN_SPORT_PATHS: Record<string, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  MLS: "soccer/usa.1",
  NCAAF: "football/college-football",
  NCAAB: "basketball/mens-college-basketball",
  EPL: "soccer/eng.1",
};

export interface TeamRecentForm {
  results: Array<"W" | "L" | "D">;
  formString: string; // "W-W-L-W-L"
  streak: number; // positive = win streak, negative = loss streak
  avgScore: number;
  avgAllowed: number;
  wins: number;
  losses: number;
}

interface ESPNScheduleEvent {
  id: string;
  competitions: Array<{
    competitors: Array<{
      id: string;
      homeAway: string;
      winner?: boolean;
      score?: string | { value: number; displayValue: string };
      team: { id: string };
    }>;
    status?: {
      type?: {
        completed?: boolean;
        state?: string;
      };
    };
  }>;
}

interface ESPNScheduleResponse {
  team?: {
    id: string;
  };
  events?: ESPNScheduleEvent[];
}

// Shared raw schedule cache — one fetch per team per sport, shared by all parsing functions
const SCHEDULE_CACHE_TTL_MS = 10 * 60 * 1000;
const scheduleCache = new LRUCache<string, { data: ESPNScheduleResponse; timestamp: number }>({ max: 200 });

async function fetchTeamScheduleRaw(teamId: string, sport: string): Promise<ESPNScheduleResponse | null> {
  const cacheKey = `schedule-raw-${teamId}-${sport}`;
  const cached = scheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SCHEDULE_CACHE_TTL_MS) {
    return cached.data;
  }

  const sportPath = ESPN_SPORT_PATHS[sport];
  if (!sportPath) return null;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamId}/schedule`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = (await response.json()) as ESPNScheduleResponse;
    scheduleCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// In-memory cache for team form data
const FORM_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes - recent form doesn't change within a game
const teamFormCache = new LRUCache<string, { data: TeamRecentForm; timestamp: number }>({ max: 200 });

function getCachedForm(key: string): TeamRecentForm | null {
  const entry = teamFormCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > FORM_CACHE_TTL_MS) {
    teamFormCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedForm(key: string, data: TeamRecentForm): void {
  teamFormCache.set(key, { data, timestamp: Date.now() });
}

function defaultForm(): TeamRecentForm {
  return {
    results: [],
    formString: "",
    streak: 0,
    avgScore: 0,
    avgAllowed: 0,
    wins: 0,
    losses: 0,
  };
}

/**
 * Parse a score value from ESPN API which can be a plain string ("89")
 * or an object ({ value: 89.0, displayValue: "89" }).
 */
function parseScore(score: string | { value: number; displayValue: string } | undefined): number | null {
  if (score === undefined || score === null) return null;
  if (typeof score === "object") {
    // Object format: { value: 89.0, displayValue: "89" }
    if (typeof score.value === "number") return score.value;
    if (typeof score.displayValue === "string") {
      const parsed = parseFloat(score.displayValue);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }
  // String format
  const parsed = parseFloat(score);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Calculate streak from an ordered list of results (most recent last).
 * Returns positive for win streak, negative for loss streak.
 */
function calculateStreak(results: Array<"W" | "L" | "D">): number {
  if (results.length === 0) return 0;
  // Iterate from most recent (last element) backwards
  const lastResult = results[results.length - 1];
  if (lastResult === "D") return 0;
  let streak = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (r === "D") break;
    if (r === lastResult) {
      streak += lastResult === "W" ? 1 : -1;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Fetch the last N completed games for a team and compute form metrics.
 */
export async function fetchTeamRecentForm(
  teamId: string,
  sport: string,
  limit = 10
): Promise<TeamRecentForm> {
  const cacheKey = `team-${teamId}-${sport}`;
  const cached = getCachedForm(cacheKey);
  if (cached) return cached;

  try {
    const data = await fetchTeamScheduleRaw(teamId, sport);
    if (!data) return defaultForm();
    const events = data.events;

    if (!Array.isArray(events) || events.length === 0) {
      return defaultForm();
    }

    // Filter to completed games only, then take the last `limit` ones
    // ESPN schedule API puts status inside competitions[0], not at event level
    const completedEvents = events.filter((e) => {
      const compStatus = e.competitions?.[0]?.status;
      const state = compStatus?.type?.state?.toLowerCase();
      const completed = compStatus?.type?.completed;
      return completed === true || state === "post";
    });

    // Take the last `limit` completed games (most recent at end)
    const recentEvents = completedEvents.slice(-limit);

    const results: Array<"W" | "L" | "D"> = [];
    let totalScored = 0;
    let totalAllowed = 0;
    let scoredCount = 0;

    for (const event of recentEvents) {
      const competition = event.competitions[0];
      if (!competition) continue;

      const teamCompetitor = competition.competitors.find(
        (c) => c.team.id === teamId
      );
      const opponentCompetitor = competition.competitors.find(
        (c) => c.team.id !== teamId
      );

      if (!teamCompetitor) continue;

      // Determine W/L/D
      if (teamCompetitor.winner === true) {
        results.push("W");
      } else if (teamCompetitor.winner === false) {
        // Check if it's a draw (both didn't win isn't always available)
        const teamScoreVal = parseScore(teamCompetitor.score);
        const oppScoreVal = parseScore(opponentCompetitor?.score);
        if (teamScoreVal !== null && oppScoreVal !== null && teamScoreVal === oppScoreVal) {
          results.push("D");
        } else {
          results.push("L");
        }
      } else {
        // Fallback: compare scores
        const teamScoreVal = parseScore(teamCompetitor.score);
        const oppScoreVal = parseScore(opponentCompetitor?.score);
        if (teamScoreVal !== null && oppScoreVal !== null) {
          if (teamScoreVal > oppScoreVal) results.push("W");
          else if (teamScoreVal < oppScoreVal) results.push("L");
          else results.push("D");
        }
      }

      // Accumulate scores
      const teamScore = parseScore(teamCompetitor.score);
      const oppScore = parseScore(opponentCompetitor?.score);
      if (teamScore !== null && !isNaN(teamScore)) {
        totalScored += teamScore;
        scoredCount++;
      }
      if (oppScore !== null && !isNaN(oppScore)) {
        totalAllowed += oppScore;
      }
    }

    const wins = results.filter((r) => r === "W").length;
    const losses = results.filter((r) => r === "L").length;
    const formString = results.join("-");
    const streak = calculateStreak(results);
    const avgScore = scoredCount > 0 ? totalScored / scoredCount : 0;
    const avgAllowed = scoredCount > 0 ? totalAllowed / scoredCount : 0;

    const form: TeamRecentForm = {
      results,
      formString,
      streak,
      avgScore,
      avgAllowed,
      wins,
      losses,
    };

    setCachedForm(cacheKey, form);
    return form;
  } catch (_err) {
    // Silently fall back to default on any network/parse error
    return defaultForm();
  }
}

// ─── Extended Stats ──────────────────────────────────────────────────────────

export interface TeamExtendedStats {
  homeRecord: { wins: number; losses: number };
  awayRecord: { wins: number; losses: number };
  lastGameDate: string | null;
  avgScoreLast5: number;
  avgScoreLast10: number;
  scoringTrend: number;     // -1 to 1, positive = offense trending up
  defenseTrend: number;     // -1 to 1, positive = defense improving
  headToHeadResults: Array<{ date: string; won: boolean; teamScore: number; oppScore: number }>;
  strengthOfSchedule: number;  // avg opponent win %, typically 0.3–0.7
  restDays: number | null;
  consecutiveAwayGames: number; // how many consecutive away games the team has played heading into this game
}

export interface TeamInjuryReport {
  out: Array<{ name: string; position: string; detail: string }>;
  doubtful: Array<{ name: string; position: string; detail: string }>;
  questionable: Array<{ name: string; position: string; detail: string }>;
  totalOut: number;
  totalDoubtful: number;
  totalQuestionable: number;
}

// Caches for extended stats and injuries
const EXTENDED_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const INJURY_CACHE_TTL_MS = 30 * 60 * 1000;   // 30 minutes
const extendedStatsCache = new LRUCache<string, { data: TeamExtendedStats; timestamp: number }>({ max: 200 });
const injuryCache = new LRUCache<string, { data: TeamInjuryReport; timestamp: number }>({ max: 200 });

function defaultExtendedStats(): TeamExtendedStats {
  return {
    homeRecord: { wins: 0, losses: 0 },
    awayRecord: { wins: 0, losses: 0 },
    lastGameDate: null,
    avgScoreLast5: 0,
    avgScoreLast10: 0,
    scoringTrend: 0,
    defenseTrend: 0,
    headToHeadResults: [],
    strengthOfSchedule: 0.5,
    restDays: null,
    consecutiveAwayGames: 0,
  };
}

function defaultInjuryReport(): TeamInjuryReport {
  return {
    out: [],
    doubtful: [],
    questionable: [],
    totalOut: 0,
    totalDoubtful: 0,
    totalQuestionable: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Fetch extended team stats: home/away record, scoring trends, head-to-head,
 * strength of schedule, and rest days.
 */
export async function fetchTeamExtendedStats(
  teamId: string,
  sport: string,
  opponentTeamId: string,
  gameDate: Date = new Date()
): Promise<TeamExtendedStats> {
  const cacheKey = `extended-${teamId}-${sport}-${opponentTeamId}`;
  const cached = extendedStatsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EXTENDED_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const data = await fetchTeamScheduleRaw(teamId, sport);
    if (!data) return defaultExtendedStats();
    const events = data.events;
    if (!Array.isArray(events) || events.length === 0) return defaultExtendedStats();

    // Filter to completed games only
    const completedEvents = events.filter((e) => {
      const compStatus = e.competitions?.[0]?.status;
      const state = compStatus?.type?.state?.toLowerCase();
      return compStatus?.type?.completed === true || state === "post";
    });

    if (completedEvents.length === 0) return defaultExtendedStats();

    // --- Home / Away record ---
    const homeRecord = { wins: 0, losses: 0 };
    const awayRecord = { wins: 0, losses: 0 };

    // --- Scored / allowed per game (all completed, most recent last) ---
    interface GameStats {
      teamScore: number;
      oppScore: number;
      opponentId: string;
      opponentWins: number;
      opponentLosses: number;
      date: string;
    }
    const gameStatsList: GameStats[] = [];

    // --- Head-to-head ---
    const headToHeadResults: TeamExtendedStats["headToHeadResults"] = [];
    // Track home/away sequence for consecutive away game detection
    const homeAwaySequence: string[] = [];

    for (const event of completedEvents) {
      const comp = event.competitions[0];
      if (!comp) continue;

      const teamComp = comp.competitors.find((c) => c.team.id === teamId);
      const oppComp = comp.competitors.find((c) => c.team.id !== teamId);
      if (!teamComp || !oppComp) continue;

      const teamScore = parseScore(teamComp.score);
      const oppScore = parseScore(oppComp.score);
      if (teamScore === null || oppScore === null) continue;

      const isWin = teamComp.winner === true || (teamComp.winner === undefined && teamScore > oppScore);
      const isLoss = teamComp.winner === false && teamScore < oppScore || (teamComp.winner === undefined && teamScore < oppScore);

      // Home / away record
      if (teamComp.homeAway === "home") {
        if (isWin) homeRecord.wins++;
        else if (isLoss) homeRecord.losses++;
      } else {
        if (isWin) awayRecord.wins++;
        else if (isLoss) awayRecord.losses++;
      }

      // Parse opponent's record from ESPN (competitors may carry record strings)
      const oppCompAny = oppComp as any;
      let oppWins = 0;
      let oppLosses = 0;
      const records: Array<{ summary?: string; type?: string }> | undefined = oppCompAny.records;
      if (records) {
        const overallRecord = records.find((r) => r.type === "total" || r.type === "overall") ?? records[0];
        if (overallRecord?.summary) {
          const parts = overallRecord.summary.split("-");
          oppWins = parseInt(parts[0] ?? "0", 10) || 0;
          oppLosses = parseInt(parts[1] ?? "0", 10) || 0;
        }
      }

      // ESPN puts date at event level (competitions[0] has a date field sometimes)
      const eventAny = event as any;
      const gameDate: string = eventAny.date ?? comp.competitors[0]?.id ?? "";

      gameStatsList.push({
        teamScore,
        oppScore,
        opponentId: oppComp.team.id,
        opponentWins: oppWins,
        opponentLosses: oppLosses,
        date: gameDate,
      });
      homeAwaySequence.push(teamComp.homeAway ?? "away");

      // Head-to-head
      if (oppComp.team.id === opponentTeamId) {
        headToHeadResults.push({
          date: gameDate,
          won: isWin,
          teamScore,
          oppScore,
        });
      }
    }

    // --- Averages ---
    const last10 = gameStatsList.slice(-10);
    const last5 = gameStatsList.slice(-5);

    // --- Recency decay ---
    // More recent games carry higher weight; older games decay exponentially.
    // Sport-specific rates: higher = faster decay (fewer games matter more).
    const DECAY_RATES: Record<string, number> = {
      NFL:   0.09,
      NCAAF: 0.09,
      NBA:   0.05,
      NCAAB: 0.06,
      MLB:   0.025,
      NHL:   0.05,
      MLS:   0.05,
      EPL:   0.05,
    };
    const decayRate = DECAY_RATES[sport] ?? 0.05;

    /**
     * Compute a decay-weighted average over an array of game results.
     * Index 0 = oldest, last index = most recent (weight ≈ 1.0).
     * Games from gamesAgo positions ago get weight exp(-decayRate * gamesAgo).
     */
    function decayWeightedAvg(
      games: GameStats[],
      fn: (g: GameStats) => number
    ): number {
      if (games.length === 0) return 0;
      const n = games.length;
      let weightSum = 0;
      let valueSum = 0;
      let i = 0;
      for (const game of games) {
        const gamesAgo = n - 1 - i;
        const weight = Math.exp(-decayRate * gamesAgo);
        weightSum += weight;
        valueSum += weight * fn(game);
        i++;
      }
      return weightSum > 0 ? valueSum / weightSum : 0;
    }

    const avg = (arr: GameStats[], fn: (g: GameStats) => number) =>
      arr.length > 0 ? arr.reduce((s, g) => s + fn(g), 0) / arr.length : 0;

    // Full-season decay-weighted averages (recent games weighted higher).
    // These replace the simple window averages for trend baselines.
    // Using the full gameStatsList ensures all season games contribute with
    // recency weighting — more recent games dominate naturally.
    const avgScoreLast5   = decayWeightedAvg(last5, (g) => g.teamScore);
    const avgScoreLast10  = decayWeightedAvg(gameStatsList, (g) => g.teamScore);
    const avgAllowedLast10 = decayWeightedAvg(gameStatsList, (g) => g.oppScore);

    // --- Opponent-quality weighted recent scores (last 5 window) ---
    // Weight each game's score by opponent win% (games vs better teams count more).
    // Opponents with no record data get neutral weight of 0.5.
    const oppQualityWeightedScore = (arr: GameStats[], fn: (g: GameStats) => number): number => {
      if (arr.length === 0) return 0;
      let weightedSum = 0;
      let totalWeight = 0;
      for (const g of arr) {
        const oppTotal = g.opponentWins + g.opponentLosses;
        const oppWinPct = oppTotal > 0 ? g.opponentWins / oppTotal : 0.5;
        weightedSum += fn(g) * oppWinPct;
        totalWeight += oppWinPct;
      }
      return totalWeight > 0 ? weightedSum / totalWeight : 0;
    };

    const recentWindow = last5.length > 0 ? last5 : gameStatsList.slice(-3);
    const recentN = recentWindow.length;

    // --- Sample size dampening: proportional to how close we are to 5 games ---
    // 5 games = 1.0, 3 games = 0.6, 1 game = 0.2
    const sampleDampening = recentN >= 5 ? 1.0 : recentN / 5;

    // --- Variance dampening: if scores are inconsistent, trend is less reliable ---
    const stdDev = (arr: GameStats[], fn: (g: GameStats) => number, mean: number): number => {
      if (arr.length < 2) return 0;
      const variance = arr.reduce((s, g) => s + Math.pow(fn(g) - mean, 2), 0) / arr.length;
      return Math.sqrt(variance);
    };

    const recentAvgScoreRaw = avg(recentWindow, (g) => g.teamScore);
    const recentAvgAllowedRaw = avg(recentWindow, (g) => g.oppScore);
    const scoreStdDev = stdDev(recentWindow, (g) => g.teamScore, recentAvgScoreRaw);
    const allowedStdDev = stdDev(recentWindow, (g) => g.oppScore, recentAvgAllowedRaw);

    // If stdDev > mean * 0.4, scores are inconsistent — dampen trend by 50%
    const scoringVarianceDampening = recentAvgScoreRaw > 0 && scoreStdDev > recentAvgScoreRaw * 0.4 ? 0.5 : 1.0;
    const defenseVarianceDampening = recentAvgAllowedRaw > 0 && allowedStdDev > recentAvgAllowedRaw * 0.4 ? 0.5 : 1.0;

    // Use opponent-quality weighted averages for recent window
    const recentAvgScoreWeighted = oppQualityWeightedScore(recentWindow, (g) => g.teamScore);
    const recentAvgAllowedWeighted = oppQualityWeightedScore(recentWindow, (g) => g.oppScore);

    // Use the weighted recent average if opponent data is available, otherwise raw
    const recentAvgScore = recentAvgScoreWeighted > 0 ? recentAvgScoreWeighted : recentAvgScoreRaw;
    const recentAvgAllowed = recentAvgAllowedWeighted > 0 ? recentAvgAllowedWeighted : recentAvgAllowedRaw;

    // Scoring trend: positive = offense improving recently
    const rawScoringTrend = avgScoreLast10 > 0
      ? clamp((recentAvgScore - avgScoreLast10) / avgScoreLast10, -1, 1)
      : 0;
    const scoringTrend = rawScoringTrend * sampleDampening * scoringVarianceDampening;

    // Defense trend: positive = allowing fewer points recently (improving)
    const rawDefenseTrend = avgAllowedLast10 > 0
      ? clamp((avgAllowedLast10 - recentAvgAllowed) / avgAllowedLast10, -1, 1)
      : 0;
    const defenseTrend = rawDefenseTrend * sampleDampening * defenseVarianceDampening;

    // --- Strength of schedule ---
    const sosGames = last10.filter((g) => g.opponentWins + g.opponentLosses > 0);
    const strengthOfSchedule = sosGames.length > 0
      ? sosGames.reduce((s, g) => s + g.opponentWins / (g.opponentWins + g.opponentLosses), 0) / sosGames.length
      : 0.5;

    // --- Rest days ---
    const lastGame = gameStatsList[gameStatsList.length - 1];
    let restDays: number | null = null;
    let lastGameDate: string | null = null;
    if (lastGame?.date) {
      const lastDate = new Date(lastGame.date);
      if (!isNaN(lastDate.getTime())) {
        lastGameDate = lastDate.toISOString();
        // Use calendar date difference (UTC) to avoid timezone edge cases
        // A game "yesterday" = 1 rest day, "2 days ago" = 2 rest days
        const targetDate = gameDate;
        const todayUTC = Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate());
        const lastUTC = Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth(), lastDate.getUTCDate());
        const daysDiff = Math.floor((todayUTC - lastUTC) / (1000 * 60 * 60 * 24));
        // Subtract 1: "played yesterday" = 1 day between games = 1 rest day
        // "played today" = 0 day diff = game hasn't happened yet or just happened = null
        restDays = daysDiff <= 0 ? null : daysDiff - 1;
      }
    }

    const result: TeamExtendedStats = {
      homeRecord,
      awayRecord,
      lastGameDate,
      avgScoreLast5,
      avgScoreLast10,
      scoringTrend,
      defenseTrend,
      headToHeadResults,
      strengthOfSchedule,
      restDays,
      consecutiveAwayGames: (() => {
        let count = 0;
        for (let i = homeAwaySequence.length - 1; i >= 0; i--) {
          if (homeAwaySequence[i] === "away") count++;
          else break;
        }
        return count;
      })(),
    };

    extendedStatsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return defaultExtendedStats();
  }
}

/**
 * Fetch the full season schedule for a team and return all completed game results.
 * Used for Elo initialization — needs the complete picture, not just H2H.
 */
export async function fetchTeamSeasonResults(
  teamId: string,
  sport: string
): Promise<Array<{ opponentId: string; won: boolean; isDraw?: boolean; date: string; teamScore?: number; oppScore?: number }>> {
  try {
    const data = await fetchTeamScheduleRaw(teamId, sport);
    if (!data) return [];
    const events = data.events;
    if (!Array.isArray(events)) return [];

    const results: Array<{ opponentId: string; won: boolean; isDraw?: boolean; date: string; teamScore?: number; oppScore?: number }> = [];

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const compStatus = comp.status;
      const state = compStatus?.type?.state?.toLowerCase();
      if (!(compStatus?.type?.completed === true || state === "post")) continue;

      const teamComp = comp.competitors.find((c) => c.team.id === teamId);
      const oppComp = comp.competitors.find((c) => c.team.id !== teamId);
      if (!teamComp || !oppComp) continue;

      const teamScore = parseScore(teamComp.score);
      const oppScore = parseScore(oppComp.score);
      if (teamScore === null || oppScore === null) continue;

      const won = teamComp.winner === true || (teamComp.winner === undefined && teamScore > oppScore);
      const isDraw = teamScore === oppScore;
      const eventAny = event as any;
      const date: string = eventAny.date ?? (comp as any).date ?? "";

      results.push({
        opponentId: oppComp.team.id,
        won,
        isDraw: isDraw || undefined,
        date,
        teamScore,
        oppScore,
      });
    }

    return results;
  } catch {
    return [];
  }
}
// ─── Advanced Metrics ────────────────────────────────────────────────────────

export interface TeamAdvancedMetrics {
  // NBA
  offensiveRating?: number;  // points per 100 possessions
  defensiveRating?: number;
  pace?: number;
  effectiveFGPct?: number;  // 0–1
  trueShootingPct?: number; // 0–1
  // NFL
  yardsPerPlay?: number;
  turnoverDifferential?: number;
  thirdDownConvPct?: number; // 0–1
  // MLB
  teamERA?: number;
  whip?: number;
  ops?: number;           // on-base + slugging, typically 0.5–1.0
  battingAverage?: number;
  // NHL
  savePercentage?: number;     // 0–1
  powerPlayPct?: number;       // 0–1
  penaltyKillPct?: number;     // 0–1
  shotsPerGame?: number;
}

const ADVANCED_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const advancedMetricsCache = new LRUCache<string, { data: TeamAdvancedMetrics; timestamp: number }>({ max: 200 });

function defaultAdvancedMetrics(): TeamAdvancedMetrics {
  return {};
}

/**
 * Fetch sport-specific advanced metrics from ESPN's team statistics endpoint.
 * Returns an empty object for sports or teams where ESPN doesn't provide data —
 * callers must treat any missing field as neutral (0 contribution).
 */
export async function fetchAdvancedMetrics(
  teamId: string,
  sport: string
): Promise<TeamAdvancedMetrics> {
  const cacheKey = `adv-${teamId}-${sport}`;
  const cached = advancedMetricsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ADVANCED_CACHE_TTL_MS) {
    return cached.data;
  }

  const sportPath = ESPN_SPORT_PATHS[sport];
  if (!sportPath) return defaultAdvancedMetrics();

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamId}/statistics`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return defaultAdvancedMetrics();

    const data = (await response.json()) as any;

    // ESPN wraps stats in results.splits.categories or stats at root
    const categories: any[] = data?.results?.stats?.categories
      ?? data?.results?.splits?.categories
      ?? data?.stats?.splits?.categories
      ?? data?.splits?.categories
      ?? data?.categories
      ?? [];

    // Build a flat lookup: statName -> displayValue (string) / value (number)
    const statMap: Record<string, number> = {};
    for (const cat of categories) {
      const stats: any[] = cat?.stats ?? cat?.athletes?.[0]?.stats ?? [];
      for (const s of stats) {
        const name: string = (s?.name ?? s?.abbreviation ?? "").toLowerCase();
        const raw = s?.value ?? s?.displayValue;
        const val = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
        if (name && !isNaN(val)) {
          statMap[name] = val;
        }
      }
    }

    const result: TeamAdvancedMetrics = {};

    if (sport === "NBA") {
      // Offensive Rating — try all ESPN name variants
      result.offensiveRating =
        statMap["offensiverating"] ??
        statMap["offrtg"] ??
        statMap["ortg"] ??
        statMap["offensiveefficiency"] ??
        statMap["pointsperpossession"] ??
        undefined;

      // Defensive Rating — lower is better
      result.defensiveRating =
        statMap["defensiverating"] ??
        statMap["defrtg"] ??
        statMap["drtg"] ??
        statMap["defensiveefficiency"] ??
        undefined;

      // Pace — possessions per 48 minutes
      result.pace =
        statMap["pace"] ??
        statMap["possessions"] ??
        statMap["pacefactor"] ??
        undefined;

      // Effective FG% — try ESPN direct, then derive from counting stats
      const efgDirect =
        statMap["effectivefieldgoalpercent"] ??
        statMap["effectivefgpercent"] ??
        statMap["efgpct"] ??
        statMap["efg"];
      if (efgDirect !== undefined) {
        result.effectiveFGPct = efgDirect > 1 ? efgDirect / 100 : efgDirect;
      } else {
        // derive: eFG% = (FGM + 0.5 * 3PM) / FGA
        const fgm = statMap["fieldgoalsmade"] ?? statMap["fgm"];
        const fga = statMap["fieldgoalsattempted"] ?? statMap["fieldgoalsattempts"] ?? statMap["fga"];
        const tpm = statMap["3pointfieldgoalsmade"] ?? statMap["threepointfieldgoalsmade"] ?? statMap["3pm"] ?? statMap["tpm"];
        if (fgm !== undefined && fga !== undefined && fga > 0 && tpm !== undefined) {
          result.effectiveFGPct = (fgm + 0.5 * tpm) / fga;
        }
      }

      // True Shooting%
      const tsDirect =
        statMap["trueshootingpercent"] ??
        statMap["trueshooting"] ??
        statMap["tspct"] ??
        statMap["ts%"] ??
        statMap["ts"];
      if (tsDirect !== undefined) {
        result.trueShootingPct = tsDirect > 1 ? tsDirect / 100 : tsDirect;
      } else {
        // derive: TS% = PTS / (2 * (FGA + 0.44 * FTA))
        const pts = statMap["points"] ?? statMap["pts"] ?? statMap["pointspergame"];
        const fga2 = statMap["fieldgoalsattempted"] ?? statMap["fieldgoalsattempts"] ?? statMap["fga"];
        const fta = statMap["freethrowsattempted"] ?? statMap["freethrowattempts"] ?? statMap["fta"];
        if (pts !== undefined && fga2 !== undefined && fga2 > 0 && fta !== undefined) {
          const denom = 2 * (fga2 + 0.44 * fta);
          if (denom > 0) result.trueShootingPct = pts / denom;
        }
      }

      // Log missing key metrics at debug level
      if (result.offensiveRating === undefined) console.debug(`[metrics] NBA team ${teamId}: offRtg unavailable from ESPN`);
      if (result.defensiveRating === undefined) console.debug(`[metrics] NBA team ${teamId}: defRtg unavailable from ESPN`);
      if (result.effectiveFGPct === undefined) console.debug(`[metrics] NBA team ${teamId}: eFG% unavailable from ESPN`);
    }

    if (sport === "NFL" || sport === "NCAAF") {
      // Yards per play — try ESPN direct, then derive
      const yppDirect = statMap["yardsperplay"] ?? statMap["ypp"] ?? statMap["totalyardsperplay"];
      if (yppDirect !== undefined) {
        result.yardsPerPlay = yppDirect;
      } else {
        const totalYards = statMap["totalyards"] ?? statMap["yards"];
        const totalPlays = statMap["totalplays"] ?? statMap["plays"];
        if (totalYards !== undefined && totalPlays !== undefined && totalPlays > 0) {
          result.yardsPerPlay = totalYards / totalPlays;
        }
      }

      // Turnover differential
      const toDiff = statMap["turnoverdifferential"] ?? statMap["todifferential"] ?? statMap["todiff"];
      if (toDiff !== undefined) {
        result.turnoverDifferential = toDiff;
      } else {
        const toFor = statMap["turnoversforced"] ?? statMap["defensiveturnovers"] ?? statMap["interceptions"];
        const toAgainst = statMap["turnoverscommitted"] ?? statMap["offensiveturnovers"] ?? statMap["fumbleslost"];
        if (toFor !== undefined && toAgainst !== undefined) {
          result.turnoverDifferential = toFor - toAgainst;
        }
      }

      // Third-down conversion rate
      const tdConvDirect =
        statMap["thirddownconversionpct"] ??
        statMap["thirddownconversions"] ??
        statMap["3rddownpct"] ??
        statMap["thirddownpercent"];
      if (tdConvDirect !== undefined) {
        result.thirdDownConvPct = tdConvDirect > 1 ? tdConvDirect / 100 : tdConvDirect;
      } else {
        const tdConv = statMap["thirddownconversions"] ?? statMap["thirddowns"];
        const tdAtt = statMap["thirddownattempts"];
        if (tdConv !== undefined && tdAtt !== undefined && tdAtt > 0) {
          result.thirdDownConvPct = tdConv / tdAtt;
        }
      }

      if (result.yardsPerPlay === undefined) console.debug(`[metrics] ${sport} team ${teamId}: yardsPerPlay unavailable from ESPN`);
      if (result.turnoverDifferential === undefined) console.debug(`[metrics] ${sport} team ${teamId}: turnoverDiff unavailable from ESPN`);
    }

    if (sport === "MLB") {
      // ERA — lower is better
      result.teamERA =
        statMap["era"] ??
        statMap["earnedrateaveragepercent"] ??
        statMap["earnedruntavg"] ??
        undefined;

      // WHIP
      result.whip =
        statMap["whip"] ??
        statMap["walksandbitsperpitchedinning"] ??
        undefined;

      // OPS = OBP + SLG
      const opsDirect = statMap["ops"] ?? statMap["onbaseplusslug"] ?? statMap["onbaseplusslugpercent"];
      if (opsDirect !== undefined) {
        result.ops = opsDirect > 2 ? opsDirect / 1000 : opsDirect;
      } else {
        const obp = statMap["obp"] ?? statMap["onbasepercent"] ?? statMap["onbasepct"];
        const slg = statMap["slg"] ?? statMap["slugging"] ?? statMap["sluggingpercent"];
        if (obp !== undefined && slg !== undefined) {
          result.ops = (obp > 1 ? obp / 1000 : obp) + (slg > 1 ? slg / 1000 : slg);
        }
      }

      // Batting average
      const avg = statMap["avg"] ?? statMap["battingaverage"] ?? statMap["battingavg"];
      if (avg !== undefined) result.battingAverage = avg > 1 ? avg / 1000 : avg;

      if (result.teamERA === undefined) console.debug(`[metrics] MLB team ${teamId}: ERA unavailable from ESPN`);
      if (result.ops === undefined) console.debug(`[metrics] MLB team ${teamId}: OPS unavailable from ESPN`);
    }

    if (sport === "NHL") {
      // Save percentage
      const svDirect =
        statMap["savepct"] ??
        statMap["savepercentage"] ??
        statMap["savespct"] ??
        statMap["goaliespct"] ??
        statMap["savepercent"];
      if (svDirect !== undefined) result.savePercentage = svDirect > 1 ? svDirect / 100 : svDirect;

      // Power play %
      const ppDirect =
        statMap["powerplaypct"] ??
        statMap["powerplaygoalspct"] ??
        statMap["powerplaygoalpercentage"] ??
        statMap["ppg%"] ??
        statMap["ppp"];
      if (ppDirect !== undefined) result.powerPlayPct = ppDirect > 1 ? ppDirect / 100 : ppDirect;

      // Penalty kill %
      const pkDirect =
        statMap["penaltykillpct"] ??
        statMap["penaltykillpercentage"] ??
        statMap["penaltykill"] ??
        statMap["pkp"];
      if (pkDirect !== undefined) result.penaltyKillPct = pkDirect > 1 ? pkDirect / 100 : pkDirect;

      // Shots per game
      result.shotsPerGame =
        statMap["shotspergame"] ??
        statMap["shots"] ??
        statMap["shotsongaol"] ??
        undefined;

      if (result.savePercentage === undefined) console.debug(`[metrics] NHL team ${teamId}: savePercentage unavailable from ESPN`);
      if (result.powerPlayPct === undefined) console.debug(`[metrics] NHL team ${teamId}: powerPlayPct unavailable from ESPN`);
    }

    advancedMetricsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return defaultAdvancedMetrics();
  }
}

// ─── Starting Lineup ─────────────────────────────────────────────────────────

export interface LineupPlayer {
  name: string;
  position: string;
  isConfirmed: boolean; // true = from ESPN's probables API; false = inferred from roster
  era?: number;    // MLB pitchers only
  record?: string; // MLB pitchers: "W-L" string
}

export interface StartingLineup {
  sport: string;
  starters: LineupPlayer[];
  // MLB-specific: the confirmed probable starting pitcher if available
  startingPitcher?: LineupPlayer;
}

const LINEUP_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const lineupCache = new LRUCache<string, { data: StartingLineup | null; timestamp: number }>({ max: 200 });

/**
 * Attempt to fetch the probable starting lineup for a team on a given game date.
 *
 * Strategy by sport:
 *  - MLB: scrape the day's scoreboard for this team and extract competitors[].probables
 *         (the ESPN probable starting pitcher field). Falls back to the SP with the
 *         best ERA from the roster if probables aren't listed.
 *  - NHL: extract all Goalies from the roster; first active goalie = probable starter.
 *  - NBA: extract Guards/Forwards from the roster as unconfirmed starters.
 *  - NFL: extract skill-position starters (QB, WR1, RB) from the roster.
 *
 * Returns null if ESPN returns no usable data — callers must handle null gracefully.
 * Never throws.
 */
export async function fetchStartingLineup(
  teamId: string,
  sport: string,
  gameDate: Date = new Date()
): Promise<StartingLineup | null> {
  const dateStr = gameDate.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const cacheKey = `lineup-${teamId}-${sport}-${dateStr}`;
  const cached = lineupCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < LINEUP_CACHE_TTL_MS) {
    return cached.data;
  }

  const sportPath = ESPN_SPORT_PATHS[sport];
  if (!sportPath) {
    lineupCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }

  try {
    let result: StartingLineup | null = null;

    if (sport === "MLB") {
      result = await fetchMLBLineup(teamId, sportPath, dateStr);
    } else {
      result = await fetchRosterLineup(teamId, sportPath, sport);
    }

    lineupCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    lineupCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * For MLB: hit the day's scoreboard and find this team's probable starting pitcher.
 * ESPN exposes competitors[].probables with ERA and W-L record pre-game.
 */
async function fetchMLBLineup(
  teamId: string,
  sportPath: string,
  dateStr: string
): Promise<StartingLineup | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${dateStr}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;

  const data = (await response.json()) as any;
  const events: any[] = data?.events ?? [];
  console.log(`[lineup] MLB scoreboard for ${dateStr}: ${events.length} events found`);

  for (const event of events) {
    const competitions: any[] = event?.competitions ?? [];
    for (const comp of competitions) {
      const competitors: any[] = comp?.competitors ?? [];
      const teamComp = competitors.find((c: any) => String(c?.team?.id) === String(teamId));
      if (!teamComp) continue;

      // ESPN puts probables as an array inside each competitor
      const probables: any[] = teamComp?.probables ?? [];
      if (probables.length > 0) {
        console.log(`[lineup] Team ${teamId}: ${probables.length} probables found — ${JSON.stringify(probables[0]?.athlete?.displayName ?? probables[0]?.displayName ?? 'unknown')}`);
      } else {
        console.log(`[lineup] Team ${teamId}: NO probables in competitor object. Keys: ${Object.keys(teamComp ?? {}).join(', ')}`);
      }
      const probableEntry = probables.find(
        (p: any) =>
          (p?.name ?? "").toLowerCase().includes("probable") ||
          (p?.displayName ?? "").toLowerCase().includes("pitcher")
      ) ?? probables[0];

      if (!probableEntry) continue;

      const athlete = probableEntry?.athlete ?? probableEntry;
      const name: string =
        athlete?.displayName ?? athlete?.fullName ?? athlete?.name ?? "Unknown";
      const position: string =
        athlete?.position?.abbreviation ?? athlete?.position?.name ?? "SP";

      // Extract ERA from statistics array
      const stats: any[] = probableEntry?.statistics ?? [];
      const eraStat = stats.find(
        (s: any) => (s?.name ?? "").toLowerCase() === "era"
      );
      const era = eraStat?.value !== undefined ? Number(eraStat.value) : undefined;
      const record: string | undefined = probableEntry?.record ?? undefined;

      const pitcher: LineupPlayer = {
        name,
        position,
        isConfirmed: true,
        era,
        record,
      };

      return {
        sport: "MLB",
        starters: [pitcher],
        startingPitcher: pitcher,
      };
    }
  }

  return null; // Game not found on scoreboard for this date
}

/**
 * For NHL/NBA/NFL: extract key positional starters from the team roster.
 * No ESPN API provides confirmed lineup pre-game for these sports, so all
 * starters are marked isConfirmed: false (inferred from roster).
 */
async function fetchRosterLineup(
  teamId: string,
  sportPath: string,
  sport: string
): Promise<StartingLineup | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamId}/roster`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;

  const data = (await response.json()) as any;

  // Roster data: top-level `athletes` array (sometimes grouped by position group)
  let athletes: any[] = [];
  if (Array.isArray(data?.athletes)) {
    // Flat array
    if (data.athletes.length > 0 && data.athletes[0]?.items) {
      // Grouped format: [{ position: "Offense", items: [...] }]
      for (const group of data.athletes) {
        athletes.push(...(group?.items ?? []));
      }
    } else {
      athletes = data.athletes;
    }
  }

  if (athletes.length === 0) return null;

  // Filter to active (non-injured-out) players
  const active = athletes.filter((a: any) => {
    const statusName: string = (a?.status?.name ?? a?.status ?? "").toLowerCase();
    return !statusName.includes("out") && !statusName.includes("injured");
  });

  const starters: LineupPlayer[] = [];

  if (sport === "NHL") {
    // Find goalies (G) — first active goalie listed is probable starter
    const goalies = active.filter(
      (a: any) =>
        (a?.position?.abbreviation ?? a?.position?.name ?? "").toUpperCase() === "G"
    );
    for (const g of goalies.slice(0, 2)) {
      starters.push({
        name: g?.displayName ?? g?.fullName ?? "Unknown",
        position: "G",
        isConfirmed: false,
      });
    }
  } else if (sport === "NFL" || sport === "NCAAF") {
    // Key positions: QB (most important), then one WR and one RB
    const positionOrder = ["QB", "WR", "RB", "TE"];
    for (const pos of positionOrder) {
      const player = active.find(
        (a: any) => (a?.position?.abbreviation ?? "").toUpperCase() === pos
      );
      if (player) {
        starters.push({
          name: player?.displayName ?? player?.fullName ?? "Unknown",
          position: pos,
          isConfirmed: pos === "QB", // QB is effectively confirmed as the presumed starter
        });
      }
    }
  } else if (sport === "NBA" || sport === "NCAAB") {
    // Key positions: PG, SG, SF, PF, C (5 starters)
    const positionOrder = ["PG", "SG", "SF", "PF", "C"];
    for (const pos of positionOrder) {
      const player = active.find(
        (a: any) =>
          (a?.position?.abbreviation ?? a?.position?.name ?? "").toUpperCase() === pos
      );
      if (player) {
        starters.push({
          name: player?.displayName ?? player?.fullName ?? "Unknown",
          position: pos,
          isConfirmed: false,
        });
      }
    }
  }

  if (starters.length === 0) return null;

  return { sport, starters };
}

// ─── Weather ─────────────────────────────────────────────────────────────────

export interface WeatherData {
  temperature: number;    // Fahrenheit
  windSpeed: number;      // mph
  precipitation: number;  // probability 0–1
  isDomed: boolean;       // true = indoor venue, skip weather fetch
}

const WEATHER_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const weatherCache = new LRUCache<string, { data: WeatherData | null; timestamp: number }>({ max: 100 });

// Outdoor sports that benefit from weather data
const OUTDOOR_SPORTS = new Set(["NFL", "NCAAF", "MLB", "MLS", "EPL"]);

// Indoor sports — always return isDomed: true
const INDOOR_SPORTS = new Set(["NBA", "NHL", "NCAAB"]);

const VENUE_COORDS: Record<string, { lat: number; lng: number }> = {
  // NFL stadiums
  "arrowhead stadium": { lat: 39.0489, lng: -94.4839 },
  "lambeau field": { lat: 44.5013, lng: -88.0622 },
  "soldier field": { lat: 41.8623, lng: -87.6167 },
  "gillette stadium": { lat: 42.0909, lng: -71.2643 },
  "metlife stadium": { lat: 40.8128, lng: -74.0742 },
  "lincoln financial field": { lat: 39.9008, lng: -75.1675 },
  "m&t bank stadium": { lat: 39.2780, lng: -76.6227 },
  "bank of america stadium": { lat: 35.2258, lng: -80.8528 },
  "nissan stadium": { lat: 36.1665, lng: -86.7713 },
  "firstenergy stadium": { lat: 41.5061, lng: -81.6995 },
  "paycor stadium": { lat: 39.0955, lng: -84.5160 },
  "heinz field": { lat: 40.4468, lng: -80.0158 },
  "acrisure stadium": { lat: 40.4468, lng: -80.0158 },
  "highmark stadium": { lat: 42.7738, lng: -78.7870 },
  "hard rock stadium": { lat: 25.9580, lng: -80.2388 },
  "raymond james stadium": { lat: 27.9759, lng: -82.5033 },
  "tiaa bank field": { lat: 30.3239, lng: -81.6373 },
  "empower field at mile high": { lat: 39.7439, lng: -105.0201 },
  "levi's stadium": { lat: 37.4032, lng: -121.9698 },
  "sofi stadium": { lat: 33.9535, lng: -118.3392 },
  "state farm stadium": { lat: 33.5276, lng: -112.2626 },
  "dignity health sports park": { lat: 33.8644, lng: -118.2611 },
  "lumen field": { lat: 47.5952, lng: -122.3316 },
  "allegiant stadium": { lat: 36.0909, lng: -115.1833 },
  "nrg stadium": { lat: 29.6847, lng: -95.4107 },
  "at&t stadium": { lat: 32.7480, lng: -97.0930 },
  // MLB stadiums
  "fenway park": { lat: 42.3467, lng: -71.0972 },
  "yankee stadium": { lat: 40.8296, lng: -73.9262 },
  "wrigley field": { lat: 41.9484, lng: -87.6553 },
  "dodger stadium": { lat: 34.0739, lng: -118.2400 },
  "oracle park": { lat: 37.7786, lng: -122.3893 },
  "petco park": { lat: 32.7073, lng: -117.1566 },
  "t-mobile park": { lat: 47.5914, lng: -122.3325 },
  "camden yards": { lat: 39.2839, lng: -76.6216 },
  "progressive field": { lat: 41.4962, lng: -81.6852 },
  "pnc park": { lat: 40.4469, lng: -80.0057 },
  "busch stadium": { lat: 38.6226, lng: -90.1928 },
  "great american ball park": { lat: 39.0975, lng: -84.5064 },
  "truist park": { lat: 33.8908, lng: -84.4678 },
  "citizens bank park": { lat: 39.9061, lng: -75.1665 },
  "citi field": { lat: 40.7571, lng: -73.8458 },
  "nationals park": { lat: 38.8730, lng: -77.0074 },
};

/**
 * Fetch weather data for a game venue and date using Open-Meteo's free API.
 * Returns null if weather data is unavailable (unknown venue, network error, etc.)
 * Returns isDomed: true for indoor sports or explicitly indoor venues.
 * Never throws — always returns null on any error.
 */
export async function fetchGameWeather(
  venueName: string,
  gameDate: Date,
  sport: string,
  isIndoor?: boolean
): Promise<WeatherData | null> {
  try {
    // Indoor sports always return domed result immediately
    if (INDOOR_SPORTS.has(sport)) {
      return { temperature: 70, windSpeed: 0, precipitation: 0, isDomed: true };
    }

    // Explicit indoor flag
    if (isIndoor === true) {
      return { temperature: 70, windSpeed: 0, precipitation: 0, isDomed: true };
    }

    // Only fetch for outdoor sports
    if (!OUTDOOR_SPORTS.has(sport)) {
      return { temperature: 70, windSpeed: 0, precipitation: 0, isDomed: true };
    }

    const cacheKey = `weather-${venueName.toLowerCase().replace(/\s+/g, "-")}-${gameDate.toISOString().slice(0, 13)}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < WEATHER_CACHE_TTL_MS) {
      return cached.data;
    }

    // Lookup venue coordinates
    const venueNormalized = venueName.toLowerCase().trim();
    let coords = VENUE_COORDS[venueNormalized];

    // If not found in mapping, try geocoding with city name extracted from venue
    if (!coords) {
      // Extract last 2 words as city name heuristic
      const words = venueNormalized.split(/\s+/).filter(Boolean);
      const cityName = words.length >= 2 ? words.slice(-2).join(" ") : words[0] ?? venueName;
      try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;
        const geoResponse = await fetch(geoUrl, { signal: AbortSignal.timeout(5000) });
        if (geoResponse.ok) {
          const geoData = (await geoResponse.json()) as { results?: Array<{ latitude: number; longitude: number }> };
          const first = geoData.results?.[0];
          if (first) {
            coords = { lat: first.latitude, lng: first.longitude };
          }
        }
      } catch {
        // geocoding failed — fall through to null
      }
    }

    if (!coords) {
      weatherCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    // Fetch weather forecast from Open-Meteo
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}&hourly=temperature_2m,precipitation_probability,windspeed_10m&wind_speed_unit=mph&temperature_unit=fahrenheit&forecast_days=3&timezone=auto`;
    const weatherResponse = await fetch(weatherUrl, { signal: AbortSignal.timeout(5000) });
    if (!weatherResponse.ok) {
      weatherCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const weatherData = (await weatherResponse.json()) as {
      hourly?: {
        time: string[];
        temperature_2m: number[];
        precipitation_probability: number[];
        windspeed_10m: number[];
      };
    };

    const hourly = weatherData.hourly;
    if (!hourly || !hourly.time || hourly.time.length === 0) {
      weatherCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    // Find the hour index closest to game time
    const gameTimestamp = gameDate.getTime();
    let closestIdx = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < hourly.time.length; i++) {
      const hourTimestamp = new Date(hourly.time[i]!).getTime();
      const diff = Math.abs(hourTimestamp - gameTimestamp);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
    }

    const temperature = hourly.temperature_2m[closestIdx] ?? 70;
    const windSpeed = hourly.windspeed_10m[closestIdx] ?? 0;
    const precipProb = hourly.precipitation_probability[closestIdx] ?? 0;

    const result: WeatherData = {
      temperature,
      windSpeed,
      precipitation: precipProb / 100,
      isDomed: false,
    };

    weatherCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return null;
  }
}

export async function fetchTeamInjuries(
  teamId: string,
  sport: string
): Promise<TeamInjuryReport> {
  const cacheKey = `injuries-${teamId}-${sport}`;
  const cached = injuryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < INJURY_CACHE_TTL_MS) {
    return cached.data;
  }

  const sportPath = ESPN_SPORT_PATHS[sport];
  if (!sportPath) return defaultInjuryReport();

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamId}/injuries`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return defaultInjuryReport();

    const data = (await response.json()) as any;

    // ESPN returns { injuries: [...] } or just an array at root
    const injuryList: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data.injuries)
      ? data.injuries
      : Array.isArray(data.items)
      ? data.items
      : [];

    const out: TeamInjuryReport["out"] = [];
    const doubtful: TeamInjuryReport["doubtful"] = [];
    const questionable: TeamInjuryReport["questionable"] = [];

    for (const item of injuryList) {
      const status: string = (item.status ?? item.type ?? "").toLowerCase();
      const name: string =
        item.athlete?.displayName ?? item.athlete?.fullName ?? item.name ?? "Unknown";
      const position: string =
        item.athlete?.position?.abbreviation ??
        item.athlete?.position?.name ??
        item.position ??
        "";
      const detail: string =
        item.longComment ?? item.shortComment ?? item.details ?? item.detail ?? "";

      const entry = { name, position, detail };

      if (status.includes("out")) {
        out.push(entry);
      } else if (status.includes("doubtful")) {
        doubtful.push(entry);
      } else if (status.includes("questionable")) {
        questionable.push(entry);
      }
    }

    const result: TeamInjuryReport = {
      out,
      doubtful,
      questionable,
      totalOut: out.length,
      totalDoubtful: doubtful.length,
      totalQuestionable: questionable.length,
    };

    injuryCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return defaultInjuryReport();
  }
}

// ─── Simple Rating System (SRS) ──────────────────────────────────────────────
// SRS = average scoring margin + average opponent SRS (iterative convergence).
// Captures both scoring dominance and opponent quality in a single number.

export interface SRSRecord {
  teamId: string;
  srs: number;          // final SRS value (positive = above average)
  avgMargin: number;    // raw scoring margin component
  gamesPlayed: number;
}

/** Input shape — same as fetchTeamSeasonResults output plus teamId tag */
export type GameResultForSRS = {
  teamId: string;
  opponentId: string;
  teamScore?: number;
  oppScore?: number;
};

// Daily SRS cache: key = "{sport}:{YYYY-MM-DD}"
const srsCache = new LRUCache<string, Map<string, SRSRecord>>({ max: 16, ttl: 24 * 60 * 60 * 1000 });

/**
 * Compute SRS for all teams present in the game log using 10-iteration convergence.
 * Games without scores are ignored (no default imputation — early season graceful degradation).
 */
export function computeSRS(games: GameResultForSRS[]): Map<string, SRSRecord> {
  // Build per-team margin lists and opponent lists
  const margins  = new Map<string, number[]>();   // teamId → list of (teamScore - oppScore)
  const opponents = new Map<string, string[]>();   // teamId → list of opponentIds

  for (const g of games) {
    if (g.teamScore === undefined || g.oppScore === undefined) continue;
    const margin = g.teamScore - g.oppScore;

    if (!margins.has(g.teamId))    margins.set(g.teamId,    []);
    if (!opponents.has(g.teamId))  opponents.set(g.teamId,  []);

    margins.get(g.teamId)!.push(margin);
    opponents.get(g.teamId)!.push(g.opponentId);
  }

  const teamIds = [...margins.keys()];
  if (teamIds.length === 0) return new Map();

  // Average margin per team
  const avgMargins = new Map<string, number>();
  for (const id of teamIds) {
    const ms = margins.get(id)!;
    avgMargins.set(id, ms.reduce((s, m) => s + m, 0) / ms.length);
  }

  // Iterative SRS: start at 0, converge in 10 passes
  let srs = new Map<string, number>(teamIds.map((id) => [id, 0]));

  for (let iter = 0; iter < 10; iter++) {
    const next = new Map<string, number>();
    for (const id of teamIds) {
      const opps = opponents.get(id)!;
      const avgOppSRS = opps.length === 0
        ? 0
        : opps.reduce((s, oppId) => s + (srs.get(oppId) ?? 0), 0) / opps.length;
      next.set(id, (avgMargins.get(id) ?? 0) + avgOppSRS);
    }
    srs = next;
  }

  // Package results
  const result = new Map<string, SRSRecord>();
  for (const id of teamIds) {
    result.set(id, {
      teamId: id,
      srs: srs.get(id) ?? 0,
      avgMargin: avgMargins.get(id) ?? 0,
      gamesPlayed: margins.get(id)!.length,
    });
  }
  return result;
}

/**
 * Get (or compute + cache) SRS ratings for a sport on the current day.
 * Pass all available game results for maximum coverage.
 */
export function getSRSRatings(sport: string, games: GameResultForSRS[]): Map<string, SRSRecord> {
  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const cacheKey = `${sport}:${dateKey}`;

  const cached = srsCache.get(cacheKey);
  if (cached) return cached;

  const computed = computeSRS(games);
  srsCache.set(cacheKey, computed);
  return computed;
}

/**
 * Convert raw SRS value to a 0–1 SoS-equivalent score for blending with
 * the existing win-percentage-based SoS.  Uses a sigmoid centred at 0 with
 * sport-calibrated scale so typical SRS ranges map to 0.2–0.8.
 */
export function srsToBlendfactor(srs: number, sport: string): number {
  // Sport-specific scale: how many SRS points map to a ±1 sigmoid input
  const scale: Record<string, number> = {
    NFL: 7,   // typical NFL SRS range ≈ ±10
    NCAAF: 10,
    NBA: 8,
    NCAAB: 10,
    MLB: 1.5,
    NHL: 1.5,
    MLS: 1.5,
    EPL: 1.5,
  };
  const s = scale[sport] ?? 6;
  // sigmoid(srs / s) → 0–1 centred at 0.5 when srs = 0
  return 1 / (1 + Math.exp(-srs / s));
}

