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
import type { NarrativeSeasonContext } from "./seasonContext";

// ─── Banned words ───────────────────────────────────────────────────────
// These must NEVER appear in narrative output. Scanned case-insensitively.
const BANNED_WORDS = [
  "lock", "guaranteed", "can't lose", "easy money",
  "slam dunk", "smash", "dominant", "sharp play", "hammer",
  "sure thing", "can’t lose",
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

// ─── Structured narrative input ─────────────────────────────────────────

export interface NarrativeInput {
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  homeTeamName?: string;
  awayTeamName?: string;
  winnerAbbr: string | null;
  sport: string;
  confidenceBand: ConfidenceBand;
  confidencePct: number;
  seasonContext: NarrativeSeasonContext | null;
  leadFactor: FactorContribution;
  supportingFactors: FactorContribution[];
  counterpoint: FactorContribution | null;
  injuries: NarrativeInjury[];
  unavailableKeyFactors: string[];
}

export interface NarrativeInjury {
  name: string;
  team: string;
  position: string;
  status: "Out" | "Doubtful";
  reason: string;
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
  injuries: NarrativeInjury[] = [],
  seasonContext: NarrativeSeasonContext | null = null,
  homeTeamName?: string,
  awayTeamName?: string,
): NarrativeInput {
  // Sort by absolute impact (|homeDelta * weight|) descending
  const sorted = [...factors]
    .filter((f) => f.available && Math.abs(f.homeDelta) > 0.01)
    .sort((a, b) => Math.abs(b.homeDelta * b.weight) - Math.abs(a.homeDelta * a.weight));

  const favorsWinner = (f: FactorContribution): boolean => {
    if (winnerAbbr === null) return true;
    return winnerAbbr === homeTeamAbbr ? f.homeDelta > 0 : f.homeDelta < 0;
  };
  const favorableFactors =
    winnerAbbr === null ? sorted : sorted.filter(favorsWinner);

  const leadFactor: FactorContribution = favorableFactors[0] ?? sorted[0] ?? {
    key: "none",
    label: "No decisive factor",
    homeDelta: 0,
    weight: 0,
    available: true,
    hasSignal: false,
    evidence: "No factor provides meaningful separation between these teams",
  };

  const supportingFactors = favorableFactors
    .filter((f) => f.key !== leadFactor.key)
    .slice(0, 2);

  // Counterpoint: any available factor that points against the predicted winner
  const counterpoint = sorted.find((f) => {
    if (winnerAbbr === null) return false;
    if (NEUTRAL_CONTEXT_FACTOR_KEYS.has(f.key)) return false;
    if (winnerAbbr === homeTeamAbbr) return f.homeDelta < -5;
    return f.homeDelta > 5;
  }) ?? null;

  const unavailableKeyFactors = factors
    .filter((f) => !f.available && f.weight >= 0.05)
    .map((f) => f.evidence);

  return {
    homeTeamAbbr,
    awayTeamAbbr,
    homeTeamName,
    awayTeamName,
    winnerAbbr,
    sport,
    confidenceBand,
    confidencePct,
    seasonContext,
    leadFactor,
    supportingFactors,
    counterpoint,
    injuries,
    unavailableKeyFactors,
  };
}

// ─── Word count helper ──────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentenceCount(text: string): number {
  const matches = text.trim().match(/[.!?](?=\s|$)/g);
  return matches?.length ?? 0;
}

function textHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickVariant<T>(items: T[], seed: string): T {
  return items[textHash(seed) % items.length]!;
}

function readableFactorLabel(factor: FactorContribution): string {
  const label = factor.label.replace(/\s*\([^)]*\)/g, "").toLowerCase();
  if (label.includes("elo") || label.includes("rating differential")) return "power rating";
  if (label.includes("simulation") || label.includes("game-script")) return "expected-score projection";
  if (label.includes("consensus") || label.includes("market")) return "outside-consensus check";
  return label;
}

