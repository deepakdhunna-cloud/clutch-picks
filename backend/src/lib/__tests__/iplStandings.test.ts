import { describe, expect, test } from "bun:test";
import { indexIPLStandings, parseIPLStandingEntry } from "../iplStandings";

describe("IPL standings enrichment helpers", () => {
  test("parses rank, points, record, and net run rate from ESPN standings rows", () => {
    const parsed = parseIPLStandingEntry({
      team: { id: "335970", abbreviation: "RCB" },
      stats: [
        { name: "rank", value: 1, displayValue: "1" },
        { name: "matchesPlayed", value: 13, displayValue: "13" },
        { name: "matchesWon", value: 9, displayValue: "9" },
        { name: "matchesLost", value: 4, displayValue: "4" },
        { name: "matchPoints", value: 18, displayValue: "18" },
        { name: "netrr", value: 1.065, displayValue: "1.065" },
      ],
    });

    expect(parsed).toEqual({
      teamId: "335970",
      abbreviation: "RCB",
      rank: 1,
      matchesPlayed: 13,
      wins: 9,
      losses: 4,
      noResult: 0,
      matchPoints: 18,
      netRunRate: 1.065,
      record: "9-4",
    });
  });

  test("indexes standings by ESPN team id and abbreviation", () => {
    const indexed = indexIPLStandings([
      {
        teamId: "628333",
        abbreviation: "SRH",
        rank: 3,
        matchesPlayed: 13,
        wins: 8,
        losses: 5,
        noResult: 0,
        matchPoints: 16,
        netRunRate: 0.35,
        record: "8-5",
      },
    ]);

    expect(indexed.get("628333")?.abbreviation).toBe("SRH");
    expect(indexed.get("SRH")?.rank).toBe(3);
  });
});
