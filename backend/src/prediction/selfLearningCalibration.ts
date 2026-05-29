import { prisma } from "../prisma";
import type {
  CanonicalFinalPick,
  CanonicalPredictionResult,
  CanonicalProbabilities,
  HonestPrediction,
} from "./types";
import { getConfidenceBand } from "./types";

export type LearningReliabilityBucket = {
  bucket: string;
  midpoint: number;
  predictedWinRate: number;
  actualWinRate: number;
  count: number;
};

export type LearningCalibrationSnapshot = {
  sport: string;
  sampleSize: number;
  generatedAt?: string | Date;
  reliabilityCurve: LearningReliabilityBucket[];
};

/**
 * Kill-switch for the self-learning calibration layer. Defaults to ENABLED so
 * shipped 2.11.0 behavior is preserved; set SELF_LEARNING_CALIBRATION_ENABLED to
 * "false"/"0"/"off"/"no" to disable it in production without a code revert. When
 * disabled, predictions serve the raw model probability with no adjustment.
 */
export function isSelfLearningCalibrationEnabled(): boolean {
  const raw = process.env.SELF_LEARNING_CALIBRATION_ENABLED;
  if (raw === undefined) return true;
  const value = raw.trim().toLowerCase();
  return !(value === "false" || value === "0" || value === "off" || value === "no");
}

