/**
 * Manager-change lookup. Backs the "new manager bounce" factor in the
 * EPL/MLS/UCL files. See ./data/soccerManagerChanges.json for the seed list.
 */

import changesRaw from "./data/soccerManagerChanges.json" assert { type: "json" };

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

const DATA = changesRaw as unknown as ManagerChangesFile;

const MAX_STALE_DAYS = 60;

export interface ManagerChangeHit {
  daysSinceChange: number;
  newManager: string;
}

/**
 * Returns null if team isn't in the list OR the change is >60 days old.
 * Matches teamName exactly (case-sensitive) against the seeded ESPN
 * displayName keys. We deliberately don't normalize here: edits to the
 * seed file are manual + infrequent, so a strict match is safer than a
 * fuzzy one.
 */
export function lookupManagerChange(
  sport: string,
  teamName: string,
  asOf: Date = new Date(),
): ManagerChangeHit | null {
  const bucket =
    sport === "EPL"
      ? DATA.EPL
      : sport === "MLS"
        ? DATA.MLS
        : sport === "UCL"
          ? DATA.UCL_teams
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
