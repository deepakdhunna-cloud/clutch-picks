/**
 * Sanity check: run the new honest prediction engine on real games.
 *
 * Usage: bun run backend/scripts/sanity-check-prediction.ts
 *
 * Fetches one real game per sport (NBA, MLB, NHL — NFL is off-season),
 * builds a GameContext from live ESPN data, runs predictGame(), and
 * prints a readable terminal report for manual review.
 */

// Must import env first to validate environment variables
import "../src/env";

import { predictGame } from "../src/prediction/index";
import type { GameContext } from "../src/prediction/types";
import { buildDeterministicNarrative, buildNarrativeInput } from "../src/prediction/narrative";
import type { Game, Team } from "../src/types/sports";
import { Sport, League, GameStatus } from "../src/types/sports";
import { DEFAULT_RATING } from "../src/lib/elo";
import {
  fetchTeamRecentForm,
  fetchTeamExtendedStats,
  fetchTeamInjuries,
  fetchAdvancedMetrics,
  fetchStartingLineup,
  fetchGameWeather,
} from "../src/lib/espnStats";

// ─── ESPN scoreboard fetching ───────────────────────────────────────────

const ESPN_SPORT_PATHS: Record<string, string> = {
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  NFL: "football/nfl",
};

interface ESPNScoreboardGame {
  id: string;
  date: string;
  name: string;
  competitions: Array<{
    venue?: { fullName?: string };
    competitors: Array<{
      id: string;
      homeAway: string;
      team: {
        id: string;
        displayName: string;
        abbreviation: string;
        logo: string;
        color?: string;
      };
      records?: Array<{ summary: string }>;
    }>;
  }>;
}

async function fetchOneGame(sport: string): Promise<ESPNScoreboardGame | null> {
  const sportPath = ESPN_SPORT_PATHS[sport];
  if (!sportPath) return null;

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${today}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const events = data?.events as ESPNScoreboardGame[] | undefined;
    if (!events || events.length === 0) return null;
    // Return the first game (or first scheduled if any)
    return events[0] ?? null;
  } catch (e) {
    console.error(`  [ERROR] Failed to fetch ${sport} scoreboard: ${e}`);
    return null;
  }
}

function parseRecord(summary: string | undefined): { wins: number; losses: number; ties?: number } {
  if (!summary) return { wins: 0, losses: 0 };
  const parts = summary.split("-").map(Number);
  return {
    wins: parts[0] ?? 0,
    losses: parts[1] ?? 0,
    ties: parts.length > 2 ? parts[2] : undefined,
  };
}

// ─── Build GameContext from ESPN data ────────────────────────────────────

