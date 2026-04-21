/**
 * Tests for the ESPN per-game injury parser.
 *
 * Verifies:
 *   - Home/away team matching works by team ID
 *   - Individual injury records are parsed with all fields
 *   - Missing / malformed records are handled gracefully
 *   - toTeamInjuryReport buckets by status correctly
 */

import { describe, it, expect } from "bun:test";
import {
  parseESPNInjury,
  parseGameInjuries,
  toTeamInjuryReport,
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
            id: "3975",
            fullName: "Austin Reaves",
            displayName: "A. Reaves",
            position: { abbreviation: "G", name: "Guard" },
          },
          type: { name: "INJURY_STATUS_OUT", description: "out", abbreviation: "O" },
          details: {
            type: "Oblique",
            location: "Torso",
            detail: "Strain",
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
  it("parses a well-formed injury record", () => {
    const record = mockESPNResponse.injuries[0]!.injuries[0]!;
    const injury = parseESPNInjury(record);

    expect(injury).not.toBeNull();
    expect(injury!.playerId).toBe("3975");
    expect(injury!.playerName).toBe("Austin Reaves");
    expect(injury!.position).toBe("G");
    expect(injury!.status).toBe("Out");
    expect(injury!.injuryType).toContain("Oblique");
    expect(injury!.injuryType).toContain("Strain");
    expect(injury!.returnDate).toBe("2026-05-01");
  });

  it("handles missing details gracefully", () => {
    const record = mockESPNResponse.injuries[1]!.injuries[1]!;
    const injury = parseESPNInjury(record);

    expect(injury).not.toBeNull();
    expect(injury!.playerName).toBe("Bench Player");
    expect(injury!.status).toBe("Doubtful");
    expect(injury!.injuryType).toBe("");
    expect(injury!.returnDate).toBeNull();
  });

  it("returns null for records with no player name", () => {
    expect(parseESPNInjury({ status: "Out", athlete: {} })).toBeNull();
    expect(parseESPNInjury({})).toBeNull();
    expect(parseESPNInjury(null)).toBeNull();
  });

  it("normalizes various status strings", () => {
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

  it("swaps home/away correctly when team IDs are reversed", () => {
    // HOU as home, LAL as away
    const report = parseGameInjuries(mockESPNResponse, "10", "13");

    expect(report.homeTeamInjuries.length).toBe(2);
    expect(report.homeTeamInjuries[0]!.playerName).toBe("Alperen Sengun");

    expect(report.awayTeamInjuries.length).toBe(2);
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

    // Lakers: 2 OUT
    expect(homeReport.totalOut).toBe(2);
    expect(homeReport.totalDoubtful).toBe(0);
    expect(homeReport.totalQuestionable).toBe(0);
    expect(homeReport.out.map((p) => p.name)).toEqual(["Austin Reaves", "Luka Doncic"]);

    // Rockets: 1 questionable, 1 doubtful
    expect(awayReport.totalOut).toBe(0);
    expect(awayReport.totalDoubtful).toBe(1);
    expect(awayReport.totalQuestionable).toBe(1);
    expect(awayReport.questionable[0]!.name).toBe("Alperen Sengun");
    expect(awayReport.doubtful[0]!.name).toBe("Bench Player");
  });

  it("buckets day-to-day into questionable", () => {
    const report = toTeamInjuryReport([
      {
        playerId: "1", playerName: "DTD Guy", position: "G",
        status: "Day-To-Day", injuryType: "Ankle", returnDate: null,
      },
    ]);
    expect(report.totalQuestionable).toBe(1);
    expect(report.totalOut).toBe(0);
  });
});
