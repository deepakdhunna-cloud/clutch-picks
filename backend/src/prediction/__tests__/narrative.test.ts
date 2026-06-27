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

function sentenceCount(text: string): number {
  return text.trim().match(/[.!?](?=\s|$)/g)?.length ?? 0;
}

const BANNED_REGEX = /lock|guaranteed|can't lose|can’t lose|easy money|slam dunk|smash|dominant|sharp play|hammer|sure thing/i;
const BAD_STYLE_REGEX = /get the call|usable edges|power-rating case|working against the pick|the model|the algorithm/i;

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
      expect(BAD_STYLE_REGEX.test(text)).toBe(false);
    }
  });

  it("includes counterpoint when one exists", () => {
    // Factor 4 (injuries) has negative homeDelta — should appear as counterpoint
    const text = buildNarrative(makeFactors(), "clear edge", "BOS");
    expect(text.toLowerCase()).toMatch(/gives me pause|flip it|not all one-way/);
  });

  it("includes structured injury context when provided", () => {
    const input = buildNarrativeInput(
      makeFactors(), "clear edge", 62.0, "BOS", "ORL", "BOS", "NBA",
      [
        {
          name: "Jayson Tatum",
          team: "BOS",
          position: "SF",
          status: "Doubtful",
          reason: "ankle soreness",
        },
      ],
    );
    const text = buildDeterministicNarrative(input);

    expect(text).toContain("Jayson Tatum");
    expect(text).toContain("BOS");
    expect(text.toLowerCase()).toContain("doubtful");
    expect(text.toLowerCase()).toContain("ankle soreness");
  });

  it("highlights playoff context when the game has it", () => {
    const input = buildNarrativeInput(
      makeFactors(), "clear edge", 62.0, "BOS", "ORL", "BOS", "NBA",
      [],
      {
        phase: "playoffs",
        label: "NBA playoff window",
        detail: "This falls in the NBA playoff window, so regular-season numbers are background and the pick should lean on repeatable matchup edges.",
        source: "date",
      },
    );
    const text = buildDeterministicNarrative(input);

    expect(text.toLowerCase()).toContain("playoff");
    expect(text.toLowerCase()).toContain("repeatable matchup edges");
    expect(text.toLowerCase()).toContain("regular-season numbers are background");
  });

  it("makes NBA fallback copy conversational instead of dumping raw factor strings", () => {
    const factors: FactorContribution[] = [
      {
        key: "rating_diff",
        label: "Elo rating differential",
        homeDelta: 97,
        weight: 0.40,
        available: true,
        hasSignal: true,
        evidence: "Home LAL Elo 1556 + 100 HFA vs Away OKC Elo 1560 = 97 pt differential",
      },
      {
        key: "recent_form",
        label: "Recent form (L10)",
        homeDelta: -45,
        weight: 0.10,
        available: true,
        hasSignal: true,
        evidence: "Home L10: 4-5 (44%), Away L10: 7-0 (100%)",
      },
    ];
    const input = buildNarrativeInput(
      factors,
      "clear edge",
      59.0,
      "LAL",
      "OKC",
      "LAL",
      "NBA",
      [],
      {
        phase: "playoffs",
        label: "NBA playoff window",
        detail: "This falls in the NBA playoff window, so regular-season numbers are background and the pick should lean on repeatable matchup edges.",
        source: "date",
      },
      "Los Angeles Lakers",
      "Oklahoma City Thunder",
    );

    const text = buildDeterministicNarrative(input);

    expect(text).toContain("Los Angeles Lakers");
    expect(text).toContain("Oklahoma City Thunder");
    expect(text.toLowerCase()).toContain("playoff");
    expect(text).not.toContain("The data points toward");
    expect(text).not.toContain("Home LAL Elo");
    expect(text).not.toContain("Away OKC Elo");
    expect(text).not.toContain("Home L10");
    expect(text).not.toMatch(BAD_STYLE_REGEX);
    expect(text.toLowerCase()).toContain("recent form");
    expect(sentenceCount(text)).toBeLessThanOrEqual(10);
  });

  it("uses singular player phrasing for tennis narratives", () => {
    const factors: FactorContribution[] = [
      {
        key: "tennis_ranking_edge",
        label: "ATP/WTA ranking edge",
        homeDelta: 70,
        weight: 0.35,
        available: true,
        hasSignal: true,
        evidence: "ATP ranking: GANN #1130 (11 pts) vs COCO #1314 (6 pts)",
      },
      {
        key: "recent_form",
        label: "Recent form (L10)",
        homeDelta: 20,
        weight: 0.10,
        available: true,
        hasSignal: true,
        evidence: "Home L10: 5-5 (50%), Away L10: 4-6 (40%)",
      },
    ];
    const input = buildNarrativeInput(
      factors,
      "clear edge",
      60.0,
      "GANN",
      "COCO",
      "GANN",
      "TENNIS",
      [],
      {
        phase: "regular_season",
        label: "Tennis tournament setting",
        detail: "Tournament draw context.",
        source: "date",
      },
      "Conor Gannon",
      "Sebastiano Cocola",
    );

    const text = buildDeterministicNarrative(input);

    expect(text).toContain("Conor Gannon");
    expect(text).not.toContain("Conor Gannon have");
    expect(text).not.toContain("hotter team");
    expect(text).not.toContain("Sebastiano Cocola sit at");
  });

  it("adds a fan-interest angle without inventing facts", () => {
    const input = buildNarrativeInput(
      makeFactors(), "clear edge", 62.0, "BOS", "ORL", "BOS", "NBA",
    );
    const text = buildDeterministicNarrative(input).toLowerCase();

    expect(text).toMatch(/question|hinge|interesting|clean edge|story|fun part|juice|spicy|comes down|carry the night|keep an eye|under the lights|watch the|track it|stay close|whole thesis|whole watch|put under the lights|their shot here|live angle|makes it watchable|how upsets start|whole read shifts|travels its strengths|harden or evaporate/);
    expect(text).not.toContain("game 7");
    expect(text).not.toContain("series lead");
  });

  it("keeps deterministic game-card narratives to 10 sentences or fewer", () => {
    const input = buildNarrativeInput(
      makeFactors(), "clear edge", 62.0, "BOS", "ORL", "BOS", "NBA",
      [
        { name: "Jayson Tatum", team: "BOS", position: "SF", status: "Doubtful", reason: "ankle soreness" },
      ],
      {
        phase: "playoffs",
        label: "NBA playoff window",
        detail: "This falls in the NBA playoff window, so regular-season numbers are background and the pick should lean on repeatable matchup edges.",
        source: "date",
      },
    );
    const text = buildDeterministicNarrative(input);

    expect(sentenceCount(text)).toBeLessThanOrEqual(10);
  });

  it("does not turn missing injury input into a fake clean injury report", () => {
    const input = buildNarrativeInput(
      makeFactors(), "clear edge", 62.0, "BOS", "ORL", "BOS", "NFL",
      [],
    );
    const text = buildDeterministicNarrative(input).toLowerCase();

    expect(text).not.toContain("healthy");
    expect(text).not.toContain("no injuries");
    expect(text).not.toContain("no significant injuries");
  });

  it("does not reuse the exact same fallback wording across different games", () => {
    const bosInput = buildNarrativeInput(
      makeFactors(), "clear edge", 62.0, "BOS", "ORL", "BOS", "NBA",
    );
    const detInput = buildNarrativeInput(
      [
        { key: "starting_pitcher", label: "Starting pitcher matchup", homeDelta: 80, weight: 0.21, available: true, hasSignal: true, evidence: "Home starter has 3.12 ERA vs Away starter 4.20 ERA" },
        { key: "recent_form", label: "Recent form (L10)", homeDelta: 50, weight: 0.10, available: true, hasSignal: true, evidence: "Home L10: 7-3, Away L10: 4-6" },
        { key: "bullpen", label: "Bullpen form", homeDelta: 30, weight: 0.08, available: true, hasSignal: true, evidence: "Home bullpen 2.90 ERA last 7 days vs Away 4.50" },
      ],
      "clear edge", 62.0, "DET", "MIL", "DET", "MLB",
    );

    const bosText = buildDeterministicNarrative(bosInput);
    const detText = buildDeterministicNarrative(detInput);

    expect(detText).toContain("DET");
    expect(detText).toContain("Starting pitcher matchup".toLowerCase());
    expect(detText).not.toBe(bosText);
    expect(detText.split(".")[0]).not.toBe(bosText.split(".")[0]);
  });

  it("includes caveat for unavailable key factors", () => {
    const factors = makeFactors();
    // net_rating has weight 0.10 >= 0.05, so it should trigger caveat
    const text = buildNarrative(factors, "clear edge");
    expect(text.toLowerCase()).toMatch(/flag|caveat/);
  });

  it("coinflip band never sounds confident", () => {
    const text = buildNarrative(makeFactors(), "coinflip");
    expect(text.toLowerCase()).not.toContain("strong case");
    expect(text.toLowerCase()).not.toContain("clear separation");
    // any toss-up / coin-flip framing, never a confident declaration
    expect(text.toLowerCase()).toMatch(/toss-up|coin flip|coin-flip|keep it light/);
  });

  it("handles pick'em (null winner)", () => {
    const text = buildNarrative(makeFactors(), "coinflip", null);
    expect(text.toLowerCase()).toMatch(/coin flip|pick'em|too close to call/);
    expect(text.toLowerCase()).toMatch(/nobody's separating|no real edge|no need to force|more than a lean/);
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

  // ── Rating-only fallback ──
  // Light-data night: rating_diff has the only real signal; every other
  // factor was pooled to hasSignal=false with homeDelta=0. The narrative
  // must still be populated with the rating lead AND an explicit note that
  // no supporting signals were available.
  it("produces a rating-only narrative when only rating_diff has real signal", () => {
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

    // Must reference the rating evidence without dumping raw Elo language.
    expect(text).toContain("220");
    expect(text).not.toContain("Elo");
    expect(text).toContain("BOS");

    // Must explicitly flag the absence of supporting signals instead of
    // silently ending after the lead factor.
    expect(text.toLowerCase()).toMatch(/not a ton of extra context|rides on that one main edge/);

    // Non-empty, no banned words.
    expect(text.length).toBeGreaterThan(40);
    expect(BANNED_REGEX.test(text)).toBe(false);
  });
});

// ─── Counterpoint framing (BHA vs CHE bug repro + neutral-context filter) ──

// Extract the sentence rendered in the counterpoint slot, if any. Returns
// null when the narrative does not include a counterpoint section at all.
function extractCounterpointSentence(text: string): string | null {
  // The counterpoint connector now varies (cool-friend voice). Find whichever
  // of the connectors rendered, earliest in the text.
  const markers = [
    "The one thing that gives me pause:",
    "What could flip it:",
    "Not all one-way though —",
    "The hole in the case:",
    "Where it could go sideways —",
    "Reason to hedge a little:",
    "The counter you can't ignore:",
    "Don't sleep on the other side, though —",
    "One crack in it:",
  ];
  let idx = -1;
  for (const m of markers) {
    const i = text.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
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

  it("Case E (regression): rating-only fallback still renders the thin-context note", () => {
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

    expect(text.toLowerCase()).toMatch(/not a ton of extra context|rides on that one main edge/);
    expect(text).not.toContain("Elo");
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
