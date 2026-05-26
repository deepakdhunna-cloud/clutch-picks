import { LRUCache } from "lru-cache";
import type { TeamAdvancedMetrics, TeamRecentForm } from "./espnStats";
import type { TennisTour } from "./tennisStats";

type FreeAdvancedArgs = {
  sport: string;
  gameId: string;
  teamId: string;
  teamName?: string | null;
  teamAbbreviation?: string | null;
  gameDate: Date;
};

export type FreeTennisProfile = {
  rank?: number;
  rankingPoints?: number;
  tour?: TennisTour;
  form?: TeamRecentForm;
};

export type FreeIPLVenueSplit = {
  homeWinPct: number;
  awayRoadWinPct: number;
  homeGames: number;
  awayGames: number;
  source: "espn-cricket-h2h";
};

type EspnSummary = Record<string, any>;
type StatMap = Record<string, number>;

type NhlTeamSummaryRow = {
  teamFullName?: string;
  powerPlayPct?: number;
  penaltyKillPct?: number;
  shotsAgainstPerGame?: number;
  goalsAgainstPerGame?: number;
  shotsForPerGame?: number;
};

type TennisMatchRow = {
  tour: TennisTour;
  date: number;
  order: number;
  winnerName: string;
  loserName: string;
  winnerRank?: number;
  loserRank?: number;
  winnerPoints?: number;
  loserPoints?: number;
};

type TennisRankingRow = {
  tour: TennisTour;
  playerId: string;
  rank: number;
  points?: number;
};

type TennisPlayerRow = {
  tour: TennisTour;
  playerId: string;
  name: string;
};

type TennisExplorerPlayerLink = {
  path: string;
  displayName: string;
  tour: TennisTour;
};

const ESPN_SUMMARY_PATHS: Record<string, string> = {
  NBA: "basketball/nba",
  NCAAB: "basketball/mens-college-basketball",
  NHL: "hockey/nhl",
  IPL: "cricket/8048",
};

const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
const NHL_CACHE_TTL_MS = 30 * 60 * 1000;
const TENNIS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const summaryCache = new LRUCache<string, { data: EspnSummary; timestamp: number }>({ max: 500 });
const nhlSummaryCache = new LRUCache<string, { data: NhlTeamSummaryRow[]; timestamp: number }>({ max: 20 });
const tennisMatchesCache = new LRUCache<string, { data: TennisMatchRow[]; timestamp: number }>({ max: 12 });
const tennisRankingsCache = new LRUCache<string, { data: TennisRankingRow[]; timestamp: number }>({ max: 4 });
const tennisPlayersCache = new LRUCache<string, { data: TennisPlayerRow[]; timestamp: number }>({ max: 4 });
const tennisExplorerProfileCache = new LRUCache<string, { data: FreeTennisProfile | null; timestamp: number }>({ max: 500 });
const tennisExplorerMatchLinksCache = new LRUCache<string, { data: TennisExplorerPlayerLink[]; timestamp: number }>({ max: 80 });

const summaryInflight = new Map<string, Promise<EspnSummary | null>>();
const nhlInflight = new Map<string, Promise<NhlTeamSummaryRow[]>>();
const tennisMatchesInflight = new Map<string, Promise<TennisMatchRow[]>>();
const tennisRankingsInflight = new Map<string, Promise<TennisRankingRow[]>>();
const tennisPlayersInflight = new Map<string, Promise<TennisPlayerRow[]>>();
const tennisExplorerProfileInflight = new Map<string, Promise<FreeTennisProfile | null>>();
const tennisExplorerMatchLinksInflight = new Map<string, Promise<TennisExplorerPlayerLink[]>>();

