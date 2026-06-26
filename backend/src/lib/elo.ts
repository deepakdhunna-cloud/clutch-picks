/**
 * Elo Power Ratings
 * Stores and updates team Elo ratings in the database.
 * Uses sport-specific K-factors and home advantage bonuses.
 */

import { prisma } from "../prisma";
import { enqueueWrite } from "./writeQueue";
import { getWorldCupSeedRating, isWorldCup } from "./worldCupSeeds";

/** Optional per-team metadata used to seed strength priors (e.g. World Cup national teams). */
export interface TeamSeedMeta {
  name?: string;
  abbreviation?: string;
}

export const DEFAULT_RATING = 1500;

// In-memory read cache: key = "{sport}-{teamId}".
// Entries carry a fetch timestamp and expire after ELO_CACHE_TTL_MS. This is
// REQUIRED for correctness in production: web and worker run as separate
// processes, so when the daily Elo-refresh cron (worker) writes fresh ratings to
// Postgres, the HTTP serving process must re-read them rather than serve a value
// it cached once at boot. The TTL is shorter than the daily cron interval so a
// refresh always propagates to the serving process within a few hours.
const ELO_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const eloCache = new Map<string, { rating: number; fetchedAt: number }>();
const warnedEloReadFailures = new Set<string>();

// Sport-specific K-factors (how much each game moves the rating)
const K_FACTORS: Record<string, number> = {
  NBA:   20,
  NFL:   32,
  NCAAF: 30,
  NCAAB: 22,
  MLB:   8,
  NHL:   12,
  MLS:   20,
  EPL:   20,
  UCL:  20,
  WORLDCUP: 40,
  IPL:  12,
  TENNIS: 14,
};

// Home advantage bonuses (added to home team's effective rating)
// NBA reduced from 100 to 65 (2026-06-05): post-2020 NBA home advantage has
// declined to ~2.5 points per game (~60-65 Elo). The previous 100 created
// systematic home bias and overconfident home picks. Source: NBA home win%
// 2021-2025 averages ~56-57% (down from 60%+ pre-COVID).
const HOME_BONUSES: Record<string, number> = {
  NBA:   65,
  NCAAB: 120,
  NFL:   48,
  NCAAF: 55,
  MLB:   24,
  NHL:   33,
  MLS:   55,
  EPL:   40,
  UCL:  40,
  // World Cup games are played at neutral venues (no true home team), so the
  // home-field bonus is near-zero. A small 8-pt nudge is kept only for the rare
  // host-nation match; national-team Elo seeding carries the real signal.
  WORLDCUP: 8,
  IPL:  18,
  TENNIS: 0,
};

// Sport-specific caps on the MOV multiplier to prevent over-correction in
// high-scoring sports where large margins are routine.
const MOV_CAPS: Record<string, number> = {
  NBA:   2.0,
  NCAAB: 2.0,
  NFL:   2.5,
  NCAAF: 2.5,
  MLB:   1.8,
  NHL:   1.8,
  MLS:   2.0,
  EPL:   2.0,
  UCL:  2.0,
  WORLDCUP: 2.0,
  IPL:  1.7,
  TENNIS: 1.4,
};

/**
 * Margin-of-victory multiplier for the K-factor.
 * log(|margin| + 1) * 0.8, capped per sport so blowouts in high-scoring
 * sports don't inflate ratings unreasonably.
 * Returns 1.0 (no adjustment) when margin is unknown or a draw.
 */
export function movMultiplier(margin: number | undefined, sport: string): number {
  if (margin === undefined || margin === 0) {
    // Soccer draws: reduced K so draws don't swing ratings as much
    return (sport === "MLS" || sport === "EPL" || sport === "UCL" || sport === "WORLDCUP") ? 0.5 : 1.0;
  }
  // Soccer-specific: gentle scaling because a 3-0 is a blowout but only 3 goals
  if (sport === "MLS" || sport === "EPL" || sport === "UCL" || sport === "WORLDCUP") {
    const m = Math.abs(margin);
    if (m === 1) return 1.0;
    if (m === 2) return 1.2;
    return 1.4; // 3+ goals
  }
  const raw = Math.log(Math.abs(margin) + 1) * 0.8;
  const cap = MOV_CAPS[sport] ?? 2.0;
  return Math.min(raw, cap);
}

export function getK(sport: string): number {
  return K_FACTORS[sport] ?? 20;
}

export function getHomeBonus(sport: string): number {
  return HOME_BONUSES[sport] ?? 50;
}

function eloKey(teamId: string, sport: string): string {
  return `${sport}-${teamId}`;
}

function shortErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const lines = err.message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => line.startsWith("Can't ") || line.includes("Environment variable"))
    ?? lines.find((line) => !line.startsWith("Invalid `prisma.") && !line.startsWith("/"))
    ?? err.name;
}

/**
 * Get the current Elo rating for a team.
 * Checks in-memory cache first, then database, then returns DEFAULT_RATING.
 */
