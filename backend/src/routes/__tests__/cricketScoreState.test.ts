import { describe, expect, test } from "bun:test";
import { buildCricketScoreState, extractESPNLinescores, isVerifiedScoreboardGame } from "../games";

const team = (abbreviation: string) => ({
  id: abbreviation,
  name: abbreviation,
  abbreviation,
  displayName: abbreviation,
  shortDisplayName: abbreviation,
});

describe("buildCricketScoreState", () => {
  test("uses the current batting innings during an IPL chase", () => {
    const state = buildCricketScoreState(
      {
        id: "LSG",
        homeAway: "home",
        team: team("LSG"),
        score: "196/6",
        linescores: [
          {
            period: 1,
            value: 1,
            displayValue: "1",
            wickets: 6,
            runs: 196,
            overs: 20,
            isBatting: true,
            description: "complete",
            isCurrent: 0,
          },
          {
            period: 2,
            value: 2,
            displayValue: "2",
            wickets: 0,
            runs: 0,
            overs: 4.5,
            isBatting: false,
            description: "",
            isCurrent: 1,
          },
        ],
      },
      {
        id: "PBKS",
        homeAway: "away",
        team: team("PBKS"),
        score: "54/2 (4.5/20 ov, target 197)",
        linescores: [
          {
            period: 1,
            value: 1,
            displayValue: "1",
            wickets: 0,
            runs: 0,
            overs: 20,
            isBatting: false,
            description: "complete",
            isCurrent: 0,
          },
          {
            period: 2,
            value: 2,
            displayValue: "2",
            wickets: 2,
            runs: 54,
            overs: 4.5,
            isBatting: true,
            description: "",
            isCurrent: 1,
          },
        ],
      },
      {
        period: 2,
        summary: "PBKS require 143 runs",
        displayClock: "",
        type: {
          id: "2",
          state: "in",
          description: "Live",
          detail: "Live",
          shortDetail: "Live",
        },
      },
    );

    expect(state?.battingSide).toBe("away");
    expect(state?.home?.isBatting).toBe(false);
    expect(state?.away?.isBatting).toBe(true);
    expect(state?.home?.scoreText).toBe("196/6");
    expect(state?.away?.scoreText).toBe("54/2");
    expect(state?.away?.detailText).toBe("4.5/20 ov");
    expect(state?.target).toBe(197);
  });

  test("uses IPL runs instead of period numbers for innings table cells", () => {
    expect(
      extractESPNLinescores(
        {
          linescores: [
            { value: 1, runs: 196 },
            { value: 2, runs: 0 },
          ],
        },
        "IPL",
      ),
    ).toEqual([196, 0]);
  });

  test("rejects synthetic scoreboard ids for every sport", () => {
    expect(isVerifiedScoreboardGame({
      id: "tennis-explorer-3212381",
      sport: "TENNIS",
      status: "LIVE",
      homeScore: 1,
      awayScore: 0,
    })).toBe(false);

    expect(isVerifiedScoreboardGame({
      id: "tennis-explorer-3212381",
      sport: "TENNIS",
      source: "tennis-explorer",
      status: "LIVE",
      homeScore: 1,
      awayScore: 0,
    })).toBe(true);

    expect(isVerifiedScoreboardGame({
      id: "tennis-explorer-3211687",
      sport: "TENNIS",
      source: "tennis-explorer",
      status: "SCHEDULED",
    })).toBe(true);

    expect(isVerifiedScoreboardGame({
      id: "manual-live-1",
      sport: "NBA",
      status: "LIVE",
      homeScore: 10,
      awayScore: 8,
    })).toBe(false);

    expect(isVerifiedScoreboardGame({
      id: "401705528",
      sport: "NBA",
      status: "LIVE",
      homeScore: 10,
      awayScore: 8,
    })).toBe(true);
  });
});
