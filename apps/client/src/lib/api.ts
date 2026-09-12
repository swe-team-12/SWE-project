import type { AuthTokens, Problem } from "@/types";
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

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipRefresh?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (
    response.status === 401 &&
    !options.skipRefresh &&
    !path.startsWith("/auth/")
  ) {
    if (await refreshAccessToken())
      return apiFetch<T>(path, { ...options, skipRefresh: true });
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
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  return (
    type.includes("application/json") ? response.json() : response.blob()
  ) as Promise<T>;
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
