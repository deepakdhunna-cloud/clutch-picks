/**
 * Live-intelligence endpoint.
 *
 * GET /api/games/:id/intelligence → 4 game-state-aware boxes (pre/live/final).
 *
 * Mounted at /api/games (different sub-path from gamesRouter, so no conflict).
 * The handler:
 *   1. Resolves the game (via lookupGameById from games.ts).
 *   2. Loads the user's pick if authenticated.
 *   3. Fetches a best-effort market snapshot (catch & null on failure).
 *   4. Pulls the live ESPN snapshot (state, win-probability, situation).
 *   5. Builds a GameContext, runs the prediction engine.
 *   6. Calls assembleBoxes — pure function, sport- and state-aware.
 */

import { Hono } from "hono";
import { auth } from "../auth";
import { prisma } from "../prisma";
import { lookupGameById, findSimilarUpcomingGame } from "./games";
import { fetchEspnLive } from "../lib/espnLive";
import { fetchMarketConsensus } from "../lib/sharpApi";
import { buildGameContext } from "../prediction/shadow";
import { predictGame } from "../prediction/index";
import {
  assembleBoxes,
  type Box,
  type GameState,
  type UserPick,
  type GameContextLite,
} from "../lib/liveIntelligence";

const intelligenceRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// LIVE answers churn every ~30s, scheduled/final are stable for ~5min.
function expiresAt(state: GameState): string {
  const ttlSec = state === "live" ? 30 : 300;
  return new Date(Date.now() + ttlSec * 1000).toISOString();
}

function gameStatusToState(status: string): GameState {
  if (status === "LIVE") return "live";
  if (status === "FINAL") return "final";
  return "pre";
}

intelligenceRouter.get("/:id/intelligence", async (c) => {
  const gameId = c.req.param("id");

  const game = await lookupGameById(gameId);
  if (!game) {
    return c.json(
      { error: { message: `Game not found: ${gameId}`, code: "GAME_NOT_FOUND" } },
      404,
    );
  }

  const user = c.get("user");

  // 1. User pick (best effort).
  let userPick: UserPick | null = null;
  if (user) {
    try {
      const row = await prisma.userPick.findUnique({
        where: { odId_gameId: { odId: user.id, gameId } },
      });
      if (row) {
        userPick = {
          pickedTeam: row.pickedTeam as "home" | "away",
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
        };
      }
    } catch (err) {
      console.warn(`[intel] pick lookup failed for ${gameId}:`, err instanceof Error ? err.message : err);
    }
  }

  // 2. ESPN live snapshot, market snapshot, and game context — fetch in parallel.
  const gameTime = new Date(game.gameTime);
  const [espn, marketSnapshot, ctx] = await Promise.all([
    fetchEspnLive(game.sport, game.id),
    fetchMarketConsensus(game.sport, game.homeTeam.name, game.awayTeam.name, gameTime).catch(
      () => null,
    ),
    buildGameContext({
      id: game.id,
      sport: game.sport,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      gameTime: game.gameTime,
      venue: game.venue,
    }).catch((err) => {
      console.warn(`[intel] context build failed for ${gameId}:`, err instanceof Error ? err.message : err);
      return null;
    }),
  ]);

  if (!ctx) {
    return c.json(
      { error: { message: "Could not build game context", code: "CONTEXT_FAILED" } },
      500,
    );
  }

  // 3. Run prediction.
  const prediction = predictGame(ctx);

  // 4. Determine canonical state. Prefer ESPN live signal, fall back to game.status.
  const state: GameState = espn.state ?? gameStatusToState(game.status);

  // 5. Resolve nextGame for FINAL-state "nextOpportunity" box. Best-effort.
  let nextGame = null;
  if (state === "final") {
    try {
      nextGame = await findSimilarUpcomingGame(game);
    } catch {
      nextGame = null;
    }
  }

  const liteGame: GameContextLite = {
    id: game.id,
    sport: game.sport,
    state,
    homeTeam: {
      id: game.homeTeam.id,
      abbreviation: game.homeTeam.abbreviation,
      name: game.homeTeam.name,
    },
    awayTeam: {
      id: game.awayTeam.id,
      abbreviation: game.awayTeam.abbreviation,
      name: game.awayTeam.name,
    },
    homeScore: game.homeScore,
    awayScore: game.awayScore,
  };

  const boxes: Box[] = assembleBoxes({
    game: liteGame,
    espn,
    userPick,
    marketSnapshot,
    prediction,
    nextGame,
  });

  return c.json({
    data: {
      gameId: game.id,
      sport: game.sport,
      state,
      boxes,
      generatedAt: new Date().toISOString(),
      expiresAt: expiresAt(state),
    },
  });
});

export { intelligenceRouter };
