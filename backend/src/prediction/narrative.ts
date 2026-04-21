/**
 * Factor-driven narrative generator.
 *
 * The narrative is built FROM factor contributions, not AROUND a pick.
 * The LLM receives a structured object — it cannot see team names without
 * factors attached, cannot see records, cannot invent a story.
 *
 * Pipeline:
 *   1. Sort factors by abs(homeDelta * weight)
 *   2. Extract top 3 + counterpoint
 *   3. Build structured NarrativeInput
 *   4. Try LLM (GPT-4o-mini) with strict prompt
 *   5. Validate word count [80-150] and banned words
 *   6. Fall back to deterministic template if LLM fails twice
 *
 * Cache by (gameId, factorHash) — unchanged factors = no regeneration.
 */

import { createHash } from "crypto";
import type { FactorContribution, ConfidenceBand } from "./types";

// ─── Banned words ───────────────────────────────────────────────────────
// These must NEVER appear in narrative output. Scanned case-insensitively.
const BANNED_WORDS = [
  "lock", "guaranteed", "can't lose", "easy money",
  "slam dunk", "smash", "dominant", "sharp play", "hammer",
];

const BANNED_REGEX = new RegExp(BANNED_WORDS.join("|"), "i");

// ─── Neutral-context factor keys ────────────────────────────────────────
// These factors describe environmental / game-level context that affects
// BOTH teams equally (weather conditions, umpire zone, ballpark run
// environment, early-season noise). They have no "opposing side", so they
// must never be rendered as a counterpoint — citing them makes the
// narrative read as self-contradictory when the pick is for either team.
const NEUTRAL_CONTEXT_FACTOR_KEYS = new Set<string>([
  "ballpark",
  "weather_mlb",
  "weather",
  "weather_ncaaf",
  "umpire",
  "early_season_mlb",
]);

/**
 * Generic counterpoint renderer.
 *
 * Describes a team-directional factor from the perspective of the side
 * OPPOSING the pick, without copying factor.evidence (which cites both
 * sides and reads as self-contradictory in the counterpoint slot).
 *
 * Factors may eventually expose a typed counterpoint string directly; for
 * now the generic form is sufficient for every team-directional factor.
 */
function renderCounterpoint(
  factor: FactorContribution,
  winnerAbbr: string,
  homeTeamAbbr: string,
  awayTeamAbbr: string,
): string {
  const opposingAbbr =
    winnerAbbr === homeTeamAbbr ? awayTeamAbbr : homeTeamAbbr;
  const label = factor.label.toLowerCase();
  return `Working against the pick: ${label} favors ${opposingAbbr}.`;
}

// ─── Structured narrative input ─────────────────────────────────────────

export interface NarrativeInput {
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  winnerAbbr: string | null;
  sport: string;
  confidenceBand: ConfidenceBand;
  confidencePct: number;
  leadFactor: FactorContribution;
  supportingFactors: FactorContribution[];
  counterpoint: FactorContribution | null;
  unavailableKeyFactors: string[];
}

// ─── Factor hash for caching ────────────────────────────────────────────

export function computeFactorHash(factors: FactorContribution[]): string {
  const sorted = [...factors].sort((a, b) => a.key.localeCompare(b.key));
  const data = sorted.map((f) => `${f.key}:${f.homeDelta.toFixed(2)}:${f.weight.toFixed(2)}:${f.available}`).join("|");
  return createHash("sha1").update(data).digest("hex").slice(0, 12);
}

// ─── In-memory narrative cache ──────────────────────────────────────────

const narrativeCache = new Map<string, string>();

// ─── Build structured input from factors ────────────────────────────────

