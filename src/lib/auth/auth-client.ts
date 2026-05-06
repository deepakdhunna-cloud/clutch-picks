import "./online-manager-shim";
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { emailOTPClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";

// Bearer-token store. We rely on this in addition to the expo plugin's
// cookie store because iOS NSURLSession can swallow Set-Cookie response
// headers before JS sees them, leaving the cookie store empty after a
// successful sign-in. The backend `bearer` plugin echoes the session
// token back as `set-auth-token`, which we capture here and replay as
// `Authorization: Bearer <token>` on subsequent requests.
const TOKEN_KEY = "vibecode_bearer_token";

function readToken(): string | null {
  try {
    const v = SecureStore.getItem(TOKEN_KEY);
    if (__DEV__) console.log('[auth] readToken', v ? `present (len=${v.length})` : 'null');
    return v;
  } catch (e) {
    if (__DEV__) console.log('[auth] readToken threw', e);
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) {
      if (__DEV__) console.log('[auth] writeToken: storing token len=', token.length);
      SecureStore.setItem(TOKEN_KEY, token);
    } else {
      if (__DEV__) console.log('[auth] writeToken: clearing');
      void SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    }
  } catch (e) {
    if (__DEV__) console.log('[auth] writeToken threw', e);
  }
}

export const setBearerToken = (token: string | null) => writeToken(token);
export const getBearerToken = () => readToken();

export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_BACKEND_URL! as string,
  fetchOptions: {
    onRequest: (context) => {
      const token = readToken();
      const url = context.url?.toString() ?? '';
      if (token && !context.headers.has("authorization")) {
        context.headers.set("authorization", `Bearer ${token}`);
        if (__DEV__) console.log('[auth] onRequest', url, 'sending Bearer');
      } else if (__DEV__) {
        console.log('[auth] onRequest', url, 'no token');
      }
      return context;
    },
    onSuccess: (context) => {
      const url = context.request?.url?.toString() ?? "";
      const setAuthToken = context.response.headers.get("set-auth-token");
      if (__DEV__) {
        const headerNames: string[] = [];
        context.response.headers.forEach((_v, k) => headerNames.push(k));
        console.log('[auth] onSuccess', url, 'status', context.response.status, 'set-auth-token?', !!setAuthToken, 'headers:', headerNames.join(','));
      }
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
      storage: SecureStore,
    }),
    emailOTPClient(),
  ],
});
