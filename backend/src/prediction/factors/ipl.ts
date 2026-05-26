/**
 * IPL / T20 cricket specific factors.
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 * Breakdown:
 *   - Table strength / net run rate: 0.14
 *   - Batting run trend: 0.08
 *   - Bowling / fielding trend: 0.08
 *   - Venue split: 0.06
 *   - Head-to-head matchup: 0.03
 *   - Weather / conditions volatility: 0.03
 *
 * ESPN's cricket feed has lighter team-level data than the US leagues, so
 * these factors intentionally use only already-fetched schedule/form context.
 * Missing factors redistribute through the shared engine instead of inventing
 * unavailable toss, XI, or player-availability data.
 */

import type { GameContext, FactorContribution } from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function splitWinPct(record: { wins: number; losses: number }): number | null {
  const games = record.wins + record.losses;
  if (games < 3) return null;
  return record.wins / games;
}

function numericTeamField(team: GameContext["game"]["homeTeam"], field: "standingsRank" | "standingsPoints" | "netRunRate" | "matchesPlayed"): number | null {
  const value = (team as unknown as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function computeIPLFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  const homeRank = numericTeamField(ctx.game.homeTeam, "standingsRank");
  const awayRank = numericTeamField(ctx.game.awayTeam, "standingsRank");
  const homePoints = numericTeamField(ctx.game.homeTeam, "standingsPoints");
  const awayPoints = numericTeamField(ctx.game.awayTeam, "standingsPoints");
  const homePlayed = numericTeamField(ctx.game.homeTeam, "matchesPlayed");
  const awayPlayed = numericTeamField(ctx.game.awayTeam, "matchesPlayed");
  const homeNrr = numericTeamField(ctx.game.homeTeam, "netRunRate");
  const awayNrr = numericTeamField(ctx.game.awayTeam, "netRunRate");
  const pointsAvailable = homePoints !== null && awayPoints !== null && homePlayed !== null && awayPlayed !== null && homePlayed > 0 && awayPlayed > 0;
  const rankAvailable = homeRank !== null && awayRank !== null;
  const nrrAvailable = homeNrr !== null && awayNrr !== null;
  const tableAvailable = pointsAvailable || rankAvailable || nrrAvailable;
  const pointsPerMatchDelta = pointsAvailable
    ? clamp(((homePoints! / homePlayed!) - (awayPoints! / awayPlayed!)) * 55, -55, 55)
    : 0;
  const rankDelta = rankAvailable ? clamp((awayRank! - homeRank!) * 7, -45, 45) : 0;
  const nrrDelta = nrrAvailable ? clamp((homeNrr! - awayNrr!) * 28, -45, 45) : 0;
  const tableDelta = tableAvailable
    ? clamp(pointsPerMatchDelta * 0.5 + rankDelta * 0.25 + nrrDelta * 0.25, -75, 75)
    : 0;
  factors.push({
    key: "ipl_table_strength",
    label: "IPL table strength",
    homeDelta: tableDelta,
    weight: 0.14,
    available: tableAvailable,
    hasSignal: tableAvailable && tableDelta !== 0,
    evidence: tableAvailable
      ? `${ctx.game.homeTeam.abbreviation} rank ${homeRank ?? "n/a"}, ${homePoints ?? "n/a"} pts, NRR ${homeNrr ?? "n/a"} vs ${ctx.game.awayTeam.abbreviation} rank ${awayRank ?? "n/a"}, ${awayPoints ?? "n/a"} pts, NRR ${awayNrr ?? "n/a"}`
      : "IPL standings unavailable for table-strength factor",
  });

  const homeBattingTrend = ctx.homeExtended.scoringTrend;
  const awayBattingTrend = ctx.awayExtended.scoringTrend;
  const battingDelta = clamp((homeBattingTrend - awayBattingTrend) * 38, -45, 45);
  factors.push({
    key: "ipl_batting_trend",
    label: "Batting run trend",
    homeDelta: battingDelta,
    weight: 0.08,
    available: true,
    hasSignal: battingDelta !== 0,
    evidence: `Home batting trend ${homeBattingTrend >= 0 ? "+" : ""}${homeBattingTrend.toFixed(2)} vs Away ${awayBattingTrend >= 0 ? "+" : ""}${awayBattingTrend.toFixed(2)}`,
  });

  const homeBowlingTrend = ctx.homeExtended.defenseTrend;
  const awayBowlingTrend = ctx.awayExtended.defenseTrend;
  const bowlingDelta = clamp((homeBowlingTrend - awayBowlingTrend) * 34, -40, 40);
  factors.push({
    key: "ipl_bowling_trend",
    label: "Bowling / fielding trend",
    homeDelta: bowlingDelta,
    weight: 0.08,
    available: true,
    hasSignal: bowlingDelta !== 0,
    evidence: `Home run-prevention trend ${homeBowlingTrend >= 0 ? "+" : ""}${homeBowlingTrend.toFixed(2)} vs Away ${awayBowlingTrend >= 0 ? "+" : ""}${awayBowlingTrend.toFixed(2)}`,
  });

  const directHomeVenuePct = splitWinPct(ctx.homeExtended.homeRecord);
  const directAwayRoadPct = splitWinPct(ctx.awayExtended.awayRecord);
  const freeVenueSplit = ctx.iplVenueSplit ?? null;
  const freeVenueAvailable =
    freeVenueSplit !== null &&
    freeVenueSplit.homeGames >= 3 &&
    freeVenueSplit.awayGames >= 3;
  const homeVenuePct = directHomeVenuePct ?? (freeVenueAvailable ? freeVenueSplit.homeWinPct : null);
  const awayRoadPct = directAwayRoadPct ?? (freeVenueAvailable ? freeVenueSplit.awayRoadWinPct : null);
  const venueAvailable = homeVenuePct !== null && awayRoadPct !== null;
  const venueDelta = venueAvailable
    ? clamp((homeVenuePct! - awayRoadPct!) * 70, -45, 45)
    : 0;
  factors.push({
    key: "ipl_venue_split",
    label: "Venue split",
    homeDelta: venueDelta,
    weight: 0.06,
    available: venueAvailable,
    hasSignal: venueAvailable && venueDelta !== 0,
    evidence: venueAvailable
      ? freeVenueAvailable && (directHomeVenuePct === null || directAwayRoadPct === null)
        ? `${ctx.game.homeTeam.abbreviation} recent IPL home/H2H win rate ${(homeVenuePct! * 100).toFixed(0)}% (${freeVenueSplit.homeGames} games) vs ${ctx.game.awayTeam.abbreviation} away/H2H win rate ${(awayRoadPct! * 100).toFixed(0)}% (${freeVenueSplit.awayGames} games)`
        : `${ctx.game.homeTeam.abbreviation} home win rate ${(homeVenuePct! * 100).toFixed(0)}% vs ${ctx.game.awayTeam.abbreviation} away win rate ${(awayRoadPct! * 100).toFixed(0)}%`
      : "Home/away split sample too small for IPL venue factor",
  });

  const h2h = ctx.homeExtended.headToHeadResults;
  const h2hAvailable = h2h.length >= 2;
  const h2hDelta = h2hAvailable
    ? clamp(((h2h.filter((game) => game.won).length / h2h.length) - 0.5) * 70, -35, 35)
    : 0;
  factors.push({
    key: "ipl_head_to_head",
    label: "Recent head-to-head",
    homeDelta: h2hDelta,
    weight: 0.03,
    available: h2hAvailable,
    hasSignal: h2hAvailable && h2hDelta !== 0,
    evidence: h2hAvailable
      ? `${ctx.game.homeTeam.abbreviation} won ${h2h.filter((game) => game.won).length}/${h2h.length} recent meetings`
      : "Head-to-head sample too small for IPL matchup factor",
  });

  let conditionsDelta = 0;
  let conditionsEvidence = "Weather data unavailable for IPL venue";
  const conditionsAvailable = ctx.weather !== null && !ctx.weather.isDomed;
  if (ctx.weather && !ctx.weather.isDomed) {
    const parts: string[] = [];
    if (ctx.weather.precipitation > 0.35) {
      conditionsDelta += 6;
      parts.push(`rain probability ${Math.round(ctx.weather.precipitation * 100)}%`);
    }
    if (ctx.weather.windSpeed > 18) {
      conditionsDelta += 4;
      parts.push(`wind ${Math.round(ctx.weather.windSpeed)} mph`);
    }
    if (ctx.weather.temperature > 95) {
      conditionsDelta += 4;
      parts.push(`heat ${Math.round(ctx.weather.temperature)}F`);
    }
    conditionsDelta = clamp(conditionsDelta, 0, 10);
    conditionsEvidence = parts.length > 0
      ? `Outdoor conditions add venue familiarity: ${parts.join(", ")}`
      : `Outdoor conditions mild (${Math.round(ctx.weather.temperature)}F, wind ${Math.round(ctx.weather.windSpeed)} mph)`;
  }

  factors.push({
    key: "ipl_conditions",
    label: "Weather / conditions volatility",
    homeDelta: conditionsDelta,
    weight: 0.03,
    available: conditionsAvailable,
    hasSignal: conditionsAvailable && conditionsDelta !== 0,
    evidence: conditionsEvidence,
  });

  return factors;
}
