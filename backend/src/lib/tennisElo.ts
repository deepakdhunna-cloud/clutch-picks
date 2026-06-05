/**
 * Tennis player-Elo refresh (FREE, no external/paid feed).
 *
 * Tennis is the one league where our factor model has clear headroom: it runs
 * on ATP/WTA ranking only, while the dominant rating_diff factor is dead because
 * no player-Elo is ever computed (every player reads the default 1500). The
 * leak-aware replay proved a rolled-forward player-Elo lifts tennis accuracy by
 * ~5-8 correct picks per 150.
 *
 * This rolls a per-PLAYER Elo from completed ESPN tennis results and persists it
 * to the same eloRating table the team sports use — keyed by the ESPN player id,
 * which is the SAME id the live tennis matchup carries (game.homeTeam.id). So
 * production reads it back via getEloRating(playerId, "TENNIS") with no fragile
 * name-matching. Reuses the proven initializeEloFromSchedule roll-forward.
 */

import { initializeEloFromSchedule } from "./elo";

const TOURS = ["atp", "wta"] as const;
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
};

interface PlayerMatchResult {
  teamId: string;     // winner player id
  opponentId: string; // loser player id
  won: boolean;       // always true (entry is from the winner's perspective)
  date: string;
}

function isWinner(flag: unknown): boolean {
  return flag === true;
}

/** Extract completed singles results (winner id, loser id) from one ESPN tennis scoreboard day. */
async function fetchTennisResultsForDate(dateYYYYMMDD: string): Promise<PlayerMatchResult[]> {
  const out: PlayerMatchResult[] = [];
  for (const tour of TOURS) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard?dates=${dateYYYYMMDD}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: FETCH_HEADERS });
      if (!res.ok) continue;
      const data = (await res.json()) as any;
      for (const event of data?.events ?? []) {
        for (const grouping of event?.groupings ?? []) {
          for (const match of grouping?.competitions ?? []) {
            const parsed = parseMatchResult(match, String(match?.date ?? event?.date ?? dateYYYYMMDD));
            if (parsed) out.push(parsed);
          }
        }
      }
    } catch {
      // ignore per-tour errors; a missing day just contributes no results
    }
  }
  return out;
}

/** Pure parser (exported for tests): one ESPN tennis competition → a winner/loser result, or null. */
export function parseMatchResult(match: any, date: string): PlayerMatchResult | null {
  const competitors: any[] = match?.competitors ?? [];
  if (competitors.length !== 2) return null;
  const a = competitors[0];
  const b = competitors[1];
  const aId = String(a?.id ?? a?.athlete?.id ?? "");
  const bId = String(b?.id ?? b?.athlete?.id ?? "");
  if (!aId || !bId || aId === bId) return null;

  let winnerId: string | null = null;
  let loserId: string | null = null;
  if (isWinner(a?.winner)) {
    winnerId = aId;
    loserId = bId;
  } else if (isWinner(b?.winner)) {
    winnerId = bId;
    loserId = aId;
  } else {
    return null; // no winner flag (in-progress, walkover w/o flag) — unscoreable
  }
  if (!date) return null;
  return { teamId: winnerId, opponentId: loserId, won: true, date };
}

function isoDaysAgo(base: number, daysAgo: number): string {
  const d = new Date(base - daysAgo * 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Roll player-Elo forward from the last `daysBack` days of ESPN tennis results
 * and persist it (keyed by ESPN player id, sport "TENNIS"). Idempotent — a full
 * chronological replay each run, like the team-sport refresh.
 */
export async function refreshTennisPlayerElo(daysBack = 365): Promise<Map<string, number>> {
  const now = Date.now();
  const days: string[] = [];
  for (let i = daysBack; i >= 0; i -= 1) days.push(isoDaysAgo(now, i));

  const results: PlayerMatchResult[] = [];
  // Fetch in small concurrent batches to be polite to ESPN.
  const BATCH = 8;
  for (let i = 0; i < days.length; i += BATCH) {
    const slice = days.slice(i, i + BATCH);
    const batches = await Promise.all(slice.map((d) => fetchTennisResultsForDate(d)));
    for (const b of batches) results.push(...b);
  }

  if (results.length === 0) return new Map();
  // initializeEloFromSchedule dedupes by player-pair + date and persists final
  // ratings via setEloRating. teamId = ESPN player id.
  return initializeEloFromSchedule("TENNIS", results);
}
