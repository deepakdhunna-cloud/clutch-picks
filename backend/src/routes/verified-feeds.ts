import { Hono } from "hono";

const USER_AGENT = "ClutchPicks/1.0 (+https://clutchpicksapp.com)";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type UmpireTendencyFile = {
  _meta: Record<string, unknown>;
  umpires: Record<string, {
    runsPerGameBias: number;
    favorsHome: number;
    sampleSize: number;
  }>;
};

type ManagerChangeFile = {
  _meta: Record<string, unknown>;
  EPL: Record<string, { newManager: string; changeDate: string }>;
  MLS: Record<string, { newManager: string; changeDate: string }>;
  UCL_teams: Record<string, { newManager: string; changeDate: string }>;
};

type UclCoefficientFile = {
  _meta: Record<string, unknown>;
  pedigree: Record<string, number>;
};

type UclLocationFile = {
  _meta: Record<string, unknown>;
  cities: Record<string, [number, number]>;
  teamCity: Record<string, string>;
};

type EspnTeamsResponse = {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{
        team?: {
          displayName?: string;
          name?: string;
          shortDisplayName?: string;
          location?: string;
        };
      }>;
    }>;
  }>;
};

type WikidataBinding = {
  teamLabel?: { value?: string };
  matchedLabel?: { value?: string };
  coachLabel?: { value?: string };
  start?: { value?: string };
};

type WikidataResponse = {
  results?: {
    bindings?: WikidataBinding[];
  };
};

type UmpScorecardsGamesResponse = {
  rows?: Array<{
    umpire?: string;
    favor?: number;
    home_batter_impact?: number;
    away_batter_impact?: number;
  }>;
};

type UefaCoefficientsResponse = {
  baseYear?: number;
  seasonLabel?: string;
  rows?: Array<{
    club?: string;
    total?: number;
  }>;
};

const cache = new Map<string, CacheEntry<unknown>>();

const ESPN_TEAM_ENDPOINTS = {
  EPL: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams",
  MLS: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/teams",
  UCL: "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/teams",
} as const;

const TEAM_ALIASES: Record<string, string[]> = {
  "Ajax Amsterdam": ["Ajax"],
  "AS Monaco": ["Monaco"],
  "Barcelona": ["FC Barcelona"],
  "Bayer Leverkusen": ["Bayer 04 Leverkusen"],
  "Bayern Munich": ["FC Bayern München", "Bayern München"],
  "Bodo/Glimt": ["Bodø / Glimt", "Bodø/Glimt"],
  "F.C. København": ["FC København", "FC Copenhagen", "Copenhagen"],
  "FK Qarabag": ["Qarabağ", "Qarabag FK"],
  "Internazionale": ["Inter", "Inter Milan", "FC Internazionale Milano"],
  "Kairat Almaty": ["Kairat"],
  "Marseille": ["Olympique Marseille"],
  "Olympiacos": ["Olympiacos F.C."],
  "Pafos": ["Paphos", "Pafos FC", "Paphos FC"],
  "PSV Eindhoven": ["PSV"],
  "Slavia Prague": ["Slavia Praha"],
  "Union St.-Gilloise": ["Union Saint-Gilloise", "Union SG"],
};

