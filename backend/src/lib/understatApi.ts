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
  "leicester city": "leicester",
  "ipswich town": "ipswich",
};

export function canonicalName(raw: string): string {
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

const UNDERSTAT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

const UNDERSTAT_TIMEOUT_MS = 20_000; // 20s — Railway → Understat has higher latency
const UNDERSTAT_MAX_RETRIES = 2;

/**
 * Detect Cloudflare challenge pages that won't contain our data.
 */
function isCloudflareChallenge(body: string): boolean {
  return body.includes("Just a moment") || body.includes("Checking your browser");
}

async function fetchWithRetry(url: string): Promise<Response | null> {
  const delays = [1000, 2000]; // backoff schedule
  for (let attempt = 0; attempt < UNDERSTAT_MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(UNDERSTAT_TIMEOUT_MS),
        headers: UNDERSTAT_HEADERS,
      });
      const durationMs = Date.now() - start;

      if (!response.ok) {
        console.warn(
          `[understat] attempt ${attempt + 1}/${UNDERSTAT_MAX_RETRIES}: ${url} → HTTP ${response.status} (${durationMs}ms)`,
        );
        if (attempt < UNDERSTAT_MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, delays[attempt]!));
          continue;
        }
        return null;
      }

      console.log(`[understat] fetch OK: ${url} → ${response.status} (${durationMs}ms)`);
      return response;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      console.warn(
        `[understat] attempt ${attempt + 1}/${UNDERSTAT_MAX_RETRIES}: ${url} failed after ${durationMs}ms: ${err?.message ?? err}`,
      );
      if (attempt < UNDERSTAT_MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, delays[attempt]!));
      }
    }
  }
  return null;
}

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

  const response = await fetchWithRetry(url);
  if (!response) {
    leagueCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }

  try {
    const html = await response.text();

    // Detect Cloudflare challenge
    if (isCloudflareChallenge(html)) {
      console.error(
        `[understat] Cloudflare challenge detected for ${league} ${seasonYear}. ` +
        `Body starts with: ${html.slice(0, 200)}`,
      );
      leagueCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const match = TEAMS_DATA_RE.exec(html);
    if (!match || !match[1]) {
      console.warn(
        `[understat] teamsData regex miss for ${league} ${seasonYear}. ` +
        `Body length=${html.length}, first 200 chars: ${html.slice(0, 200)}`,
      );
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

    console.log(`[understat] parsed ${result.size} teams for ${league} ${seasonYear}`);
    leagueCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.warn(`[understat] parse failed for ${league} ${seasonYear}:`, err instanceof Error ? err.message : err);
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
  if (!leagueMap) {
    console.warn(
      `[understat] miss: ${leagueLabel} — league map is NULL (fetch failed or timed out). ESPN team "${espnTeamName}" cannot be looked up.`,
    );
    return null;
  }
  const key = canonicalName(espnTeamName);
  const hit = leagueMap.get(key);
  if (hit) return hit;
  // Secondary: try raw normalized name without alias mapping
  const altKey = normalizeSoccerTeamName(espnTeamName);
  const altHit = leagueMap.get(altKey);
  if (altHit) return altHit;

  // Verbose diagnostic: dump what we tried and a sample of what's actually in the map
  const mapKeys = Array.from(leagueMap.keys());
  const sampleKeys = mapKeys.slice(0, 5);
  console.warn(
    `[understat] miss: ${leagueLabel} — ESPN "${espnTeamName}"\n` +
    `  canonical key: "${key}"\n` +
    `  alt key (raw normalized): "${altKey}"\n` +
    `  map has ${mapKeys.length} teams, sample keys: [${sampleKeys.map(k => `"${k}"`).join(", ")}]\n` +
    `  all keys: [${mapKeys.join(", ")}]`,
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
  const key = canonicalName(teamName);
  const altKey = normalizeSoccerTeamName(teamName);
  const triedLeagues: string[] = [];

  for (const league of leagueHints) {
    const leagueMap = await fetchLeagueXG(league);
    if (!leagueMap) {
      triedLeagues.push(`${league}(null map)`);
      continue;
    }
    const hit = leagueMap.get(key);
    if (hit) return hit;
    const altHit = leagueMap.get(altKey);
    if (altHit) return altHit;
    triedLeagues.push(`${league}(${leagueMap.size} teams)`);
  }
  console.warn(
    `[understat] UCL cross-league miss for "${teamName}"\n` +
    `  canonical: "${key}", alt: "${altKey}"\n` +
    `  tried: ${triedLeagues.join(", ")}`,
  );
  return null;
}
