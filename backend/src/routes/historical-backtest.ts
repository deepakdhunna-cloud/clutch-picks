import { Hono } from "hono";
import { DEFAULT_RATING, expectedScore, getK, getHomeBonus, movMultiplier } from "../lib/elo";

export const historicalBacktestRouter = new Hono();

const ESPN_PATHS: Record<string, string> = {
  NBA:   "basketball/nba",
  NFL:   "football/nfl",
  MLB:   "baseball/mlb",
  NHL:   "hockey/nhl",
  NCAAB: "basketball/mens-college-basketball",
  NCAAF: "football/college-football",
  MLS:   "soccer/usa.1",
  EPL:   "soccer/eng.1",
};

interface HistoricalGame {
  gameId: string;
  date: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  homeWon: boolean;
  isDraw: boolean;
}

async function fetchScoreboardForDate(sport: string, dateYYYYMMDD: string): Promise<HistoricalGame[]> {
  const path = ESPN_PATHS[sport];
  if (!path) return [];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dateYYYYMMDD}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const events: any[] = data?.events ?? [];
    const out: HistoricalGame[] = [];
    for (const event of events) {
      const comp = event?.competitions?.[0];
      if (!comp) continue;
      const isCompleted = comp.status?.type?.completed === true || comp.status?.type?.state?.toLowerCase() === "post";
      if (!isCompleted) continue;
      const competitors: any[] = comp.competitors ?? [];
      const home = competitors.find((c: any) => c.homeAway === "home");
      const away = competitors.find((c: any) => c.homeAway === "away");
      if (!home || !away) continue;
      const homeScore = parseInt(home.score, 10);
      const awayScore = parseInt(away.score, 10);
      if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) continue;
      out.push({
        gameId: String(event.id),
        date: comp.date ?? event.date ?? "",
        homeId: String(home.team?.id ?? ""),
        awayId: String(away.team?.id ?? ""),
        homeScore,
        awayScore,
        homeWon: homeScore > awayScore,
        isDraw: homeScore === awayScore,
      });
    }
    return out;
  } catch {
    return [];
  }
}

