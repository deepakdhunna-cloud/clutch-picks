import { GameStatus, Sport, type GameWithPrediction } from '@/types/sports';
import { filterFollowedEntriesForReset, nextLocalTwoAmAfterGameDay } from '../followed-games';

function game(id: string, status: GameStatus, gameTime: Date): GameWithPrediction {
  return {
    id,
    sport: Sport.NBA,
    gameTime: gameTime.toISOString(),
    status,
    venue: 'Arena',
    homeTeam: { id: 'home', name: 'Home', abbreviation: 'HME', city: 'Home', record: '0-0', color: '#111111' },
    awayTeam: { id: 'away', name: 'Away', abbreviation: 'AWY', city: 'Away', record: '0-0', color: '#222222' },
  } as GameWithPrediction;
}

describe('followed game cleanup', () => {
  it('keeps final tracked games until the next local 2 AM reset', () => {
    const finalGame = game('g1', GameStatus.FINAL, new Date(2026, 4, 23, 19, 30));

    expect(filterFollowedEntriesForReset(
      [{ id: 'g1', followedAt: '2026-05-23T20:00:00.000Z' }],
      [finalGame],
      new Date(2026, 4, 24, 1, 59),
    )).toEqual([{ id: 'g1', followedAt: '2026-05-23T20:00:00.000Z' }]);

    expect(filterFollowedEntriesForReset(
      [{ id: 'g1', followedAt: '2026-05-23T20:00:00.000Z' }],
      [finalGame],
      new Date(2026, 4, 24, 2, 0),
    )).toEqual([]);
  });

  it('never clears live or scheduled tracked games during the reset window', () => {
    const liveGame = game('live', GameStatus.LIVE, new Date(2026, 4, 23, 22, 0));
    const scheduledGame = game('scheduled', GameStatus.SCHEDULED, new Date(2026, 4, 24, 19, 0));

    expect(filterFollowedEntriesForReset(
      [{ id: 'live' }, { id: 'scheduled' }],
      [liveGame, scheduledGame],
      new Date(2026, 4, 24, 2, 30),
    )).toEqual([{ id: 'live' }, { id: 'scheduled' }]);
  });

  it('uses 2 AM on the day after the game date as the reset point', () => {
    const reset = nextLocalTwoAmAfterGameDay(new Date(2026, 4, 23, 19, 30).toISOString());

    expect(reset?.getFullYear()).toBe(2026);
    expect(reset?.getMonth()).toBe(4);
    expect(reset?.getDate()).toBe(24);
    expect(reset?.getHours()).toBe(2);
    expect(reset?.getMinutes()).toBe(0);
  });
});
