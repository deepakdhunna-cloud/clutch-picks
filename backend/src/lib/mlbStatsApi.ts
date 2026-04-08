/**
 * MLB StatsAPI integration for richer pitcher quality data.
 *
 * ESPN's probables endpoint often returns pitcher names without ERA, and when
 * it does include ERA, that's the only stat available. MLB StatsAPI is free,
 * reliable, and exposes full pitching metrics (ERA, FIP, WHIP, K/9, BB/9,
 * recent game log) which give us a much stronger composite pitcher quality
 * signal for the MLB startingPitcher factor.
 *
 * Base URL: https://statsapi.mlb.com/api/v1
 * No auth required. Generous rate limits for app-sized traffic.
 */

import { LRUCache } from "lru-cache";

// ─── ESPN team ID → MLB StatsAPI team ID ───────────────────────────────────
// Both sources have 30 MLB teams with different ID schemes, so we keep a
// static mapping. ESPN IDs verified from live prod; MLB IDs are standard
// and documented at https://statsapi.mlb.com/api/v1/teams?sportId=1
const ESPN_TO_MLB_TEAM_ID: Record<number, number> = {
  1:  110, // Baltimore Orioles
  2:  111, // Boston Red Sox
  3:  108, // Los Angeles Angels
  4:  145, // Chicago White Sox
  5:  114, // Cleveland Guardians
  6:  116, // Detroit Tigers
  7:  118, // Kansas City Royals
  8:  158, // Milwaukee Brewers
  9:  142, // Minnesota Twins
  10: 147, // New York Yankees
  11: 133, // Oakland Athletics
  12: 136, // Seattle Mariners
  13: 140, // Texas Rangers
  14: 141, // Toronto Blue Jays
  15: 144, // Atlanta Braves
  16: 112, // Chicago Cubs
  17: 113, // Cincinnati Reds
  18: 117, // Houston Astros
  19: 119, // Los Angeles Dodgers
  20: 120, // Washington Nationals
  21: 121, // New York Mets
  22: 143, // Philadelphia Phillies
  23: 134, // Pittsburgh Pirates
  24: 138, // St. Louis Cardinals
  25: 135, // San Diego Padres
  26: 137, // San Francisco Giants
  27: 115, // Colorado Rockies
  28: 146, // Miami Marlins
  29: 109, // Arizona Diamondbacks
  30: 139, // Tampa Bay Rays
};

const MLB_TO_ESPN_TEAM_ID: Record<number, number> = Object.fromEntries(
  Object.entries(ESPN_TO_MLB_TEAM_ID).map(([espn, mlb]) => [mlb, Number(espn)])
);

export function getMLBTeamIdFromESPN(espnId: number | string): number | null {
  const id = typeof espnId === "string" ? parseInt(espnId, 10) : espnId;
  if (Number.isNaN(id)) return null;
  return ESPN_TO_MLB_TEAM_ID[id] ?? null;
}

// ─── Types ──────────────────────────────────────────────────────────────────
export interface MLBPitcherQuality {
  mlbPersonId: number;
  name: string;
  handedness?: "L" | "R";
  seasonEra?: number;
  seasonFip?: number;         // Fielding Independent Pitching — more predictive than ERA
  seasonWhip?: number;
  seasonK9?: number;          // Strikeouts per 9 innings
  seasonBb9?: number;         // Walks per 9 innings
  seasonInningsPitched?: number;
  seasonGamesStarted?: number;
  seasonWins?: number;
  seasonLosses?: number;
  recent5Era?: number;        // ERA over last 5 starts
  recent5WarningFlag?: boolean; // recent ERA > season ERA + 1.5 runs
}

// ─── Caches ─────────────────────────────────────────────────────────────────
const DAILY_PROBABLES_TTL_MS = 60 * 60 * 1000;   // 1 hour
const PITCHER_STATS_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const dailyProbablesCache = new LRUCache<string, { data: Map<number, MLBPitcherQuality>; timestamp: number }>({ max: 14 });
const pitcherStatsCache = new LRUCache<string, { data: MLBPitcherQuality; timestamp: number }>({ max: 200 });

// ─── Fetch daily probable pitchers ──────────────────────────────────────────
/**
 * Fetch all MLB probable pitchers for a given date, keyed by ESPN team ID.
 * Each probable pitcher is enriched with full season stats via a follow-up
 * call to the /people/{id}/stats endpoint (batched in parallel).
 *
 * @param dateStr Date in YYYY-MM-DD format
 * @returns Map<espnTeamId, MLBPitcherQuality>. Empty map on failure (never throws).
 */
