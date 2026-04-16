/**
 * LLM-powered player-availability extractor.
 *
 * Given a RawNewsItem (article / tweet), asks Anthropic Haiku to extract
 * structured availability signals for every player mentioned. Returns
 * zero or more ExtractedSignals per item; invalid entries (hallucinated
 * players, unknown team abbreviations, out-of-range confidence) are
 * dropped rather than passed downstream.
 *
 * Guardrails:
 *   - Feature-gated on ANTHROPIC_API_KEY (unset → `[]` + startup warn)
 *   - Per-call 15s timeout, graceful null on error
 *   - Strict JSON-only parsing: any non-array response returns []
 *   - Field-level validation against the PLAYER_STATUS / SEVERITY enums
 *     and the NBA team directory (lib/ingestion/nbaTeams.ts). A bad
 *     field on a single player doesn't discard the whole response —
 *     only that player is dropped.
 *
 * Cost: we cap the orchestrator at 50 calls per 2-min cycle. Each call
 * is ~300 input + ~200 output tokens on Haiku ≈ $0.0003 apiece, so a
 * hard cap of 50 × 48 cycles/day ≈ $0.72/day worst case.
 */

import {
  PLAYER_STATUS_VALUES,
  SEVERITY_VALUES,
  type ExtractedSignal,
  type PlayerStatus,
  type RawNewsItem,
  type Severity,
} from "./types";
import { NBA_ABBR_LIST, isValidNBAAbbreviation } from "./nbaTeams";

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 500;

const SYSTEM_PROMPT = `You are a sports injury/availability analyst. Extract ONLY factual player availability signals from the text below.

For each player mentioned, output an object with:
- playerName: full name
- teamAbbreviation: 3-letter NBA code (one of: ${NBA_ABBR_LIST.join(", ")})
- status: one of [out, doubtful, questionable, probable, available, minutes_restriction, game_time_decision]
- confidence: 0.0 to 1.0 — your confidence in this extraction
- severity: one of [critical, moderate, minor]  (critical = top-3 player on team, moderate = rotation player, minor = end of bench)
- reasoning: one-sentence explanation
- gameImpactElo: estimated Elo impact if this player misses the game, negative integer in [-120, 0]  (-120 = MVP-level, -60 = starter, -20 = rotation)

RULES:
1. Only extract CONCRETE availability information. Ignore speculation, trade rumors, historical stats.
2. "Expected to play" → status "probable", not "available".
3. "Game-time decision" → status "game_time_decision", NOT "questionable".
4. If you cannot determine a concrete status, DO NOT include that player.
5. Return a valid JSON array. If no signals found, return [].

Respond with ONLY a JSON array. No preamble, no markdown, no code fences.`;

// ─── Response shape ────────────────────────────────────────────────────────

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
}

interface RawExtraction {
  playerName?: unknown;
  teamAbbreviation?: unknown;
  status?: unknown;
  confidence?: unknown;
  severity?: unknown;
  reasoning?: unknown;
  gameImpactElo?: unknown;
}

// ─── Startup gate ───────────────────────────────────────────────────────────

let startupWarnLogged = false;
function getApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    if (!startupWarnLogged) {
      console.warn(
        "[ingestion] ANTHROPIC_API_KEY not set — LLM extraction disabled, ingestion will collect but not process",
      );
      startupWarnLogged = true;
    }
    return null;
  }
  return key;
}

// ─── Validation ─────────────────────────────────────────────────────────────

export function validateExtractions(
  raw: unknown,
  sourceLine: string,
  sourceCredibility: number,
): ExtractedSignal[] {
  if (!Array.isArray(raw)) return [];

  const out: ExtractedSignal[] = [];
  for (const entry of raw) {
    const candidate = entry as RawExtraction;

    const playerName = typeof candidate.playerName === "string" ? candidate.playerName.trim() : "";
    if (!playerName) continue;

    const teamAbbrRaw = typeof candidate.teamAbbreviation === "string" ? candidate.teamAbbreviation.toUpperCase() : "";
    if (!isValidNBAAbbreviation(teamAbbrRaw)) continue;

    const status = typeof candidate.status === "string" ? candidate.status : "";
    if (!(PLAYER_STATUS_VALUES as readonly string[]).includes(status)) continue;

    const severity = typeof candidate.severity === "string" ? candidate.severity : "";
    if (!(SEVERITY_VALUES as readonly string[]).includes(severity)) continue;

    const confidenceNum = Number(candidate.confidence);
    if (!Number.isFinite(confidenceNum) || confidenceNum < 0 || confidenceNum > 1) continue;

    const gameImpactRaw = Number(candidate.gameImpactElo);
    if (!Number.isFinite(gameImpactRaw)) continue;
    // Clamp into [-120, 0] — the prompt says negative integer in that range.
    const gameImpactElo = Math.max(-120, Math.min(0, Math.round(gameImpactRaw)));

    const reasoning = typeof candidate.reasoning === "string" ? candidate.reasoning.slice(0, 500) : "";

    out.push({
      playerName,
      teamAbbreviation: teamAbbrRaw,
      status: status as PlayerStatus,
      severity: severity as Severity,
      confidence: confidenceNum,
      sourceCredibility,
      gameImpactElo,
      reasoning,
      source: sourceLine.slice(0, 500),
    });
  }
  return out;
}

// ─── Anthropic call ─────────────────────────────────────────────────────────

async function callHaiku(apiKey: string, userPrompt: string): Promise<string | null> {
  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.warn(`[ingestion] Haiku HTTP ${res.status} for extraction call`);
      return null;
    }
    const body = (await res.json()) as AnthropicResponse;
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    return text || null;
  } catch (err) {
    console.warn(
      "[ingestion] Haiku call failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Extract structured availability signals from a single news item.
 * Returns [] on: missing API key, HTTP error, invalid JSON, empty response.
 */
export async function extractSignals(item: RawNewsItem): Promise<ExtractedSignal[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const userPrompt = `Source: ${item.sourceName} (credibility: ${item.credibility.toFixed(2)})\nText: ${item.title}\n${item.content}`;
  const rawText = await callHaiku(apiKey, userPrompt);
  if (!rawText) return [];

  // Haiku occasionally still wraps JSON in code fences despite the prompt.
  // Strip the fence if present, then parse.
  const trimmed = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    console.warn(`[ingestion] Haiku returned non-JSON for ${item.url}`);
    return [];
  }

  const sourceLine = item.title || item.content.slice(0, 200);
  return validateExtractions(parsed, sourceLine, item.credibility);
}
