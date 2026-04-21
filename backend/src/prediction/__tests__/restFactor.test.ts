/**
 * Tests for the rest-differential sanity cap in factors/base.ts.
 *
 * Guards against stale "last completed game" data (e.g. resolve-picks
 * falling behind → team stuck on last season's opener → 247-day "rest").
 * Non-soccer cap is 14 days, soccer (EPL/MLS/UCL) cap is 10 days.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  computeBaseFactors,
  __resetRestWarningCacheForTests,
} from "../factors/base";
import type { GameContext } from "../types";
import type { Game, Team } from "../../types/sports";
import { Sport, League, GameStatus } from "../../types/sports";

type SportKey = "NBA" | "NHL" | "NFL" | "MLB" | "EPL" | "MLS" | "UCL";

const SPORT_ENUM: Record<SportKey, Sport> = {
  NBA: Sport.NBA,
  NHL: Sport.NHL,
  NFL: Sport.NFL,
  MLB: Sport.MLB,
  EPL: Sport.EPL,
  MLS: Sport.MLS,
  UCL: Sport.UCL,
};

function makeCtx(
  sport: SportKey,
  homeRest: number,
  awayRest: number,
  gameId = "g-rest-1",
): GameContext {
  const home: Team = { id: "1", name: "Home", abbreviation: "HOM", logo: "", record: { wins: 0, losses: 0 } };
  const away: Team = { id: "2", name: "Away", abbreviation: "AWY", logo: "", record: { wins: 0, losses: 0 } };
  const game: Game = {
    id: gameId,
    sport: SPORT_ENUM[sport],
    league: League.Pro,
    homeTeam: home,
    awayTeam: away,
    dateTime: "2026-04-16T19:00Z",
    venue: "",
    tvChannel: "",
    status: GameStatus.Scheduled,
  };
  const ext = (restDays: number) => ({
    homeRecord: { wins: 0, losses: 0 }, awayRecord: { wins: 0, losses: 0 },
    lastGameDate: "", avgScoreLast5: 0, avgScoreLast10: 0,
    scoringTrend: 0, defenseTrend: 0, headToHeadResults: [],
    strengthOfSchedule: 0.5, restDays, consecutiveAwayGames: 0,
  });
  return {
    game,
    sport,
    homeElo: 1500,
    awayElo: 1500,
    homeForm: { results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0 },
    awayForm: { results: [], formString: "", streak: 0, avgScore: 0, avgAllowed: 0, wins: 0, losses: 0 },
    homeExtended: ext(homeRest),
    awayExtended: ext(awayRest),
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

function restFactor(ctx: GameContext) {
  const factors = computeBaseFactors(ctx);
  const rest = factors.find((f) => f.key === "rest_diff");
  if (!rest) throw new Error("rest_diff factor missing");
  return rest;
}

describe("rest-differential sanity cap", () => {
  beforeEach(() => {
    __resetRestWarningCacheForTests();
  });

  it("non-soccer: 3 days rest on both sides → hasSignal respects equal-rest rule", () => {
    // Equal rest → delta is 0, so hasSignal=false by design, but data is NOT stale.
    const rest = restFactor(makeCtx("NBA", 3, 3));
    expect(rest.available).toBe(true);
    expect(rest.homeDelta).toBe(0);
    expect(rest.evidence).toContain("3 days");
    expect(rest.evidence).not.toContain("stale");
  });

  it("non-soccer: 3 vs 1 days rest → hasSignal=true, positive home delta", () => {
    const rest = restFactor(makeCtx("NBA", 3, 1));
    expect(rest.available).toBe(true);
    expect(rest.hasSignal).toBe(true);
    expect(rest.homeDelta).toBeGreaterThan(0);
    expect(rest.evidence).not.toContain("stale");
  });

  it("non-soccer: 14 days rest at the boundary → still emits real data", () => {
    const rest = restFactor(makeCtx("NHL", 14, 3));
    expect(rest.available).toBe(true);
    expect(rest.hasSignal).toBe(true);
    expect(rest.evidence).toContain("14 days");
    expect(rest.evidence).not.toContain("stale");
  });

  it("non-soccer: 15 days rest → stale-guard fires, hasSignal=false", () => {
    const rest = restFactor(makeCtx("NBA", 15, 3));
    expect(rest.hasSignal).toBe(false);
    expect(rest.homeDelta).toBe(0);
    expect(rest.evidence).toContain("stale");
  });

  it("soccer EPL: 3 days rest → hasSignal=true", () => {
    const rest = restFactor(makeCtx("EPL", 3, 1));
    expect(rest.available).toBe(true);
    expect(rest.hasSignal).toBe(true);
    expect(rest.evidence).not.toContain("stale");
  });

  it("soccer MLS: 10 days rest at the boundary → still emits real data", () => {
    const rest = restFactor(makeCtx("MLS", 10, 4));
    expect(rest.available).toBe(true);
    expect(rest.hasSignal).toBe(true);
    expect(rest.evidence).toContain("10 days");
    expect(rest.evidence).not.toContain("stale");
  });

  it("soccer EPL: 11 days rest → stale-guard fires", () => {
    const rest = restFactor(makeCtx("EPL", 11, 4));
    expect(rest.hasSignal).toBe(false);
    expect(rest.homeDelta).toBe(0);
    expect(rest.evidence).toContain("stale");
  });

  it("soccer UCL: 247 days rest (production bug repro) → stale-guard fires", () => {
    const rest = restFactor(makeCtx("UCL", 247, 246));
    expect(rest.hasSignal).toBe(false);
    expect(rest.homeDelta).toBe(0);
    expect(rest.evidence).toContain("stale");
  });

  it("warning is logged exactly once per (sport, gameId)", () => {
    const calls: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      calls.push(args.map(String).join(" "));
    };
    try {
      const ctx = makeCtx("EPL", 247, 246, "g-warn-1");
      computeBaseFactors(ctx);
      computeBaseFactors(ctx);
      computeBaseFactors(ctx);
      const relevant = calls.filter((line) => line.includes("[rest]"));
      expect(relevant.length).toBe(1);
      expect(relevant[0]).toContain("EPL");
      expect(relevant[0]).toContain("g-warn-1");
      expect(relevant[0]).toContain("247/246");
    } finally {
      console.warn = originalWarn;
    }
  });
});
