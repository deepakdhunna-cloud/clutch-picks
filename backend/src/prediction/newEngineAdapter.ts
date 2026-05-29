/**
 * Adapter: run the new "honest" engine and translate its output into the
 * GamePrediction shape that /api/games has always returned.
 *
 * This keeps the API contract stable for the frontend while routing the
 * actual computation to the new engine when USE_NEW_PREDICTION_ENGINE=true.
 */

import { predictGame, reconcileProjectionToFinal } from "./index";
import { buildGameContext } from "./shadow";
import { buildDeterministicNarrative, buildNarrativeInput } from "./narrative";
import type { HonestPrediction, FactorContribution, GameContext } from "./types";
import { getConfidenceBand } from "./types";
import {
  applySelfLearningCalibration,
  getSelfLearningCalibrationSnapshot,
  isSelfLearningCalibrationEnabled,
} from "./selfLearningCalibration";
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
import { deriveSeasonContext } from "./seasonContext";
import { selectedOutcomeProbability } from "./grading";

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
  injuries: ReturnType<typeof extractInjuryListForLLM> = [],
): string {
  const confidencePct = newPred.confidence;
  const band = getConfidenceBand(
    Math.max(newPred.homeWinProbability, newPred.awayWinProbability, newPred.drawProbability ?? 0),
  );
  const winnerAbbr = newPred.predictedWinner?.abbr ?? null;
  const seasonContext =
    game.seasonContext ??
    deriveSeasonContext({ sport, gameTime: game.gameTime });
  const narrativeFactors = buildDecisionNarrativeFactors(newPred, game);
  const input = buildNarrativeInput(
    narrativeFactors,
    band,
    confidencePct,
    game.homeTeam.abbreviation,
    game.awayTeam.abbreviation,
    winnerAbbr,
    sport,
    injuries,
    seasonContext,
    game.homeTeam.name,
    game.awayTeam.name,
  );
  prioritizeProjectionFactor(input, narrativeFactors);
  return buildDeterministicNarrative(input);
}

function prioritizeProjectionFactor(
  input: ReturnType<typeof buildNarrativeInput>,
  factors: FactorContribution[],
): void {
  const projectionFactor = factors.find((f) => f.key === "simulation_projection" && f.available);
  if (!projectionFactor) return;
  const winnerIsHome = input.winnerAbbr === input.homeTeamAbbr;
  const winnerIsAway = input.winnerAbbr === input.awayTeamAbbr;
  if (!winnerIsHome && !winnerIsAway) return;
  const projectionSupportsWinner =
    (winnerIsHome && projectionFactor.homeDelta > 0) ||
    (winnerIsAway && projectionFactor.homeDelta < 0);

  if (!projectionSupportsWinner) {
    if (!input.counterpoint && Math.abs(projectionFactor.homeDelta) > 2) {
      input.counterpoint = projectionFactor;
    }
    return;
  }

  const alreadyIncluded =
    input.leadFactor.key === projectionFactor.key ||
    input.supportingFactors.some((f) => f.key === projectionFactor.key);
  if (alreadyIncluded) return;
  input.supportingFactors = [projectionFactor, ...input.supportingFactors].slice(0, 2);
}

