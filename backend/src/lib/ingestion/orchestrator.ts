/**
 * Ingestion orchestrator.
 *
 * One call = one cycle of the pipeline:
 *
 *   1. Load NBA source registry
 *   2. Poll RSS sources                → RawNewsItem[]
 *   3. Poll Twitter sources via Apify  → RawNewsItem[]   (no-op if key unset)
 *   4. Merge + sort by publishedAt (newest first)
 *   5. For each item (up to the 50-call Haiku budget): extract signals
 *   6. For each signal: upsert into PlayerAvailability (with supersede)
 *   7. For critical/moderate signals: fire-and-forget a re-predict
 *   8. Clean expired availability rows
 *   9. Return a stats summary that the cron wrapper logs
 *
 * The whole cycle is wrapped so one bad source / bad LLM response can
 * never bring down the cron. Stats are held in the IngestionCycleResult
 * return so the admin endpoint (/api/ingestion/status) can surface them.
 */

import { loadNBASources } from "./sourceRegistry";
import { pollRSSSources } from "./rssWorker";
import { pollTwitterSources } from "./twitterWorker";
import { extractSignals } from "./llmExtractor";
import { upsertPlayerAvailability, cleanExpired } from "./stateStore";
import { triggerRePrediction } from "./rePredictTrigger";
import type { RawNewsItem } from "./types";

const HAIKU_BUDGET_PER_CYCLE = 50;

export interface IngestionCycleResult {
  runAt: string;
  itemsProcessed: number;
  signalsExtracted: number;
  signalsStored: number;
  rePredictionsTriggered: number;
  expiredCleaned: number;
  errors: string[];
  sourceStats: Array<{ sourceName: string; fetched: number; newItems: number; ok: boolean }>;
}

/**
 * Sort items so Tier-1 (Shams etc.) run first when the Haiku budget is
 * tight — we'd rather spend budget on an ESPN breaking-news headline
 * than a Reddit rumor. Ties broken by publishedAt (newest first).
 */
export function prioritize(items: RawNewsItem[]): RawNewsItem[] {
  return [...items].sort((a, b) => {
    if (b.credibility !== a.credibility) return b.credibility - a.credibility;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

// baseUrl is the HTTP origin of the web service (e.g. "http://localhost:3000"
// in dev, the Railway public URL in prod). Threaded through so the worker
// process, which has no HTTP server of its own, can still reach the games
// aggregator that triggerRePrediction → loadUpcomingGames depends on.
export async function runIngestionCycle(baseUrl: string): Promise<IngestionCycleResult> {
  const runAt = new Date().toISOString();
  const errors: string[] = [];

  const sources = loadNBASources();

  // 2 + 3: poll RSS + Twitter in parallel. Each worker is responsible for
  // its own error containment; a rejection here would be a library bug.
  const [rssPoll, twitterPoll] = await Promise.all([
    pollRSSSources(sources).catch((err) => {
      errors.push(`rss: ${err instanceof Error ? err.message : String(err)}`);
      return { items: [], stats: [] as IngestionCycleResult["sourceStats"] };
    }),
    pollTwitterSources(sources).catch((err) => {
      errors.push(`twitter: ${err instanceof Error ? err.message : String(err)}`);
      return { items: [], stats: [] as IngestionCycleResult["sourceStats"] };
    }),
  ]);

  const allItems = prioritize([...rssPoll.items, ...twitterPoll.items]);
  const sourceStats = [...rssPoll.stats, ...twitterPoll.stats];

  // 5: LLM extract, bounded by HAIKU_BUDGET_PER_CYCLE.
  let signalsExtracted = 0;
  let signalsStored = 0;
  let rePredictionsTriggered = 0;

  const candidates = allItems.slice(0, HAIKU_BUDGET_PER_CYCLE);
  for (const item of candidates) {
    let signals = [] as Awaited<ReturnType<typeof extractSignals>>;
    try {
      signals = await extractSignals(item);
    } catch (err) {
      errors.push(`extract ${item.url}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    signalsExtracted += signals.length;

    // 6 + 7: store each signal; fire-and-forget re-predict for material ones.
    for (const signal of signals) {
      try {
        const row = await upsertPlayerAvailability(signal, { sourceUrl: item.url });
        signalsStored++;

        if (signal.severity === "critical" || signal.severity === "moderate") {
          // Fire-and-forget. The trigger never throws (it logs + swallows),
          // but we keep a .catch anyway for belt-and-suspenders.
          void triggerRePrediction(signal, row.id, baseUrl)
            .then((n) => {
              rePredictionsTriggered += n;
            })
            .catch((err) => {
              errors.push(`re-predict: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
      } catch (err) {
        errors.push(`store: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 8: clean expired rows.
  let expiredCleaned = 0;
  try {
    expiredCleaned = await cleanExpired();
  } catch (err) {
    errors.push(`clean: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    runAt,
    itemsProcessed: candidates.length,
    signalsExtracted,
    signalsStored,
    rePredictionsTriggered,
    expiredCleaned,
    errors,
    sourceStats,
  };
}

// ─── Recent-cycle stats ringbuffer (for /api/ingestion/status) ──────────────
// Keeps the 10 most recent cycle summaries so the admin endpoint can show
// "last 5 cycles" without a DB round-trip.

const RECENT_RESULTS: IngestionCycleResult[] = [];
const RECENT_MAX = 10;

export function recordCycleResult(result: IngestionCycleResult): void {
  RECENT_RESULTS.unshift(result);
  if (RECENT_RESULTS.length > RECENT_MAX) RECENT_RESULTS.length = RECENT_MAX;
}

export function getRecentCycles(n: number = RECENT_MAX): IngestionCycleResult[] {
  return RECENT_RESULTS.slice(0, Math.min(n, RECENT_MAX));
}
