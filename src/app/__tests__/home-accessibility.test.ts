import fs from 'fs';
import path from 'path';

const homeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/(tabs)/index.tsx'),
  'utf8',
);
const sportCardSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/sports/SportCard.tsx'),
  'utf8',
);
const liveArenaCardSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/sports/LiveArenaCard.tsx'),
  'utf8',
);
const gameCardSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/sports/GameCard.tsx'),
  'utf8',
);

describe('home accessibility', () => {
  it('exposes home board controls as named buttons with selected state', () => {
    expect(homeSource).toContain('accessibilityLabel={selectedSportFilter ? `Clear ${displaySport(selectedSportFilter)} filter` : \'View game board\'}');
    expect(homeSource).toContain('accessibilityLabel={`${f.label} games filter`}');
    expect(homeSource).toContain('accessibilityState={{ selected: active }}');
    expect(homeSource).toContain('<LedMiniPanel label="CLEAR" height={44} />');
    expect(homeSource).toContain('minHeight: 44');
  });

  it('uses a shared slight blur surface for home filter pills', () => {
    expect(homeSource).toContain("import { BlurView } from 'expo-blur';");
    expect(homeSource).toContain('const HOME_FILTER_PILL_BLUR_INTENSITY = 18;');
    expect(homeSource).toContain('const HomeFilterPillSurface = memo');
    expect(homeSource).toContain('<BlurView intensity={HOME_FILTER_PILL_BLUR_INTENSITY} tint="dark" style={StyleSheet.absoluteFillObject} />');
    expect(homeSource).toContain('<HomeFilterPillSurface active={!selectedLiveSportFilter}>');
    expect(homeSource).toContain('<HomeFilterPillSurface active={isChipSelected}>');
    expect(homeSource).toContain('<HomeFilterPillSurface active={active}>');
  });

  it('exposes sport tiles and live/game cards as named buttons', () => {
    expect(sportCardSource).toContain('accessibilityLabel={`${displaySport(sport)}, ${gameCount} game${gameCount === 1 ? \'\' : \'s\'}`}');
    expect(sportCardSource).toContain('accessibilityState={{ selected: isSelected }}');
    expect(liveArenaCardSource).toContain('accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}');
    expect(liveArenaCardSource).toContain('accessibilityHint="Opens game details"');
    expect(gameCardSource).toContain('accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}');
    expect(gameCardSource).toContain('accessibilityHint="Opens game details"');
  });

  it('names nested home card actions instead of leaking raw REMOVE text', () => {
    expect(gameCardSource).toContain("accessibilityLabel={isDisabled ? `${team.name} jersey` : isSelected ? `Remove pick for ${team.name}` : `Pick ${team.name}`}");
    expect(gameCardSource).toContain('accessibilityLabel={`Preview Pro: ${game.awayTeam.name} at ${game.homeTeam.name}`}');
    expect(gameCardSource).toContain('accessibilityHint="Opens Clutch Picks Pro"');
  });

  it('shows a real settling state while home search debounce catches up', () => {
    expect(homeSource).toContain("const isHomeSearchSettling = normalizedSearchQuery !== '' && normalizedDebouncedSearchQuery !== normalizedSearchQuery;");
    expect(homeSource).toContain("isHomeSearchSettling ? 'Updating results'");
    expect(homeSource).toContain(') : isHomeSearchSettling ? (');
    expect(homeSource).toContain('Searching games');
    expect(homeSource).toContain('searchData = useMemo<GameWithPrediction[]>');
  });
});