function buildDecisionNarrativeFactors(newPred: HonestPrediction, game: Game): FactorContribution[] {
  const factors = [...newPred.factors];
  if (newPred.projection) {
    const projection = newPred.projection;
    const homePct = Math.round(projection.homeWinProbability * 100);
    const awayPct = Math.round(projection.awayWinProbability * 100);
    const drawPct =
      projection.drawProbability !== undefined
        ? Math.round(projection.drawProbability * 100)
        : undefined;
    const expectedHome = projection.projectedHomeScore.toFixed(1);
    const expectedAway = projection.projectedAwayScore.toFixed(1);
    const expectedGap = Math.abs(projection.projectedHomeScore - projection.projectedAwayScore);
    const scoreRead =
      expectedGap < 0.35
        ? `Expected scoring average is tight at ${expectedHome}-${expectedAway}`
        : `Expected scoring average is ${expectedHome}-${expectedAway}`;
    const lean =
      drawPct !== undefined && drawPct >= homePct && drawPct >= awayPct
        ? `draw ${drawPct}%`
        : homePct >= awayPct
          ? `${game.homeTeam.abbreviation} ${homePct}%`
          : `${game.awayTeam.abbreviation} ${awayPct}%`;
    const probabilityDelta = projection.homeWinProbability - projection.awayWinProbability;

    factors.push({
      key: "simulation_projection",
      label: "Expected-score projection",
      homeDelta: probabilityDelta * 180,
      weight: 0.14,
      available: true,
      hasSignal: Math.abs(probabilityDelta) >= 0.015 || Math.abs(projection.projectedSpread) >= 0.15,
      evidence:
        `${scoreRead}, while the projection lean is ${lean} ` +
        `with upset/draw risk ${Math.round(projection.upsetRisk * 100)}%`,
    });
  }

  if (newPred.marketComparison) {
    const modelHome = Math.round(newPred.marketComparison.modelHomeProb * 100);
    const marketHome = Math.round(newPred.marketComparison.marketHomeProb * 100);
    factors.push({
      key: "market_comparison",
      label: "Consensus check",
      homeDelta: (newPred.marketComparison.modelHomeProb - newPred.marketComparison.marketHomeProb) * 120,
      weight: newPred.marketComparison.isDivergent ? 0.07 : 0.03,
      available: true,
      hasSignal: newPred.marketComparison.isDivergent,
      evidence:
        `Internal read has home at ${modelHome}% while outside consensus sits near ${marketHome}%; ` +
        (newPred.marketComparison.isDivergent ? "that disagreement is a real risk flag" : "that is close enough to be a calibration check"),
    });
  }

  return factors;
}

function recentFormString(form: GameContext["homeForm"] | undefined): string {
  if (!form) return "";
  if (form.formString) return form.formString;
  return form.results.join("-");
}

function bestBookForPick(
  market: GameContext["marketConsensus"] | undefined | null,
  pickedSide: "home" | "away",
): { sportsbook: string; american: number } | null {
  const bestBook = market?.lines
    ?.slice()
    .sort((a, b) =>
      pickedSide === "home"
        ? b.homeAmerican - a.homeAmerican
        : b.awayAmerican - a.awayAmerican,
    )[0];

  return bestBook
    ? {
        sportsbook: bestBook.sportsbook,
        american: pickedSide === "home" ? bestBook.homeAmerican : bestBook.awayAmerican,
      }
    : null;
}

