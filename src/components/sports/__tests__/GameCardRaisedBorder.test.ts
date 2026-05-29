import { readFileSync } from 'fs';
import path from 'path';

describe('GameCard raised border treatment', () => {
  it('uses a thicker raised outer border shell', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/sports/GameCard.tsx'), 'utf8');

    expect(source).toContain('raisedCardOuterBorder');
    expect(source).toContain('padding: 4');
    expect(source).toContain('cardRaisedTopHighlight');
    expect(source).toContain('cardRaisedBottomShadow');
  });

  it('prints projected score in the same away-vs-home order as the card matchup', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/sports/GameCard.tsx'), 'utf8');

    expect(source).toContain(
      '{game.awayTeam.abbreviation} {projectionDisplay?.awayScore ?? Math.round(game.prediction.projection.projectedAwayScore)} · {game.homeTeam.abbreviation} {projectionDisplay?.homeScore ?? Math.round(game.prediction.projection.projectedHomeScore)}',
    );
  });

  it('uses larger jersey artwork on card surfaces so wordmarks stay readable', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/sports/GameCard.tsx'), 'utf8');

    expect(source).toContain('const GAME_CARD_JERSEY_SIZE = 60;');
    expect(source).toContain('const LIVE_CARD_JERSEY_SIZE = 46;');
    expect(source).toContain('size = GAME_CARD_JERSEY_SIZE');
    expect(source).toContain('size={LIVE_CARD_JERSEY_SIZE}');
  });
});
