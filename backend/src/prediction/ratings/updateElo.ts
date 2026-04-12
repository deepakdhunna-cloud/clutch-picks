/**
 * Nightly Elo update job.
 *
 * Pulls completed games since last run from ESPN, applies Elo updates
 * in chronological order, and writes updated ratings to the DB.
 *
 * This wraps the existing initializeEloFromSchedule() which already does
 * full-season replay with proper deduplication and chronological ordering.
 * The nightly job's purpose is to trigger the replay and log results.
 *
 * TODO: Add top-5/bottom-5 logging per league after each run.
 * TODO: Add incremental update mode (only process games since last run)
 *       instead of full-season replay every time.
 */

import { initializeEloFromSchedule, getEloRating } from "../../lib/elo";
import { fetchTeamSeasonResults } from "../../lib/espnStats";

const LEAGUES = ["NFL", "NBA", "MLB", "NHL", "MLS", "EPL", "NCAAF", "NCAAB"] as const;

/**
 * Run a full Elo recalculation for one league.
 * This is the function called by the nightly job scheduler.
 *
 * @param sport - League key
 * @param teamIds - All ESPN team IDs for this league
 * @returns Map of teamId -> final Elo rating
 */
export async function runEloUpdate(
  sport: string,
  teamIds: string[]
): Promise<Map<string, number>> {
  console.log(`[elo-update] Starting ${sport} Elo update for ${teamIds.length} teams...`);
  const startTime = Date.now();

  // Fetch all season results for all teams in parallel
  const allGames: Array<{
    teamId: string;
    opponentId: string;
    won: boolean;
    isDraw?: boolean;
    date: string;
    margin?: number;
  }> = [];

  const results = await Promise.allSettled(
    teamIds.map(async (teamId) => {
      const seasonResults = await fetchTeamSeasonResults(teamId, sport);
      for (const game of seasonResults) {
        allGames.push({
          teamId,
          opponentId: game.opponentId,
          won: game.won,
          isDraw: game.isDraw,
          date: game.date,
          margin:
            game.teamScore !== undefined && game.oppScore !== undefined
              ? Math.abs(game.teamScore - game.oppScore)
              : undefined,
        });
      }
    })
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    console.warn(
      `[elo-update] ${sport}: ${failures.length}/${teamIds.length} teams failed to fetch season results`
    );
  }

  // Run the full replay
  const ratings = await initializeEloFromSchedule(sport, allGames);

  // Log top 5 and bottom 5
  const sorted = Array.from(ratings.entries()).sort((a, b) => b[1] - a[1]);
  const top5 = sorted.slice(0, 5);
  const bottom5 = sorted.slice(-5).reverse();

  console.log(`[elo-update] ${sport} complete in ${Date.now() - startTime}ms (${ratings.size} teams)`);
  console.log(`  Top 5: ${top5.map(([id, r]) => `${id}=${Math.round(r)}`).join(", ")}`);
  console.log(`  Bottom 5: ${bottom5.map(([id, r]) => `${id}=${Math.round(r)}`).join(", ")}`);

  return ratings;
}
