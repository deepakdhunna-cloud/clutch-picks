// Sport Types for Sports Prediction App

export enum Sport {
  NFL = 'NFL',
  NBA = 'NBA',
  MLB = 'MLB',
  NHL = 'NHL',
  MLS = 'MLS',
  NCAAF = 'NCAAF',
  NCAAB = 'NCAAB',
  EPL = 'EPL',
  UCL = 'UCL',
  IPL = 'IPL',
  TENNIS = 'TENNIS',
}

export enum League {
  // Pro Leagues
  NFL = 'NFL',
  NBA = 'NBA',
  MLB = 'MLB',
  NHL = 'NHL',
  MLS = 'MLS',
  EPL = 'EPL',
  UCL = 'UCL',
  IPL = 'IPL',
  TENNIS = 'TENNIS',
  // College
  NCAAF = 'NCAAF',
  NCAAB = 'NCAAB',
}

export enum GameStatus {
  SCHEDULED = 'SCHEDULED',
  LIVE = 'LIVE',
  FINAL = 'FINAL',
  POSTPONED = 'POSTPONED',
  CANCELLED = 'CANCELLED',
}

export interface Team {
  id: string;
  name: string;
  abbreviation: string;
  city: string;
  logo?: string;
  record: string; // e.g., "10-3" or "45-20"
  color: string; // Primary team color
  rank?: number;
  seed?: number;
  rankingPoints?: number;
  tour?: 'ATP' | 'WTA';
  tennisRankSource?: 'espn-rankings';
  standingsRank?: number;
  standingsPoints?: number;
  netRunRate?: number;
  matchesPlayed?: number;
}

export interface Game {
  id: string;
  sport: Sport;
  homeTeam: Team;
  awayTeam: Team;
  gameTime: string; // ISO date string
  status: GameStatus;
  venue: string;
  tvChannel?: string;
  watchSources?: string[];
  homeScore?: number;
  awayScore?: number;
  spread?: number; // Positive means home favored
  overUnder?: number;
  marketFavorite?: 'home' | 'away';
  quarter?: string; // For live games: "Q1", "Q2", "3rd Period", etc.
  clock?: string; // Time remaining in period
  statusLabel?: string;
  statusDetail?: string;
  suspension?: {
    display: string;
    resumeText: string;
    reasonText: string;
    source?: string;
  };
  seasonContext?: {
    phase: string;
    label: string;
    detail: string;
    source: string;
  } | null;
  homeLinescores?: number[];
  awayLinescores?: number[];
  liveState?: {
    balls: number;
    strikes: number;
    outs: number;
    onFirst: boolean;
    onSecond: boolean;
    onThird: boolean;
    inningHalf: 'top' | 'bottom' | null;
    inning?: number;
    inningNumber?: number | null;
    betweenInnings?: boolean;
    inningTransition?: 'mid' | 'end' | null;
    pitcher: { name: string | null; teamAbbr: string } | null;
    batter: { name: string | null; teamAbbr: string } | null;
  };
}

export interface PredictionFactor {
  name: string;
  weight: number;
  homeScore: number; // -1 to 1
  awayScore: number; // -1 to 1
  description: string;
}

