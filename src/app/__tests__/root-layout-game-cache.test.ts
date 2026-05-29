import { readFileSync } from 'fs';
import path from 'path';

describe('root layout games cache hydration', () => {
  it('does not seed the games query from the old root-level cache', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/_layout.tsx'), 'utf8');

    expect(source).not.toContain('rq_cache_games_v1');
    expect(source).not.toContain("queryClient.setQueryData(['games'], parsed.data)");
  });
});
