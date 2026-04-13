/**
 * Advanced Data-Driven Prediction Engine for Sports Games
 * Uses ESPN real data + OpenAI GPT-4o-mini analysis
 */

import type { Game, Prediction, PredictionFactor, Team } from "../types/sports";
import { fetchTeamRecentForm, fetchTeamExtendedStats, fetchTeamInjuries, fetchTeamSeasonResults, fetchAdvancedMetrics, fetchStartingLineup, fetchGameWeather, getSRSRatings, srsToBlendfactor, type TeamRecentForm, type TeamExtendedStats, type TeamInjuryReport, type TeamAdvancedMetrics, type StartingLineup, type WeatherData, type GameResultForSRS } from "./espnStats";
import { getEloRating, getEloPrediction, initializeEloFromSchedule, DEFAULT_RATING } from "./elo";
import { env } from "../env";
import { prisma } from "../prisma";
import { enqueueWrite } from "./writeQueue";

// ─── Calibration ───────────────────────────────────────────────────────────
// Sport-specific calibration: different sports have different predictability
const SPORT_CALIBRATION: Record<string, { dampener: number; ceiling: number; tossUpCeiling: number }> = {
  NBA:   { dampener: 0.70, ceiling: 88, tossUpCeiling: 54 },
  NFL:   { dampener: 0.55, ceiling: 82, tossUpCeiling: 53 },
  NCAAF: { dampener: 0.60, ceiling: 85, tossUpCeiling: 53 },
  NCAAB: { dampener: 0.65, ceiling: 87, tossUpCeiling: 54 },
  MLB:   { dampener: 0.45, ceiling: 75, tossUpCeiling: 53 },
  NHL:   { dampener: 0.55, ceiling: 80, tossUpCeiling: 53 },
  MLS:   { dampener: 0.55, ceiling: 78, tossUpCeiling: 53 },
  EPL:   { dampener: 0.60, ceiling: 82, tossUpCeiling: 53 },
};
function getCalibration(sport: string) {
  return SPORT_CALIBRATION[sport] ?? { dampener: 0.65, ceiling: 87, tossUpCeiling: 54 };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getWinPercentage(team: Team): number {
  const totalGames = team.record.wins + team.record.losses + (team.record.ties || 0);
  if (totalGames === 0) return 0.5;
  return (team.record.wins + (team.record.ties || 0) * 0.5) / totalGames;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

// ─── Sport-specific sigmoid scaling: NBA is most predictable, MLB least ─────
const SIGMOID_SCALING: Record<string, number> = {
  NBA: 5.5, NFL: 4.0, NCAAF: 4.5, NCAAB: 5.0,
  MLB: 3.0, NHL: 3.5, MLS: 4.0, EPL: 4.5,
};

// ─── Over/Under baseline by sport (fallback if ESPN doesn't provide) ────────

const SPORT_OVER_UNDER_BASELINES: Record<string, number> = {
  NFL: 45,
  NCAAF: 52,
  NBA: 220,
  NCAAB: 140,
  MLB: 8.5,
  NHL: 6,
  MLS: 2.5,
  EPL: 2.5,
};

// ─── Season total games by sport (for dampening calculation) ─────────────────

const SEASON_TOTAL_GAMES: Record<string, number> = {
  NBA: 82,
  NFL: 17,
  NCAAF: 12,
  NCAAB: 30,
  MLB: 162,
  NHL: 82,
  MLS: 34,
  EPL: 38,
};

// ─── AI analysis cache (game ID + injury state hash) ────────────────────────

import { LRUCache } from "lru-cache";

const AI_CACHE_TTL_MS       = 60 * 60 * 1000; // 1 hour for games > 6 hours away
const AI_CACHE_TTL_NEAR_MS  = 20 * 60 * 1000; // 20 minutes for games within 6 hours
const aiAnalysisCache = new LRUCache<string, { text: string; timestamp: number }>({ max: 500 });

/**
 * Deterministic hash of the current injury reports for both teams.
 * Any change to the injured player list busts the cache key.
 */
function computeInjuryHash(
  homeInjuries: TeamInjuryReport,
  awayInjuries: TeamInjuryReport
): string {
  const parts: string[] = [];
  for (const p of homeInjuries.out)          parts.push(`HO:${p.name}`);
  for (const p of homeInjuries.doubtful)     parts.push(`HD:${p.name}`);
  for (const p of homeInjuries.questionable) parts.push(`HQ:${p.name}`);
  for (const p of awayInjuries.out)          parts.push(`AO:${p.name}`);
  for (const p of awayInjuries.doubtful)     parts.push(`AD:${p.name}`);
  for (const p of awayInjuries.questionable) parts.push(`AQ:${p.name}`);
  // djb2-style hash — fast and deterministic
  const str = parts.sort().join("|");
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // keep 32-bit unsigned
  }
  return h.toString(36);
}

function aiCacheKey(
  gameId: string,
  homeInjuries: TeamInjuryReport,
  awayInjuries: TeamInjuryReport
): string {
  return `${gameId}_${computeInjuryHash(homeInjuries, awayInjuries)}`;
}

function aiCacheTTL(gameDateTime: string): number {
  const msUntilGame = new Date(gameDateTime).getTime() - Date.now();
  return msUntilGame <= 6 * 60 * 60 * 1000 ? AI_CACHE_TTL_NEAR_MS : AI_CACHE_TTL_MS;
}

function getCachedAIAnalysis(
  gameId: string,
  gameDateTime: string,
  homeInjuries: TeamInjuryReport,
  awayInjuries: TeamInjuryReport
): string | null {
  const key = aiCacheKey(gameId, homeInjuries, awayInjuries);
  const entry = aiAnalysisCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > aiCacheTTL(gameDateTime)) {
    aiAnalysisCache.delete(key);
    return null;
  }
  return entry.text;
}

function setCachedAIAnalysis(
  gameId: string,
  homeInjuries: TeamInjuryReport,
  awayInjuries: TeamInjuryReport,
  text: string
): void {
  const key = aiCacheKey(gameId, homeInjuries, awayInjuries);
  aiAnalysisCache.set(key, { text, timestamp: Date.now() });
}

// ─── Rest label helper ───────────────────────────────────────────────────────

function restLabel(days: number | null): string {
  if (days === null) return "unknown rest";
  if (days === 0) return "0 days (BACK-TO-BACK)";
  if (days === 1) return "1 day (SHORT REST)";
  return `${days} days`;
}

// ─── Trend label helper ──────────────────────────────────────────────────────

function trendLabel(value: number): string {
  if (value > 0.15) return "up";
  if (value < -0.15) return "down";
  return "flat";
}

function defTrendLabel(value: number): string {
  if (value > 0.15) return "improving";
  if (value < -0.15) return "declining";
  return "flat";
}

// ─── Injury list helper ──────────────────────────────────────────────────────

function injuryList(
  players: Array<{ name: string; position: string; detail: string }>,
  max: number
): string {
  if (players.length === 0) return "";
  return players
    .slice(0, max)
    .map((p) => `${p.name} (${p.position})`)
    .join(", ");
}

// ─── Template-based fallback analysis ───────────────────────────────────────

function buildTemplateAnalysis(
  game: Game,
  predictedWinner: "home" | "away",
  confidence: number,
  homeForm: TeamRecentForm,
  awayForm: TeamRecentForm,
  homeExtended: TeamExtendedStats,
  awayExtended: TeamExtendedStats,
  homeInjuries: TeamInjuryReport,
  awayInjuries: TeamInjuryReport,
  homeElo: number,
  awayElo: number,
  isTossUp: boolean
): string {
  const winnerTeam = predictedWinner === "home" ? game.homeTeam : game.awayTeam;
  const loserTeam = predictedWinner === "home" ? game.awayTeam : game.homeTeam;
  const winnerForm = predictedWinner === "home" ? homeForm : awayForm;
  const loserForm = predictedWinner === "home" ? awayForm : homeForm;
  const winnerElo = predictedWinner === "home" ? homeElo : awayElo;
  const loserElo = predictedWinner === "home" ? awayElo : homeElo;
  const winnerInjuries = predictedWinner === "home" ? homeInjuries : awayInjuries;
  const winnerExtended = predictedWinner === "home" ? homeExtended : awayExtended;
  const loserExtended = predictedWinner === "home" ? awayExtended : homeExtended;

  const winnerRecord = `${winnerTeam.record.wins}-${winnerTeam.record.losses}`;
  const loserRecord = `${loserTeam.record.wins}-${loserTeam.record.losses}`;
  const winnerFormStr = winnerForm.formString || "N/A";
  const loserFormStr = loserForm.formString || "N/A";

  const locationStr = predictedWinner === "home" ? "at home" : "on the road";
  const confLevel = confidence >= 80 ? "strong" : confidence >= 70 ? "solid" : confidence >= 60 ? "slight" : "marginal";

  let line = `${winnerTeam.name} (${winnerRecord}, Elo ${Math.round(winnerElo)}, L10: ${winnerFormStr}) hold a ${confLevel} edge over ${loserTeam.name} (${loserRecord}, Elo ${Math.round(loserElo)}, L10: ${loserFormStr}) ${locationStr}.`;

  // Rest sentence — only if there's a meaningful difference
  const homeRest = homeExtended.restDays;
  const awayRest = awayExtended.restDays;
  if (homeRest !== null && awayRest !== null && Math.abs(homeRest - awayRest) >= 2) {
    const restedTeam = homeRest > awayRest ? game.homeTeam.name : game.awayTeam.name;
    const fatiguedTeam = homeRest > awayRest ? game.awayTeam.name : game.homeTeam.name;
    const restedDays = homeRest > awayRest ? homeRest : awayRest;
    const fatiguedDays = homeRest > awayRest ? awayRest : homeRest;
    line += ` ${restedTeam} has ${restedDays} days rest while ${fatiguedTeam} plays on ${fatiguedDays === 0 ? "a back-to-back" : "short rest"}.`;
  } else if ((homeRest === 0 || awayRest === 0) && homeRest !== awayRest) {
    const b2bTeam = homeRest === 0 ? game.homeTeam.name : game.awayTeam.name;
    line += ` ${b2bTeam} is on a back-to-back.`;
  }

  // Injury sentence — only if winner has notable absences
  if (winnerInjuries.totalOut > 0) {
    const outList = injuryList(winnerInjuries.out, 2);
    line += ` Key absence${winnerInjuries.totalOut > 1 ? "s" : ""}: ${outList} (out) may limit ${winnerTeam.name}'s ceiling.`;
  } else if (winnerInjuries.totalDoubtful > 0) {
    const doubtList = injuryList(winnerInjuries.doubtful, 1);
    line += ` Watch ${doubtList} (doubtful) for ${winnerTeam.name}.`;
  }

  if (isTossUp) {
    line += ` This is a toss-up — Elo ratings (${Math.round(homeElo)} vs ${Math.round(awayElo)}) show neither team has a clear edge.`;
  }

  return line;
}

// ─── AI agreement helper ─────────────────────────────────────────────────────

/**
 * Heuristic: scan the AI text for mentions of each team name and infer
 * which team the AI favours. Returns true if the AI appears to favour the
 * home team, false for away, and null when genuinely ambiguous.
 * Caller compares this to predictedWinner to derive aiAgreesWithModel.
 */