async function buildContext(espnGame: ESPNScoreboardGame, sport: string): Promise<GameContext> {
  const comp = espnGame.competitions[0]!;
  const homeComp = comp.competitors.find((c) => c.homeAway === "home")!;
  const awayComp = comp.competitors.find((c) => c.homeAway === "away")!;

  const homeRecord = parseRecord(homeComp.records?.[0]?.summary);
  const awayRecord = parseRecord(awayComp.records?.[0]?.summary);

  const homeTeam: Team = {
    id: homeComp.team.id,
    name: homeComp.team.displayName,
    abbreviation: homeComp.team.abbreviation,
    logo: homeComp.team.logo,
    record: homeRecord,
  };

  const awayTeam: Team = {
    id: awayComp.team.id,
    name: awayComp.team.displayName,
    abbreviation: awayComp.team.abbreviation,
    logo: awayComp.team.logo,
    record: awayRecord,
  };

  const game: Game = {
    id: espnGame.id,
    sport: sport as Sport,
    league: ["NCAAF", "NCAAB"].includes(sport) ? League.College : League.Pro,
    homeTeam,
    awayTeam,
    dateTime: espnGame.date,
    venue: comp.venue?.fullName ?? "Unknown",
    tvChannel: "",
    status: GameStatus.Scheduled,
  };

  const gameDate = new Date(espnGame.date);

  // Try to get Elo from DB, fall back to DEFAULT_RATING if DB is unavailable
  let homeElo = DEFAULT_RATING;
  let awayElo = DEFAULT_RATING;
  try {
    const { getEloRating } = await import("../src/lib/elo");
    [homeElo, awayElo] = await Promise.all([
      getEloRating(homeTeam.id, sport),
      getEloRating(awayTeam.id, sport),
    ]);
  } catch {
    console.log(`  [WARN] DB unavailable — using default Elo ${DEFAULT_RATING} for both teams`);
  }

  // Fetch all ESPN data in parallel
  console.log(`  Fetching ESPN data for ${awayTeam.abbreviation} @ ${homeTeam.abbreviation}...`);
  const [
    homeForm, awayForm,
    homeExtended, awayExtended,
    homeInjuries, awayInjuries,
    homeAdvanced, awayAdvanced,
    homeLineup, awayLineup,
    weather,
  ] = await Promise.all([
    fetchTeamRecentForm(homeTeam.id, sport),
    fetchTeamRecentForm(awayTeam.id, sport),
    fetchTeamExtendedStats(homeTeam.id, sport, awayTeam.id, gameDate),
    fetchTeamExtendedStats(awayTeam.id, sport, homeTeam.id, gameDate),
    fetchTeamInjuries(homeTeam.id, sport),
    fetchTeamInjuries(awayTeam.id, sport),
    fetchAdvancedMetrics(homeTeam.id, sport),
    fetchAdvancedMetrics(awayTeam.id, sport),
    fetchStartingLineup(homeTeam.id, sport, gameDate),
    fetchStartingLineup(awayTeam.id, sport, gameDate),
    fetchGameWeather(comp.venue?.fullName ?? "", gameDate, sport),
  ]);

  return {
    game,
    sport,
    homeElo,
    awayElo,
    homeForm,
    awayForm,
    homeExtended,
    awayExtended,
    homeInjuries,
    awayInjuries,
    homeAdvanced,
    awayAdvanced,
    homeLineup,
    awayLineup,
    weather,
    gameDate: gameDate.toISOString(),
  };
}

// ─── Report printer ─────────────────────────────────────────────────────

