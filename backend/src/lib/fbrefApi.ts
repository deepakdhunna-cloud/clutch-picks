/**
 * FBRef xG scraper.
 *
 * FBRef (maintained by Sports Reference) publishes per-team xG/xGA for the
 * big-5 European leagues in server-rendered HTML tables. Replaces Understat
 * which moved to client-side rendering in early 2026.
 *
 * FBRef does NOT cover MLS (handled separately in the MLS factor file —
 * kept `available: false` until an ASA data source is wired up).
 *
 * Caveats:
 *   - Team names differ between ESPN and FBRef (e.g. "Manchester United"
 *     vs "Manchester Utd", "Nottingham Forest" vs "Nott'ham Forest").
 *     We normalize aggressively and maintain an alias map.
 *   - FBRef wraps some tables in HTML comments (`<!-- ... -->`) as an
 *     anti-scraping measure. We strip comments before parsing.
 *   - For UCL lookups we don't know which domestic league a team plays in,
 *     so `lookupTeamXG` tries a hint list in order and returns the first
 *     match.
 *
 * All errors swallowed → null. 20s timeout. 6-hour LRU cache.
 */

import { LRUCache } from "lru-cache";
import { Parser } from "htmlparser2";

// ─── Types ──────────────────────────────────────────────────────────────────

export type FBRefLeague =
  | "EPL"
  | "La_Liga"
  | "Bundesliga"
  | "Serie_A"
  | "Ligue_1";

// Re-export as UnderstatLeague for backward compatibility with shadow.ts
export type UnderstatLeague = FBRefLeague;

export interface FBRefTeam {
  name: string;            // raw FBRef display name
  games: number;
  xgPerGame: number;
  xgaPerGame: number;
  xgDiffPerGame: number;   // xgPerGame - xgaPerGame
}

// Re-export as UnderstatTeam for backward compatibility with types.ts
export type UnderstatTeam = FBRefTeam;

// ─── Name normalization ────────────────────────────────────────────────────

/**
 * Canonicalize a soccer team name so ESPN and FBRef line up.
 * Strips accents, common corporate suffixes, apostrophe contractions,
 * and whitespace.
 */
export function normalizeSoccerTeamName(name: string): string {
  const stripped = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks
    .replace(/['']/g, "")           // strip apostrophes (Nott'ham → Nottham)
    .trim();

  const tokens = stripped
    .split(/\s+/)
    .filter((tok) => {
      if (/^\d+\.?$/.test(tok)) return false;
      const bare = tok.replace(/\./g, "").toLowerCase();
      return !["fc", "afc", "cf", "sc", "ac", "club"].includes(bare);
    });

  return tokens.join(" ").replace(/\s+/g, " ").toLowerCase();
}

/**
 * Known ESPN→FBRef aliases. Keys are already-normalized ESPN names,
 * values are already-normalized FBRef names. Expand from prod logs.
 */
const ESPN_TO_FBREF_ALIASES: Record<string, string> = {
  // EPL
  "manchester united": "manchester utd",
  "man city": "manchester city",
  "wolverhampton wanderers": "wolves",
  "wolves": "wolves",
  "brighton & hove albion": "brighton",
  "brighton and hove albion": "brighton",
  "west ham united": "west ham",
  "newcastle united": "newcastle utd",
  "tottenham hotspur": "tottenham",
  "nottingham forest": "nottham forest",
  "leicester city": "leicester city",
  "ipswich town": "ipswich town",
  // La Liga
  "atletico madrid": "atletico madrid",
  "real sociedad": "real sociedad",
  // Bundesliga
  "bayer leverkusen": "bayer leverkusen",
  "bayern munich": "bayern munich",
  // Ligue 1
  "psg": "paris s-g",
  // UCL misc
  "sporting cp": "sporting cp",
};

export function canonicalName(raw: string): string {
  const normalized = normalizeSoccerTeamName(raw);
  return ESPN_TO_FBREF_ALIASES[normalized] ?? normalized;
}

