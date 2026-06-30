import { fetch } from "expo/fetch";
import { getAuthHeaders } from "../auth/auth-client";
import { definedApiResult, unwrapApiResponse } from "./response";
import { recordGamesProbe } from "../debug-net-probe";

// Normalize the backend base URL: strip any trailing slash(es) so that
// `${baseUrl}${path}` (where path starts with "/") can never produce a
// double slash like "https://host//api/games", which Hono treats as a
// different route and returns 404 for. This makes the join robust regardless
// of how EXPO_PUBLIC_BACKEND_URL is formatted in the build environment.
const baseUrl = (process.env.EXPO_PUBLIC_BACKEND_URL ?? "").replace(/\/+$/, "");

// Deduplicates concurrent GET requests to the same URL
const inflightRequests = new Map<string, Promise<any>>();

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
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  // No per-request cache-buster: a unique URL per call defeats the backend's
  // short shared cache (s-maxage) and forced uncached re-assembly, which is what
  // pushed /api/games to 15-35s. The backend now serves a perpetually-warm
  // snapshot with a 5s shared cache, and we send `Cache-Control: no-cache` so
  // the device revalidates rather than reusing a stored body. Stale-day boards
  // are prevented by the day-stamped persisted client cache + revalidate-on-mount.
  const isGet = !options.method || options.method.toUpperCase() === "GET";
  const requestUrl = url;

  const startedAt = Date.now();
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${baseUrl}${requestUrl}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        "Cache-Control": "no-cache",
        // Explicitly request gzip. The home board is ~2.6MB uncompressed but
        // ~250KB gzipped; without this header expo/fetch was downloading the
        // full uncompressed body over LTE, which was slow enough to hit the
        // 25s client timeout and feel broken. RN decodes gzip natively.
        "Accept-Encoding": "gzip, deflate",
        ...getAuthHeaders(),
      },
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    // TEMP diagnostic: record a failed home-games network attempt so the
    // on-device overlay can distinguish "fetch never ran" from "fetch errored".
    if (isGet && url.startsWith("/api/games") && !url.includes("/api/games/")) {
      recordGamesProbe({
        url: `${baseUrl}${requestUrl}`,
        status: -1,
        rawCount: 0,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        error: err?.name === "AbortError" ? "timeout/abort" : String(err?.message ?? err),
      });
    }
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

    // Handle error responses from the API
    if (!response.ok) {
      throw new Error(apiErrorMessage(json, response.status));
    }

    const unwrapped = definedApiResult(unwrapApiResponse<T>(json));

    // TEMP diagnostic: record the raw home-games network result so the
    // on-device overlay can show the unprocessed truth (count + sample row).
    if (url.startsWith("/api/games") && !url.includes("/api/games/")) {
      const arr = Array.isArray(unwrapped) ? (unwrapped as any[]) : [];
      const first = arr[0] as any;
      recordGamesProbe({
        url: `${baseUrl}${requestUrl}`,
        status: response.status,
        rawCount: arr.length,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        encoding: response.headers.get("content-encoding") ?? "(none)",
        sample: first ? { id: String(first.id), sport: String(first.sport), gameTime: String(first.gameTime) } : undefined,
      });
    }

    return unwrapped as T;
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
    if (existing) return existing as Promise<T>;
    const promise = request<T>(url).finally(() => {
      inflightRequests.delete(url);
    });
    inflightRequests.set(url, promise);
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
