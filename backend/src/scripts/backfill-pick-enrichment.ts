/**
 * One-time backfill script — populates the 5 enriched fields
 * (modelPredictedWinner, modelConfidence, modelHomeWinProb,
 * finalHomeScore, finalAwayScore) on every UserPick row that has a
 * `result` set but no `modelPredictedWinner`.
 *
 * Idempotent: re-running it after completion finds zero rows and exits.
 *
 * Run manually after the schema migration is live on Railway:
 *   bun run backend/src/scripts/backfill-pick-enrichment.ts
 *
 * Not wired into startup. This is a deliberately manual one-shot.
 */

import { prisma } from "../prisma";
import {
  fetchGameResult,
  buildPredictionEnrichment,
  type PredictionEnrichment,
} from "../lib/resolve-picks";

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 100;

interface BackfillStats {
  total: number;
  enriched: number;
  skippedNoGame: number;
  skippedNoPrediction: number;
  errored: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backfillOnePick(pick: {
  id: string;
  gameId: string;
  pickedTeam: string;
}, predictionMap: Map<string, { predictedWinner: string; confidence: number; homeWinProb: number | null }>): Promise<"enriched" | "no_game" | "no_prediction" | "error"> {
  let gameResult: Awaited<ReturnType<typeof fetchGameResult>> = null;
  try {
    gameResult = await fetchGameResult(pick.gameId);
  } catch (err) {
    console.error(`[backfill] Error fetching game ${pick.gameId}:`, err);
    return "error";
  }

  if (!gameResult || !gameResult.isFinal) {
    return "no_game";
  }

  const enrichment: PredictionEnrichment | null = buildPredictionEnrichment(
    predictionMap.get(pick.gameId) ?? null
  );

  // We can always write the scores even if the prediction is missing.
  // But the spec says all 5 fields should land together for the UI to treat
  // a pick as "enriched". We mark the pick partially enriched (scores only)
  // when no prediction exists, so it's still distinguishable from totally
  // empty rows by the presence of finalHomeScore.
  try {
    await prisma.userPick.update({
      where: { id: pick.id },
      data: {
        finalHomeScore: gameResult.homeScore,
        finalAwayScore: gameResult.awayScore,
        ...(enrichment ?? {}),
      },
    });
  } catch (err) {
    console.error(`[backfill] Error updating pick ${pick.id}:`, err);
    return "error";
  }

  return enrichment ? "enriched" : "no_prediction";
}

async function main(): Promise<void> {
  console.log("[backfill] Starting pick enrichment backfill...");

  const targetPicks = await prisma.userPick.findMany({
    where: {
      result: { not: null },
      modelPredictedWinner: null,
    },
    select: { id: true, gameId: true, pickedTeam: true },
    orderBy: { createdAt: "asc" },
  });

  const stats: BackfillStats = {
    total: targetPicks.length,
    enriched: 0,
    skippedNoGame: 0,
    skippedNoPrediction: 0,
    errored: 0,
  };

  if (stats.total === 0) {
    console.log("[backfill] No picks need backfilling. Exiting cleanly.");
    return;
  }

  console.log(`[backfill] Found ${stats.total} settled picks missing enrichment. Processing in batches of ${BATCH_SIZE}.`);

  // Pre-fetch every prediction we might need in a single query.
  const allGameIds = Array.from(new Set(targetPicks.map((p) => p.gameId)));
  const predRows = await prisma.predictionResult.findMany({
    where: { gameId: { in: allGameIds } },
    select: { gameId: true, predictedWinner: true, confidence: true, homeWinProb: true },
  });
  const predictionMap = new Map(predRows.map((p) => [p.gameId, p]));
  console.log(`[backfill] Loaded ${predRows.length} prediction rows for ${allGameIds.length} unique games.`);

  for (let i = 0; i < targetPicks.length; i += BATCH_SIZE) {
    const batch = targetPicks.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(targetPicks.length / BATCH_SIZE);

    const results = await Promise.all(
      batch.map((pick) => backfillOnePick(pick, predictionMap))
    );

    for (const r of results) {
      if (r === "enriched") stats.enriched++;
      else if (r === "no_game") stats.skippedNoGame++;
      else if (r === "no_prediction") stats.skippedNoPrediction++;
      else stats.errored++;
    }

    console.log(
      `[backfill] Batch ${batchNum}/${totalBatches} done. ` +
      `Running totals: enriched=${stats.enriched} no_game=${stats.skippedNoGame} no_prediction=${stats.skippedNoPrediction} errored=${stats.errored}`
    );

    if (i + BATCH_SIZE < targetPicks.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log("[backfill] Complete.");
  console.log(`[backfill]   total picks examined:    ${stats.total}`);
  console.log(`[backfill]   fully enriched:          ${stats.enriched}`);
  console.log(`[backfill]   scores only (no pred):   ${stats.skippedNoPrediction}`);
  console.log(`[backfill]   skipped (game missing):  ${stats.skippedNoGame}`);
  console.log(`[backfill]   errored:                 ${stats.errored}`);
}

main()
  .catch((err) => {
    console.error("[backfill] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
