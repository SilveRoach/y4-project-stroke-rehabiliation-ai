export type Role = "patient" | "therapist" | "admin";

export type TrackingType = "pose" | "virtual_grip" | "both";

export type ExerciseStatus = "done" | "in_progress" | "not_started";

export interface PatientUser {
  id: string;
  displayName: string;
  phoneNumber: string;
  role: "patient";
}

// Lightweight patient list item returned by GET /patients
export interface PatientListItem {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  status: "active" | "inactive" | "suspended";
  assignedTherapistId?: string | null;
  assignedTherapistName?: string | null;
}

export interface PatientExercise {
  id: string;
  name: string;
  nameTh?: string;
  trackingType: TrackingType;
  targetLabel: string;
  status: ExerciseStatus;
  feedback: string;
  progressLabel: string;
  durationMinutes: number;
  sets: number;
  reps: number;
  difficulty: "Easy" | "Moderate" | "Hard";
  score?: number;
}

export interface PatientProgramDay {
  patient: PatientUser;
  dayNumber: number;
  totalDays: number;
  exercises: PatientExercise[];
  heatmap: Array<"completed" | "missed" | "today" | "future">;
}

// --- Therapist dashboard (frontend-design.md §5, mockup built from
// `design draft/src/views/TherapistView.tsx`) ---

export interface TherapistProfile {
  displayName: string;
  title: string;
  initials: string;
}

export type PatientStanding = "active" | "at_risk";

export interface TherapistPatientSummary {
  id: string;
  name: string;
  username?: string;
  email?: string | null;
  phoneNumber?: string | null;
  accountStatus?: string;
  lastLoginLabel?: string;
  gender?: string;
  dateOfBirth?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  profilePictureFileId?: string | null;
  nameTh?: string;
  age: number;
  condition: string;
  lastSessionLabel: string;
  compliancePercent: number;
  progressPercent: number;
  sessionsCompleted: number;
  standing: PatientStanding;
  avatarInitials: string;
  summary: string;
  assignedTherapistId?: string | null;
  assignedTherapistName?: string | null;
}

export interface WeeklySessionPoint {
  day: string;
  sessions: number;
  compliancePercent: number;
}

export interface ProgressTrendPoint {
  week: string;
  score: number;
}

// Per-patient recovery trend for the Dashboard's "Avg. Recovery Progress" chart
// (frontend-design.md §4). Previously that chart always plotted a single
// aggregate-across-all-patients series (progressTrendData) with no way to view
// one patient's own trend. One row per patient in therapistMock.ts's
// `patientProgressTrends`; `planName` is shown as the chart subtitle once a
// patient is selected (mock data only has one active plan per patient, matching
// the "one active program per patient" domain rule, so there's no separate plan
// picker — selecting the patient is enough to determine which plan's trend shows).
export interface PatientProgressTrend {
  patientId: string;
  planName: string;
  points: ProgressTrendPoint[];
}

// --- Admin dashboard (frontend-design.md §8/9, built from
// `design draft/src/views/AdminView.tsx`) ---

export interface AdminProfile {
  displayName: string;
  title: string;
  initials: string;
}

export type StaffRole = "therapist" | "admin";

// Widened beyond StaffRole to also cover Patient rows in the Staff accounts table
// (UI_MOCKUP_PLAN_NEWDB.md §6). Patients normally self-register (FR-AUTH-01b), but
// an admin can also create one directly through this page's "Create account" flow
// now (POST /users, user.service.ts's `createAccount()` patient branch) — same
// table/Edit-popup pattern already built for Therapist/Admin, generalized to a 3rd
// account kind without a separate page.
export type AdminManagedRole = "patient" | StaffRole;

