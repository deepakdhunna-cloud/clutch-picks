import { describe, expect, it } from "bun:test";
import {
  buildGradebookSummary,
  gradeResolvedPrediction,
  logLoss,
  selectedOutcomeProbability,
} from "../grading";
import { shouldPersistPredictionSnapshot, shouldUpdatePredictionSnapshot } from "../newEngineAdapter";

describe("prediction grading", () => {
  it("uses the probability assigned to the selected home/away/draw outcome", () => {
    expect(selectedOutcomeProbability({
      predictedWinner: "home",
      predictedOutcome: "home",
      confidence: 61,
      homeWinProb: 0.64,
      awayWinProb: 0.36,
    })).toBeCloseTo(0.64, 5);

    expect(selectedOutcomeProbability({
      predictedWinner: "away",
      predictedOutcome: "away",
      confidence: 58,
      homeWinProb: 0.42,
      awayWinProb: null,
    })).toBeCloseTo(0.58, 5);

    expect(selectedOutcomeProbability({
      predictedWinner: "home",
      predictedOutcome: "draw",
      confidence: 39,
      homeWinProb: 0.31,
      awayWinProb: 0.30,
      drawProb: 0.39,
    })).toBeCloseTo(0.39, 5);
  });

  it("grades a resolved game with selected-outcome Brier and log loss", () => {
    const grade = gradeResolvedPrediction(
      {
        predictedWinner: "away",
        predictedOutcome: "away",
        confidence: 57,
        homeWinProb: 0.43,
        awayWinProb: 0.57,
      },
      {
        actualOutcome: "away",
        homeScore: 98,
        awayScore: 104,
        now: new Date("2026-05-24T20:00:00Z"),
      },
    );

    expect(grade.wasCorrect).toBe(true);
    expect(grade.finalHomeScore).toBe(98);
    expect(grade.finalAwayScore).toBe(104);
    expect(grade.selectedOutcomeProb).toBeCloseTo(0.57, 5);
    expect(grade.brierScore).toBeCloseTo(Math.pow(0.57 - 1, 2), 5);
    expect(grade.logLoss).toBeCloseTo(logLoss(0.57, true), 5);
    expect(grade.gradeVersion).toBe("selected-outcome-v1");
  });

  it("summarizes gradebook rows by sport, model version, and confidence bucket", () => {
    const rows = [
      {
        sport: "NBA",
        modelVersion: "v1",
        confidence: 60,
        selectedOutcomeProb: 0.60,
        wasCorrect: true,
        brierScore: 0.16,
        logLoss: 0.51,
        dataCoverage: 0.8,
        signalCoverage: 0.5,
      },
      {
        sport: "NBA",
        modelVersion: "v1",
        confidence: 60,
        selectedOutcomeProb: 0.60,
        wasCorrect: false,
        brierScore: 0.36,
        logLoss: 0.92,
        dataCoverage: 0.7,
        signalCoverage: 0.4,
      },
      {
        sport: "MLB",
        modelVersion: "v2",
        confidence: 55,
        selectedOutcomeProb: 0.55,
        wasCorrect: true,
        brierScore: 0.2025,
        logLoss: 0.6,
      },
    ];

    const summary = buildGradebookSummary(rows);

    expect(summary.overall.total).toBe(3);
    expect(summary.overall.correct).toBe(2);
    expect(summary.perSport.find((sport) => sport.key === "NBA")?.accuracy).toBe(0.5);
    expect(summary.byModelVersion.find((version) => version.key === "v1")?.total).toBe(2);
    expect(summary.confidenceBuckets.find((bucket) => bucket.key === "60-65")?.total).toBe(2);
    expect(summary.overall.avgBrierScore).toBeCloseTo(0.2408, 4);
  });

  it("persists any pregame snapshot but only updates before the lock window", () => {
    const now = new Date("2026-05-24T18:00:00Z");

    expect(shouldPersistPredictionSnapshot({
      status: "SCHEDULED",
      gameTime: "2026-05-24T18:10:01Z",
    }, now)).toBe(true);
    expect(shouldUpdatePredictionSnapshot({
      status: "SCHEDULED",
      gameTime: "2026-05-24T18:10:01Z",
    }, now)).toBe(true);

    expect(shouldPersistPredictionSnapshot({
      status: "SCHEDULED",
      gameTime: "2026-05-24T18:03:00Z",
    }, now)).toBe(true);
    expect(shouldUpdatePredictionSnapshot({
      status: "SCHEDULED",
      gameTime: "2026-05-24T18:03:00Z",
    }, now)).toBe(false);

    expect(shouldPersistPredictionSnapshot({
      status: "LIVE",
      gameTime: "2026-05-24T18:30:00Z",
    }, now)).toBe(false);

    expect(shouldPersistPredictionSnapshot({
      status: "FINAL",
      gameTime: "2026-05-24T17:00:00Z",
    }, now)).toBe(false);
  });
});
