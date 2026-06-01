import fs from 'fs';
import path from 'path';

const clutchPicksSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/(tabs)/clutch-picks.tsx'),
  'utf8',
);

describe('free clutch picks paywall entry points', () => {
  it('lets locked pick cards open the paywall, not just the footer CTA', () => {
    expect(clutchPicksSource).toContain('const openPaywall = useCallback');
    expect(clutchPicksSource).toContain('accessibilityLabel={`Unlock Pro pick #${rank}`}');
    const lockedPickControl = clutchPicksSource.slice(
      clutchPicksSource.indexOf('accessibilityLabel={`Unlock Pro pick #${rank}`}'),
      clutchPicksSource.indexOf('style={({ pressed }) => ({', clutchPicksSource.indexOf('accessibilityLabel={`Unlock Pro pick #${rank}`}')),
    );
    expect(lockedPickControl).toContain('accessibilityHint="Opens Clutch Picks Pro"');
    expect(clutchPicksSource).toContain('onPress={openPaywall}');
  });

  it('exposes the footer pro CTA as a named button', () => {
    expect(clutchPicksSource).toContain('accessibilityRole="button"');
    expect(clutchPicksSource).toContain('accessibilityLabel="Explore Pro"');
    expect(clutchPicksSource).toContain('accessibilityHint="Opens Clutch Picks Pro"');
  });

  it('exposes unlocked Pro pick cards as concise full-breakdown buttons', () => {
    expect(clutchPicksSource).toContain('accessibilityLabel={`Open full breakdown: ${game.awayTeam.name} at ${game.homeTeam.name}`}');
    expect(clutchPicksSource).toContain('accessibilityHint="Opens game details with the full prediction breakdown"');
    expect(clutchPicksSource).toContain('accessibilityElementsHidden');
    expect(clutchPicksSource).toContain('importantForAccessibility="no-hide-descendants"');
  });

  it('does not wait on top-picks data before showing free locked entry points', () => {
    expect(clutchPicksSource).toContain('const { isPremium, isLoading: isSubscriptionLoading } = useSubscription();');
    expect(clutchPicksSource).toContain('const shouldShowPicksSkeleton = isSubscriptionLoading || (isPremium && isInitialPicksLoading);');
    expect(clutchPicksSource).toContain('{shouldShowPicksSkeleton ? (');
  });

  it('keeps collapsed Pro analysis previews from clipping mid-word', () => {
    expect(clutchPicksSource).toContain('numberOfLines={expanded ? undefined : 3}');
    expect(clutchPicksSource).toContain('ellipsizeMode="tail"');
  });
});
