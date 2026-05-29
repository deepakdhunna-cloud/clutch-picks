import { readFileSync } from 'fs';
import path from 'path';

describe('CompactLiveCard raised border treatment', () => {
  it('uses a one-notch thicker raised border shell', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/sports/CompactLiveCard.tsx'), 'utf8');

    expect(source).toContain('compactLiveRaisedBorder');
    expect(source).toContain('padding: 3');
    expect(source).toContain('compactLiveRaisedTopHighlight');
    expect(source).toContain('compactLiveRaisedBottomShadow');
  });
});