historicalBacktestRouter.get("/", async (c) => {
  const sport = (c.req.query("sport") ?? "NBA").toUpperCase();
  const days = Math.min(Math.max(parseInt(c.req.query("days") ?? "45", 10), 7), 120);

  if (!ESPN_PATHS[sport]) {
    return c.json({ error: { message: `Unsupported sport: ${sport}. Valid: ${Object.keys(ESPN_PATHS).join(", ")}`, code: "BAD_SPORT" } }, 400);
  }

  // Build date strings YYYYMMDD for the last N days, oldest first
  const dates: string[] = [];
  const now = new Date();
  for (let i = days; i >= 1; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }

  // Parallel fetch all dates (chunked to avoid hammering ESPN)
  const CHUNK_SIZE = 10;
  const allGames: HistoricalGame[] = [];
  for (let i = 0; i < dates.length; i += CHUNK_SIZE) {
    const chunk = dates.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(chunk.map((d) => fetchScoreboardForDate(sport, d)));
    for (const r of results) allGames.push(...r);
  }

  // Dedupe by gameId
  const seen = new Set<string>();
  const unique: HistoricalGame[] = [];
  for (const g of allGames) {
    if (seen.has(g.gameId)) continue;
    seen.add(g.gameId);
    unique.push(g);
  }

  // Sort chronologically
  unique.sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    return ta - tb;
  });

  // Replay loop: predict-then-update
  const ratings = new Map<string, number>();
  const teamGameCount = new Map<string, number>();
  const WARMUP_GAMES_PER_TEAM = 5;

  const K = getK(sport);
  const homeBonus = getHomeBonus(sport);

  type Bucket = { label: string; min: number; max: number; total: number; correct: number };
  const buckets: Bucket[] = [
    { label: "50-54", min: 50, max: 54, total: 0, correct: 0 },
    { label: "55-59", min: 55, max: 59, total: 0, correct: 0 },
    { label: "60-64", min: 60, max: 64, total: 0, correct: 0 },
    { label: "65-69", min: 65, max: 69, total: 0, correct: 0 },
    { label: "70-74", min: 70, max: 74, total: 0, correct: 0 },
    { label: "75-79", min: 75, max: 79, total: 0, correct: 0 },
    { label: "80-100", min: 80, max: 100, total: 0, correct: 0 },
  ];

  let totalPredicted = 0;
  let totalCorrect = 0;
  let homeWinsActual = 0;

  for (const game of unique) {
    const rH = ratings.get(game.homeId) ?? DEFAULT_RATING;
    const rA = ratings.get(game.awayId) ?? DEFAULT_RATING;
    const homeCount = teamGameCount.get(game.homeId) ?? 0;
    const awayCount = teamGameCount.get(game.awayId) ?? 0;

    // Only count predictions once both teams have past warmup.
    // Draws are counted as predictions BUT are always "incorrect" for a binary
    // predictor — this honestly reflects the engine's ceiling in draw-heavy sports.
    if (homeCount >= WARMUP_GAMES_PER_TEAM && awayCount >= WARMUP_GAMES_PER_TEAM) {
      const homeWinProb = expectedScore(rH + homeBonus, rA);
      const predictedHomeWin = homeWinProb > 0.5;
      const winnerProb = predictedHomeWin ? homeWinProb : 1 - homeWinProb;
      const confidence = Math.round(winnerProb * 100);

      // A draw is always wrong for a binary home/away predictor
      const correct = game.isDraw ? false : predictedHomeWin === game.homeWon;

      totalPredicted++;
      if (correct) totalCorrect++;
      if (game.homeWon) homeWinsActual++;

      const clampedConf = Math.max(50, Math.min(100, confidence));
      const bucket = buckets.find((b) => clampedConf >= b.min && clampedConf <= b.max);
      if (bucket) {
        bucket.total++;
        if (correct) bucket.correct++;
      }
    }

    // Update Elo with the actual outcome (whether or not we counted the prediction).
    // Draws get actualScore = 0.5 for both sides (standard Elo draw handling).
    const margin = Math.abs(game.homeScore - game.awayScore);
    const k = K * movMultiplier(game.isDraw ? 0 : margin, sport);
    const expectedH = expectedScore(rH + homeBonus, rA);
    const expectedA = 1 - expectedH;
    const actualH = game.isDraw ? 0.5 : game.homeWon ? 1 : 0;
    const actualA = game.isDraw ? 0.5 : game.homeWon ? 0 : 1;
    ratings.set(game.homeId, rH + k * (actualH - expectedH));
    ratings.set(game.awayId, rA + k * (actualA - expectedA));

    teamGameCount.set(game.homeId, homeCount + 1);
    teamGameCount.set(game.awayId, awayCount + 1);
  }

  // Compute calibration error per bucket
  const bucketsOut = buckets.map((b) => {
    const accuracy = b.total > 0 ? Math.round((b.correct / b.total) * 1000) / 10 : null;
    const midpoint = Math.round((b.min + b.max) / 2);
    const calError = accuracy !== null ? Math.round(Math.abs(accuracy - midpoint) * 10) / 10 : null;
    return { label: b.label, total: b.total, correct: b.correct, accuracy, midpoint, calibrationError: calError };
  });

  return c.json({
    data: {
      sport,
      daysScanned: days,
      totalGamesScraped: unique.length,
      totalPredicted,
      totalCorrect,
      accuracy: totalPredicted > 0 ? Math.round((totalCorrect / totalPredicted) * 1000) / 10 : null,
      homeWinRate: totalPredicted > 0 ? Math.round((homeWinsActual / totalPredicted) * 1000) / 10 : null,
      buckets: bucketsOut,
      note: "Elo-only baseline. Reflects ~60-70% of production engine signal. Does NOT include injuries, rest days, starting pitchers, or advanced metrics — those require point-in-time data ESPN does not expose historically. Use this as a floor: the live engine should beat these numbers because it has more inputs.",
      drawsNote: "Draws count as incorrect predictions for binary home/away models. In soccer leagues where ~25% of games draw, the theoretical accuracy ceiling is ~75%. Draws are included in Elo updates with actual score 0.5.",
    },
  });
});