const TENNIS_EXPLORER_BASE_URL = "https://www.tennisexplorer.com";
const TENNIS_EXPLORER_FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ClutchPicksBot/1.0)",
  "Accept": "text/html,application/xhtml+xml",
};

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/,/g, "").trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pct(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  if (parsed === undefined) return undefined;
  if (parsed >= 0 && parsed <= 1) return parsed;
  if (parsed > 1 && parsed <= 100) return parsed / 100;
  return undefined;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenKey(value: string): string {
  return normalizeName(value).split(" ").filter(Boolean).sort().join(" ");
}

function mergeMetrics(left: TeamAdvancedMetrics | null, right: TeamAdvancedMetrics | null): TeamAdvancedMetrics | null {
  const merged: TeamAdvancedMetrics = {};
  for (const source of [left, right]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        (merged as Record<string, number>)[key] = value;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

async function fetchEspnSummary(sport: string, gameId: string): Promise<EspnSummary | null> {
  const sportPath = ESPN_SUMMARY_PATHS[sport];
  if (!sportPath || !/^\d+$/.test(gameId)) return null;

  const cacheKey = `${sport}:${gameId}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SUMMARY_CACHE_TTL_MS) return cached.data;

  const existing = summaryInflight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<EspnSummary | null> => {
    try {
      const response = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${gameId}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as EspnSummary;
      summaryCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch {
      return null;
    } finally {
      summaryInflight.delete(cacheKey);
    }
  })();

  summaryInflight.set(cacheKey, request);
  return request;
}

function teamMatches(
  candidate: any,
  args: Pick<FreeAdvancedArgs, "teamId" | "teamName" | "teamAbbreviation">,
): boolean {
  const team = candidate?.team ?? candidate;
  if (String(team?.id ?? candidate?.teamId ?? "") === String(args.teamId)) return true;

  const targetAbbr = normalizeName(args.teamAbbreviation);
  if (targetAbbr && normalizeName(team?.abbreviation ?? team?.shortDisplayName) === targetAbbr) return true;

  const targetName = normalizeName(args.teamName);
  const displayName = normalizeName(team?.displayName ?? team?.name ?? team?.fullName);
  return Boolean(targetName && displayName && (displayName === targetName || displayName.includes(targetName) || targetName.includes(displayName)));
}

function extractStatsFromSummary(summary: EspnSummary, args: FreeAdvancedArgs): StatMap {
  const buckets: any[] = [
    ...(Array.isArray(summary?.boxscore?.teams) ? summary.boxscore.teams : []),
    ...(Array.isArray(summary?.boxscore?.statistics) ? summary.boxscore.statistics : []),
  ];
  const bucket = buckets.find((candidate) => teamMatches(candidate, args));
  if (!bucket) return {};

  const rawStats: any[] = [
    ...(Array.isArray(bucket?.statistics) ? bucket.statistics : []),
    ...(Array.isArray(bucket?.stats) ? bucket.stats : []),
  ];
  const stats: StatMap = {};

  for (const stat of rawStats) {
    const name = normalizeKey(String(stat?.name ?? stat?.abbreviation ?? stat?.label ?? ""));
    if (!name) continue;
    const raw = stat?.value ?? stat?.displayValue ?? stat?.display;
    const value = finiteNumber(raw);
    if (value !== undefined) stats[name] = value;
  }

  return stats;
}

function basketballMetricsFromSummary(stats: StatMap): TeamAdvancedMetrics | null {
  const avgPoints =
    stats.avgpoints ??
    stats.pointspergame ??
    stats.ppg;
  const avgAllowed =
    stats.avgpointsagainst ??
    stats.pointsallowedpergame ??
    stats.opponentpointspergame ??
    stats.oppg;

  const result: TeamAdvancedMetrics = {};
  if (avgPoints !== undefined) result.offensiveRating = avgPoints;
  if (avgAllowed !== undefined) result.defensiveRating = avgAllowed;

  const fgPct = pct(stats.fieldgoalpct ?? stats.fieldgoalpercentage);
  if (fgPct !== undefined) result.effectiveFGPct = fgPct;

  return Object.keys(result).length > 0 ? result : null;
}

function hockeyMetricsFromSummary(stats: StatMap): TeamAdvancedMetrics | null {
  const result: TeamAdvancedMetrics = {};
  const pp = pct(stats.powerplaypct ?? stats.powerplaypercentage);
  const pk = pct(stats.penaltykillpct ?? stats.penaltykillpercentage);
  if (pp !== undefined) result.powerPlayPct = pp;
  if (pk !== undefined) result.penaltyKillPct = pk;

  const avgShots = stats.avgshots ?? stats.shotspergame;
  if (avgShots !== undefined) result.shotsPerGame = avgShots;

  const avgGoalsAgainst = stats.avggoalsagainst;
  const avgShotsAgainst = stats.avgshotsagainst;
  if (avgGoalsAgainst !== undefined && avgShotsAgainst !== undefined && avgShotsAgainst > 0) {
    result.savePercentage = 1 - avgGoalsAgainst / avgShotsAgainst;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function nhlSeasonId(gameDate: Date): number {
  const year = gameDate.getUTCFullYear();
  const month = gameDate.getUTCMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return Number(`${startYear}${startYear + 1}`);
}

async function fetchNhlTeamSummaryRows(seasonId: number): Promise<NhlTeamSummaryRow[]> {
  const cacheKey = String(seasonId);
  const cached = nhlSummaryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < NHL_CACHE_TTL_MS) return cached.data;

  const existing = nhlInflight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<NhlTeamSummaryRow[]> => {
    try {
      const response = await fetch(
        `https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=seasonId=${seasonId}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!response.ok) return [];
      const payload = (await response.json()) as { data?: NhlTeamSummaryRow[] };
      const rows = Array.isArray(payload.data) ? payload.data : [];
      nhlSummaryCache.set(cacheKey, { data: rows, timestamp: Date.now() });
      return rows;
    } catch {
      return [];
    } finally {
      nhlInflight.delete(cacheKey);
    }
  })();

  nhlInflight.set(cacheKey, request);
  return request;
}

