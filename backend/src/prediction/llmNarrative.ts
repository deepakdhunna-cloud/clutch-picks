/**
 * LLM-generated analyst narrative.
 *
 * Called from background-only enrichment paths — never synchronously from
 * /api/games. Builds a structured prompt from the prediction context,
 * hits OpenAI (low-cost narrative model, 8s timeout), validates the response for
 * sentence count + banned terms, and returns the text on success.
 *
 * Failures always return null. The caller serves the deterministic
 * narrative in that case.
 *
 * A 500-call-per-hour cap (sliding window) skips OpenAI entirely when
 * we're overloaded; the deterministic narrative remains live.
 */

import type { FactorContribution } from "./types";
import type { TeamInjuryReport } from "../lib/espnStats";
import type { NarrativeSeasonContext } from "./seasonContext";

// ─── Types ─────────────────────────────────────────────────────────────

export type ConfidenceTier = "low" | "moderate" | "strong";

export interface InjuryListEntry {
  /** Player name */
  name: string;
  /** Team abbreviation (e.g. "LAL") */
  team: string;
  /** Position code (e.g. "SF", "SP", "OF"). Empty string if unknown. */
  position: string;
  /** "Out" or "Doubtful". Day-To-Day / Questionable are intentionally excluded upstream. */
  status: "Out" | "Doubtful";
  /** Optional free-text reason (injury type). Empty string when none. */
  reason: string;
}

export interface LLMNarrativeInput {
  sport: string;
  awayTeam: { abbr: string; name: string };
  homeTeam: { abbr: string; name: string };
  /** Full team name of the picked side, e.g. "Detroit Tigers". Null = pickem. */
  pickTeamName: string | null;
  /** Confidence bucket — never pass the raw percentage into the prompt. */
  confidenceTier: ConfidenceTier;
  /** Lead + up-to-2 supporting factors favoring the pick, already filtered/sorted. */
  topFactors: FactorContribution[];
  /** Optional counterpoint factor (the side opposing the pick). */
  counterpoint: FactorContribution | null;
  /** Out/Doubtful only. Empty array → prompt omits the injury section. */
  injuries: InjuryListEntry[];
  seasonContext?: NarrativeSeasonContext | null;
}

export interface LLMNarrativeResult {
  text: string | null;
  tokensUsed: number;
  /** Reason for a null text — for logging. */
  reason?:
    | "disabled"
    | "validation_failed"
    | "empty_response"
    | "openai_error"
    | "timeout"
    | "rate_capped"
    | "no_api_key";
}

// ─── Injury extraction ────────────────────────────────────────────────

// Sports with a live injury feed wired through ESPN. Other sports
// (EPL/MLS/UCL/NFL/NCAAB/NCAAF) have no injury source right now; we
// omit the injury block entirely rather than fabricate or claim "no
// injuries reported."
const INJURY_AVAILABLE_SPORTS = new Set(["NBA", "MLB", "NHL"]);

/**
 * Extract the Out/Doubtful roster for the LLM prompt. Questionable /
 * Day-To-Day entries are filtered out by the injury report shape being
 * (out, doubtful, questionable) — we only consume the first two.
 *
 * Returns [] for sports without an injury feed, so the caller's prompt
 * omits the injury section rather than saying "no injuries reported."
 */
export function extractInjuryListForLLM(
  sport: string,
  homeTeamAbbr: string,
  homeInjuries: TeamInjuryReport | null | undefined,
  awayTeamAbbr: string,
  awayInjuries: TeamInjuryReport | null | undefined,
): InjuryListEntry[] {
  if (!INJURY_AVAILABLE_SPORTS.has(sport)) return [];
  const out: InjuryListEntry[] = [];
  const pushAll = (
    team: string,
    report: TeamInjuryReport | null | undefined,
  ): void => {
    if (!report) return;
    for (const p of report.out) {
      out.push({
        name: p.name,
        team,
        position: p.position ?? "",
        status: "Out",
        reason: p.detail ?? "",
      });
    }
    for (const p of report.doubtful) {
      out.push({
        name: p.name,
        team,
        position: p.position ?? "",
        status: "Doubtful",
        reason: p.detail ?? "",
      });
    }
  };
  pushAll(homeTeamAbbr, homeInjuries);
  pushAll(awayTeamAbbr, awayInjuries);
  return out;
}

// ─── Prompt construction ───────────────────────────────────────────────

