// REST API client wrapper for backend calls (auth, programs, sessions).
// Base URL is relative ("/api/v1/...") so it works same-origin in production
// (backend serves the built frontend, per deployment-architecture.md §1) and
// via the Vite dev-server proxy in development (see vite.config.ts).

import type {
  ExerciseLibraryItem,
  ExerciseLibraryDifficulty,
  ExerciseTrackingType,
  ExerciseBaseCriteria,
  PatientProgressTrend,
  TherapistPatientSummary,
  TherapistSessionLogEntry,
  WeeklySessionPoint
} from "../types";

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
  role: "therapist" | "admin" | "patient";
  // For Therapist/Admin, a chosen login username. For Patient, the login
  // identifier is the phone number itself (same convention as `register()`'s
  // RegisterPayload above) — send the phone number in this field.
  username: string;
  password: string;
  // Mirrors users.first_name/last_name on schema.prisma — required, replacing
  // the old single `displayName` field (which had no matching column; the
  // display name is now derived server-side from these, see CreatedUser below).
  firstName: string;
  lastName: string;
  // Optional, mirrors users.email/phone_number. Therapist/Admin only — not
  // used for Patient (whose contact phone IS `username` above).
  email?: string;
  phoneNumber?: string;
  // Patient-only, mirrors patients.gender/date_of_birth/height_cm/weight_kg.
  // Ignored by the backend for Therapist/Admin roles.
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string;
  heightCm?: number;
  weightKg?: number;
}

