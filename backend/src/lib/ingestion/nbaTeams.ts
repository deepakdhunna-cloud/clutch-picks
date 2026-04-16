/**
 * NBA team directory for LLM-extraction validation.
 *
 * The LLM returns a 3-letter team abbreviation for every extracted signal.
 * We use this table to (a) reject hallucinated/unknown abbreviations and
 * (b) convert to the ESPN team id the rest of the code (Elo ratings,
 * scheduling, etc.) speaks in.
 *
 * Keep in sync with ESPN's NBA listing. Abbreviations are ESPN-canonical
 * (e.g. "GSW" not "GS", "BKN" not "BRK", "NOP" not "NOR").
 */

export interface NBATeamEntry {
  espnId: string;    // ESPN team id (matches lib/nbaStatsApi.ts ESPN_TO_NBA_TEAM_ID)
  abbr: string;      // 3-letter code
  displayName: string;
}

export const NBA_TEAMS: NBATeamEntry[] = [
  { espnId: "1",  abbr: "ATL", displayName: "Atlanta Hawks" },
  { espnId: "2",  abbr: "BOS", displayName: "Boston Celtics" },
  { espnId: "17", abbr: "BKN", displayName: "Brooklyn Nets" },
  { espnId: "30", abbr: "CHA", displayName: "Charlotte Hornets" },
  { espnId: "4",  abbr: "CHI", displayName: "Chicago Bulls" },
  { espnId: "5",  abbr: "CLE", displayName: "Cleveland Cavaliers" },
  { espnId: "6",  abbr: "DAL", displayName: "Dallas Mavericks" },
  { espnId: "7",  abbr: "DEN", displayName: "Denver Nuggets" },
  { espnId: "8",  abbr: "DET", displayName: "Detroit Pistons" },
  { espnId: "9",  abbr: "GSW", displayName: "Golden State Warriors" },
  { espnId: "10", abbr: "HOU", displayName: "Houston Rockets" },
  { espnId: "11", abbr: "IND", displayName: "Indiana Pacers" },
  { espnId: "12", abbr: "LAC", displayName: "LA Clippers" },
  { espnId: "13", abbr: "LAL", displayName: "Los Angeles Lakers" },
  { espnId: "29", abbr: "MEM", displayName: "Memphis Grizzlies" },
  { espnId: "14", abbr: "MIA", displayName: "Miami Heat" },
  { espnId: "15", abbr: "MIL", displayName: "Milwaukee Bucks" },
  { espnId: "16", abbr: "MIN", displayName: "Minnesota Timberwolves" },
  { espnId: "3",  abbr: "NOP", displayName: "New Orleans Pelicans" },
  { espnId: "18", abbr: "NYK", displayName: "New York Knicks" },
  { espnId: "25", abbr: "OKC", displayName: "Oklahoma City Thunder" },
  { espnId: "19", abbr: "ORL", displayName: "Orlando Magic" },
  { espnId: "20", abbr: "PHI", displayName: "Philadelphia 76ers" },
  { espnId: "21", abbr: "PHX", displayName: "Phoenix Suns" },
  { espnId: "22", abbr: "POR", displayName: "Portland Trail Blazers" },
  { espnId: "23", abbr: "SAC", displayName: "Sacramento Kings" },
  { espnId: "24", abbr: "SAS", displayName: "San Antonio Spurs" },
  { espnId: "28", abbr: "TOR", displayName: "Toronto Raptors" },
  { espnId: "26", abbr: "UTA", displayName: "Utah Jazz" },
  { espnId: "27", abbr: "WAS", displayName: "Washington Wizards" },
];

const BY_ABBR = new Map<string, NBATeamEntry>(NBA_TEAMS.map((t) => [t.abbr, t]));

export function isValidNBAAbbreviation(abbr: string): boolean {
  return BY_ABBR.has(abbr.toUpperCase());
}

export function getTeamByAbbr(abbr: string): NBATeamEntry | null {
  return BY_ABBR.get(abbr.toUpperCase()) ?? null;
}

export const NBA_ABBR_LIST: string[] = NBA_TEAMS.map((t) => t.abbr);
