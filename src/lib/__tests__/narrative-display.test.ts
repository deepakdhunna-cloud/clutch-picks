import { displayPredictionAnalysis } from '../narrative-display';
import { GameStatus, Sport, type GameWithPrediction } from '@/types/sports';

function makeTennisGame(): GameWithPrediction {
  return {
    id: 'tennis-copy-1',
    sport: Sport.TENNIS,
    homeTeam: {
      id: 'home-player',
      name: 'Conor Gannon',
      abbreviation: 'GANN',
      city: '',
      record: 'ATP Rank #1130',
      color: '#7A9DB8',
    },
    awayTeam: {
      id: 'away-player',
      name: 'Sebastiano Cocola',
      abbreviation: 'COCO',
      city: '',
      record: 'ATP Rank #1314',
      color: '#8B0A1F',
    },
    gameTime: '2026-06-01T19:30:00.000Z',
    status: GameStatus.SCHEDULED,
    venue: 'Court 1',
    prediction: {
      id: 'tennis-prediction-1',
      gameId: 'tennis-copy-1',
      predictedWinner: 'home',
      predictedOutcome: 'home',
      confidence: 60,
      homeWinProbability: 60,
      awayWinProbability: 40,
      predictedSpread: 0,
      predictedTotal: 0,
      analysis: 'Conor Gannon have the better case against Sebastiano Cocola. Conor Gannon have been the hotter team at 5-5, while Sebastiano Cocola sit at 4-6.',
      createdAt: '2026-06-01T12:00:00.000Z',
      factors: [],
    },
  };
}

describe('displayPredictionAnalysis', () => {
  it('polishes tennis player narratives so individual competitors are not described like teams', () => {
    const analysis = displayPredictionAnalysis(makeTennisGame());

    expect(analysis).toContain('Conor Gannon has the better case');
    expect(analysis).toContain('Conor Gannon has been in better form');
    expect(analysis).toContain('Sebastiano Cocola sits at 4-6');
    expect(analysis).not.toContain('Conor Gannon have');
    expect(analysis).not.toContain('hotter team');
    expect(analysis).not.toContain('Sebastiano Cocola sit at');
  });
});
