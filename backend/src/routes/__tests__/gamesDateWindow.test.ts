import { describe, expect, test } from "bun:test";
import { buildHomeGamesDateWindow } from "../games";

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
