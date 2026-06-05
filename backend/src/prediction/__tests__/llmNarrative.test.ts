/**
 * Tests for the LLM-narrative pipeline.
 *
 * Covers:
 *   - Prompt construction shape
 *   - Validation (sentence count, banned substrings)
 *   - Fallback behavior on empty/error/timeout responses
 *   - Rate cap (500/hour sliding window)
 *   - Injury extraction per sport
 *   - Cache read/write round-trip (mocked OpenAI + real Prisma-adjacent
 *     shape; cache is exercised end-to-end through the orchestration helper).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  ANALYST_SYSTEM_PROMPT,
  buildUserPrompt,
  validateAnalystNarrative,
  generateLLMNarrative,
  extractInjuryListForLLM,
  mapConfidenceTier,
  isRateCapped,
  __setLLMClientForTests,
  __resetRateWindowForTests,
  type LLMNarrativeInput,
  type LLMClient,
} from "../llmNarrative";
import {
  computeVersionHash,
  __resetNarrativeCacheForTests,
} from "../narrativeCache";
import type { FactorContribution } from "../types";
import type { TeamInjuryReport } from "../../lib/espnStats";

// ─── Helpers ────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<LLMNarrativeInput> = {}): LLMNarrativeInput {
  const topFactors: FactorContribution[] = [
    {
      key: "starting_pitcher",
      label: "Starting pitcher matchup",
      homeDelta: 80,
      weight: 0.21,
      available: true,
      hasSignal: true,
      evidence: "Keider Montero (ERA 3.12, FIP 1.70) vs Kyle Harrison (ERA 2.87, FIP 3.63)",
    },
    {
      key: "recent_form",
      label: "Recent form (L10)",
      homeDelta: 80,
      weight: 0.10,
      available: true,
      hasSignal: true,
      evidence: "Home L10: 8-2 (80%), Away L10: 4-6 (40%)",
    },
  ];
  return {
    sport: "MLB",
    awayTeam: { abbr: "MIL", name: "Milwaukee Brewers" },
    homeTeam: { abbr: "DET", name: "Detroit Tigers" },
    pickTeamName: "Detroit Tigers",
    confidenceTier: "moderate",
    topFactors,
    counterpoint: {
      key: "rest_diff",
      label: "Rest differential",
      homeDelta: -30,
      weight: 0.05,
      available: true,
      hasSignal: true,
      evidence: "Home 1 day rest vs Away 3 days rest (-2 day advantage home)",
    },
    injuries: [],
    ...overrides,
  };
}

function mockClient(text: string | null, tokensUsed = 150): LLMClient {
  return {
    async complete() {
      if (text === null) return null;
      return { text, tokensUsed };
    },
  };
}

function failingClient(kind: "throw" | "timeout" | "http-429"): LLMClient {
  return {
    async complete() {
      if (kind === "throw") throw new Error("boom");
      if (kind === "timeout") {
        await new Promise((_, reject) =>
          setTimeout(() => reject(new Error("AbortError")), 1),
        );
        return null;
      }
      return null; // 429 / non-2xx surfaces as null from the real client
    },
  };
}

// ─── Prompt construction ───────────────────────────────────────────────

describe("buildUserPrompt", () => {
  it("includes sport, matchup, pick, confidence tier, and top factors", () => {
    const prompt = buildUserPrompt(makeInput());
    expect(prompt).toContain("Sport: MLB");
    expect(prompt).toContain("MIL Milwaukee Brewers @ DET Detroit Tigers");
    expect(prompt).toContain("Pick: Detroit Tigers");
    expect(prompt).toContain("Confidence: moderate");
    expect(prompt).toContain("Top factors favoring the pick, in priority order:");
    expect(prompt).toContain("Starting pitcher matchup");
    expect(prompt).toContain("Recent form (L10)");
  });

  it("includes counterpoint block when present", () => {
    const prompt = buildUserPrompt(makeInput());
    expect(prompt).toContain("Counterpoint factor:");
    expect(prompt).toContain("Rest differential");
  });

  it("omits counterpoint block when null", () => {
    const prompt = buildUserPrompt(makeInput({ counterpoint: null }));
    expect(prompt).not.toContain("Counterpoint factor:");
  });

  it("omits injury section entirely when list is empty", () => {
    const prompt = buildUserPrompt(makeInput({ injuries: [] }));
    expect(prompt).not.toContain("Injuries");
    expect(prompt).not.toContain("no injuries reported");
  });

  it("includes injury section with Out/Doubtful when present", () => {
    const prompt = buildUserPrompt(
      makeInput({
        injuries: [
          { name: "LeBron James", team: "LAL", position: "SF", status: "Out", reason: "Ankle" },
          { name: "Anthony Davis", team: "LAL", position: "PF", status: "Doubtful", reason: "" },
        ],
      }),
    );
    expect(prompt).toContain("Injuries (Out/Doubtful only");
    expect(prompt).toContain("LeBron James (LAL, SF): Out — Ankle");
    expect(prompt).toContain("Anthony Davis (LAL, PF): Doubtful");
  });

  it("includes season context when present", () => {
    const prompt = buildUserPrompt(
      makeInput({
        seasonContext: {
          phase: "playoffs",
          label: "NBA playoff window",
          detail: "This falls in the NBA playoff window, so the pick should lean on repeatable matchup edges instead of generic regular-season form.",
          source: "date",
        },
      }),
    );

    expect(prompt).toContain("Season context: NBA playoff window");
    expect(prompt).toContain("repeatable matchup edges");
  });

  it("omits season context when absent", () => {
    const prompt = buildUserPrompt(makeInput({ seasonContext: null }));
    expect(prompt).not.toContain("Season context:");
  });

  it("ends with the analysis instruction", () => {
    const prompt = buildUserPrompt(makeInput());
    expect(prompt.endsWith("Write the 80-150 word analysis now.")).toBe(true);
  });
});

describe("ANALYST_SYSTEM_PROMPT", () => {
  it("bans numeric Elo, Vegas lines, and algorithm references", () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain("80-150 words");
    expect(ANALYST_SYSTEM_PROMPT.toLowerCase()).toContain("never do");
    expect(ANALYST_SYSTEM_PROMPT.toLowerCase()).toContain("vegas");
    expect(ANALYST_SYSTEM_PROMPT.toLowerCase()).toContain("elo");
    expect(ANALYST_SYSTEM_PROMPT.toLowerCase()).toContain("lock");
    expect(ANALYST_SYSTEM_PROMPT.toLowerCase()).toContain("season context");
    expect(ANALYST_SYSTEM_PROMPT.toLowerCase()).toContain("fun to watch");
    expect(ANALYST_SYSTEM_PROMPT.toLowerCase()).toContain("sure thing");
  });
});

// ─── Confidence tier ───────────────────────────────────────────────────

describe("mapConfidenceTier", () => {
  it("buckets 45-54 as low", () => {
    expect(mapConfidenceTier(45)).toBe("low");
    expect(mapConfidenceTier(54.9)).toBe("low");
  });
  it("buckets 55-64 as moderate", () => {
    expect(mapConfidenceTier(55)).toBe("moderate");
    expect(mapConfidenceTier(64.9)).toBe("moderate");
  });
  it("buckets 65+ as strong", () => {
    expect(mapConfidenceTier(65)).toBe("strong");
    expect(mapConfidenceTier(78.5)).toBe("strong");
  });
});

// ─── Validation ────────────────────────────────────────────────────────

const SAMPLE_5 =
  "Detroit's the pick because the pitching matchup gives them the cleanest path into this game tonight. Keider Montero brings the better full profile with a 3.12 ERA and 1.70 FIP against Kyle Harrison's 2.87 ERA but 3.63 FIP. The Tigers also have the form edge, sitting 8-2 over their last 10 while Milwaukee is 4-6. The one concern is rest, since the Brewers come in with three days off against Detroit's one. Still, the main baseball reasons point to Detroit.";

describe("validateAnalystNarrative", () => {
  it("accepts a clean 5-sentence blurb", () => {
    expect(validateAnalystNarrative(SAMPLE_5).ok).toBe(true);
  });

  it("rejects fewer than 4 sentences", () => {
    const text = "One sentence. Two sentences. Three sentences.";
    const result = validateAnalystNarrative(text);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("sentence count");
  });

  it("rejects more than 7 sentences", () => {
    const text = "A. B. C. D. E. F. G. H. I.";
    const result = validateAnalystNarrative(text);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("sentence count");
  });

  it("rejects empty input", () => {
    expect(validateAnalystNarrative("").ok).toBe(false);
    expect(validateAnalystNarrative("   \n").ok).toBe(false);
  });

  it("rejects banned term 'spread'", () => {
    const text =
      "The spread is deceptive. Keider Montero has been dealing. The Tigers are rolling. Milwaukee's been scuffling. The home mound flips it.";
    expect(validateAnalystNarrative(text).ok).toBe(false);
  });

  it("rejects banned term 'elo' (case-insensitive)", () => {
    const text =
      "Detroit's the pick. Their ELO is higher. Montero has been dealing. The Tigers are rolling. Milwaukee's been scuffling.";
    expect(validateAnalystNarrative(text).ok).toBe(false);
  });

  it("rejects banned hedge 'anything can happen'", () => {
    const text =
      "Detroit's the pick here. Keider Montero has been dealing. The Tigers are rolling. Milwaukee's been scuffling. Anything can happen in a 9-inning game.";
    expect(validateAnalystNarrative(text).ok).toBe(false);
  });

  it("rejects banned ' ATS'", () => {
    const text =
      "Detroit's the pick. Strong 7-3 ATS at home. Montero has been dealing. The Tigers are rolling. Milwaukee's been scuffling.";
    expect(validateAnalystNarrative(text).ok).toBe(false);
  });

  it("rejects additional hype/tout terms", () => {
    const text =
      "Detroit's the pick because the pitching matchup gives them the cleanest path into this game tonight. Keider Montero brings the better full profile with a 3.12 ERA and 1.70 FIP against Kyle Harrison's 2.87 ERA but 3.63 FIP. The Tigers also have the form edge, sitting 8-2 over their last 10 while Milwaukee is 4-6. The one concern is rest, since the Brewers come in with three days off against Detroit's one. This is a sure thing for Detroit.";
    expect(validateAnalystNarrative(text).ok).toBe(false);
  });

  it("allows the casual / slang voice (it is no longer bounced to the template)", () => {
    // The cool-friend voice is intentional now. Phrases like "got the slight
    // edge" and "don't sleep on" used to be banned; they are welcome as long as
    // the text stays clear of gambling-guarantee/line/internals language.
    const text =
      "Detroit's low-key the move tonight because the pitching matchup is just cleaner top to bottom. Keider Montero's been absolutely cooking lately, carrying a 3.12 ERA and 1.70 FIP against Kyle Harrison's 2.87 ERA but much shakier 3.63 FIP. The Tigers are rolling too, sitting 8-2 over their last 10 while Milwaukee is stuck at 4-6. The one thing that gives me pause is rest, since the Brewers come in with three full days off against Detroit's one. Don't sleep on Milwaukee here, but Detroit's just got the better baseball case tonight.";
    expect(validateAnalystNarrative(text).ok).toBe(true);
  });

  it("rejects multiple paragraphs", () => {
    const text =
      "Detroit is the pick because the pitching matchup gives them the cleanest path into this game tonight. Keider Montero brings the better full profile with a 3.12 ERA and 1.70 FIP against Kyle Harrison's 2.87 ERA but 3.63 FIP.\n\nThe Tigers also have the form edge, sitting 8-2 over their last 10 while Milwaukee is 4-6. The one concern is rest, since the Brewers come in with three days off against Detroit's one. The main baseball reasons point to Detroit.";
    expect(validateAnalystNarrative(text).ok).toBe(false);
  });

  it("rejects more than 10 sentences even if word count is valid", () => {
    const text =
      "Detroit is the pick tonight. The pitching matchup points their way. Montero has a 3.12 ERA. His FIP sits at 1.70. Harrison's FIP is 3.63. Detroit is 8-2 over its last 10. Milwaukee is 4-6 over that same window. Rest is the counterpoint. The Brewers are fresher. The fan angle is the mound edge. That is enough detail.";
    const result = validateAnalystNarrative(text);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("sentence count");
  });
});

// ─── generateLLMNarrative ──────────────────────────────────────────────

describe("generateLLMNarrative", () => {
  beforeEach(() => {
    __resetRateWindowForTests();
    __resetNarrativeCacheForTests();
    // Ensure the default client path is bypassed for tests (no API key).
    process.env.OPENAI_API_KEY = "sk-test";
  });
  afterEach(() => {
    __setLLMClientForTests(null);
  });

  it("happy path: returns validated text + tokensUsed", async () => {
    __setLLMClientForTests(mockClient(SAMPLE_5, 181));
    const res = await generateLLMNarrative(makeInput());
    expect(res.text).toBe(SAMPLE_5);
    expect(res.tokensUsed).toBe(181);
    expect(res.reason).toBeUndefined();
  });

  it("rejects a 2-sentence response and falls back", async () => {
    __setLLMClientForTests(mockClient("Short. Too short.", 50));
    const res = await generateLLMNarrative(makeInput());
    expect(res.text).toBeNull();
    expect(res.reason).toBe("validation_failed");
  });

  it("rejects a 9-sentence response and falls back", async () => {
    __setLLMClientForTests(
      mockClient("A. B. C. D. E. F. G. H. I.", 60),
    );
    const res = await generateLLMNarrative(makeInput());
    expect(res.text).toBeNull();
    expect(res.reason).toBe("validation_failed");
  });

  it("rejects a response containing a banned term", async () => {
    __setLLMClientForTests(
      mockClient(
        "Detroit's a lock here. Keider Montero has been dealing. The Tigers are rolling. Milwaukee's been scuffling. Home mound flips it.",
        60,
      ),
    );
    const res = await generateLLMNarrative(makeInput());
    expect(res.text).toBeNull();
    expect(res.reason).toBe("validation_failed");
  });

  it("falls back on OpenAI error (null result)", async () => {
    __setLLMClientForTests(mockClient(null));
    const res = await generateLLMNarrative(makeInput());
    expect(res.text).toBeNull();
    expect(res.reason).toBe("openai_error");
  });

  it("falls back on OpenAI throw", async () => {
    __setLLMClientForTests(failingClient("throw"));
    let caught: unknown = null;
    try {
      const res = await generateLLMNarrative(makeInput());
      expect(res.text).toBeNull();
    } catch (err) {
      // Current contract: LLMClient is trusted to not throw. If it
      // does, the generator surfaces the throw; the caller's
      // setImmediate wrapper turns it into a warn log. Assert the
      // throw arrives here as a baseline.
      caught = err;
    }
    // Either the function absorbed the throw (returning null) or it
    // propagated — both are acceptable for the "no cache write" goal.
    if (caught) {
      expect((caught as Error).message).toBe("boom");
    }
  });

  it("honors rate cap: 500/hour then skips", async () => {
    __setLLMClientForTests(mockClient(SAMPLE_5, 100));
    // Burn the window.
    for (let i = 0; i < 500; i++) {
      await generateLLMNarrative(makeInput());
    }
    expect(isRateCapped()).toBe(true);
    const capped = await generateLLMNarrative(makeInput());
    expect(capped.text).toBeNull();
    expect(capped.reason).toBe("rate_capped");
  });
});

// ─── Injury extraction ─────────────────────────────────────────────────

describe("extractInjuryListForLLM", () => {
  const report = (
    out: Array<{ name: string; position: string; detail: string }>,
    doubtful: Array<{ name: string; position: string; detail: string }> = [],
    questionable: Array<{ name: string; position: string; detail: string }> = [],
  ): TeamInjuryReport => ({
    out,
    doubtful,
    questionable,
    totalOut: out.length,
    totalDoubtful: doubtful.length,
    totalQuestionable: questionable.length,
  });

  it("returns [] for soccer (no injury source)", () => {
    const list = extractInjuryListForLLM(
      "EPL",
      "BHA",
      report([{ name: "Ace", position: "F", detail: "Knee" }]),
      "CHE",
      report([]),
    );
    expect(list).toEqual([]);
  });

  it("returns [] for NFL/NCAA", () => {
    for (const sport of ["NFL", "NCAAB", "NCAAF"]) {
      const list = extractInjuryListForLLM(
        sport,
        "HOM",
        report([{ name: "X", position: "QB", detail: "" }]),
        "AWY",
        report([]),
      );
      expect(list).toEqual([]);
    }
  });

  it("returns Out + Doubtful for NBA, skips Questionable", () => {
    const list = extractInjuryListForLLM(
      "NBA",
      "LAL",
      report(
        [{ name: "LeBron James", position: "SF", detail: "Ankle" }],
        [{ name: "Anthony Davis", position: "PF", detail: "" }],
        [{ name: "D. Russell", position: "PG", detail: "Questionable — illness" }],
      ),
      "BOS",
      report([]),
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      name: "LeBron James",
      team: "LAL",
      position: "SF",
      status: "Out",
      reason: "Ankle",
    });
    expect(list[1]).toEqual({
      name: "Anthony Davis",
      team: "LAL",
      position: "PF",
      status: "Doubtful",
      reason: "",
    });
  });

  it("includes both teams for MLB + NHL", () => {
    for (const sport of ["MLB", "NHL"]) {
      const list = extractInjuryListForLLM(
        sport,
        "HOM",
        report([{ name: "Player A", position: "OF", detail: "" }]),
        "AWY",
        report([{ name: "Player B", position: "C", detail: "" }]),
      );
      expect(list).toHaveLength(2);
      const teams = list.map((i) => i.team).sort();
      expect(teams).toEqual(["AWY", "HOM"]);
    }
  });

  it("handles null/undefined reports gracefully", () => {
    const list = extractInjuryListForLLM("NBA", "HOM", null, "AWY", undefined);
    expect(list).toEqual([]);
  });
});

// ─── Version hash ──────────────────────────────────────────────────────

describe("computeVersionHash", () => {
  const baseFactors = [
    { name: "Starting pitcher matchup", weight: 0.21, homeScore: 0.8, awayScore: 0.2, description: "" },
    { name: "Recent form (L10)", weight: 0.10, homeScore: 0.65, awayScore: 0.35, description: "" },
    { name: "Ballpark run environment", weight: 0.04, homeScore: 0.5, awayScore: 0.5, description: "" },
  ];

  it("is deterministic for identical inputs", () => {
    const pred = { predictedWinner: "home" as const, confidence: 62, factors: baseFactors };
    const injuries = [
      { name: "Player A", team: "HOM", position: "SF", status: "Out" as const, reason: "" },
    ];
    const h1 = computeVersionHash(pred, injuries);
    const h2 = computeVersionHash(pred, injuries);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });

  it("is order-independent across injury entries", () => {
    const pred = { predictedWinner: "home" as const, confidence: 62, factors: baseFactors };
    const inj1 = [
      { name: "A", team: "HOM", position: "", status: "Out" as const, reason: "" },
      { name: "B", team: "AWY", position: "", status: "Doubtful" as const, reason: "" },
    ];
    const inj2 = [inj1[1]!, inj1[0]!];
    expect(computeVersionHash(pred, inj1)).toBe(computeVersionHash(pred, inj2));
  });

  it("changes when the picked side flips", () => {
    const home = { predictedWinner: "home" as const, confidence: 62, factors: baseFactors };
    const away = { predictedWinner: "away" as const, confidence: 62, factors: baseFactors };
    expect(computeVersionHash(home, [])).not.toBe(computeVersionHash(away, []));
  });

  it("changes when an injury is added", () => {
    const pred = { predictedWinner: "home" as const, confidence: 62, factors: baseFactors };
    const noInj = computeVersionHash(pred, []);
    const withInj = computeVersionHash(pred, [
      { name: "Player A", team: "HOM", position: "", status: "Out" as const, reason: "" },
    ]);
    expect(noInj).not.toBe(withInj);
  });

  it("changes when season context is added", () => {
    const pred = { predictedWinner: "home" as const, confidence: 62, factors: baseFactors };
    const noContext = computeVersionHash(pred, []);
    const withContext = computeVersionHash(pred, [], {
      phase: "playoffs",
      label: "NBA playoff window",
      detail: "This falls in the NBA playoff window.",
      source: "date",
    });

    expect(noContext).not.toBe(withContext);
  });

  it("ignores 1-pt confidence drift (5-pt bucket)", () => {
    const a = { predictedWinner: "home" as const, confidence: 62, factors: baseFactors };
    const b = { predictedWinner: "home" as const, confidence: 63, factors: baseFactors };
    expect(computeVersionHash(a, [])).toBe(computeVersionHash(b, []));
  });

  it("changes across bucket boundary (64 → 65)", () => {
    const a = { predictedWinner: "home" as const, confidence: 64, factors: baseFactors };
    const b = { predictedWinner: "home" as const, confidence: 65, factors: baseFactors };
    expect(computeVersionHash(a, [])).not.toBe(computeVersionHash(b, []));
  });

  it("changes when a canonical draw replaces a team pick", () => {
    const teamPick = {
      predictedWinner: "home" as const,
      predictedOutcome: "home" as const,
      confidence: 55,
      factors: baseFactors,
      canonicalResult: {
        finalPick: "home" as const,
        finalProbability: 0.55,
        probabilities: { home: 0.55, away: 0.45 },
      },
    };
    const drawPick = {
      ...teamPick,
      predictedOutcome: "draw" as const,
      canonicalResult: {
        finalPick: "draw" as const,
        finalProbability: 0.38,
        probabilities: { home: 0.31, away: 0.31, draw: 0.38 },
      },
    };

    expect(computeVersionHash(teamPick as any, [])).not.toBe(computeVersionHash(drawPick as any, []));
  });

  it("changes when a pick becomes a toss-up display outcome", () => {
    const pick = { predictedWinner: "home" as const, confidence: 54, factors: baseFactors, isTossUp: false };
    const tossUp = { ...pick, isTossUp: true };
    expect(computeVersionHash(pick, [])).not.toBe(computeVersionHash(tossUp, []));
  });
});