export interface AdminUserSummary {
  id: string;
  name: string;
  role: AdminManagedRole;
  // Login identifier — for Therapist/Admin this is a chosen username; for Patient
  // it's their phone number, per newdb.txt's users.username comment ("Patient:
  // Usually their phone number"). Same underlying field in the schema either way,
  // so it isn't split into a separate phoneNumber column here.
  username: string;
  status: "active" | "disabled";
  lastLoginLabel: string;
  patientCount?: number;
  // Therapist-only (newdb.txt's therapists.license_number/issued/expiry) and
  // Admin-only (admins.employee_id) fields — UI_MOCKUP_PLAN_NEWDB.md §2.2/§6#1.
  // Client-side only: collected in the create-account modal but not sent to the
  // real POST /users call, since CreateUserPayload/createAccount() don't accept
  // them yet (no matching columns on Therapist/Admin — see the plan's §5). Held
  // here so the new row in the table reflects what was entered, same "real UI,
  // mock persistence" pattern as every other still-mock page.
  licenseNumber?: string;
  licenseIssuedLabel?: string;
  licenseExpiryLabel?: string;
  employeeId?: string;
  // Therapist/Admin only, matching users.email/phone_number on schema.prisma
  // (real fields, sent to and returned from POST /users — unlike
  // licenseNumber/employeeId above, which still aren't persisted). Not used
  // for Patient rows: `username` already carries the phone-as-login-identifier
  // for that role, so a second phoneNumber field would be redundant there.
  email?: string;
  phoneNumber?: string;
  // users.profile_picture_file_id (files-row id) — resolved to a blob URL per
  // row via useProfilePicture for the account table's avatar (initials
  // fallback when unset/loading/failed).
  profilePictureFileId?: string;
  // Patient-only, matching the `patients` DBML the user supplied 2026-08-08
  // (supersedes the earlier date_of_birth/affected_side guess, which was sourced
  // from the OLD schema.prisma's Patient model before this DBML was shared).
  // `name` above stays the full display name (used for the table's Name column,
  // avatar initials, and search) derived from firstName + lastName on save; the
  // DBML itself has no single "name"/"display_name" column on `patients` the way
  // User.displayName covers Therapist/Admin. affectedSide was DROPPED entirely
  // rather than kept alongside these — this DBML's `patients` table has no such
  // column, so it doesn't belong here; if the app still needs it, that's a
  // decision for wherever it's actually used (exercise assignment?), not this row.
  firstName?: string;
  lastName?: string;
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirthLabel?: string;
  heightCm?: number;
  weightKg?: number;
  // Patient-only: the therapist from the patient's ACTIVE
  // patient_therapist_assignments row (null/undefined when unassigned).
  // Mirrors AdminUserListItem.assignedTherapist; powers the assign/unassign
  // therapist UI on AdminUserManagementPage.
  assignedTherapist?: { id: string; displayName: string; licenseNumber?: string | null } | null;
}

export interface WeeklyActivityPoint {
  day: string;
  sessions: number;
  aiCalls: number;
}

export interface RoleDistributionSlice {
  name: string;
  value: number;
  color: string;
}

export interface SystemLogEntry {
  id?: string;
  type: "create" | "edit" | "delete" | string;
  table: "user" | "exercise" | string;
  objectName: string;
  timeLabel: string;
  timestamp?: string;
  byWho: string;
  level?: "info" | "warning" | "error";
  message?: string;
}

export type ExerciseTrackingType = "pose" | "virtual_grip" | "none";

export type ExerciseLibraryDifficulty = "easy" | "medium" | "hard";

export type ExerciseLibraryStatus = "draft" | "active" | "archived";

// Base evaluation criteria, shaped by movement_tracking (newdb.txt's
// exercise_library.base_criteria json). Only the fields relevant to the exercise's
// movement_tracking are expected to be set — see UI_MOCKUP_PLAN_NEWDB.md §2.5.
export interface ExerciseBaseCriteria {
  targetAngleDeg?: number;
  targetGripStrength?: number;
  repetitions?: number;
  holdSeconds?: number;
}

// One row in an exercise family's version history (newdb.txt's exercise_library,
// grouped by parent_exercise_id). Lighter-weight than ExerciseLibraryItem — just
// enough to render the History panel's version list.
export interface ExerciseVersionSummary {
  id: string;
  versionNumber: number;
  status: ExerciseLibraryStatus;
  baseCriteria: ExerciseBaseCriteria;
  createdAtLabel: string;
}

export interface ExerciseLibraryItem {
  id: string; // this specific version's row id (exercise_library.id)
  parentExerciseId: string; // groups all versions of the same exercise (parent_exercise_id)
  versionNumber: number;
  name: string;
  nameTh?: string;
  description: string;

  movementTracking: ExerciseTrackingType;
  difficultyLevel: ExerciseLibraryDifficulty;

  hasDemoVideo: boolean;
  demoVideoFileId?: string | null;
  demoVideoFile?: {
    id: string;
    originalName: string;
    mimeType: string | null;
    fileSize: number | null;
  } | null;
  baseCriteria: ExerciseBaseCriteria;

