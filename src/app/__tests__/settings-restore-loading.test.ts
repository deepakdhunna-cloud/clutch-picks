import fs from 'fs';
import path from 'path';

const settingsSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/settings.tsx'),
  'utf8',
);

describe('settings restore purchases row', () => {
  it('shows immediate in-row progress while restore is pending', () => {
    expect(settingsSource).toContain('const restorePurchasesMutation = useMutation');
    expect(settingsSource).toContain('const isRestoringPurchases = restorePurchasesMutation.isPending');
    expect(settingsSource).toContain('title={isRestoringPurchases ? "Restoring..." : "Restore Purchases"}');
    expect(settingsSource).toContain('disabled={isRestoringPurchases}');
    expect(settingsSource).toContain('<ActivityIndicator size="small" color="#7A9DB8" />');
  });

  it('treats RevenueCat premium access as restored even when active entitlements lag', () => {
    expect(settingsSource).toContain('customerInfoHasPremium,');
    expect(settingsSource).toContain('await checkSubscription({ restored: true });');
    expect(settingsSource).toContain('return { hasActive: customerInfoHasPremium(result.data) };');
    expect(settingsSource).not.toContain("return { hasActive: Object.keys(result.data.entitlements.active || {}).length > 0 };");
  });

  it('gives users a support recovery path when restore finds no purchase', () => {
    expect(settingsSource).toContain('const openSupportEmail = async () =>');
    expect(settingsSource).toContain("actionLabel: 'Contact Support'");
    expect(settingsSource).toContain("secondaryActionLabel: 'OK'");
    expect(settingsSource).toContain('support@clutchpicksapp.com');
    expect(settingsSource).toContain('No App Store subscription was found for this account.');
  });
});
