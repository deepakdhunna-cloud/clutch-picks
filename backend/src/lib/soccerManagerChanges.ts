/**
 * Manager-change lookup. Backs the "new manager bounce" factor in the
 * EPL/MLS/UCL files. The JSON table must contain only verified rows from a
 * documented source; when empty, this factor stays unavailable.
 */

import changesRaw from "./data/soccerManagerChanges.json" assert { type: "json" };
import { env } from "../env";

interface ManagerChangeEntry {
  newManager: string;
  changeDate: string; // YYYY-MM-DD
}

interface ManagerChangesFile {
  _meta?: unknown;
  EPL: Record<string, ManagerChangeEntry>;
  MLS: Record<string, ManagerChangeEntry>;
  UCL_teams: Record<string, ManagerChangeEntry>;
}

const MAX_STALE_DAYS = 60;
const VERIFIED_FEED_TTL_MS = 6 * 60 * 60 * 1000;
const LOCAL_DATA = normalizeManagerChanges(
  changesRaw as unknown as Partial<ManagerChangesFile>,
);
let verifiedFeedCache: { data: ManagerChangesFile; expiresAt: number } | null = null;

export interface ManagerChangeHit {
  daysSinceChange: number;
  newManager: string;
}

function isManagerChangeEntry(value: unknown): value is ManagerChangeEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ManagerChangeEntry>;
  return typeof row.newManager === "string" && typeof row.changeDate === "string";
}

function normalizeBucket(bucket: unknown): Record<string, ManagerChangeEntry> {
  if (!bucket || typeof bucket !== "object") return {};
  return Object.fromEntries(
    Object.entries(bucket as Record<string, unknown>).filter((entry): entry is [string, ManagerChangeEntry] =>
      isManagerChangeEntry(entry[1]),
    ),
  );
}

function normalizeManagerChanges(file: Partial<ManagerChangesFile>): ManagerChangesFile {
  return {
    EPL: normalizeBucket(file.EPL),
    MLS: normalizeBucket(file.MLS),
    UCL_teams: normalizeBucket(file.UCL_teams),
  };
}

async function loadManagerChanges(): Promise<ManagerChangesFile> {
  if (!env.SOCCER_MANAGER_CHANGES_SOURCE_URL) return LOCAL_DATA;
  if (verifiedFeedCache && verifiedFeedCache.expiresAt > Date.now()) {
    return verifiedFeedCache.data;
  }

  try {
    const response = await fetch(env.SOCCER_MANAGER_CHANGES_SOURCE_URL, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = normalizeManagerChanges(
      (await response.json()) as Partial<ManagerChangesFile>,
    );
    verifiedFeedCache = { data, expiresAt: Date.now() + VERIFIED_FEED_TTL_MS };
    return data;
  } catch (error) {
    console.warn("[verified-data] soccer manager-change feed unavailable:", error);
    return LOCAL_DATA;
  }
}

/**
 * Returns null if team isn't in the list OR the change is >60 days old.
 * Matches teamName exactly (case-sensitive) against verified ESPN
 * displayName keys.
 */
export async function lookupManagerChange(
  sport: string,
  teamName: string,
  asOf: Date = new Date(),
): Promise<ManagerChangeHit | null> {
  const data = await loadManagerChanges();
  const bucket =
    sport === "EPL"
      ? data.EPL
      : sport === "MLS"
        ? data.MLS
        : sport === "UCL"
          ? data.UCL_teams
          : null;
  if (!bucket) return null;

  const entry = bucket[teamName];
  if (!entry) return null;

  const changed = new Date(entry.changeDate).getTime();
  if (Number.isNaN(changed)) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  const daysSinceChange = Math.floor((asOf.getTime() - changed) / dayMs);
  if (daysSinceChange < 0) return null;
  if (daysSinceChange > MAX_STALE_DAYS) return null;

  return { daysSinceChange, newManager: entry.newManager };
}