function nhlRowMatches(row: NhlTeamSummaryRow, args: FreeAdvancedArgs): boolean {
  const rowName = normalizeName(row.teamFullName);
  const teamName = normalizeName(args.teamName);
  if (!rowName || !teamName) return false;
  if (rowName === teamName) return true;
  const rowLast = rowName.split(" ").at(-1);
  const teamLast = teamName.split(" ").at(-1);
  return Boolean(rowLast && teamLast && rowLast === teamLast);
}

async function fetchNhlPublicMetrics(args: FreeAdvancedArgs): Promise<TeamAdvancedMetrics | null> {
  const rows = await fetchNhlTeamSummaryRows(nhlSeasonId(args.gameDate));
  const row = rows.find((candidate) => nhlRowMatches(candidate, args));
  if (!row) return null;

  const result: TeamAdvancedMetrics = {};
  const pp = pct(row.powerPlayPct);
  const pk = pct(row.penaltyKillPct);
  if (pp !== undefined) result.powerPlayPct = pp;
  if (pk !== undefined) result.penaltyKillPct = pk;
  if (typeof row.shotsForPerGame === "number" && Number.isFinite(row.shotsForPerGame)) {
    result.shotsPerGame = row.shotsForPerGame;
  }
  if (
    typeof row.goalsAgainstPerGame === "number" &&
    Number.isFinite(row.goalsAgainstPerGame) &&
    typeof row.shotsAgainstPerGame === "number" &&
    Number.isFinite(row.shotsAgainstPerGame) &&
    row.shotsAgainstPerGame > 0
  ) {
    result.savePercentage = 1 - row.goalsAgainstPerGame / row.shotsAgainstPerGame;
  }

  return Object.keys(result).length > 0 ? result : null;
}

export async function fetchFreeAdvancedMetrics(args: FreeAdvancedArgs): Promise<TeamAdvancedMetrics | null> {
  if (args.sport === "NBA" || args.sport === "NCAAB") {
    const summary = await fetchEspnSummary(args.sport, args.gameId);
    if (!summary) return null;
    return basketballMetricsFromSummary(extractStatsFromSummary(summary, args));
  }

  if (args.sport === "NHL") {
    const [nhlPublic, summary] = await Promise.all([
      fetchNhlPublicMetrics(args),
      fetchEspnSummary(args.sport, args.gameId),
    ]);
    const espnMetrics = summary ? hockeyMetricsFromSummary(extractStatsFromSummary(summary, args)) : null;
    return mergeMetrics(espnMetrics, nhlPublic);
  }

  return null;
}

function csvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  return cells;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = csvLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const cells = csvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function sackmannRepo(tour: TennisTour): string {
  return tour === "ATP" ? "tennis_atp" : "tennis_wta";
}

function sackmannPrefix(tour: TennisTour): string {
  return tour === "ATP" ? "atp" : "wta";
}

function sackmannMatchFiles(tour: TennisTour, year: number): string[] {
  const prefix = sackmannPrefix(tour);
  if (tour === "ATP") {
    return [
      `${prefix}_matches_${year}.csv`,
      `${prefix}_matches_qual_chall_${year}.csv`,
      `${prefix}_matches_futures_${year}.csv`,
    ];
  }
  return [
    `${prefix}_matches_${year}.csv`,
    `${prefix}_matches_qual_itf_${year}.csv`,
  ];
}

async function fetchText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), ...init });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

async function fetchTennisMatchesForYear(tour: TennisTour, year: number): Promise<TennisMatchRow[]> {
  const cacheKey = `${tour}:${year}`;
  const cached = tennisMatchesCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TENNIS_CACHE_TTL_MS) return cached.data;

  const existing = tennisMatchesInflight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<TennisMatchRow[]> => {
    const files = sackmannMatchFiles(tour, year);
    const texts = await Promise.all(files.map((file) =>
      fetchText(`https://raw.githubusercontent.com/JeffSackmann/${sackmannRepo(tour)}/master/${file}`),
    ));

    const rows = texts.flatMap((text, fileIndex) => {
      if (!text) return [];
      return parseCsv(text).map((row, index): TennisMatchRow => ({
        tour,
        date: finiteNumber(row.tourney_date) ?? 0,
        order: fileIndex * 1_000_000 + index,
        winnerName: row.winner_name ?? "",
        loserName: row.loser_name ?? "",
        winnerRank: finiteNumber(row.winner_rank),
        loserRank: finiteNumber(row.loser_rank),
        winnerPoints: finiteNumber(row.winner_rank_points),
        loserPoints: finiteNumber(row.loser_rank_points),
      })).filter((row) => row.winnerName && row.loserName);
    });

    tennisMatchesCache.set(cacheKey, { data: rows, timestamp: Date.now() });
    return rows;
  })().finally(() => {
    tennisMatchesInflight.delete(cacheKey);
  });

  tennisMatchesInflight.set(cacheKey, request);
  return request;
}

