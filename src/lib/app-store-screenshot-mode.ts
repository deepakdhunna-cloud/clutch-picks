import { GameStatus, Sport, type GameWithPrediction } from '@/types/sports';

// TEMPORARY APP STORE SCREENSHOT STAGING.
// Remove by reverting the commit that introduced this file and its imports.
export const APP_STORE_SCREENSHOT_MODE = true;

export const SCREENSHOT_PROFILE = {
  name: 'Deepak',
  handle: '@clutchpicks',
};

function isoMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function screenshotPrediction(
  gameId: string,
  pick: 'home' | 'away',
  homeProbability: number,
  awayProbability: number,
  confidence: number,
  projectedHomeScore: number,
  projectedAwayScore: number,
) {
  const finalProbability = pick === 'home' ? homeProbability : awayProbability;
  const createdAt = isoMinutesFromNow(-18);
  return {
    id: `screenshot-prediction-${gameId}`,
    gameId,
    predictedWinner: pick,
    predictedOutcome: pick,
    confidence,
    homeWinProbability: homeProbability * 100,
    awayWinProbability: awayProbability * 100,
    predictedSpread: projectedHomeScore - projectedAwayScore,
    predictedTotal: projectedHomeScore + projectedAwayScore,
    edgeRating: 8,
    valueRating: 7,
    recentFormHome: 'W-W-L-W-W',
    recentFormAway: 'L-W-L-W-L',
    homeStreak: 3,
    awayStreak: 1,
    analysis: 'Live edge profile: bullpen leverage, plate discipline, and late-inning matchup pressure all point toward the home side holding the cleaner path.',
    createdAt,
    canonicalResult: {
      eventId: gameId,
      marketType: 'moneyline',
      finalPick: pick,
      finalProbability,
      confidence,
      probabilities: {
        home: homeProbability,
        away: awayProbability,
      },
      projectedScore: {
        home: projectedHomeScore,
        away: projectedAwayScore,
        spread: projectedHomeScore - projectedAwayScore,
        total: projectedHomeScore + projectedAwayScore,
      },
      simulationSummary: {
        engine: 'clutch-screenshot-model',
        iterations: 8000,
        probabilities: {
          home: homeProbability,
          away: awayProbability,
        },
        volatility: 0.31,
        upsetRisk: 1 - finalProbability,
      },
      timestamp: createdAt,
      dataVersion: 'app-store-screenshot',
    },
    projection: {
      engine: 'clutch-screenshot-model',
      iterations: 8000,
      homeWinProbability: homeProbability,
      awayWinProbability: awayProbability,
      projectedHomeScore,
      projectedAwayScore,
      projectedSpread: projectedHomeScore - projectedAwayScore,
      projectedTotal: projectedHomeScore + projectedAwayScore,
      volatility: 0.31,
      upsetRisk: 1 - finalProbability,
      signals: [
        {
          key: 'live-pressure',
          label: 'Live pressure edge',
          value: 0.82,
          evidence: 'The matchup profile favors the home side in late innings with runners on and a stronger leverage bullpen ready.',
        },
        {
          key: 'form',
          label: 'Recent form',
          value: 0.74,
          evidence: 'The model grades the home side higher across recent scoring quality and late-game conversion.',
        },
      ],
    },
    factors: [
      {
        name: 'Late Inning Leverage',
        weight: 0.24,
        homeScore: 0.78,
        awayScore: -0.28,
        description: 'Home bullpen depth and pressure hitting create the cleanest live edge.',
      },
      {
        name: 'Plate Discipline',
        weight: 0.2,
        homeScore: 0.66,
        awayScore: -0.18,
        description: 'Projected traffic on base favors the home lineup.',
      },
    ],
  } satisfies GameWithPrediction['prediction'];
}

