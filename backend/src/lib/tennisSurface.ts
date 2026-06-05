/**
 * Surface-Specific Tennis Ratings
 *
 * Tennis performance varies dramatically by surface:
 * - Clay: Favors baseline grinders, high topspin, fitness (Nadal archetype)
 * - Grass: Favors big servers, net play, flat strokes (Federer archetype)
 * - Hard: Most neutral, favors all-court players (Djokovic archetype)
 *
 * A clay specialist playing on grass is a completely different proposition
 * than on their preferred surface. This module:
 * 1. Detects the match surface from venue/tournament context
 * 2. Fetches surface-specific win rates per player from ESPN results
 * 3. Provides a surface adjustment factor to the tennis prediction
 *
 * Surface detection uses tournament name/venue matching:
 * - Roland Garros, Monte Carlo, Madrid, Rome, Barcelona → Clay
 * - Wimbledon, Queen's, Halle, Stuttgart → Grass
 * - Australian Open, US Open, Indian Wells, Miami, most others → Hard
 */

import { LRUCache } from "lru-cache";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TennisSurface = "clay" | "grass" | "hard" | "unknown";

export interface SurfaceProfile {
  surface: TennisSurface;
  winRate: number;      // 0–1 win rate on this surface
  matchesPlayed: number;
  source: "espn-results" | "tournament-history" | "inferred";
}

export interface SurfaceAdjustment {
  surface: TennisSurface;
  homeSurfaceWinRate: number | null;
  awaySurfaceWinRate: number | null;
  deltaElo: number;    // Positive = favors home
  evidence: string;
}

// ─── Surface Detection ──────────────────────────────────────────────────────

// Known clay tournaments (partial list — covers all Masters/Slams/500s)
const CLAY_TOURNAMENTS = [
  "roland garros", "french open",
  "monte carlo", "monte-carlo",
  "madrid", "mutua madrid",
  "rome", "internazionali", "italian open",
  "barcelona", "conde de godo",
  "hamburg", "german open",
  "buenos aires", "argentina open",
  "rio", "rio open",
  "lyon", "geneva", "parma", "bastad", "umag", "kitzbuhel",
  "bucharest", "marrakech", "estoril", "houston",
  "charleston", "strasbourg", "rabat", "bogota",
];

// Known grass tournaments
const GRASS_TOURNAMENTS = [
  "wimbledon",
  "queen", "queen's",
  "halle", "terra wortmann",
  "stuttgart", "boss open",
  "eastbourne", "rothesay",
  "s-hertogenbosch", "libema",
  "mallorca", "bad homburg",
  "nottingham", "birmingham",
  "newport",
];

// Known indoor hard tournaments (subset — most hard courts are outdoor)
const INDOOR_HARD_TOURNAMENTS = [
  "australian open",
  "us open",
  "indian wells", "bnp paribas",
  "miami", "miami open",
  "cincinnati", "western & southern",
  "toronto", "montreal", "canadian open", "national bank",
  "shanghai", "rolex shanghai",
  "paris", "paris masters", "rolex paris",
  "atp finals", "wta finals", "nitto",
  "dubai", "doha", "qatar",
  "rotterdam", "abn amro",
  "vienna", "erste bank",
  "basel", "swiss indoors",
  "tokyo", "japan open",
  "beijing", "china open",
];

/**
 * Detect the surface from tournament/venue context.
 * Uses the game venue, season context label, and detail fields.
 */
export function detectSurface(
  venue: string,
  tournamentContext?: string,
): TennisSurface {
  const text = [venue, tournamentContext]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Check clay first (most distinctive)
  for (const keyword of CLAY_TOURNAMENTS) {
    if (text.includes(keyword)) return "clay";
  }

  // Check grass
  for (const keyword of GRASS_TOURNAMENTS) {
    if (text.includes(keyword)) return "grass";
  }

  // Check known hard court tournaments
  for (const keyword of INDOOR_HARD_TOURNAMENTS) {
    if (text.includes(keyword)) return "hard";
  }

  // Heuristic: if venue mentions "clay" or "terre battue"
  if (text.includes("clay") || text.includes("terre battue")) return "clay";
  if (text.includes("grass") || text.includes("lawn")) return "grass";
  if (text.includes("hard") || text.includes("hardcourt") || text.includes("acrylic")) return "hard";

  // Default to hard (most common surface on tour)
  return "hard";
}

// ─── Surface Win Rate Cache ─────────────────────────────────────────────────

const SURFACE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const surfaceCache = new LRUCache<string, { data: Map<TennisSurface, SurfaceProfile>; timestamp: number }>({ max: 500 });

/**
 * Parse surface-specific results from ESPN player results page HTML.
 * ESPN's results page shows tournament names which we can map to surfaces.
 */