function aiPrefersHomeTeam(
  text: string,
  homeTeamName: string,
  awayTeamName: string
): boolean | null {
  const lower = text.toLowerCase();
  const homeFirst = homeTeamName.split(" ").pop()?.toLowerCase() ?? homeTeamName.toLowerCase();
  const awayFirst = awayTeamName.split(" ").pop()?.toLowerCase() ?? awayTeamName.toLowerCase();

  // Count how many times each team's key name appears near positive words
  const positiveWords = ["edge", "advantage", "stronger", "better", "favor", "favour", "lean", "back"];
  let homeSignal = 0;
  let awaySignal = 0;

  for (const word of positiveWords) {
    const idx = lower.indexOf(word);
    if (idx === -1) continue;
    const window = lower.slice(Math.max(0, idx - 60), idx + 60);
    if (window.includes(homeFirst)) homeSignal++;
    if (window.includes(awayFirst)) awaySignal++;
  }

  if (homeSignal === awaySignal) return null; // ambiguous
  return homeSignal > awaySignal;
}

// ─── OpenAI analysis ────────────────────────────────────────────────────────

async function generateAIAnalysis(
  game: Game,
  factors: PredictionFactor[],
  homeForm: TeamRecentForm,
  awayForm: TeamRecentForm,
  homeExtended: TeamExtendedStats,
  awayExtended: TeamExtendedStats,
  homeInjuries: TeamInjuryReport,
  awayInjuries: TeamInjuryReport,
  homeElo: number,
  awayElo: number,
  isTossUp: boolean,
  homeLineup: StartingLineup | null,
  awayLineup: StartingLineup | null,
  predictedWinner: "home" | "away",
  confidence: number,
  weatherData: WeatherData | null,
  dataCoverage: number
): Promise<{ text: string; aiAgreesWithModel: boolean }> {
  // Return cached response if available
  const cached = getCachedAIAnalysis(game.id, game.dateTime, homeInjuries, awayInjuries);
  if (cached) {
    const aiPrefersHome = aiPrefersHomeTeam(cached, game.homeTeam.name, game.awayTeam.name);
    return { text: cached, aiAgreesWithModel: aiPrefersHome === (predictedWinner === "home") };
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    const text = buildTemplateAnalysis(game, predictedWinner, confidence, homeForm, awayForm, homeExtended, awayExtended, homeInjuries, awayInjuries, homeElo, awayElo, isTossUp);
    return { text, aiAgreesWithModel: true };
  }

  const factorSummary = factors
    .filter((f) => f.weight > 0)
    .map(
      (f) =>
        `${f.name}: home ${f.homeScore >= 0 ? "+" : ""}${f.homeScore.toFixed(2)}, away ${f.awayScore >= 0 ? "+" : ""}${f.awayScore.toFixed(2)} — ${f.description}`
    )
    .join("\n");

  // ── Build Elo section ───────────────────────────────────────────────────
  const eloPredLocal = getEloPrediction(homeElo, awayElo, game.sport.toString());
  const eloSection = `Elo ratings: Home Elo: ${Math.round(homeElo)} | Away Elo: ${Math.round(awayElo)} | Elo win prob: ${(eloPredLocal.homeWinProb * 100).toFixed(0)}% home`;

  // ── Build rest section ──────────────────────────────────────────────────
  const homeRestStr = homeExtended.restDays !== null
    ? `${homeExtended.restDays} days${homeExtended.restDays <= 1 ? (homeExtended.restDays === 0 ? " (BACK-TO-BACK)" : " (SHORT REST)") : ""}`
    : "unknown";
  const awayRestStr = awayExtended.restDays !== null
    ? `${awayExtended.restDays} days${awayExtended.restDays <= 1 ? (awayExtended.restDays === 0 ? " (BACK-TO-BACK)" : " (SHORT REST)") : ""}`
    : "unknown";
  const restSection = `Rest: Home rest: ${homeRestStr} | Away rest: ${awayRestStr}`;

  // ── Build injury section ────────────────────────────────────────────────
  const homeOutList = injuryList(homeInjuries.out, 5);
  const homeDoubtList = injuryList(homeInjuries.doubtful, 3);
  const awayOutList = injuryList(awayInjuries.out, 5);
  const awayDoubtList = injuryList(awayInjuries.doubtful, 3);

  const homeInjuryStr = homeInjuries.totalOut === 0 && homeInjuries.totalDoubtful === 0
    ? "Healthy roster."
    : `Out: ${homeOutList || "none"}. Doubtful: ${homeDoubtList || "none"}.`;
  const awayInjuryStr = awayInjuries.totalOut === 0 && awayInjuries.totalDoubtful === 0
    ? "Healthy roster."
    : `Out: ${awayOutList || "none"}. Doubtful: ${awayDoubtList || "none"}.`;
  const injurySection = `Injuries: Home — ${homeInjuryStr} Away — ${awayInjuryStr}`;

  // ── Build H2H section ───────────────────────────────────────────────────
  const h2hTotal = homeExtended.headToHeadResults.length;
  const h2hHomeWins = homeExtended.headToHeadResults.filter((g) => g.won).length;
  const h2hSection = h2hTotal > 0
    ? `Season series: Home ${h2hHomeWins}-${h2hTotal - h2hHomeWins} vs Away`
    : "No previous matchups this season.";

  // ── Build trends section ────────────────────────────────────────────────
  const trendsSection = `Trends: Home offense trend: ${trendLabel(homeExtended.scoringTrend)} (${homeExtended.scoringTrend.toFixed(2)}). Home defense trend: ${defTrendLabel(homeExtended.defenseTrend)}. Away offense trend: ${trendLabel(awayExtended.scoringTrend)} (${awayExtended.scoringTrend.toFixed(2)}). Away defense trend: ${defTrendLabel(awayExtended.defenseTrend)}.`;

  // ── Build splits section ────────────────────────────────────────────────
  const splitsSection = `Home/Away splits: Home team's home record: ${homeExtended.homeRecord.wins}-${homeExtended.homeRecord.losses}. Away team's road record: ${awayExtended.awayRecord.wins}-${awayExtended.awayRecord.losses}.`;

  // ── Toss-up note ────────────────────────────────────────────────────────
  const tossUpNote = isTossUp
    ? "NOTE: The statistical model flags this game as a TOSS-UP. Reflect that in your assessment."
    : "";

  // ── Build lineup section ────────────────────────────────────────────────
  const buildLineupSection = (lineup: StartingLineup | null, teamName: string): string => {
    if (!lineup || lineup.starters.length === 0) return "";
    const starterList = lineup.starters
      .map((s) => `${s.name} (${s.position})${s.era !== undefined ? " ERA " + s.era.toFixed(2) : ""}${s.record ? " " + s.record : ""}${s.isConfirmed ? "" : "*"}`)
      .join(", ");
    return `${teamName} starters: ${starterList}${lineup.starters.some((s) => !s.isConfirmed) ? " (* = inferred, not confirmed)" : ""}`;
  };
  const homeLineupStr = buildLineupSection(homeLineup, game.homeTeam.name);
  const awayLineupStr = buildLineupSection(awayLineup, game.awayTeam.name);
  const lineupSection = [homeLineupStr, awayLineupStr].filter(Boolean).join("\n");

  // ── Build weather section ───────────────────────────────────────────────
  const weatherSection = weatherData && !weatherData.isDomed
    ? `Weather: ${Math.round(weatherData.temperature)}°F, ${Math.round(weatherData.windSpeed)}mph wind, ${Math.round(weatherData.precipitation * 100)}% precip chance`
    : "";

  // ── Build situational section ───────────────────────────────────────────
  const situationalParts: string[] = [];
  if (homeExtended.restDays === 0) situationalParts.push(`${game.homeTeam.name} on B2B`);
  if (awayExtended.restDays === 0) situationalParts.push(`${game.awayTeam.name} on B2B`);
  if (awayExtended.consecutiveAwayGames >= 3) situationalParts.push(`${game.awayTeam.name} on ${awayExtended.consecutiveAwayGames}-game road trip`);
  const situationalSection = situationalParts.length > 0 ? `Situational: ${situationalParts.join(" | ")}` : "";

  // ── Data coverage note ──────────────────────────────────────────────────
  const dataCoverageNote = dataCoverage < 0.6
    ? `NOTE: Limited data available (${Math.round(dataCoverage * 100)}% of factors have real data). Confidence has been reduced accordingly. Acknowledge uncertainty where appropriate.`
    : dataCoverage < 0.8
    ? `Data note: ${Math.round(dataCoverage * 100)}% factor coverage.`
    : "";

  const userPrompt = `
Sport: ${game.sport}
Matchup: ${game.awayTeam.name} (${game.awayTeam.record.wins}-${game.awayTeam.record.losses}, L10: ${awayForm.formString || "N/A"}) @ ${game.homeTeam.name} (${game.homeTeam.record.wins}-${game.homeTeam.record.losses}, L10: ${homeForm.formString || "N/A"})
Home streak: ${homeForm.streak >= 0 ? 'W' + homeForm.streak : 'L' + Math.abs(homeForm.streak)} | Away streak: ${awayForm.streak >= 0 ? 'W' + awayForm.streak : 'L' + Math.abs(awayForm.streak)}
Home point diff: ${(homeForm.avgScore - homeForm.avgAllowed).toFixed(1)} | Away point diff: ${(awayForm.avgScore - awayForm.avgAllowed).toFixed(1)}

${eloSection}
${restSection}
${injurySection}
${weatherSection ? weatherSection + "\n" : ""}${situationalSection ? situationalSection + "\n" : ""}${lineupSection ? lineupSection + "\n" : ""}${h2hSection}
${trendsSection}
${splitsSection}
${tossUpNote}
${dataCoverageNote ? dataCoverageNote + "\n" : ""}
Factors:
${factorSummary}

Write a sharp 2-3 sentence sports prediction analysis.`.trim();

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
          {
            role: "system",
            content:
              "You are an elite sports analyst writing for a prediction app called Clutch Picks. Based only on the data provided, independently assess which team has the statistical edge. Do not assume any pre-determined winner. If the data is mixed or close, say so honestly. Never state a conclusion the data does not support. Write exactly 2-3 sentences that are specific, data-driven, and reference concrete numbers: rest days, head-to-head records, scoring trends, Elo ratings, and key injuries when they tell a meaningful story. Never use generic phrases like 'should be a good game' or 'anything can happen'.",
          },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 150,
        temperature: 0.15,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const text = buildTemplateAnalysis(game, predictedWinner, confidence, homeForm, awayForm, homeExtended, awayExtended, homeInjuries, awayInjuries, homeElo, awayElo, isTossUp);
      return { text, aiAgreesWithModel: true };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      const fallback = buildTemplateAnalysis(game, predictedWinner, confidence, homeForm, awayForm, homeExtended, awayExtended, homeInjuries, awayInjuries, homeElo, awayElo, isTossUp);
      return { text: fallback, aiAgreesWithModel: true };
    }

    setCachedAIAnalysis(game.id, homeInjuries, awayInjuries, text);
    const aiPrefersHome = aiPrefersHomeTeam(text, game.homeTeam.name, game.awayTeam.name);
    const aiAgreesWithModel = aiPrefersHome === (predictedWinner === "home");
    return { text, aiAgreesWithModel };
  } catch (_err) {
    const text = buildTemplateAnalysis(game, predictedWinner, confidence, homeForm, awayForm, homeExtended, awayExtended, homeInjuries, awayInjuries, homeElo, awayElo, isTossUp);
    return { text, aiAgreesWithModel: true };
  }
}

// ─── Point differential factor ──────────────────────────────────────────────

/**
 * Normalise a raw point differential (scored - allowed) to [-1, 1].
 * Different sports have very different scoring scales.
 */
