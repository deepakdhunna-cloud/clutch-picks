import { getHomeGamesRequestPlan } from '../home-games-request-plan';

describe('home games request plan', () => {
  it('uses the backend-warmed home slate for first paint', () => {
    expect(getHomeGamesRequestPlan()).toEqual({
      firstPaintPath: '/api/games',
    });
  });
});
