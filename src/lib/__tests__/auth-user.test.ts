import {
  authPayloadHasSession,
  authSessionFromPayload,
  authUserIdentityFromPayload,
  sessionTokenFromAuthPayload,
} from '../auth/auth-user';

describe('auth user identity extraction', () => {
  it('extracts RevenueCat identity from a Better Auth sign-in payload', () => {
    expect(authUserIdentityFromPayload({
      token: 'session-token',
      user: {
        id: 'user_123',
        email: 'person@example.com',
        name: 'Jane Appleseed',
      },
    })).toEqual({
      userId: 'user_123',
      email: 'person@example.com',
      displayName: 'Jane Appleseed',
    });
  });

  it('extracts RevenueCat identity from a getSession payload', () => {
    expect(authUserIdentityFromPayload({
      session: { token: 'session-token' },
      user: {
        id: 'user_456',
        email: 'manual@example.com',
        name: '',
      },
    })).toEqual({
      userId: 'user_456',
      email: 'manual@example.com',
      displayName: null,
    });
  });

  it('extracts session tokens from nested auth client payloads', () => {
    expect(sessionTokenFromAuthPayload({
      data: {
        token: 'nested-session-token',
      },
    })).toBe('nested-session-token');
  });

  it('recognizes nested auth client payloads as authenticated sessions', () => {
    expect(authPayloadHasSession({
      data: {
        token: 'nested-session-token',
        user: {
          id: 'user_789',
        },
      },
    })).toBe(true);
  });

  it('does not treat empty auth payloads as authenticated sessions', () => {
    expect(authPayloadHasSession(null)).toBe(false);
    expect(authPayloadHasSession({ data: { token: '   ', user: null } })).toBe(false);
  });

  it('builds a session snapshot from a successful auth response', () => {
    expect(authSessionFromPayload({
      token: 'session-token',
      user: {
        id: 'user_123',
        email: 'person@example.com',
        name: 'Jane Appleseed',
      },
    })).toEqual({
      session: { token: 'session-token' },
      user: {
        id: 'user_123',
        email: 'person@example.com',
        name: 'Jane Appleseed',
      },
    });
  });

  it('can build a temporary session snapshot from a token and fallback email', () => {
    expect(authSessionFromPayload(
      { data: { token: 'session-token' } },
      { fallbackEmail: 'person@example.com' },
    )).toEqual({
      session: { token: 'session-token' },
      user: {
        id: 'person@example.com',
        email: 'person@example.com',
        name: null,
      },
    });
  });

  it('does not build a session snapshot from only a fallback email', () => {
    expect(authSessionFromPayload(null, { fallbackEmail: 'person@example.com' })).toBeNull();
  });
});
