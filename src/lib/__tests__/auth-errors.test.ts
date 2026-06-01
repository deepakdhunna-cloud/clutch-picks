import { verificationCodeErrorMessage } from '../auth/auth-errors';

describe('auth error presentation', () => {
  it('rewrites technical OTP errors into user-facing copy', () => {
    expect(verificationCodeErrorMessage('Invalid OTP')).toBe("That code didn't work. Check it and try again.");
    expect(verificationCodeErrorMessage('invalid verification code')).toBe("That code didn't work. Check it and try again.");
  });

  it('falls back to a friendly code error when the backend gives no message', () => {
    expect(verificationCodeErrorMessage()).toBe("That code didn't work. Check it and try again.");
  });
});
