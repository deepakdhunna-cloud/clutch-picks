import fs from 'fs';
import path from 'path';

const verifyOtpSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/verify-otp.tsx'),
  'utf8',
);
const welcomeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/welcome.tsx'),
  'utf8',
);
const useSessionSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/auth/use-session.ts'),
  'utf8',
);

describe('auth session wiring', () => {
  it('persists OTP sessions through the shared auth payload token helper', () => {
    expect(verifyOtpSource).toContain("import { authUserIdentityFromPayload, sessionTokenFromAuthPayload } from '@/lib/auth/auth-user';");
    expect(verifyOtpSource).toContain("import { useFinalizeAuthSession } from '@/lib/auth/use-session';");
    expect(verifyOtpSource).toContain('const sessionToken = sessionTokenFromAuthPayload(result.data);');
    expect(verifyOtpSource).toContain('const finalizedSession = await finalizeAuthSession(result.data, { fallbackEmail: email.trim() });');
    expect(verifyOtpSource).not.toContain('(result.data as any)?.token');
    expect(verifyOtpSource).not.toContain('useInvalidateSession');
  });

  it('uses the shared auth payload session check for Apple sign-in completion', () => {
    expect(welcomeSource).toContain("import { useFinalizeAuthSession } from '@/lib/auth/use-session';");
    expect(welcomeSource).toContain('authPayloadHasSession');
    expect(welcomeSource).toContain('if (authPayloadHasSession(authData)) {');
    expect(welcomeSource).toContain('if (authPayloadHasSession(sessionResult.data)) {');
    expect(welcomeSource).toContain('const finalizedSession = await finalizeAuthSession(authData);');
    expect(welcomeSource).not.toContain('const authPayloadHasSession = (authData: unknown)');
    expect(welcomeSource).not.toContain('useInvalidateSession');
  });

  it('cancels stale signed-out session requests before priming an auth session', () => {
    expect(useSessionSource).toContain('await queryClient.cancelQueries({ queryKey: SESSION_QUERY_KEY });');
    expect(useSessionSource.indexOf('await queryClient.cancelQueries({ queryKey: SESSION_QUERY_KEY });'))
      .toBeLessThan(useSessionSource.indexOf('queryClient.setQueryData(SESSION_QUERY_KEY, primedSession);'));
  });
});
