import { authUserIdentityFromPayload } from '../auth/auth-user';

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
});
