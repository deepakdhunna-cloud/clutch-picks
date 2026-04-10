/**
 * Sports Prediction API Types
 */

// Sport categories
export enum Sport {
  NFL = "NFL",
  NBA = "NBA",
  MLB = "MLB",
  NHL = "NHL",
  NCAAF = "NCAAF",
  NCAAB = "NCAAB",
  MLS = "MLS",
  EPL = "EPL",
}

// League categories
export enum League {
  Pro = "Pro",
  College = "College",
}

// Game status
export enum GameStatus {
  Scheduled = "scheduled",
  InProgress = "in_progress",
  Final = "final",
  Postponed = "postponed",
}

// Team record
export interface TeamRecord {
  wins: number;
  losses: number;
  ties?: number;
}

// Team definition
export interface Team {
  id: string;
  name: string;
  abbreviation: string;
  logo: string;
  record: TeamRecord;
}

// Game definition
export interface Game {
  id: string;
  sport: Sport;
  league: League;
  homeTeam: Team;
  awayTeam: Team;
  dateTime: string; // ISO 8601 format
  venue: string;
  tvChannel: string;
  status: GameStatus;
  homeScore?: number;
  awayScore?: number;
}

// Individual prediction factor
export interface PredictionFactor {
  name: string;
  weight: number;
  homeScore: number; // -1 to 1
  awayScore: number; // -1 to 1
  description: string;
}

// AI Prediction
export interface Prediction {
  gameId: string;
  predictedWinner: "home" | "away";
  confidence: number; // 50-94%
  aiAnalysis: string;
  marketFavorite: "home" | "away";
  spread: number; // Positive means home favored
  overUnder: number;
  // Advanced fields
  homeWinProbability: number; // 0-100
  awayWinProbability: number; // 0-100
  factors: PredictionFactor[];
  edgeRating: number; // 1-10
  valueRating: number; // 1-10
  recentFormHome: string; // "W-W-L-W-L"
  recentFormAway: string;
  homeStreak: number; // positive = win streak, negative = loss streak
  awayStreak: number;
  isTossUp?: boolean; // true if game is within 45-55% probability range
  aiAgreesWithModel?: boolean; // true if AI independent assessment matches model pick
  dataCoverage?: number; // 0.0–1.0: fraction of factors with non-default data
  lowDataWarning?: boolean; // true when dataCoverage < 0.6 — show ⚠️ Limited data UI
  // Ensemble sub-model outputs
  drawProbability?: number; // 0-100: estimated draw probability for soccer leagues
  ensembleDivergence?: boolean; // true when ≥2 sub-models disagree on the winner
  subModelProbs?: {
    eloOnly: number;       // eloOnlyModel homeWinProb 0–100
    recentForm: number;    // recentFormModel homeWinProb 0–100
    composite: number;     // full composite model homeWinProb 0–100
  };
}

// Combined game with prediction
export interface GameWithPrediction extends Game {
  prediction: Prediction;
}

// Sport category info
export interface SportCategory {
  sport: Sport;
  name: string;
  league: League;
  icon: string;
  gameCount: number;
}

// API Response types
export interface SportsListResponse {
  sports: SportCategory[];
}

export interface GamesResponse {
  games: GameWithPrediction[];
}

export interface GameResponse {
  game: GameWithPrediction;
}

export interface PredictionResponse {
  prediction: Prediction;
}
