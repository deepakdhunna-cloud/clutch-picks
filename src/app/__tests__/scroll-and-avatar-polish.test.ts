import fs from 'fs';
import path from 'path';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const scrollPerformanceSource = read('src/lib/scroll-performance.ts');
const avatarSource = read('src/components/ProfileAvatarImage.tsx');
const homeSource = read('src/app/(tabs)/index.tsx');
const arenaSource = read('src/app/(tabs)/search.tsx');
const exploreSource = read('src/app/search-explore.tsx');
const profileSource = read('src/app/(tabs)/profile.tsx');

describe('scroll and avatar polish regressions', () => {
  it('keeps clipped subview recycling platform-aware for iOS scroll polish', () => {
    expect(scrollPerformanceSource).toContain("Platform.OS === 'android'");
    expect(homeSource).toContain('removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}');
    expect(arenaSource).toContain('removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}');
    expect(exploreSource).toContain('removeClippedSubviews={SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS}');
  });

  it('keeps horizontal card rails centered and one-card-at-a-time', () => {
    expect(homeSource).toContain('snapToInterval={HOME_LIVE_CARD_WIDTH + HOME_LIVE_CARD_GAP}');
    expect(homeSource).toContain('snapToAlignment="start"');
    expect(arenaSource).toContain('snapToInterval={FOLLOWED_CARD_W + ARENA_CARD_GAP}');
    expect(arenaSource).toContain('const LIVE_CARD_SIDE_PEEK = 28;');
    expect(arenaSource).toContain('const liveVisibleRailWidth = Math.min(liveRailWidth, SW);');
    expect(arenaSource).toContain('contentContainerStyle={{ paddingHorizontal: liveRailSidePadding }}');
    expect(arenaSource).toContain('snapToInterval={TOP_GRADE_CARD_SNAP_INTERVAL}');
    expect(exploreSource).toContain('const StoryCardRail = memo');
    expect(exploreSource).toContain('snapToInterval={STORY_CARD_SNAP_INTERVAL}');
    expect(profileSource).toContain('snapToInterval={RECENT_PICK_SNAP_INTERVAL}');
    expect(profileSource).toContain('const RECENT_PICK_RAIL_EDGE_PADDING = RECENT_PICK_CARD_GAP;');
    expect(profileSource).not.toContain('RECENT_PICK_RAIL_SIDE_PADDING');
    expect(profileSource).toContain('disableIntervalMomentum');
  });

  it('keeps avatar image failures from leaving blank profile circles', () => {
    expect(avatarSource).toContain('const [loadFailed, setLoadFailed] = useState(false);');
    expect(avatarSource).toContain('onError={() => setLoadFailed(true)}');
    expect(avatarSource).toContain('return <>{children}</>;');
    expect(profileSource).toContain('<ProfileAvatarImage');
    expect(read('src/app/edit-profile.tsx')).toContain('<ProfileAvatarImage');
    expect(read('src/app/profile-setup.tsx')).toContain('<ProfileAvatarImage');
  });

  it('keeps arena search input light while the keyboard is active', () => {
    expect(exploreSource).toContain('const SEARCH_DEBOUNCE_MS = 180;');
    expect(exploreSource).toContain('const searchableGames = useMemo');
    expect(exploreSource).toContain('setSportFilter((current) => current === null ? current : null);');
    expect(exploreSource).toContain('keyboardDismissMode={Platform.OS === \'ios\' ? \'interactive\' : \'on-drag\'}');
    expect(exploreSource).toContain('automaticallyAdjustKeyboardInsets={Platform.OS === \'ios\'}');
    expect(exploreSource).toContain('autoCorrect={false}');
    expect(exploreSource).toContain('spellCheck={false}');
  });
});
