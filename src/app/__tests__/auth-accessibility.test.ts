import fs from 'fs';
import path from 'path';

const welcomeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/welcome.tsx'),
  'utf8',
);
const signInSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/sign-in.tsx'),
  'utf8',
);
const signUpSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/sign-up.tsx'),
  'utf8',
);
const verifyOtpSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/verify-otp.tsx'),
  'utf8',
);

describe('auth accessibility', () => {
  it('exposes welcome entry actions as real buttons', () => {
    expect(welcomeSource).toContain('accessibilityLabel="Create account"');
    expect(welcomeSource).toContain('accessibilityLabel="Sign in"');
    expect(welcomeSource).toContain('accessibilityState={{ disabled: isLoading }}');
  });

  it('keeps Apple sign-in recoverable when native auth fails', () => {
    expect(welcomeSource).toContain('isAppleSignInCancel');
    expect(welcomeSource).toContain('const signInWithAppleOAuthFallback = async () => {');
    expect(welcomeSource).toContain("provider: 'apple'");
    expect(welcomeSource).toContain("callbackURL: '/(tabs)'");
    expect(welcomeSource).toContain('if (isAppleSignInCancel(nativeError)) return;');
    expect(welcomeSource).toContain('authData = await signInWithAppleOAuthFallback();');
    expect(welcomeSource).toContain('if (isLoading || appleInFlightRef.current) return;');
    expect(welcomeSource).toContain('if (authPayloadHasSession(authData)) {');
    expect(welcomeSource).toContain('throw appleSignInIncompleteError();');
  });

  it('names email auth form controls and links', () => {
    for (const source of [signInSource, signUpSource]) {
      expect(source).toContain('accessibilityLabel="Back"');
      expect(source).toContain('accessibilityLabel="Email address"');
      expect(source).toContain('accessibilityLabel="Continue"');
      expect(source).toContain('accessibilityState={{ disabled: isLoading || !email.trim(), busy: isLoading }}');
    }
    expect(signInSource).toContain('accessibilityLabel="Create an account"');
    expect(signUpSource).toContain('accessibilityLabel="Sign in instead"');
    expect(signInSource).toContain('Sending code...');
    expect(signUpSource).toContain('Sending code...');
  });

  it('names verification code actions and loading states', () => {
    expect(verifyOtpSource).toContain('accessibilityLabel="Back"');
    expect(verifyOtpSource).toContain('accessibilityLabel="Verification code"');
    expect(verifyOtpSource).toContain('accessibilityLabel="Resend code"');
    expect(verifyOtpSource).toContain('accessibilityState={{ disabled: isResending, busy: isResending }}');
    expect(verifyOtpSource).toContain('accessibilityLabel="Verify my account"');
    expect(verifyOtpSource).toContain('accessibilityState={{ disabled: !isComplete || isLoading, busy: isLoading }}');
    expect(verifyOtpSource).toContain('Checking code...');
  });
});
