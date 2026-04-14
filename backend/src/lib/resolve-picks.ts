/**
 * Pick Resolution System
 * Checks unresolved picks against ESPN final scores and marks them win/loss.
 */

import { prisma } from "../prisma";
import { createNotification } from "../routes/notifications";
import { notifyPickResult, checkStreakMilestone, calculateWinStreak } from "./notification-jobs";
import { fetchWithTimeout } from "./fetch-with-timeout";

const ESPN_ENDPOINTS: Record<string, string> = {
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  MLS: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard",
  NCAAF: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
  NCAAB: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
  EPL: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
};

export interface FinalGameResult {
  gameId: string;
  homeScore: number;
  awayScore: number;
  isFinal: boolean;
}

// Fetch a specific game by ID from ESPN. Searches across all sports and ±3 days.
export async function fetchGameResult(gameId: string): Promise<FinalGameResult | null> {
  const today = new Date();
  const datesToSearch: string[] = [];

  for (let offset = -3; offset <= 1; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    datesToSearch.push(d.toISOString().split("T")[0]!);
  }

  for (const sport of Object.keys(ESPN_ENDPOINTS)) {
    const baseUrl = ESPN_ENDPOINTS[sport]!;
    for (const date of datesToSearch) {
      try {
        const params = new URLSearchParams({ dates: date.replace(/-/g, "") });
        if (sport === "NCAAB") { params.set("groups", "50"); params.set("limit", "300"); }
        if (sport === "NCAAF") { params.set("groups", "80"); params.set("limit", "300"); }

        const res = await fetchWithTimeout(`${baseUrl}?${params.toString()}`, { timeoutMs: 25000 });
        if (!res.ok) continue;

        const data = await res.json() as { events?: Array<{
          id: string;
          competitions: Array<{
            competitors: Array<{ homeAway: string; score?: string }>;
            status: { type: { state: string; completed: boolean } };
          }>;
        }> };

        if (!data.events) continue;

        const event = data.events.find((e) => e.id === gameId);
        if (!event) continue;

        const competition = event.competitions[0];
        if (!competition) {
          console.log(`[resolve-diag] gameId=${gameId} sport=${sport} date=${date}: found event but no competition data`);
          return null;
        }

        const status = competition.status.type;
        const isFinal = status.state.toLowerCase() === "post" || status.completed;
        if (!isFinal) {
          console.log(`[resolve-diag] gameId=${gameId} sport=${sport} date=${date}: NOT FINAL state=${status.state} completed=${status.completed}`);
          return null; // Game exists but isn't final yet
        }

        const home = competition.competitors.find((c) => c.homeAway === "home");
        const away = competition.competitors.find((c) => c.homeAway === "away");
        if (!home || !away) {
          console.log(`[resolve-diag] gameId=${gameId} sport=${sport} date=${date}: missing home/away competitor`);
          return null;
        }

        const homeScore = parseInt(home.score ?? "0", 10);
        const awayScore = parseInt(away.score ?? "0", 10);
        if (isNaN(homeScore) || isNaN(awayScore)) {
          console.log(`[resolve-diag] gameId=${gameId} sport=${sport} date=${date}: NaN scores home="${home.score}" away="${away.score}"`);
          return null;
        }

        return { gameId, homeScore, awayScore, isFinal: true };
      } catch {
        // Skip this sport/date combo and keep searching
      }
    }
  }

  // Fallback: ESPN's per-game summary endpoint works for historical games
  // outside the ±3 day scoreboard window. Try every sport's summary path
  // until one returns a final result.
  for (const sport of Object.keys(ESPN_ENDPOINTS)) {
    const summaryUrl = ESPN_ENDPOINTS[sport]!.replace("/scoreboard", "/summary");
    try {
      const res = await fetchWithTimeout(`${summaryUrl}?event=${encodeURIComponent(gameId)}`, { timeoutMs: 25000 });
      if (!res.ok) continue;

      const data = await res.json() as {
        header?: {
          competitions?: Array<{
            competitors: Array<{ homeAway: string; score?: string | number }>;
            status?: { type?: { state?: string; completed?: boolean } };
          }>;
        };
      };

      const competition = data.header?.competitions?.[0];
      if (!competition) continue;

      const status = competition.status?.type;
      const isFinal = status?.state?.toLowerCase() === "post" || !!status?.completed;
      if (!isFinal) continue;

      const home = competition.competitors.find((c) => c.homeAway === "home");
      const away = competition.competitors.find((c) => c.homeAway === "away");
      if (!home || !away) continue;

      const homeScore = parseInt(String(home.score ?? "0"), 10);
      const awayScore = parseInt(String(away.score ?? "0"), 10);
      if (isNaN(homeScore) || isNaN(awayScore)) continue;

      console.log(`[resolve-diag] gameId=${gameId}: resolved via summary fallback (sport=${sport})`);
      return { gameId, homeScore, awayScore, isFinal: true };
    } catch {
      // Try next sport
    }
  }

  console.log(`[resolve-diag] gameId=${gameId}: NOT FOUND via scoreboard window or summary fallback`);
  return null;
}

