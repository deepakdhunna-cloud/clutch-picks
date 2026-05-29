/**
 * Prediction Accuracy API
 * Returns calibration stats showing how well predictions perform by confidence level.
 */

import { Hono } from "hono";
import { prisma } from "../prisma";

export const accuracyRouter = new Hono();

export interface DriftResponseData {
  isDrifting: boolean;
  rollingAccuracy7d: number | null;
  rollingAccuracy30d: number | null;
  allTimeAccuracy: number | null;
  sample: { total: number; last7d: number; last30d: number };
  message?: string;
}

type DriftPredictionRow = {
  wasCorrect: boolean | null;
  createdAt: Date;
};

export function buildDriftApiResponse(
  predictions: DriftPredictionRow[],
  now = Date.now(),
): { data: DriftResponseData } {
  const DAY = 86400000;
  const resolved = predictions.filter(
    (p): p is DriftPredictionRow & { wasCorrect: boolean } => p.wasCorrect !== null,
  );
  const last7d = resolved.filter((p) => now - p.createdAt.getTime() < 7 * DAY);
  const last30d = resolved.filter((p) => now - p.createdAt.getTime() < 30 * DAY);

  if (resolved.length < 20) {
    return {
      data: {
        isDrifting: false,
        rollingAccuracy7d: null,
        rollingAccuracy30d: null,
        allTimeAccuracy: null,
        sample: { total: resolved.length, last7d: last7d.length, last30d: last30d.length },
        message: "Need 20+ resolved predictions",
      },
    };
  }

  const calcAcc = (preds: Array<DriftPredictionRow & { wasCorrect: boolean }>) =>
    preds.length === 0 ? null : preds.filter((p) => p.wasCorrect).length / preds.length;
  const acc7d = calcAcc(last7d);
  const acc30d = calcAcc(last30d);
  const accAll = calcAcc(resolved);
  const isDrifting =
    (acc7d !== null && accAll !== null && last7d.length >= 5 && accAll - acc7d > 0.08) ||
    (acc30d !== null && accAll !== null && last30d.length >= 15 && accAll - acc30d > 0.08);

  return {
    data: {
      isDrifting,
      rollingAccuracy7d: acc7d !== null ? Math.round(acc7d * 100) : null,
      rollingAccuracy30d: acc30d !== null ? Math.round(acc30d * 100) : null,
      allTimeAccuracy: accAll !== null ? Math.round(accAll * 100) : null,
      sample: { total: resolved.length, last7d: last7d.length, last30d: last30d.length },
    },
  };
}

const BUCKETS = [
  { label: "25-29", min: 25, max: 29 },
  { label: "30-34", min: 30, max: 34 },
  { label: "35-39", min: 35, max: 39 },
  { label: "40-44", min: 40, max: 44 },
  { label: "45-49", min: 45, max: 49 },
  { label: "50-54", min: 50, max: 54 },
  { label: "55-59", min: 55, max: 59 },
  { label: "60-64", min: 60, max: 64 },
  { label: "65-69", min: 65, max: 69 },
  { label: "70-74", min: 70, max: 74 },
  { label: "75-79", min: 75, max: 79 },
  { label: "80-84", min: 80, max: 84 },
  { label: "85-89", min: 85, max: 89 },
  { label: "90-94", min: 90, max: 94 },
];

