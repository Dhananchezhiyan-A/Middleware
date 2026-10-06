"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, refreshAccessToken, setAccessToken, setUnauthenticatedHandler } from "@/lib/api";
import type { LoginResult, MeResult, SessionUser } from "@/lib/types";

/**
 * Client-side auth store.
 *
 * Access token lives in the API module (memory only, never localStorage /
 * sessionStorage). On boot we POST /auth/refresh — the httpOnly cookie carries
 * the refresh token — and then hydrate the user via GET /auth/me.
 */

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface LoginInput {
  email: string;
  password: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * UX-only permission check. The API enforces every permission server-side;
   * hiding a button is never a security control.
   */
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toSessionUser(me: MeResult, fallback?: SessionUser | null): SessionUser {
  return {
    id: me.user.id,
    email: me.user.email,
    name: me.user.name ?? fallback?.name ?? "",
    role: me.user.role,
    permissions: me.user.permissions ?? [],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);

  // A refresh failure anywhere in the app pushes us back to /login.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setUser(null);
      setStatus("unauthenticated");
    });
    return () => setUnauthenticatedHandler(null);
  }, []);

  // Bootstrap: refresh (single-flight) → /auth/me.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const refreshed = await refreshAccessToken();
      if (cancelled) return;
      if (!refreshed) {
        setStatus("unauthenticated");
        return;
      }
      try {
        const me = await api.get<MeResult>("/auth/me");
        if (cancelled) return;
        setUser(toSessionUser(me));
        setStatus("authenticated");
      } catch {
        if (cancelled) return;
        setUser(null);
        setStatus("unauthenticated");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const payload: LoginInput = {
      email: input.email,
      password: input.password,
    };
    const result = await api.post<LoginResult>("/auth/login", payload, {
      auth: false,
      retryOn401: false,
    });
    setAccessToken(result.accessToken);
    try {
      const me = await api.get<MeResult>("/auth/me");
      setUser(toSessionUser(me, result.user));
    } catch {
      // /auth/me unavailable — fall back to the login payload (same token).
      setUser(result.user);
    }
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", {}, { auth: false, retryOn401: false });
    } catch {
      // Best effort — local state is cleared regardless.
    }
    setAccessToken(null);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const can = useCallback(
    (permission: string) => user?.permissions.includes(permission) ?? false,
    [user],
  );

  const value = useMemo(
    () => ({ status, user, login, logout, can }),
    [status, user, login, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** Convenience permission hook — UX only; the API enforces server-side. */
export function useCan(permission: string): boolean {
  const { can } = useAuth();
  return can(permission);
}
