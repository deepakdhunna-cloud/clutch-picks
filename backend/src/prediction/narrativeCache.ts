/**
 * Versioned cache for LLM-generated analyst narratives.
 *
 * Two-layer:
 *   1. In-memory LRU — zero-latency read for hot paths.
 *   2. Prisma `LLMNarrativeCache` — survives restarts and cross-replica.
 *
 * Key: (gameId, versionHash). When the underlying prediction shifts (injury
 * flips a factor, confidence band changes, etc.), versionHash changes and
 * a new entry is generated on demand. A 12h TTL retires old rows as a
 * safety net.
 *
 * Writes/reads are non-blocking relative to the request path. The only
 * synchronous surface is the in-memory LRU; DB ops run inside the
 * background enrichment job.
 */

import { createHash } from "crypto";
import { LRUCache } from "lru-cache";
import { prisma } from "../prisma";
import type { FactorContribution } from "./types";
import type { GamePrediction } from "../routes/games";
import type { InjuryListEntry } from "./llmNarrative";

// ─── Version hash ──────────────────────────────────────────────────────

/**
 * Stable hash of the prediction-level bits that should invalidate a
 * cached narrative:
 *   - Who we picked + rounded confidence bucket
 *   - Top 3 factor labels + their hasSignal state (whether the factor
 *     is actually contributing — a factor that flips from signal to
 *     no-signal is a different story)
 *   - Injury list (name + status), so a new Out status forces a
 *     regeneration even if the overall pick is unchanged
 */
export function computeVersionHash(
  prediction: Pick<
    GamePrediction,
    "predictedWinner" | "confidence" | "factors"
  >,
  injuries: InjuryListEntry[],
): string {
  // Sort factors by weight desc, take top 3, hash on label+hasSignal-ish
  // marker. The GamePrediction shape doesn't expose hasSignal directly;
  // we approximate it with "contributes": factor weight > 0 AND score
  // meaningfully off-center (0.45..0.55 treated as no-signal).
  const topFactors = [...prediction.factors]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((f) => {
      const contributes =
        f.weight > 0 && (f.homeScore <= 0.48 || f.homeScore >= 0.52);
      return `${f.name}:${contributes ? "1" : "0"}`;
    })
    .join("|");

  const injuryKey = injuries
    .slice()
    .sort((a, b) => (a.name + a.team).localeCompare(b.name + b.team))
    .map((i) => `${i.team}:${i.name}:${i.status}`)
    .join("|");

  // Bucket confidence into 5-pt tranches so minor prob drift doesn't
  // cause needless regenerations.
  const bucket = Math.floor(prediction.confidence / 5) * 5;

  const material = `${prediction.predictedWinner}|${bucket}|${topFactors}|${injuryKey}`;
  return createHash("sha1").update(material).digest("hex").slice(0, 16);
}

// ─── TTL ───────────────────────────────────────────────────────────────

const TTL_MS = 12 * 60 * 60 * 1000; // 12h safety-net

export function isStale(generatedAt: Date): boolean {
  return Date.now() - generatedAt.getTime() > TTL_MS;
}

// ─── In-memory shortcut ────────────────────────────────────────────────

interface MemoryEntry {
  narrative: string;
  generatedAt: number;
}

const memoryCache = new LRUCache<string, MemoryEntry>({ max: 1024 });

function memKey(gameId: string, versionHash: string): string {
  return `${gameId}:${versionHash}`;
}

export function __resetNarrativeCacheForTests(): void {
  memoryCache.clear();
}

// ─── Read ──────────────────────────────────────────────────────────────

/**
 * Return the cached LLM narrative for (gameId, versionHash) if fresh,
 * else null. Checks memory first; falls back to DB on miss and hydrates
 * memory on hit. Errors are swallowed — cache is best-effort.
 */
export async function getCachedLLMNarrative(
  gameId: string,
  versionHash: string,
): Promise<string | null> {
  const k = memKey(gameId, versionHash);
  const mem = memoryCache.get(k);
  if (mem && Date.now() - mem.generatedAt <= TTL_MS) {
    return mem.narrative;
  }
  try {
    const row = await prisma.lLMNarrativeCache.findUnique({
      where: { gameId_versionHash: { gameId, versionHash } },
    });
    if (!row) return null;
    if (isStale(row.generatedAt)) return null;
    memoryCache.set(k, {
      narrative: row.narrative,
      generatedAt: row.generatedAt.getTime(),
    });
    return row.narrative;
  } catch (err) {
    console.warn(
      `[llm-narrative] cache read failed gameId=${gameId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─── Write ─────────────────────────────────────────────────────────────

export async function putCachedLLMNarrative(
  gameId: string,
  versionHash: string,
  narrative: string,
  tokensUsed: number,
): Promise<void> {
  const k = memKey(gameId, versionHash);
  memoryCache.set(k, { narrative, generatedAt: Date.now() });
  try {
    await prisma.lLMNarrativeCache.upsert({
      where: { gameId_versionHash: { gameId, versionHash } },
      create: {
        gameId,
        versionHash,
        narrative,
        tokensUsed,
      },
      update: {
        narrative,
        tokensUsed,
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    console.warn(
      `[llm-narrative] cache write failed gameId=${gameId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
