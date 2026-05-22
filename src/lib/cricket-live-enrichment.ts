import {
  GameStatus,
  Sport,
  type CricketBatterContext,
  type CricketBallSummary,
  type CricketBowlerContext,
  type CricketCurrentOverSummary,
  type CricketInningsScore,
  type CricketOverSummary,
  type CricketScoreState,
  type GameWithPrediction,
} from '@/types/sports';

const ESPN_IPL_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard';
const ESPN_IPL_SUMMARY_URL = (eventId: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/cricket/8048/summary?event=${encodeURIComponent(eventId)}`;

type ESPNCricketLineScore = {
  runs?: number;
  wickets?: number;
  overs?: number;
  maxOvers?: number;
  isBatting?: boolean | number;
  isCurrent?: boolean | number;
  displayValue?: string | number;
};

type ESPNCricketCompetitor = {
  homeAway?: 'home' | 'away';
  score?: string;
  linescores?: ESPNCricketLineScore[];
};

type ESPNCricketEvent = {
  id: string;
  competitions?: Array<{
    competitors?: ESPNCricketCompetitor[];
    status?: {
      period?: number;
      summary?: string;
      displayClock?: string;
      type?: {
        detail?: string;
        shortDetail?: string;
      };
    };
  }>;
};

type ESPNCricketScoreboard = {
  events?: ESPNCricketEvent[];
};

type ESPNCricketStat = {
  name?: string;
  displayValue?: string | number;
  value?: string | number;
};

type ESPNCricketPlayerLineScore = {
  linescores?: ESPNCricketPlayerLineScore[];
  statistics?: {
    categories?: Array<{
      stats?: ESPNCricketStat[];
    }>;
  };
};

type ESPNCricketRosterEntry = {
  active?: boolean | number;
  activeName?: string;
  athlete?: {
    displayName?: string;
  };
  linescores?: ESPNCricketPlayerLineScore[];
};

type ESPNCricketSummary = {
  header?: {
    competitions?: Array<{
      commentaries?: Record<string, ESPNCricketCommentary> | ESPNCricketCommentary[];
      competitors?: ESPNCricketSummaryCompetitor[];
    }>;
  };
  rosters?: Array<{
    roster?: ESPNCricketRosterEntry[];
  }>;
};

type ESPNCricketOverLine = {
  number?: string | number;
  runs?: string | number;
  wicket?: unknown[];
};

type ESPNCricketSummaryCompetitor = {
  score?: string;
  linescores?: Array<{
    isBatting?: boolean | number;
    statistics?: {
      overs?: ESPNCricketOverLine[][];
    };
  }>;
};

type ESPNCricketCommentary = {
  id?: string | number;
  text?: string;
  homeScore?: string;
  awayScore?: string;
  scoreValue?: number;
  innings?: {
    number?: number;
    wickets?: number;
  };
  over?: {
    ball?: number;
    number?: number;
    runs?: number;
    wickets?: number;
    complete?: boolean;
    wide?: number;
    noBall?: number;
    legByes?: number;
    byes?: number;
    actual?: number;
    unique?: number;
  };
};

type CricketLivePatch = {
  homeScore?: number;
  awayScore?: number;
  homeScoreDisplay?: string;
  awayScoreDisplay?: string;
  clock?: string;
  quarter?: string;
  cricketState: CricketScoreState;
};

type CricketSummaryContext = Pick<CricketScoreState, 'currentBatters' | 'currentBowler' | 'overTrack' | 'currentOver'>;

function cricketBool(value: boolean | number | undefined): boolean {
  return value === true || value === 1;
}

function formatCricketNumber(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function parseCricketScoreText(raw: string | undefined): { runs?: number; wickets?: number; overs?: number; maxOvers?: number } {
  if (!raw) return {};
  const scoreMatch = raw.match(/(\d+)\s*\/\s*(\d+)/);
  const oversMatch = raw.match(/\((\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*ov\)/i)
    ?? raw.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*ov/i);

  return {
    runs: scoreMatch ? Number(scoreMatch[1]) : undefined,
    wickets: scoreMatch ? Number(scoreMatch[2]) : undefined,
    overs: oversMatch ? Number(oversMatch[1]) : undefined,
    maxOvers: oversMatch?.[2] !== undefined ? Number(oversMatch[2]) : undefined,
  };
}

function flattenPlayerLineScores(linescores: ESPNCricketPlayerLineScore[] | undefined): ESPNCricketPlayerLineScore[] {
  if (!linescores?.length) return [];
  return linescores.flatMap((line) => [line, ...flattenPlayerLineScores(line.linescores)]);
}

function playerStatMap(player: ESPNCricketRosterEntry): Record<string, string | number> {
  const stats: Record<string, string | number> = {};
  for (const line of flattenPlayerLineScores(player.linescores)) {
    for (const category of line.statistics?.categories ?? []) {
      for (const stat of category.stats ?? []) {
        if (!stat.name) continue;
        const value = stat.displayValue ?? stat.value;
        if (value !== undefined && value !== '') stats[stat.name] = value;
      }
    }
  }
  return stats;
}

function statNumber(stats: Record<string, string | number>, key: string): number | undefined {
  const raw = stats[key];
  if (raw === undefined || raw === null || raw === '-') return undefined;
  const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function statString(stats: Record<string, string | number>, key: string): string | undefined {
  const raw = stats[key];
  if (raw === undefined || raw === null || raw === '' || raw === '-') return undefined;
  return String(raw);
}

function extractCricketSummaryContext(summary: ESPNCricketSummary, inningsNumber?: number | null): CricketSummaryContext {
  const currentBatters: CricketBatterContext[] = [];
  let currentBowler: CricketBowlerContext | undefined;

  for (const roster of summary.rosters ?? []) {
    for (const player of roster.roster ?? []) {
      const activeName = player.activeName?.trim().toLowerCase();
      const name = player.athlete?.displayName?.trim();
      if (!activeName || !name) continue;

      if (activeName === 'striker' || activeName === 'non-striker') {
        const stats = playerStatMap(player);
        currentBatters.push({
          name,
          role: activeName,
          runs: statNumber(stats, 'runs'),
          balls: statNumber(stats, 'ballsFaced'),
        });
        continue;
      }

      if (activeName === 'current bowler') {
        const stats = playerStatMap(player);
        currentBowler = {
          name,
          overs: statString(stats, 'overs'),
          runsConceded: statNumber(stats, 'conceded'),
          wickets: statNumber(stats, 'wickets'),
        };
      }
    }
  }

  currentBatters.sort((a, b) => {
    if (a.role === b.role) return 0;
    return a.role === 'striker' ? -1 : 1;
  });

  return {
    currentBatters: currentBatters.length ? currentBatters : undefined,
    currentBowler,
    overTrack: extractCricketOverTrack(summary, inningsNumber),
    currentOver: extractCricketCurrentOver(summary, inningsNumber),
  };
}

function parseScoreWickets(score: string | undefined): number | undefined {
  const match = score?.match(/\d+\s*\/\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function commentarySortValue(commentary: ESPNCricketCommentary): number {
  if (typeof commentary.over?.unique === 'number') return commentary.over.unique;
  if (typeof commentary.over?.actual === 'number') return commentary.over.actual;
  const id = typeof commentary.id === 'number' ? commentary.id : Number(commentary.id);
  return Number.isFinite(id) ? id : 0;
}

function cricketBallLabel(commentary: ESPNCricketCommentary, wicket: boolean): Pick<CricketBallSummary, 'label' | 'extra'> {
  if (wicket) return { label: 'W' };
  if ((commentary.over?.wide ?? 0) > 0) return { label: 'WD', extra: 'wide' };
  if ((commentary.over?.noBall ?? 0) > 0) return { label: 'NB', extra: 'noball' };
  if ((commentary.over?.byes ?? 0) > 0) return { label: `${commentary.scoreValue ?? commentary.over?.byes ?? 0}B`, extra: 'bye' };
  if ((commentary.over?.legByes ?? 0) > 0) return { label: `${commentary.scoreValue ?? commentary.over?.legByes ?? 0}LB`, extra: 'legbye' };
  return { label: String(commentary.scoreValue ?? 0) };
}

function extractCricketCurrentOver(summary: ESPNCricketSummary, inningsNumber?: number | null): CricketCurrentOverSummary | undefined {
  const rawCommentaries = summary.header?.competitions?.[0]?.commentaries;
  const commentaries = Array.isArray(rawCommentaries)
    ? rawCommentaries
    : Object.values(rawCommentaries ?? {});
  const filtered = commentaries
    .filter((commentary) => {
      if (typeof commentary.over?.number !== 'number') return false;
      if (typeof inningsNumber !== 'number') return true;
      return commentary.innings?.number === inningsNumber;
    })
    .sort((a, b) => commentarySortValue(a) - commentarySortValue(b));
  if (!filtered.length) return undefined;

  const currentOverNumber = filtered[filtered.length - 1]?.over?.number;
  if (typeof currentOverNumber !== 'number') return undefined;

  const currentComments = filtered.filter((commentary) => commentary.over?.number === currentOverNumber);
  const previousCommentary = [...filtered].reverse().find((commentary) => commentary.over?.number !== currentOverNumber);
  let previousWickets: number | undefined = previousCommentary?.innings?.wickets
    ?? parseScoreWickets(previousCommentary?.homeScore)
    ?? parseScoreWickets(previousCommentary?.awayScore);
  const balls: CricketBallSummary[] = currentComments.map((commentary, index) => {
    const homeWickets = parseScoreWickets(commentary.homeScore);
    const awayWickets = parseScoreWickets(commentary.awayScore);
    const wickets = commentary.innings?.wickets ?? homeWickets ?? awayWickets;
    const wicketFromScore = typeof wickets === 'number' && typeof previousWickets === 'number' && wickets > previousWickets;
    previousWickets = wickets ?? previousWickets;
    const wicketFromText = /\bOUT\b|wicket/i.test(commentary.text ?? '');
    const wicket = wicketFromScore || wicketFromText;
    const label = cricketBallLabel(commentary, wicket);

    return {
      ball: commentary.over?.ball ?? index + 1,
      runs: Math.max(0, commentary.scoreValue ?? 0),
      wicket,
      ...label,
    };
  });

  const fallbackOver = extractCricketOverTrack(summary, inningsNumber)?.find((over) => over.over === currentOverNumber);
  return {
    over: currentOverNumber,
    runs: balls.reduce((sum, ball) => sum + ball.runs, 0) || fallbackOver?.runs || 0,
    wickets: balls.filter((ball) => ball.wicket).length || fallbackOver?.wickets || 0,
    complete: currentComments.some((commentary) => commentary.over?.complete === true) || fallbackOver?.complete,
    balls,
  };
}

function extractCricketOverTrack(summary: ESPNCricketSummary, inningsNumber?: number | null): CricketOverSummary[] | undefined {
  const competitors = summary.header?.competitions?.[0]?.competitors ?? [];
  const battingCompetitor = competitors.find((competitor) =>
    competitor.linescores?.some((line) => cricketBool(line.isBatting))
  ) ?? competitors.find((competitor) => Boolean(competitor.score?.trim()));
  const overLines = battingCompetitor?.linescores?.find((line) => cricketBool(line.isBatting))?.statistics?.overs?.[0]
    ?? battingCompetitor?.linescores?.[0]?.statistics?.overs?.[0];
  if (overLines?.length) {
    return overLines.map((overLine) => ({
      over: Number(overLine.number),
      runs: Number(overLine.runs),
      wickets: overLine.wicket?.length ?? 0,
      complete: true,
    })).filter((over) => Number.isFinite(over.over) && Number.isFinite(over.runs));
  }

  const rawCommentaries = summary.header?.competitions?.[0]?.commentaries;
  const commentaries = Array.isArray(rawCommentaries)
    ? rawCommentaries
    : Object.values(rawCommentaries ?? {});
  const filtered = commentaries.filter((commentary) => {
    if (typeof commentary.over?.number !== 'number') return false;
    if (typeof inningsNumber !== 'number') return true;
    return commentary.innings?.number === inningsNumber;
  });
  if (!filtered.length) return undefined;

  const byOver = new Map<number, CricketOverSummary>();
  for (const commentary of filtered) {
    const over = commentary.over?.number;
    if (typeof over !== 'number') continue;
    const current = byOver.get(over) ?? { over, runs: 0, wickets: 0, complete: false };
    const scoreValue = typeof commentary.scoreValue === 'number' ? commentary.scoreValue : 0;
    current.runs += Math.max(0, scoreValue);
    current.wickets = Math.max(current.wickets, commentary.over?.wickets ?? 0);
    current.complete = current.complete || commentary.over?.complete === true;
    byOver.set(over, current);
  }

  return Array.from(byOver.values())
    .sort((a, b) => a.over - b.over)
    .slice(-20);
}

function extractCricketInnings(competitor: ESPNCricketCompetitor | undefined): CricketInningsScore | undefined {
  if (!competitor) return undefined;

  const parsed = parseCricketScoreText(competitor.score);
  const currentBattingLine = competitor.linescores?.find((ls) => cricketBool(ls.isCurrent) && cricketBool(ls.isBatting));
  const matchingScoreLine = competitor.linescores?.find((ls) =>
    typeof parsed.runs === 'number'
    && ls.runs === parsed.runs
    && (typeof parsed.wickets !== 'number' || ls.wickets === parsed.wickets)
  );
  const line = currentBattingLine
    ?? matchingScoreLine
    ?? competitor.linescores?.find((ls) => typeof ls.runs === 'number' && ls.runs > 0)
    ?? competitor.linescores?.find((ls) => typeof ls.runs === 'number' || typeof ls.wickets === 'number' || typeof ls.overs === 'number');
  const runs = line?.runs ?? parsed.runs;
  const wickets = line?.wickets ?? parsed.wickets ?? (runs === 0 ? 0 : undefined);
  const isBatting = Boolean(currentBattingLine);
  const hasScoreText = Boolean(competitor.score?.trim());
  const overs = isBatting || hasScoreText ? line?.overs ?? parsed.overs : undefined;
  const maxOvers = isBatting || hasScoreText ? line?.maxOvers ?? parsed.maxOvers : undefined;
  const oversText = formatCricketNumber(overs);
  const maxOversText = formatCricketNumber(maxOvers);

  if (runs === undefined && wickets === undefined && !competitor.score) return undefined;

  return {
    runs,
    wickets,
    overs,
    maxOvers,
    isBatting,
    scoreText: typeof runs === 'number' && typeof wickets === 'number'
      ? `${runs}/${wickets}`
      : competitor.score?.split('(')[0]?.trim() || (typeof runs === 'number' ? String(runs) : '0/0'),
    detailText: oversText ? `${oversText}${maxOversText ? `/${maxOversText}` : ''} ov` : undefined,
  };
}

function patchFromEvent(event: ESPNCricketEvent): CricketLivePatch | null {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((competitor) => competitor.homeAway === 'home');
  const away = competition?.competitors?.find((competitor) => competitor.homeAway === 'away');
  const homeInnings = extractCricketInnings(home);
  const awayInnings = extractCricketInnings(away);
  if (!homeInnings && !awayInnings) return null;

  const battingSide = homeInnings?.isBatting ? 'home' : awayInnings?.isBatting ? 'away' : undefined;
  const battingInnings = battingSide ? (battingSide === 'home' ? homeInnings : awayInnings) : undefined;
  const summary = [
    competition?.status?.summary,
    competition?.status?.type?.shortDetail,
    competition?.status?.type?.detail,
  ].find((text) => text && text.trim().length > 0)?.trim();
  const cricketState: CricketScoreState = {
    home: homeInnings,
    away: awayInnings,
    battingSide,
    innings: competition?.status?.period ?? null,
    summary,
  };

  return {
    homeScore: homeInnings?.runs,
    awayScore: awayInnings?.runs,
    homeScoreDisplay: homeInnings?.scoreText,
    awayScoreDisplay: awayInnings?.scoreText,
    clock: battingInnings?.detailText ?? competition?.status?.displayClock,
    quarter: summary ?? competition?.status?.type?.shortDetail ?? competition?.status?.type?.detail,
    cricketState,
  };
}

async function fetchCricketSummaryContext(eventId: string, inningsNumber?: number | null): Promise<CricketSummaryContext | null> {
  const response = await fetch(ESPN_IPL_SUMMARY_URL(eventId));
  if (!response.ok) return null;
  const data = (await response.json()) as ESPNCricketSummary;
  const context = extractCricketSummaryContext(data, inningsNumber);
  return context.currentBatters?.length || context.currentBowler || context.overTrack?.length ? context : null;
}

let cache: { timestamp: number; patches: Map<string, CricketLivePatch> } | null = null;
const CACHE_TTL_MS = 5000;

async function fetchIplPatches(): Promise<Map<string, CricketLivePatch>> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) return cache.patches;

  const response = await fetch(ESPN_IPL_SCOREBOARD_URL);
  if (!response.ok) return new Map<string, CricketLivePatch>();

  const data = (await response.json()) as ESPNCricketScoreboard;
  const patches = new Map<string, CricketLivePatch>();
  for (const event of data.events ?? []) {
    const patch = patchFromEvent(event);
    if (patch) patches.set(event.id, patch);
  }

  await Promise.all(Array.from(patches.entries()).map(async ([eventId, patch]) => {
    try {
      const context = await fetchCricketSummaryContext(eventId, patch.cricketState.innings);
      if (!context) return;
      patch.cricketState = {
        ...patch.cricketState,
        currentBatters: context.currentBatters ?? patch.cricketState.currentBatters,
        currentBowler: context.currentBowler ?? patch.cricketState.currentBowler,
        overTrack: context.overTrack ?? patch.cricketState.overTrack,
        currentOver: context.currentOver ?? patch.cricketState.currentOver,
      };
    } catch {
      // Player names are supplementary; keep the live score patch if summary is unavailable.
    }
  }));

  cache = { timestamp: Date.now(), patches };
  return patches;
}

function applyPatch(game: GameWithPrediction, patch: CricketLivePatch | undefined): GameWithPrediction {
  if (!patch) return game;
  return {
    ...game,
    homeScore: patch.homeScore ?? game.homeScore,
    awayScore: patch.awayScore ?? game.awayScore,
    homeScoreDisplay: patch.homeScoreDisplay ?? game.homeScoreDisplay,
    awayScoreDisplay: patch.awayScoreDisplay ?? game.awayScoreDisplay,
    clock: patch.clock ?? game.clock,
    quarter: patch.quarter ?? game.quarter,
    cricketState: patch.cricketState,
  };
}

export async function enrichCricketLiveGames<T extends GameWithPrediction>(games: T[]): Promise<T[]> {
  if (!games.some((game) => game.sport === Sport.IPL && game.status === GameStatus.LIVE)) return games;

  try {
    const patches = await fetchIplPatches();
    let changed = false;
    const nextGames = games.map((game) => {
      const next = applyPatch(game, patches.get(game.id));
      if (next !== game) changed = true;
      return next as T;
    });
    return changed ? nextGames : games;
  } catch {
    return games;
  }
}

export async function enrichCricketLiveGame<T extends GameWithPrediction | null>(game: T): Promise<T> {
  if (!game || game.sport !== Sport.IPL || game.status !== GameStatus.LIVE) return game;
  const [enriched] = await enrichCricketLiveGames([game]);
  return (enriched ?? game) as T;
}
