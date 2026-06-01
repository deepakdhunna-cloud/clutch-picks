import fs from 'fs';
import path from 'path';

const profileSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/(tabs)/profile.tsx'),
  'utf8',
);

describe('profile settings control', () => {
  it('exposes a named button with a forgiving hit target', () => {
    expect(profileSource).toContain('accessibilityRole="button"');
    expect(profileSource).toContain('accessibilityLabel="Open settings"');
    expect(profileSource).toContain('hitSlop={10}');
    expect(profileSource).toContain('width: 44');
    expect(profileSource).toContain('height: 44');
  });
});

describe('profile primary actions', () => {
  it('exposes visible profile actions as real buttons with 44 point touch targets', () => {
    expect(profileSource).toContain('accessibilityLabel="Edit profile"');
    expect(profileSource).toContain('accessibilityLabel="Share analyst card"');
    expect(profileSource).toContain('accessibilityLabel="Sign out"');
    expect(profileSource).toContain('accessibilityHint="Signs you out of Clutch Picks"');
    expect(profileSource).toContain('minHeight: 44');
  });
});
