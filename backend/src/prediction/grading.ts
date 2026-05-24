const EPS = 1e-15;
export const GRADE_VERSION = "selected-outcome-v1";

type Outcome = "home" | "away" | "draw";

export type GradeablePrediction = {
  predictedWinner: string;
  predictedOutcome?: string | null;
  confidence: number;
  homeWinProb?: number | null;
  awayWinProb?: number | null;
  drawProb?: number | null;
};

export type PredictionGrade = {
  actualWinner: Outcome;
  actualOutcome: Outcome;
  wasCorrect: boolean;
  finalHomeScore: number;
  finalAwayScore: number;
  selectedOutcomeProb: number;
  brierScore: number;
  logLoss: number;
  gradeVersion: string;
  gradedAt: Date;
  resolvedAt: Date;
  settledBy: string;
};

export type GradebookRow = {
  sport: string;
  modelVersion?: string | null;
  confidence: number;
  wasCorrect: boolean | null;
  selectedOutcomeProb?: number | null;
  brierScore?: number | null;
  logLoss?: number | null;
  marketDivergence?: number | null;
  dataCoverage?: number | null;
  signalCoverage?: number | null;
};

export type GradebookSlice = {
  key: string;
  total: number;
  correct: number;
  accuracy: number | null;
  avgSelectedOutcomeProb: number | null;
  avgConfidence: number | null;
  avgBrierScore: number | null;
  avgLogLoss: number | null;
  avgMarketDivergence: number | null;
  avgDataCoverage: number | null;
  avgSignalCoverage: number | null;
};

export type GradebookSummary = {
  overall: GradebookSlice;
  perSport: GradebookSlice[];
  byModelVersion: GradebookSlice[];
  confidenceBuckets: GradebookSlice[];
  weakSpots: string[];
};

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function normalizeProbability(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const probability = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, probability));
}

export function predictedOutcome(row: Pick<GradeablePrediction, "predictedWinner" | "predictedOutcome">): Outcome {
  const outcome = row.predictedOutcome ?? row.predictedWinner;
  if (outcome === "draw") return "draw";
  return outcome === "away" ? "away" : "home";
}

export function selectedOutcomeProbability(row: GradeablePrediction): number {
  const fallback = normalizeProbability(row.confidence / 100) ?? 0.5;
  const outcome = predictedOutcome(row);

  if (outcome === "home") {
    return normalizeProbability(row.homeWinProb) ?? fallback;
  }
  if (outcome === "away") {
    const away = normalizeProbability(row.awayWinProb);
    if (away !== null) return away;
    const home = normalizeProbability(row.homeWinProb);
    return home !== null ? 1 - home : fallback;
  }
  return normalizeProbability(row.drawProb) ?? fallback;
}

export function brierScore(probability: number, wasCorrect: boolean): number {
  const outcome = wasCorrect ? 1 : 0;
  return Math.pow(probability - outcome, 2);
}

export function logLoss(probability: number, wasCorrect: boolean): number {
  const prob = Math.max(EPS, Math.min(1 - EPS, probability));
  const outcome = wasCorrect ? 1 : 0;
  return -(
    outcome * Math.log(prob) +
    (1 - outcome) * Math.log(1 - prob)
  );
}

export function gradeResolvedPrediction(
  prediction: GradeablePrediction,
  result: {
    actualOutcome: Outcome;
    homeScore: number;
    awayScore: number;
    settledBy?: string;
    now?: Date;
  },
): PredictionGrade {
  const selectedProb = selectedOutcomeProbability(prediction);
  const correct = predictedOutcome(prediction) === result.actualOutcome;
  const now = result.now ?? new Date();

  return {
    actualWinner: result.actualOutcome,
    actualOutcome: result.actualOutcome,
    wasCorrect: correct,
    finalHomeScore: result.homeScore,
    finalAwayScore: result.awayScore,
    selectedOutcomeProb: selectedProb,
    brierScore: brierScore(selectedProb, correct),
    logLoss: logLoss(selectedProb, correct),
    gradeVersion: GRADE_VERSION,
    gradedAt: now,
    resolvedAt: now,
    settledBy: result.settledBy ?? "espn-scoreboard",
  };
}

