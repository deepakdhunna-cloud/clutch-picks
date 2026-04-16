/**
 * Understat xG scraper.
 *
 * Understat publishes per-team xG/xGA for the big-5 European leagues via
 * JSON embedded in its public HTML:
 *   var teamsData = JSON.parse('<percent-encoded-and-hex-escaped-JSON>');
 *
 * There's no API; we pull the HTML, find the teamsData assignment, and
 * decode it. Understat does NOT cover MLS (handled separately in the MLS
 * factor file — kept `available: false`).
 *
 * Caveats:
 *   - Team names are inconsistent between ESPN and Understat (e.g. "Man
 *     City" vs "Manchester City", "PSG" vs "Paris Saint Germain", accented
 *     variants). We normalize aggressively and maintain a small alias map.
 *   - For UCL lookups we don't know which domestic league a team plays in,
 *     so `lookupTeamXG` tries a hint list in order and returns the first
 *     match.
 *   - Every miss is logged via console.warn so the alias map can be
 *     expanded from production logs.
 *
 * All errors swallowed → null. 10s timeout. 6-hour LRU cache.
 */

import { LRUCache } from "lru-cache";

// ─── Types ──────────────────────────────────────────────────────────────────

export type UnderstatLeague =
  | "EPL"
  | "La_Liga"
  | "Bundesliga"
  | "Serie_A"
  | "Ligue_1";

export interface UnderstatTeam {
  name: string;            // raw Understat display name
  games: number;
  xgPerGame: number;
  xgaPerGame: number;
  xgDiffPerGame: number;   // xgPerGame - xgaPerGame
}

// ─── Name normalization ────────────────────────────────────────────────────

/**
 * Canonicalize a soccer team name so ESPN and Understat line up.
 * Strips accents, common corporate suffixes, and whitespace.
 *
 *   "1. FC Köln"          → "koln"
 *   "Brighton & Hove Albion FC" → "brighton & hove albion"
 *   "Bayern München"      → "bayern munchen"
 *
 * NOTE: we do NOT strip ampersands or "united"/"city" tokens — those are
 * identifying. Only tokens that appear as club-type prefixes/suffixes.
 */
export function normalizeSoccerTeamName(name: string): string {
  const stripped = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks
    .trim();

  const tokens = stripped
    .split(/\s+/)
    .filter((tok) => {
      // Remove leading "1." or trailing dots (Bundesliga style "1. FC Köln")
      if (/^\d+\.?$/.test(tok)) return false;
      const bare = tok.replace(/\./g, "").toLowerCase();
      return !["fc", "afc", "cf", "sc", "ac", "club"].includes(bare);
    });

  return tokens.join(" ").replace(/\s+/g, " ").toLowerCase();
}

/**
 * Known ESPN→Understat aliases. Keys are already-normalized ESPN names,
 * values are already-normalized Understat names. Expand from prod logs.
 */
const ESPN_TO_UNDERSTAT_ALIASES: Record<string, string> = {
  "manchester united": "manchester united",
  "man city": "manchester city",
  "bayer leverkusen": "bayer leverkusen",
  "bayern munich": "bayern munich",
  "psg": "paris saint germain",
  "sporting cp": "sporting",
  "wolverhampton wanderers": "wolverhampton wanderers",
  "wolves": "wolverhampton wanderers",
  "brighton & hove albion": "brighton",
  "brighton and hove albion": "brighton",
  "west ham united": "west ham",
  "newcastle united": "newcastle united",
  "tottenham hotspur": "tottenham",
  "nottingham forest": "nottingham forest",
  "atletico madrid": "atletico madrid",
  "real sociedad": "real sociedad",
};

function canonicalName(raw: string): string {
  const normalized = normalizeSoccerTeamName(raw);
  return ESPN_TO_UNDERSTAT_ALIASES[normalized] ?? normalized;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const UNDERSTAT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const leagueCache = new LRUCache<
  string,
  { data: Map<string, UnderstatTeam> | null; timestamp: number }
>({ max: 20 });

// ─── Season helper ──────────────────────────────────────────────────────────
// Understat uses the starting year of the European season. The season runs
// Aug → May, so Jan-Jul belongs to the season that started the prior year.
function currentSeasonStartYear(date: Date = new Date()): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-indexed
  return m >= 6 ? y : y - 1; // July forward = new season
}

// ─── HTML payload extraction ────────────────────────────────────────────────