  status: ExerciseLibraryStatus;

  createdAtLabel: string;
  createdByName: string;
  createdById?: string;

  // Full version history for this parent_exercise_id, including this row itself,
  // newest first. Powers the "History" panel (UI_MOCKUP_PLAN_NEWDB.md §2.5).
  versions: ExerciseVersionSummary[];
}

// --- File Picker / Uploader (shared component, UI_MOCKUP_PLAN_NEWDB.md §2.4).
// Backs every `*_file_id` column in newdb.txt's `files` table: profile pictures,
// medical_history_attachments, exercise_library.demo_video_file_id,
// exercise_performance_results.reference_video. Mirrors
// docs/04-design/mockups/file-picker.html. Component in
// components/FilePicker.tsx. Upload-backed pickers use the server file id in
// `id`; mock-backed consumers may continue to use their local ids.

export type PickedFileType = "image" | "video";

export interface PickedFile {
  id: string;
  fileName: string;
  fileType: PickedFileType;
  sizeLabel: string;
  previewUrl: string;
  uploadedAtLabel: string;
  // Video only, formatted m:ss (best-effort — read from the browser's decoded
  // metadata, so may be briefly absent right after upload).
  durationLabel?: string;
}

// --- Patient Detail (Therapist view, frontend-design.md §5, revised per
// UI_MOCKUP_PLAN_NEWDB.md §2.3 for patient_medical_history/medical_history_attachments,
// §2.7 for exercise_performance_results' AI/PT review split, and modeled directly on
// patient_rehabilitation_plans/rehabilitation_schedule_days for the plan
// selector + calendar). Mirrors docs/04-design/mockups/patient-detail.html plus a
// later layout revision (multi-plan calendar block). Mock data in
// data/patientDetailMock.ts; page in pages/PatientDetailPage.tsx. "Add record",
// attachments (via FilePicker), and plan create/edit are all real client-side
// state; "Review"/"Generate summary report" are stubs pending Session Result
// Review's own persistence and a reporting backend respectively — see inline
// comments in the page component.

export type MedicalRecordType =
  | "diagnosis"
  | "pt_assessment"
  | "progress_note"
  | "rehab_followup"
  | "discharge"
  | "referral"
  | "other";

export interface MedicalHistoryRecord {
  id: string;
  recordType: MedicalRecordType;
  title: string;
  dateLabel: string;
  recordedByLabel: string;
  // Rendered as a small key-value row, never raw JSON, per
  // UI_MOCKUP_PLAN_NEWDB.md §4's design assumption for `assessment_data`.
  details?: Array<{ label: string; value: string }>;
  // Real medical_history_attachments rows, rendered via the FilePicker component.
  // Pre-seeded mock records may have attachments the mock data doesn't actually
  // hold files for — see data/patientDetailMock.ts's comments for which is which.
  attachments: PickedFile[];
}

export type HeatmapDayStatus = "completed" | "in_progress" | "skipped" | "pending" | "cancelled";

export type SessionOutcome = "completed" | "skipped";

export type EvaluationSource = "ai" | "pt_reviewed";

export interface SessionHistoryEntry {
  id: string;
  dateLabel: string;
  dayLabel: string;
  exercisesAttempted: number;
  outcome: SessionOutcome;
  avgScore?: number;
  evaluationSource?: EvaluationSource;
}

// --- Therapist Sessions (sidebar "Sessions" page, cross-patient session log).
// Same shape as SessionHistoryEntry (Patient Detail's per-patient list) plus the
// patient identity fields needed to show a mixed-patient list, and the owning
// plan identity so consumers can scope the log to a plan (PatientDetailPage
// shows only the currently selected plan's sessions).
export interface TherapistSessionLogEntry extends SessionHistoryEntry {
  patientId: string;
  patientName: string;
  rehabilitationPlanId: string;
  rehabilitationPlanName: string;
  patientAvatarInitials: string;
}

// Matches newdb.txt's patient_rehabilitation_plans_status enum exactly (draft/
// active/paused/completed/cancelled) — a patient can have several plans over
// time (a completed baseline assessment plan, the current active one, etc.), not
// just one, per that table's design. Replaces the earlier PatientProgramSummary,
// which modeled only a single "current program".
export type RehabPlanStatus = "draft" | "active" | "paused" | "completed" | "cancelled";

