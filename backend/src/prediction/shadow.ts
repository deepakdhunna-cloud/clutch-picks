/**
 * Shadow comparison logger.
 *
 * When USE_NEW_PREDICTION_ENGINE=false (current state), the old engine
 * serves predictions to users. In parallel, the new engine runs and both
 * results are logged to daily JSONL files for review.
 *
 * A shadow-engine failure NEVER affects the user-facing response.
 * Writes are append-only, async, fire-and-forget.
 */

import { appendFile, readdir, unlink } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { predictGame } from "./index";
import type { GameContext } from "./types";
import type { Game } from "../types/sports";
import { Sport, League, GameStatus } from "../types/sports";
import { getEloRating } from "../lib/elo";
import {
  fetchTeamRecentForm,
  fetchTeamExtendedStats,
  fetchTeamInjuries,
  fetchAdvancedMetrics,
  fetchStartingLineup,
  fetchGameWeather,
} from "../lib/espnStats";
import { fetchTeamShootingRecent } from "../lib/nbaStatsApi";
import { lookupHomePlateUmpireBias } from "../lib/mlbUmpireApi";

// ─── Paths ──────────────────────────────────────────────────────────────

const LOGS_DIR = join(__dirname, "../../logs");

function ensureLogsDir(): void {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function shadowLogPath(date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return join(LOGS_DIR, `prediction_shadow_${d}.jsonl`);
}

function errorLogPath(date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return join(LOGS_DIR, `prediction_shadow_errors_${d}.jsonl`);
}

// ─── Log entry shapes ───────────────────────────────────────────────────

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

interface ShadowErrorEntry {
  timestamp: string;
  gameId: string;
  league: string;
  error: string;
  stack?: string;
}

// ─── Feature flag ───────────────────────────────────────────────────────

export function useNewEngine(): boolean {
  return process.env.USE_NEW_PREDICTION_ENGINE === "true";
}

// ─── Log rotation (keep last 14 days) ───────────────────────────────────

export async function cleanOldShadowLogs(): Promise<void> {
  try {
    ensureLogsDir();
    const files = await readdir(LOGS_DIR);
    const now = Date.now();
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith("prediction_shadow")) continue;
      // Extract date from filename: prediction_shadow_2026-04-12.jsonl
      const match = file.match(/(\d{4}-\d{2}-\d{2})/);
      if (!match) continue;
      const fileDate = new Date(match[1]!).getTime();
      if (now - fileDate > FOURTEEN_DAYS_MS) {
        await unlink(join(LOGS_DIR, file));
        console.log(`[shadow] Deleted old log: ${file}`);
      }
    }
  } catch (e) {
    console.error("[shadow] Log cleanup failed:", e);
  }
}

// ─── Build GameContext from route-level game data ────────────────────────

