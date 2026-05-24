/**
 * Twitter ingestion worker — Apify-backed.
 *
 * Apify's Twitter/X Actor is the Twitter alternative for apps that can't use
 * the paid X API. It runs asynchronously: POST a run → poll the run status →
 * fetch the dataset when it's done. Each Actor call costs credits, so we batch
 * a small rotating set of handles into one run per cycle.
 *
 * Feature-gated on APIFY_API_KEY:
 *   - Unset → empty array, one startup warning
 *   - Set but call errors / times out → that source is skipped, cycle continues
 *
 * Dedup is URL-keyed via the shared LRU (dedupCache). The canonical tweet URL
 * is preferred; if Apify doesn't return one we fall back to
 * `https://x.com/${handle}/status/${id}`.
 */

import { CREDIBILITY_SCORES, type Source } from "./sourceRegistry";
import { markSeen, seenBefore } from "./dedupCache";
import type { RawNewsItem } from "./types";

const APIFY_ACTOR_SLUG = "fastdata~twitter-scraper";
const APIFY_BASE = "https://api.apify.com/v2";
const MAX_HANDLES_PER_CYCLE = 5;
const RUN_POLL_INTERVAL_MS = 3_000;
const RUN_TIMEOUT_MS = 30_000;
const TWEETS_PER_HANDLE = 5;
let nextSourceIndex = 0;

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
  username?: string;
  userName?: string;
  author?: {
    username?: string;
    userName?: string;
  };
}

async function startRun(apiKey: string, handles: string[]): Promise<{ runId: string; datasetId: string } | null> {
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/${APIFY_ACTOR_SLUG}/runs?token=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(8_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          twitterHandles: handles,
          mode: "tweets",
          maxTweets: handles.length * TWEETS_PER_HANDLE,
          maxTweetsPerAccount: TWEETS_PER_HANDLE,
          includeReplies: false,
          includeRetweets: true,
          deduplicate: true,
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

function normalizeHandle(value: string | null | undefined): string | null {
  const raw = value?.trim().replace(/^@/, "");
  return raw ? raw.toLowerCase() : null;
}

function tweetHandle(tweet: ApifyTweet): string | null {
  return (
    normalizeHandle(tweet.author?.username) ??
    normalizeHandle(tweet.author?.userName) ??
    normalizeHandle(tweet.username) ??
    normalizeHandle(tweet.userName) ??
    normalizeHandle(handleFromUrl(tweet.url ?? ""))
  );
}

function tweetPublishedAt(tweet: ApifyTweet): string {
  if (typeof tweet.createdAtMs === "number" && Number.isFinite(tweet.createdAtMs)) {
    return new Date(tweet.createdAtMs).toISOString();
  }

  if (tweet.createdAt) {
    const parsed = Date.parse(tweet.createdAt);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  return new Date().toISOString();
}

function tweetUrl(tweet: ApifyTweet, handle: string): string {
  return tweet.url ?? (tweet.id ? `https://x.com/${handle}/status/${tweet.id}` : "");
}

export function selectTwitterSourceBatchForTest(sources: Source[], maxHandles = MAX_HANDLES_PER_CYCLE): Source[] {
  const twitterSources = sources.filter((s) => s.type === "twitter");
  if (twitterSources.length === 0) return [];

  const start = nextSourceIndex % twitterSources.length;
  const selected: Source[] = [];
  for (let i = 0; i < Math.min(maxHandles, twitterSources.length); i++) {
    selected.push(twitterSources[(start + i) % twitterSources.length]!);
  }
  nextSourceIndex = (start + selected.length) % twitterSources.length;
  return selected;
}

export function resetTwitterSourceRotationForTest(): void {
  nextSourceIndex = 0;
}

/**
 * Poll a rotating batch of Twitter sources through one Apify run. Returns all
 * fresh tweets for those handles, or empty on any failure.
 */
async function pollBatch(apiKey: string, sources: Source[]): Promise<Map<string, RawNewsItem[]>> {
  const sourceByHandle = new Map<string, Source>();
  for (const source of sources) {
    const handle = normalizeHandle(handleFromUrl(source.url));
    if (handle) sourceByHandle.set(handle, source);
  }
  const handles = [...sourceByHandle.keys()];
  const itemsBySourceId = new Map<string, RawNewsItem[]>();
  if (handles.length === 0) return itemsBySourceId;

  const run = await startRun(apiKey, handles);
  if (!run) return itemsBySourceId;

  const ok = await waitForRun(apiKey, run.runId);
  if (!ok) return itemsBySourceId;

  const tweets = await fetchDataset(apiKey, run.datasetId);
  for (const t of tweets) {
    const handle = tweetHandle(t);
    const source = handle ? sourceByHandle.get(handle) : undefined;
    if (!source || !handle) continue;
    const url = tweetUrl(t, handle);
    if (!url || seenBefore(url)) continue;
    if (!t.text || t.text.length < 10) continue; // skip empty / near-empty tweets
    markSeen(url);
    const items = itemsBySourceId.get(source.id) ?? [];
    items.push({
      sourceId: source.id,
      sourceName: source.name,
      sourceType: "twitter",
      credibilityTier: source.credibility,
      credibility: CREDIBILITY_SCORES[source.credibility],
      title: t.text.slice(0, 180), // tweets have no title — use first 180 chars
      content: t.text,
      url,
      publishedAt: tweetPublishedAt(t),
      teams: source.teams,
    });
    itemsBySourceId.set(source.id, items);
  }
  return itemsBySourceId;
}

export async function pollTwitterSources(sources: Source[]): Promise<TwitterPollSummary> {
  const apiKey = getApiKey();
  if (!apiKey) return { items: [], stats: [] };

  const twitterSources = selectTwitterSourceBatchForTest(sources);
  const stats: TwitterPollSummary["stats"] = [];
  const items: RawNewsItem[] = [];
  if (twitterSources.length === 0) return { items, stats };

  console.log(
    `[ingestion] Twitter batch: ${twitterSources.length}/${sources.filter((s) => s.type === "twitter").length} handles via ${APIFY_ACTOR_SLUG}`,
  );

  let itemsBySourceId = new Map<string, RawNewsItem[]>();
  let ok = true;
  try {
    itemsBySourceId = await pollBatch(apiKey, twitterSources);
  } catch (err) {
    ok = false;
    console.warn(
      "[ingestion] Twitter batch poll failed:",
      err instanceof Error ? err.message : err,
    );
  }

  for (const source of twitterSources) {
    const fresh = itemsBySourceId.get(source.id) ?? [];
    items.push(...fresh);
    const count = fresh.length;
    console.log(`[ingestion] Twitter polled ${source.name}: ${count} new tweets`);
    stats.push({ sourceName: source.name, fetched: count, newItems: count, ok });
  }

  return { items, stats };
}
