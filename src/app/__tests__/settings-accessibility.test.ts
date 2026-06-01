import fs from 'fs';
import path from 'path';

const settingsSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/settings.tsx'),
  'utf8',
);

describe('settings screen accessibility', () => {
  it('names the back control and keeps it at the recommended 44 point target', () => {
    expect(settingsSource).toContain('accessibilityRole="button"');
    expect(settingsSource).toContain('accessibilityLabel="Back"');
    expect(settingsSource).toContain('width: 44');
    expect(settingsSource).toContain('height: 44');
  });

  it('only exposes actionable settings rows as buttons', () => {
    expect(settingsSource).toContain("const isActionable = typeof onPress === 'function';");
    expect(settingsSource).toContain('if (!isActionable)');
    expect(settingsSource).toContain('accessibilityLabel={title}');
    expect(settingsSource).toContain('accessibilityHint={subtitle}');
    expect(settingsSource).toContain('accessibilityState={{ disabled: Boolean(disabled) }}');
    expect(settingsSource).toContain('disabled={disabled}');
  });

  it('names the promo code field and modal actions', () => {
    expect(settingsSource).not.toContain('accessibilityLabel="Dismiss promo code"');
    expect(settingsSource).toContain('<Pressable accessible={false} onPress={() => setPromoModalVisible(false)}');
    expect(settingsSource).toContain('accessibilityLabel="Promo code"');
    expect(settingsSource).toContain('accessibilityLabel="Cancel promo code"');
    expect(settingsSource).toContain('accessibilityLabel="Redeem promo code"');
  });

  it('shows a support fallback if the device cannot open email', () => {
    expect(settingsSource).toContain('const openSupportEmail = async () =>');
    expect(settingsSource).toContain('const handleSupportPress = openSupportEmail;');
    expect(settingsSource).toContain('Linking.canOpenURL(supportUrl)');
    expect(settingsSource).toContain("title: 'Email Support'");
    expect(settingsSource).toContain('support@clutchpicksapp.com');
    expect(settingsSource).toContain('onPress={handleSupportPress}');
  });
});
