/**
 * FREE market consensus from ESPN's core-odds API.
 *
 * ESPN's core endpoint exposes real sportsbook moneylines (DraftKings + others)
 * for free, no API key — for current AND historical games. A moneyline de-vigs
 * directly into a market win probability, which is the single most predictive
 * signal in sports. This is the no-cost alternative to a paid odds feed
 * (SharpAPI): when SHARPAPI_KEY is unset, the engine sources its market
 * consensus here instead of running with no market anchor at all.
 *
 * Returns null on any failure or for sports/games ESPN has no posted line for;
 * the caller then runs without a market anchor (today's behavior).
 */

import { LRUCache } from "lru-cache";
import type { MarketConsensus, MarketLine } from "./sharpApi";
import { devigPinnacle } from "./sharpApi";

// ESPN core-API paths: "{sport}/{league}". Cricket/IPL omitted — ESPN posts no
// odds for it. Tennis omitted — per-match books are not on the core endpoint.
const ESPN_CORE_PATHS: Record<string, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  NCAAF: "football/college-football",
  NCAAB: "basketball/mens-college-basketball",
  EPL: "soccer/eng.1",
  MLS: "soccer/usa.1",
  UCL: "soccer/uefa.champions",
};

function impliedFromAmerican(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function decimalFromAmerican(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / -american + 1;
}

interface EspnOddsItem {
  provider?: { name?: string };
  spread?: number;
  overUnder?: number;
  homeTeamOdds?: { moneyLine?: number; favorite?: boolean };
  awayTeamOdds?: { moneyLine?: number; favorite?: boolean };
  drawOdds?: { moneyLine?: number };
}

// A successful line is fresh for 10 minutes. A *failed* fetch (timeout / 5xx /
// network blip) must NOT be cached for that long — doing so locks the game into
// running market-blind (≈ a coin-flip factor model) for 10 minutes off a single
// transient hiccup. Failures get a short negative TTL so the next warm cycle
// retries almost immediately. A genuine "no line posted" (404) also uses the
// short TTL so a line that appears later is picked up promptly.
const POSITIVE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;
const oddsCache = new LRUCache<string, { data: MarketConsensus | null; timestamp: number }>({ max: 1000 });

/**
 * One fetch attempt. Returns the Response, or null on network failure/timeout.
 */
async function fetchOddsOnce(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(7000) });
  } catch {
    return null;
  }
}

/**
 * Fetch a free ESPN market consensus for one game by its ESPN event id.
 * @param sport  league key (NBA, MLB, NHL, EPL, ...)
 * @param eventId ESPN event id (the engine's Game.id is the ESPN event id)
 */