export function getScreenshotGames(): GameWithPrediction[] {
  const mlbId = 'screenshot-mlb-live-dodgers-mets';
  const nbaId = 'screenshot-nba-finals-spurs-thunder';
  const iplId = 'screenshot-ipl-pbks-lsg';
  const nhlId = 'screenshot-nhl-stars-avalanche';

  return [
    {
      id: mlbId,
      sport: Sport.MLB,
      status: GameStatus.LIVE,
      gameTime: isoMinutesFromNow(-125),
      venue: 'Dodger Stadium',
      tvChannel: 'Apple TV+',
      watchSources: ['Apple TV+', 'MLB.TV', 'YouTube TV', 'Fubo'],
      homeTeam: {
        id: 'lad',
        name: 'Los Angeles Dodgers',
        city: 'Los Angeles',
        abbreviation: 'LAD',
        record: '34-18',
        color: '#005A9C',
      },
      awayTeam: {
        id: 'nym',
        name: 'New York Mets',
        city: 'New York',
        abbreviation: 'NYM',
        record: '29-23',
        color: '#FF5910',
      },
      homeScore: 6,
      awayScore: 5,
      homeLinescores: [1, 0, 2, 0, 1, 0, 2],
      awayLinescores: [0, 2, 0, 1, 0, 2, 0],
      quarter: 'BOT 7',
      clock: '1 OUT',
      spread: -1.5,
      overUnder: 8.5,
      marketFavorite: 'home',
      liveState: {
        balls: 3,
        strikes: 2,
        outs: 1,
        onFirst: true,
        onSecond: true,
        onThird: true,
        inningHalf: 'bottom',
        inning: 7,
        inningNumber: 7,
        betweenInnings: false,
        inningTransition: null,
        pitcher: { name: 'Reed Garrett', teamAbbr: 'NYM' },
        batter: { name: 'Shohei Ohtani', teamAbbr: 'LAD' },
      },
      prediction: screenshotPrediction(mlbId, 'home', 0.684, 0.316, 76, 6.8, 5.4),
    },
    {
      id: nbaId,
      sport: Sport.NBA,
      status: GameStatus.FINAL,
      gameTime: isoMinutesFromNow(-1320),
      venue: 'Frost Bank Center',
      tvChannel: 'ABC',
      watchSources: ['ABC', 'YouTube TV', 'Hulu + Live TV'],
      homeTeam: {
        id: 'sa',
        name: 'San Antonio Spurs',
        city: 'San Antonio',
        abbreviation: 'SA',
        record: '62-20',
        color: '#BAC3C9',
      },
      awayTeam: {
        id: 'okc',
        name: 'Oklahoma City Thunder',
        city: 'Oklahoma City',
        abbreviation: 'OKC',
        record: '64-18',
        color: '#007AC1',
      },
      homeScore: 114,
      awayScore: 109,
      homeLinescores: [31, 27, 28, 28],
      awayLinescores: [26, 30, 25, 28],
      prediction: screenshotPrediction(nbaId, 'home', 0.622, 0.378, 72, 114.8, 111.2),
    },
    {
      id: iplId,
      sport: Sport.IPL,
      status: GameStatus.SCHEDULED,
      gameTime: isoMinutesFromNow(86),
      venue: 'Dharamsala Stadium',
      tvChannel: 'Willow TV',
      watchSources: ['Willow TV', 'YouTube TV'],
      homeTeam: {
        id: 'pbks',
        name: 'Punjab Kings',
        city: 'Punjab',
        abbreviation: 'PBKS',
        record: '6-6-1',
        color: '#D71920',
      },
      awayTeam: {
        id: 'lsg',
        name: 'Lucknow Super Giants',
        city: 'Lucknow',
        abbreviation: 'LSG',
        record: '4-9',
        color: '#2F80ED',
      },
      prediction: screenshotPrediction(iplId, 'home', 0.641, 0.359, 69, 160.6, 154.3),
    },
    {
      id: nhlId,
      sport: Sport.NHL,
      status: GameStatus.FINAL,
      gameTime: isoMinutesFromNow(-1610),
      venue: 'Ball Arena',
      tvChannel: 'ESPN',
      watchSources: ['ESPN', 'ESPN app', 'YouTube TV'],
      homeTeam: {
        id: 'col',
        name: 'Colorado Avalanche',
        city: 'Colorado',
        abbreviation: 'COL',
        record: '50-25-7',
        color: '#6F263D',
      },
      awayTeam: {
        id: 'dal',
        name: 'Dallas Stars',
        city: 'Dallas',
        abbreviation: 'DAL',
        record: '52-23-7',
        color: '#006847',
      },
      homeScore: 4,
      awayScore: 2,
      homeLinescores: [1, 1, 2],
      awayLinescores: [0, 1, 1],
      prediction: screenshotPrediction(nhlId, 'home', 0.594, 0.406, 64, 3.7, 2.8),
    },
  ];
}