export interface CreatedUser {
  id: string;
  role: "therapist" | "admin" | "patient";
  username: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  // Patient-only — absent for Therapist/Admin accounts.
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
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

// GET /users (Admin-only account list, FR-USR-02) — backed by
// modules/user-management/*'s new `listUsers()`. Replaces
// AdminUserManagementPage.tsx's former data/adminMock.ts `adminUsers` seed
// list — see that page's header comment.
export interface AdminUserListItem {
  id: string;
  role: "patient" | "therapist" | "admin";
  username: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  status: "active" | "disabled";
  lastLoginLabel: string;
  email: string | null;
  phoneNumber: string | null;
  // Therapist-only.
  licenseNumber?: string | null;
  licenseIssuedLabel?: string | null;
  licenseExpiryLabel?: string | null;
  patientCount?: number;
  // Admin-only.
  employeeId?: string | null;
  // Patient-only.
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirthLabel?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
}

export function getUsers(token: string): Promise<{ users: AdminUserListItem[] }> {
  return apiRequest<{ users: AdminUserListItem[] }>("/users", {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export { apiRequest };

// --- Therapist dashboard (frontend-design.md §4/§5) ---
// Backed by modules/therapist/* on the backend — see
// docs/04-design/api-design.md's "Dashboard & Reporting" section
// (GET /therapists/:id/patients, GET /therapists/:id/dashboard,
// GET /patients/:id/report). Response shapes are kept field-for-field
// compatible with types/index.ts's TherapistPatientSummary/WeeklySessionPoint/
// PatientProgressTrend so the page barely needs to touch its render code —
// only its data source changes from data/therapistMock.ts to these calls.

export interface TherapistDashboardStats {
  activePatients: number;
  sessionsToday: number;
  avgCompliancePercent: number;
  pendingReviews: number;
}

export interface TherapistDashboardData {
  stats: TherapistDashboardStats;
  weeklySessions: WeeklySessionPoint[];
  patients: TherapistPatientSummary[];
}

export function getTherapistDashboard(token: string, therapistId: string): Promise<TherapistDashboardData> {
  return apiRequest<TherapistDashboardData>(`/therapists/${therapistId}/dashboard`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function getTherapistPatients(
  token: string,
  therapistId: string
): Promise<{ patients: TherapistPatientSummary[] }> {
  return apiRequest<{ patients: TherapistPatientSummary[] }>(`/therapists/${therapistId}/patients`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function getPatientProgressTrend(token: string, patientId: string): Promise<PatientProgressTrend> {
  return apiRequest<PatientProgressTrend>(`/patients/${patientId}/report`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// --- Exercise Library (frontend-design.md §6, revised per
// UI_MOCKUP_PLAN_NEWDB.md §2.5) ---
// Backed by modules/exercise-program-library/* on the backend — replaces the
// former data/exerciseLibraryMock.ts import (exerciseLibrary). See that
// module's exercise.service.ts for the documented schema gaps (no nameTh, no
// file-upload backend so hasDemoVideo never persists as true, and the
// parentExerciseId "points at the family root" convention). One route,
// PATCH /exercises/:id, isn't in docs/04-design/api-design.md at all — it was
// added there to support editing a still-draft exercise in place, which this
// page's UI already assumed was possible.

export interface ExerciseInputPayload {
  name: string;
  description: string;
  movementTracking: ExerciseTrackingType;
  difficultyLevel: ExerciseLibraryDifficulty;
  baseCriteria: ExerciseBaseCriteria;
}

export function getExerciseLibrary(token: string): Promise<{ exercises: ExerciseLibraryItem[] }> {
  return apiRequest<{ exercises: ExerciseLibraryItem[] }>("/exercises", {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function createExercise(
  token: string,
  payload: ExerciseInputPayload
): Promise<{ exercise: ExerciseLibraryItem }> {
  return apiRequest<{ exercise: ExerciseLibraryItem }>("/exercises", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// Edits a still-draft exercise's fields in place (no version bump). Backend
// returns 409 (surfaced as ApiError) if the target isn't a draft anymore.
export function updateExerciseDraft(
  token: string,
  exerciseId: string,
  payload: ExerciseInputPayload
): Promise<{ exercise: ExerciseLibraryItem }> {
  return apiRequest<{ exercise: ExerciseLibraryItem }>(`/exercises/${exerciseId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// Bumps an active exercise to a new draft version (BR-6) — the prior active
// row is archived server-side in the same transaction.
export function createExerciseVersion(
  token: string,
  exerciseId: string,
  payload: ExerciseInputPayload
): Promise<{ exercise: ExerciseLibraryItem }> {
  return apiRequest<{ exercise: ExerciseLibraryItem }>(`/exercises/${exerciseId}/versions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function archiveExercise(token: string, exerciseId: string): Promise<{ exercise: ExerciseLibraryItem }> {
  return apiRequest<{ exercise: ExerciseLibraryItem }>(`/exercises/${exerciseId}/archive`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` }
  });
}

// --- Self profile (Settings pages, FR-USR-04) ---
// Backed by modules/user-management/*'s new GET/PATCH /users/:id — see that
// module's user.service.ts for the schema gaps this works around (no
// `address`/job-title columns on `users`/`therapists`, so those fields were
// dropped from TherapistSettingsPage.tsx's form entirely rather than kept as
// dead inputs).

export interface UserProfile {
  id: string;
  role: "patient" | "therapist" | "admin";
  username: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  createdAtLabel: string;
  // Therapist-only — absent for patient/admin callers.
  licenseNumber?: string | null;
  licenseIssuedDate?: string | null;
  licenseExpiryDate?: string | null;
  // Patient-only — absent for therapist/admin callers. Populated for Admin's
  // Patient-edit flow (AdminUserManagementPage.tsx's EditAccountModal).
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
}

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  licenseNumber?: string;
  licenseIssuedDate?: string;
  licenseExpiryDate?: string;
  // Patient-only — Admin editing a Patient account. `username` doubles as the
  // patient's login phone number, same convention as CreateUserPayload's
  // Patient branch above.
  username?: string;
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string;
  heightCm?: number;
  weightKg?: number;
}

export function getUserProfile(token: string, userId: string): Promise<{ user: UserProfile }> {
  return apiRequest<{ user: UserProfile }>(`/users/${userId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function updateUserProfile(
  token: string,
  userId: string,
  payload: UpdateProfilePayload
): Promise<{ user: UserProfile }> {
  return apiRequest<{ user: UserProfile }>(`/users/${userId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// --- Therapist Sessions (sidebar "Sessions" page) ---
// Backed by modules/session-results/* on the backend — GET /therapists/:id/sessions,
// an endpoint not in docs/04-design/api-design.md (which only documents the
// per-patient GET /patients/:id/sessions). Replaces the former
// data/therapistSessionsMock.ts import (therapistSessionLog). See
// session.service.ts for the "session = one rehabilitation_schedule_days row"
// convention and the evaluationSource ai/pt/manual -> ai/pt_reviewed mapping.

export function getTherapistSessions(
  token: string,
  therapistId: string
): Promise<{ sessions: TherapistSessionLogEntry[] }> {
  return apiRequest<{ sessions: TherapistSessionLogEntry[] }>(`/therapists/${therapistId}/sessions`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// --- Patient today ----------------------------------------------------------

export interface PatientTodayExercise {
  id: string;
  exerciseLibraryId: string;
  exerciseName: string;
  versionLabel: string;
  movementTracking: ExerciseTrackingType;
  difficultyLevel: ExerciseLibraryDifficulty;
  targetValueLabel: string;
  therapistInstruction: string | null;
  status: "pending" | "in_progress" | "completed" | "skipped" | "cancelled";
}

export interface PatientTodayData {
  patient: { id: string; displayName: string; avatarInitials: string };
  scheduleDay: {
    id: string;
    scheduledDate: string;
    status: "pending" | "in_progress" | "completed" | "skipped" | "cancelled";
    dayNumber: number;
    streak: number;
    therapistNote: string | null;
    plan: { id: string; name: string; totalDays: number; scheduleDates: string[] };
    exercises: PatientTodayExercise[];
  } | null;
  stats: { averageScore: number | null; completedSessions: number };
}

export function getPatientToday(token: string, patientId: string): Promise<PatientTodayData> {
  return apiRequest<PatientTodayData>(`/patients/${patientId}/today`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export interface PatientScheduledExerciseInstruction {
  id: string;
  exerciseLibraryId: string;
  targetType: "repetitions" | "duration" | "sets" | "distance" | "free";
  targetValue: unknown;
  therapistInstruction: string | null;
  exercise: {
    id: string;
    name: string;
    description: string | null;
    difficultyLevel: ExerciseLibraryDifficulty;
    movementTracking: ExerciseTrackingType;
    demoVideoFileId: string | null;
  };
}

export function getPatientScheduledExerciseInstruction(
  token: string,
  scheduledExerciseId: string
): Promise<{ scheduledExercise: PatientScheduledExerciseInstruction }> {
  return apiRequest<{ scheduledExercise: PatientScheduledExerciseInstruction }>(`/scheduled-exercises/${scheduledExerciseId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function getPatientScheduledExerciseDemoVideo(token: string, scheduledExerciseId: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/scheduled-exercises/${scheduledExerciseId}/demo-video`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(response.status, body?.error?.message ?? `Request failed (${response.status})`, body?.error?.code);
  }
  return response.blob();
}

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

// --- Admin dashboard (frontend-design.md §8) ---
// Backed by modules/admin/* on the backend — GET /admin/dashboard
// (docs/04-design/api-design.md's "Dashboard & Reporting" section, FR-DASH-03).
// Replaces AdminDashboardPage.tsx's mock stats/weekly-activity/role-distribution
// (data/adminMock.ts's adminUsers/weeklyActivityData/roleDistributionData) —
// System logs stays mock (no audit-log table exists in the schema at all; see
// admin.service.ts's header comment), and the User Management page/staff list
// is untouched (still fully mock — no GET /users list endpoint exists yet).

export interface AdminDashboardStats {
  totalPatients: number;
  activePatients: number;
  totalTherapists: number;
  activeTherapists: number;
  sessionsToday: number;
}

export interface AdminWeeklyActivityPoint {
  day: string;
  sessions: number;
  aiCalls: number;
}

export interface AdminRoleCount {
  role: "patient" | "therapist" | "admin";
  count: number;
}

export interface AdminDashboardData {
  stats: AdminDashboardStats;
  weeklyActivity: AdminWeeklyActivityPoint[];
  roleDistribution: AdminRoleCount[];
}

export function getAdminDashboard(token: string): Promise<AdminDashboardData> {
  return apiRequest<AdminDashboardData>("/admin/dashboard", {
    headers: { Authorization: `Bearer ${token}` }
  });
}
