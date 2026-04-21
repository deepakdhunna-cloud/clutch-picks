/**
 * Shadow comparison admin endpoints.
 *
 * Read-only views into the shadow prediction logs so we can back-test the
 * new engine against the old one before cutting over.
 *
 *   GET /api/shadow/logs                — aggregated stats across all shadow logs
 *   GET /api/shadow/resolved-comparison — head-to-head accuracy on resolved games
 *   GET /api/shadow/recent?limit=50     — last N raw shadow entries
 *   GET /api/shadow/understat-diag      — diagnostic: Understat cache state
 *
 * All endpoints are gated on the CALIBRATION_ADMIN_KEY header.
 * Reads from the ShadowComparison Postgres table (survives Railway redeploys).
 */

import { Hono } from "hono";
import { prisma } from "../prisma";
import {
  fetchLeagueXG,
  lookupInLeague,
  normalizeSoccerTeamName,
  type UnderstatLeague,
} from "../lib/understatApi";

const shadowRouter = new Hono();

// ─── In-memory cache (5-minute TTL) ────────────────────────────────────

interface CachedRow {
  gameId: string;
  league: string;
  matchup: string;
  scheduledStart: Date;
  oldPredictedWinner: string;
  oldHomeWinProb: number;
  oldConfidence: number;
  newPredictedWinner: string | null;
  newHomeWinProb: number;
  newAwayWinProb: number;
  newDrawProb: number | null;
  newConfidence: number;
  newConfidenceBand: string;
  unavailableFactorsJson: string;
  agreement: boolean;
  confidenceDelta: number;
  createdAt: Date;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedRows: CachedRow[] | null = null;
let cacheTimestamp = 0;

async function loadAllRows(): Promise<CachedRow[]> {
  const now = Date.now();
  if (cachedRows && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedRows;
  }

  const rows = await prisma.shadowComparison.findMany({
    select: {
      gameId: true,
      league: true,
      matchup: true,
      scheduledStart: true,
      oldPredictedWinner: true,
      oldHomeWinProb: true,
      oldConfidence: true,
      newPredictedWinner: true,
      newHomeWinProb: true,
      newAwayWinProb: true,
      newDrawProb: true,
      newConfidence: true,
      newConfidenceBand: true,
      unavailableFactorsJson: true,
      agreement: true,
      confidenceDelta: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  cachedRows = rows;
  cacheTimestamp = now;
  return rows;
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

  const rows = await loadAllRows();

  if (rows.length === 0) {
    return c.json({
      data: {
        totalComparisons: 0,
        perSport: {},
        dailyBreakdown: [],
        warnings: [],
        note: "No shadow comparisons found in the database.",
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

  for (const r of rows) {
    // Sport
    const sport = r.league;
    let s = sportMap.get(sport);
    if (!s) {
      s = { count: 0, agreements: 0, oldConfSum: 0, newConfSum: 0, deltaSum: 0, unavailableCount: 0 };
      sportMap.set(sport, s);
    }
    s.count++;
    if (r.agreement) s.agreements++;
    s.oldConfSum += r.oldConfidence;
    s.newConfSum += r.newConfidence;
    s.deltaSum += r.confidenceDelta;
    const factors: string[] = JSON.parse(r.unavailableFactorsJson);
    if (factors.length > 0) s.unavailableCount++;

    // Day
    const day = r.createdAt.toISOString().slice(0, 10);
    let d = dayMap.get(day);
    if (!d) {
      d = { count: 0, agreements: 0 };
      dayMap.set(day, d);
    }
    d.count++;
    if (r.agreement) d.agreements++;
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

  // ─── Warnings: scan for inconsistencies ──────────────────────────────
  const SOCCER = new Set(["EPL", "MLS", "UCL"]);
  const warnings: string[] = [];

  const confidenceMismatchIds: string[] = [];
  const winnerMismatchIds: string[] = [];
  let missingDrawCount = 0;

  for (const r of rows) {
    const maxP = Math.max(r.newHomeWinProb, r.newAwayWinProb, r.newDrawProb ?? 0);
    const expectedConf = Math.round(maxP * 1000) / 10;
    if (Math.abs(r.newConfidence - expectedConf) > 0.1) {
      confidenceMismatchIds.push(r.gameId);
    }

    if (r.newPredictedWinner !== null) {
      // Determine which side the predicted winner is on — we don't have
      // the team IDs in the cached row, but we do have newHomeWinProb/newAwayWinProb.
      // If newPredictedWinner is set and the corresponding prob is not max, flag it.
      const homeIsMax = r.newHomeWinProb >= r.newAwayWinProb && r.newHomeWinProb >= (r.newDrawProb ?? 0);
      const awayIsMax = r.newAwayWinProb >= r.newHomeWinProb && r.newAwayWinProb >= (r.newDrawProb ?? 0);
      // We can't definitively match winner to home/away from the abbreviation alone,
      // but if neither home nor away is max (draw is max), that's a clear mismatch.
      if (!homeIsMax && !awayIsMax) {
        winnerMismatchIds.push(r.gameId);
      }
    }

    if (SOCCER.has(r.league) && r.newDrawProb === null) {
      missingDrawCount++;
    }
  }

  if (confidenceMismatchIds.length > 0) {
    const examples = confidenceMismatchIds.slice(0, 3).join(", ");
    warnings.push(
      `${confidenceMismatchIds.length} comparisons have confidence/probability mismatch — example gameIds: ${examples}`,
    );
  }
  if (winnerMismatchIds.length > 0) {
    const examples = winnerMismatchIds.slice(0, 3).join(", ");
    warnings.push(
      `${winnerMismatchIds.length} comparisons have predictedWinner inconsistent with probabilities — example gameIds: ${examples}`,
    );
  }
  if (missingDrawCount > 0) {
    warnings.push(
      `${missingDrawCount} soccer comparisons stored without draw probability`,
    );
  }

  return c.json({
    data: {
      totalComparisons: rows.length,
      perSport,
      dailyBreakdown,
      warnings,
    },
  });
});

// ─── GET /api/shadow/resolved-comparison ───────────────────────────────

shadowRouter.get("/resolved-comparison", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  const rows = await loadAllRows();

  if (rows.length === 0) {
    return c.json({
      data: {
        perSport: [],
        newEngineWins: false,
        note: "No shadow comparisons found in the database.",
      },
    });
  }

  // Collect unique gameIds
  const gameIds = Array.from(new Set(rows.map((r) => r.gameId)));

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

  for (const r of rows) {
    const actual = resolvedMap.get(r.gameId);
    if (!actual) continue; // Game not resolved yet

    const sport = r.league;
    let s = sportStats.get(sport);
    if (!s) {
      s = { oldCorrect: 0, newCorrect: 0, oldTotal: 0, newTotal: 0 };
      sportStats.set(sport, s);
    }

    // Old engine
    s.oldTotal++;
    if (r.oldPredictedWinner === actual) s.oldCorrect++;

    // New engine (skip if it didn't produce a pick)
    if (r.newPredictedWinner) {
      s.newTotal++;
      if (r.newPredictedWinner === actual) s.newCorrect++;
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

  const rows = await prisma.shadowComparison.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const data = rows.map((r) => ({
    timestamp: r.createdAt.toISOString(),
    gameId: r.gameId,
    league: r.league,
    matchup: r.matchup,
    scheduledStart: r.scheduledStart.toISOString(),
    old: {
      predictedWinner: r.oldPredictedWinner,
      homeWinProb: r.oldHomeWinProb,
      confidence: r.oldConfidence,
    },
    new: {
      predictedWinner: r.newPredictedWinner,
      homeWinProb: r.newHomeWinProb,
      confidence: r.newConfidence,
      confidenceBand: r.newConfidenceBand,
      unavailableFactors: JSON.parse(r.unavailableFactorsJson),
    },
    agreement: r.agreement,
    confidenceDelta: r.confidenceDelta,
  }));

  return c.json({ data });
});

// ─── GET /api/shadow/understat-diag ────────────────────────────────────

/**
 * One-time diagnostic: fetches every Understat league and returns the
 * normalized team-name keys in each cache. Lets us see exactly what
 * Understat has vs what ESPN sends so we can expand the alias map.
 */
shadowRouter.get("/understat-diag", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  const leagues: UnderstatLeague[] = ["EPL", "La_Liga", "Bundesliga", "Serie_A", "Ligue_1"];
  const result: Record<string, { teamCount: number; normalizedKeys: string[] } | { error: string }> = {};

  for (const league of leagues) {
    try {
      const map = await fetchLeagueXG(league);
      if (!map) {
        result[league] = { error: "fetch returned null (timeout or parse failure)" };
      } else {
        const keys = Array.from(map.keys()).sort();
        result[league] = { teamCount: keys.length, normalizedKeys: keys };
      }
    } catch (err: any) {
      result[league] = { error: err?.message ?? String(err) };
    }
  }

  // Also test a few known problematic lookups
  const testLookups = [
    { espnName: "Chelsea", league: "EPL" as UnderstatLeague },
    { espnName: "Brighton & Hove Albion", league: "EPL" as UnderstatLeague },
    { espnName: "Brighton", league: "EPL" as UnderstatLeague },
  ];

  const lookupResults = [];
  for (const t of testLookups) {
    const map = await fetchLeagueXG(t.league);
    const hit = lookupInLeague(map, t.espnName, t.league);
    lookupResults.push({
      espnName: t.espnName,
      league: t.league,
      normalizedTo: normalizeSoccerTeamName(t.espnName),
      found: !!hit,
      understatName: hit?.name ?? null,
    });
  }

  return c.json({
    data: {
      leagues: result,
      testLookups: lookupResults,
    },
  });
});

export { shadowRouter };
