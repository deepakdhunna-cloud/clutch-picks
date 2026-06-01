import fs from 'fs';
import path from 'path';

const onboardingSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/onboarding.tsx'),
  'utf8',
);

describe('onboarding profile save', () => {
  it('does not silently complete onboarding when required profile save fails', () => {
    expect(onboardingSource).toContain("title: 'Profile Not Saved'");
    expect(onboardingSource).toContain('setIsSavingProfile(true)');
    expect(onboardingSource).toContain('setIsSavingProfile(false)');
    expect(onboardingSource).not.toContain("catch {\n      await AsyncStorage.setItem('clutch_onboarding_complete', 'true');\n      setStep(5);\n    }");
  });
});
