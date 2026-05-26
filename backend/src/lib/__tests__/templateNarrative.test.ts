import { describe, expect, test } from "bun:test";
import { _buildTemplateAnalysis_forTest } from "../predictions";
import type { TeamExtendedStats, TeamInjuryReport, TeamRecentForm } from "../espnStats";
import { GameStatus, League, Sport, type Game } from "../../types/sports";

function makeForm(wins: number, losses: number, formString: string): TeamRecentForm {
  return {
    results: [],
    formString,
    streak: wins >= losses ? wins : -losses,
    avgScore: 110,
    avgAllowed: 106,
    wins,
    losses,
  };
}

function makeExtended(overrides: Partial<TeamExtendedStats> = {}): TeamExtendedStats {
  return {
    homeRecord: { wins: 26, losses: 15 },
    awayRecord: { wins: 22, losses: 19 },
    lastGameDate: null,
    avgScoreLast5: 112,
    avgScoreLast10: 110,
    scoringTrend: 0.1,
    defenseTrend: 0.1,
    headToHeadResults: [],
    strengthOfSchedule: 0.5,
    restDays: 2,
    consecutiveAwayGames: 0,
    ...overrides,
  };
}

function emptyInjuries(): TeamInjuryReport {
  return {
    out: [],
    doubtful: [],
    questionable: [],
    totalOut: 0,
    totalDoubtful: 0,
    totalQuestionable: 0,
  };
}

describe("legacy template analysis", () => {
  test("NBA fallback reads like a game-card narrative, not a raw stat dump", () => {
    const game: Game = {
      id: "nba-lal-okc",
      sport: Sport.NBA,
      league: League.Pro,
      homeTeam: {
        id: "lal",
        name: "Los Angeles Lakers",
        abbreviation: "LAL",
        logo: "",
        record: { wins: 53, losses: 29 },
      },
      awayTeam: {
        id: "okc",
        name: "Oklahoma City Thunder",
        abbreviation: "OKC",
        logo: "",
        record: { wins: 58, losses: 24 },
      },
      dateTime: "2026-05-11T21:30:00.000Z",
      venue: "crypto.com Arena",
      tvChannel: "Prime Video",
      status: GameStatus.Scheduled,
      seasonContext: {
        phase: "playoffs",
        label: "NBA playoff window",
        detail: "This falls in the NBA playoff window, so regular-season numbers are background and the pick should lean on repeatable matchup edges.",
        source: "date",
      },
    };

    const text = _buildTemplateAnalysis_forTest(
      game,
      "home",
      59,
      makeForm(4, 5, "4-5"),
      makeForm(7, 0, "7-0"),
      makeExtended({ homeRecord: { wins: 31, losses: 10 } }),
      makeExtended({ awayRecord: { wins: 29, losses: 12 } }),
      emptyInjuries(),
      emptyInjuries(),
      1556,
      1560,
      false,
    );

    expect(text).toContain("Los Angeles Lakers");
    expect(text).toContain("Oklahoma City Thunder");
    expect(text.toLowerCase()).toContain("playoff");
    expect(text.toLowerCase()).toContain("recent form");
    expect(text).not.toContain("Home LAL Elo");
    expect(text).not.toContain("Elo");
    expect(text).not.toContain("the model");
    expect(text).not.toContain("usable edges");
    expect(text).not.toContain("The data points toward");
    expect(text).not.toContain("clear separation");
  });
});
