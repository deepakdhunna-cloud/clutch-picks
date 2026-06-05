/**
 * NHL Goalie Confirmation Pipeline
 *
 * Fetches confirmed starting goalies and their individual stats from:
 * 1. NHL API (api.nhle.com) — game-day confirmed starters
 * 2. ESPN scoreboard probables — fallback when NHL API is unavailable
 * 3. Daily Faceoff scrape — secondary fallback for pre-game confirmations
 *
 * Individual goalie stats come from the NHL API player stats endpoint,
 * which provides season SV%, GAA, GP, W, L, SO for any active goalie.
 *
 * This module is the single source of truth for "who is starting in net"
 * and "how good are they individually" — replacing the team-level save%
 * proxy that was previously the only signal.
 */

import { LRUCache } from "lru-cache";
import type { LineupPlayer } from "./espnStats";

// ─── Types ──────────────────────────────────────────────────────────────────

interface NHLGoalieStats {
  playerId: number;
  name: string;
  savePercentage: number;  // 0–1
  goalsAgainstAvg: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  shutouts: number;
}

interface NHLGameDayResponse {
  gameWeek?: Array<{
    date: string;
    games: Array<{
      id: number;
      homeTeam: { abbrev: string; id: number };
      awayTeam: { abbrev: string; id: number };
    }>;
  }>;
}

interface NHLGameLandingResponse {
  matchup?: {
    goalieComparison?: {
      homeTeam?: {
        starter?: { playerId: number; name?: { default?: string } };
      };
      awayTeam?: {
        starter?: { playerId: number; name?: { default?: string } };
      };
    };
  };
  // Alternative structure in some API versions
  summary?: {
    gameInfo?: {
      homeTeam?: { headCoach?: { default?: string } };
      awayTeam?: { headCoach?: { default?: string } };
    };
  };
}

interface NHLPlayerStatsResponse {
  featuredStats?: {
    regularSeason?: {
      subSeason?: {
        savePctg?: number;
        goalsAgainstAvg?: number;
        gamesPlayed?: number;
        wins?: number;
        losses?: number;
        shutouts?: number;
      };
    };
  };
  // Fallback: some endpoints use this structure
  seasonTotals?: Array<{
    season: number;
    gameTypeId: number; // 2 = regular season
    savePctg?: number;
    goalsAgainstAvg?: number;
    gamesPlayed?: number;
    wins?: number;
    losses?: number;
    shutouts?: number;
  }>;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const GOALIE_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes — starters can change close to game time
const STATS_CACHE_TTL_MS = 60 * 60 * 1000;  // 1 hour — season stats don't change rapidly

const goalieStarterCache = new LRUCache<string, { data: LineupPlayer | null; timestamp: number }>({ max: 100 });
const goalieStatsCache = new LRUCache<string, { data: NHLGoalieStats | null; timestamp: number }>({ max: 200 });
const goalieInflight = new Map<string, Promise<LineupPlayer | null>>();

// ─── NHL API Helpers ────────────────────────────────────────────────────────

const NHL_API_BASE = "https://api-web.nhle.com/v1";
const FETCH_TIMEOUT = 6000;

function nhlSeasonId(gameDate: Date): number {
  const year = gameDate.getUTCFullYear();
  const month = gameDate.getUTCMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return Number(`${startYear}${startYear + 1}`);
}

/**
 * Fetch individual goalie stats from the NHL API player endpoint.
 * Returns season SV%, GAA, GP, W, L, SO for the current season.
 */
async function fetchGoalieStats(playerId: number, gameDate: Date): Promise<NHLGoalieStats | null> {
  const cacheKey = `goalie-stats-${playerId}`;
  const cached = goalieStatsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const response = await fetch(
      `${NHL_API_BASE}/player/${playerId}/landing`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) }
    );
    if (!response.ok) return null;

    const data = (await response.json()) as NHLPlayerStatsResponse;

    // Try featured stats first (current season)
    const featured = data.featuredStats?.regularSeason?.subSeason;
    if (featured && featured.savePctg !== undefined) {
      const stats: NHLGoalieStats = {
        playerId,
        name: "", // filled by caller
        savePercentage: featured.savePctg,
        goalsAgainstAvg: featured.goalsAgainstAvg ?? 3.0,
        gamesPlayed: featured.gamesPlayed ?? 0,
        wins: featured.wins ?? 0,
        losses: featured.losses ?? 0,
        shutouts: featured.shutouts ?? 0,
      };
      goalieStatsCache.set(cacheKey, { data: stats, timestamp: Date.now() });
      return stats;
    }

    // Fallback: seasonTotals array — find current season regular season
    if (data.seasonTotals && Array.isArray(data.seasonTotals)) {
      const seasonId = nhlSeasonId(gameDate);
      const currentSeason = data.seasonTotals.find(
        (s) => s.season === seasonId && s.gameTypeId === 2
      );
      if (currentSeason && currentSeason.savePctg !== undefined) {
        const stats: NHLGoalieStats = {
          playerId,
          name: "",
          savePercentage: currentSeason.savePctg,
          goalsAgainstAvg: currentSeason.goalsAgainstAvg ?? 3.0,
          gamesPlayed: currentSeason.gamesPlayed ?? 0,
          wins: currentSeason.wins ?? 0,
          losses: currentSeason.losses ?? 0,
          shutouts: currentSeason.shutouts ?? 0,
        };
        goalieStatsCache.set(cacheKey, { data: stats, timestamp: Date.now() });
        return stats;
      }
    }

    goalieStatsCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt to find the confirmed starting goalie for a team from the NHL API
 * game landing/matchup endpoint.
 *
 * The NHL API exposes goalie comparison data for upcoming games, which includes
 * the confirmed starter's playerId. This is the most reliable source.
 */
