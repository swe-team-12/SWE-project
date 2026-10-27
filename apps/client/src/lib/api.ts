import type { AuthTokens, Problem } from "@/types";
import { apiErrorText } from "./apiErrorText";
import { getRefreshToken, setRefreshToken } from "./session-storage";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8010/api/v1";
export const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL ?? "ws://localhost:8010/api/v1";

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(public problem: Problem) {
    super(problem.detail);
    // Resolve the message on read so known problem codes follow the active
    // UI language; unknown codes keep the server-provided detail.
    Object.defineProperty(this, "message", {
      configurable: true,
      enumerable: false,
      get: () => apiErrorText(problem),
    });
  }
}

export function setAccessToken(value: string | null) {
  accessToken = value;
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) {
      setAccessToken(null);
      await setRefreshToken();
      return false;
    }
    const tokens = (await response.json()) as AuthTokens;
    setAccessToken(tokens.access_token);
    await setRefreshToken(tokens.refresh_token);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

type ApiRequestOptions = RequestInit & { skipRefresh?: boolean };

/**
 * Sends an authenticated request, refreshing the access token and retrying
 * once on 401, and throws an ApiError carrying the server's problem detail
 * for any non-OK response.
 */
async function apiRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const { skipRefresh, ...init } = options;
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 401 && !skipRefresh && !path.startsWith("/auth/")) {
    if (await refreshAccessToken())
      return apiRequest(path, { ...options, skipRefresh: true });
  }
  if (!response.ok) {
    let problem: Problem;
    try {
      problem = (await response.json()) as Problem;
    } catch {
      problem = {
        title: "Request failed",
        status: response.status,
        code: "network_error",
        detail: `Request failed with status ${response.status}.`,
      };
    }
    throw new ApiError(problem);
  }
  return response;
}

export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const response = await apiRequest(path, options);
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  return (
    type.includes("application/json") ? response.json() : response.blob()
  ) as Promise<T>;
}

/** Fetches a binary resource (PDF, CSV, ICS...) with the same auth handling. */
export async function apiFetchBlob(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Blob> {
  const response = await apiRequest(path, options);
  return response.blob();
}

export async function bootstrapSession(): Promise<AuthTokens | null> {
  const token = await getRefreshToken();
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ refresh_token: token }),
    });
    if (!response.ok) return null;
    const result = (await response.json()) as AuthTokens;
    setAccessToken(result.access_token);
    await setRefreshToken(result.refresh_token);
    return result;
  } catch {
    return null;
  }
}

export function currentAccessToken(): string | null {
  return accessToken;
}
