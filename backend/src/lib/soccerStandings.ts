/**
 * ESPN soccer standings fetcher.
 *
 * Used by the EPL / MLS / UCL factor files to derive late-season "stakes"
 * flags (title race, relegation battle, European-qualification race).
 *
 * Endpoint: https://site.api.espn.com/apis/v2/sports/soccer/{path}/standings
 *   EPL → soccer/eng.1
 *   MLS → soccer/usa.1
 *   UCL → soccer/uefa.champions (format differs — group / knockout stage)
 *
 * All errors → null. 8s timeout. 6-hour LRU cache.
 */

import { LRUCache } from "lru-cache";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LeagueStandingsRow {
  teamId: string;
  teamName: string;
  rank: number;           // 1-based position in the table
  gamesPlayed: number;
  points: number;
  goalDifference: number;
}

export type SoccerLeague = "EPL" | "MLS" | "UCL";

// ESPN's internal path per league (see site.api.espn.com docs)
const ESPN_SOCCER_PATH: Record<SoccerLeague, string> = {
  EPL: "soccer/eng.1",
  MLS: "soccer/usa.1",
  UCL: "soccer/uefa.champions",
};

// Teams per league (used for regular-season games-remaining math).
// UCL is group + knockout so we don't compute a simple games-remaining here.
const SEASON_GAMES_PER_TEAM: Partial<Record<SoccerLeague, number>> = {
  EPL: 38,
  MLS: 34, // Regular-season matches; playoffs handled separately
};

// ─── Cache ──────────────────────────────────────────────────────────────────

const STANDINGS_TTL_MS = 6 * 60 * 60 * 1000;
const standingsCache = new LRUCache<
  string,
  { data: LeagueStandingsRow[] | null; timestamp: number }
>({ max: 8 });

// ─── Fetch ──────────────────────────────────────────────────────────────────

interface ESPNStandingsEntry {
  team?: { id?: string; displayName?: string };
  stats?: Array<{ name?: string; type?: string; value?: number }>;
}
interface ESPNStandingsResponse {
  children?: Array<{ standings?: { entries?: ESPNStandingsEntry[] } }>;
  standings?: { entries?: ESPNStandingsEntry[] };
}

function statByName(entry: ESPNStandingsEntry, ...names: string[]): number | undefined {
  for (const stat of entry.stats ?? []) {
    if (stat.name && names.includes(stat.name)) return stat.value;
    if (stat.type && names.includes(stat.type)) return stat.value;
  }
  return undefined;
}

export async function fetchLeagueStandings(
  league: SoccerLeague,
): Promise<LeagueStandingsRow[] | null> {
  const cached = standingsCache.get(league);
  if (cached && Date.now() - cached.timestamp < STANDINGS_TTL_MS) {
    return cached.data;
  }

  const url = `https://site.api.espn.com/apis/v2/sports/${ESPN_SOCCER_PATH[league]}/standings`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      standingsCache.set(league, { data: null, timestamp: Date.now() });
      return null;
    }
    const data = (await response.json()) as ESPNStandingsResponse;

    // ESPN nests EPL / MLS entries directly under `standings.entries`; some
    // competitions (e.g. UCL group stage) nest them under `children[].standings`.
    const entries: ESPNStandingsEntry[] =
      data.standings?.entries ??
      (data.children ?? []).flatMap((c) => c.standings?.entries ?? []);

    const rows: LeagueStandingsRow[] = [];
    for (const entry of entries) {
      const teamId = entry.team?.id ?? "";
      const teamName = entry.team?.displayName ?? "";
      if (!teamId || !teamName) continue;

      const rank = statByName(entry, "rank") ?? 0;
      const gp = statByName(entry, "gamesPlayed") ?? 0;
      const points = statByName(entry, "points") ?? 0;
      const gd = statByName(entry, "pointDifferential", "goalDifference") ?? 0;

      rows.push({
        teamId: String(teamId),
        teamName,
        rank: Math.round(rank),
        gamesPlayed: Math.round(gp),
        points: Math.round(points),
        goalDifference: Math.round(gd),
      });
    }

    standingsCache.set(league, { data: rows, timestamp: Date.now() });
    return rows;
  } catch {
    standingsCache.set(league, { data: null, timestamp: Date.now() });
    return null;
  }
}

// ─── Stakes derivation ──────────────────────────────────────────────────────

export interface StakesInput {
  standings: LeagueStandingsRow[];
  teamId: string;
  league: SoccerLeague;
}

/**
 * Compute stakes flags from a league table.
 *
 *   - inTitleRace: within 8 points of the leader AND in top 3.
 *   - inRelegationRace: EPL bottom-6 or MLS bottom-4.
 *   - inEuropeRace: EPL rank 4-8; N/A for MLS/UCL (false).
 *
 * gamesRemaining is derived from SEASON_GAMES_PER_TEAM - gamesPlayed.
 * For UCL we return 0 since the format is group + knockout and
 * "games remaining" has no simple definition.
 */
export function computeStakes({ standings, teamId, league }: StakesInput) {
  const team = standings.find((r) => r.teamId === teamId);
  if (!team) return null;

  const leaderPoints = Math.max(...standings.map((r) => r.points));
  const tableSize = standings.length;

  const seasonGames = SEASON_GAMES_PER_TEAM[league] ?? 0;
  const gamesRemaining = Math.max(0, seasonGames - team.gamesPlayed);

  const inTitleRace = team.rank <= 3 && leaderPoints - team.points <= 8;

  let inRelegationRace = false;
  if (league === "EPL") inRelegationRace = team.rank >= Math.max(15, tableSize - 5);
  else if (league === "MLS") inRelegationRace = team.rank >= Math.max(tableSize - 3, 1);

  let inEuropeRace = false;
  if (league === "EPL") inEuropeRace = team.rank >= 4 && team.rank <= 8;

  return { inTitleRace, inRelegationRace, inEuropeRace, gamesRemaining };
}
