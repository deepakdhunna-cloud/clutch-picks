/**
 * Twitter ingestion worker — Apify-backed.
 *
 * Apify's twitter-scraper Actor is the Twitter alternative for apps that
 * can't use the paid X API. It runs asynchronously: POST a run → poll
 * the run status → fetch the dataset when it's done. Each Actor call
 * costs compute credits, so we cap at 5 runs per ingestion cycle to
 * stay inside the free tier.
 *
 * Feature-gated on APIFY_API_KEY:
 *   - Unset → empty array, one startup warning
 *   - Set but call errors / times out → that source is skipped, cycle continues
 *
 * Dedup is URL-keyed via the shared LRU (dedupCache). The canonical
 * tweet URL is preferred; if Apify doesn't return one we fall back to
 * `${handle}/status/${id}`.
 */

import { CREDIBILITY_SCORES, type Source } from "./sourceRegistry";
import { markSeen, seenBefore } from "./dedupCache";
import type { RawNewsItem } from "./types";

const APIFY_ACTOR_SLUG = "apify~twitter-scraper";
const APIFY_BASE = "https://api.apify.com/v2";
const MAX_RUNS_PER_CYCLE = 5;
const RUN_POLL_INTERVAL_MS = 3_000;
const RUN_TIMEOUT_MS = 30_000;
const TWEETS_PER_HANDLE = 5;

export interface TwitterPollSummary {
  items: RawNewsItem[];
  stats: Array<{ sourceName: string; fetched: number; newItems: number; ok: boolean }>;
}

let startupWarnLogged = false;
function getApiKey(): string | null {
  const key = process.env.APIFY_API_KEY;
  if (!key) {
    if (!startupWarnLogged) {
      console.warn("[ingestion] APIFY_API_KEY not set — Twitter ingestion disabled");
      startupWarnLogged = true;
    }
    return null;
  }
  return key;
}

/** Parse the @handle out of a Twitter profile URL. */
function handleFromUrl(url: string): string | null {
  // Accepts  https://twitter.com/{handle}  or  https://x.com/{handle}
  const m = /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([^/?#]+)/i.exec(url);
  return m ? (m[1] ?? null) : null;
}

interface ApifyRunStartResponse { data?: { id?: string; defaultDatasetId?: string } }
interface ApifyRunStatusResponse {
  data?: { status?: string; defaultDatasetId?: string };
}
interface ApifyTweet {
  id?: string;
  url?: string;
  text?: string;
  createdAt?: string;
  createdAtMs?: number;
}

async function startRun(apiKey: string, handle: string): Promise<{ runId: string; datasetId: string } | null> {
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/${APIFY_ACTOR_SLUG}/runs?token=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(8_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchTerms: [],
          twitterHandles: [handle],
          maxItems: TWEETS_PER_HANDLE,
          sort: "Latest",
        }),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as ApifyRunStartResponse;
    const runId = body.data?.id;
    const datasetId = body.data?.defaultDatasetId;
    if (!runId || !datasetId) return null;
    return { runId, datasetId };
  } catch {
    return null;
  }
}

async function waitForRun(apiKey: string, runId: string): Promise<boolean> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${APIFY_BASE}/actor-runs/${runId}?token=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) return false;
      const body = (await res.json()) as ApifyRunStatusResponse;
      const status = body.data?.status;
      if (status === "SUCCEEDED") return true;
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") return false;
    } catch {
      // swallow + retry until deadline
    }
    await new Promise((r) => setTimeout(r, RUN_POLL_INTERVAL_MS));
  }
  return false;
}

async function fetchDataset(apiKey: string, datasetId: string): Promise<ApifyTweet[]> {
  try {
    const res = await fetch(
      `${APIFY_BASE}/datasets/${datasetId}/items?token=${encodeURIComponent(apiKey)}&clean=true&format=json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as ApifyTweet[];
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

/**
 * Poll a single Twitter source through Apify. Returns all fresh tweets
 * for that handle, or empty on any failure.
 */
async function pollOne(apiKey: string, source: Source): Promise<RawNewsItem[]> {
  const handle = handleFromUrl(source.url);
  if (!handle) return [];

  const run = await startRun(apiKey, handle);
  if (!run) return [];

  const ok = await waitForRun(apiKey, run.runId);
  if (!ok) return [];

  const tweets = await fetchDataset(apiKey, run.datasetId);
  const items: RawNewsItem[] = [];
  for (const t of tweets) {
    const url = t.url ?? (t.id ? `https://twitter.com/${handle}/status/${t.id}` : "");
    if (!url || seenBefore(url)) continue;
    if (!t.text || t.text.length < 10) continue; // skip empty / near-empty tweets
    markSeen(url);
    items.push({
      sourceId: source.id,
      sourceName: source.name,
      sourceType: "twitter",
      credibilityTier: source.credibility,
      credibility: CREDIBILITY_SCORES[source.credibility],
      title: t.text.slice(0, 180), // tweets have no title — use first 180 chars
      content: t.text,
      url,
      publishedAt:
        t.createdAt ??
        (t.createdAtMs ? new Date(t.createdAtMs).toISOString() : new Date().toISOString()),
      teams: source.teams,
    });
  }
  return items;
}

export async function pollTwitterSources(sources: Source[]): Promise<TwitterPollSummary> {
  const apiKey = getApiKey();
  if (!apiKey) return { items: [], stats: [] };

  const twitterSources = sources.filter((s) => s.type === "twitter");
  const stats: TwitterPollSummary["stats"] = [];
  const items: RawNewsItem[] = [];
  let runsUsed = 0;

  for (const source of twitterSources) {
    if (runsUsed >= MAX_RUNS_PER_CYCLE) {
      console.log(
        `[ingestion] Twitter budget exhausted (${MAX_RUNS_PER_CYCLE} runs/cycle) — skipping ${source.name}`,
      );
      stats.push({ sourceName: source.name, fetched: 0, newItems: 0, ok: false });
      continue;
    }
    runsUsed++;
    let ok = true;
    let fresh: RawNewsItem[] = [];
    try {
      fresh = await pollOne(apiKey, source);
      items.push(...fresh);
    } catch (err) {
      ok = false;
      console.warn(
        `[ingestion] Twitter poll failed for ${source.name}:`,
        err instanceof Error ? err.message : err,
      );
    }
    const count = fresh.length;
    console.log(`[ingestion] Twitter polled ${source.name}: ${count} new tweets`);
    stats.push({ sourceName: source.name, fetched: count, newItems: count, ok });
  }

  return { items, stats };
}
