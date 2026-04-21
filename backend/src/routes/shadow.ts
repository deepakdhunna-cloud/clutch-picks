/**
 * Shadow comparison admin endpoints.
 *
 * Read-only views into the shadow prediction logs so we can back-test the
 * new engine against the old one before cutting over.
 *
 *   GET /api/shadow/logs                — aggregated stats across all shadow logs
 *   GET /api/shadow/resolved-comparison — head-to-head accuracy on resolved games
 *   GET /api/shadow/recent?limit=50     — last N raw shadow entries
 *
 * All endpoints are gated on the CALIBRATION_ADMIN_KEY header.
 */

import { Hono } from "hono";
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { prisma } from "../prisma";

const shadowRouter = new Hono();

// ─── Types ──────────────────────────────────────────────────────────────

interface ShadowEntry {
  timestamp: string;
  gameId: string;
  league: string;
  matchup: string;
  scheduledStart: string;
  old: {
    predictedWinner: string;
    homeWinProb: number;
    confidence: number;
  };
  new: {
    predictedWinner: string | null;
    homeWinProb: number;
    confidence: number;
    confidenceBand: string;
    unavailableFactors: string[];
  };
  agreement: boolean;
  confidenceDelta: number;
}

// ─── In-memory cache (5-minute TTL) ────────────────────────────────────

const LOGS_DIR = join(__dirname, "../../logs");
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedEntries: ShadowEntry[] | null = null;
let cacheTimestamp = 0;

async function loadAllEntries(): Promise<ShadowEntry[]> {
  const now = Date.now();
  if (cachedEntries && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedEntries;
  }

  if (!existsSync(LOGS_DIR)) {
    cachedEntries = [];
    cacheTimestamp = now;
    return [];
  }

  const files = (await readdir(LOGS_DIR)).filter((f) =>
    f.startsWith("prediction_shadow_") && f.endsWith(".jsonl") && !f.includes("errors"),
  );

  if (files.length === 0) {
    cachedEntries = [];
    cacheTimestamp = now;
    return [];
  }

  const entries: ShadowEntry[] = [];

  for (const file of files.sort()) {
    const content = await readFile(join(LOGS_DIR, file), "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as ShadowEntry);
      } catch {
        // Skip malformed lines
      }
    }
  }

  cachedEntries = entries;
  cacheTimestamp = now;
  return entries;
}

// ─── Admin key guard ───────────────────────────────────────────────────

function checkAdminKey(c: any): Response | null {
  const adminKey = process.env.CALIBRATION_ADMIN_KEY;
  if (!adminKey) {
    return c.json(
      { error: { message: "CALIBRATION_ADMIN_KEY not configured", code: "ADMIN_KEY_UNSET" } },
      503,
    );
  }
  const provided = c.req.header("x-calibration-admin-key");
  if (provided !== adminKey) {
    return c.json(
      { error: { message: "Forbidden", code: "FORBIDDEN" } },
      403,
    );
  }
  return null;
}

// ─── GET /api/shadow/logs ──────────────────────────────────────────────

shadowRouter.get("/logs", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  const entries = await loadAllEntries();

  if (entries.length === 0) {
    return c.json({
      data: {
        totalComparisons: 0,
        perSport: {},
        dailyBreakdown: [],
        note: "No shadow logs found. Logs directory may be empty or not yet populated.",
      },
    });
  }

  // Per-sport aggregation
  const sportMap = new Map<string, {
    count: number;
    agreements: number;
    oldConfSum: number;
    newConfSum: number;
    deltaSum: number;
    unavailableCount: number;
  }>();

  // Daily aggregation
  const dayMap = new Map<string, { count: number; agreements: number }>();

  for (const e of entries) {
    // Sport
    const sport = e.league;
    let s = sportMap.get(sport);
    if (!s) {
      s = { count: 0, agreements: 0, oldConfSum: 0, newConfSum: 0, deltaSum: 0, unavailableCount: 0 };
      sportMap.set(sport, s);
    }
    s.count++;
    if (e.agreement) s.agreements++;
    s.oldConfSum += e.old.confidence;
    s.newConfSum += e.new.confidence;
    s.deltaSum += e.confidenceDelta;
    if (e.new.unavailableFactors.length > 0) s.unavailableCount++;

    // Day
    const day = e.timestamp.slice(0, 10);
    let d = dayMap.get(day);
    if (!d) {
      d = { count: 0, agreements: 0 };
      dayMap.set(day, d);
    }
    d.count++;
    if (e.agreement) d.agreements++;
  }

  const perSport: Record<string, any> = {};
  for (const [sport, s] of Array.from(sportMap.entries())) {
    perSport[sport] = {
      count: s.count,
      agreementRate: +(s.agreements / s.count * 100).toFixed(1),
      avgOldConfidence: +(s.oldConfSum / s.count).toFixed(1),
      avgNewConfidence: +(s.newConfSum / s.count).toFixed(1),
      avgConfidenceDelta: +(s.deltaSum / s.count).toFixed(2),
      newEngineUnavailableFactors: s.unavailableCount,
    };
  }

  const dailyBreakdown = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      count: d.count,
      agreementRate: +(d.agreements / d.count * 100).toFixed(1),
    }));

  return c.json({
    data: {
      totalComparisons: entries.length,
      perSport,
      dailyBreakdown,
    },
  });
});

