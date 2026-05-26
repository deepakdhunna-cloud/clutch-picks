import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { fetchMLBProjectedStarter, resetMLBStatsApiCachesForTest } from "../mlbStatsApi";

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

beforeEach(() => {
  resetMLBStatsApiCachesForTest();
});

afterEach(() => {
  fetchSpy?.mockRestore?.();
  fetchSpy = undefined;
  resetMLBStatsApiCachesForTest();
});

describe("MLB StatsAPI free starter projection", () => {
  it("projects an unannounced starter from recent official probable-pitcher rotation history", async () => {
    mockFetch({
      "schedule?sportId=1&teamId=121": {
        dates: [
          {
            date: "2026-05-22",
            games: [
              {
                officialDate: "2026-05-22",
                teams: {
                  home: { team: { id: 121 }, probablePitcher: { id: 1001, fullName: "Projected Ace" } },
                  away: { team: { id: 113 } },
                },
              },
            ],
          },
          {
            date: "2026-05-25",
            games: [
              {
                officialDate: "2026-05-25",
                teams: {
                  home: { team: { id: 121 }, probablePitcher: { id: 1002, fullName: "Too Recent Starter" } },
                  away: { team: { id: 113 } },
                },
              },
            ],
          },
          {
            date: "2026-05-27",
            games: [
              {
                officialDate: "2026-05-27",
                teams: {
                  home: { team: { id: 121 } },
                  away: { team: { id: 113 } },
                },
              },
            ],
          },
        ],
      },
      "people/1001/stats?stats=season": {
        stats: [
          {
            splits: [
              {
                stat: {
                  era: "3.20",
                  whip: "1.10",
                  inningsPitched: "60.0",
                  gamesStarted: "10",
                  strikeOuts: "70",
                  baseOnBalls: "18",
                  homeRuns: "6",
                  wins: "4",
                  losses: "2",
                },
              },
            ],
          },
        ],
      },
      "people/1001/stats?stats=gameLog": {
        stats: [
          {
            splits: [
              { stat: { gamesStarted: "1", earnedRuns: "2", inningsPitched: "6.0" } },
              { stat: { gamesStarted: "1", earnedRuns: "1", inningsPitched: "6.0" } },
            ],
          },
        ],
      },
    });

    const starter = await fetchMLBProjectedStarter(21, "2026-05-27");

    expect(starter?.name).toBe("Projected Ace");
    expect(starter?.isProjected).toBe(true);
    expect(starter?.projectionSource).toBe("mlb-rotation-inference");
    expect(starter?.projectedRestDays).toBe(5);
    expect(starter?.seasonEra).toBe(3.2);
    expect(starter?.recent5Era).toBeCloseTo(2.25, 5);
  });
});
