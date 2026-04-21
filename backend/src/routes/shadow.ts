/**
 * Shadow comparison admin endpoints.
 *
 * Read-only views into the shadow prediction logs so we can back-test the
 * new engine against the old one before cutting over.
 *
 *   GET /api/shadow/logs                — aggregated stats across all shadow logs
 *   GET /api/shadow/resolved-comparison — head-to-head accuracy on resolved games
 *   GET /api/shadow/recent?limit=50     — last N raw shadow entries
 *   GET /api/shadow/fbref-diag           — diagnostic: FBRef xG source state
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
  type FBRefLeague,
} from "../lib/fbrefApi";

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

// ─── GET /api/shadow/fbref-diag ───────────────────────────────────────

/**
 * Raw diagnostic: bypasses the cached fetchLeagueXG and issues direct fetches
 * to FBRef. For EPL, returns the FULL body (up to 200KB) plus pattern
 * analysis. Other leagues get lightweight summary only.
 */
shadowRouter.get("/fbref-diag", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  const FBREF_URLS: Record<FBRefLeague, string> = {
    EPL: "https://fbref.com/en/comps/9/Premier-League-Stats",
    La_Liga: "https://fbref.com/en/comps/12/La-Liga-Stats",
    Bundesliga: "https://fbref.com/en/comps/20/Bundesliga-Stats",
    Serie_A: "https://fbref.com/en/comps/11/Serie-A-Stats",
    Ligue_1: "https://fbref.com/en/comps/13/Ligue-1-Stats",
  };
  const leagues: FBRefLeague[] = ["EPL", "La_Liga", "Bundesliga", "Serie_A", "Ligue_1"];

  // Pattern scan helpers — look for FBRef table structures
  const PATTERNS_TO_CHECK = ["data-stat=\"xg_for\"", "data-stat=\"team\"", "_overall", "xg_against", "<!--", "<table"];

  function scanPatterns(body: string) {
    const matches: Record<string, { found: boolean; context: string | null }> = {};
    for (const pat of PATTERNS_TO_CHECK) {
      const idx = body.indexOf(pat);
      if (idx >= 0) {
        const ctxStart = Math.max(0, idx - 50);
        const ctxEnd = Math.min(body.length, idx + pat.length + 250);
        matches[pat] = { found: true, context: body.slice(ctxStart, ctxEnd) };
      } else {
        matches[pat] = { found: false, context: null };
      }
    }
    return matches;
  }

  function countTableTags(body: string): number {
    const re = /<table/gi;
    let count = 0;
    while (re.exec(body)) count++;
    return count;
  }

  const results: Record<string, any> = {};

  for (const league of leagues) {
    const url = FBREF_URLS[league];
    const start = Date.now();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Connection": "keep-alive",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
        },
      });
      const durationMs = Date.now() - start;
      const body = await response.text();

      const relevantHeaders: Record<string, string> = {};
      for (const key of ["content-type", "cf-ray", "server", "x-robots-tag"]) {
        const val = response.headers.get(key);
        if (val) relevantHeaders[key] = val;
      }

      const hasOverallTable = body.includes("_overall");
      const isCloudflare = body.includes("Just a moment") || body.includes("Checking your browser");

      const entry: Record<string, any> = {
        url,
        httpStatus: response.status,
        headers: relevantHeaders,
        bodyLength: body.length,
        bodyPreview: body.slice(0, 500),
        hasOverallTable,
        isCloudflareChallenge: isCloudflare,
        tableTagCount: countTableTags(body),
        patternScan: scanPatterns(body),
        durationMs,
      };

      // For EPL only: include full body (up to 200KB) for deep inspection
      if (league === "EPL") {
        entry.fullBody = body.slice(0, 200_000);
      }

      results[league] = entry;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      results[league] = {
        url,
        error: err?.message ?? String(err),
        errorName: err?.name,
        durationMs,
      };
    }
  }

  // Also run the cached path for comparison
  const cachedResults: Record<string, any> = {};
  for (const league of leagues) {
    try {
      const map = await fetchLeagueXG(league);
      if (!map) {
        cachedResults[league] = { status: "null" };
      } else {
        cachedResults[league] = { status: "ok", teamCount: map.size };
      }
    } catch (err: any) {
      cachedResults[league] = { status: "error", message: err?.message };
    }
  }

  // Test lookups to verify canonicalization
  const testLookups = [
    { espnName: "Chelsea", league: "EPL" as FBRefLeague },
    { espnName: "Manchester United", league: "EPL" as FBRefLeague },
    { espnName: "Brighton & Hove Albion", league: "EPL" as FBRefLeague },
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
      fbrefName: hit?.name ?? null,
    });
  }

  return c.json({
    data: {
      source: "FBRef",
      rawFetches: results,
      cachedFetchLeagueXG: cachedResults,
      testLookups: lookupResults,
    },
  });
});

// ─── GET /api/shadow/nba-stats-diag (vestigial) ──────────────────────

/**
 * Vestigial diagnostic endpoint. stats.nba.com IP-blocks Railway's ranges,
 * so the NBA 3P regression factor has been removed. This endpoint is kept
 * for reference but will always timeout or fail from cloud hosts.
 */
shadowRouter.get("/nba-stats-diag", async (c) => {
  const denied = checkAdminKey(c);
  if (denied) return denied;

  return c.json({
    data: {
      note: "stats.nba.com IP-blocks Railway/cloud hosts. The NBA 3P regression factor " +
        "has been removed. This endpoint is vestigial — use it only from local dev for debugging.",
      status: "abandoned",
    },
  });
});

export { shadowRouter };
