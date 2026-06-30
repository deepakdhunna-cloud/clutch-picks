import { fetch } from "expo/fetch";
import { getAuthHeaders } from "../auth/auth-client";
import { definedApiResult, unwrapApiResponse } from "./response";

// Normalize the backend base URL: strip any trailing slash(es) so that
// `${baseUrl}${path}` (where path starts with "/") can never produce a
// double slash like "https://host//api/games", which Hono treats as a
// different route and returns 404 for. This makes the join robust regardless
// of how EXPO_PUBLIC_BACKEND_URL is formatted in the build environment.
const baseUrl = (process.env.EXPO_PUBLIC_BACKEND_URL ?? "").replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 20000;

// Deduplicates concurrent GET requests to the same URL. Each entry is stamped
// with the time it was created so a hung/never-settling promise can NEVER
// permanently block future requests: if an entry is older than the request
// timeout, it is treated as dead and a fresh request is issued. A naive
// implementation that only deletes entries in `.finally()` would let a single
// stuck fetch pin a dead promise so every later `api.get(sameUrl)` awaits it
// forever — the "fetch never completes / board stuck" failure mode.
type InflightEntry = { promise: Promise<any>; createdAt: number };
const inflightRequests = new Map<string, InflightEntry>();

const apiErrorMessage = (json: any, status: number) => {
  if (typeof json?.error === "string") return json.error;
  if (typeof json?.error?.message === "string") return json.error.message;
  if (typeof json?.message === "string") return json.message;
  return `Request failed with status ${status}`;
};

const request = async <T>(
  url: string,
  options: { method?: string; body?: string } = {}
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${baseUrl}${url}`, {
      ...options,
      credentials: "include",
      // NOTE: We intentionally do NOT set `Accept-Encoding`. It is a
      // forbidden/managed request header — the native networking layer sets and
      // negotiates compression itself (the server gzip-compresses, so the
      // device receives ~250KB, not the 2.6MB uncompressed body). Setting it
      // manually in expo/fetch can cause the request to be rejected or
      // mishandled, producing a fetch that never resolves on device.
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...getAuthHeaders(),
      },
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      throw new Error("Request timed out. Please check your connection.");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  // 1. Handle 204 No Content
  if (response.status === 204) {
    return null as T;
  }

  // 2. JSON responses: parse and unwrap { data }
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const json = await response.json();

    if (!response.ok) {
      throw new Error(apiErrorMessage(json, response.status));
    }

    return definedApiResult(unwrapApiResponse<T>(json)) as T;
  }

  // 3. Non-OK non-JSON: throw
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  // 4. Non-JSON OK responses have no useful payload. Return null so React
  // Query never receives undefined from a query function.
  return null as T;
};

export const api = {
  get: <T>(url: string): Promise<T> => {
    const existing = inflightRequests.get(url);
    // Reuse an in-flight promise ONLY if it is recent. A stale entry (older than
    // the request timeout) means the previous request hung; drop it and start a
    // fresh one so a single stuck fetch can never permanently block this URL.
    if (existing && Date.now() - existing.createdAt < REQUEST_TIMEOUT_MS + 2000) {
      return existing.promise as Promise<T>;
    }
    const promise = request<T>(url).finally(() => {
      // Only delete if this exact promise is still the registered one (avoid
      // deleting a newer entry that replaced a stale one).
      const cur = inflightRequests.get(url);
      if (cur && cur.promise === promise) inflightRequests.delete(url);
    });
    inflightRequests.set(url, { promise, createdAt: Date.now() });
    return promise;
  },
  post: <T>(url: string, body: any) =>
    request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(url: string, body: any) =>
    request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  patch: <T>(url: string, body: any) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
};
