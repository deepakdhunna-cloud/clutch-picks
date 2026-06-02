import * as SecureStore from 'expo-secure-store';

export const AUTH_STORAGE_COOKIE_KEY = 'vibecode_cookie';
export const AUTH_STORAGE_KEYS = [
  AUTH_STORAGE_COOKIE_KEY,
  'vibecode_session_data',
  'vibecode_session_token',
  'vibecode_refresh_token',
  'vibecode_bearer_token',
  'clutchpicks_cookie',
  'clutchpicks_session_data',
  'clutchpicks_session_token',
  'clutchpicks_refresh_token',
  'clutchpicks_bearer_token',
];

const volatileAuthStorage = new Map<string, string>();

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
};

export const isSecureStoreUnavailableError = (error: unknown) => {
  const message = errorMessage(error);
  return (
    message.includes("A required entitlement isn't present") ||
    message.includes('errSecMissingEntitlement') ||
    message.includes('KeyChainException')
  );
};

export const authStorage = {
  getItem(key: string): string | null {
    try {
      const value = SecureStore.getItem(key);
      if (value != null) volatileAuthStorage.set(key, value);
      return value ?? volatileAuthStorage.get(key) ?? null;
    } catch {
      return volatileAuthStorage.get(key) ?? null;
    }
  },

  setItem(key: string, value: string): void {
    volatileAuthStorage.set(key, value);
    try {
      SecureStore.setItem(key, value);
    } catch {}
  },

  async deleteItemAsync(key: string): Promise<void> {
    volatileAuthStorage.delete(key);
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {}
  },
};

export const clearAuthStorage = async (keys = AUTH_STORAGE_KEYS) => {
  await Promise.all(keys.map((key) => authStorage.deleteItemAsync(key)));
};
