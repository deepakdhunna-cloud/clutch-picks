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
  const rankingAvailable = homeRank !== null || awayRank !== null;
  const rankingDelta = rankingAvailable ? tennisRankDelta(homeRank, awayRank) : 0;
  factors.push({
    key: "tennis_ranking_edge",
    label: "Ranking edge",
    homeDelta: rankingDelta,
    weight: 0.16,
    available: rankingAvailable,
    hasSignal: rankingAvailable && rankingDelta !== 0,
    evidence: rankingAvailable
      ? `${ctx.game.homeTeam.abbreviation} rank ${homeRank ?? "unranked"} vs ${ctx.game.awayTeam.abbreviation} rank ${awayRank ?? "unranked"}`
      : "Ranking unavailable for both sides",
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

  let conditionsDelta = 0;
  let conditionsEvidence = "Weather data unavailable for tennis venue";
  const conditionsAvailable = ctx.weather !== null && !ctx.weather.isDomed;
  if (ctx.weather && !ctx.weather.isDomed) {
    const parts: string[] = [];
    if (ctx.weather.windSpeed > 16) {
      conditionsDelta += 4;
      parts.push(`wind ${Math.round(ctx.weather.windSpeed)} mph`);
    }
    if (ctx.weather.temperature > 88) {
      conditionsDelta += 3;
      parts.push(`heat ${Math.round(ctx.weather.temperature)}F`);
    }
    if (ctx.weather.precipitation > 0.35) {
      conditionsDelta += 3;
      parts.push(`rain probability ${Math.round(ctx.weather.precipitation * 100)}%`);
    }
    conditionsDelta = clamp(conditionsDelta, 0, 9);
    conditionsEvidence = parts.length > 0
      ? `Outdoor conditions increase tennis volatility: ${parts.join(", ")}`
      : `Outdoor conditions mild (${Math.round(ctx.weather.temperature)}F, wind ${Math.round(ctx.weather.windSpeed)} mph)`;
  }
  factors.push({
    key: "tennis_conditions",
    label: "Outdoor conditions",
    homeDelta: conditionsDelta,
    weight: 0.04,
    available: conditionsAvailable,
    hasSignal: conditionsAvailable && conditionsDelta !== 0,
    evidence: conditionsEvidence,
  });

  return factors;
}