// One row from patient_rehabilitation_plans, plus its derived day-by-day calendar.
// `heatmap` is one entry per rehabilitation_schedule_days row for this plan, in
// date order starting at startDateLabel — there's no separate "current day"
// column in the schema; that's derived from how many days aren't `pending` yet
// (see PatientDetailPage.tsx's planProgress()).
// --- Program Editor (PT_EXERCISE_PATH_MOCKUP_PLAN.md §4.1). Models
// rehabilitation_schedule_days + scheduled_exercises from newdb.txt: each day in a
// plan can carry its own ordered list of assigned exercises, each pointing back at
// an ExerciseLibraryItem. Mirrors docs/04-design/mockups/program-editor.html.
// Page in pages/ProgramEditorPage.tsx.

export type ScheduledExerciseTargetType = "repetitions" | "duration";

export type ScheduledExerciseStatus = "pending" | "in_progress" | "completed" | "skipped" | "cancelled";

export interface ScheduledExercise {
  id: string;
  exerciseLibraryId: string; // points at an ExerciseLibraryItem.id
  exerciseName: string; // denormalized for display without a lookup
  versionLabel?: string; // e.g. "v3", mirrors ExerciseLibraryItem.versionNumber
  movementTracking: ExerciseTrackingType; // reuse existing enum, drives the row icon
  orderNumber: number;
  targetType: ScheduledExerciseTargetType;
  targetValueLabel: string; // freeform display, e.g. "10 laps", "3 sets x 12"
  difficultyLevel?: ExerciseLibraryDifficulty; // can override the library default for this patient
  therapistInstruction?: string;
  status: ScheduledExerciseStatus;
  performanceResults?: any[];
}

export interface ScheduleDay {
  id?: string;
  dateLabel?: string; // ISO date if the plan is date-anchored
  status: HeatmapDayStatus; // reuse existing enum (completed/in_progress/skipped/pending)
  therapistNote?: string;
  exercises: ScheduledExercise[];
}

export interface PlanAttachmentFile {
  id: string;
  originalName: string;
  storedName?: string;
  fileType: "image" | "video" | "document" | "audio" | "other";
  mimeType?: string | null;
  fileSize?: number | null;
  storagePath?: string;
}

export interface PlanAttachment {
  id: string;
  rehabilitationPlanId: string;
  fileId: string;
  description?: string | null;
  uploadedAtLabel?: string;
  file?: PlanAttachmentFile;
  rehabilitationPlan?: {
    id: string;
    name: string;
    status?: string;
  };
}

// `heatmap` stays exactly as-is (PatientDetailPage's calendar cells already render
// from it) — `days` is added alongside it, same length/order, one entry per
// rehabilitation_schedule_days row, so existing calendar code needs no changes.
export interface PatientRehabPlan {
  id: string;
  name: string;
  description?: string;
  status: RehabPlanStatus;
  startDateLabel: string;
  endDateLabel?: string;
  heatmap: HeatmapDayStatus[];
  days: ScheduleDay[];
  attachments?: PlanAttachment[];
}

export interface PatientDetailProfile {
  id: string;
  name: string;
  sex: "Male" | "Female" | "Other";
  age: number;
  affectedSide: "Left" | "Right" | "Both" | "None";
  patientCode: string;
  // Every plan this patient has ever had, newest first — the Progress calendar
  // shows whichever one the PT has selected (defaulting to the active one), and
  // the plan selector lets them switch. Empty array is valid (no plan created yet).
  plans: PatientRehabPlan[];
  medicalHistory: MedicalHistoryRecord[];
  earlierMedicalHistoryCount: number;
  sessionHistory: SessionHistoryEntry[];
  hasEarlierSessions: boolean;
}

// --- Patient's own History page (sidebar "History"). Reuses the same
// PatientRehabPlan/HeatmapDayStatus/RehabPlanStatus shapes the Therapist's
// Patient Detail calendar above already uses (data/patientDetailMock.ts), so the
// calendar-grid rendering logic (weekday header + Sun-first month layout from a
// startDateLabel) can be shared between the two pages instead of reinvented.
// Extends the plan's plain per-day status with the exercises actually attempted
// that day (with per-exercise scores) — a bare heatmap can answer "was this day
// completed" but not "what did I do that day", which the calendar drill-down
// (clicking a day) needs. Mock data in data/patientHistoryMock.ts; page in
// pages/PatientHistoryPage.tsx.
export interface PatientHistoryDayExercise {
  name: string;
  nameTh?: string;
  trackingType: TrackingType;
  score?: number;
}

