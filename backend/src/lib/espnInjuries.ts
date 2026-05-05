/**
 * ESPN per-game injury fetcher.
 *
 * The per-team injuries endpoint (/teams/{id}/injuries) returns {} as of
 * 2026-04. The per-game summary endpoint (/summary?event={gameId}) DOES
 * return populated injury data for both teams in a game — use that.
 *
 * Coverage:
 *   - NBA, MLB, NHL: verified shape, implemented below.
 *   - Everything else (NFL, NCAA, EPL, MLS, UCL): ESPN does not publish
 *     per-game injuries here. Callers get an empty GameInjuryReport with
 *     source="unavailable" so soccer injuries continue to flow through
 *     the key-player-availability factor + ingestion pipeline.
 */

import { LRUCache } from "lru-cache";

// ─── ESPN sport slug mapping (verified working) ──────────────────────────

const SPORT_PATHS: Record<string, string> = {
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
};

// ─── Types ───────────────────────────────────────────────────────────────

export type InjuryStatus =
  | "Out"
  | "Doubtful"
  | "Questionable"
  | "Day-To-Day"
  | "Probable"
  | "Unknown";

export interface PlayerInjury {
  playerId: string;
  playerName: string;
  position: string;              // "G", "F", "P", "C" — may be ""
  status: InjuryStatus;
  injuryDescription: string;     // e.g. "Oblique strain (Left)"
  returnDate: string | null;
}

export interface GameInjuryReport {
  homeTeamInjuries: PlayerInjury[];
  awayTeamInjuries: PlayerInjury[];
  source: "espn-summary" | "unavailable";
}

// ─── Cache ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: GameInjuryReport;
  timestamp: number;
}

const injuryCache = new LRUCache<string, CacheEntry>({ max: 500 });

// ─── Status normalization ────────────────────────────────────────────────

function normalizeStatus(raw: unknown): InjuryStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("out")) return "Out";
  if (s.includes("doubtful")) return "Doubtful";
  if (s.includes("questionable")) return "Questionable";
  if (s.includes("day") || s.includes("dtd")) return "Day-To-Day";
  if (s.includes("probable")) return "Probable";
  return "Unknown";
}

/**
 * Build the human-readable injury description from ESPN's `details` object.
 * Prefers "{type} {detail}" (e.g. "Oblique strain"), appends side in parens
 * if present (e.g. "Oblique strain (Left)"), falls back to status description.
 */
function composeInjuryDescription(record: any): string {
  const details = record?.details;
  if (details && typeof details === "object") {
    const type = typeof details.type === "string" ? details.type : "";
    const detail = typeof details.detail === "string" ? details.detail : "";
    const side = typeof details.side === "string" ? details.side : "";
    const location = typeof details.location === "string" ? details.location : "";

    const base = [type, detail].filter(Boolean).join(" ").trim();
    if (base) {
      return side ? `${base} (${side})` : base;
    }
    if (location) return location;
  }

  const typeDesc = record?.type?.description;
  if (typeof typeDesc === "string" && typeDesc) return typeDesc;

  return "";
}

// ─── Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses a single ESPN injury record into a PlayerInjury. Returns null if
 * the record is malformed (missing player name).
 */
export function parseESPNInjury(record: any): PlayerInjury | null {
  const athlete = record?.athlete ?? {};
  const playerName =
    athlete.fullName ?? athlete.displayName ?? athlete.shortName ?? "";
  if (!playerName) return null;

  const playerId = String(athlete.id ?? "");
  const position =
    athlete.position?.abbreviation ?? athlete.position?.name ?? "";

  const statusRaw =
    record?.status ?? record?.type?.description ?? record?.type?.name ?? "";
  const status = normalizeStatus(statusRaw);

  const injuryDescription = composeInjuryDescription(record);

  const returnDate =
    typeof record?.details?.returnDate === "string"
      ? record.details.returnDate
      : null;

  return {
    playerId,
    playerName,
    position,
    status,
    injuryDescription,
    returnDate,
  };
}

/**
 * Parse the full ESPN summary response into home/away injury arrays by
 * matching the top-level `injuries[].team.id` against the provided IDs.
 * Array order is NOT trusted — we match explicitly by team ID.
 */