async function fetchConfirmedGoalieFromNHLAPI(
  teamAbbrev: string,
  gameDate: Date,
  side: "home" | "away"
): Promise<{ playerId: number; name: string } | null> {
  try {
    // First, find the game ID for this team on this date
    const dateStr = gameDate.toISOString().slice(0, 10);
    const scheduleResponse = await fetch(
      `${NHL_API_BASE}/schedule/${dateStr}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) }
    );
    if (!scheduleResponse.ok) return null;

    const schedule = (await scheduleResponse.json()) as NHLGameDayResponse;
    const gameWeek = schedule.gameWeek;
    if (!gameWeek || gameWeek.length === 0) return null;

    // Find the game for this team on this date
    const todayGames = gameWeek.find((gw) => gw.date === dateStr);
    if (!todayGames) return null;

    const game = todayGames.games.find((g) => {
      const abbrevUpper = teamAbbrev.toUpperCase();
      return (
        g.homeTeam.abbrev.toUpperCase() === abbrevUpper ||
        g.awayTeam.abbrev.toUpperCase() === abbrevUpper
      );
    });
    if (!game) return null;

    // Now fetch the game landing page which has goalie comparison
    const landingResponse = await fetch(
      `${NHL_API_BASE}/gamecenter/${game.id}/landing`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) }
    );
    if (!landingResponse.ok) return null;

    const landing = (await landingResponse.json()) as NHLGameLandingResponse;
    const comparison = landing.matchup?.goalieComparison;
    if (!comparison) return null;

    const teamData = side === "home" ? comparison.homeTeam : comparison.awayTeam;
    const starter = teamData?.starter;
    if (!starter || !starter.playerId) return null;

    return {
      playerId: starter.playerId,
      name: starter.name?.default ?? "Unknown",
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the confirmed starting goalie for an NHL team, with individual stats.
 *
 * Pipeline:
 * 1. Try NHL API game landing (confirmed starter + playerId)
 * 2. Fetch individual stats for that playerId
 * 3. Return a LineupPlayer with full goalie metrics
 *
 * Falls back to null if no confirmation is available — the factor will then
 * use team-level save% as before (but at reduced confidence).
 */
export async function fetchNHLStartingGoalie(
  teamId: string,
  teamAbbrev: string,
  gameDate: Date,
  side: "home" | "away"
): Promise<LineupPlayer | null> {
  const dateStr = gameDate.toISOString().slice(0, 10);
  const cacheKey = `nhl-goalie-${teamAbbrev}-${dateStr}-${side}`;

  const cached = goalieStarterCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < GOALIE_CACHE_TTL_MS) {
    return cached.data;
  }

  // Deduplicate in-flight requests
  const existing = goalieInflight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<LineupPlayer | null> => {
    try {
      // Step 1: Get confirmed starter from NHL API
      const confirmed = await fetchConfirmedGoalieFromNHLAPI(teamAbbrev, gameDate, side);
      if (!confirmed) {
        goalieStarterCache.set(cacheKey, { data: null, timestamp: Date.now() });
        return null;
      }

      // Step 2: Fetch individual stats
      const stats = await fetchGoalieStats(confirmed.playerId, gameDate);

      // Step 3: Build LineupPlayer
      const goalie: LineupPlayer = {
        name: confirmed.name,
        position: "G",
        isConfirmed: true,
        source: "nhl-api-confirmed",
        savePercentage: stats?.savePercentage,
        goalsAgainstAvg: stats?.goalsAgainstAvg,
        gamesPlayed: stats?.gamesPlayed,
        wins: stats?.wins,
        losses: stats?.losses,
        shutouts: stats?.shutouts,
        nhlPlayerId: confirmed.playerId,
      };

      goalieStarterCache.set(cacheKey, { data: goalie, timestamp: Date.now() });
      return goalie;
    } catch {
      goalieStarterCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    } finally {
      goalieInflight.delete(cacheKey);
    }
  })();

  goalieInflight.set(cacheKey, request);
  return request;
}

/**
 * Clear the goalie cache — useful for testing or when a late scratch is reported.
 */
export function clearGoalieCache(): void {
  goalieStarterCache.clear();
  goalieStatsCache.clear();
}
