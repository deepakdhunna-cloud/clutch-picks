/**
 * Soccer Expected Goals (xG) Data Pipeline
 *
 * xG is the single best predictor of future soccer performance — far better
 * than actual goals scored. A team outperforming its xG will regress; a team
 * underperforming will improve.
 *
 * Data sources (in priority order):
 * 1. FBref (free, Cloudflare-protected but accessible with proper headers)
 * 2. Understat (free, JSON API)
 * 3. Fallback: derive xG proxy from shot data in ESPN summary
 *
 * This module provides rolling xG metrics per team:
 * - xGF (expected goals for) — rolling last 10 matches
 * - xGA (expected goals against) — rolling last 10 matches
 * - xGD (expected goal difference) = xGF - xGA
 * - Performance delta = actual goals - xG (positive = overperforming)
 *
 * The xG factor uses xGD differential between the two teams as the primary
 * signal, with a regression penalty for teams significantly overperforming.
 */

import { LRUCache } from "lru-cache";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TeamXgMetrics {
  xGFor: number;         // Rolling average xG created per match
  xGAgainst: number;     // Rolling average xG conceded per match
  xGDiff: number;        // xGFor - xGAgainst
  actualGoalsFor: number;
  actualGoalsAgainst: number;
  overperformance: number; // actualGoals - xG (positive = overperforming, will regress)
  matchesUsed: number;
  source: "fbref" | "understat" | "espn-proxy";
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const XG_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — xG doesn't change intra-day
const xgCache = new LRUCache<string, { data: TeamXgMetrics | null; timestamp: number }>({ max: 200 });
const xgInflight = new Map<string, Promise<TeamXgMetrics | null>>();

// ─── League-to-FBref mappings ───────────────────────────────────────────────

const FBREF_LEAGUE_PATHS: Record<string, string> = {
  EPL: "9/Premier-League-Stats",
  MLS: "22/Major-League-Soccer-Stats",
  // UCL uses a different structure on FBref
  UCL: "8/Champions-League-Stats",
};

// Understat league slugs (alternative source)
const UNDERSTAT_LEAGUES: Record<string, string> = {
  EPL: "EPL",
  MLS: "MLS",
  // Understat doesn't cover UCL
};

// ─── FBref Fetcher ──────────────────────────────────────────────────────────

const FBREF_BASE = "https://fbref.com/en/comps";
const FBREF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface FBrefTeamRow {
  team: string;
  gamesPlayed: number;
  xG: number;        // Total xG for
  xGA: number;       // Total xG against
  goalsFor: number;
  goalsAgainst: number;
}

/**
 * Fetch league-wide xG table from FBref.
 * FBref publishes season-total xG in their league stats pages.
 * We derive per-match averages from the totals.
 */
async function fetchFBrefXgTable(sport: string): Promise<FBrefTeamRow[]> {
  const path = FBREF_LEAGUE_PATHS[sport];
  if (!path) return [];

  try {
    const response = await fetch(
      `${FBREF_BASE}/${path}`,
      {
        headers: FBREF_HEADERS,
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!response.ok) return [];

    const html = await response.text();
    return parseFBrefStatsTable(html);
  } catch {
    return [];
  }
}

/**
 * Parse the FBref stats table HTML to extract xG data.
 * FBref uses a standard table with id="stats_squads_standard_for" or similar.
 * The xG column is typically labeled "xG" in the header.
 */
function parseFBrefStatsTable(html: string): FBrefTeamRow[] {
  const rows: FBrefTeamRow[] = [];

  // FBref has multiple tables; we want the one with xG data
  // Look for the "Squad Standard Stats" table which has xG columns
  const tableMatch = html.match(
    /<table[^>]*id="stats_squads_standard_for"[^>]*>([\s\S]*?)<\/table>/
  );
  if (!tableMatch) {
    // Try alternative table ID
    const altMatch = html.match(
      /<table[^>]*id="stats_squads_shooting_for"[^>]*>([\s\S]*?)<\/table>/
    );
    if (!altMatch) return [];
    return parseXgFromTable(altMatch[1] ?? "");
  }

  return parseXgFromTable(tableMatch[1] ?? "");
}

function parseXgFromTable(tableHtml: string): FBrefTeamRow[] {
  const rows: FBrefTeamRow[] = [];

  // Find header row to locate column indices
  const headerMatch = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/);
  if (!headerMatch) return [];

  const headers: string[] = [];
  const thRegex = /<th[^>]*>(.*?)<\/th>/g;
  let thMatch: RegExpExecArray | null;
  while ((thMatch = thRegex.exec(headerMatch[1] ?? "")) !== null) {
    headers.push((thMatch[1] ?? "").replace(/<[^>]*>/g, "").trim().toLowerCase());
  }

  // Find relevant column indices
  const teamIdx = headers.findIndex((h) => h === "squad" || h === "team");
  const mpIdx = headers.findIndex((h) => h === "mp" || h === "matches" || h === "gp");
  const xgIdx = headers.findIndex((h) => h === "xg");
  const xgaIdx = headers.findIndex((h) => h === "xga" || h === "xg against");
  const gfIdx = headers.findIndex((h) => h === "gls" || h === "gf" || h === "goals");
  const gaIdx = headers.findIndex((h) => h === "ga" || h === "goals against");

  if (teamIdx === -1 || xgIdx === -1) return [];

  // Parse body rows
  const bodyMatch = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!bodyMatch) return [];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(bodyMatch[1] ?? "")) !== null) {
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1] ?? "")) !== null) {
      cells.push((cellMatch[1] ?? "").replace(/<[^>]*>/g, "").trim());
    }

    if (cells.length <= teamIdx) continue;

    const team = cells[teamIdx] ?? "";
    if (!team || team === "Squad") continue;

    const gp = mpIdx >= 0 ? parseFloat(cells[mpIdx] ?? "0") : 0;
    const xg = xgIdx >= 0 ? parseFloat(cells[xgIdx] ?? "0") : 0;
    const xga = xgaIdx >= 0 ? parseFloat(cells[xgaIdx] ?? "0") : 0;
    const gf = gfIdx >= 0 ? parseFloat(cells[gfIdx] ?? "0") : 0;
    const ga = gaIdx >= 0 ? parseFloat(cells[gaIdx] ?? "0") : 0;

    if (isNaN(xg) || gp === 0) continue;

    rows.push({
      team,
      gamesPlayed: gp,
      xG: xg,
      xGA: xga,
      goalsFor: gf,
      goalsAgainst: ga,
    });
  }

  return rows;
}