function cleanEvidenceForNarrative(evidence: string): string {
  return evidence
    .replace(/\bElo\b/g, "rating")
    .replace(/\bHFA\b/g, "home adjustment")
    .replace(/\bthe model\b/gi, "the read")
    .replace(/\bthe algorithm\b/gi, "the read");
}

function teamName(input: NarrativeInput, abbr: string): string {
  if (abbr === input.homeTeamAbbr) return input.homeTeamName ?? abbr;
  if (abbr === input.awayTeamAbbr) return input.awayTeamName ?? abbr;
  return abbr;
}

function teamSubject(input: NarrativeInput, abbr: string): string {
  const name = teamName(input, abbr);
  if (name === abbr) return name;
  if (["NBA", "NFL", "MLB", "NHL", "NCAAB", "NCAAF"].includes(input.sport)) {
    return `the ${name}`;
  }
  return name;
}

function homeVenueEdge(input: NarrativeInput): string {
  switch (input.sport) {
    case "NBA":
    case "NCAAB":
      return "home court";
    case "NHL":
      return "home ice";
    case "MLB":
    case "NFL":
    case "NCAAF":
      return "home field";
    case "EPL":
    case "UCL":
      return "home ground";
    case "IPL":
      return "home venue";
    case "TENNIS":
      return "draw slot";
    default:
      return "home setup";
  }
}

function homeAdjustmentLabel(input: NarrativeInput): string {
  switch (input.sport) {
    case "NBA":
    case "NCAAB":
      return "home-court adjustment";
    case "NHL":
      return "home-ice adjustment";
    case "MLB":
    case "NFL":
    case "NCAAF":
      return "home-field adjustment";
    case "EPL":
    case "UCL":
      return "home-ground adjustment";
    case "IPL":
      return "venue adjustment";
    case "TENNIS":
      return "draw-slot adjustment";
    default:
      return "venue adjustment";
  }
}

function possessive(value: string): string {
  return value.endsWith("s") ? `${value}'` : `${value}'s`;
}

function teamPossessive(input: NarrativeInput, abbr: string): string {
  return possessive(teamName(input, abbr));
}

function winnerName(input: NarrativeInput): string | null {
  return input.winnerAbbr ? teamName(input, input.winnerAbbr) : null;
}

function loserName(input: NarrativeInput): string | null {
  if (!input.winnerAbbr) return null;
  return teamName(
    input,
    input.winnerAbbr === input.homeTeamAbbr
      ? input.awayTeamAbbr
      : input.homeTeamAbbr,
  );
}

function parseEloDifferential(evidence: string): number | null {
  const match = evidence.match(/=\s*(-?\d+(?:\.\d+)?)\s*pt/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.round(Math.abs(parsed)) : null;
}

function parseRecentForm(evidence: string): { home: string; away: string } | null {
  const match = evidence.match(/Home\s+L10:\s*([^,.;]+(?:\([^)]*\))?)\s*,\s*Away\s+L10:\s*([^,.;]+(?:\([^)]*\))?)/i);
  if (!match) return null;
  return {
    home: match[1]!.trim(),
    away: match[2]!.trim(),
  };
}

function pickedSide(input: NarrativeInput): "home" | "away" | null {
  if (!input.winnerAbbr) return null;
  return input.winnerAbbr === input.homeTeamAbbr ? "home" : "away";
}

