import { describe, expect, it } from "bun:test";
import {
  applySelfLearningCalibration,
  type LearningCalibrationSnapshot,
} from "../selfLearningCalibration";
import type { CanonicalPredictionResult, HonestPrediction } from "../types";

function canonical(home: number, away: number): CanonicalPredictionResult {
  return {
    eventId: "learn-1",
    marketType: "moneyline",
    finalPick: home >= away ? "home" : "away",
    finalProbability: Math.max(home, away),
    confidence: Math.round(Math.max(home, away) * 1000) / 10,
    probabilities: { home, away },
    modelInputs: {
      sport: "TENNIS",
      homeTeamId: "home",
      awayTeamId: "away",
      gameTime: "2026-05-28T17:00:00.000Z",
      factorCount: 2,
      availableFactorCount: 2,
      marketConsensusIncluded: false,
    },
    engineBreakdown: [
      {
        engine: "orchestrator-v1",
        pick: home >= away ? "home" : "away",
        probability: Math.max(home, away),
        probabilities: { home, away },
        weight: 1,
      },
    ],
    reconciliation: {
      method: "test",
      notes: [],
    },
    timestamp: "2026-05-28T12:00:00.000Z",
    dataVersion: "test",
    warnings: [],
  };
}

function prediction(home = 0.62, away = 0.38): HonestPrediction {
  return {
    gameId: "learn-1",
    league: "TENNIS",
    canonicalResult: canonical(home, away),
    predictedWinner: { teamId: "home", abbr: "HOM" },
    homeWinProbability: home,
    awayWinProbability: away,
    confidence: Math.round(Math.max(home, away) * 1000) / 10,
    confidenceBand: "clear edge",
    factors: [],
    unavailableFactors: [],
    narrative: "",
    modelVersion: "test",
    generatedAt: "2026-05-28T12:00:00.000Z",
    dataSources: ["game-script simulation"],
  };
}

function snapshot(count: number): LearningCalibrationSnapshot {
  return {
    sport: "TENNIS",
    sampleSize: count,
    generatedAt: "2026-05-28T03:00:00.000Z",
    reliabilityCurve: [
      {
        bucket: "60-65",
        midpoint: 0.625,
        predictedWinRate: 0.625,
        actualWinRate: 0.50,
        count,
      },
    ],
  };
}

describe("self-learning calibration", () => {
  it("pulls over-confident sport buckets down with a hard cap", () => {
    const calibrated = applySelfLearningCalibration(prediction(), snapshot(120));

    expect(calibrated.homeWinProbability).toBeCloseTo(0.59, 3);
    expect(calibrated.awayWinProbability).toBeCloseTo(0.41, 3);
    expect(calibrated.confidence).toBe(59);
    expect(calibrated.dataSources).toContain("self-learning calibration");
    expect(calibrated.canonicalResult.engineBreakdown.map((read) => read.engine)).toContain(
      "self-learning-calibration-v1",
    );
  });

  it("does not auto-apply when the matching bucket sample is too small", () => {
    const original = prediction();
    const calibrated = applySelfLearningCalibration(original, snapshot(29));

    expect(calibrated).toBe(original);
    expect(calibrated.homeWinProbability).toBe(0.62);
    expect(calibrated.dataSources).not.toContain("self-learning calibration");
  });
});