export async function getEloRating(
  teamId: string,
  sport: string,
  // Optional team identity used only to derive a strength seed when no stored
  // rating exists yet. Required for the World Cup, where ESPN provides too few
  // completed games to build Elo, so an unseeded team would otherwise sit at a
  // flat 1500 and make every match a 50/50 toss-up.
  seedMeta?: TeamSeedMeta,
): Promise<number> {
  const key = eloKey(teamId, sport);

  const cached = eloCache.get(key);
  if (cached !== undefined && Date.now() - cached.fetchedAt < ELO_CACHE_TTL_MS) {
    return cached.rating;
  }

  try {
    const row = await prisma.eloRating.findUnique({ where: { id: key } });
    if (row) {
      eloCache.set(key, { rating: row.rating, fetchedAt: Date.now() });
      return row.rating;
    }
  } catch (err) {
    const warnKey = `${sport}:read`;
    if (!warnedEloReadFailures.has(warnKey)) {
      warnedEloReadFailures.add(warnKey);
      console.warn(
        `[elo] DB read failed for ${sport}; using default rating ${DEFAULT_RATING}`,
        shortErrorMessage(err),
      );
    }
  }

  // No stored rating: for the World Cup, fall back to the national-team strength
  // seed so favorites/underdogs differentiate immediately. All other sports use
  // the neutral default.
  if (isWorldCup(sport)) {
    return getWorldCupSeedRating(seedMeta?.name, seedMeta?.abbreviation);
  }
  return DEFAULT_RATING;
}

/**
 * Persist a team's Elo rating to the database and update the in-memory cache.
 * The cache is updated synchronously; the DB write is enqueued asynchronously
 * so it never blocks callers (and never causes concurrent SQLite write contention).
 */
export function setEloRating(teamId: string, sport: string, rating: number): void {
  const key = eloKey(teamId, sport);
  // Update in-memory cache immediately so subsequent reads within the same
  // prediction (and process) see the new rating without waiting for the DB write.
  eloCache.set(key, { rating, fetchedAt: Date.now() });
  enqueueWrite(async () => {
    await prisma.eloRating.upsert({
      where: { id: key },
      create: { id: key, teamId, sport, rating, lastUpdated: new Date() },
      update: { rating, lastUpdated: new Date() },
    });
  });
}

/**
 * Standard Elo expected score formula.
 * expectedA = 1 / (1 + 10^((ratingB - ratingA) / 400))
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Update both teams' Elo ratings after a completed game.
 * Pass `margin` (winner score - loser score) to apply MOV adjustment.
 */
export async function updateEloAfterGame(
  winnerTeamId: string,
  loserTeamId: string,
  sport: string,
  isDraw = false,
  margin?: number
): Promise<void> {
  const [winnerRating, loserRating] = await Promise.all([
    getEloRating(winnerTeamId, sport),
    getEloRating(loserTeamId, sport),
  ]);

  const K = getK(sport) * movMultiplier(isDraw ? 0 : margin, sport);

  const expectedWinner = expectedScore(winnerRating, loserRating);
  const expectedLoser = expectedScore(loserRating, winnerRating);

  const actualWinner = isDraw ? 0.5 : 1;
  const actualLoser = isDraw ? 0.5 : 0;

  const newWinnerRating = winnerRating + K * (actualWinner - expectedWinner);
  const newLoserRating = loserRating + K * (actualLoser - expectedLoser);

  setEloRating(winnerTeamId, sport, newWinnerRating);
  setEloRating(loserTeamId, sport, newLoserRating);
}

/**
 * Calculate win probabilities using Elo ratings with home advantage applied.
 * Returns probabilities that sum to 1.0.
 */
export function getEloPrediction(
  homeRating: number,
  awayRating: number,
  sport: string
): { homeWinProb: number; awayWinProb: number } {
  const bonus = getHomeBonus(sport);
  const adjustedHome = homeRating + bonus;

  const homeWinProb = expectedScore(adjustedHome, awayRating);
  const awayWinProb = 1 - homeWinProb;

  return { homeWinProb, awayWinProb };
}

/**
 * Initialize Elo ratings for a set of teams by replaying ALL their completed
 * games in strict chronological order using a fully in-memory ratings map.
 *
 * This eliminates two bugs from the old per-team approach:
 *   1. Opponent ratings were read from the DB (current/future values, not
 *      historical values at game time).
 *   2. setEloRating() called mid-loop mutated the DB so later iterations
 *      picked up ratings that included the current replay's own effects,
 *      making results non-deterministic and order-dependent.
 *
 * Algorithm:
 *   - All teams start at DEFAULT_RATING (or regressed prior if a stored
 *     rating already exists: 75% prior + 25% default).
 *   - Every game is processed exactly once in ascending date order.
 *   - Ratings for both teams are read from and written to the in-memory map.
 *   - After all games are processed the final ratings are flushed to the DB
 *     in a single batch upsert.
 *   - The 24-hour freshness guard is evaluated before any ESPN fetching
 *     happens (upstream in predictions.ts), so it is not re-checked here.
 */
