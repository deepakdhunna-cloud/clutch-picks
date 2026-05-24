import { describe, expect, test, beforeEach } from "bun:test";
import {
  resetTwitterSourceRotationForTest,
  selectTwitterSourceBatchForTest,
} from "../twitterWorker";
import type { Source } from "../sourceRegistry";

function source(id: string, type: Source["type"] = "twitter"): Source {
  return {
    id,
    name: id,
    type,
    url: type === "twitter" ? `https://x.com/${id}` : `https://example.com/${id}.rss`,
    sport: "NBA",
    credibility: "tier2",
    enabled: true,
    pollIntervalMs: 120_000,
  };
}

describe("selectTwitterSourceBatchForTest", () => {
  beforeEach(() => {
    resetTwitterSourceRotationForTest();
  });

  test("rotates through Twitter sources instead of repeating the first batch", () => {
    const sources = ["a", "b", "c", "d", "e", "f", "g"].map((id) => source(id));

    expect(selectTwitterSourceBatchForTest(sources, 3).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(selectTwitterSourceBatchForTest(sources, 3).map((s) => s.id)).toEqual(["d", "e", "f"]);
    expect(selectTwitterSourceBatchForTest(sources, 3).map((s) => s.id)).toEqual(["g", "a", "b"]);
  });

  test("ignores non-Twitter sources for the Apify batch", () => {
    const sources = [
      source("rss", "rss"),
      source("a"),
      source("b"),
    ];

    expect(selectTwitterSourceBatchForTest(sources, 5).map((s) => s.id)).toEqual(["a", "b"]);
  });
});