export function parseGameInjuries(
  data: any,
  homeTeamId: string,
  awayTeamId: string,
): { homeTeamInjuries: PlayerInjury[]; awayTeamInjuries: PlayerInjury[] } {
  const homeTeamInjuries: PlayerInjury[] = [];
  const awayTeamInjuries: PlayerInjury[] = [];

  const teamBuckets: any[] = Array.isArray(data?.injuries) ? data.injuries : [];
  for (const bucket of teamBuckets) {
    const teamId = String(bucket?.team?.id ?? "");
    const list: any[] = Array.isArray(bucket?.injuries) ? bucket.injuries : [];

    const target: PlayerInjury[] =
      teamId === String(homeTeamId)
        ? homeTeamInjuries
        : teamId === String(awayTeamId)
          ? awayTeamInjuries
          : [];

    if (target === homeTeamInjuries || target === awayTeamInjuries) {
      for (const rec of list) {
        const injury = parseESPNInjury(rec);
        if (injury) target.push(injury);
      }
    }
  }

  return { homeTeamInjuries, awayTeamInjuries };
}

// ─── Public fetcher ──────────────────────────────────────────────────────

const EMPTY_UNAVAILABLE: GameInjuryReport = {
  homeTeamInjuries: [],
  awayTeamInjuries: [],
  source: "unavailable",
};

/**
 * Fetch the per-game injury report. For unsupported sports (NFL, NCAA,
 * soccer) returns immediately with source="unavailable" — no network call.
 *
 * On any fetch/parse failure for a supported sport, returns an empty
 * report with source="espn-summary" (safe default — never throws).
 */
