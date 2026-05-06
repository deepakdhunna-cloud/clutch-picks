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
    return SecureStore.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) {
      SecureStore.setItem(TOKEN_KEY, token);
    } else {
      // deleteItemAsync is the only delete API; fire and forget.
      void SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

export const setBearerToken = (token: string | null) => writeToken(token);
export const getBearerToken = () => readToken();

export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_BACKEND_URL! as string,
  fetchOptions: {
    onRequest: (context) => {
      const token = readToken();
      if (token && !context.headers.has("authorization")) {
        context.headers.set("authorization", `Bearer ${token}`);
      }
      return context;
    },
    onSuccess: (context) => {
      const setAuthToken = context.response.headers.get("set-auth-token");
      if (setAuthToken) {
        writeToken(setAuthToken);
      }
      const url = context.request?.url?.toString() ?? "";
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
