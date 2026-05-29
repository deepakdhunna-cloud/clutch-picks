import { getConfidenceTier, getConfidenceTierLabel } from '../display-confidence';

describe('confidence tier display', () => {
  it('does not label narrow 55 percent edges as solid picks', () => {
    expect(getConfidenceTier(55).label).toBe('Lean Pick');
    expect(getConfidenceTierLabel(55)).toBe('Considered a Lean Pick');
  });

  it('reserves solid, strong, and lock labels for wider separation', () => {
    expect(getConfidenceTier(60).label).toBe('Solid Pick');
    expect(getConfidenceTier(67).label).toBe('Strong Pick');
    expect(getConfidenceTier(75).label).toBe('Lock');
  });

  it('keeps toss-up flags above numeric confidence tiers', () => {
    expect(getConfidenceTier(70, true).label).toBe('Toss-Up');
  });

  it('uses a three-way ladder for soccer-style result markets', () => {
    expect(getConfidenceTier(41, false, 'three_way_result').label).toBe('Lean Pick');
    expect(getConfidenceTier(48, false, 'three_way_result').label).toBe('Solid Pick');
    expect(getConfidenceTier(53, false, 'three_way_result').label).toBe('Strong Pick');
  });
});
