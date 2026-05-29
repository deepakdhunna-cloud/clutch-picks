import { firstRouteParam } from '../route-params';

describe('route params', () => {
  it('uses the first value when Expo Router gives an array param', () => {
    expect(firstRouteParam(['game-123', 'duplicate'])).toBe('game-123');
  });

  it('returns an empty string until the route param is available', () => {
    expect(firstRouteParam(undefined)).toBe('');
  });
});
