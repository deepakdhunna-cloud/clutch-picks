import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  fetchTeamExtendedStats,
  fetchTeamRecentForm,
  resetESPNStatsCachesForTest,
} from "../espnStats";

let fetchSpy: ReturnType<typeof spyOn> | undefined;

function event(args: {
  id: string;
  date: string;
  homeAway: "home" | "away";
  teamScore: number;
  opponentScore: number;
  won: boolean;
}) {
  return {
    id: args.id,
    date: args.date,
    competitions: [
      {
        date: args.date,
        status: { type: { completed: true, state: "post" } },
        competitors: [
          {
            id: "team",
            homeAway: args.homeAway,
            winner: args.won,
            score: String(args.teamScore),
            team: { id: "1" },
            records: [{ type: "overall", summary: "10-5" }],
          },
          {
            id: "opponent",
            homeAway: args.homeAway === "home" ? "away" : "home",
            winner: !args.won,
            score: String(args.opponentScore),
            team: { id: "2" },
            records: [{ type: "overall", summary: "8-7" }],
          },
        ],
      },
    ],
  };
}

function mockSchedule(events: unknown[]): void {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    (async (_input: Parameters<typeof fetch>[0]) =>
      new Response(JSON.stringify({ events }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  resetESPNStatsCachesForTest();
});

afterEach(() => {
  fetchSpy?.mockRestore?.();
  fetchSpy = undefined;
  resetESPNStatsCachesForTest();
});

describe("ESPN stats point-in-time windows", () => {
  it("caps recent form to games completed before the target event", async () => {
    mockSchedule([
      event({ id: "future", date: "2026-05-12T00:00:00Z", homeAway: "home", teamScore: 130, opponentScore: 100, won: true }),
      event({ id: "past-2", date: "2026-05-05T00:00:00Z", homeAway: "away", teamScore: 80, opponentScore: 91, won: false }),
      event({ id: "past-1", date: "2026-05-01T00:00:00Z", homeAway: "home", teamScore: 100, opponentScore: 90, won: true }),
    ]);

    const form = await fetchTeamRecentForm("1", "NBA", 10, new Date("2026-05-10T00:00:00Z"));

    expect(form.results).toEqual(["W", "L"]);
    expect(form.wins).toBe(1);
    expect(form.losses).toBe(1);
    expect(form.avgScore).toBe(90);
    expect(form.avgAllowed).toBe(90.5);
  });

  it("caps extended stats and rest days to games before the target event", async () => {
    mockSchedule([
      event({ id: "future", date: "2026-05-12T00:00:00Z", homeAway: "home", teamScore: 130, opponentScore: 100, won: true }),
      event({ id: "past-2", date: "2026-05-05T00:00:00Z", homeAway: "away", teamScore: 80, opponentScore: 91, won: false }),
      event({ id: "past-1", date: "2026-05-01T00:00:00Z", homeAway: "home", teamScore: 100, opponentScore: 90, won: true }),
    ]);

    const stats = await fetchTeamExtendedStats("1", "NBA", "2", new Date("2026-05-10T00:00:00Z"));

    expect(stats.homeRecord).toEqual({ wins: 1, losses: 0 });
    expect(stats.awayRecord).toEqual({ wins: 0, losses: 1 });
    expect(stats.headToHeadResults).toHaveLength(2);
    expect(stats.restDays).toBe(4);
    expect(stats.consecutiveAwayGames).toBe(1);
  });
});
