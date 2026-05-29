import { readFileSync } from 'fs';
import path from 'path';

describe('game detail prediction copy', () => {
  it('does not show a pregame lock badge in the prediction card', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/game/[id].tsx'), 'utf8');

    expect(source).not.toContain('PREGAME LOCK');
  });
});
