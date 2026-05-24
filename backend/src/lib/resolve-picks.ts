/**
 * Pick Resolution System
 * Checks unresolved picks against ESPN final scores and marks them win/loss.
 */

import { prisma } from "../prisma";
import { notifyPickResult, checkStreakMilestone, calculateWinStreak } from "./notification-jobs";
import { fetchWithTimeout } from "./fetch-with-timeout";

const ESPN_ENDPOINTS: Record<string, string> = {
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  MLS: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard",
  NCAAF: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
  NCAAB: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
  EPL: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
  UCL: "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard",
  IPL: "https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard",
};

const ESPN_TENNIS_SCOREBOARD = "https://www.espn.com/tennis/scoreboard/_/date";
const TENNIS_EXPLORER_BASE_URL = "https://www.tennisexplorer.com";
const TENNIS_EXPLORER_FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ClutchPicksBot/1.0)",
  "Accept": "text/html,application/xhtml+xml",
};

export interface FinalGameResult {
  gameId: string;
  homeScore: number;
  awayScore: number;
  isFinal: boolean;
}

type TeamResultHint = {
  homeTeam?: string | null;
  awayTeam?: string | null;
};

function normalizeTeamHint(value?: string | null): string | null {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}

function competitionMatchesTeamHint(
  competition: { competitors?: Array<{ homeAway?: string; team?: { abbreviation?: string; shortDisplayName?: string; displayName?: string; name?: string } }> },
  teamHint?: TeamResultHint,
): boolean {
  const homeHint = normalizeTeamHint(teamHint?.homeTeam);
  const awayHint = normalizeTeamHint(teamHint?.awayTeam);
  if (!homeHint || !awayHint) return false;

  const home = competition.competitors?.find((c) => c.homeAway === "home");
  const away = competition.competitors?.find((c) => c.homeAway === "away");
  const homeNames = [
    home?.team?.abbreviation,
    home?.team?.shortDisplayName,
    home?.team?.displayName,
    home?.team?.name,
  ].map(normalizeTeamHint);
  const awayNames = [
    away?.team?.abbreviation,
    away?.team?.shortDisplayName,
    away?.team?.displayName,
    away?.team?.name,
  ].map(normalizeTeamHint);

  return homeNames.includes(homeHint) && awayNames.includes(awayHint);
}

function sportsToSearch(sportHint?: string | null): string[] {
  const normalized = sportHint?.toUpperCase();
  const sports = Object.keys(ESPN_ENDPOINTS);
  if (!normalized || !ESPN_ENDPOINTS[normalized]) return sports;
  return [normalized, ...sports.filter((sport) => sport !== normalized)];
}