export const ANALYST_SYSTEM_PROMPT = `You are a professional sports analyst writing for a paid prediction product. Explain why the listed team is the pick in 80-150 words and 4-6 sentences.

VOICE
Clear, direct, and specific. Confident, but never hypey. No slang, no preachiness, no clichés, no gambling tout energy. The tone should feel like a serious analyst explaining a matchup to both beginners and experts.

MUST INCLUDE
- The picked team, unless the input says pick'em.
- A verbal version of how the pick was made: the top factor, expected-score projection when provided, injury/availability notes when provided, schedule/rest, form, ratings, and the best risk flag.
- 2-3 supporting reasons from the factor data when available. Do not reduce the pick to only "home field" or "recent form" if other factors are present.
- A meaningful counterpoint or risk when one is provided.
- Out/Doubtful injuries when they are provided, especially if they affect the pick.
- Season context when provided: playoff, tournament, stretch-run, bowl, or late-season games should sound different from ordinary regular-season games.
- Why this game is interesting from a fan perspective, using only the provided matchup, factors, injury list, or season context.

STRUCTURAL VARIETY (CRITICAL)
Every analysis must open differently and follow a different shape. Do NOT settle into a formulaic intro. Vary which angle leads: sometimes the headline factor, sometimes a specific stat, sometimes the highest-leverage risk, sometimes a matchup-specific detail, sometimes a player. Pick the angle that's most useful for THIS game and lead with it — don't default to the same template.

Example opening *patterns* (mimic the shape, not the words):
- Lead with the team and the concrete edge.
- Lead with the deciding factor.
- Lead with a stat from the input.
- Lead with the matchup tension.
- Lead with the highest-leverage risk.

FORBIDDEN OPENERS (do not start with any of these, in any casing):
"Alright", "So,", "Let's break", "Here's the deal", "Buckle up", "Listen", "Look,", "Okay so", "Real talk".

SPECIFICITY
Reference at least one concrete, verifiable detail from the input — a record, a stat, a player name, or the venue. Don't lean on generic phrasing like "they've been rolling" or "scuffling a bit"; ground every claim in something real from the prompt.
If the scoring projection is nearly level but the pick has a clear lean, explain that average scoring can be tight while the win lean comes from the whole factor stack.

NEVER MENTION
Spread, over/under, Vegas lines, numeric Elo values, the algorithm, the model, or generic hedges like "anything can happen." Do not use hype/tout terms: lock, guaranteed, can't lose, can’t lose, easy money, slam dunk, smash, dominant, sharp play, hammer, sure thing.

DO NOT USE THESE PHRASES
"get the call", "usable edges", "power-rating case", "power-rating setup", "start here", "gets the nod", "got the edge", "don't sleep", "rather grim", "lighting up".

Return one paragraph only. End on the last real point — do not tack on a confidence call at the end.`;

export function mapConfidenceTier(confidencePct: number): ConfidenceTier {
  if (confidencePct < 55) return "low";
  if (confidencePct < 65) return "moderate";
  return "strong";
}

export function buildUserPrompt(input: LLMNarrativeInput): string {
  const lines: string[] = [];
  lines.push(`Sport: ${input.sport}`);
  lines.push(
    `Matchup: ${input.awayTeam.abbr} ${input.awayTeam.name} @ ${input.homeTeam.abbr} ${input.homeTeam.name}`,
  );
  lines.push(`Pick: ${input.pickTeamName ?? "no edge (pick'em)"}`);
  lines.push(`Confidence: ${input.confidenceTier}`);
  if (input.seasonContext) {
    lines.push(
      `Season context: ${input.seasonContext.label} — ${input.seasonContext.detail}`,
    );
  }
  lines.push("");
  lines.push("Top factors favoring the pick, in priority order:");
  for (const f of input.topFactors) {
    lines.push(`- ${f.label}: ${f.evidence}`);
  }
  lines.push("");
  if (input.counterpoint) {
    lines.push("Counterpoint factor:");
    lines.push(`- ${input.counterpoint.label}: ${input.counterpoint.evidence}`);
    lines.push("");
  }
  if (input.injuries.length > 0) {
    lines.push("Injuries (Out/Doubtful only, skip Day-To-Day):");
    for (const inj of input.injuries) {
      const posPart = inj.position ? `, ${inj.position}` : "";
      const reasonPart = inj.reason ? ` — ${inj.reason}` : "";
      lines.push(
        `- ${inj.name} (${inj.team}${posPart}): ${inj.status}${reasonPart}`,
      );
    }
    lines.push("");
  }
  lines.push("Write the 80-150 word analysis now.");
  return lines.join("\n");
}

// ─── Validation ────────────────────────────────────────────────────────

const BANNED_SUBSTRINGS = [
  "spread",
  "over/under",
  "vegas",
  "elo",
  "the model",
  "the algorithm",
  "according to our",
  "anything can happen",
  "lock",
  "guaranteed",
  "can't lose",
  "can’t lose",
  "easy money",
  "slam dunk",
  "smash",
  "dominant",
  "sharp play",
  "hammer",
  "sure thing",
  "cover ",
  " ats",
  "alright, so",
  "let's break",
  "here's the deal",
  "buckle up",
  "get the call",
  "usable edges",
  "power-rating case",
  "power-rating setup",
  "start here",
  "gets the nod",
  "get the nod",
  "got the edge",
  "got a slight edge",
  "got the slight edge",
  "don't sleep",
  "don’t sleep",
  "rather grim",
  "lighting up",
];

