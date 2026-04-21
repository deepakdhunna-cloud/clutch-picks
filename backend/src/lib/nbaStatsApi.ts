/**
 * NBA Stats API integration for live three-point shooting data.
 *
 * ESPN doesn't expose per-game 3P% for teams, so the three-point variance
 * regression factor in prediction/factors/nba.ts was shipped dead.
 * stats.nba.com does expose this via its team game log, is free, and
 * requires no API key — just a handful of browser-style headers.
 *
 * Endpoint:
 *   https://stats.nba.com/stats/teamgamelog?TeamID={id}&Season={season}&SeasonType=Regular+Season
 *
 * Response: resultSets[0] is "TeamGameLog" with columns in .headers and
 * row data in .rowSet. Relevant columns: FG3M, FG3A (per game). We
 * compute 3P% over the last 5 games (recent) and the full season (baseline).
 */

import { LRUCache } from "lru-cache";

// ─── ESPN team ID → NBA Stats API team ID ─────────────────────────────────
// ESPN and stats.nba.com use different numeric IDs for the same franchise.
// This mapping was cross-referenced against stats.nba.com's /teams endpoint
// and ESPN's NBA team listing. All 30 teams included.
const ESPN_TO_NBA_TEAM_ID: Record<number, number> = {
  1:  1610612737, // Atlanta Hawks
  2:  1610612738, // Boston Celtics
  3:  1610612751, // Brooklyn Nets (was New Jersey Nets, ESPN id 17 historically)
  4:  1610612766, // Charlotte Hornets
  5:  1610612741, // Chicago Bulls
  6:  1610612739, // Cleveland Cavaliers
  7:  1610612742, // Dallas Mavericks
  8:  1610612743, // Denver Nuggets
  9:  1610612765, // Detroit Pistons
  10: 1610612744, // Golden State Warriors
  11: 1610612745, // Houston Rockets
  12: 1610612754, // Indiana Pacers
  13: 1610612746, // LA Clippers
  14: 1610612747, // Los Angeles Lakers
  15: 1610612763, // Memphis Grizzlies
  16: 1610612748, // Miami Heat
  17: 1610612749, // Milwaukee Bucks
  18: 1610612750, // Minnesota Timberwolves
  19: 1610612740, // New Orleans Pelicans
  20: 1610612752, // New York Knicks
  21: 1610612760, // Oklahoma City Thunder
  22: 1610612753, // Orlando Magic
  23: 1610612755, // Philadelphia 76ers
  24: 1610612756, // Phoenix Suns
  25: 1610612757, // Portland Trail Blazers
  26: 1610612758, // Sacramento Kings
  27: 1610612759, // San Antonio Spurs
  28: 1610612761, // Toronto Raptors
  29: 1610612762, // Utah Jazz
  30: 1610612764, // Washington Wizards
};

