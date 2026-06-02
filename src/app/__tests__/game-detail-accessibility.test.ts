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
    expect(gameDetailSource).toContain('pointerEvents="box-none" style={[styles.floatingDetailControls');
    expect(gameDetailSource).toContain("floatingDetailControls: { position: 'absolute', left: 0, right: 0, zIndex: 110");
    expect(gameDetailSource).not.toContain('styles.detailHeaderScrim');
    expect(gameDetailSource).not.toContain("colors={['#040608', '#040608', 'rgba(4,6,8,0.00)']}");
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
    expect(gameDetailSource).toContain('accessibilityState={{ disabled: !watchOption }}');
    expect(gameDetailSource).toContain('accessible={false}');
    expect(gameDetailSource).toContain('accessibilityViewIsModal');
    expect(gameDetailSource).toContain('accessibilityRole="header"');
    expect(gameDetailSource).toContain('How would you like to watch?');
  });

  it('does not render an empty box score section before a game starts', () => {
    expect(gameDetailSource).toContain('const hasBoxScore =');
    expect(gameDetailSource).toContain('{hasBoxScore ? (');
    expect(gameDetailSource).not.toContain('<Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Box Score</Text>\n            <QuarterTable game={game} />');
  });
});