export interface Prediction {
  id: string;
  gameId: string;
  predictedWinner: 'home' | 'away';
  predictedOutcome?: 'home' | 'away' | 'draw';
  confidence: number; // 0-100
  predictedSpread?: number;
  predictedTotal?: number;
  analysis?: string;
  createdAt: string;
  // Advanced fields from new prediction engine
  homeWinProbability?: number; // 0-100
  awayWinProbability?: number; // 0-100
  factors?: PredictionFactor[];
  edgeRating?: number; // 1-10
  valueRating?: number; // 1-10
  recentFormHome?: string; // "W-W-L-W-L"
  recentFormAway?: string;
  homeStreak?: number;
  awayStreak?: number;
  isTossUp?: boolean; // true if game is within 45-55% probability range
  lowDataWarning?: boolean; // true when dataCoverage < 0.6
  ensembleDivergence?: boolean; // true when sub-models disagree on winner
  projection?: {
    engine: string;
    iterations: number;
    homeWinProbability: number;
    awayWinProbability: number;
    drawProbability?: number;
    projectedHomeScore: number;
    projectedAwayScore: number;
    projectedSpread: number;
    projectedTotal: number;
    volatility: number;
    upsetRisk: number;
    signals: Array<{
      key: string;
      label: string;
      value: number;
      evidence: string;
    }>;
  };
  // Post-hoc comparison to SharpAPI market consensus. Populated only when
  // the backend has SHARPAPI_KEY set. NOT a prediction input.
  marketComparison?: {
    modelHomeProb: number;     // 0..1
    marketHomeProb: number;    // 0..1 (Pinnacle de-vigged)
    divergence: number;        // 0..1
    isDivergent: boolean;      // divergence > 0.10
    bestBook?: { sportsbook: string; american: number } | null;
  };
}

export interface GameWithPrediction extends Game {
  prediction?: Prediction;
}

// Sport metadata for UI display
export interface SportMeta {
  sport: Sport;
  name: string;
  icon: string;
  color: string;
  accentColor: string;
  isCollege: boolean;
}

export const SPORT_META: Record<Sport, SportMeta> = {
  [Sport.NFL]: {
    sport: Sport.NFL,
    name: 'NFL Football',
    icon: 'football',
    color: '#2E4A5E',
    accentColor: '#FFFFFF',
    isCollege: false,
  },
  [Sport.NBA]: {
    sport: Sport.NBA,
    name: 'NBA Basketball',
    icon: 'basketball',
    color: '#8B0A1F',
    accentColor: '#FFFFFF',
    isCollege: false,
  },
  [Sport.MLB]: {
    sport: Sport.MLB,
    name: 'MLB Baseball',
    icon: 'baseball',
    color: '#9FABB8',
    accentColor: '#FFFFFF',
    isCollege: false,
  },
  [Sport.NHL]: {
    sport: Sport.NHL,
    name: 'NHL Hockey',
    icon: 'hockey-puck',
    color: '#3D5A6F',
    accentColor: '#FFFFFF',
    isCollege: false,
  },
  [Sport.MLS]: {
    sport: Sport.MLS,
    name: 'MLS Soccer',
    icon: 'soccer-ball',
    color: '#C9BDA8',
    accentColor: '#FFFFFF',
    isCollege: false,
  },
  [Sport.EPL]: {
    sport: Sport.EPL,
    name: 'Premier League',
    icon: 'soccer-ball',
    color: '#6A0818',
    accentColor: '#FFFFFF',
    isCollege: false,
  },
  [Sport.UCL]: {
    sport: Sport.UCL,
    name: 'Champions League',
    icon: 'soccer-ball',
    color: '#1A2A6C',
    accentColor: '#FFFFFF',
    isCollege: false,
  },
  [Sport.IPL]: {
    sport: Sport.IPL,
    name: 'IPL Cricket',
    icon: 'cricket',
    color: '#D7A21E',
    accentColor: '#FFFFFF',
    isCollege: false,
  },
  [Sport.TENNIS]: {
    sport: Sport.TENNIS,
    name: 'Tennis',
    icon: 'tennis',
    color: '#2E7D5B',
    accentColor: '#FFFFFF',
    isCollege: false,
  },
  [Sport.NCAAF]: {
    sport: Sport.NCAAF,
    name: 'CFB',
    icon: 'football',
    color: '#5A7A8A',
    accentColor: '#FFFFFF',
    isCollege: true,
  },
  [Sport.NCAAB]: {
    sport: Sport.NCAAB,
    name: 'CBB',
    icon: 'basketball',
    color: '#D98E76',
    accentColor: '#FFFFFF',
    isCollege: true,
  },
};
