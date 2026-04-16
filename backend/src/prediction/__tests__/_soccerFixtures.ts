/**
 * Shared fixture builder for EPL / MLS / UCL factor tests.
 * Not a test file — extracted helpers so each of the three soccer test
 * files stays focused on its own cases without duplicating 60 lines of
 * default-context boilerplate.
 */

import type { GameContext } from "../types";
import type { Team, Game } from "../../types/sports";
import { Sport, League, GameStatus } from "../../types/sports";

export function makeSoccerTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "1",
    name: "Home FC",
    abbreviation: "HOM",
    logo: "",
    record: { wins: 10, losses: 5 },
    ...overrides,
  };
}

export function makeSoccerContext(
  sport: "EPL" | "MLS" | "UCL",
  overrides: Partial<GameContext> = {},
): GameContext {
  const home = makeSoccerTeam({
    id: "1",
    name: overrides.game?.homeTeam?.name ?? "Home FC",
    abbreviation: "HOM",
  });
  const away = makeSoccerTeam({
    id: "2",
    name: overrides.game?.awayTeam?.name ?? "Away FC",
    abbreviation: "AWY",
  });
  const game: Game = {
    id: "g1",
    sport: sport === "EPL" ? Sport.EPL : sport === "MLS" ? Sport.MLS : Sport.UCL,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-04-16T19:00Z",
    venue: "Test Stadium",
    tvChannel: "",
    status: GameStatus.Scheduled,
  };
  return {
    game,
    sport,
    homeElo: 1500,
    awayElo: 1500,
    homeForm: {
      results: ["W","L","D","W","L","D","W","L","W","D"],
      formString: "W-L-D-W-L-D-W-L-W-D",
      streak: 0, avgScore: 1.5, avgAllowed: 1.2, wins: 4, losses: 3,
    },
    awayForm: {
      results: ["L","W","D","L","W","L","D","W","L","W"],
      formString: "L-W-D-L-W-L-D-W-L-W",
      streak: 0, avgScore: 1.3, avgAllowed: 1.5, wins: 4, losses: 4,
    },
    homeExtended: {
      homeRecord: { wins: 6, losses: 2 }, awayRecord: { wins: 4, losses: 3 },
      lastGameDate: "2026-04-13", avgScoreLast5: 1.5, avgScoreLast10: 1.5,
      scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
      strengthOfSchedule: 0.5, restDays: 3, consecutiveAwayGames: 0,
    },
    awayExtended: {
      homeRecord: { wins: 4, losses: 3 }, awayRecord: { wins: 4, losses: 4 },
      lastGameDate: "2026-04-13", avgScoreLast5: 1.3, avgScoreLast10: 1.3,
      scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
      strengthOfSchedule: 0.5, restDays: 3, consecutiveAwayGames: 0,
    },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: {},
    awayAdvanced: {},
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-04-16",
    ...overrides,
  };
}
