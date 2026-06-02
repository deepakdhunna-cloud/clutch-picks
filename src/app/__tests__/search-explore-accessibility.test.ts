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

  it('keeps existing search results mounted while debounced filtering settles', () => {
    expect(searchExploreSource).toContain("isSearchSettling ? 'UPDATING RESULTS'");
    expect(searchExploreSource).toContain('const displayedFilteredGames = filteredGames;');
    expect(searchExploreSource).toContain('ListHeaderComponent={resultsHeader}');
    expect(searchExploreSource).not.toContain('const displayedFilteredGames = isSearchSettling ? [] : filteredGames;');
    expect(searchExploreSource).not.toContain('ListHeaderComponent={isSearchSettling ? null : resultsHeader}');
  });

  it('keeps browse rails left-aligned under their section headers', () => {
    expect(searchExploreSource).toContain('const EXPLORE_RAIL_SIDE_PADDING = 20;');
    expect(searchExploreSource).toContain('paddingLeft: EXPLORE_RAIL_SIDE_PADDING, paddingRight: EXPLORE_RAIL_SIDE_PADDING');
    expect(searchExploreSource).toContain('contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}');
    expect(searchExploreSource).toContain("style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14, position: 'relative', zIndex: 1 }}");
    expect(searchExploreSource).not.toContain('const STORY_CARD_RAIL_SIDE_PADDING = Math.max(20, (EXPLORE_SCREEN_WIDTH - STORY_CARD_W) / 2);');
    expect(searchExploreSource).not.toContain('const SPORT_CARD_RAIL_SIDE_PADDING = Math.max(20, (EXPLORE_SCREEN_WIDTH - SPORT_CARD_W) / 2);');
  });
});