function normalisePtDiff(diff: number, sport: string): number {
  const scale: Record<string, number> = {
    NFL: 10,     // tighter since NFL margins are often 3-7
    NCAAF: 14,
    NBA: 12,     // NBA margins typically 5-10
    NCAAB: 10,
    MLB: 1.2,    // MLB run diffs are tighter
    NHL: 0.8,    // NHL goal diffs are small
    MLS: 0.6,
    EPL: 0.6,
  };
  const s = scale[sport] ?? 10;
  return clamp(diff / s, -1, 1);
}

// ─── Recent form scoring ─────────────────────────────────────────────────────

const RECENCY_DECAY = 0.85;
function formScore(form: TeamRecentForm): number {
  if (form.results.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < form.results.length; i++) {
    const weight = Math.pow(RECENCY_DECAY, i);
    const value = form.results[i] === "W" ? 1 : form.results[i] === "D" ? 0.5 : 0;
    weightedSum += value * weight;
    totalWeight += weight;
  }
  return (weightedSum / totalWeight) * 2 - 1;
}

// ─── Streak scoring ──────────────────────────────────────────────────────────

function streakScore(streak: number): number {
  // streak ±5 maps fully to ±1
  return clamp(streak / 5, -1, 1);
}

// ─── Value rating vs spread ──────────────────────────────────────────────────
// This comparison is valid because CRITICAL-3 removed marketLine from the
// composite score. predictedSpread is derived purely from homeWeightedSum
// (the model's own 13-factor composite) — no market data feeds into it.
// A large divergence between model spread and market spread is genuine signal
// that the model sees something the market doesn't (or vice versa).

function calcValueRating(
  predictedSpread: number,
  marketSpread: number | undefined,
  sport: string
): number {
  // No market line available — return neutral mid-point (5/10)
  if (marketSpread === undefined) return 5;
  const diff = Math.abs(predictedSpread - marketSpread);
  // Sport-specific scale: how many points of divergence = full 10/10 value
  const valueScale: Record<string, number> = {
    NFL: 3.5, NCAAF: 4.0, NBA: 4.0, NCAAB: 3.5,
    MLB: 1.5, NHL: 1.5, MLS: 1.0, EPL: 1.0,
  };
  const scale = valueScale[sport] ?? 3.5;
  // Bounded [1, 10]: larger divergence = higher value rating
  return clamp(Math.round(1 + (diff / scale) * 9), 1, 10);
}

// ─── Edge rating ──────────────────────────────────────────────────────────────

function calcEdgeRating(confidence: number): number {
  // Use a power curve: confidence 50 -> 1, 65 -> 4, 75 -> 6, 85 -> 8, 95 -> 10
  const normalized = (confidence - 50) / 45; // 0 to 1
  const curved = Math.pow(normalized, 0.6); // More aggressive curve rewarding higher confidence
  return clamp(Math.round(curved * 9 + 1), 1, 10);
}

// ─── Sport factor weights ────────────────────────────────────────────────────

export interface SportFactorWeights {
  winPct: number;
  recentForm: number;
  homeAwaySplit: number;
  pointDiff: number;
  streak: number;
  restDays: number;
  scoringTrend: number;
  defenseTrend: number;
  headToHead: number;
  strengthOfSchedule: number;
  elo: number;
  injuries: number;
  advancedMetrics: number;
  startingPitcher: number; // MLB only; 0 for all other sports
  weather: number; // outdoor sports only; 0 for NBA, NHL, NCAAB
  situational: number; // scheduling/fatigue context; highest for NBA/NHL
  // Placeholder for referee/umpire tendency scoring. Set to 0 until a referee data source is
  // integrated. NBA referees affect pace/fouls, MLB umpires affect strike zones, NFL referees
  // have penalty tendencies.
  refereeTendency: number;
  clutchFactor: number; // close-game win rate
  matchupInteraction: number; // offense vs defense cross-matchup quality
}

const SPORT_FACTOR_WEIGHTS: Record<string, SportFactorWeights> = {
  NBA: {
    winPct: 0.03, recentForm: 0.09, homeAwaySplit: 0.06, pointDiff: 0.09,
    streak: 0.02, restDays: 0.06, scoringTrend: 0.03, defenseTrend: 0.03,
    headToHead: 0.03, strengthOfSchedule: 0.05, elo: 0.16, injuries: 0.12,
    advancedMetrics: 0.10, startingPitcher: 0.00, weather: 0.00,
    situational: 0.04, refereeTendency: 0.00, clutchFactor: 0.04, matchupInteraction: 0.05,
  },
  NFL: {
    winPct: 0.04, recentForm: 0.07, homeAwaySplit: 0.07, pointDiff: 0.09,
    streak: 0.02, restDays: 0.05, scoringTrend: 0.03, defenseTrend: 0.04,
    headToHead: 0.04, strengthOfSchedule: 0.05, elo: 0.13, injuries: 0.15,
    advancedMetrics: 0.10, startingPitcher: 0.00, weather: 0.04,
    situational: 0.02, refereeTendency: 0.00, clutchFactor: 0.03, matchupInteraction: 0.03,
  },
  MLB: {
    winPct: 0.04, recentForm: 0.06, homeAwaySplit: 0.04, pointDiff: 0.07,
    streak: 0.02, restDays: 0.01, scoringTrend: 0.04, defenseTrend: 0.04,
    headToHead: 0.04, strengthOfSchedule: 0.05, elo: 0.12, injuries: 0.12,
    advancedMetrics: 0.10, startingPitcher: 0.12, weather: 0.03,
    situational: 0.02, refereeTendency: 0.00, clutchFactor: 0.04, matchupInteraction: 0.04,
  },
  NHL: {
    winPct: 0.04, recentForm: 0.10, homeAwaySplit: 0.05, pointDiff: 0.09,
    streak: 0.03, restDays: 0.04, scoringTrend: 0.03, defenseTrend: 0.04,
    headToHead: 0.04, strengthOfSchedule: 0.05, elo: 0.15, injuries: 0.13,
    advancedMetrics: 0.10, startingPitcher: 0.00, weather: 0.00,
    situational: 0.04, refereeTendency: 0.00, clutchFactor: 0.03, matchupInteraction: 0.04,
  },
  NCAAB: {
    winPct: 0.04, recentForm: 0.08, homeAwaySplit: 0.11, pointDiff: 0.08,
    streak: 0.02, restDays: 0.04, scoringTrend: 0.04, defenseTrend: 0.04,
    headToHead: 0.04, strengthOfSchedule: 0.10, elo: 0.20, injuries: 0.08,
    advancedMetrics: 0.03, startingPitcher: 0.00, weather: 0.00,
    situational: 0.00, refereeTendency: 0.00, clutchFactor: 0.05, matchupInteraction: 0.05,
  },
  NCAAF: {
    winPct: 0.04, recentForm: 0.08, homeAwaySplit: 0.08, pointDiff: 0.09,
    streak: 0.03, restDays: 0.06, scoringTrend: 0.03, defenseTrend: 0.04,
    headToHead: 0.04, strengthOfSchedule: 0.10, elo: 0.18, injuries: 0.08,
    advancedMetrics: 0.03, startingPitcher: 0.00, weather: 0.04,
    situational: 0.00, refereeTendency: 0.00, clutchFactor: 0.04, matchupInteraction: 0.04,
  },
  MLS: {
    winPct: 0.05, recentForm: 0.12, homeAwaySplit: 0.09, pointDiff: 0.08,
    streak: 0.03, restDays: 0.04, scoringTrend: 0.04, defenseTrend: 0.04,
    headToHead: 0.05, strengthOfSchedule: 0.05, elo: 0.18, injuries: 0.09,
    advancedMetrics: 0.02, startingPitcher: 0.00, weather: 0.02,
    situational: 0.00, refereeTendency: 0.00, clutchFactor: 0.05, matchupInteraction: 0.05,
  },
  EPL: {
    winPct: 0.05, recentForm: 0.12, homeAwaySplit: 0.09, pointDiff: 0.08,
    streak: 0.03, restDays: 0.04, scoringTrend: 0.04, defenseTrend: 0.04,
    headToHead: 0.05, strengthOfSchedule: 0.05, elo: 0.18, injuries: 0.09,
    advancedMetrics: 0.02, startingPitcher: 0.00, weather: 0.02,
    situational: 0.00, refereeTendency: 0.00, clutchFactor: 0.05, matchupInteraction: 0.05,
  },
};

// Validate all weight sets sum to 1.0
for (const [sport, w] of Object.entries(SPORT_FACTOR_WEIGHTS)) {
  const sum = Object.values(w).reduce((s, v) => s + (v as number), 0);
  if (Math.abs(sum - 1.0) > 0.005) {
    console.error(`ORACLE CORE: ${sport} weights sum to ${sum.toFixed(4)}, expected 1.0`);
  }
}

export function getWeightsForSport(sport: string): SportFactorWeights {
  return SPORT_FACTOR_WEIGHTS[sport] ?? SPORT_FACTOR_WEIGHTS.NBA!;
}

// ─── Rest days factor score ───────────────────────────────────────────────────

function restDaysScore(restDays: number | null): number {
  if (restDays === null) return 0;
  if (restDays === 0) return -0.8;  // back-to-back
  if (restDays === 1) return -0.3;
  if (restDays === 2) return 0.1;
  if (restDays === 3) return 0.25;
  return 0.15; // 4+ days — stale legs slightly
}

// ─── Situational / scheduling context score ──────────────────────────────────

/**
 * Detect and score scheduling/fatigue situations that the restDays factor
 * alone cannot capture. Returns [homeScore, awayScore] each in [-1, 1].
 *
 * Situations scored:
 *  1. Back-to-back (restDays = 0): -0.5 per team on B2B
 *     NBA back-to-back-to-back (restDays = 0 AND previous restDays was also 0
 *     — approximated via consecutiveAwayGames >= 3 in the away case): -0.7
 *  2. Long road trip (away team on 3+ consecutive away games): -0.15 fatigue
 *  3. Travel burden proxy: away team on 3+ road games gets an extra -0.1
 *     (we don't have lat/long city data, so road trip length is the proxy)
 *
 * The score is computed for each team independently, then returned as the
 * home-relative differential (homeRaw - awayRaw), so a larger magnitude means
 * a more exploitable scheduling mismatch.
 */
export function computeSituationalScore(
  homeRestDays: number | null,
  awayRestDays: number | null,
  homeConsecAway: number,   // consecutive away games for home team (should be 0 if hosting)
  awayConsecAway: number,   // consecutive away games for away team
  sport: string
): { homeScore: number; awayScore: number; description: string } {
  const parts: string[] = [];

  // Per-team raw scores (negative = disadvantaged)
  let homeRaw = 0;
  let awayRaw = 0;

  // ── Back-to-back penalty ─────────────────────────────────────────────────
  if (homeRestDays === 0) {
    // NBA B2B-to-B2B proxy: if home team has also been on the road (unusual
    // for a home game, but possible mid-road-trip turnaround)
    homeRaw -= sport === "NBA" ? 0.5 : 0.4;
    parts.push(`Home B2B`);
  }
  if (awayRestDays === 0) {
    // Away B2B-to-B2B: road team on 3+ consecutive games signals deeper fatigue
    const isB2B3 = sport === "NBA" && awayConsecAway >= 3;
    awayRaw -= isB2B3 ? 0.7 : (sport === "NBA" ? 0.5 : 0.4);
    parts.push(isB2B3 ? `Away B2B-to-B2B (3rd straight road game)` : `Away B2B`);
  }

  // ── Short rest (1 day) — smaller penalty ─────────────────────────────────
  if (homeRestDays === 1) {
    homeRaw -= 0.15;
    parts.push(`Home short rest`);
  }
  if (awayRestDays === 1) {
    awayRaw -= 0.15;
    parts.push(`Away short rest`);
  }

  // ── Long road trip fatigue (3+ consecutive away games) ───────────────────
  // Only meaningful for NBA/NHL (dense schedule); MLB long road trips also matter
  if (awayConsecAway >= 3 && (sport === "NBA" || sport === "NHL" || sport === "MLB")) {
    const fatigue = awayConsecAway >= 5 ? 0.25 : 0.15;
    awayRaw -= fatigue;
    parts.push(`Away on ${awayConsecAway}-game road trip`);
  }

  // Clamp each raw score to [-1, 0] (these are only penalties, never boosts)
  homeRaw = clamp(homeRaw, -1, 0);
  awayRaw = clamp(awayRaw, -1, 0);

  // Convert to relative scores: home advantage = home less penalized than away
  // homeScore positive = home team has scheduling advantage over the visitor
  const homeScore = clamp(awayRaw - homeRaw, -1, 1);
  const awayScore = -homeScore;

  const description =
    parts.length > 0
      ? parts.join(" | ")
      : "No significant scheduling factors";

  return { homeScore, awayScore, description };
}



