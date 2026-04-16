/**
 * Player-availability state store.
 *
 * Persists ExtractedSignals to PlayerAvailability with a supersede-on-write
 * rule: if an existing active row for the same (player, sport) is from a
 * LESS credible source, the new signal wins and the old row gets
 * `supersededById` set to the new row's id. If the existing row is from
 * an EQUAL-or-MORE credible source, the new signal only wins when it is
 * strictly newer.
 *
 * "Active" means: not yet past `expiresAt` AND `supersededById IS NULL`.
 * This is the surface the re-predict trigger and factor layer read from.
 *
 * Expiry: every signal lives 48h. Injury status changes fast — a 3-day
 * old "questionable" is worse than no signal.
 */

import type { ExtractedSignal } from "./types";
import { prisma } from "../../prisma";
import { getTeamByAbbr } from "./nbaTeams";

const AVAILABILITY_TTL_MS = 48 * 60 * 60 * 1000;

export interface UpsertOptions {
  sourceUrl?: string;
  sport?: string;    // defaults to "NBA" for the pilot
  now?: Date;        // test hook
}

/**
 * Insert a new signal, superseding any older active row for the same
 * (player, sport) that we outrank. Returns the newly-created row. If a
 * stricter row already exists that we don't outrank, returns that row
 * instead and does NOT insert.
 */
export async function upsertPlayerAvailability(
  signal: ExtractedSignal,
  opts: UpsertOptions = {},
) {
  const sport = opts.sport ?? "NBA";
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + AVAILABILITY_TTL_MS);

  const team = getTeamByAbbr(signal.teamAbbreviation);
  const teamId = team?.espnId ?? "";

  // Find the most recent active row for this player in this sport.
  const incumbent = await prisma.playerAvailability.findFirst({
    where: {
      playerName: signal.playerName,
      sport,
      supersededById: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (incumbent && !decideSupersede(
    { credibility: signal.sourceCredibility, now },
    { credibility: incumbent.sourceCredibility, createdAt: incumbent.createdAt },
  )) {
    return incumbent;
  }

  const created = await prisma.playerAvailability.create({
    data: {
      playerName: signal.playerName,
      teamId,
      teamAbbreviation: signal.teamAbbreviation,
      sport,
      status: signal.status,
      severity: signal.severity,
      confidence: signal.confidence,
      sourceCredibility: signal.sourceCredibility,
      gameImpactElo: signal.gameImpactElo,
      source: signal.source,
      sourceUrl: opts.sourceUrl,
      reasoning: signal.reasoning,
      expiresAt,
    },
  });

  if (incumbent) {
    await prisma.playerAvailability.update({
      where: { id: incumbent.id },
      data: { supersededById: created.id },
    });
  }

  return created;
}

/**
 * Currently-valid availability rows for a team (by abbreviation).
 * Used by the re-predict trigger to decide which games to refresh.
 */
export async function getActiveAvailability(
  teamAbbr: string,
  sport: string = "NBA",
  now: Date = new Date(),
) {
  return prisma.playerAvailability.findMany({
    where: {
      teamAbbreviation: teamAbbr,
      sport,
      supersededById: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Delete rows past their expiresAt. Run by the orchestrator each cycle
 * so the table doesn't bloat with stale rumor-mill entries.
 */
export async function cleanExpired(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.playerAvailability.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}

export const _AVAILABILITY_TTL_MS_FOR_TESTS = AVAILABILITY_TTL_MS;

// ─── Pure supersede decision (exported for unit tests) ──────────────────────
// Extracted from upsertPlayerAvailability so the "who wins" contract is
// unit-testable without a live Prisma client.
//
// Decision table:
//   incoming.credibility >  incumbent.credibility   → supersede (new wins)
//   incoming.credibility <  incumbent.credibility   → keep (old wins)
//   incoming.credibility == incumbent.credibility   → supersede iff incoming.now > incumbent.createdAt
//
// A 1e-9 epsilon is used around the equality branch to avoid float
// instability from the CREDIBILITY_SCORES table.
export function decideSupersede(
  incoming: { credibility: number; now: Date },
  incumbent: { credibility: number; createdAt: Date },
): boolean {
  const eps = 1e-9;
  if (incoming.credibility > incumbent.credibility + eps) return true;
  if (incoming.credibility < incumbent.credibility - eps) return false;
  // Same credibility within eps → freshness tiebreaker.
  return incoming.now > incumbent.createdAt;
}
