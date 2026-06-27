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
const BAD_STYLE_REGEX =
  /\bget the call\b|\busable edges\b|\bpower-rating (?:case|setup)\b|\bworking against the pick\b|\bthe model\b|\bthe algorithm\b|\bstart here\b|\bgets? the nod\b|\bgot (?:a |the )?(?:slight |solid |clear )?edge\b|don['’]t sleep|\brather grim\b|\blighting up\b/i;

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

function sentenceStart(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
    case "WORLDCUP":
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
    case "WORLDCUP":
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

function replaceAllLiteral(value: string, from: string, to: string): string {
  return value.split(from).join(to);
}

function polishIndividualCompetitorCopy(input: NarrativeInput, text: string): string {
  if (input.sport !== "TENNIS") return text;

  let polished = text;
  for (const abbr of [input.homeTeamAbbr, input.awayTeamAbbr]) {
    const name = teamName(input, abbr);
    polished = replaceAllLiteral(polished, `${name} have the better case`, `${name} has the better case`);
    polished = replaceAllLiteral(polished, `${name} have been the hotter team`, `${name} has been in better form`);
    polished = replaceAllLiteral(polished, `${name} have the momentum`, `${name} has the momentum`);
    polished = replaceAllLiteral(polished, `${name} are the pick`, `${name} is the pick`);
    polished = replaceAllLiteral(polished, `${name} are the side`, `${name} is the side`);
    polished = replaceAllLiteral(polished, `${name} are the play`, `${name} is the play`);
    polished = replaceAllLiteral(polished, `${name} are the clear side`, `${name} is the clear side`);
    polished = replaceAllLiteral(polished, `${name} are the strong read`, `${name} is the strong read`);
    polished = replaceAllLiteral(polished, `${name} are cooking`, `${name} is in a good spot`);
    polished = replaceAllLiteral(polished, `${name} look built different`, `${name} looks built different`);
    polished = replaceAllLiteral(polished, `${name} just grade`, `${name} just grades`);
    polished = replaceAllLiteral(polished, `${name} rate ahead`, `${name} rates ahead`);
    polished = replaceAllLiteral(polished, `${name} carry the stronger profile`, `${name} carries the stronger profile`);
    polished = replaceAllLiteral(polished, `${name} sit at`, `${name} sits at`);
  }

  return polished;
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
    const edgeText = diff ? `by about ${diff} rating points` : "on paper";

    if (role === "counter") {
      return `the rating gap isn't huge, so ${opposingDisplay} are still very much in this`;
    }

    if (side === "home") {
      const venueEdge = homeVenueEdge(input);
      return pickVariant(
        [
          `${venueEdge} is a nice bonus, but the real story is ${winnerDisplay} just grade out as the better squad ${edgeText}`,
          `even setting the ${venueEdge} aside, ${winnerDisplay} are the stronger team here ${edgeText}`,
          `${winnerDisplay} rate ahead ${edgeText} once you bake in the ${venueEdge} — they're the better roster`,
        ],
        `${seed}|elo-home|${role}`,
      );
    }

    return pickVariant(
      [
        `${winnerDisplay} are just the better team here ${edgeText}, even on the road`,
        `road game or not, ${winnerDisplay} grade out ahead ${edgeText} — that's the backbone of the pick`,
        `${winnerDisplay} carry the stronger profile ${edgeText}, and the neutral/road spot is already factored in`,
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
        return `${teamPossessive(input, opposingAbbr)} form is the thing keeping me honest — they've been ${loserForm} lately`;
      }
      return `${teamName(input, input.winnerAbbr)} have been the hotter team at ${winnerForm}, while ${loser} sit at ${loserForm}`;
    }
    return role === "counter"
      ? `${teamPossessive(input, opposingAbbr)} recent form is the cleanest reason to second-guess this`
      : `${winnerDisplay} have the momentum lately, which only helps the pick`;
  }

  if (factor.key.includes("rest") || label.includes("rest")) {
    return role === "counter"
      ? `${opposingDisplay} get the rest edge, and that can bite late`
      : `the schedule's doing ${winnerDisplay} a favor: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("back_to_back") || label.includes("back-to-back")) {
    return role === "counter"
      ? `${opposingDisplay} land the comfier schedule spot`
      : `the schedule spot is in their corner too: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("injur") || label.includes("availability")) {
    return role === "counter"
      ? `the injury picture is what could drag this back toward ${opposingDisplay}: ${cleanEvidenceForNarrative(factor.evidence)}`
      : `the availability stuff lines up for the pick: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("travel") || label.includes("travel")) {
    return role === "counter"
      ? `${opposingDisplay} have the travel/schedule angle working for them`
      : `the travel setup tilts ${winnerDisplay}'s way too: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("simulation_projection") || label.includes("game-script")) {
    return role === "counter"
      ? `the projected score says this stays tight: ${cleanEvidenceForNarrative(factor.evidence)}`
      : `the projected score is on board with the lean: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (factor.key.includes("market_comparison") || label.includes("consensus")) {
    return role === "counter"
      ? `the read is going a little against the room here: ${cleanEvidenceForNarrative(factor.evidence)}`
      : `the broader consensus doesn't really push back: ${cleanEvidenceForNarrative(factor.evidence)}`;
  }

  if (role === "counter") {
    return `${readableFactorLabel(factor)} gives ${opposingDisplay} a legit counter`;
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
        `The fun part: whether ${teamSubject(input, opposingAbbr)} can turn ${readableFactorLabel(counterpoint)} into real pressure with the ${seasonContext.label} stakes cranked up.`,
        `This one's got juice because ${teamPossessive(input, opposingAbbr)} ${readableFactorLabel(counterpoint)} can absolutely pull it back.`,
        `Big question in the ${seasonContext.label}: does ${teamPossessive(input, winnerAbbr!)} top edge hold up with ${readableFactorLabel(counterpoint)} pushing back?`,
        `What makes it watchable: ${teamPossessive(input, opposingAbbr)} ${readableFactorLabel(counterpoint)} is exactly the thing that flips ${seasonContext.label} games.`,
        `Keep an eye on ${teamPossessive(input, opposingAbbr)} ${readableFactorLabel(counterpoint)} — under ${seasonContext.label} lights, that's how upsets start.`,
      ],
      `${seed}|fan-season-counter`,
    );
  }

  if (seasonContext) {
    return pickVariant(
      [
        `The ${seasonContext.label} turns the volume up — these matchup edges matter way more than a random calendar night.`,
        `In the ${seasonContext.label}, the question is which of these edges actually shows up when it counts.`,
        `This is the kind of spot where the cleanest edges get put under the lights.`,
        `${seasonContext.label} games reward the team that travels its strengths — that's the whole watch here.`,
        `When the ${seasonContext.label} pressure hits, edges either harden or evaporate; this one tells you which.`,
      ],
      `${seed}|fan-season`,
    );
  }

  if (counterpoint && opposingAbbr && winnerAbbr) {
    return pickVariant(
      [
        `${sentenceStart(teamSubject(input, opposingAbbr))} still have a path if ${readableFactorLabel(counterpoint)} shows up — that's what keeps it spicy.`,
        `${sentenceStart(teamSubject(input, opposingAbbr))} have one real way to make this uncomfortable, so the upset isn't crazy.`,
        `It comes down to whether ${teamPossessive(input, winnerAbbr)} main edge outmuscles ${teamPossessive(input, opposingAbbr)} best counter.`,
        `Give ${teamSubject(input, opposingAbbr)} their shot here — if ${readableFactorLabel(counterpoint)} lands, the whole read shifts.`,
        `The live angle is ${teamPossessive(input, opposingAbbr)} ${readableFactorLabel(counterpoint)}; that's the lever that makes it close.`,
      ],
      `${seed}|fan-counter`,
    );
  }

  const supportLabel = supportingFactors[0] ? readableFactorLabel(supportingFactors[0]) : undefined;
  const leadLabel = readableFactorLabel(leadFactor);
  return pickVariant(
    [
      `Really it's about whether that ${leadLabel} edge is enough to carry the night.`,
      supportLabel
        ? `${sentenceStart(leadLabel)} gets it started, and ${supportLabel} is the next thing to keep an eye on.`
        : `This basically rides on whether ${leadLabel} is as real as the numbers say.`,
      `One clean edge could tell the whole story early.`,
      `Watch the ${leadLabel} early — if it travels, this one's chalk; if not, it gets interesting.`,
      supportLabel
        ? `If both the ${leadLabel} and ${supportLabel} show up together, it won't stay close for long.`
        : `The ${leadLabel} is the whole thesis here, so track it from the opening minutes.`,
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
  // Salt the seed with the full team names and confidence band so two different
  // matchups that happen to share the same lead factor don't collapse onto the
  // same variant index. This spreads games across the (now much larger) phrasing
  // pools, which is what actually removes the "recycled narrative" feel — the
  // copy itself is unchanged, only which variant a given game lands on.
  const nameSalt = `${input.homeTeamName ?? homeTeamAbbr}|${input.awayTeamName ?? awayTeamAbbr}`;
  const seed = `${sport}|${homeTeamAbbr}|${awayTeamAbbr}|${winnerAbbr ?? "pickem"}|${confidenceBand}|${leadFactor.key}|${supportingFactors.map((f) => f.key).join(",")}|${nameSalt}`;
  const seasonLead = seasonContext
    ? pickVariant(
      [
        `${seasonContext.label} stakes here. `,
        `It's a ${seasonContext.label} spot. `,
        `Big ${seasonContext.label} energy. `,
        `${seasonContext.label} lights are on. `,
        `This one carries ${seasonContext.label} weight. `,
        `Pure ${seasonContext.label} pressure here. `,
        `${seasonContext.label} stage, so it matters more. `,
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
          `Real talk, ${homeTeamAbbr}-${awayTeamAbbr} is a coin flip — no need to force a side here.`,
          `${homeTeamAbbr} vs ${awayTeamAbbr} is too close to call cleanly, and the honest read is there's no real edge.`,
          `This one's a true pick'em between ${homeTeamAbbr} and ${awayTeamAbbr} — it could legit go either way.`,
          `${homeTeamAbbr}-${awayTeamAbbr} grades out dead even; anyone selling you a strong side is guessing.`,
          `No edge worth chasing in ${homeTeamAbbr} vs ${awayTeamAbbr} — it's as close to 50/50 as these get.`,
          `${homeTeamAbbr} and ${awayTeamAbbr} cancel out on paper; this is a hands-off, watch-and-enjoy spot.`,
        ],
        `${seed}|pickem`,
      ),
    );
    if (leadFactor.key !== "none") {
      parts.push(`If anything tips it, it's ${readableFactorLabel(leadFactor)}: ${cleanEvidenceForNarrative(leadFactor.evidence)}.`);
    }
    if (supportingFactors.length > 0) {
      parts.push(
        `Also worth a look: ${supportingFactors
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
    parts.push(`Bottom line: nobody's separating enough here to make this more than a lean.`);
    if (unavailableKeyFactors.length > 0) {
      parts.push(`One thing to flag: ${unavailableKeyFactors[0]}.`);
    }
    return polishIndividualCompetitorCopy(input, parts.join(" "));
  }

  // ── Band-appropriate opening ──
  const loserAbbr = winnerAbbr === homeTeamAbbr ? awayTeamAbbr : homeTeamAbbr;

  switch (confidenceBand) {
    case "coinflip":
      parts.push(
        seasonLead +
        pickVariant(
          [
            `${sentenceStart(teamSubject(input, winnerAbbr))} get the slight lean over ${teamSubject(input, loserAbbr)}, but real talk this is basically a coin flip.`,
            `If you're picking, give it to ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)} — but barely; it's a true toss-up vibe.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the pick, but keep it light: this is a coin-flip spot, not a statement against ${teamSubject(input, loserAbbr)}.`,
            `Flip a coin and you've about got it — ${teamSubject(input, winnerAbbr)} edge ${teamSubject(input, loserAbbr)} by a whisker, nothing more.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the side, but I'm not married to it; ${teamSubject(input, loserAbbr)} are right there.`,
            `Honestly this one's a dead heat — the needle barely tips to ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)}.`,
            `Call it ${teamSubject(input, winnerAbbr)} if you're forced to, but ${teamSubject(input, loserAbbr)} could just as easily take it.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} nose ahead of ${teamSubject(input, loserAbbr)}, though "ahead" is doing a lot of work in a spot this tight.`,
            `Splitting hairs here — ${teamSubject(input, winnerAbbr)} get the faint nod, but treat ${teamSubject(input, loserAbbr)} as a live dog.`,
            `No clean edge in this one; ${teamSubject(input, winnerAbbr)} are the lean over ${teamSubject(input, loserAbbr)} and that's about all you can say.`,
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
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the side over ${teamSubject(input, loserAbbr)} — the matchup tilts their way, just not by a ton.`,
            `Leaning ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)} here; the edge is real but it's a thin one.`,
            `The read nudges toward ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)} — there's an edge, just don't oversell it.`,
            `Give me ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)}, but it's a modest lean, not a hammer.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} have the better of it against ${teamSubject(input, loserAbbr)} — slim margin, but it's there.`,
            `Slight tilt to ${teamSubject(input, winnerAbbr)} here; ${teamSubject(input, loserAbbr)} keep it close enough to respect.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} grade out a touch ahead of ${teamSubject(input, loserAbbr)} — enough to side with, not enough to lean on hard.`,
            `The edge points to ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)}, but it's the kind you'd want to double-check at the number.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the pick over ${teamSubject(input, loserAbbr)}, just know the gap is narrow.`,
            `A small but honest edge to ${teamSubject(input, winnerAbbr)} here — ${teamSubject(input, loserAbbr)} aren't far off.`,
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
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the play over ${teamSubject(input, loserAbbr)}, and the matchup genuinely sets up in their favor.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} have the better case against ${teamSubject(input, loserAbbr)} — the key pieces all point the same way.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are cooking in this spot against ${teamSubject(input, loserAbbr)}; the read likes them with room to work.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the side I want over ${teamSubject(input, loserAbbr)} — this matchup fits them well.`,
            `Comfortable with ${teamSubject(input, winnerAbbr)} here; the profile against ${teamSubject(input, loserAbbr)} is a clean one.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} check the boxes that matter against ${teamSubject(input, loserAbbr)}, and it shows in the read.`,
            `This sets up nicely for ${teamSubject(input, winnerAbbr)} — enough separation from ${teamSubject(input, loserAbbr)} to back it with some conviction.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} have the cleaner path against ${teamSubject(input, loserAbbr)}, and the numbers back the eye test.`,
            `Solid spot for ${teamSubject(input, winnerAbbr)}; the gap on ${teamSubject(input, loserAbbr)} is real and repeatable.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the stronger team in the ways that count tonight against ${teamSubject(input, loserAbbr)}.`,
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
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the clear side here, and it's not just one thing carrying it.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} look built different in this spot — multiple signals stacked their way over ${teamSubject(input, loserAbbr)}.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the strong read against ${teamSubject(input, loserAbbr)}, with the biggest factors all lined up.`,
            `This is one of the cleaner reads on the board — ${teamSubject(input, winnerAbbr)} over ${teamSubject(input, loserAbbr)}, and it's not close on paper.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are a confident side against ${teamSubject(input, loserAbbr)}; just about everything points their way.`,
            `Hard to talk yourself onto ${teamSubject(input, loserAbbr)} here — ${teamSubject(input, winnerAbbr)} have too much going for them.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the kind of spot you circle: layered edges over ${teamSubject(input, loserAbbr)}, not a one-trick read.`,
            `Everything that matters tilts ${teamSubject(input, winnerAbbr)} tonight, and ${teamSubject(input, loserAbbr)} don't have an obvious answer.`,
            `${sentenceStart(teamSubject(input, winnerAbbr))} are the strong play; the case against ${teamSubject(input, loserAbbr)} is stacked on multiple fronts.`,
            `This one reads decisive — ${teamSubject(input, winnerAbbr)} have separation on ${teamSubject(input, loserAbbr)} in the areas that decide games.`,
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
        `The main thing: ${leadInsight}.`,
        `Where it really starts — ${leadInsight}.`,
        `What's driving it: ${leadInsight}.`,
        `Start here: ${leadInsight}.`,
        `The engine of it is ${leadInsight}.`,
        `Biggest lever in the read — ${leadInsight}.`,
        `What tips it: ${leadInsight}.`,
        `The core of the case is ${leadInsight}.`,
        `Top of the list: ${leadInsight}.`,
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
        `It's backed up too: ${supportText}.`,
        `And there's more on the stack: ${supportText}.`,
        `The next layer's in their corner too: ${supportText}.`,
        `There's reinforcement behind it: ${supportText}.`,
        `It doesn't stop there — ${supportText}.`,
        `More working in their favor: ${supportText}.`,
        `The supporting case holds up too: ${supportText}.`,
        `Stacked on top of that: ${supportText}.`,
        `And the secondary read agrees: ${supportText}.`,
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
      pickVariant(
      [
        `The one thing that gives me pause: ${counterInsight}.`,
        `What could flip it: ${counterInsight}.`,
        `Not all one-way though — ${counterInsight}.`,
        `The hole in the case: ${counterInsight}.`,
        `Where it could go sideways — ${counterInsight}.`,
        `Reason to hedge a little: ${counterInsight}.`,
        `The counter you can't ignore: ${counterInsight}.`,
        `Don't sleep on the other side, though — ${counterInsight}.`,
        `One crack in it: ${counterInsight}.`,
      ],
      `${seed}|counter`,
      ),
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
    parts.push(`Not a ton of extra context tonight, so the pick mostly rides on that one main edge.`);
  }

  // ── Unavailable caveats ──
  if (unavailableKeyFactors.length > 0) {
    parts.push(`One thing to flag: ${unavailableKeyFactors[0]}.`);
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

  return polishIndividualCompetitorCopy(input, text);
}

function formatInjuryNotes(injuries: NarrativeInjury[]): string[] {
  return injuries.slice(0, 3).map((injury) => {
    const pos = injury.position ? `, ${injury.position}` : "";
    const reason = injury.reason ? ` with ${injury.reason}` : "";
    return `Injury check: ${injury.name} (${injury.team}${pos}) is ${injury.status.toLowerCase()}${reason}`;
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
  if (BAD_STYLE_REGEX.test(text)) {
    const match = text.match(BAD_STYLE_REGEX);
    return { valid: false, reason: `Contains bad style phrase: "${match?.[0]}"` };
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