const UCL_TEAM_LOCATIONS: Record<string, { city: string; coord: [number, number] }> = {
  "AS Monaco": { city: "Monaco", coord: [43.7384, 7.4246] },
  "Ajax Amsterdam": { city: "Amsterdam", coord: [52.3676, 4.9041] },
  "Arsenal": { city: "London", coord: [51.5074, -0.1278] },
  "Atalanta": { city: "Bergamo", coord: [45.6983, 9.6773] },
  "Athletic Club": { city: "Bilbao", coord: [43.263, -2.935] },
  "Atlético Madrid": { city: "Madrid", coord: [40.4168, -3.7038] },
  "Barcelona": { city: "Barcelona", coord: [41.3874, 2.1686] },
  "Bayer Leverkusen": { city: "Leverkusen", coord: [51.0459, 7.0192] },
  "Bayern Munich": { city: "Munich", coord: [48.1351, 11.582] },
  "Benfica": { city: "Lisbon", coord: [38.7223, -9.1393] },
  "Bodo/Glimt": { city: "Bodo", coord: [67.2804, 14.405] },
  "Borussia Dortmund": { city: "Dortmund", coord: [51.5136, 7.4653] },
  "Chelsea": { city: "London", coord: [51.5074, -0.1278] },
  "Club Brugge": { city: "Bruges", coord: [51.2093, 3.2247] },
  "Eintracht Frankfurt": { city: "Frankfurt", coord: [50.1109, 8.6821] },
  "F.C. København": { city: "Copenhagen", coord: [55.6761, 12.5683] },
  "FK Qarabag": { city: "Baku", coord: [40.4093, 49.8671] },
  "Galatasaray": { city: "Istanbul", coord: [41.0082, 28.9784] },
  "Internazionale": { city: "Milan", coord: [45.4642, 9.19] },
  "Juventus": { city: "Turin", coord: [45.0703, 7.6869] },
  "Kairat Almaty": { city: "Almaty", coord: [43.222, 76.8512] },
  "Liverpool": { city: "Liverpool", coord: [53.4084, -2.9916] },
  "Manchester City": { city: "Manchester", coord: [53.4808, -2.2426] },
  "Marseille": { city: "Marseille", coord: [43.2965, 5.3698] },
  "Napoli": { city: "Naples", coord: [40.8518, 14.2681] },
  "Newcastle United": { city: "Newcastle upon Tyne", coord: [54.9783, -1.6178] },
  "Olympiacos": { city: "Piraeus", coord: [37.942, 23.646] },
  "PSV Eindhoven": { city: "Eindhoven", coord: [51.4416, 5.4697] },
  "Pafos": { city: "Paphos", coord: [34.772, 32.4297] },
  "Paris Saint-Germain": { city: "Paris", coord: [48.8566, 2.3522] },
  "Real Madrid": { city: "Madrid", coord: [40.4168, -3.7038] },
  "Slavia Prague": { city: "Prague", coord: [50.0755, 14.4378] },
  "Sporting CP": { city: "Lisbon", coord: [38.7223, -9.1393] },
  "Tottenham Hotspur": { city: "London", coord: [51.5074, -0.1278] },
  "Union St.-Gilloise": { city: "Brussels", coord: [50.8503, 4.3517] },
  "Villarreal": { city: "Villarreal", coord: [39.9383, -0.1004] },
};

export const verifiedFeedsRouter = new Hono();

verifiedFeedsRouter.get("/mlb-umpire-tendencies", async (c) =>
  c.json(await cached("mlb-umpire-tendencies", buildMlbUmpireTendencies), 200, feedHeaders()),
);

verifiedFeedsRouter.get("/soccer-manager-changes", async (c) =>
  c.json(await cached("soccer-manager-changes", buildSoccerManagerChanges), 200, feedHeaders()),
);

verifiedFeedsRouter.get("/ucl-coefficients", async (c) =>
  c.json(await cached("ucl-coefficients", buildUclCoefficients), 200, feedHeaders()),
);

verifiedFeedsRouter.get("/ucl-team-locations", async (c) =>
  c.json(await cached("ucl-team-locations", buildUclTeamLocations), 200, feedHeaders()),
);

function feedHeaders(): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=21600",
  };
}

async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function round(value: number, places = 3): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function yesterdayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
}