// ─── FBRef URL map ─────────────────────────────────────────────────────────

const FBREF_COMP_IDS: Record<FBRefLeague, { id: number; slug: string }> = {
  EPL:        { id: 9,  slug: "Premier-League-Stats" },
  La_Liga:    { id: 12, slug: "La-Liga-Stats" },
  Bundesliga: { id: 20, slug: "Bundesliga-Stats" },
  Serie_A:    { id: 11, slug: "Serie-A-Stats" },
  Ligue_1:    { id: 13, slug: "Ligue-1-Stats" },
};

function fbrefUrl(league: FBRefLeague): string {
  const comp = FBREF_COMP_IDS[league];
  return `https://fbref.com/en/comps/${comp.id}/${comp.slug}`;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const FBREF_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const leagueCache = new LRUCache<
  string,
  { data: Map<string, FBRefTeam> | null; timestamp: number }
>({ max: 20 });

// ─── Fetch helpers ─────────────────────────────────────────────────────────

const FBREF_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

const FBREF_TIMEOUT_MS = 20_000;
const FBREF_MAX_RETRIES = 2;

function isCloudflareChallenge(body: string): boolean {
  return body.includes("Just a moment") || body.includes("Checking your browser");
}

async function fetchWithRetry(url: string): Promise<Response | null> {
  const delays = [1000, 2000];
  for (let attempt = 0; attempt < FBREF_MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FBREF_TIMEOUT_MS),
        headers: FBREF_HEADERS,
      });
      const durationMs = Date.now() - start;
      if (!response.ok) {
        console.warn(
          `[fbref] attempt ${attempt + 1}/${FBREF_MAX_RETRIES}: ${url} → HTTP ${response.status} (${durationMs}ms)`,
        );
        if (attempt < FBREF_MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, delays[attempt]!));
          continue;
        }
        return null;
      }
      console.log(`[fbref] fetch OK: ${url} → ${response.status} (${durationMs}ms)`);
      return response;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      console.warn(
        `[fbref] attempt ${attempt + 1}/${FBREF_MAX_RETRIES}: ${url} failed after ${durationMs}ms: ${err?.message ?? err}`,
      );
      if (attempt < FBREF_MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, delays[attempt]!));
      }
    }
  }
  return null;
}

// ─── HTML table parsing ────────────────────────────────────────────────────

/**
 * Parse team xG data from FBRef HTML. The overall standings table has
 * `data-stat` attributes on `<td>` elements for team, games, xg_for, xg_against.
 *
 * FBRef sometimes wraps tables in HTML comments. We strip those before parsing.
 */
function parseTeamXGTable(html: string): FBRefTeam[] {
  // Strip HTML comments to reveal hidden tables
  const uncommented = html.replace(/<!--/g, "").replace(/-->/g, "");

  const teams: FBRefTeam[] = [];
  let inOverallTable = false;
  let inRow = false;
  let currentDataStat = "";
  let currentTeam: Partial<{ name: string; games: number; xg: number; xga: number }> = {};
  let capturingText = false;

  const parser = new Parser({
    onopentag(tagName, attrs) {
      // Detect the overall standings table (id contains "_overall")
      if (tagName === "table" && attrs.id && attrs.id.includes("_overall")) {
        inOverallTable = true;
      }
      if (!inOverallTable) return;

      if (tagName === "tr") {
        inRow = true;
        currentTeam = {};
      }
      if (tagName === "td" || tagName === "th") {
        currentDataStat = attrs["data-stat"] ?? "";
        if (["team", "games", "xg_for", "xg_against"].includes(currentDataStat)) {
          capturingText = true;
        }
      }
      // Team name is in an <a> inside the team cell
      if (tagName === "a" && currentDataStat === "team") {
        capturingText = true;
      }
    },
    ontext(text) {
      if (!capturingText || !inRow) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      if (currentDataStat === "team") {
        // Prefer the <a> tag text (team name), not any other text in the cell
        currentTeam.name = trimmed;
      } else if (currentDataStat === "games") {
        currentTeam.games = parseInt(trimmed, 10);
      } else if (currentDataStat === "xg_for") {
        currentTeam.xg = parseFloat(trimmed);
      } else if (currentDataStat === "xg_against") {
        currentTeam.xga = parseFloat(trimmed);
      }
    },
    onclosetag(tagName) {
      if (tagName === "td" || tagName === "th") {
        capturingText = false;
        currentDataStat = "";
      }
      if (tagName === "tr" && inRow) {
        inRow = false;
        if (
          currentTeam.name &&
          currentTeam.games &&
          currentTeam.games > 0 &&
          Number.isFinite(currentTeam.xg) &&
          Number.isFinite(currentTeam.xga)
        ) {
          const games = currentTeam.games!;
          const xgPerGame = currentTeam.xg! / games;
          const xgaPerGame = currentTeam.xga! / games;
          teams.push({
            name: currentTeam.name!,
            games,
            xgPerGame,
            xgaPerGame,
            xgDiffPerGame: xgPerGame - xgaPerGame,
          });
        }
      }
      if (tagName === "table") {
        inOverallTable = false;
      }
    },
  });

  parser.write(uncommented);
  parser.end();

  return teams;
}

