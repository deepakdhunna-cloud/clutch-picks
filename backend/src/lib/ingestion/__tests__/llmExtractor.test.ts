/**
 * LLM-extraction tests.
 *
 * We don't exercise the real Haiku call in CI — too slow, too flaky,
 * and requires a key. Instead we test `validateExtractions` directly:
 * it's the dropout gate that every parsed Haiku response flows through,
 * and it owns the "reject hallucinations" contract.
 */

import { describe, it, expect } from "bun:test";
import { validateExtractions } from "../llmExtractor";

const sourceLine = "Shams: LeBron OUT tonight vs BOS";
const credibility = 0.95;

describe("validateExtractions", () => {
  it("keeps a well-formed NBA extraction with all required fields", () => {
    const raw = [
      {
        playerName: "LeBron James",
        teamAbbreviation: "LAL",
        status: "out",
        confidence: 0.9,
        severity: "critical",
        reasoning: "Woj tweeted he's out with ankle soreness",
        gameImpactElo: -115,
      },
    ];
    const signals = validateExtractions(raw, sourceLine, credibility);
    expect(signals.length).toBe(1);
    expect(signals[0]!.playerName).toBe("LeBron James");
    expect(signals[0]!.teamAbbreviation).toBe("LAL");
    expect(signals[0]!.status).toBe("out");
    expect(signals[0]!.sourceCredibility).toBe(0.95);
  });

  it("returns [] for an empty article (no players detected)", () => {
    expect(validateExtractions([], sourceLine, credibility)).toEqual([]);
  });

  it("drops a hallucinated team abbreviation (not on the NBA roster)", () => {
    const raw = [
      {
        playerName: "Fake Player",
        teamAbbreviation: "ZZZ",
        status: "out",
        confidence: 0.9,
        severity: "critical",
        reasoning: "nonsense",
        gameImpactElo: -90,
      },
    ];
    expect(validateExtractions(raw, sourceLine, credibility)).toEqual([]);
  });

  it("returns [] when the parsed response is not an array (e.g. LLM hallucinated JSON shape)", () => {
    // Haiku sometimes returns an object with `players: [...]` despite the prompt.
    // validateExtractions must bounce that.
    expect(validateExtractions({ players: [] }, sourceLine, credibility)).toEqual([]);
  });

  it("clamps out-of-range gameImpactElo into [-120, 0] and drops invalid confidence", () => {
    const raw = [
      // Case A: gameImpactElo way too negative → clamped to -120
      {
        playerName: "A Player",
        teamAbbreviation: "BOS",
        status: "doubtful",
        confidence: 0.8,
        severity: "moderate",
        reasoning: "ok",
        gameImpactElo: -500,
      },
      // Case B: confidence > 1.0 → invalid, drop
      {
        playerName: "B Player",
        teamAbbreviation: "GSW",
        status: "out",
        confidence: 2.5,
        severity: "critical",
        reasoning: "ok",
        gameImpactElo: -80,
      },
    ];
    const signals = validateExtractions(raw, sourceLine, credibility);
    expect(signals.length).toBe(1);
    expect(signals[0]!.playerName).toBe("A Player");
    expect(signals[0]!.gameImpactElo).toBe(-120);
  });

  it("drops entries with unknown status (not in PLAYER_STATUS_VALUES)", () => {
    const raw = [
      {
        playerName: "X",
        teamAbbreviation: "MIA",
        status: "maybe_kinda",
        confidence: 0.5,
        severity: "minor",
        reasoning: "ambiguous",
        gameImpactElo: -20,
      },
    ];
    expect(validateExtractions(raw, sourceLine, credibility)).toEqual([]);
  });
});
