/**
 * Standalone backtest — runs without a database.
 *
 * This script patches the Prisma import with a mock, then runs the existing
 * currentEngineHistoricalReplay logic using only ESPN's public API.
 *
 * Usage: bun run src/scripts/standaloneBacktest.ts --sports NBA,MLB,NHL,EPL,MLS --days 30 --max-games-per-sport 50
 */

// ─── Patch Prisma before any other imports ─────────────────────────────────
// Bun's module system allows us to override the prisma import path.
import { mock } from "bun:test";

// We can't use bun:test mock in a non-test context, so we'll use a different approach.
// Instead, we'll create a register-style preload that replaces the module.

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// ─── Types ─────────────────────────────────────────────────────────────────

type TeamInfo = {
  id: string;
  name: string;
  abbreviation: string;
  logo: string;
  record: string;
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
  actualPick: "home" | "away" | "draw";
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
  actualPick: string;
  predictedPick: string;
  correct: boolean;
  confidence: number;
  actualScore: { home: number; away: number };
  projectedScore?: { home: number; away: number; spread: number; total: number };
};

type SportSummary = {
  sport: string;
  scoredGames: number;
  correct: number;
  accuracy: number | null;
  avgConfidence: number | null;
};

// ─── ESPN Config ───────────────────────────────────────────────────────────

const ESPN_PATHS: Record<string, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  MLS: "soccer/usa.1",
  EPL: "soccer/eng.1",
  UCL: "soccer/uefa.champions",
};

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ClutchPicksBacktest/1.0)",
  "Accept": "application/json",
};

const DEFAULT_SPORTS = ["NBA", "MLB", "NHL", "EPL", "MLS"];

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function parseArgs(argv: string[]) {
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
    : sportsRaw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

  return {
    sports: requestedSports,
    days: clampInt(Number(getValue("--days") ?? 30), 1, 180),
    warmup: clampInt(Number(getValue("--warmup") ?? 5), 0, 30),
    maxGamesPerSport: clampInt(Number(getValue("--max-games-per-sport") ?? 50), 1, 500),
    concurrency: clampInt(Number(getValue("--concurrency") ?? 3), 1, 8),
  };
}

// ─── ESPN Fetch ────────────────────────────────────────────────────────────

