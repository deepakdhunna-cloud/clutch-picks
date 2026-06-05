/**
 * Current-engine historical replay.
 *
 * Pulls real completed games from ESPN scoreboards, rolls sport-specific Elo
 * ratings forward chronologically, runs the current unified prediction engine,
 * and compares the pick/projection to the actual final score.
 *
 * This is an approximate replay, not a point-in-time audit. Elo is replayed
 * from historical scores, but other context rebuilt by buildGameContext()
 * can reflect data available now rather than data available before tipoff.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { GameContext, HonestPrediction } from "../prediction/types";

type FinalPick = "home" | "away" | "draw";

type TeamInfo = {
  id: string;
  name: string;
  abbreviation: string;
  logo: string;
  record: string;
  // Tennis-only: player ranking signal flows through buildGameContext into the
  // tennis ranking factor. Undefined for team sports.
  rank?: number;
  seed?: number;
  rankingPoints?: number;
};

type HistoricalEvent = {
  id: string;
  sport: string;
  date: string;
  venue: string;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  homeScore: number;
  awayScore: number;
  actualPick: FinalPick;
  marketFavorite?: "home" | "away";
  spread?: number;
  overUnder?: number;
};

type EvaluationCandidate = {
  event: HistoricalEvent;
  homeElo: number;
  awayElo: number;
};

type ReplayRow = {
  gameId: string;
  sport: string;
  date: string;
  matchup: string;
  actualPick: FinalPick;
  predictedPick: "home" | "away" | "draw" | "none";
  correct: boolean;
  confidence: number;
  actualScore: { home: number; away: number };
  projectedScore?: { home: number; away: number; spread: number; total: number };
  probabilityAssignedToActual: number;
  brier: number;
  availableFactors: number;
  unavailableFactors: number;
  warnings: string[];
};

type SportSummary = {
  sport: string;
  scoredGames: number;
  correct: number;
  accuracy: number | null;
  avgConfidence: number | null;
  avgActualProbability: number | null;
  logLoss: number | null;
  brier: number | null;
  homeScoreMae: number | null;
  awayScoreMae: number | null;
  totalMae: number | null;
  marginMae: number | null;
};

type CalibrationBucket = {
  label: string;
  min: number;
  max: number;
  total: number;
  correct: number;
  accuracy: number | null;
};

type ReplayReport = {
  runAt: string;
  mode: "current-engine-historical-replay";
  sportsRequested: string[];
  daysScanned: number;
  warmupGamesPerTeam: number;
  maxGamesPerSport: number;
  totalHistoricalGamesFound: number;
  totalGamesScored: number;
  overall: SportSummary;
  perSport: SportSummary[];
  calibration: CalibrationBucket[];
  highConfidenceMisses: ReplayRow[];
  rows: ReplayRow[];
  warnings: string[];
  dataQualityNote: string;
};

const ESPN_PATHS: Record<string, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  NCAAB: "basketball/mens-college-basketball",
  NCAAF: "football/college-football",
  MLS: "soccer/usa.1",
  EPL: "soccer/eng.1",
  UCL: "soccer/uefa.champions",
  IPL: "cricket/8048",
  // Sentinel so TENNIS clears the supported-sports gate. Tennis is fetched
  // specially (ATP+WTA tours, tournament→round→match nesting) — see
  // fetchTennisScoreboardForDate; this path string is not used directly.
  TENNIS: "tennis",
};

const TENNIS_TOURS = ["atp", "wta"];

const DEFAULT_SPORTS = ["NBA", "MLB", "NHL", "MLS", "EPL", "UCL", "IPL", "NFL", "NCAAF", "NCAAB"];

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ClutchPicksBacktest/1.0)",
  "Accept": "application/json",
};

const BUCKET_TEMPLATE = [
  { label: "0-39", min: 0, max: 39 },
  { label: "40-44", min: 40, max: 44 },
  { label: "45-49", min: 45, max: 49 },
  { label: "50-54", min: 50, max: 54 },
  { label: "55-59", min: 55, max: 59 },
  { label: "60-64", min: 60, max: 64 },
  { label: "65-69", min: 65, max: 69 },
  { label: "70-74", min: 70, max: 74 },
  { label: "75-79", min: 75, max: 79 },
  { label: "80-100", min: 80, max: 100 },
];

function setLocalBacktestEnvDefaults(): void {
  process.env.DATABASE_URL ||= "postgresql://user:pass@localhost:5432/clutch_backtest";
  process.env.BETTER_AUTH_SECRET ||= "local-backtest-secret-at-least-32-chars";
}

function parseArgs(argv: string[]): {
  sports: string[];
  days: number;
  warmup: number;
  maxGamesPerSport: number;
  concurrency: number;
} {
  const getValue = (name: string): string | undefined => {
    const prefix = `${name}=`;
    const inline = argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = argv.indexOf(name);
    if (index >= 0) return argv[index + 1];
    return undefined;
  };

  const sportsRaw = getValue("--sports") ?? "all";
  const requestedSports = sportsRaw.toLowerCase() === "all"
    ? DEFAULT_SPORTS
    : sportsRaw.split(",").map((sport) => sport.trim().toUpperCase()).filter(Boolean);

  return {
    sports: requestedSports,
    days: clampInt(Number(getValue("--days") ?? 45), 1, 365),
    warmup: clampInt(Number(getValue("--warmup") ?? 5), 0, 30),
    maxGamesPerSport: clampInt(Number(getValue("--max-games-per-sport") ?? 40), 1, 500),
    concurrency: clampInt(Number(getValue("--concurrency") ?? 4), 1, 10),
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function datesBack(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let offset = days; offset >= 1; offset--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - offset);
    out.push(yyyymmdd(d));
  }
  return out;
}

function scoreboardUrl(sport: string, dateYYYYMMDD: string): string {
  const params = new URLSearchParams({ dates: dateYYYYMMDD });
  if (sport === "NCAAB") {
    params.set("groups", "50");
    params.set("limit", "300");
  }
  if (sport === "NCAAF") {
    params.set("groups", "80");
    params.set("limit", "300");
  }
  return `https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATHS[sport]}/scoreboard?${params.toString()}`;
}

function parseScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWinner(value: unknown): boolean {
  return value === true || value === "true";
}

function recordSummary(competitor: any): string {
  const record = (competitor?.records ?? []).find((row: any) =>
    row?.type === "total" || row?.type === "overall" || row?.name === "overall"
  );
  return String(record?.summary ?? record?.displayValue ?? "0-0");
}

function teamInfo(competitor: any): TeamInfo | null {
  const team = competitor?.team;
  if (!team?.id) return null;
  return {
    id: String(team.id),
    name: String(team.displayName ?? team.shortDisplayName ?? team.name ?? team.abbreviation ?? team.id),
    abbreviation: String(team.abbreviation ?? team.shortDisplayName ?? team.name ?? team.id),
    logo: String(team.logo ?? team.logos?.[0]?.href ?? ""),
    record: recordSummary(competitor),
  };
}

function oddsFromCompetition(competition: any): {
  marketFavorite?: "home" | "away";
  spread?: number;
  overUnder?: number;
} {
  const odds = competition?.odds?.[0];
  if (!odds) return {};
  const spread = Number(odds.spread);
  const overUnder = Number(odds.overUnder);
  const marketFavorite = odds.homeTeamOdds?.favorite
    ? "home"
    : odds.awayTeamOdds?.favorite
      ? "away"
      : undefined;
  return {
    marketFavorite,
    spread: Number.isFinite(spread) ? spread : undefined,
    overUnder: Number.isFinite(overUnder) ? overUnder : undefined,
  };
}

function historicalEventFromEspn(sport: string, event: any): HistoricalEvent | null {
  const competition = event?.competitions?.[0];
  const statusType = competition?.status?.type ?? event?.status?.type;
  const state = String(statusType?.state ?? "").toLowerCase();
  const completed = statusType?.completed === true || state === "post";
  if (!competition || !completed) return null;

  const competitors: any[] = competition.competitors ?? [];
  const home = competitors.find((c) => c?.homeAway === "home");
  const away = competitors.find((c) => c?.homeAway === "away");
  if (!home || !away) return null;

  const homeTeam = teamInfo(home);
  const awayTeam = teamInfo(away);
  if (!homeTeam || !awayTeam) return null;

  const homeScore = parseScore(home.score);
  const awayScore = parseScore(away.score);
  if (homeScore === null || awayScore === null) return null;

  let actualPick: FinalPick;
  if (homeScore > awayScore) {
    actualPick = "home";
  } else if (awayScore > homeScore) {
    actualPick = "away";
  } else if (isWinner(home.winner)) {
    actualPick = "home";
  } else if (isWinner(away.winner)) {
    actualPick = "away";
  } else {
    actualPick = "draw";
  }

  const odds = oddsFromCompetition(competition);
  return {
    id: String(event.id ?? competition.id),
    sport,
    date: String(competition.date ?? event.date ?? ""),
    venue: String(competition.venue?.fullName ?? event.venue?.fullName ?? "Unknown"),
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    actualPick,
    ...odds,
  };
}

// ─── Tennis (ATP/WTA) ───────────────────────────────────────────────────────
// Tennis on ESPN nests matches under tournament → grouping(round) → competition,
// and competitors are players (athlete, not team). Ranking comes from
// curatedRank.current. There is no team-style score, so home/away "score" is
// sets won and the winner is taken from the winner flag. Score MAE is therefore
// meaningless for tennis (sets ≠ projected games) — only accuracy/Brier matter.
function tennisCompetitorRank(competitor: any): number | undefined {
  const raw = competitor?.curatedRank?.current ?? competitor?.athlete?.rank?.current ?? competitor?.athlete?.rank;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 2000 ? n : undefined;
}

function tennisTeamInfo(competitor: any): TeamInfo | null {
  const ath = competitor?.athlete;
  if (!ath) return null;
  const id = String(ath.guid ?? ath.id ?? ath.displayName ?? "");
  if (!id) return null;
  const seed = Number(competitor?.seed ?? ath?.seed);
  return {
    id,
    name: String(ath.displayName ?? ath.fullName ?? ath.shortName ?? id),
    abbreviation: String(ath.shortName ?? ath.displayName ?? id).slice(0, 24),
    logo: "",
    record: "0-0",
    rank: tennisCompetitorRank(competitor),
    seed: Number.isFinite(seed) && seed > 0 ? seed : undefined,
  };
}

function tennisSetsWon(competitor: any, opponent: any): number {
  const a: any[] = competitor?.linescores ?? [];
  const b: any[] = opponent?.linescores ?? [];
  let won = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const av = Number(a[i]?.value);
    const bv = Number(b[i]?.value);
    if (Number.isFinite(av) && Number.isFinite(bv) && av > bv) won++;
  }
  return won;
}

function tennisMatchToEvent(match: any): HistoricalEvent | null {
  const statusType = match?.status?.type ?? {};
  const completed = statusType.completed === true || String(statusType.state ?? "").toLowerCase() === "post";
  if (!completed) return null;
  const competitors: any[] = match?.competitors ?? [];
  if (competitors.length < 2) return null;
  const home = competitors.find((c) => c?.homeAway === "home") ?? competitors[0];
  const away = competitors.find((c) => c?.homeAway === "away") ?? competitors[1];
  const homeTeam = tennisTeamInfo(home);
  const awayTeam = tennisTeamInfo(away);
  if (!homeTeam || !awayTeam || homeTeam.id === awayTeam.id) return null;
  // Evaluate only ranked-vs-ranked matchups — the population the tennis model is
  // designed for and what the live app serves. Unranked qualifier/challenger
  // matches have neither a ranking signal nor meaningful player history, so
  // including them measures noise rather than the model.
  if (homeTeam.rank === undefined || awayTeam.rank === undefined) return null;

  const homeSets = tennisSetsWon(home, away);
  const awaySets = tennisSetsWon(away, home);
  let actualPick: FinalPick;
  if (isWinner(home.winner)) actualPick = "home";
  else if (isWinner(away.winner)) actualPick = "away";
  else if (homeSets !== awaySets) actualPick = homeSets > awaySets ? "home" : "away";
  else return null; // walkover/retirement with no winner flag — unscoreable

  return {
    id: String(match.id ?? match.uid ?? `${homeTeam.id}-${awayTeam.id}-${match.date ?? ""}`),
    sport: "TENNIS",
    date: String(match.date ?? match.startDate ?? ""),
    venue: String(match.venue?.fullName ?? "Unknown"),
    homeTeam,
    awayTeam,
    homeScore: homeSets,
    awayScore: awaySets,
    actualPick,
  };
}

async function fetchTennisScoreboardForDate(dateYYYYMMDD: string): Promise<HistoricalEvent[]> {
  const out: HistoricalEvent[] = [];
  for (const tour of TENNIS_TOURS) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard?${new URLSearchParams({ dates: dateYYYYMMDD }).toString()}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: FETCH_HEADERS });
      if (!response.ok) continue;
      const data = await response.json() as any;
      for (const event of data?.events ?? []) {
        for (const grouping of event?.groupings ?? []) {
          for (const match of grouping?.competitions ?? []) {
            const parsed = tennisMatchToEvent(match);
            if (parsed) out.push(parsed);
          }
        }
      }
    } catch {
      // ignore per-tour fetch errors
    }
  }
  return out;
}

async function fetchScoreboardForDate(sport: string, dateYYYYMMDD: string): Promise<HistoricalEvent[]> {
  if (sport === "TENNIS") return fetchTennisScoreboardForDate(dateYYYYMMDD);
  const url = scoreboardUrl(sport, dateYYYYMMDD);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: FETCH_HEADERS,
    });
    if (!response.ok) return [];

    const data = await response.json() as any;
    return (data?.events ?? [])
      .map((event: any) => historicalEventFromEspn(sport, event))
      .filter((event: HistoricalEvent | null): event is HistoricalEvent => event !== null);
  } catch {
    return [];
  }
}

async function mapInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(fn)));
    if (i + concurrency < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
  }
  return results;
}

async function fetchHistoricalEvents(
  sport: string,
  dates: string[],
  concurrency: number,
): Promise<HistoricalEvent[]> {
  const byDate = await mapInBatches(dates, concurrency, (date) => fetchScoreboardForDate(sport, date));
  const deduped = new Map<string, HistoricalEvent>();
  for (const events of byDate) {
    for (const event of events) deduped.set(event.id, event);
  }
  return Array.from(deduped.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function buildEvaluationCandidates(args: {
  events: HistoricalEvent[];
  warmup: number;
  defaultRating: number;
  expectedScore: (ratingA: number, ratingB: number) => number;
  getHomeBonus: (sport: string) => number;
  getK: (sport: string) => number;
  movMultiplier: (margin: number | undefined, sport: string) => number;
}): EvaluationCandidate[] {
  const ratings = new Map<string, number>();
  const gameCounts = new Map<string, number>();
  const candidates: EvaluationCandidate[] = [];

  for (const event of args.events) {
    const homeRating = ratings.get(event.homeTeam.id) ?? args.defaultRating;
    const awayRating = ratings.get(event.awayTeam.id) ?? args.defaultRating;
    const homeCount = gameCounts.get(event.homeTeam.id) ?? 0;
    const awayCount = gameCounts.get(event.awayTeam.id) ?? 0;

    if (homeCount >= args.warmup && awayCount >= args.warmup) {
      candidates.push({ event, homeElo: homeRating, awayElo: awayRating });
    }

    const expectedHome = args.expectedScore(homeRating + args.getHomeBonus(event.sport), awayRating);
    const actualHome = event.actualPick === "draw" ? 0.5 : event.actualPick === "home" ? 1 : 0;
    const actualAway = 1 - actualHome;
    const expectedAway = 1 - expectedHome;
    const margin = event.actualPick === "draw" ? 0 : Math.abs(event.homeScore - event.awayScore);
    const k = args.getK(event.sport) * args.movMultiplier(margin, event.sport);

    ratings.set(event.homeTeam.id, homeRating + k * (actualHome - expectedHome));
    ratings.set(event.awayTeam.id, awayRating + k * (actualAway - expectedAway));
    gameCounts.set(event.homeTeam.id, homeCount + 1);
    gameCounts.set(event.awayTeam.id, awayCount + 1);
  }

  return candidates;
}

function gameForContext(event: HistoricalEvent) {
  return {
    id: event.id,
    sport: event.sport,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    gameTime: event.date,
    venue: event.venue,
    spread: event.spread,
    overUnder: event.overUnder,
    marketFavorite: event.marketFavorite,
  };
}

function finalPick(prediction: HonestPrediction): "home" | "away" | "draw" | "none" {
  return prediction.canonicalResult.finalPick;
}

function probabilityForActual(prediction: HonestPrediction, actualPick: FinalPick): number {
  const probabilities = prediction.canonicalResult.probabilities;
  if (actualPick === "home") return probabilities.home;
  if (actualPick === "away") return probabilities.away;
  return probabilities.draw ?? 0;
}

function brierForRow(prediction: HonestPrediction, actualPick: FinalPick): number {
  const probabilities = prediction.canonicalResult.probabilities;
  const picks: FinalPick[] = probabilities.draw === undefined ? ["home", "away"] : ["home", "away", "draw"];
  return picks.reduce((sum, pick) => {
    const p = pick === "home" ? probabilities.home : pick === "away" ? probabilities.away : probabilities.draw ?? 0;
    const y = pick === actualPick ? 1 : 0;
    return sum + (p - y) ** 2;
  }, 0);
}

async function replayCandidate(args: {
  candidate: EvaluationCandidate;
  predictGame: (ctx: GameContext) => HonestPrediction;
  buildGameContext: (game: ReturnType<typeof gameForContext>) => Promise<GameContext>;
}): Promise<ReplayRow | null> {
  try {
    const ctx = await args.buildGameContext(gameForContext(args.candidate.event));
    // REPLAY_FREEZE_ELO=true simulates production's frozen-Elo state (every team
    // at the default 1500) so we can A/B the value of a live Elo refresh: a
    // frozen run vs the normal rolled-forward run, holding everything else equal.
    if (process.env.REPLAY_FREEZE_ELO === "true") {
      ctx.homeElo = 1500;
      ctx.awayElo = 1500;
    } else {
      ctx.homeElo = args.candidate.homeElo;
      ctx.awayElo = args.candidate.awayElo;
    }

    const prediction = args.predictGame(ctx);
    const predictedPick = finalPick(prediction);
    const probabilityAssignedToActual = probabilityForActual(prediction, args.candidate.event.actualPick);
    const projectedScore = prediction.canonicalResult.projectedScore;

    return {
      gameId: args.candidate.event.id,
      sport: args.candidate.event.sport,
      date: args.candidate.event.date,
      matchup: `${args.candidate.event.awayTeam.abbreviation} @ ${args.candidate.event.homeTeam.abbreviation}`,
      actualPick: args.candidate.event.actualPick,
      predictedPick,
      correct: predictedPick === args.candidate.event.actualPick,
      confidence: prediction.canonicalResult.confidence,
      actualScore: {
        home: args.candidate.event.homeScore,
        away: args.candidate.event.awayScore,
      },
      projectedScore,
      probabilityAssignedToActual,
      brier: brierForRow(prediction, args.candidate.event.actualPick),
      availableFactors: prediction.factors.filter((factor) => factor.available).length,
      unavailableFactors: prediction.unavailableFactors.length,
      warnings: prediction.canonicalResult.warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[historical-replay] skipped ${args.candidate.event.sport} ${args.candidate.event.id}: ${message}`);
    return null;
  }
}

function summarizeRows(sport: string, rows: ReplayRow[]): SportSummary {
  if (rows.length === 0) {
    return {
      sport,
      scoredGames: 0,
      correct: 0,
      accuracy: null,
      avgConfidence: null,
      avgActualProbability: null,
      logLoss: null,
      brier: null,
      homeScoreMae: null,
      awayScoreMae: null,
      totalMae: null,
      marginMae: null,
    };
  }

  const correct = rows.filter((row) => row.correct).length;
  const withProjection = rows.filter((row) => row.projectedScore);
  const avg = (values: number[]): number | null =>
    values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 3) : null;

  return {
    sport,
    scoredGames: rows.length,
    correct,
    accuracy: round((correct / rows.length) * 100, 1),
    avgConfidence: avg(rows.map((row) => row.confidence)),
    avgActualProbability: avg(rows.map((row) => row.probabilityAssignedToActual * 100)),
    logLoss: avg(rows.map((row) => -Math.log(Math.max(0.001, row.probabilityAssignedToActual)))),
    brier: avg(rows.map((row) => row.brier)),
    homeScoreMae: avg(withProjection.map((row) => Math.abs(row.projectedScore!.home - row.actualScore.home))),
    awayScoreMae: avg(withProjection.map((row) => Math.abs(row.projectedScore!.away - row.actualScore.away))),
    totalMae: avg(withProjection.map((row) =>
      Math.abs(row.projectedScore!.total - (row.actualScore.home + row.actualScore.away))
    )),
    marginMae: avg(withProjection.map((row) =>
      Math.abs(row.projectedScore!.spread - (row.actualScore.home - row.actualScore.away))
    )),
  };
}

function calibration(rows: ReplayRow[]): CalibrationBucket[] {
  return BUCKET_TEMPLATE.map((bucket) => {
    const bucketRows = rows.filter((row) => row.confidence >= bucket.min && row.confidence <= bucket.max);
    const correct = bucketRows.filter((row) => row.correct).length;
    return {
      ...bucket,
      total: bucketRows.length,
      correct,
      accuracy: bucketRows.length > 0 ? round((correct / bucketRows.length) * 100, 1) : null,
    };
  });
}

async function main(): Promise<void> {
  setLocalBacktestEnvDefaults();
  const args = parseArgs(process.argv.slice(2));
  const warnings: string[] = [];
  const unsupportedSports = args.sports.filter((sport) => !ESPN_PATHS[sport]);
  const sports = args.sports.filter((sport) => ESPN_PATHS[sport]);

  for (const sport of unsupportedSports) {
    warnings.push(`${sport} is not supported by the ESPN JSON scoreboard replay script yet.`);
  }

  if (sports.length === 0) {
    throw new Error("No supported sports requested.");
  }

  const [
    { predictGame },
    { buildGameContext },
    { DEFAULT_RATING, expectedScore, getHomeBonus, getK, movMultiplier },
    { prisma },
  ] = await Promise.all([
    import("../prediction/index"),
    import("../prediction/shadow"),
    import("../lib/elo"),
    import("../prisma"),
  ]);

  const dates = datesBack(args.days);
  console.log(`[historical-replay] scanning ${args.days} days for ${sports.join(", ")}`);
  console.log(`[historical-replay] warmup=${args.warmup}, maxGamesPerSport=${args.maxGamesPerSport}`);

  const eventsBySport = new Map<string, HistoricalEvent[]>();
  let totalHistoricalGamesFound = 0;

  for (const sport of sports) {
    const events = await fetchHistoricalEvents(sport, dates, args.concurrency);
    eventsBySport.set(sport, events);
    totalHistoricalGamesFound += events.length;
    console.log(`[historical-replay] ${sport}: ${events.length} completed games found`);
  }

  const candidates: EvaluationCandidate[] = [];
  for (const sport of sports) {
    const events = eventsBySport.get(sport) ?? [];
    const sportCandidates = buildEvaluationCandidates({
      events,
      warmup: args.warmup,
      defaultRating: DEFAULT_RATING,
      expectedScore,
      getHomeBonus,
      getK,
      movMultiplier,
    }).slice(-args.maxGamesPerSport);
    candidates.push(...sportCandidates);
    console.log(`[historical-replay] ${sport}: ${sportCandidates.length} games selected after warmup`);
  }

  const rowsRaw = await mapInBatches(candidates, args.concurrency, (candidate) =>
    replayCandidate({ candidate, predictGame, buildGameContext })
  );
  const rows = rowsRaw.filter((row): row is ReplayRow => row !== null)
    .sort((a, b) => `${a.sport}-${a.date}`.localeCompare(`${b.sport}-${b.date}`));

  const perSport = sports
    .map((sport) => summarizeRows(sport, rows.filter((row) => row.sport === sport)))
    .filter((summary) => summary.scoredGames > 0);
  const overall = summarizeRows("OVERALL", rows);
  const highConfidenceMisses = rows
    .filter((row) => !row.correct)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);

  if (rows.length < candidates.length) {
    warnings.push(`${candidates.length - rows.length} selected games were skipped because context rebuild failed.`);
  }
  for (const summary of perSport) {
    if (summary.scoredGames < 30) {
      warnings.push(`${summary.sport} sample is ${summary.scoredGames} games; treat that league's number as directional only.`);
    }
  }

  const report: ReplayReport = {
    runAt: new Date().toISOString(),
    mode: "current-engine-historical-replay",
    sportsRequested: args.sports,
    daysScanned: args.days,
    warmupGamesPerTeam: args.warmup,
    maxGamesPerSport: args.maxGamesPerSport,
    totalHistoricalGamesFound,
    totalGamesScored: rows.length,
    overall,
    perSport,
    calibration: calibration(rows),
    highConfidenceMisses,
    rows,
    warnings,
    dataQualityNote:
      "Approximate replay: final scores are real ESPN historical results, Elo is rolled forward chronologically, " +
      "and ESPN recent-form/stat windows are capped before each event. Rebuilt context such as injuries, standings, " +
      "weather, and provider enrichment can still reflect current availability instead of the exact pregame snapshot. " +
      "Exact accuracy requires saved point-in-time GameContext fixtures.",
  };

  const outDir = join(import.meta.dir, "../../backtest-results");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const specificPath = join(outDir, `current-engine-historical-${stamp}.json`);
  const latestPath = join(outDir, "current-engine-historical-latest.json");

  await Promise.all([
    writeFile(specificPath, JSON.stringify(report, null, 2)),
    writeFile(latestPath, JSON.stringify(report, null, 2)),
  ]);

  console.log("\n[historical-replay] complete");
  console.log(`[historical-replay] scored games: ${report.totalGamesScored}`);
  console.log(`[historical-replay] overall accuracy: ${report.overall.accuracy ?? "n/a"}%`);
  for (const summary of report.perSport) {
    console.log(
      `[historical-replay] ${summary.sport.padEnd(6)} ${String(summary.accuracy ?? "n/a").padStart(5)}% ` +
      `(${summary.correct}/${summary.scoredGames}), avg confidence ${summary.avgConfidence ?? "n/a"}%`,
    );
  }
  console.log(`[historical-replay] wrote ${specificPath}`);

  await prisma.$disconnect().catch(() => undefined);
}

main().catch((err) => {
  console.error("[historical-replay] failed", err);
  process.exit(1);
});