function isMarketAwareTossUp(canonical: HonestPrediction["canonicalResult"]): boolean {
  if (canonical.finalPick === "none") return true;

  const entries = [
    { outcome: "home", probability: canonical.probabilities.home },
    { outcome: "away", probability: canonical.probabilities.away },
    ...(canonical.probabilities.draw !== undefined
      ? [{ outcome: "draw", probability: canonical.probabilities.draw }]
      : []),
  ].sort((a, b) => b.probability - a.probability);
  const leader = entries[0];
  const runnerUp = entries[1];
  if (!leader || !runnerUp) return true;

  const lead = leader.probability - runnerUp.probability;
  if (canonical.marketType === "three_way_result") {
    return leader.probability < 0.37 || lead < 0.025;
  }

  return leader.probability < 0.53 || lead < 0.06;
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
  ctx?: GameContext,
): GamePrediction {
  const homeProbPct = Math.round(newPred.homeWinProbability * 100);
  const awayProbPct = Math.round(newPred.awayWinProbability * 100);
  const drawProbPct =
    newPred.drawProbability !== undefined
      ? Math.round(newPred.drawProbability * 100)
      : undefined;

  // Determine winner for legacy UI fields. predictedOutcome preserves the
  // honest three-way result for soccer so draw reads are not silently erased.
  let predictedWinner: "home" | "away";
  let predictedOutcome: "home" | "away" | "draw";
  if (newPred.predictedWinner) {
    predictedWinner =
      newPred.predictedWinner.teamId === game.homeTeam.id ? "home" : "away";
    predictedOutcome = predictedWinner;
  } else {
    predictedWinner = homeProbPct >= awayProbPct ? "home" : "away";
    predictedOutcome = drawProbPct !== undefined ? "draw" : predictedWinner;
  }

  // Confidence = raw outcome probability, no capping. Soccer draw reads must
  // use the three-way max, not the larger of only home/away.
  const confidence = Math.max(homeProbPct, awayProbPct, drawProbPct ?? 0);

  const decisionProfile = newPred.canonicalResult.decisionProfile;

  return {
    id: `pred-${game.id}`,
    gameId: game.id,
    predictedWinner,
    predictedOutcome,
    confidence,
    analysis: newPred.narrative || "",
    predictedSpread: newPred.projection?.projectedSpread ?? spread ?? 0,
    predictedTotal: newPred.projection?.projectedTotal ?? overUnder ?? 0,
    marketFavorite: game.marketFavorite,
    spread,
    overUnder,
    createdAt: newPred.generatedAt,
    canonicalResult: newPred.canonicalResult,
    homeWinProbability: homeProbPct,
    awayWinProbability: awayProbPct,
    drawProbability: drawProbPct,
    projection: newPred.projection
      ? {
          engine: newPred.projection.engine,
          iterations: newPred.projection.iterations,
          homeWinProbability: Math.round(newPred.projection.homeWinProbability * 1000) / 10,
          awayWinProbability: Math.round(newPred.projection.awayWinProbability * 1000) / 10,
          drawProbability:
            newPred.projection.drawProbability !== undefined
              ? Math.round(newPred.projection.drawProbability * 1000) / 10
              : undefined,
          projectedHomeScore: newPred.projection.projectedHomeScore,
          projectedAwayScore: newPred.projection.projectedAwayScore,
          projectedSpread: newPred.projection.projectedSpread,
          projectedTotal: newPred.projection.projectedTotal,
          volatility: newPred.projection.volatility,
          upsetRisk: newPred.projection.upsetRisk,
          signals: newPred.projection.signals,
        }
      : undefined,
    factors: newPred.factors.map(translateFactor),
    edgeRating: decisionProfile?.edgeRating ?? 5,
    valueRating: decisionProfile?.valueRating ?? 5,
    recentFormHome: recentFormString(ctx?.homeForm),
    recentFormAway: recentFormString(ctx?.awayForm),
    homeStreak: ctx?.homeForm?.streak ?? 0,
    awayStreak: ctx?.awayForm?.streak ?? 0,
    isTossUp: isMarketAwareTossUp(newPred.canonicalResult),
    lowDataWarning: decisionProfile?.lowDataWarning ?? false,
    ensembleDivergence: decisionProfile?.engineDivergence ?? false,
    marketComparison: newPred.marketComparison
      ? {
          ...newPred.marketComparison,
          bestBook: bestBookForPick(ctx?.marketConsensus, predictedWinner),
        }
      : undefined,
  };
}

const SNAPSHOT_FREEZE_MS = 5 * 60 * 1000;

export function shouldPersistPredictionSnapshot(
  game: Pick<Game, "status" | "gameTime">,
  now = new Date(),
): boolean {
  if (game.status !== "SCHEDULED") return false;
  const scheduledStart = new Date(game.gameTime).getTime();
  if (!Number.isFinite(scheduledStart)) return false;
  return scheduledStart > now.getTime();
}

export function shouldUpdatePredictionSnapshot(
  game: Pick<Game, "status" | "gameTime">,
  now = new Date(),
): boolean {
  if (!shouldPersistPredictionSnapshot(game, now)) return false;
  const scheduledStart = new Date(game.gameTime).getTime();
  return scheduledStart - now.getTime() > SNAPSHOT_FREEZE_MS;
}

/**
 * Run the new engine end-to-end for an ESPN-shaped Game and return a
 * GamePrediction. Persists a PredictionResult only while the event is still
 * safely pregame; live/final cold-cache predictions are display-only so they
 * cannot poison the gradebook.
 */