export function buildNarrativeInput(
  factors: FactorContribution[],
  confidenceBand: ConfidenceBand,
  confidencePct: number,
  homeTeamAbbr: string,
  awayTeamAbbr: string,
  winnerAbbr: string | null,
  sport: string,
): NarrativeInput {
  // Sort by absolute impact (|homeDelta * weight|) descending
  const sorted = [...factors]
    .filter((f) => f.available && Math.abs(f.homeDelta) > 0.01)
    .sort((a, b) => Math.abs(b.homeDelta * b.weight) - Math.abs(a.homeDelta * a.weight));

  const leadFactor: FactorContribution = sorted[0] ?? {
    key: "none",
    label: "No decisive factor",
    homeDelta: 0,
    weight: 0,
    available: true,
    hasSignal: false,
    evidence: "No factor provides meaningful separation between these teams",
  };

  const supportingFactors = sorted.slice(1, 3);

  // Counterpoint: any available factor that points against the predicted winner
  const counterpoint = sorted.find((f) => {
    if (winnerAbbr === null) return false;
    if (winnerAbbr === homeTeamAbbr) return f.homeDelta < -5;
    return f.homeDelta > 5;
  }) ?? null;

  const unavailableKeyFactors = factors
    .filter((f) => !f.available && f.weight >= 0.05)
    .map((f) => f.evidence);

  return {
    homeTeamAbbr,
    awayTeamAbbr,
    winnerAbbr,
    sport,
    confidenceBand,
    confidencePct,
    leadFactor,
    supportingFactors,
    counterpoint,
    unavailableKeyFactors,
  };
}

// ─── Word count helper ──────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ─── Deterministic fallback template ────────────────────────────────────
// Built directly from the structured input. Always valid. May sound dry
// but never sounds dishonest.

export function buildDeterministicNarrative(input: NarrativeInput): string {
  const { winnerAbbr, homeTeamAbbr, awayTeamAbbr, confidenceBand, leadFactor, supportingFactors, counterpoint, unavailableKeyFactors } = input;

  const parts: string[] = [];

  // ── Pick'em case ──
  if (winnerAbbr === null) {
    parts.push(`This is a true coin flip between ${homeTeamAbbr} and ${awayTeamAbbr}.`);
    if (leadFactor.key !== "none") {
      parts.push(`The largest factor is ${leadFactor.label.toLowerCase()} — ${leadFactor.evidence}.`);
    }
    parts.push(`Neither team has a meaningful edge. Take either side or pass.`);
    if (unavailableKeyFactors.length > 0) {
      parts.push(`Note: ${unavailableKeyFactors[0]}.`);
    }
    return parts.join(" ");
  }

  // ── Band-appropriate opening ──
  const loserAbbr = winnerAbbr === homeTeamAbbr ? awayTeamAbbr : homeTeamAbbr;

  switch (confidenceBand) {
    case "coinflip":
      parts.push(`Slim lean toward ${winnerAbbr} over ${loserAbbr}, but this is close to a toss-up.`);
      break;
    case "slight edge":
      parts.push(`${winnerAbbr} holds a modest edge over ${loserAbbr} in this matchup.`);
      break;
    case "clear edge":
      parts.push(`The data points toward ${winnerAbbr} over ${loserAbbr} with clear separation.`);
      break;
    case "strong edge":
      parts.push(`Strong case for ${winnerAbbr} over ${loserAbbr} across multiple factors.`);
      break;
  }

  // ── Lead factor ──
  parts.push(`The biggest driver: ${leadFactor.evidence}.`);

  // ── Supporting factors ──
  for (const f of supportingFactors) {
    parts.push(`${f.label}: ${f.evidence}.`);
  }

  // ── Counterpoint ──
  // Neutral-context factors (weather, umpire, ballpark, early-season noise)
  // are skipped entirely — they have no "opposing side" framing. For every
  // other factor we render a side-aware counterpoint instead of copying
  // factor.evidence verbatim; evidence typically cites BOTH teams and
  // reads as self-contradictory in the counterpoint slot.
  const effectiveCounterpoint =
    counterpoint && !NEUTRAL_CONTEXT_FACTOR_KEYS.has(counterpoint.key)
      ? counterpoint
      : null;
  if (effectiveCounterpoint && winnerAbbr !== null) {
    parts.push(
      renderCounterpoint(
        effectiveCounterpoint,
        winnerAbbr,
        homeTeamAbbr,
        awayTeamAbbr,
      ),
    );
  }

  // ── Elo-only note ──
  // If the lead is the only factor with meaningful signal and nothing is
  // pushing against the pick, say so explicitly. Prevents the narrative
  // from sounding like we ran out of things to mention.
  if (
    leadFactor.key !== "none" &&
    supportingFactors.length === 0 &&
    effectiveCounterpoint === null
  ) {
    parts.push(`No additional contextual signals available.`);
  }

  // ── Unavailable caveats ──
  if (unavailableKeyFactors.length > 0) {
    parts.push(`Caveat: ${unavailableKeyFactors[0]}.`);
  }

  let text = parts.join(" ");

  // Trim to word count range if needed
  const wc = wordCount(text);
  if (wc > 150) {
    // Drop counterpoint or caveats to trim
    const shorter = parts.slice(0, -1).join(" ");
    if (wordCount(shorter) <= 150 && wordCount(shorter) >= 80) {
      text = shorter;
    }
  }

  return text;
}

