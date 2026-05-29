import { selectPersistableHomeGames } from '../home-games-cache';
import { GameStatus, Sport, type GameWithPrediction } from '@/types/sports';

function makeGame(id: string): GameWithPrediction {
  return {
    id,
    sport: Sport.NBA,
    homeTeam: { id: `h-${id}`, name: 'Home', abbreviation: 'HOM', city: '', record: '', color: '#fff' },
    awayTeam: { id: `a-${id}`, name: 'Away', abbreviation: 'AWY', city: '', record: '', color: '#fff' },
    gameTime: '2026-05-27T12:00:00.000Z',
    status: GameStatus.SCHEDULED,
    venue: 'Arena',
  };
}

describe('home games cache', () => {
  it('keeps the persisted starter slate bounded for quick app launch hydration', () => {
    const games = Array.from({ length: 120 }, (_, index) => makeGame(String(index + 1000)));

    expect(selectPersistableHomeGames(games)).toHaveLength(80);
  });
});
