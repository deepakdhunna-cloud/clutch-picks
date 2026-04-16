/**
 * Shared dedup LRU for the ingestion pipeline.
 *
 * RSS and Twitter both funnel into one cache keyed on the item URL
 * (canonical for articles; tweet permalink for social). A single cache
 * shared between workers avoids the edge case where the same story is
 * picked up via one of Shams' tweets AND his ESPN article — we only
 * want to LLM-extract it once.
 *
 * 1000 entries, 24h TTL: comfortably holds a day of breaking-news
 * volume; a URL falling out of the cache after 24h is fine because
 * LLM-extracted signals auto-expire at 48h anyway, so re-processing
 * yesterday's article just refreshes what's already there.
 */

import { LRUCache } from "lru-cache";

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

const cache = new LRUCache<string, boolean>({ max: 1000, ttl: DEDUP_TTL_MS });

export function seenBefore(url: string): boolean {
  return cache.has(url);
}

export function markSeen(url: string): void {
  cache.set(url, true);
}

/** Test-only — resets the cache so each test starts clean. */
export function _clearDedupCacheForTests(): void {
  cache.clear();
}
