import { prepareHomeGamesFirstPaint } from '../home-games-first-paint';
import { GameStatus, Sport, type GameWithPrediction } from '@/types/sports';

function makeGame(id: string, sport: Sport, status: GameStatus, gameTime = '2026-05-27T12:00:00.000Z'): GameWithPrediction {
  return {
    id,
    sport,
    homeTeam: { id: `home-${id}`, name: 'Home', abbreviation: 'HOM', city: '', record: '', color: '#fff' },
    awayTeam: { id: `away-${id}`, name: 'Away', abbreviation: 'AWY', city: '', record: '', color: '#fff' },
    gameTime,
    status,
    venue: 'Stadium',
  };
}

const liveIplGame = makeGame('123456', Sport.IPL, GameStatus.LIVE);

describe('home games first paint', () => {
  it('returns verified games immediately without waiting for live cricket enrichment', () => {
    expect(prepareHomeGamesFirstPaint([liveIplGame])).toEqual([liveIplGame]);
  });
});