function currentUefaBaseYear(now = new Date()): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? year + 1 : year;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[åÅ]/g, "a")
    .replace(/[ß]/g, "ss")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/\b(f\.?\s?c\.?|a\.?\s?f\.?\s?c\.?|c\.?\s?f\.?|s\.?\s?c\.?|fk|cf|sc)\b/g, " ")
    .replace(/\b(football club|futbol club|futbol|fútbol club|club de futbol|04)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function aliasesFor(name: string): string[] {
  return [name, ...(TEAM_ALIASES[name] ?? [])];
}

function addLookupName(lookup: Map<string, string>, alias: string, canonical: string): void {
  const normalized = normalizeName(alias);
  if (normalized) lookup.set(normalized, canonical);
}

function buildNameLookup(canonicalNames: string[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const canonical of canonicalNames) {
    for (const alias of aliasesFor(canonical)) {
      addLookupName(lookup, alias, canonical);
    }
  }
  return lookup;
}

async function buildMlbUmpireTendencies(): Promise<UmpireTendencyFile> {
  const end = yesterdayUtc();
  const year = end.getUTCFullYear();
  const startDate = `${year}-01-01`;
  const endDate = isoDate(end);
  const sourceUrl = `https://umpscorecards.com/api/games?startDate=${startDate}&endDate=${endDate}&seasonType=R`;
  const data = await fetchJson<UmpScorecardsGamesResponse>(sourceUrl);
  const aggregates = new Map<string, { batterBias: number; favor: number; sampleSize: number }>();

  for (const row of data.rows ?? []) {
    const umpire = row.umpire?.trim();
    if (!umpire) continue;
    const homeBatter = asNumber(row.home_batter_impact);
    const awayBatter = asNumber(row.away_batter_impact);
    const favor = asNumber(row.favor);
    if (homeBatter === null || awayBatter === null || favor === null) continue;

    const current = aggregates.get(umpire) ?? { batterBias: 0, favor: 0, sampleSize: 0 };
    current.batterBias += homeBatter + awayBatter;
    current.favor += favor;
    current.sampleSize += 1;
    aggregates.set(umpire, current);
  }

  const umpires = Object.fromEntries(
    [...aggregates.entries()].map(([umpire, row]) => [
      umpire,
      {
        runsPerGameBias: round(row.batterBias / row.sampleSize),
        favorsHome: round(row.favor / row.sampleSize),
        sampleSize: row.sampleSize,
      },
    ]),
  );

  return {
    _meta: {
      description: "MLB home-plate umpire tendency feed adapted from UmpScorecards game-level public data.",
      source: sourceUrl,
      sourceMetric: "home_batter_impact + away_batter_impact averaged per umpire; positive favors hitters, negative favors pitchers.",
      lastUpdated: isoDate(new Date()),
    },
    umpires,
  };
}

async function fetchEspnTeamNames(league: keyof typeof ESPN_TEAM_ENDPOINTS): Promise<string[]> {
  const data = await fetchJson<EspnTeamsResponse>(ESPN_TEAM_ENDPOINTS[league]);
  const teams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams
    .map((entry) => entry.team?.displayName?.trim())
    .filter((name): name is string => !!name);
}

function wikidataDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return isoDate(date);
}

