/**
 * SportsDataIO provider client.
 *
 * This is a verified-data enrichment layer for the prediction engine. It is
 * intentionally conservative:
 *   - no key -> no-op, no throw
 *   - upstream error / access-denied / scrambled trial field -> no-op
 *   - parsed values must be sane before they can override ESPN fallbacks
 *
 * The first engine consumers use team season stats and depth charts because
 * those feeds are stable on the free trial and materially improve NBA/NFL/NHL
 * context without fabricating injuries or lineup status.
 */

import { LRUCache } from "lru-cache";
import type {
  TeamAdvancedMetrics,
  TeamInjuryReport,
  StartingLineup,
  LineupPlayer,
} from "./espnStats";

type SupportedSport =
  | "NBA"
  | "NFL"
  | "MLB"
  | "NHL"
  | "NCAAF"
  | "NCAAB"
  | "EPL"
  | "MLS"
  | "UCL";

type FeedKind = "scores" | "stats";

type SportConfig = {
  slug: string;
  teamFeed: FeedKind;
  statsFeed: FeedKind;
  hasDepthCharts?: boolean;
};

const SPORT_CONFIG: Partial<Record<SupportedSport, SportConfig>> = {
  NBA: { slug: "nba", teamFeed: "scores", statsFeed: "stats", hasDepthCharts: true },
  NFL: { slug: "nfl", teamFeed: "scores", statsFeed: "stats", hasDepthCharts: true },
  MLB: { slug: "mlb", teamFeed: "scores", statsFeed: "stats" },
  NHL: { slug: "nhl", teamFeed: "scores", statsFeed: "stats" },
  NCAAF: { slug: "cfb", teamFeed: "scores", statsFeed: "scores" },
  NCAAB: { slug: "cbb", teamFeed: "scores", statsFeed: "stats" },
  EPL: { slug: "soccer", teamFeed: "scores", statsFeed: "stats" },
  MLS: { slug: "soccer", teamFeed: "scores", statsFeed: "stats" },
  UCL: { slug: "soccer", teamFeed: "scores", statsFeed: "stats" },
};

const TEAM_KEY_ALIASES: Record<string, string> = {
  GSW: "GS",
  PHX: "PHO",
  NYK: "NY",
  NOP: "NO",
  SAS: "SA",
  WSH: "WAS",
  UTAH: "UTA",
};

export interface SportsDataIOTeam {
  TeamID: number;
  Key?: string | null;
  Team?: string | null;
  City?: string | null;
  Name?: string | null;
}

type SportsDataIOTeamSeason = {
  TeamID?: number | null;
  Team?: string | null;
  TeamName?: string | null;
  Name?: string | null;
  Games?: number | null;
  Wins?: number | null;
  Losses?: number | null;
  Points?: number | null;
  Possessions?: number | null;
  Score?: number | null;
  TotalScore?: number | null;
  OpponentStat?: {
    Points?: number | null;
    Possessions?: number | null;
  } | null;
  OffensiveYardsPerPlay?: number | null;
  OpponentOffensiveYardsPerPlay?: number | null;
  TurnoverDifferential?: number | null;
  ThirdDownPercentage?: number | null;
  TeamERA?: number | null;
  Whip?: number | null;
  OPS?: number | null;
  BattingAverage?: number | null;
  GoaltendingShotsAgainst?: number | null;
  GoaltendingGoalsAgainst?: number | null;
  PowerPlayGoals?: number | null;
  PenaltyKillPercentage?: number | null;
  ShotsOnGoal?: number | null;
  Goals?: number | null;
  OpponentScore?: number | null;
  PointsFor?: number | null;
  PointsAgainst?: number | null;
  RushingYardsPerAttempt?: number | null;
  PassingYardsPerAttempt?: number | null;
  ThirdDownAttempts?: number | null;
  ThirdDownConversions?: number | null;
};

type SportsDataIODepthChart = {
  TeamID?: number | null;
  PlayerID?: number | null;
  Name?: string | null;
  Position?: string | null;
  PositionCategory?: string | null;
  DepthOrder?: number | null;
};

type SportsDataIOTeamDepthChart = {
  TeamID: number;
  DepthCharts?: SportsDataIODepthChart[];
};

type SportsDataIOPlayer = {
  FirstName?: string | null;
  LastName?: string | null;
  Name?: string | null;
  Team?: string | null;
  TeamID?: number | null;
  Position?: string | null;
  Status?: string | null;
  InjuryStatus?: string | null;
  InjuryBodyPart?: string | null;
  InjuryNotes?: string | null;
};

