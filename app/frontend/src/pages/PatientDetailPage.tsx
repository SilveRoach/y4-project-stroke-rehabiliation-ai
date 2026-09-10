import {
  ArrowLeft,
  Ban,
  Bell,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Dumbbell,
  Eye,
  FileText,
  FileVideo,
  GripVertical,
  Hand,
  Image as ImageIcon,
  Minus,
  Paperclip,
  Plus,
  Save,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import {
  ApiError,
  getTherapistSessions,
  getPatientPlans,
  createPatientPlan,
  patchPlan,
  createScheduleDay,
  deleteScheduleDay,
  createScheduledExercise,
  deleteScheduledExercise,
  patchScheduleDay,
  patchScheduledExercise,
  reorderScheduledExercises,
  getExerciseLibrary,
  getPatientAttachments,
  addPlanAttachment,
  deletePlanAttachment,
  deletePlan,
  uploadFile
} from "../services/api";
import { useAuth } from "../store/authStore";
import { useProfilePicture } from "../hooks/useProfilePicture";
import { trackingIcon } from "./ProgramEditorPage";
import type {
  ExerciseLibraryDifficulty,
  ExerciseLibraryItem,
  ExerciseTrackingType,
  HeatmapDayStatus,
  PatientRehabPlan,
  PlanAttachment,
  PlanAttachmentFile,
  RehabPlanStatus,
  ScheduleDay,
  ScheduledExercise,
  ScheduledExerciseStatus,
  ScheduledExerciseTargetType,
  SessionHistoryEntry,
  TherapistPatientSummary
} from "../types";
import { initialsFromName } from "../utils/displayName";

interface PatientDetailPageProps {
  // Real TherapistPatientSummary — the same object TherapistDashboardPage.tsx /
  // TherapistPatientsPage.tsx already fetch from GET /therapists/:id/patients
  // (services/api.ts's getTherapistPatients) and hand to onViewFullReport /
  // onViewPatient. Replaces the old mock-shaped PatientDetailProfile
  // (data/patientDetailMock.ts's getPatientDetailProfile), whose sex/
  // affectedSide/patientCode fields had no backing column anywhere in
  // schema.prisma — see the fallback constants below this component.
  patient: TherapistPatientSummary;
  onBack: () => void;
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  onReviewSession: (session: SessionHistoryEntry) => void;
  onOpenExercise?: (exerciseLibraryId: string) => void;
  // Program Editor's schedule/exercise editing now lives directly in this page
  // (four-column Calendar/Plan/Day/Exercises workspace below) instead of routing
  // to a separate ProgramEditorPage. These two props are kept optional, unused,
  // purely so App.tsx's existing <PatientDetailPage onOpenProgramEditor=.../>
  // call site still type-checks without needing its own edit in this pass.
  onOpenProgramEditor?: (plan: PatientRehabPlan) => void;
  pendingPlanUpdate?: PatientRehabPlan | null;
}


const heatmapLabels: Record<HeatmapDayStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  skipped: "Skipped",
  pending: "Pending",
  cancelled: "Cancelled"
};

// Mismatch flagged, not changed: schema.prisma's PatientRehabilitationPlansStatus
// enum (and api-design.md's PATCH /plans/:id/status note) has no "paused" value
// — only draft/active/completed/cancelled; "cancel is the only way to stop one
// short." Left as-is because Plans still have no backend endpoint at all (see
// the `plans` state above), so nothing here is persisted yet; whoever wires
// POST /plans up will need to drop/remap this option then.
const planStatusLabels: Record<RehabPlanStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled"
};