export interface PatientHistoryDay {
  status: HeatmapDayStatus;
  exercises: PatientHistoryDayExercise[];
}

export interface PatientHistoryPlan {
  id: string;
  name: string;
  status: RehabPlanStatus;
  // One entry per rehabilitation_schedule_days row for this plan, in date order
  // starting at startDateLabel — same anchoring convention as
  // PatientRehabPlan.heatmap above.
  startDateLabel: string;
  endDateLabel?: string;
  days: PatientHistoryDay[];
}

// --- Session Result Review (frontend-design.md §2.7, new page — no prior spec
// section, only UI_MOCKUP_PLAN_NEWDB.md §2.7). Mirrors
// docs/04-design/mockups/session-result-review.html. Reached from Patient Detail's
// per-session "Review ›" action. Models newdb.txt's exercise_performance_results:
// one row per completed attempt of a scheduled_exercise, with separate AI and PT
// evaluation fields plus a final_score/evaluation_source recording which one (or a
// manual override) was selected as the official result.
//
// Mock data in data/sessionReviewMock.ts; page in pages/SessionResultReviewPage.tsx.
// "Use AI score"/"Use my score" are real client-side state updates (no backend
// endpoint exists for exercise_performance_results yet — see
// UI_MOCKUP_PLAN_NEWDB.md §5 for why: the running schema has no ai_score/pt_score/
// evaluation_source/final_score split at all yet, only a single `score` column).

export type EvaluationDecisionSource = "ai" | "pt" | "manual";

export interface ExercisePerformanceAttempt {
  id: string;
  attemptNumber: number;
  // Placeholder only for mock attempts — real attempts (from
  // GET /schedule-days/:id/results) carry the server files-row id here, which
  // the review page streams via GET /files/:fileId/content.
  referenceVideo: PickedFile | null;
  referenceVideoFileId?: string | null;
  videoBlobUrl?: string | null;

  aiScore?: number;
  aiFeedback?: string;
  // Rendered as small key-value pairs, never raw JSON, matching the design
  // assumption already applied to MedicalHistoryRecord.details and
  // ExerciseLibraryItem.baseCriteria (UI_MOCKUP_PLAN_NEWDB.md §4).
  aiMetrics?: Array<{ label: string; value: string }>;
  aiEvaluatedAtLabel?: string;

  ptScore?: number;
  ptFeedback?: string;
  ptEvaluatedByLabel?: string;

  finalScore?: number;
  evaluationSource?: EvaluationDecisionSource;
}

export interface SessionExerciseReview {
  id: string;
  exerciseName: string;
  // exercise_library.id this scheduled_exercise points to, plus its version badge
  // for display (e.g. "v3") — links back to ExerciseLibraryItem.versionNumber.
  exerciseVersionLabel?: string;
  scheduledExerciseId: string;
  // Newest attempt first, matching the mockup's default-selected-latest behavior.
  attempts: ExercisePerformanceAttempt[];
}

export interface SessionReviewData {
  sessionId: string;
  patientName: string;
  dateLabel: string;
  dayLabel: string;
  exercises: SessionExerciseReview[];
}

// --- Session video capture / upload confirm (CAMERA_TRACKING_MOCKUP_PLAN.md §6).
// Client-side shape for what a confirmed upload sends to
// POST /scheduled-exercises/:id/results (backend session-results module) — see
// the plan's §6.1 schema-mapping table. Held in App.tsx between
// PatientSessionPage's STOP/handoff and SessionUploadConfirmPage's
// Confirm/Retry/Discard actions. The raw video Blob rides along here (the
// object URL is only for preview) so Confirm can actually upload it.
export interface PendingSessionAttempt {
  scheduledExerciseId: string;
  exerciseName: string;
  exerciseNameTh?: string;
  videoBlobUrl: string;
  // The real recording bytes — sent to POST /scheduled-exercises/:id/results on
  // Confirm and stored via the backend files module.
  videoBlob: Blob;
  videoFileName: string;
  videoSizeLabel: string;
  videoMimeType: string;
  // Generated client-side right after recording stops (ai/scoring.ts is still a
  // stub — mocked, same caveat as CAMERA_TRACKING_MOCKUP_PLAN.md §2.5).
  aiScore: number;
  aiFeedback: string;
  aiMetrics: Array<{ label: string; value: string }>;
}