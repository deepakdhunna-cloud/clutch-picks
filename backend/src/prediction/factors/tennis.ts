/**
 * Tennis-specific factors.
 *
 * ESPN exposes tennis as player/team matchups inside tournament scoreboards,
 * so these factors use only data the game shell already carries: rankings,
 * recent form when available, tournament round text, match format, and outdoor
 * conditions. Missing context stays unavailable and redistributes through the
 * shared engine instead of being guessed.
 */

import type { GameContext, FactorContribution } from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function playerRank(team: GameContext["game"]["homeTeam"]): number | null {
  const rank = (team as { rank?: number }).rank;
  return typeof rank === "number" && Number.isFinite(rank) && rank > 0 ? rank : null;
}

function playerSeed(team: GameContext["game"]["homeTeam"]): number | null {
  const seed = (team as { seed?: number }).seed;
  return typeof seed === "number" && Number.isFinite(seed) && seed > 0 ? seed : null;
}

function rankingPoints(team: GameContext["game"]["homeTeam"]): number | null {
  const points = (team as { rankingPoints?: number }).rankingPoints;
  return typeof points === "number" && Number.isFinite(points) && points > 0 ? points : null;
}

function tourName(team: GameContext["game"]["homeTeam"]): string {
  const tour = (team as { tour?: string }).tour;
  return tour === "ATP" || tour === "WTA" ? tour : "Tennis";
}

function recentWinPct(results: Array<"W" | "L" | "D">): number | null {
  const decisive = results.filter((result) => result === "W" || result === "L");
  if (decisive.length < 3) return null;
  return decisive.filter((result) => result === "W").length / decisive.length;
}

function tennisRankDelta(homeRank: number | null, awayRank: number | null): number {
  if (homeRank !== null && awayRank !== null) {
    const diff = awayRank - homeRank;
    if (diff === 0) return 0;
    const magnitude = clamp(Math.log1p(Math.abs(diff)) * 44, 0, 155);
    return diff > 0 ? magnitude : -magnitude;
  }

  const loneRank = homeRank ?? awayRank;
  if (loneRank === null) return 0;
  const magnitude = clamp(122 - Math.log1p(loneRank) * 12, 68, 116);
  return homeRank !== null ? magnitude : -magnitude;
}

