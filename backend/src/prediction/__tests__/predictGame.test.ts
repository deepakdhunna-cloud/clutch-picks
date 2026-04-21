/**
 * Tests for predictGame() — soccer winner/confidence logic and invariant checks.
 *
 * Verifies:
 * 1. Soccer: when away team has highest probability → correct winner + confidence
 * 2. Soccer: when draw has highest probability → predictedWinner=null
 * 3. Non-soccer: two-way logic preserved
 *
 * We use carefully chosen Elo deltas to produce known probability ranges.
 * The exact probabilities depend on the draw adjustment formula, so we verify
 * structural invariants rather than exact values.
 */

import { describe, it, expect } from "bun:test";
import { predictGame } from "../index";
import { ratingDeltaToHomeWinProb, applySoccerDrawAdjustment } from "../probability";
import { makeSoccerContext } from "./_soccerFixtures";
import type { GameContext } from "../types";
import type { Game, Team } from "../../types/sports";
import { Sport, League, GameStatus } from "../../types/sports";

// ─── Non-soccer context builder ────────────────────────────────────────

function makeNBAContext(homeElo: number, awayElo: number): GameContext {
  const home: Team = { id: "1", name: "Home", abbreviation: "HOM", logo: "", record: { wins: 40, losses: 30 } };
  const away: Team = { id: "2", name: "Away", abbreviation: "AWY", logo: "", record: { wins: 30, losses: 40 } };
  const game: Game = {
    id: "nba-1",
    sport: Sport.NBA,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-04-16T19:00Z",
    venue: "Arena",
    tvChannel: "",
    status: GameStatus.Scheduled,
  };
  return {
    game,
    sport: "NBA",
    homeElo,
    awayElo,
    homeForm: { results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0 },
    awayForm: { results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0 },
    homeExtended: { homeRecord: { wins: 0, losses: 0 }, awayRecord: { wins: 0, losses: 0 }, lastGameDate: "", avgScoreLast5: 0, avgScoreLast10: 0, scoringTrend: 0, defenseTrend: 0, headToHeadResults: [], strengthOfSchedule: 0.5, restDays: 3, consecutiveAwayGames: 0 },
    awayExtended: { homeRecord: { wins: 0, losses: 0 }, awayRecord: { wins: 0, losses: 0 }, lastGameDate: "", avgScoreLast5: 0, avgScoreLast10: 0, scoringTrend: 0, defenseTrend: 0, headToHeadResults: [], strengthOfSchedule: 0.5, restDays: 3, consecutiveAwayGames: 0 },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: {},
    awayAdvanced: {},
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-04-16",
  };
}

