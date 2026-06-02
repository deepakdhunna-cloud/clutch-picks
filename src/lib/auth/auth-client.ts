import "./online-manager-shim";
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { authStorage } from "./auth-storage";

// Bearer-token store. We rely on this in addition to the expo plugin's
// cookie store because iOS NSURLSession can swallow Set-Cookie response
// headers before JS sees them, leaving the cookie store empty after a
// successful sign-in. The backend `bearer` plugin echoes the session
// token back as `set-auth-token`, which we capture here and replay as
// `Authorization: Bearer <token>` on subsequent requests.
// Keep the existing SecureStore/app scheme identifiers for update
// compatibility. These are local app identifiers, not external service
// dependencies, and changing them would force existing users to sign in again.
const TOKEN_KEY = "vibecode_bearer_token";
const LEGACY_TOKEN_KEYS = ["clutchpicks_bearer_token"];
let cachedToken: string | null | undefined;

function readToken(): string | null {
  if (cachedToken !== undefined) {
    return cachedToken;
  }

  try {
    let v = authStorage.getItem(TOKEN_KEY);
    if (!v) {
      for (const key of LEGACY_TOKEN_KEYS) {
        v = authStorage.getItem(key);
        if (v) break;
      }
    }
    cachedToken = v ?? null;
    return v;
  } catch {
    cachedToken = null;
    return null;
  }
}

function writeToken(token: string | null) {
  cachedToken = token;
  try {
    if (token) {
      authStorage.setItem(TOKEN_KEY, token);
    } else {
      void authStorage.deleteItemAsync(TOKEN_KEY).catch(() => {});
      for (const key of LEGACY_TOKEN_KEYS) {
        void authStorage.deleteItemAsync(key).catch(() => {});
      }
    }
  } catch {}
}

export const setBearerToken = (token: string | null) => writeToken(token);
export const getBearerToken = () => readToken();

export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_BACKEND_URL! as string,
  fetchOptions: {
    onRequest: (context) => {
      const token = readToken();
      const url = context.url?.toString() ?? '';
      if (token && url.includes("/api/auth/")) {
        // Native fetches do not reliably send browser-style Origin headers.
        // Prefer bearer auth for Better Auth endpoints when a bearer token is
        // present, but keep cookie auth available for OAuth browser sessions.
        context.headers.delete("cookie");
      }
      if (token && !context.headers.has("authorization")) {
        context.headers.set("authorization", `Bearer ${token}`);
        context.headers.delete("cookie");
      }
      return context;
    },
    onSuccess: (context) => {
      const url = context.request?.url?.toString() ?? "";
      const setAuthToken = context.response.headers.get("set-auth-token");
      if (setAuthToken) {
        writeToken(setAuthToken);
      }
      if (url.includes("/sign-out")) {
        writeToken(null);
      }
    },
  },
  plugins: [
    expoClient({
      scheme: "vibecode",
      storagePrefix: "vibecode",
      storage: authStorage,
    }),
    emailOTPClient(),
  ],
});

export const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  const cookie = authClient.getCookie();
  const token = readToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }
  if (cookie) headers.Cookie = cookie;

  return headers;
};
