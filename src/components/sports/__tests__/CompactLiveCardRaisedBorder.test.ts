import { readFileSync } from 'fs';
import path from 'path';

describe('CompactLiveCard shares the My Arena live-card design', () => {
  it('delegates to the shared LiveArenaCard rail variant at the locked rail width', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/sports/CompactLiveCard.tsx'), 'utf8');

    expect(source).toContain('LiveArenaCard');
    expect(source).toContain("variant=\"rail\"");
    expect(source).toContain('CARD_WIDTH = 300');
  });

  it('builds the rail card on the shared glass-frame primitives', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/sports/LiveArenaCard.tsx'), 'utf8');

    // Shares the My Arena game-day visual: LED scoreboard + jerseys, glass frame.
    expect(source).toContain('SharedArenaScoreboard');
    expect(source).toContain('TeamJersey');
    expect(source).toContain('padding: cfg.border');
  });

  it('keeps tennis live cards on the compact player-score layout', () => {
    const liveCardSource = readFileSync(path.join(process.cwd(), 'src/components/sports/LiveArenaCard.tsx'), 'utf8');
    const tennisGridSource = readFileSync(path.join(process.cwd(), 'src/components/sports/TennisScoreGrid.tsx'), 'utf8');

    expect(liveCardSource).toContain('renderTennisBody');
    expect(liveCardSource).toContain('variant="rail"');
    expect(liveCardSource).toContain('tennisScoreScale = variant === \'rail\' ? 0.76 : 0.9');
    expect(tennisGridSource).toContain("type Variant = 'rail' | 'compact' | 'detail'");
    expect(tennisGridSource).toContain('railScoreText');
  });
});
