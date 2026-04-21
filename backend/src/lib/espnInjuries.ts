/**
 * ESPN per-game injury fetcher.
 *
 * The per-team injuries endpoint (/teams/{id}/injuries) returns {} as of
 * 2026-04. The per-game summary endpoint (/summary?event={gameId}) DOES
 * return populated injury data for both teams in a game — use that.
 *
 * Coverage:
 *   - NBA, NFL, MLB, NHL, NCAAF, NCAAB: verified shape, implemented below.
 *   - EPL/MLS/UCL: soccer summary endpoints don't publish this structure
 *     consistently — callers should fall back to the old per-team path.
 */

import { LRUCache } from "lru-cache";

// ─── ESPN sport slug mapping ─────────────────────────────────────────────

const ESPN_SUMMARY_SPORT_PATHS: Record<string, string> = {
  NBA: "basketball/nba",
  NFL: "football/nfl",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  NCAAF: "football/college-football",
  NCAAB: "basketball/mens-college-basketball",
};

function isSupportedSport(sport: string): boolean {
  return sport in ESPN_SUMMARY_SPORT_PATHS;
}

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
  position: string;
  status: InjuryStatus;
  injuryType: string;      // e.g. "Oblique strain"
  returnDate: string | null;
}

export interface GameInjuryReport {
  homeTeamInjuries: PlayerInjury[];
  awayTeamInjuries: PlayerInjury[];
}

// ─── Cache ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — injuries change slowly

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

function composeInjuryType(details: any): string {
  if (!details || typeof details !== "object") return "";
  const type = typeof details.type === "string" ? details.type : "";
  const location = typeof details.location === "string" ? details.location : "";
  const detail = typeof details.detail === "string" ? details.detail : "";
  const parts = [type, detail].filter(Boolean);
  const base = parts.join(" ").trim();
  if (!base) return location;
  return location ? `${base} (${location})` : base;
}

// ─── Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses a single ESPN injury record into a PlayerInjury. Returns null if
 * the record is malformed (missing player name/id).
 */
export function parseESPNInjury(record: any): PlayerInjury | null {
  const athlete = record?.athlete ?? {};
  const playerName =
    athlete.fullName ?? athlete.displayName ?? athlete.shortName ?? "";
  if (!playerName) return null;

  const playerId = String(athlete.id ?? "");
  const position =
    athlete.position?.abbreviation ?? athlete.position?.name ?? "";

  const statusRaw = record?.status ?? record?.type?.description ?? record?.type?.name ?? "";
  const status = normalizeStatus(statusRaw);

  const injuryType = composeInjuryType(record?.details);
  const returnDate =
    typeof record?.details?.returnDate === "string"
      ? record.details.returnDate
      : null;

  return {
    playerId,
    playerName,
    position,
    status,
    injuryType,
    returnDate,
  };
}

/**
 * Parse the full ESPN summary response into home/away injury arrays by
 * matching the top-level `injuries[].team.id` against the provided IDs.
 */
export function parseGameInjuries(
  data: any,
  homeTeamId: string,
  awayTeamId: string,
): GameInjuryReport {
  const result: GameInjuryReport = {
    homeTeamInjuries: [],
    awayTeamInjuries: [],
  };

  const teamBuckets: any[] = Array.isArray(data?.injuries) ? data.injuries : [];
  for (const bucket of teamBuckets) {
    const teamId = String(bucket?.team?.id ?? "");
    const list: any[] = Array.isArray(bucket?.injuries) ? bucket.injuries : [];
    const parsed: PlayerInjury[] = [];
    for (const rec of list) {
      const injury = parseESPNInjury(rec);
      if (injury) parsed.push(injury);
    }
    if (teamId === String(homeTeamId)) {
      result.homeTeamInjuries = parsed;
    } else if (teamId === String(awayTeamId)) {
      result.awayTeamInjuries = parsed;
    }
  }

  return result;
}

// ─── Public fetcher ──────────────────────────────────────────────────────

/**
 * Fetch the per-game injury report for a supported sport.
 *
 * Returns null for soccer leagues (EPL/MLS/UCL) so the caller can fall
 * back to the old per-team path. On any fetch/parse failure, returns an
 * empty report (safe default — never throws).
 */
export async function fetchGameInjuries(
  sport: string,
  gameId: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<GameInjuryReport | null> {
  if (!isSupportedSport(sport)) return null;

  const cacheKey = `${sport}-${gameId}`;
  const cached = injuryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const sportPath = ESPN_SUMMARY_SPORT_PATHS[sport]!;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${gameId}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      const empty: GameInjuryReport = { homeTeamInjuries: [], awayTeamInjuries: [] };
      injuryCache.set(cacheKey, { data: empty, timestamp: Date.now() });
      return empty;
    }

    const data = await response.json();
    const parsed = parseGameInjuries(data, homeTeamId, awayTeamId);

    injuryCache.set(cacheKey, { data: parsed, timestamp: Date.now() });
    return parsed;
  } catch (err) {
    console.warn(
      `[injuries] summary fetch failed for ${sport} game ${gameId}:`,
      err instanceof Error ? err.message : err,
    );
    const empty: GameInjuryReport = { homeTeamInjuries: [], awayTeamInjuries: [] };
    injuryCache.set(cacheKey, { data: empty, timestamp: Date.now() });
    return empty;
  }
}

// ─── Translation into the existing TeamInjuryReport shape ────────────────
// The prediction factor code already consumes TeamInjuryReport (name,
// position, detail + bucketed arrays). Translate here so factor logic
// doesn't change.

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
      detail: inj.injuryType,
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
