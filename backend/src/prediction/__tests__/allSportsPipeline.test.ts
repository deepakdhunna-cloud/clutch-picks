import { describe, expect, it } from "bun:test";
import { predictGame } from "../index";
import type { GameContext } from "../types";
import type { Game, Team } from "../../types/sports";
import { GameStatus, League, Sport } from "../../types/sports";

function makeTeam(
  id: string,
  abbreviation: string,
  record: { wins: number; losses: number } = { wins: 8, losses: 4 },
  overrides: Partial<Team> = {},
): Team {
  return {
    id,
    name: `${abbreviation} Team`,
    abbreviation,
    logo: "",
    record,
    ...overrides,
  };
}

function baseContext(sport: Sport): GameContext {
  const homeTeam = makeTeam("home-1", sport === Sport.MLB ? "NYY" : "HOM", { wins: 9, losses: 3 });
  const awayTeam = makeTeam("away-1", sport === Sport.MLB ? "BOS" : "AWY", { wins: 5, losses: 7 });
  const game: Game = {
    id: `${sport.toLowerCase()}-pipeline-1`,
    sport,
    league: sport === Sport.NCAAF || sport === Sport.NCAAB ? League.College : League.Pro,
    homeTeam,
    awayTeam,
    dateTime: "2026-05-21T19:00:00.000Z",
    venue: "Test Stadium",
    tvChannel: "",
    status: GameStatus.Scheduled,
  };

  return {
    game,
    sport,
    homeElo: 1580,
    awayElo: 1460,
    homeForm: {
      results: ["W", "W", "L", "W", "W", "W"],
      formString: "W-W-L-W-W-W",
      streak: 3,
      avgScore: sport === Sport.IPL ? 178 : sport === Sport.MLB ? 5.1 : sport === Sport.NHL ? 3.4 : 112,
      avgAllowed: sport === Sport.IPL ? 162 : sport === Sport.MLB ? 3.8 : sport === Sport.NHL ? 2.6 : 105,
      wins: 5,
      losses: 1,
    },
    awayForm: {
      results: ["L", "W", "L", "L", "W", "L"],
      formString: "L-W-L-L-W-L",
      streak: -1,
      avgScore: sport === Sport.IPL ? 158 : sport === Sport.MLB ? 3.9 : sport === Sport.NHL ? 2.7 : 104,
      avgAllowed: sport === Sport.IPL ? 171 : sport === Sport.MLB ? 4.9 : sport === Sport.NHL ? 3.3 : 113,
      wins: 2,
      losses: 4,
    },
    homeExtended: {
      homeRecord: { wins: 6, losses: 1 },
      awayRecord: { wins: 3, losses: 3 },
      lastGameDate: "2026-05-18",
      avgScoreLast5: sport === Sport.IPL ? 181 : 114,
      avgScoreLast10: sport === Sport.IPL ? 178 : 112,
      scoringTrend: 0.18,
      defenseTrend: 0.12,
      headToHeadResults: [
        { date: "2026-04-10", won: true, teamScore: 5, oppScore: 3 },
        { date: "2025-05-10", won: true, teamScore: 4, oppScore: 2 },
      ],
      strengthOfSchedule: 0.56,
      restDays: 3,
      consecutiveAwayGames: 0,
    },
    awayExtended: {
      homeRecord: { wins: 3, losses: 4 },
      awayRecord: { wins: 2, losses: 5 },
      lastGameDate: "2026-05-19",
      avgScoreLast5: sport === Sport.IPL ? 158 : 104,
      avgScoreLast10: sport === Sport.IPL ? 160 : 104,
      scoringTrend: -0.08,
      defenseTrend: -0.06,
      headToHeadResults: [
        { date: "2026-04-10", won: false, teamScore: 3, oppScore: 5 },
        { date: "2025-05-10", won: false, teamScore: 2, oppScore: 4 },
      ],
      strengthOfSchedule: 0.49,
      restDays: 1,
      consecutiveAwayGames: 4,
    },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: {
      out: [{ name: "Away Starter", position: sport === Sport.NFL || sport === Sport.NCAAF ? "WR" : "G", detail: "Out" }],
      doubtful: [],
      questionable: [],
      totalOut: 1,
      totalDoubtful: 0,
      totalQuestionable: 0,
    },
    homeAdvanced: {
      offensiveRating: 118,
      defensiveRating: 110,
      savePercentage: 0.918,
      powerPlayPct: 0.24,
      penaltyKillPct: 0.83,
    },
    awayAdvanced: {
      offensiveRating: 110,
      defensiveRating: 118,
      savePercentage: 0.902,
      powerPlayPct: 0.18,
      penaltyKillPct: 0.77,
    },
    homeLineup: null,
    awayLineup: null,
    weather: { temperature: 72, windSpeed: 8, precipitation: 0.1, isDomed: false },
    gameDate: "2026-05-21",
  };
}

