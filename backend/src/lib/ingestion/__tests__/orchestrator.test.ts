/**
 * Orchestrator tests.
 *
 * We verify the two pure pieces of the orchestrator without mocking
 * Prisma / fetch:
 *
 *   1. `prioritize` — credibility-first, then recency. This is the
 *      rule that decides which of our 25 news sources gets Haiku
 *      budget when we only have 50 calls per cycle.
 *   2. `recordCycleResult` / `getRecentCycles` — the 10-entry
 *      ringbuffer the admin endpoint reads from.
 *
 * A full runIngestionCycle integration test would need stubs for
 * rss-parser, Apify, Anthropic, and Prisma — outside the scope of
 * these unit tests. Those layers each have their own focused tests
 * or defensive-null contracts that make them safe to ship.
 */

import { describe, it, expect } from "bun:test";
import {
  prioritize,
  recordCycleResult,
  getRecentCycles,
  type IngestionCycleResult,
} from "../orchestrator";
import type { RawNewsItem } from "../types";

function makeItem(
  sourceName: string,
  credibility: number,
  publishedAt: string,
): RawNewsItem {
  return {
    sourceId: sourceName.toLowerCase(),
    sourceName,
    sourceType: "rss",
    credibilityTier: credibility >= 0.9 ? "tier1" : credibility >= 0.7 ? "tier2" : "tier3",
    credibility,
    title: `${sourceName} headline`,
    content: "body",
    url: `https://example.com/${sourceName}/${publishedAt}`,
    publishedAt,
  };
}

function emptyCycle(runAt: string, errors: string[] = []): IngestionCycleResult {
  return {
    runAt,
    itemsProcessed: 0,
    signalsExtracted: 0,
    signalsStored: 0,
    rePredictionsTriggered: 0,
    expiredCleaned: 0,
    errors,
    sourceStats: [],
  };
}

describe("prioritize", () => {
  it("puts higher-credibility sources ahead of lower-credibility, regardless of timestamp", () => {
    const items = [
      makeItem("Reddit", 0.40, "2026-04-16T10:00:00Z"),
      makeItem("Shams", 0.95, "2026-04-16T09:00:00Z"),
      makeItem("BeatWriter", 0.75, "2026-04-16T08:00:00Z"),
    ];
    const out = prioritize(items);
    expect(out.map((i) => i.sourceName)).toEqual(["Shams", "BeatWriter", "Reddit"]);
  });

  it("breaks ties in favor of the newer item at the same credibility tier", () => {
    const items = [
      makeItem("BeatWriterA", 0.75, "2026-04-16T08:00:00Z"),
      makeItem("BeatWriterB", 0.75, "2026-04-16T09:00:00Z"), // newer
      makeItem("BeatWriterC", 0.75, "2026-04-16T07:00:00Z"),
    ];
    const out = prioritize(items);
    expect(out.map((i) => i.sourceName)).toEqual([
      "BeatWriterB",
      "BeatWriterA",
      "BeatWriterC",
    ]);
  });
});

describe("recordCycleResult / getRecentCycles", () => {
  it("keeps at most 10 entries, newest first", () => {
    // Push 12 cycles — last one should be newest in the list.
    for (let i = 0; i < 12; i++) {
      recordCycleResult(emptyCycle(`2026-04-16T10:${String(i).padStart(2, "0")}:00Z`));
    }
    const recent = getRecentCycles();
    expect(recent.length).toBeLessThanOrEqual(10);
    // The most recent push is "11" (0-indexed); earlier pushes should be
    // evicted. Confirm ordering: first entry's runAt > second entry's.
    expect(recent[0]!.runAt >= recent[1]!.runAt).toBe(true);
  });

  it("returns the last N on request", () => {
    recordCycleResult(emptyCycle("2026-04-16T11:00:00Z", ["one-off error"]));
    const three = getRecentCycles(3);
    expect(three.length).toBeLessThanOrEqual(3);
    expect(three[0]!.errors).toContain("one-off error");
  });
});