export type SportsDataIOCoverage = {
  teamStats: boolean;
  depthChart: boolean;
  injuries: boolean;
};

const BASE = "https://azure-api.sportsdata.io/v3";
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new LRUCache<string, { data: unknown; timestamp: number }>({ max: 500 });
const inflight = new Map<string, Promise<unknown | null>>();
let missingKeyWarned = false;

export function resetSportsDataIOCacheForTest(): void {
  cache.clear();
  inflight.clear();
  missingKeyWarned = false;
}

function getApiKey(): string | null {
  const key = process.env.SPORTSDATAIO_API_KEY?.trim();
  if (!key) {
    if (!missingKeyWarned) {
      console.warn("[sportsdataio] SPORTSDATAIO_API_KEY not set — provider disabled");
      missingKeyWarned = true;
    }
    return null;
  }
  return key;
}

function normalizeTeamKey(value: string | null | undefined): string | null {
  const raw = value?.trim().toUpperCase();
  if (!raw) return null;
  return TEAM_KEY_ALIASES[raw] ?? raw;
}

function configForSport(sport: string): SportConfig | null {
  return SPORT_CONFIG[sport as SupportedSport] ?? null;
}

function seasonForSport(sport: string, gameDate: Date): number {
  const year = gameDate.getUTCFullYear();
  const month = gameDate.getUTCMonth() + 1;

  if (sport === "NBA" || sport === "NHL" || sport === "NCAAB") {
    return month >= 9 ? year + 1 : year;
  }
  if (sport === "NFL" || sport === "NCAAF") {
    return month <= 2 ? year - 1 : year;
  }
  return year;
}

function endpoint(config: SportConfig, feed: FeedKind, path: string): string {
  return `${BASE}/${config.slug}/${feed}/json/${path}`;
}

