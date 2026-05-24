import { Sport } from '@/types/sports';
import { filterVerifiedGames, isUnverifiedScoreboardGame, isUnverifiedTennisGame, isVerifiedScoreboardGame } from '../verified-games';

describe('verified game filtering', () => {
  it('removes synthetic rows for every sport while keeping verified ESPN ids', () => {
    const staleTennis = { id: 'tennis-explorer-3212381', sport: Sport.TENNIS };
    const staleNba = { id: 'manual-live-1', sport: Sport.NBA };
    const verifiedSupplementalTennis = {
      id: 'tennis-explorer-3212381',
      sport: Sport.TENNIS,
      source: 'tennis-explorer',
      status: 'LIVE',
      homeScore: 1,
      awayScore: 0,
    };
    const verifiedScheduledSupplementalTennis = {
      id: 'tennis-explorer-3211687',
      sport: Sport.TENNIS,
      source: 'tennis-explorer',
      status: 'SCHEDULED',
    };
    const verifiedTennis = { id: '176172', sport: Sport.TENNIS };
    const verifiedNba = { id: '401705528', sport: Sport.NBA };

    expect(isUnverifiedTennisGame(staleTennis)).toBe(true);
    expect(isUnverifiedScoreboardGame(staleNba)).toBe(true);
    expect(isVerifiedScoreboardGame(verifiedSupplementalTennis)).toBe(true);
    expect(isVerifiedScoreboardGame(verifiedScheduledSupplementalTennis)).toBe(true);
    expect(isVerifiedScoreboardGame(verifiedTennis)).toBe(true);
    expect(isVerifiedScoreboardGame(verifiedNba)).toBe(true);
    expect(filterVerifiedGames([
      staleTennis,
      staleNba,
      verifiedSupplementalTennis,
      verifiedScheduledSupplementalTennis,
      verifiedTennis,
      verifiedNba,
    ])).toEqual([
      verifiedSupplementalTennis,
      verifiedScheduledSupplementalTennis,
      verifiedTennis,
      verifiedNba,
    ]);
  });
});