export function getScreenshotGame(gameId: string): GameWithPrediction | undefined {
  return getScreenshotGames().find((game) => game.id === gameId);
}

export function getScreenshotGamesBySport(sport: string): GameWithPrediction[] {
  return getScreenshotGames().filter((game) => game.sport.toLowerCase() === sport.toLowerCase());
}

export function getScreenshotGamesByDate(date: string): GameWithPrediction[] {
  return getScreenshotGames().filter((game) => game.gameTime.slice(0, 10) === date);
}

export function getScreenshotTopPicks(): GameWithPrediction[] {
  return getScreenshotGames().filter((game) => game.prediction);
}

export function getScreenshotPicks() {
  const pick = (
    id: string,
    gameId: string,
    pickedTeam: 'home' | 'away',
    result: 'win' | 'loss' | 'pending',
    homeTeam: string,
    awayTeam: string,
    sport: Sport,
    minutesAgo: number,
    modelConfidence = 68,
    modelHomeWinProb = 58.2,
    finalHomeScore?: number,
    finalAwayScore?: number,
  ) => ({
    id,
    userId: 'screenshot-user',
    gameId,
    pickedTeam,
    result,
    homeTeam,
    awayTeam,
    sport,
    createdAt: isoMinutesFromNow(-minutesAgo),
    modelPredictedWinner: pickedTeam,
    modelConfidence,
    modelHomeWinProb,
    finalHomeScore,
    finalAwayScore,
  });

  return [
    pick('screenshot-history-01', 'history-mlb-yankees-red-sox', 'away', 'win', 'NYY', 'BOS', Sport.MLB, 9720, 71, 44.8, 3, 6),
    pick('screenshot-history-02', 'history-nba-celtics-heat', 'home', 'win', 'BOS', 'MIA', Sport.NBA, 8640, 74, 66.1, 118, 104),
    pick('screenshot-history-03', 'history-nhl-rangers-devils', 'away', 'loss', 'NYR', 'NJD', Sport.NHL, 7560, 62, 41.3, 4, 2),
    pick('screenshot-history-04', 'history-mlb-braves-phillies', 'home', 'win', 'ATL', 'PHI', Sport.MLB, 6480, 70, 61.7, 5, 2),
    pick('screenshot-history-05', 'history-epl-arsenal-city', 'away', 'win', 'ARS', 'MCI', Sport.EPL, 5760, 69, 39.9, 1, 3),
    pick('screenshot-history-06', 'history-mlb-cubs-cardinals', 'home', 'win', 'CHC', 'STL', Sport.MLB, 5040, 73, 63.4, 7, 4),
    pick('screenshot-history-07', 'history-nba-lakers-warriors', 'away', 'loss', 'LAL', 'GSW', Sport.NBA, 4320, 65, 47.8, 109, 101),
    pick('screenshot-history-08', 'history-ipl-kkr-csk', 'home', 'win', 'KKR', 'CSK', Sport.IPL, 3600, 72, 64.6, 184, 172),
    pick('screenshot-history-09', 'history-mlb-mariners-astros', 'away', 'win', 'SEA', 'HOU', Sport.MLB, 2880, 70, 45.5, 2, 4),
    pick('screenshot-history-10', 'history-nhl-panthers-bruins', 'home', 'win', 'FLA', 'BOS', Sport.NHL, 2520, 75, 67.2, 5, 3),
    pick('screenshot-history-11', 'history-mls-miami-atlanta', 'home', 'win', 'MIA', 'ATL', Sport.MLS, 2160, 68, 60.5, 2, 1),
    pick('screenshot-history-12', 'history-mlb-giants-padres', 'away', 'loss', 'SF', 'SD', Sport.MLB, 1800, 61, 48.1, 6, 3),
    pick('screenshot-history-13', 'history-ncaab-duke-unc', 'home', 'win', 'DUKE', 'UNC', Sport.NCAAB, 1500, 76, 69.8, 82, 74),
    pick('screenshot-history-14', 'history-nfl-chiefs-ravens', 'home', 'win', 'KC', 'BAL', Sport.NFL, 1260, 73, 64.2, 27, 20),
    pick('screenshot-history-15', 'history-nhl-stars-oilers', 'away', 'win', 'DAL', 'EDM', Sport.NHL, 1080, 67, 43.9, 2, 4),
    pick('screenshot-history-16', 'history-mlb-blue-jays-rays', 'home', 'loss', 'TOR', 'TB', Sport.MLB, 900, 63, 59.8, 3, 5),
    {
      id: 'screenshot-pick-col',
      userId: 'screenshot-user',
      gameId: 'screenshot-nhl-stars-avalanche',
      pickedTeam: 'home' as const,
      result: 'win' as const,
      homeTeam: 'COL',
      awayTeam: 'DAL',
      sport: Sport.NHL,
      createdAt: isoMinutesFromNow(-720),
      modelPredictedWinner: 'home' as const,
      modelConfidence: 64,
      modelHomeWinProb: 59.4,
      finalHomeScore: 4,
      finalAwayScore: 2,
    },
    {
      id: 'screenshot-pick-pbks',
      userId: 'screenshot-user',
      gameId: 'screenshot-ipl-pbks-lsg',
      pickedTeam: 'home' as const,
      result: 'pending' as const,
      homeTeam: 'PBKS',
      awayTeam: 'LSG',
      sport: Sport.IPL,
      createdAt: isoMinutesFromNow(-240),
      modelPredictedWinner: 'home' as const,
      modelConfidence: 69,
      modelHomeWinProb: 64.1,
    },
    {
      id: 'screenshot-pick-sa',
      userId: 'screenshot-user',
      gameId: 'screenshot-nba-finals-spurs-thunder',
      pickedTeam: 'home' as const,
      result: 'win' as const,
      homeTeam: 'SA',
      awayTeam: 'OKC',
      sport: Sport.NBA,
      createdAt: isoMinutesFromNow(-180),
      modelPredictedWinner: 'home' as const,
      modelConfidence: 72,
      modelHomeWinProb: 62.2,
      finalHomeScore: 114,
      finalAwayScore: 109,
    },
    {
      id: 'screenshot-pick-lad',
      userId: 'screenshot-user',
      gameId: 'screenshot-mlb-live-dodgers-mets',
      pickedTeam: 'home' as const,
      result: 'pending' as const,
      homeTeam: 'LAD',
      awayTeam: 'NYM',
      sport: Sport.MLB,
      createdAt: isoMinutesFromNow(-14),
      modelPredictedWinner: 'home' as const,
      modelConfidence: 76,
      modelHomeWinProb: 68.4,
    },
  ];
}

export function getScreenshotPickForGame(gameId: string) {
  return getScreenshotPicks().find((pick) => pick.gameId === gameId);
}

export function getScreenshotStats() {
  return {
    picksMade: 84,
    wins: 53,
    losses: 21,
    winRate: 72,
    currentStreak: 5,
  };
}

export function getScreenshotAllPickStats() {
  return Object.fromEntries(
    getScreenshotGames().map((game) => [
      game.id,
      {
        gameId: game.id,
        homePicks: game.prediction?.predictedWinner === 'home' ? 842 : 318,
        awayPicks: game.prediction?.predictedWinner === 'away' ? 842 : 318,
        totalPicks: 1160,
        homePercentage: game.prediction?.predictedWinner === 'home' ? 73 : 27,
        awayPercentage: game.prediction?.predictedWinner === 'away' ? 73 : 27,
      },
    ])
  );
}