export async function fetchGameInjuries(
  sport: string,
  gameId: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<GameInjuryReport> {
  const sportPath = SPORT_PATHS[sport];
  if (!sportPath) {
    return EMPTY_UNAVAILABLE;
  }

  const cacheKey = `${sport}:${gameId}`;
  const cached = injuryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${gameId}`;

  const emptyReport: GameInjuryReport = {
    homeTeamInjuries: [],
    awayTeamInjuries: [],
    source: "espn-summary",
  };

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      injuryCache.set(cacheKey, { data: emptyReport, timestamp: Date.now() });
      return emptyReport;
    }

    const data = await response.json();
    const parsed = parseGameInjuries(data, homeTeamId, awayTeamId);
    const report: GameInjuryReport = { ...parsed, source: "espn-summary" };

    injuryCache.set(cacheKey, { data: report, timestamp: Date.now() });
    return report;
  } catch (err) {
    console.warn(
      `[injuries] summary fetch failed for ${sport} game ${gameId}:`,
      err instanceof Error ? err.message : err,
    );
    injuryCache.set(cacheKey, { data: emptyReport, timestamp: Date.now() });
    return emptyReport;
  }
}

// ─── Translation into the existing TeamInjuryReport shape ────────────────
// The prediction factor code already consumes TeamInjuryReport (buckets
// by status with name/position/detail). Translate here so factor logic
// stays unchanged — it now just receives real data.

import type { TeamInjuryReport } from "./espnStats";

export function toTeamInjuryReport(
  injuries: PlayerInjury[],
): TeamInjuryReport {
  const out: TeamInjuryReport["out"] = [];
  const doubtful: TeamInjuryReport["doubtful"] = [];
  const questionable: TeamInjuryReport["questionable"] = [];

  for (const inj of injuries) {
    const entry = {
      name: inj.playerName,
      position: inj.position,
      detail: inj.injuryDescription,
    };
    if (inj.status === "Out") {
      out.push(entry);
    } else if (inj.status === "Doubtful") {
      doubtful.push(entry);
    } else if (inj.status === "Questionable" || inj.status === "Day-To-Day") {
      questionable.push(entry);
    }
  }

  return {
    out,
    doubtful,
    questionable,
    totalOut: out.length,
    totalDoubtful: doubtful.length,
    totalQuestionable: questionable.length,
  };
}

// ─── PlayerAvailability merge ────────────────────────────────────────────
// The Apify ingestion pipeline writes injury/availability signals to the
// PlayerAvailability table on every cycle. ESPN's summary endpoint returns
// empty for all soccer (EPL/MLS/UCL). The merger below joins both sources
// so the key_player_availability factor finally has signal everywhere.

/**
 * Discriminator for the merged injury report.
 *   - "espn-summary"        : only ESPN had data
 *   - "player-availability" : only PlayerAvailability had data (soccer path)
 *   - "merged"              : both sources contributed
 *   - "unavailable"         : neither source had data
 */
export type InjurySourceTag =
  | "espn-summary"
  | "player-availability"
  | "merged"
  | "unavailable";

/**
 * TeamInjuryReport plus a source tag identifying which pipeline(s)
 * contributed. Structurally a superset of TeamInjuryReport so it can be
 * assigned to GameContext.homeInjuries / awayInjuries unchanged.
 */
export type MergedTeamInjuryReport = TeamInjuryReport & { source: InjurySourceTag };

// Structural local type — Prisma's PlayerAvailability has more fields, but
// these are the only two we read here. Importing from @prisma/client at the
// type level would also work; structural keeps this helper trivially testable.
type PlayerAvailabilityLike = {
  playerName: string;
  status: string;
};

/**
 * Merge PlayerAvailability rows (from Apify ingestion) into a
 * TeamInjuryReport already populated by ESPN's summary endpoint.
 *
 * - For soccer (EPL/MLS/UCL), ESPN returns no injury data, so PA is the
 *   sole source.
 * - For NBA/NHL/MLB, this is additive: PA fills gaps where ESPN's feed
 *   is incomplete (and ESPN occasionally is, especially mid-day).
 *
 * De-dupe by lowercase trimmed playerName. ESPN row wins on conflict —
 * its data is more authoritative for sports where ESPN does report.
 *
 * Status string -> bucket mapping:
 *   - out, minutes_restriction       -> out
 *   - doubtful                       -> doubtful
 *   - questionable, game_time_decision -> questionable
 *   - probable, available, anything else -> ignored (no signal)
 */
export function mergePlayerAvailability(
  espnReport: TeamInjuryReport,
  rows: PlayerAvailabilityLike[],
): MergedTeamInjuryReport {
  function bucketFor(status: string): "out" | "doubtful" | "questionable" | null {
    const s = status.toLowerCase().trim();
    if (s === "out" || s === "minutes_restriction") return "out";
    if (s === "doubtful") return "doubtful";
    if (s === "questionable" || s === "game_time_decision") return "questionable";
    return null;
  }

  // Names already in ESPN report — used to de-dupe so ESPN row wins.
  const espnNames = new Set<string>();
  for (const list of [espnReport.out, espnReport.doubtful, espnReport.questionable]) {
    for (const p of list) espnNames.add(p.name.toLowerCase().trim());
  }

  const out = [...espnReport.out];
  const doubtful = [...espnReport.doubtful];
  const questionable = [...espnReport.questionable];

  let paAddedAny = false;
  for (const row of rows) {
    const bucket = bucketFor(row.status);
    if (!bucket) continue;
    const key = row.playerName.toLowerCase().trim();
    if (espnNames.has(key)) continue;

    // PA rows lack a position field; the raw status string is the most
    // informative thing we have for the factor's "detail" slot.
    const entry = { name: row.playerName, position: "", detail: row.status };
    if (bucket === "out") out.push(entry);
    else if (bucket === "doubtful") doubtful.push(entry);
    else questionable.push(entry);
    paAddedAny = true;
  }

  const espnHadData =
    espnReport.out.length > 0 ||
    espnReport.doubtful.length > 0 ||
    espnReport.questionable.length > 0;

  let source: InjurySourceTag;
  if (!espnHadData && !paAddedAny) source = "unavailable";
  else if (espnHadData && paAddedAny) source = "merged";
  else if (paAddedAny) source = "player-availability";
  else source = "espn-summary";

  return {
    out,
    doubtful,
    questionable,
    totalOut: out.length,
    totalDoubtful: doubtful.length,
    totalQuestionable: questionable.length,
    source,
  };
}
