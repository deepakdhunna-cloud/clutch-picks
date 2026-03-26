/**
 * Elo Power Ratings
 * Stores and updates team Elo ratings in the database.
 * Uses sport-specific K-factors and home advantage bonuses.
 */

import { prisma } from "../prisma";
import { enqueueWrite } from "./writeQueue";

export const DEFAULT_RATING = 1500;

// In-memory read cache: key = "{sport}-{teamId}"
const eloCache = new Map<string, number>();

// Sport-specific K-factors (how much each game moves the rating)
const K_FACTORS: Record<string, number> = {
  NBA:   20,
  NFL:   32,
  NCAAF: 30,
  NCAAB: 22,
  MLB:   8,
  NHL:   12,
  MLS:   25,
  EPL:   25,
};

// Home advantage bonuses (added to home team's effective rating)
const HOME_BONUSES: Record<string, number> = {
  NBA:   100,
  NCAAB: 120,
  NFL:   48,
  NCAAF: 55,
  MLB:   24,
  NHL:   33,
  MLS:   60,
  EPL:   60,
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
};

/**
 * Margin-of-victory multiplier for the K-factor.
 * log(|margin| + 1) * 0.8, capped per sport so blowouts in high-scoring
 * sports don't inflate ratings unreasonably.
 * Returns 1.0 (no adjustment) when margin is unknown or a draw.
 */
function movMultiplier(margin: number | undefined, sport: string): number {
  if (margin === undefined || margin === 0) return 1.0;
  const raw = Math.log(Math.abs(margin) + 1) * 0.8;
  const cap = MOV_CAPS[sport] ?? 2.0;
  return Math.min(raw, cap);
}

function getK(sport: string): number {
  return K_FACTORS[sport] ?? 20;
}

function getHomeBonus(sport: string): number {
  return HOME_BONUSES[sport] ?? 50;
}

function eloKey(teamId: string, sport: string): string {
  return `${sport}-${teamId}`;
}

/**
 * Get the current Elo rating for a team.
 * Checks in-memory cache first, then database, then returns DEFAULT_RATING.
 */
export async function getEloRating(teamId: string, sport: string): Promise<number> {
  const key = eloKey(teamId, sport);

  const cached = eloCache.get(key);
  if (cached !== undefined) return cached;

  const row = await prisma.eloRating.findUnique({ where: { id: key } });
  if (row) {
    eloCache.set(key, row.rating);
    return row.rating;
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
  // prediction see the new rating without waiting for the DB write.
  eloCache.set(key, rating);
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
function expectedScore(ratingA: number, ratingB: number): number {
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
  }>
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
      const seed = row
        ? row.rating * 0.75 + DEFAULT_RATING * 0.25
        : DEFAULT_RATING;
      ratings.set(id, seed);
    })
  );

  // Sort all games chronologically. Games with no parseable date sort last
  // (treated as most recent) so they don't corrupt early-season ratings.
  const sorted = [...allTeamGames].sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : Infinity;
    const tb = b.date ? new Date(b.date).getTime() : Infinity;
    return ta - tb;
  });

  // Deduplicate: each matchup appears once per team in the input (home team
  // entry + away team entry). We only want to process each physical game once.
  // Use a Set keyed on sorted team-pair + date string.
  const processed = new Set<string>();

  for (const game of sorted) {
    const [a, b] = [game.teamId, game.opponentId].sort();
    const dedupeKey = `${a}|${b}|${game.date}`;
    if (processed.has(dedupeKey)) continue;
    processed.add(dedupeKey);

    const rA = ratings.get(game.teamId)  ?? DEFAULT_RATING;
    const rB = ratings.get(game.opponentId) ?? DEFAULT_RATING;
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
