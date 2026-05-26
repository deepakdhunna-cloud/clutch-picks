/**
 * Point-in-time simulation backtest.
 *
 * This script intentionally refuses to invent historical context. Feed it a
 * JSON file containing saved GameContext snapshots plus final scores, and it
 * reports pick accuracy, probability calibration, projected spread error, and
 * projected total error by league.
 *
 * Usage:
 *   bun run src/scripts/simulationBacktest.ts --file ./fixtures/simulation-backtest.json
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { predictGame } from "../prediction";
import type { CanonicalFinalPick, GameContext } from "../prediction/types";

type ActualResult = {
  homeScore: number;
  awayScore: number;
};

type SimulationBacktestFixture = {
  id?: string;
  sport?: string;
  ctx: GameContext;
  actual: ActualResult;
};

type FixtureFile = SimulationBacktestFixture[] | { games: SimulationBacktestFixture[] };

type ScoredFixture = {
  id: string;
  sport: string;
  finalPick: CanonicalFinalPick;
  actualPick: CanonicalFinalPick;
  correct: boolean;
  predictedProbability: number;
  actualProbability: number;
  logLoss: number;
  brier: number;
  projectedSpread: number;
  actualSpread: number;
  spreadError: number;
  projectedTotal: number;
  actualTotal: number;
  totalError: number;
  confidence: number;
  warnings: string[];
};

type SportAggregate = {
  sport: string;
  games: number;
  correct: number;
  accuracy: number;
  avgConfidence: number;
  avgLogLoss: number;
  avgBrier: number;
  spreadMae: number;
  totalMae: number;
  warnings: string[];
};

type BacktestReport = {
  runAt: string;
  inputFile: string;
  totalGames: number;
  overall: Omit<SportAggregate, "sport">;
  perSport: SportAggregate[];
  calibrationBuckets: Array<{
    label: string;
    games: number;
    accuracy: number | null;
    expected: number;
    error: number | null;
  }>;
  dataContract: string;
};

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);

  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0) return process.argv[index + 1] ?? null;
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseFixtureFile(raw: unknown): SimulationBacktestFixture[] {
  const games = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { games?: unknown }).games)
      ? (raw as { games: SimulationBacktestFixture[] }).games
      : null;

  if (!games) {
    throw new Error("Fixture file must be an array or an object with a games array.");
  }

  const valid: SimulationBacktestFixture[] = [];
  for (const [index, fixture] of games.entries()) {
    if (!fixture || typeof fixture !== "object") {
      throw new Error(`Fixture ${index} is not an object.`);
    }
    if (!fixture.ctx || typeof fixture.ctx !== "object") {
      throw new Error(`Fixture ${index} is missing ctx.`);
    }
    if (!fixture.actual || typeof fixture.actual !== "object") {
      throw new Error(`Fixture ${index} is missing actual result.`);
    }
    if (!isFiniteNumber(fixture.actual.homeScore) || !isFiniteNumber(fixture.actual.awayScore)) {
      throw new Error(`Fixture ${index} actual.homeScore/awayScore must be numbers.`);
    }
    valid.push(fixture);
  }

  return valid;
}

function actualPick(actual: ActualResult, hasDraw: boolean): CanonicalFinalPick {
  if (actual.homeScore > actual.awayScore) return "home";
  if (actual.awayScore > actual.homeScore) return "away";
  return hasDraw ? "draw" : "none";
}

function probabilityForActual(
  probabilities: { home: number; away: number; draw?: number },
  pick: CanonicalFinalPick,
): number {
  if (pick === "home") return probabilities.home;
  if (pick === "away") return probabilities.away;
  if (pick === "draw") return probabilities.draw ?? 0;
  return Math.max(1 - probabilities.home - probabilities.away - (probabilities.draw ?? 0), 0);
}

function scoreFixture(fixture: SimulationBacktestFixture): ScoredFixture {
  const prediction = predictGame(fixture.ctx);
  const canonical = prediction.canonicalResult;
  const actual = actualPick(fixture.actual, canonical.marketType === "three_way_result");
  const actualProbability = probabilityForActual(canonical.probabilities, actual);
  const clampedActualProbability = Math.min(0.999, Math.max(0.001, actualProbability));
  const actualSpread = fixture.actual.homeScore - fixture.actual.awayScore;
  const actualTotal = fixture.actual.homeScore + fixture.actual.awayScore;
  const projectedSpread = prediction.projection?.projectedSpread ?? 0;
  const projectedTotal = prediction.projection?.projectedTotal ?? 0;
  const correct = canonical.finalPick === actual;

  return {
    id: fixture.id ?? fixture.ctx.game.id,
    sport: fixture.sport ?? fixture.ctx.sport,
    finalPick: canonical.finalPick,
    actualPick: actual,
    correct,
    predictedProbability: canonical.finalProbability,
    actualProbability,
    logLoss: -Math.log(clampedActualProbability),
    brier: (1 - actualProbability) ** 2,
    projectedSpread,
    actualSpread,
    spreadError: Math.abs(projectedSpread - actualSpread),
    projectedTotal,
    actualTotal,
    totalError: Math.abs(projectedTotal - actualTotal),
    confidence: canonical.confidence,
    warnings: canonical.warnings,
  };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function aggregate(sport: string, rows: ScoredFixture[]): SportAggregate {
  const correct = rows.filter((row) => row.correct).length;
  const warnings = Array.from(new Set(rows.flatMap((row) => row.warnings))).slice(0, 8);
  return {
    sport,
    games: rows.length,
    correct,
    accuracy: rows.length > 0 ? round((correct / rows.length) * 100, 1) : 0,
    avgConfidence: round(avg(rows.map((row) => row.confidence)), 1),
    avgLogLoss: round(avg(rows.map((row) => row.logLoss)), 4),
    avgBrier: round(avg(rows.map((row) => row.brier)), 4),
    spreadMae: round(avg(rows.map((row) => row.spreadError)), 2),
    totalMae: round(avg(rows.map((row) => row.totalError)), 2),
    warnings,
  };
}

function calibrationBuckets(rows: ScoredFixture[]): BacktestReport["calibrationBuckets"] {
  const buckets = [
    { label: "50-54", min: 50, max: 54, expected: 52 },
    { label: "55-59", min: 55, max: 59, expected: 57 },
    { label: "60-64", min: 60, max: 64, expected: 62 },
    { label: "65-69", min: 65, max: 69, expected: 67 },
    { label: "70-74", min: 70, max: 74, expected: 72 },
    { label: "75-79", min: 75, max: 79, expected: 77 },
    { label: "80-100", min: 80, max: 100, expected: 85 },
  ];

  return buckets.map((bucket) => {
    const inBucket = rows.filter((row) => row.confidence >= bucket.min && row.confidence <= bucket.max);
    const accuracy = inBucket.length > 0
      ? round((inBucket.filter((row) => row.correct).length / inBucket.length) * 100, 1)
      : null;
    return {
      label: bucket.label,
      games: inBucket.length,
      accuracy,
      expected: bucket.expected,
      error: accuracy === null ? null : round(Math.abs(accuracy - bucket.expected), 1),
    };
  });
}

async function main(): Promise<void> {
  const file = argValue("file");
  if (!file) {
    console.error(
      "Missing --file. Provide point-in-time GameContext fixtures; this script will not fabricate historical data.",
    );
    process.exitCode = 1;
    return;
  }

  const inputFile = resolve(process.cwd(), file);
  const content = await readFile(inputFile, "utf-8");
  const fixtures = parseFixtureFile(JSON.parse(content) as FixtureFile);
  if (fixtures.length === 0) {
    throw new Error("Fixture file contained zero games.");
  }

  const scored = fixtures.map(scoreFixture);
  const bySport = new Map<string, ScoredFixture[]>();
  for (const row of scored) {
    bySport.set(row.sport, [...(bySport.get(row.sport) ?? []), row]);
  }

  const perSport = Array.from(bySport.entries())
    .map(([sport, rows]) => aggregate(sport, rows))
    .sort((a, b) => b.games - a.games);
  const overall = aggregate("ALL", scored);
  const report: BacktestReport = {
    runAt: new Date().toISOString(),
    inputFile,
    totalGames: scored.length,
    overall: {
      games: overall.games,
      correct: overall.correct,
      accuracy: overall.accuracy,
      avgConfidence: overall.avgConfidence,
      avgLogLoss: overall.avgLogLoss,
      avgBrier: overall.avgBrier,
      spreadMae: overall.spreadMae,
      totalMae: overall.totalMae,
      warnings: overall.warnings,
    },
    perSport,
    calibrationBuckets: calibrationBuckets(scored),
    dataContract:
      "Fixtures must be point-in-time GameContext snapshots captured before games start. " +
      "Do not use current injuries/form/ratings for past games.",
  };

  const outDir = resolve(process.cwd(), "backtest-results");
  await mkdir(outDir, { recursive: true });
  const stamped = `simulation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await Promise.all([
    writeFile(resolve(outDir, stamped), JSON.stringify(report, null, 2)),
    writeFile(resolve(outDir, "simulation-latest.json"), JSON.stringify(report, null, 2)),
  ]);

  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
