/**
 * MLB home-plate umpire lookup + zone tendency integration.
 *
 * The previous `umpire` factor in prediction/factors/mlb.ts was a placeholder
 * marked `available: false`. This module wires it up to real data:
 *
 *   1. Use MLB Stats API /schedule?hydrate=officials to find the home plate
 *      umpire for a given matchup. We fetch one day at a time (cached) and
 *      index by (homeMlbTeamId → umpire).
 *   2. Cross-reference the umpire name against a static JSON file of known
 *      zone biases (./data/umpireZoneTendencies.json). The file is a manual
 *      seed list derived from public UmpScorecards aggregates and should be
 *      expanded over time — see the file's own _meta.description.
 *
 * The file is intentionally JSON (not TS) so it can be updated without a
 * build. If the umpire is unknown or unassigned, `lookupHomePlateUmpire`
 * returns null and the factor stays `available: false` (but with a more
 * honest evidence string than before).
 */

import { LRUCache } from "lru-cache";
import { getMLBTeamIdFromESPN } from "./mlbStatsApi";
import umpireData from "./data/umpireZoneTendencies.json" assert { type: "json" };

// ─── Tendency types ─────────────────────────────────────────────────────────

export interface UmpireTendency {
  /** Signed runs/game bias. Negative = pitcher's zone, positive = hitter's zone. */
  runsPerGameBias: number;
  /** Signed home-team favoritism bias (reserved for future use). */
  favorsHome: number;
  /** Career games worked with measured zone data. */
  sampleSize: number;
}

/**
 * What we surface to the prediction engine for a given game's home-plate ump.
 *
 *   tendency === null   → umpire is assigned, but not in our historical file
 *                          (factor ships `available: false` with a name-level
 *                          evidence string).
 *   tendency !== null   → live bias data — factor can apply a real delta.
 */
export interface UmpireZoneBias {
  name: string;
  tendency: UmpireTendency | null;
}

interface UmpireTendencyFile {
  _meta?: unknown;
  umpires: Record<string, UmpireTendency>;
}

/**
 * Canonicalize an umpire name so lookups are resilient to diacritics and
 * whitespace variance between the MLB StatsAPI and our hand-curated JSON.
 *
 *   "Ángel   Hernández"  → "Angel Hernandez"
 *   " cb  bucknor "      → "cb bucknor"  (case preserved; callers compare
 *                          case-insensitively via the normalized TENDENCY_TABLE)
 *
 * Applied at JSON load time (below) AND to every name coming back from
 * MLB StatsAPI before we hit TENDENCY_TABLE.
 */
export function normalizeUmpireName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

const RAW_UMPIRES = (umpireData as unknown as UmpireTendencyFile).umpires ?? {};
// Build a normalized lookup table once at module load. Keys in the JSON can
// contain accented characters or inconsistent spacing; this makes us robust.
const TENDENCY_TABLE: Record<string, UmpireTendency> = Object.fromEntries(
  Object.entries(RAW_UMPIRES).map(([k, v]) => [normalizeUmpireName(k), v]),
);

export function getUmpireTendency(name: string): UmpireTendency | null {
  return TENDENCY_TABLE[normalizeUmpireName(name)] ?? null;
}

// ─── Daily officials lookup ─────────────────────────────────────────────────
// Map shape: homeMlbTeamId → umpire name (for the requested date).
const DAILY_OFFICIALS_TTL_MS = 60 * 60 * 1000; // 1 hour

const dailyOfficialsCache = new LRUCache<
  string,
  { data: Map<number, string>; timestamp: number }
>({ max: 14 });

interface MLBScheduleResponse {
  dates?: Array<{
    games?: Array<{
      gamePk?: number;
      teams?: {
        home?: { team?: { id?: number } };
        away?: { team?: { id?: number } };
      };
      officials?: Array<{
        official?: { fullName?: string };
        officialType?: string;
      }>;
    }>;
  }>;
}

/**
 * Fetch the MLB schedule for `dateStr` with officials hydrated and build a
 * map of { homeMlbTeamId → homePlateUmpireName } for that day.
 *
 * Cached for 1 hour per date. Returns an empty map on failure.
 */
async function fetchDailyOfficials(dateStr: string): Promise<Map<number, string>> {
  const cached = dailyOfficialsCache.get(dateStr);
  if (cached && Date.now() - cached.timestamp < DAILY_OFFICIALS_TTL_MS) {
    return cached.data;
  }

  const result = new Map<number, string>();

  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=officials`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      dailyOfficialsCache.set(dateStr, { data: result, timestamp: Date.now() });
      return result;
    }

    const data = (await response.json()) as MLBScheduleResponse;

    for (const dateEntry of data.dates ?? []) {
      for (const game of dateEntry.games ?? []) {
        const homeId = game.teams?.home?.team?.id;
        if (typeof homeId !== "number") continue;
        const hp = (game.officials ?? []).find(
          (o) => o.officialType === "Home Plate",
        );
        const name = hp?.official?.fullName;
        if (name) result.set(homeId, name);
      }
    }
  } catch {
    // network / parse error — fall through with an empty map
  }

  dailyOfficialsCache.set(dateStr, { data: result, timestamp: Date.now() });
  return result;
}

// ─── Public lookup ──────────────────────────────────────────────────────────

/**
 * Look up the home plate umpire for a game.
 *
 * Returns:
 *   - `null` if no umpire is yet assigned / lookup failed.
 *   - `{ name, tendency: null }` if the umpire is assigned but we have no
 *     historical zone data for them.
 *   - `{ name, tendency: {...} }` if we have full bias data.
 */
export async function lookupHomePlateUmpireBias(
  espnHomeTeamId: number | string,
  gameDate: Date,
): Promise<UmpireZoneBias | null> {
  const name = await lookupHomePlateUmpireName(espnHomeTeamId, gameDate);
  if (!name) return null;
  return { name, tendency: getUmpireTendency(name) };
}

/**
 * Lower-level variant that only resolves the umpire's name — use when you
 * want to surface "{name} — no historical data" for unknown umpires.
 */
export async function lookupHomePlateUmpireName(
  espnHomeTeamId: number | string,
  gameDate: Date,
): Promise<string | null> {
  const mlbHomeId = getMLBTeamIdFromESPN(espnHomeTeamId);
  if (mlbHomeId === null) return null;

  const dateStr = gameDate.toISOString().slice(0, 10);
  const byHome = await fetchDailyOfficials(dateStr);
  return byHome.get(mlbHomeId) ?? null;
}