function datesAroundToday(): string[] {
  const today = new Date();
  const datesToSearch: string[] = [];
  for (let offset = -3; offset <= 1; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    datesToSearch.push(d.toISOString().split("T")[0]!);
  }
  return datesToSearch;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseEspnFitTennisState(html: string): any | null {
  const marker = /window\['__espnfitt__'\]\s*=\s*/.exec(html);
  if (!marker || marker.index === undefined) return null;

  const start = marker.index + marker[0].length;
  const end = html.indexOf(";</script>", start);
  const fallbackEnd = html.indexOf("</script>", start);
  const sliceEnd = end >= 0 ? end : fallbackEnd;
  if (sliceEnd < 0) return null;

  const raw = html.slice(start, sliceEnd).replace(/;\s*$/, "");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tennisLineValue(line: any): number | null {
  const parsed = Number(line?.v);
  return Number.isFinite(parsed) ? parsed : null;
}

function tennisSetScores(competitor: any): number[] {
  return (competitor?.lnescrs ?? [])
    .map((line: any) => tennisLineValue(line))
    .filter((value: number | null): value is number => value !== null);
}

function tennisSetsWon(competitor: any, opponent: any): number {
  const explicitSetWins = (competitor?.lnescrs ?? []).filter((line: any) => line?.w === true).length;
  if (explicitSetWins > 0) return explicitSetWins;

  const ownScores = tennisSetScores(competitor);
  const opponentScores = tennisSetScores(opponent);
  if (ownScores.length === 0 && opponentScores.length === 0) {
    if (competitor?.wnr === true) return 1;
    if (opponent?.wnr === true) return 0;
  }

  let sets = 0;
  for (let i = 0; i < Math.min(ownScores.length, opponentScores.length); i++) {
    if (ownScores[i]! > opponentScores[i]!) sets++;
  }
  return sets;
}

function finalTennisResultFromCompetition(gameId: string, competition: any): FinalGameResult | null {
  const status = competition?.status;
  const isFinal = String(status?.state ?? "").toLowerCase() === "post" || status?.completed === true;
  if (!isFinal) return null;

  const competitors = competition?.competitors ?? [];
  const home = competitors.find((c: any) => c?.homeAway === "home") ?? competitors[0];
  const away = competitors.find((c: any) => c?.homeAway === "away") ?? competitors.find((c: any) => c !== home);
  if (!home || !away) return null;

  return {
    gameId,
    homeScore: tennisSetsWon(home, away),
    awayScore: tennisSetsWon(away, home),
    isFinal: true,
  };
}

async function fetchEspnTennisGameResult(gameId: string): Promise<FinalGameResult | null> {
  for (const date of datesAroundToday()) {
    try {
      const url = `${ESPN_TENNIS_SCOREBOARD}/${date.replace(/-/g, "")}`;
      const res = await fetchWithTimeout(url, { timeoutMs: 25000 });
      if (!res.ok) continue;

      const html = await res.text();
      const state = parseEspnFitTennisState(html);
      const competitions = Object.values(state?.page?.content?.scoreboard?.competitions ?? {});
      const competition = competitions.find((c: any) => c?.id === gameId);
      if (!competition) continue;

      const result = finalTennisResultFromCompetition(gameId, competition);
      if (!result) {
        console.log(`[resolve-diag] gameId=${gameId} sport=TENNIS date=${date}: found event but not final`);
      }
      return result;
    } catch {
      // Try the next date.
    }
  }
  return null;
}

async function fetchTennisExplorerGameResult(gameId: string): Promise<FinalGameResult | null> {
  const sourceId = gameId.match(/^tennis-explorer-(\d+)$/)?.[1];
  if (!sourceId) return null;

  try {
    const res = await fetchWithTimeout(`${TENNIS_EXPLORER_BASE_URL}/match-detail/?id=${sourceId}`, {
      headers: TENNIS_EXPLORER_FETCH_HEADERS,
      timeoutMs: 25000,
    });
    if (!res.ok) return null;

    const html = await res.text();
    const scoreText = stripTags(html.match(/<td\b[^>]*class=["'][^"']*\bgScore\b[^"']*["'][^>]*>\s*<span>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/);
    if (!scoreMatch) return null;

    const homeScore = Number(scoreMatch[1]);
    const awayScore = Number(scoreMatch[2]);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
    if (Math.max(homeScore, awayScore) < 2) return null;

    return { gameId, homeScore, awayScore, isFinal: true };
  } catch {
    return null;
  }
}

// Fetch a specific game by ID from ESPN. Searches across all sports and ±3 days.
export async function fetchGameResult(gameId: string, sportHint?: string | null, teamHint?: TeamResultHint): Promise<FinalGameResult | null> {
  if (sportHint?.toUpperCase() === "TENNIS" || gameId.startsWith("tennis-explorer-")) {
    const tennisResult = gameId.startsWith("tennis-explorer-")
      ? await fetchTennisExplorerGameResult(gameId)
      : await fetchEspnTennisGameResult(gameId);
    return tennisResult;
  }

  for (const sport of sportsToSearch(sportHint)) {
    const baseUrl = ESPN_ENDPOINTS[sport]!;
    for (const date of datesAroundToday()) {
      try {
        const params = new URLSearchParams({ dates: date.replace(/-/g, "") });
        if (sport === "NCAAB") { params.set("groups", "50"); params.set("limit", "300"); }
        if (sport === "NCAAF") { params.set("groups", "80"); params.set("limit", "300"); }

        const res = await fetchWithTimeout(`${baseUrl}?${params.toString()}`, { timeoutMs: 25000 });
        if (!res.ok) continue;

        const data = await res.json() as { events?: Array<{
          id: string;
          competitions: Array<{
            competitors: Array<{ homeAway: string; score?: string }>;
            status: { type: { state: string; completed: boolean } };
          }>;
        }> };

        if (!data.events) continue;

        const event = data.events.find((e) => e.id === gameId)
          ?? data.events.find((e) => competitionMatchesTeamHint(e.competitions?.[0] ?? {}, teamHint));
        if (!event) continue;

        const competition = event.competitions[0];
        if (!competition) {
          console.log(`[resolve-diag] gameId=${gameId} sport=${sport} date=${date}: found event but no competition data`);
          return null;
        }

        const status = competition.status.type;
        const isFinal = status.state.toLowerCase() === "post" || status.completed;
        if (!isFinal) {
          console.log(`[resolve-diag] gameId=${gameId} sport=${sport} date=${date}: NOT FINAL state=${status.state} completed=${status.completed}`);
          return null; // Game exists but isn't final yet
        }

        const home = competition.competitors.find((c) => c.homeAway === "home");
        const away = competition.competitors.find((c) => c.homeAway === "away");
        if (!home || !away) {
          console.log(`[resolve-diag] gameId=${gameId} sport=${sport} date=${date}: missing home/away competitor`);
          return null;
        }

        const homeScore = parseInt(home.score ?? "0", 10);
        const awayScore = parseInt(away.score ?? "0", 10);
        if (isNaN(homeScore) || isNaN(awayScore)) {
          console.log(`[resolve-diag] gameId=${gameId} sport=${sport} date=${date}: NaN scores home="${home.score}" away="${away.score}"`);
          return null;
        }

        return { gameId, homeScore, awayScore, isFinal: true };
      } catch {
        // Skip this sport/date combo and keep searching
      }
    }
  }

  // Fallback: ESPN's per-game summary endpoint works for historical games
  // outside the ±3 day scoreboard window. Try every sport's summary path
  // until one returns a final result.
  for (const sport of Object.keys(ESPN_ENDPOINTS)) {
    const summaryUrl = ESPN_ENDPOINTS[sport]!.replace("/scoreboard", "/summary");
    try {
      const res = await fetchWithTimeout(`${summaryUrl}?event=${encodeURIComponent(gameId)}`, { timeoutMs: 25000 });
      if (!res.ok) continue;

      const data = await res.json() as {
        header?: {
          competitions?: Array<{
            competitors: Array<{ homeAway: string; score?: string | number }>;
            status?: { type?: { state?: string; completed?: boolean } };
          }>;
        };
      };

      const competition = data.header?.competitions?.[0];
      if (!competition) continue;

      const status = competition.status?.type;
      const isFinal = status?.state?.toLowerCase() === "post" || !!status?.completed;
      if (!isFinal) continue;

      const home = competition.competitors.find((c) => c.homeAway === "home");
      const away = competition.competitors.find((c) => c.homeAway === "away");
      if (!home || !away) continue;

      const homeScore = parseInt(String(home.score ?? "0"), 10);
      const awayScore = parseInt(String(away.score ?? "0"), 10);
      if (isNaN(homeScore) || isNaN(awayScore)) continue;

      console.log(`[resolve-diag] gameId=${gameId}: resolved via summary fallback (sport=${sport})`);
      return { gameId, homeScore, awayScore, isFinal: true };
    } catch {
      // Try next sport
    }
  }

  console.log(`[resolve-diag] gameId=${gameId}: NOT FOUND via scoreboard window or summary fallback`);
  return null;
}

// Determine win/loss for a pick given final scores
export function determineResult(
  pickedTeam: string,
  homeScore: number,
  awayScore: number
): "win" | "loss" | null {
  if (homeScore === awayScore) {
    return pickedTeam === "home" || pickedTeam === "away" ? "loss" : null;
  }
  const homeWon = homeScore > awayScore;
  if (pickedTeam === "home") return homeWon ? "win" : "loss";
  if (pickedTeam === "away") return homeWon ? "loss" : "win";
  return null;
}

export function actualOutcomeFromScore(homeScore: number, awayScore: number): "home" | "away" | "draw" {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "draw";
}

// Convert a stored PredictionResult row into the 3 model fields we denormalize
// onto UserPick at settlement. PredictionResult.homeWinProb is 0..1 and may be
// null on older rows — fall back to deriving from confidence + predictedWinner
// (which are always populated). Returns null when even those are missing.
export interface PredictionEnrichment {
  modelPredictedWinner: string;
  modelConfidence: number;
  modelHomeWinProb: number;
}

export function buildPredictionEnrichment(pred: {
  predictedWinner: string | null;
  confidence: number | null;
  homeWinProb: number | null;
} | null): PredictionEnrichment | null {
  if (!pred || pred.predictedWinner == null || pred.confidence == null) return null;
  const conf = Math.round(pred.confidence);
  const winner = pred.predictedWinner;
  const homeWinProb =
    pred.homeWinProb != null
      ? Math.round(pred.homeWinProb * 100)
      : winner === "home"
        ? conf
        : 100 - conf;
  return {
    modelPredictedWinner: winner,
    modelConfidence: conf,
    modelHomeWinProb: homeWinProb,
  };
}

// Main resolution function — resolves all pending picks
export async function resolvePicks(): Promise<{ resolved: number; skipped: number }> {
  let resolved = 0;
  let skipped = 0;
  let voided = 0;

  try {
    const unresolvedPicks = await prisma.userPick.findMany({
      where: { result: null },
      select: { id: true, gameId: true, pickedTeam: true, odId: true, homeTeam: true, awayTeam: true, sport: true },
    });

    // Also pull unresolved PredictionResult rows for calibration data (independent of user picks).
    // Only consider games whose prediction was created at least 30 min ago to allow them to finish.
    const calibrationCutoff = new Date(Date.now() - 30 * 60 * 1000);
    const unresolvedPredictions = await prisma.predictionResult.findMany({
      where: { actualWinner: null, createdAt: { lt: calibrationCutoff } },
      select: { gameId: true, sport: true, createdAt: true },
    });

    if (unresolvedPicks.length === 0 && unresolvedPredictions.length === 0) {
      return { resolved: 0, skipped: 0 };
    }

    // Union of all game IDs we need to check (user picks + calibration data)
    const uniqueGameIds = [...new Set([
      ...unresolvedPicks.map((p) => p.gameId),
      ...unresolvedPredictions.map((p) => p.gameId),
    ])];
    console.log(`[resolve-picks] Checking ${uniqueGameIds.length} unique games (${unresolvedPicks.length} user picks, ${unresolvedPredictions.length} calibration rows)`);
    const gameResultMap = new Map<string, FinalGameResult | null>();
    const gameSportHints = new Map<string, string>();
    const gameTeamHints = new Map<string, TeamResultHint>();
    for (const pick of unresolvedPicks) {
      if (pick.sport) gameSportHints.set(pick.gameId, pick.sport);
      if (pick.homeTeam && pick.awayTeam && !gameTeamHints.has(pick.gameId)) {
        gameTeamHints.set(pick.gameId, { homeTeam: pick.homeTeam, awayTeam: pick.awayTeam });
      }
    }
    for (const prediction of unresolvedPredictions) {
      if (!gameSportHints.has(prediction.gameId)) gameSportHints.set(prediction.gameId, prediction.sport);
    }
    const pickGameIdSet = new Set(unresolvedPicks.map((p) => p.gameId));
    const staleUnavailableCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const gameId of uniqueGameIds) {
      try {
        const result = await fetchGameResult(gameId, gameSportHints.get(gameId), gameTeamHints.get(gameId));
        gameResultMap.set(gameId, result);
      } catch (err) {
        console.error(`[resolve-picks] Error fetching game ${gameId}:`, err);
        gameResultMap.set(gameId, null);
      }
    }

    // Some scheduled/postponed/renumbered ESPN events disappear from the API
    // before ever becoming final. Keep those out of calibration, but close the
    // row so diagnostics and workers do not carry dead records forever.
    for (const prediction of unresolvedPredictions) {
      if (pickGameIdSet.has(prediction.gameId)) continue;
      if (prediction.createdAt >= staleUnavailableCutoff) continue;
      if (gameResultMap.get(prediction.gameId) !== null) continue;

      try {
        const result = await prisma.predictionResult.updateMany({
          where: {
            gameId: prediction.gameId,
            actualWinner: null,
            createdAt: { lt: staleUnavailableCutoff },
          },
          data: {
            actualWinner: "unavailable",
            actualOutcome: "unavailable",
            wasCorrect: null,
            resolvedAt: new Date(),
          },
        });
        if (result.count > 0) {
          voided += result.count;
          console.warn(`[resolve-picks] Voided stale unavailable PredictionResult for game ${prediction.gameId}`);
        }
      } catch (err) {
        console.error(`[resolve-picks] Error voiding stale PredictionResult for game ${prediction.gameId}:`, err);
      }
    }

    // Batch-fetch persisted predictions for every game we're about to resolve
    // a pick on. Used to denormalize the model's call onto the pick row so the
    // Profile UI can render Signature Calls without joining against allGames.
    const pickGameIds = unresolvedPicks.map((p) => p.gameId);
    let predictionMap = new Map<string, { predictedWinner: string; confidence: number; homeWinProb: number | null }>();
    if (pickGameIds.length > 0) {
      try {
        const predRows = await prisma.predictionResult.findMany({
          where: { gameId: { in: pickGameIds } },
          select: { gameId: true, predictedWinner: true, confidence: true, homeWinProb: true },
        });
        predictionMap = new Map(predRows.map((p) => [p.gameId, p]));
      } catch (err) {
        console.error(`[resolve-picks] Error batch-fetching predictions:`, err);
      }
    }

    // Now resolve each pick
    for (const pick of unresolvedPicks) {
      const gameResult = gameResultMap.get(pick.gameId);
      if (!gameResult || !gameResult.isFinal) {
        skipped++;
        continue;
      }

      const result = determineResult(pick.pickedTeam, gameResult.homeScore, gameResult.awayScore);
      if (!result) {
        skipped++;
        continue;
      }

      // Build enrichment payload — settlement always writes scores; model
      // fields only when a PredictionResult row exists for the game.
      const enrichment = buildPredictionEnrichment(predictionMap.get(pick.gameId) ?? null);
      const enriched = enrichment !== null;
      if (!enriched) {
        console.warn(`[resolve-picks] No prediction found for game ${pick.gameId} — settling pick ${pick.id} without model enrichment`);
      }

      try {
        await prisma.userPick.update({
          where: { id: pick.id },
          data: {
            result,
            finalHomeScore: gameResult.homeScore,
            finalAwayScore: gameResult.awayScore,
            ...(enrichment ?? {}),
          },
        });
        resolved++;
        console.log(`[resolve-picks] Resolved pick ${pick.id}: ${result}, enriched: ${enriched}`);

        // Notify user of resolved pick (in-app + push)
        const homeAbbr = pick.homeTeam ?? 'HOME';
        const awayAbbr = pick.awayTeam ?? 'AWAY';
        const teams = [awayAbbr, homeAbbr].filter(Boolean).join(" vs ");

        // In-app notification. Push is sent once by notifyPickResult below.
        const emoji = result === "win" ? "W" : "L";
        await prisma.appNotification.create({
          data: {
            userId: pick.odId,
            type: "pick_resolved",
            title: `Pick Result: ${emoji}`,
            body: `Your pick on ${teams || "a game"} was a ${result}!`,
            data: JSON.stringify({ gameId: pick.gameId }),
          },
        });

        // Rich push notification (deduped in notifyPickResult)
        notifyPickResult(pick.odId, pick.gameId, result, homeAbbr, awayAbbr);

        // Check if this win extends a streak worth celebrating
        if (result === 'win') {
          calculateWinStreak(pick.odId).then(streak => {
            checkStreakMilestone(pick.odId, streak);
          }).catch(() => {});
        }
      } catch (err) {
        console.error(`[resolve-picks] Error updating pick ${pick.id}:`, err);
        skipped++;
      }
    }

    // Update PredictionResult calibration records for all resolved games
    for (const gameId of uniqueGameIds) {
      const gameResult = gameResultMap.get(gameId);
      if (!gameResult || !gameResult.isFinal) continue;

      const actualOutcome = actualOutcomeFromScore(gameResult.homeScore, gameResult.awayScore);
      const actualWinner = actualOutcome;

      try {
        // Find unresolved PredictionResult rows for this game
        const records = await prisma.predictionResult.findMany({
          where: { gameId, actualWinner: null },
          select: { id: true, predictedWinner: true, predictedOutcome: true },
        });
        for (const rec of records) {
          const predictedOutcome = rec.predictedOutcome ?? rec.predictedWinner;
          await prisma.predictionResult.update({
            where: { id: rec.id },
            data: {
              actualWinner,
              actualOutcome,
              wasCorrect: predictedOutcome === actualOutcome,
              resolvedAt: new Date(),
            },
          });
        }
      } catch (err) {
        console.error(`[resolve-picks] Error updating PredictionResult for game ${gameId}:`, err);
        // Non-fatal — pick resolution continues unaffected
      }

      // Promote the most-recent pregame MarketSnapshot as the closing line.
      // The 30-min snapshot cron stops writing once a game kicks off, so the
      // latest fetchedAt is effectively the last line we saw before start.
      // Idempotent: if we already have an isClosing=true row, skip.
      await captureClosingLine(gameId);
    }
  } catch (err) {
    console.error("[resolve-picks] Fatal error during resolution:", err);
  }

  console.log(`[resolve-picks] Done: ${resolved} resolved, ${skipped} skipped, ${voided} voided`);
  return { resolved, skipped };
}

// ─── Closing-line helper ────────────────────────────────────────────────────
// Grabs the latest MarketSnapshot we have for `gameId` (set by the 30-min
// snapshot cron) and clones its fields into a new row flagged isClosing=true.
// This is the gold-standard reference for sharp accuracy: "how did our pick
// compare to the line right before kickoff?" Silently skips when no pregame
// snapshot exists (SHARPAPI_KEY unset, or cron hadn't run before kickoff).
async function captureClosingLine(gameId: string): Promise<void> {
  try {
    const existing = await prisma.marketSnapshot.findFirst({
      where: { gameId, isClosing: true },
      select: { id: true },
    });
    if (existing) return;

    const latest = await prisma.marketSnapshot.findFirst({
      where: { gameId, isClosing: false },
      orderBy: { fetchedAt: "desc" },
    });
    if (!latest) return;

    await prisma.marketSnapshot.create({
      data: {
        gameId: latest.gameId,
        sport: latest.sport,
        isClosing: true,
        pinnacleHomeNoVig: latest.pinnacleHomeNoVig,
        pinnacleAwayNoVig: latest.pinnacleAwayNoVig,
        pinnacleDrawNoVig: latest.pinnacleDrawNoVig,
        avgHomeProb: latest.avgHomeProb,
        avgAwayProb: latest.avgAwayProb,
        linesJson: latest.linesJson,
      },
    });
  } catch (err) {
    // Non-fatal — pick settlement already succeeded above.
    console.error(`[resolve-picks] captureClosingLine failed for ${gameId}:`, err);
  }
}

// Fire-and-forget wrapper — safe to call without awaiting
export function resolvePicksInBackground(): void {
  resolvePicks().catch((err) => {
    console.error("[resolve-picks] Background resolution failed:", err);
  });
}
