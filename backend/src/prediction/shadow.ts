/**
 * Shadow comparison logger.
 *
 * When USE_NEW_PREDICTION_ENGINE=false, the old engine runs as primary
 * but the new engine also runs in the background. Both predictions are
 * logged to backend/logs/prediction_shadow.jsonl for comparison.
 *
 * One JSON object per line:
 * {
 *   gameId, timestamp, sport,
 *   oldPrediction: { winner, homeWinProb, confidence },
 *   newPrediction: { winner, homeWinProb, confidence, confidenceBand }
 * }
 */

import { appendFileSync } from "fs";
import { join } from "path";

const SHADOW_LOG_PATH = join(__dirname, "../../logs/prediction_shadow.jsonl");

interface ShadowEntry {
  gameId: string;
  timestamp: string;
  sport: string;
  oldPrediction: {
    winner: string;
    homeWinProb: number;
    confidence: number;
  };
  newPrediction: {
    winner: string | null;
    homeWinProb: number;
    confidence: number;
    confidenceBand: string;
  };
}

export function logShadowPrediction(entry: ShadowEntry): void {
  try {
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(SHADOW_LOG_PATH, line, "utf-8");
  } catch (e) {
    console.error("[shadow] Failed to write shadow log:", e);
  }
}

/**
 * Check whether the new prediction engine should be used as primary.
 * Reads USE_NEW_PREDICTION_ENGINE from environment.
 * Default: false (old engine runs, new engine shadows).
 */
export function useNewEngine(): boolean {
  return process.env.USE_NEW_PREDICTION_ENGINE === "true";
}
