import { shouldRefetchGameDetailOnMount } from '../game-detail-load-stability';
import { GameStatus, Sport } from '@/types/sports';

describe('game detail load stability', () => {
  it('does not refetch fresh cached detail data on mount', () => {
    expect(
      shouldRefetchGameDetailOnMount(
        { sport: Sport.TENNIS, status: GameStatus.SCHEDULED },
        1_000,
        5_000,
      ),
    ).toBe(false);
  });

  it('refetches stale cached detail data through the query mount path', () => {
    expect(
      shouldRefetchGameDetailOnMount(
        { sport: Sport.TENNIS, status: GameStatus.SCHEDULED },
        1_000,
        12_000,
      ),
    ).toBe(true);
  });

  it('keeps live cricket detail data fresh because enrichment changes quickly', () => {
    expect(
      shouldRefetchGameDetailOnMount(
        { sport: Sport.IPL, status: GameStatus.LIVE },
        4_900,
        5_000,
      ),
    ).toBe(true);
  });
});
