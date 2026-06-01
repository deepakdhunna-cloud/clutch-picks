import fs from 'fs';
import path from 'path';

const paywallSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/paywall.tsx'),
  'utf8',
);

describe('paywall purchase flow', () => {
  it('leaves the paywall when RevenueCat reports premium access', () => {
    expect(paywallSource).toContain('const { checkSubscription, isPremium } = useSubscription();');
    expect(paywallSource).toContain('const didRedirectForPremiumRef = useRef(false);');
    expect(paywallSource).toContain('if (!isPremium || didRedirectForPremiumRef.current) return;');
    expect(paywallSource).toContain("router.replace('/(tabs)');");
  });

  it('unlocks only after RevenueCat reports active premium access from purchase or restore', () => {
    expect(paywallSource).toContain('customerInfoHasPremium,');
    expect(paywallSource).toContain('if (customerInfoHasPremium(result.data)) {');
    expect(paywallSource).toContain('const hasActive = customerInfoHasPremium(result.data);');
    expect(paywallSource).not.toContain("const hasActive = Object.keys(result.data.entitlements.active || {}).length > 0;");
  });

  it('keeps the purchase button calm and explicit during the App Store handoff', () => {
    expect(paywallSource).toContain('loadingLabel?: string;');
    expect(paywallSource).toContain("if (loading) {");
    expect(paywallSource).toContain('cancelAnimation(shimmerX);');
    expect(paywallSource).toContain("colors={loading ? ['#050505', '#0B0B0D'] : [MAROON, '#6A0818', '#5A0614']}");
    expect(paywallSource).toContain("loadingLabel=\"Opening App Store...\"");
  });

  it('does not leave failed restore as a dead end', () => {
    expect(paywallSource).toContain('const openSupportEmail = async () =>');
    expect(paywallSource).toContain("actionLabel: 'Contact Support'");
    expect(paywallSource).toContain("secondaryActionLabel: 'OK'");
    expect(paywallSource).toContain('support@clutchpicksapp.com');
    expect(paywallSource).toContain('No App Store subscription was found for this account.');
  });

  it('does not leave a canceled App Store sign-in or purchase as a dead end', () => {
    expect(paywallSource).toContain("title: 'Purchase Not Completed'");
    expect(paywallSource).toContain('No charge was made. Sign in to your Apple Account and try again when you are ready.');
  });

  it('explains sandbox Apple Account requirements only in development builds', () => {
    expect(paywallSource).toContain('const sandboxPurchaseHint = __DEV__');
    expect(paywallSource).toContain('not your Clutch login');
    expect(paywallSource).toContain('Use a Sandbox Apple Account from App Store Connect to test purchases.');
    expect(paywallSource).toContain('Development builds need a Sandbox Apple Account from App Store Connect, not your Clutch login.');
    expect(paywallSource).toContain('{sandboxPurchaseHint ? (');
  });

  it('keeps an available monthly package purchasable when store metadata is incomplete', () => {
    expect(paywallSource).toContain('const packageMetadataWarnings = (pkg: PurchasesPackage) => {');
    expect(paywallSource).toContain('const metadataWarnings = packageMetadataWarnings(monthly);');
    expect(paywallSource).toContain('setMonthlyPackage(monthly);');
    expect(paywallSource).not.toContain('must include a 3-day free trial introductory price.');
    expect(paywallSource).not.toContain('must be a monthly subscription. Found period');
  });

  it('keeps the canonical 3-day trial copy when sandbox metadata omits intro pricing', () => {
    expect(paywallSource).toContain('PRO_MONTHLY_HAS_THREE_DAY_TRIAL');
    expect(paywallSource).toContain('const shouldAdvertiseThreeDayTrial = (pkg: PurchasesPackage | null) => {');
    expect(paywallSource).toContain('return PRO_MONTHLY_HAS_THREE_DAY_TRIAL;');
    expect(paywallSource).toContain('const monthlyPackageHasTrial = shouldAdvertiseThreeDayTrial(monthlyPackage);');
    expect(paywallSource).toContain("Start 3-Day Free Trial");
  });
});
