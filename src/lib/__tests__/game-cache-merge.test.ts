import { mergeGameData, mergeGameLists } from '../game-cache-merge';
import { GameStatus, Sport, type GameWithPrediction } from '@/types/sports';

function makeGame(id: string, overrides: Partial<GameWithPrediction> = {}): GameWithPrediction {
  return {
    id,
    sport: Sport.NBA,
    homeTeam: { id: `home-${id}`, name: 'Home', abbreviation: 'HOM', city: '', record: '', color: '#fff' },
    awayTeam: { id: `away-${id}`, name: 'Away', abbreviation: 'AWY', city: '', record: '', color: '#fff' },
    gameTime: '2026-05-28T20:00:00.000Z',
    status: GameStatus.SCHEDULED,
    venue: 'Arena',
    ...overrides,
  };
}

describe('game cache merge', () => {
  it('does not erase an existing prediction when a refresh omits it', () => {
    const previous = makeGame('game-1', {
      prediction: {
        id: 'prediction-1',
        gameId: 'game-1',
        predictedWinner: 'home',
        confidence: 61,
        createdAt: '2026-05-28T12:00:00.000Z',
        projection: {
          engine: 'simulation',
          iterations: 1000,
          homeWinProbability: 61,
          awayWinProbability: 39,
          projectedHomeScore: 112,
          projectedAwayScore: 106,
          projectedSpread: 6,
          projectedTotal: 218,
          volatility: 0.22,
          upsetRisk: 0.31,
          signals: [],
        },
      },
    });
    const incoming = makeGame('game-1', { status: GameStatus.LIVE, homeScore: 14 });

    expect(mergeGameData(previous, incoming).prediction).toBe(previous.prediction);
  });

  it('keeps existing game order stable while merging refreshed rows', () => {
    const first = makeGame('1001', { prediction: { id: 'p-a', gameId: '1001', predictedWinner: 'home', confidence: 58, createdAt: '2026-05-28T12:00:00.000Z' } });
    const second = makeGame('1002', { prediction: { id: 'p-b', gameId: '1002', predictedWinner: 'away', confidence: 57, createdAt: '2026-05-28T12:00:00.000Z' } });
    const incoming = [makeGame('1002', { homeScore: 3 }), makeGame('1001', { homeScore: 7 }), makeGame('1003')];

    const merged = mergeGameLists(incoming, [first, second]);

    expect(merged.map((game) => game.id)).toEqual(['1001', '1002', '1003']);
    expect(merged[0]?.prediction).toBe(first.prediction);
    expect(merged[1]?.prediction).toBe(second.prediction);
    expect(merged[0]?.homeScore).toBe(7);
    expect(merged[1]?.homeScore).toBe(3);
  });
});
