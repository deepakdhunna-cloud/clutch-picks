import fs from 'fs';
import path from 'path';

const layoutSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/_layout.tsx'),
  'utf8',
);

function stackScreenOptions(routeName: string): string {
  const match = layoutSource.match(
    new RegExp(`<Stack\\.Screen\\s+name="${routeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+options=\\{\\{([^}]*)\\}\\}`),
  );

  if (!match) {
    throw new Error(`Could not find root stack screen options for ${routeName}`);
  }

  return match[1];
}

describe('root stack navigation stability', () => {
  it('does not freeze the animated tab tree when opening stack routes', () => {
    expect(stackScreenOptions('(tabs)')).toContain('freezeOnBlur: false');
  });

  it('does not freeze the game detail route while its reanimated worklets are active', () => {
    expect(stackScreenOptions('game/[id]')).toContain('freezeOnBlur: false');
  });
});
