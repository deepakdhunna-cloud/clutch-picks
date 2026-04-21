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