const MIN_BUCKET_SAMPLE = 30;
const FULL_TRUST_BUCKET_SAMPLE = 100;
const MAX_BINARY_ADJUSTMENT = 0.03;
const MAX_THREE_WAY_ADJUSTMENT = 0.02;
const LEARNING_BLEND_RATE = 0.35;
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { expiresAt: number; snapshot: LearningCalibrationSnapshot | null }>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundProbability(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundConfidence(probability: number): number {
  return Math.round(probability * 1000) / 10;
}

function normalizeProbabilities(probabilities: CanonicalProbabilities): CanonicalProbabilities {
  const draw = probabilities.draw;
  const sum = probabilities.home + probabilities.away + (draw ?? 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    return draw === undefined
      ? { home: 0.5, away: 0.5 }
      : { home: 1 / 3, away: 1 / 3, draw: 1 / 3 };
  }
  return {
    home: roundProbability(probabilities.home / sum),
    away: roundProbability(probabilities.away / sum),
    ...(draw !== undefined ? { draw: roundProbability(draw / sum) } : {}),
  };
}

function probabilityForPick(probabilities: CanonicalProbabilities, pick: CanonicalFinalPick): number {
  if (pick === "home") return probabilities.home;
  if (pick === "away") return probabilities.away;
  if (pick === "draw") return probabilities.draw ?? 0;
  return Math.max(probabilities.home, probabilities.away, probabilities.draw ?? 0);
}

function pickFromProbabilities(probabilities: CanonicalProbabilities): CanonicalFinalPick {
  const entries: Array<{ pick: CanonicalFinalPick; probability: number }> = [
    { pick: "home", probability: probabilities.home },
    { pick: "away", probability: probabilities.away },
  ];
  if (probabilities.draw !== undefined) {
    entries.push({ pick: "draw", probability: probabilities.draw });
  }
  entries.sort((a, b) => b.probability - a.probability);
  const leader = entries[0];
  const runnerUp = entries[1];
  if (!leader || !runnerUp) return "none";
  if (Math.abs(leader.probability - runnerUp.probability) < 0.0001) return "none";
  return leader.pick;
}

function bucketRange(label: string): { min: number; max: number } | null {
  const match = /^(\d+)-(\d+)$/.exec(label);
  if (!match) return null;
  const min = Number(match[1]) / 100;
  const max = Number(match[2]) / 100;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}

function bucketForProbability(
  curve: LearningReliabilityBucket[],
  probability: number,
): LearningReliabilityBucket | null {
  return curve.find((bucket) => {
    const range = bucketRange(bucket.bucket);
    if (!range) return false;
    return probability >= range.min && probability < range.max;
  }) ?? null;
}

function boundedAdjustment(
  bucket: LearningReliabilityBucket,
  isThreeWay: boolean,
): number {
  if (bucket.count < MIN_BUCKET_SAMPLE) return 0;
  const predicted = Number.isFinite(bucket.predictedWinRate)
    ? bucket.predictedWinRate
    : bucket.midpoint;
  const error = bucket.actualWinRate - predicted;
  if (!Number.isFinite(error)) return 0;

  const trust = clamp(bucket.count / FULL_TRUST_BUCKET_SAMPLE, 0, 1);
  const maxAdjustment = (isThreeWay ? MAX_THREE_WAY_ADJUSTMENT : MAX_BINARY_ADJUSTMENT) * trust;
  const adjustment = clamp(error * LEARNING_BLEND_RATE * trust, -maxAdjustment, maxAdjustment);
  return Math.abs(adjustment) < 0.001 ? 0 : adjustment;
}

function adjustedBinaryProbabilities(
  probabilities: CanonicalProbabilities,
  pick: "home" | "away",
  adjustment: number,
): CanonicalProbabilities {
  const selected = probabilityForPick(probabilities, pick);
  const adjustedSelected = clamp(selected + adjustment, 0.5005, 0.97);
  return pick === "home"
    ? normalizeProbabilities({ home: adjustedSelected, away: 1 - adjustedSelected })
    : normalizeProbabilities({ home: 1 - adjustedSelected, away: adjustedSelected });
}

function adjustedThreeWayProbabilities(
  probabilities: CanonicalProbabilities,
  pick: Exclude<CanonicalFinalPick, "none">,
  adjustment: number,
): CanonicalProbabilities {
  const selected = probabilityForPick(probabilities, pick);
  const adjustedSelected = clamp(selected + adjustment, 0.01, 0.86);
  const remaining = Math.max(0.0001, 1 - selected);
  const adjustedRemaining = 1 - adjustedSelected;
  const scale = adjustedRemaining / remaining;

  return normalizeProbabilities({
    home: pick === "home" ? adjustedSelected : probabilities.home * scale,
    away: pick === "away" ? adjustedSelected : probabilities.away * scale,
    draw: pick === "draw"
      ? adjustedSelected
      : probabilities.draw !== undefined
        ? probabilities.draw * scale
        : undefined,
  });
}

function canonicalWithLearning(
  canonical: CanonicalPredictionResult,
  probabilities: CanonicalProbabilities,
  snapshot: LearningCalibrationSnapshot,
  bucket: LearningReliabilityBucket,
  adjustment: number,
): CanonicalPredictionResult {
  const finalPick = pickFromProbabilities(probabilities);
  const finalProbability = probabilityForPick(probabilities, finalPick);
  const confidence = roundConfidence(finalProbability);
  const evidence =
    `${snapshot.sport} ${bucket.bucket} bucket learned ${(adjustment * 100).toFixed(1)}pt ` +
    `from ${bucket.count} resolved predictions`;
  const learningRead = {
    engine: "self-learning-calibration-v1",
    pick: finalPick,
    probability: roundProbability(finalProbability),
    confidence,
    probabilities,
    inputs: {
      sport: snapshot.sport,
      bucket: bucket.bucket,
      bucketCount: bucket.count,
      predictedWinRate: roundProbability(bucket.predictedWinRate),
      actualWinRate: roundProbability(bucket.actualWinRate),
      adjustmentPts: roundProbability(adjustment) * 100,
    },
  };
  const engineBreakdown = [
    ...canonical.engineBreakdown.filter((read) => read.engine !== "orchestrator-v1"),
    learningRead,
    ...canonical.engineBreakdown
      .filter((read) => read.engine === "orchestrator-v1")
      .map((read) => ({ ...read, probabilities })),
  ];

  return {
    ...canonical,
    finalPick,
    finalProbability: roundProbability(finalProbability),
    confidence,
    probabilities,
    decisionProfile: canonical.decisionProfile
      ? {
          ...canonical.decisionProfile,
          pick: finalPick,
          probability: roundProbability(finalProbability),
          confidence,
          thesis: [...canonical.decisionProfile.thesis, evidence],
        }
      : undefined,
    engineBreakdown,
    reconciliation: {
      ...canonical.reconciliation,
      notes: [...canonical.reconciliation.notes, "Self-learning calibration adjusted the final probability from settled prediction results."],
    },
  };
}

export function applySelfLearningCalibration(
  prediction: HonestPrediction,
  snapshot: LearningCalibrationSnapshot | null,
): HonestPrediction {
  if (!snapshot || snapshot.sampleSize < MIN_BUCKET_SAMPLE) return prediction;

  const pick = prediction.canonicalResult.finalPick;
  if (pick === "none") return prediction;

  const currentProbabilities = normalizeProbabilities(prediction.canonicalResult.probabilities);
  const selectedProbability = probabilityForPick(currentProbabilities, pick);
  const bucket = bucketForProbability(snapshot.reliabilityCurve, selectedProbability);
  if (!bucket) return prediction;

  const isThreeWay = currentProbabilities.draw !== undefined;
  const adjustment = boundedAdjustment(bucket, isThreeWay);
  if (adjustment === 0) return prediction;

  const adjustedProbabilities = isThreeWay
    ? adjustedThreeWayProbabilities(currentProbabilities, pick, adjustment)
    : adjustedBinaryProbabilities(currentProbabilities, pick as "home" | "away", adjustment);
  const finalPick = pickFromProbabilities(adjustedProbabilities);
  const finalProbability = probabilityForPick(adjustedProbabilities, finalPick);
  const confidence = roundConfidence(finalProbability);
  const canonicalResult = canonicalWithLearning(
    prediction.canonicalResult,
    adjustedProbabilities,
    snapshot,
    bucket,
    adjustment,
  );

  // Derive predictedWinner from the RECOMPUTED finalPick so it never keeps a
  // stale side after a three-way adjustment flips the leader. Keep the existing
  // {teamId, abbr} only when it still matches finalPick's side; otherwise null
  // (downstream reconcile + translate fall back to the correct side).
  const homeTeamId = prediction.canonicalResult.modelInputs?.homeTeamId;
  const staleSide =
    prediction.predictedWinner && homeTeamId
      ? prediction.predictedWinner.teamId === homeTeamId
        ? "home"
        : "away"
      : null;
  const reconciledWinner =
    (finalPick === "home" || finalPick === "away") && staleSide === finalPick
      ? prediction.predictedWinner
      : null;

  return {
    ...prediction,
    canonicalResult,
    predictedWinner: reconciledWinner,
    homeWinProbability: adjustedProbabilities.home,
    awayWinProbability: adjustedProbabilities.away,
    drawProbability: adjustedProbabilities.draw,
    confidence,
    confidenceBand: getConfidenceBand(finalProbability),
    dataSources: prediction.dataSources.includes("self-learning calibration")
      ? prediction.dataSources
      : [...prediction.dataSources, "self-learning calibration"],
  };
}

export async function getSelfLearningCalibrationSnapshot(
  sport: string,
): Promise<LearningCalibrationSnapshot | null> {
  const now = Date.now();
  const cached = cache.get(sport);
  if (cached && cached.expiresAt > now) return cached.snapshot;

  try {
    const row = await prisma.calibrationSnapshot.findFirst({
      where: { league: sport },
      orderBy: { date: "desc" },
    });
    const snapshot = row
      ? {
          sport,
          sampleSize: row.sampleSize,
          generatedAt: row.date,
          reliabilityCurve: JSON.parse(row.reliabilityCurveJson) as LearningReliabilityBucket[],
        }
      : null;
    cache.set(sport, { expiresAt: now + CACHE_TTL_MS, snapshot });
    return snapshot;
  } catch (err) {
    console.warn(`[self-learning] failed to load calibration snapshot for ${sport}:`, err);
    cache.set(sport, { expiresAt: now + CACHE_TTL_MS, snapshot: null });
    return null;
  }
}

export function __resetSelfLearningCalibrationCacheForTests(): void {
  cache.clear();
}
