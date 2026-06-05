/**
 * Point-in-Time Elo Snapshot Storage
 *
 * Stores Elo ratings at the moment each prediction is made, enabling:
 * 1. Leak-free backtesting — historical predictions use the Elo that was
 *    actually available at game time, not the current (future-contaminated) value.
 * 2. Elo trajectory analysis — track how a team's rating evolved over the season.
 * 3. Prediction auditing — verify what inputs the engine actually used.
 *
 * Storage strategy:
 * - Primary: Prisma EloSnapshot table (persistent, queryable)
 * - Fallback: In-memory ring buffer for recent snapshots (fast reads, no DB dependency)
 * - The snapshot is taken at prediction time and stored alongside the prediction.
 *
 * This module provides:
 * - recordEloSnapshot(): Save a snapshot when a prediction is made
 * - getEloAtDate(): Retrieve the Elo rating for a team at a specific date
 * - getEloHistory(): Retrieve the Elo trajectory for a team over a date range
 */

import { prisma } from "../prisma";
import { LRUCache } from "lru-cache";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EloSnapshotRecord {
  sport: string;
  teamId: string;
  rating: number;
  date: string;       // ISO date (YYYY-MM-DD)
  gameId?: string;    // The game this snapshot was taken for
  source: "prediction" | "replay" | "daily-cron";
}

export interface EloAtDateResult {
  rating: number;
  date: string;
  source: "snapshot" | "interpolated" | "current";
  confidence: "exact" | "approximate";
}

// ─── In-Memory Ring Buffer ──────────────────────────────────────────────────
// For fast lookups without DB round-trips during prediction runs.
// Keyed by "{sport}-{teamId}", stores the last N snapshots per team.

const BUFFER_SIZE_PER_TEAM = 100; // Keep last 100 snapshots per team
const snapshotBuffer = new LRUCache<string, EloSnapshotRecord[]>({ max: 2000 });

function bufferKey(sport: string, teamId: string): string {
  return `${sport}-${teamId}`;
}

function addToBuffer(record: EloSnapshotRecord): void {
  const key = bufferKey(record.sport, record.teamId);
  const existing = snapshotBuffer.get(key) ?? [];
  existing.push(record);
  // Keep only the most recent N entries
  if (existing.length > BUFFER_SIZE_PER_TEAM) {
    existing.splice(0, existing.length - BUFFER_SIZE_PER_TEAM);
  }
  snapshotBuffer.set(key, existing);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Record an Elo snapshot at prediction time.
 * Called by the prediction pipeline after reading the Elo but before computing factors.
 * This is fire-and-forget — it never blocks the prediction path.
 */
export function recordEloSnapshot(
  sport: string,
  teamId: string,
  rating: number,
  gameDate: Date,
  gameId?: string,
  source: "prediction" | "replay" | "daily-cron" = "prediction"
): void {
  const date = gameDate.toISOString().slice(0, 10);
  const record: EloSnapshotRecord = { sport, teamId, rating, date, gameId, source };

  // Always update the in-memory buffer synchronously
  addToBuffer(record);

  // Persist to DB asynchronously (fire-and-forget)
  persistSnapshot(record).catch(() => {
    // Silently ignore DB write failures — the in-memory buffer is the primary
    // source for same-session reads, and the DB is for cross-session persistence.
  });
}

/**
 * Get the Elo rating for a team at a specific date.
 * Checks in-memory buffer first, then DB, then falls back to current rating.
 */
export async function getEloAtDate(
  sport: string,
  teamId: string,
  targetDate: Date
): Promise<EloAtDateResult> {
  const dateStr = targetDate.toISOString().slice(0, 10);
  const key = bufferKey(sport, teamId);

  // 1. Check in-memory buffer for exact date match
  const buffered = snapshotBuffer.get(key);
  if (buffered) {
    const exact = buffered.find((r) => r.date === dateStr);
    if (exact) {
      return { rating: exact.rating, date: exact.date, source: "snapshot", confidence: "exact" };
    }

    // Find the closest snapshot before the target date
    const before = buffered
      .filter((r) => r.date <= dateStr)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (before.length > 0 && before[0]) {
      return { rating: before[0].rating, date: before[0].date, source: "snapshot", confidence: "approximate" };
    }
  }

  // 2. Check DB for the closest snapshot on or before the target date
  try {
    const dbSnapshot = await prisma.eloSnapshot.findFirst({
      where: {
        sport,
        teamId,
        date: { lte: targetDate },
      },
      orderBy: { date: "desc" },
    });

    if (dbSnapshot) {
      const snapshotDate = dbSnapshot.date.toISOString().slice(0, 10);
      const isExact = snapshotDate === dateStr;
      return {
        rating: dbSnapshot.rating,
        date: snapshotDate,
        source: "snapshot",
        confidence: isExact ? "exact" : "approximate",
      };
    }
  } catch {
    // DB unavailable — fall through to current rating
  }

  // 3. Fallback: return current rating (this is the "leaky" path we're trying to eliminate)
  try {
    const current = await prisma.eloRating.findUnique({
      where: { id: `${sport}-${teamId}` },
    });
    return {
      rating: current?.rating ?? 1500,
      date: dateStr,
      source: "current",
      confidence: "approximate",
    };
  } catch {
    return { rating: 1500, date: dateStr, source: "current", confidence: "approximate" };
  }
}

/**
 * Get the Elo trajectory for a team over a date range.
 * Useful for visualization and trend analysis.
 */
export async function getEloHistory(
  sport: string,
  teamId: string,
  startDate: Date,
  endDate: Date
): Promise<EloSnapshotRecord[]> {
  try {
    const rows = await prisma.eloSnapshot.findMany({
      where: {
        sport,
        teamId,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: "asc" },
    });

    return rows.map((r: any) => ({
      sport: r.sport,
      teamId: r.teamId,
      rating: r.rating,
      date: r.date.toISOString().slice(0, 10),
      gameId: r.gameId ?? undefined,
      source: r.source as "prediction" | "replay" | "daily-cron",
    }));
  } catch {
    // Fallback to in-memory buffer
    const key = bufferKey(sport, teamId);
    const buffered = snapshotBuffer.get(key) ?? [];
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);
    return buffered.filter((r) => r.date >= startStr && r.date <= endStr);
  }
}

/**
 * Batch record snapshots for all teams at a specific date.
 * Used by the daily cron to capture a full league snapshot.
 */
export function recordDailySnapshot(
  sport: string,
  ratings: Map<string, number>,
  date: Date
): void {
  for (const [teamId, rating] of ratings.entries()) {
    recordEloSnapshot(sport, teamId, rating, date, undefined, "daily-cron");
  }
}

// ─── Internal ───────────────────────────────────────────────────────────────

async function persistSnapshot(record: EloSnapshotRecord): Promise<void> {
  const id = `${record.sport}-${record.teamId}-${record.date}-${record.gameId ?? "daily"}`;
  await prisma.eloSnapshot.upsert({
    where: { id },
    create: {
      id,
      sport: record.sport,
      teamId: record.teamId,
      rating: record.rating,
      date: new Date(record.date),
      gameId: record.gameId ?? null,
      source: record.source,
    },
    update: {
      rating: record.rating,
      source: record.source,
    },
  });
}