// Determine win/loss for a pick given final scores
export function determineResult(
  pickedTeam: string,
  homeScore: number,
  awayScore: number
): "win" | "loss" | null {
  if (homeScore === awayScore) return null; // Tie — leave unresolved
  const homeWon = homeScore > awayScore;
  if (pickedTeam === "home") return homeWon ? "win" : "loss";
  if (pickedTeam === "away") return homeWon ? "loss" : "win";
  return null;
}

// Convert a stored PredictionResult row into the 3 model fields we denormalize
// onto UserPick at settlement. PredictionResult.homeWinProb is 0..1 and may be
// null on older rows — fall back to deriving from confidence + predictedWinner
// (which are always populated). Returns null when even those are missing.
export interface PredictionEnrichment {
  modelPredictedWinner: string;
  modelConfidence: number;
  modelHomeWinProb: number;
}

export function buildPredictionEnrichment(pred: {
  predictedWinner: string | null;
  confidence: number | null;
  homeWinProb: number | null;
} | null): PredictionEnrichment | null {
  if (!pred || pred.predictedWinner == null || pred.confidence == null) return null;
  const conf = Math.round(pred.confidence);
  const winner = pred.predictedWinner;
  const homeWinProb =
    pred.homeWinProb != null
      ? Math.round(pred.homeWinProb * 100)
      : winner === "home"
        ? conf
        : 100 - conf;
  return {
    modelPredictedWinner: winner,
    modelConfidence: conf,
    modelHomeWinProb: homeWinProb,
  };
}

