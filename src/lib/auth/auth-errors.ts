const FRIENDLY_CODE_ERROR = "That code didn't work. Check it and try again.";

export function verificationCodeErrorMessage(message?: string | null): string {
  const normalized = message?.trim().toLowerCase();
  if (!normalized) return FRIENDLY_CODE_ERROR;

  if (normalized.includes('invalid otp') || normalized.includes('invalid verification code')) {
    return FRIENDLY_CODE_ERROR;
  }

  return message?.trim() || FRIENDLY_CODE_ERROR;
}