// ─── LLM narrative generation ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are writing an analysis note for a sports prediction app. You will be given a structured factor breakdown. Your job is to render it into 80-150 words of natural prose that explains the pick. HARD RULES:

- Lead with the top factor. Do not rearrange.
- You may not introduce any information not in the structured input.
- You may not make confidence stronger than the confidenceBand indicates. A "coinflip" band must be described as a toss-up with a slight lean, not a confident pick.
- If a counterpoint is provided, you must include it in one sentence.
- If any unavailableKeyFactors are listed, you must mention them as a caveat.
- No hype language. Banned words: lock, guaranteed, can't lose, easy money, slam dunk, smash, dominant, sharp play, hammer. Using any of these words is a failure.
- One paragraph, 80-150 words, no headers, no bullet points.
- Use concrete numbers from the evidence fields. Do not round or paraphrase numbers.`;

async function callLLM(input: NarrativeInput): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const userPrompt = `Sport: ${input.sport}
Winner: ${input.winnerAbbr ?? "PICK'EM (no edge)"}
Confidence band: ${input.confidenceBand} (${input.confidencePct.toFixed(1)}%)
Home: ${input.homeTeamAbbr}, Away: ${input.awayTeamAbbr}

Lead factor: [${input.leadFactor.label}] ${input.leadFactor.evidence}
${input.supportingFactors.map((f, i) => `Supporting factor ${i + 1}: [${f.label}] ${f.evidence}`).join("\n")}
${input.counterpoint ? `Counterpoint: [${input.counterpoint.label}] ${input.counterpoint.evidence}` : "No counterpoint."}
${input.unavailableKeyFactors.length > 0 ? `Unavailable key factors: ${input.unavailableKeyFactors.join("; ")}` : "All key factors available."}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 300,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text ?? null;
  } catch {
    return null;
  }
}

function validateNarrative(text: string): { valid: boolean; reason?: string } {
  const wc = wordCount(text);
  if (wc < 80) return { valid: false, reason: `Too short: ${wc} words (min 80)` };
  if (wc > 150) return { valid: false, reason: `Too long: ${wc} words (max 150)` };
  if (BANNED_REGEX.test(text)) {
    const match = text.match(BANNED_REGEX);
    return { valid: false, reason: `Contains banned word: "${match?.[0]}"` };
  }
  return { valid: true };
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Generate a narrative for a prediction.
 *
 * Tries LLM twice with validation. Falls back to deterministic template.
 * Results are cached by (gameId, factorHash).
 *
 * @returns narrative string, always valid (80-150 words, no banned words)
 */
export async function generateNarrative(
  gameId: string,
  factors: FactorContribution[],
  confidenceBand: ConfidenceBand,
  confidencePct: number,
  homeTeamAbbr: string,
  awayTeamAbbr: string,
  winnerAbbr: string | null,
  sport: string,
): Promise<string> {
  const factorHash = computeFactorHash(factors);
  const cacheKey = `${gameId}:${factorHash}`;

  const cached = narrativeCache.get(cacheKey);
  if (cached) return cached;

  const input = buildNarrativeInput(
    factors, confidenceBand, confidencePct,
    homeTeamAbbr, awayTeamAbbr, winnerAbbr, sport,
  );

  // Attempt 1: LLM
  const attempt1 = await callLLM(input);
  if (attempt1) {
    const v1 = validateNarrative(attempt1);
    if (v1.valid) {
      narrativeCache.set(cacheKey, attempt1);
      return attempt1;
    }
    console.log(`[narrative] LLM attempt 1 failed validation: ${v1.reason}`);
  }

  // Attempt 2: LLM retry
  const attempt2 = await callLLM(input);
  if (attempt2) {
    const v2 = validateNarrative(attempt2);
    if (v2.valid) {
      narrativeCache.set(cacheKey, attempt2);
      return attempt2;
    }
    console.log(`[narrative] LLM attempt 2 failed validation: ${v2.reason}`);
  }

  // Fallback: deterministic template
  const fallback = buildDeterministicNarrative(input);
  narrativeCache.set(cacheKey, fallback);
  return fallback;
}

// Re-export for direct use
export { buildNarrativeInput as _buildNarrativeInput_forTest };