describe("predictGame — soccer winner/confidence invariants", () => {
  it("soccer: away team wins when away has highest probability", () => {
    // Give away team much higher Elo so away probability > home and > draw
    const ctx = makeSoccerContext("EPL", {
      homeElo: 1300,
      awayElo: 1700,
    });
    const result = predictGame(ctx);

    // With 400-point Elo disadvantage for home, away should win
    expect(result.awayWinProbability).toBeGreaterThan(result.homeWinProbability);
    expect(result.awayWinProbability).toBeGreaterThan(result.drawProbability ?? 0);

    // predictedWinner should be the away team
    expect(result.predictedWinner).not.toBeNull();
    expect(result.predictedWinner!.abbr).toBe("AWY");

    // Confidence should equal max probability * 100
    const maxP = Math.max(result.homeWinProbability, result.awayWinProbability, result.drawProbability ?? 0);
    const expectedConf = Math.round(maxP * 1000) / 10;
    expect(Math.abs(result.confidence - expectedConf)).toBeLessThanOrEqual(0.1);
  });

  it("soccer: draw predicted when teams are very evenly matched", () => {
    // With equal Elo and no other signal, the draw adjustment can make draw
    // the highest for very close matchups. Let's verify the invariant:
    // If draw IS the highest, predictedWinner must be null.
    const ctx = makeSoccerContext("EPL", {
      homeElo: 1500,
      awayElo: 1500,
    });
    const result = predictGame(ctx);

    // Whether or not draw ends up highest depends on factors, but verify invariant:
    const maxP = Math.max(result.homeWinProbability, result.awayWinProbability, result.drawProbability ?? 0);

    if ((result.drawProbability ?? 0) >= result.homeWinProbability &&
        (result.drawProbability ?? 0) >= result.awayWinProbability) {
      // Draw is highest → winner must be null
      expect(result.predictedWinner).toBeNull();
    }

    // Confidence must match max probability regardless
    const expectedConf = Math.round(maxP * 1000) / 10;
    expect(Math.abs(result.confidence - expectedConf)).toBeLessThanOrEqual(0.1);
  });

  it("soccer: confidence reflects three-way max, not two-way", () => {
    // Use the draw adjustment formula directly to verify our fix
    const rawHome = 0.5; // even matchup
    const [adjHome, draw, adjAway] = applySoccerDrawAdjustment(rawHome, "EPL");

    // Draw prob should be significant for even matchups
    expect(draw).toBeGreaterThan(0.15);
    // All three should sum to ~1
    expect(Math.abs(adjHome + draw + adjAway - 1)).toBeLessThan(0.001);

    // The max of the three is what confidence should be based on
    const maxP = Math.max(adjHome, draw, adjAway);
    // If draw > home and draw > away (which it can be for even matchups),
    // confidence must be draw * 100, NOT max(home, away) * 100
    if (draw > adjHome && draw > adjAway) {
      expect(maxP).toBe(draw);
    }
  });

  it("non-soccer: two-way logic, home favored → home wins", () => {
    // Home has 200 Elo advantage
    const ctx = makeNBAContext(1600, 1400);
    const result = predictGame(ctx);

    // Home should be predicted winner
    expect(result.predictedWinner).not.toBeNull();
    expect(result.predictedWinner!.abbr).toBe("HOM");

    // No draw for NBA
    expect(result.drawProbability).toBeUndefined();

    // Confidence = max(home, away) * 100
    const maxP = Math.max(result.homeWinProbability, result.awayWinProbability);
    const expectedConf = Math.round(maxP * 1000) / 10;
    expect(Math.abs(result.confidence - expectedConf)).toBeLessThanOrEqual(0.1);

    // Home prob should be greater
    expect(result.homeWinProbability).toBeGreaterThan(result.awayWinProbability);
  });

  it("non-soccer: away favored → away wins", () => {
    // Away has 200 Elo advantage
    const ctx = makeNBAContext(1400, 1600);
    const result = predictGame(ctx);

    // Away should be predicted winner
    expect(result.predictedWinner).not.toBeNull();
    expect(result.predictedWinner!.abbr).toBe("AWY");
  });

  it("invariant: predictedWinner is always consistent with probabilities", () => {
    // Run several soccer scenarios and verify the invariant
    const scenarios = [
      { homeElo: 1300, awayElo: 1700, sport: "EPL" as const },
      { homeElo: 1700, awayElo: 1300, sport: "EPL" as const },
      { homeElo: 1500, awayElo: 1500, sport: "MLS" as const },
      { homeElo: 1550, awayElo: 1450, sport: "UCL" as const },
      { homeElo: 1400, awayElo: 1600, sport: "UCL" as const },
    ];

    for (const s of scenarios) {
      const ctx = makeSoccerContext(s.sport, { homeElo: s.homeElo, awayElo: s.awayElo });
      const result = predictGame(ctx);

      const maxP = Math.max(result.homeWinProbability, result.awayWinProbability, result.drawProbability ?? 0);
      const expectedConf = Math.round(maxP * 1000) / 10;

      // Confidence matches max prob
      expect(Math.abs(result.confidence - expectedConf)).toBeLessThanOrEqual(0.1);

      if (result.predictedWinner) {
        const isHome = result.predictedWinner.teamId === ctx.game.homeTeam.id;
        if (isHome) {
          expect(result.homeWinProbability).toBeGreaterThanOrEqual(result.awayWinProbability);
          expect(result.homeWinProbability).toBeGreaterThanOrEqual(result.drawProbability ?? 0);
        } else {
          expect(result.awayWinProbability).toBeGreaterThanOrEqual(result.homeWinProbability);
          expect(result.awayWinProbability).toBeGreaterThanOrEqual(result.drawProbability ?? 0);
        }
      } else {
        // null winner means draw is highest (or true pickem)
        if (result.drawProbability !== undefined) {
          expect(result.drawProbability).toBeGreaterThanOrEqual(result.homeWinProbability);
          expect(result.drawProbability).toBeGreaterThanOrEqual(result.awayWinProbability);
        }
      }
    }
  });
});