async function fetchCurrentTennisRankings(tour: TennisTour): Promise<TennisRankingRow[]> {
  const cacheKey = tour;
  const cached = tennisRankingsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TENNIS_CACHE_TTL_MS) return cached.data;

  const existing = tennisRankingsInflight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<TennisRankingRow[]> => {
    const url = `https://raw.githubusercontent.com/JeffSackmann/${sackmannRepo(tour)}/master/${sackmannPrefix(tour)}_rankings_current.csv`;
    const text = await fetchText(url);
    if (!text) return [];
    const rows = parseCsv(text).map((row): TennisRankingRow | null => {
      const playerId = row.player;
      const rank = finiteNumber(row.rank);
      if (!playerId || rank === undefined) return null;
      return {
        tour,
        playerId,
        rank,
        points: finiteNumber(row.points),
      };
    }).filter((row): row is TennisRankingRow => row !== null);
    tennisRankingsCache.set(cacheKey, { data: rows, timestamp: Date.now() });
    return rows;
  })().finally(() => {
    tennisRankingsInflight.delete(cacheKey);
  });

  tennisRankingsInflight.set(cacheKey, request);
  return request;
}

async function fetchTennisPlayers(tour: TennisTour): Promise<TennisPlayerRow[]> {
  const cacheKey = tour;
  const cached = tennisPlayersCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TENNIS_CACHE_TTL_MS) return cached.data;

  const existing = tennisPlayersInflight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<TennisPlayerRow[]> => {
    const url = `https://raw.githubusercontent.com/JeffSackmann/${sackmannRepo(tour)}/master/${sackmannPrefix(tour)}_players.csv`;
    const text = await fetchText(url);
    if (!text) return [];
    const rows = parseCsv(text).map((row): TennisPlayerRow | null => {
      const playerId = row.player_id;
      const first = row.name_first;
      const last = row.name_last;
      const name = [first, last].filter(Boolean).join(" ").trim();
      if (!playerId || !name) return null;
      return { tour, playerId, name };
    }).filter((row): row is TennisPlayerRow => row !== null);
    tennisPlayersCache.set(cacheKey, { data: rows, timestamp: Date.now() });
    return rows;
  })().finally(() => {
    tennisPlayersInflight.delete(cacheKey);
  });

  tennisPlayersInflight.set(cacheKey, request);
  return request;
}

function toursForLookup(tour?: TennisTour): TennisTour[] {
  return tour ? [tour] : ["ATP", "WTA"];
}

function tennisFormFromResults(latestFirst: Array<"W" | "L">): TeamRecentForm | undefined {
  if (latestFirst.length === 0) return undefined;
  const results: Array<"W" | "L" | "D"> = [...latestFirst].reverse();
  const wins = results.filter((result) => result === "W").length;
  const losses = results.filter((result) => result === "L").length;
  const latest = results.at(-1);
  let streak = 0;
  if (latest === "W" || latest === "L") {
    for (let index = results.length - 1; index >= 0; index--) {
      if (results[index] !== latest) break;
      streak += latest === "W" ? 1 : -1;
    }
  }

  return {
    results,
    formString: results.join("-"),
    streak,
    avgScore: 0,
    avgAllowed: 0,
    wins,
    losses,
  };
}

function tennisFormFromAggregate(results: Array<"W" | "L" | "D">): TeamRecentForm | undefined {
  const decisive = results.filter((result): result is "W" | "L" => result === "W" || result === "L");
  if (decisive.length < 3) return undefined;
  const wins = decisive.filter((result) => result === "W").length;
  const losses = decisive.filter((result) => result === "L").length;
  const latest = decisive.at(-1);
  let streak = 0;
  if (latest) {
    for (let index = decisive.length - 1; index >= 0; index--) {
      if (decisive[index] !== latest) break;
      streak += latest === "W" ? 1 : -1;
    }
  }

  return {
    results: decisive,
    formString: decisive.join("-"),
    streak,
    avgScore: 0,
    avgAllowed: 0,
    wins,
    losses,
  };
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeHtml(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " "));
}

function tennisExplorerDateParts(date: Date, offsetDays = 0): { date: string; year: number; month: number; day: number } {
  const base = new Date(date.getTime());
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const day = base.getUTCDate();
  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    year,
    month,
    day,
  };
}