export async function initializeEloFromSchedule(
  sport: string,
  allTeamGames: Array<{
    teamId: string;
    opponentId: string;
    won: boolean;
    isDraw?: boolean;
    date: string;
    margin?: number;  // winner score - loser score; undefined = no MOV adjustment
  }>,
  // Optional map of teamId -> {name, abbreviation}. Used for sports (World Cup)
  // where ESPN exposes too little game history to build meaningful Elo, so each
  // team must start from a strength-based seed prior instead of flat 1500.
  teamMeta?: Map<string, TeamSeedMeta>
): Promise<Map<string, number>> {
  // Collect every unique team id appearing in the game list
  const teamIds = new Set<string>();
  for (const g of allTeamGames) {
    teamIds.add(g.teamId);
    teamIds.add(g.opponentId);
  }

  // Seed the in-memory map: apply preseason regression for teams that already
  // have a stored rating, otherwise start at DEFAULT_RATING.
  const ratings = new Map<string, number>();
  await Promise.all(
    Array.from(teamIds).map(async (id) => {
      const key = eloKey(id, sport);
      const row = await prisma.eloRating.findUnique({ where: { id: key } });
      // Base prior: stored rating regressed toward the mean, else the sport's
      // default. For the World Cup, the "default" is a national-team strength
      // seed (not 1500) so favorites/underdogs differentiate even when ESPN
      // returns almost no completed games to replay.
      const meta = teamMeta?.get(id);
      const basePrior = isWorldCup(sport)
        ? getWorldCupSeedRating(meta?.name, meta?.abbreviation)
        : DEFAULT_RATING;
      const seed = row
        ? row.rating * 0.75 + basePrior * 0.25
        : basePrior;
      ratings.set(id, seed);
    })
  );

  // Filter out undated games BEFORE sorting/dedup. Undated entries cannot be
  // reliably deduplicated — each physical game appears twice in the input
  // (once per team perspective) and without a date or game ID, all undated
  // games between the same pair collapse to one dedupe key, silently dropping
  // data. The previous "treat as most recent" approach was dishonest because
  // the dedupe collision wiped out everything but the first.
  const datedGames = allTeamGames.filter(g => {
    if (!g.date) return false;
    const t = new Date(g.date).getTime();
    return Number.isFinite(t);
  });
  const undatedCount = allTeamGames.length - datedGames.length;
  if (undatedCount > 0) {
    console.warn(`[elo] ${sport}: skipped ${undatedCount} undated game(s) during replay (data quality issue upstream)`);
  }

  // Sort all dated games chronologically.
  const sorted = [...datedGames].sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  // Deduplicate: each matchup appears once per team in the input (home team
  // entry + away team entry). We only want to process each physical game once.
  // Use a Set keyed on sorted team-pair + date string. Date is now guaranteed
  // to exist because undated games were filtered out above.
  const processed = new Set<string>();

  for (const game of sorted) {
    const [a, b] = [game.teamId, game.opponentId].sort();
    const dedupeKey = `${a}|${b}|${game.date}`;
    if (processed.has(dedupeKey)) continue;
    processed.add(dedupeKey);

    const rA = ratings.get(game.teamId)  ?? (isWorldCup(sport) ? getWorldCupSeedRating(teamMeta?.get(game.teamId)?.name, teamMeta?.get(game.teamId)?.abbreviation) : DEFAULT_RATING);
    const rB = ratings.get(game.opponentId) ?? (isWorldCup(sport) ? getWorldCupSeedRating(teamMeta?.get(game.opponentId)?.name, teamMeta?.get(game.opponentId)?.abbreviation) : DEFAULT_RATING);
    const isDraw = game.isDraw ?? false;
    const K  = getK(sport) * movMultiplier(isDraw ? 0 : game.margin, sport);

    const expectedA = expectedScore(rA, rB);
    const expectedB = expectedScore(rB, rA);
    const actualA   = isDraw ? 0.5 : game.won ? 1 : 0;
    const actualB   = isDraw ? 0.5 : game.won ? 0 : 1;

    ratings.set(game.teamId,    rA + K * (actualA - expectedA));
    ratings.set(game.opponentId, rB + K * (actualB - expectedB));
  }

  // Flush all final ratings: update read cache immediately, enqueue DB writes.
  for (const [id, rating] of ratings.entries()) {
    setEloRating(id, sport, rating);
  }

  return ratings;
}

/**
 * Returns the raw Elo margin (home rating + home bonus - away rating).
 * Useful for estimating the predicted point spread.
 */
export function getEloMargin(homeRating: number, awayRating: number, sport: string): number {
  return homeRating + getHomeBonus(sport) - awayRating;
}