function configureSport(ctx: GameContext): GameContext {
  if (ctx.sport === Sport.MLB) {
    return {
      ...ctx,
      homeLineup: {
        sport: "MLB",
        starters: [],
        startingPitcher: {
          name: "Home Ace",
          position: "SP",
          isConfirmed: true,
          era: 2.95,
          fip: 3.1,
          whip: 1.05,
          seasonInningsPitched: 74,
        },
      },
      awayLineup: {
        sport: "MLB",
        starters: [],
        startingPitcher: {
          name: "Away Starter",
          position: "SP",
          isConfirmed: true,
          era: 4.55,
          fip: 4.75,
          whip: 1.34,
          seasonInningsPitched: 61,
        },
      },
      homePlateUmpire: {
        name: "Verified Umpire",
        tendency: {
          runsPerGameBias: -0.04,
          favorsHome: 0.015,
          sampleSize: 120,
        },
      },
    };
  }

  if (ctx.sport === Sport.EPL || ctx.sport === Sport.MLS || ctx.sport === Sport.UCL) {
    const soccerContext = {
      ...ctx,
      homeForm: { ...ctx.homeForm, avgScore: 1.8, avgAllowed: 1.0 },
      awayForm: { ...ctx.awayForm, avgScore: 1.1, avgAllowed: 1.6 },
      homeFixtureCongestion: { gamesLast7Days: 1, gamesLast14Days: 3 },
      awayFixtureCongestion: { gamesLast7Days: 3, gamesLast14Days: 5 },
      homeManagerChange: { daysSinceChange: 12, newManager: "New Boss" },
      awayManagerChange: null,
      homeStakes: { inTitleRace: true, inRelegationRace: false, inEuropeRace: false, gamesRemaining: 6 },
      awayStakes: { inTitleRace: false, inRelegationRace: false, inEuropeRace: false, gamesRemaining: 6 },
    };
    if (ctx.sport !== Sport.UCL) return soccerContext;
    return {
      ...soccerContext,
      uclPedigree: { home: 112, away: 58 },
      uclTravel: { distanceKm: 1800, homeCity: "London", awayCity: "Lisbon" },
    };
  }

  if (ctx.sport === Sport.IPL) {
    return {
      ...ctx,
      game: {
        ...ctx.game,
        homeTeam: {
          ...ctx.game.homeTeam,
          standingsRank: 1,
          standingsPoints: 18,
          netRunRate: 1.02,
          matchesPlayed: 12,
        },
        awayTeam: {
          ...ctx.game.awayTeam,
          standingsRank: 7,
          standingsPoints: 10,
          netRunRate: -0.34,
          matchesPlayed: 12,
        },
      },
    };
  }

  if (ctx.sport === Sport.TENNIS) {
    return {
      ...ctx,
      game: {
        ...ctx.game,
        venue: "Rome Masters - Men's Singles Quarterfinal",
        homeTeam: {
          ...ctx.game.homeTeam,
          name: "Home Player",
          abbreviation: "HOM",
          rank: 5,
          seed: 4,
          rankingPoints: 5320,
          tour: "ATP",
        },
        awayTeam: {
          ...ctx.game.awayTeam,
          name: "Away Player",
          abbreviation: "AWY",
          rank: 28,
          seed: 24,
          rankingPoints: 1480,
          tour: "ATP",
        },
      },
      homeForm: { ...ctx.homeForm, avgScore: 2, avgAllowed: 0.7 },
      awayForm: { ...ctx.awayForm, avgScore: 1.3, avgAllowed: 1.2 },
    };
  }

  return ctx;
}

