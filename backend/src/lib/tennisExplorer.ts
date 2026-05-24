import type { TennisTour } from "./tennisStats";

export interface TennisExplorerLiveMatch {
  id: string;
  sourceId: string;
  source: "tennis-explorer";
  status: "LIVE" | "SCHEDULED";
  tour: TennisTour;
  homeName: string;
  awayName: string;
  homeAbbreviation: string;
  awayAbbreviation: string;
  homeRank?: number;
  awayRank?: number;
  homeSeed?: number;
  awaySeed?: number;
  homeSets?: number;
  awaySets?: number;
  homeLinescores?: number[];
  awayLinescores?: number[];
  gameTime: string;
  venue: string;
  quarter: string;
  clock?: string;
  suspended: boolean;
  suspension?: {
    display: string;
    resumeText: string;
    reasonText: string;
    source: "tennis-explorer";
  };
}

interface TennisExplorerCandidate {
  id: string;
  tour: TennisTour;
  tournament: string;
  surface?: string;
  timeText?: string;
  sourceDate: string;
  homeShortName: string;
  awayShortName: string;
  homeSeed?: number;
  awaySeed?: number;
  status: "LIVE" | "SCHEDULED";
  homeSets?: number;
  awaySets?: number;
  homeLinescores: number[];
  awayLinescores: number[];
}

const TENNIS_EXPLORER_BASE_URL = "https://www.tennisexplorer.com";
const TENNIS_EXPLORER_FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ClutchPicksBot/1.0)",
  "Accept": "text/html,application/xhtml+xml",
};

const tennisExplorerCache = new Map<string, { data: TennisExplorerLiveMatch[]; timestamp: number }>();
const TENNIS_EXPLORER_CACHE_TTL_MS = 45 * 1000;
const TENNIS_EXPLORER_LIVE_WINDOW_MS = 10 * 60 * 60 * 1000;
const TENNIS_EXPLORER_FUTURE_GRACE_MS = 2 * 60 * 60 * 1000;
const TENNIS_EXPLORER_SCHEDULED_WINDOW_MS = 54 * 60 * 60 * 1000;
const TENNIS_EXPLORER_SCHEDULED_STALE_MS = 90 * 60 * 1000;

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeHtml(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " "));
}

function numericText(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = stripTags(value).replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCells(rowHtml: string, className: string): string[] {
  const cells: string[] = [];
  const cellPattern = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellPattern.exec(rowHtml)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const classMatch = attrs.match(/\bclass=["']([^"']+)["']/i);
    const classes = classMatch?.[1]?.split(/\s+/) ?? [];
    if (classes.includes(className)) cells.push(body);
  }
  return cells;
}

function extractPlayer(rowHtml: string): { name: string; seed?: number } | null {
  const match = rowHtml.match(/<td\b[^>]*class=["'][^"']*\bt-name\b[^"']*["'][^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*(?:\((\d+)\))?/i);
  if (!match) return null;
  const seed = match[2] ? Number(match[2]) : undefined;
  return {
    name: stripTags(match[1] ?? ""),
    seed: typeof seed === "number" && Number.isFinite(seed) ? seed : undefined,
  };
}

function displayNameFromExplorer(rawName: string): string {
  const parts = rawName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return rawName;
  const [familyName, ...givenNames] = parts;
  return [...givenNames, familyName].join(" ");
}

function abbreviationFromName(name: string): string {
  const last = name.replace(/[^a-z0-9\s]/gi, " ").trim().split(/\s+/).filter(Boolean).at(-1) ?? name;
  return last.slice(0, 4).toUpperCase();
}

function parseExplorerDate(sourceDate: string, timeText?: string): string {
  const timeMatch = timeText?.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) return `${sourceDate}T12:00:00.000Z`;
  const hour = timeMatch[1]?.padStart(2, "0") ?? "12";
  const minute = timeMatch[2] ?? "00";
  return `${sourceDate}T${hour}:${minute}:00.000Z`;
}

function dateParts(date?: string, offsetDays = 0): { date: string; year: number; month: number; day: number } {
  const base = date ? new Date(`${date}T00:00:00.000Z`) : new Date();
  base.setUTCDate(base.getUTCDate() + offsetDays);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const day = base.getUTCDate();
  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    year,
    month,
    day,
  };
}

function matchListUrl(date: { year: number; month: number; day: number }, tour: TennisTour): string {
  const type = tour === "WTA" ? "wta-single" : "atp-single";
  return `${TENNIS_EXPLORER_BASE_URL}/matches/?type=${type}&year=${date.year}&month=${date.month}&day=${date.day}`;
}

