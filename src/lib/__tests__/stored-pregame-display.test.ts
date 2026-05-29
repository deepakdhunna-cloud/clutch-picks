import { displayPredictionAnalysis } from '../narrative-display';
import {
  formatAnalysisLinkSubtitle,
  getDisplayProjection,
  getValueSignalDisplay,
} from '../stored-pregame-display';
import { GameStatus, Sport, type GameWithPrediction } from '@/types/sports';

jest.mock('expo/virtual/env', () => ({ env: process.env }), { virtual: true });

const storedTennisGame: GameWithPrediction = {
  id: '175765',
  sport: Sport.TENNIS,
  source: 'tennis-explorer',
  homeTeam: {
    id: 'khachanov',
    name: 'Karen Khachanov',
    abbreviation: 'KHAC',
    city: '',
    record: 'ATP Rank #15',
    color: '#0057D8',
    rank: 15,
  },
  awayTeam: {
    id: 'trungelliti',
    name: 'Marco Trungelliti',
    abbreviation: 'TRUN',
    city: '',
    record: 'ATP Rank #81',
    color: '#75BDF2',
    rank: 81,
  },
  gameTime: '2026-05-27T12:00:00.000Z',
  status: GameStatus.LIVE,
  venue: 'Court Philippe-Chatrier',
  homeScore: 2,
  awayScore: 1,
  prediction: {
    id: 'stored-1',
    gameId: '175765',
    predictedWinner: 'home',
    predictedOutcome: 'home',
    confidence: 53,
    homeWinProbability: 53.5,
    awayWinProbability: 46.5,
    predictedSpread: 0,
    predictedTotal: 0,
    analysis: 'The pregame read favored Karen Khachanov at 53% before first serve. This pick is locked now that the event has started, so the live score is shown separately and does not rewrite the recommendation.',
    createdAt: '2026-05-27T11:30:00.000Z',
    factors: [],
    edgeRating: 6,
    valueRating: 8,
    recentFormHome: '',
    recentFormAway: '',
    homeStreak: 0,
    awayStreak: 0,
    snapshotType: 'stored-pregame',
    canonicalResult: {
      eventId: '175765',
      marketType: 'moneyline',
      finalPick: 'home',
      finalProbability: 0.535,
      confidence: 53,
      probabilities: { home: 0.535, away: 0.465 },
      timestamp: '2026-05-27T11:30:00.000Z',
      dataVersion: '2.10.0-source-aware-availability',
      warnings: ['Stored pregame prediction snapshot; not recomputed after final.'],
    },
  },
};

const storedIplGame: GameWithPrediction = {
  id: 'rcb-kkr',
  sport: Sport.IPL,
  homeTeam: {
    id: 'rcb',
    name: 'Royal Challengers Bengaluru',
    abbreviation: 'RCB',
    city: 'Bengaluru',
    record: '8-4',
    color: '#D11D2A',
    standingsRank: 1,
    standingsPoints: 18,
    netRunRate: 1.065,
    runRateFor: 9.7,
    runRateAgainst: 8.1,
    matchesPlayed: 13,
  },
  awayTeam: {
    id: 'kkr',
    name: 'Kolkata Knight Riders',
    abbreviation: 'KKR',
    city: 'Kolkata',
    record: '6-6',
    color: '#3A225D',
    standingsRank: 7,
    standingsPoints: 12,
    netRunRate: -0.32,
    runRateFor: 8,
    runRateAgainst: 9.5,
    matchesPlayed: 13,
  },
  gameTime: '2026-05-27T14:00:00.000Z',
  status: GameStatus.LIVE,
  venue: 'M. Chinnaswamy Stadium',
  prediction: {
    id: 'stored-ipl-1',
    gameId: 'rcb-kkr',
    predictedWinner: 'home',
    predictedOutcome: 'home',
    confidence: 61,
    homeWinProbability: 61,
    awayWinProbability: 39,
    predictedSpread: 0,
    predictedTotal: 0,
    analysis: 'The pregame read favored Royal Challengers Bengaluru before the toss and opening ball.',
    createdAt: '2026-05-27T12:30:00.000Z',
    factors: [],
    snapshotType: 'stored-pregame',
    canonicalResult: {
      eventId: 'rcb-kkr',
      marketType: 'moneyline',
      finalPick: 'home',
      finalProbability: 0.61,
      confidence: 61,
      probabilities: { home: 0.61, away: 0.39 },
      timestamp: '2026-05-27T12:30:00.000Z',
      dataVersion: 'test',
      warnings: ['Stored pregame prediction snapshot; not recomputed after final.'],
    },
  },
};

describe('stored pregame display fallbacks', () => {
  it('rebuilds a projection from a locked probability snapshot when the API omitted projection details', () => {
    const projection = getDisplayProjection(storedTennisGame);

    expect(projection).toMatchObject({
      engine: 'stored-pregame-projection-v1',
      homeWinProbability: 53.5,
      awayWinProbability: 46.5,
    });
    expect(projection!.projectedHomeScore).toBeGreaterThan(12);
    expect(projection!.projectedAwayScore).toBeGreaterThan(8);
    expect(projection!.projectedTotal).toBeGreaterThan(20);
  });

  it('rebuilds cricket stored projections from team run rates instead of the generic T20 baseline', () => {
    const projection = getDisplayProjection(storedIplGame);

    expect(projection).toMatchObject({
      engine: 'stored-pregame-projection-v1',
      homeWinProbability: 61,
      awayWinProbability: 39,
    });
    expect(projection!.projectedHomeScore).toBeGreaterThan(185);
    expect(projection!.projectedAwayScore).toBeLessThan(170);
    expect(projection!.projectedTotal).toBeGreaterThan(345);
  });

  it('replaces stale generic cricket projection payloads when run-rate context is available', () => {
    const game: GameWithPrediction = {
      ...storedIplGame,
      prediction: {
        ...storedIplGame.prediction!,
        projection: {
          engine: 'game-script-v1',
          iterations: 50000,
          homeWinProbability: 61,
          awayWinProbability: 39,
          projectedHomeScore: 160,
          projectedAwayScore: 160,
          projectedSpread: 0,
          projectedTotal: 320,
          volatility: 0.11,
          upsetRisk: 0.39,
          signals: [],
        },
      },
    };

    const projection = getDisplayProjection(game);

    expect(projection!.projectedHomeScore).toBeGreaterThan(185);
    expect(projection!.projectedAwayScore).toBeLessThan(170);
    expect(projection!.projectedTotal).toBeGreaterThan(345);
  });

  it('does not overstate value or factor coverage for a thin stored snapshot', () => {
    expect(getValueSignalDisplay(storedTennisGame.prediction).label).toBe('Lean Edge');
    expect(formatAnalysisLinkSubtitle(storedTennisGame.prediction)).toBe('Pregame snapshot - 53% lean');
  });

  it('replaces the raw locked-pregame fallback narration with useful matchup copy', () => {
    const copy = displayPredictionAnalysis(storedTennisGame);

    expect(copy).toContain('Karen Khachanov is the original pregame lean at 53.5%');
    expect(copy).toContain('ATP Rank #15 against Marco Trungelliti at #81');
    expect(copy).not.toContain('locked pregame lean');
    expect(copy).not.toContain('does not rewrite the recommendation');
  });
});
