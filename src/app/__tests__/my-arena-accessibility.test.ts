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

  it('labels expandable intel, model-grade cards, matchup cards, and prep tabs', () => {
    expect(arenaSource).toContain('accessibilityLabel={isLong ? (expanded ? `Collapse ${title} live intel` : `Read full ${title} live intel`) : undefined}');
    expect(arenaSource).toContain('accessibilityState={isLong ? { expanded } : undefined}');
    expect(arenaSource).toContain('accessibilityLabel={`Open model grade for ${game.awayTeam.name} at ${game.homeTeam.name}`}');
    expect(arenaSource).toContain('accessibilityLabel={expanded ? `Collapse matchup ${rank}: ${matchupTitle(game.awayTeam.name, game.homeTeam.name)}` : `Expand matchup ${rank}: ${matchupTitle(game.awayTeam.name, game.homeTeam.name)}`}');
    expect(arenaSource).toContain('accessibilityLabel={`Open game details for ${game.awayTeam.name} at ${game.homeTeam.name}`}');
    expect(arenaSource).toContain('accessibilityLabel={`${label} prep tab, ${count} matchup${count === 1 ? \'\': \'s\'}`}');
  });

  it('keeps My Arena tennis live cards on the compact player-score layout', () => {
    expect(arenaSource).toContain("import { TennisScoreGrid } from '@/components/sports/TennisScoreGrid';");
    expect(arenaSource).toContain('renderTennisBody');
    expect(arenaSource).toContain('tennisScoreScale = 0.82');
    expect(arenaSource).toContain('compactTennisPlayerName');
    expect(arenaSource).toContain('variant="rail"');
  });

  it('keeps the My Arena live rail on exact centered snap correction', () => {
    expect(arenaSource).toContain('const liveRailRef = useRef<FlatList<GameWithPrediction> | null>(null);');
    expect(arenaSource).toContain('ref={liveRailRef}');
    expect(arenaSource).toContain('onLiveRailLayout');
    expect(arenaSource).toContain('const liveVisibleRailWidth = Math.min(liveRailWidth, SW);');
    expect(arenaSource).toContain('const liveCardWidth = Math.max(LIVE_CARD_MIN_W, liveVisibleRailWidth - LIVE_CARD_SIDE_SPACE * 2);');
    expect(arenaSource).toContain('const LIVE_RAIL_VISUAL_CENTER_CORRECTION = 11;');
    expect(arenaSource).toContain('const liveRailSidePadding = Math.max(0, liveCardSidePadding - LIVE_RAIL_VISUAL_CENTER_CORRECTION);');
    expect(arenaSource).toContain('contentContainerStyle={{ paddingHorizontal: liveRailSidePadding }}');
    expect(arenaSource).toContain('const canOpenLiveCard = useCallback(() => Date.now() > liveRailBlockOpenUntilRef.current, []);');
    expect(arenaSource).toContain('onScrollBeginDrag={markLiveRailScrollStart}');
    expect(arenaSource).toContain('canOpen={canOpenLiveCard}');
    expect(arenaSource).not.toContain('LIVE_RAIL_PAGER_GUTTER_CORRECTION');
    expect(arenaSource).not.toContain('ListHeaderComponent={<View style={{ width: liveRailEdgeSpacer }} />}');
    expect(arenaSource).toContain('snapToOffsets={liveSnapOffsets}');
    expect(arenaSource).toContain('key={`live-rail-${Math.round(liveCardWidth)}-${liveSportFilter}-${liveSearch.trim()}`}');
    expect(arenaSource).toContain('snapLiveRail(event, true)');
  });
});