// ─── Position impact multipliers by sport ────────────────────────────────────

const POSITION_WEIGHTS: Record<string, Record<string, number>> = {
  NBA:  { PG: 1.5, SG: 1.2, SF: 1.4, PF: 1.1, C: 1.0, G: 1.3, F: 1.2 },
  NFL:  { QB: 2.8, WR: 1.0, RB: 0.85, TE: 0.9, OL: 0.75, CB: 1.1, DE: 1.0, LB: 0.9, S: 0.8 },
  MLB:  { SP: 2.5, C: 0.9, SS: 0.95, '2B': 0.8, '3B': 0.85, OF: 0.8, RP: 0.5 },
  NHL:  { G: 2.5, D: 1.1, LW: 0.9, RW: 0.9, C: 1.1 },
};

function positionWeight(sport: string, position: string): number {
  return POSITION_WEIGHTS[sport]?.[position] ?? 1.0;
}

function weightedInjuryScore(
  report: { out: Array<{ position: string }>; doubtful: Array<{ position: string }>; questionable: Array<{ position: string }> },
  sport: string
): number {
  // If no position data available on any player, fall back to flat body count
  const allPlayers = [...report.out, ...report.doubtful, ...report.questionable];
  const hasPositionData = allPlayers.some((p) => p.position && p.position.length > 0);

  if (!hasPositionData) {
    return Math.max(-1,
      report.out.length * -0.15 +
      report.doubtful.length * -0.08 +
      report.questionable.length * -0.03
    );
  }

  const outPenalty = report.out.reduce(
    (sum, p) => sum + -0.15 * positionWeight(sport, p.position), 0
  );
  const doubtfulPenalty = report.doubtful.reduce(
    (sum, p) => sum + -0.08 * positionWeight(sport, p.position), 0
  );
  const questionablePenalty = report.questionable.reduce(
    (sum, p) => sum + -0.03 * positionWeight(sport, p.position), 0
  );

  return Math.max(-1, outPenalty + doubtfulPenalty + questionablePenalty);
}

// ─── Referee/umpire tendency score (placeholder) ─────────────────────────────

/**
 * TODO: Implement when a referee data source is integrated.
 * Potential signals:
 *  - NBA: referee foul-call rate (affects pace and FT opportunities)
 *  - MLB: umpire strike-zone tendencies (affects pitcher vs batter matchups)
 *  - NFL: referee crew penalty rate (affects game flow and scoring)
 * Until then this is zero-impact on all predictions.
 */
function computeRefereeTendencyScore(): { homeScore: number; awayScore: number } {
  return { homeScore: 0, awayScore: 0 };
}

// ─── Close-game clutch factor ─────────────────────────────────────────────────
const CLOSE_GAME_THRESHOLDS: Record<string, number> = {
  NBA: 5, NFL: 7, NCAAF: 7, NCAAB: 5, MLB: 2, NHL: 1, MLS: 1, EPL: 1,
};
function computeClutchScore(
  seasonResults: Array<{ teamScore?: number; oppScore?: number; won: boolean }>,
  sport: string
): number {
  const threshold = CLOSE_GAME_THRESHOLDS[sport] ?? 5;
  let closeGames = 0;
  let closeWins = 0;
  for (const g of seasonResults) {
    if (g.teamScore === undefined || g.oppScore === undefined) continue;
    if (Math.abs(g.teamScore - g.oppScore) <= threshold) {
      closeGames++;
      if (g.won) closeWins++;
    }
  }
  if (closeGames < 4) return 0;
  const winRate = closeWins / closeGames;
  const sampleConf = Math.min(1, closeGames / 10);
  return clamp((winRate - 0.5) * 3, -1, 1) * sampleConf;
}

// ─── Advanced metrics score ───────────────────────────────────────────────────

/**
 * Compare sport-specific advanced metrics for home vs away team.
 * Returns a score in [-1, 1]: positive = home has the edge, negative = away.
 * Returns 0 (neutral) for any metric that is missing from either team's data.
 */