async function buildGameContext(
  game: { id: string; sport: string; homeTeam: any; awayTeam: any; gameTime: string; venue: string },
): Promise<GameContext> {
  const sport = game.sport;
  const gameDate = new Date(game.gameTime);

  const [
    homeElo, awayElo,
    homeForm, awayForm,
    homeExtended, awayExtended,
    homeInjuries, awayInjuries,
    homeAdvanced, awayAdvanced,
    homeLineup, awayLineup,
    weather,
    homeShooting, awayShooting,
    homePlateUmpire,
  ] = await Promise.all([
    getEloRating(game.homeTeam.id, sport),
    getEloRating(game.awayTeam.id, sport),
    fetchTeamRecentForm(game.homeTeam.id, sport),
    fetchTeamRecentForm(game.awayTeam.id, sport),
    fetchTeamExtendedStats(game.homeTeam.id, sport, game.awayTeam.id, gameDate),
    fetchTeamExtendedStats(game.awayTeam.id, sport, game.homeTeam.id, gameDate),
    fetchTeamInjuries(game.homeTeam.id, sport),
    fetchTeamInjuries(game.awayTeam.id, sport),
    fetchAdvancedMetrics(game.homeTeam.id, sport),
    fetchAdvancedMetrics(game.awayTeam.id, sport),
    fetchStartingLineup(game.homeTeam.id, sport, gameDate),
    fetchStartingLineup(game.awayTeam.id, sport, gameDate),
    fetchGameWeather(game.venue ?? "", gameDate, sport),
    sport === "NBA" ? fetchTeamShootingRecent(game.homeTeam.id) : Promise.resolve(null),
    sport === "NBA" ? fetchTeamShootingRecent(game.awayTeam.id) : Promise.resolve(null),
    sport === "MLB" ? lookupHomePlateUmpireBias(game.homeTeam.id, gameDate) : Promise.resolve(null),
  ]);

  const sportsGame: import("../types/sports").Game = {
    id: game.id,
    sport: sport as Sport,
    league: ["NCAAF", "NCAAB"].includes(sport) ? League.College : League.Pro,
    homeTeam: {
      id: game.homeTeam.id,
      name: game.homeTeam.name,
      abbreviation: game.homeTeam.abbreviation,
      logo: game.homeTeam.logo || "",
      record: {
        wins: typeof game.homeTeam.record === "string"
          ? parseInt(game.homeTeam.record.split("-")[0] ?? "0")
          : game.homeTeam.record?.wins ?? 0,
        losses: typeof game.homeTeam.record === "string"
          ? parseInt(game.homeTeam.record.split("-")[1] ?? "0")
          : game.homeTeam.record?.losses ?? 0,
      },
    },
    awayTeam: {
      id: game.awayTeam.id,
      name: game.awayTeam.name,
      abbreviation: game.awayTeam.abbreviation,
      logo: game.awayTeam.logo || "",
      record: {
        wins: typeof game.awayTeam.record === "string"
          ? parseInt(game.awayTeam.record.split("-")[0] ?? "0")
          : game.awayTeam.record?.wins ?? 0,
        losses: typeof game.awayTeam.record === "string"
          ? parseInt(game.awayTeam.record.split("-")[1] ?? "0")
          : game.awayTeam.record?.losses ?? 0,
      },
    },
    dateTime: game.gameTime,
    venue: game.venue ?? "Unknown",
    tvChannel: "",
    status: GameStatus.Scheduled,
  };

  return {
    game: sportsGame,
    sport,
    homeElo,
    awayElo,
    homeForm,
    awayForm,
    homeExtended,
    awayExtended,
    homeInjuries,
    awayInjuries,
    homeAdvanced,
    awayAdvanced,
    homeLineup,
    awayLineup,
    weather,
    homeShooting,
    awayShooting,
    homePlateUmpire,
    gameDate: gameDate.toISOString(),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Run the new engine in shadow mode for a game and log the comparison.
 *
 * Called AFTER the old engine has produced its prediction. This function:
 * 1. Builds a GameContext from the game data
 * 2. Runs predictGame() from the new engine
 * 3. Logs both predictions to the daily shadow JSONL file
 * 4. If the new engine throws, logs to the error file instead
 *
 * CRITICAL: This is fire-and-forget. It must NEVER be awaited on the
 * response path. The old prediction is already served to the user.
 */
export function runShadowPrediction(
  game: { id: string; sport: string; homeTeam: any; awayTeam: any; gameTime: string; venue: string },
  oldPrediction: {
    predictedWinner: string;
    homeWinProbability: number;
    confidence: number;
  },
): void {
  // Fire and forget — no await, no blocking
  (async () => {
    try {
      ensureLogsDir();

      const ctx = await buildGameContext(game);
      const newPred = predictGame(ctx);

      const entry: ShadowEntry = {
        timestamp: new Date().toISOString(),
        gameId: game.id,
        league: game.sport,
        matchup: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
        scheduledStart: game.gameTime,
        old: {
          predictedWinner: oldPrediction.predictedWinner,
          homeWinProb: oldPrediction.homeWinProbability / 100, // Old engine uses 0-100
          confidence: oldPrediction.confidence,
        },
        new: {
          predictedWinner: newPred.predictedWinner?.abbr ?? "PICKEM",
          homeWinProb: newPred.homeWinProbability,
          confidence: newPred.confidence,
          confidenceBand: newPred.confidenceBand,
          unavailableFactors: newPred.unavailableFactors,
        },
        agreement:
          oldPrediction.predictedWinner ===
          (newPred.predictedWinner
            ? (newPred.homeWinProbability > newPred.awayWinProbability ? "home" : "away")
            : ""),
        confidenceDelta: newPred.confidence - oldPrediction.confidence,
      };

      await appendFile(shadowLogPath(), JSON.stringify(entry) + "\n", "utf-8");
    } catch (e: any) {
      // Log error — never propagate
      try {
        ensureLogsDir();
        const errEntry: ShadowErrorEntry = {
          timestamp: new Date().toISOString(),
          gameId: game.id,
          league: game.sport,
          error: e?.message ?? String(e),
          stack: e?.stack,
        };
        await appendFile(errorLogPath(), JSON.stringify(errEntry) + "\n", "utf-8");
      } catch {
        // Even error logging failed — silently continue
        console.error(`[shadow] Failed to log error for game ${game.id}:`, e?.message);
      }
    }
  })();
}
