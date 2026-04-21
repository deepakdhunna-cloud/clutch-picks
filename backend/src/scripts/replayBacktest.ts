/**
 * Replay backtest — runs the new prediction engine against every resolved
 * game in PredictionResult and compares accuracy to the old engine.
 *
 * IMPORTANT: This is a best-effort backtest. homeElo/awayElo are point-in-time
 * (good), but other context (form, injuries, standings) uses CURRENT values.
 * Results are approximate, not definitive.
 */

import { prisma } from "../prisma";
import { predictGame } from "../prediction/index";
import { buildGameContext } from "../prediction/shadow";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ReplayResult {
  gameId: string;
  sport: string;
  actualWinner: string;
  oldPredictedWinner: string;
  oldConfidence: number;
  oldCorrect: boolean;
  newPredictedWinner: string | null;
  newConfidence: number;
  newCorrect: boolean;
  newAvailableFactorCount: number;
  newUnavailableFactorCount: number;
}

export interface ReplayBacktestReport {
  runAt: string;
  totalGames: number;
  gamesSkipped: number;
  perSport: Array<{
    sport: string;
    resolvedGames: number;
    oldCorrect: number;
    newCorrect: number;
    oldAccuracy: number;
    newAccuracy: number;
    accuracyDelta: number;
    avgNewConfidence: number;
    avgOldConfidence: number;
    disagreements: number;
    disagreementsNewCorrect: number;
  }>;
  overall: {
    oldAccuracy: number;
    newAccuracy: number;
    accuracyDelta: number;
    newEngineWins: boolean;
  };
  dataQualityNote: string;
  warnings: string[];
}

// ─── ESPN sport → path mapping ──────────────────────────────────────────

const ESPN_SPORT_PATHS: Record<string, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  MLS: "soccer/usa.1",
  NCAAF: "football/college-football",
  NCAAB: "basketball/mens-college-basketball",
  EPL: "soccer/eng.1",
  UCL: "soccer/uefa.champions",
};

// ─── ESPN game fetcher ──────────────────────────────────────────────────

interface ESPNGameInfo {
  id: string;
  sport: string;
  homeTeam: { id: string; name: string; abbreviation: string; logo: string; record: string };
  awayTeam: { id: string; name: string; abbreviation: string; logo: string; record: string };
  gameTime: string;
  venue: string;
}

async function fetchESPNGameInfo(gameId: string, sport: string): Promise<ESPNGameInfo | null> {
  const sportPath = ESPN_SPORT_PATHS[sport];
  if (!sportPath) return null;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${gameId}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    if (!response.ok) return null;

    const data = await response.json() as any;
    const event = data.header?.competitions?.[0] ?? data.boxscore?.teams?.[0]?.team;
    const competition = data.header?.competitions?.[0];

    if (!competition) return null;

    const homeComp = competition.competitors?.find((c: any) => c.homeAway === "home");
    const awayComp = competition.competitors?.find((c: any) => c.homeAway === "away");

    if (!homeComp?.team || !awayComp?.team) return null;

    return {
      id: gameId,
      sport,
      homeTeam: {
        id: homeComp.team.id,
        name: homeComp.team.displayName ?? homeComp.team.name ?? "",
        abbreviation: homeComp.team.abbreviation ?? "",
        logo: homeComp.team.logos?.[0]?.href ?? homeComp.team.logo ?? "",
        record: homeComp.record?.[0]?.displayValue ?? "0-0",
      },
      awayTeam: {
        id: awayComp.team.id,
        name: awayComp.team.displayName ?? awayComp.team.name ?? "",
        abbreviation: awayComp.team.abbreviation ?? "",
        logo: awayComp.team.logos?.[0]?.href ?? awayComp.team.logo ?? "",
        record: awayComp.record?.[0]?.displayValue ?? "0-0",
      },
      gameTime: data.header?.competitions?.[0]?.date ?? new Date().toISOString(),
      venue: data.gameInfo?.venue?.fullName ?? "Unknown",
    };
  } catch {
    return null;
  }
}

// ─── Rate-limited batch processor ───────────────────────────────────────

