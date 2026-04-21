/**
 * Tests for buildAdapterNarrative — the synchronous narrative hook that
 * runs in runNewEnginePrediction before the HonestPrediction is translated
 * into the API's GamePrediction shape.
 *
 * Regression guard: before this wire-up, analysis always came back as ""
 * for every game on the new engine path.
 */

import { describe, it, expect } from "bun:test";
import { buildAdapterNarrative } from "../newEngineAdapter";
import type { HonestPrediction, FactorContribution } from "../types";
import type { Game } from "../../routes/games";

function makeGame(): Game {
  return {
    id: "g1",
    sport: "NBA",
    homeTeam: { id: "1", name: "Boston Celtics", abbreviation: "BOS", logo: "", record: "45-30", primaryColor: "#000", secondaryColor: "#fff" } as any,
    awayTeam: { id: "2", name: "Philadelphia 76ers", abbreviation: "PHI", logo: "", record: "30-45", primaryColor: "#000", secondaryColor: "#fff" } as any,
    gameTime: "2026-04-21T19:00Z",
    status: "SCHEDULED",
    venue: "TD Garden",
  };
}

function makePred(overrides: Partial<HonestPrediction> & { factors: FactorContribution[] }): HonestPrediction {
  return {
    gameId: "g1",
    league: "NBA",
    predictedWinner: { teamId: "1", abbr: "BOS" },
    homeWinProbability: 0.78,
    awayWinProbability: 0.22,
    confidence: 78.0,
    confidenceBand: "strong edge",
    narrative: "",
    modelVersion: "test",
    generatedAt: new Date().toISOString(),
    dataSources: [],
    unavailableFactors: [],
    ...overrides,
  };
}

describe("buildAdapterNarrative", () => {
  it("produces a non-empty narrative when multiple factors have signal", () => {
    const factors: FactorContribution[] = [
      { key: "rating_diff", label: "Elo rating differential", homeDelta: 220, weight: 0.40, available: true, hasSignal: true, evidence: "Home BOS Elo 1561 + 100 HFA vs Away PHI Elo 1441 = 220 pt differential" },
      { key: "injuries_nba", label: "Star player availability", homeDelta: 60, weight: 0.19, available: true, hasSignal: true, evidence: "PHI: Joel Embiid (C) OUT" },
      { key: "net_rating", label: "Pace-adjusted net rating", homeDelta: 30, weight: 0.11, available: true, hasSignal: true, evidence: "Home net rating +4.0 vs Away net rating +0.5" },
    ];
    const narrative = buildAdapterNarrative(makePred({ factors }), "NBA", makeGame());

    expect(narrative.length).toBeGreaterThan(40);
    expect(narrative).toContain("BOS");
    // Lead factor evidence shows up somewhere.
    expect(narrative).toMatch(/220 pt differential|Elo/);
    // No "" fallback.
    expect(narrative.trim()).not.toBe("");
  });

  it("produces Elo-only narrative with explicit no-signal note on light-data nights", () => {
    // Simulates a post-blendFactors state where all non-Elo factors were
    // pooled to weight=0 / hasSignal=false. rating_diff carries the pick.
    const factors: FactorContribution[] = [
      { key: "rating_diff", label: "Elo rating differential", homeDelta: 220, weight: 1.0, available: true, hasSignal: true, evidence: "Home BOS Elo 1561 + 100 HFA vs Away PHI Elo 1441 = 220 pt differential" },
      { key: "injuries_nba", label: "Star player availability", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "No significant injuries reported for either team" },
      { key: "back_to_back", label: "Back-to-back fatigue", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "No back-to-back for either team" },
      { key: "net_rating", label: "Pace-adjusted net rating", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "Offensive/defensive rating data unavailable from ESPN" },
    ];
    const narrative = buildAdapterNarrative(makePred({ factors }), "NBA", makeGame());

    expect(narrative).toContain("BOS");
    expect(narrative).toContain("Elo");
    expect(narrative.toLowerCase()).toContain("no additional contextual signals available");
  });

  it("produces a valid narrative even for a pick'em (winner=null)", () => {
    const factors: FactorContribution[] = [
      { key: "rating_diff", label: "Elo rating differential", homeDelta: 0, weight: 0.40, available: true, hasSignal: true, evidence: "Home Elo 1500 + 100 HFA vs Away Elo 1600 = 0 pt differential" },
    ];
    const pred = makePred({
      factors,
      predictedWinner: null,
      homeWinProbability: 0.50,
      awayWinProbability: 0.50,
      confidence: 50.0,
      confidenceBand: "coinflip",
    });
    const narrative = buildAdapterNarrative(pred, "NBA", makeGame());
    expect(narrative.length).toBeGreaterThan(20);
    expect(narrative.toLowerCase()).toContain("coin flip");
  });
});
