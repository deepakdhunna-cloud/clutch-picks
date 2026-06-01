export const AUTH_REQUEST_TIMEOUT_CODE = 'AUTH_REQUEST_TIMEOUT';
export const AUTH_REQUEST_TIMEOUT_MESSAGE =
  'This is taking too long. Check your connection and try again.';

const DEFAULT_TIMEOUT_MS = 20_000;

export class AuthRequestTimeoutError extends Error {
  code = AUTH_REQUEST_TIMEOUT_CODE;

  constructor(label = 'Auth request') {
    super(`${label} timed out`);
    this.name = 'AuthRequestTimeoutError';
  }
}

export function isAuthRequestTimeoutError(error: unknown): boolean {
  return (
    error instanceof AuthRequestTimeoutError ||
    (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === AUTH_REQUEST_TIMEOUT_CODE
    )
  );
}

export function authRequestErrorMessage(error: unknown, fallback: string): string {
  if (isAuthRequestTimeoutError(error)) return AUTH_REQUEST_TIMEOUT_MESSAGE;
  return fallback;
}

export function withAuthRequestTimeout<T>(
  request: Promise<T>,
  options: { timeoutMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new AuthRequestTimeoutError(options.label));
    }, timeoutMs);
  });

  return Promise.race([request, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}
