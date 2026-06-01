import fs from 'fs';
import path from 'path';

const onboardingSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/onboarding.tsx'),
  'utf8',
);
const profileSetupSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/profile-setup.tsx'),
  'utf8',
);

describe('onboarding accessibility', () => {
  it('names primary onboarding navigation controls and states', () => {
    expect(onboardingSource).toContain('accessibilityLabel="Start onboarding"');
    expect(onboardingSource).toContain('accessibilityLabel="Back"');
    expect(onboardingSource).toContain('accessibilityLabel="Skip onboarding"');
    expect(onboardingSource).toContain('accessibilityLabel="Continue onboarding"');
    expect(onboardingSource).toContain('accessibilityState={{ disabled: !picked }}');
    expect(onboardingSource).toContain('accessibilityState={{ disabled: !canContinue, busy: isSavingProfile }}');
  });

  it('keeps small onboarding controls at a real 44 point target', () => {
    expect(onboardingSource).toContain('const iconButtonStyle = { width: 44, height: 44');
    expect(onboardingSource).toContain('minHeight: 44');
  });

  it('names interactive onboarding content controls', () => {
    expect(onboardingSource).toContain('accessibilityLabel="Pick Chicago Bulls"');
    expect(onboardingSource).toContain('accessibilityLabel="Pick Minnesota Timberwolves"');
    expect(onboardingSource).toContain('accessibilityState={{ selected: picked === \'home\' }}');
    expect(onboardingSource).toContain('accessibilityState={{ selected: picked === \'away\' }}');
    expect(onboardingSource).toContain('accessibilityLabel={profileImage ? "Change profile photo" : "Add profile photo"}');
    expect(onboardingSource).toContain('accessibilityLabel="Display name"');
    expect(onboardingSource).toContain('accessibilityLabel="Start Pro"');
    expect(onboardingSource).toContain('accessibilityLabel="Continue free"');
  });

  it('names standalone profile setup controls', () => {
    expect(profileSetupSource).toContain('accessibilityLabel={profileImage ? "Change profile photo" : "Add profile photo"}');
    expect(profileSetupSource).toContain('accessibilityLabel="Add profile photo"');
    expect(profileSetupSource).toContain('accessibilityLabel="Display name"');
    expect(profileSetupSource).toContain('accessibilityLabel={`Toggle ${league.name}`}');
    expect(profileSetupSource).toContain('accessibilityState={{ selected: isSelected }}');
    expect(profileSetupSource).toContain("accessibilityLabel={hasDisplayName ? \"Let's Go\" : \"Skip for Now\"}");
    expect(profileSetupSource).toContain('accessibilityState={{ disabled: isSaving, busy: isSaving }}');
  });

  it('keeps standalone profile setup content clear of the fixed footer', () => {
    expect(profileSetupSource).toContain('paddingTop: 36');
    expect(profileSetupSource).toContain('marginBottom: 30');
    expect(profileSetupSource).toContain('marginBottom: 28');
  });
});
