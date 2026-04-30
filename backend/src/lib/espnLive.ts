/**
 * ESPN per-game live-state fetcher.
 *
 * Uses the same `/summary?event={gameId}` endpoint as espnInjuries.ts and
 * pulls win-probability, situation, last play, leverage signals from it.
 *
 * Coverage:
 *   - NBA, MLB, NHL: ESPN exposes a usable winprobability array (sparkline
 *     + current home win % per play). Situation parsed from boxscore where
 *     present.
 *   - EPL, MLS, UCL: ESPN summary returns structure but no live win-prob
 *     for soccer. We return winProbability:null, sparkline:null and let the
 *     caller render a degraded "winProbabilityPlaceholder" box.
 *   - NFL/NCAA: ESPN does have a winprobability feed for some games but
 *     coverage is inconsistent. We treat it as unavailable and degrade the
 *     same way as soccer for now.
 *
 * Caching:
 *   - LIVE games: 30s TTL keyed by `${sport}:${gameId}:${scoreH}:${scoreA}:${period}`
 *     so a score change immediately invalidates and the next call refetches.
 *   - PRE / FINAL games: 5min TTL keyed by `${sport}:${gameId}` (the result
 *     and venue don't change often once the game is decided / scheduled).
 */

import { LRUCache } from "lru-cache";

// ─── ESPN sport slug mapping (must match espnInjuries.ts) ────────────────

const SPORT_PATHS: Record<string, string> = {
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  EPL: "soccer/eng.1",
  MLS: "soccer/usa.1",
  UCL: "soccer/uefa.champions",
};

// Sports for which ESPN exposes a live win-probability feed in /summary.
const WP_SPORTS = new Set(["NBA", "MLB", "NHL"]);

// ─── Types ───────────────────────────────────────────────────────────────

export type GameState = "pre" | "live" | "final";

export interface EspnLive {
  state: GameState;
  /**
   * Current home/away (and draw for soccer) win probability, 0..1.
   * null when ESPN doesn't publish a live WP feed for this sport/game.
   */
  winProbability: { home: number; away: number; draw?: number } | null;
  /**
   * Last 20 home-win-probability samples for a sparkline render.
   * null when WP feed is unavailable.
   */
  sparkline: number[] | null;
  /** Short human-readable game situation (e.g. "Bot 7th, 2 outs, runner on 1st"). */
  situation: string;
  /** Last play description as published by ESPN. Empty string when none. */
  lastPlay: string;
  /** Next-up signal — at-bat / scheduled lead, when available. */
  nextUp: { name: string; stat: string } | null;
  /** MLB Leverage Index. null when sport ≠ MLB or situation insufficient. */
  leverageIndex: number | null;
  /** Game venue, may be empty. */
  venue: string;
}

// ─── Cache ───────────────────────────────────────────────────────────────

const LIVE_TTL_MS = 30 * 1000;
const STATIC_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: EspnLive;
  timestamp: number;
  ttlMs: number;
}

const liveCache = new LRUCache<string, CacheEntry>({ max: 500 });

// ─── State derivation ────────────────────────────────────────────────────

function deriveState(statusState: string | undefined, completed: boolean): GameState {
  if (completed) return "final";
  const s = (statusState ?? "").toLowerCase();
  if (s === "in" || s === "live" || s === "halftime") return "live";
  return "pre";
}

// ─── MLB Leverage Index heuristic ────────────────────────────────────────

/**
 * Compute a Leverage Index (LI) heuristic for an MLB situation.
 *
 * LI is the swing in win expectancy a single PA can produce, scaled so the
 * average PA = 1.0. We don't have the full Tom Tango LI table available at
 * runtime, so this approximates with three multiplicative components:
 *
 *   1. Inning weight: late innings are higher leverage (1.0 in inning 1,
 *      ~3.5 in the 9th). Capped at 4.0 for extras.
 *   2. Score weight: a 1-run game is more leveraged than a 5-run blowout.
 *      base = max(0.2, 1.5 - 0.25 * |scoreDiff|).
 *   3. Base+out state: bases-loaded with no outs is much more leveraged
 *      than empty-bases-2-outs. We use a simple scoring grid:
 *        runners_on * 0.4 + (3 - outs) * 0.2  (range ~0.2 .. 1.8)
 *
 * Final LI = inningWeight * scoreWeight * stateWeight, clamped to [0, 8].
 *
 * Returns 0 when fed an invalid inning. Not a substitute for a real LI
 * table — used only as a directional "is this moment important" signal in
 * the live-intelligence box.
 */
