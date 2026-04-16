/**
 * SharpAPI market-lines client.
 *
 * Feature-flagged on SHARPAPI_KEY — when unset, every function returns null
 * and the app runs fine without market data. Market numbers are NEVER used
 * as a prediction input (that would just be copying Vegas); they're a
 * post-prediction calibration anchor surfaced for UI display.
 *
 * Free-tier rate limit: 12 req/min. We throttle at 10/min via a token
 * bucket so upstream hiccups don't blow the budget.
 *
 * All errors swallowed → null. 8s timeout. 5-minute LRU cache (line
 * movement matters — don't over-cache).
 */

import { LRUCache } from "lru-cache";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MarketLine {
  sportsbook: string;
  homeAmerican: number;
  awayAmerican: number;
  homeDecimal: number;
  awayDecimal: number;
  homeImpliedProb: number;    // with vig
  awayImpliedProb: number;
  drawImpliedProb?: number;   // soccer only
  fetchedAt: string;          // ISO timestamp
}

export interface MarketConsensus {
  lines: MarketLine[];
  pinnacleLine: MarketLine | null; // sharp reference
  noVigHomeProb: number;           // de-vigged from Pinnacle when present
  noVigAwayProb: number;
  noVigDrawProb?: number;
  avgHomeProb: number;             // simple mean across books
  avgAwayProb: number;
}

// ─── Sport key mapping ─────────────────────────────────────────────────────
// Keep in sync with SharpAPI's documented league param.
const SPORT_TO_SHARPAPI: Record<string, string> = {
  NFL: "NFL",
  NBA: "NBA",
  MLB: "MLB",
  NHL: "NHL",
  NCAAF: "NCAAF",
  NCAAB: "NCAAB",
  EPL: "EPL",
  MLS: "MLS",
  UCL: "UCL",
};

// ─── Rate limiter (token bucket, 10 req/min) ────────────────────────────────

const MAX_PER_MINUTE = 10;
const REFILL_INTERVAL_MS = 60_000 / MAX_PER_MINUTE; // one token every 6s
let availableTokens = MAX_PER_MINUTE;
let lastRefillAt = Date.now();

function refillTokens() {
  const now = Date.now();
  const elapsed = now - lastRefillAt;
  if (elapsed <= 0) return;
  const gained = Math.floor(elapsed / REFILL_INTERVAL_MS);
  if (gained <= 0) return;
  availableTokens = Math.min(MAX_PER_MINUTE, availableTokens + gained);
  lastRefillAt += gained * REFILL_INTERVAL_MS;
}

