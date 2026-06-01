import { readFileSync } from 'fs';
import path from 'path';

const gameDetailSource = readFileSync(
  path.join(process.cwd(), 'src/app/game/[id].tsx'),
  'utf8',
);

describe('game detail accessibility', () => {
  it('names the game header controls and keeps them at reachable sizes', () => {
    expect(gameDetailSource).toContain('accessibilityLabel="Back"');
    expect(gameDetailSource).toContain('backBtn: { width: 44, height: 44');
    expect(gameDetailSource).toContain("accessibilityLabel={followed ? 'Unfollow game' : 'Follow game'}");
    expect(gameDetailSource).toContain('accessibilityState={{ selected: followed }}');
  });

  it('keeps detail navigation fixed above long Pro breakdowns', () => {
    expect(gameDetailSource).toContain('const detailFloatingTop = insets.top + 12;');
    expect(gameDetailSource).toContain('styles.detailHeaderScrim');
    expect(gameDetailSource).toContain('pointerEvents="box-none" style={[styles.floatingDetailControls');
    expect(gameDetailSource).toContain("detailHeaderScrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 90");
    expect(gameDetailSource).toContain("floatingDetailControls: { position: 'absolute', left: 0, right: 0, zIndex: 110");
  });

  it('exposes pick jerseys and locked pro previews with useful action labels', () => {
    expect(gameDetailSource).toContain("accessibilityLabel={isDisabled ? `${team.name} jersey` : isSelected ? `Remove pick for ${team.name}` : `Pick ${team.name}`}");
    expect(gameDetailSource).toContain("accessibilityLabel={`Preview Pro pick for ${awayTeam.name} at ${homeTeam.name}`}");
    expect(gameDetailSource).toContain('accessibilityLabel={`Preview Pro: ${title}`}');
    expect(gameDetailSource).toContain('accessibilityHint="Opens Clutch Picks Pro"');
  });

  it('names analysis and pick-strength routes as buttons', () => {
    expect(gameDetailSource).toContain('accessibilityLabel="Explain pick strength"');
    expect(gameDetailSource).toContain('accessibilityLabel="Open full pick analysis"');
    expect(gameDetailSource).toContain('accessibilityLabel="Preview Pro: Why We Made This Pick"');
  });

  it('keeps the watch source action at the recommended 44 point target', () => {
    expect(gameDetailSource).toContain('watchHubHeader: {\n    minHeight: 44');
  });

  it('does not render an empty box score section before a game starts', () => {
    expect(gameDetailSource).toContain('const hasBoxScore =');
    expect(gameDetailSource).toContain('{hasBoxScore ? (');
    expect(gameDetailSource).not.toContain('<Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Box Score</Text>\n            <QuarterTable game={game} />');
  });
});