export function parseTennisExplorerMatchRows(html: string, tour: TennisTour, sourceDate: string): TennisExplorerCandidate[] {
  const candidates: TennisExplorerCandidate[] = [];
  let tournament = "Tennis";
  let surface: string | undefined;
  const rowPattern = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowPattern) ?? [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? "";
    const tournamentMatch = row.match(/<td\b[^>]*class=["'][^"']*\bt-name\b[^"']*["'][^>]*colspan=["']2["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (tournamentMatch) {
      tournament = stripTags(tournamentMatch[1] ?? "") || tournament;
      const surfaceMatch = row.match(/<span\b[^>]*title=["']([^"']+)["'][^>]*style=["'][^"']*background-color/i);
      surface = surfaceMatch ? stripTags(surfaceMatch[1] ?? "") : undefined;
      continue;
    }

    if (!/\browspan=["']2["']/i.test(row)) continue;
    const nextRow = rows[index + 1] ?? "";
    const idMatch = `${row}${nextRow}`.match(/match-detail\/\?id=(\d+)/i);
    if (!idMatch?.[1]) continue;

    const home = extractPlayer(row);
    const away = extractPlayer(nextRow);
    if (!home || !away) continue;

    const resultCellsHome = extractCells(row, "result");
    const resultCellsAway = extractCells(nextRow, "result");
    const parsedHomeSets = numericText(resultCellsHome[0]);
    const parsedAwaySets = numericText(resultCellsAway[0]);

    const scoreCellsHome = extractCells(row, "score").map(numericText).filter((value): value is number => value !== null);
    const scoreCellsAway = extractCells(nextRow, "score").map(numericText).filter((value): value is number => value !== null);
    const hasPartialScore = scoreCellsHome.length > 0 || scoreCellsAway.length > 0;
    const hasSetTotals = parsedHomeSets !== null && parsedAwaySets !== null;
    const looksCompleted = (parsedHomeSets ?? 0) >= 2 || (parsedAwaySets ?? 0) >= 2;
    if (hasPartialScore && (!hasSetTotals || looksCompleted)) continue;
    if (!hasPartialScore && hasSetTotals) continue;

    const timeText = stripTags(extractCells(row, "time")[0] ?? "");
    const status = hasPartialScore ? "LIVE" : "SCHEDULED";

    candidates.push({
      id: idMatch[1],
      tour,
      tournament,
      surface,
      timeText,
      sourceDate,
      homeShortName: home.name,
      awayShortName: away.name,
      homeSeed: home.seed,
      awaySeed: away.seed,
      status,
      homeSets: parsedHomeSets ?? undefined,
      awaySets: parsedAwaySets ?? undefined,
      homeLinescores: scoreCellsHome,
      awayLinescores: scoreCellsAway,
    });
  }

  return candidates;
}

function parseRankingPair(html: string): { homeRank?: number; awayRank?: number } {
  const rankMatch = html.match(/<td\b[^>]*class=["'][^"']*\btr\b[^"']*["'][^>]*>([\s\S]*?)<\/td>\s*<th>\s*Singles ranking\s*<\/th>\s*<td\b[^>]*class=["'][^"']*\btl\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
  const homeRank = numericText(rankMatch?.[1]);
  const awayRank = numericText(rankMatch?.[2]);
  return {
    homeRank: homeRank ?? undefined,
    awayRank: awayRank ?? undefined,
  };
}

function parseDetailNames(html: string): { homeName?: string; awayName?: string } {
  const names = Array.from(html.matchAll(/<th\b[^>]*class=["'][^"']*\bplName\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => stripTags(match[1] ?? ""));
  return {
    homeName: names[0] ? displayNameFromExplorer(names[0]) : undefined,
    awayName: names[1] ? displayNameFromExplorer(names[1]) : undefined,
  };
}

function parseCurrentScore(html: string): { home?: number; away?: number } {
  const scoreText = stripTags(html.match(/<td\b[^>]*class=["'][^"']*\bgScore\b[^"']*["'][^>]*>\s*<span>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/);
  if (!scoreMatch) return {};
  const home = Number(scoreMatch[1]);
  const away = Number(scoreMatch[2]);
  return {
    home: Number.isFinite(home) ? home : undefined,
    away: Number.isFinite(away) ? away : undefined,
  };
}

function parseResumeText(statusText: string): string {
  const timeMatch = statusText.match(/\b(?:resume|resumes|restart|restarts|play)\b[^0-9]{0,32}(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?(?:\s*[A-Z]{2,4})?)/i);
  return timeMatch?.[1] ? `Est. ${timeMatch[1].trim()}` : "No time announced";
}

function parseReasonText(statusText: string): string {
  const normalized = statusText.toLowerCase();
  if (/\blightning\b/.test(normalized)) return "Lightning delay";
  if (/\brain\b|\brained\b/.test(normalized)) return "Rain delay";
  if (/\bweather\b/.test(normalized)) return "Weather delay";
  if (/\bbad light\b/.test(normalized)) return "Bad light";
  if (/\bdarkness\b/.test(normalized)) return "Darkness";
  if (/\bcourt\b/.test(normalized) && /\bcondition/.test(normalized)) return "Court conditions";
  if (/\bmedical\b/.test(normalized)) return "Medical delay";
  return "Reason not reported";
}

export function parseTennisExplorerMatchDetail(html: string, candidate: TennisExplorerCandidate): TennisExplorerLiveMatch {
  const detailNames = parseDetailNames(html);
  const ranks = parseRankingPair(html);
  const currentScore = parseCurrentScore(html);
  const interruptedText = stripTags(html.match(/<td\b[^>]*class=["'][^"']*\bgInterrupted\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "");
  const suspended = interruptedText.length > 0;
  const homeName = detailNames.homeName ?? displayNameFromExplorer(candidate.homeShortName);
  const awayName = detailNames.awayName ?? displayNameFromExplorer(candidate.awayShortName);
  const homeLinescores = [...candidate.homeLinescores];
  const awayLinescores = [...candidate.awayLinescores];
  if (currentScore.home !== undefined && currentScore.away !== undefined) {
    homeLinescores[homeLinescores.length - 1] = currentScore.home;
    awayLinescores[awayLinescores.length - 1] = currentScore.away;
  }
  const resumeText = suspended ? parseResumeText(interruptedText) : undefined;
  const reasonText = suspended ? parseReasonText(interruptedText) : undefined;

  return {
    id: `tennis-explorer-${candidate.id}`,
    sourceId: candidate.id,
    source: "tennis-explorer",
    status: candidate.status,
    tour: candidate.tour,
    homeName,
    awayName,
    homeAbbreviation: abbreviationFromName(homeName),
    awayAbbreviation: abbreviationFromName(awayName),
    homeRank: ranks.homeRank,
    awayRank: ranks.awayRank,
    homeSeed: candidate.homeSeed,
    awaySeed: candidate.awaySeed,
    homeSets: candidate.homeSets,
    awaySets: candidate.awaySets,
    homeLinescores: homeLinescores.length > 0 ? homeLinescores : undefined,
    awayLinescores: awayLinescores.length > 0 ? awayLinescores : undefined,
    gameTime: parseExplorerDate(candidate.sourceDate, candidate.timeText),
    venue: [candidate.tournament, candidate.surface].filter(Boolean).join(" · "),
    quarter: candidate.status === "LIVE" ? suspended ? "Suspended" : "In Progress" : "Scheduled",
    clock: suspended ? resumeText : undefined,
    suspended,
    suspension: suspended
      ? {
          display: "Suspended",
          resumeText: resumeText ?? "No time announced",
          reasonText: reasonText ?? "Reason not reported",
          source: "tennis-explorer",
        }
      : undefined,
  };
}

export function isFreshTennisExplorerLiveMatch(match: TennisExplorerLiveMatch, now = new Date()): boolean {
  if (match.source !== "tennis-explorer") return false;
  const startTime = new Date(match.gameTime).getTime();
  const nowTime = now.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(nowTime)) return false;

  if (match.status === "SCHEDULED") {
    if (nowTime - startTime > TENNIS_EXPLORER_SCHEDULED_STALE_MS) return false;
    return startTime - nowTime <= TENNIS_EXPLORER_SCHEDULED_WINDOW_MS;
  }

  if (match.homeSets === undefined || match.awaySets === undefined) return false;
  const hasScore = Boolean(match.homeLinescores?.length || match.awayLinescores?.length);
  if (!hasScore) return false;
  if (startTime - nowTime > TENNIS_EXPLORER_FUTURE_GRACE_MS) return false;
  return nowTime - startTime <= TENNIS_EXPLORER_LIVE_WINDOW_MS;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: TENNIS_EXPLORER_FETCH_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

async function fetchDetails(candidates: TennisExplorerCandidate[]): Promise<TennisExplorerLiveMatch[]> {
  const limited = candidates.slice(0, 24);
  const results: TennisExplorerLiveMatch[] = [];
  for (let i = 0; i < limited.length; i += 4) {
    const batch = limited.slice(i, i + 4);
    const parsed = await Promise.all(batch.map(async (candidate) => {
      const html = await fetchText(`${TENNIS_EXPLORER_BASE_URL}/match-detail/?id=${candidate.id}`);
      return html ? parseTennisExplorerMatchDetail(html, candidate) : null;
    }));
    results.push(...parsed.filter((match): match is TennisExplorerLiveMatch => match !== null));
  }
  return results;
}

export async function fetchTennisExplorerLiveMatches(date?: string): Promise<TennisExplorerLiveMatch[]> {
  const cacheKey = date ?? "today";
  const cached = tennisExplorerCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TENNIS_EXPLORER_CACHE_TTL_MS) {
    return cached.data;
  }

  const uniqueCandidates = new Map<string, TennisExplorerCandidate>();
  for (const offset of [0, 1]) {
    const targetDate = dateParts(date, offset);
    for (const tour of ["ATP", "WTA"] as const) {
      const html = await fetchText(matchListUrl(targetDate, tour));
      if (!html) continue;
      for (const candidate of parseTennisExplorerMatchRows(html, tour, targetDate.date)) {
        uniqueCandidates.set(candidate.id, candidate);
      }
    }
  }

  const data = (await fetchDetails(Array.from(uniqueCandidates.values())))
    .filter((match) => isFreshTennisExplorerLiveMatch(match));
  tennisExplorerCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}