export function parseSurfaceResults(
  html: string,
): Map<TennisSurface, { wins: number; losses: number }> {
  const surfaces = new Map<TennisSurface, { wins: number; losses: number }>([
    ["clay", { wins: 0, losses: 0 }],
    ["grass", { wins: 0, losses: 0 }],
    ["hard", { wins: 0, losses: 0 }],
  ]);

  // ESPN results page has rows with tournament name and W/L result
  // Pattern: <td class="Table__TD">Tournament Name</td> ... <span class="greenfont">W</span>
  const rowRegex = /<tr[^>]*class="Table__TR[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1] ?? "";

    // Extract tournament name from the row
    const tournamentMatch = rowHtml.match(/<td[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const tournament = tournamentMatch?.[1]?.replace(/<[^>]*>/g, "").trim().toLowerCase() ?? "";

    // Extract result
    const resultMatch = rowHtml.match(/<span class="(greenfont|redfont)">\s*([WL])\s*<\/span>/);
    if (!resultMatch) continue;

    const result = resultMatch[2] as "W" | "L";
    const surface = detectSurface(tournament);
    if (surface === "unknown") continue;

    const stats = surfaces.get(surface)!;
    if (result === "W") stats.wins++;
    else stats.losses++;
  }

  return surfaces;
}

/**
 * Fetch surface-specific win rates for a player.
 * Uses ESPN player results page and maps tournaments to surfaces.
 */
export async function fetchPlayerSurfaceProfile(
  playerId: string,
): Promise<Map<TennisSurface, SurfaceProfile>> {
  const cacheKey = `surface-${playerId}`;
  const cached = surfaceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SURFACE_CACHE_TTL_MS) {
    return cached.data;
  }

  const profiles = new Map<TennisSurface, SurfaceProfile>();

  try {
    const year = new Date().getFullYear();
    // Fetch current year and previous year for better sample size
    const [currentHtml, prevHtml] = await Promise.all([
      fetchResultsPage(playerId, year),
      fetchResultsPage(playerId, year - 1),
    ]);

    const currentResults = parseSurfaceResults(currentHtml);
    const prevResults = parseSurfaceResults(prevHtml);

    // Merge results from both years
    for (const surface of ["clay", "grass", "hard"] as TennisSurface[]) {
      const current = currentResults.get(surface) ?? { wins: 0, losses: 0 };
      const prev = prevResults.get(surface) ?? { wins: 0, losses: 0 };
      const totalWins = current.wins + prev.wins;
      const totalLosses = current.losses + prev.losses;
      const total = totalWins + totalLosses;

      profiles.set(surface, {
        surface,
        winRate: total > 0 ? totalWins / total : 0.5,
        matchesPlayed: total,
        source: total > 0 ? "espn-results" : "inferred",
      });
    }

    surfaceCache.set(cacheKey, { data: profiles, timestamp: Date.now() });
  } catch {
    // Return empty profiles on failure
    for (const surface of ["clay", "grass", "hard"] as TennisSurface[]) {
      profiles.set(surface, { surface, winRate: 0.5, matchesPlayed: 0, source: "inferred" });
    }
  }

  return profiles;
}

async function fetchResultsPage(playerId: string, year: number): Promise<string> {
  try {
    const url = `https://www.espn.com/tennis/player/results/_/id/${playerId}/year/${year}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  }
}

/**
 * Compute the surface adjustment for a tennis match.
 * Returns an Elo delta based on the difference in surface-specific win rates.
 *
 * Logic:
 * - If both players have surface data, compare their win rates on the match surface
 * - Each 10% win rate advantage on the surface ≈ 25 Elo points
 * - Cap at ±50 Elo to prevent extreme adjustments from small samples
 * - Require at least 5 matches on the surface for the signal to be meaningful
 */
export function computeSurfaceAdjustment(
  matchSurface: TennisSurface,
  homeProfile: Map<TennisSurface, SurfaceProfile> | null,
  awayProfile: Map<TennisSurface, SurfaceProfile> | null,
): SurfaceAdjustment {
  if (matchSurface === "unknown" || !homeProfile || !awayProfile) {
    return {
      surface: matchSurface,
      homeSurfaceWinRate: null,
      awaySurfaceWinRate: null,
      deltaElo: 0,
      evidence: "Surface data unavailable or surface unknown",
    };
  }

  const homeData = homeProfile.get(matchSurface);
  const awayData = awayProfile.get(matchSurface);

  if (!homeData || !awayData) {
    return {
      surface: matchSurface,
      homeSurfaceWinRate: null,
      awaySurfaceWinRate: null,
      deltaElo: 0,
      evidence: `No ${matchSurface} court data available for one or both players`,
    };
  }

  // Require minimum sample size for meaningful signal
  const MIN_MATCHES = 5;
  const homeHasSignal = homeData.matchesPlayed >= MIN_MATCHES;
  const awayHasSignal = awayData.matchesPlayed >= MIN_MATCHES;

  if (!homeHasSignal && !awayHasSignal) {
    return {
      surface: matchSurface,
      homeSurfaceWinRate: homeData.winRate,
      awaySurfaceWinRate: awayData.winRate,
      deltaElo: 0,
      evidence: `Insufficient ${matchSurface} sample: ${homeData.matchesPlayed} and ${awayData.matchesPlayed} matches (need ${MIN_MATCHES}+)`,
    };
  }

  // Compute delta: each 10% win rate advantage = 25 Elo
  const winRateDiff = homeData.winRate - awayData.winRate;
  const rawDelta = winRateDiff * 250; // 0.10 diff * 250 = 25 Elo
  const delta = Math.max(-50, Math.min(50, rawDelta));

  const evidence = `${matchSurface.charAt(0).toUpperCase() + matchSurface.slice(1)} court: Home ${(homeData.winRate * 100).toFixed(0)}% (${homeData.matchesPlayed} matches) vs Away ${(awayData.winRate * 100).toFixed(0)}% (${awayData.matchesPlayed} matches)`;

  return {
    surface: matchSurface,
    homeSurfaceWinRate: homeData.winRate,
    awaySurfaceWinRate: awayData.winRate,
    deltaElo: delta,
    evidence,
  };
}