export function computeAdvancedMetricScore(
  home: TeamAdvancedMetrics,
  away: TeamAdvancedMetrics,
  sport: string
): number {
  // Weighted diff: each metric contributes a (weight, score) pair
  const weightedScores: Array<{ w: number; v: number }> = [];

  const addMetric = (
    h: number | undefined,
    a: number | undefined,
    scale: number,
    weight: number,
    higherIsBetter = true
  ): void => {
    if (h === undefined || a === undefined) return;
    const raw = higherIsBetter ? (h - a) / scale : (a - h) / scale;
    weightedScores.push({ w: weight, v: clamp(raw, -1, 1) });
  };

  if (sport === "NBA") {
    // Off/def rating gap is the single strongest NBA predictor.
    // Net rating diff (offRtg - defRtg) represents true team quality.
    // Give the combined off+def rating gap 40% of the total score weight.
    if (
      home.offensiveRating !== undefined && home.defensiveRating !== undefined &&
      away.offensiveRating !== undefined && away.defensiveRating !== undefined
    ) {
      const homeNetRtg = home.offensiveRating - home.defensiveRating;
      const awayNetRtg = away.offensiveRating - away.defensiveRating;
      // Net rating diff: a 10-point gap is dominant
      const netDiff = clamp((homeNetRtg - awayNetRtg) / 10, -1, 1);
      weightedScores.push({ w: 0.40, v: netDiff });
    } else {
      // Fall back to individual ratings if both aren't available
      addMetric(home.offensiveRating, away.offensiveRating, 10, 0.20);
      addMetric(home.defensiveRating, away.defensiveRating, 10, 0.20, false);
    }
    // Efficiency metrics: eFG% and TS% are high-quality shooting efficiency signals
    addMetric(home.effectiveFGPct, away.effectiveFGPct, 0.05, 0.35); // highest efficiency weight
    addMetric(home.trueShootingPct, away.trueShootingPct, 0.05, 0.25);
    // Pace: lower weight — it's a style metric more than a quality signal
    addMetric(home.pace, away.pace, 5, 0.00); // weight 0 — pace alone doesn't predict wins
  }

  if (sport === "NFL" || sport === "NCAAF") {
    // Yards per play is the most efficient single NFL predictor (efficiency metric)
    addMetric(home.yardsPerPlay, away.yardsPerPlay, 1.0, 0.40);
    // Turnover differential is a strong predictor (mix of luck + skill)
    addMetric(home.turnoverDifferential, away.turnoverDifferential, 5, 0.35);
    // Third-down conversion is a quality/efficiency metric
    addMetric(home.thirdDownConvPct, away.thirdDownConvPct, 0.10, 0.25);
  }

  if (sport === "MLB") {
    // ERA is the most predictive pitching metric
    addMetric(home.teamERA, away.teamERA, 1.0, 0.35, false);
    // WHIP closely related to ERA but captures walks differently
    addMetric(home.whip, away.whip, 0.2, 0.25, false);
    // OPS is the key offensive efficiency metric
    addMetric(home.ops, away.ops, 0.05, 0.30);
    // Batting average is less predictive than OPS but still informative
    addMetric(home.battingAverage, away.battingAverage, 0.02, 0.10);
  }

  if (sport === "NHL") {
    // Save percentage is the #1 goaltending/defensive metric
    addMetric(home.savePercentage, away.savePercentage, 0.015, 0.40);
    // Special teams: power play and penalty kill are huge in NHL
    addMetric(home.powerPlayPct, away.powerPlayPct, 0.05, 0.30);
    addMetric(home.penaltyKillPct, away.penaltyKillPct, 0.05, 0.20);
    // Shots per game: volume metric, lower weight
    addMetric(home.shotsPerGame, away.shotsPerGame, 3, 0.10);
  }

  if (weightedScores.length === 0) return 0;

  // Weighted average — normalize by actual total weight used (not all metrics may be available)
  const totalWeight = weightedScores.reduce((s, x) => s + x.w, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = weightedScores.reduce((s, x) => s + x.w * x.v, 0);
  return clamp(weightedSum / totalWeight, -1, 1);
}

// ─── Ensemble sub-models ─────────────────────────────────────────────────────

export interface SubModelResult {
  homeWinProb: number; // 0–100
  confidence: number;  // 50–100
}

export interface EnsembleResult {
  homeWinProb: number;       // final ensemble probability 0–100
  confidence: number;        // final ensemble confidence 50–100
  divergenceFlag: boolean;   // true when ≥2 sub-models disagree on winner
  subModels: {
    eloOnly: SubModelResult;
    recentForm: SubModelResult;
    composite: SubModelResult;
  };
}

/**
 * Sub-model A: Elo-only
 * Pure Elo expected score with home advantage applied. No form, no injury.
 */
function eloOnlyModel(homeElo: number, awayElo: number, sport: string): SubModelResult {
  const { homeWinProb } = getEloPrediction(homeElo, awayElo, sport);
  const prob100 = clamp(Math.round(homeWinProb * 100), 8, 92);
  // Confidence = how far from 50, dampened — Elo alone is moderate signal
  const rawConf = 50 + Math.abs(prob100 - 50) * 0.55;
  return { homeWinProb: prob100, confidence: clamp(Math.round(rawConf), 50, 80) };
}

/**
 * Sub-model B: Recent Form only
 * Combines last-10 win rate, scoring differential, and streak.
 * Does NOT use record, Elo, injuries, advanced metrics, or home/away splits.
 */
function recentFormModel(
  homeForm: Pick<TeamRecentForm, "formString" | "avgScore" | "avgAllowed" | "streak">,
  awayForm:  Pick<TeamRecentForm, "formString" | "avgScore" | "avgAllowed" | "streak">
): SubModelResult {
  // Win rate from L10 form string (count Ws)
  function formWinRate(fs: string): number {
    if (!fs) return 0.5;
    const games = fs.split("-").filter((x) => x === "W" || x === "L");
    if (games.length === 0) return 0.5;
    return games.filter((x) => x === "W").length / games.length;
  }

  const homeWR = formWinRate(homeForm.formString);
  const awayWR  = formWinRate(awayForm.formString);

  // Net point differential advantage (normalise to [-1, 1] assuming max meaningful diff ~15)
  const homeNetPts = homeForm.avgScore - homeForm.avgAllowed;
  const awayNetPts  = awayForm.avgScore  - awayForm.avgAllowed;
  const ptsDiff = clamp((homeNetPts - awayNetPts) / 15, -1, 1);

  // Streak advantage: each game in streak = 0.05, capped at ±0.3
  const streakAdv = clamp((homeForm.streak - awayForm.streak) * 0.05, -0.3, 0.3);

  // Weighted composite (win rate carries most weight)
  const wrAdv    = clamp(homeWR - awayWR, -0.5, 0.5) * 2; // scale to [-1, 1]
  const rawScore = 0.55 * wrAdv + 0.30 * ptsDiff + 0.15 * streakAdv;

  const rawProb = 1 / (1 + Math.exp(-rawScore * 4));
  const prob100 = clamp(Math.round(rawProb * 100), 8, 92);

  // Recent form is moderate-reliability signal; dampen confidence similarly to composite
  const rawConf = 50 + Math.abs(prob100 - 50) * 0.50;
  return { homeWinProb: prob100, confidence: clamp(Math.round(rawConf), 50, 80) };
}

const ENSEMBLE_WEIGHTS: Record<string, { composite: number; elo: number; form: number }> = {
  NBA:   { composite: 0.55, elo: 0.25, form: 0.20 },
  NFL:   { composite: 0.50, elo: 0.20, form: 0.30 },
  NCAAF: { composite: 0.50, elo: 0.25, form: 0.25 },
  NCAAB: { composite: 0.50, elo: 0.30, form: 0.20 },
  MLB:   { composite: 0.60, elo: 0.15, form: 0.25 },
  NHL:   { composite: 0.50, elo: 0.20, form: 0.30 },
  MLS:   { composite: 0.55, elo: 0.25, form: 0.20 },
  EPL:   { composite: 0.55, elo: 0.25, form: 0.20 },
};

/**
 * Combine three sub-models into a single ensemble prediction.
 * Weights: composite 0.6, eloOnly 0.2, recentForm 0.2
 * Divergence penalty: –10 confidence points when ≥2 sub-models disagree on winner.
 */
function ensemblePrediction(
  composite:   SubModelResult,
  eloOnly:     SubModelResult,
  recentForm:  SubModelResult,
  sport: string = "NBA"
): EnsembleResult {
  const ew = ENSEMBLE_WEIGHTS[sport] ?? { composite: 0.55, elo: 0.25, form: 0.20 };
  const W_COMPOSITE   = ew.composite;
  const W_ELO         = ew.elo;
  const W_RECENT_FORM = ew.form;

  const ensembleProb = Math.round(
    composite.homeWinProb   * W_COMPOSITE +
    eloOnly.homeWinProb     * W_ELO +
    recentForm.homeWinProb  * W_RECENT_FORM
  );

  const rawEnsembleConf =
    composite.confidence   * W_COMPOSITE +
    eloOnly.confidence     * W_ELO +
    recentForm.confidence  * W_RECENT_FORM;

  // Count sub-model winner picks
  const compositePickHome   = composite.homeWinProb   >= 50;
  const eloPickHome         = eloOnly.homeWinProb     >= 50;
  const recentFormPickHome  = recentForm.homeWinProb  >= 50;

  const homePicks = [compositePickHome, eloPickHome, recentFormPickHome].filter(Boolean).length;
  const divergenceFlag = homePicks !== 3 && homePicks !== 0; // not unanimous

  // Compute divergence magnitude from sub-model probability spread
  const probs = [composite.homeWinProb, eloOnly.homeWinProb, recentForm.homeWinProb];
  const mean = probs.reduce((s, p) => s + p, 0) / 3;
  const stdDev = Math.sqrt(probs.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / 3);
  const divergenceMagnitude = clamp(stdDev / 30, 0, 1);
  const confidencePenalty = divergenceFlag
    ? Math.round(divergenceMagnitude * 15)
    : Math.round(divergenceMagnitude * 5);
  const sportCeiling = (SPORT_CALIBRATION[sport] ?? { ceiling: 87 }).ceiling;
  const finalConf = clamp(Math.round(rawEnsembleConf) - confidencePenalty, 50, sportCeiling);

  return {
    homeWinProb:   clamp(ensembleProb, 8, 92),
    confidence:    finalConf,
    divergenceFlag,
    subModels: {
      eloOnly,
      recentForm,
      composite,
    },
  };
}

// ─── Main prediction function ────────────────────────────────────────────────

export async function generatePrediction(
  game: Game,
  marketSpread?: number,
  marketOverUnder?: number
): Promise<Prediction> {
  const sportKey = game.sport.toString();

  // ── Expanded parallel data fetching ─────────────────────────────────────
  const [homeForm, awayForm, homeExtended, awayExtended, homeInjuries, awayInjuries, homeAdvanced, awayAdvanced, homeLineup, awayLineup, weatherData] =
    await Promise.all([
      fetchTeamRecentForm(game.homeTeam.id, sportKey),
      fetchTeamRecentForm(game.awayTeam.id, sportKey),
      fetchTeamExtendedStats(game.homeTeam.id, sportKey, game.awayTeam.id, new Date(game.dateTime)),
      fetchTeamExtendedStats(game.awayTeam.id, sportKey, game.homeTeam.id, new Date(game.dateTime)),
      fetchTeamInjuries(game.homeTeam.id, sportKey),
      fetchTeamInjuries(game.awayTeam.id, sportKey),
      fetchAdvancedMetrics(game.homeTeam.id, sportKey),
      fetchAdvancedMetrics(game.awayTeam.id, sportKey),
      fetchStartingLineup(game.homeTeam.id, sportKey, new Date(game.dateTime)),
      fetchStartingLineup(game.awayTeam.id, sportKey, new Date(game.dateTime)),
      fetchGameWeather(game.venue, new Date(game.dateTime), sportKey),
    ]);

  // ── Elo initialization from full season schedule data ───────────────────
  // Fetch full season results for proper Elo building (not just H2H)
  const [homeSeasonResults, awaySeasonResults] = await Promise.all([
    fetchTeamSeasonResults(game.homeTeam.id, sportKey),
    fetchTeamSeasonResults(game.awayTeam.id, sportKey),
  ]);

  // Combine both teams' games into a single list tagged with their teamId,
  // then replay the entire set chronologically in one in-memory pass.
  // Compute margin = |winner score - loser score| for MOV-adjusted K-factors.
  const allTeamGames = [
    ...homeSeasonResults.map((g) => ({
      teamId: game.homeTeam.id,
      opponentId: g.opponentId,
      won: g.won,
      isDraw: g.isDraw,
      date: g.date,
      margin: g.teamScore !== undefined && g.oppScore !== undefined
        ? Math.abs(g.teamScore - g.oppScore)
        : undefined,
    })),
    ...awaySeasonResults.map((g) => ({
      teamId: game.awayTeam.id,
      opponentId: g.opponentId,
      won: g.won,
      isDraw: g.isDraw,
      date: g.date,
      margin: g.teamScore !== undefined && g.oppScore !== undefined
        ? Math.abs(g.teamScore - g.oppScore)
        : undefined,
    })),
  ];

  // ── SRS computation (uses signed margins for proper SRS math) ───────────
  const srsGames: GameResultForSRS[] = [
    ...homeSeasonResults.map((g) => ({
      teamId: game.homeTeam.id,
      opponentId: g.opponentId,
      teamScore: g.teamScore,
      oppScore: g.oppScore,
    })),
    ...awaySeasonResults.map((g) => ({
      teamId: game.awayTeam.id,
      opponentId: g.opponentId,
      teamScore: g.teamScore,
      oppScore: g.oppScore,
    })),
  ];
  const srsRatings = getSRSRatings(sportKey, srsGames);


  const eloRatings = await initializeEloFromSchedule(sportKey, allTeamGames);

  const homeEloRating = eloRatings.get(game.homeTeam.id) ?? DEFAULT_RATING;
  const awayEloRating = eloRatings.get(game.awayTeam.id) ?? DEFAULT_RATING;

  const eloPrediction = getEloPrediction(homeEloRating, awayEloRating, sportKey);
  const eloHomeWinProb = eloPrediction.homeWinProb;
  const eloAwayWinProb = eloPrediction.awayWinProb;

  // ── Early season dampening ───────────────────────────────────────────────
  const seasonTotal = SEASON_TOTAL_GAMES[sportKey] ?? 30;
  const homeGamesPlayed = game.homeTeam.record.wins + game.homeTeam.record.losses + (game.homeTeam.record.ties || 0);
  const awayGamesPlayed = game.awayTeam.record.wins + game.awayTeam.record.losses + (game.awayTeam.record.ties || 0);
  const avgGamesPlayed = (homeGamesPlayed + awayGamesPlayed) / 2;
  const seasonProgress = avgGamesPlayed / seasonTotal;

  let seasonDampening: number;
  if (seasonProgress < 0.2) {
    seasonDampening = 0.6;
  } else if (seasonProgress < 0.4) {
    seasonDampening = 0.8;
  } else {
    seasonDampening = 1.0;
  }

  // ── Get sport-specific weights ──────────────────────────────────────────
  const weights = getWeightsForSport(sportKey);

  // ── Factor 1: Win % differential ───────────────────────────────────────
  const homeWinPct = getWinPercentage(game.homeTeam);
  const awayWinPct = getWinPercentage(game.awayTeam);
  const winPctDiff = homeWinPct - awayWinPct; // positive = home better
  const winPctHomeScore = clamp(winPctDiff * 2.5, -1, 1);
  const winPctAwayScore = -winPctHomeScore;

  const winPctFactor: PredictionFactor = {
    name: "Win % Differential",
    weight: weights.winPct,
    homeScore: winPctHomeScore,
    awayScore: winPctAwayScore,
    description: `Home ${(homeWinPct * 100).toFixed(0)}% vs Away ${(awayWinPct * 100).toFixed(0)}% season win rate`,
  };

  // ── Factor 2: Recent form – last 10 ────────────────────────────────────
  const homeFormScore = formScore(homeForm);
  const awayFormScore = formScore(awayForm);

  const recentFormFactor: PredictionFactor = {
    name: "Recent Form (L10)",
    weight: weights.recentForm,
    homeScore: homeFormScore,
    awayScore: awayFormScore,
    description: `Home L10: ${homeForm.formString || "N/A"} | Away L10: ${awayForm.formString || "N/A"}`,
  };

  // ── Factor 3: Point differential ───────────────────────────────────────
  const homePtDiff = homeForm.avgScore - homeForm.avgAllowed;
  const awayPtDiff = awayForm.avgScore - awayForm.avgAllowed;
  // Adjust raw diff by strength of schedule before normalising.
  // SoS > 0.5 = harder schedule → inflate (reward), SoS < 0.5 = easier → deflate (penalise).
  // Uses SRS-blended SoS when available (same 0.6/0.4 blend as Factor 10).
  const homeSoSForPtDiff = (() => {
    const raw = homeExtended.strengthOfSchedule ?? 0.5;
    const srsRec = srsRatings.get(game.homeTeam.id);
    return srsRec && srsRec.gamesPlayed >= 3
      ? 0.6 * raw + 0.4 * srsToBlendfactor(srsRec.srs, sportKey)
      : raw;
  })();
  const awaySoSForPtDiff = (() => {
    const raw = awayExtended.strengthOfSchedule ?? 0.5;
    const srsRec = srsRatings.get(game.awayTeam.id);
    return srsRec && srsRec.gamesPlayed >= 3
      ? 0.6 * raw + 0.4 * srsToBlendfactor(srsRec.srs, sportKey)
      : raw;
  })();
  const homeAdjDiff = homePtDiff / (1 + (0.5 - homeSoSForPtDiff) * 0.5);
  const awayAdjDiff = awayPtDiff / (1 + (0.5 - awaySoSForPtDiff) * 0.5);
  const homePtScore = normalisePtDiff(homeAdjDiff, sportKey);
  const awayPtScore = normalisePtDiff(awayAdjDiff, sportKey);

  const ptDiffFactor: PredictionFactor = {
    name: "Point Differential",
    weight: weights.pointDiff,
    homeScore: homePtScore,
    awayScore: awayPtScore,
    description: `Home avg +${homePtDiff.toFixed(1)} (adj ${homeAdjDiff.toFixed(1)}) | Away avg +${awayPtDiff.toFixed(1)} (adj ${awayAdjDiff.toFixed(1)}) pts/game`,
  };

  // ── Factor 4: Streak ───────────────────────────────────────────────────
  const homeStreakScore = streakScore(homeForm.streak);
  const awayStreakScore = streakScore(awayForm.streak);

  const streakFactor: PredictionFactor = {
    name: "Current Streak",
    weight: weights.streak,
    homeScore: homeStreakScore,
    awayScore: awayStreakScore,
    description: `Home streak: ${homeForm.streak >= 0 ? "W" + homeForm.streak : "L" + Math.abs(homeForm.streak)} | Away streak: ${awayForm.streak >= 0 ? "W" + awayForm.streak : "L" + Math.abs(awayForm.streak)}`,
  };

  // ── Factor 5: Home/Away Split (actual records) ─────────────────────────
  const homeHomeGames = homeExtended.homeRecord.wins + homeExtended.homeRecord.losses;
  const homeHomeScore = homeHomeGames > 0
    ? clamp(((homeExtended.homeRecord.wins / homeHomeGames) - 0.5) * 2, -1, 1)
    : 0;

  const awayAwayGames = awayExtended.awayRecord.wins + awayExtended.awayRecord.losses;
  const awayAwayScore = awayAwayGames > 0
    ? clamp(((awayExtended.awayRecord.wins / awayAwayGames) - 0.5) * 2, -1, 1)
    : 0;

  const homeAwaySplitFactor: PredictionFactor = {
    name: "Home/Away Split",
    weight: weights.homeAwaySplit,
    homeScore: homeHomeScore,
    awayScore: awayAwayScore,
    description: `Home record at home: ${homeExtended.homeRecord.wins}-${homeExtended.homeRecord.losses} | Away record on road: ${awayExtended.awayRecord.wins}-${awayExtended.awayRecord.losses}`,
  };

  // ── Factor 6: Rest Days ────────────────────────────────────────────────
  const homeRestScore = restDaysScore(homeExtended.restDays);
  const awayRestScore = restDaysScore(awayExtended.restDays);

  const homeRestLabel = homeExtended.restDays === null
    ? "unknown"
    : homeExtended.restDays === 0
    ? "back-to-back"
    : `${homeExtended.restDays} day${homeExtended.restDays !== 1 ? "s" : ""} rest`;
  const awayRestLabel = awayExtended.restDays === null
    ? "unknown"
    : awayExtended.restDays === 0
    ? "back-to-back"
    : `${awayExtended.restDays} day${awayExtended.restDays !== 1 ? "s" : ""} rest`;

  const restDaysFactor: PredictionFactor = {
    name: "Rest Days",
    weight: weights.restDays,
    homeScore: homeRestScore,
    awayScore: awayRestScore,
    description: `Home team: ${homeRestLabel} | Away team: ${awayRestLabel}`,
  };

  // ── Factor 7: Scoring Trend ────────────────────────────────────────────
  const scoringTrendFactor: PredictionFactor = {
    name: "Scoring Trend",
    weight: weights.scoringTrend,
    homeScore: clamp(homeExtended.scoringTrend, -1, 1),
    awayScore: clamp(awayExtended.scoringTrend, -1, 1),
    description: `Home scoring trend: ${homeExtended.scoringTrend >= 0 ? "+" : ""}${homeExtended.scoringTrend.toFixed(2)} | Away: ${awayExtended.scoringTrend >= 0 ? "+" : ""}${awayExtended.scoringTrend.toFixed(2)}`,
  };

  // ── Factor 8: Defense Trend ────────────────────────────────────────────
  const defenseTrendFactor: PredictionFactor = {
    name: "Defense Trend",
    weight: weights.defenseTrend,
    homeScore: clamp(homeExtended.defenseTrend, -1, 1),
    awayScore: clamp(awayExtended.defenseTrend, -1, 1),
    description: `Home defense trend: ${homeExtended.defenseTrend >= 0 ? "+" : ""}${homeExtended.defenseTrend.toFixed(2)} | Away: ${awayExtended.defenseTrend >= 0 ? "+" : ""}${awayExtended.defenseTrend.toFixed(2)}`,
  };

  // ── Factor 9: Head-to-Head ─────────────────────────────────────────────
  // H2H from current season only — early season gives 0-2 matchups which is
  // pure noise. Require a minimum of 3 games before applying any signal, then
  // scale confidence with sample size: 3 games = 60%, 5+ games = 100%.
  const homeH2HWins = homeExtended.headToHeadResults.filter((g) => g.won).length;
  const homeH2HTotal = homeExtended.headToHeadResults.length;
  const H2H_MIN_GAMES = 3;
  const h2hSampleWeight = homeH2HTotal < H2H_MIN_GAMES ? 0 : Math.min(1, homeH2HTotal / 5);
  const homeH2HScore = homeH2HTotal >= H2H_MIN_GAMES
    ? clamp(((homeH2HWins / homeH2HTotal) - 0.5) * 2, -1, 1) * h2hSampleWeight
    : 0;
  const awayH2HScore = -homeH2HScore;

  const h2hFactor: PredictionFactor = {
    name: "Head-to-Head",
    weight: weights.headToHead,
    homeScore: homeH2HScore,
    awayScore: awayH2HScore,
    description: homeH2HTotal === 0
      ? "No head-to-head data this season"
      : homeH2HTotal < H2H_MIN_GAMES
      ? `${homeH2HTotal} matchup${homeH2HTotal !== 1 ? "s" : ""} (min ${H2H_MIN_GAMES} required — scored neutral)`
      : `Last ${homeH2HTotal} matchups: home won ${homeH2HWins}, away won ${homeH2HTotal - homeH2HWins} (${Math.round(h2hSampleWeight * 100)}% weight)`,
  };

  // ── Factor 10: Strength of Schedule ────────────────────────────────────
  // Blend win-pct SoS (existing) with SRS-based SoS (0.6 / 0.4 split).
  // If SRS data isn't available for a team, fall back to raw SoS unchanged.
  const homeSRSRecord = srsRatings.get(game.homeTeam.id);
  const awaySRSRecord = srsRatings.get(game.awayTeam.id);

  const homeSoSRaw = homeExtended.strengthOfSchedule;
  const awaySoSRaw = awayExtended.strengthOfSchedule;

  const homeSRSBlend = homeSRSRecord && homeSRSRecord.gamesPlayed >= 3
    ? srsToBlendfactor(homeSRSRecord.srs, sportKey)
    : null;
  const awaySRSBlend = awaySRSRecord && awaySRSRecord.gamesPlayed >= 3
    ? srsToBlendfactor(awaySRSRecord.srs, sportKey)
    : null;

  const homeSoSAdj = homeSRSBlend !== null
    ? 0.6 * homeSoSRaw + 0.4 * homeSRSBlend
    : homeSoSRaw;
  const awaySoSAdj = awaySRSBlend !== null
    ? 0.6 * awaySoSRaw + 0.4 * awaySRSBlend
    : awaySoSRaw;

  const homeSoSScore = clamp((homeSoSAdj - 0.5) * 4, -1, 1);
  const awaySoSScore = clamp((awaySoSAdj - 0.5) * 4, -1, 1);

  const srsSuffix = homeSRSBlend !== null
    ? ` | SRS: home ${homeSRSRecord!.srs.toFixed(1)}, away ${awaySRSRecord?.srs.toFixed(1) ?? "N/A"}`
    : "";

  const sosFactor: PredictionFactor = {
    name: "Strength of Schedule",
    weight: weights.strengthOfSchedule,
    homeScore: homeSoSScore,
    awayScore: awaySoSScore,
    description: `Home SoS: ${(homeSoSAdj * 100).toFixed(0)}% adj${srsSuffix} | Away SoS: ${(awaySoSAdj * 100).toFixed(0)}%`,
  };

  // ── Factor 11: Elo Rating ──────────────────────────────────────────────
  const eloHomeScore = (eloHomeWinProb - 0.5) * 2;
  const eloAwayScore = (eloAwayWinProb - 0.5) * 2;

  const eloFactor: PredictionFactor = {
    name: "Elo Rating",
    weight: weights.elo,
    homeScore: clamp(eloHomeScore, -1, 1),
    awayScore: clamp(eloAwayScore, -1, 1),
    description: `Home Elo: ${Math.round(homeEloRating)} (${(eloHomeWinProb * 100).toFixed(0)}% win prob) | Away Elo: ${Math.round(awayEloRating)} (${(eloAwayWinProb * 100).toFixed(0)}%)`,
  };

  // ── Factor 12: Injuries ────────────────────────────────────────────────
  const homeInjuryScore = weightedInjuryScore(homeInjuries, sportKey);
  const awayInjuryScore = weightedInjuryScore(awayInjuries, sportKey);

  const injuriesFactor: PredictionFactor = {
    name: "Injuries",
    weight: weights.injuries,
    homeScore: homeInjuryScore,
    awayScore: awayInjuryScore,
    description: `Home: ${homeInjuries.totalOut} out, ${homeInjuries.totalDoubtful} doubtful, ${homeInjuries.totalQuestionable} questionable | Away: ${awayInjuries.totalOut} out, ${awayInjuries.totalDoubtful} doubtful, ${awayInjuries.totalQuestionable} questionable`,
  };

  // ── Factor 12b: Starting Pitcher (MLB only) ────────────────────────────
  // The starting pitcher is the single most important variable in baseball.
  // When ESPN provides confirmed probable starters, compare their ERAs directly.
  // ERA scale: < 3.00 elite, 3.00–4.00 good, 4.00–5.00 average, > 5.00 poor.
  // Score = clamp((awayERA - homeERA) / 2, -1, 1) — home pitcher advantage is positive.
  let startingPitcherHomeScore = 0;
  let startingPitcherAwayScore = 0;
  let startingPitcherDesc = "No starting pitcher data available";

  if (sportKey === "MLB") {
    const homePitcher = homeLineup?.startingPitcher;
    const awayPitcher = awayLineup?.startingPitcher;

    if (homePitcher && awayPitcher && homePitcher.era !== undefined && awayPitcher.era !== undefined) {
      // Lower ERA is better → positive score for team with better (lower) ERA
      startingPitcherHomeScore = clamp((awayPitcher.era - homePitcher.era) / 2, -1, 1);
      startingPitcherAwayScore = -startingPitcherHomeScore;
      const homeLabel = `${homePitcher.name} (ERA ${homePitcher.era.toFixed(2)}${homePitcher.record ? ", " + homePitcher.record : ""})`;
      const awayLabel = `${awayPitcher.name} (ERA ${awayPitcher.era.toFixed(2)}${awayPitcher.record ? ", " + awayPitcher.record : ""})`;
      startingPitcherDesc = `Home SP: ${homeLabel} | Away SP: ${awayLabel}`;
    } else if (homePitcher && !awayPitcher) {
      startingPitcherHomeScore = 0.2; // slight edge for having known starter
      startingPitcherDesc = `Home SP: ${homePitcher.name}${homePitcher.era !== undefined ? " (ERA " + homePitcher.era.toFixed(2) + ")" : ""} | Away SP: TBD`;
    } else if (!homePitcher && awayPitcher) {
      startingPitcherAwayScore = 0.2;
      startingPitcherHomeScore = -0.2;
      startingPitcherDesc = `Home SP: TBD | Away SP: ${awayPitcher.name}${awayPitcher.era !== undefined ? " (ERA " + awayPitcher.era.toFixed(2) + ")" : ""}`;
    } else {
      startingPitcherDesc = "Probable starters not yet announced";
    }
  }

  const startingPitcherFactor: PredictionFactor = {
    name: "Starting Pitcher",
    weight: weights.startingPitcher,
    homeScore: startingPitcherHomeScore,
    awayScore: startingPitcherAwayScore,
    description: startingPitcherDesc,
  };

  // ── Factor 13: Advanced Metrics (sport-specific) ───────────────────────
  const advMetricScore = computeAdvancedMetricScore(homeAdvanced, awayAdvanced, sportKey);
  const advMetricHomeScore = advMetricScore;
  const advMetricAwayScore = -advMetricScore;

  // Build human-readable summary of which metrics were compared
  const advMetricParts: string[] = [];
  if (sportKey === "NBA") {
    if (homeAdvanced.offensiveRating !== undefined && awayAdvanced.offensiveRating !== undefined)
      advMetricParts.push(`offRtg ${homeAdvanced.offensiveRating.toFixed(1)} vs ${awayAdvanced.offensiveRating.toFixed(1)}`);
    if (homeAdvanced.defensiveRating !== undefined && awayAdvanced.defensiveRating !== undefined)
      advMetricParts.push(`defRtg ${homeAdvanced.defensiveRating.toFixed(1)} vs ${awayAdvanced.defensiveRating.toFixed(1)}`);
    if (homeAdvanced.effectiveFGPct !== undefined && awayAdvanced.effectiveFGPct !== undefined)
      advMetricParts.push(`eFG% ${(homeAdvanced.effectiveFGPct * 100).toFixed(1)} vs ${(awayAdvanced.effectiveFGPct * 100).toFixed(1)}`);
  } else if (sportKey === "NFL" || sportKey === "NCAAF") {
    if (homeAdvanced.yardsPerPlay !== undefined && awayAdvanced.yardsPerPlay !== undefined)
      advMetricParts.push(`yds/play ${homeAdvanced.yardsPerPlay.toFixed(1)} vs ${awayAdvanced.yardsPerPlay.toFixed(1)}`);
    if (homeAdvanced.turnoverDifferential !== undefined && awayAdvanced.turnoverDifferential !== undefined)
      advMetricParts.push(`TO diff ${homeAdvanced.turnoverDifferential > 0 ? "+" : ""}${homeAdvanced.turnoverDifferential} vs ${awayAdvanced.turnoverDifferential > 0 ? "+" : ""}${awayAdvanced.turnoverDifferential}`);
  } else if (sportKey === "MLB") {
    if (homeAdvanced.teamERA !== undefined && awayAdvanced.teamERA !== undefined)
      advMetricParts.push(`ERA ${homeAdvanced.teamERA.toFixed(2)} vs ${awayAdvanced.teamERA.toFixed(2)}`);
    if (homeAdvanced.ops !== undefined && awayAdvanced.ops !== undefined)
      advMetricParts.push(`OPS ${homeAdvanced.ops.toFixed(3)} vs ${awayAdvanced.ops.toFixed(3)}`);
  } else if (sportKey === "NHL") {
    if (homeAdvanced.savePercentage !== undefined && awayAdvanced.savePercentage !== undefined)
      advMetricParts.push(`SV% ${(homeAdvanced.savePercentage * 100).toFixed(1)} vs ${(awayAdvanced.savePercentage * 100).toFixed(1)}`);
    if (homeAdvanced.powerPlayPct !== undefined && awayAdvanced.powerPlayPct !== undefined)
      advMetricParts.push(`PP% ${(homeAdvanced.powerPlayPct * 100).toFixed(1)} vs ${(awayAdvanced.powerPlayPct * 100).toFixed(1)}`);
  }

  const advancedMetricsFactor: PredictionFactor = {
    name: "Advanced Metrics",
    weight: weights.advancedMetrics,
    homeScore: advMetricHomeScore,
    awayScore: advMetricAwayScore,
    description: advMetricParts.length > 0
      ? `Home vs Away — ${advMetricParts.join(" | ")}`
      : "No advanced metric data available for this sport",
  };

  // ── Factor 15: Weather (outdoor sports only) ──────────────────────────
  // Weather impacts scoring in NFL, NCAAF, MLB, MLS, EPL.
  // Heavy wind suppresses passing/scoring; cold temps reduce output;
  // rain/snow reduces both scoring and home advantage.
  // Score: negative = bad conditions hurt both teams (slight home advantage
  // as home fans/team are more accustomed), positive = neutral/favorable.
  let weatherHomeScore = 0;
  let weatherAwayScore = 0;
  let weatherDesc = "No weather data (indoor or unavailable)";

  if (weatherData && !weatherData.isDomed) {
    const { temperature, windSpeed, precipitation } = weatherData;

    // Wind penalty: >15mph starts hurting passing/kicking
    const windPenalty = windSpeed > 15 ? Math.min(0.6, (windSpeed - 15) / 20) : 0;

    // Cold penalty: <32°F hurts scoring
    const coldPenalty = temperature < 32 ? Math.min(0.4, (32 - temperature) / 30) : 0;

    // Precipitation penalty
    const precipPenalty = precipitation * 0.4;

    // Total conditions penalty (0 = perfect, up to ~1.0 = extreme)
    const totalPenalty = windPenalty + coldPenalty + precipPenalty;

    // Slight home advantage in bad weather (home team is more accustomed)
    // Only applies when conditions are actually bad
    if (totalPenalty > 0.1) {
      weatherHomeScore = Math.min(0.3, totalPenalty * 0.3);
      weatherAwayScore = -weatherHomeScore * 0.5; // visiting team hurt more
    }

    const conditionParts: string[] = [`${Math.round(temperature)}°F`, `${Math.round(windSpeed)}mph wind`];
    if (precipitation > 0.3) conditionParts.push(`${Math.round(precipitation * 100)}% precip`);
    weatherDesc = conditionParts.join(", ") + (totalPenalty > 0.2 ? " — adverse conditions" : " — favorable conditions");
  }

  const weatherFactor: PredictionFactor = {
    name: "Weather",
    weight: weights.weather,
    homeScore: weatherHomeScore,
    awayScore: weatherAwayScore,
    description: weatherDesc,
  };

  // ── Factor 16: Situational / Scheduling Context ────────────────────────
  const {
    homeScore: situationalHomeScore,
    awayScore: situationalAwayScore,
    description: situationalDesc,
  } = computeSituationalScore(
    homeExtended.restDays,
    awayExtended.restDays,
    homeExtended.consecutiveAwayGames,
    awayExtended.consecutiveAwayGames,
    sportKey
  );

  const situationalFactor: PredictionFactor = {
    name: "Situational",
    weight: weights.situational,
    homeScore: situationalHomeScore,
    awayScore: situationalAwayScore,
    description: situationalDesc,
  };

  // ── Factor 17: Referee/Umpire Tendency (placeholder — zero impact) ─────
  const { homeScore: refereeHomeScore, awayScore: refereeAwayScore } =
    computeRefereeTendencyScore();

  const refereeTendencyFactor: PredictionFactor = {
    name: "Referee Tendency",
    weight: weights.refereeTendency,
    homeScore: refereeHomeScore,
    awayScore: refereeAwayScore,
    description: "No referee data source integrated yet",
  };

  // ── Factor 18: Close-Game Clutch ────────────────────────────────────────
  const homeClutchScore = computeClutchScore(
    homeSeasonResults.map(g => ({ teamScore: g.teamScore, oppScore: g.oppScore, won: g.won })),
    sportKey
  );
  const awayClutchScore = computeClutchScore(
    awaySeasonResults.map(g => ({ teamScore: g.teamScore, oppScore: g.oppScore, won: g.won })),
    sportKey
  );
  const clutchFactor: PredictionFactor = {
    name: "Clutch Factor",
    weight: weights.clutchFactor,
    homeScore: homeClutchScore,
    awayScore: awayClutchScore,
    description: `Close-game performance — Home: ${homeClutchScore >= 0 ? "+" : ""}${homeClutchScore.toFixed(2)} | Away: ${awayClutchScore >= 0 ? "+" : ""}${awayClutchScore.toFixed(2)}`,
  };

  // ── Factor 19: Matchup Interaction ──────────────────────────────────────
  let matchupHomeEdge = 0;
  let matchupAwayEdge = 0;
  if (sportKey === "NBA" && homeAdvanced.offensiveRating !== undefined && homeAdvanced.defensiveRating !== undefined && awayAdvanced.offensiveRating !== undefined && awayAdvanced.defensiveRating !== undefined) {
    const homeOffVsAwayDef = (homeAdvanced.offensiveRating - awayAdvanced.defensiveRating) / 10;
    const awayOffVsHomeDef = (awayAdvanced.offensiveRating - homeAdvanced.defensiveRating) / 10;
    matchupHomeEdge = clamp((homeOffVsAwayDef - awayOffVsHomeDef) * 0.5, -1, 1);
    matchupAwayEdge = -matchupHomeEdge;
  } else if ((sportKey === "NFL" || sportKey === "NCAAF") && homeAdvanced.yardsPerPlay !== undefined && awayAdvanced.yardsPerPlay !== undefined) {
    const diff = (homeAdvanced.yardsPerPlay - awayAdvanced.yardsPerPlay) / 2;
    matchupHomeEdge = clamp(diff * 0.4, -1, 1);
    matchupAwayEdge = -matchupHomeEdge;
  }
  const matchupInteractionFactor: PredictionFactor = {
    name: "Matchup Interaction",
    weight: weights.matchupInteraction,
    homeScore: matchupHomeEdge,
    awayScore: matchupAwayEdge,
    description: matchupHomeEdge !== 0 ? `Off vs Def cross-matchup edge: ${matchupHomeEdge >= 0 ? "Home" : "Away"} ${Math.abs(matchupHomeEdge).toFixed(2)}` : "No matchup interaction data",
  };

  const spreadScaleByMart: Record<string, number> = {
    NFL: 14, NCAAF: 18, NBA: 15, NCAAB: 12,
    MLB: 2, NHL: 2, MLS: 1.5, EPL: 1.5,
  };
  const mktSpreadScale = spreadScaleByMart[sportKey] ?? 10;

  let mktHomeScore = 0;
  let mktAwayScore = 0;
  if (marketSpread !== undefined) {
    // Positive spread = home favored, negative = away favored
    mktHomeScore = clamp(marketSpread / mktSpreadScale, -1, 1);
    mktAwayScore = -mktHomeScore;
  }

  const marketLineFactor: PredictionFactor = {
    name: "Market Line",
    weight: 0,
    homeScore: mktHomeScore,
    awayScore: mktAwayScore,
    description: marketSpread !== undefined
      ? `Market spread: ${marketSpread > 0 ? "Home -" + Math.abs(marketSpread) : "Away -" + Math.abs(marketSpread)}`
      : "No market line available",
  };

  // ── Build factors array (15 total factors + market line) ────────────────
  const factors: PredictionFactor[] = [
    winPctFactor,
    recentFormFactor,
    ptDiffFactor,
    streakFactor,
    homeAwaySplitFactor,
    restDaysFactor,
    scoringTrendFactor,
    defenseTrendFactor,
    h2hFactor,
    sosFactor,
    eloFactor,
    injuriesFactor,
    startingPitcherFactor,
    advancedMetricsFactor,
    weatherFactor,
    situationalFactor,
    refereeTendencyFactor,
    clutchFactor,
    matchupInteractionFactor,
    marketLineFactor,
  ];

  // ── Weighted composite score (15 factors with sport-specific weights) ───
  // Create factor data with weight keys for dampening application
  const factorData: Array<{ key: keyof SportFactorWeights; homeScore: number; awayScore: number }> = [
    { key: "winPct", homeScore: winPctHomeScore, awayScore: winPctAwayScore },
    { key: "recentForm", homeScore: homeFormScore, awayScore: awayFormScore },
    { key: "pointDiff", homeScore: homePtScore, awayScore: awayPtScore },
    { key: "streak", homeScore: homeStreakScore, awayScore: awayStreakScore },
    { key: "homeAwaySplit", homeScore: homeHomeScore, awayScore: awayAwayScore },
    { key: "restDays", homeScore: homeRestScore, awayScore: awayRestScore },
    { key: "scoringTrend", homeScore: scoringTrendFactor.homeScore, awayScore: scoringTrendFactor.awayScore },
    { key: "defenseTrend", homeScore: defenseTrendFactor.homeScore, awayScore: defenseTrendFactor.awayScore },
    { key: "headToHead", homeScore: homeH2HScore, awayScore: awayH2HScore },
    { key: "strengthOfSchedule", homeScore: homeSoSScore, awayScore: awaySoSScore },
    { key: "elo", homeScore: eloFactor.homeScore, awayScore: eloFactor.awayScore },
    { key: "injuries", homeScore: homeInjuryScore, awayScore: awayInjuryScore },
    { key: "startingPitcher", homeScore: startingPitcherHomeScore, awayScore: startingPitcherAwayScore },
    { key: "advancedMetrics", homeScore: advMetricHomeScore, awayScore: advMetricAwayScore },
    { key: "weather", homeScore: weatherHomeScore, awayScore: weatherAwayScore },
    { key: "situational", homeScore: situationalHomeScore, awayScore: situationalAwayScore },
    { key: "refereeTendency", homeScore: refereeHomeScore, awayScore: refereeAwayScore },
    { key: "clutchFactor", homeScore: homeClutchScore, awayScore: awayClutchScore },
    { key: "matchupInteraction", homeScore: matchupHomeEdge, awayScore: matchupAwayEdge },
  ];

  // Factors that get early season dampening applied
  const dampenedFactors: Set<keyof SportFactorWeights> = new Set([
    "winPct",
    "homeAwaySplit",
    "strengthOfSchedule",
    "elo",
    "streak",
  ]);

  let homeWeightedSum = 0;
  let awayWeightedSum = 0;
  for (const f of factorData) {
    const weight = weights[f.key];
    const dampening = dampenedFactors.has(f.key) ? seasonDampening : 1.0;
    homeWeightedSum += weight * f.homeScore * dampening;
    awayWeightedSum += weight * f.awayScore * dampening;
  }

  // ── Winner and probabilities ────────────────────────────────────────────
  // homeWeightedSum is in [-1, 1]; use sigmoid for natural probability spread
  // More moderate scaling - prevents clustering at extremes
  const sigmoidScale = SIGMOID_SCALING[sportKey] ?? 4.5;
  const rawHomeProb = 1 / (1 + Math.exp(-homeWeightedSum * sigmoidScale));
  const rawAwayProb = 1 - rawHomeProb;
  // Scale to percentage
  const homeWinProbability = clamp(Math.round(rawHomeProb * 100), 8, 92);
  const awayWinProbability = 100 - homeWinProbability;

  const predictedWinner: "home" | "away" = homeWinProbability >= 50 ? "home" : "away";

  // ── Toss-up detection ───────────────────────────────────────────────────
  const isTossUp = Math.abs(homeWinProbability - 50) < 5;

  // ── Confidence ─────────────────────────────────────────────────────────
  const winnerProb = predictedWinner === "home" ? homeWinProbability : awayWinProbability;
  const cal = getCalibration(sportKey);
  // Power-curve dampening: stronger compression near 50%, weaker at extremes
  const deviation = winnerProb - 50;
  const curvedDeviation = Math.pow(Math.abs(deviation), 0.85) * cal.dampener;
  const calibratedWinnerProb = 50 + (deviation >= 0 ? curvedDeviation : -curvedDeviation);
  const calibratedConfidence = isTossUp
    ? clamp(Math.round(calibratedWinnerProb), 50, cal.tossUpCeiling)
    : clamp(Math.round(calibratedWinnerProb), 50, cal.ceiling);

  // ── Data coverage penalty (applied AFTER calibration) ──────────────────
  // Count factors that carry meaningful signal (non-zero for either team).
  // Zero-weight factors (refereeTendency, weather for indoor, etc.) are
  // excluded — they genuinely contribute nothing and shouldn't penalise coverage.
  const scoringFactors = factorData.filter((f) => weights[f.key] > 0);
  const factorsWithRealData = scoringFactors.filter(
    (f) => f.homeScore !== 0 || f.awayScore !== 0
  ).length;
  const dataCoverage = scoringFactors.length > 0
    ? factorsWithRealData / scoringFactors.length
    : 1.0;
  const lowDataWarning = dataCoverage < 0.6;

  // Compress confidence toward 50% proportionally to missing data.
  // Full data (1.0) → no compression. Half data (0.5) → 50% compression.
  // Floor of 0.5 ensures we never compress more than 50% even with zero data.
  const coverageMultiplier = Math.max(0.4, Math.pow(dataCoverage, 1.5));
  const confidence = clamp(
    Math.round(50 + (calibratedConfidence - 50) * coverageMultiplier),
    50,
    isTossUp ? cal.tossUpCeiling : cal.ceiling
  );

  // ── Ensemble architecture ───────────────────────────────────────────────
  // Run two lightweight sub-models independently, then combine with the
  // composite model (current full model output) to form a final ensemble.
  const compositeSubModel: SubModelResult = { homeWinProb: homeWinProbability, confidence };
  const eloSubModel    = eloOnlyModel(homeEloRating, awayEloRating, sportKey);
  const formSubModel   = recentFormModel(homeForm, awayForm);
  const ensemble       = ensemblePrediction(compositeSubModel, eloSubModel, formSubModel, sportKey);

  // Apply ensemble divergence penalty on top of the existing confidence
  const postEnsembleConf = ensemble.divergenceFlag
    ? clamp(confidence - 10, 50, isTossUp ? cal.tossUpCeiling : cal.ceiling)
    : confidence;
  // Lineup confirmation modifier: unconfirmed lineups = uncertainty tax
  const lineupPenalties: Record<string, number> = { MLB: -8, NFL: -6, NBA: -4, NHL: -5, NCAAB: -3, NCAAF: -4, MLS: -3, EPL: -3 };
  const maxLineupPenalty = lineupPenalties[sportKey] ?? -4;
  let lineupPenalty = 0;
  if (!homeLineup || homeLineup.starters.length === 0) lineupPenalty += maxLineupPenalty / 2;
  if (!awayLineup || awayLineup.starters.length === 0) lineupPenalty += maxLineupPenalty / 2;
  const finalConfidence = clamp(
    Math.round(postEnsembleConf + lineupPenalty),
    50,
    isTossUp ? cal.tossUpCeiling : cal.ceiling
  );

  // Derive spread from win probability using sport-specific margin distributions
  const MARGIN_SIGMA: Record<string, number> = {
    NBA: 12.5, NFL: 13.8, NCAAF: 17.0, NCAAB: 11.0, MLB: 3.2, NHL: 2.1, MLS: 1.4, EPL: 1.4,
  };
  const sigma = MARGIN_SIGMA[sportKey] ?? 10;
  const spreadProb = clamp(homeWinProbability / 100, 0.05, 0.95);
  const t = spreadProb < 0.5 ? spreadProb : 1 - spreadProb;
  const spreadSign = spreadProb < 0.5 ? -1 : 1;
  const inner = Math.sqrt(-2 * Math.log(t));
  const z = spreadSign * (inner - (2.515517 + 0.802853 * inner + 0.010328 * inner * inner) / (1 + 1.432788 * inner + 0.189269 * inner * inner + 0.001308 * inner * inner * inner));
  const predictedSpread = roundHalf(z * sigma / 1.8);

  // ── Market spread / over-under ─────────────────────────────────────────
  const marketFavorite: "home" | "away" =
    marketSpread !== undefined ? (marketSpread >= 0 ? "home" : "away") : predictedWinner;

  const overUnder =
    marketOverUnder ??
    (() => {
      const base = SPORT_OVER_UNDER_BASELINES[sportKey] ?? 100;
      // Adjust slightly based on scoring averages from recent form
      const homeAvg = homeForm.avgScore > 0 ? homeForm.avgScore : base / 2;
      const awayAvg = awayForm.avgScore > 0 ? awayForm.avgScore : base / 2;
      const combined = homeAvg + awayAvg;
      // If we have real data use it, otherwise fall back to base
      return combined > 0 ? roundHalf(combined) : base;
    })();

  // ── Edge and value ratings ─────────────────────────────────────────────
  const edgeRating = calcEdgeRating(finalConfidence);
  const valueRating = calcValueRating(predictedSpread, marketSpread, sportKey);

  // ── AI analysis ────────────────────────────────────────────────────────
  const { text: aiAnalysis, aiAgreesWithModel } = await generateAIAnalysis(
    game,
    factors,
    homeForm,
    awayForm,
    homeExtended,
    awayExtended,
    homeInjuries,
    awayInjuries,
    homeEloRating,
    awayEloRating,
    isTossUp,
    homeLineup,
    awayLineup,
    predictedWinner,
    finalConfidence,
    weatherData,
    dataCoverage
  );

  // ── Save calibration record (create-once, never overwrite) ────────────
  // The first prediction for a game is the authoritative record used for
  // accuracy tracking. Subsequent views re-compute for display but must not
  // overwrite the stored pick — that would corrupt calibration data.
  const _gameId = game.id;
  const _sport = sportKey;
  const _predictedWinner = predictedWinner;
  const _confidence = finalConfidence;
  const _isTossUp = isTossUp;
  const _homeElo = homeEloRating;
  const _awayElo = awayEloRating;
  enqueueWrite(async () => {
    const existing = await prisma.predictionResult.findUnique({ where: { gameId: _gameId } });
    if (existing) return; // already recorded — never overwrite
    await prisma.predictionResult.create({
      data: {
        gameId: _gameId,
        sport: _sport,
        predictedWinner: _predictedWinner,
        confidence: _confidence,
        isTossUp: _isTossUp,
        homeElo: _homeElo,
        awayElo: _awayElo,
        actualWinner: null,
        wasCorrect: null,
        resolvedAt: null,
      },
    });
  });

  return {
    gameId: game.id,
    predictedWinner,
    confidence: finalConfidence,
    aiAnalysis,
    aiAgreesWithModel,
    marketFavorite,
    spread: predictedSpread,
    overUnder,
    homeWinProbability,
    awayWinProbability,
    factors,
    edgeRating,
    valueRating,
    recentFormHome: homeForm.formString,
    recentFormAway: awayForm.formString,
    homeStreak: homeForm.streak,
    awayStreak: awayForm.streak,
    isTossUp,
    dataCoverage: Math.round(dataCoverage * 100) / 100,
    lowDataWarning,
    ensembleDivergence: ensemble.divergenceFlag,
    subModelProbs: {
      eloOnly:    ensemble.subModels.eloOnly.homeWinProb,
      recentForm: ensemble.subModels.recentForm.homeWinProb,
      composite:  ensemble.subModels.composite.homeWinProb,
    },
  };
}

// Shim: bustAIAnalysisCache was added after release-day in a later commit.
// Restored release-day engine does not implement it. AI cache still expires via TTL.
export function bustAIAnalysisCache(_gameId?: string) {}
