/**
 * Prediction Accuracy API
 * Returns calibration stats showing how well predictions perform by confidence level.
 */

import { Hono } from "hono";
import { prisma } from "../prisma";

export const accuracyRouter = new Hono();

const BUCKETS = [
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
    },
  });

  // --- Confidence buckets ---
  const bucketMap = new Map<string, { total: number; correct: number }>();
  for (const b of BUCKETS) {
    bucketMap.set(b.label, { total: 0, correct: 0 });
  }

  // --- Per-sport ---
  const sportMap = new Map<string, { total: number; correct: number }>();

  // --- Toss-up ---
  let tossUpTotal = 0;
  let tossUpCorrect = 0;

  // --- Overall ---
  let totalResolved = 0;
  let totalCorrect = 0;

  for (const row of resolved) {
    totalResolved++;
    const correct = row.wasCorrect === true;
    if (correct) totalCorrect++;

    // Bucket
    const bucket = BUCKETS.find((b) => row.confidence >= b.min && row.confidence <= b.max);
    if (bucket) {
      const entry = bucketMap.get(bucket.label)!;
      entry.total++;
      if (correct) entry.correct++;
    }

    // Per-sport
    if (!sportMap.has(row.sport)) {
      sportMap.set(row.sport, { total: 0, correct: 0 });
    }
    const sportEntry = sportMap.get(row.sport)!;
    sportEntry.total++;
    if (correct) sportEntry.correct++;

    // Toss-up
    if (row.isTossUp) {
      tossUpTotal++;
      if (correct) tossUpCorrect++;
    }
  }

  const buckets = BUCKETS.map((b) => {
    const entry = bucketMap.get(b.label)!;
    return {
      bucket: b.label,
      totalPredictions: entry.total,
      correctPredictions: entry.correct,
      accuracy: entry.total > 0 ? Math.round((entry.correct / entry.total) * 100) : null,
    };
  });

  const perSport = Array.from(sportMap.entries()).map(([sport, s]) => ({
    sport,
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
      },
      perSport,
      tossUp: {
        total: tossUpTotal,
        correct: tossUpCorrect,
        accuracy: tossUpTotal > 0 ? Math.round((tossUpCorrect / tossUpTotal) * 100) : null,
      },
    },
  });
});

accuracyRouter.get("/drift", async (c) => {
  try {
    const sport = c.req.query("sport") || undefined;
    const predictions = await prisma.predictionResult.findMany({
      where: { wasCorrect: { not: null }, ...(sport ? { sport } : {}) },
      select: { wasCorrect: true, confidence: true, createdAt: true, sport: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const now = Date.now();
    const DAY = 86400000;
    const resolved = predictions.filter(p => p.wasCorrect !== null);
    if (resolved.length < 20) {
      return c.json({ isDrifting: false, message: "Need 20+ resolved predictions", data: null });
    }
    const calcAcc = (preds: typeof resolved) => preds.length === 0 ? null : preds.filter(p => p.wasCorrect).length / preds.length;
    const last7d = resolved.filter(p => now - p.createdAt.getTime() < 7 * DAY);
    const last30d = resolved.filter(p => now - p.createdAt.getTime() < 30 * DAY);
    const acc7d = calcAcc(last7d);
    const acc30d = calcAcc(last30d);
    const accAll = calcAcc(resolved);
    const isDrifting = (acc7d !== null && accAll !== null && last7d.length >= 5 && accAll - acc7d > 0.08) ||
                       (acc30d !== null && accAll !== null && last30d.length >= 15 && accAll - acc30d > 0.08);
    return c.json({
      isDrifting,
      rollingAccuracy7d: acc7d !== null ? Math.round(acc7d * 100) : null,
      rollingAccuracy30d: acc30d !== null ? Math.round(acc30d * 100) : null,
      allTimeAccuracy: accAll !== null ? Math.round(accAll * 100) : null,
      sample: { total: resolved.length, last7d: last7d.length, last30d: last30d.length },
    });
  } catch (err) {
    return c.json({ error: "Drift detection failed" }, 500);
  }
});
