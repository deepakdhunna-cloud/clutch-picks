import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  fetchSportsDataIOAdvancedMetrics,
  fetchSportsDataIOInjuries,
  fetchSportsDataIOLineup,
  mergeAdvancedMetrics,
  mergeInjuryReports,
  resetSportsDataIOCacheForTest,
} from "../sportsDataIO";
import type { TeamInjuryReport } from "../espnStats";

let originalKey: string | undefined;
let fetchSpy: any;

function mockFetch(routes: Record<string, unknown>): void {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      const match = Object.entries(routes).find(([path]) => url.includes(path));
      if (!match) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      return new Response(JSON.stringify(match[1]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );
}

function emptyInjuryReport(): TeamInjuryReport {
  return {
    out: [],
    doubtful: [],
    questionable: [],
    totalOut: 0,
    totalDoubtful: 0,
    totalQuestionable: 0,
  };
}

beforeEach(() => {
  originalKey = process.env.SPORTSDATAIO_API_KEY;
  process.env.SPORTSDATAIO_API_KEY = "test-sportsdataio-key";
  resetSportsDataIOCacheForTest();
});

afterEach(() => {
  fetchSpy?.mockRestore?.();
  fetchSpy = undefined;
  resetSportsDataIOCacheForTest();
  if (originalKey === undefined) {
    delete process.env.SPORTSDATAIO_API_KEY;
  } else {
    process.env.SPORTSDATAIO_API_KEY = originalKey;
  }
});

describe("SportsDataIO provider", () => {
  it("does not call the network when the API key is missing", async () => {
    delete process.env.SPORTSDATAIO_API_KEY;
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    mockFetch({});

    const metrics = await fetchSportsDataIOAdvancedMetrics(
      "NBA",
      "OKC",
      new Date("2026-05-24T18:00:00Z"),
    );

    expect(metrics).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("derives NBA offensive and defensive rating from team season stats", async () => {
    mockFetch({
      AllTeams: [
        { TeamID: 1, Key: "OKC", City: "Oklahoma City", Name: "Thunder" },
      ],
      "TeamSeasonStats/2026": [
        {
          TeamID: 1,
          Team: "OKC",
          Points: 11400,
          Possessions: 9500,
          OpponentStat: {
            Points: 10830,
            Possessions: 9500,
          },
        },
      ],
    });

    const metrics = await fetchSportsDataIOAdvancedMetrics(
      "NBA",
      "OKC",
      new Date("2026-05-24T18:00:00Z"),
    );

    expect(metrics?.offensiveRating).toBeCloseTo(120, 5);
    expect(metrics?.defensiveRating).toBeCloseTo(114, 5);
  });

  it("dedupes identical in-flight provider calls", async () => {
    mockFetch({
      AllTeams: [
        { TeamID: 1, Key: "OKC", City: "Oklahoma City", Name: "Thunder" },
      ],
      "TeamSeasonStats/2026": [
        {
          TeamID: 1,
          Team: "OKC",
          Points: 11400,
          Possessions: 9500,
          OpponentStat: {
            Points: 10830,
            Possessions: 9500,
          },
        },
      ],
    });

    const [first, second] = await Promise.all([
      fetchSportsDataIOAdvancedMetrics("NBA", "OKC", new Date("2026-05-24T18:00:00Z")),
      fetchSportsDataIOAdvancedMetrics("NBA", "OKC", new Date("2026-05-24T18:00:00Z")),
    ]);

    const urls = fetchSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(first?.offensiveRating).toBeCloseTo(120, 5);
    expect(second?.defensiveRating).toBeCloseTo(114, 5);
    expect(urls.filter((url: string) => url.includes("AllTeams")).length).toBe(1);
    expect(urls.filter((url: string) => url.includes("TeamSeasonStats/2026")).length).toBe(1);
  });

  it("overrides ESPN metrics only with finite SportsDataIO values", () => {
    const merged = mergeAdvancedMetrics(
      { offensiveRating: 101, defensiveRating: 109, pace: 98.2 },
      { offensiveRating: 118.5, defensiveRating: Number.NaN },
    );

    expect(merged).toEqual({
      offensiveRating: 118.5,
      defensiveRating: 109,
      pace: 98.2,
    });
  });

  it("ignores scrambled injury fields from trial-limited feeds", async () => {
    mockFetch({
      "Players/OKC": [
        {
          Name: "Real Hurt",
          Position: "G",
          InjuryStatus: "Out",
          InjuryBodyPart: "Ankle",
          InjuryNotes: "No timeline",
        },
        {
          Name: "Trial Hidden",
          Position: "F",
          InjuryStatus: "Scrambled",
          InjuryBodyPart: "Scrambled",
          InjuryNotes: "Scrambled",
        },
        {
          Name: "Active Player",
          Position: "C",
          Status: "Active",
        },
      ],
    });

    const report = await fetchSportsDataIOInjuries("NBA", "OKC");

    expect(report?.totalOut).toBe(1);
    expect(report?.out[0]?.name).toBe("Real Hurt");
    expect(report?.out[0]?.detail).toBe("Out - Ankle - No timeline");
    expect(report?.out.some((player) => player.name === "Trial Hidden")).toBe(false);
  });

  it("builds unconfirmed starters from depth charts", async () => {
    mockFetch({
      AllTeams: [
        { TeamID: 1, Key: "OKC", City: "Oklahoma City", Name: "Thunder" },
      ],
      DepthCharts: [
        {
          TeamID: 1,
          DepthCharts: [
            { TeamID: 1, Name: "Backup Guard", Position: "PG", DepthOrder: 2 },
            { TeamID: 1, Name: "Lead Guard", Position: "PG", DepthOrder: 1 },
            { TeamID: 1, Name: "Wing Starter", Position: "SF", DepthOrder: 1 },
            { TeamID: 1, Name: "Scrambled", Position: "C", DepthOrder: 1 },
          ],
        },
      ],
    });

    const lineup = await fetchSportsDataIOLineup("NBA", "OKC");

    expect(lineup?.sport).toBe("NBA");
    expect(lineup?.starters).toEqual([
      { name: "Lead Guard", position: "PG", isConfirmed: false },
      { name: "Wing Starter", position: "SF", isConfirmed: false },
    ]);
  });

  it("merges injury reports without duplicating players across buckets", () => {
    const primary = emptyInjuryReport();
    primary.questionable.push({ name: "Same Player", position: "G", detail: "ESPN questionable" });
    primary.totalQuestionable = 1;

    const merged = mergeInjuryReports(primary, {
      out: [{ name: "Same Player", position: "G", detail: "SportsDataIO out" }],
      doubtful: [],
      questionable: [{ name: "Different Player", position: "F", detail: "Day-to-day" }],
      totalOut: 1,
      totalDoubtful: 0,
      totalQuestionable: 1,
    });

    expect(merged.out.map((player) => player.name)).toEqual(["Same Player"]);
    expect(merged.questionable.map((player) => player.name)).toEqual(["Different Player"]);
    expect(merged.totalOut).toBe(1);
    expect(merged.totalQuestionable).toBe(1);
  });
});