export async function fetchEspnMarketConsensus(
  sport: string,
  eventId: string,
): Promise<MarketConsensus | null> {
  const path = ESPN_CORE_PATHS[sport];
  if (!path || !eventId) return null;

  const cacheKey = `${sport}:${eventId}`;
  const cached = oddsCache.get(cacheKey);
  if (cached) {
    const ttl = cached.data ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    if (Date.now() - cached.timestamp < ttl) return cached.data;
  }

  let result: MarketConsensus | null = null;
  try {
    const [sportPath, leaguePath] = path.split("/");
    const url = `https://sports.core.api.espn.com/v2/sports/${sportPath}/leagues/${leaguePath}/events/${eventId}/competitions/${eventId}/odds`;
    // The moneyline is the single most predictive signal we have — a transient
    // failure shouldn't silently drop it. Retry once on a network failure or a
    // 5xx; a 404 (no line posted) is taken at face value (no retry).
    let res = await fetchOddsOnce(url);
    if (!res || res.status >= 500) {
      res = await fetchOddsOnce(url);
    }
    if (res && res.ok) {
      const data = (await res.json()) as { items?: EspnOddsItem[] };
      const items = data.items ?? [];

      // Build a de-vigged line for EVERY book that posts both moneylines, not
      // just one. Averaging the no-vig probabilities across books is a sharper,
      // lower-variance anchor than any single book: it cancels each book's
      // idiosyncratic lean and stale-line noise. This is the textbook "market
      // consensus" — and it's free: ESPN already returns all of these books in
      // the same payload we were discarding down to one.
      const books = items
        .filter(
          (it) =>
            typeof it.homeTeamOdds?.moneyLine === "number" &&
            typeof it.awayTeamOdds?.moneyLine === "number",
        )
        .map((it) => {
          const homeAmerican = it.homeTeamOdds!.moneyLine!;
          const awayAmerican = it.awayTeamOdds!.moneyLine!;
          const drawAmerican =
            typeof it.drawOdds?.moneyLine === "number" ? it.drawOdds.moneyLine : undefined;
          const line: MarketLine = {
            sportsbook: it.provider?.name ?? "ESPN",
            homeAmerican,
            awayAmerican,
            homeDecimal: decimalFromAmerican(homeAmerican),
            awayDecimal: decimalFromAmerican(awayAmerican),
            homeImpliedProb: impliedFromAmerican(homeAmerican),
            awayImpliedProb: impliedFromAmerican(awayAmerican),
            drawImpliedProb:
              drawAmerican !== undefined ? impliedFromAmerican(drawAmerican) : undefined,
            fetchedAt: new Date().toISOString(),
          };
          return { item: it, line, devig: devigPinnacle(line) };
        });

      if (books.length > 0) {
        // Representative line for display/spread/total: prefer DraftKings (the
        // most consistently present sharp book), else the first available.
        const reference = books.find((b) => /draftkings/i.test(b.line.sportsbook)) ?? books[0]!;

        // Opt-out switch for A/B sweeps. Default ON. When disabled, fall back to
        // the legacy single-book (reference) behavior so the change is isolable.
        const multiBookEnabled = process.env.ENGINE_MARKET_MULTIBOOK !== "false";
        const consensusBooks = multiBookEnabled ? books : [reference];

        // Consensus de-vigged probabilities = mean across books, renormalized.
        // Renormalizing absorbs the tiny drift from soccer books that omit the
        // draw price so the three outcomes still sum to 1.
        const n = consensusBooks.length;
        const sumHome = consensusBooks.reduce((s, b) => s + b.devig.noVigHomeProb, 0);
        const sumAway = consensusBooks.reduce((s, b) => s + b.devig.noVigAwayProb, 0);
        const drawBooks = consensusBooks.filter((b) => b.devig.noVigDrawProb !== undefined);
        const meanDraw =
          drawBooks.length > 0
            ? drawBooks.reduce((s, b) => s + (b.devig.noVigDrawProb ?? 0), 0) / drawBooks.length
            : undefined;
        let meanHome = sumHome / n;
        let meanAway = sumAway / n;
        const total = meanHome + meanAway + (meanDraw ?? 0);
        meanHome /= total;
        meanAway /= total;
        const consensusDraw = meanDraw !== undefined ? meanDraw / total : undefined;

        // With-vig implied averages (display only).
        const avgHome = consensusBooks.reduce((s, b) => s + b.line.homeImpliedProb, 0) / n;
        const avgAway = consensusBooks.reduce((s, b) => s + b.line.awayImpliedProb, 0) / n;

        const isMultiBook = n >= 2;
        const sourceLabel = isMultiBook
          ? `${n}-book consensus via ESPN`
          : `${reference.line.sportsbook} via ESPN`;

        result = {
          lines: consensusBooks.map((b) => b.line),
          pinnacleLine: reference.line,
          noVigHomeProb: meanHome,
          noVigAwayProb: meanAway,
          noVigDrawProb: consensusDraw,
          avgHomeProb: avgHome,
          avgAwayProb: avgAway,
          source: "espn-odds",
          sourceLabel,
          // A multi-book consensus is a genuine market read, not a thin single-
          // book fallback. A lone book stays flagged so callers can stay
          // conservative; downstream weighting does not change on this flag.
          isFallback: !isMultiBook,
          spread: typeof reference.item.spread === "number" ? reference.item.spread : undefined,
          overUnder:
            typeof reference.item.overUnder === "number" ? reference.item.overUnder : undefined,
          marketFavorite: meanHome >= meanAway ? "home" : "away",
        };
      }
    }
  } catch {
    result = null;
  }

  oddsCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}
