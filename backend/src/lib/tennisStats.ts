import { LRUCache } from "lru-cache";

export type TennisTour = "ATP" | "WTA";

export interface TennisRankingEntry {
  rank: number;
  previousRank?: number;
  points?: number;
  trend?: string;
  tour: TennisTour;
  lastUpdated?: string;
}

export interface TennisRecentForm {
  results: Array<"W" | "L" | "D">;
  formString: string;
  streak: number;
  avgScore: number;
  avgAllowed: number;
  wins: number;
  losses: number;
}

interface EspnRankingList {
  items?: Array<{ "$ref"?: string }>;
}

interface EspnRankingPayload {
  lastUpdated?: string;
  ranks?: Array<{
    current?: number;
    previous?: number;
    points?: number;
    trend?: string;
    athlete?: { "$ref"?: string };
  }>;
}

const TENNIS_RANKINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TENNIS_FORM_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let tennisRankingsCache: { data: Map<string, TennisRankingEntry>; timestamp: number } | null = null;
let tennisRankingsInFlight: Promise<Map<string, TennisRankingEntry>> | null = null;

const tennisFormCache = new LRUCache<string, { data: TennisRecentForm; timestamp: number }>({ max: 500 });

function defaultTennisForm(): TennisRecentForm {
  return {
    results: [],
    formString: "",
    streak: 0,
    avgScore: 0,
    avgAllowed: 0,
    wins: 0,
    losses: 0,
  };
}

function calculateStreak(results: Array<"W" | "L" | "D">): number {
  if (results.length === 0) return 0;
  const latest = results[results.length - 1];
  if (!latest || latest === "D") return 0;

  let streak = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const result = results[i];
    if (result !== latest) break;
    streak += latest === "W" ? 1 : -1;
  }
  return streak;
}

export function extractTennisAthleteId(value: string | undefined): string | null {
  if (!value) return null;
  const uidMatch = value.match(/(?:^|~)a:(\d+)(?:$|~)/i);
  if (uidMatch?.[1]) return uidMatch[1];
  const refMatch = value.match(/athletes\/(\d+)/i);
  if (refMatch?.[1]) return refMatch[1];
  return /^\d+$/.test(value) ? value : null;
}

function rankingUrl(tour: Lowercase<TennisTour>): string {
  return `https://sports.core.api.espn.com/v2/sports/tennis/leagues/${tour}/rankings?lang=en&region=us`;
}

async function fetchRankingTour(tour: TennisTour): Promise<Map<string, TennisRankingEntry>> {
  const lowerTour = tour.toLowerCase() as Lowercase<TennisTour>;
  const listResponse = await fetch(rankingUrl(lowerTour), { signal: AbortSignal.timeout(5000) });
  if (!listResponse.ok) return new Map();

  const list = (await listResponse.json()) as EspnRankingList;
  const ref = list.items?.[0]?.["$ref"];
  if (!ref) return new Map();

  const rankingResponse = await fetch(ref.replace("http://", "https://"), {
    signal: AbortSignal.timeout(5000),
  });
  if (!rankingResponse.ok) return new Map();

  const payload = (await rankingResponse.json()) as EspnRankingPayload;
  const rankings = new Map<string, TennisRankingEntry>();
  for (const row of payload.ranks ?? []) {
    const athleteId = extractTennisAthleteId(row.athlete?.["$ref"]);
    if (!athleteId || typeof row.current !== "number") continue;
    rankings.set(athleteId, {
      rank: row.current,
      previousRank: row.previous,
      points: row.points,
      trend: row.trend,
      tour,
      lastUpdated: payload.lastUpdated,
    });
  }
  return rankings;
}

async function refreshTennisRankings(): Promise<Map<string, TennisRankingEntry>> {
  const merged = new Map<string, TennisRankingEntry>();
  const [atp, wta] = await Promise.all([
    fetchRankingTour("ATP").catch(() => new Map<string, TennisRankingEntry>()),
    fetchRankingTour("WTA").catch(() => new Map<string, TennisRankingEntry>()),
  ]);

  for (const [id, entry] of atp) merged.set(id, entry);
  for (const [id, entry] of wta) merged.set(id, entry);
  return merged;
}

export async function fetchTennisRankings(): Promise<Map<string, TennisRankingEntry>> {
  if (tennisRankingsCache && Date.now() - tennisRankingsCache.timestamp < TENNIS_RANKINGS_CACHE_TTL_MS) {
    return tennisRankingsCache.data;
  }
  if (tennisRankingsInFlight) return tennisRankingsInFlight;

  tennisRankingsInFlight = refreshTennisRankings()
    .then((data) => {
      tennisRankingsCache = { data, timestamp: Date.now() };
      return data;
    })
    .finally(() => {
      tennisRankingsInFlight = null;
    });

  return tennisRankingsInFlight;
}

export function parseTennisRecentResultsFromHtml(html: string, limit = 10): Array<"W" | "L"> {
  const sectionOrResult =
    /<tr class="total"[\s\S]*?<\/tr>|<span class="(?:greenfont|redfont)">\s*([WL])\s*<\/span>/gi;
  const allResults: Array<"W" | "L"> = [];
  const singlesResults: Array<"W" | "L"> = [];
  let inSinglesSection = false;

  for (const match of html.matchAll(sectionOrResult)) {
    const token = match[0];
    const result = match[1] as "W" | "L" | undefined;
    if (result) {
      allResults.push(result);
      if (inSinglesSection) singlesResults.push(result);
      continue;
    }

    const text = token.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
    inSinglesSection = text.includes("singles") && !text.includes("doubles");
  }

  const source = singlesResults.length > 0 ? singlesResults : allResults;
  return source.slice(0, limit);
}

function formFromLatestFirstResults(latestFirst: Array<"W" | "L">): TennisRecentForm {
  const results: Array<"W" | "L" | "D"> = [...latestFirst].reverse();
  const wins = results.filter((result) => result === "W").length;
  const losses = results.filter((result) => result === "L").length;
  return {
    results,
    formString: results.join("-"),
    streak: calculateStreak(results),
    avgScore: 0,
    avgAllowed: 0,
    wins,
    losses,
  };
}

export async function fetchTennisRecentForm(playerId: string, limit = 10): Promise<TennisRecentForm> {
  const athleteId = extractTennisAthleteId(playerId);
  if (!athleteId) return defaultTennisForm();

  const cacheKey = `${athleteId}-${limit}`;
  const cached = tennisFormCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TENNIS_FORM_CACHE_TTL_MS) {
    return cached.data;
  }

  const year = new Date().getFullYear();
  const url = `https://www.espn.com/tennis/player/results/_/id/${athleteId}/year/${year}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!response.ok) return defaultTennisForm();
    const html = await response.text();
    const results = parseTennisRecentResultsFromHtml(html, limit);
    const form = results.length >= 3 ? formFromLatestFirstResults(results) : defaultTennisForm();
    tennisFormCache.set(cacheKey, { data: form, timestamp: Date.now() });
    return form;
  } catch {
    return defaultTennisForm();
  }
}
