// Cricket league discovery + format labeling.
//
// ESPN does not expose a single "all cricket" scoreboard endpoint; each cricket
// competition has its own numeric league id (e.g. 8048 = IPL, 8044 = Big Bash,
// 8634 = ICC Women's T20 World Cup). The set of *active* competitions changes
// constantly (domestic leagues, bilateral tours, ICC events, qualifiers...).
//
// The scoreboard "header" endpoint returns every cricket competition that
// currently has events, which lets us treat cricket as one broad league that
// reports ALL matches instead of IPL only. This module:
//   1. Discovers the currently active cricket league ids.
//   2. Derives a short, user-facing format label for each competition
//      ("IPL", "Women's T20", "T20I", "ODI", "Test", "Big Bash", ...).

const CRICKET_HEADER_URL =
  "https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket";

// The canonical IPL league id. Kept so IPL-specific behavior (standings,
// run-rate projection) can still be detected within the generalized league.
export const IPL_LEAGUE_ID = "8048";

const CRICKET_LEAGUES_CACHE_TTL_MS = 10 * 60 * 1000;

export interface CricketLeague {
  id: string;
  name: string;
  abbreviation?: string;
  slug?: string;
  eventCount: number;
}

interface HeaderLeague {
  id?: string | number;
  name?: string;
  abbreviation?: string;
  slug?: string;
  events?: unknown[];
}

interface HeaderSport {
  leagues?: HeaderLeague[];
}

interface HeaderResponse {
  sports?: HeaderSport[];
}

let cachedLeagues: { data: CricketLeague[]; timestamp: number } | null = null;

/**
 * Discover cricket competitions that currently have events. Falls back to the
 * IPL-only league id if discovery fails, so the league never goes empty due to
 * a transient header-endpoint failure.
 */
