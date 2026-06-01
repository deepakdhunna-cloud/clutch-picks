import fs from 'fs';
import path from 'path';

const searchExploreSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/search-explore.tsx'),
  'utf8',
);

describe('search explore accessibility', () => {
  it('names the fixed header controls and keeps icon buttons at 44 points', () => {
    expect(searchExploreSource).toContain('accessibilityLabel="Back to My Arena"');
    expect(searchExploreSource).toContain('width: 44, height: 44');
    expect(searchExploreSource).toContain('accessibilityLabel="Search teams, sports, venues"');
    expect(searchExploreSource).toContain('accessibilityLabel="Clear arena search"');
  });

  it('exposes browse and game cards as buttons with action labels', () => {
    expect(searchExploreSource).toContain('accessibilityLabel={`Browse ${displaySport(sport)}, ${count} game${count !== 1 ? \'s\' : \'\'}`}');
    expect(searchExploreSource).toContain('accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}');
    expect(searchExploreSource).toContain('accessibilityHint="Opens game details"');
  });

  it('exposes filters and recent searches as reachable named buttons', () => {
    expect(searchExploreSource).toContain('accessibilityLabel="Clear sport filter"');
    expect(searchExploreSource).toContain('accessibilityLabel={`${label} games filter`}');
    expect(searchExploreSource).toContain('accessibilityState={{ selected: active }}');
    expect(searchExploreSource).toContain('accessibilityLabel="Clear recent searches"');
    expect(searchExploreSource).toContain('accessibilityLabel={`Search recent term ${term}`}');
    expect(searchExploreSource).toContain('accessibilityLabel={`Remove recent search ${term}`}');
  });
});