function tennisExplorerMatchTypes(tour?: TennisTour): Array<{ type: string; tour: TennisTour }> {
  if (tour === "ATP") return [{ type: "atp-single", tour }, { type: "atp-double", tour }];
  if (tour === "WTA") return [{ type: "wta-single", tour }, { type: "wta-double", tour }];
  return [
    { type: "atp-single", tour: "ATP" },
    { type: "atp-double", tour: "ATP" },
    { type: "wta-single", tour: "WTA" },
    { type: "wta-double", tour: "WTA" },
  ];
}

function shortTennisNameMatches(shortName: string, fullName: string): boolean {
  const shortTokens = normalizeName(shortName).split(" ").filter(Boolean);
  const fullTokens = normalizeName(fullName).split(" ").filter(Boolean);
  if (shortTokens.length === 0 || fullTokens.length === 0) return false;
  if (tokenKey(shortName) === tokenKey(fullName)) return true;

  const fullLast = fullTokens.at(-1);
  if (!fullLast) return false;
  const shortNameTokens = shortTokens.filter((token) => token.length > 1);
  if (!shortNameTokens.includes(fullLast)) return false;

  const shortInitials = shortTokens.filter((token) => token.length === 1).map((token) => token[0]);
  if (shortInitials.length === 0) return true;

  const givenInitials = fullTokens.slice(0, -1).map((token) => token[0]).filter(Boolean);
  return shortInitials.some((initial) => givenInitials.includes(initial));
}

function fullTennisNameMatches(profileName: string, requestedName: string): boolean {
  const profile = normalizeName(profileName);
  const requested = normalizeName(requestedName);
  if (!profile || !requested) return false;
  if (profile === requested || tokenKey(profileName) === tokenKey(requestedName)) return true;
  return shortTennisNameMatches(profileName, requestedName);
}

function tennisExplorerProfilePathCandidates(name: string): string[] {
  const tokens = normalizeName(name).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  const first = tokens[0]!;
  const last = tokens.at(-1)!;
  const given = tokens.slice(0, -1).join("-");
  const candidates = [
    last,
    `${last}-${first}`,
    `${first}-${last}`,
    given ? `${last}-${given}` : "",
  ];
  return Array.from(new Set(candidates.filter(Boolean).map((slug) => `/player/${slug}/`)));
}

