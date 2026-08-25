import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import {
  ApiError,
  AuthUser,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister
} from "../services/api";

type AuthStatus = "idle" | "loading" | "authenticated" | "error";

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  status: AuthStatus;
  error: string | null;
  login: (identifier: string, password: string) => Promise<AuthUser | null>;
  register: (phoneNumber: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "stroke-rehab.auth.token";
const USER_KEY = "stroke-rehab.auth.user";

function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(() => loadStoredUser());
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const persist = (nextToken: string, nextUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  };

  const clearPersisted = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  const login = useCallback(async (identifier: string, password: string) => {
    setStatus("loading");
    setError(null);
    try {
      const result = await apiLogin({ identifier, password });
      persist(result.token, result.user);
      setStatus("authenticated");
      return result.user;
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      return null;
    }
  }, []);

  const register = useCallback(async (phoneNumber: string, password: string) => {
    setStatus("loading");
    setError(null);
    try {
      const result = await apiRegister({ phoneNumber, password });
      persist(result.token, result.user);
      setStatus("authenticated");
      return true;
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    if (token) {
      // Best-effort — don't block local logout on the network call.
      apiLogout(token).catch(() => undefined);
    }
    clearPersisted();
    setStatus("idle");
    setError(null);
  }, [token]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthState>(
    () => ({ user, token, status, error, login, register, logout, clearError }),
    [user, token, status, error, login, register, logout, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
