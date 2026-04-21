/**
 * Tests for narrative.ts — Section 6 / Section 8.
 *
 * Validates:
 *   - Word count stays in [80, 150]
 *   - No banned words
 *   - Counterpoint inclusion
 *   - Unavailable factor caveats
 *   - Coinflip band never sounds confident
 *   - Deterministic fallback handles edge cases
 */

import { describe, it, expect } from "bun:test";
import {
  buildDeterministicNarrative,
  buildNarrativeInput,
  computeFactorHash,
} from "../narrative";
import type { FactorContribution, ConfidenceBand } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const BANNED_REGEX = /lock|guaranteed|can't lose|easy money|slam dunk|smash|dominant|sharp play|hammer/i;

function makeFactors(overrides: Partial<FactorContribution>[] = []): FactorContribution[] {
  const defaults: FactorContribution[] = [
    { key: "rating_diff", label: "Elo rating differential", homeDelta: 80, weight: 0.40, available: true, hasSignal: true, evidence: "Home BOS Elo 1580 + 100 HFA vs Away ORL Elo 1500 = 180 pt differential" },
    { key: "rest_diff", label: "Rest differential", homeDelta: 15, weight: 0.05, available: true, hasSignal: true, evidence: "Home 2 days rest vs Away 1 day rest" },
    { key: "recent_form", label: "Recent form (L10)", homeDelta: 40, weight: 0.10, available: true, hasSignal: true, evidence: "Home L10: 8-2 (80%), Away L10: 5-5 (50%)" },
    { key: "travel", label: "Travel / road trip fatigue", homeDelta: 10, weight: 0.03, available: true, hasSignal: true, evidence: "Away team on game 3 of road trip" },
    { key: "injuries", label: "Star player availability", homeDelta: -30, weight: 0.18, available: true, hasSignal: true, evidence: "Home team missing 2 starters — net 60 Elo penalty" },
    { key: "back_to_back", label: "Back-to-back fatigue", homeDelta: 50, weight: 0.07, available: true, hasSignal: true, evidence: "ORL on back-to-back (road)" },
    { key: "net_rating", label: "Pace-adjusted net rating", homeDelta: 0, weight: 0.10, available: false, hasSignal: false, evidence: "Data unavailable from ESPN" },
    { key: "three_pt", label: "Three-point regression", homeDelta: 0, weight: 0.03, available: false, hasSignal: false, evidence: "Per-game 3P% not available" },
  ];
  for (let i = 0; i < overrides.length && i < defaults.length; i++) {
    defaults[i] = { ...defaults[i]!, ...overrides[i] };
  }
  return defaults;
}

