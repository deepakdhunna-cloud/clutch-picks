import fs from 'fs';
import path from 'path';

const routeFiles = [
  'src/app/model-accuracy.tsx',
  'src/app/confidence-tiers.tsx',
  'src/app/confidence-explained.tsx',
  'src/app/privacy-policy.tsx',
  'src/app/terms.tsx',
  'src/app/live-games.tsx',
  'src/app/sport/[sport].tsx',
  'src/app/user/[id].tsx',
  'src/app/followers/[userId].tsx',
  'src/app/game-analysis.tsx',
];

describe('secondary route back buttons', () => {
  it.each(routeFiles)('%s labels Back and keeps the touch target at least 44 points', (file) => {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');

    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('accessibilityLabel="Back"');
    expect(source).toContain('width: 44');
    expect(source).toContain('height: 44');
  });

  it('keeps the live games broadcast header clear of the Dynamic Island', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/live-games.tsx'), 'utf8');

    expect(source).toContain('paddingTop: 28');
  });
});
