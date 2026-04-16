/**
 * Prediction version history.
 *
 * Writes a row to PredictionVersion every time a game's prediction is
 * first computed (v1, triggerReason="initial") and every time a news
 * signal prompts a re-predict (v2+, triggerReason describing the cause).
 *
 * Prompt C2 will consume this table to render a UI timeline like:
 *   v1  LAL -140 (62.8%)  initial
 *   v2  LAL -120 (57.1%)  injury:LeBron James OUT
 *   v3  LAL -135 (61.5%)  injury:Anthony Davis PROBABLE
 *
 * All writes are best-effort (try/catch, log on failure) because the
 * version audit trail must never block the user-facing prediction.
 */

import type { HonestPrediction } from "../../prediction/types";
import { prisma } from "../../prisma";

async function nextVersion(gameId: string): Promise<number> {
  const latest = await prisma.predictionVersion.findFirst({
    where: { gameId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

/** Write the v1 "initial" row for a game. Idempotent via a latest-version guard. */
export async function createInitialVersion(
  gameId: string,
  sport: string,
  prediction: HonestPrediction,
): Promise<void> {
  try {
    // Idempotency: if any version exists already, don't double-write v1.
    const existing = await prisma.predictionVersion.findFirst({
      where: { gameId },
      select: { id: true },
    });
    if (existing) return;

    await prisma.predictionVersion.create({
      data: {
        gameId,
        sport,
        version: 1,
        homeWinProb: prediction.homeWinProbability,
        awayWinProb: prediction.awayWinProbability,
        drawProb: prediction.drawProbability ?? null,
        confidence: prediction.confidence,
        confidenceBand: prediction.confidenceBand,
        triggerReason: "initial",
        factorsJson: JSON.stringify(prediction.factors ?? []),
      },
    });
  } catch (err) {
    console.warn(
      `[prediction-version] initial write failed for ${gameId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Write a follow-up version after a re-predict. Always bumps `version`
 * to the current max + 1 even if the concurrent crons race — duplicates
 * are harmless because the unique constraint we rely on is `(gameId,
 * createdAt)`, not `(gameId, version)`.
 */
export async function createTriggeredVersion(args: {
  gameId: string;
  sport: string;
  prediction: HonestPrediction;
  triggerReason: string;
  triggerSourceId?: string | null;
}): Promise<void> {
  try {
    const version = await nextVersion(args.gameId);
    await prisma.predictionVersion.create({
      data: {
        gameId: args.gameId,
        sport: args.sport,
        version,
        homeWinProb: args.prediction.homeWinProbability,
        awayWinProb: args.prediction.awayWinProbability,
        drawProb: args.prediction.drawProbability ?? null,
        confidence: args.prediction.confidence,
        confidenceBand: args.prediction.confidenceBand,
        triggerReason: args.triggerReason,
        triggerSourceId: args.triggerSourceId ?? null,
        factorsJson: JSON.stringify(args.prediction.factors ?? []),
      },
    });
  } catch (err) {
    console.warn(
      `[prediction-version] triggered write failed for ${args.gameId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Read-side helper for the admin status endpoint + Prompt C2 timeline UI. */
export async function getVersionsForGame(gameId: string) {
  return prisma.predictionVersion.findMany({
    where: { gameId },
    orderBy: { version: "asc" },
  });
}
