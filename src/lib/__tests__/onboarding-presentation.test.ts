import { arenaStepButtonLabel } from '../onboarding-presentation';

describe('onboarding presentation', () => {
  it('uses tappable button copy for arena sub-pages', () => {
    expect(arenaStepButtonLabel(0)).toBe('Next');
    expect(arenaStepButtonLabel(1)).toBe('Next');
    expect(arenaStepButtonLabel(2)).toBe('Continue');
  });
});
