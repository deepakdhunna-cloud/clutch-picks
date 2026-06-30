import { fetch } from "expo/fetch";
import { getAuthHeaders } from "../auth/auth-client";
import { definedApiResult, unwrapApiResponse } from "./response";

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

// IMPORTANT: This sets the cookies/auth token in the headers
const request = async <T>(
  url: string,
  options: { method?: string; body?: string } = {}
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${baseUrl}${url}`, {
      ...options,
      credentials: "include",
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

    // Handle error responses from the API
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