function contextText(ctx: GameContext): string {
  return [
    ctx.game.venue,
    ctx.game.seasonContext?.label,
    ctx.game.seasonContext?.detail,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function computeTennisFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  const homeRank = playerRank(ctx.game.homeTeam);
  const awayRank = playerRank(ctx.game.awayTeam);
  const homeSeed = playerSeed(ctx.game.homeTeam);
  const awaySeed = playerSeed(ctx.game.awayTeam);
  const homePoints = rankingPoints(ctx.game.homeTeam);
  const awayPoints = rankingPoints(ctx.game.awayTeam);
  const worldRankingAvailable = homeRank !== null || awayRank !== null;
  const seedAvailable = homeSeed !== null || awaySeed !== null;
  const rankingAvailable = worldRankingAvailable || seedAvailable;
  const worldRankDelta = worldRankingAvailable ? tennisRankDelta(homeRank, awayRank) : 0;
  const seedDelta = !worldRankingAvailable && seedAvailable ? tennisRankDelta(homeSeed, awaySeed) * 0.45 : 0;
  const pointsDelta =
    homePoints !== null && awayPoints !== null
      ? clamp(Math.log(homePoints / awayPoints) * 42, -34, 34)
      : 0;
  const rankingDelta = worldRankingAvailable
    ? clamp(worldRankDelta * 0.82 + pointsDelta * 0.18, -155, 155)
    : seedDelta;

  const rankingEvidence = worldRankingAvailable
    ? `${tourName(ctx.game.homeTeam)} ranking: ${ctx.game.homeTeam.abbreviation} #${homeRank ?? "unranked"} (${homePoints ?? "n/a"} pts) vs ${ctx.game.awayTeam.abbreviation} #${awayRank ?? "unranked"} (${awayPoints ?? "n/a"} pts)`
    : seedAvailable
      ? `Tournament seed fallback: ${ctx.game.homeTeam.abbreviation} seed ${homeSeed ?? "unseeded"} vs ${ctx.game.awayTeam.abbreviation} seed ${awaySeed ?? "unseeded"}`
      : "ATP/WTA ranking unavailable for both sides";

  factors.push({
    key: "tennis_ranking_edge",
    label: worldRankingAvailable ? "ATP/WTA ranking edge" : "Tournament seed edge",
    homeDelta: rankingDelta,
    weight: 0.16,
    available: rankingAvailable,
    hasSignal: rankingAvailable && rankingDelta !== 0,
    evidence: rankingEvidence,
  });

  const homeFormPct = recentWinPct(ctx.homeForm.results);
  const awayFormPct = recentWinPct(ctx.awayForm.results);
  const formAvailable = homeFormPct !== null && awayFormPct !== null;
  const formDelta = formAvailable ? clamp((homeFormPct! - awayFormPct!) * 70, -45, 45) : 0;
  factors.push({
    key: "tennis_recent_form",
    label: "Recent form",
    homeDelta: formDelta,
    weight: 0.10,
    available: formAvailable,
    hasSignal: formAvailable && formDelta !== 0,
    evidence: formAvailable
      ? `${ctx.game.homeTeam.abbreviation} recent win rate ${(homeFormPct! * 100).toFixed(0)}% vs ${ctx.game.awayTeam.abbreviation} ${(awayFormPct! * 100).toFixed(0)}%`
      : "Recent tennis form sample unavailable from ESPN player schedules",
  });

  const roundText = contextText(ctx);
  const isHighLeverage =
    roundText.includes("final") ||
    roundText.includes("semifinal") ||
    roundText.includes("quarterfinal");
  const roundDelta = isHighLeverage && rankingAvailable ? clamp(rankingDelta * 0.22, -14, 14) : 0;
  factors.push({
    key: "tennis_round_pressure",
    label: "Round pressure",
    homeDelta: roundDelta,
    weight: 0.08,
    available: isHighLeverage,
    hasSignal: isHighLeverage && roundDelta !== 0,
    evidence: isHighLeverage
      ? `Tournament round text indicates a high-leverage match; ranking edge is ${(roundDelta >= 0 ? "+" : "")}${roundDelta.toFixed(1)}`
      : "Round pressure only applies to quarterfinals, semifinals, and finals",
  });

  const isDoubles = roundText.includes("doubles") || ctx.game.homeTeam.name.includes(" / ") || ctx.game.awayTeam.name.includes(" / ");
  factors.push({
    key: "tennis_match_format",
    label: "Match format",
    homeDelta: 0,
    weight: 0.04,
    available: true,
    hasSignal: false,
    evidence: isDoubles
      ? "Doubles format adds match variance without favoring either side"
      : "Singles format carries no side-specific format adjustment",
  });

  let conditionsVolatility = 0;
  let conditionsEvidence = "Weather data unavailable for tennis venue";
  const conditionsAvailable = ctx.weather !== null && !ctx.weather.isDomed;
  if (ctx.weather && !ctx.weather.isDomed) {
    const parts: string[] = [];
    if (ctx.weather.windSpeed > 16) {
      conditionsVolatility += 4;
      parts.push(`wind ${Math.round(ctx.weather.windSpeed)} mph`);
    }
    if (ctx.weather.temperature > 88) {
      conditionsVolatility += 3;
      parts.push(`heat ${Math.round(ctx.weather.temperature)}F`);
    }
    if (ctx.weather.precipitation > 0.35) {
      conditionsVolatility += 3;
      parts.push(`rain probability ${Math.round(ctx.weather.precipitation * 100)}%`);
    }
    conditionsVolatility = clamp(conditionsVolatility, 0, 9);
    conditionsEvidence = parts.length > 0
      ? `Outdoor conditions increase tennis volatility without favoring either player: ${parts.join(", ")}`
      : `Outdoor conditions mild (${Math.round(ctx.weather.temperature)}F, wind ${Math.round(ctx.weather.windSpeed)} mph)`;
  }
  factors.push({
    key: "tennis_conditions",
    label: "Outdoor conditions",
    homeDelta: 0,
    weight: 0.04,
    available: conditionsAvailable,
    hasSignal: conditionsAvailable && conditionsVolatility > 0,
    evidence: conditionsEvidence,
  });

  return factors;
}