function parseTennisExplorerProfileName(html: string): string | null {
  const h3 = stripTags(html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
  if (h3) return h3;
  const title = stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  return title.replace(/\s*-\s*Tennis Explorer\s*$/i, "").trim() || null;
}

function parseTennisExplorerTour(html: string, fallback?: TennisTour): TennisTour | undefined {
  const sex = stripTags(html.match(/Sex:\s*([^<]+)/i)?.[1] ?? "").toLowerCase();
  if (sex.includes("woman")) return "WTA";
  if (sex.includes("man")) return "ATP";
  return fallback;
}

function parseTennisExplorerRank(html: string): number | undefined {
  const singlesRank = finiteNumber(stripTags(html.match(/Current\/Highest rank - singles:\s*([^<]+)/i)?.[1] ?? ""));
  if (singlesRank !== undefined && singlesRank > 0) return singlesRank;
  const doublesRank = finiteNumber(stripTags(html.match(/Current\/Highest rank - doubles:\s*([^<]+)/i)?.[1] ?? ""));
  return doublesRank !== undefined && doublesRank > 0 ? doublesRank : undefined;
}

function parseTennisExplorerRecentResults(html: string, limit: number): Array<"W" | "L"> {
  const rows = html.match(/<tr\b[^>]*class=["'][^"']*\b(?:one|two)\b[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const results: Array<"W" | "L"> = [];

  for (const row of rows) {
    const nameCell = row.match(/<td\b[^>]*class=["'][^"']*\bt-name\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";
    if (!/<strong\b/i.test(nameCell)) continue;

    const scoreText = stripTags(row.match(/<td\b[^>]*class=["'][^"']*\btl\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "");
    if (!/\d/.test(scoreText)) continue;

    const strongIndex = nameCell.search(/<strong\b/i);
    const separatorIndex = nameCell.search(/\s-\s/i);
    if (strongIndex < 0 || separatorIndex < 0) continue;

    results.push(strongIndex < separatorIndex ? "W" : "L");
    if (results.length >= limit) break;
  }

  return results;
}

function parseTennisExplorerProfile(html: string, name: string, tour?: TennisTour, limit = 10): FreeTennisProfile | null {
  const profileName = parseTennisExplorerProfileName(html);
  if (!profileName || !fullTennisNameMatches(profileName, name)) return null;

  const rank = parseTennisExplorerRank(html);
  const form = tennisFormFromResults(parseTennisExplorerRecentResults(html, limit));
  const resolvedTour = parseTennisExplorerTour(html, tour);
  const profile: FreeTennisProfile = {};
  if (rank !== undefined) profile.rank = rank;
  if (form) profile.form = form;
  if (resolvedTour && Object.keys(profile).length > 0) profile.tour = resolvedTour;
  return Object.keys(profile).length > 0 ? profile : null;
}

function parseTennisExplorerMatchLinks(html: string, tour: TennisTour): TennisExplorerPlayerLink[] {
  const links: TennisExplorerPlayerLink[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<a\b([^>]*href=["']\/player\/[^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] ?? "";
    const href = attrs.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const path = decodeHtml(href);
    if (seen.has(path)) continue;
    const displayName = stripTags(match[2] ?? "");
    if (!displayName) continue;
    seen.add(path);
    links.push({ path, displayName, tour });
  }

  for (const match of html.matchAll(/<a\b([^>]*href=["']\/doubles-team\/[^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] ?? "";
    const href = decodeHtml(attrs.match(/href=["']([^"']+)["']/i)?.[1] ?? "");
    const title = stripTags(attrs.match(/title=["']([^"']+)["']/i)?.[1] ?? "");
    const display = title || stripTags(match[2] ?? "");
    const pathParts = href.match(/\/doubles-team\/([^/]+)\/([^/]+)\//i);
    if (!pathParts) continue;
    const displayParts = display.split("/").map((part) => part.trim()).filter(Boolean);
    const slugs = [pathParts[1], pathParts[2]].filter((slug): slug is string => Boolean(slug));
    slugs.forEach((slug, index) => {
      const path = `/player/${slug}/`;
      if (seen.has(path)) return;
      const displayName = displayParts[index] ?? slug;
      seen.add(path);
      links.push({ path, displayName, tour });
    });
  }

  return links;
}

async function fetchTennisExplorerMatchLinksForDate(date: Date, tour?: TennisTour): Promise<TennisExplorerPlayerLink[]> {
  const dateOffsets = [-1, 0, 1];
  const requests = dateOffsets.flatMap((offset) => {
    const parts = tennisExplorerDateParts(date, offset);
    return tennisExplorerMatchTypes(tour).map(({ type, tour: lookupTour }) => ({ ...parts, type, tour: lookupTour }));
  });

  const results = await Promise.all(requests.map(async (request) => {
    const cacheKey = `${request.type}:${request.date}`;
    const cached = tennisExplorerMatchLinksCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < TENNIS_CACHE_TTL_MS) return cached.data;
    const existing = tennisExplorerMatchLinksInflight.get(cacheKey);
    if (existing) return existing;

    const promise = (async (): Promise<TennisExplorerPlayerLink[]> => {
      const url = `${TENNIS_EXPLORER_BASE_URL}/matches/?type=${request.type}&year=${request.year}&month=${request.month}&day=${request.day}`;
      const html = await fetchText(url, { headers: TENNIS_EXPLORER_FETCH_HEADERS });
      const links = html ? parseTennisExplorerMatchLinks(html, request.tour) : [];
      tennisExplorerMatchLinksCache.set(cacheKey, { data: links, timestamp: Date.now() });
      return links;
    })().finally(() => {
      tennisExplorerMatchLinksInflight.delete(cacheKey);
    });

    tennisExplorerMatchLinksInflight.set(cacheKey, promise);
    return promise;
  }));

  return results.flat();
}

async function tennisExplorerProfilePathsForName(name: string, tour?: TennisTour, matchDate?: Date): Promise<string[]> {
  const fromMatches = matchDate
    ? (await fetchTennisExplorerMatchLinksForDate(matchDate, tour))
      .filter((link) => shortTennisNameMatches(link.displayName, name))
      .map((link) => link.path)
    : [];
  return Array.from(new Set([...fromMatches, ...tennisExplorerProfilePathCandidates(name)]));
}

async function profileFromTennisExplorer(name: string, tour?: TennisTour, limit = 10, matchDate?: Date): Promise<FreeTennisProfile | null> {
  const cacheKey = `${normalizeName(name)}:${tour ?? "ALL"}:${limit}:${matchDate?.toISOString().slice(0, 10) ?? "none"}`;
  const cached = tennisExplorerProfileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TENNIS_CACHE_TTL_MS) return cached.data;
  const existing = tennisExplorerProfileInflight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<FreeTennisProfile | null> => {
    const paths = await tennisExplorerProfilePathsForName(name, tour, matchDate);
    for (const path of paths) {
      const html = await fetchText(`${TENNIS_EXPLORER_BASE_URL}${path}`, { headers: TENNIS_EXPLORER_FETCH_HEADERS });
      if (!html) continue;
      const profile = parseTennisExplorerProfile(html, name, tour, limit);
      if (profile) {
        tennisExplorerProfileCache.set(cacheKey, { data: profile, timestamp: Date.now() });
        return profile;
      }
    }
    tennisExplorerProfileCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  })().finally(() => {
    tennisExplorerProfileInflight.delete(cacheKey);
  });

  tennisExplorerProfileInflight.set(cacheKey, request);
  return request;
}

async function tennisMatchesForLookup(tour?: TennisTour): Promise<TennisMatchRow[]> {
  const year = new Date().getUTCFullYear();
  const requests = toursForLookup(tour).flatMap((lookupTour) => [
    fetchTennisMatchesForYear(lookupTour, year),
    fetchTennisMatchesForYear(lookupTour, year - 1),
  ]);
  return (await Promise.all(requests)).flat();
}

async function profileFromMatchRows(name: string, tour?: TennisTour, limit = 10): Promise<FreeTennisProfile | null> {
  const normalized = normalizeName(name);
  const tokenized = tokenKey(name);
  if (!normalized) return null;

  const rows = (await tennisMatchesForLookup(tour))
    .filter((row) => {
      const winner = normalizeName(row.winnerName);
      const loser = normalizeName(row.loserName);
      return winner === normalized || loser === normalized || tokenKey(row.winnerName) === tokenized || tokenKey(row.loserName) === tokenized;
    })
    .sort((a, b) => b.date - a.date || b.order - a.order);

  if (rows.length === 0) return null;

  const results: Array<"W" | "L"> = [];
  let rank: number | undefined;
  let rankingPoints: number | undefined;
  let resolvedTour: TennisTour | undefined = tour;

  for (const row of rows) {
    const won = normalizeName(row.winnerName) === normalized || tokenKey(row.winnerName) === tokenized;
    results.push(won ? "W" : "L");
    resolvedTour ??= row.tour;
    if (rank === undefined) rank = won ? row.winnerRank : row.loserRank;
    if (rankingPoints === undefined) rankingPoints = won ? row.winnerPoints : row.loserPoints;
    if (results.length >= limit && rank !== undefined) break;
  }

  const form = tennisFormFromResults(results.slice(0, limit));
  return {
    rank,
    rankingPoints,
    tour: resolvedTour,
    form,
  };
}

async function profileFromCurrentRankings(name: string, tour?: TennisTour): Promise<FreeTennisProfile | null> {
  const normalized = normalizeName(name);
  const tokenized = tokenKey(name);
  if (!normalized) return null;

  for (const lookupTour of toursForLookup(tour)) {
    const [rankings, players] = await Promise.all([
      fetchCurrentTennisRankings(lookupTour),
      fetchTennisPlayers(lookupTour),
    ]);
    const playerById = new Map(players.map((player) => [player.playerId, player]));
    const rankedPlayers = rankings
      .map((ranking) => ({ ranking, player: playerById.get(ranking.playerId) }))
      .filter((entry): entry is { ranking: TennisRankingRow; player: TennisPlayerRow } => entry.player !== undefined);
    const match = rankedPlayers.find((entry) => normalizeName(entry.player.name) === normalized)
      ?? rankedPlayers.find((entry) => tokenKey(entry.player.name) === tokenized);
    if (match) {
      return {
        rank: match.ranking.rank,
        rankingPoints: match.ranking.points,
        tour: lookupTour,
      };
    }
  }

  return null;
}

export async function fetchFreeTennisProfileByName(
  name: string,
  tour?: TennisTour,
  limit = 10,
  matchDate?: Date,
): Promise<FreeTennisProfile | null> {
  if (name.includes(" / ")) {
    const players = name.split("/").map((part) => part.trim()).filter(Boolean);
    const profiles = (await Promise.all(
      players.map((player) => fetchFreeTennisProfileByName(player, tour, Math.max(3, Math.ceil(limit / Math.max(1, players.length))), matchDate)),
    )).filter((profile): profile is FreeTennisProfile => profile !== null);

    if (profiles.length === 0) return null;

    const ranks = profiles
      .map((profile) => profile.rank)
      .filter((rank): rank is number => typeof rank === "number" && Number.isFinite(rank) && rank > 0);
    const points = profiles
      .map((profile) => profile.rankingPoints)
      .filter((rankingPoints): rankingPoints is number => typeof rankingPoints === "number" && Number.isFinite(rankingPoints) && rankingPoints > 0);
    const aggregateResults = profiles.flatMap((profile) => profile.form?.results ?? []);
    const aggregateForm = tennisFormFromAggregate(aggregateResults);

    const merged: FreeTennisProfile = {};
    if (ranks.length > 0) {
      merged.rank = ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
    }
    if (points.length > 0) {
      merged.rankingPoints = points.reduce((sum, rankingPoints) => sum + rankingPoints, 0) / points.length;
    }
    const resolvedTour = profiles.find((profile) => profile.tour)?.tour ?? tour;
    if (resolvedTour) merged.tour = resolvedTour;
    if (aggregateForm) merged.form = aggregateForm;
    return Object.keys(merged).length > 0 ? merged : null;
  }

  const matchProfile = await profileFromMatchRows(name, tour, limit).catch(() => null);
  const hasRanking = matchProfile?.rank !== undefined;
  if (hasRanking && matchProfile?.form) return matchProfile;

  const [rankingProfile, explorerProfile] = await Promise.all([
    profileFromCurrentRankings(name, tour).catch(() => null),
    profileFromTennisExplorer(name, tour, limit, matchDate).catch(() => null),
  ]);
  const merged: FreeTennisProfile = {};
  const rank = matchProfile?.rank ?? rankingProfile?.rank ?? explorerProfile?.rank;
  const rankingPoints = matchProfile?.rankingPoints ?? rankingProfile?.rankingPoints ?? explorerProfile?.rankingPoints;
  const resolvedTour = matchProfile?.tour ?? rankingProfile?.tour ?? explorerProfile?.tour ?? tour;
  if (rank !== undefined) merged.rank = rank;
  if (rankingPoints !== undefined) merged.rankingPoints = rankingPoints;
  if (matchProfile?.form ?? explorerProfile?.form) merged.form = matchProfile?.form ?? explorerProfile!.form;
  if (resolvedTour && Object.keys(merged).length > 0) merged.tour = resolvedTour;
  if (Object.keys(merged).length === 0) return null;
  return merged;
}

function parseIPLH2HSplit(summary: EspnSummary, homeTeamId: string, awayTeamId: string): FreeIPLVenueSplit | null {
  const buckets: any[] = Array.isArray(summary?.headToHeadGames) ? summary.headToHeadGames : [];
  if (buckets.length === 0) return null;

  const eventsById = new Map<string, {
    id: string;
    homeTeamId: string;
    awayTeamId: string;
    winnerTeamId: string | null;
  }>();

  for (const bucket of buckets) {
    const bucketTeamId = String(bucket?.team?.id ?? "");
    if (!bucketTeamId) continue;
    const events: any[] = Array.isArray(bucket?.events) ? bucket.events : [];
    for (const event of events) {
      const id = String(event?.id ?? "");
      const eventHomeId = String(event?.homeTeamId ?? "");
      const eventAwayId = String(event?.awayTeamId ?? "");
      if (!id || !eventHomeId || !eventAwayId || eventsById.has(id)) continue;

      const result = String(event?.gameResult ?? "").toUpperCase();
      const opponentId = eventHomeId === bucketTeamId ? eventAwayId : eventHomeId;
      const winnerTeamId =
        result === "W" ? bucketTeamId :
        result === "L" ? opponentId :
        null;

      eventsById.set(id, {
        id,
        homeTeamId: eventHomeId,
        awayTeamId: eventAwayId,
        winnerTeamId,
      });
    }
  }

  let homeGames = 0;
  let homeWins = 0;
  let awayGames = 0;
  let awayWins = 0;

  for (const event of eventsById.values()) {
    if (!event.winnerTeamId) continue;
    if (event.homeTeamId === String(homeTeamId)) {
      homeGames += 1;
      if (event.winnerTeamId === String(homeTeamId)) homeWins += 1;
    }
    if (event.awayTeamId === String(awayTeamId)) {
      awayGames += 1;
      if (event.winnerTeamId === String(awayTeamId)) awayWins += 1;
    }
  }

  if (homeGames === 0 || awayGames === 0) return null;
  return {
    homeWinPct: homeWins / homeGames,
    awayRoadWinPct: awayWins / awayGames,
    homeGames,
    awayGames,
    source: "espn-cricket-h2h",
  };
}

export async function fetchFreeIPLVenueSplit(
  gameId: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<FreeIPLVenueSplit | null> {
  const summary = await fetchEspnSummary("IPL", gameId);
  if (!summary) return null;
  return parseIPLH2HSplit(summary, homeTeamId, awayTeamId);
}

export function resetFreeDataSourceCachesForTest(): void {
  summaryCache.clear();
  nhlSummaryCache.clear();
  tennisMatchesCache.clear();
  tennisRankingsCache.clear();
  tennisPlayersCache.clear();
  tennisExplorerProfileCache.clear();
  tennisExplorerMatchLinksCache.clear();
  summaryInflight.clear();
  nhlInflight.clear();
  tennisMatchesInflight.clear();
  tennisRankingsInflight.clear();
  tennisPlayersInflight.clear();
  tennisExplorerProfileInflight.clear();
  tennisExplorerMatchLinksInflight.clear();
}