export function leverageIndex(
  inning: number,
  scoreDiff: number,
  baserunners: { onFirst: boolean; onSecond: boolean; onThird: boolean },
  outs: number,
): number {
  if (!Number.isFinite(inning) || inning < 1) return 0;

  const inningWeight = Math.min(4.0, 1.0 + (inning - 1) * 0.35);
  const scoreWeight = Math.max(0.2, 1.5 - 0.25 * Math.abs(scoreDiff));
  const runnersOn =
    (baserunners.onFirst ? 1 : 0) +
    (baserunners.onSecond ? 1 : 0) +
    (baserunners.onThird ? 1 : 0);
  const safeOuts = Math.max(0, Math.min(3, outs));
  const stateWeight = 0.4 * runnersOn + 0.2 * (3 - safeOuts) + 0.2;

  const li = inningWeight * scoreWeight * stateWeight;
  return Math.max(0, Math.min(8, li));
}

// ─── Parsers ─────────────────────────────────────────────────────────────

function parseWinProbability(
  data: any,
  homeId: string,
  sport: string,
): { current: { home: number; away: number; draw?: number } | null; spark: number[] | null } {
  if (!WP_SPORTS.has(sport)) return { current: null, spark: null };

  const arr: any[] = Array.isArray(data?.winprobability) ? data.winprobability : [];
  if (arr.length === 0) return { current: null, spark: null };

  // Sparkline: last 20 home-win-probability values.
  const homeSeries = arr
    .map((p) => (typeof p?.homeWinPercentage === "number" ? p.homeWinPercentage : null))
    .filter((v): v is number => v !== null);
  const spark = homeSeries.length > 0 ? homeSeries.slice(-20) : null;

  const last = arr[arr.length - 1];
  const homeProb = typeof last?.homeWinPercentage === "number" ? last.homeWinPercentage : null;
  if (homeProb === null) return { current: null, spark };

  const clamped = Math.max(0, Math.min(1, homeProb));
  return { current: { home: clamped, away: 1 - clamped }, spark };
}

function parseSituation(data: any, sport: string): string {
  const s = data?.situation;
  if (!s) {
    const status = data?.header?.competitions?.[0]?.status?.type?.shortDetail;
    return typeof status === "string" ? status : "";
  }

  if (sport === "MLB") {
    const inning = s.inning ?? data?.header?.competitions?.[0]?.status?.period;
    const half = (s.inningHalf ?? "").toLowerCase();
    const outs = s.outs;
    const runners: string[] = [];
    if (s.onFirst) runners.push("1st");
    if (s.onSecond) runners.push("2nd");
    if (s.onThird) runners.push("3rd");
    const runnersStr = runners.length ? `, runner${runners.length > 1 ? "s" : ""} on ${runners.join("/")}` : ", bases empty";
    const halfStr = half === "top" ? "Top" : half === "bottom" ? "Bot" : "";
    return `${halfStr} ${inning ?? "?"}, ${outs ?? 0} out${outs === 1 ? "" : "s"}${runnersStr}`.trim();
  }

  if (typeof s.lastPlay?.text === "string") return s.lastPlay.text;
  const status = data?.header?.competitions?.[0]?.status?.type?.shortDetail;
  return typeof status === "string" ? status : "";
}

function parseLastPlay(data: any): string {
  const last =
    data?.situation?.lastPlay?.text ??
    data?.plays?.[data?.plays?.length - 1]?.text ??
    "";
  return typeof last === "string" ? last : "";
}

function parseNextUp(data: any, sport: string): { name: string; stat: string } | null {
  if (sport === "MLB") {
    const batter = data?.situation?.batter?.athlete?.fullName ?? data?.situation?.batter?.athlete?.displayName;
    const summary = data?.situation?.batter?.summary ?? data?.situation?.batter?.statistics;
    if (typeof batter === "string" && batter) {
      return { name: batter, stat: typeof summary === "string" ? summary : "" };
    }
  }
  return null;
}