export async function runNewEnginePrediction(game: Game): Promise<GamePrediction> {
  const ctx = await buildGameContext(game);
  let newPred = predictGame(ctx);
  // Capture the RAW (pre-self-learning) probabilities as primitives now, before
  // any self-learning adjustment reassigns/mutates newPred. Persisted alongside
  // the served values so calibration/recalibration can grade the raw model and
  // avoid the self-learning feedback loop (#3).
  const rawHomeWinProb = newPred.homeWinProbability;
  const rawAwayWinProb = newPred.awayWinProbability;
  const rawDrawProb = newPred.drawProbability ?? null;
  // Self-learning calibration is gated by a kill-switch so it can be disabled in
  // production without a revert. When disabled we serve the raw model output.
  const learnedPred = isSelfLearningCalibrationEnabled()
    ? applySelfLearningCalibration(newPred, await getSelfLearningCalibrationSnapshot(ctx.sport))
    : newPred;
  if (learnedPred !== newPred) {
    const alignedProjection = learnedPred.projection
      ? reconcileProjectionToFinal({
          sport: ctx.sport,
          projection: learnedPred.projection,
          finalProbabilities: learnedPred.canonicalResult.probabilities,
        })
      : undefined;
    newPred = {
      ...learnedPred,
      projection: alignedProjection,
      canonicalResult: {
        ...learnedPred.canonicalResult,
        projectedScore: alignedProjection
          ? {
              home: alignedProjection.projectedHomeScore,
              away: alignedProjection.projectedAwayScore,
              spread: alignedProjection.projectedSpread,
              total: alignedProjection.projectedTotal,
            }
          : learnedPred.canonicalResult.projectedScore,
      },
    };
  }

  // Populate the narrative with the deterministic template: synchronous,
  // always valid, no LLM latency tax on cold requests. LLM enrichment can
  // layer on later via generateNarrative() if we want richer prose.
  const syncInjuries = extractInjuryListForLLM(
    ctx.sport,
    game.homeTeam.abbreviation,
    ctx.homeInjuries,
    game.awayTeam.abbreviation,
    ctx.awayInjuries,
  );
  newPred.narrative = buildAdapterNarrative(
    newPred,
    ctx.sport,
    game,
    syncInjuries,
  );

  const prediction = translateNewEnginePrediction(
    game,
    newPred,
    game.spread,
    game.overUnder,
    ctx,
  );

  // Persist on first generation; never overwrite an existing settled record.
  const gameId = game.id;
  const sport = game.sport;
  const predictedWinner = prediction.predictedWinner;
  const predictedOutcome = prediction.predictedOutcome ?? predictedWinner;
  const confidence = prediction.confidence;
  const isTossUp = prediction.isTossUp ?? false;
  const homeElo = ctx.homeElo;
  const awayElo = ctx.awayElo;
  const homeWinProb = newPred.homeWinProbability;
  const awayWinProb = newPred.awayWinProbability;
  const drawProb = newPred.drawProbability ?? null;
  const modelVersion = newPred.modelVersion;
  const scheduledStart = new Date(game.gameTime);
  const decisionProfile = newPred.canonicalResult.decisionProfile;
  const selectedProb = selectedOutcomeProbability({
    predictedWinner,
    predictedOutcome,
    confidence,
    homeWinProb,
    awayWinProb,
    drawProb,
  });
  // Raw selected-outcome probability uses the SAME pick but the pre-self-learning
  // probabilities, so the raw model's calibration can be measured independently.
  const rawSelectedProb = selectedOutcomeProbability({
    predictedWinner,
    predictedOutcome,
    confidence,
    homeWinProb: rawHomeWinProb,
    awayWinProb: rawAwayWinProb,
    drawProb: rawDrawProb,
  });

  if (shouldPersistPredictionSnapshot(game)) {
    enqueueWrite(async () => {
      const existing = await prisma.predictionResult.findUnique({ where: { gameId } });
      const data = {
        sport,
        scheduledStart: Number.isFinite(scheduledStart.getTime()) ? scheduledStart : null,
        homeTeam: game.homeTeam.abbreviation,
        awayTeam: game.awayTeam.abbreviation,
        predictedWinner,
        predictedOutcome,
        confidence,
        isTossUp,
        homeElo,
        awayElo,
        homeWinProb,
        awayWinProb,
        drawProb,
        modelVersion,
        analysisSnapshot: prediction.analysis,
        projectionJson: prediction.projection ? JSON.stringify(prediction.projection) : null,
        canonicalResultJson: prediction.canonicalResult ? JSON.stringify(prediction.canonicalResult) : null,
        selectedOutcomeProb: selectedProb,
        rawHomeWinProb,
        rawAwayWinProb,
        rawDrawProb,
        rawSelectedOutcomeProb: rawSelectedProb,
        marketHomeProb: ctx.marketConsensus?.noVigHomeProb ?? null,
        marketAwayProb: ctx.marketConsensus?.noVigAwayProb ?? null,
        marketDrawProb: ctx.marketConsensus?.noVigDrawProb ?? null,
        marketDivergence: newPred.marketComparison?.divergence ?? null,
        dataCoverage: decisionProfile?.dataCoverage ?? null,
        signalCoverage: decisionProfile?.signalCoverage ?? null,
        agreementScore: decisionProfile?.agreementScore ?? null,
        edgeRating: decisionProfile?.edgeRating ?? null,
        valueRating: decisionProfile?.valueRating ?? null,
        riskScore: decisionProfile?.riskScore ?? null,
        tagsJson: decisionProfile ? JSON.stringify(decisionProfile.tags) : null,
        dataSourcesJson: JSON.stringify(newPred.dataSources),
      };
      if (existing) {
        if (existing.actualWinner !== null || existing.wasCorrect !== null || existing.resolvedAt !== null) {
          return;
        }
        if (!shouldUpdatePredictionSnapshot(game)) {
          return;
        }
        await prisma.predictionResult.update({
          where: { gameId },
          data,
        });
        return;
      }
      await prisma.predictionResult.create({
        data: {
          gameId,
          ...data,
          actualWinner: null,
          actualOutcome: null,
          wasCorrect: null,
          resolvedAt: null,
        },
      });
    });
  }

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

const llmNarrativeInFlight = new Map<string, Promise<string | null>>();

export function __resetLLMEnrichmentDedupeForTests(): void {
  llmNarrativeInFlight.clear();
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

  const seasonContext =
    game.seasonContext ??
    deriveSeasonContext({ sport, gameTime: game.gameTime });
  const versionHash = computeVersionHash(prediction, injuries, seasonContext);
  const inFlightKey = `${game.id}:${versionHash}`;
  let narrativeTask = llmNarrativeInFlight.get(inFlightKey);

  if (!narrativeTask) {
    narrativeTask = resolveLLMNarrative(game, newPred, sport, injuries, seasonContext, versionHash);
    llmNarrativeInFlight.set(inFlightKey, narrativeTask);
    narrativeTask.finally(() => {
      if (llmNarrativeInFlight.get(inFlightKey) === narrativeTask) {
        llmNarrativeInFlight.delete(inFlightKey);
      }
    }).catch(() => {});
  }

  const narrative = await narrativeTask;
  if (narrative) {
    prediction.analysis = narrative;
  }
}

async function resolveLLMNarrative(
  game: Game,
  newPred: HonestPrediction,
  sport: string,
  injuries: ReturnType<typeof extractInjuryListForLLM>,
  seasonContext: ReturnType<typeof deriveSeasonContext>,
  versionHash: string,
): Promise<string | null> {
  // Tier-2 cache hit: reuse stored narrative, no OpenAI call.
  const cached = await getCachedLLMNarrative(game.id, versionHash);
  if (cached) {
    return cached;
  }

  if (isRateCapped()) {
    console.warn(
      `[llm-narrative] rate cap hit, skipping enrichment for gameId=${game.id}`,
    );
    return null;
  }

  const input = buildLLMNarrativeInput(game, newPred, sport, injuries);
  const result = await generateLLMNarrative(input);

  if (!result.text) {
    if (result.reason && result.reason !== "no_api_key") {
      console.log(
        `[llm-narrative] fallback (${result.reason}) gameId=${game.id}`,
      );
    }
    return null;
  }

  await putCachedLLMNarrative(
    game.id,
    versionHash,
    result.text,
    result.tokensUsed,
  );
  console.log(
    `[llm-narrative] generation success gameId=${game.id} tokens=${result.tokensUsed}`,
  );
  return result.text;
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
  const seasonContext =
    game.seasonContext ??
    deriveSeasonContext({ sport, gameTime: game.gameTime });
  const decisionFactors = buildDecisionNarrativeFactors(newPred, game);
  const narrativeInput = buildNarrativeInput(
    decisionFactors,
    band,
    newPred.confidence,
    game.homeTeam.abbreviation,
    game.awayTeam.abbreviation,
    winnerAbbr,
    sport,
    injuries,
    seasonContext,
    game.homeTeam.name,
    game.awayTeam.name,
  );
  prioritizeProjectionFactor(narrativeInput, decisionFactors);

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
    seasonContext,
  };
}