const TEAMS_DATA_RE = /var\s+teamsData\s*=\s*JSON\.parse\('([^']+)'\)/;

/**
 * Understat wraps its JSON twice:
 *   1. Percent-encoded string (URI escape)
 *   2. With some characters re-encoded as \xHH hex escapes inside the
 *      single-quoted JS string literal.
 *
 * Observed pattern: the literal contains only \x escapes + raw chars;
 * decodeURIComponent handles the percent-encoded wrapper. We first
 * normalize \xHH → %HH so decodeURIComponent can read the whole thing.
 */
function decodeTeamsDataPayload(raw: string): unknown {
  const percentified = raw.replace(/\\x([0-9A-Fa-f]{2})/g, "%$1");
  const jsonText = decodeURIComponent(percentified);
  return JSON.parse(jsonText);
}

interface UnderstatHistoryEntry {
  xG?: string | number;
  xGA?: string | number;
}

interface UnderstatTeamRaw {
  title?: string;
  history?: UnderstatHistoryEntry[];
}

function buildTeamFromRaw(raw: UnderstatTeamRaw): UnderstatTeam | null {
  const name = raw.title;
  const history = raw.history ?? [];
  if (!name || history.length === 0) return null;

  let xgSum = 0;
  let xgaSum = 0;
  for (const g of history) {
    xgSum += Number(g.xG ?? 0);
    xgaSum += Number(g.xGA ?? 0);
  }
  const games = history.length;
  const xgPerGame = xgSum / games;
  const xgaPerGame = xgaSum / games;
  return {
    name,
    games,
    xgPerGame,
    xgaPerGame,
    xgDiffPerGame: xgPerGame - xgaPerGame,
  };
}

// ─── Public fetchers ────────────────────────────────────────────────────────

export async function fetchLeagueXG(
  league: UnderstatLeague,
  season?: number,
): Promise<Map<string, UnderstatTeam> | null> {
  const seasonYear = season ?? currentSeasonStartYear();
  const cacheKey = `${league}-${seasonYear}`;
  const cached = leagueCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < UNDERSTAT_TTL_MS) {
    return cached.data;
  }

  const url = `https://understat.com/league/${league}/${seasonYear}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      leagueCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const html = await response.text();
    const match = TEAMS_DATA_RE.exec(html);
    if (!match || !match[1]) {
      leagueCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const parsed = decodeTeamsDataPayload(match[1]) as Record<string, UnderstatTeamRaw>;
    const result = new Map<string, UnderstatTeam>();
    for (const rawTeam of Object.values(parsed)) {
      const team = buildTeamFromRaw(rawTeam);
      if (!team) continue;
      result.set(normalizeSoccerTeamName(team.name), team);
    }

    leagueCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.warn(`[understat] fetch failed for ${league} ${seasonYear}:`, err instanceof Error ? err.message : err);
    leagueCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Look up a team by ESPN name in a specific league's cached xG table.
 * Returns null on miss; logs the miss so we can expand aliases.
 */
export function lookupInLeague(
  leagueMap: Map<string, UnderstatTeam> | null,
  espnTeamName: string,
  leagueLabel: string,
): UnderstatTeam | null {
  if (!leagueMap) return null;
  const key = canonicalName(espnTeamName);
  const hit = leagueMap.get(key);
  if (hit) return hit;
  // Secondary: try raw normalized name without alias mapping
  const altKey = normalizeSoccerTeamName(espnTeamName);
  const altHit = leagueMap.get(altKey);
  if (altHit) return altHit;
  console.warn(
    `[understat] miss: ${leagueLabel} — ESPN "${espnTeamName}" (normalized "${key}") not in Understat map`,
  );
  return null;
}

/**
 * Cross-league lookup — tries each hint league in order and returns the
 * first match. Used for UCL where a team's domestic league isn't obvious.
 */
export async function lookupTeamXG(
  teamName: string,
  leagueHints: UnderstatLeague[],
): Promise<UnderstatTeam | null> {
  for (const league of leagueHints) {
    const leagueMap = await fetchLeagueXG(league);
    if (!leagueMap) continue;
    const key = canonicalName(teamName);
    const hit = leagueMap.get(key);
    if (hit) return hit;
    const altHit = leagueMap.get(normalizeSoccerTeamName(teamName));
    if (altHit) return altHit;
  }
  console.warn(
    `[understat] UCL cross-league miss for "${teamName}" (tried ${leagueHints.join(", ")})`,
  );
  return null;
}