// GET /api/predictions/accuracy — public, no auth required
accuracyRouter.get("/accuracy", async (c) => {
  const resolved = await prisma.predictionResult.findMany({
    where: { wasCorrect: { not: null } },
    select: {
      sport: true,
      confidence: true,
      wasCorrect: true,
      isTossUp: true,
      modelVersion: true,
      predictedOutcome: true,
      actualOutcome: true,
      selectedOutcomeProb: true,
      brierScore: true,
      logLoss: true,
      dataCoverage: true,
      signalCoverage: true,
    },
  });

  // --- Confidence buckets ---
  const bucketMap = new Map<string, { total: number; correct: number; probabilitySum: number }>();
  for (const b of BUCKETS) {
    bucketMap.set(b.label, { total: 0, correct: 0, probabilitySum: 0 });
  }

  // --- Per-sport ---
  const sportMap = new Map<string, { total: number; correct: number }>();

  // --- Toss-up ---
  let tossUpTotal = 0;
  let tossUpCorrect = 0;

  // --- Per engine/model version ---
  const versionMap = new Map<string, { total: number; correct: number }>();

  // --- Draw-aware audit ---
  let drawResolved = 0;
  let drawCorrect = 0;
  let brierSum = 0;
  let brierCount = 0;
  let logLossSum = 0;
  let logLossCount = 0;
  let dataCoverageSum = 0;
  let dataCoverageCount = 0;
  let signalCoverageSum = 0;
  let signalCoverageCount = 0;

  // --- Overall ---
  let totalResolved = 0;
  let totalCorrect = 0;

  for (const row of resolved) {
    totalResolved++;
    const correct = row.wasCorrect === true;
    if (correct) totalCorrect++;
    if (typeof row.brierScore === "number") {
      brierSum += row.brierScore;
      brierCount++;
    }
    if (typeof row.logLoss === "number") {
      logLossSum += row.logLoss;
      logLossCount++;
    }
    if (typeof row.dataCoverage === "number") {
      dataCoverageSum += row.dataCoverage;
      dataCoverageCount++;
    }
    if (typeof row.signalCoverage === "number") {
      signalCoverageSum += row.signalCoverage;
      signalCoverageCount++;
    }

    // Bucket by the selected-outcome probability captured at prediction time.
    // This is more precise than the rounded display confidence and keeps
    // three-way soccer/draw reads in the correct sub-50 buckets.
    const selectedProbPct =
      typeof row.selectedOutcomeProb === "number" && Number.isFinite(row.selectedOutcomeProb)
        ? row.selectedOutcomeProb * 100
        : row.confidence;
    const bucket = BUCKETS.find((b) => selectedProbPct >= b.min && selectedProbPct <= b.max);
    if (bucket) {
      const entry = bucketMap.get(bucket.label)!;
      entry.total++;
      entry.probabilitySum += selectedProbPct;
      if (correct) entry.correct++;
    }

    // Per-sport
    if (!sportMap.has(row.sport)) {
      sportMap.set(row.sport, { total: 0, correct: 0 });
    }
    const sportEntry = sportMap.get(row.sport)!;
    sportEntry.total++;
    if (correct) sportEntry.correct++;

    const version = row.modelVersion ?? "unknown";
    if (!versionMap.has(version)) {
      versionMap.set(version, { total: 0, correct: 0 });
    }
    const versionEntry = versionMap.get(version)!;
    versionEntry.total++;
    if (correct) versionEntry.correct++;

    if (row.predictedOutcome === "draw" || row.actualOutcome === "draw") {
      drawResolved++;
      if (correct) drawCorrect++;
    }

    // Toss-up
    if (row.isTossUp) {
      tossUpTotal++;
      if (correct) tossUpCorrect++;
    }
  }

  const buckets = BUCKETS.map((b) => {
    const entry = bucketMap.get(b.label)!;
    const expectedAccuracy = entry.total > 0
      ? Math.round((entry.probabilitySum / entry.total) * 10) / 10
      : null;
    const accuracy = entry.total > 0 ? Math.round((entry.correct / entry.total) * 100) : null;
    return {
      bucket: b.label,
      totalPredictions: entry.total,
      correctPredictions: entry.correct,
      accuracy,
      expectedAccuracy,
      calibrationErrorPts:
        accuracy !== null && expectedAccuracy !== null
          ? Math.round((expectedAccuracy - accuracy) * 10) / 10
          : null,
    };
  });

  const perSport = Array.from(sportMap.entries()).map(([sport, s]) => ({
    sport,
    total: s.total,
    correct: s.correct,
    accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : null,
  }));

  const byModelVersion = Array.from(versionMap.entries()).map(([modelVersion, s]) => ({
    modelVersion,
    total: s.total,
    correct: s.correct,
    accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : null,
  }));

  return c.json({
    data: {
      buckets,
      overall: {
        totalResolved,
        totalCorrect,
        overallAccuracy: totalResolved > 0 ? Math.round((totalCorrect / totalResolved) * 100) : null,
        brierScore: brierCount > 0 ? Math.round((brierSum / brierCount) * 10000) / 10000 : null,
        logLoss: logLossCount > 0 ? Math.round((logLossSum / logLossCount) * 10000) / 10000 : null,
        avgDataCoverage: dataCoverageCount > 0 ? Math.round((dataCoverageSum / dataCoverageCount) * 1000) / 1000 : null,
        avgSignalCoverage: signalCoverageCount > 0 ? Math.round((signalCoverageSum / signalCoverageCount) * 1000) / 1000 : null,
      },
      perSport,
      tossUp: {
        total: tossUpTotal,
        correct: tossUpCorrect,
        accuracy: tossUpTotal > 0 ? Math.round((tossUpCorrect / tossUpTotal) * 100) : null,
      },
      drawAudit: {
        total: drawResolved,
        correct: drawCorrect,
        accuracy: drawResolved > 0 ? Math.round((drawCorrect / drawResolved) * 100) : null,
      },
      byModelVersion,
    },
  });
});

accuracyRouter.get("/drift", async (c) => {
  try {
    const sport = c.req.query("sport") || undefined;
    const predictions = await prisma.predictionResult.findMany({
      where: { wasCorrect: { not: null }, ...(sport ? { sport } : {}) },
      select: { wasCorrect: true, confidence: true, selectedOutcomeProb: true, createdAt: true, sport: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return c.json(buildDriftApiResponse(predictions));
  } catch (err) {
    return c.json({ error: "Drift detection failed" }, 500);
  }
});
