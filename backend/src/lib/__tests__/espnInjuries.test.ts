/**
 * Tests for the ESPN per-game injury parser.
 *
 * Verifies:
 *   - Home/away team matching works by team ID (array order not trusted)
 *   - Individual injury records are parsed with all fields
 *   - Missing / malformed records (no `details`) are handled defensively
 *   - toTeamInjuryReport buckets by status correctly
 *   - Unsupported sports (soccer) return source="unavailable" with NO
 *     network call
 */

import { describe, it, expect, spyOn } from "bun:test";
import {
  parseESPNInjury,
  parseGameInjuries,
  toTeamInjuryReport,
  fetchGameInjuries,
} from "../espnInjuries";

// Realistic shape based on ESPN's /summary?event=... response for a Lakers/Rockets game.
const mockESPNResponse = {
  injuries: [
    {
      team: { id: "13", abbreviation: "LAL" },
      injuries: [
        {
          status: "Out",
          athlete: {
            id: "4066457",
            fullName: "Austin Reaves",
            displayName: "A. Reaves",
            position: { abbreviation: "G", name: "Guard" },
          },
          type: { name: "INJURY_STATUS_OUT", description: "out", abbreviation: "O" },
          details: {
            type: "Oblique",
            location: "Torso",
            detail: "Strain",
            side: "Left",
            returnDate: "2026-05-01",
          },
        },
        {
          status: "Out",
          athlete: {
            id: "4066261",
            fullName: "Luka Doncic",
            position: { abbreviation: "G" },
          },
          type: { description: "out" },
          details: { type: "Calf", location: "Leg", detail: "Strain" },
        },
      ],
    },
    {
      team: { id: "10", abbreviation: "HOU" },
      injuries: [
        {
          status: "Questionable",
          athlete: {
            id: "4278073",
            fullName: "Alperen Sengun",
            position: { abbreviation: "C" },
          },
          type: { description: "questionable" },
          details: { type: "Ankle", detail: "Sprain" },
        },
        {
          status: "Doubtful",
          athlete: {
            id: "9999",
            fullName: "Bench Player",
            position: { abbreviation: "F" },
          },
          type: { description: "doubtful" },
          // Intentionally missing `details`
        },
      ],
    },
  ],
};

describe("parseESPNInjury", () => {
  it("parses a well-formed injury record with side", () => {
    const record = mockESPNResponse.injuries[0]!.injuries[0]!;
    const injury = parseESPNInjury(record);

    expect(injury).not.toBeNull();
    expect(injury!.playerId).toBe("4066457");
    expect(injury!.playerName).toBe("Austin Reaves");
    expect(injury!.position).toBe("G");
    expect(injury!.status).toBe("Out");
    // Side is wrapped in parens per the spec's example
    expect(injury!.injuryDescription).toBe("Oblique Strain (Left)");
    expect(injury!.returnDate).toBe("2026-05-01");
  });

  it("handles missing details defensively", () => {
    const record = mockESPNResponse.injuries[1]!.injuries[1]!;
    const injury = parseESPNInjury(record);

    expect(injury).not.toBeNull();
    expect(injury!.playerName).toBe("Bench Player");
    expect(injury!.status).toBe("Doubtful");
    // Falls back to type.description when details is absent
    expect(injury!.injuryDescription).toBe("doubtful");
    expect(injury!.returnDate).toBeNull();
  });

  it("returns null for records with no player name", () => {
    expect(parseESPNInjury({ status: "Out", athlete: {} })).toBeNull();
    expect(parseESPNInjury({})).toBeNull();
    expect(parseESPNInjury(null)).toBeNull();
  });

  it("normalizes status strings", () => {
    const cases: Array<[string, string]> = [
      ["Out", "Out"],
      ["OUT", "Out"],
      ["out", "Out"],
      ["Day-To-Day", "Day-To-Day"],
      ["DTD", "Day-To-Day"],
      ["Questionable", "Questionable"],
      ["Doubtful", "Doubtful"],
      ["Probable", "Probable"],
      ["wibble", "Unknown"],
    ];
    for (const [raw, expected] of cases) {
      const injury = parseESPNInjury({
        status: raw,
        athlete: { id: "1", fullName: "Test Player" },
      });
      expect(injury!.status).toBe(expected as any);
    }
  });
});

