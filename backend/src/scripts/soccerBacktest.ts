/**
 * Soccer-specific backtest — evaluates the NEW prediction engine on soccer
 * with PROPER 3-way (home/draw/away) metrics, designed to assess World Cup
 * readiness.
 *
 * Reuses the ESPN public-API fetch + chronological Elo replay approach from
 * standaloneBacktest.ts (no database required), but adds soccer-aware metrics:
 *   - 3-way accuracy (home/draw/away — the real market)
 *   - Side-only accuracy (exclude actual draws; how well it picks the winner)
 *   - Draw recall & precision (does the engine ever call draws, and are they right?)
 *   - Confusion matrix (predicted vs actual)
 *   - Calibration buckets
 *   - Brier score (probabilistic accuracy across all 3 outcomes)
 *   - Market baseline comparison (Elo-only + home-field pick)
 *
 * Usage:
 *   bun run src/scripts/soccerBacktest.ts --leagues EPL,MLS,UCL,LALIGA,SERIEA,BUNDESLIGA,LIGUE1 --days 150 --max-games-per-league 200 --warmup 3
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

// ─── Types ─────────────────────────────────────────────────────────────────

type TeamInfo = {
  id: string;
  name: string;
  abbreviation: string;
  logo: string;
  record: string;
};

type Outcome = "home" | "draw" | "away";

type HistoricalEvent = {
  id: string;
  league: string;
  date: string;
  venue: string;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  homeScore: number;
  awayScore: number;
  actual: Outcome;
  marketFavorite?: "home" | "away";
  spread?: number;
  overUnder?: number;
};

type Candidate = {
  event: HistoricalEvent;
  homeElo: number;
  awayElo: number;
};

type Row = {
  gameId: string;
  league: string;
  date: string;
  matchup: string;
  actual: Outcome;
  predicted: Outcome;
  correct: boolean;
  confidence: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  actualScore: { home: number; away: number };
  projectedScore?: { home: number; away: number; spread: number; total: number };
  eloPick: Outcome;
};

// ─── ESPN league paths (all map to engine sport "EPL"-style 3-way soccer) ────
// The engine treats every soccer league through the SOCCER_LEAGUES set. We map
// each ESPN competition to an engine sport key that the engine recognizes as
// three-way soccer. EPL/MLS/UCL are first-class; others fall back to "EPL"
// behavior (generic soccer) which is what the World Cup will use too.

const LEAGUES: Record<string, { espn: string; engineSport: string; homeBonus: number; k: number }> = {
  EPL: { espn: "soccer/eng.1", engineSport: "EPL", homeBonus: 62, k: 30 },
  MLS: { espn: "soccer/usa.1", engineSport: "MLS", homeBonus: 68, k: 30 },
  UCL: { espn: "soccer/uefa.champions", engineSport: "UCL", homeBonus: 55, k: 35 },
  LALIGA: { espn: "soccer/esp.1", engineSport: "EPL", homeBonus: 60, k: 30 },
  SERIEA: { espn: "soccer/ita.1", engineSport: "EPL", homeBonus: 60, k: 30 },
  BUNDESLIGA: { espn: "soccer/ger.1", engineSport: "EPL", homeBonus: 60, k: 30 },
  LIGUE1: { espn: "soccer/fra.1", engineSport: "EPL", homeBonus: 60, k: 30 },
  // International — closest proxy to the World Cup context
  WORLDCUP: { espn: "soccer/fifa.world", engineSport: "EPL", homeBonus: 30, k: 40 },
  EURO: { espn: "soccer/uefa.euro", engineSport: "EPL", homeBonus: 35, k: 40 },
  COPA: { espn: "soccer/conmebol.america", engineSport: "EPL", homeBonus: 35, k: 40 },
};

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ClutchPicksSoccerBacktest/1.0)",
  Accept: "application/json",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

  const leaguesRaw = getValue("--leagues") ?? "EPL,MLS,UCL,LALIGA,SERIEA,BUNDESLIGA,LIGUE1";
  const requested = leaguesRaw.toUpperCase() === "ALL"
    ? Object.keys(LEAGUES)
    : leaguesRaw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => LEAGUES[s]);

  return {
    leagues: requested,
    days: clampInt(Number(getValue("--days") ?? 150), 1, 365),
    warmup: clampInt(Number(getValue("--warmup") ?? 3), 0, 30),
    maxGamesPerLeague: clampInt(Number(getValue("--max-games-per-league") ?? 200), 1, 1000),
    concurrency: clampInt(Number(getValue("--concurrency") ?? 4), 1, 8),
  };
}

// ─── ESPN fetch ──────────────────────────────────────────────────────────────

function scoreboardUrl(espnPath: string, date: string): string {
  return `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${date}`;
}

function parseScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordSummary(competitor: any): string {
  const record = (competitor?.records ?? []).find(
    (row: any) => row?.type === "total" || row?.type === "overall" || row?.name === "overall",
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

function eventFromEspn(league: string, event: any): HistoricalEvent | null {
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

  let actual: Outcome;
  if (homeScore > awayScore) actual = "home";
  else if (awayScore > homeScore) actual = "away";
  else actual = "draw";

  const odds = oddsFromCompetition(competition);
  return {
    id: String(event.id ?? competition.id),
    league,
    date: String(competition.date ?? event.date ?? ""),
    venue: String(competition.venue?.fullName ?? event.venue?.fullName ?? "Unknown"),
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    actual,
    ...odds,
  };
}

async function fetchScoreboardForDate(league: string, espnPath: string, date: string): Promise<HistoricalEvent[]> {
  try {
    const response = await fetch(scoreboardUrl(espnPath, date), {
      signal: AbortSignal.timeout(15_000),
      headers: FETCH_HEADERS,
    });
    if (!response.ok) return [];
    const data = (await response.json()) as any;
    return (data?.events ?? [])
      .map((event: any) => eventFromEspn(league, event))
      .filter((e: HistoricalEvent | null): e is HistoricalEvent => e !== null);
  } catch {
    return [];
  }
}

async function fetchEvents(league: string, espnPath: string, dates: string[], concurrency: number): Promise<HistoricalEvent[]> {
  const results: HistoricalEvent[] = [];
  for (let i = 0; i < dates.length; i += concurrency) {
    const batch = dates.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((d) => fetchScoreboardForDate(league, espnPath, d)));
    for (const events of batchResults) results.push(...events);
    if (i + concurrency < dates.length) await new Promise((r) => setTimeout(r, 150));
  }
  const deduped = new Map<string, HistoricalEvent>();
  for (const event of results) deduped.set(event.id, event);
  return Array.from(deduped.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── Elo replay ────────────────────────────────────────────────────────────

const DEFAULT_RATING = 1500;

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function movMultiplier(margin: number): number {
  if (!margin) return 1;
  return Math.min(1.5, 1 + Math.log(1 + margin / 2) * 0.4);
}

function buildCandidates(events: HistoricalEvent[], warmup: number, homeBonus: number, k: number): Candidate[] {
  const ratings = new Map<string, number>();
  const counts = new Map<string, number>();
  const candidates: Candidate[] = [];

  for (const event of events) {
    const homeRating = ratings.get(event.homeTeam.id) ?? DEFAULT_RATING;
    const awayRating = ratings.get(event.awayTeam.id) ?? DEFAULT_RATING;
    const homeCount = counts.get(event.homeTeam.id) ?? 0;
    const awayCount = counts.get(event.awayTeam.id) ?? 0;

    if (homeCount >= warmup && awayCount >= warmup) {
      candidates.push({ event, homeElo: homeRating, awayElo: awayRating });
    }

    const expected = expectedScore(homeRating + homeBonus, awayRating);
    const actual = event.actual === "draw" ? 0.5 : event.actual === "home" ? 1 : 0;
    const margin = event.actual === "draw" ? 0 : Math.abs(event.homeScore - event.awayScore);
    const kEff = k * movMultiplier(margin);
    ratings.set(event.homeTeam.id, homeRating + kEff * (actual - expected));
    ratings.set(event.awayTeam.id, awayRating + kEff * ((1 - actual) - (1 - expected)));
    counts.set(event.homeTeam.id, homeCount + 1);
    counts.set(event.awayTeam.id, awayCount + 1);
  }

  return candidates;
}

// ─── Context builder (real ESPN form data) ───────────────────────────────────

const emptyInjuries = {
  out: [] as any[],
  doubtful: [] as any[],
  questionable: [] as any[],
  totalOut: 0,
  totalDoubtful: 0,
  totalQuestionable: 0,
};

async function buildContext(
  candidate: Candidate,
  engineSport: string,
  stats: {
    fetchTeamRecentForm: any;
    fetchTeamExtendedStats: any;
    fetchAdvancedMetrics: any;
  },
): Promise<any> {
  const event = candidate.event;
  const gameDate = new Date(event.date);

  const [homeForm, awayForm, homeExtended, awayExtended, homeAdvanced, awayAdvanced] = await Promise.all([
    stats.fetchTeamRecentForm(event.homeTeam.id, engineSport, 10, gameDate).catch(() => ({
      results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0,
    })),
    stats.fetchTeamRecentForm(event.awayTeam.id, engineSport, 10, gameDate).catch(() => ({
      results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0,
    })),
    stats.fetchTeamExtendedStats(event.homeTeam.id, engineSport).catch(() => ({
      homeRecord: "0-0", awayRecord: "0-0", scoringTrend: 0, defenseTrend: 0,
      atsRecord: "0-0", overUnderRecord: "0-0", strengthOfSchedule: 0.5,
    })),
    stats.fetchTeamExtendedStats(event.awayTeam.id, engineSport).catch(() => ({
      homeRecord: "0-0", awayRecord: "0-0", scoringTrend: 0, defenseTrend: 0,
      atsRecord: "0-0", overUnderRecord: "0-0", strengthOfSchedule: 0.5,
    })),
    stats.fetchAdvancedMetrics(event.homeTeam.id, engineSport).catch(() => ({})),
    stats.fetchAdvancedMetrics(event.awayTeam.id, engineSport).catch(() => ({})),
  ]);

  return {
    game: {
      id: event.id,
      sport: engineSport,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      gameTime: event.date,
      venue: event.venue,
      spread: event.spread,
      overUnder: event.overUnder,
      marketFavorite: event.marketFavorite,
    },
    sport: engineSport,
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

// ─── Metrics ─────────────────────────────────────────────────────────────────

function pct(num: number, den: number): number | null {
  return den > 0 ? round((num / den) * 100, 1) : null;
}

function summarize(rows: Row[]) {
  const total = rows.length;
  const correct = rows.filter((r) => r.correct).length;

  // Side-only: exclude games that actually ended in a draw AND games where the
  // engine declined to pick a side (predicted draw). This measures "when a side
  // wins and we call a side, how often are we right".
  const decisiveActual = rows.filter((r) => r.actual !== "draw");
  const sideCalled = decisiveActual.filter((r) => r.predicted !== "draw");
  const sideCorrect = sideCalled.filter((r) => r.predicted === r.actual).length;

  // Draw metrics
  const predictedDraws = rows.filter((r) => r.predicted === "draw");
  const actualDraws = rows.filter((r) => r.actual === "draw");
  const drawHits = predictedDraws.filter((r) => r.actual === "draw").length;

  // Confusion matrix [actual][predicted]
  const outcomes: Outcome[] = ["home", "draw", "away"];
  const confusion: Record<string, Record<string, number>> = {};
  for (const a of outcomes) {
    confusion[a] = { home: 0, draw: 0, away: 0 };
    for (const r of rows.filter((row) => row.actual === a)) {
      confusion[a][r.predicted] += 1;
    }
  }

  // Brier score (multiclass): mean over games of sum (p_k - y_k)^2
  let brierSum = 0;
  for (const r of rows) {
    const y = { home: r.actual === "home" ? 1 : 0, draw: r.actual === "draw" ? 1 : 0, away: r.actual === "away" ? 1 : 0 };
    brierSum += (r.pHome - y.home) ** 2 + (r.pDraw - y.draw) ** 2 + (r.pAway - y.away) ** 2;
  }
  const brier = total > 0 ? round(brierSum / total, 4) : null;

  // Elo + home-field baseline accuracy (3-way: baseline never predicts draw)
  const eloCorrect = rows.filter((r) => r.eloPick === r.actual).length;

  return {
    total,
    correct,
    accuracy3way: pct(correct, total),
    sideOnly: { called: sideCalled.length, correct: sideCorrect, accuracy: pct(sideCorrect, sideCalled.length) },
    draws: {
      actualCount: actualDraws.length,
      actualRate: pct(actualDraws.length, total),
      predictedCount: predictedDraws.length,
      drawPrecision: pct(drawHits, predictedDraws.length),
      drawRecall: pct(drawHits, actualDraws.length),
    },
    confusion,
    brier,
    eloBaseline: { correct: eloCorrect, accuracy: pct(eloCorrect, total) },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.env.DATABASE_URL ||= "postgresql://mock:mock@localhost:5432/mock";
  process.env.BETTER_AUTH_SECRET ||= "soccer-backtest-secret-at-least-32-characters-long";
  process.env.USE_NEW_PREDICTION_ENGINE ||= "true";

  const args = parseArgs(process.argv.slice(2));

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  CLUTCH PICKS — SOCCER 3-WAY BACKTEST (World Cup readiness)  ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Leagues: ${args.leagues.join(", ").slice(0, 48).padEnd(49)}║`);
  console.log(`║  Days: ${String(args.days).padEnd(53)}║`);
  console.log(`║  Max games/league: ${String(args.maxGamesPerLeague).padEnd(41)}║`);
  console.log(`║  Warmup: ${String(args.warmup).padEnd(51)}║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  const { predictGame } = await import("../prediction/index");
  const { fetchTeamRecentForm, fetchTeamExtendedStats, fetchAdvancedMetrics } = await import("../lib/espnStats");
  const stats = { fetchTeamRecentForm, fetchTeamExtendedStats, fetchAdvancedMetrics };

  const dates = datesBack(args.days);
  const allRows: Row[] = [];
  const perLeague: Array<{ league: string; metrics: ReturnType<typeof summarize> }> = [];

  for (const league of args.leagues) {
    const cfg = LEAGUES[league];
    console.log(`[${league}] Fetching completed games from ESPN (${cfg.espn})...`);
    const events = await fetchEvents(league, cfg.espn, dates, args.concurrency);
    console.log(`[${league}] Found ${events.length} completed games`);
    if (events.length === 0) continue;

    const candidates = buildCandidates(events, args.warmup, cfg.homeBonus, cfg.k).slice(-args.maxGamesPerLeague);
    console.log(`[${league}] ${candidates.length} games after warmup (${args.warmup}/team)`);

    const rows: Row[] = [];
    for (const candidate of candidates) {
      try {
        const ctx = await buildContext(candidate, cfg.engineSport, stats);
        const prediction = predictGame(ctx);
        const cr = prediction.canonicalResult;
        const probs = cr.probabilities ?? {};
        const pHome = Number(probs.home ?? 0);
        const pAway = Number(probs.away ?? 0);
        const pDraw = Number(probs.draw ?? Math.max(0, 1 - pHome - pAway));

        let predicted: Outcome = cr.finalPick === "draw" ? "draw" : cr.finalPick === "away" ? "away" : "home";
        // If finalPick is "none" (toss-up with no draw market), fall back to top prob
        if (cr.finalPick === "none") {
          predicted = pHome >= pDraw && pHome >= pAway ? "home" : pAway >= pDraw ? "away" : "draw";
        }

        const eloPick: Outcome = candidate.homeElo + cfg.homeBonus >= candidate.awayElo ? "home" : "away";

        rows.push({
          gameId: candidate.event.id,
          league,
          date: candidate.event.date,
          matchup: `${candidate.event.awayTeam.abbreviation} @ ${candidate.event.homeTeam.abbreviation}`,
          actual: candidate.event.actual,
          predicted,
          correct: predicted === candidate.event.actual,
          confidence: cr.confidence,
          pHome: round(pHome, 4),
          pDraw: round(pDraw, 4),
          pAway: round(pAway, 4),
          actualScore: { home: candidate.event.homeScore, away: candidate.event.awayScore },
          projectedScore: cr.projectedScore,
          eloPick,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  [ERROR] ${candidate.event.id}: ${msg.slice(0, 120)}`);
      }
    }

    const metrics = summarize(rows);
    perLeague.push({ league, metrics });
    allRows.push(...rows);
    console.log(
      `[${league}] ✓ ${metrics.total} games | 3-way ${metrics.accuracy3way}% | side-only ${metrics.sideOnly.accuracy}% | ` +
        `draws actual ${metrics.draws.actualRate}% predicted ${metrics.draws.predictedCount} | Brier ${metrics.brier} | Elo-base ${metrics.eloBaseline.accuracy}%\n`,
    );
  }

  const overall = summarize(allRows);

  // Calibration buckets (on the chosen pick's probability = confidence/100)
  const buckets = [
    { label: "33-39%", min: 33, max: 39 },
    { label: "40-44%", min: 40, max: 44 },
    { label: "45-49%", min: 45, max: 49 },
    { label: "50-54%", min: 50, max: 54 },
    { label: "55-59%", min: 55, max: 59 },
    { label: "60-64%", min: 60, max: 64 },
    { label: "65-69%", min: 65, max: 69 },
    { label: "70%+", min: 70, max: 100 },
  ].map((b) => {
    const inB = allRows.filter((r) => r.confidence >= b.min && r.confidence <= b.max);
    const c = inB.filter((r) => r.correct).length;
    return { ...b, total: inB.length, correct: c, accuracy: pct(c, inB.length) };
  });

  // ─── Print ───────────────────────────────────────────────────────────────
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  OVERALL SOCCER RESULTS                                       ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Games scored: ${String(overall.total).padEnd(45)}║`);
  console.log(`║  3-way accuracy (H/D/A): ${String(overall.accuracy3way + "%").padEnd(35)}║`);
  console.log(`║  Side-only accuracy:     ${String(overall.sideOnly.accuracy + "% (" + overall.sideOnly.correct + "/" + overall.sideOnly.called + ")").padEnd(35)}║`);
  console.log(`║  Elo+HFA baseline:       ${String(overall.eloBaseline.accuracy + "%").padEnd(35)}║`);
  console.log(`║  Brier score (lower=better): ${String(overall.brier).padEnd(31)}║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  DRAW HANDLING                                               ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Actual draw rate:   ${String(overall.draws.actualRate + "% (" + overall.draws.actualCount + " games)").padEnd(39)}║`);
  console.log(`║  Engine drew picks:  ${String(overall.draws.predictedCount + " games").padEnd(39)}║`);
  console.log(`║  Draw precision:     ${String(overall.draws.drawPrecision + "%").padEnd(39)}║`);
  console.log(`║  Draw recall:        ${String(overall.draws.drawRecall + "%").padEnd(39)}║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  CONFUSION MATRIX  (rows=actual, cols=predicted)             ║`);
  console.log(`║              pred:home  pred:draw  pred:away                 ║`);
  for (const a of ["home", "draw", "away"] as Outcome[]) {
    const c = overall.confusion[a];
    console.log(`║  act:${a.padEnd(5)}    ${String(c.home).padStart(7)}    ${String(c.draw).padStart(7)}    ${String(c.away).padStart(7)}              ║`);
  }
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  PER-LEAGUE                                                  ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  for (const pl of perLeague) {
    console.log(
      `║  ${pl.league.padEnd(10)} n=${String(pl.metrics.total).padStart(3)} | 3way=${String(pl.metrics.accuracy3way ?? "NA").padStart(5)}% | side=${String(pl.metrics.sideOnly.accuracy ?? "NA").padStart(5)}% | Elo=${String(pl.metrics.eloBaseline.accuracy ?? "NA").padStart(5)}%`.padEnd(63) + `║`,
    );
  }
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  CALIBRATION (pick confidence vs actual win rate)           ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  for (const b of buckets) {
    if (b.total > 0) {
      console.log(`║  ${b.label.padEnd(8)} ${String(b.correct).padStart(3)}/${String(b.total).padStart(3)} = ${String(b.accuracy).padStart(5)}% actual`.padEnd(63) + `║`);
    }
  }
  console.log(`╚══════════════════════════════════════════════════════════════╝`);

  const report = {
    runAt: new Date().toISOString(),
    mode: "soccer-3way-backtest-no-db",
    engine: "unified-simulation-engine",
    leaguesRequested: args.leagues,
    days: args.days,
    warmup: args.warmup,
    overall,
    perLeague,
    calibration: buckets,
    rows: allRows,
    note:
      "Standalone soccer backtest using ESPN scoreboards + chronological Elo replay + real ESPN form data. " +
      "Context excludes injuries/lineups (set empty), so production accuracy with full context will differ. " +
      "International leagues (WORLDCUP/EURO/COPA) are the closest proxies for actual World Cup play.",
  };

  const outDir = join(import.meta.dir, "../../backtest-results");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "soccer-backtest-latest.json");
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
