/**
 * Adapter: run the new "honest" engine and translate its output into the
 * GamePrediction shape that /api/games has always returned.
 *
 * This keeps the API contract stable for the frontend while routing the
 * actual computation to the new engine when USE_NEW_PREDICTION_ENGINE=true.
 */

import { predictGame } from "./index";
import { buildGameContext } from "./shadow";
import { buildDeterministicNarrative, buildNarrativeInput } from "./narrative";
import type { HonestPrediction, FactorContribution, GameContext } from "./types";
import { getConfidenceBand } from "./types";
import type { Game, GamePrediction, PredictionFactor } from "../routes/games";
import { prisma } from "../prisma";
import { enqueueWrite } from "../lib/writeQueue";
import {
  extractInjuryListForLLM,
  generateLLMNarrative,
  isRateCapped,
  mapConfidenceTier,
  type LLMNarrativeInput,
} from "./llmNarrative";
import {
  computeVersionHash,
  getCachedLLMNarrative,
  putCachedLLMNarrative,
} from "./narrativeCache";

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
 * Build a 2-4 sentence narrative for a new-engine prediction. Reads the
 * factor list, picks the lead + supporting factors, and composes a
 * deterministic summary.
 *
 * Called synchronously in the API path so the response always ships with
 * a populated analysis string — no "" placeholders reaching the client.
 *
 * When no non-Elo factor has real signal (light-data night), the template
 * appends "No additional contextual signals available." so the reader
 * knows the pick is Elo-only, not that we forgot to mention supporting
 * evidence.
 */
export function buildAdapterNarrative(
  newPred: HonestPrediction,
  sport: string,
  game: Game,
): string {
  const confidencePct = newPred.confidence;
  const band = getConfidenceBand(
    Math.max(newPred.homeWinProbability, newPred.awayWinProbability, newPred.drawProbability ?? 0),
  );
  const winnerAbbr = newPred.predictedWinner?.abbr ?? null;
  const input = buildNarrativeInput(
    newPred.factors,
    band,
    confidencePct,
    game.homeTeam.abbreviation,
    game.awayTeam.abbreviation,
    winnerAbbr,
    sport,
  );
  return buildDeterministicNarrative(input);
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

  // Populate the narrative. predictGame leaves newPred.narrative as "" so a
  // separate step can fill it in; historically that step was only wired up
  // on the old-engine path. Use the deterministic template — synchronous,
  // always valid, no LLM latency tax on cold requests. LLM enrichment can
  // layer on later via generateNarrative() if we want richer prose.
  newPred.narrative = buildAdapterNarrative(newPred, ctx.sport, game);

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

  // Fire-and-forget LLM enrichment. setImmediate defers the work until
  // after Hono has serialized and sent the current response, so this
  // never blocks /api/games. On success, the cached GamePrediction's
  // `analysis` field is mutated in place; the LRU stores references,
  // so the next request sees the LLM text.
  scheduleLLMEnrichment(game, ctx, newPred, prediction);

  return prediction;
}

/**
 * Schedule LLM narrative enrichment after the response has been sent.
 *
 * Hot path:
 *   - Never awaits. Never throws. Uses setImmediate to drain the current
 *     request before doing any work.
 *   - Reuses the already-built GameContext and HonestPrediction, so no
 *     re-fetch of the 20 parallel ESPN endpoints.
 *   - Mutates `prediction.analysis` on success; the LRU cache upstream
 *     holds this same object by reference.
 */
function scheduleLLMEnrichment(
  game: Game,
  ctx: GameContext,
  newPred: HonestPrediction,
  prediction: GamePrediction,
): void {
  setImmediate(async () => {
    try {
      await enrichPredictionWithLLMNarrative(game, ctx, newPred, prediction);
    } catch (err) {
      console.warn(
        `[llm-narrative] enrichment crashed gameId=${game.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  });
}

/**
 * Synchronous orchestration of the LLM cache check → OpenAI call →
 * cache write → in-place prediction mutation pipeline. Exported so the
 * test suite can drive it deterministically without setImmediate.
 */
export async function enrichPredictionWithLLMNarrative(
  game: Game,
  ctx: GameContext,
  newPred: HonestPrediction,
  prediction: GamePrediction,
): Promise<void> {
  const sport = ctx.sport;
  const injuries = extractInjuryListForLLM(
    sport,
    game.homeTeam.abbreviation,
    ctx.homeInjuries,
    game.awayTeam.abbreviation,
    ctx.awayInjuries,
  );

  const versionHash = computeVersionHash(prediction, injuries);

  // Tier-2 cache hit: reuse stored narrative, no OpenAI call.
  const cached = await getCachedLLMNarrative(game.id, versionHash);
  if (cached) {
    prediction.analysis = cached;
    return;
  }

  if (isRateCapped()) {
    console.warn(
      `[llm-narrative] rate cap hit, skipping enrichment for gameId=${game.id}`,
    );
    return;
  }

  const input = buildLLMNarrativeInput(game, newPred, sport, injuries);
  const result = await generateLLMNarrative(input);

  if (!result.text) {
    if (result.reason && result.reason !== "no_api_key") {
      console.log(
        `[llm-narrative] fallback (${result.reason}) gameId=${game.id}`,
      );
    }
    return;
  }

  prediction.analysis = result.text;
  await putCachedLLMNarrative(
    game.id,
    versionHash,
    result.text,
    result.tokensUsed,
  );
  console.log(
    `[llm-narrative] generation success gameId=${game.id} tokens=${result.tokensUsed}`,
  );
}

function buildLLMNarrativeInput(
  game: Game,
  newPred: HonestPrediction,
  sport: string,
  injuries: ReturnType<typeof extractInjuryListForLLM>,
): LLMNarrativeInput {
  // Reuse the existing sort/select logic from buildNarrativeInput so the
  // LLM sees the same top factors the deterministic fallback would have
  // used. The band is recomputed here just for mapConfidenceTier.
  const band = getConfidenceBand(
    Math.max(
      newPred.homeWinProbability,
      newPred.awayWinProbability,
      newPred.drawProbability ?? 0,
    ),
  );
  const winnerAbbr = newPred.predictedWinner?.abbr ?? null;
  const narrativeInput = buildNarrativeInput(
    newPred.factors,
    band,
    newPred.confidence,
    game.homeTeam.abbreviation,
    game.awayTeam.abbreviation,
    winnerAbbr,
    sport,
  );

  const topFactors: FactorContribution[] = [narrativeInput.leadFactor].concat(
    narrativeInput.supportingFactors,
  );

  const pickTeamName =
    winnerAbbr === null
      ? null
      : winnerAbbr === game.homeTeam.abbreviation
        ? game.homeTeam.name
        : game.awayTeam.name;

  return {
    sport,
    awayTeam: {
      abbr: game.awayTeam.abbreviation,
      name: game.awayTeam.name,
    },
    homeTeam: {
      abbr: game.homeTeam.abbreviation,
      name: game.homeTeam.name,
    },
    pickTeamName,
    confidenceTier: mapConfidenceTier(newPred.confidence),
    topFactors,
    counterpoint: narrativeInput.counterpoint,
    injuries,
  };
}