export function getNBATeamIdFromESPN(espnId: number | string): number | null {
  const id = typeof espnId === "string" ? parseInt(espnId, 10) : espnId;
  if (Number.isNaN(id)) return null;
  return ESPN_TO_NBA_TEAM_ID[id] ?? null;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TeamShootingRecent {
  recent3P: number;   // 3-point % over last 5 games (0..1)
  season3P: number;   // 3-point % over the full season (0..1)
  gamesUsed: number;  // how many recent games were actually used (≤5)
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const SHOOTING_TTL_MS = 30 * 60 * 1000; // 30 minutes
const shootingCache = new LRUCache<string, { data: TeamShootingRecent | null; timestamp: number }>({ max: 64 });

// ─── Season string helper ───────────────────────────────────────────────────
// NBA season strings are "2025-26" for the 2025-26 season (Oct 2025 – Jun 2026).
function currentNBASeasonString(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-indexed
  // Months Oct-Dec belong to the season starting that year; Jan-Sep belong to
  // the season that started the previous year.
  const startYear = m >= 9 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endShort}`;
}

// ─── Request helpers ────────────────────────────────────────────────────────

export const NBA_STATS_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  "Referer": "https://www.nba.com/",
  "Origin": "https://www.nba.com",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

const NBA_STATS_TIMEOUT_MS = 15_000; // 15s — stats.nba.com is slow from remote hosts
const NBA_STATS_MAX_RETRIES = 2;

async function fetchNBAWithRetry(url: string): Promise<Response | null> {
  const delays = [1000, 2000];
  for (let attempt = 0; attempt < NBA_STATS_MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(NBA_STATS_TIMEOUT_MS),
        headers: NBA_STATS_HEADERS,
      });
      const durationMs = Date.now() - start;

      if (!response.ok) {
        const bodyPreview = await response.text().catch(() => "(unreadable)");
        console.warn(
          `[nba-stats] attempt ${attempt + 1}/${NBA_STATS_MAX_RETRIES}: ${url} → HTTP ${response.status} (${durationMs}ms). ` +
          `Body preview: ${bodyPreview.slice(0, 200)}`,
        );
        if (attempt < NBA_STATS_MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, delays[attempt]!));
          continue;
        }
        return null;
      }

      console.log(`[nba-stats] fetch OK: teamId=${url.match(/TeamID=(\d+)/)?.[1]} (${durationMs}ms)`);
      return response;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      console.warn(
        `[nba-stats] attempt ${attempt + 1}/${NBA_STATS_MAX_RETRIES}: failed after ${durationMs}ms: ${err?.message ?? err}`,
      );
      if (attempt < NBA_STATS_MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, delays[attempt]!));
      }
    }
  }
  return null;
}

// ─── Fetcher ────────────────────────────────────────────────────────────────

/**
 * Fetch recent 3P% (last 5 games) and season 3P% for a team.
 * Returns null if the API call fails, the team has no games yet, or the
 * team ID cannot be mapped to a stats.nba.com ID.
 */
export async function fetchTeamShootingRecent(
  espnTeamId: number | string,
  season?: string,
): Promise<TeamShootingRecent | null> {
  const nbaTeamId = getNBATeamIdFromESPN(espnTeamId);
  if (nbaTeamId === null) return null;

  const seasonStr = season ?? currentNBASeasonString();
  const cacheKey = `${nbaTeamId}-${seasonStr}`;
  const cached = shootingCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SHOOTING_TTL_MS) {
    return cached.data;
  }

  const url = `https://stats.nba.com/stats/teamgamelog?TeamID=${nbaTeamId}&Season=${seasonStr}&SeasonType=Regular+Season`;

  const response = await fetchNBAWithRetry(url);
  if (!response) {
    shootingCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }

  try {
    const data = (await response.json()) as {
      resultSets?: Array<{ name?: string; headers?: string[]; rowSet?: any[][] }>;
    };

    const set = data.resultSets?.find((s) => s.name === "TeamGameLog") ?? data.resultSets?.[0];
    const headers = set?.headers ?? [];
    const rows = set?.rowSet ?? [];
    if (rows.length === 0) {
      shootingCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const fg3mIdx = headers.indexOf("FG3M");
    const fg3aIdx = headers.indexOf("FG3A");
    const gameDateIdx = headers.indexOf("GAME_DATE");
    if (fg3mIdx < 0 || fg3aIdx < 0) {
      shootingCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    // stats.nba.com returns games most-recent first, but sort defensively by
    // GAME_DATE descending in case ordering ever changes.
    const sorted = [...rows];
    if (gameDateIdx >= 0) {
      sorted.sort((a, b) => {
        const ad = new Date(a[gameDateIdx] as string).getTime();
        const bd = new Date(b[gameDateIdx] as string).getTime();
        return bd - ad;
      });
    }

    let seasonMade = 0;
    let seasonAttempts = 0;
    for (const row of sorted) {
      seasonMade += Number(row[fg3mIdx] ?? 0);
      seasonAttempts += Number(row[fg3aIdx] ?? 0);
    }

    const recent = sorted.slice(0, 5);
    let recentMade = 0;
    let recentAttempts = 0;
    for (const row of recent) {
      recentMade += Number(row[fg3mIdx] ?? 0);
      recentAttempts += Number(row[fg3aIdx] ?? 0);
    }

    if (seasonAttempts === 0 || recentAttempts === 0) {
      shootingCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const result: TeamShootingRecent = {
      recent3P: recentMade / recentAttempts,
      season3P: seasonMade / seasonAttempts,
      gamesUsed: recent.length,
    };

    shootingCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (err: any) {
    console.warn(`[nba-stats] parse failed for team ${nbaTeamId}:`, err?.message);
    shootingCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }
}
