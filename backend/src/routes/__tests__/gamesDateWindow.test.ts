import { describe, expect, test } from "bun:test";
import { buildHomeGamesDateWindow, buildGameLookupDateOffsets } from "../games";

describe("buildGameLookupDateOffsets", () => {
  test("known sport looks back deep enough to resolve older picks", () => {
    const offsets = buildGameLookupDateOffsets({ knownSport: true });
    // Today (0) is searched by the caller first, so it must not be in here.
    expect(offsets).not.toContain(0);
    // Reaches well past the old ±3-day window so 1–3 week-old picks resolve.
    expect(Math.min(...offsets)).toBeLessThanOrEqual(-21);
    // Still probes a few days forward for misfiled/future-dated events.
    expect(Math.max(...offsets)).toBeGreaterThanOrEqual(3);
    // Closest dates come first so the common case resolves with fewest round-trips.
    expect(offsets.slice(0, 4)).toEqual([1, -1, 2, -2]);
  });

  test("unknown sport keeps the window shallow to avoid all-sport fan-out", () => {
    const offsets = buildGameLookupDateOffsets({ knownSport: false });
    expect(offsets).not.toContain(0);
    expect(Math.min(...offsets)).toBe(-3);
    expect(Math.max(...offsets)).toBe(3);
    // No date may repeat (would double the ESPN calls for nothing).
    expect(new Set(offsets).size).toBe(offsets.length);
  });
});

describe("buildHomeGamesDateWindow", () => {
  test("includes the previous UTC date so US evening users do not lose same-day games", () => {
    const window = buildHomeGamesDateWindow(new Date("2026-05-28T02:30:00.000Z"));

    expect(window.fetchDates).toEqual([
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
    ]);
  });

  test("sets a rolling coverage window that keeps recent finals but excludes stale scheduled games", () => {
    const window = buildHomeGamesDateWindow(new Date("2026-05-28T02:30:00.000Z"));

    expect(window.coverageStart.toISOString()).toBe("2026-05-26T20:30:00.000Z");
    expect(window.scheduledCutoff.toISOString()).toBe("2026-05-30T23:59:59.999Z");
  });
});
