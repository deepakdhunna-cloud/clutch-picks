/**
 * Re-prediction trigger.
 *
 * When a critical or moderate player-availability signal lands, find
 * all scheduled games in the next 24h involving the affected team and
 * re-run the prediction engine. Each re-predict writes a new row to
 * PredictionVersion so the Prompt C2 UI can render a timeline of how
 * confidence moved as news broke.
 *
 * Design notes:
 *   - Fire-and-forget from the orchestrator. A slow re-predict must
 *     never block the main ingestion cycle (or the user-facing game
 *     response).
 *   - Scheduled games are fetched via the app's own /api/games
 *     aggregator (same pattern as the snapshotMarketLines cron).
 *   - Only "critical" and "moderate" signals trigger a re-predict.
 *     "minor" signals still get stored but don't flip the wheel —
 *     the 0.03-weight rotation-player factor rarely moves confidence
 *     more than ~1%.
 */

import { buildGameContext } from "../../prediction/shadow";
import { predictGame } from "../../prediction/index";
import { createTriggeredVersion } from "./predictionVersions";
import type { ExtractedSignal } from "./types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface ScheduledGame {
  id: string;
  sport: string;
  gameTime: string;
  status: string;
  venue?: string;
  homeTeam: { id: string; name: string; abbreviation: string; logo?: string; record?: string };
  awayTeam: { id: string; name: string; abbreviation: string; logo?: string; record?: string };
}

async function loadUpcomingGames(baseUrl: string): Promise<ScheduledGame[]> {
  try {
    const res = await fetch(`${baseUrl}/api/games`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: ScheduledGame[] };
    const games = body.data ?? [];
    const cutoff = Date.now() + ONE_DAY_MS;
    return games
      .filter((g) => g.status === "SCHEDULED")
      .filter((g) => {
        const ts = new Date(g.gameTime).getTime();
        return !Number.isNaN(ts) && ts <= cutoff && ts > Date.now() - 60 * 60 * 1000;
      });
  } catch {
    return [];
  }
}

function affectsTeam(game: ScheduledGame, teamAbbr: string): boolean {
  return (
    game.homeTeam.abbreviation === teamAbbr ||
    game.awayTeam.abbreviation === teamAbbr
  );
}

function triggerReason(signal: ExtractedSignal): string {
  return `injury:${signal.playerName} ${signal.status.toUpperCase()}`;
}

/**
 * Kick off re-predictions for one signal. Returns number of versions
 * written (one per affected scheduled game).
 *
 * Intentionally does NOT throw: every step is wrapped so a flaky
 * prediction or network hiccup surfaces as a log line, never an error
 * propagating into the orchestrator's cron cycle.
 */
export async function triggerRePrediction(
  signal: ExtractedSignal,
  signalId: string,
  baseUrl: string,
): Promise<number> {
  if (signal.severity === "minor") return 0;
  if (signal.confidence < 0.5) return 0; // don't move the model on low-confidence signals

  const games = await loadUpcomingGames(baseUrl);
  const affected = games.filter((g) => affectsTeam(g, signal.teamAbbreviation));
  if (affected.length === 0) return 0;

  let written = 0;
  for (const game of affected) {
    try {
      const ctx = await buildGameContext({
        id: game.id,
        sport: game.sport,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        gameTime: game.gameTime,
        venue: game.venue ?? "",
      });
      const prediction = predictGame(ctx);

      await createTriggeredVersion({
        gameId: game.id,
        sport: game.sport,
        prediction,
        triggerReason: triggerReason(signal),
        triggerSourceId: signalId,
      });

      console.log(
        `[re-predict] ${game.sport} ${game.homeTeam.abbreviation} vs ${game.awayTeam.abbreviation} ` +
          `prediction updated: ${(prediction.confidence).toFixed(1)}% ` +
          `(trigger: ${signal.playerName} ${signal.status.toUpperCase()})`,
      );
      written++;
    } catch (err) {
      console.warn(
        `[re-predict] failed for game ${game.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return written;
}