// ─── Public fetchers ────────────────────────────────────────────────────────

export async function fetchLeagueXG(
  league: FBRefLeague,
  _season?: number, // kept for API compat; FBRef URL always shows current season
): Promise<Map<string, FBRefTeam> | null> {
  const cacheKey = league;
  const cached = leagueCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < FBREF_TTL_MS) {
    return cached.data;
  }

  const url = fbrefUrl(league);
  const response = await fetchWithRetry(url);
  if (!response) {
    leagueCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }

  try {
    const html = await response.text();

    if (isCloudflareChallenge(html)) {
      console.error(
        `[fbref] Cloudflare challenge detected for ${league}. ` +
        `Body starts with: ${html.slice(0, 200)}`,
      );
      leagueCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const teams = parseTeamXGTable(html);
    if (teams.length === 0) {
      console.warn(
        `[fbref] No teams parsed for ${league}. Body length=${html.length}, ` +
        `first 200 chars: ${html.slice(0, 200)}`,
      );
      leagueCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const result = new Map<string, FBRefTeam>();
    for (const team of teams) {
      result.set(normalizeSoccerTeamName(team.name), team);
    }

    console.log(`[fbref] parsed ${result.size} teams for ${league}`);
    leagueCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.warn(`[fbref] parse failed for ${league}:`, err instanceof Error ? err.message : err);
    leagueCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Look up a team by ESPN name in a specific league's cached xG table.
 * Returns null on miss; logs the miss so we can expand aliases.
 */
export function lookupInLeague(
  leagueMap: Map<string, FBRefTeam> | null,
  espnTeamName: string,
  leagueLabel: string,
): FBRefTeam | null {
  if (!leagueMap) {
    console.warn(
      `[fbref] miss: ${leagueLabel} — league map is NULL (fetch failed or timed out). ESPN team "${espnTeamName}" cannot be looked up.`,
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

  const mapKeys = Array.from(leagueMap.keys());
  console.warn(
    `[fbref] miss: ${leagueLabel} — ESPN "${espnTeamName}"\n` +
    `  canonical key: "${key}"\n` +
    `  alt key (raw normalized): "${altKey}"\n` +
    `  map has ${mapKeys.length} teams: [${mapKeys.join(", ")}]`,
  );
  return null;
}

/**
 * Cross-league lookup — tries each hint league in order and returns the
 * first match. Used for UCL where a team's domestic league isn't obvious.
 */
export async function lookupTeamXG(
  teamName: string,
  leagueHints: FBRefLeague[],
): Promise<FBRefTeam | null> {
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
    `[fbref] UCL cross-league miss for "${teamName}"\n` +
    `  canonical: "${key}", alt: "${altKey}"\n` +
    `  tried: ${triedLeagues.join(", ")}`,
  );
  return null;
}