function scoreboardUrl(sport: string, dateYYYYMMDD: string): string {
  return `https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATHS[sport]}/scoreboard?dates=${dateYYYYMMDD}`;
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
  const home = competitors.find((c: any) => c?.homeAway === "home");
  const away = competitors.find((c: any) => c?.homeAway === "away");
  if (!home || !away) return null;

  const homeTeam = teamInfo(home);
  const awayTeam = teamInfo(away);
  if (!homeTeam || !awayTeam) return null;

  const homeScore = parseScore(home.score);
  const awayScore = parseScore(away.score);
  if (homeScore === null || awayScore === null) return null;

  let actualPick: "home" | "away" | "draw";
  if (homeScore > awayScore) actualPick = "home";
  else if (awayScore > homeScore) actualPick = "away";
  else if (isWinner(home.winner)) actualPick = "home";
  else if (isWinner(away.winner)) actualPick = "away";
  else actualPick = "draw";

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

async function fetchScoreboardForDate(sport: string, dateYYYYMMDD: string): Promise<HistoricalEvent[]> {
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

async function fetchHistoricalEvents(sport: string, dates: string[], concurrency: number): Promise<HistoricalEvent[]> {
  const results: HistoricalEvent[] = [];
  for (let i = 0; i < dates.length; i += concurrency) {
    const batch = dates.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((date) => fetchScoreboardForDate(sport, date)));
    for (const events of batchResults) results.push(...events);
    if (i + concurrency < dates.length) await new Promise((r) => setTimeout(r, 200));
  }
  const deduped = new Map<string, HistoricalEvent>();
  for (const event of results) deduped.set(event.id, event);
  return Array.from(deduped.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── Elo Replay ────────────────────────────────────────────────────────────

const DEFAULT_RATING = 1500;

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function getHomeBonus(sport: string): number {
  const bonuses: Record<string, number> = {
    NBA: 65, NFL: 48, MLB: 24, NHL: 33, MLS: 68, EPL: 62, UCL: 55, IPL: 15,
    NCAAF: 55, NCAAB: 100, TENNIS: 0,
  };
  return bonuses[sport] ?? 40;
}

function getK(sport: string): number {
  const ks: Record<string, number> = {
    NBA: 20, NFL: 28, MLB: 6, NHL: 16, MLS: 30, EPL: 30, UCL: 35, IPL: 40,
    NCAAF: 24, NCAAB: 24, TENNIS: 32,
  };
  return ks[sport] ?? 20;
}

function movMultiplier(margin: number | undefined, sport: string): number {
  if (margin === undefined || margin === 0) return 1;
  const divisors: Record<string, number> = {
    NBA: 12, NFL: 10, MLB: 4, NHL: 3, MLS: 2, EPL: 2, UCL: 2,
  };
  const divisor = divisors[sport] ?? 8;
  return Math.min(1.5, 1 + Math.log(1 + margin / divisor) * 0.4);
}

function buildEvaluationCandidates(events: HistoricalEvent[], warmup: number): EvaluationCandidate[] {
  const ratings = new Map<string, number>();
  const gameCounts = new Map<string, number>();
  const candidates: EvaluationCandidate[] = [];

  for (const event of events) {
    const homeRating = ratings.get(event.homeTeam.id) ?? DEFAULT_RATING;
    const awayRating = ratings.get(event.awayTeam.id) ?? DEFAULT_RATING;
    const homeCount = gameCounts.get(event.homeTeam.id) ?? 0;
    const awayCount = gameCounts.get(event.awayTeam.id) ?? 0;

    if (homeCount >= warmup && awayCount >= warmup) {
      candidates.push({ event, homeElo: homeRating, awayElo: awayRating });
    }

    const bonus = getHomeBonus(event.sport);
    const expected = expectedScore(homeRating + bonus, awayRating);
    const actual = event.actualPick === "draw" ? 0.5 : event.actualPick === "home" ? 1 : 0;
    const margin = event.actualPick === "draw" ? 0 : Math.abs(event.homeScore - event.awayScore);
    const k = getK(event.sport) * movMultiplier(margin, event.sport);

    ratings.set(event.homeTeam.id, homeRating + k * (actual - expected));
    ratings.set(event.awayTeam.id, awayRating + k * ((1 - actual) - (1 - expected)));
    gameCounts.set(event.homeTeam.id, homeCount + 1);
    gameCounts.set(event.awayTeam.id, awayCount + 1);
  }

  return candidates;
}

// ─── Context Builder (with real ESPN data) ─────────────────────────────────

import {
  fetchTeamRecentForm,
  fetchTeamExtendedStats,
  fetchAdvancedMetrics,
} from "../lib/espnStats";

const emptyInjuries = {
  out: [] as any[],
  doubtful: [] as any[],
  questionable: [] as any[],
  totalOut: 0,
  totalDoubtful: 0,
  totalQuestionable: 0,
};

async function buildRealGameContext(candidate: EvaluationCandidate): Promise<any> {
  const event = candidate.event;
  const gameDate = new Date(event.date);

  // Fetch real form data from ESPN (capped to before game date)
  const [homeForm, awayForm, homeExtended, awayExtended, homeAdvanced, awayAdvanced] = await Promise.all([
    fetchTeamRecentForm(event.homeTeam.id, event.sport, 10, gameDate).catch(() => ({
      results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0,
    })),
    fetchTeamRecentForm(event.awayTeam.id, event.sport, 10, gameDate).catch(() => ({
      results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0,
    })),
    fetchTeamExtendedStats(event.homeTeam.id, event.sport).catch(() => ({
      homeRecord: "0-0", awayRecord: "0-0", scoringTrend: 0, defenseTrend: 0,
      atsRecord: "0-0", overUnderRecord: "0-0", strengthOfSchedule: 0.5,
    })),
    fetchTeamExtendedStats(event.awayTeam.id, event.sport).catch(() => ({
      homeRecord: "0-0", awayRecord: "0-0", scoringTrend: 0, defenseTrend: 0,
      atsRecord: "0-0", overUnderRecord: "0-0", strengthOfSchedule: 0.5,
    })),
    fetchAdvancedMetrics(event.homeTeam.id, event.sport).catch(() => ({})),
    fetchAdvancedMetrics(event.awayTeam.id, event.sport).catch(() => ({})),
  ]);

  return {
    game: {
      id: event.id,
      sport: event.sport,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      gameTime: event.date,
      venue: event.venue,
      spread: event.spread,
      overUnder: event.overUnder,
      marketFavorite: event.marketFavorite,
    },
    sport: event.sport,
    homeElo: candidate.homeElo,
    awayElo: candidate.awayElo,
    homeForm,
    awayForm,
    homeExtended,
    awayExtended,
    homeInjuries: emptyInjuries,
    awayInjuries: emptyInjuries,
    homeAdvanced,
    awayAdvanced,
    homeLineup: null,
    awayLineup: null,
    weather: null,
    marketFavorite: event.marketFavorite,
    marketSpread: event.spread,
    marketOverUnder: event.overUnder,
    gameDate: event.date,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // Set env defaults to prevent validation errors
  process.env.DATABASE_URL ||= "postgresql://mock:mock@localhost:5432/mock";
  process.env.BETTER_AUTH_SECRET ||= "standalone-backtest-secret-at-least-32-characters-long";
  process.env.USE_NEW_PREDICTION_ENGINE ||= "true";

  const args = parseArgs(process.argv.slice(2));
  const sports = args.sports.filter((s) => ESPN_PATHS[s]);

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  CLUTCH PICKS — STANDALONE ENGINE BACKTEST                   ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Sports: ${sports.join(", ").padEnd(50)}║`);
  console.log(`║  Days: ${String(args.days).padEnd(53)}║`);
  console.log(`║  Max games/sport: ${String(args.maxGamesPerSport).padEnd(42)}║`);
  console.log(`║  Warmup: ${String(args.warmup).padEnd(51)}║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  // Dynamically import the prediction engine (after env is set)
  const { predictGame } = await import("../prediction/index");

  const dates = datesBack(args.days);
  const allRows: ReplayRow[] = [];
  const sportSummaries: SportSummary[] = [];

  for (const sport of sports) {
    console.log(`[${sport}] Fetching completed games from ESPN...`);
    const events = await fetchHistoricalEvents(sport, dates, args.concurrency);
    console.log(`[${sport}] Found ${events.length} completed games`);

    const candidates = buildEvaluationCandidates(events, args.warmup).slice(-args.maxGamesPerSport);
    console.log(`[${sport}] ${candidates.length} games selected after warmup (${args.warmup} games/team)`);

    let correct = 0;
    let total = 0;
    let totalConfidence = 0;
    const rows: ReplayRow[] = [];

    for (const candidate of candidates) {
      try {
        const ctx = await buildRealGameContext(candidate);
        const prediction = predictGame(ctx);
        const predictedPick = prediction.canonicalResult.finalPick;
        const isCorrect = predictedPick === candidate.event.actualPick;
        const confidence = prediction.canonicalResult.confidence;

        // Debug first 2 games
        if (total < 2) {
          console.log(`  [DEBUG] ${candidate.event.awayTeam.abbreviation}@${candidate.event.homeTeam.abbreviation}:`);
          console.log(`    pick=${predictedPick}, conf=${confidence}, prob_home=${prediction.canonicalResult.probabilities.home}`);
          console.log(`    homeElo=${ctx.homeElo}, awayElo=${ctx.awayElo}`);
          console.log(`    homeForm results=${ctx.homeForm.results.length}, wins=${ctx.homeForm.wins}`);
          console.log(`    factors available=${prediction.factors.filter((f:any)=>f.available).length}/${prediction.factors.length}`);
          const signalFactors = prediction.factors.filter((f:any)=>f.available && f.hasSignal);
          const nonRatingSignal = signalFactors.filter((f:any)=>f.key !== 'rating_diff');
          console.log(`    signal factors: ${signalFactors.map((f:any)=>`${f.key}(w=${f.weight.toFixed(3)},d=${f.homeDelta.toFixed(1)})`).join(', ')}`);
          console.log(`    nonRatingSignalWeight=${nonRatingSignal.reduce((s:number,f:any)=>s+f.weight,0).toFixed(3)}`);
          console.log(`    all factors: ${prediction.factors.map((f:any)=>`${f.key}[${f.available?'Y':'N'}/${f.hasSignal?'S':'-'}](w=${f.weight.toFixed(3)})`).join(', ')}`);
          console.log(`    warnings=${prediction.canonicalResult.warnings?.join('; ')}`);
        }

        if (isCorrect) correct++;
        total++;
        totalConfidence += confidence;

        rows.push({
          gameId: candidate.event.id,
          sport,
          date: candidate.event.date,
          matchup: `${candidate.event.awayTeam.abbreviation} @ ${candidate.event.homeTeam.abbreviation}`,
          actualPick: candidate.event.actualPick,
          predictedPick,
          correct: isCorrect,
          confidence,
          actualScore: { home: candidate.event.homeScore, away: candidate.event.awayScore },
          projectedScore: prediction.canonicalResult.projectedScore,
        });
      } catch (err) {
        // Log ALL errors for debugging
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 3).join('\n') : '';
        console.warn(`  [ERROR] ${candidate.event.id}: ${msg.slice(0, 120)}`);
        if (total === 0 && candidates.indexOf(candidate) < 3) {
          console.warn(`  [STACK] ${stack}`);
        }
      }
    }

    const accuracy = total > 0 ? round((correct / total) * 100, 1) : null;
    const avgConf = total > 0 ? round(totalConfidence / total, 1) : null;
    sportSummaries.push({ sport, scoredGames: total, correct, accuracy, avgConfidence: avgConf });
    allRows.push(...rows);

    console.log(`[${sport}] ✓ ${total} scored | ${correct} correct | ${accuracy}% accuracy | avg conf ${avgConf}%\n`);
  }

  // Overall
  const totalGames = allRows.length;
  const totalCorrect = allRows.filter((r) => r.correct).length;
  const overallAccuracy = totalGames > 0 ? round((totalCorrect / totalGames) * 100, 1) : null;
  const overallAvgConf = totalGames > 0 ? round(allRows.reduce((s, r) => s + r.confidence, 0) / totalGames, 1) : null;

  // Calibration
  const buckets = [
    { label: "50-54%", min: 50, max: 54 },
    { label: "55-59%", min: 55, max: 59 },
    { label: "60-64%", min: 60, max: 64 },
    { label: "65-69%", min: 65, max: 69 },
    { label: "70-74%", min: 70, max: 74 },
    { label: "75-79%", min: 75, max: 79 },
    { label: "80%+", min: 80, max: 100 },
  ].map((b) => {
    const inBucket = allRows.filter((r) => r.confidence >= b.min && r.confidence <= b.max);
    const bucketCorrect = inBucket.filter((r) => r.correct).length;
    return {
      ...b,
      total: inBucket.length,
      correct: bucketCorrect,
      accuracy: inBucket.length > 0 ? round((bucketCorrect / inBucket.length) * 100, 1) : null,
    };
  });

  // High confidence misses
  const highConfMisses = allRows
    .filter((r) => !r.correct && r.confidence >= 65)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);

  // Print results
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  RESULTS                                                     ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Overall: ${totalCorrect}/${totalGames} = ${overallAccuracy}% accuracy (avg conf: ${overallAvgConf}%)`.padEnd(63) + `║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  for (const s of sportSummaries) {
    console.log(`║  ${s.sport.padEnd(8)} ${String(s.correct).padStart(3)}/${String(s.scoredGames).padStart(3)} = ${String(s.accuracy ?? "N/A").padStart(5)}% (conf: ${String(s.avgConfidence ?? "N/A").padStart(5)}%)`.padEnd(63) + `║`);
  }
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  CALIBRATION                                                 ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  for (const b of buckets) {
    if (b.total > 0) {
      console.log(`║  ${b.label.padEnd(8)} ${String(b.correct).padStart(3)}/${String(b.total).padStart(3)} = ${String(b.accuracy).padStart(5)}% actual`.padEnd(63) + `║`);
    }
  }
  if (highConfMisses.length > 0) {
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    console.log(`║  HIGH-CONFIDENCE MISSES (≥65%)                               ║`);
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    for (const miss of highConfMisses) {
      console.log(`║  ${miss.matchup.padEnd(12)} ${miss.sport.padEnd(5)} conf:${String(miss.confidence).padStart(4)}% picked:${miss.predictedPick} actual:${miss.actualPick}`.padEnd(63) + `║`);
    }
  }
  console.log(`╚══════════════════════════════════════════════════════════════╝`);

  // Write report
  const report = {
    runAt: new Date().toISOString(),
    mode: "standalone-backtest-no-db",
    engine: "3.0.0-unified-simulation-engine",
    sportsRequested: sports,
    daysScanned: args.days,
    warmupGamesPerTeam: args.warmup,
    maxGamesPerSport: args.maxGamesPerSport,
    totalGamesScored: totalGames,
    overall: { scoredGames: totalGames, correct: totalCorrect, accuracy: overallAccuracy, avgConfidence: overallAvgConf },
    perSport: sportSummaries,
    calibration: buckets,
    highConfidenceMisses: highConfMisses,
    dataQualityNote: "Standalone backtest: uses ESPN scoreboards + chronological Elo replay. " +
      "Context is MINIMAL (no injuries, no form, no lineups from DB). " +
      "This tests the engine's structural accuracy with Elo + market data only. " +
      "Production accuracy will be HIGHER because it has full context.",
  };

  const outDir = join(import.meta.dir, "../../backtest-results");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "standalone-backtest-latest.json");
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
