/**
 * Market-line snapshot job.
 *
 * Runs every 30 minutes in src/index.ts. For each scheduled game in the
 * next 24 hours, pull a fresh SharpAPI consensus and persist to the
 * MarketSnapshot table. Over time these rows form a line-movement time
 * series we can cross-reference against our model for sharpness analysis.
 *
 * Gated on SHARPAPI_KEY — when unset, fetchMarketConsensus returns null
 * and this job becomes a no-op (see lib/sharpApi.ts).
 *
 * Idempotent and self-throttling: sharpApi's 10/min token bucket silently
 * drops calls when exhausted, so running the job on a 30-min cadence with
 * hundreds of games in flight is safe.
 */

import { prisma } from "../prisma";
import { fetchMarketConsensus, type MarketLine } from "../lib/sharpApi";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface ScheduledGame {
  id: string;
  sport: string;
  gameTime: string;
  homeTeamName: string;
  awayTeamName: string;
}

/**
 * Pull the list of games to snapshot. Delegates to the running backend's
 * `/api/games` aggregator so we don't re-implement per-sport schedule
 * fetchers here. Filters to SCHEDULED games within the next 24 hours.
 */
async function loadScheduledGames(baseUrl: string): Promise<ScheduledGame[]> {
  try {
    const response = await fetch(`${baseUrl}/api/games`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      data?: Array<{
        id: string;
        sport: string;
        gameTime: string;
        status: string;
        homeTeam: { name: string };
        awayTeam: { name: string };
      }>;
    };
    const cutoff = Date.now() + ONE_DAY_MS;
    const rows = body.data ?? [];
    return rows
      .filter((g) => g.status === "SCHEDULED")
      .filter((g) => {
        const ts = new Date(g.gameTime).getTime();
        return !Number.isNaN(ts) && ts <= cutoff && ts > Date.now() - 60 * 60 * 1000;
      })
      .map((g) => ({
        id: g.id,
        sport: g.sport,
        gameTime: g.gameTime,
        homeTeamName: g.homeTeam.name,
        awayTeamName: g.awayTeam.name,
      }));
  } catch (err) {
    console.warn("[market] loadScheduledGames failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Fetch + persist a single game's market consensus. Returns true if a row
 * was written, false otherwise (no consensus, or write failed).
 */
async function snapshotGame(game: ScheduledGame): Promise<boolean> {
  const gameTime = new Date(game.gameTime);
  const consensus = await fetchMarketConsensus(
    game.sport,
    game.homeTeamName,
    game.awayTeamName,
    gameTime,
  );
  if (!consensus) return false;

  try {
    await prisma.marketSnapshot.create({
      data: {
        gameId: game.id,
        sport: game.sport,
        pinnacleHomeNoVig: consensus.pinnacleLine ? consensus.noVigHomeProb : null,
        pinnacleAwayNoVig: consensus.pinnacleLine ? consensus.noVigAwayProb : null,
        pinnacleDrawNoVig: consensus.pinnacleLine ? consensus.noVigDrawProb ?? null : null,
        avgHomeProb: consensus.avgHomeProb,
        avgAwayProb: consensus.avgAwayProb,
        linesJson: JSON.stringify(consensus.lines satisfies MarketLine[]),
      },
    });
    return true;
  } catch (err) {
    console.error(`[market] snapshot failed for ${game.id}:`, err);
    return false;
  }
}

/**
 * Top-level entry invoked by the cron. Batches in groups of 5 to keep the
 * token bucket from starving (SharpAPI allows 10 req/min).
 */
export async function snapshotMarketLines(baseUrl: string): Promise<{
  attempted: number;
  written: number;
}> {
  const games = await loadScheduledGames(baseUrl);
  if (games.length === 0) return { attempted: 0, written: 0 };

  console.log(`[market] snapshot run — ${games.length} scheduled games in next 24h`);
  let written = 0;
  const BATCH = 5;
  for (let i = 0; i < games.length; i += BATCH) {
    const chunk = games.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map(snapshotGame));
    written += results.filter(Boolean).length;
  }
  console.log(`[market] snapshot run complete — ${written}/${games.length} persisted`);
  return { attempted: games.length, written };
}