// Main resolution function — resolves all pending picks
export async function resolvePicks(): Promise<{ resolved: number; skipped: number }> {
  let resolved = 0;
  let skipped = 0;

  try {
    const unresolvedPicks = await prisma.userPick.findMany({
      where: { result: null },
      select: { id: true, gameId: true, pickedTeam: true, odId: true, homeTeam: true, awayTeam: true },
    });

    // Also pull unresolved PredictionResult rows for calibration data (independent of user picks).
    // Only consider games whose prediction was created at least 30 min ago to allow them to finish.
    const calibrationCutoff = new Date(Date.now() - 30 * 60 * 1000);
    const unresolvedPredictions = await prisma.predictionResult.findMany({
      where: { actualWinner: null, createdAt: { lt: calibrationCutoff } },
      select: { gameId: true },
    });

    if (unresolvedPicks.length === 0 && unresolvedPredictions.length === 0) {
      return { resolved: 0, skipped: 0 };
    }

    // Union of all game IDs we need to check (user picks + calibration data)
    const uniqueGameIds = [...new Set([
      ...unresolvedPicks.map((p) => p.gameId),
      ...unresolvedPredictions.map((p) => p.gameId),
    ])];
    console.log(`[resolve-picks] Checking ${uniqueGameIds.length} unique games (${unresolvedPicks.length} user picks, ${unresolvedPredictions.length} calibration rows)`);
    const gameResultMap = new Map<string, FinalGameResult | null>();

    for (const gameId of uniqueGameIds) {
      try {
        const result = await fetchGameResult(gameId);
        gameResultMap.set(gameId, result);
      } catch (err) {
        console.error(`[resolve-picks] Error fetching game ${gameId}:`, err);
        gameResultMap.set(gameId, null);
      }
    }

    // Batch-fetch persisted predictions for every game we're about to resolve
    // a pick on. Used to denormalize the model's call onto the pick row so the
    // Profile UI can render Signature Calls without joining against allGames.
    const pickGameIds = unresolvedPicks.map((p) => p.gameId);
    let predictionMap = new Map<string, { predictedWinner: string; confidence: number; homeWinProb: number | null }>();
    if (pickGameIds.length > 0) {
      try {
        const predRows = await prisma.predictionResult.findMany({
          where: { gameId: { in: pickGameIds } },
          select: { gameId: true, predictedWinner: true, confidence: true, homeWinProb: true },
        });
        predictionMap = new Map(predRows.map((p) => [p.gameId, p]));
      } catch (err) {
        console.error(`[resolve-picks] Error batch-fetching predictions:`, err);
      }
    }

    // Now resolve each pick
    for (const pick of unresolvedPicks) {
      const gameResult = gameResultMap.get(pick.gameId);
      if (!gameResult || !gameResult.isFinal) {
        skipped++;
        continue;
      }

      const result = determineResult(pick.pickedTeam, gameResult.homeScore, gameResult.awayScore);
      if (!result) {
        skipped++;
        continue;
      }

      // Build enrichment payload — settlement always writes scores; model
      // fields only when a PredictionResult row exists for the game.
      const enrichment = buildPredictionEnrichment(predictionMap.get(pick.gameId) ?? null);
      const enriched = enrichment !== null;
      if (!enriched) {
        console.warn(`[resolve-picks] No prediction found for game ${pick.gameId} — settling pick ${pick.id} without model enrichment`);
      }

      try {
        await prisma.userPick.update({
          where: { id: pick.id },
          data: {
            result,
            finalHomeScore: gameResult.homeScore,
            finalAwayScore: gameResult.awayScore,
            ...(enrichment ?? {}),
          },
        });
        resolved++;
        console.log(`[resolve-picks] Resolved pick ${pick.id}: ${result}, enriched: ${enriched}`);

        // Notify user of resolved pick (in-app + push)
        const homeAbbr = pick.homeTeam ?? 'HOME';
        const awayAbbr = pick.awayTeam ?? 'AWAY';
        const teams = [awayAbbr, homeAbbr].filter(Boolean).join(" vs ");

        // In-app notification
        const emoji = result === "win" ? "W" : "L";
        createNotification(
          pick.odId,
          "pick_resolved",
          `Pick Result: ${emoji}`,
          `Your pick on ${teams || "a game"} was a ${result}!`,
          { gameId: pick.gameId }
        );

        // Rich push notification (deduped in notifyPickResult)
        notifyPickResult(pick.odId, pick.gameId, result, homeAbbr, awayAbbr);

        // Check if this win extends a streak worth celebrating
        if (result === 'win') {
          calculateWinStreak(pick.odId).then(streak => {
            checkStreakMilestone(pick.odId, streak);
          }).catch(() => {});
        }
      } catch (err) {
        console.error(`[resolve-picks] Error updating pick ${pick.id}:`, err);
        skipped++;
      }
    }

    // Update PredictionResult calibration records for all resolved games
    for (const gameId of uniqueGameIds) {
      const gameResult = gameResultMap.get(gameId);
      if (!gameResult || !gameResult.isFinal) continue;

      const actualWinner = gameResult.homeScore > gameResult.awayScore ? "home" : "away";

      try {
        // Find unresolved PredictionResult rows for this game
        const records = await prisma.predictionResult.findMany({
          where: { gameId, actualWinner: null },
          select: { id: true, predictedWinner: true },
        });
        for (const rec of records) {
          await prisma.predictionResult.update({
            where: { id: rec.id },
            data: {
              actualWinner,
              wasCorrect: rec.predictedWinner === actualWinner,
              resolvedAt: new Date(),
            },
          });
        }
      } catch (err) {
        console.error(`[resolve-picks] Error updating PredictionResult for game ${gameId}:`, err);
        // Non-fatal — pick resolution continues unaffected
      }
    }
  } catch (err) {
    console.error("[resolve-picks] Fatal error during resolution:", err);
  }

  console.log(`[resolve-picks] Done: ${resolved} resolved, ${skipped} skipped`);
  return { resolved, skipped };
}

// Fire-and-forget wrapper — safe to call without awaiting
export function resolvePicksInBackground(): void {
  resolvePicks().catch((err) => {
    console.error("[resolve-picks] Background resolution failed:", err);
  });
}
