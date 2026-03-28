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
}

export enum League {
  // Pro Leagues
  NFL = 'NFL',
  NBA = 'NBA',
  MLB = 'MLB',
  NHL = 'NHL',
  MLS = 'MLS',
  EPL = 'EPL',
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
  homeScore?: number;
  awayScore?: number;
  spread?: number; // Positive means home favored
  overUnder?: number;
  marketFavorite?: 'home' | 'away';
  quarter?: string; // For live games: "Q1", "Q2", "3rd Period", etc.
  clock?: string; // Time remaining in period
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
