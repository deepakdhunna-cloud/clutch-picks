import {
  claimInteractionLock,
  createScrollPressBlocker,
  releaseAllInteractionLocksForTests,
  releaseInteractionLock,
} from '../interaction-guard';

describe('interaction guard', () => {
  beforeEach(() => {
    releaseAllInteractionLocksForTests();
  });

  it('blocks duplicate actions inside the lock window', () => {
    expect(claimInteractionLock('nav:paywall', 700, 1000)).toBe(true);
    expect(claimInteractionLock('nav:paywall', 700, 1200)).toBe(false);
    expect(claimInteractionLock('nav:paywall', 700, 1701)).toBe(true);
  });

  it('keeps unrelated scopes independent', () => {
    expect(claimInteractionLock('nav:paywall', 700, 1000)).toBe(true);
    expect(claimInteractionLock('profile:save', 700, 1000)).toBe(true);
  });

  it('can release a lock early', () => {
    expect(claimInteractionLock('settings:restore', 700, 1000)).toBe(true);
    releaseInteractionLock('settings:restore');
    expect(claimInteractionLock('settings:restore', 700, 1001)).toBe(true);
  });

  it('blocks card taps while a horizontal rail is settling after drag', () => {
    let now = 1000;
    const blocker = createScrollPressBlocker({
      dragBlockMs: 500,
      settleBlockMs: 220,
      now: () => now,
    });

    expect(blocker.canPress()).toBe(true);
    blocker.blockForDrag();
    now = 1200;
    expect(blocker.canPress()).toBe(false);
    now = 1501;
    expect(blocker.canPress()).toBe(true);

    blocker.blockForSettle();
    now = 1600;
    expect(blocker.canPress()).toBe(false);
    now = 1721;
    expect(blocker.canPress()).toBe(true);
  });
});
