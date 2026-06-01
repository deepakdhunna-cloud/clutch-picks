import {
  appleSignInFallbackMessage,
  isAppleSignInCancel,
  WELCOME_LEAGUE_PILLS,
} from '../auth/auth-presentation';

describe('auth presentation', () => {
  it('shows every supported league on the welcome screen', () => {
    expect(WELCOME_LEAGUE_PILLS).toEqual([
      'NBA',
      'NFL',
      'MLB',
      'NHL',
      'MLS',
      'NCAAF',
      'NCAAB',
      'EPL',
      'UCL',
      'IPL',
      'Tennis',
    ]);
    expect(WELCOME_LEAGUE_PILLS).toHaveLength(11);
  });

  it('does not show an Apple sign-in error when the user cancels', () => {
    const error = { code: 'ERR_REQUEST_CANCELED' };
    expect(isAppleSignInCancel(error)).toBe(true);
    expect(appleSignInFallbackMessage(error)).toBeNull();
  });

  it('treats native Apple user-cancel messages as cancellation', () => {
    const error = new Error('The user canceled the authorization attempt');
    expect(isAppleSignInCancel(error)).toBe(true);
    expect(appleSignInFallbackMessage(error)).toBeNull();
  });

  it('uses a completion message for real Apple sign-in failures', () => {
    expect(appleSignInFallbackMessage({ code: 'ERR_APPLE_AUTHENTICATION_FAILED' }))
      .toBe('Apple sign in could not complete. Please try again or use email.');
  });
});
