/**
 * LLM-generated analyst narrative.
 *
 * Called from background-only enrichment paths — never synchronously from
 * /api/games. Builds a structured prompt from the prediction context,
 * hits OpenAI (gpt-4o-mini, 8s timeout), validates the response for
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
}

export interface LLMNarrativeResult {
  text: string | null;
  tokensUsed: number;
  /** Reason for a null text — for logging. */
  reason?:
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

export const ANALYST_SYSTEM_PROMPT = `You are a sports analyst who talks like a knowledgeable friend at a bar. You explain why a prediction model picked a team in 5-6 sentences. Be direct and specific to the game. Contractions OK. Tone is a mix of casual ("dealing", "rolling", "scuffling") and informed. NEVER mention: spread, over/under, Vegas lines, numeric Elo values, the algorithm, or generic hedges like "anything can happen." End on the last real point — do not add a confidence call at the end.`;

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
  lines.push("");
  lines.push("Top factors favoring the pick:");
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
  lines.push("Write the 5-6 sentence analysis now.");
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
  "cover ",
  " ats",
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

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateAnalystNarrative(text: string): ValidationResult {
  if (!text || text.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  const sentences = countSentences(text);
  if (sentences < 4 || sentences > 7) {
    return { ok: false, reason: `sentence count ${sentences} outside [4,7]` };
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

const MODEL = "gpt-4o-mini";
const TEMPERATURE = 0.7;
const MAX_TOKENS = 250;
const TIMEOUT_MS = 8000;

/**
 * Call OpenAI, validate, and return {text, tokensUsed}. Returns
 * text=null with a reason on any failure (no API key, rate cap hit,
 * timeout, validation fail). Callers serve the deterministic narrative
 * on null.
 */
export async function generateLLMNarrative(
  input: LLMNarrativeInput,
): Promise<LLMNarrativeResult> {
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
