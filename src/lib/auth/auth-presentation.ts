export const WELCOME_LEAGUE_PILLS = [
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
] as const;

function appleErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
}

function appleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

export function isAppleSignInCancel(error: unknown): boolean {
  const code = appleErrorCode(error);
  const message = appleErrorMessage(error).toLowerCase();
  return (
    code === 'ERR_REQUEST_CANCELED' ||
    code === 'ERR_CANCELED' ||
    code === 'USER_CANCELLED_AUTHORIZE' ||
    message.includes('user canceled') ||
    message.includes('user cancelled') ||
    message.includes('authorization was cancelled')
  );
}

export function appleSignInFallbackMessage(error: unknown): string | null {
  if (isAppleSignInCancel(error)) return null;

  return 'Apple sign in could not complete. Please try again or use email.';
}
