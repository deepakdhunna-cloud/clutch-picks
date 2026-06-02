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

const CACHE_TTL_MS = 10 * 60 * 1000;
const oddsCache = new LRUCache<string, { data: MarketConsensus | null; timestamp: number }>({ max: 1000 });

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
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  let result: MarketConsensus | null = null;
  try {
    const [sportPath, leaguePath] = path.split("/");
    const url = `https://sports.core.api.espn.com/v2/sports/${sportPath}/leagues/${leaguePath}/events/${eventId}/competitions/${eventId}/odds`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = (await res.json()) as { items?: EspnOddsItem[] };
      const items = data.items ?? [];
      // Prefer DraftKings (consistently present); else any provider carrying both
      // moneylines. A single sharp book IS a usable consensus for our purposes.
      const withMoneyline = items.filter(
        (it) =>
          typeof it.homeTeamOdds?.moneyLine === "number" &&
          typeof it.awayTeamOdds?.moneyLine === "number",
      );
      const chosen =
        withMoneyline.find((it) => /draftkings/i.test(it.provider?.name ?? "")) ??
        withMoneyline[0];

      if (chosen) {
        const homeAmerican = chosen.homeTeamOdds!.moneyLine!;
        const awayAmerican = chosen.awayTeamOdds!.moneyLine!;
        const drawAmerican =
          typeof chosen.drawOdds?.moneyLine === "number" ? chosen.drawOdds.moneyLine : undefined;

        const line: MarketLine = {
          sportsbook: chosen.provider?.name ?? "ESPN",
          homeAmerican,
          awayAmerican,
          homeDecimal: decimalFromAmerican(homeAmerican),
          awayDecimal: decimalFromAmerican(awayAmerican),
          homeImpliedProb: impliedFromAmerican(homeAmerican),
          awayImpliedProb: impliedFromAmerican(awayAmerican),
          drawImpliedProb: drawAmerican !== undefined ? impliedFromAmerican(drawAmerican) : undefined,
          fetchedAt: new Date().toISOString(),
        };
        const devig = devigPinnacle(line);
        result = {
          lines: [line],
          pinnacleLine: line,
          noVigHomeProb: devig.noVigHomeProb,
          noVigAwayProb: devig.noVigAwayProb,
          noVigDrawProb: devig.noVigDrawProb,
          avgHomeProb: line.homeImpliedProb,
          avgAwayProb: line.awayImpliedProb,
          source: "espn-odds",
          sourceLabel: `${line.sportsbook} via ESPN`,
          // A real single-book moneyline — not the weak spread-only fallback.
          // Flagged true so downstream weighting can stay conservative until a
          // multi-book paid feed is provisioned.
          isFallback: true,
          spread: typeof chosen.spread === "number" ? chosen.spread : undefined,
          overUnder: typeof chosen.overUnder === "number" ? chosen.overUnder : undefined,
          marketFavorite: devig.noVigHomeProb >= devig.noVigAwayProb ? "home" : "away",
        };
      }
    }
  } catch {
    result = null;
  }

  oddsCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}
