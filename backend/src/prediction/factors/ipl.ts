/**
 * IPL / T20 cricket specific factors.
 *
 * Sport-factor weights (relative; the engine normalizes all factor weights to
 * sum to 1 after unavailable-data redistribution, so these are relative
 * importances rather than a fixed budget):
 *   - Table strength / net run rate: 0.14  (real IPL standings only)
 *   - Season win rate (from record):  0.10  (works for ALL T20 competitions)
 *   - Batting run trend:               0.08
 *   - Bowling / fielding trend:        0.08
 *   - Venue split:                     0.06
 *   - Head-to-head matchup:            0.03
 *   - Weather / conditions volatility: 0.03
 *
 * The season-win-rate factor is the key signal for non-IPL T20 competitions
 * (domestic leagues, bilateral tours, women's T20) where IPL standings, NRR and
 * trend data do not exist; it keeps those predictions from collapsing to ~50%.
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

// Derive a team's season win% from whatever record shape the context carries.
// The route layer stores cricket records as a "W-L" (optionally "W-L-T") string,
// while other layers use a {wins,losses} object. Returns null when the record is
// missing or the sample is too small to be meaningful — never invents a value.
function seasonWinPctFromRecord(
  record: unknown,
): { winPct: number; games: number } | null {
  let wins: number | null = null;
  let losses: number | null = null;
  let ties = 0;

  if (typeof record === "string") {
    const m = record.trim().match(/^(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?$/);
    if (m) {
      wins = Number(m[1]);
      losses = Number(m[2]);
      ties = m[3] !== undefined ? Number(m[3]) : 0;
    }
  } else if (record && typeof record === "object") {
    const r = record as { wins?: unknown; losses?: unknown; ties?: unknown };
    if (typeof r.wins === "number") wins = r.wins;
    if (typeof r.losses === "number") losses = r.losses;
    if (typeof r.ties === "number") ties = r.ties;
  }

  if (wins === null || losses === null) return null;
  const games = wins + losses + ties;
  if (games < 3) return null;
  // Ties count as half-wins (rare in T20, but possible via super-over/abandon).
  return { winPct: (wins + ties * 0.5) / games, games };
}

function numericTeamField(
  team: GameContext["game"]["homeTeam"],
  field:
    | "standingsRank"
    | "standingsPoints"
    | "netRunRate"
    | "matchesPlayed"
    | "runRateFor"
    | "runRateAgainst",
): number | null {
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
  const homeRunRateFor = numericTeamField(ctx.game.homeTeam, "runRateFor");
  const awayRunRateFor = numericTeamField(ctx.game.awayTeam, "runRateFor");
  const battingTrendAvailable =
    ctx.homeExtended.avgScoreLast10 > 0 &&
    ctx.awayExtended.avgScoreLast10 > 0;
  const battingRunRateAvailable = homeRunRateFor !== null && awayRunRateFor !== null;
  const battingAvailable = battingTrendAvailable || battingRunRateAvailable;
  const battingDelta = battingTrendAvailable
    ? clamp((homeBattingTrend - awayBattingTrend) * 38, -45, 45)
    : battingRunRateAvailable
      ? clamp((homeRunRateFor! - awayRunRateFor!) * 22, -45, 45)
      : 0;
  factors.push({
    key: "ipl_batting_trend",
    label: battingTrendAvailable ? "Batting run trend" : "Batting run rate",
    homeDelta: battingDelta,
    weight: 0.08,
    available: battingAvailable,
    hasSignal: battingAvailable && battingDelta !== 0,
    evidence: battingTrendAvailable
      ? `Home batting trend ${homeBattingTrend >= 0 ? "+" : ""}${homeBattingTrend.toFixed(2)} vs Away ${awayBattingTrend >= 0 ? "+" : ""}${awayBattingTrend.toFixed(2)}`
      : battingRunRateAvailable
        ? `${ctx.game.homeTeam.abbreviation} season run rate ${homeRunRateFor!.toFixed(2)} rpo vs ${ctx.game.awayTeam.abbreviation} ${awayRunRateFor!.toFixed(2)} rpo`
        : "IPL batting run-rate data unavailable",
  });

  const homeBowlingTrend = ctx.homeExtended.defenseTrend;
  const awayBowlingTrend = ctx.awayExtended.defenseTrend;
  const homeRunRateAgainst = numericTeamField(ctx.game.homeTeam, "runRateAgainst");
  const awayRunRateAgainst = numericTeamField(ctx.game.awayTeam, "runRateAgainst");
  const bowlingTrendAvailable = battingTrendAvailable;
  const bowlingRunRateAvailable = homeRunRateAgainst !== null && awayRunRateAgainst !== null;
  const bowlingAvailable = bowlingTrendAvailable || bowlingRunRateAvailable;
  const bowlingDelta = bowlingTrendAvailable
    ? clamp((homeBowlingTrend - awayBowlingTrend) * 34, -40, 40)
    : bowlingRunRateAvailable
      ? clamp((awayRunRateAgainst! - homeRunRateAgainst!) * 22, -40, 40)
      : 0;
  factors.push({
    key: "ipl_bowling_trend",
    label: bowlingTrendAvailable ? "Bowling / fielding trend" : "Bowling run prevention",
    homeDelta: bowlingDelta,
    weight: 0.08,
    available: bowlingAvailable,
    hasSignal: bowlingAvailable && bowlingDelta !== 0,
    evidence: bowlingTrendAvailable
      ? `Home run-prevention trend ${homeBowlingTrend >= 0 ? "+" : ""}${homeBowlingTrend.toFixed(2)} vs Away ${awayBowlingTrend >= 0 ? "+" : ""}${awayBowlingTrend.toFixed(2)}`
      : bowlingRunRateAvailable
        ? `${ctx.game.homeTeam.abbreviation} concede ${homeRunRateAgainst!.toFixed(2)} rpo vs ${ctx.game.awayTeam.abbreviation} ${awayRunRateAgainst!.toFixed(2)} rpo`
        : "IPL run-prevention data unavailable",
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

  // Season win-rate from each team's competition record. This is the most
  // reliably populated cricket signal for non-IPL T20 competitions (domestic
  // leagues, tours, women's T20) where IPL standings, NRR and trend data are
  // unavailable — without it those predictions collapse toward 50/50. ESPN
  // supplies a W-L record on the scoreboard for most active T20 teams. The
  // factor only fires when BOTH teams have a real record sample, so nothing is
  // invented; when records are missing it redistributes through the engine.
  const homeSeason = seasonWinPctFromRecord(
    (ctx.game.homeTeam as unknown as Record<string, unknown>).record,
  );
  const awaySeason = seasonWinPctFromRecord(
    (ctx.game.awayTeam as unknown as Record<string, unknown>).record,
  );
  const seasonAvailable = homeSeason !== null && awaySeason !== null;
  // Shrink toward the league mean (0.5) by sample size so a 3-0 team isn't
  // treated as a certainty. Effective sample uses the smaller of the two so a
  // thin opponent record can't over-amplify the edge.
  const seasonDelta = seasonAvailable
    ? (() => {
        const minGames = Math.min(homeSeason!.games, awaySeason!.games);
        const shrink = minGames / (minGames + 6); // 0..1, ~0.5 at 6 games
        const raw = (homeSeason!.winPct - awaySeason!.winPct) * 90;
        return clamp(raw * shrink, -60, 60);
      })()
    : 0;
  factors.push({
    key: "ipl_season_record",
    label: "Season win rate",
    homeDelta: seasonDelta,
    weight: 0.1,
    available: seasonAvailable,
    hasSignal: seasonAvailable && seasonDelta !== 0,
    evidence: seasonAvailable
      ? `${ctx.game.homeTeam.abbreviation} ${(homeSeason!.winPct * 100).toFixed(0)}% win rate (${homeSeason!.games} games) vs ${ctx.game.awayTeam.abbreviation} ${(awaySeason!.winPct * 100).toFixed(0)}% (${awaySeason!.games} games)`
      : "Season records unavailable for both teams",
  });

  return factors;
}
