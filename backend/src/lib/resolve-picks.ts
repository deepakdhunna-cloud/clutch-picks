/**
 * Pick Resolution System
 * Checks unresolved picks against ESPN final scores and marks them win/loss.
 */

import { prisma } from "../prisma";
import { createNotification } from "../routes/notifications";

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

interface FinalGameResult {
  gameId: string;
  homeScore: number;
  awayScore: number;
  isFinal: boolean;
}

// Fetch a specific game by ID from ESPN. Searches across all sports and ±3 days.
async function fetchGameResult(gameId: string): Promise<FinalGameResult | null> {
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

        const res = await fetch(`${baseUrl}?${params.toString()}`);
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
        if (!competition) continue;

        const status = competition.status.type;
        const isFinal = status.state.toLowerCase() === "post" || status.completed;
        if (!isFinal) return null; // Game exists but isn't final yet

        const home = competition.competitors.find((c) => c.homeAway === "home");
        const away = competition.competitors.find((c) => c.homeAway === "away");
        if (!home || !away) return null;

        const homeScore = parseInt(home.score ?? "0", 10);
        const awayScore = parseInt(away.score ?? "0", 10);
        if (isNaN(homeScore) || isNaN(awayScore)) return null;

        return { gameId, homeScore, awayScore, isFinal: true };
      } catch {
        // Skip this sport/date combo and keep searching
      }
    }
  }

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

// Main resolution function — resolves all pending picks
export async function resolvePicks(): Promise<{ resolved: number; skipped: number }> {
  let resolved = 0;
  let skipped = 0;

  try {
    const unresolvedPicks = await prisma.userPick.findMany({
      where: { result: null },
      select: { id: true, gameId: true, pickedTeam: true },
    });

    if (unresolvedPicks.length === 0) return { resolved: 0, skipped: 0 };

    // Deduplicate by gameId so we only fetch each game once
    const uniqueGameIds = [...new Set(unresolvedPicks.map((p) => p.gameId))];
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

      try {
        await prisma.userPick.update({
          where: { id: pick.id },
          data: { result },
        });
        resolved++;

        // Notify user of resolved pick
        const emoji = result === "win" ? "W" : "L";
        const teams = [pick.homeTeam, pick.awayTeam].filter(Boolean).join(" vs ");
        createNotification(
          pick.odId,
          "pick_resolved",
          `Pick Result: ${emoji}`,
          `Your pick on ${teams || "a game"} was a ${result}!`,
          { gameId: pick.gameId }
        );
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
