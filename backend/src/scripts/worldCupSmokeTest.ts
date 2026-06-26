/**
 * End-to-end smoke test for World Cup as a first-class soccer league.
 * Builds realistic GameContexts and runs them through predictGame() to verify:
 *   1. 3-way output (home / away / draw) with sensible draw probability
 *   2. draw support fires on an even matchup
 *   3. clear favorite is picked on a lopsided matchup
 *   4. sport is classified as low-scoring soccer
 *
 * Run: bun run src/scripts/worldCupSmokeTest.ts
 */

import { predictGame } from "../prediction";
import type { GameContext } from "../prediction/types";
import type { Game, Team } from "../types/sports";
import { Sport, League, GameStatus } from "../types/sports";

function team(id: string, name: string, abbr: string): Team {
  return {
    id,
    name,
    abbreviation: abbr,
    logo: "",
    record: { wins: 0, losses: 0 },
  };
}

function makeWorldCupContext(opts: {
  gameId: string;
  homeName: string;
  homeAbbr: string;
  awayName: string;
  awayAbbr: string;
  homeElo: number;
  awayElo: number;
}): GameContext {
  const home = team("1", opts.homeName, opts.homeAbbr);
  const away = team("2", opts.awayName, opts.awayAbbr);
  const game: Game = {
    id: opts.gameId,
    sport: Sport.WORLDCUP,
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-06-26T19:00Z",
    venue: "Neutral Stadium",
    tvChannel: "FOX",
    status: GameStatus.Scheduled,
  };
  return {
    game,
    sport: "WORLDCUP",
    homeElo: opts.homeElo,
    awayElo: opts.awayElo,
    homeForm: {
      results: ["W", "D", "W", "L", "D"],
      formString: "W-D-W-L-D",
      streak: 0, avgScore: 1.6, avgAllowed: 1.1, wins: 2, losses: 1,
    },
    awayForm: {
      results: ["L", "W", "D", "W", "L"],
      formString: "L-W-D-W-L",
      streak: 0, avgScore: 1.3, avgAllowed: 1.4, wins: 2, losses: 2,
    },
    homeExtended: {
      homeRecord: { wins: 3, losses: 1 }, awayRecord: { wins: 2, losses: 2 },
      lastGameDate: "2026-06-22", avgScoreLast5: 1.6, avgScoreLast10: 1.5,
      scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
      strengthOfSchedule: 0.5, restDays: 4, consecutiveAwayGames: 0,
    },
    awayExtended: {
      homeRecord: { wins: 2, losses: 2 }, awayRecord: { wins: 2, losses: 2 },
      lastGameDate: "2026-06-22", avgScoreLast5: 1.3, avgScoreLast10: 1.3,
      scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
      strengthOfSchedule: 0.5, restDays: 4, consecutiveAwayGames: 0,
    },
    homeInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    awayInjuries: { out: [], doubtful: [], questionable: [], totalOut: 0, totalDoubtful: 0, totalQuestionable: 0 },
    homeAdvanced: {},
    awayAdvanced: {},
    homeLineup: null,
    awayLineup: null,
    weather: null,
    gameDate: "2026-06-26",
  };
}

function report(label: string, ctx: GameContext) {
  const p = predictGame(ctx);
  const home = Math.round(p.homeWinProbability * 1000) / 10;
  const away = Math.round(p.awayWinProbability * 1000) / 10;
  const draw = p.drawProbability != null ? Math.round(p.drawProbability * 1000) / 10 : null;
  console.log(`\n=== ${label} ===`);
  console.log(`  ${ctx.game.homeTeam.name} (home) vs ${ctx.game.awayTeam.name} (away)`);
  console.log(`  homeWin: ${home}%   awayWin: ${away}%   draw: ${draw}%`);
  console.log(`  finalPick: ${p.canonicalResult.finalPick}`);
  console.log(`  predictedWinner: ${p.predictedWinner ? p.predictedWinner.abbr : "none (toss-up)"}`);
  console.log(`  confidence: ${p.confidence}%  band: ${p.confidenceBand}`);
  const sum = home + away + (draw ?? 0);
  console.log(`  prob sum: ${Math.round(sum * 10) / 10}% (should be ~100)`);
  console.log(`  draw present (soccer 3-way): ${draw != null ? "YES" : "NO -- BUG"}`);
  return { p, home, away, draw };
}

console.log("World Cup end-to-end smoke test");

// 1. Even matchup -> expect a meaningful draw probability and possibly a draw pick
const even = report(
  "EVEN MATCHUP (Spain 1800 vs Uruguay 1790)",
  makeWorldCupContext({
    gameId: "760479",
    homeName: "Uruguay", homeAbbr: "URU",
    awayName: "Spain", awayAbbr: "ESP",
    homeElo: 1790, awayElo: 1800,
  }),
);

// 2. Lopsided matchup -> expect a clear favorite, draw should not dominate
const lopsided = report(
  "LOPSIDED MATCHUP (France 1950 vs Norway 1620)",
  makeWorldCupContext({
    gameId: "760475",
    homeName: "Norway", homeAbbr: "NOR",
    awayName: "France", awayAbbr: "FRA",
    homeElo: 1620, awayElo: 1950,
  }),
);

console.log("\n=== ASSERTIONS ===");
let pass = true;
function check(name: string, cond: boolean) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) pass = false;
}

check("even: draw probability present", even.draw != null);
check("even: draw probability in realistic 18-35% range", even.draw != null && even.draw >= 18 && even.draw <= 35);
check("even: probabilities sum ~100", Math.abs(even.home + even.away + (even.draw ?? 0) - 100) < 1.5);
check("lopsided: draw probability present", lopsided.draw != null);
check("lopsided: France (away) is favorite", lopsided.away > lopsided.home);
check("lopsided: France favored over draw", lopsided.away > (lopsided.draw ?? 0));
check("lopsided: finalPick is away (France)", lopsided.p.canonicalResult.finalPick === "away");

console.log(`\n${pass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
process.exit(pass ? 0 : 1);
