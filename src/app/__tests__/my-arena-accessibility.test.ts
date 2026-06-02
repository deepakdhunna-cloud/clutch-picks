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

  it('keeps arena mode controls directly under search with compact sport filters below', () => {
    const arenaChromeStart = arenaSource.indexOf('const ArenaChrome = memo');
    const searchIndex = arenaSource.indexOf('<SearchBar />', arenaChromeStart);
    const modeIndex = arenaSource.indexOf('{showModes ? <SegPill', arenaChromeStart);
    const sportIndex = arenaSource.indexOf('<SportPills', arenaChromeStart);

    expect(searchIndex).toBeGreaterThan(arenaChromeStart);
    expect(modeIndex).toBeGreaterThan(searchIndex);
    expect(sportIndex).toBeGreaterThan(modeIndex);
    expect(arenaSource).toContain('const SEG_PILL_INNER_MIN_HEIGHT = 44;');
    expect(arenaSource).toContain('const SEG_PILL_BOTTOM_MARGIN = 8;');
    expect(arenaSource).toContain('compact={showModes}');
  });

  it('keeps My Arena chrome compact after the search bar', () => {
    expect(arenaSource).not.toContain('Games, teams, sports, and live matchups');
    expect(arenaSource).toContain('const SPORT_PILL_COMPACT_HEIGHT = 25;');
    expect(arenaSource).toContain('const SPORT_PILL_COMPACT_MARGIN = 8;');
    expect(arenaSource).toContain("height: compact ? SPORT_PILL_COMPACT_HEIGHT : SPORT_PILL_DEFAULT_HEIGHT");
    expect(arenaSource).toContain("fontSize: compact ? 10.2 : 11");
  });

  it('keeps My Arena top chrome small and uses one consecutive accent system', () => {
    const chromeStart = arenaSource.indexOf('// ─── SEARCH BAR ───');
    const chromeEnd = arenaSource.indexOf('const ArenaLoadingWarmup', chromeStart);
    const chromeSource = arenaSource.slice(chromeStart, chromeEnd);
    const searchBarStart = arenaSource.indexOf('const SearchBar = memo', chromeStart);
    const searchBarEnd = arenaSource.indexOf('// ─── SPORT PILLS ───', searchBarStart);
    const searchBarSource = arenaSource.slice(searchBarStart, searchBarEnd);

    expect(searchBarSource).not.toContain('Clutch Picks');
    expect(chromeSource).toContain('const ARENA_TITLE_FONT_SIZE = 24;');
    expect(chromeSource).toContain('const ARENA_TITLE_LINE_HEIGHT = 28;');
    expect(chromeSource).toContain('const SEARCH_BAR_ICON_SIZE = 26;');
    expect(chromeSource).toContain('const SEARCH_BAR_TEXT_SIZE = 12.8;');
    expect(chromeSource).toContain('fontSize: ARENA_TITLE_FONT_SIZE, lineHeight: ARENA_TITLE_LINE_HEIGHT');
    expect(chromeSource).toContain('paddingVertical: 7');
    expect(chromeSource).toContain('width: SEARCH_BAR_ICON_SIZE');
    expect(chromeSource).toContain('height: SEARCH_BAR_ICON_SIZE');
    expect(chromeSource).toContain('Search size={14}');
    expect(chromeSource).toContain('const ARENA_CHROME_ACCENT = TEAL;');
    expect(chromeSource).toContain('hexWithAlpha(ARENA_CHROME_ACCENT');
    expect(chromeSource).not.toContain('fontSize: 30, lineHeight: 34');
    expect(chromeSource).not.toContain('hexWithAlpha(MAROON, 0.72)');
    expect(chromeSource).not.toContain('hexWithAlpha(MAROON, 0.52)');
    expect(chromeSource).not.toContain('rgba(139,10,31,0.16)');
  });

  it('uses a centered broadcast-style Game Day title banner', () => {
    expect(arenaSource).toContain('const ArenaModeTitleBanner = memo');
    expect(arenaSource).toContain('const ARENA_MODE_BANNER_TOP_LINE_ALPHA = 0.58;');
    expect(arenaSource).toContain('const ARENA_MODE_BANNER_BOTTOM_LINE_ALPHA = 0.36;');
    expect(arenaSource).toContain('height: ARENA_MODE_BANNER_TOP_LINE_HEIGHT');
    expect(arenaSource).toContain('height: ARENA_MODE_BANNER_BOTTOM_LINE_HEIGHT');
    expect(arenaSource).toContain('const GameDayTitleBanner = memo');
    expect(arenaSource).toContain("fontFamily: 'BebasNeue_400Regular'");
    expect(arenaSource).toContain('<GameDayTitleBanner liveCount={live.length}');
    expect(arenaSource).toContain("const subtitle = 'TODAY\\'S SLATE COMMAND CENTER';");
    expect(arenaSource).not.toContain('LIVE GAMES ON THE BOARD');
    expect(arenaSource).not.toContain('<ArenaHeader title="Game Day"');
  });

  it('keeps Live intelligence as the only live label in the Game Day section header', () => {
    const liveHeaderStart = arenaSource.indexOf('{/* 3. Live intelligence search */}');
    const liveHeaderEnd = arenaSource.indexOf('{live.length > 0 ? (', liveHeaderStart);
    const liveHeaderSource = arenaSource.slice(liveHeaderStart, liveHeaderEnd);

    expect(liveHeaderSource).toContain('>Live intelligence</Text>');
    expect(liveHeaderSource).not.toContain('>LIVE</Text>');
    expect(liveHeaderSource).not.toContain('${live.length} LIVE');
    expect(liveHeaderSource).not.toContain('${filteredLive.length} MATCH');
    expect(arenaSource).not.toContain('>LIVE</Text>');
    expect(arenaSource).toContain('>IN PLAY</Text>');
    expect(arenaSource).not.toContain('Find a live game or team');
    expect(arenaSource).not.toContain('Search live teams or matchups');
    expect(arenaSource).toContain('placeholder="Find a game or team"');
    expect(arenaSource).toContain('accessibilityLabel="Search teams or matchups"');
    expect(arenaSource).not.toContain('keep live scores');
    expect(arenaSource).not.toContain('No live games on the board');
    expect(arenaSource).not.toContain('Read the live game like a pro');
  });

  it('uses centered non-live banners for Prep Mode and Review', () => {
    expect(arenaSource).toContain('<ArenaModeTitleBanner');
    expect(arenaSource).toContain('title="Prep Mode"');
    expect(arenaSource).toContain('title="Review"');
    expect(arenaSource).toContain("subtitle=\"MODEL BOARD\"");
    expect(arenaSource).toContain("subtitle=\"POSTGAME AUDIT\"");
    expect(arenaSource).not.toContain('<ArenaHeader title="Prep Mode"');
    expect(arenaSource).not.toContain('<ArenaHeader title="Review"');
  });

  it('lets the watchlist label sit on the card instead of a separate Tracked Games heading', () => {
    expect(arenaSource).not.toContain('>Tracked Games<');
    expect(arenaSource).toContain('WATCHLIST</Text>');
    expect(arenaSource).toContain('WATCHLIST {orderedGames.length}');
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

  it('labels expandable intel, matchup cards, and prep tabs', () => {
    expect(arenaSource).toContain('accessibilityLabel={isLong ? (expanded ? `Collapse ${title} live intel` : `Read full ${title} live intel`) : undefined}');
    expect(arenaSource).toContain('accessibilityState={isLong ? { expanded } : undefined}');
    expect(arenaSource).toContain('accessibilityLabel={expanded ? `Collapse matchup ${rank}: ${matchupTitle(game.awayTeam.name, game.homeTeam.name)}` : `Expand matchup ${rank}: ${matchupTitle(game.awayTeam.name, game.homeTeam.name)}`}');
    expect(arenaSource).toContain('accessibilityLabel={`Open game details for ${game.awayTeam.name} at ${game.homeTeam.name}`}');
    expect(arenaSource).toContain('accessibilityLabel={`${label} prep tab, ${count} matchup${count === 1 ? \'\': \'s\'}`}');
  });

  it('keeps live intel cards compact and avoids hiding normal-length reads behind tap-to-read-more', () => {
    expect(arenaSource).toContain('const INTEL_BODY_COLLAPSE_THRESHOLD = 220;');
    expect(arenaSource).toContain('const LIVE_INTEL_CARD_GAP = 16;');
    expect(arenaSource).toContain('body.length > INTEL_BODY_COLLAPSE_THRESHOLD');
    expect(arenaSource).toContain('body.substring(0, INTEL_BODY_COLLAPSE_THRESHOLD)');
    expect(arenaSource).toContain('marginBottom: LIVE_INTEL_CARD_GAP');
    expect(arenaSource).not.toContain('body.length > 140');
    expect(arenaSource).not.toContain('body.substring(0, 140)');
    expect(arenaSource).not.toContain('whether they control the next pressure moment too');
    expect(arenaSource).toContain('next service game keeps that edge intact');
    expect(arenaSource).not.toContain('>LIVE INTEL</Text>');
  });

  it('removes duplicate Prep Mode top model tiles and keeps sub-tabs stretched cleanly across the page', () => {
    expect(arenaSource).toContain('const PREP_SUBTAB_MIN_HEIGHT = 34;');
    expect(arenaSource).toContain('const PREP_SUBTAB_TRACK_INNER_PADDING = 3;');
    expect(arenaSource).toContain("style={{marginHorizontal:ARENA_SIDE_PADDING, marginBottom:12}}");
    expect(arenaSource).toContain("style={{flex:1, marginRight: idx === PREP_TABS.length - 1 ? 0 : PREP_SUBTAB_GAP}}");
    expect(arenaSource).toContain('flex: 1,');
    expect(arenaSource).toContain('minWidth: 0,');
    expect(arenaSource).toContain("width: '100%',");
    expect(arenaSource).toContain("padding:PREP_SUBTAB_TRACK_INNER_PADDING");
    expect(arenaSource).toContain('const ARENA_SEGMENT_ACTIVE_GRADIENT =');
    expect(arenaSource).toContain('colors={active ? ARENA_SEGMENT_ACTIVE_GRADIENT : ARENA_SEGMENT_INACTIVE_GRADIENT}');
    expect(arenaSource).toContain('locations={active ? ARENA_SEGMENT_ACTIVE_LOCATIONS : undefined}');
    expect(arenaSource).toContain('backgroundColor:active?ARENA_SEGMENT_ACTIVE_BACKGROUND:ARENA_SEGMENT_INACTIVE_BACKGROUND');
    expect(arenaSource).not.toContain("backgroundColor:active?'rgba(122,157,184,0.08)':'transparent'");
    expect(arenaSource).not.toContain("backgroundColor:active?hexWithAlpha(ARENA_CHROME_ACCENT, 0.72):'transparent'");
    expect(arenaSource).not.toContain('PREP_SUBTAB_WIDTH');
    expect(arenaSource).not.toContain('TOP MODEL GRADES');
    expect(arenaSource).not.toContain('const TOP_GRADE_CARD_W');
    expect(arenaSource).not.toContain('const Top3Card');
    expect(arenaSource).not.toContain('top3.length');
    expect(arenaSource).not.toContain("alignSelf:'flex-start'");
    expect(arenaSource).not.toContain('Math.max(ARENA_SIDE_PADDING, (SW - TOP_GRADE_CARD_W) / 2)');
    expect(arenaSource).not.toContain('style={{minHeight:PREP_SUBTAB_MIN_HEIGHT, borderRadius:13, padding:1}}');
    expect(arenaSource).not.toContain("style={{minHeight:54, flexDirection:'row', marginHorizontal:ARENA_SIDE_PADDING");
  });

  it('keeps Prep matchup cards constrained and readable on narrow screens', () => {
    expect(arenaSource).toContain('const MATCHUP_CARD_CTA_HEIGHT = 40;');
    expect(arenaSource).toContain('const MATCHUP_TAG_ROW_GAP = 5;');
    expect(arenaSource).toContain('const PREP_MATCHUP_CARD_GAP = 10;');
    expect(arenaSource).toContain('const MATCHUP_CARD_CONTENT_PADDING_X = 20;');
    expect(arenaSource).toContain('const MATCHUP_CARD_CONTENT_PADDING_Y = 18;');
    expect(arenaSource).toContain('const MATCHUP_CARD_MIN_HEIGHT = 148;');
    expect(arenaSource).toContain('const MATCHUP_RANK_SIZE = 30;');
    expect(arenaSource).toContain('const MATCHUP_RANK_GAP = 12;');
    expect(arenaSource).toContain('const MATCHUP_ACTION_SIZE = 30;');
    expect(arenaSource).toContain('const MATCHUP_ACTION_GAP = 10;');
    expect(arenaSource).toContain('const MATCHUP_CARD_BACKGROUND =');
    expect(arenaSource).toContain('const MATCHUP_CARD_BORDER =');
    expect(arenaSource).toContain('minHeight: MATCHUP_CARD_MIN_HEIGHT');
    expect(arenaSource).toContain("style={{ flexDirection: 'row', alignItems: 'flex-start' }}");
    expect(arenaSource).toContain('marginRight: MATCHUP_RANK_GAP');
    expect(arenaSource).toContain("style={{ flex: 1, minWidth: 0 }}");
    expect(arenaSource).toContain('marginLeft: MATCHUP_ACTION_GAP');
    expect(arenaSource).toContain("style={{ flexDirection: 'row', flexWrap: 'wrap', gap: MATCHUP_TAG_ROW_GAP, marginTop: 13 }}");
    expect(arenaSource).toContain('height: MATCHUP_CARD_CTA_HEIGHT');
    expect(arenaSource).toContain('marginBottom: PREP_MATCHUP_CARD_GAP');
    expect(arenaSource).not.toContain('defaultExpanded={i === 0}');
    expect(arenaSource).not.toContain('maxWidth: 108');
    expect(arenaSource).not.toContain("marginLeft: 40 }} numberOfLines={expanded ? undefined : 2}");
  });

  it('keeps Prep matchup cards neutral but not flat, with color used only as restrained accent', () => {
    const cardStart = arenaSource.indexOf('// ─── MATCHUP CARD (collapsible) ───');
    const cardEnd = arenaSource.indexOf('// ─── ACCURACY BY SPORT ───', cardStart);
    const cardSource = arenaSource.slice(cardStart, cardEnd);

    expect(cardSource).toContain("const MATCHUP_CARD_BACKGROUND = '#0D131B';");
    expect(cardSource).toContain('const MATCHUP_RANK_BACKGROUND =');
    expect(cardSource).toContain('const MATCHUP_ACCENT_COLOR = ARENA_CHROME_ACCENT;');
    expect(cardSource).toContain('backgroundColor: MATCHUP_CARD_BACKGROUND');
    expect(cardSource).toContain('borderColor: MATCHUP_CARD_BORDER');
    expect(cardSource).toContain('backgroundColor: MATCHUP_RANK_BACKGROUND');
    expect(cardSource).toContain('backgroundColor: MATCHUP_CHIP_BACKGROUND');
    expect(cardSource).toContain('paddingHorizontal: MATCHUP_CARD_CONTENT_PADDING_X');
    expect(cardSource).toContain('paddingVertical: MATCHUP_CARD_CONTENT_PADDING_Y');
    expect(cardSource).toContain('height: MATCHUP_RANK_SIZE');
    expect(cardSource).toContain('width: MATCHUP_ACTION_SIZE');
    expect(cardSource).toContain('<ChevronRight size={14}');
    expect(cardSource).not.toContain('View details');
    expect(cardSource).not.toContain('Hide details');
    expect(cardSource).not.toContain('MODEL READ');
    expect(cardSource).not.toContain('<Plus size={16}');
    expect(cardSource).not.toContain('<Minus size={16}');
    expect(cardSource).not.toContain('borderLeftWidth');
    expect(cardSource).not.toContain('borderLeftColor');
    expect(cardSource).not.toContain("position: 'absolute', left: 12");
    expect(cardSource).not.toContain('width: 2, borderRadius: 1');
    expect(cardSource).not.toContain('isFirst ?');
    expect(cardSource).not.toContain('backgroundColor: MAROON');
    expect(cardSource).not.toContain('backgroundColor: TEAL');
  });

  it('keeps the Prep matchup board above supporting context so game cards sit in the primary viewport', () => {
    const prepStart = arenaSource.indexOf('// ─── PREP MODE ───');
    const prepEnd = arenaSource.indexOf('// ─── REVIEW ───', prepStart);
    const prepSource = arenaSource.slice(prepStart, prepEnd);
    const subtabIndex = prepSource.indexOf('{/* Sub-tab toggle: Ranked / Upsets */}');
    const boardIndex = prepSource.indexOf('{/* Ranked tab content */}');
    const contextIndex = prepSource.indexOf('{/* Slate context card */}');

    expect(subtabIndex).toBeGreaterThan(0);
    expect(boardIndex).toBeGreaterThan(subtabIndex);
    expect(contextIndex).toBeGreaterThan(boardIndex);
    expect(prepSource).not.toContain('Open a matchup for factors and context');
    expect(prepSource).toContain('marginBottom:12');
  });

  it('resets Prep and Review pages to the top instead of preserving stale scroll placement', () => {
    expect(arenaSource).toContain('resetSignal?: number;');
    expect(arenaSource).toContain('const scrollRef = useRef<ScrollView | null>(null);');
    expect(arenaSource).toContain('scrollRef.current?.scrollTo?.({ y: 0, animated: false });');
    expect(arenaSource).toContain('const [arenaPageResetKey, setArenaPageResetKey] = useState<number>(0);');
    expect(arenaSource).toContain('setArenaPageResetKey((key) => key + 1);');
    expect(arenaSource).toContain('resetSignal={am === 1 ? arenaPageResetKey : undefined}');
    expect(arenaSource).toContain('resetSignal={am === 2 ? arenaPageResetKey : undefined}');
  });

  it('uses a compact Review summary and denser result cards', () => {
    expect(arenaSource).toContain('const REVIEW_RESULT_CARD_GAP = 10;');
    expect(arenaSource).toContain('const REVIEW_PROGRESS_SEGMENT_GAP = 3;');
    expect(arenaSource).toContain('const ReviewSummaryCard = memo');
    expect(arenaSource).toContain("fontVariant: ['tabular-nums']");
    expect(arenaSource).toContain('marginBottom: REVIEW_RESULT_CARD_GAP');
    expect(arenaSource).toContain('<ReviewSummaryCard wins={w} losses={l} accuracy={a} games={pfg} picks={pm} />');
    expect(arenaSource).not.toContain('fontSize:50');
    expect(arenaSource).not.toContain('paddingVertical:26');
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
    expect(arenaSource).toContain('const liveRailPressGuard = useScrollPressGuard();');
    expect(arenaSource).toContain('const canOpenLiveCard = liveRailPressGuard.canPress;');
    expect(arenaSource).toContain('liveRailPressGuard.onScrollBeginDrag();');
    expect(arenaSource).toContain('liveRailPressGuard.onScrollEndDrag();');
    expect(arenaSource).toContain('onScrollBeginDrag={markLiveRailScrollStart}');
    expect(arenaSource).toContain('canOpen={canOpenLiveCard}');
    expect(arenaSource).not.toContain('LIVE_RAIL_PAGER_GUTTER_CORRECTION');
    expect(arenaSource).not.toContain('ListHeaderComponent={<View style={{ width: liveRailEdgeSpacer }} />}');
    expect(arenaSource).toContain('snapToOffsets={liveSnapOffsets}');
    expect(arenaSource).toContain('key={`live-rail-${Math.round(liveCardWidth)}-${liveSportFilter}-${liveSearch.trim()}`}');
    expect(arenaSource).toContain('snapLiveRail(event, true)');
  });
});