export async function fetchMLBDailyProbables(dateStr: string): Promise<Map<number, MLBPitcherQuality>> {
  const cached = dailyProbablesCache.get(dateStr);
  if (cached && Date.now() - cached.timestamp < DAILY_PROBABLES_TTL_MS) {
    return cached.data;
  }

  const result = new Map<number, MLBPitcherQuality>();

  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=probablePitcher`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      console.warn(`[mlbStatsApi] schedule fetch returned ${response.status} for ${dateStr}`);
      dailyProbablesCache.set(dateStr, { data: result, timestamp: Date.now() });
      return result;
    }

    const data = (await response.json()) as any;
    const dates: any[] = data?.dates ?? [];
    const season = new Date(dateStr).getFullYear();

    // Collect all (espnTeamId, personId, name) tuples first, then batch-fetch stats in parallel
    const tuples: Array<{ espnTeamId: number; personId: number; name: string }> = [];
    for (const dateEntry of dates) {
      const games: any[] = dateEntry?.games ?? [];
      for (const game of games) {
        const homeMlbTeamId: number | undefined = game?.teams?.home?.team?.id;
        const awayMlbTeamId: number | undefined = game?.teams?.away?.team?.id;
        const homeProbable = game?.teams?.home?.probablePitcher;
        const awayProbable = game?.teams?.away?.probablePitcher;
        const homeEspnId = homeMlbTeamId != null ? MLB_TO_ESPN_TEAM_ID[homeMlbTeamId] : undefined;
        const awayEspnId = awayMlbTeamId != null ? MLB_TO_ESPN_TEAM_ID[awayMlbTeamId] : undefined;
        if (homeProbable?.id && homeEspnId !== undefined) {
          tuples.push({ espnTeamId: homeEspnId, personId: homeProbable.id, name: homeProbable.fullName ?? `Pitcher ${homeProbable.id}` });
        }
        if (awayProbable?.id && awayEspnId !== undefined) {
          tuples.push({ espnTeamId: awayEspnId, personId: awayProbable.id, name: awayProbable.fullName ?? `Pitcher ${awayProbable.id}` });
        }
      }
    }

    // Parallel stat fetches — much faster than sequential for 10+ pitchers
    const enriched = await Promise.all(
      tuples.map(async (t) => ({
        espnTeamId: t.espnTeamId,
        quality: await fetchMLBPitcherStats(t.personId, season, t.name),
      }))
    );

    for (const { espnTeamId, quality } of enriched) {
      if (quality) result.set(espnTeamId, quality);
    }

    console.log(`[mlbStatsApi] Fetched ${result.size} probables for ${dateStr} (${tuples.length} tuples)`);
  } catch (err) {
    console.warn(`[mlbStatsApi] Failed to fetch daily probables for ${dateStr}:`, err instanceof Error ? err.message : String(err));
  }

  dailyProbablesCache.set(dateStr, { data: result, timestamp: Date.now() });
  return result;
}

// ─── Fetch individual pitcher stats ─────────────────────────────────────────
export async function fetchMLBPitcherStats(
  personId: number,
  season: number,
  fallbackName?: string
): Promise<MLBPitcherQuality | null> {
  const cacheKey = `${personId}-${season}`;
  const cached = pitcherStatsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PITCHER_STATS_TTL_MS) {
    return cached.data;
  }

  try {
    const [seasonRes, gameLogRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${personId}/stats?stats=season&group=pitching&season=${season}`, { signal: AbortSignal.timeout(8000) }),
      fetch(`https://statsapi.mlb.com/api/v1/people/${personId}/stats?stats=gameLog&group=pitching&season=${season}`, { signal: AbortSignal.timeout(8000) }),
    ]);

    if (!seasonRes.ok && !gameLogRes.ok) return null;

    const seasonData = seasonRes.ok ? ((await seasonRes.json()) as any) : null;
    const gameLogData = gameLogRes.ok ? ((await gameLogRes.json()) as any) : null;

    const seasonSplit = seasonData?.stats?.[0]?.splits?.[0]?.stat;
    const gameLogSplits: any[] = gameLogData?.stats?.[0]?.splits ?? [];

    const seasonEra = seasonSplit?.era !== undefined ? parseFloat(seasonSplit.era) : undefined;
    const seasonWhip = seasonSplit?.whip !== undefined ? parseFloat(seasonSplit.whip) : undefined;
    const seasonInningsPitched = seasonSplit?.inningsPitched !== undefined ? parseFloat(seasonSplit.inningsPitched) : undefined;
    const seasonGamesStarted = seasonSplit?.gamesStarted !== undefined ? Number(seasonSplit.gamesStarted) : undefined;
    const seasonStrikeouts = seasonSplit?.strikeOuts !== undefined ? Number(seasonSplit.strikeOuts) : undefined;
    const seasonWalks = seasonSplit?.baseOnBalls !== undefined ? Number(seasonSplit.baseOnBalls) : undefined;
    const seasonHomeRuns = seasonSplit?.homeRuns !== undefined ? Number(seasonSplit.homeRuns) : undefined;
    const seasonWins = seasonSplit?.wins !== undefined ? Number(seasonSplit.wins) : undefined;
    const seasonLosses = seasonSplit?.losses !== undefined ? Number(seasonSplit.losses) : undefined;

    const seasonK9 = seasonInningsPitched !== undefined && seasonInningsPitched > 0 && seasonStrikeouts !== undefined
      ? (seasonStrikeouts * 9) / seasonInningsPitched
      : undefined;
    const seasonBb9 = seasonInningsPitched !== undefined && seasonInningsPitched > 0 && seasonWalks !== undefined
      ? (seasonWalks * 9) / seasonInningsPitched
      : undefined;

    // Compute FIP: ((13*HR + 3*BB - 2*K) / IP) + constant
    // FIP constant varies by year; 3.10 is a reasonable modern approximation.
    const FIP_CONSTANT = 3.10;
    const seasonFip = seasonInningsPitched !== undefined && seasonInningsPitched > 0
      && seasonHomeRuns !== undefined && seasonWalks !== undefined && seasonStrikeouts !== undefined
      ? ((13 * seasonHomeRuns + 3 * seasonWalks - 2 * seasonStrikeouts) / seasonInningsPitched) + FIP_CONSTANT
      : undefined;

    // Recent 5 starts ERA from game log (filter to starts only)
    const recentStarts = gameLogSplits
      .filter((s: any) => Number(s?.stat?.gamesStarted ?? 0) === 1)
      .slice(-5);
    let recent5Era: number | undefined;
    if (recentStarts.length >= 2) {
      let totalEarnedRuns = 0;
      let totalInnings = 0;
      for (const start of recentStarts) {
        const er = Number(start?.stat?.earnedRuns ?? 0);
        const ip = parseFloat(start?.stat?.inningsPitched ?? "0");
        totalEarnedRuns += er;
        totalInnings += ip;
      }
      if (totalInnings > 0) {
        recent5Era = (totalEarnedRuns * 9) / totalInnings;
      }
    }

    const recent5WarningFlag = recent5Era !== undefined && seasonEra !== undefined
      && recent5Era - seasonEra > 1.5;

    const quality: MLBPitcherQuality = {
      mlbPersonId: personId,
      name: fallbackName ?? `Pitcher ${personId}`,
      seasonEra,
      seasonFip: seasonFip !== undefined ? Math.round(seasonFip * 100) / 100 : undefined,
      seasonWhip,
      seasonK9: seasonK9 !== undefined ? Math.round(seasonK9 * 100) / 100 : undefined,
      seasonBb9: seasonBb9 !== undefined ? Math.round(seasonBb9 * 100) / 100 : undefined,
      seasonInningsPitched,
      seasonGamesStarted,
      seasonWins,
      seasonLosses,
      recent5Era: recent5Era !== undefined ? Math.round(recent5Era * 100) / 100 : undefined,
      recent5WarningFlag,
    };

    pitcherStatsCache.set(cacheKey, { data: quality, timestamp: Date.now() });
    return quality;
  } catch (err) {
    console.warn(`[mlbStatsApi] Failed to fetch stats for pitcher ${personId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── Composite quality score ────────────────────────────────────────────────
/**
 * Compute a single composite quality score for a pitcher — higher is better.
 * Combines ERA, FIP, WHIP, K/9, BB/9, and recent form.
 *
 * Returns a score roughly in the range [0, 10] where:
 *   - 5.0 = league average
 *   - 6.5+ = well above average (top 20% of starters)
 *   - 8.0+ = elite (top 5%)
 *   - 3.5- = well below average
 *
 * Uses only the stats that are available; partial data still produces a score.
 * Returns 5.0 (neutral) if no data at all.
 */
export function computePitcherQualityScore(p: MLBPitcherQuality): number {
  let score = 5.0;
  let components = 0;

  if (p.seasonEra !== undefined) {
    score += (4.20 - p.seasonEra) * 1.4;
    components++;
  }
  if (p.seasonFip !== undefined) {
    score += (4.20 - p.seasonFip) * 1.8;
    components++;
  }
  if (p.seasonWhip !== undefined) {
    score += (1.30 - p.seasonWhip) * 5;
    components++;
  }
  if (p.seasonK9 !== undefined) {
    score += (p.seasonK9 - 8.8) * 0.2;
    components++;
  }
  if (p.seasonBb9 !== undefined) {
    score += (3.1 - p.seasonBb9) * 0.4;
    components++;
  }

  // Recent 5-start form: shift 30% of season-ERA weight onto recent ERA
  if (p.recent5Era !== undefined && p.seasonEra !== undefined) {
    const recentSwing = (4.20 - p.recent5Era) * 1.4 * 0.3;
    const seasonRollback = (4.20 - p.seasonEra) * 1.4 * -0.3;
    score += recentSwing + seasonRollback;
  }

  if (components === 0) return 5.0;
  return Math.max(0, Math.min(10, score));
}