function finiteAverage(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function summarizeSlice(key: string, rows: GradebookRow[]): GradebookSlice {
  const resolved = rows.filter((row) => row.wasCorrect !== null);
  const correct = resolved.filter((row) => row.wasCorrect === true).length;
  const selectedProbs = resolved.map((row) =>
    normalizeProbability(row.selectedOutcomeProb) ??
    normalizeProbability(row.confidence / 100),
  );

  return {
    key,
    total: resolved.length,
    correct,
    accuracy: resolved.length > 0 ? round(correct / resolved.length, 4) : null,
    avgSelectedOutcomeProb: roundNullable(finiteAverage(selectedProbs)),
    avgConfidence: roundNullable(finiteAverage(resolved.map((row) => normalizeProbability(row.confidence / 100)))),
    avgBrierScore: roundNullable(finiteAverage(resolved.map((row) => row.brierScore))),
    avgLogLoss: roundNullable(finiteAverage(resolved.map((row) => row.logLoss))),
    avgMarketDivergence: roundNullable(finiteAverage(resolved.map((row) => row.marketDivergence))),
    avgDataCoverage: roundNullable(finiteAverage(resolved.map((row) => row.dataCoverage))),
    avgSignalCoverage: roundNullable(finiteAverage(resolved.map((row) => row.signalCoverage))),
  };
}

function roundNullable(value: number | null): number | null {
  return value === null ? null : round(value, 4);
}

function bucketLabel(probability: number): string {
  const pct = Math.max(0, Math.min(100, probability * 100));
  const floor = Math.floor(pct / 5) * 5;
  const start = Math.max(25, Math.min(95, floor));
  return `${start}-${start + 5}`;
}

function groupBy(rows: GradebookRow[], keyFor: (row: GradebookRow) => string): GradebookSlice[] {
  const groups = new Map<string, GradebookRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, grouped]) => summarizeSlice(key, grouped))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export function buildGradebookSummary(rows: GradebookRow[]): GradebookSummary {
  const resolved = rows.filter((row) => row.wasCorrect !== null);
  const confidenceBuckets = groupBy(resolved, (row) => {
    const probability =
      normalizeProbability(row.selectedOutcomeProb) ??
      normalizeProbability(row.confidence / 100) ??
      0.5;
    return bucketLabel(probability);
  }).sort((a, b) => Number(a.key.split("-")[0]) - Number(b.key.split("-")[0]));

  const perSport = groupBy(resolved, (row) => row.sport || "UNKNOWN");
  const byModelVersion = groupBy(resolved, (row) => row.modelVersion || "unknown");
  const weakSpots: string[] = [];

  for (const bucket of confidenceBuckets) {
    if (bucket.total < 20 || bucket.accuracy === null || bucket.avgSelectedOutcomeProb === null) continue;
    const error = bucket.avgSelectedOutcomeProb - bucket.accuracy;
    if (Math.abs(error) >= 0.08) {
      weakSpots.push(
        `Confidence bucket ${bucket.key} is ${error > 0 ? "over" : "under"}-confident by ${round(Math.abs(error) * 100, 1)} pts over ${bucket.total} games.`,
      );
    }
  }

  for (const sport of perSport) {
    if (sport.total < 20) continue;
    if ((sport.avgBrierScore ?? 0) > 0.26) {
      weakSpots.push(`${sport.key} Brier score is ${sport.avgBrierScore}; needs calibration review.`);
    }
    if ((sport.accuracy ?? 1) < 0.48) {
      weakSpots.push(`${sport.key} accuracy is ${round((sport.accuracy ?? 0) * 100, 1)}% over ${sport.total} games.`);
    }
  }

  return {
    overall: summarizeSlice("ALL", resolved),
    perSport,
    byModelVersion,
    confidenceBuckets,
    weakSpots,
  };
}