const cases: Array<{ sport: Sport; expectedFactor: string }> = [
  { sport: Sport.NFL, expectedFactor: "starting_qb" },
  { sport: Sport.NBA, expectedFactor: "net_rating" },
  { sport: Sport.MLB, expectedFactor: "starting_pitcher" },
  { sport: Sport.NHL, expectedFactor: "starting_goalie" },
  { sport: Sport.MLS, expectedFactor: "fixture_congestion" },
  { sport: Sport.EPL, expectedFactor: "fixture_congestion" },
  { sport: Sport.UCL, expectedFactor: "ucl_pedigree" },
  { sport: Sport.IPL, expectedFactor: "ipl_table_strength" },
  { sport: Sport.TENNIS, expectedFactor: "tennis_ranking_edge" },
  { sport: Sport.NCAAF, expectedFactor: "starting_qb_ncaaf" },
  { sport: Sport.NCAAB, expectedFactor: "net_rating_ncaamb" },
];

describe("all supported sports prediction pipeline", () => {
  for (const { sport, expectedFactor } of cases) {
    it(`${sport} plugs real match context into factors, projection, and one canonical answer`, () => {
      const ctx = configureSport(baseContext(sport));
      const result = predictGame(ctx);
      const canonical = result.canonicalResult;
      const probabilities = canonical.probabilities;
      const probabilitySum = probabilities.home + probabilities.away + (probabilities.draw ?? 0);

      expect(result.league).toBe(sport);
      expect(result.factors.some((factor) => factor.key === "rating_diff")).toBe(true);
      expect(result.factors.some((factor) => factor.key === expectedFactor)).toBe(true);
      expect(result.projection?.engine).toBe("game-script-v1");
      expect(result.projection?.iterations).toBe(50000);
      expect(canonical.eventId).toBe(ctx.game.id);
      expect(canonical.modelInputs.sport).toBe(sport);
      expect(canonical.modelInputs.homeTeamId).toBe(ctx.game.homeTeam.id);
      expect(canonical.modelInputs.awayTeamId).toBe(ctx.game.awayTeam.id);
      expect(canonical.modelInputs.factorCount).toBe(result.factors.length);
      expect(probabilitySum).toBeCloseTo(1, 3);
      expect(canonical.finalProbability).toBeGreaterThan(0);
      expect(canonical.finalProbability).toBeLessThanOrEqual(1);
      expect(canonical.engineBreakdown.map((read) => read.engine)).toContain("factor-model-v1");
      expect(canonical.engineBreakdown.map((read) => read.engine)).toContain("game-script-v1");
      expect(canonical.engineBreakdown.at(-1)?.engine).toBe("orchestrator-v1");
      const projectionRead = canonical.engineBreakdown.find((read) => read.engine === "game-script-v1");
      expect(projectionRead?.probabilities?.home).toBeCloseTo(result.projection!.homeWinProbability, 3);
      expect(projectionRead?.probabilities?.away).toBeCloseTo(result.projection!.awayWinProbability, 3);

      if (canonical.finalPick === "home") {
        expect(result.predictedWinner?.teamId).toBe(ctx.game.homeTeam.id);
      } else if (canonical.finalPick === "away") {
        expect(result.predictedWinner?.teamId).toBe(ctx.game.awayTeam.id);
      } else if (canonical.finalPick === "draw") {
        expect(result.predictedWinner).toBeNull();
      }

      expect(canonical.finalPick).not.toBe("none");
    });
  }
});
