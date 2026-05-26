import { getCanonicalConfidence, getCanonicalTeam, getCanonicalWinProbabilities } from '../canonical-result';
import { cleanProjectionCopy, getProjectionDisplay } from '../projection-display';
import { getGamePredictionDisplay } from '../prediction-display';
import { displayPredictionAnalysis } from '../narrative-display';
import { displayWinProbability } from '../display-confidence';
import { resolvePickResultForDisplay } from '../pick-resolution-display';
import { GameStatus, Sport, type GameWithPrediction } from '@/types/sports';

function makeGame(): GameWithPrediction {
  return {
    id: 'ui-canonical-1',
    sport: Sport.NBA,
    homeTeam: {
      id: 'home',
      name: 'Home Team',
      abbreviation: 'HOM',
      city: 'Home',
      record: '40-30',
      color: '#7A9DB8',
    },
    awayTeam: {
      id: 'away',
      name: 'Away Team',
      abbreviation: 'AWY',
      city: 'Away',
      record: '42-28',
      color: '#8B0A1F',
    },
    gameTime: '2026-05-21T19:00:00.000Z',
    status: GameStatus.SCHEDULED,
    venue: 'Arena',
    prediction: {
      id: 'pred-ui-canonical-1',
      gameId: 'ui-canonical-1',
      predictedWinner: 'home',
      predictedOutcome: 'home',
      confidence: 57,
      predictedSpread: 2,
      predictedTotal: 214,
      analysis: 'Legacy fields intentionally disagree for this test.',
      createdAt: '2026-05-21T12:00:00.000Z',
      homeWinProbability: 57,
      awayWinProbability: 43,
      factors: [],
      projection: {
        engine: 'game-script-v1',
        iterations: 8000,
        homeWinProbability: 57,
        awayWinProbability: 43,
        projectedHomeScore: 108,
        projectedAwayScore: 105,
        projectedSpread: 3,
        projectedTotal: 213,
        volatility: 0.18,
        upsetRisk: 0.43,
        signals: [],
      },
      canonicalResult: {
        eventId: 'ui-canonical-1',
        marketType: 'moneyline',
        finalPick: 'away',
        finalProbability: 0.62,
        confidence: 62,
        probabilities: { home: 0.38, away: 0.62 },
        projectedScore: { home: 108, away: 105, spread: 3, total: 213 },
        timestamp: '2026-05-21T12:00:00.000Z',
        dataVersion: 'test',
        warnings: [],
      },
    },
  };
}

