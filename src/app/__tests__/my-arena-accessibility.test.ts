import fs from 'fs';
import path from 'path';

const arenaSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/(tabs)/search.tsx'),
  'utf8',
);

describe('my arena accessibility', () => {
  it('exposes the search entry and filter controls as buttons', () => {
    expect(arenaSource).toContain('accessibilityLabel="Open arena search"');
    expect(arenaSource).toContain('accessibilityHint="Opens the full arena search screen"');
    expect(arenaSource).not.toContain('accessibilityRole="tab"');
    expect(arenaSource).toContain('accessibilityState={{ selected: on }}');
    expect(arenaSource).toContain('accessibilityState={{ selected: isActive }}');
    expect(arenaSource).toContain('minHeight: 44');
  });

  it('labels visible arena card actions', () => {
    expect(arenaSource).toContain('accessibilityLabel="Track games"');
    expect(arenaSource).toContain('accessibilityLabel="Browse games"');
    expect(arenaSource).toContain('accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}');
    expect(arenaSource).toContain('accessibilityHint="Opens game details"');
  });

  it('labels locked pro previews as paywall actions', () => {
    expect(arenaSource).toContain('accessibilityLabel="Preview Live Intelligence Pro"');
    expect(arenaSource).toContain('accessibilityLabel={`Preview Pro: ${title}`}');
    expect(arenaSource).toContain('accessibilityHint="Opens Clutch Picks Pro"');
  });
});
