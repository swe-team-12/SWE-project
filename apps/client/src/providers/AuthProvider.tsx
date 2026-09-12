import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { apiFetch, bootstrapSession, setAccessToken } from "@/lib/api";
import { getRefreshToken, setRefreshToken } from "@/lib/session-storage";
import type { AuthTokens, User } from "@/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bootstrapSession()
      .then((tokens) => setUser(tokens?.user ?? null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiFetch<AuthTokens>("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        device_name: "BiletFlow universal app",
      }),
      skipRefresh: true,
    });
    setAccessToken(result.access_token);
    await setRefreshToken(result.refresh_token);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = await getRefreshToken();
    try {
      await apiFetch<void>("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
        skipRefresh: true,
      });
    } finally {
      setAccessToken(null);
      await setRefreshToken();
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await apiFetch<User>("/auth/me"));
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser }),
    [user, loading, login, logout, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