// Exported so the patient-facing Progress page can render the same
// month-navigable schedule calendar (previously private to this page).
export interface MonthCell {
  key: string;
  iso: string | null; // real date (YYYY-MM-DD), null for adjacent-month padding we still show
  dateNumber: number | null;
  status: HeatmapDayStatus | null;
  dayIndex: number | null; // index into plan.days when this date maps to a scheduled day
  outside: boolean; // real date of the viewed month but outside the plan's range
  otherMonth: boolean; // padding day from the previous/next month
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DISPLAY_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function displayDateLabel(isoDate: string): string {
  if (!ISO_DATE_RE.test(isoDate)) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function isoDateFromDisplay(value: string): string {
  const match = DISPLAY_DATE_RE.exec(value.trim());
  if (!match) return "";
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  return date.getFullYear() === Number(year) && date.getMonth() + 1 === Number(month) && date.getDate() === Number(day)
    ? `${year}-${month}-${day}`
    : "";
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

function dateFromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Full month-based calendar: always renders complete Sun-first week rows for
// the viewed month (up to 6 week columns). Days unrelated to the plan (before
// the start date / after the end date) are rendered "shadowed out", and
// adjacent-month padding days are faded too. Day statuses come from the plan's
// schedule days (dateLabel → status), falling back to the heatmap sequence
// anchored at startDateLabel — same mapping the old heatmap strip used.
// Exported for PatientProgressPage's schedule calendar (same component base).
export function buildMonthCalendar(plan: PatientRehabPlan, monthKey: string): MonthCell[] {
  const startIso = ISO_DATE_RE.test(plan.startDateLabel) ? plan.startDateLabel : null;

  // Status map: prefer explicit schedule-day dates.
  const byDate = new Map<string, { status: HeatmapDayStatus; dayIndex: number }>();
  (plan.days ?? []).forEach((day, idx) => {
    if (day.dateLabel && ISO_DATE_RE.test(day.dateLabel)) {
      byDate.set(day.dateLabel, { status: day.status, dayIndex: idx });
    }
  });
  // Fallback: anchor the heatmap sequence at the plan start date.
  if (byDate.size === 0 && startIso && plan.heatmap.length > 0) {
    plan.heatmap.forEach((status, idx) => {
      const d = dateFromIso(startIso);
      d.setDate(d.getDate() + idx);
      byDate.set(isoOf(d), { status, dayIndex: idx });
    });
  }

  // Plan range (used to shadow out unrelated days of the viewed month).
  const totalDays = plan.heatmap.length || (plan.days?.length ?? 0);
  const endIso =
    plan.endDateLabel && ISO_DATE_RE.test(plan.endDateLabel)
      ? plan.endDateLabel
      : startIso && totalDays > 0
        ? isoOf(new Date(dateFromIso(startIso).getTime() + (totalDays - 1) * 86_400_000))
        : null;

  // Grid geometry: Sunday-first, ALWAYS a full 6-row × 7-column grid (42 cells)
  // so the calendar keeps a constant height regardless of how the month falls —
  // leading/trailing cells beyond the month are handled by the otherMonth/outside
  // shadowing below.
  const [year, month] = monthKey.split("-").map(Number);
  const firstOfMonth = new Date(year, month - 1, 1);
  const weekRows = 6;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay()); // back to Sunday

  const cells: MonthCell[] = [];
  for (let i = 0; i < weekRows * 7; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = isoOf(d);
    const otherMonth = d.getMonth() !== month - 1;
    const hit = byDate.get(iso);
    const inRange = startIso ? iso >= startIso && (!endIso || iso <= endIso) : false;
    cells.push({
      key: `c-${iso}`,
      iso,
      dateNumber: d.getDate(),
      status: hit?.status ?? null,
      dayIndex: hit?.dayIndex ?? null,
      outside: !otherMonth && !inRange,
      otherMonth
    });
  }
  return cells;
}

// Exported for PatientProgressPage's schedule calendar (same component base).
export function planMonthRange(plan: PatientRehabPlan): { min: string; max: string } {
  const dates: string[] = [];
  if (ISO_DATE_RE.test(plan.startDateLabel)) dates.push(plan.startDateLabel);
  (plan.days ?? []).forEach((day) => {
    if (day.dateLabel && ISO_DATE_RE.test(day.dateLabel)) dates.push(day.dateLabel);
  });
  if (plan.endDateLabel && ISO_DATE_RE.test(plan.endDateLabel)) dates.push(plan.endDateLabel);
  if (dates.length === 0) {
    const now = isoOf(new Date());
    return { min: monthKeyOf(now), max: monthKeyOf(now) };
  }
  dates.sort();
  return { min: monthKeyOf(dates[0]), max: monthKeyOf(dates[dates.length - 1]) };
}


// Exported for PatientProgressPage's schedule calendar (same component base).
export function calendarPeriodLabel(plan: PatientRehabPlan): string {
  if (!ISO_DATE_RE.test(plan.startDateLabel)) {
    return `${plan.heatmap.length}-day plan`;
  }
  const start = new Date(`${plan.startDateLabel}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + plan.heatmap.length - 1);
  const startLabel = start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const endLabel = end.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return startLabel === endLabel
    ? startLabel
    : `${start.toLocaleDateString("en-US", { month: "short" })} \u2013 ${endLabel}`;
}

// There's no "current day" column on patient_rehabilitation_plans — it's derived
// from how many of this plan's rehabilitation_schedule_days rows aren't `pending`
// yet (the first pending day is the next one due).
function planProgress(plan: PatientRehabPlan): { current: number; total: number } {
  const total = plan.heatmap.length;
  const firstPendingIndex = plan.heatmap.findIndex((status) => status === "pending");
  const current = firstPendingIndex === -1 ? total : firstPendingIndex + 1;
  return { current, total };
}

function daysBetweenInclusive(startLabel: string, endLabel: string): number {
  if (!ISO_DATE_RE.test(startLabel) || !ISO_DATE_RE.test(endLabel)) return 21;
  const start = new Date(`${startLabel}T00:00:00`);
  const end = new Date(`${endLabel}T00:00:00`);
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.min(60, Math.max(1, diffDays));
}

// Shared label maps for the Calendar | Plan | Day | Exercise workspace below.
// "Edit note" / "Add exercise" still hit the same real APIs the old inline
// DayDetailPanel used (patchScheduleDay / createScheduledExercise).
const trackingLabels: Record<ExerciseTrackingType, string> = {
  pose: "Pose tracking",
  virtual_grip: "Virtual grip",
  none: "No tracking"
};

const exerciseStatusLabel: Record<ScheduledExerciseStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped",
  cancelled: "Cancelled"
};

const difficultyLabels: Record<ExerciseLibraryDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard"
};

const difficultyBadgeClass: Record<ExerciseLibraryDifficulty, string> = {
  easy: "easy",
  medium: "moderate",
  hard: "hard"
};

function defaultTargetValueLabel(criteria: any, targetType?: string): string {
  if (!criteria || typeof criteria !== "object") return "";
  if (targetType === "duration" && criteria.holdSeconds !== undefined) return `${criteria.holdSeconds} sec`;
  if (targetType === "sets" && criteria.repetitions !== undefined) return `${criteria.repetitions} reps`;
  if (targetType === "distance") return "";
  if (criteria.repetitions !== undefined) return `${criteria.repetitions} reps`;
  if (criteria.holdSeconds !== undefined) return `${criteria.holdSeconds} sec`;
  if (criteria.targetAngleDeg !== undefined) return `${criteria.targetAngleDeg}°`;
  if (criteria.targetGripStrength !== undefined) return String(criteria.targetGripStrength);
  return "";
}

function splitTargetValue(value: string): { amount: string; unit: string } {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  return match ? { amount: match[1], unit: match[2] } : { amount: "", unit: value.trim() };
}

function TargetValueControl({
  value,
  disabled,
  onSave
}: {
  value: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [parts, setParts] = useState(() => splitTargetValue(value));

  useEffect(() => {
    setParts(splitTargetValue(value));
  }, [value]);

  const save = (amount: string) => {
    setParts((current) => ({ ...current, amount }));
    onSave(`${amount}${parts.unit ? ` ${parts.unit}` : ""}`);
  };

  return (
    <div className="pd-ex-target-control">
      <button type="button" onClick={() => save(String(Math.max(0, Number(parts.amount || 0) - 1)))} disabled={disabled} aria-label="Decrease target value">−</button>
      <input
        type="number"
        min="0"
        step="1"
        value={parts.amount}
        placeholder="—"
        disabled={disabled}
        onChange={(event) => setParts((current) => ({ ...current, amount: event.target.value }))}
        onBlur={() => save(parts.amount)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        aria-label="Target value"
      />
      <button type="button" onClick={() => save(String(Number(parts.amount || 0) + 1))} disabled={disabled} aria-label="Increase target value">+</button>
      {parts.unit && <span>{parts.unit}</span>}
    </div>
  );
}

// ── Program Editor API flows, wired into this page ───────────────────────────
// Same endpoints ProgramEditorPage uses; adapted so the therapist never has to
// leave Patient Detail to manage a plan's schedule.
//
//   Add day      → POST /plans/:planId/schedule-days
//   Add exercise → POST /schedule-days/:dayId/exercises (via library picker,
//                  GET /exercises — active items only)

// Sensible starting target per target_type — matches the library item's own
// base_criteria when it has a relevant field (mirrors ProgramEditorPage).
function defaultTargetForExercise(item: ExerciseLibraryItem): {
  targetType: ScheduledExerciseTargetType;
  targetValueLabel: string;
} {
  if (item.baseCriteria.repetitions !== undefined) {
    return { targetType: "repetitions", targetValueLabel: `${item.baseCriteria.repetitions} reps` };
  }
  if (item.baseCriteria.holdSeconds !== undefined) {
    return { targetType: "duration", targetValueLabel: `${item.baseCriteria.holdSeconds} sec` };
  }
  if (item.baseCriteria.targetAngleDeg !== undefined) {
    return { targetType: "free", targetValueLabel: `${item.baseCriteria.targetAngleDeg}°` };
  }
  if (item.baseCriteria.targetGripStrength !== undefined) {
    return { targetType: "free", targetValueLabel: String(item.baseCriteria.targetGripStrength) };
  }
  return { targetType: "repetitions", targetValueLabel: "10 reps" };
}

// Compute the next calendar date to assign when "Add day" is pressed.
// Advances one day past the last dated day; falls back to today when the plan
// has no dated days yet (mirrors ProgramEditorPage).
function nextScheduledDate(days: ScheduleDay[]): string {
  const dated = days
    .map((d) => d.dateLabel)
    .filter((label): label is string => !!label && /^\d{4}-\d{2}-\d{2}$/.test(label))
    .sort();
  const base = dated.length > 0 ? dated[dated.length - 1] : new Date().toISOString().slice(0, 10);
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}


export function PatientDetailPage({
  patient,
  onBack,
  onLogout,
  onNavigate,
  onReviewSession,
  onOpenExercise,
  onOpenProgramEditor,
  pendingPlanUpdate
}: PatientDetailPageProps) {
  const { token, user } = useAuth();
  const therapistDisplayName = user?.displayName || user?.username || "Therapist";
  // Real profile picture for the patient-profile panel: the summary already
  // carries users.profile_picture_file_id — resolve it to a blob object URL via
  // the auth'd GET /files/:id/content endpoint (useProfilePicture). Falls back
  // to the initials badge while loading / when there's no picture / on failure.
  const patientAvatarUrl = useProfilePicture(token, patient.profilePictureFileId ?? null);
  const [assignedTherapist, setAssignedTherapist] = useState<{ id: string; displayName: string } | null | undefined>(
    patient.assignedTherapistId
      ? { id: patient.assignedTherapistId, displayName: patient.assignedTherapistName || "Assigned therapist" }
      : patient.assignedTherapistId === null
        ? null
        : undefined
  );
  const canEditPlan = user?.role === "therapist" && assignedTherapist?.id === user.id;

  // patients.gender / date_of_birth aren't exposed by any endpoint a therapist is
  // authorized to call (GET /users/:id is "Self, or Admin" only — see
  // user.controller.ts's getUserProfileHandler), and schema.prisma's Patient
  // model has no affected-side column at all (dropped from the newdb.txt design
  // — see schema.prisma's own header note). Rather than invent values, these
  // stay fixed fallbacks; "None" already renders as "Affected side not
  // recorded" below, same as the old mock's own generic fallback profile did.
  // patients.user_id is a UUID, not a "#P-0142"-style code — there's no
  // patient_code column anywhere in schema.prisma. Derived a short display code
  // from the id instead of fabricating one.
  const patientCode = `#${patient.id.slice(0, 8).toUpperCase()}`;

  // No patient_rehabilitation_plans backend endpoint exists yet (api-design.md
  // documents POST /plans / GET /patients/:id/plans, but no "plans" module has
  // actually been implemented — see backend/src/modules), so this starts empty
  // rather than seeding a fabricated calendar/heatmap. Create/edit below remains
  // real, client-side-only state, same as before (see handleSavePlan's comment).
  const [plans, setPlans] = useState<PatientRehabPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    plans.find((plan) => plan.status === "active")?.id ?? plans[0]?.id ?? null
  );
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [editingDayNote, setEditingDayNote] = useState(false);
  const [dayNoteDraft, setDayNoteDraft] = useState("");
  const [dayNoteSaving, setDayNoteSaving] = useState(false);

  // Available medical attachments & files for this patient
  const [availableAttachments, setAvailableAttachments] = useState<PlanAttachment[]>([]);
  const [availableFiles, setAvailableFiles] = useState<PlanAttachmentFile[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  // Program Editor flows wired into this page (real APIs — see comment block
  // above defaultTargetForExercise). Loading/error surfaced inline per action.
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  // "create" forces the plan modal open on its "+ New plan" tab (used by the
  // + button next to the Rehab plans column title); "view" keeps the old
  // behavior of defaulting to edit when a plan is selected.
  const [planModalIntent, setPlanModalIntent] = useState<"view" | "create">("view");
  const [addDayLoading, setAddDayLoading] = useState(false);
  const [addDayError, setAddDayError] = useState<string | null>(null);
  const [addExerciseLoading, setAddExerciseLoading] = useState(false);
  const [addExerciseError, setAddExerciseError] = useState<string | null>(null);
  const [draggedExerciseId, setDraggedExerciseId] = useState<string | null>(null);
  const [targetSavingId, setTargetSavingId] = useState<string | null>(null);
  const [exercisePendingRemoval, setExercisePendingRemoval] = useState<{ id: string; name: string } | null>(null);

  // Calendar view month ("YYYY-MM"), constrained to the plan's span. null =
  // follow the plan's start month (resets automatically when the plan changes).
  const [viewMonthKey, setViewMonthKey] = useState<string | null>(null);

  function handleSelectDay(dayIndex: number) {
    if (!selectedPlan || !selectedPlan.days) return;
    if (dayIndex < 0 || dayIndex >= selectedPlan.days.length) return;
    setSelectedDayIndex(dayIndex);
  }

  // The Exercise column mirrors the selected day; when a different plan is
  // chosen (or a refresh changes the day list), auto-select that plan's first
  // pending/in-progress day so the workspace always shows a coherent
  // Plan → Day → Exercise context. Keeps the current selection when still valid.
  useEffect(() => {
    setSelectedDayIndex((current) => {
      const plan = plans.find((p) => p.id === selectedPlanId);
      if (!plan || !plan.days || plan.days.length === 0) return null;
      if (current !== null && current >= 0 && current < plan.days.length) return current;
      const pendingIdx = plan.days.findIndex((d) => d.status === "pending" || d.status === "in_progress");
      return pendingIdx === -1 ? 0 : pendingIdx;
    });
  }, [selectedPlanId, plans]);

  // Derived: the day row shown in columns 3 & 4 of the workspace.

  // Helper: map server response shape to client PatientRehabPlan consistently
  const mapServerPlans = (serverPlans: any[]): PatientRehabPlan[] => {
    return serverPlans.map((sp: any) => {
      const start = sp.startDate ? sp.startDate.slice?.(0, 10) ?? new Date(sp.startDate).toISOString().slice(0, 10) : "";
      const end = sp.endDate ? sp.endDate.slice?.(0, 10) ?? new Date(sp.endDate).toISOString().slice(0, 10) : "";
      const days = (sp.scheduleDays || []).map((sd: any) => ({
        id: sd.id,
        dateLabel: sd.scheduledDate ? (sd.scheduledDate.slice?.(0, 10) ?? new Date(sd.scheduledDate).toISOString().slice(0, 10)) : undefined,
        status: sd.status,
        therapistNote: sd.therapistNote ?? undefined,
        exercises: (sd.scheduledExercises || []).map((ex: any) => ({
          id: ex.id,
          exerciseLibraryId: ex.exerciseLibraryId,
          exerciseName: ex.exerciseLibrary?.name ?? ex.exerciseName ?? (ex.exerciseLibraryId ?? ""),
          versionLabel: ex.exerciseLibrary?.versionNumber != null ? `v${ex.exerciseLibrary.versionNumber}` : (ex.versionLabel ?? undefined),
          movementTracking: ex.exerciseLibrary?.movementTracking ?? ex.movementTracking ?? "none",
          orderNumber: ex.orderNumber ?? 0,
          targetType: ex.targetType ?? "free",
          targetValueLabel: ex.targetValue !== null && ex.targetValue !== undefined
            ? (typeof ex.targetValue === "object" ? JSON.stringify(ex.targetValue) : String(ex.targetValue))
            : defaultTargetValueLabel(ex.exerciseLibrary?.baseCriteria, ex.targetType),
          difficultyLevel: ex.exerciseLibrary?.difficultyLevel ?? ex.difficultyLevel ?? undefined,
          therapistInstruction: ex.therapistInstruction ?? undefined,
          status: ex.status ?? "pending"
        }))
      }));
      const attachments: PlanAttachment[] = (sp.attachments || []).map((att: any) => ({
        id: att.id,
        rehabilitationPlanId: att.rehabilitationPlanId,
        fileId: att.fileId,
        description: att.description ?? undefined,
        uploadedAtLabel: att.uploadedAt
          ? (att.uploadedAt.slice?.(0, 10) ?? new Date(att.uploadedAt).toISOString().slice(0, 10))
          : undefined,
        file: att.file ? {
          id: att.file.id,
          originalName: att.file.originalName,
          storedName: att.file.storedName,
          fileType: att.file.fileType,
          mimeType: att.file.mimeType ?? undefined,
          fileSize: att.file.fileSize != null ? Number(att.file.fileSize) : undefined,
          storagePath: att.file.storagePath
        } : undefined
      }));
      const heatmap = (sp.scheduleDays || []).map((sd: any) => sd.status as HeatmapDayStatus);
      return {
        id: sp.id,
        name: sp.name,
        description: sp.description ?? undefined,
        status: sp.status,
        startDateLabel: start,
        endDateLabel: end || undefined,
        heatmap,
        days,
        attachments
      } as PatientRehabPlan;
    });
  };

  const refreshAvailableAttachments = async () => {
    if (!token || !patient.id) return;
    setAttachmentsLoading(true);
    try {
      const res = await getPatientAttachments(token, patient.id);
      const mappedAtts: PlanAttachment[] = (res.attachments || []).map((att: any) => ({
        id: att.id,
        rehabilitationPlanId: att.rehabilitationPlanId,
        fileId: att.fileId,
        description: att.description ?? undefined,
        uploadedAtLabel: att.uploadedAt
          ? (att.uploadedAt.slice?.(0, 10) ?? new Date(att.uploadedAt).toISOString().slice(0, 10))
          : undefined,
        file: att.file ? {
          id: att.file.id,
          originalName: att.file.originalName,
          storedName: att.file.storedName,
          fileType: att.file.fileType,
          mimeType: att.file.mimeType ?? undefined,
          fileSize: att.file.fileSize != null ? Number(att.file.fileSize) : undefined,
          storagePath: att.file.storagePath
        } : undefined,
        rehabilitationPlan: att.rehabilitationPlan
      }));
      setAvailableAttachments(mappedAtts);
      setAvailableFiles(res.files || []);
    } catch {
      // best-effort
    } finally {
      setAttachmentsLoading(false);
    }
  };

  // Refresh plans from the server and update local state. Keeps selectedPlanId
  // stable if possible.
  const refreshPlans = async () => {
    if (!token || !patient.id) return;
    setPlansLoading(true);
    setPlansError(null);
    try {
      const res = await getPatientPlans(token, patient.id);
      const serverPlans = res.plans || [];
      const mapped = mapServerPlans(serverPlans);
      setPlans(mapped);
      setAssignedTherapist(res.patient?.assignedTherapist ?? null);
      setSelectedPlanId((current) => (current && mapped.some((p) => p.id === current) ? current : (mapped.find((p) => p.status === "active")?.id ?? mapped[0]?.id ?? null)));
    } catch (err) {
      setPlansError(err instanceof ApiError ? err.message : "Could not load plans");
    } finally {
      setPlansLoading(false);
    }
  };

  // Real session history — GET /therapists/:id/sessions (modules/session-results/*),
  // the same endpoint/service TherapistSessionsPage.tsx already uses, reused here
  // instead of adding a new per-patient route. That endpoint already scopes its
  // results to patients currently assigned to the calling (self) therapist, so
  // filtering its result down to this one patient client-side isn't relying on
  // the UI alone for authorization — a therapist can never receive another
  // therapist's patient sessions from this call in the first place.
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    setSessionsLoading(true);
    setSessionsError(null);

    getTherapistSessions(token, user.id)
      .then((data) => {
        if (!cancelled) setSessionHistory(data.sessions.filter((session) => session.patientId === patient.id));
      })
      .catch((err) => {
        if (!cancelled) {
          setSessionsError(err instanceof ApiError ? err.message : "Couldn't load session history. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user, patient.id]);

  // No medical-history backend exists against the current schema — newdb2.txt's
  // redesign dropped patient_medical_history / medical_history_attachments
  // entirely (see schema.prisma's header note), even though api-design.md still
  // documents GET/POST /patients/:id/medical-history from the prior design.
  // hasEarlierSessions has no real source yet (no pagination endpoint for
  // session/medical resources), so keep it fixed at false rather than fabricating data.
  const hasEarlierSessions = false;

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null;

  // Month-based calendar: default to the plan's start month, while allowing
  // navigation to any month so the schedule remains browsable without a plan.
  const monthRange = selectedPlan ? planMonthRange(selectedPlan) : null;
  const todayKey = monthKeyOf(isoOf(new Date()));
  const effectiveMonthKey = viewMonthKey ?? (selectedPlan && monthRange ? monthRange.min : todayKey);
  const monthCells = selectedPlan && effectiveMonthKey ? buildMonthCalendar(selectedPlan, effectiveMonthKey) : [];
  const monthLabel = (() => {
    if (!effectiveMonthKey) return "";
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  })();
  const prevMonthKey = (() => {
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
  })();
  const nextMonthKey = (() => {
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
  })();

  // The Day/Exercise workspace columns mirror this day (see selection effect above).
  const selectedDay =
    selectedPlan && selectedDayIndex !== null && selectedPlan.days && selectedPlan.days[selectedDayIndex]
      ? selectedPlan.days[selectedDayIndex]
      : null;

  // Merges Program Editor's saved plan back into local state when the PT returns
  // from it — see the onOpenProgramEditor prop's comment above for why this
  // arrives as a prop rather than being owned here directly.
  useEffect(() => {
    if (!pendingPlanUpdate) return;
    setPlans((current) => current.map((plan) => (plan.id === pendingPlanUpdate.id ? pendingPlanUpdate : plan)));
  }, [pendingPlanUpdate]);

  // Load plans & attachments from backend
  useEffect(() => {
    if (!token || !patient.id) return;
    let cancelled = false;
    setPlansLoading(true);
    setPlansError(null);
    refreshPlans()
      .catch((err) => {
        if (!cancelled) setPlansError(err instanceof ApiError ? err.message : "Could not load plans");
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });

    refreshAvailableAttachments();

    return () => {
      cancelled = true;
    };
  }, [token, patient.id]);

  // Save plan via backend calls; maps client plan shape to API payloads and
  // updates local state from server response.
  const handleSavePlan = async (
    plan: PatientRehabPlan,
    mode: "edit" | "create",
    selectedAttachments?: Array<{ fileId: string; description?: string }>
  ) => {
    if (!canEditPlan) {
      alert("Only the therapist assigned to this patient can edit rehabilitation plans.");
      return;
    }
    if (!token) {
      alert("Not authenticated");
      return;
    }

    try {
      if (mode === "create") {
        // create on server
        const payload: any = {
          name: plan.name,
          description: plan.description,
          startDate: plan.startDateLabel || undefined,
          endDate: plan.endDateLabel || undefined,
          attachments: selectedAttachments && selectedAttachments.length > 0 ? selectedAttachments : undefined
        };
        const res = await createPatientPlan(token, patient.id, payload);
        const mapped = mapServerPlans([res.plan])[0];

        setPlans((current) => [mapped, ...current]);
        setSelectedPlanId(mapped.id);
        await refreshAvailableAttachments();
      } else {
        // edit existing
        const payload: any = {
          name: plan.name,
          description: plan.description ?? null,
          startDate: plan.startDateLabel || null,
          endDate: plan.endDateLabel || null,
          status: plan.status
        };
        const res = await patchPlan(token, plan.id, payload);
        const mapped = mapServerPlans([res.plan])[0];

        // Sync attachments for existing plan if specified
        if (selectedAttachments && selectedPlan) {
          const currentAtts = selectedPlan.attachments ?? [];
          const currentFileIds = new Set(currentAtts.map((a) => a.fileId));
          const targetFileIds = new Set(selectedAttachments.map((a) => a.fileId));

          // Remove any attachments that were unselected
          for (const att of currentAtts) {
            if (!targetFileIds.has(att.fileId)) {
              try {
                await deletePlanAttachment(token, selectedPlan.id, att.id);
              } catch {
                // best-effort
              }
            }
          }

          // Add any new attachments
          for (const att of selectedAttachments) {
            if (!currentFileIds.has(att.fileId)) {
              try {
                await addPlanAttachment(token, selectedPlan.id, { fileId: att.fileId, description: att.description });
              } catch {
                // best-effort
              }
            }
          }
        }

        await refreshPlans();
        await refreshAvailableAttachments();
        setSelectedPlanId(mapped.id);
      }
    } catch (err) {
      // surface error to therapist; controllers throw ApiError via apiRequest
      const message = err instanceof ApiError ? err.message : String(err);
      alert(`Could not save plan: ${message}`);
      return;
    } finally {
      setShowPlanModal(false);
    }
  };

  // ---- Add schedule day ------------------------------------------------------
  // Real API (mirrors ProgramEditorPage.handleAddDay): POST /plans/:planId/
  // schedule-days with the next computed date — no more window.prompt().
  // The plan's end date is extended to cover the new day (i.e. +1 more day
  // when the plan previously ended at its last scheduled day), then
  // refreshPlans() re-fetches GET /patients/:id/plans.
  const handleAddScheduleDay = async () => {
    if (!canEditPlan) return alert("Only the assigned therapist can edit this patient's schedule.");
    if (!token) return alert("Not authenticated");
    if (!selectedPlan) return alert("No plan selected");
    setAddDayLoading(true);
    setAddDayError(null);
    const scheduledDate = nextScheduledDate(selectedPlan.days ?? []);
    try {
      await createScheduleDay(token, selectedPlan.id, scheduledDate);
      // Extend the plan's end date when the new day falls past it.
      const currentEnd =
        selectedPlan.endDateLabel && ISO_DATE_RE.test(selectedPlan.endDateLabel)
          ? selectedPlan.endDateLabel
          : null;
      if (!currentEnd || scheduledDate > currentEnd) {
        await patchPlan(token, selectedPlan.id, { endDate: scheduledDate });
      }
      await refreshPlans();
    } catch (err) {
      setAddDayError(err instanceof ApiError ? err.message : "Could not add day. Please try again.");
    } finally {
      setAddDayLoading(false);
    }
  };

  // "+" next to the "Rehab plans" column title — opens the plan modal directly
  // in create mode (PlanModal's own "+ New plan" toggle is still available).
  const handleCreatePlanClick = () => {
    if (!canEditPlan) return;
    setPlanModalIntent("create");
    setShowPlanModal(true);
  };

  // Add a scheduled exercise to the first day of the selected plan (simple flow)

  // Same real APIs the old inline DayDetailPanel used, moved into the
  // workspace's Exercise column (UI only redesign — no backend changes).
  const handleEditDayNote = () => {
    if (!selectedDay) return;
    setDayNoteDraft(selectedDay.therapistNote ?? "");
    setEditingDayNote(true);
  };

  const handleSaveDayNote = async () => {
    if (!canEditPlan) return alert("Only the assigned therapist can edit this patient's schedule.");
    if (!token) return alert("Not authenticated");
    if (!selectedDay || !selectedDay.id) return alert("Selected day has no id");
    setDayNoteSaving(true);
    try {
      await patchScheduleDay(token, selectedDay.id, {
        therapistNote: dayNoteDraft.trim() === "" ? undefined : dayNoteDraft.trim()
      });
      await refreshPlans();
      setEditingDayNote(false);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDayNoteSaving(false);
    }
  };

  // ---- Add exercise to the selected day ---------------------------------------
  // Opens the exercise library picker panel (GET /exercises, active items only
  // — same as Program Editor's picker). The actual POST happens in
  // handlePickExercise once a library exercise is chosen.
  const handleAddExerciseToSelectedDay = async () => {
    if (!canEditPlan) return alert("Only the assigned therapist can edit this patient's exercises.");
    if (!selectedDay) return alert("Select a day first");
    setAddExerciseError(null);
    setShowExercisePicker(true);
  };

  const handlePickExercise = async (item: ExerciseLibraryItem) => {
    if (!canEditPlan) return;
    if (!token) return alert("Not authenticated");
    if (!selectedDay || !selectedDay.id) {
      setAddExerciseError("This day hasn't been saved to the server yet.");
      return;
    }
    setAddExerciseLoading(true);
    setAddExerciseError(null);
    const { targetType, targetValueLabel } = defaultTargetForExercise(item);
    try {
      await createScheduledExercise(token, selectedDay.id, {
        exerciseLibraryId: item.id,
        orderNumber: selectedDay.exercises.length + 1,
        targetType,
        targetValue: targetValueLabel,
        therapistInstruction: undefined
      });
      await refreshPlans();
      setShowExercisePicker(false);
    } catch (err) {
      setAddExerciseError(err instanceof ApiError ? err.message : "Could not add exercise. Please try again.");
    } finally {
      setAddExerciseLoading(false);
    }
  };

  const handleSaveExerciseTarget = async (exerciseId: string, targetValue: string) => {
    if (!canEditPlan) return;
    if (!token) return alert("Not authenticated");
    setTargetSavingId(exerciseId);
    try {
      await patchScheduledExercise(token, exerciseId, {
        targetValue: targetValue.trim() === "" ? null : targetValue.trim()
      });
      await refreshPlans();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not save the exercise target.");
    } finally {
      setTargetSavingId(null);
    }
  };

  const handleRemoveExercise = (exerciseId: string, exerciseName: string) => {
    if (!canEditPlan) return;
    setExercisePendingRemoval({ id: exerciseId, name: exerciseName });
  };

  const confirmRemoveExercise = async () => {
    if (!exercisePendingRemoval) return;
    if (!token) {
      alert("Not authenticated");
      return;
    }
    try {
      await deleteScheduledExercise(token, exercisePendingRemoval.id);
      setExercisePendingRemoval(null);
      await refreshPlans();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not remove the exercise.");
    }
  };

  // ---- Delete plan (real DELETE /plans/:planId, full cascade) -----------------
  // Irreversible: wipes the plan, its days/exercises, recorded session results,
  // and attachments — unlike cancelling, which keeps all of that. Gated behind
  // a confirm dialog (same idiom as exercise removal).
  const [planPendingRemoval, setPlanPendingRemoval] = useState<{ id: string; name: string } | null>(null);
  const [deletePlanLoading, setDeletePlanLoading] = useState(false);

  const confirmDeletePlan = async () => {
    if (!planPendingRemoval) return;
    if (!token) {
      alert("Not authenticated");
      return;
    }
    setDeletePlanLoading(true);
    try {
      await deletePlan(token, planPendingRemoval.id);
      const removedId = planPendingRemoval.id;
      const remaining = plans.filter((plan) => plan.id !== removedId);
      setPlanPendingRemoval(null);
      setPlans(remaining);
      // Re-select when the deleted plan was selected: prefer an active plan,
      // else the first remaining one.
      if (selectedPlanId === removedId) {
        const next = remaining.find((plan) => plan.status === "active") ?? remaining[0] ?? null;
        setSelectedPlanId(next ? next.id : "");
      }
      await refreshAvailableAttachments();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not delete the plan.");
    } finally {
      setDeletePlanLoading(false);
    }
  };

  // ---- Remove last day ([ − ] next to [ + ], Days column header) -------------
  // Mirror of "Add day": removing takes the LAST day only — the day is deleted
  // and the plan's end date is pulled back to the new last day's date (both via
  // real APIs: DELETE /schedule-days/:id then PATCH /plans/:id { endDate }). The
  // plan's start date is never touched. Gated behind a confirm dialog because a
  // completed last day takes its recorded results with it.
  const [dayPendingRemoval, setDayPendingRemoval] = useState<{ id: string; label: string; newEndDateLabel: string | null } | null>(null);
  const [deleteDayLoading, setDeleteDayLoading] = useState(false);

  const canRemoveLastDay = canEditPlan && !!selectedPlan && (selectedPlan.days?.length ?? 0) > 1;

  const handleRemoveLastDay = () => {
    if (!canRemoveLastDay || !selectedPlan) return;
    const days = selectedPlan.days ?? [];
    const last = days[days.length - 1];
    const previous = days[days.length - 2];
    if (!last?.id) return;
    // The end date moves to the date of the new last day (one day earlier).
    const newEndDateLabel =
      previous?.dateLabel && ISO_DATE_RE.test(previous.dateLabel) ? previous.dateLabel : null;
    setDayPendingRemoval({
      id: last.id,
      label: last.dateLabel || `Day ${days.length}`,
      newEndDateLabel
    });
  };

  const confirmDeleteDay = async () => {
    if (!dayPendingRemoval || !selectedPlan) return;
    if (!token) {
      alert("Not authenticated");
      return;
    }
    setDeleteDayLoading(true);
    try {
      await deleteScheduleDay(token, dayPendingRemoval.id);
      // Pull the plan's end date back to the new last day's date.
      if (dayPendingRemoval.newEndDateLabel) {
        await patchPlan(token, selectedPlan.id, { endDate: dayPendingRemoval.newEndDateLabel });
      }
      setDayPendingRemoval(null);
      // Clear the day selection; refreshPlans() re-derives the shortened list
      // and the plan's updated endDateLabel.
      setSelectedDayIndex(null);
      setEditingDayNote(false);
      await refreshPlans();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not remove the day.");
    } finally {
      setDeleteDayLoading(false);
    }
  };

  const handleDropExercise = async (targetExerciseId: string) => {
    if (!canEditPlan || !selectedDay?.id || !draggedExerciseId || draggedExerciseId === targetExerciseId) return;
    const fromIndex = selectedDay.exercises.findIndex((exercise) => exercise.id === draggedExerciseId);
    const toIndex = selectedDay.exercises.findIndex((exercise) => exercise.id === targetExerciseId);
    if (fromIndex < 0 || toIndex < 0) return;

    const reordered = [...selectedDay.exercises];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setPlans((current) => current.map((plan) => plan.id !== selectedPlan?.id ? plan : {
      ...plan,
      days: plan.days.map((day) => day.id !== selectedDay.id ? day : {
        ...day,
        exercises: reordered.map((exercise, index) => ({ ...exercise, orderNumber: index + 1 }))
      })
    }));
    setDraggedExerciseId(null);

    try {
      await reorderScheduledExercises(token!, selectedDay.id, reordered.map((exercise) => exercise.id));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not save the exercise order.");
      await refreshPlans();
    }
  };

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Patients" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Patient Detail</h1>
            <p>{patientCode}</p>
          </div>
          <div className="therapist-topbar-actions">
            <button type="button" className="icon-button therapist-bell" aria-label="Notifications">
              <Bell size={17} />
            </button>
            <div className="therapist-topbar-profile">
              <div>
                <strong>{therapistDisplayName}</strong>
                <small>Physical Therapist</small>
              </div>
              <span className="avatar-badge">{initialsFromName(therapistDisplayName)}</span>
            </div>
          </div>
        </header>

        <main className="therapist-main">
          <button type="button" className="text-action pd-back-link" onClick={onBack}>
            <ArrowLeft size={14} /> All patients
          </button>

          <div className="pd-patient-info-layout">
            <div
              className={`pd-patient-profile-avatar${patientAvatarUrl ? " with-photo" : ""}`}
              aria-label={`Profile picture for ${patient.name}`}
            >
              {patientAvatarUrl ? (
                <img src={patientAvatarUrl} alt={`${patient.name}'s profile picture`} />
              ) : (
                patient.avatarInitials
              )}
            </div>
            <section className="summary-card pd-patient-info-card">
              <div className="pd-patient-info-columns">
                <div className="pd-patient-info-group">
                  <h3>Personal information</h3>
                  <div className="pd-patient-info-grid">
                    <div><span>Full name</span><strong>{patient.name}</strong></div>
                    <div><span>Username</span><strong>{patient.username || "—"}</strong></div>
                    <div><span>Gender</span><strong>{patient.gender && patient.gender !== "unknown" ? patient.gender : "Not recorded"}</strong></div>
                    <div><span>Date of birth</span><strong>{patient.dateOfBirth || "—"}</strong></div>
                    <div><span>Height</span><strong>{patient.heightCm !== null ? `${patient.heightCm} cm` : "—"}</strong></div>
                    <div><span>Weight</span><strong>{patient.weightKg !== null ? `${patient.weightKg} kg` : "—"}</strong></div>
                    <div><span>Account status</span><strong>{patient.accountStatus || "—"}</strong></div>
                    <div><span>Last login</span><strong>{patient.lastLoginLabel || "—"}</strong></div>
                  </div>
                </div>
                <div className="pd-patient-info-group">
                  <h3>Contact information</h3>
                  <div className="pd-patient-info-grid">
                    <div><span>Email</span><strong>{patient.email || "—"}</strong></div>
                    <div><span>Phone number</span><strong>{patient.phoneNumber || "—"}</strong></div>
                    <div><span>Assigned therapist</span><strong>{assignedTherapist?.displayName || patient.assignedTherapistName || "Unassigned"}</strong></div>
                    <div className="pd-patient-info-wide"><span>Address</span><strong>{patient.address || "—"}</strong></div>
                    <div><span>Emergency contact</span><strong>{patient.emergencyContactName || "—"}</strong></div>
                    <div><span>Emergency phone</span><strong>{patient.emergencyContactPhone || "—"}</strong></div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          {!canEditPlan && assignedTherapist && (
            <div className="pd-read-only-notice" role="status">
              This patient is assigned to <strong>{assignedTherapist.displayName}</strong>. You can view the plan manager, but only the assigned therapist can make changes.
            </div>
          )}
          {!canEditPlan && assignedTherapist === null && (
            <div className="pd-read-only-notice" role="status">
              This patient is not currently assigned to a therapist. You can view the plan manager, but plan editing is unavailable.
            </div>
          )}

          {/* 2. Therapist workspace: Calendar | Plan | Day | Exercise — one
              connected four-column panel (desktop-only page). Visual hierarchy
              runs left → right: the calendar anchors the schedule, the plan
              list scopes it, the day list picks the session, and the exercise
              column mirrors the selected day. All write actions still hit the
              same real endpoints as before; nothing backend-facing changed. */}
          <div className="summary-card pd-plan-card">
            {selectedPlan ? (
              <div className="pd-workspace">
                {/* Column 1 — Calendar */}
                <div className="pd-ws-col pd-ws-calendar">
                  <div className="pd-ws-col-head">
                    <span className="pd-ws-step">1</span>
                    <div>
                      <strong>Schedule</strong>
                      <small>{calendarPeriodLabel(selectedPlan)}</small>
                    </div>
                  </div>
                  {/* Month-based calendar: full Sun-first grid (up to 6 week
                      rows) for the viewed month. Unrelated days (outside the
                      plan's range) and adjacent-month padding are shadowed out. */}
                  <div className="pd-calendar-header">
                    <button
                      type="button"
                      className="icon-button pd-calendar-nav"
                      onClick={() => setViewMonthKey(prevMonthKey)}
                      aria-label="Previous month"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <strong>{monthLabel}</strong>
                    <button
                      type="button"
                      className="icon-button pd-calendar-nav"
                      onClick={() => setViewMonthKey(nextMonthKey)}
                      aria-label="Next month"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="pd-calendar-weekdays">
                    {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                      <span key={index}>{day}</span>
                    ))}
                  </div>
                  <div className="pd-calendar-grid">
                    {monthCells.map((cell) => {
                      // Days that belong to the plan are rendered with their
                      // real status color even when they sit in the grid's
                      // leading/trailing adjacent-month cells (e.g. a plan
                      // running Aug 28 → Sep 2 shows Sep 1–2 colored at the
                      // start of September's grid and Aug 28–31 colored at
                      // the end of August's grid) — only the "soft" fade of
                      // unrelated adjacent days (.adjacent) distinguishes
                      // them. Adjacent cells with NO plan day stay faded.
                      const hasPlanDay = cell.dayIndex !== null && cell.status !== null;
                      const className = [
                        "pd-calendar-cell",
                        hasPlanDay ? cell.status : "",
                        hasPlanDay && cell.otherMonth ? "adjacent" : "",
                        !hasPlanDay ? (cell.otherMonth ? "other" : cell.outside ? "outside" : "empty") : "",
                        cell.dayIndex !== null ? "clickable" : "",
                        cell.dayIndex !== null && cell.dayIndex === selectedDayIndex ? "selected" : ""
                      ].join(" ").trim();
                      return (
                        <button
                          key={cell.key}
                          type="button"
                          className={className}
                          title={
                            hasPlanDay
                              ? `${cell.iso} · ${heatmapLabels[cell.status!]}${cell.otherMonth ? " (next/prev month)" : ""}`
                              : cell.otherMonth
                                ? undefined
                                : `${cell.iso}${cell.outside ? " · No session scheduled" : ""}`
                          }
                          onClick={() => cell.dayIndex !== null && handleSelectDay(cell.dayIndex)}
                        >
                          {cell.dateNumber ?? ""}
                        </button>
                      );
                    })}
                  </div>
                  <div className="pd-legend">
                    {(["completed", "in_progress", "skipped", "pending", "cancelled"] as HeatmapDayStatus[]).map((status) => (
                      <span key={status}>
                        <span className={`pd-legend-dot ${status}`} />
                        {heatmapLabels[status]}
                      </span>
                    ))}
                  </div>
                  <p className="pd-ws-footnote">
                    Day {planProgress(selectedPlan).current} of {planProgress(selectedPlan).total} &middot;{" "}
                    {selectedPlan.name}
                  </p>
                </div>

                {/* Column 2 — Plan */}
                <div className="pd-ws-col">
                  <div className="pd-ws-col-head">
                    <span className="pd-ws-step">2</span>
                    <div>
                      <span className="pd-ws-title-row">
                        <strong>Plan</strong>
                        <button
                          type="button"
                          className="icon-button pd-ws-add"
                          title="Create new plan"
                          aria-label="Create new plan"
                          onClick={handleCreatePlanClick}
                          disabled={!canEditPlan}
                        >
                          <Plus size={13} />
                        </button>
                      </span>
                      <small>{plans.length} plan{plans.length === 1 ? "" : "s"}</small>
                    </div>
                  </div>
                  <div className="pd-ws-scroll pd-ws-plan-list">
                    {plans.map((plan) => {
                      const progress = planProgress(plan);
                      const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={`pd-plan-row ${plan.id === selectedPlan.id ? "active" : ""}`}
                          onClick={() => setSelectedPlanId(plan.id)}
                        >
                          <span className="pd-plan-row-top">
                            <strong>{plan.name}</strong>
                            <span className={`pd-program-status ${plan.status}`}>{planStatusLabels[plan.status]}</span>
                          </span>
                          <small className="pd-plan-row-dates">
                            {plan.startDateLabel || "No start date"}
                            {plan.endDateLabel ? ` \u2192 ${plan.endDateLabel}` : ""}
                          </small>
                          <span className="pd-progress-track" aria-hidden="true">
                            <span className="pd-progress-fill" style={{ width: `${pct}%` }} />
                          </span>
                          <small>Day {progress.current} of {progress.total} &middot; {pct}%</small>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pd-ws-actions">
                    {/* Edit/delete live in this popup; creation is the "+" icon
                        button on the column header above. */}
                    <button
                      type="button"
                      className="secondary-button full-width"
                      onClick={() => {
                        if (plans.length === 0) {
                          if (canEditPlan) {
                            setPlanModalIntent("create");
                            setShowPlanModal(true);
                          }
                          return;
                        }
                        setPlanModalIntent("view");
                        setShowPlanModal(true);
                      }}
                    >
                      <ClipboardList size={14} /> {canEditPlan ? (plans.length === 0 ? "Create a plan" : "Edit plan") : "Plan details (read-only)"}
                    </button>
                  </div>
                </div>

                {/* Column 3 — Day */}
                <div className="pd-ws-col">
                  <div className="pd-ws-col-head">
                    <span className="pd-ws-step">3</span>
                    <div>
                      <span className="pd-ws-title-row">
                        <strong>Days</strong>
                        {/* [ − ] / [ + ] grouped together — remove/add a day at
                            the plan's end, kept visually as one tight pair. */}
                        <span className="pd-ws-day-actions">
                          <button
                            type="button"
                            className="icon-button pd-ws-add"
                            title="Remove last day (moves the plan's end date back one day)"
                            aria-label="Remove last day"
                            onClick={handleRemoveLastDay}
                            disabled={!canRemoveLastDay || deleteDayLoading}
                          >
                            <Minus size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button pd-ws-add"
                            title="Add schedule day (extends the plan's end date by one day)"
                            aria-label="Add schedule day"
                            onClick={handleAddScheduleDay}
                            disabled={!canEditPlan || addDayLoading}
                          >
                            <Plus size={13} />
                          </button>
                        </span>
                      </span>
                      <small>
                        {selectedPlan.days && selectedPlan.days.length > 0
                          ? `${selectedPlan.days.length} day${selectedPlan.days.length === 1 ? "" : "s"} scheduled`
                          : "No days scheduled"}
                      </small>
                    </div>
                  </div>
                  {selectedPlan.days && selectedPlan.days.length > 0 ? (
                    <div className="pd-ws-scroll pd-ws-day-list">
                      {selectedPlan.days.map((day, idx) => (
                        <button
                          key={day.id ?? `day-${idx}`}
                          type="button"
                          className={`pd-day-row ${idx === selectedDayIndex ? "active" : ""}`}
                          onClick={() => setSelectedDayIndex(idx)}
                        >
                          <span className="pd-day-row-top">
                            <strong>{day.dateLabel ?? `Day ${idx + 1}`}</strong>
                            <span className={`pd-day-status ${day.status}`}>{heatmapLabels[day.status]}</span>
                          </span>
                          <small>
                            {day.exercises.length} exercise{day.exercises.length === 1 ? "" : "s"}
                            {day.therapistNote ? " \u00b7 has note" : ""}
                          </small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="pd-ws-empty">
                      <Calendar size={22} />
                      <strong>No rehab days yet</strong>
                      <p>Add a schedule day to this plan to start assigning exercises.</p>
                    </div>
                  )}
                </div>

                {/* Column 4 — Exercise */}
                <div className="pd-ws-col pd-ws-exercises">
                  <div className="pd-ws-col-head">
                    <span className="pd-ws-step">4</span>
                    <div>
                      <span className="pd-ws-title-row">
                        <strong>Exercises</strong>
                        <button
                          type="button"
                          className="secondary-button pd-ws-add-exercise"
                          title="Add exercise from library"
                          aria-label="Add exercise from library"
                          onClick={handleAddExerciseToSelectedDay}
                          disabled={!canEditPlan || !selectedDay}
                        >
                          <Plus size={14} /> Add exercise
                        </button>
                      </span>
                      <small>
                        {selectedDay
                          ? (selectedDay.dateLabel ?? `Day ${(selectedDayIndex ?? 0) + 1}`) + ` \u00b7 ${heatmapLabels[selectedDay.status]}`
                          : "Select a day"}
                      </small>
                    </div>
                  </div>

                  {selectedDay ? (
                    <>
                      <div className="pd-day-context">
                        <span className={`pd-day-status ${selectedDay.status}`}>{heatmapLabels[selectedDay.status]}</span>
                        {editingDayNote ? (
                          <textarea
                            className="pd-day-note-editor"
                            value={dayNoteDraft}
                            onChange={(event) => setDayNoteDraft(event.target.value)}
                            placeholder="Enter a therapist note for this day."
                            rows={3}
                            disabled={!canEditPlan || dayNoteSaving}
                          />
                        ) : selectedDay.therapistNote ? (
                          <p className="pd-day-note">{selectedDay.therapistNote}</p>
                        ) : (
                          <p className="pd-day-note pd-day-note-empty">No therapist note for this day.</p>
                        )}
                        <div className="pd-day-context-actions">
                          <button type="button" className="text-action" onClick={handleEditDayNote} disabled={!canEditPlan}>
                            <Save size={13} /> Edit note
                          </button>
                          {editingDayNote && (
                            <button type="button" className="text-action" onClick={handleSaveDayNote} disabled={!canEditPlan || dayNoteSaving}>
                              <Save size={13} /> {dayNoteSaving ? "Saving\u2026" : "Save"}
                            </button>
                          )}
                        </div>
                        {addExerciseError && (
                          <p className="pd-empty-note" role="alert" style={{ margin: 0, color: "var(--error)" }}>
                            {addExerciseError}
                          </p>
                        )}
                      </div>

                      {selectedDay.exercises.length > 0 ? (
                        <div className="pd-ws-scroll pd-ex-list">
                          {selectedDay.exercises.map((ex) => {
                            return (
                              <div
                                key={ex.id}
                                className={`pd-ex-row ${ex.status}`}
                                draggable={canEditPlan}
                                onDragStart={() => setDraggedExerciseId(ex.id)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => void handleDropExercise(ex.id)}
                                onDragEnd={() => setDraggedExerciseId(null)}
                              >
                                <span className="pd-ex-drag-handle" title={canEditPlan ? "Drag to reorder" : undefined} aria-hidden="true">
                                  <GripVertical size={15} />
                                </span>
                                <div className="pd-ex-content">
                                  <div className="pd-ex-topline">
                                    <strong>
                                      {ex.exerciseName}
                                      {ex.versionLabel ? <small className="pd-ex-version"> {ex.versionLabel}</small> : null}
                                    </strong>
                                    <div className="pd-ex-top-meta">
                                      {ex.difficultyLevel && (
                                        <span className={`difficulty-badge ${difficultyBadgeClass[ex.difficultyLevel]}`}>
                                          {difficultyLabels[ex.difficultyLevel]}
                                        </span>
                                      )}
                                      <span className={`pd-ex-status ${ex.status}`}>{exerciseStatusLabel[ex.status]}</span>
                                      <button
                                        type="button"
                                        className="pd-ex-remove"
                                        onClick={() => void handleRemoveExercise(ex.id, ex.exerciseName)}
                                        disabled={!canEditPlan}
                                        title="Remove exercise from this day"
                                        aria-label={`Remove ${ex.exerciseName} from this day`}
                                      >
                                        <X size={13} />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="pd-ex-bottomline">
                                    <small>{trackingLabels[ex.movementTracking]}</small>
                                    <div className="pd-ex-actions">
                                      <TargetValueControl
                                        value={ex.targetValueLabel}
                                        disabled={!canEditPlan || targetSavingId === ex.id}
                                        onSave={(value) => {
                                          if (value !== ex.targetValueLabel) void handleSaveExerciseTarget(ex.id, value);
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="pd-ex-view"
                                        onClick={() => onOpenExercise?.(ex.exerciseLibraryId)}
                                        disabled={!onOpenExercise}
                                      >
                                        View
                                      </button>
                                    </div>
                                  </div>
                                  {ex.therapistInstruction ? <p className="pd-ex-note">{ex.therapistInstruction}</p> : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="pd-ws-empty">
                          <Dumbbell size={22} />
                          <strong>No exercises assigned</strong>
                          <p>This day has no exercises yet — add one from the exercise library.</p>
                          <button type="button" className="secondary-button" onClick={handleAddExerciseToSelectedDay} disabled={!canEditPlan}>
                            <Plus size={14} /> Add exercise
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="pd-ws-empty">
                      <Eye size={22} />
                      <strong>No day selected</strong>
                      <p>Pick a rehab day from the Day column (or a date on the calendar) to see its exercises.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="pd-ws-empty pd-ws-empty-plan">
                <ClipboardList size={24} />
                <strong>This patient has no rehabilitation plan yet</strong>
                <p>{canEditPlan ? "Create a plan to start scheduling rehab days and exercises." : "No plan has been created yet."}</p>
                {canEditPlan && (
                  <button type="button" className="secondary-button" onClick={handleCreatePlanClick}>
                    <ClipboardList size={14} /> Create plan
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 3. Session history — now full width. REMOVED in this pass: the old
              side-by-side "Plan Medical Attachments" card (attachment list,
              View/Remove actions, "Attach file" button) and its dedicated
              AddAttachmentModal/FileViewModal dialogs. Plan-level attachment
              management still exists inside the View / edit / create plan modal. */}
          <div className="summary-card pd-session-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>Session history</strong>
                  <p>
                    {sessionsLoading
                      ? "Loading\u2026"
                      : `${sessionHistory.length} session${sessionHistory.length === 1 ? "" : "s"} recorded`}
                  </p>
                </div>
              </div>

              {sessionsError && (
                <p className="pd-empty-note" role="alert">
                  {sessionsError}
                </p>
              )}

              {sessionsLoading ? (
                <p className="pd-empty-note">Loading session history\u2026</p>
              ) : sessionHistory.length === 0 ? (
                <p className="pd-empty-note">No sessions recorded yet.</p>
              ) : (
                <>
                  <div className="pd-session-list">
                    {sessionHistory.map((session) => (
                      <div key={session.id} className="pd-session-row">
                        <div>
                          <span>
                            {session.dateLabel} &middot; {session.dayLabel}
                          </span>
                          <small>{session.exercisesAttempted} exercises attempted</small>
                        </div>
                        <div className="pd-session-actions">
                          {session.outcome === "skipped" ? (
                            <span className="pd-session-skipped">Skipped</span>
                          ) : (
                            <span className="pd-session-score">Avg {session.avgScore}</span>
                          )}
                          {session.evaluationSource && (
                            <span className={`pd-session-source ${session.evaluationSource}`}>
                              {session.evaluationSource === "ai" ? "AI-scored" : "PT-reviewed"}
                            </span>
                          )}
                          {/* Real: routes to SessionResultReviewPage (§2.7), which
                              was only a static mockup (session-result-review.html)
                              until now. */}
                          <button type="button" className="text-action" onClick={() => onReviewSession(session)}>
                            Review <ChevronRight size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Stub: no earlier-session pagination endpoint exists yet — kept
                      as inert text matching the mockup rather than a toggle with
                      nothing to reveal. */}
                  {hasEarlierSessions && <p className="pd-show-more">Show earlier sessions</p>}
                </>
              )}
          </div>
        </main>
      </div>

      {showPlanModal && (
        <PlanModal
          selectedPlan={planModalIntent === "create" || plans.length === 0 ? null : selectedPlan}
          mode={planModalIntent === "create" || plans.length === 0 ? "create" : "edit"}
          availableAttachments={availableAttachments}
          availableFiles={availableFiles}
          token={token ?? null}
          onFileUploaded={(uploaded) => setAvailableFiles((current) => [...current, uploaded])}
          onClose={() => {
            setShowPlanModal(false);
            setPlanModalIntent("view");
          }}
          onSave={handleSavePlan}
          onDeleteRequest={() => {
            if (!selectedPlan) return;
            setShowPlanModal(false);
            setPlanModalIntent("view");
            setPlanPendingRemoval({ id: selectedPlan.id, name: selectedPlan.name });
          }}
        />
      )}
      {showExercisePicker && selectedDay && (
        <ExercisePickerPanel
          token={token ?? null}
          onClose={() => setShowExercisePicker(false)}
          onPick={handlePickExercise}
          alreadyAddedIds={selectedDay.exercises.map((ex) => ex.exerciseLibraryId)}
          loading={addExerciseLoading}
        />
      )}
      {dayPendingRemoval && (
        <div className="therapist-panel-scrim" onClick={() => setDayPendingRemoval(null)}>
          <div className="pd-modal pd-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-day-title" onClick={(event) => event.stopPropagation()}>
            <div className="therapist-detail-header">
              <strong id="remove-day-title">Remove day?</strong>
              <button type="button" className="icon-button" onClick={() => setDayPendingRemoval(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="pd-confirm-message">
              Remove the last day <strong>{dayPendingRemoval.label}</strong> from this plan? Its exercises and any
              recorded results for that day are deleted with it
              {dayPendingRemoval.newEndDateLabel ? (
                <>
                  {" "}and the plan's end date moves to <strong>{dayPendingRemoval.newEndDateLabel}</strong>
                </>
              ) : null}
              .
            </p>
            <div className="pd-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setDayPendingRemoval(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                style={{ background: "var(--danger, #d33)" }}
                disabled={deleteDayLoading}
                onClick={() => void confirmDeleteDay()}
              >
                {deleteDayLoading ? "Removing…" : "Remove day"}
              </button>
            </div>
          </div>
        </div>
      )}
      {planPendingRemoval && (
        <div className="therapist-panel-scrim" onClick={() => setPlanPendingRemoval(null)}>
          <div className="pd-modal pd-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-plan-title" onClick={(event) => event.stopPropagation()}>
            <div className="therapist-detail-header">
              <strong id="delete-plan-title">Delete plan?</strong>
              <button type="button" className="icon-button" onClick={() => setPlanPendingRemoval(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="pd-confirm-message">
              Permanently delete <strong>{planPendingRemoval.name}</strong>? This also removes its schedule days,
              exercises, attachments, and ALL recorded session history for this plan. This cannot be undone — use
              &ldquo;Cancelled&rdquo; status instead to keep the history.
            </p>
            <div className="pd-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setPlanPendingRemoval(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                style={{ background: "var(--danger, #d33)" }}
                disabled={deletePlanLoading}
                onClick={() => void confirmDeletePlan()}
              >
                {deletePlanLoading ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
      {exercisePendingRemoval && (
        <div className="therapist-panel-scrim" onClick={() => setExercisePendingRemoval(null)}>
          <div className="pd-modal pd-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-exercise-title" onClick={(event) => event.stopPropagation()}>
            <div className="therapist-detail-header">
              <strong id="remove-exercise-title">Remove exercise?</strong>
              <button type="button" className="icon-button" onClick={() => setExercisePendingRemoval(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="pd-confirm-message">
              Remove <strong>{exercisePendingRemoval.name}</strong> from this rehabilitation day?
            </p>
            <div className="pd-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setExercisePendingRemoval(null)}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={() => void confirmRemoveExercise()}>
                Remove exercise
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Exercise library picker panel ─────────────────────────────────────────────
// Mirrors ProgramEditorPage's ExercisePickerPanel: loads the library via
// GET /exercises (real API), offers only status:"active" exercises, disables
// ones already assigned to the selected day, and hands the picked item to
// onPick (which POSTs /schedule-days/:dayId/exercises).
function ExercisePickerPanel({
  token,
  onClose,
  onPick,
  alreadyAddedIds,
  loading: parentLoading
}: {
  token: string | null;
  onClose: () => void;
  onPick: (item: ExerciseLibraryItem) => Promise<void>;
  alreadyAddedIds: string[];
  loading: boolean;
}) {
  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setFetchError("Not authenticated.");
      setFetchLoading(false);
      return;
    }
    let cancelled = false;
    setFetchLoading(true);
    setFetchError(null);

    getExerciseLibrary(token)
      .then((res) => {
        if (!cancelled) setExercises(res.exercises ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err instanceof ApiError ? err.message : "Could not load exercises. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setFetchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const assignable = exercises.filter((item) => item.status === "active");

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <aside className="therapist-detail-panel" aria-label="Add exercise from library">
        <div className="therapist-detail-header">
          <strong>Add exercise from library</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {fetchLoading ? (
          <p className="pd-empty-note">Loading exercises{"\u2026"}</p>
        ) : fetchError ? (
          <p className="pd-empty-note" role="alert" style={{ color: "var(--error, #c0392b)" }}>
            {fetchError}
          </p>
        ) : assignable.length === 0 ? (
          <p className="pd-empty-note">No active exercises in the library yet.</p>
        ) : (
          <div className="pe-picker-list">
            {assignable.map((item) => {
              const Icon = trackingIcon[item.movementTracking];
              const alreadyAdded = alreadyAddedIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="pe-picker-row"
                  disabled={alreadyAdded || parentLoading}
                  onClick={() => onPick(item)}
                >
                  <span className={`pe-exercise-icon tracking-${item.movementTracking}`}>
                    <Icon size={17} />
                  </span>
                  <div className="pe-exercise-info">
                    <strong>
                      {item.name}{" "}
                      <small style={{ color: "var(--text-secondary)" }}>v{item.versionNumber}</small>
                    </strong>
                    <small>{trackingLabels[item.movementTracking]}</small>
                  </div>
                  {alreadyAdded && <span className="library-status-badge active">Added</span>}
                </button>
              );
            })}
          </div>
        )}
      </aside>
    </>
  );
}




function formatFileSize(bytes?: number | null): string {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type?: string) {
  if (type === "image") return <ImageIcon size={16} />;
  if (type === "video") return <FileVideo size={16} />;
  return <FileText size={16} />;
}

interface AvailableFileItem {
  fileId: string;
  originalName: string;
  fileType: "image" | "video" | "document" | "audio" | "other";
  mimeType?: string | null;
  fileSize?: number | null;
  defaultDescription?: string | null;
  uploadedAtLabel?: string;
}

function PlanModal({
  selectedPlan,
  mode,
  availableAttachments,
  availableFiles,
  token,
  onFileUploaded,
  onClose,
  onSave,
  onDeleteRequest
}: {
  selectedPlan: PatientRehabPlan | null;
  // Fixed mode: the "+" button opens this modal in "create", the bottom
  // "Edit plan" button in "edit" — there is no in-modal switcher anymore.
  mode: "edit" | "create";
  availableAttachments: PlanAttachment[];
  availableFiles: PlanAttachmentFile[];
  // Auth token for the real POST /files upload behind "Attach medical file".
  token: string | null;
  // Called after a real upload succeeds — the parent appends the new files row
  // to its availableFiles list so it shows in the checkbox list immediately.
  onFileUploaded: (file: PlanAttachmentFile) => void;
  onClose: () => void;
  onSave: (
    plan: PatientRehabPlan,
    mode: "edit" | "create",
    selectedAttachments?: Array<{ fileId: string; description?: string }>
  ) => void;
  // Edit mode only: "Delete plan" hands off to the parent's confirm dialog
  // (which closes this modal and opens the destructive-delete warning).
  onDeleteRequest?: () => void;
}) {
  const [name, setName] = useState(selectedPlan?.name ?? "");
  const [description, setDescription] = useState(selectedPlan?.description ?? "");
  const [status, setStatus] = useState<RehabPlanStatus>(selectedPlan?.status ?? "draft");
  const [startDateLabel, setStartDateLabel] = useState(
    selectedPlan && ISO_DATE_RE.test(selectedPlan.startDateLabel) ? selectedPlan.startDateLabel : ""
  );
  const [endDateLabel, setEndDateLabel] = useState(
    selectedPlan?.endDateLabel && ISO_DATE_RE.test(selectedPlan.endDateLabel) ? selectedPlan.endDateLabel : ""
  );
  const [startDateInput, setStartDateInput] = useState(displayDateLabel(startDateLabel));
  const [endDateInput, setEndDateInput] = useState(displayDateLabel(endDateLabel));
  const todayDateLabel = new Date().toISOString().slice(0, 10);

  // Combine unique available files for this patient
  const uniqueAvailableFiles: AvailableFileItem[] = [];
  const seenFileIds = new Set<string>();

  for (const att of availableAttachments) {
    if (att.file && !seenFileIds.has(att.fileId)) {
      seenFileIds.add(att.fileId);
      uniqueAvailableFiles.push({
        fileId: att.fileId,
        originalName: att.file.originalName,
        fileType: att.file.fileType,
        mimeType: att.file.mimeType,
        fileSize: att.file.fileSize,
        defaultDescription: att.description,
        uploadedAtLabel: att.uploadedAtLabel
      });
    }
  }

  for (const f of availableFiles) {
    if (!seenFileIds.has(f.id)) {
      seenFileIds.add(f.id);
      uniqueAvailableFiles.push({
        fileId: f.id,
        originalName: f.originalName,
        fileType: f.fileType,
        mimeType: f.mimeType,
        fileSize: f.fileSize,
        defaultDescription: undefined,
        uploadedAtLabel: undefined
      });
    }
  }

  // Selected attachments in this modal: map of fileId -> description
  const [selectedAttachmentsMap, setSelectedAttachmentsMap] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (selectedPlan?.attachments) {
      for (const att of selectedPlan.attachments) {
        init[att.fileId] = att.description ?? "";
      }
    }
    return init;
  });
  // Real medical-file upload behind "Attach medical file": the picked file goes
  // to POST /files (shared files module — same storage as every other upload),
  // the resulting files row is handed to the parent (which adds it to the
  // available-files list) and immediately selected as an attachment so plan
  // create/edit links it via the usual attachments payload.
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const medicalFileInputRef = useRef<HTMLInputElement>(null);

  const handleMedicalFilePicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow re-picking the same file after a failure.
    event.target.value = "";
    if (!file) return;
    if (!token) {
      setUploadError("Please log in again to attach files.");
      return;
    }
    setUploadingFile(true);
    setUploadError(null);
    try {
      const res = await uploadFile(token, file);
      const uploaded: PlanAttachmentFile = {
        id: res.file.id,
        originalName: res.file.originalName,
        fileType: res.file.fileType,
        mimeType: res.file.mimeType,
        fileSize: res.file.fileSize
      };
      onFileUploaded(uploaded);
      // Auto-select the new file as an attachment for this plan.
      setSelectedAttachmentsMap((current) => (uploaded.id in current ? current : { ...current, [uploaded.id]: "" }));
    } catch (err) {
      setUploadError(
        err instanceof ApiError
          ? err.message
          : "Could not upload the file. Please try again."
      );
    } finally {
      setUploadingFile(false);
    }
  };

  const toggleAttachment = (fileId: string, defaultDesc = "") => {
    setSelectedAttachmentsMap((current) => {
      const next = { ...current };
      if (fileId in next) {
        delete next[fileId];
      } else {
        next[fileId] = defaultDesc;
      }
      return next;
    });
  };

  const updateAttachmentDescription = (fileId: string, desc: string) => {
    setSelectedAttachmentsMap((current) => ({
      ...current,
      [fileId]: desc
    }));
  };

  // The modal is mounted fresh each open with a fixed mode (create via the
  // column's "+" button, edit via the bottom "Edit plan" button) — no
  // in-modal switcher, so no switchMode reset logic is needed.

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !startDateLabel || !endDateLabel) return;

    const attachmentPayload = Object.entries(selectedAttachmentsMap).map(([fileId, desc]) => ({
      fileId,
      description: desc.trim() || undefined
    }));

    if (mode === "edit" && selectedPlan) {
      onSave(
        {
          ...selectedPlan,
          name: name.trim(),
          description: description.trim() || undefined,
          status,
          startDateLabel,
          endDateLabel
        },
        "edit",
        attachmentPayload
      );
    } else {
      onSave(
        {
          id: `plan-${Date.now()}`,
          name: name.trim(),
          description: description.trim() || undefined,
          status,
          startDateLabel,
          endDateLabel,
          heatmap: Array.from({ length: daysBetweenInclusive(startDateLabel, endDateLabel) }, () => "pending" as HeatmapDayStatus),
          days: Array.from({ length: daysBetweenInclusive(startDateLabel, endDateLabel) }, () => ({
            status: "pending" as HeatmapDayStatus,
            exercises: []
          }))
        },
        "create",
        attachmentPayload
      );
    }
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="pd-modal" role="dialog" aria-label="Manage rehabilitation plan" style={{ width: "min(100%, 540px)" }}>
        <div className="therapist-detail-header">
          <strong>{mode === "create" ? "New rehabilitation plan" : "Edit rehabilitation plan"}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form className="pd-modal-form" onSubmit={handleSubmit}>
          <label>
            Plan name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Initial Stroke Recovery Plan"
              required
            />
          </label>

          <label>
            Description (optional)
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
          </label>

          <label>
            Status
            <select
              className="admin-role-select"
              value={status}
              onChange={(event) => setStatus(event.target.value as RehabPlanStatus)}
            >
              {(["draft", "active", "completed", "cancelled"] as RehabPlanStatus[]).map((value) => (
                <option key={value} value={value}>
                  {planStatusLabels[value]}
                </option>
              ))}
            </select>
          </label>

          <div className="library-toggle-row">
            <label>
              Start date
              <div className="date-input-with-calendar">
                <input type="text" inputMode="numeric" placeholder="dd/mm/yyyy" value={startDateInput} onChange={(event) => {
                  const value = isoDateFromDisplay(event.target.value);
                  setStartDateInput(event.target.value);
                  if (value) {
                    setStartDateLabel(value);
                    if (endDateLabel && endDateLabel < value) {
                      setEndDateLabel(value);
                      setEndDateInput(displayDateLabel(value));
                    }
                  }
                }} required />
                <span className="date-calendar-icon" aria-hidden="true"><Calendar size={16} /></span>
                <input className="native-calendar-trigger" type="date" value={startDateLabel} min={mode === "create" ? todayDateLabel : undefined} aria-label="Choose start date" onChange={(event) => {
                  const value = event.target.value;
                  setStartDateLabel(value);
                  setStartDateInput(displayDateLabel(value));
                  if (endDateLabel && endDateLabel < value) {
                    setEndDateLabel(value);
                    setEndDateInput(displayDateLabel(value));
                  }
                }} />
              </div>
            </label>
            <label>
              End date
              <div className="date-input-with-calendar">
                <input type="text" inputMode="numeric" placeholder="dd/mm/yyyy" value={endDateInput} onChange={(event) => {
                  const value = isoDateFromDisplay(event.target.value);
                  setEndDateInput(event.target.value);
                  if (value) setEndDateLabel(value);
                }} required />
                <span className="date-calendar-icon" aria-hidden="true"><Calendar size={16} /></span>
                <input className="native-calendar-trigger" type="date" value={endDateLabel} min={startDateLabel || todayDateLabel} aria-label="Choose end date" onChange={(event) => {
                  const value = event.target.value;
                  setEndDateLabel(value);
                  setEndDateInput(displayDateLabel(value));
                }} />
              </div>
            </label>
          </div>

          {/* Medical Attachments selection */}
          <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <Paperclip size={14} /> Medical Attachments
            </label>
            {/* Real upload: picks a file, POSTs it to /files, then selects it
                as an attachment — the files row is linked to the plan through
                rehabilitation_plan_attachments when the form is saved. */}
            <input
              ref={medicalFileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={handleMedicalFilePicked}
              aria-label="Choose medical file to upload"
            />
            {uploadError && (
              <p className="auth-error-banner" role="alert" style={{ margin: 0 }}>
                {uploadError}
              </p>
            )}
            <button
              type="button"
              className="secondary-button pd-mock-attachment-button"
              onClick={() => medicalFileInputRef.current?.click()}
              disabled={uploadingFile || !token}
            >
              <Paperclip size={14} /> {uploadingFile ? "Uploading…" : "Attach medical file"}
            </button>
            {uniqueAvailableFiles.length === 0 ? (
              <p className="pd-empty-note" style={{ margin: 0, padding: "10px 0", fontSize: "0.8rem" }}>
                No medical files or attachments available for this patient yet.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 8, maxHeight: 180, overflowY: "auto", paddingRight: 2 }}>
                {uniqueAvailableFiles.map((file) => {
                  const isChecked = file.fileId in selectedAttachmentsMap;
                  const isOriginallyAttached = selectedPlan?.attachments?.some((a) => a.fileId === file.fileId);
                  return (
                    <div
                      key={file.fileId}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: "8px 10px",
                        background: isChecked ? "var(--primary-light)" : "var(--card)",
                        display: "grid",
                        gap: 6
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            margin: 0,
                            fontWeight: 500,
                            fontSize: "0.82rem"
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleAttachment(file.fileId, file.defaultDescription ?? "")}
                          />
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {getFileIcon(file.fileType)}
                            <strong>{file.originalName}</strong>
                          </span>
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {isOriginallyAttached && mode === "edit" && (
                            <span className="pd-program-status active" style={{ fontSize: "0.7rem", padding: "1px 6px" }}>
                              Attached
                            </span>
                          )}
                          <small style={{ color: "var(--text-secondary)", fontSize: "0.72rem" }}>
                            {formatFileSize(file.fileSize)}
                          </small>
                        </div>
                      </div>

                      {isChecked && (
                        <input
                          type="text"
                          placeholder="Optional attachment note/description..."
                          value={selectedAttachmentsMap[file.fileId] ?? ""}
                          onChange={(e) => updateAttachmentDescription(file.fileId, e.target.value)}
                          style={{
                            minHeight: 28,
                            fontSize: "0.78rem",
                            padding: "4px 8px",
                            borderRadius: 6,
                            border: "1px solid var(--border)"
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="pd-modal-hint">
            <Calendar size={12} />{" "}
            {mode === "create"
              ? "Creates a fresh day-by-day schedule matching patient_rehabilitation_plans and links any selected medical attachments."
              : "Editing updates plan metadata and synchronizes associated medical attachments."}
          </p>

          {/* Delete lives in the EDIT popup only — creating a plan has nothing
              to delete. Hands off to the parent's confirm dialog. */}
          {mode === "edit" && selectedPlan && onDeleteRequest && (
            <button
              type="button"
              className="secondary-button full-width"
              style={{ color: "var(--danger, #d33)", borderColor: "var(--danger, #d33)" }}
              onClick={onDeleteRequest}
            >
              <Trash2 size={14} /> Delete plan
            </button>
          )}

          <button type="submit" className="primary-button full-width">
            {mode === "create" ? "Create plan" : "Save changes"}
          </button>
        </form>
      </div>
    </>
  );
}