function printReport(ctx: GameContext, prediction: ReturnType<typeof predictGame>) {
  const { game } = ctx;
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${game.awayTeam.name} (${game.awayTeam.record.wins}-${game.awayTeam.record.losses}) @ ${game.homeTeam.name} (${game.homeTeam.record.wins}-${game.homeTeam.record.losses})`);
  console.log(`  Sport: ${ctx.sport} | Venue: ${game.venue} | Time: ${game.dateTime}`);
  console.log(`  Home Elo: ${Math.round(ctx.homeElo)} | Away Elo: ${Math.round(ctx.awayElo)}`);
  console.log(`${"─".repeat(70)}`);

  // Factors table
  console.log(`\n  FACTORS:`);
  console.log(`  ${"Key".padEnd(24)} ${"Delta".padStart(8)} ${"Weight".padStart(8)} ${"Avail".padStart(6)}  Evidence`);
  console.log(`  ${"─".repeat(24)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(6)}  ${"─".repeat(40)}`);

  let totalDelta = 0;
  for (const f of prediction.factors) {
    const delta = f.available ? f.homeDelta * f.weight : 0;
    totalDelta += delta;
    const sign = f.homeDelta >= 0 ? "+" : "";
    console.log(
      `  ${f.key.padEnd(24)} ${(sign + f.homeDelta.toFixed(1)).padStart(8)} ${f.weight.toFixed(3).padStart(8)} ${(f.available ? "  YES" : "   NO").padStart(6)}  ${f.evidence.slice(0, 80)}`
    );
  }

  console.log(`\n  TOTAL WEIGHTED DELTA: ${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(2)} (positive = favors home)`);

  // Unavailable factors
  const unavail = prediction.factors.filter((f) => !f.available);
  if (unavail.length > 0) {
    console.log(`\n  UNAVAILABLE FACTORS (weight redistributed to available):`);
    for (const f of unavail) {
      console.log(`    - ${f.label}: ${f.evidence}`);
    }
  }

  // Result
  console.log(`\n  ── PREDICTION ──`);
  console.log(`  Home Win Prob:  ${(prediction.homeWinProbability * 100).toFixed(1)}%`);
  console.log(`  Away Win Prob:  ${(prediction.awayWinProbability * 100).toFixed(1)}%`);
  if (prediction.drawProbability !== undefined) {
    console.log(`  Draw Prob:      ${(prediction.drawProbability * 100).toFixed(1)}%`);
  }
  console.log(`  Confidence:     ${prediction.confidence.toFixed(1)}%`);
  console.log(`  Band:           ${prediction.confidenceBand}`);
  console.log(`  Winner:         ${prediction.predictedWinner?.abbr ?? "PICK'EM (no edge)"}`);
  console.log(`  Model Version:  ${prediction.modelVersion}`);
  console.log(`  Data Sources:   ${prediction.dataSources.join(", ")}`);

  // Generate narrative
  const narrativeInput = buildNarrativeInput(
    prediction.factors,
    prediction.confidenceBand,
    prediction.confidence,
    game.homeTeam.abbreviation,
    game.awayTeam.abbreviation,
    prediction.predictedWinner?.abbr ?? null,
    ctx.sport,
  );
  const narrative = buildDeterministicNarrative(narrativeInput);
  console.log(`\n  ── NARRATIVE (deterministic) ──`);
  console.log(`  ${narrative}`);
  console.log(`  [${narrative.trim().split(/\s+/).length} words]`);
  console.log(`${"═".repeat(70)}\n`);
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  HONEST PREDICTION ENGINE — SANITY CHECK                            ║");
  console.log("║  Running on real games from today's ESPN scoreboard                 ║");
  console.log(`║  Date: ${new Date().toISOString().slice(0, 10)}                                                   ║`);
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  // NFL is off-season in April, skip it
  const sports = ["NBA", "MLB", "NHL"];
  const issues: string[] = [];

  for (const sport of sports) {
    console.log(`\n[${sport}] Fetching scoreboard...`);
    const espnGame = await fetchOneGame(sport);

    if (!espnGame) {
      console.log(`  No ${sport} games found today. Skipping.`);
      continue;
    }

    try {
      const ctx = await buildContext(espnGame, sport);
      const prediction = predictGame(ctx);

      printReport(ctx, prediction);

      // ── SANITY CHECKS ──
      // 1. Any single factor swamping all others?
      const maxFactorContrib = Math.max(
        ...prediction.factors.filter((f) => f.available).map((f) => Math.abs(f.homeDelta * f.weight))
      );
      const totalAbsContrib = prediction.factors
        .filter((f) => f.available)
        .reduce((s, f) => s + Math.abs(f.homeDelta * f.weight), 0);
      if (totalAbsContrib > 0 && maxFactorContrib / totalAbsContrib > 0.85) {
        const swamper = prediction.factors.find(
          (f) => f.available && Math.abs(f.homeDelta * f.weight) === maxFactorContrib
        );
        issues.push(`[${sport}] WEIGHT BUG: Factor "${swamper?.key}" contributes ${((maxFactorContrib / totalAbsContrib) * 100).toFixed(0)}% of total — single factor swamping`);
      }

      // 2. Confidence above 80% on non-obvious mismatch?
      if (prediction.confidence > 80) {
        issues.push(`[${sport}] HIGH CONFIDENCE: ${prediction.confidence.toFixed(1)}% — verify this is a genuine mismatch`);
      }

      // 3. Confidence above 68% on evenly matched teams (similar Elo)?
      const eloDiff = Math.abs(ctx.homeElo - ctx.awayElo);
      if (prediction.confidence > 68 && eloDiff < 80) {
        issues.push(`[${sport}] INFLATED: ${prediction.confidence.toFixed(1)}% confidence but Elo gap only ${Math.round(eloDiff)} pts`);
      }

      // 4. Factor available=true but underlying data missing?
      for (const f of prediction.factors) {
        if (f.available && f.evidence.includes("unavailable")) {
          issues.push(`[${sport}] DATA LIE: Factor "${f.key}" marked available but evidence says unavailable`);
        }
      }

    } catch (e) {
      console.error(`  [ERROR] ${sport}: ${e}`);
      issues.push(`[${sport}] CRASH: ${e}`);
    }
  }

  // ── Summary ──
  console.log("\n" + "═".repeat(70));
  if (issues.length === 0) {
    console.log("  ✅ ALL SANITY CHECKS PASSED — no issues detected");
  } else {
    console.log("  ⚠️  ISSUES FOUND:");
    for (const issue of issues) {
      console.log(`    - ${issue}`);
    }
  }
  console.log("═".repeat(70));
}

main().catch(console.error);