async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null>,
  onProgress?: (processed: number, total: number) => void,
): Promise<Array<R | null>> {
  const results: Array<R | null> = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (onProgress) onProgress(results.length, items.length);
    // Small sleep between batches to avoid hammering ESPN
    if (i + concurrency < items.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return results;
}

// ─── Progress tracking (exported for status endpoint) ───────────────────

export interface ReplayProgress {
  running: boolean;
  startedAt?: string;
  progress?: { processed: number; total: number; currentSport: string };
}

let replayProgress: ReplayProgress = { running: false };

export function getReplayProgress(): ReplayProgress {
  return { ...replayProgress };
}

// ─── Main replay function ───────────────────────────────────────────────

export async function runReplayBacktest(): Promise<ReplayBacktestReport> {
  if (replayProgress.running) {
    throw new Error("Replay backtest already running");
  }

  replayProgress = { running: true, startedAt: new Date().toISOString() };

  const warnings: string[] = [];
  const results: ReplayResult[] = [];
  let gamesSkipped = 0;

  try {
    // Fetch all resolved predictions
    const resolved = await prisma.predictionResult.findMany({
      where: { wasCorrect: { not: null }, actualWinner: { not: null } },
      orderBy: { createdAt: "asc" },
    });

    console.log(`[replay] Starting replay backtest with ${resolved.length} resolved games`);
    replayProgress.progress = { processed: 0, total: resolved.length, currentSport: "" };

    // Group by sport for logging
    const sportCounts = new Map<string, number>();
    for (const r of resolved) {
      sportCounts.set(r.sport, (sportCounts.get(r.sport) ?? 0) + 1);
    }
    console.log(`[replay] Sport breakdown: ${Array.from(sportCounts.entries()).map(([s, c]) => `${s}=${c}`).join(", ")}`);

    // Process each game
    const replayOne = async (row: typeof resolved[0]): Promise<ReplayResult | null> => {
      try {
        // Fetch game info from ESPN (with per-game timeout)
        const gameInfo = await fetchESPNGameInfo(row.gameId, row.sport);
        if (!gameInfo) {
          gamesSkipped++;
          return null;
        }

        // Build context — this uses current ESPN data for form/injuries/etc
        const ctx = await buildGameContext(gameInfo);

        // Override Elo with point-in-time values from PredictionResult
        if (row.homeElo !== null) ctx.homeElo = row.homeElo;
        if (row.awayElo !== null) ctx.awayElo = row.awayElo;

        // Run the new engine
        const newPred = predictGame(ctx);

        // Determine new engine's winner in "home"/"away" format
        let newWinner: string | null = null;
        if (newPred.predictedWinner) {
          newWinner = newPred.predictedWinner.teamId === gameInfo.homeTeam.id ? "home" : "away";
        }

        const newCorrect = newWinner === row.actualWinner;

        return {
          gameId: row.gameId,
          sport: row.sport,
          actualWinner: row.actualWinner!,
          oldPredictedWinner: row.predictedWinner,
          oldConfidence: row.confidence,
          oldCorrect: row.wasCorrect!,
          newPredictedWinner: newWinner,
          newConfidence: newPred.confidence,
          newCorrect,
          newAvailableFactorCount: newPred.factors.filter((f) => f.available).length,
          newUnavailableFactorCount: newPred.unavailableFactors.length,
        };
      } catch (err: any) {
        gamesSkipped++;
        if (gamesSkipped <= 10) {
          console.warn(`[replay] Skipping game ${row.gameId} (${row.sport}): ${err?.message}`);
        }
        return null;
      }
    };

    // Process with concurrency limit
    const rawResults = await processInBatches(
      resolved,
      5,
      replayOne,
      (processed, total) => {
        replayProgress.progress = {
          processed,
          total,
          currentSport: resolved[Math.min(processed, resolved.length - 1)]?.sport ?? "",
        };
        if (processed % 50 === 0 || processed === total) {
          console.log(`[replay] ${processed}/${total} games processed (${gamesSkipped} skipped)`);
        }
      },
    );

    // Filter out nulls
    for (const r of rawResults) {
      if (r) results.push(r);
    }

    // ─── Aggregate per-sport ──────────────────────────────────────────
    const sportMap = new Map<string, {
      resolvedGames: number;
      oldCorrect: number;
      newCorrect: number;
      oldConfSum: number;
      newConfSum: number;
      disagreements: number;
      disagreementsNewCorrect: number;
    }>();

    for (const r of results) {
      let s = sportMap.get(r.sport);
      if (!s) {
        s = { resolvedGames: 0, oldCorrect: 0, newCorrect: 0, oldConfSum: 0, newConfSum: 0, disagreements: 0, disagreementsNewCorrect: 0 };
        sportMap.set(r.sport, s);
      }
      s.resolvedGames++;
      if (r.oldCorrect) s.oldCorrect++;
      if (r.newCorrect) s.newCorrect++;
      s.oldConfSum += r.oldConfidence;
      s.newConfSum += r.newConfidence;
      if (r.oldPredictedWinner !== r.newPredictedWinner) {
        s.disagreements++;
        if (r.newCorrect) s.disagreementsNewCorrect++;
      }
    }

    const perSport = Array.from(sportMap.entries()).map(([sport, s]) => ({
      sport,
      resolvedGames: s.resolvedGames,
      oldCorrect: s.oldCorrect,
      newCorrect: s.newCorrect,
      oldAccuracy: s.resolvedGames > 0 ? +(s.oldCorrect / s.resolvedGames * 100).toFixed(1) : 0,
      newAccuracy: s.resolvedGames > 0 ? +(s.newCorrect / s.resolvedGames * 100).toFixed(1) : 0,
      accuracyDelta: s.resolvedGames > 0
        ? +((s.newCorrect / s.resolvedGames - s.oldCorrect / s.resolvedGames) * 100).toFixed(1)
        : 0,
      avgNewConfidence: s.resolvedGames > 0 ? +(s.newConfSum / s.resolvedGames).toFixed(1) : 0,
      avgOldConfidence: s.resolvedGames > 0 ? +(s.oldConfSum / s.resolvedGames).toFixed(1) : 0,
      disagreements: s.disagreements,
      disagreementsNewCorrect: s.disagreementsNewCorrect,
    }));

    // Warnings for small samples
    for (const s of perSport) {
      if (s.resolvedGames < 30) {
        warnings.push(`${s.sport} has only ${s.resolvedGames} resolved games — not statistically meaningful`);
      }
    }

    if (gamesSkipped > 0) {
      warnings.push(`${gamesSkipped} games skipped due to missing ESPN data or fetch failure`);
    }

    // Overall
    const totalOldCorrect = results.filter((r) => r.oldCorrect).length;
    const totalNewCorrect = results.filter((r) => r.newCorrect).length;
    const totalGames = results.length;

    const overallOldAcc = totalGames > 0 ? totalOldCorrect / totalGames : 0;
    const overallNewAcc = totalGames > 0 ? totalNewCorrect / totalGames : 0;

    const report: ReplayBacktestReport = {
      runAt: new Date().toISOString(),
      totalGames,
      gamesSkipped,
      perSport,
      overall: {
        oldAccuracy: +(overallOldAcc * 100).toFixed(1),
        newAccuracy: +(overallNewAcc * 100).toFixed(1),
        accuracyDelta: +((overallNewAcc - overallOldAcc) * 100).toFixed(1),
        newEngineWins: overallNewAcc > overallOldAcc,
      },
      dataQualityNote:
        "Context data (injuries, form, standings) reflects CURRENT state, not state at prediction time. " +
        "For games older than 7 days, this introduces noise. Use results as directional signal, not exact accuracy.",
      warnings,
    };

    // Log summary table
    console.log("\n[replay] ════════════════════════════════════════");
    console.log(`[replay] Replay Backtest Complete — ${totalGames} games (${gamesSkipped} skipped)`);
    console.log("[replay] ────────────────────────────────────────");
    for (const s of perSport) {
      const arrow = s.accuracyDelta > 0 ? "↑" : s.accuracyDelta < 0 ? "↓" : "=";
      console.log(
        `[replay]  ${s.sport.padEnd(6)} | old ${s.oldAccuracy}% | new ${s.newAccuracy}% | ${arrow}${Math.abs(s.accuracyDelta)}% | ${s.disagreements} disagree (${s.disagreementsNewCorrect} new correct)`,
      );
    }
    console.log("[replay] ────────────────────────────────────────");
    console.log(
      `[replay]  TOTAL | old ${report.overall.oldAccuracy}% | new ${report.overall.newAccuracy}% | ${report.overall.newEngineWins ? "NEW WINS" : "OLD WINS"}`,
    );
    console.log("[replay] ════════════════════════════════════════\n");

    // Write results
    const outDir = join(__dirname, "../../backtest-results");
    await mkdir(outDir, { recursive: true });
    const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
    const specificPath = join(outDir, `replay-${dateStr}.json`);
    const latestPath = join(outDir, "replay-latest.json");

    await Promise.all([
      writeFile(specificPath, JSON.stringify(report, null, 2)),
      writeFile(latestPath, JSON.stringify(report, null, 2)),
    ]);

    console.log(`[replay] Results written to ${specificPath}`);

    return report;
  } finally {
    replayProgress = { running: false };
  }
}