describe("parseGameInjuries", () => {
  it("matches home and away teams by ID correctly", () => {
    const report = parseGameInjuries(mockESPNResponse, "13", "10");

    expect(report.homeTeamInjuries.length).toBe(2);
    expect(report.homeTeamInjuries[0]!.playerName).toBe("Austin Reaves");
    expect(report.homeTeamInjuries[1]!.playerName).toBe("Luka Doncic");

    expect(report.awayTeamInjuries.length).toBe(2);
    expect(report.awayTeamInjuries[0]!.playerName).toBe("Alperen Sengun");
    expect(report.awayTeamInjuries[1]!.playerName).toBe("Bench Player");
  });

  it("swaps home/away when team IDs are reversed (does not trust array order)", () => {
    const report = parseGameInjuries(mockESPNResponse, "10", "13");
    expect(report.homeTeamInjuries[0]!.playerName).toBe("Alperen Sengun");
    expect(report.awayTeamInjuries[0]!.playerName).toBe("Austin Reaves");
  });

  it("tolerates string vs numeric team IDs", () => {
    const report = parseGameInjuries(mockESPNResponse, 13 as any, 10 as any);
    expect(report.homeTeamInjuries.length).toBe(2);
    expect(report.awayTeamInjuries.length).toBe(2);
  });

  it("returns empty arrays when team IDs don't match", () => {
    const report = parseGameInjuries(mockESPNResponse, "999", "888");
    expect(report.homeTeamInjuries.length).toBe(0);
    expect(report.awayTeamInjuries.length).toBe(0);
  });

  it("handles missing / empty injuries payload", () => {
    expect(parseGameInjuries({}, "13", "10").homeTeamInjuries.length).toBe(0);
    expect(parseGameInjuries({ injuries: [] }, "13", "10").homeTeamInjuries.length).toBe(0);
    expect(parseGameInjuries(null, "13", "10").homeTeamInjuries.length).toBe(0);
  });
});

describe("toTeamInjuryReport", () => {
  it("buckets players by status", () => {
    const report = parseGameInjuries(mockESPNResponse, "13", "10");
    const homeReport = toTeamInjuryReport(report.homeTeamInjuries);
    const awayReport = toTeamInjuryReport(report.awayTeamInjuries);

    expect(homeReport.totalOut).toBe(2);
    expect(homeReport.totalDoubtful).toBe(0);
    expect(homeReport.totalQuestionable).toBe(0);
    expect(homeReport.out.map((p) => p.name)).toEqual(["Austin Reaves", "Luka Doncic"]);
    // Detail comes from the new injuryDescription field
    expect(homeReport.out[0]!.detail).toBe("Oblique Strain (Left)");

    expect(awayReport.totalOut).toBe(0);
    expect(awayReport.totalDoubtful).toBe(1);
    expect(awayReport.totalQuestionable).toBe(1);
  });

  it("buckets day-to-day into questionable", () => {
    const report = toTeamInjuryReport([
      {
        playerId: "1", playerName: "DTD Guy", position: "G",
        status: "Day-To-Day", injuryDescription: "Ankle", returnDate: null,
      },
    ]);
    expect(report.totalQuestionable).toBe(1);
    expect(report.totalOut).toBe(0);
  });
});

describe("fetchGameInjuries — unsupported sports", () => {
  it("returns unavailable for soccer WITHOUT a network call", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    fetchSpy.mockClear();

    const epl = await fetchGameInjuries("EPL", "g1", "t1", "t2");
    const mls = await fetchGameInjuries("MLS", "g2", "t1", "t2");
    const ucl = await fetchGameInjuries("UCL", "g3", "t1", "t2");

    expect(epl.source).toBe("unavailable");
    expect(epl.homeTeamInjuries).toEqual([]);
    expect(epl.awayTeamInjuries).toEqual([]);
    expect(mls.source).toBe("unavailable");
    expect(ucl.source).toBe("unavailable");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns unavailable for NFL/NCAA without a network call", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    fetchSpy.mockClear();

    const nfl = await fetchGameInjuries("NFL", "g1", "t1", "t2");
    const ncaaf = await fetchGameInjuries("NCAAF", "g2", "t1", "t2");
    const ncaab = await fetchGameInjuries("NCAAB", "g3", "t1", "t2");

    expect(nfl.source).toBe("unavailable");
    expect(ncaaf.source).toBe("unavailable");
    expect(ncaab.source).toBe("unavailable");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