function countSentences(text: string): number {
  // A sentence ends with . ? or ! followed by whitespace or end-of-string.
  // We count terminators rather than splitting so trailing whitespace and
  // mid-sentence punctuation (e.g. "Dr.") don't corrupt the count.
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const matches = trimmed.match(/[.!?](?=\s|$)/g);
  return matches?.length ?? 0;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateAnalystNarrative(text: string): ValidationResult {
  if (!text || text.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (/\n/.test(text.trim())) {
    return { ok: false, reason: "multiple paragraphs" };
  }
  const sentences = countSentences(text);
  if (sentences < 4 || sentences > 7) {
    return { ok: false, reason: `sentence count ${sentences} outside [4,7]` };
  }
  const words = countWords(text);
  if (words < 80 || words > 150) {
    return { ok: false, reason: `word count ${words} outside [80,150]` };
  }
  const lower = text.toLowerCase();
  for (const banned of BANNED_SUBSTRINGS) {
    if (lower.includes(banned)) {
      return { ok: false, reason: `contains banned substring: "${banned.trim()}"` };
    }
  }
  return { ok: true };
}

// ─── Rate cap (sliding 1h window) ──────────────────────────────────────

const RATE_CAP_PER_HOUR = 500;
const RATE_WINDOW_MS = 60 * 60 * 1000;
let rateTimestamps: number[] = [];

function pruneRateWindow(now: number): void {
  const cutoff = now - RATE_WINDOW_MS;
  // Drop timestamps older than the window in one pass.
  let i = 0;
  while (i < rateTimestamps.length && rateTimestamps[i]! < cutoff) i++;
  if (i > 0) rateTimestamps = rateTimestamps.slice(i);
}

export function isRateCapped(): boolean {
  pruneRateWindow(Date.now());
  return rateTimestamps.length >= RATE_CAP_PER_HOUR;
}

function recordRateCall(): void {
  rateTimestamps.push(Date.now());
}

export function __resetRateWindowForTests(): void {
  rateTimestamps = [];
}

// ─── OpenAI client (overridable for tests) ─────────────────────────────

export interface LLMClient {
  complete(args: {
    system: string;
    user: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
  }): Promise<{ text: string; tokensUsed: number } | null>;
}

const defaultOpenAIClient: LLMClient = {
  async complete({ system, user, model, temperature, maxTokens, timeoutMs }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) return null;
      return {
        text,
        tokensUsed: data.usage?.total_tokens ?? 0,
      };
    } catch {
      return null;
    }
  },
};

let activeClient: LLMClient = defaultOpenAIClient;

export function __setLLMClientForTests(client: LLMClient | null): void {
  activeClient = client ?? defaultOpenAIClient;
}

// ─── Public entry point ────────────────────────────────────────────────

const MODEL = process.env.OPENAI_NARRATIVE_MODEL ?? "gpt-4o-mini";
const TEMPERATURE = 0.7;
const MAX_TOKENS = 250;
const TIMEOUT_MS = 8000;

function llmNarrativesEnabled(): boolean {
  return process.env.ENABLE_LLM_NARRATIVES === "true" || activeClient !== defaultOpenAIClient;
}

/**
 * Call OpenAI, validate, and return {text, tokensUsed}. Returns
 * text=null with a reason on any failure (no API key, rate cap hit,
 * timeout, validation fail). Callers serve the deterministic narrative
 * on null.
 */
export async function generateLLMNarrative(
  input: LLMNarrativeInput,
): Promise<LLMNarrativeResult> {
  if (!llmNarrativesEnabled()) {
    return { text: null, tokensUsed: 0, reason: "disabled" };
  }
  if (!process.env.OPENAI_API_KEY && activeClient === defaultOpenAIClient) {
    return { text: null, tokensUsed: 0, reason: "no_api_key" };
  }
  if (isRateCapped()) {
    return { text: null, tokensUsed: 0, reason: "rate_capped" };
  }

  const system = ANALYST_SYSTEM_PROMPT;
  const user = buildUserPrompt(input);

  recordRateCall();

  const raw = await activeClient.complete({
    system,
    user,
    model: MODEL,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
  });

  if (!raw) {
    return { text: null, tokensUsed: 0, reason: "openai_error" };
  }
  if (!raw.text) {
    return { text: null, tokensUsed: raw.tokensUsed, reason: "empty_response" };
  }
  const check = validateAnalystNarrative(raw.text);
  if (!check.ok) {
    return {
      text: null,
      tokensUsed: raw.tokensUsed,
      reason: "validation_failed",
    };
  }
  return { text: raw.text, tokensUsed: raw.tokensUsed };
}