// ─── GET /api/shadow/resolved-comparison ───────────────────────────────

shadowRouter.get("/resolved-comparison", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  const entries = await loadAllEntries();

  if (entries.length === 0) {
    return c.json({
      data: {
        perSport: [],
        newEngineWins: false,
        note: "No shadow logs found.",
      },
    });
  }

  // Collect unique gameIds
  const gameIds = Array.from(new Set(entries.map((e) => e.gameId)));

  // Fetch resolved predictions from database
  const resolved = await prisma.predictionResult.findMany({
    where: {
      gameId: { in: gameIds },
      wasCorrect: { not: null },
    },
    select: {
      gameId: true,
      actualWinner: true,
    },
  });

  const resolvedMap = new Map(resolved.map((r) => [r.gameId, r.actualWinner]));

  // Per-sport head-to-head
  const sportStats = new Map<string, {
    oldCorrect: number;
    newCorrect: number;
    oldTotal: number;
    newTotal: number;
  }>();

  for (const e of entries) {
    const actual = resolvedMap.get(e.gameId);
    if (!actual) continue; // Game not resolved yet

    const sport = e.league;
    let s = sportStats.get(sport);
    if (!s) {
      s = { oldCorrect: 0, newCorrect: 0, oldTotal: 0, newTotal: 0 };
      sportStats.set(sport, s);
    }

    // Old engine
    s.oldTotal++;
    if (e.old.predictedWinner === actual) s.oldCorrect++;

    // New engine (skip if it didn't produce a pick)
    if (e.new.predictedWinner) {
      s.newTotal++;
      if (e.new.predictedWinner === actual) s.newCorrect++;
    }
  }

  const perSport = Array.from(sportStats.entries()).map(([sport, s]) => ({
    sport,
    oldCorrect: s.oldCorrect,
    newCorrect: s.newCorrect,
    oldTotal: s.oldTotal,
    newTotal: s.newTotal,
    oldAccuracy: s.oldTotal > 0 ? +(s.oldCorrect / s.oldTotal * 100).toFixed(1) : 0,
    newAccuracy: s.newTotal > 0 ? +(s.newCorrect / s.newTotal * 100).toFixed(1) : 0,
    accuracyDelta: s.oldTotal > 0 && s.newTotal > 0
      ? +((s.newCorrect / s.newTotal - s.oldCorrect / s.oldTotal) * 100).toFixed(1)
      : 0,
  }));

  // Overall
  const totalOldCorrect = perSport.reduce((sum, s) => sum + s.oldCorrect, 0);
  const totalOldTotal = perSport.reduce((sum, s) => sum + s.oldTotal, 0);
  const totalNewCorrect = perSport.reduce((sum, s) => sum + s.newCorrect, 0);
  const totalNewTotal = perSport.reduce((sum, s) => sum + s.newTotal, 0);

  const overallOldAcc = totalOldTotal > 0 ? totalOldCorrect / totalOldTotal : 0;
  const overallNewAcc = totalNewTotal > 0 ? totalNewCorrect / totalNewTotal : 0;

  return c.json({
    data: {
      perSport,
      newEngineWins: totalNewTotal > 0 && overallNewAcc > overallOldAcc,
      overall: {
        oldAccuracy: +(overallOldAcc * 100).toFixed(1),
        newAccuracy: +(overallNewAcc * 100).toFixed(1),
        resolvedGames: totalOldTotal,
      },
    },
  });
});

// ─── GET /api/shadow/recent ────────────────────────────────────────────

shadowRouter.get("/recent", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 500);
  const entries = await loadAllEntries();

  // Most recent first
  const recent = entries
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);

  return c.json({ data: recent });
});

export { shadowRouter };
