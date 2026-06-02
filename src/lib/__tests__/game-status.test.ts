import { GameStatus, Sport, type GameWithPrediction } from '@/types/sports';
import { isSuspendedGame, sortSuspendedGamesLast } from '../game-status';

function liveGame(
  id: string,
  gameTime: string,
  extra: Partial<GameWithPrediction> = {},
): GameWithPrediction {
  return {
    id,
    sport: Sport.NBA,
    gameTime,
    status: GameStatus.LIVE,
    venue: 'Arena',
    homeTeam: { id: `${id}-home`, name: 'Home', abbreviation: 'HME', city: 'Home', record: '0-0' },
    awayTeam: { id: `${id}-away`, name: 'Away', abbreviation: 'AWY', city: 'Away', record: '0-0' },
    ...extra,
  } as GameWithPrediction;
}

describe('game status helpers', () => {
  it('detects suspended live games from explicit status metadata', () => {
    expect(isSuspendedGame(liveGame('weather', '2026-06-02T20:00:00.000Z', {
      statusDetail: 'Suspended - weather delay',
    }))).toBe(true);
  });

  it('detects suspended games when backend live status is in_progress', () => {
    expect(isSuspendedGame(liveGame('legacy-status', '2026-06-02T20:00:00.000Z', {
      status: 'in_progress' as GameStatus,
      statusLabel: 'Suspended',
    }))).toBe(true);
  });

  it('keeps active live games ahead of suspended live games while preserving secondary ordering', () => {
    const activeLate = liveGame('active-late', '2026-06-02T22:00:00.000Z');
    const suspendedEarly = liveGame('suspended-early', '2026-06-02T18:00:00.000Z', {
      statusLabel: 'Suspended',
    });
    const activeEarly = liveGame('active-early', '2026-06-02T19:00:00.000Z');

    const sorted = sortSuspendedGamesLast(
      [activeLate, suspendedEarly, activeEarly],
      (a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime(),
    );

    expect(sorted.map((game) => game.id)).toEqual(['active-early', 'active-late', 'suspended-early']);
  });
});
