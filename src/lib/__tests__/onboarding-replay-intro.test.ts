import {
  REPLAY_BLACK_SCREEN_MS,
  REPLAY_INTRO_MOTION_SCALE,
  shouldUseReplayIntroGate,
} from '../onboarding-replay-intro';

describe('onboarding replay intro', () => {
  it('uses the deliberate intro gate only for settings replay routes', () => {
    expect(shouldUseReplayIntroGate('settings')).toBe(true);
    expect(shouldUseReplayIntroGate('true')).toBe(true);
    expect(shouldUseReplayIntroGate(['profile', 'settings'])).toBe(true);
    expect(shouldUseReplayIntroGate(undefined)).toBe(false);
    expect(shouldUseReplayIntroGate('false')).toBe(false);
  });

  it('keeps the replay intro calm enough to read as intentional', () => {
    expect(REPLAY_BLACK_SCREEN_MS).toBeGreaterThanOrEqual(500);
    expect(REPLAY_BLACK_SCREEN_MS).toBeLessThanOrEqual(900);
    expect(REPLAY_INTRO_MOTION_SCALE).toBeGreaterThanOrEqual(1.25);
    expect(REPLAY_INTRO_MOTION_SCALE).toBeLessThanOrEqual(1.75);
  });
});