describe('canonical UI result helpers', () => {
  it('make cards prefer the canonical final answer over conflicting legacy fields', () => {
    const game = makeGame();
    const prediction = game.prediction!;

    expect(getCanonicalTeam(game)?.abbreviation).toBe('AWY');
    expect(getCanonicalConfidence(prediction)).toBe(62);
    expect(getCanonicalWinProbabilities(prediction)).toEqual({ home: 38, away: 62 });

    const projectionDisplay = getProjectionDisplay({
      sport: game.sport,
      homeAbbr: game.homeTeam.abbreviation,
      awayAbbr: game.awayTeam.abbreviation,
      canonicalResult: prediction.canonicalResult,
      predictedWinner: prediction.predictedWinner,
      predictedOutcome: prediction.predictedOutcome,
      confidence: prediction.confidence,
      projection: prediction.projection!,
    });

    expect(projectionDisplay.leanText).toBe('Lean AWY 62%');
    expect(projectionDisplay.contextText).not.toContain('simulated');
  });

  it('does not let a stale legacy winner override a canonical home pick', () => {
    const game = makeGame();
    game.prediction!.predictedWinner = 'away';
    game.prediction!.predictedOutcome = 'away';
    game.prediction!.canonicalResult = {
      ...game.prediction!.canonicalResult!,
      finalPick: 'home',
      finalProbability: 0.61,
      confidence: 61,
      probabilities: { home: 0.61, away: 0.39 },
    };

    const display = getGamePredictionDisplay(game);

    expect(display.outcome).toBe('home');
    expect(display.badgeLabel).toBe('HOM');
    expect(display.team?.abbreviation).toBe('HOM');
  });

  it('hides raw simulation counts from projection copy', () => {
    expect(cleanProjectionCopy('8,000 simulated scripts aligned to the final pick')).toBe(
      'Projected score and margin for the final pick',
    );
    expect(cleanProjectionCopy('Expected scoring average is 108.0-105.0, while the simulation lean is HOM 57% after 8,000 game scripts; upset/draw risk 43%')).toBe(
      'Expected scoring average is 108.0-105.0, while the projection lean is HOM 57% with upset/draw risk 43%',
    );
  });

  it('hides raw simulation counts from prediction analysis text', () => {
    const game = makeGame();
    game.prediction!.analysis =
      'Expected scoring average is 108.0-105.0, while the simulation lean is HOM 57% after 8,000 game scripts; upset/draw risk 43%.';

    const analysis = displayPredictionAnalysis(game);

    expect(analysis).not.toContain('8,000');
    expect(analysis).not.toContain('game scripts');
    expect(analysis).toContain('projection lean');
  });

  it('uses one shared display outcome for draw reads', () => {
    const game = makeGame();
    game.sport = Sport.EPL;
    game.prediction!.predictedWinner = 'home';
    game.prediction!.predictedOutcome = 'draw';
    game.prediction!.confidence = 40;
    game.prediction!.drawProbability = 40;
    game.prediction!.projection!.drawProbability = 40;
    game.prediction!.canonicalResult = {
      ...game.prediction!.canonicalResult!,
      marketType: 'three_way_result',
      finalPick: 'draw',
      finalProbability: 0.4,
      confidence: 40,
      probabilities: { home: 0.3, away: 0.3, draw: 0.4 },
    };

    const display = getGamePredictionDisplay(game);
    expect(display.outcome).toBe('draw');
    expect(display.badgeLabel).toBe('DRAW');
    expect(display.team).toBeNull();
    expect(getCanonicalWinProbabilities(game.prediction)).toEqual({ home: 30, away: 30, draw: 40 });
    expect(displayWinProbability(30, 30, 40)).toEqual({ home: 30, away: 30, draw: 40 });

    const projectionDisplay = getProjectionDisplay({
      sport: game.sport,
      homeAbbr: game.homeTeam.abbreviation,
      awayAbbr: game.awayTeam.abbreviation,
      canonicalResult: game.prediction!.canonicalResult,
      predictedWinner: game.prediction!.predictedWinner,
      predictedOutcome: game.prediction!.predictedOutcome,
      confidence: getCanonicalConfidence(game.prediction),
      isTossUp: display.isTossUp,
      projection: game.prediction!.projection!,
    });
    expect(projectionDisplay.leanText).toBe('Draw 40%');
  });

  it('uses one shared display outcome for toss-up reads', () => {
    const game = makeGame();
    game.prediction!.isTossUp = true;
    game.prediction!.canonicalResult = {
      ...game.prediction!.canonicalResult!,
      finalPick: 'home',
      finalProbability: 0.52,
      confidence: 52,
      probabilities: { home: 0.52, away: 0.48 },
    };

    const display = getGamePredictionDisplay(game);
    expect(display.outcome).toBe('toss_up');
    expect(display.badgeLabel).toBe('TOSS-UP');
    expect(display.team).toBeNull();

    const projectionDisplay = getProjectionDisplay({
      sport: game.sport,
      homeAbbr: game.homeTeam.abbreviation,
      awayAbbr: game.awayTeam.abbreviation,
      canonicalResult: game.prediction!.canonicalResult,
      predictedWinner: game.prediction!.predictedWinner,
      predictedOutcome: game.prediction!.predictedOutcome,
      confidence: getCanonicalConfidence(game.prediction),
      isTossUp: display.isTossUp,
      projection: game.prediction!.projection!,
    });
    expect(projectionDisplay.leanText).toBe('Toss-Up 52%');
  });
});

describe('pick result display fallback', () => {
  it('resolves a pending pick from a final game already loaded in the app', () => {
    expect(resolvePickResultForDisplay(
      { pickedTeam: 'away', result: 'pending' },
      { status: 'FINAL', homeScore: 196, awayScore: 200 },
    )).toBe('win');

    expect(resolvePickResultForDisplay(
      { pickedTeam: 'home', result: null },
      { status: 'FINAL', homeScore: 196, awayScore: 200 },
    )).toBe('loss');
  });
});
