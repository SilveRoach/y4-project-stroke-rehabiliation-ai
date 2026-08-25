// REST API client wrapper for backend calls (auth, programs, sessions).
// Base URL is relative ("/api/v1/...") so it works same-origin in production
// (backend serves the built frontend, per deployment-architecture.md §1) and
// via the Vite dev-server proxy in development (see vite.config.ts).

const BASE_URL = "/api/v1";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  } catch {
    // Network failure (server unreachable, CORS, DNS, etc.) — no HTTP response at all.
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    const message = errorBody?.error?.message ?? `Request failed (${response.status})`;
    throw new ApiError(response.status, message, errorBody?.error?.code);
  }

  return body as T;
}

export interface AuthUser {
  id: string;
  role: "patient" | "therapist" | "admin";
  phoneNumber?: string;
  username?: string;
  displayName?: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface LoginPayload {
  identifier: string; // phone number or username, per login-register.html mockup
  password: string;
}

export interface RegisterPayload {
  phoneNumber: string;
  password: string;
}

export function login(payload: LoginPayload): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function register(payload: RegisterPayload): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function logout(token: string): Promise<void> {
  return apiRequest<void>("/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export interface CreateUserPayload {
  role: "therapist" | "admin";
  username: string;
  password: string;
  displayName: string;
}

export interface CreatedUser {
  id: string;
  role: "therapist" | "admin";
  username: string;
  displayName: string;
}

// Admin-only (FR-AUTH-01c/FR-USR-02) — requires the admin's own bearer token, unlike
// login/register which are public.
export function createUser(token: string, payload: CreateUserPayload): Promise<{ user: CreatedUser }> {
  return apiRequest<{ user: CreatedUser }>("/users", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export { apiRequest };

// --- System health (Admin Dashboard §8) ---
// GET /health and /health/db are mounted at the app root in app.ts, not under
// /api/v1, so this bypasses apiRequest's BASE_URL and hits them directly. Unlike
// the rest of this file, a failed fetch here is a normal, expected "server is down"
// result, not an exceptional error — so this resolves to a status object instead of
// throwing.
export interface HealthStatus {
  server: "ok" | "unreachable";
  database: "ok" | "unreachable" | "unknown";
}

export async function checkHealth(): Promise<HealthStatus> {
  let server: HealthStatus["server"] = "unreachable";
  let database: HealthStatus["database"] = "unknown";

  try {
    const res = await fetch("/health");
    server = res.ok ? "ok" : "unreachable";
  } catch {
    server = "unreachable";
  }

  try {
    const res = await fetch("/health/db");
    database = res.ok ? "ok" : "unreachable";
  } catch {
    database = "unreachable";
  }

  return { server, database };
}
