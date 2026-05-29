import { readFileSync } from 'fs';
import path from 'path';

describe('jersey visual refinement', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/components/sports/jerseyVisuals.tsx'), 'utf8');

  it('uses the app display font and leaner applique strokes for jersey wordmarks', () => {
    expect(source).toContain("const WORDMARK_FONT_FAMILY = 'BebasNeue_400Regular'");
    expect(source).toContain('fontFamily={WORDMARK_FONT_FAMILY}');
    expect(source).toContain('Math.min(2.35, layout.fontSize * 0.18)');
    expect(source).toContain('strokeOpacity={0.16}');
  });

  it('gives baseball wordmarks more room and fits condensed jersey lettering', () => {
    expect(source).toContain('return sum + 0.56');
    expect(source).toContain('maxWidth={68}');
    expect(source).toContain('minFontSize={8.8}');
  });

  it('keeps integrated jersey wordmarks larger and readable across sports', () => {
    expect(source).toContain('return { maxWidth: 52, minFontSize: 8.2 };');
    expect(source).toContain('return { maxWidth: 54, minFontSize: 7.8 };');
    expect(source).toContain('return { maxWidth: 48, minFontSize: 7.4 };');
    expect(source).toContain('return length >= 11 ? 9.8 : length >= 9 ? 10.7 : length >= 7 ? 11.4 : 12.6;');
  });

  it('locks jersey lettering into the cloth surface instead of floating above it', () => {
    expect(source).toContain('surface?: string;');
    expect(source).toContain('const integratedFill = mixColor(fill, jerseySurface');
    expect(source).toContain('key={`applique_surface_shadow_${line}_${index}`}');
    expect(source).toContain('key={`applique_cloth_grain_${line}_${index}`}');
    expect(source).toContain('surface={surface}');
  });
});