async function fetchJson<T>(url: string, cacheKey: string): Promise<T | null> {
  const key = getApiKey();
  if (!key) return null;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const existing = inflight.get(cacheKey);
  if (existing) {
    return (await existing) as T | null;
  }

  const request = (async (): Promise<unknown | null> => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Accept": "application/json",
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  })();

  inflight.set(cacheKey, request);
  try {
    return (await request) as T | null;
  } catch (err) {
    console.warn(
      "[sportsdataio] fetch failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    inflight.delete(cacheKey);
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanePercentage(value: unknown): number | undefined {
  const number = finite(value);
  if (number === undefined) return undefined;
  if (number > 0 && number <= 1) return number;
  if (number > 1 && number <= 100) return number / 100;
  return undefined;
}

function isScrambled(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "scrambled";
}

function isMeaningfulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !isScrambled(value);
}

export async function fetchSportsDataIOTeams(sport: string): Promise<SportsDataIOTeam[]> {
  const config = configForSport(sport);
  if (!config) return [];

  const teams = await fetchJson<SportsDataIOTeam[]>(
    endpoint(config, config.teamFeed, "AllTeams"),
    `teams:${sport}`,
  );
  return Array.isArray(teams) ? teams.filter((t) => t.TeamID) : [];
}

async function findTeam(sport: string, abbreviation: string): Promise<SportsDataIOTeam | null> {
  const target = normalizeTeamKey(abbreviation);
  if (!target) return null;
  const teams = await fetchSportsDataIOTeams(sport);
  return (
    teams.find((team) => normalizeTeamKey(team.Key ?? team.Team) === target) ??
    null
  );
}

async function fetchTeamSeasonRows(sport: string, gameDate: Date): Promise<SportsDataIOTeamSeason[]> {
  const config = configForSport(sport);
  if (!config) return [];
  const season = seasonForSport(sport, gameDate);
  const rows = await fetchJson<SportsDataIOTeamSeason[]>(
    endpoint(config, config.statsFeed, `TeamSeasonStats/${season}`),
    `team-season:${sport}:${season}`,
  );
  return Array.isArray(rows) ? rows : [];
}

function advancedFromTeamSeason(sport: string, row: SportsDataIOTeamSeason): TeamAdvancedMetrics {
  const result: TeamAdvancedMetrics = {};

  if (sport === "NBA" || sport === "NCAAB") {
    const points = finite(row.Points);
    const possessions = finite(row.Possessions);
    const oppPoints = finite(row.OpponentStat?.Points);
    const oppPossessions = finite(row.OpponentStat?.Possessions);
    if (points !== undefined && possessions && possessions > 0) {
      result.offensiveRating = (points / possessions) * 100;
    }
    if (oppPoints !== undefined && oppPossessions && oppPossessions > 0) {
      result.defensiveRating = (oppPoints / oppPossessions) * 100;
    }
  }

  if (sport === "NFL") {
    result.yardsPerPlay = finite(row.OffensiveYardsPerPlay);
    result.turnoverDifferential = finite(row.TurnoverDifferential);
    result.thirdDownConvPct = sanePercentage(row.ThirdDownPercentage);
  }

  if (sport === "NCAAF") {
    const passYpa = finite(row.PassingYardsPerAttempt);
    const rushYpa = finite(row.RushingYardsPerAttempt);
    if (passYpa !== undefined && rushYpa !== undefined) {
      result.yardsPerPlay = (passYpa + rushYpa) / 2;
    } else {
      result.yardsPerPlay = passYpa ?? rushYpa;
    }
    const thirdConversions = finite(row.ThirdDownConversions);
    const thirdAttempts = finite(row.ThirdDownAttempts);
    if (thirdConversions !== undefined && thirdAttempts && thirdAttempts > 0) {
      result.thirdDownConvPct = thirdConversions / thirdAttempts;
    }
  }

  if (sport === "NHL") {
    const shotsAgainst = finite(row.GoaltendingShotsAgainst);
    const goalsAgainst = finite(row.GoaltendingGoalsAgainst);
    if (shotsAgainst && shotsAgainst > 0 && goalsAgainst !== undefined) {
      result.savePercentage = 1 - goalsAgainst / shotsAgainst;
    }
    const shotsOnGoal = finite(row.ShotsOnGoal);
    const games = finite(row.Games);
    if (shotsOnGoal !== undefined && games && games > 0) {
      result.shotsPerGame = shotsOnGoal / games;
    }
  }

  if (sport === "MLB") {
    result.teamERA = finite(row.TeamERA);
    result.whip = finite(row.Whip);
    result.ops = finite(row.OPS);
    result.battingAverage = finite(row.BattingAverage);
  }

  return result;
}

export async function fetchSportsDataIOAdvancedMetrics(
  sport: string,
  teamAbbreviation: string,
  gameDate: Date,
): Promise<TeamAdvancedMetrics | null> {
  const team = await findTeam(sport, teamAbbreviation);
  if (!team) return null;
  const rows = await fetchTeamSeasonRows(sport, gameDate);
  const row =
    rows.find((r) => r.TeamID === team.TeamID) ??
    rows.find((r) => normalizeTeamKey(r.Team) === normalizeTeamKey(teamAbbreviation));
  if (!row) return null;
  const metrics = advancedFromTeamSeason(sport, row);
  return Object.keys(metrics).length > 0 ? metrics : null;
}

export function mergeAdvancedMetrics(
  fallback: TeamAdvancedMetrics,
  sportsDataIO: TeamAdvancedMetrics | null,
): TeamAdvancedMetrics {
  if (!sportsDataIO) return fallback;
  return {
    ...fallback,
    ...Object.fromEntries(
      Object.entries(sportsDataIO).filter(([, value]) =>
        typeof value === "number" && Number.isFinite(value),
      ),
    ),
  };
}

async function fetchDepthCharts(sport: string): Promise<SportsDataIOTeamDepthChart[]> {
  const config = configForSport(sport);
  if (!config?.hasDepthCharts) return [];
  const rows = await fetchJson<Array<SportsDataIOTeamDepthChart | SportsDataIODepthChart>>(
    endpoint(config, config.teamFeed, "DepthCharts"),
    `depthcharts:${sport}`,
  );
  if (!Array.isArray(rows)) return [];
  if (rows.some((row) => Array.isArray((row as SportsDataIOTeamDepthChart).DepthCharts))) {
    return rows.filter((row): row is SportsDataIOTeamDepthChart =>
      typeof (row as SportsDataIOTeamDepthChart).TeamID === "number" &&
      Array.isArray((row as SportsDataIOTeamDepthChart).DepthCharts),
    );
  }

  const byTeam = new Map<number, SportsDataIODepthChart[]>();
  for (const row of rows) {
    const player = row as SportsDataIODepthChart;
    if (typeof player.TeamID !== "number") continue;
    const existing = byTeam.get(player.TeamID) ?? [];
    existing.push(player);
    byTeam.set(player.TeamID, existing);
  }

  return [...byTeam.entries()].map(([TeamID, DepthCharts]) => ({ TeamID, DepthCharts }));
}

export async function fetchSportsDataIOLineup(
  sport: string,
  teamAbbreviation: string,
): Promise<StartingLineup | null> {
  const team = await findTeam(sport, teamAbbreviation);
  if (!team) return null;
  const depthCharts = await fetchDepthCharts(sport);
  const teamDepth = depthCharts.find((row) => row.TeamID === team.TeamID);
  const rawPlayers = teamDepth?.DepthCharts ?? [];
  if (rawPlayers.length === 0) return null;

  const positionOrder = sport === "NBA" || sport === "NCAAB"
    ? ["PG", "SG", "SF", "PF", "C"]
    : ["QB", "RB", "WR", "TE"];
  const starters: LineupPlayer[] = [];
  const seenNames = new Set<string>();

  for (const position of positionOrder) {
    const player = rawPlayers
      .filter((p) => p.Position === position && isMeaningfulText(p.Name))
      .sort((a, b) => (a.DepthOrder ?? 99) - (b.DepthOrder ?? 99))[0];
    if (!player?.Name || seenNames.has(player.Name)) continue;
    seenNames.add(player.Name);
    starters.push({
      name: player.Name,
      position,
      isConfirmed: false,
    });
  }

  if (starters.length === 0) return null;
  return { sport, starters };
}

async function fetchPlayersForTeam(
  sport: string,
  teamAbbreviation: string,
): Promise<SportsDataIOPlayer[]> {
  const config = configForSport(sport);
  if (!config) return [];
  const teamKey = normalizeTeamKey(teamAbbreviation);
  if (!teamKey) return [];
  const players = await fetchJson<SportsDataIOPlayer[]>(
    endpoint(config, config.teamFeed, `Players/${teamKey}`),
    `players:${sport}:${teamKey}`,
  );
  return Array.isArray(players) ? players : [];
}

function injuryBucket(status: string): "out" | "doubtful" | "questionable" | null {
  const value = status.toLowerCase();
  if (value.includes("out") || value.includes("injured reserve") || value.includes("suspended")) return "out";
  if (value.includes("doubtful")) return "doubtful";
  if (value.includes("questionable") || value.includes("day-to-day") || value.includes("probable")) return "questionable";
  return null;
}

export async function fetchSportsDataIOInjuries(
  sport: string,
  teamAbbreviation: string,
): Promise<TeamInjuryReport | null> {
  const players = await fetchPlayersForTeam(sport, teamAbbreviation);
  if (players.length === 0) return null;

  const out: TeamInjuryReport["out"] = [];
  const doubtful: TeamInjuryReport["doubtful"] = [];
  const questionable: TeamInjuryReport["questionable"] = [];

  for (const player of players) {
    const rawStatus = player.InjuryStatus ?? player.Status;
    if (!isMeaningfulText(rawStatus)) continue;
    const bucket = injuryBucket(rawStatus);
    if (!bucket) continue;
    const name =
      player.Name ??
      [player.FirstName, player.LastName].filter(isMeaningfulText).join(" ");
    if (!name) continue;
    const detail = [player.InjuryStatus, player.InjuryBodyPart, player.InjuryNotes]
      .filter(isMeaningfulText)
      .join(" - ");
    const entry = {
      name,
      position: player.Position ?? "",
      detail: detail || rawStatus,
    };
    if (bucket === "out") out.push(entry);
    else if (bucket === "doubtful") doubtful.push(entry);
    else questionable.push(entry);
  }

  if (out.length + doubtful.length + questionable.length === 0) return null;
  return {
    out,
    doubtful,
    questionable,
    totalOut: out.length,
    totalDoubtful: doubtful.length,
    totalQuestionable: questionable.length,
  };
}

export function mergeInjuryReports(
  primary: TeamInjuryReport,
  sportsDataIO: TeamInjuryReport | null,
): TeamInjuryReport {
  if (!sportsDataIO) return primary;
  const seen = new Set<string>();
  const mergeList = (
    left: TeamInjuryReport["out"],
    right: TeamInjuryReport["out"],
  ) => {
    const merged: TeamInjuryReport["out"] = [];
    for (const player of [...left, ...right]) {
      const key = player.name.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(player);
    }
    return merged;
  };

  const out = mergeList(primary.out, sportsDataIO.out);
  const doubtful = mergeList(primary.doubtful, sportsDataIO.doubtful);
  const questionable = mergeList(primary.questionable, sportsDataIO.questionable);

  return {
    out,
    doubtful,
    questionable,
    totalOut: out.length,
    totalDoubtful: doubtful.length,
    totalQuestionable: questionable.length,
  };
}