function sparqlUrl(query: string): string {
  return `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
}

async function fetchWikidata(query: string): Promise<WikidataBinding[]> {
  const data = await fetchJson<WikidataResponse>(sparqlUrl(query));
  return data.results?.bindings ?? [];
}

function wikidataLeagueManagerQuery(leagueEntity: string): string {
  return `
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?teamLabel ?coachLabel ?start WHERE {
  ?team wdt:P118 wd:${leagueEntity};
        wdt:P31/wdt:P279* wd:Q476028.
  ?team p:P286 ?coachStmt.
  ?coachStmt ps:P286 ?coach.
  OPTIONAL { ?coachStmt pq:P580 ?start. }
  FILTER NOT EXISTS { ?coachStmt pq:P582 ?end. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;
}

function wikidataNamedTeamsManagerQuery(teamNames: string[]): string {
  const values = teamNames
    .flatMap((name) => aliasesFor(name))
    .map((name) => `"${name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"@en`)
    .join(" ");

  return `
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?matchedLabel ?teamLabel ?coachLabel ?start WHERE {
  VALUES ?matchedLabel { ${values} }
  ?team (rdfs:label|skos:altLabel) ?matchedLabel;
        wdt:P31/wdt:P279* wd:Q476028.
  ?team p:P286 ?coachStmt.
  ?coachStmt ps:P286 ?coach.
  OPTIONAL { ?coachStmt pq:P580 ?start. }
  FILTER NOT EXISTS { ?coachStmt pq:P582 ?end. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;
}

function managerMapFromBindings(
  bindings: WikidataBinding[],
  canonicalNames: string[],
): Record<string, { newManager: string; changeDate: string }> {
  const lookup = buildNameLookup(canonicalNames);
  const map: Record<string, { newManager: string; changeDate: string }> = {};

  for (const binding of bindings) {
    const sourceName = binding.matchedLabel?.value ?? binding.teamLabel?.value;
    const coach = binding.coachLabel?.value;
    const changeDate = wikidataDate(binding.start?.value);
    if (!sourceName || !coach || !changeDate) continue;
    const canonical = lookup.get(normalizeName(sourceName));
    if (!canonical) continue;
    map[canonical] = { newManager: coach, changeDate };
  }

  return map;
}

async function buildSoccerManagerChanges(): Promise<ManagerChangeFile> {
  const [eplTeams, mlsTeams, uclTeams, eplBindings, mlsBindings] = await Promise.all([
    fetchEspnTeamNames("EPL"),
    fetchEspnTeamNames("MLS"),
    fetchEspnTeamNames("UCL"),
    fetchWikidata(wikidataLeagueManagerQuery("Q9448")),
    fetchWikidata(wikidataLeagueManagerQuery("Q18543")),
  ]);
  const uclBindings = await fetchWikidata(wikidataNamedTeamsManagerQuery(uclTeams));

  return {
    _meta: {
      description: "Current soccer manager start-date feed adapted from Wikidata head-coach statements and ESPN active team lists.",
      sources: {
        espnTeams: ESPN_TEAM_ENDPOINTS,
        wikidata: "https://query.wikidata.org/sparql",
      },
      lastUpdated: isoDate(new Date()),
    },
    EPL: managerMapFromBindings(eplBindings, eplTeams),
    MLS: managerMapFromBindings(mlsBindings, mlsTeams),
    UCL_teams: managerMapFromBindings(uclBindings, uclTeams),
  };
}

async function buildUclCoefficients(): Promise<UclCoefficientFile> {
  const baseYear = currentUefaBaseYear();
  const sourceUrl = `https://api.rankingiuefa.pl/clubs/five-years/${baseYear}`;
  const [data, uclTeams] = await Promise.all([
    fetchJson<UefaCoefficientsResponse>(sourceUrl),
    fetchEspnTeamNames("UCL"),
  ]);

  const sourceRows = data.rows ?? [];
  const byNormalized = new Map<string, number>();
  const pedigree: Record<string, number> = {};

  for (const row of sourceRows) {
    if (!row.club || typeof row.total !== "number") continue;
    pedigree[row.club] = row.total;
    byNormalized.set(normalizeName(row.club), row.total);
  }

  for (const teamName of uclTeams) {
    for (const alias of aliasesFor(teamName)) {
      const value = byNormalized.get(normalizeName(alias));
      if (value !== undefined) {
        pedigree[teamName] = Number(value);
        break;
      }
    }
  }

  return {
    _meta: {
      description: "UCL club pedigree feed adapted from RankingUEFA five-year club coefficients.",
      source: sourceUrl,
      seasonLabel: data.seasonLabel ?? `${baseYear - 1}/${baseYear}`,
      lastUpdated: isoDate(new Date()),
    },
    pedigree,
  };
}

async function buildUclTeamLocations(): Promise<UclLocationFile> {
  const uclTeams = await fetchEspnTeamNames("UCL");
  const cities: Record<string, [number, number]> = {};
  const teamCity: Record<string, string> = {};
  const missingTeams: string[] = [];

  for (const teamName of uclTeams) {
    const location = UCL_TEAM_LOCATIONS[teamName];
    if (!location) {
      missingTeams.push(teamName);
      continue;
    }
    teamCity[teamName] = location.city;
    cities[location.city] = location.coord;
  }

  return {
    _meta: {
      description: "UCL team travel-location feed for ESPN active Champions League teams.",
      source: ESPN_TEAM_ENDPOINTS.UCL,
      coordinateSource: "Club home-city coordinates verified from public geographic references and stored as release data.",
      missingTeams,
      lastUpdated: isoDate(new Date()),
    },
    cities,
    teamCity,
  };
}
