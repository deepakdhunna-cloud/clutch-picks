import { LRUCache } from "lru-cache";

export interface IPLStandingEntry {
  teamId: string;
  abbreviation: string;
  rank: number | null;
  matchesPlayed: number | null;
  wins: number | null;
  losses: number | null;
  noResult: number;
  matchPoints: number | null;
  netRunRate: number | null;
  record: string | null;
}

interface ESPNStandingsResponse {
  children?: Array<{
    standings?: {
      entries?: ESPNStandingEntry[];
    };
  }>;
}

interface ESPNStandingEntry {
  team?: {
    id?: string;
    abbreviation?: string;
  };
  stats?: Array<{
    name?: string;
    type?: string;
    value?: number;
    displayValue?: string;
  }>;
}

const IPL_STANDINGS_URL = "https://site.web.api.espn.com/apis/v2/sports/cricket/8048/standings";
const IPL_STANDINGS_CACHE_TTL_MS = 10 * 60 * 1000;

const standingsCache = new LRUCache<string, { data: Map<string, IPLStandingEntry>; timestamp: number }>({
  max: 2,
});

function statValue(entry: ESPNStandingEntry, names: string[]): number | null {
  const targets = new Set(names.map((name) => name.toLowerCase()));
  const stat = entry.stats?.find((candidate) =>
    targets.has((candidate.name ?? "").toLowerCase()) ||
    targets.has((candidate.type ?? "").toLowerCase()),
  );
  if (typeof stat?.value === "number" && Number.isFinite(stat.value)) {
    return stat.value;
  }
  const parsed = Number(stat?.displayValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIPLStandingEntry(entry: ESPNStandingEntry): IPLStandingEntry | null {
  const teamId = entry.team?.id?.trim();
  const abbreviation = entry.team?.abbreviation?.trim();
  if (!teamId || !abbreviation) return null;

  const wins = statValue(entry, ["matchesWon", "matcheswon", "wins"]);
  const losses = statValue(entry, ["matchesLost", "matcheslost", "losses"]);
  const tied = statValue(entry, ["matchesTied", "matchestied", "ties"]) ?? 0;
  const noResult = statValue(entry, ["noresult", "noResult"]) ?? 0;
  const extra = tied + noResult;
  const record = wins !== null && losses !== null
    ? extra > 0 ? `${wins}-${losses}-${extra}` : `${wins}-${losses}`
    : null;

  return {
    teamId,
    abbreviation,
    rank: statValue(entry, ["rank"]),
    matchesPlayed: statValue(entry, ["matchesPlayed", "matchesplayed"]),
    wins,
    losses,
    noResult,
    matchPoints: statValue(entry, ["matchPoints", "matchpoints", "points"]),
    netRunRate: statValue(entry, ["netrr", "netRunRate", "netrunrate", "nrr"]),
    record,
  };
}

export function indexIPLStandings(entries: IPLStandingEntry[]): Map<string, IPLStandingEntry> {
  const indexed = new Map<string, IPLStandingEntry>();
  for (const entry of entries) {
    for (const key of [entry.teamId, entry.abbreviation]) {
      indexed.set(key.toUpperCase(), entry);
    }
  }
  return indexed;
}

export async function fetchIPLStandings(): Promise<Map<string, IPLStandingEntry>> {
  const cached = standingsCache.get("current");
  if (cached && Date.now() - cached.timestamp < IPL_STANDINGS_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const response = await fetch(IPL_STANDINGS_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return new Map();
    const data = (await response.json()) as ESPNStandingsResponse;
    const rows = (data.children ?? [])
      .flatMap((child) => child.standings?.entries ?? [])
      .map(parseIPLStandingEntry)
      .filter((entry): entry is IPLStandingEntry => entry !== null);
    const indexed = indexIPLStandings(rows);
    standingsCache.set("current", { data: indexed, timestamp: Date.now() });
    return indexed;
  } catch (error) {
    console.warn("[ipl-standings] failed to fetch standings:", error instanceof Error ? error.message : error);
    return cached?.data ?? new Map();
  }
}
