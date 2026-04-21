/**
 * Adapter: run the new "honest" engine and translate its output into the
 * GamePrediction shape that /api/games has always returned.
 *
 * This keeps the API contract stable for the frontend while routing the
 * actual computation to the new engine when USE_NEW_PREDICTION_ENGINE=true.
 */

import { predictGame } from "./index";
import { buildGameContext } from "./shadow";
import type { HonestPrediction, FactorContribution } from "./types";
import type { Game, GamePrediction, PredictionFactor } from "../routes/games";
import { prisma } from "../prisma";
import { enqueueWrite } from "../lib/writeQueue";

/**
 * Map a new-engine factor (FactorContribution) into the old PredictionFactor
 * shape used by the API.
 *
 *   homeScore/awayScore are 0..1 display values. We map homeDelta (Elo points,
 *   positive = favors home) into a 0..1 scale centered at 0.5:
 *     homeDelta >=  +100 → homeScore 1.0
 *     homeDelta ==    0  → homeScore 0.5
 *     homeDelta <=  -100 → homeScore 0.0
 *   awayScore = 1 - homeScore.
 *
 *   Unavailable factors report 0.5/0.5 so the UI can still render them.
 */
function translateFactor(f: FactorContribution): PredictionFactor {
  let homeScore = 0.5;
  if (f.available) {
    const clamped = Math.max(-100, Math.min(100, f.homeDelta));
    homeScore = 0.5 + clamped / 200;
  }
  return {
    name: f.label,
    weight: f.weight,
    homeScore,
    awayScore: 1 - homeScore,
    description: f.evidence,
  };
}

/**
 * Build a GamePrediction from a HonestPrediction + Game shell.
 * Confidence is deliberately the RAW max probability — no ceilings, no
 * dampeners, no band-derived values.
 */
export function translateNewEnginePrediction(
  game: Game,
  newPred: HonestPrediction,
  spread: number | undefined,
  overUnder: number | undefined,
): GamePrediction {
  const homeProbPct = Math.round(newPred.homeWinProbability * 100);
  const awayProbPct = Math.round(newPred.awayWinProbability * 100);
  const drawProbPct =
    newPred.drawProbability !== undefined
      ? Math.round(newPred.drawProbability * 100)
      : undefined;

  // Determine winner. If the new engine picked a team, match it; otherwise
  // fall back to higher home/away probability (null = draw preferred, but
  // the old API shape doesn't represent draws — default to whichever side
  // has the higher prob).
  let predictedWinner: "home" | "away";
  if (newPred.predictedWinner) {
    predictedWinner =
      newPred.predictedWinner.teamId === game.homeTeam.id ? "home" : "away";
  } else {
    predictedWinner = homeProbPct >= awayProbPct ? "home" : "away";
  }

  // Confidence = raw winner probability, no capping.
  const confidence = Math.max(homeProbPct, awayProbPct);

  const marketFavorite: "home" | "away" =
    game.marketFavorite ?? predictedWinner;

  return {
    id: `pred-${game.id}`,
    gameId: game.id,
    predictedWinner,
    confidence,
    analysis: newPred.narrative || "",
    predictedSpread: spread ?? 0,
    predictedTotal: overUnder ?? 0,
    marketFavorite,
    spread: spread ?? 0,
    overUnder: overUnder ?? 0,
    createdAt: newPred.generatedAt,
    homeWinProbability: homeProbPct,
    awayWinProbability: awayProbPct,
    drawProbability: drawProbPct,
    factors: newPred.factors.map(translateFactor),
    edgeRating: 0,
    valueRating: 0,
    recentFormHome: "",
    recentFormAway: "",
    homeStreak: 0,
    awayStreak: 0,
    isTossUp: Math.abs(homeProbPct - awayProbPct) < 5,
  };
}

/**
 * Run the new engine end-to-end for an ESPN-shaped Game and return a
 * GamePrediction. Persists a PredictionResult row on first generation
 * for the game (create-once, never overwrite).
 */
export async function runNewEnginePrediction(game: Game): Promise<GamePrediction> {
  const ctx = await buildGameContext(game);
  const newPred = predictGame(ctx);

  const prediction = translateNewEnginePrediction(
    game,
    newPred,
    game.spread,
    game.overUnder,
  );

  // Persist on first generation (same create-once semantics as the old engine).
  const gameId = game.id;
  const sport = game.sport;
  const predictedWinner = prediction.predictedWinner;
  const confidence = prediction.confidence;
  const isTossUp = prediction.isTossUp ?? false;
  const homeElo = ctx.homeElo;
  const awayElo = ctx.awayElo;
  const homeWinProb = newPred.homeWinProbability;

  enqueueWrite(async () => {
    const existing = await prisma.predictionResult.findUnique({ where: { gameId } });
    if (existing) return;
    await prisma.predictionResult.create({
      data: {
        gameId,
        sport,
        predictedWinner,
        confidence,
        isTossUp,
        homeElo,
        awayElo,
        homeWinProb,
        actualWinner: null,
        wasCorrect: null,
        resolvedAt: null,
      },
    });
  });

  return prediction;
}
