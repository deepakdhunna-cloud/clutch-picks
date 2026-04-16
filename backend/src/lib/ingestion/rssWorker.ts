/**
 * RSS ingestion worker.
 *
 * Iterates the rss-typed entries in the source registry, fetches each
 * feed with a hard timeout, and returns unseen items for the LLM
 * extractor downstream. Every feed is isolated — one source throwing
 * a parse error must not kill the rest of the batch.
 *
 * Dedup is URL-keyed against the shared LRU (dedupCache.ts). An item
 * that survives this worker is guaranteed to be a first-sighting in
 * the past 24 hours.
 */

import Parser from "rss-parser";
import { CREDIBILITY_SCORES, type Source } from "./sourceRegistry";
import { markSeen, seenBefore } from "./dedupCache";
import type { RawNewsItem } from "./types";

const parser = new Parser({ timeout: 8_000 });

export interface RSSPollSummary {
  items: RawNewsItem[];
  stats: Array<{ sourceName: string; fetched: number; newItems: number; ok: boolean }>;
}

/**
 * Poll all rss-type sources and return deduplicated new items.
 * Never throws — per-source errors are swallowed and reported in stats.
 */
export async function pollRSSSources(sources: Source[]): Promise<RSSPollSummary> {
  const items: RawNewsItem[] = [];
  const stats: RSSPollSummary["stats"] = [];

  const rssSources = sources.filter((s) => s.type === "rss");
  for (const source of rssSources) {
    let fetched = 0;
    let newItems = 0;
    let ok = true;
    try {
      const feed = await parser.parseURL(source.url);
      for (const entry of feed.items ?? []) {
        fetched++;
        const url = entry.link ?? entry.guid ?? "";
        if (!url || seenBefore(url)) continue;
        markSeen(url);

        const item: RawNewsItem = {
          sourceId: source.id,
          sourceName: source.name,
          sourceType: "rss",
          credibilityTier: source.credibility,
          credibility: CREDIBILITY_SCORES[source.credibility],
          title: entry.title?.trim() ?? "",
          content: (entry.contentSnippet ?? entry.content ?? "").trim(),
          url,
          publishedAt: entry.isoDate ?? entry.pubDate ?? new Date().toISOString(),
          teams: source.teams,
        };
        items.push(item);
        newItems++;
      }
    } catch (err) {
      ok = false;
      console.warn(
        `[ingestion] RSS fetch failed for ${source.name}:`,
        err instanceof Error ? err.message : err,
      );
    }

    console.log(`[ingestion] RSS polled ${source.name}: ${newItems} new items (of ${fetched})`);
    stats.push({ sourceName: source.name, fetched, newItems, ok });
  }

  return { items, stats };
}