function tryConsumeToken(): boolean {
  refillTokens();
  if (availableTokens <= 0) return false;
  availableTokens--;
  return true;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;
const consensusCache = new LRUCache<
  string,
  { data: MarketConsensus | null; timestamp: number }
>({ max: 500 });

// ─── Startup gate ───────────────────────────────────────────────────────────

let startupWarnLogged = false;

/**
 * Returns the API key, or null. Logs a single warning the first time it's
 * called with no key configured — quiet afterwards.
 */
function getApiKey(): string | null {
  const key = process.env.SHARPAPI_KEY;
  if (!key) {
    if (!startupWarnLogged) {
      console.warn(
        "[market] SHARPAPI_KEY not set — market lines disabled, model will run without market anchor",
      );
      startupWarnLogged = true;
    }
    return null;
  }
  return key;
}

// ─── De-vig helper (exported for tests) ─────────────────────────────────────

/**
 * De-vig a Pinnacle line using proportional normalization.
 *
 *   noVigHome = homeImplied / (homeImplied + awayImplied + drawImplied?)
 *
 * Sum of returned probs is always 1.0 to 6dp.
 */
export function devigPinnacle(line: MarketLine): {
  noVigHomeProb: number;
  noVigAwayProb: number;
  noVigDrawProb?: number;
} {
  const total =
    line.homeImpliedProb + line.awayImpliedProb + (line.drawImpliedProb ?? 0);
  if (total <= 0) {
    return { noVigHomeProb: 0.5, noVigAwayProb: 0.5 };
  }
  const noVigHomeProb = line.homeImpliedProb / total;
  const noVigAwayProb = line.awayImpliedProb / total;
  const noVigDrawProb =
    line.drawImpliedProb !== undefined
      ? line.drawImpliedProb / total
      : undefined;
  return { noVigHomeProb, noVigAwayProb, noVigDrawProb };
}

// ─── Response shape (defensive — SharpAPI may change) ───────────────────────

interface SharpAPIBook {
  sportsbook?: string;
  price_home_american?: number;
  price_away_american?: number;
  price_home_decimal?: number;
  price_away_decimal?: number;
  implied_home?: number;
  implied_away?: number;
  implied_draw?: number;
}

interface SharpAPIResponse {
  books?: SharpAPIBook[];
  lines?: SharpAPIBook[];
}

function impliedFromAmerican(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return -american / (-american + 100);
}

function mapBook(book: SharpAPIBook): MarketLine | null {
  const sportsbook = book.sportsbook;
  if (!sportsbook) return null;
  const homeAmerican = book.price_home_american;
  const awayAmerican = book.price_away_american;
  if (typeof homeAmerican !== "number" || typeof awayAmerican !== "number") return null;

  const homeDecimal =
    book.price_home_decimal ??
    (homeAmerican > 0 ? homeAmerican / 100 + 1 : 100 / -homeAmerican + 1);
  const awayDecimal =
    book.price_away_decimal ??
    (awayAmerican > 0 ? awayAmerican / 100 + 1 : 100 / -awayAmerican + 1);

  const homeImpliedProb = book.implied_home ?? impliedFromAmerican(homeAmerican);
  const awayImpliedProb = book.implied_away ?? impliedFromAmerican(awayAmerican);
  const drawImpliedProb = book.implied_draw;

  return {
    sportsbook,
    homeAmerican,
    awayAmerican,
    homeDecimal,
    awayDecimal,
    homeImpliedProb,
    awayImpliedProb,
    drawImpliedProb,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Public ────────────────────────────────────────────────────────────────

/**
 * Fetch a consensus snapshot for a single game. Returns null when:
 *   - SHARPAPI_KEY is unset
 *   - Rate limit exhausted
 *   - Upstream returns non-200 or malformed payload
 *   - Fewer than 2 books present (not a useful consensus)
 */
export async function fetchMarketConsensus(
  sport: string,
  homeTeam: string,
  awayTeam: string,
  gameTime: Date,
): Promise<MarketConsensus | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const league = SPORT_TO_SHARPAPI[sport];
  if (!league) return null;

  const cacheKey = `${league}|${homeTeam}|${awayTeam}|${gameTime.toISOString().slice(0, 16)}`;
  const cached = consensusCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  if (!tryConsumeToken()) {
    console.warn("[market] rate-limit: skipping SharpAPI request");
    return null;
  }

  const url = new URL("https://api.sharpapi.io/api/v1/odds");
  url.searchParams.set("league", league);
  url.searchParams.set("home", homeTeam);
  url.searchParams.set("away", awayTeam);
  url.searchParams.set("game_time", gameTime.toISOString());

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/json",
      },
    });
    if (!response.ok) {
      consensusCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const data = (await response.json()) as SharpAPIResponse;
    const rawBooks = data.books ?? data.lines ?? [];
    const lines: MarketLine[] = rawBooks
      .map(mapBook)
      .filter((x): x is MarketLine => x !== null);

    if (lines.length < 2) {
      consensusCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const consensus = buildConsensus(lines);
    consensusCache.set(cacheKey, { data: consensus, timestamp: Date.now() });
    return consensus;
  } catch (err) {
    console.warn("[market] fetch failed:", err instanceof Error ? err.message : err);
    consensusCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Assemble a MarketConsensus from raw book lines. Exported so tests can
 * pass in synthetic lines without stubbing fetch.
 */
export function buildConsensus(lines: MarketLine[]): MarketConsensus {
  const pinnacleLine =
    lines.find((l) => l.sportsbook.toLowerCase().includes("pinnacle")) ?? null;

  let noVigHomeProb: number;
  let noVigAwayProb: number;
  let noVigDrawProb: number | undefined;

  if (pinnacleLine) {
    const devigged = devigPinnacle(pinnacleLine);
    noVigHomeProb = devigged.noVigHomeProb;
    noVigAwayProb = devigged.noVigAwayProb;
    noVigDrawProb = devigged.noVigDrawProb;
  } else {
    // Fallback: de-vig the average of all books
    const avgLine: MarketLine = {
      sportsbook: "avg",
      homeAmerican: 0,
      awayAmerican: 0,
      homeDecimal: 0,
      awayDecimal: 0,
      homeImpliedProb:
        lines.reduce((s, l) => s + l.homeImpliedProb, 0) / lines.length,
      awayImpliedProb:
        lines.reduce((s, l) => s + l.awayImpliedProb, 0) / lines.length,
      drawImpliedProb: lines.some((l) => l.drawImpliedProb !== undefined)
        ? lines.reduce((s, l) => s + (l.drawImpliedProb ?? 0), 0) / lines.length
        : undefined,
      fetchedAt: new Date().toISOString(),
    };
    const devigged = devigPinnacle(avgLine);
    noVigHomeProb = devigged.noVigHomeProb;
    noVigAwayProb = devigged.noVigAwayProb;
    noVigDrawProb = devigged.noVigDrawProb;
  }

  const avgHomeProb =
    lines.reduce((s, l) => s + l.homeImpliedProb, 0) / lines.length;
  const avgAwayProb =
    lines.reduce((s, l) => s + l.awayImpliedProb, 0) / lines.length;

  return {
    lines,
    pinnacleLine,
    noVigHomeProb,
    noVigAwayProb,
    noVigDrawProb,
    avgHomeProb,
    avgAwayProb,
  };
}
