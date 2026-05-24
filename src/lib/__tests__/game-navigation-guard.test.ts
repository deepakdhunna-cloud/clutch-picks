import {
  claimGameNavigation,
  currentGameNavigationLockForTests,
  releaseGameNavigationForTests,
} from '../game-navigation-guard';

describe('game navigation guard', () => {
  beforeEach(() => {
    releaseGameNavigationForTests();
  });

  it('blocks duplicate game opens during the navigation transition window', () => {
    expect(claimGameNavigation('game-1')).toBe(true);
    expect(currentGameNavigationLockForTests()).toBe('game-1');
    expect(claimGameNavigation('game-1')).toBe(false);
    expect(claimGameNavigation('game-2')).toBe(false);
  });

  it('can be reset for a new navigation cycle', () => {
    expect(claimGameNavigation('game-1')).toBe(true);
    releaseGameNavigationForTests();
    expect(claimGameNavigation('game-2')).toBe(true);
    expect(currentGameNavigationLockForTests()).toBe('game-2');
  });
});