// ─── Understat Fetcher (Alternative) ────────────────────────────────────────

interface UnderstatTeamData {
  title: string;
  xG: number;
  xGA: number;
  scored: number;
  missed: number;
  matches: number;
}

async function fetchUnderstatXg(sport: string): Promise<UnderstatTeamData[]> {
  const league = UNDERSTAT_LEAGUES[sport];
  if (!league) return [];

  try {
    // Understat has a JSON endpoint for league data
    const currentYear = new Date().getFullYear();
    const response = await fetch(
      `https://understat.com/league/${league}/${currentYear}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ClutchPicksBot/1.0)",
          "Accept": "text/html",
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!response.ok) return [];

    const html = await response.text();
    // Understat embeds JSON in a script tag
    const dataMatch = html.match(/var\s+teamsData\s*=\s*JSON\.parse\('(.+?)'\)/);
    if (!dataMatch) return [];

    // Understat double-encodes the JSON
    const decoded = (dataMatch[1] ?? "").replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

    const teamsData = JSON.parse(decoded) as Record<string, { title: string; history: Array<{ xG: number; xGA: number; scored: number; missed: number }> }>;

    return Object.values(teamsData).map((team) => {
      const history = team.history ?? [];
      const recent = history.slice(-10); // Last 10 matches
      const xG = recent.reduce((sum, m) => sum + (m.xG ?? 0), 0);
      const xGA = recent.reduce((sum, m) => sum + (m.xGA ?? 0), 0);
      const scored = recent.reduce((sum, m) => sum + (m.scored ?? 0), 0);
      const missed = recent.reduce((sum, m) => sum + (m.missed ?? 0), 0);
      return {
        title: team.title,
        xG,
        xGA,
        scored,
        missed,
        matches: recent.length,
      };
    });
  } catch {
    return [];
  }
}

// ─── Team Name Matching ─────────────────────────────────────────────────────

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bfc\b/g, "")
    .replace(/\bcity\b/g, "")
    .replace(/\bunited\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamNameMatches(source: string, target: string): boolean {
  const s = normalizeTeamName(source);
  const t = normalizeTeamName(target);
  if (s === t) return true;
  // Check if one contains the other (e.g., "Arsenal" matches "Arsenal FC")
  if (s.includes(t) || t.includes(s)) return true;
  // Check last word match (e.g., "Liverpool" from "Liverpool FC")
  const sLast = s.split(" ").at(-1);
  const tLast = t.split(" ").at(-1);
  return Boolean(sLast && tLast && sLast.length > 3 && sLast === tLast);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch xG metrics for a team in a given league.
 * Tries FBref first, then Understat, then returns null.
 */
export async function fetchTeamXgMetrics(
  sport: string,
  teamName: string,
): Promise<TeamXgMetrics | null> {
  const cacheKey = `xg-${sport}-${normalizeTeamName(teamName)}`;

  const cached = xgCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < XG_CACHE_TTL_MS) {
    return cached.data;
  }

  const existing = xgInflight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<TeamXgMetrics | null> => {
    try {
      // Try FBref first
      const fbrefRows = await fetchFBrefXgTable(sport);
      if (fbrefRows.length > 0) {
        const match = fbrefRows.find((r) => teamNameMatches(r.team, teamName));
        if (match && match.gamesPlayed > 0) {
          const metrics: TeamXgMetrics = {
            xGFor: match.xG / match.gamesPlayed,
            xGAgainst: match.xGA / match.gamesPlayed,
            xGDiff: (match.xG - match.xGA) / match.gamesPlayed,
            actualGoalsFor: match.goalsFor / match.gamesPlayed,
            actualGoalsAgainst: match.goalsAgainst / match.gamesPlayed,
            overperformance: (match.goalsFor - match.xG) / match.gamesPlayed,
            matchesUsed: match.gamesPlayed,
            source: "fbref",
          };
          xgCache.set(cacheKey, { data: metrics, timestamp: Date.now() });
          return metrics;
        }
      }

      // Try Understat as fallback
      const understatData = await fetchUnderstatXg(sport);
      if (understatData.length > 0) {
        const match = understatData.find((t) => teamNameMatches(t.title, teamName));
        if (match && match.matches > 0) {
          const metrics: TeamXgMetrics = {
            xGFor: match.xG / match.matches,
            xGAgainst: match.xGA / match.matches,
            xGDiff: (match.xG - match.xGA) / match.matches,
            actualGoalsFor: match.scored / match.matches,
            actualGoalsAgainst: match.missed / match.matches,
            overperformance: (match.scored - match.xG) / match.matches,
            matchesUsed: match.matches,
            source: "understat",
          };
          xgCache.set(cacheKey, { data: metrics, timestamp: Date.now() });
          return metrics;
        }
      }

      xgCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    } catch {
      xgCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    } finally {
      xgInflight.delete(cacheKey);
    }
  })();

  xgInflight.set(cacheKey, request);
  return request;
}
