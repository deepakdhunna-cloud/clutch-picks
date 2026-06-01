import {
  authRequestErrorMessage,
  AUTH_REQUEST_TIMEOUT_MESSAGE,
  isAuthRequestTimeoutError,
  withAuthRequestTimeout,
} from '../auth/auth-request';

describe('auth request helpers', () => {
  it('returns a request result before the timeout', async () => {
    await expect(withAuthRequestTimeout(Promise.resolve({ ok: true }), { timeoutMs: 20 }))
      .resolves.toEqual({ ok: true });
  });

  it('turns a stalled auth request into a friendly timeout error', async () => {
    const stalled = new Promise(() => {});

    await expect(withAuthRequestTimeout(stalled, { timeoutMs: 1 }))
      .rejects.toMatchObject({ code: 'AUTH_REQUEST_TIMEOUT' });
  });

  it('maps timeout errors to user-facing copy', () => {
    const error = Object.assign(new Error('timed out'), { code: 'AUTH_REQUEST_TIMEOUT' });

    expect(isAuthRequestTimeoutError(error)).toBe(true);
    expect(authRequestErrorMessage(error, 'fallback')).toBe(AUTH_REQUEST_TIMEOUT_MESSAGE);
  });
});