function renderFactorInsight(
  factor: FactorContribution,
  input: NarrativeInput,
  seed: string,
  role: "lead" | "support" | "counter",
): string {
  const label = readableFactorLabel(factor);
  const winner = winnerName(input) ?? input.winnerAbbr ?? "the pick";
  const winnerDisplay = input.winnerAbbr ? teamSubject(input, input.winnerAbbr) : "the pick";
  const loser = loserName(input) ?? "the other side";
  const side = pickedSide(input);
  const opposingAbbr =
    input.winnerAbbr === input.homeTeamAbbr
      ? input.awayTeamAbbr
      : input.homeTeamAbbr;
  const opposing = input.winnerAbbr ? teamName(input, opposingAbbr) : "the other side";
  const opposingDisplay = input.winnerAbbr ? teamSubject(input, opposingAbbr) : "the other side";

  if (factor.key.includes("rating") || label.includes("elo")) {
    const diff = parseEloDifferential(factor.evidence);
    const edgeText = diff ? `about ${diff} rating points` : "a power-rating edge";

    if (role === "counter") {
      return `the power-rating read still gives ${opposingDisplay} something to argue with`;
    }

    if (side === "home") {
      const venueEdge = homeVenueEdge(input);
      const adjustment = homeAdjustmentLabel(input);
      return pickVariant(
        [
          `${venueEdge} is doing real work: once the location bump is included, ${winnerDisplay} show ${edgeText} of edge`,
          `the power-rating case starts with the ${adjustment}, where ${winnerDisplay} grade out with ${edgeText} behind them`,
          `the home setup matters: after the ${adjustment}, ${winnerDisplay} come out ${edgeText} ahead`,
        ],
        `${seed}|elo-home|${role}`,
      );
    }

    return pickVariant(
      [
        `the power-rating piece travels: even with the road setting baked in, ${winnerDisplay} still carry ${edgeText}`,
        `${winnerDisplay} get there through the ratings, with the matchup still showing ${edgeText} in their favor`,
        `the road spot is baked in, and the ratings still point to ${winnerDisplay} by ${edgeText}`,
      ],
      `${seed}|elo-away|${role}`,
    );
  }

  if (factor.key.includes("recent_form") || label.includes("recent form")) {
    const form = parseRecentForm(factor.evidence);
    if (form && input.winnerAbbr) {
      const winnerForm = side === "home" ? form.home : form.away;
      const loserForm = side === "home" ? form.away : form.home;
      if (role === "counter") {
        return `${teamPossessive(input, opposingAbbr)} recent form is the warning sign: ${loserForm} lately`;
      }
      return `${teamPossessive(input, input.winnerAbbr)} recent-results case is ${winnerForm}, compared with ${loserForm} for ${loser}`;
    }
    return role === "counter"
      ? `${teamPossessive(input, opposingAbbr)} recent form gives them the cleanest counter`
      : `recent form gives ${winnerDisplay} another reason to like the pick`;
  }

  if (factor.key.includes("rest") || label.includes("rest")) {
    return role === "counter"
      ? `${opposingDisplay} have the rest angle, which can matter late`
      : `the rest setup helps ${winnerDisplay}: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("back_to_back") || label.includes("back-to-back")) {
    return role === "counter"
      ? `${opposingDisplay} get the cleaner schedule spot`
      : `the schedule spot helps too: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("injur") || label.includes("availability")) {
    return role === "counter"
      ? `availability is the piece that could tug this back toward ${opposingDisplay}: ${cleanEvidenceForNarrative(factor.evidence)}`
      : `availability supports the pick: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("travel") || label.includes("travel")) {
    return role === "counter"
      ? `${opposingDisplay} have the travel/schedule counter`
      : `the travel setup also leans toward ${winnerDisplay}: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("simulation_projection") || label.includes("game-script")) {
    return role === "counter"
      ? `the expected-score projection is the cleanest warning: ${cleanEvidenceForNarrative(factor.evidence)}`
      : `the expected-score projection adds context: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("market_comparison") || label.includes("consensus")) {
    return role === "counter"
      ? `outside consensus is the warning label here: ${cleanEvidenceForNarrative(factor.evidence)}`
      : `outside consensus does not fight the pick much: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (role === "counter") {
    return `${readableFactorLabel(factor)} gives ${opposingDisplay} a real counter`;
  }

  return `${readableFactorLabel(factor)}: ${cleanEvidenceForNarrative(factor.evidence)}`;
}

function renderFanAngle(
  input: NarrativeInput,
  seed: string,
  counterpoint: FactorContribution | null,
): string {
  const { winnerAbbr, homeTeamAbbr, awayTeamAbbr, seasonContext, leadFactor, supportingFactors } = input;
  const opposingAbbr =
    winnerAbbr === null
      ? null
      : winnerAbbr === homeTeamAbbr ? awayTeamAbbr : homeTeamAbbr;

  if (seasonContext && counterpoint && opposingAbbr) {
    return pickVariant(
      [
        `That is the fan angle: in the ${seasonContext.label}, ${readableFactorLabel(counterpoint)} gives ${teamSubject(input, opposingAbbr)} a real pressure point.`,
        `What makes this worth watching is the tension between ${teamPossessive(input, winnerAbbr!)} main edge and ${teamPossessive(input, opposingAbbr)} ${readableFactorLabel(counterpoint)} counterpunch.`,
        `For fans, the interesting part is whether ${teamPossessive(input, winnerAbbr!)} top edge still travels with ${readableFactorLabel(counterpoint)} pulling the other way.`,
      ],
      `${seed}|fan-season-counter`,
    );
  }

  if (seasonContext) {
    return pickVariant(
      [
        `That is the viewing hook: the ${seasonContext.label} makes those matchup edges feel bigger than a normal calendar spot.`,
        `For fans, the draw is seeing which of these concrete edges actually holds up in the ${seasonContext.label}.`,
        `The interesting part is that this setting puts the cleanest matchup data under a brighter light.`,
      ],
      `${seed}|fan-season`,
    );
  }

  if (counterpoint && opposingAbbr && winnerAbbr) {
    return pickVariant(
      [
        `The fun part is ${teamSubject(input, opposingAbbr)} still have a path if ${readableFactorLabel(counterpoint)} shows up.`,
        `That counterpoint keeps the card interesting: ${teamSubject(input, opposingAbbr)} have one clear way to make this uncomfortable.`,
        `For fans, the hinge is whether ${teamPossessive(input, winnerAbbr)} main edge outweighs ${teamPossessive(input, opposingAbbr)} best counter.`,
      ],
      `${seed}|fan-counter`,
    );
  }

  const supportLabel = supportingFactors[0] ? readableFactorLabel(supportingFactors[0]) : undefined;
  const leadLabel = readableFactorLabel(leadFactor);
  return pickVariant(
    [
      `What makes it interesting is whether that ${leadLabel} edge is enough to set the whole game script.`,
      supportLabel
        ? `The fan angle is simple: ${leadLabel} starts the case, and ${supportLabel} is the next piece to watch.`
        : `The fan angle is simple: this one mostly comes down to whether ${leadLabel} is as meaningful as the numbers say.`,
      `For a normal fan, this is the kind of matchup where one clean edge can tell you what to watch from the jump.`,
    ],
    `${seed}|fan-basic`,
  );
}

// ─── Deterministic fallback template ────────────────────────────────────
// Built directly from the structured input. Always valid. May sound dry
// but never sounds dishonest.

export function buildDeterministicNarrative(input: NarrativeInput): string {
  const { winnerAbbr, homeTeamAbbr, awayTeamAbbr, sport, confidenceBand, leadFactor, supportingFactors, counterpoint, injuries, seasonContext, unavailableKeyFactors } = input;

  const parts: string[] = [];
  const injuryLines = formatInjuryNotes(injuries);
  const seed = `${sport}|${homeTeamAbbr}|${awayTeamAbbr}|${winnerAbbr ?? "pickem"}|${leadFactor.key}|${supportingFactors.map((f) => f.key).join(",")}`;
  const seasonLead = seasonContext
    ? pickVariant(
      [
        `${seasonContext.label}: `,
        `Given the ${seasonContext.label}, `,
        `Context matters here: ${seasonContext.label}, `,
      ],
      `${seed}|season`,
    )
    : "";

  // ── Pick'em case ──
  if (winnerAbbr === null) {
    parts.push(
      seasonLead +
      pickVariant(
        [
          `this is basically a coin flip between ${homeTeamAbbr} and ${awayTeamAbbr}, so there is no need to force a side.`,
          `${homeTeamAbbr}-${awayTeamAbbr} is tight enough that the honest read is no clear edge.`,
          `I would call this one a true toss-up between ${homeTeamAbbr} and ${awayTeamAbbr}.`,
        ],
        `${seed}|pickem`,
      ),
    );
    if (leadFactor.key !== "none") {
      parts.push(`The biggest separator is ${readableFactorLabel(leadFactor)}: ${cleanEvidenceForNarrative(leadFactor.evidence)}.`);
    }
    if (supportingFactors.length > 0) {
      parts.push(
        `The other useful reads are ${supportingFactors
          .map((f) => `${readableFactorLabel(f)} (${cleanEvidenceForNarrative(f.evidence)})`)
          .join(" and ")}.`,
      );
    }
    if (injuryLines.length > 0) {
      parts.push(`${injuryLines[0]}.`);
    }
    if (seasonContext) {
      parts.push(seasonContext.detail);
    }
    parts.push(renderFanAngle(input, seed, null));
    parts.push(`Neither team has enough separation to make this more than a lean.`);
    if (unavailableKeyFactors.length > 0) {
      parts.push(`Worth noting: ${unavailableKeyFactors[0]}.`);
    }
    return parts.join(" ");
  }

  // ── Band-appropriate opening ──
  const loserAbbr = winnerAbbr === homeTeamAbbr ? awayTeamAbbr : homeTeamAbbr;

  switch (confidenceBand) {
    case "coinflip":
      parts.push(
        seasonLead +
        pickVariant(
          [
            `${teamSubject(input, winnerAbbr)} are the lean over ${teamSubject(input, loserAbbr)}, but this is still close to a toss-up.`,
            `I give ${teamSubject(input, winnerAbbr)} the nod over ${teamSubject(input, loserAbbr)}, though it is still a toss-up type margin.`,
            `${teamSubject(input, winnerAbbr)} are the pick, but this is more toss-up lean than declaration against ${teamSubject(input, loserAbbr)}.`,
          ],
          `${seed}|coinflip`,
        ),
      );
      break;
    case "slight edge":
      parts.push(
        seasonLead +
        pickVariant(
          [
            `I lean ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)} because the best pieces of the matchup point their way.`,
            `${teamSubject(input, winnerAbbr)} get the call over ${teamSubject(input, loserAbbr)}, mostly because the matchup gives them a few more usable edges.`,
            `The read tilts toward ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)}, even if it is not a runaway case.`,
          ],
          `${seed}|slight`,
        ),
      );
      break;
    case "clear edge":
      parts.push(
        seasonLead +
        pickVariant(
          [
            `${teamSubject(input, winnerAbbr)} are the pick over ${teamSubject(input, loserAbbr)}, and the case starts with one matchup edge carrying real weight.`,
            `I am on ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)} here because the matchup data gives them cleaner paths to win.`,
            `${teamSubject(input, winnerAbbr)} have the better case against ${teamSubject(input, loserAbbr)}, with the top factors pointing the same direction.`,
          ],
          `${seed}|clear`,
        ),
      );
      break;
    case "strong edge":
      parts.push(
        seasonLead +
        pickVariant(
          [
            `${teamSubject(input, winnerAbbr)} are the side here, with more than one signal backing up the pick.`,
            `The strongest read on this matchup is ${teamSubject(input, winnerAbbr)}, because the biggest indicators are stacked their way.`,
            `${teamSubject(input, winnerAbbr)} are the cleaner pick over ${teamSubject(input, loserAbbr)}, and it is not just one stat doing the work.`,
          ],
          `${seed}|strong`,
        ),
      );
      break;
  }

  // ── Lead factor ──
  const leadInsight = renderFactorInsight(leadFactor, input, seed, "lead");
  parts.push(
    pickVariant(
      [
        `The main reason: ${leadInsight}.`,
        `Start here: ${leadInsight}.`,
        `The first thing that jumps out: ${leadInsight}.`,
      ],
      `${seed}|lead`,
    ),
  );

  // ── Supporting factors ──
  if (supportingFactors.length > 0) {
    const supportText = supportingFactors
      .map((f) => renderFactorInsight(f, input, seed, "support"))
      .join("; ");
    parts.push(
      pickVariant(
        [
          `The support is not one-note either: ${supportText}.`,
          `There is backup for it too: ${supportText}.`,
          `Two more pieces help the pick: ${supportText}.`,
        ],
        `${seed}|support`,
      ),
    );
  }

  if (injuryLines.length > 0) {
    parts.push(`${injuryLines[0]}.`);
  }

  if (seasonContext) {
    parts.push(seasonContext.detail);
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
    const counterInsight = renderFactorInsight(
      effectiveCounterpoint,
      input,
      seed,
      "counter",
    );
    parts.push(
      `Working against the pick: ${counterInsight}.`,
    );
  }

  parts.push(renderFanAngle(input, seed, effectiveCounterpoint));

  // ── Elo-only note ──
  // If the lead is the only factor with meaningful signal and nothing is
  // pushing against the pick, say so explicitly. Prevents the narrative
  // from sounding like we ran out of things to mention.
  if (
    leadFactor.key !== "none" &&
    supportingFactors.length === 0 &&
    effectiveCounterpoint === null
  ) {
    parts.push(`There is not much supporting context available, so the read leans heavily on that main edge.`);
  }

  // ── Unavailable caveats ──
  if (unavailableKeyFactors.length > 0) {
    parts.push(`One caveat: ${unavailableKeyFactors[0]}.`);
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

  if (sentenceCount(text) > 10) {
    text = parts.slice(0, 10).join(" ");
  }

  return text;
}

function formatInjuryNotes(injuries: NarrativeInjury[]): string[] {
  return injuries.slice(0, 3).map((injury) => {
    const pos = injury.position ? `, ${injury.position}` : "";
    const reason = injury.reason ? ` with ${injury.reason}` : "";
    return `Injury-wise, ${injury.name} (${injury.team}${pos}) is ${injury.status.toLowerCase()}${reason}`;
  });
}

// ─── LLM narrative generation ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are writing an analysis note for a sports prediction app. Talk like a knowledgeable sports friend at a bar: conversational, sharp, confident but not hypey. You will be given a structured factor breakdown. Render it into one paragraph of 80-150 words that explains the pick. HARD RULES:

- Clearly name the picked team, unless this is pick'em.
- Lead with the top factor as the main reason. Do not invent a different reason.
- Include 2-3 supporting reasons when they exist in the input.
- Include the counterpoint when one is provided.
- Mention Out/Doubtful injuries naturally when provided.
- Include why the game is interesting from a fan perspective, using only the provided factors or season context.
- If season context is provided, make playoff/tournament/cup/final/bowl/group-stage games sound like that moment, not a generic regular-season note.
- You may not introduce any information not in the structured input.
- You may not make confidence stronger than the confidenceBand indicates. A "coinflip" band must be described as a toss-up with a slight lean, not a confident pick.
- If any unavailableKeyFactors are listed, you must mention them as a caveat.
- No hype language. Banned words: lock, guaranteed, can't lose, can’t lose, easy money, slam dunk, smash, dominant, sharp play, hammer, sure thing. Using any of these words is a failure.
- Do not mention the model, the algorithm, or raw Elo labels; translate ratings into plain matchup language.
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
${input.injuries.length > 0 ? `Injuries: ${input.injuries.map((inj) => {
    const pos = inj.position ? `, ${inj.position}` : "";
    const reason = inj.reason ? ` — ${inj.reason}` : "";
    return `${inj.name} (${inj.team}${pos}): ${inj.status}${reason}`;
  }).join("; ")}` : "Injuries omitted from structured input; do not claim either team is healthy."}
${input.seasonContext ? `Season context: ${input.seasonContext.label} — ${input.seasonContext.detail}` : "No special season context provided."}
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
  const sc = sentenceCount(text);
  if (sc > 10) return { valid: false, reason: `Too many sentences: ${sc} (max 10)` };
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