export async function fetchActiveCricketLeagues(): Promise<CricketLeague[]> {
  if (cachedLeagues && Date.now() - cachedLeagues.timestamp < CRICKET_LEAGUES_CACHE_TTL_MS) {
    return cachedLeagues.data;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(CRICKET_HEADER_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return fallbackLeagues();

    const data = (await response.json()) as HeaderResponse;
    const leagues: CricketLeague[] = [];
    const seen = new Set<string>();
    for (const sport of data.sports ?? []) {
      for (const league of sport.leagues ?? []) {
        const id = league.id !== undefined ? String(league.id) : undefined;
        if (!id || seen.has(id)) continue;
        const eventCount = Array.isArray(league.events) ? league.events.length : 0;
        // Only include competitions that actually have games to show.
        if (eventCount <= 0) continue;
        // The app exposes a single "T20" cricket league. Exclude Test, ODI and
        // multi-day bilateral tours so non-T20 cricket never leaks in. IPL id is
        // always re-added below regardless.
        if (id !== IPL_LEAGUE_ID && !isT20Competition(league.name ?? "", league.abbreviation)) {
          continue;
        }
        seen.add(id);
        leagues.push({
          id,
          name: (league.name ?? "Cricket").trim(),
          abbreviation: league.abbreviation?.trim() || undefined,
          slug: league.slug?.trim() || undefined,
          eventCount,
        });
      }
    }

    // Always make sure IPL is included even if it has no events on this date, so
    // standings-backed IPL behavior remains available when it returns.
    if (!seen.has(IPL_LEAGUE_ID)) {
      leagues.push({ id: IPL_LEAGUE_ID, name: "Indian Premier League", abbreviation: "IPL", eventCount: 0 });
    }

    const result = leagues.length > 0 ? leagues : fallbackLeagues();
    cachedLeagues = { data: result, timestamp: Date.now() };
    return result;
  } catch {
    return fallbackLeagues();
  }
}

function fallbackLeagues(): CricketLeague[] {
  const fallback: CricketLeague[] = [
    { id: IPL_LEAGUE_ID, name: "Indian Premier League", abbreviation: "IPL", eventCount: 0 },
  ];
  cachedLeagues = { data: fallback, timestamp: Date.now() };
  return fallback;
}

/**
 * Detect whether a cricket league name refers to a women's competition.
 */
export function isWomensCompetition(leagueName: string, abbreviation?: string): boolean {
  const text = `${leagueName ?? ""} ${abbreviation ?? ""}`.toLowerCase();
  return /\bwomen('s)?\b|\bwomens\b|\bwt20\b|\bwbbl\b|\bwpl\b|ladies|\(w\)/.test(text);
}

/**
 * Detect whether a cricket competition is played in the T20 (twenty-over)
 * format. Returns true for branded T20 leagues (IPL, Big Bash, PSL, The
 * Hundred, ...) and explicit T20 markers; returns false for Test, ODI,
 * first-class, list-A and multi-day tour competitions.
 */
export function isT20Competition(leagueName: string, abbreviation?: string): boolean {
  const text = `${leagueName ?? ""} ${abbreviation ?? ""}`.toLowerCase();
  if (!text.trim()) return false;

  // Explicit non-T20 formats are excluded outright.
  if (/\btest\b|test match|test championship|first[- ]class|\bfc\b|multi[- ]day|four[- ]day|\b4[- ]day\b/.test(text)) {
    return false;
  }
  if (/\bodi\b|one[- ]day|list a|\b50[- ]over|fifty[- ]over|\bod\b cup/.test(text)) {
    return false;
  }
  if (/the hundred|\bthe 100\b/.test(text)) return true; // 100-ball is T20-adjacent; keep it.

  // Branded T20 competitions.
  if (/indian premier league|\bipl\b|big bash|\bbbl\b|\bwbbl\b|pakistan super league|\bpsl\b|major league cricket|\bmlc\b|caribbean premier league|\bcpl\b|vitality blast|t20 blast|twenty20 cup|super smash|\bsa20\b|\bilt20\b|\blpl\b|\bbpl\b|\bwpl\b/.test(text)) {
    return true;
  }

  // Explicit T20 markers.
  if (/\bt20i?\b|twenty20|twenty 20|\bt20\d|\btg20\b|\bg20\b|eleven twenty20|t20 trophy|t20 cup/.test(text)) {
    return true;
  }
  // League names embedding a "...20" branding (TG20, SA20, ILT20) are T20.
  if (/\b[a-z]{1,4}20\b/.test(text)) return true;
  // T20 World Cup.
  if (/world cup/.test(text) && /t20|twenty20/.test(text)) return true;

  // Unknown / ambiguous competitions are treated as non-T20 so we stay strict.
  return false;
}

/**
 * Derive a concise, user-facing competition/format label from a cricket league
 * name. The goal is a short pill string that tells the user what *kind* of
 * cricket match it is. Detection is heuristic and order-sensitive.
 */
export function cricketFormatLabel(leagueName: string, abbreviation?: string): string {
  const name = (leagueName ?? "").trim();
  if (!name) return abbreviation?.toUpperCase() || "Cricket";
  const lower = name.toLowerCase();
  const isWomen = /\bwomen('s)?\b|\bwt20\b|\bwomen\b|ladies/.test(lower);

  // Well-known branded competitions keep their name.
  if (/indian premier league|\bipl\b/.test(lower)) return "IPL";
  if (/big bash|\bbbl\b/.test(lower)) return isWomen ? "WBBL" : "Big Bash";
  if (/the hundred/.test(lower)) return isWomen ? "The Hundred (W)" : "The Hundred";
  if (/pakistan super league|\bpsl\b/.test(lower)) return "PSL";
  if (/major league cricket|\bmlc\b/.test(lower)) return "MLC";
  if (/caribbean premier league|\bcpl\b/.test(lower)) return "CPL";
  if (/vitality blast|t20 blast|twenty20 cup/.test(lower)) return isWomen ? "Blast (W)" : "T20 Blast";
  if (/super smash/.test(lower)) return "Super Smash";

  // Format detection by keyword.
  if (/\btest\b|test championship|test match/.test(lower)) return isWomen ? "Women's Test" : "Test";
  if (/\bt20i\b|t20 international/.test(lower)) return isWomen ? "Women's T20I" : "T20I";
  if (/\bodi\b|one day international|one-day international/.test(lower)) return isWomen ? "Women's ODI" : "ODI";
  if (/\bt20\b|twenty20|twenty 20|\bt20\d|\bg20\b|\btg20\b/.test(lower)) return isWomen ? "Women's T20" : "T20";
  // League names that embed a "...20" branding (e.g. "TG20", "SA20", "ILT20",
  // "LPL T20") are virtually always T20 competitions.
  if (/\b[a-z]{1,4}20\b/.test(lower)) return isWomen ? "Women's T20" : "T20";
  if (/world cup/.test(lower)) {
    if (/t20/.test(lower)) return isWomen ? "Women's T20 WC" : "T20 World Cup";
    return isWomen ? "Women's World Cup" : "World Cup";
  }
  if (/champions trophy/.test(lower)) return "Champions Trophy";

  // Bilateral tours ("X tour of Y") are usually limited-overs; keep them generic
  // but flag women's matches.
  if (isWomen) return "Women's Cricket";

  // Fall back to the abbreviation, otherwise a trimmed competition name.
  if (abbreviation && abbreviation.length <= 6) return abbreviation.toUpperCase();
  return name.length <= 22 ? name : "Cricket";
}
