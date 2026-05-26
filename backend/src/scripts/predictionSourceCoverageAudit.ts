import { buildGameContext } from "../prediction/shadow";
import { predictGame } from "../prediction";
import type { FactorContribution, GameContext } from "../prediction/types";

type ApiObject = Record<string, any>;

const DEFAULT_BASE_URL = "https://clutch-picks-production.up.railway.app";
const baseUrl = (process.env.PREDICTION_AUDIT_BASE_URL ?? process.env.BACKEND_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
const auditDate = process.env.PREDICTION_AUDIT_DATE ?? new Date().toISOString().slice(0, 10);
const limit = Number.parseInt(process.env.PREDICTION_AUDIT_LIMIT ?? "120", 10);
const concurrency = Math.max(1, Number.parseInt(process.env.PREDICTION_AUDIT_CONCURRENCY ?? "3", 10));
const strict = process.env.PREDICTION_AUDIT_STRICT === "1";
const criticalCoverageFloor = Number.parseFloat(process.env.PREDICTION_AUDIT_CRITICAL_FLOOR ?? "80");

const CRITICAL_FACTOR_KEYS: Record<string, string[]> = {
  NBA: ["injuries_nba", "net_rating"],
  NCAAB: ["injuries_ncaamb", "net_rating_ncaamb"],
  NFL: ["starting_qb", "injuries_nfl"],
  NCAAF: ["starting_qb_ncaaf", "injuries_ncaaf"],
  MLB: ["starting_pitcher", "injuries_mlb"],
  NHL: ["starting_goalie", "special_teams", "injuries_nhl"],
  MLS: ["fixture_congestion", "key_player_availability", "stakes"],
  EPL: ["fixture_congestion", "key_player_availability", "stakes"],
  UCL: ["fixture_congestion", "key_player_availability", "ucl_pedigree", "ucl_travel"],
  IPL: ["ipl_table_strength", "ipl_venue_split"],
  TENNIS: ["tennis_ranking_edge", "tennis_recent_form"],
};

type AuditRow = {
  id: string;
  sport: string;
  matchup: string;
  confidence: number;
  pick: string;
  criticalMissing: string[];
  warnings: string[];
  tags: string[];
  sources: {
    homeAvailability: string | null;
    awayAvailability: string | null;
    market: string | null;
    sportsDataIO: GameContext["sportsDataIO"] | undefined;
    advancedFields: {
      home: string[];
      away: string[];
    };
    lineups: {
      home: boolean;
      away: boolean;
    };
  };
};

function asGames(payload: unknown): ApiObject[] {
  if (Array.isArray(payload)) return payload as ApiObject[];
  const object = payload as ApiObject | null;
  if (Array.isArray(object?.games)) return object.games;
  if (Array.isArray(object?.data)) return object.data;
  return [];
}

function gameName(game: ApiObject): string {
  const away = game.awayTeam?.abbreviation ?? game.awayTeam?.name ?? "Away";
  const home = game.homeTeam?.abbreviation ?? game.homeTeam?.name ?? "Home";
  return `${away} @ ${home}`;
}

function factorMissing(factors: FactorContribution[], key: string): boolean {
  const factor = factors.find((candidate) => candidate.key === key);
  return !factor || !factor.available;
}

function source(report: GameContext["homeInjuries"]): string | null {
  const value = (report as { source?: string }).source;
  return typeof value === "string" ? value : null;
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function mapLimit<T, R>(
  values: T[],
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function run(): Promise<void> {
    while (index < values.length) {
      const current = values[index]!;
      index += 1;
      results.push(await worker(current));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return results;
}

async function auditGame(game: ApiObject): Promise<AuditRow> {
  const ctx = await buildGameContext({
    id: String(game.id),
    sport: String(game.sport),
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    gameTime: String(game.gameTime ?? game.dateTime),
    venue: String(game.venue ?? ""),
    spread: game.spread,
    overUnder: game.overUnder,
    marketFavorite: game.marketFavorite,
    seasonContext: game.seasonContext ?? null,
  });
  const prediction = predictGame(ctx);
  const criticalKeys = CRITICAL_FACTOR_KEYS[ctx.sport] ?? [];
  return {
    id: String(game.id),
    sport: ctx.sport,
    matchup: gameName(game),
    confidence: prediction.confidence,
    pick: prediction.canonicalResult.finalPick,
    criticalMissing: criticalKeys.filter((key) => factorMissing(prediction.factors, key)),
    warnings: prediction.canonicalResult.warnings,
    tags: prediction.canonicalResult.decisionProfile?.tags ?? [],
    sources: {
      homeAvailability: source(ctx.homeInjuries),
      awayAvailability: source(ctx.awayInjuries),
      market: ctx.marketConsensus?.sourceLabel ?? ctx.marketConsensus?.source ?? null,
      sportsDataIO: ctx.sportsDataIO,
      advancedFields: {
        home: Object.keys(ctx.homeAdvanced).sort(),
        away: Object.keys(ctx.awayAdvanced).sort(),
      },
      lineups: {
        home: Boolean(ctx.homeLineup),
        away: Boolean(ctx.awayLineup),
      },
    },
  };
}

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

async function main(): Promise<void> {
  const games = asGames(await fetchJson(`/api/games/date/${auditDate}`))
    .filter((game) => game.status !== "FINAL")
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 120);
  const rows = await mapLimit(games, auditGame);

  const sports = [...new Set(rows.map((row) => row.sport))].sort();
  const bySport = sports.map((sport) => {
    const sportRows = rows.filter((row) => row.sport === sport);
    const missingCritical = sportRows.filter((row) => row.criticalMissing.length > 0);
    const market = sportRows.filter((row) => row.sources.market);
    const verifiedAvailability = sportRows.filter((row) =>
      row.sources.homeAvailability !== "unavailable" &&
      row.sources.awayAvailability !== "unavailable"
    );
    const advanced = sportRows.filter((row) =>
      row.sources.advancedFields.home.length > 0 &&
      row.sources.advancedFields.away.length > 0
    );
    const lineups = sportRows.filter((row) => row.sources.lineups.home && row.sources.lineups.away);
    return {
      sport,
      games: sportRows.length,
      criticalCoveragePct: pct(sportRows.length - missingCritical.length, sportRows.length),
      marketCoveragePct: pct(market.length, sportRows.length),
      verifiedAvailabilityPct: pct(verifiedAvailability.length, sportRows.length),
      advancedCoveragePct: pct(advanced.length, sportRows.length),
      lineupCoveragePct: pct(lineups.length, sportRows.length),
      missingCriticalFactors: Object.fromEntries(
        [...new Set(missingCritical.flatMap((row) => row.criticalMissing))]
          .sort()
          .map((key) => [key, missingCritical.filter((row) => row.criticalMissing.includes(key)).length]),
      ),
    };
  });

  const highRisk = rows
    .filter((row) => row.criticalMissing.length > 0 || row.tags.includes("thin-data"))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 25)
    .map((row) => ({
      id: row.id,
      sport: row.sport,
      matchup: row.matchup,
      confidence: row.confidence,
      pick: row.pick,
      criticalMissing: row.criticalMissing,
      availability: [row.sources.homeAvailability, row.sources.awayAvailability],
      market: row.sources.market,
      warnings: row.warnings,
      tags: row.tags,
    }));

  const findings = bySport.flatMap((row) => {
    const sportFindings: string[] = [];
    if (row.criticalCoveragePct < criticalCoverageFloor) {
      sportFindings.push(
        `${row.sport}: critical factor coverage ${row.criticalCoveragePct}% is below ${criticalCoverageFloor}%`,
      );
    }
    if ((row.sport === "TENNIS" || row.sport === "IPL") && row.marketCoveragePct === 0) {
      sportFindings.push(`${row.sport}: market coverage is 0%; do not promote as top picks without a verified odds source`);
    }
    return sportFindings;
  });

  console.log(JSON.stringify({
    baseUrl,
    auditDate,
    auditedGames: rows.length,
    bySport,
    highRisk,
    findings,
    strict,
  }, null, 2));

  if (strict && findings.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