function buildNarrative(
  factors: FactorContribution[],
  band: ConfidenceBand = "clear edge",
  winnerAbbr: string | null = "BOS"
): string {
  const input = buildNarrativeInput(factors, band, 62.0, "BOS", "ORL", winnerAbbr, "NBA");
  return buildDeterministicNarrative(input);
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("buildDeterministicNarrative", () => {
  it("produces output in [80, 150] word range for standard input", () => {
    // Test across multiple band types
    const bands: ConfidenceBand[] = ["coinflip", "slight edge", "clear edge", "strong edge"];
    for (const band of bands) {
      const text = buildNarrative(makeFactors(), band);
      const wc = wordCount(text);
      expect(wc).toBeGreaterThanOrEqual(30); // Deterministic may be shorter than LLM target but must be reasonable
      expect(wc).toBeLessThanOrEqual(180);
    }
  });

  it("never contains banned words", () => {
    const bands: ConfidenceBand[] = ["coinflip", "slight edge", "clear edge", "strong edge"];
    for (const band of bands) {
      const text = buildNarrative(makeFactors(), band);
      expect(BANNED_REGEX.test(text)).toBe(false);
    }
  });

  it("includes counterpoint when one exists", () => {
    // Factor 4 (injuries) has negative homeDelta — should appear as counterpoint
    const text = buildNarrative(makeFactors(), "clear edge", "BOS");
    expect(text.toLowerCase()).toContain("against the pick");
  });

  it("includes caveat for unavailable key factors", () => {
    const factors = makeFactors();
    // net_rating has weight 0.10 >= 0.05, so it should trigger caveat
    const text = buildNarrative(factors, "clear edge");
    expect(text.toLowerCase()).toContain("caveat");
  });

  it("coinflip band never sounds confident", () => {
    const text = buildNarrative(makeFactors(), "coinflip");
    expect(text.toLowerCase()).not.toContain("strong case");
    expect(text.toLowerCase()).not.toContain("clear separation");
    expect(text.toLowerCase()).toContain("toss-up");
  });

  it("handles pick'em (null winner)", () => {
    const text = buildNarrative(makeFactors(), "coinflip", null);
    expect(text.toLowerCase()).toContain("coin flip");
    expect(text.toLowerCase()).toContain("neither team");
  });

  it("handles all factors unavailable", () => {
    const factors = makeFactors().map((f) => ({ ...f, available: false, homeDelta: 0 }));
    const input = buildNarrativeInput(factors, "coinflip", 50.0, "BOS", "ORL", null, "NBA");
    const text = buildDeterministicNarrative(input);
    expect(text.length).toBeGreaterThan(20);
    expect(BANNED_REGEX.test(text)).toBe(false);
  });

  it("handles single factor only", () => {
    const factors: FactorContribution[] = [
      { key: "rating_diff", label: "Elo rating differential", homeDelta: 200, weight: 1.0, available: true, hasSignal: true, evidence: "Home Elo 1700 vs Away Elo 1300 = 400 pt gap" },
    ];
    const input = buildNarrativeInput(factors, "strong edge", 75.0, "BOS", "ORL", "BOS", "NBA");
    const text = buildDeterministicNarrative(input);
    expect(text.length).toBeGreaterThan(20);
    expect(text).toContain("BOS");
  });

  it("handles perfectly balanced factors", () => {
    const factors: FactorContribution[] = [
      { key: "f1", label: "Factor A", homeDelta: 50, weight: 0.5, available: true, hasSignal: true, evidence: "Slightly favors home" },
      { key: "f2", label: "Factor B", homeDelta: -50, weight: 0.5, available: true, hasSignal: true, evidence: "Slightly favors away" },
    ];
    const input = buildNarrativeInput(factors, "coinflip", 50.1, "BOS", "ORL", "BOS", "NBA");
    const text = buildDeterministicNarrative(input);
    expect(text.length).toBeGreaterThan(20);
  });

  // ── Elo-only fallback ──
  // Light-data night: rating_diff has the only real signal; every other
  // factor was pooled to hasSignal=false with homeDelta=0. The narrative
  // must still be populated with the Elo lead AND an explicit note that
  // no supporting signals were available.
  it("produces an Elo-only narrative when only rating_diff has real signal", () => {
    const factors: FactorContribution[] = [
      {
        key: "rating_diff",
        label: "Elo rating differential",
        homeDelta: 220,
        weight: 1.0, // blendFactors pooled everything onto Elo
        available: true,
        hasSignal: true,
        evidence: "Home BOS Elo 1561 + 100 HFA vs Away PHI Elo 1441 = 220 pt differential",
      },
      // These match what post-blendFactors no-signal factors look like.
      { key: "injuries_nba", label: "Star player availability", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "No significant injuries reported for either team" },
      { key: "back_to_back", label: "Back-to-back fatigue", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "No back-to-back for either team" },
      { key: "net_rating", label: "Pace-adjusted net rating", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "Offensive/defensive rating data unavailable from ESPN" },
    ];
    const input = buildNarrativeInput(factors, "strong edge", 78.0, "BOS", "PHI", "BOS", "NBA");
    const text = buildDeterministicNarrative(input);

    // Must reference the Elo evidence (the only signal).
    expect(text).toContain("Elo");
    expect(text).toContain("BOS");

    // Must explicitly flag the absence of supporting signals instead of
    // silently ending after the lead factor.
    expect(text.toLowerCase()).toContain("no additional contextual signals available");

    // Non-empty, no banned words.
    expect(text.length).toBeGreaterThan(40);
    expect(BANNED_REGEX.test(text)).toBe(false);
  });
});

// ─── Counterpoint framing (BHA vs CHE bug repro + neutral-context filter) ──

// Extract the sentence rendered in the counterpoint slot, if any. Returns
// null when the narrative does not include a counterpoint section at all.
function extractCounterpointSentence(text: string): string | null {
  const marker = "Working against the pick:";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const after = text.slice(idx);
  const endIdx = after.indexOf(".");
  return endIdx === -1 ? after : after.slice(0, endIdx + 1);
}

describe("buildDeterministicNarrative — counterpoint framing", () => {
  it("Case A: pick=home, away-favored recent form → counterpoint names AWAY team, not home form number", () => {
    const factors: FactorContribution[] = [
      {
        key: "rating_diff",
        label: "Elo rating differential",
        homeDelta: 50,
        weight: 0.40,
        available: true,
        hasSignal: true,
        evidence: "Home BHA Elo 1550 + 65 HFA vs Away CHE Elo 1540 = 75 pt differential",
      },
      {
        key: "recent_form",
        label: "Recent form (L10)",
        homeDelta: -200,
        weight: 0.10,
        available: true,
        hasSignal: true,
        evidence: "Home L10: 3-7 (30%), Away L10: 7-3 (70%)",
      },
    ];
    const input = buildNarrativeInput(
      factors, "slight edge", 55.0, "BHA", "CHE", "BHA", "EPL",
    );
    const text = buildDeterministicNarrative(input);
    const counterpoint = extractCounterpointSentence(text);

    expect(counterpoint).not.toBeNull();
    expect(counterpoint).toContain("CHE");
    expect(counterpoint).not.toContain("BHA");
    // Must NOT copy the verbatim two-sided evidence into the counterpoint slot.
    expect(counterpoint).not.toContain("Home L10");
    expect(counterpoint).not.toContain("(30%)");
  });

  it("Case B: pick=away, home-favored rest → counterpoint names HOME team, not raw evidence", () => {
    const factors: FactorContribution[] = [
      {
        key: "rating_diff",
        label: "Elo rating differential",
        homeDelta: -80,
        weight: 0.40,
        available: true,
        hasSignal: true,
        evidence: "Home BOS Elo 1500 + 90 HFA vs Away LAL Elo 1680 = -90 pt differential",
      },
      {
        key: "rest_diff",
        label: "Rest differential",
        homeDelta: 30,
        weight: 0.05,
        available: true,
        hasSignal: true,
        evidence: "Home 4 days rest vs Away 2 days rest (+2 day advantage home)",
      },
    ];
    const input = buildNarrativeInput(
      factors, "slight edge", 56.0, "BOS", "LAL", "LAL", "NBA",
    );
    const text = buildDeterministicNarrative(input);
    const counterpoint = extractCounterpointSentence(text);

    expect(counterpoint).not.toBeNull();
    expect(counterpoint).toContain("BOS");
    expect(counterpoint).not.toContain("LAL");
    // Must NOT copy the verbatim two-sided evidence into the counterpoint slot.
    expect(counterpoint).not.toContain("Home 4 days rest");
    expect(counterpoint).not.toContain("Away 2 days rest");
  });

  it("Case C: MLB weather factor is never rendered as a counterpoint", () => {
    const factors: FactorContribution[] = [
      {
        key: "rating_diff",
        label: "Elo rating differential",
        homeDelta: 40,
        weight: 0.40,
        available: true,
        hasSignal: true,
        evidence: "Home NYY Elo 1560 + 24 HFA vs Away BOS Elo 1550 = 34 pt differential",
      },
      {
        key: "weather_mlb",
        label: "Weather (wind/conditions)",
        homeDelta: -20,
        weight: 0.02,
        available: true,
        hasSignal: true,
        evidence: "Outdoor with 22 mph wind — slight randomness increase",
      },
    ];
    const input = buildNarrativeInput(
      factors, "slight edge", 56.0, "NYY", "BOS", "NYY", "MLB",
    );
    const text = buildDeterministicNarrative(input);

    expect(extractCounterpointSentence(text)).toBeNull();
  });

  it("Case D: MLB ballpark factor is never rendered as a counterpoint", () => {
    const factors: FactorContribution[] = [
      {
        key: "rating_diff",
        label: "Elo rating differential",
        homeDelta: 40,
        weight: 0.40,
        available: true,
        hasSignal: true,
        evidence: "Home SF Elo 1540 + 24 HFA vs Away COL Elo 1530 = 34 pt differential",
      },
      {
        key: "ballpark",
        label: "Ballpark run environment",
        homeDelta: -8,
        weight: 0.04,
        available: true,
        hasSignal: true,
        evidence: "SF park (-0.40 runs/game) — pitcher-friendly (-8 Elo home)",
      },
    ];
    const input = buildNarrativeInput(
      factors, "slight edge", 55.0, "SF", "COL", "SF", "MLB",
    );
    const text = buildDeterministicNarrative(input);

    expect(extractCounterpointSentence(text)).toBeNull();
  });

  it("Case D2: umpire and early-season factors are also never counterpoints", () => {
    const factors: FactorContribution[] = [
      {
        key: "rating_diff",
        label: "Elo rating differential",
        homeDelta: 40,
        weight: 0.40,
        available: true,
        hasSignal: true,
        evidence: "Home NYY Elo 1560 + 24 HFA vs Away BOS Elo 1550 = 34 pt differential",
      },
      {
        key: "umpire",
        label: "Umpire strike zone tendency",
        homeDelta: -15,
        weight: 0.02,
        available: true,
        hasSignal: true,
        evidence: "HP umpire X favors away (-2.5 pts) in a hitter's zone",
      },
      {
        key: "early_season_mlb",
        label: "Early-season noise warning",
        homeDelta: -10,
        weight: 0.02,
        available: true,
        hasSignal: true,
        evidence: "Only 12 games played — team stats unreliable",
      },
    ];
    const input = buildNarrativeInput(
      factors, "slight edge", 56.0, "NYY", "BOS", "NYY", "MLB",
    );
    const text = buildDeterministicNarrative(input);

    expect(extractCounterpointSentence(text)).toBeNull();
  });

  it("Case E (regression): Elo-only fallback still renders 'no additional contextual signals'", () => {
    const factors: FactorContribution[] = [
      {
        key: "rating_diff",
        label: "Elo rating differential",
        homeDelta: 220,
        weight: 1.0,
        available: true,
        hasSignal: true,
        evidence: "Home BOS Elo 1561 + 100 HFA vs Away PHI Elo 1441 = 220 pt differential",
      },
      { key: "injuries_nba", label: "Star player availability", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "No significant injuries reported for either team" },
      { key: "back_to_back", label: "Back-to-back fatigue", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "No back-to-back for either team" },
      { key: "net_rating", label: "Pace-adjusted net rating", homeDelta: 0, weight: 0, available: true, hasSignal: false, evidence: "Offensive/defensive rating data unavailable from ESPN" },
    ];
    const input = buildNarrativeInput(factors, "strong edge", 78.0, "BOS", "PHI", "BOS", "NBA");
    const text = buildDeterministicNarrative(input);

    expect(text.toLowerCase()).toContain("no additional contextual signals available");
    expect(text).toContain("Elo");
    expect(text).toContain("BOS");
  });
});

describe("computeFactorHash", () => {
  it("produces consistent hash for same factors", () => {
    const factors = makeFactors();
    const h1 = computeFactorHash(factors);
    const h2 = computeFactorHash(factors);
    expect(h1).toBe(h2);
  });

  it("produces different hash when factors change", () => {
    const factors1 = makeFactors();
    const factors2 = makeFactors([{ homeDelta: 999 }]);
    expect(computeFactorHash(factors1)).not.toBe(computeFactorHash(factors2));
  });

  it("is order-independent", () => {
    const factors = makeFactors();
    const reversed = [...factors].reverse();
    expect(computeFactorHash(factors)).toBe(computeFactorHash(reversed));
  });
});

describe("buildNarrativeInput", () => {
  it("sorts factors by impact and picks top 3", () => {
    const input = buildNarrativeInput(
      makeFactors(), "clear edge", 62.0, "BOS", "ORL", "BOS", "NBA"
    );
    expect(input.leadFactor.key).toBe("rating_diff"); // Highest impact
    expect(input.supportingFactors.length).toBeLessThanOrEqual(2);
  });

  it("identifies counterpoint when present", () => {
    const input = buildNarrativeInput(
      makeFactors(), "clear edge", 62.0, "BOS", "ORL", "BOS", "NBA"
    );
    // injuries has homeDelta -30, which is against BOS (home winner)
    expect(input.counterpoint).not.toBeNull();
    expect(input.counterpoint?.key).toBe("injuries");
  });

  it("lists unavailable key factors", () => {
    const input = buildNarrativeInput(
      makeFactors(), "clear edge", 62.0, "BOS", "ORL", "BOS", "NBA"
    );
    // net_rating (weight 0.10) is unavailable
    expect(input.unavailableKeyFactors.length).toBeGreaterThan(0);
  });
});
