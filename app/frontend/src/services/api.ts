// REST API client wrapper for backend calls (auth, programs, sessions).
// Base URL is relative ("/api/v1/...") so it works same-origin in production
// (backend serves the built frontend, per deployment-architecture.md §1) and
// via the Vite dev-server proxy in development (see vite.config.ts).

import type {
  ExerciseLibraryItem,
  ExerciseLibraryDifficulty,
  ExerciseTrackingType,
  ExerciseBaseCriteria,
  HandTrackingGameType,
  PatientProgressTrend,
  TherapistPatientSummary,
  TherapistSessionLogEntry,
  TherapistExerciseSessionEntry,
  WeeklySessionPoint
} from "../types";
import type { FrameFeature, PoseReferencePublic, PoseRepScoringResult } from "../ai/poseScoring/poseScoringTypes";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/+$/, "");

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
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
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
  // users.profile_picture_file_id — present for therapist/admin logins; lets
  // the sidebar/topbar avatars show the logged-in user's uploaded picture.
  profilePictureFileId?: string | null;
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

export function changeUserPassword(
  token: string,
  payload: { currentPassword: string; newPassword: string }
): Promise<void> {
  return apiRequest<void>("/auth/change-password", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
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
  // users.profile_picture_file_id (files-row id) — powers the account table's
  // profile-picture avatar on AdminUserManagementPage (initials fallback).
  profilePictureFileId?: string | null;
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
  // Patient-only: the therapist from the patient's ACTIVE
  // patient_therapist_assignments row (null when unassigned). Powers the
  // assign/unassign therapist UI on AdminUserManagementPage.
  assignedTherapist?: { id: string; displayName: string; licenseNumber?: string | null } | null;
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

export interface AllPatientListItem {
  id: string;
  name: string;
  displayName: string;
  username: string;
  age: number;
  condition: string;
  lastSessionLabel: string;
  sessionsCompleted: number;
  avatarInitials: string;
  // files-row id of the patient's uploaded profile picture — resolved to a
  // blob URL via useProfilePicture (auth'd GET /files/:id/content); when null
  // or unresolvable the initials badge renders instead.
  profilePictureFileId?: string | null;
  progressPercent: number;
  compliancePercent: number;
  standing: "active" | "at_risk";
  summary: string;
  phoneNumber?: string | null;
  status: "active" | "inactive" | "suspended";
  assignedTherapistId?: string | null;
  assignedTherapistName?: string | null;
}

export function getAllPatients(token: string, query?: string): Promise<{ patients: AllPatientListItem[] }> {
  const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
  return apiRequest<{ patients: AllPatientListItem[] }>(`/patients${suffix}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function getPatientProgressTrend(token: string, patientId: string): Promise<PatientProgressTrend> {
  return apiRequest<PatientProgressTrend>(`/patients/${patientId}/report`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// --- Patient search / assignment ------------------------------------------------
export interface PatientListItem {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  profilePictureFileId?: string | null;
  status: "active" | "inactive" | "suspended";
  assignedTherapistId?: string | null;
  assignedTherapistName?: string | null;
}

export function searchPatients(token: string, query?: string): Promise<{ patients: PatientListItem[] }> {
  const qs = query && query.trim().length > 0 ? `?q=${encodeURIComponent(query.trim())}` : "";
  return apiRequest<{ patients: PatientListItem[] }>(`/patients${qs}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function assignPatient(
  token: string,
  therapistId: string,
  patientId: string
): Promise<{ patient: TherapistPatientSummary }> {
  return apiRequest<{ patient: TherapistPatientSummary }>(`/therapists/${therapistId}/patients`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ patientId })
  });
}

// DELETE /therapists/:id/patients/:patientId — ends the patient's ACTIVE
// assignment (status → 'ended' + ended_at/ended_by). Authorization matches
// assign: the owning therapist may self-unassign, an admin may unassign anyone.
// Used by AdminUserManagementPage's unassign button.
export function unassignPatient(
  token: string,
  therapistId: string,
  patientId: string
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/therapists/${therapistId}/patients/${patientId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}

// --- Exercise Library (frontend-design.md §6, revised per
// UI_MOCKUP_PLAN_NEWDB.md §2.5) ---
// Backed by modules/exercise-program-library/* on the backend — replaces the
// former data/exerciseLibraryMock.ts import (exerciseLibrary). See that
// module's exercise.service.ts for the documented schema gaps (no nameTh and
// the parentExerciseId "points at the family root" convention). One route,
// PATCH /exercises/:id, isn't in docs/04-design/api-design.md at all — it was
// added there to support editing a still-draft exercise in place, which this
// page's UI already assumed was possible.

export interface ExerciseInputPayload {
  name: string;
  description: string;
  movementTracking: ExerciseTrackingType;
  difficultyLevel: ExerciseLibraryDifficulty;
  baseCriteria: ExerciseBaseCriteria;
  demoVideoFileId?: string | null;
}

export interface UploadedFile {
  id: string;
  fileType: "image" | "video" | "document" | "audio" | "other";
  originalName: string;
  storedName: string;
  mimeType: string | null;
  fileSize: number | null;
  storagePath: string;
  uploadedBy: string | null;
  createdAt: string;
}

export function uploadFile(token: string, file: File): Promise<{ file: UploadedFile }> {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<{ file: UploadedFile }>("/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body
  });
}

// PATCH /performance-results/:id/scoring — save therapist evaluation fields or
// independently select the AI/therapist grading score for one recorded attempt.
export function updateAttemptScoring(
  token: string,
  resultId: string,
  payload: {
    ptScore?: number | null;
    ptFeedback?: string | null;
    evaluationSource?: "ai" | "pt" | "manual";
  }
): Promise<{ attempt: {
    id: string;
    attemptNumber: number;
    aiScore: number | null;
    aiFeedback: string | null;
    ptScore: number | null;
    ptFeedback: string | null;
    finalScore: number | null;
    evaluationSource: "ai" | "pt" | "manual" | null;
    currentScore: number | null;
    currentScoreSource: "ai" | "pt" | "manual" | null;
    therapistReviewed: boolean;
    referenceVideoFileId: string | null;
    completedAtIso: string | null;
    aiEvaluatedAtIso: string | null;
    aiMetrics: Array<{ label: string; value: string }> | null;
  } }> {
  return apiRequest(`/performance-results/${resultId}/scoring`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function getFileContent(token: string, fileId: string): Promise<Blob> {
  const response = await fetch(`${BASE_URL}/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    throw new ApiError(response.status, body?.error?.message ?? "The file could not be loaded.", body?.error?.code);
  }
  return response.blob();
}

export async function getFileThumbnail(token: string, fileId: string): Promise<Blob> {
  const response = await fetch(`${BASE_URL}/files/${fileId}/thumbnail`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    throw new ApiError(response.status, body?.error?.message ?? "The video thumbnail could not be loaded.", body?.error?.code);
  }
  return response.blob();
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

// Publish an exercise (makes a draft active). Returns the canonical exercise row.
export function publishExercise(token: string, exerciseId: string): Promise<{ exercise: ExerciseLibraryItem }> {
  return apiRequest<{ exercise: ExerciseLibraryItem }>(`/exercises/${exerciseId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
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
  createdAtIso?: string;
  // Therapist-only — absent for patient/admin callers.
  licenseNumber?: string | null;
  licenseIssuedDate?: string | null;
  licenseExpiryDate?: string | null;
  // Patient-only — absent for therapist/admin callers. Populated for Admin's
  // Patient-edit flow and Patient Settings.
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  // Id of the user's profile-picture `files` row (upload via POST /files,
  // resolve to pixels via GET /files/:fileId/content).
  profilePictureFileId?: string | null;
  assignedTherapist?: {
    id: string;
    displayName: string;
    licenseNumber?: string | null;
  } | null;
}

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  licenseNumber?: string;
  licenseIssuedDate?: string;
  licenseExpiryDate?: string;
  // Patient-only
  username?: string;
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string;
  heightCm?: number;
  weightKg?: number;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  // Assign a previously-uploaded image file (via uploadFile()) as the profile
  // picture; null clears it. The backend validates ownership + file type.
  profilePictureFileId?: string | null;
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
  therapistId: string,
  // Optional narrowing scopes: patientId scopes the log to one assigned
  // patient, planId to one of that patient's plans (PatientDetailPage passes
  // both so its history matches the plan selected in the UI). Both are enforced
  // against the therapist's own assignments on the backend.
  opts: { patientId?: string; planId?: string } = {}
): Promise<{ sessions: TherapistSessionLogEntry[] }> {
  const params = new URLSearchParams();
  if (opts.patientId) params.set("patientId", opts.patientId);
  if (opts.planId) params.set("planId", opts.planId);
  const query = params.toString();
  return apiRequest<{ sessions: TherapistSessionLogEntry[] }>(
    `/therapists/${therapistId}/sessions${query ? `?${query}` : ""}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
}

export function getTherapistExerciseSessions(
  token: string,
  therapistId: string
): Promise<{ sessions: TherapistExerciseSessionEntry[] }> {
  return apiRequest<{ sessions: TherapistExerciseSessionEntry[] }>(
    `/therapists/${therapistId}/sessions?exerciseSessions=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

// --- Patient today ----------------------------------------------------------

export interface PatientTodayExercise {
  id: string;
  exerciseLibraryId: string;
  exerciseName: string;
  description?: string | null;
  versionLabel: string;
  movementTracking: ExerciseTrackingType;
  difficultyLevel: ExerciseLibraryDifficulty;
  targetValueLabel: string;
  therapistInstruction: string | null;
  status: "pending" | "in_progress" | "completed" | "skipped" | "cancelled";
  virtualGripGameType?: HandTrackingGameType;
  baseCriteria?: any;
}

// A single active plan's own "current day" — each active plan computes this
// independently, so a patient with multiple concurrent active plans gets one
// per plan instead of a single cross-plan pick.
export interface PatientTodayPlanDay {
  scheduleDayId: string;
  scheduledDate: string;
  status: "pending" | "in_progress" | "completed" | "skipped" | "cancelled";
  dayNumber: number;
  streak: number;
  therapistNote: string | null;
  exercises: PatientTodayExercise[];
}

export interface PatientTodayPlan {
  id: string;
  name: string;
  totalDays: number;
  scheduleDates: string[];
  // Real per-date day status (rehabilitation_schedule_days.status) for every
  // date in scheduleDates — lets the calendar mark past days actually
  // COMPLETED as completed instead of assuming every past day was missed.
  dateStatuses: Record<string, "pending" | "in_progress" | "completed" | "skipped" | "cancelled">;
  today: PatientTodayPlanDay | null;
}

export interface PatientTodayData {
  patient: { id: string; displayName: string; avatarInitials: string; profilePictureFileId?: string | null };
  todayDate: string;
  activePlans: { id: string; name: string }[];
  plans: PatientTodayPlan[];
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
  targetType: "repetitions" | "duration";
  targetValue: unknown;
  therapistInstruction: string | null;
  exercise: {
    id: string;
    name: string;
    description: string | null;
    difficultyLevel: ExerciseLibraryDifficulty;
    movementTracking: ExerciseTrackingType;
    demoVideoFileId: string | null;
    virtualGripGameType?: HandTrackingGameType;
    baseCriteria?: any;
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

// GET /scheduled-exercises/:id/pose-reference — the pose exercise's
// starting-position/rep criteria (FSM config + angle definitions), used by
// PatientSessionPage for movementTracking=pose exercises. masterSamples (the
// reference skeleton feature sequences) stay server-side — only the scoring
// backend ever sees them. poseReference is null when the exercise library
// row has no poseReference stored (scoring requests will fail with a clear
// error in that case).
export function getPatientScheduledExercisePoseReference(
  token: string,
  scheduledExerciseId: string
): Promise<{ poseReference: PoseReferencePublic | null }> {
  return apiRequest<{ poseReference: PoseReferencePublic | null }>(
    `/scheduled-exercises/${scheduledExerciseId}/pose-reference`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

// POST /scheduled-exercises/:id/pose-rep-score — sends ONE captured
// repetition's skeleton features (not raw video) to the backend, which scores
// it against the exercise's reference using the Rehab-AI scoring pipeline
// (DTW + BVE + K-NN + scoreEngine) and returns score + AI feedback. A rep is
// only counted client-side after this request succeeds.
export function scorePoseRep(
  token: string,
  scheduledExerciseId: string,
  payload: {
    repNumber: number;
    frames: FrameFeature[];
    peakRom: number;
    baseTrunkPoint: { x: number; y: number } | null;
    baseShoulderWidthNorm?: number | null;
    // Optional extras for meanTrunkDrift / peakHandSeparation (callers that
    // omit them get 0 for those signals on the backend).
    baseRawTrunkPoint?: { x: number; y: number } | null;
    baseTrunkLength?: number | null;
    baseWristDistanceNorm?: number | null;
  }
): Promise<{ rep: PoseRepScoringResult }> {
  return apiRequest<{ rep: PoseRepScoringResult }>(`/scheduled-exercises/${scheduledExerciseId}/pose-rep-score`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// POST /exercises/test-pose-rep-score — therapist/admin AI exercise TEST
// scoring (ExerciseAiPage's "Test exercise" button → PatientSessionPage's
// testConfig). Same scoring pipeline as scorePoseRep, but with no patient
// scheduled-exercise context: the reference comes from the request body (the
// therapist's on-screen criteria, possibly unsaved — including the
// masterSamples DTW/K-NN compare against) or, when that copy carries no
// master samples / is omitted, from the exercise_library row named by
// exerciseId. Responds with the same { rep } payload, so a test rep counts
// and scores exactly like a patient's.
export function scoreExerciseTestRep(
  token: string,
  payload: {
    exerciseId?: string;
    poseReference?: PoseReferencePublic | null;
    repNumber: number;
    frames: FrameFeature[];
    peakRom: number;
    baseTrunkPoint: { x: number; y: number } | null;
    baseShoulderWidthNorm?: number | null;
    baseRawTrunkPoint?: { x: number; y: number } | null;
    baseTrunkLength?: number | null;
    baseWristDistanceNorm?: number | null;
  }
): Promise<{ rep: PoseRepScoringResult }> {
  return apiRequest<{ rep: PoseRepScoringResult }>("/exercises/test-pose-rep-score", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}


// §2.7 — real review data for one schedule day (assigned therapist or admin).
// Attempts come newest-first per exercise; referenceVideoFileId is the server
// files-row id of the patient's recorded video (streamed via getFileContent).
export interface ScheduleDayReviewData {
  sessionId: string;
  patientName: string;
  dateLabel: string;
  dayLabel: string;
  planName: string;
  scheduledDateIso: string;
  exercises: Array<{
    id: string;
    scheduledExerciseId: string;
    exerciseName: string;
    exerciseVersionLabel: string;
    description: string | null;
    difficultyLevel: string;
    movementTracking: ExerciseTrackingType;
    baseCriteria: Array<{ label: string; value: string }> | null;
    targetValueLabel: string;
    therapistInstruction: string | null;
    attempts: Array<{
      id: string;
      attemptNumber: number;
      aiScore: number | null;
      aiFeedback: string | null;
      ptScore: number | null;
      ptFeedback: string | null;
      finalScore: number | null;
      evaluationSource: "ai" | "pt" | "manual" | null;
      referenceVideoFileId: string | null;
      completedAtIso: string | null;
      aiEvaluatedAtIso: string | null;
      aiMetrics: Array<{ label: string; value: string }> | null;
      videoIncludesOverlay: boolean;
      currentScore: number | null;
      currentScoreSource: "ai" | "pt" | "manual" | null;
      therapistReviewed: boolean;
    }>;
  }>;
}

export function getScheduleDayReview(
  token: string,
  dayId: string
): Promise<{ review: ScheduleDayReviewData }> {
  return apiRequest<{ review: ScheduleDayReviewData }>(`/schedule-days/${dayId}/results`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// §6.7 — real attempt submission: uploads the recorded video (multipart) and
// creates the exercise_performance_results row server-side, marking the
// scheduled exercise (and its day, once all its exercises are done) completed.
export async function submitExerciseResult(
  token: string,
  scheduledExerciseId: string,
  video: Blob,
  fileName: string,
  mimeType: string,
  payload: {
    aiScore?: number;
    aiFeedback?: string;
    videoIncludesOverlay?: boolean;
    /** label -> value chips (shown in the review page), e.g. { "จำนวนครั้งที่ทำ": "8/10" }. */
    aiMetrics?: Record<string, string>;
    /** Structured per-session numbers: repsCompleted, targetReps, repScores. */
    performanceData?: Record<string, unknown>;
  }
): Promise<{
  result: { id: string; attemptNumber: number; aiScore: number | null; aiFeedback: string | null; referenceVideoFileId: string | null };
  scheduledExerciseStatus: string;
  scheduleDayStatus: string | null;
}> {
  const body = new FormData();
  body.append("file", video, fileName);
  if (payload.aiScore !== undefined) body.append("aiScore", String(payload.aiScore));
  if (payload.aiFeedback !== undefined) body.append("aiFeedback", payload.aiFeedback);
  if (payload.videoIncludesOverlay !== undefined) body.append("videoIncludesOverlay", String(payload.videoIncludesOverlay));
  if (payload.aiMetrics !== undefined) body.append("aiMetrics", JSON.stringify(payload.aiMetrics));
  if (payload.performanceData !== undefined) body.append("performanceData", JSON.stringify(payload.performanceData));

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/scheduled-exercises/${scheduledExerciseId}/results`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(response.status, errorBody?.error?.message ?? `Upload failed (${response.status})`, errorBody?.error?.code);
  }
  return response.json();
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

export interface AdminDashboardLogEntry {
  id: string;
  type: "create" | "edit" | string;
  table: "user" | "exercise" | string;
  objectName: string;
  timeLabel: string;
  timestamp: string;
  byWho: string;
  level?: "info" | "warning" | "error";
  message?: string;
}

export interface AdminDashboardData {
  stats: AdminDashboardStats;
  weeklyActivity: AdminWeeklyActivityPoint[];
  roleDistribution: AdminRoleCount[];
  logs?: AdminDashboardLogEntry[];
}

export function getAdminDashboard(token: string): Promise<AdminDashboardData> {
  return apiRequest<AdminDashboardData>("/admin/dashboard", {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export interface SyncSchedulesResponse {
  success: boolean;
  message: string;
  today: string;
  updatedDaysCount: number;
  updatedExercisesCount: number;
  /** Plans flipped active → completed because today is past their end date. */
  updatedPlansCount: number;
  summary: {
    daysSkipped: number;
    daysCompleted: number;
    daysPending: number;
    daysInProgress: number;
    exercisesSkipped: number;
    exercisesPending: number;
    exercisesCompleted: number;
    plansCompleted: number;
  };
}

export function syncScheduleStatuses(token: string, clientToday?: string): Promise<SyncSchedulesResponse> {
  return apiRequest<SyncSchedulesResponse>("/admin/sync-schedules", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ clientToday })
  });
}


// --- Patient rehabilitation plans (Patient Detail page) ---------------------
// GET /patients/:patientId/plans
// `patient` mirrors session.service.ts's /patients/:id/today payload — a
// server-computed display name/initials so patient-side pages can show the
// real name even when the auth-store user carries no displayName.
export interface GetPatientPlansResponse {
  plans: any[];
  patient?: {
    displayName: string;
    avatarInitials: string;
    profilePictureFileId?: string | null;
    assignedTherapist?: { id: string; displayName: string } | null;
  };
}

export function getPatientPlans(
  token: string,
  patientId: string,
  statuses?: Array<"draft" | "active" | "completed" | "cancelled">
): Promise<GetPatientPlansResponse> {
  const query = statuses && statuses.length > 0 ? `?statuses=${statuses.join(",")}` : "";
  return apiRequest<GetPatientPlansResponse>(`/patients/${patientId}/plans${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// POST /patients/:patientId/plans
export function createPatientPlan(
  token: string,
  patientId: string,
  payload: {
    name: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    days?: any[];
    attachments?: Array<{ fileId: string; description?: string }>;
  }
): Promise<{ plan: any }> {
  return apiRequest<{ plan: any }>(`/patients/${patientId}/plans`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// DELETE /schedule-days/:dayId — removes one schedule day (and its exercises
// + recorded results) without touching the plan's start/end dates.
export function deleteScheduleDay(token: string, dayId: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/schedule-days/${dayId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}

// PATCH /plans/:planId
export function patchPlan(
  token: string,
  planId: string,
  payload: { name?: string; description?: string; startDate?: string | null; endDate?: string | null; status?: string }
): Promise<{ plan: any }> {
  return apiRequest<{ plan: any }>(`/plans/${planId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// GET /patients/:patientId/attachments
export function getPatientAttachments(
  token: string,
  patientId: string
): Promise<{ attachments: any[]; files: any[] }> {
  return apiRequest<{ attachments: any[]; files: any[] }>(`/patients/${patientId}/attachments`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// POST /plans/:planId/attachments
export function addPlanAttachment(
  token: string,
  planId: string,
  payload: { fileId: string; description?: string }
): Promise<{ attachment: any }> {
  return apiRequest<{ attachment: any }>(`/plans/${planId}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// DELETE /plans/:planId/attachments/:attachmentId
export function deletePlanAttachment(
  token: string,
  planId: string,
  attachmentId: string
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/plans/${planId}/attachments/${attachmentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}

// GET /files/:fileId
export function getFile(token: string, fileId: string): Promise<{ file: any }> {
  return apiRequest<{ file: any }>(`/files/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// POST /plans/:planId/schedule-days
export function createScheduleDay(
  token: string,
  planId: string,
  scheduledDate: string,
  therapistNote?: string
): Promise<{ day: any }> {
  return apiRequest<{ day: any }>(`/plans/${planId}/schedule-days`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ scheduledDate, therapistNote })
  });
}

// POST /schedule-days/:dayId/exercises
export function createScheduledExercise(
  token: string,
  dayId: string,
  payload: { exerciseLibraryId: string; orderNumber?: number; targetType?: string; targetValue?: any; therapistInstruction?: string }
): Promise<{ scheduledExercise: any }> {
  return apiRequest<{ scheduledExercise: any }>(`/schedule-days/${dayId}/exercises`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// POST /exercises/:id/duplicate — clone an exercise into a new family root (v1, draft).
export function duplicateExercise(
  token: string,
  exerciseId: string
): Promise<{ exercise: any }> {
  return apiRequest<{ exercise: any }>(`/exercises/${exerciseId}/duplicate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

// PATCH /exercises/:id
export function patchScheduledExercise(
  token: string,
  exerciseId: string,
  payload: { targetValue: string | number | null }
): Promise<{ scheduledExercise: any }> {
  return apiRequest<{ scheduledExercise: any }>(`/scheduled-exercises/${exerciseId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function deleteScheduledExercise(token: string, exerciseId: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/scheduled-exercises/${exerciseId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function reorderScheduledExercises(
  token: string,
  dayId: string,
  exerciseIds: string[]
): Promise<{ day: any }> {
  return apiRequest<{ day: any }>(`/schedule-days/${dayId}/exercises/order`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ exerciseIds })
  });
}

export function patchScheduleDay(token: string, dayId: string, payload: { therapistNote?: string; status?: string }) {
  return apiRequest<{ day: any }>(`/schedule-days/${dayId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function patchScheduledExerciseStatus(token: string, exerciseId: string, payload: { status: string; performance?: any }) {
  return apiRequest<any>(`/scheduled-exercises/${exerciseId}/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}