function parseScoresAndPeriod(
  data: any,
): { homeScore: number; awayScore: number; period: number; homeId: string; awayId: string } {
  const comp = data?.header?.competitions?.[0];
  const competitors: any[] = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => c?.homeAway === "home");
  const away = competitors.find((c) => c?.homeAway === "away");
  const period = Number(comp?.status?.period ?? 0);
  return {
    homeScore: Number(home?.score ?? 0),
    awayScore: Number(away?.score ?? 0),
    period: Number.isFinite(period) ? period : 0,
    homeId: String(home?.team?.id ?? ""),
    awayId: String(away?.team?.id ?? ""),
  };
}

// ─── Public fetcher ──────────────────────────────────────────────────────

const EMPTY_LIVE: EspnLive = {
  state: "pre",
  winProbability: null,
  sparkline: null,
  situation: "",
  lastPlay: "",
  nextUp: null,
  leverageIndex: null,
  venue: "",
};

/**
 * Fetch the per-game live-intelligence snapshot. Never throws — always returns
 * a default EspnLive on any failure so the caller can render a degraded box.
 *
 * The cache key embeds the score+period so a goal/score change naturally
 * busts the entry without needing manual invalidation. We don't know the
 * score before the call, so we do a two-phase cache: a low-resolution
 * static-key entry holds the last result; the live-key entry layers on top
 * and short-circuits when nothing material has changed.
 */
export async function fetchEspnLive(sport: string, gameId: string): Promise<EspnLive> {
  const sportPath = SPORT_PATHS[sport];
  if (!sportPath) return EMPTY_LIVE;

  const staticKey = `${sport}:${gameId}`;
  const staticHit = liveCache.get(staticKey);
  if (staticHit && Date.now() - staticHit.timestamp < staticHit.ttlMs) {
    return staticHit.data;
  }

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${gameId}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      liveCache.set(staticKey, { data: EMPTY_LIVE, timestamp: Date.now(), ttlMs: STATIC_TTL_MS });
      return EMPTY_LIVE;
    }

    const data = (await response.json()) as any;
    const comp = data?.header?.competitions?.[0];
    const completed = Boolean(comp?.status?.type?.completed);
    const stateRaw = comp?.status?.type?.state;
    const state = deriveState(stateRaw, completed);

    const { homeScore, awayScore, period, homeId } = parseScoresAndPeriod(data);
    const wp = parseWinProbability(data, homeId, sport);
    const situation = parseSituation(data, sport);
    const lastPlay = parseLastPlay(data);
    const nextUp = parseNextUp(data, sport);

    let li: number | null = null;
    if (sport === "MLB" && state === "live") {
      const s = data?.situation;
      if (s) {
        const inning = Number(s.inning ?? comp?.status?.period ?? 0);
        const scoreDiff = homeScore - awayScore;
        li = leverageIndex(
          inning,
          scoreDiff,
          {
            onFirst: Boolean(s.onFirst),
            onSecond: Boolean(s.onSecond),
            onThird: Boolean(s.onThird),
          },
          Number(s.outs ?? 0),
        );
      }
    }

    const venue = typeof data?.gameInfo?.venue?.fullName === "string"
      ? data.gameInfo.venue.fullName
      : (typeof comp?.venue?.fullName === "string" ? comp.venue.fullName : "");

    const result: EspnLive = {
      state,
      winProbability: wp.current,
      sparkline: wp.spark,
      situation,
      lastPlay,
      nextUp,
      leverageIndex: li,
      venue,
    };

    const ttlMs = state === "live" ? LIVE_TTL_MS : STATIC_TTL_MS;
    const liveKey =
      state === "live"
        ? `${sport}:${gameId}:${homeScore}:${awayScore}:${period}`
        : staticKey;
    liveCache.set(staticKey, { data: result, timestamp: Date.now(), ttlMs });
    if (liveKey !== staticKey) {
      liveCache.set(liveKey, { data: result, timestamp: Date.now(), ttlMs });
    }
    return result;
  } catch (err) {
    console.warn(
      `[live] summary fetch failed for ${sport} game ${gameId}:`,
      err instanceof Error ? err.message : err,
    );
    liveCache.set(staticKey, { data: EMPTY_LIVE, timestamp: Date.now(), ttlMs: STATIC_TTL_MS });
    return EMPTY_LIVE;
  }
}
