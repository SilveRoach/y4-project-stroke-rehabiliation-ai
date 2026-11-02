import {
  ArrowLeft,
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Dumbbell,
  ExternalLink,
  Eye,
  FileText,
  FileVideo,
  Filter,
  GripVertical,
  Hand,
  Image as ImageIcon,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Paperclip,
  Plus,
  RotateCcw,
  Save,
  Search,
  Target,
  UploadCloud,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import {
  ApiError,
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
  getFileContent,
  getFileThumbnail,
  getPatientAttachments,
  addPlanAttachment,
  deletePlanAttachment,
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
import { formatTargetValue } from "../utils/targetValue";

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
  onReviewSession: (session: SessionHistoryEntry, focusExerciseId?: string) => void;
  onOpenExercise?: (exerciseLibraryId: string) => void;
  // Program Editor's schedule/exercise editing now lives directly in this page
  // (four-column Calendar/Plan/Day/Exercises workspace below) instead of routing
  // to a separate ProgramEditorPage. These two props are kept optional, unused,
  // purely so App.tsx's existing <PatientDetailPage onOpenProgramEditor=.../>
  // call site still type-checks without needing its own edit in this pass.
  onOpenProgramEditor?: (plan: PatientRehabPlan) => void;
  pendingPlanUpdate?: PatientRehabPlan | null;
  // Opens ExerciseCreationPage for a library exercise (the "View" button in the
  // exercise-picker popup). Optional so the call site stays type-safe if unwired.
  onViewExercise?: (exercise: ExerciseLibraryItem) => void;
}


const heatmapLabels: Record<HeatmapDayStatus, string> = {
  completed: "เสร็จสิ้น",
  in_progress: "กำลังดำเนินการ",
  skipped: "ข้าม",
  pending: "รอดำเนินการ",
  cancelled: "ยกเลิก"
};

// Mismatch flagged, not changed: schema.prisma's PatientRehabilitationPlansStatus
// enum (and api-design.md's PATCH /plans/:id/status note) has no "paused" value
// — only draft/active/completed/cancelled; "cancel is the only way to stop one
// short." Left as-is because Plans still have no backend endpoint at all (see
// the `plans` state above), so nothing here is persisted yet; whoever wires
// POST /plans up will need to drop/remap this option then.
const planStatusLabels: Record<RehabPlanStatus, string> = {
  draft: "ฉบับร่าง",
  active: "กำลังใช้งาน",
  paused: "พักไว้",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก"
};

const planFilterStatuses: RehabPlanStatus[] = ["active", "draft", "completed", "cancelled"];

const patientGenderLabels: Record<string, string> = {
  male: "ชาย",
  female: "หญิง",
  other: "อื่น ๆ"
};

const patientAccountStatusLabels: Record<string, string> = {
  active: "ใช้งานอยู่",
  inactive: "ไม่ได้ใช้งาน",
  disabled: "ปิดใช้งาน",
  pending: "รอดำเนินการ",
  suspended: "ระงับ"
};

function patientValueLabel(value: string | null | undefined, labels: Record<string, string>, emptyLabel = "—"): string {
  if (!value) return emptyLabel;
  return labels[value.toLowerCase()] ?? value;
}

function patientLastLoginLabel(label: string | null | undefined): string {
  if (!label) return "—";
  if (label === "Today") return "วันนี้";
  if (label === "Yesterday") return "เมื่อวาน";
  if (label === "Never") return "ไม่เคยเข้าสู่ระบบ";
  const daysAgo = label.match(/^(\d+) days? ago$/);
  if (daysAgo) return `${daysAgo[1]} วันที่แล้ว`;
  const date = new Date(label);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
  }
  return label;
}

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

function displayDayLabel(value: string): string {
  return value.replace(/^day\s+(\d+)$/i, "วันที่ $1");
}

function displayDateValue(value: string): string {
  return ISO_DATE_RE.test(value) ? displayDateLabel(value) : value;
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
  const startLabel = start.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  const endLabel = end.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  return startLabel === endLabel
    ? startLabel
    : `${start.toLocaleDateString("th-TH", { month: "short" })} \u2013 ${endLabel}`;
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
  pose: "ติดตามท่าทาง",
  virtual_grip: "ติดตามมือ",
  none: "ไม่ติดตาม"
};

const exerciseStatusLabel: Record<ScheduledExerciseStatus, string> = {
  pending: "รอดำเนินการ",
  in_progress: "กำลังดำเนินการ",
  completed: "เสร็จสิ้น",
  skipped: "ข้าม",
  cancelled: "ยกเลิก"
};

const difficultyLabels: Record<ExerciseLibraryDifficulty, string> = {
  easy: "ง่าย",
  medium: "ปานกลาง",
  hard: "ยาก"
};

const difficultyBadgeClass: Record<ExerciseLibraryDifficulty, string> = {
  easy: "easy",
  medium: "moderate",
  hard: "hard"
};

function defaultTargetValueLabel(criteria: any, targetType?: string): string {
  if (!criteria || typeof criteria !== "object") return "";
  if (targetType === "duration" && criteria.holdSeconds !== undefined) return `${criteria.holdSeconds} วินาที`;
  if (criteria.repetitions !== undefined) return `${criteria.repetitions} ครั้ง`;
  if (criteria.holdSeconds !== undefined) return `${criteria.holdSeconds} วินาที`;
  if (criteria.targetAngleDeg !== undefined) return `${criteria.targetAngleDeg}°`;
  if (criteria.targetGripStrength !== undefined) return String(criteria.targetGripStrength);
  return "";
}

function splitTargetValue(value: string): { amount: string; unit: string } {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  return match ? { amount: match[1], unit: match[2] } : { amount: "", unit: value.trim() };
}

function targetUnitLabel(unit: string): string {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "reps" || normalized === "rep") return "ครั้ง";
  if (normalized === "sec" || normalized === "secs" || normalized === "second" || normalized === "seconds") return "วินาที";
  return unit;
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
      <button type="button" onClick={() => save(String(Math.max(0, Number(parts.amount || 0) - 1)))} disabled={disabled} aria-label="ลดค่าเป้าหมาย">−</button>
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
        aria-label="ค่าเป้าหมาย"
      />
      <button type="button" onClick={() => save(String(Number(parts.amount || 0) + 1))} disabled={disabled} aria-label="เพิ่มค่าเป้าหมาย">+</button>
      {parts.unit && <span>{targetUnitLabel(parts.unit)}</span>}
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
    return { targetType: "repetitions", targetValueLabel: `${item.baseCriteria.repetitions} ครั้ง` };
  }
  if (item.baseCriteria.holdSeconds !== undefined) {
    return { targetType: "duration", targetValueLabel: `${item.baseCriteria.holdSeconds} วินาที` };
  }
  if (item.baseCriteria.targetAngleDeg !== undefined) {
    return { targetType: "repetitions", targetValueLabel: `${item.baseCriteria.targetAngleDeg}°` };
  }
  if (item.baseCriteria.targetGripStrength !== undefined) {
    return { targetType: "repetitions", targetValueLabel: String(item.baseCriteria.targetGripStrength) };
  }
  return { targetType: "repetitions", targetValueLabel: "10 ครั้ง" };
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
  pendingPlanUpdate,
  onViewExercise
}: PatientDetailPageProps) {
  const { token, user } = useAuth();
  // Real profile picture for the patient-profile panel: the summary already
  // carries users.profile_picture_file_id — resolve it to a blob object URL via
  // the auth'd GET /files/:id/content endpoint (useProfilePicture). Falls back
  // to the initials badge while loading / when there's no picture / on failure.
  const patientAvatarUrl = useProfilePicture(token, patient.profilePictureFileId ?? null);
  const [assignedTherapist, setAssignedTherapist] = useState<{ id: string; displayName: string } | null | undefined>(
    patient.assignedTherapistId
      ? { id: patient.assignedTherapistId, displayName: patient.assignedTherapistName || "นักกายภาพบำบัดที่ได้รับมอบหมาย" }
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
  // Plan-column status filter: narrows the Plan list (column 2) to the chosen
  // status combination (multi-select — empty selection means show everything).
  // Filtering only affects which rows are listed — the selected plan (calendar/
  // day/exercise columns) is untouched, so hiding the selected plan's row never
  // blanks out the rest of the workspace.
  const [planStatusFilter, setPlanStatusFilter] = useState<RehabPlanStatus[]>([]);
  const [showStatusFilterMenu, setShowStatusFilterMenu] = useState(false);
  const statusFilterMenuRef = useRef<HTMLDivElement | null>(null);

  // Close the status-filter dropdown when clicking anywhere outside it or pressing Escape.
  useEffect(() => {
    if (!showStatusFilterMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (statusFilterMenuRef.current && !statusFilterMenuRef.current.contains(event.target as Node)) {
        setShowStatusFilterMenu(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowStatusFilterMenu(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showStatusFilterMenu]);
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
          targetType: ex.targetType ?? "repetitions",
          targetValueLabel: ex.targetValue !== null && ex.targetValue !== undefined
            ? formatTargetValue(ex.targetValue)
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
      setPlansError(err instanceof ApiError ? err.message : "โหลดแผนฟื้นฟูไม่สำเร็จ");
    } finally {
      setPlansLoading(false);
    }
  };

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null;

  // Plan list narrowed by the header's status filter (column 2 only). Multiple
  // statuses can be selected at once; an empty selection shows every plan.
  // When filtering, the label reads "x of y plans" and an empty state replaces
  // the list if no plan has any of the chosen statuses.
  const visiblePlans = useMemo(
    () => (planStatusFilter.length === 0 ? plans : plans.filter((plan) => planStatusFilter.includes(plan.status))),
    [plans, planStatusFilter]
  );

  const planCountsByStatus = useMemo(() => {
    const counts: Record<RehabPlanStatus, number> = {
      draft: 0,
      active: 0,
      paused: 0,
      completed: 0,
      cancelled: 0
    };
    for (const p of plans) {
      if (counts[p.status] !== undefined) {
        counts[p.status]++;
      }
    }
    return counts;
  }, [plans]);

  // Month-based calendar: default to the plan's start month, while allowing
  // navigation to any month so the schedule remains browsable without a plan.
  const monthRange = selectedPlan ? planMonthRange(selectedPlan) : null;
  const todayKey = monthKeyOf(isoOf(new Date()));
  const effectiveMonthKey = viewMonthKey ?? (selectedPlan && monthRange ? monthRange.min : todayKey);
  const monthCells = selectedPlan && effectiveMonthKey ? buildMonthCalendar(selectedPlan, effectiveMonthKey) : [];
  const monthLabel = (() => {
    if (!effectiveMonthKey) return "";
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
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
        if (!cancelled) setPlansError(err instanceof ApiError ? err.message : "โหลดแผนฟื้นฟูไม่สำเร็จ");
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
      alert("เฉพาะนักกายภาพบำบัดที่ได้รับมอบหมายให้ดูแลผู้ป่วยรายนี้เท่านั้นที่แก้ไขแผนฟื้นฟูได้");
      return;
    }
    if (!token) {
      alert("ไม่พบข้อมูลการเข้าสู่ระบบ");
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
      alert(`บันทึกแผนไม่สำเร็จ: ${message}`);
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
    if (!canEditPlan) return alert("เฉพาะนักกายภาพบำบัดที่ได้รับมอบหมายเท่านั้นที่แก้ไขตารางฝึกของผู้ป่วยรายนี้ได้");
    if (!token) return alert("ไม่พบข้อมูลการเข้าสู่ระบบ");
    if (!selectedPlan) return alert("ยังไม่ได้เลือกแผน");
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
      setAddDayError(err instanceof ApiError ? err.message : "เพิ่มวันฝึกไม่สำเร็จ กรุณาลองอีกครั้ง");
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
    if (!canEditPlan) return alert("เฉพาะนักกายภาพบำบัดที่ได้รับมอบหมายเท่านั้นที่แก้ไขตารางฝึกของผู้ป่วยรายนี้ได้");
    if (!token) return alert("ไม่พบข้อมูลการเข้าสู่ระบบ");
    if (!selectedDay || !selectedDay.id) return alert("วันที่เลือกยังไม่มีรหัส");
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
  // handlePickExercise once a library exercise is chosen and confirmed (the
  // picker's confirm popup also collects an optional therapist instruction).
  const handleAddExerciseToSelectedDay = async () => {
    if (!canEditPlan) return alert("เฉพาะนักกายภาพบำบัดที่ได้รับมอบหมายเท่านั้นที่แก้ไขท่าบริหารของผู้ป่วยรายนี้ได้");
    if (!selectedDay) return alert("กรุณาเลือกวันฝึกก่อน");
    setAddExerciseError(null);
    setShowExercisePicker(true);
  };

  const handlePickExercise = async (item: ExerciseLibraryItem, therapistInstruction?: string, targetValueLabel?: string) => {
    if (!canEditPlan) return;
    if (!token) return alert("ไม่พบข้อมูลการเข้าสู่ระบบ");
    if (!selectedDay || !selectedDay.id) {
      setAddExerciseError("วันนี้ยังไม่ได้บันทึกลงในระบบ");
      return;
    }
    setAddExerciseLoading(true);
    const defaultReps = item.baseCriteria?.repetitions ?? 10;
    try {
      await createScheduledExercise(token, selectedDay.id, {
        exerciseLibraryId: item.id,
        orderNumber: selectedDay.exercises.length + 1,
        targetType: "repetitions",
        targetValue: targetValueLabel ?? `${defaultReps} ครั้ง`,
        therapistInstruction: therapistInstruction?.trim() ? therapistInstruction.trim() : undefined
      });
      await refreshPlans();
      setShowExercisePicker(false);
    } catch (err) {
      setAddExerciseError(err instanceof ApiError ? err.message : "เพิ่มท่าบริหารไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setAddExerciseLoading(false);
    }
  };

  const handleSaveExerciseTarget = async (exerciseId: string, targetValue: string) => {
    if (!canEditPlan) return;
    if (!token) return alert("ไม่พบข้อมูลการเข้าสู่ระบบ");
    setTargetSavingId(exerciseId);
    try {
      await patchScheduledExercise(token, exerciseId, {
        targetValue: targetValue.trim() === "" ? null : targetValue.trim()
      });
      await refreshPlans();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "บันทึกเป้าหมายการฝึกไม่สำเร็จ");
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
      alert("ไม่พบข้อมูลการเข้าสู่ระบบ");
      return;
    }
    try {
      await deleteScheduledExercise(token, exercisePendingRemoval.id);
      setExercisePendingRemoval(null);
      await refreshPlans();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "นำท่าบริหารออกไม่สำเร็จ");
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
      label: last.dateLabel || `วันที่ ${days.length}`,
      newEndDateLabel
    });
  };

  const confirmDeleteDay = async () => {
    if (!dayPendingRemoval || !selectedPlan) return;
    if (!token) {
      alert("ไม่พบข้อมูลการเข้าสู่ระบบ");
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
      alert(err instanceof ApiError ? err.message : "นำวันฝึกออกไม่สำเร็จ");
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
      alert(err instanceof ApiError ? err.message : "บันทึกลำดับท่าบริหารไม่สำเร็จ");
      await refreshPlans();
    }
  };

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Patients" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>ข้อมูลผู้ป่วย</h1>
            <p>{patientCode}</p>
          </div>
        </header>

        <main className="therapist-main">
          <button type="button" className="text-action pd-back-link" onClick={onBack}>
            <ArrowLeft size={14} /> รายชื่อผู้ป่วย
          </button>

          <div className="pd-patient-info-layout">
            <div
              className={`pd-patient-profile-avatar${patientAvatarUrl ? " with-photo" : ""}`}
              aria-label={`รูปโปรไฟล์ของ ${patient.name}`}
            >
              {patientAvatarUrl ? (
                <img src={patientAvatarUrl} alt={`รูปโปรไฟล์ของ ${patient.name}`} />
              ) : (
                patient.avatarInitials
              )}
            </div>
            <section className="summary-card pd-patient-info-card">
              <div className="pd-patient-info-columns">
                <div className="pd-patient-info-group">
                  <h3>ข้อมูลส่วนบุคคล</h3>
                  <div className="pd-patient-info-grid">
                    <div><span>ชื่อ-นามสกุล</span><strong>{patient.name}</strong></div>
                    <div><span>ชื่อผู้ใช้</span><strong>{patient.username || "—"}</strong></div>
                    <div><span>เพศ</span><strong>{patient.gender?.toLowerCase() === "unknown" ? "ไม่มีข้อมูล" : patientValueLabel(patient.gender, patientGenderLabels, "ไม่มีข้อมูล")}</strong></div>
                    <div><span>วันเกิด</span><strong>{patient.dateOfBirth ? displayDateValue(patient.dateOfBirth) : "—"}</strong></div>
                    <div><span>ส่วนสูง</span><strong>{patient.heightCm !== null ? `${patient.heightCm} ซม.` : "—"}</strong></div>
                    <div><span>น้ำหนัก</span><strong>{patient.weightKg !== null ? `${patient.weightKg} กก.` : "—"}</strong></div>
                    <div><span>สถานะบัญชี</span><strong>{patientValueLabel(patient.accountStatus, patientAccountStatusLabels)}</strong></div>
                    <div><span>เข้าสู่ระบบล่าสุด</span><strong>{patientLastLoginLabel(patient.lastLoginLabel)}</strong></div>
                  </div>
                </div>
                <div className="pd-patient-info-group">
                  <h3>ข้อมูลติดต่อ</h3>
                  <div className="pd-patient-info-grid">
                    <div><span>อีเมล</span><strong>{patient.email || "—"}</strong></div>
                    <div><span>หมายเลขโทรศัพท์</span><strong>{patient.phoneNumber || "—"}</strong></div>
                    <div><span>นักกายภาพบำบัดผู้ดูแล</span><strong>{assignedTherapist?.displayName || patient.assignedTherapistName || "ยังไม่ได้มอบหมาย"}</strong></div>
                    <div className="pd-patient-info-wide"><span>ที่อยู่</span><strong>{patient.address || "—"}</strong></div>
                    <div><span>ผู้ติดต่อฉุกเฉิน</span><strong>{patient.emergencyContactName || "—"}</strong></div>
                    <div><span>โทรศัพท์ฉุกเฉิน</span><strong>{patient.emergencyContactPhone || "—"}</strong></div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          {!canEditPlan && assignedTherapist && (
            <div className="pd-read-only-notice" role="status">
              ผู้ป่วยรายนี้อยู่ในความดูแลของ <strong>{assignedTherapist.displayName}</strong> คุณสามารถดูแผนได้ แต่มีเพียงนักกายภาพบำบัดที่ได้รับมอบหมายเท่านั้นที่แก้ไขได้
            </div>
          )}
          {!canEditPlan && assignedTherapist === null && (
            <div className="pd-read-only-notice" role="status">
              ผู้ป่วยรายนี้ยังไม่ได้รับมอบหมายนักกายภาพบำบัด คุณสามารถดูแผนได้ แต่ไม่สามารถแก้ไขแผนได้
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
                      <strong>ตารางฝึก</strong>
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
                      aria-label="เดือนก่อนหน้า"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <strong>{monthLabel}</strong>
                    <button
                      type="button"
                      className="icon-button pd-calendar-nav"
                      onClick={() => setViewMonthKey(nextMonthKey)}
                      aria-label="เดือนถัดไป"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="pd-calendar-weekdays">
                    {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((day, index) => (
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
                              ? `${cell.iso} · ${heatmapLabels[cell.status!]}${cell.otherMonth ? " (เดือนก่อนหน้าหรือถัดไป)" : ""}`
                              : cell.otherMonth
                                ? undefined
                                : `${cell.iso}${cell.outside ? " · ไม่มีตารางฝึก" : ""}`
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
                    วันที่ {planProgress(selectedPlan).current} จาก {planProgress(selectedPlan).total} &middot;{" "}
                    {selectedPlan.name}
                  </p>
                </div>

                {/* Column 2 — Plan */}
                <div className="pd-ws-col">
                  <div className="pd-ws-col-head">
                    <span className="pd-ws-step">2</span>
                    <div>
                      <span className="pd-ws-title-row">
                        <strong>แผนฟื้นฟู</strong>
                        <span className="pd-ws-day-actions">
                          {/* Multi-select status filter: a button opening a
                              checkbox popover; picking several statuses narrows
                              the list to plans matching ANY of them, and no
                              selection shows everything. */}
                          <div className="pd-status-filter-wrap" ref={statusFilterMenuRef}>
                            <button
                              type="button"
                              className={`pd-plan-status-filter ${planStatusFilter.length > 0 ? "filtering" : ""} ${showStatusFilterMenu ? "active-menu" : ""}`}
                              onClick={() => setShowStatusFilterMenu((open) => !open)}
                              aria-haspopup="true"
                              aria-expanded={showStatusFilterMenu}
                              title={
                                planStatusFilter.length === 0
                                  ? "กรองแผนตามสถานะ"
                                  : `กรองตามสถานะ: ${planStatusFilter.map((s) => planStatusLabels[s]).join(", ")}`
                              }
                            >
                              <Filter size={12} className="pd-filter-icon" />
                              <span className="pd-filter-btn-label">
                                {planStatusFilter.length === 0
                                  ? "สถานะ"
                                  : planStatusFilter.length === 1
                                    ? planStatusLabels[planStatusFilter[0]]
                                    : "สถานะ"}
                              </span>
                              {planStatusFilter.length > 0 && (
                                <span className="pd-filter-count-badge">{planStatusFilter.length}</span>
                              )}
                              <ChevronDown size={11} className={`pd-filter-chevron ${showStatusFilterMenu ? "rotated" : ""}`} />
                            </button>
                            {showStatusFilterMenu && (
                              <div className="pd-status-filter-menu" role="dialog" aria-label="กรองแผนตามสถานะ">
                                <div className="pd-status-filter-header">
                                  <span className="pd-status-filter-title">กรองตามสถานะ</span>
                                  {planStatusFilter.length > 0 ? (
                                    <button
                                      type="button"
                                      className="pd-status-filter-quick-action"
                                      onClick={() => setPlanStatusFilter([])}
                                    >
                                      ล้างทั้งหมด
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="pd-status-filter-quick-action"
                                      onClick={() => setPlanStatusFilter([...planFilterStatuses])}
                                    >
                                      เลือกทั้งหมด
                                    </button>
                                  )}
                                </div>
                                <div className="pd-status-filter-list" role="group">
                                  {planFilterStatuses.map((status) => {
                                    const isChecked = planStatusFilter.includes(status);
                                    const count = planCountsByStatus[status] ?? 0;
                                    return (
                                      <label key={status} className={`pd-status-filter-option ${isChecked ? "checked" : ""}`}>
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(event) =>
                                            setPlanStatusFilter((current) =>
                                              event.target.checked
                                                ? [...current, status]
                                                : current.filter((s) => s !== status)
                                            )
                                          }
                                        />
                                        <span className={`pd-status-dot ${status}`} />
                                        <span className="pd-status-filter-option-name">{planStatusLabels[status]}</span>
                                        <span className={`pd-status-filter-count ${count === 0 ? "zero" : ""}`}>
                                          {count}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                                <div className="pd-status-filter-footer">
                                  <span>แสดง {visiblePlans.length} จาก {plans.length} แผน</span>
                                </div>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            className="icon-button pd-ws-add"
                            title="สร้างแผนใหม่"
                            aria-label="สร้างแผนใหม่"
                            onClick={handleCreatePlanClick}
                            disabled={!canEditPlan}
                          >
                            <Plus size={13} />
                          </button>
                        </span>
                      </span>
                      <small>
                        {planStatusFilter.length === 0
                          ? `${plans.length} แผน`
                          : `${visiblePlans.length} จาก ${plans.length} แผน`}
                      </small>
                    </div>
                  </div>
                  {planStatusFilter.length > 0 && (
                    <div className="pd-active-filter-chips">
                      <div className="pd-active-filter-list">
                        {planStatusFilter.map((status) => (
                          <span key={status} className={`pd-active-filter-chip ${status}`}>
                            <span className={`pd-status-dot ${status}`} />
                            <span>{planStatusLabels[status]}</span>
                            <button
                              type="button"
                              className="pd-active-filter-remove"
                              onClick={() => setPlanStatusFilter((current) => current.filter((s) => s !== status))}
                              title={`นำตัวกรอง ${planStatusLabels[status]} ออก`}
                              aria-label={`นำตัวกรอง ${planStatusLabels[status]} ออก`}
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                        <button
                          type="button"
                          className="pd-active-filter-clear-link"
                          onClick={() => setPlanStatusFilter([])}
                          title="ล้างตัวกรองทั้งหมด"
                        >
                          ล้าง
                        </button>
                      </div>
                    </div>
                  )}
                  {visiblePlans.length > 0 ? (
                    <div className="pd-ws-scroll pd-ws-plan-list">
                      {visiblePlans.map((plan) => {
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
                            {plan.startDateLabel ? displayDateValue(plan.startDateLabel) : "ไม่มีวันที่เริ่มต้น"}
                            {plan.endDateLabel ? ` \u2192 ${displayDateValue(plan.endDateLabel)}` : ""}
                          </small>
                          <span className="pd-progress-track" aria-hidden="true">
                            <span className="pd-progress-fill" style={{ width: `${pct}%` }} />
                          </span>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <small>วันที่ {progress.current} จาก {progress.total} &middot; {pct}%</small>
                            {plan.attachments && plan.attachments.length > 0 && (
                              <small style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-secondary)", fontWeight: 500 }}>
                                <Paperclip size={10} /> {plan.attachments.length}
                              </small>
                            )}
                          </div>
                        </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="pd-ws-empty">
                      <ClipboardList size={22} />
                      <strong>ไม่พบแผนที่ตรงกัน</strong>
                      <p>ไม่มีแผนที่ตรงกับสถานะที่เลือก</p>
                      <button
                        type="button"
                        className="secondary-button pd-empty-clear-btn"
                        onClick={() => setPlanStatusFilter([])}
                      >
                        ล้างตัวกรองสถานะ
                      </button>
                    </div>
                  )}

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
                      <ClipboardList size={14} /> {canEditPlan ? (plans.length === 0 ? "สร้างแผน" : "แก้ไขแผน") : "รายละเอียดแผน (ดูอย่างเดียว)"}
                    </button>
                  </div>
                </div>

                {/* Column 3 — Day */}
                <div className="pd-ws-col">
                  <div className="pd-ws-col-head">
                    <span className="pd-ws-step">3</span>
                    <div>
                      <span className="pd-ws-title-row">
                        <strong>วันฝึก</strong>
                        {/* [ − ] / [ + ] grouped together — remove/add a day at
                            the plan's end, kept visually as one tight pair. */}
                        <span className="pd-ws-day-actions">
                          <button
                            type="button"
                            className="icon-button pd-ws-add"
                            title="นำวันสุดท้ายออก (เลื่อนวันสิ้นสุดแผนกลับหนึ่งวัน)"
                            aria-label="นำวันสุดท้ายออก"
                            onClick={handleRemoveLastDay}
                            disabled={!canRemoveLastDay || deleteDayLoading}
                          >
                            <Minus size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button pd-ws-add"
                            title="เพิ่มวันฝึก (ขยายวันสิ้นสุดแผนออกไปหนึ่งวัน)"
                            aria-label="เพิ่มวันฝึก"
                            onClick={handleAddScheduleDay}
                            disabled={!canEditPlan || addDayLoading}
                          >
                            <Plus size={13} />
                          </button>
                        </span>
                      </span>
                      <small>
                        {selectedPlan.days && selectedPlan.days.length > 0
                          ? `กำหนดไว้ ${selectedPlan.days.length} วัน`
                          : "ยังไม่ได้กำหนดวันฝึก"}
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
                            <strong>{day.dateLabel ?? `วันที่ ${idx + 1}`}</strong>
                            <span className={`pd-day-status ${day.status}`}>{heatmapLabels[day.status]}</span>
                          </span>
                          <small>
                            {day.exercises.length} ท่าบริหาร
                            {day.therapistNote ? " \u00b7 มีบันทึก" : ""}
                          </small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="pd-ws-empty">
                      <Calendar size={22} />
                      <strong>ยังไม่มีวันฝึก</strong>
                      <p>เพิ่มวันฝึกในแผนนี้เพื่อเริ่มกำหนดท่าบริหาร</p>
                    </div>
                  )}
                </div>

                {/* Column 4 — Exercise */}
                <div className="pd-ws-col pd-ws-exercises">
                  <div className="pd-ws-col-head">
                    <span className="pd-ws-step">4</span>
                    <div>
                      <span className="pd-ws-title-row">
                        <strong>ท่าบริหาร</strong>
                        <button
                          type="button"
                          className="secondary-button pd-ws-add-exercise"
                          title="เพิ่มท่าบริหารจากคลัง"
                          aria-label="เพิ่มท่าบริหารจากคลัง"
                          onClick={handleAddExerciseToSelectedDay}
                          disabled={!canEditPlan || !selectedDay}
                        >
                          <Plus size={14} /> เพิ่มท่าบริหาร
                        </button>
                      </span>
                      <small>
                        {selectedDay
                          ? (selectedDay.dateLabel ?? `วันที่ ${(selectedDayIndex ?? 0) + 1}`) + ` \u00b7 ${heatmapLabels[selectedDay.status]}`
                          : "เลือกวันฝึก"}
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
                            placeholder="เพิ่มบันทึกสำหรับวันฝึกนี้"
                            rows={3}
                            disabled={!canEditPlan || dayNoteSaving}
                          />
                        ) : selectedDay.therapistNote ? (
                          <p className="pd-day-note">{selectedDay.therapistNote}</p>
                        ) : (
                          <p className="pd-day-note pd-day-note-empty">ไม่มีบันทึกสำหรับวันฝึกนี้</p>
                        )}
                        <div className="pd-day-context-actions">
                          <button type="button" className="text-action" onClick={handleEditDayNote} disabled={!canEditPlan}>
                            <Save size={13} /> แก้ไขบันทึก
                          </button>
                          {editingDayNote && (
                            <button type="button" className="text-action" onClick={handleSaveDayNote} disabled={!canEditPlan || dayNoteSaving}>
                              <Save size={13} /> {dayNoteSaving ? "กำลังบันทึก…" : "บันทึก"}
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
                                <span className="pd-ex-drag-handle" title={canEditPlan ? "ลากเพื่อจัดลำดับใหม่" : undefined} aria-hidden="true">
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
                                        title="นำท่าบริหารออกจากวันนี้"
                                        aria-label={`นำ ${ex.exerciseName} ออกจากวันนี้`}
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
                                      {ex.status === "completed" && (
                                        <button
                                          type="button"
                                          className="pd-ex-view"
                                          onClick={() => {
                                            if (!selectedDay?.id) return;
                                            const dayIndex =
                                              selectedPlan?.days.findIndex((day) => day.id === selectedDay.id) ?? -1;
                                            const completed = selectedDay.exercises.filter(
                                              (item) => item.status === "completed"
                                            );
                                            // Per-exercise review: opens the day's Session
                                            // Result Review focused on this exercise. Only
                                            // rendered for completed exercises — there are
                                            // no recorded attempts to review otherwise.
                                            onReviewSession(
                                              {
                                                id: selectedDay.id,
                                                dateLabel: selectedDay.dateLabel ?? selectedPlan?.startDateLabel ?? "",
                                                dayLabel: dayIndex >= 0 ? `วันที่ ${dayIndex + 1}` : "รอบฝึก",
                                                exercisesAttempted: completed.length,
                                                outcome: selectedDay.status === "skipped" ? "skipped" : "completed"
                                              },
                                              ex.id
                                            );
                                          }}
                                          title="ตรวจสอบผลการฝึกท่านี้"
                                        >
                                          ตรวจสอบผล
                                        </button>
                                      )}
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
                          <strong>ยังไม่ได้กำหนดท่าบริหาร</strong>
                          <p>วันนี้ยังไม่มีท่าบริหาร — เพิ่มท่าจากคลังท่าบริหาร</p>
                          <button type="button" className="secondary-button" onClick={handleAddExerciseToSelectedDay} disabled={!canEditPlan}>
                            <Plus size={14} /> เพิ่มท่าบริหาร
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="pd-ws-empty">
                      <Eye size={22} />
                      <strong>ยังไม่ได้เลือกวันฝึก</strong>
                      <p>เลือกวันฝึกจากคอลัมน์วันฝึกหรือจากปฏิทินเพื่อดูท่าบริหาร</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="pd-ws-empty pd-ws-empty-plan">
                <ClipboardList size={24} />
                <strong>ผู้ป่วยรายนี้ยังไม่มีแผนฟื้นฟู</strong>
                <p>{canEditPlan ? "สร้างแผนเพื่อเริ่มกำหนดวันฝึกและท่าบริหาร" : "ยังไม่มีการสร้างแผน"}</p>
                {canEditPlan && (
                  <button type="button" className="secondary-button" onClick={handleCreatePlanClick}>
                    <ClipboardList size={14} /> สร้างแผน
                  </button>
                )}
              </div>
            )}
          </div>

        </main>
      </div>

      {showPlanModal && (
        <PlanModal
          selectedPlan={planModalIntent === "create" || plans.length === 0 ? null : selectedPlan}
          mode={planModalIntent === "create" || plans.length === 0 ? "create" : "edit"}
          // A therapist who is not assigned to this patient may open the popup
          // to READ the plan, but every control inside stays disabled.
          readOnly={!canEditPlan}
          availableAttachments={availableAttachments}
          availableFiles={availableFiles}
          token={token ?? null}
          onFileUploaded={(uploaded) => setAvailableFiles((current) => [...current, uploaded])}
          onClose={() => {
            setShowPlanModal(false);
            setPlanModalIntent("view");
          }}
          onSave={handleSavePlan}
        />
      )}
      {showExercisePicker && selectedDay && (
        <ExercisePickerModal
          token={token ?? null}
          onClose={() => setShowExercisePicker(false)}
          onPick={handlePickExercise}
          alreadyAddedIds={selectedDay.exercises.map((ex) => ex.exerciseLibraryId)}
          loading={addExerciseLoading}
          onView={onViewExercise}
          dayLabel={
            selectedDayIndex !== null
              ? `วันที่ ${selectedDayIndex + 1}${selectedDay.dateLabel ? ` (${displayDateLabel(selectedDay.dateLabel)})` : ""}`
              : selectedDay.dateLabel
                ? displayDateLabel(selectedDay.dateLabel)
                : undefined
          }
        />
      )}
      {dayPendingRemoval && (
        <div className="therapist-panel-scrim" onClick={() => setDayPendingRemoval(null)}>
          <div className="pd-modal pd-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-day-title" onClick={(event) => event.stopPropagation()}>
            <div className="therapist-detail-header">
              <strong id="remove-day-title">นำวันฝึกออก?</strong>
              <button type="button" className="icon-button" onClick={() => setDayPendingRemoval(null)} aria-label="ปิด">
                <X size={16} />
              </button>
            </div>
            <p className="pd-confirm-message">
              ต้องการนำวันสุดท้าย <strong>{displayDayLabel(dayPendingRemoval.label)}</strong> ออกจากแผนนี้หรือไม่? ท่าบริหารและผลการฝึกที่บันทึกไว้ของวันดังกล่าวจะถูกลบด้วย
              {dayPendingRemoval.newEndDateLabel ? (
                <>
                  {" "}และวันสิ้นสุดของแผนจะเปลี่ยนเป็น <strong>{dayPendingRemoval.newEndDateLabel}</strong>
                </>
              ) : null}
              .
            </p>
            <div className="pd-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setDayPendingRemoval(null)}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="primary-button"
                style={{ background: "var(--danger, #d33)" }}
                disabled={deleteDayLoading}
                onClick={() => void confirmDeleteDay()}
              >
                {deleteDayLoading ? "กำลังนำออก…" : "นำวันฝึกออก"}
              </button>
            </div>
          </div>
        </div>
      )}
      {exercisePendingRemoval && (
        <div className="therapist-panel-scrim" onClick={() => setExercisePendingRemoval(null)}>
          <div className="pd-modal pd-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-exercise-title" onClick={(event) => event.stopPropagation()}>
            <div className="therapist-detail-header">
              <strong id="remove-exercise-title">นำท่าบริหารออก?</strong>
              <button type="button" className="icon-button" onClick={() => setExercisePendingRemoval(null)} aria-label="ปิด">
                <X size={16} />
              </button>
            </div>
            <p className="pd-confirm-message">
              ต้องการนำ <strong>{exercisePendingRemoval.name}</strong> ออกจากวันฝึกนี้หรือไม่?
            </p>
            <div className="pd-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setExercisePendingRemoval(null)}>
                ยกเลิก
              </button>
              <button type="button" className="primary-button" onClick={() => void confirmRemoveExercise()}>
                นำท่าบริหารออก
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Exercise library picker MODAL ──────────────────────────────────────────────
// Full-screen popup version of the former side panel: loads the library via
// GET /exercises (real API), then mirrors ExerciseLibraryPage's look — toolbar
// with a search field plus status/tracking filters and the same .library-card
// grid with demo-video thumbnails. Only status:"active" exercises are actually
// pickable (cards for other statuses render disabled); ones already assigned to
// the selected day show an "Added" badge and are disabled too. Clicking a card
// hands the item to onPick (which POSTs /schedule-days/:dayId/exercises).
function ExercisePickerModal({
  token,
  onClose,
  onPick,
  alreadyAddedIds,
  loading: parentLoading,
  onView,
  dayLabel
}: {
  token: string | null;
  onClose: () => void;
  // Called once the therapist confirms the pick in the detail popup. The second
  // argument is the optional therapist instruction typed in that popup; the
  // third is an optional target value label (e.g. "12 ครั้ง") overriding the
  // exercise's default when the therapist edited it.
  onPick: (item: ExerciseLibraryItem, therapistInstruction?: string, targetValueLabel?: string) => Promise<void>;
  alreadyAddedIds: string[];
  loading: boolean;
  // Opens ExerciseCreationPage for the exercise (small "View" button on each
  // card). Clicking anywhere else on the card still picks it for the day.
  onView?: (exercise: ExerciseLibraryItem) => void;
  dayLabel?: string;
}) {
  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Exercise the therapist just clicked — shown in the small "Add exercise"
  // confirm popup (basic info + optional therapist instruction) before the
  // actual POST happens. null = no popup open.
  const [pendingPick, setPendingPick] = useState<ExerciseLibraryItem | null>(null);
  const [pendingInstruction, setPendingInstruction] = useState("");
  // Editable target value (e.g. "10 ครั้ง") shown in the confirm popup —
  // pre-filled from the exercise's default and overridable before the POST.
  const [pendingTarget, setPendingTarget] = useState("");

  const openPick = (exercise: ExerciseLibraryItem) => {
    setPendingPick(exercise);
    setPendingInstruction("");
    const reps = exercise.baseCriteria?.repetitions ?? 10;
    setPendingTarget(`${reps} ครั้ง`);
  };

  useEffect(() => {
    if (!pendingPick) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPendingPick(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingPick]);

  // Same toolbar state as ExerciseLibraryPage: free-text search + status and
  // tracking dropdowns. Status defaults to "active" since that's what's
  // assignable on a schedule day; the others stay browsable (disabled cards).
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ExerciseLibraryItem["status"]>("active");
  const [trackingFilter, setTrackingFilter] = useState<"all" | ExerciseTrackingType>("all");

  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const thumbnailUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!token) {
      setFetchError("ไม่พบข้อมูลการเข้าสู่ระบบ");
      setFetchLoading(false);
      return;
    }
    let cancelled = false;
    setFetchLoading(true);
    setFetchError(null);

    getExerciseLibrary(token)
      .then((res) => {
        if (cancelled) return;
        setExercises(res.exercises ?? []);
        for (const exercise of res.exercises ?? []) {
          if (!exercise.demoVideoFileId) continue;
          getFileThumbnail(token, exercise.demoVideoFileId)
            .then((blob) => {
              if (cancelled) return;
              const url = URL.createObjectURL(blob);
              thumbnailUrlsRef.current[exercise.id] = url;
              setThumbnailUrls((current) => ({ ...current, [exercise.id]: url }));
            })
            .catch(() => {
              // Keep the placeholder when a thumbnail cannot be generated.
            });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err instanceof ApiError ? err.message : "โหลดท่าบริหารไม่สำเร็จ กรุณาลองอีกครั้ง");
        }
      })
      .finally(() => {
        if (!cancelled) setFetchLoading(false);
      });

    return () => {
      cancelled = true;
      Object.values(thumbnailUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrlsRef.current = {};
    };
  }, [token]);

  const filteredExercises = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return exercises.filter((exercise) => {
      const matchesStatus = statusFilter === "all" || exercise.status === statusFilter;
      const matchesTracking = trackingFilter === "all" || exercise.movementTracking === trackingFilter;
      const searchableText = [
        exercise.name,
        trackingLabels[exercise.movementTracking],
        exercise.movementTracking,
        exercise.createdByName || "นักกายภาพบำบัด"
      ]
        .join(" ")
        .toLocaleLowerCase();
      return matchesStatus && matchesTracking && (!query || searchableText.includes(query));
    });
  }, [exercises, searchQuery, statusFilter, trackingFilter]);

  return (
    <>
      {/* Scrim darkens the page behind the majority-screen modal */}
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div
        className="pd-modal pd-library-modal"
        role="dialog"
        aria-modal="true"
        aria-label="เพิ่มท่าบริหารจากคลัง"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="therapist-detail-header">
          <strong>เพิ่มท่าบริหารจากคลัง</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด">
            <X size={16} />
          </button>
        </header>

        <div className="summary-card pd-library-toolbar-card">
          <div className="library-toolbar">
            <label className="library-search">
              <Search size={16} />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="ค้นหาตามชื่อ ประเภท หรือผู้สร้าง"
                aria-label="ค้นหาท่าบริหารตามชื่อ ประเภท หรือผู้สร้าง"
              />
            </label>
            <label className="library-status-filter">
              <span>สถานะ</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | ExerciseLibraryItem["status"])}
                aria-label="กรองท่าบริหารตามสถานะ"
              >
                <option value="all">ทั้งหมด</option>
                <option value="active">กำลังใช้งาน</option>
                <option value="draft">ฉบับร่าง</option>
                <option value="archived">เก็บถาวร</option>
              </select>
            </label>
            <label className="library-status-filter">
              <span>การติดตาม</span>
              <select
                value={trackingFilter}
                onChange={(event) => setTrackingFilter(event.target.value as "all" | ExerciseTrackingType)}
                aria-label="กรองท่าบริหารตามประเภทการติดตาม"
              >
                <option value="all">ทั้งหมด</option>
                <option value="pose">ติดตามท่าทาง</option>
                <option value="virtual_grip">วัดแรงบีบมือ</option>
                <option value="none">ไม่ใช้ AI ติดตาม</option>
              </select>
            </label>
          </div>
        </div>

        <div className="pd-library-modal-body">
          {fetchLoading ? (
            <p className="pd-empty-note">กำลังโหลดท่าบริหาร…</p>
          ) : fetchError ? (
            <p className="pd-empty-note" role="alert" style={{ color: "var(--error, #c0392b)" }}>
              {fetchError}
            </p>
          ) : filteredExercises.length === 0 ? (
            <p className="pd-empty-note">
              {exercises.length === 0
                ? "ยังไม่มีท่าบริหารในคลัง"
                : searchQuery.trim()
                  ? "ไม่พบท่าบริหารที่ตรงกับคำค้นหา"
                  : "ไม่พบท่าบริหารที่ตรงกับตัวกรองนี้"}
            </p>
          ) : (
            <div className="library-grid">
              {filteredExercises.map((exercise) => {
                const Icon = trackingIcon[exercise.movementTracking];
                const alreadyAdded = alreadyAddedIds.includes(exercise.id);
                const pickable = exercise.status === "active" && !alreadyAdded && !parentLoading;
                return (
                  <div
                    key={exercise.id}
                    className={`library-card ${exercise.status !== "active" ? "is-archived" : ""}`}
                    role="button"
                    tabIndex={pickable ? 0 : -1}
                    aria-disabled={!pickable}
                    onClick={() => {
                      if (pickable) openPick(exercise);
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === "Enter" || event.key === " ") && pickable) {
                        event.preventDefault();
                        openPick(exercise);
                      }
                    }}
                    title={
                      alreadyAdded
                        ? "กำหนดท่าบริหารนี้ในวันนี้แล้ว"
                        : exercise.status !== "active"
                          ? "กำหนดได้เฉพาะท่าบริหารที่กำลังใช้งาน"
                          : "เพิ่มท่าบริหารในวันที่เลือก"
                    }
                  >
                    <div className="library-card-media">
                      {thumbnailUrls[exercise.id] ? (
                        <img
                          className="library-card-thumbnail library-card-video-thumbnail"
                          src={thumbnailUrls[exercise.id]}
                          alt={`ภาพตัวอย่างวิดีโอสาธิต ${exercise.name}`}
                        />
                      ) : (
                        <div className="library-card-thumbnail">
                          <Icon size={30} />
                          <span>{exercise.hasDemoVideo ? "วิดีโอสาธิต" : "ไม่มีวิดีโอสาธิต"}</span>
                        </div>
                      )}
                      <span className={`library-card-type tracking-${exercise.movementTracking}`}>
                        {trackingLabels[exercise.movementTracking]}
                      </span>
                    </div>

                    <div className="library-card-details">
                      <strong className="library-card-title">
                        {exercise.name}{" "}
                        <small style={{ color: "var(--text-secondary)" }}>v{exercise.versionNumber}</small>
                      </strong>
                      <span>สร้างโดย {exercise.createdByName || "นักกายภาพบำบัด"}</span>
                      <span className={`library-status-badge ${exercise.status}`}>
                        {alreadyAdded ? "เพิ่มแล้ว" : exercise.status === "active" ? "กำลังใช้งาน" : exercise.status === "draft" ? "ฉบับร่าง" : "เก็บถาวร"}
                      </span>
                      {onView && (
                        <button
                          type="button"
                          className="text-action pd-picker-view-link"
                          onClick={(event) => {
                            // Don't let the card's own pick handler fire too.
                            event.stopPropagation();
                            onView(exercise);
                          }}
                          title="เปิดท่าบริหารนี้ในหน้าแก้ไข"
                        >
                          <Eye size={13} /> ดู
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── "Add exercise" confirm popup ─────────────────────────────────────
          Rich confirmation dialog shown when a library exercise card is selected.
          Displays thumbnail/media, exercise metadata chips, dynamic target value
          stepper with quick presets and reset to default, and optional therapist
          instruction note before committing to the schedule day. */}
      {pendingPick && (() => {
        const defaultReps = pendingPick.baseCriteria?.repetitions ?? 10;
        const targetParts = splitTargetValue(pendingTarget);
        const currentReps = Math.max(1, parseInt(targetParts.amount, 10) || defaultReps);
        const isCustomTarget = Boolean(
          pendingTarget.trim() && pendingTarget.trim() !== `${defaultReps} ครั้ง`
        );
        const Icon = trackingIcon[pendingPick.movementTracking];

        const handleStep = (delta: number) => {
          const nextReps = Math.max(1, currentReps + delta);
          setPendingTarget(`${nextReps} ครั้ง`);
        };

        const handleAmountChange = (rawAmount: string) => {
          setPendingTarget(`${rawAmount} ครั้ง`);
        };

        const handlePresetClick = (val: number) => {
          setPendingTarget(`${val} ครั้ง`);
        };

        const handleConfirmPick = () => {
          const item = pendingPick;
          const instruction = pendingInstruction;
          const target = pendingTarget;
          setPendingPick(null);
          setPendingInstruction("");
          setPendingTarget("");
          void onPick(
            item,
            instruction.trim() ? instruction.trim() : undefined,
            target.trim() ? target.trim() : `${defaultReps} ครั้ง`
          );
        };

        return (
          <>
            <div
              className="therapist-panel-scrim"
              style={{ zIndex: 320 }}
              onClick={() => {
                if (!parentLoading) setPendingPick(null);
              }}
            />
            <div
              className="pd-modal pd-picker-confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="เพิ่มท่าบริหารลงในตารางฝึก"
              style={{ zIndex: 321 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="therapist-detail-header pd-picker-confirm-header">
                <div className="pd-picker-confirm-title-wrap">
                  <strong>เพิ่มท่าบริหารลงในตารางฝึก</strong>
                  {dayLabel && (
                    <span className="pd-picker-confirm-day-badge">{dayLabel}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setPendingPick(null)}
                  aria-label="ปิด"
                  disabled={parentLoading}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="pd-picker-confirm-body">
                {/* 1. Short detail card */}
                <div className="pd-picker-confirm-card">
                  <div className="pd-picker-confirm-media">
                    {thumbnailUrls[pendingPick.id] ? (
                      <>
                        <img
                          className="pd-picker-confirm-thumb"
                          src={thumbnailUrls[pendingPick.id]}
                          alt={`ภาพตัวอย่าง ${pendingPick.name}`}
                        />
                        <span className="pd-picker-confirm-badge-overlay">
                          <FileVideo size={10} /> วิดีโอ
                        </span>
                      </>
                    ) : (
                      <div className="pd-picker-confirm-placeholder">
                        <Icon size={24} />
                        <span>{pendingPick.hasDemoVideo ? "วิดีโอสาธิต" : "ท่าบริหาร"}</span>
                      </div>
                    )}
                  </div>

                  <div className="pd-picker-confirm-details">
                    <div className="pd-picker-confirm-name-row">
                      <h4 className="pd-picker-confirm-name">{pendingPick.name}</h4>
                    </div>
                    {pendingPick.nameTh && (
                      <span className="pd-picker-confirm-nameth">{pendingPick.nameTh}</span>
                    )}
                    <div className="pd-picker-confirm-chips">
                      <span className={`pd-picker-confirm-chip tracking tracking-${pendingPick.movementTracking}`}>
                        <Icon size={12} />
                        {trackingLabels[pendingPick.movementTracking]}
                      </span>
                      <span
                        className={`difficulty-badge ${
                          pendingPick.difficultyLevel === "medium" ? "moderate" : pendingPick.difficultyLevel
                        }`}
                      >
                        {difficultyLabels[pendingPick.difficultyLevel]}
                      </span>
                      <span className="pd-picker-confirm-chip author">
                        สร้างโดย {pendingPick.createdByName || "นักกายภาพบำบัด"}
                      </span>
                    </div>
                    {pendingPick.description && (
                      <p className="pd-picker-confirm-desc">{pendingPick.description}</p>
                    )}
                  </div>
                </div>

                {/* 2. Target Value Setter (Repetitions only) */}
                <div className="pd-picker-confirm-section">
                  <div className="pd-picker-confirm-section-header">
                    <div className="pd-picker-confirm-section-title">
                      <Target size={15} />
                      <span>จำนวนครั้งเป้าหมาย</span>
                    </div>
                    {isCustomTarget && (
                      <button
                        type="button"
                        className="pd-picker-confirm-reset-btn"
                        onClick={() => setPendingTarget(`${defaultReps} ครั้ง`)}
                        title="คืนค่าเป็นจำนวนครั้งเริ่มต้น"
                        disabled={parentLoading}
                      >
                        <RotateCcw size={11} /> คืนค่า ({defaultReps} ครั้ง)
                      </button>
                    )}
                  </div>

                  <div className="pd-picker-confirm-target-box">
                    <div className="pd-picker-confirm-stepper">
                      <button
                        type="button"
                        className="pd-picker-confirm-step-btn"
                        onClick={() => handleStep(-1)}
                        disabled={parentLoading || currentReps <= 1}
                        aria-label="ลดจำนวนครั้ง"
                      >
                        <Minus size={16} />
                      </button>

                      <div className="pd-picker-confirm-stepper-val">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="pd-picker-confirm-stepper-input"
                          value={targetParts.amount || ""}
                          onChange={(e) => handleAmountChange(e.target.value)}
                          disabled={parentLoading}
                          aria-label="จำนวนครั้งเป้าหมาย"
                        />
                        <span className="pd-picker-confirm-stepper-unit">ครั้ง</span>
                      </div>

                      <button
                        type="button"
                        className="pd-picker-confirm-step-btn"
                        onClick={() => handleStep(1)}
                        disabled={parentLoading}
                        aria-label="เพิ่มจำนวนครั้ง"
                      >
                        <Plus size={16} />
                      </button>
                    </div>

                    <div className="pd-picker-confirm-presets">
                      <span className="pd-picker-confirm-presets-label">เลือกด่วน:</span>
                      <div className="pd-picker-confirm-presets-list">
                        {[5, 8, 10, 12, 15, 20].map((preset) => {
                          const isSelected = currentReps === preset;
                          return (
                            <button
                              key={preset}
                              type="button"
                              className={`pd-picker-confirm-preset-btn ${isSelected ? "active" : ""}`}
                              onClick={() => handlePresetClick(preset)}
                              disabled={parentLoading}
                            >
                              {preset} ครั้ง
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Optional Therapist Instruction */}
                <div className="pd-picker-confirm-section">
                  <div className="pd-picker-confirm-section-header">
                    <div className="pd-picker-confirm-section-title">
                      <ClipboardList size={15} />
                      <span>คำแนะนำจากนักกายภาพบำบัด</span>
                    </div>
                    <span className="pd-optional-badge">ไม่บังคับ</span>
                  </div>

                  <textarea
                    className="pd-picker-confirm-textarea"
                    value={pendingInstruction}
                    onChange={(event) => setPendingInstruction(event.target.value)}
                    rows={3}
                    placeholder="เช่น ควบคุมการเคลื่อนไหวให้มั่นคง รักษาข้อศอกให้นิ่ง และพัก 30 วินาทีระหว่างครั้ง"
                    disabled={parentLoading}
                  />

                  <p className="pd-modal-hint pd-picker-confirm-hint">
                    <Info size={13} className="pd-picker-confirm-hint-icon" />
                    <span>คำแนะนำนี้จะแสดงให้ผู้ป่วยเห็นพร้อมกับท่าบริหาร เพื่อช่วยให้ฝึกได้อย่างถูกต้อง</span>
                  </p>
                </div>

                {/* 4. Action buttons */}
                <div className="pd-picker-confirm-actions">
                  <button
                    type="button"
                    className="secondary-button pd-picker-confirm-btn"
                    onClick={() => setPendingPick(null)}
                    disabled={parentLoading}
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    className="primary-button pd-picker-confirm-btn"
                    disabled={parentLoading}
                    onClick={handleConfirmPick}
                  >
                    {parentLoading ? (
                      <>
                        <Loader2 size={16} className="spin-icon" />
                        <span>กำลังเพิ่ม…</span>
                      </>
                    ) : (
                      <>
                        <Plus size={16} />
                        <span>เพิ่มลงในตารางฝึก</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        );
      })()}
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
  if (type === "image") return <ImageIcon size={18} />;
  if (type === "video") return <FileVideo size={18} />;
  return <FileText size={18} />;
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

function fileTypeBadge(file: AvailableFileItem): string {
  const parts = file.originalName.split(".");
  const ext = parts.length > 1 ? parts.pop()?.toUpperCase() : null;
  if (ext && ext.length <= 5) return ext;
  if (file.fileType === "image") return "รูปภาพ";
  if (file.fileType === "video") return "วิดีโอ";
  if (file.fileType === "document") return "เอกสาร";
  return "ไฟล์";
}

function PlanModal({
  selectedPlan,
  mode,
  readOnly = false,
  availableAttachments,
  availableFiles,
  token,
  onFileUploaded,
  onClose,
  onSave
}: {
  selectedPlan: PatientRehabPlan | null;
  // Fixed mode: the "+" button opens this modal in "create", the bottom
  // "Edit plan" button in "edit" — there is no in-modal switcher anymore.
  mode: "edit" | "create";
  // True when the opener may VIEW but not edit this plan — the signed-in
  // therapist is not assigned to the patient (PatientDetailPage's canEditPlan
  // === false). Every field, the attachment tools and the submit button are
  // then disabled so the popup can never look editable while being un-saveable;
  // Close and file preview remain available.
  readOnly?: boolean;
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
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ file: AvailableFileItem; url: string; mime: string } | null>(null);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
  const [previewingFileId, setPreviewingFileId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const medicalFileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadPickedFile = async (file: File) => {
    if (!token) {
      setUploadError("กรุณาเข้าสู่ระบบอีกครั้งเพื่อแนบไฟล์");
      return;
    }
    setUploadingFile(true);
    setUploadingFileName(file.name);
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
          : "อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง"
      );
    } finally {
      setUploadingFile(false);
      setUploadingFileName(null);
    }
  };

  const handleMedicalFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow re-picking the same file after a failure.
    event.target.value = "";
    if (file) void handleUploadPickedFile(file);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleUploadPickedFile(file);
  };

  const handlePreviewFile = async (file: AvailableFileItem) => {
    if (!token) {
      setUploadError("กรุณาเข้าสู่ระบบเพื่อดูตัวอย่างไฟล์");
      return;
    }
    setPreviewingFileId(file.fileId);
    setPreviewError(null);
    try {
      const blob = await getFileContent(token, file.fileId);
      const defaultMime =
        file.fileType === "image"
          ? "image/jpeg"
          : file.fileType === "video"
            ? "video/mp4"
            : file.originalName.toLowerCase().endsWith(".pdf")
              ? "application/pdf"
              : "application/octet-stream";
      const mime = blob.type || file.mimeType || defaultMime;
      const typedBlob = blob.type ? blob : new Blob([blob], { type: mime });
      const url = URL.createObjectURL(typedBlob);
      setPreviewFile({ file, url, mime });
    } catch (err) {
      setPreviewError(err instanceof ApiError ? err.message : "โหลดตัวอย่างไฟล์ไม่สำเร็จ");
    } finally {
      setPreviewingFileId(null);
    }
  };

  const handleClosePreview = () => {
    if (previewFile) {
      URL.revokeObjectURL(previewFile.url);
      setPreviewFile(null);
      setIsPreviewMaximized(false);
    }
  };

  useEffect(() => {
    return () => {
      if (previewFile?.url) {
        URL.revokeObjectURL(previewFile.url);
      }
    };
  }, [previewFile]);

  const toggleAttachment = (fileId: string, defaultDesc = "") => {
    if (readOnly) return;
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
    if (readOnly) return;
    setSelectedAttachmentsMap((current) => ({
      ...current,
      [fileId]: desc
    }));
  };

  const selectedCount = Object.keys(selectedAttachmentsMap).length;
  // The "All" tab was removed — this list ALWAYS shows only the files attached
  // to this plan (a fresh upload auto-attaches, and each card's checkbox/×
  // still unlinks it).
  const displayedFiles = useMemo(
    () => uniqueAvailableFiles.filter((f) => f.fileId in selectedAttachmentsMap),
    [uniqueAvailableFiles, selectedAttachmentsMap]
  );

  // The modal is mounted fresh each open with a fixed mode (create via the
  // column's "+" button, edit via the bottom "Edit plan" button) — no
  // in-modal switcher, so no switchMode reset logic is needed.

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    // Read-only popup (therapist not assigned) — never saves, even if a key
    // press somehow re-enables the form.
    if (readOnly) return;
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
      <div className="pd-modal" role="dialog" aria-label="จัดการแผนฟื้นฟู" style={{ width: "min(100%, 580px)" }}>
        <div className="therapist-detail-header">
          <strong>
            {readOnly
              ? "แผนฟื้นฟู (ดูอย่างเดียว)"
              : mode === "create"
                ? "สร้างแผนฟื้นฟูใหม่"
                : "แก้ไขแผนฟื้นฟู"}
          </strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>

        <form className="pd-modal-form" onSubmit={handleSubmit}>
          <label>
            ชื่อแผน
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="เช่น แผนฟื้นฟูระยะเริ่มต้นหลังโรคหลอดเลือดสมอง"
              disabled={readOnly}
              required
            />
          </label>

          <label>
            คำอธิบาย (ไม่บังคับ)
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} disabled={readOnly} />
          </label>

          <label>
            สถานะ
            <select
              className="admin-role-select"
              value={status}
              onChange={(event) => setStatus(event.target.value as RehabPlanStatus)}
              disabled={readOnly}
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
              วันที่เริ่มต้น
              <div className="date-input-with-calendar">
                <input type="text" inputMode="numeric" placeholder="วัน/เดือน/ปี" disabled={readOnly} value={startDateInput} onChange={(event) => {
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
                <input className="native-calendar-trigger" type="date" disabled={readOnly} value={startDateLabel} min={mode === "create" ? todayDateLabel : undefined} aria-label="เลือกวันที่เริ่มต้น" onChange={(event) => {
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
              วันที่สิ้นสุด
              <div className="date-input-with-calendar">
                <input type="text" inputMode="numeric" placeholder="วัน/เดือน/ปี" disabled={readOnly} value={endDateInput} onChange={(event) => {
                  const value = isoDateFromDisplay(event.target.value);
                  setEndDateInput(event.target.value);
                  if (value) setEndDateLabel(value);
                }} required />
                <span className="date-calendar-icon" aria-hidden="true"><Calendar size={16} /></span>
                <input className="native-calendar-trigger" type="date" disabled={readOnly} value={endDateLabel} min={startDateLabel || todayDateLabel} aria-label="เลือกวันที่สิ้นสุด" onChange={(event) => {
                  const value = event.target.value;
                  setEndDateLabel(value);
                  setEndDateInput(displayDateLabel(value));
                }} />
              </div>
            </label>
          </div>

          {/* Medical Attachments selection */}
          <div className="pd-attachments-container">
            <div className="pd-attachments-header-row">
              <label className="pd-attachments-title">
                <Paperclip size={15} /> ไฟล์ทางการแพทย์
                {selectedCount > 0 && (
                  <span className="pd-attachments-count-badge">
                    <Check size={11} strokeWidth={3} /> แนบแล้ว {selectedCount} ไฟล์
                  </span>
                )}
              </label>
            </div>

            {/* Hidden file input */}
            <input
              ref={medicalFileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={handleMedicalFilePicked}
              aria-label="เลือกไฟล์ทางการแพทย์เพื่ออัปโหลด"
            />

            {/* Dropzone & Upload trigger — inert in read-only mode (no click,
                no drag-and-drop) so a non-assigned therapist can't upload. */}
            <div
              className={`pd-attachments-dropzone ${isDragOver ? "drag-over" : ""}${readOnly ? " read-only" : ""}`}
              onClick={() => {
                if (!readOnly) medicalFileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                if (readOnly) return;
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={readOnly ? undefined : handleDrop}
            >
              <div className="pd-attachments-dropzone-left">
                <span className="pd-attachments-dropzone-icon">
                  <UploadCloud size={18} />
                </span>
                <div className="pd-attachments-dropzone-text">
                  <strong>{uploadingFile ? "กำลังอัปโหลดไฟล์ทางการแพทย์…" : readOnly ? "ไม่สามารถอัปโหลดไฟล์ทางการแพทย์ได้" : "แนบไฟล์ทางการแพทย์"}</strong>
                  <small>
                    {readOnly
                      ? "เฉพาะนักกายภาพบำบัดที่ได้รับมอบหมายให้ดูแลผู้ป่วยรายนี้เท่านั้นที่แนบไฟล์ได้"
                      : "ลากและวางหรือคลิกเพื่อแนบภาพ MRI รายงาน หรือประวัติการรักษา"}
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="pd-attachments-browse-btn"
                disabled={uploadingFile || !token || readOnly}
                onClick={(e) => {
                  e.stopPropagation();
                  medicalFileInputRef.current?.click();
                }}
              >
                {uploadingFile ? "กำลังอัปโหลด…" : "เลือกไฟล์"}
              </button>
            </div>

            {uploadingFile && (
              <div className="pd-attachments-uploading-row">
                <Loader2 size={16} className="filepicker-spin" style={{ color: "var(--primary)" }} />
                <div className="pd-attachments-uploading-info">
                  <p className="pd-attachments-uploading-filename">
                    {uploadingFileName || "กำลังอัปโหลดไฟล์…"}
                  </p>
                  <div className="filepicker-progress-track">
                    <div className="filepicker-progress-fill" style={{ width: "100%" }} />
                  </div>
                </div>
              </div>
            )}

            {uploadError && (
              <p className="auth-error-banner" role="alert" style={{ margin: 0 }}>
                {uploadError}
              </p>
            )}
            {previewError && (
              <p className="auth-error-banner" role="alert" style={{ margin: 0 }}>
                {previewError}
              </p>
            )}

            {uniqueAvailableFiles.length === 0 ? (
              <p className="pd-empty-note" style={{ margin: 0, padding: "12px 0", fontSize: "0.82rem" }}>
                ยังไม่มีไฟล์ทางการแพทย์หรือไฟล์แนบของผู้ป่วยรายนี้ คลิกปุ่มด้านบนเพื่ออัปโหลด
              </p>
            ) : displayedFiles.length === 0 ? (
              <p className="pd-empty-note" style={{ margin: 0, padding: "12px 0", fontSize: "0.82rem" }}>
                ยังไม่มีไฟล์แนบในแผนนี้ คลิกปุ่มด้านบนเพื่ออัปโหลดและแนบไฟล์
              </p>
            ) : (
              <div className="pd-attachments-list">
                {displayedFiles.map((file) => {
                  const isChecked = file.fileId in selectedAttachmentsMap;
                  const isOriginallyAttached = selectedPlan?.attachments?.some((a) => a.fileId === file.fileId);
                  return (
                    <div
                      key={file.fileId}
                      className={`pd-attachment-card ${isChecked ? "selected" : ""}`}
                    >
                      <div className="pd-attachment-card-header">
                        <label
                          className="pd-attachment-checkbox-label"
                          title={isChecked ? "นำออกจากแผน" : "แนบกับแผน"}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className="pd-attachment-checkbox"
                            checked={isChecked}
                            disabled={readOnly}
                            onChange={() => toggleAttachment(file.fileId, file.defaultDescription ?? "")}
                          />
                          <span className="pd-attachment-custom-check" aria-hidden="true">
                            {isChecked && <Check size={13} strokeWidth={3} />}
                          </span>
                        </label>

                        <div className={`pd-attachment-thumb ${file.fileType}`}>
                          {getFileIcon(file.fileType)}
                        </div>

                        <div
                          className="pd-attachment-info"
                          onClick={() => toggleAttachment(file.fileId, file.defaultDescription ?? "")}
                        >
                          <div className="pd-attachment-title-row">
                            <strong className="pd-attachment-filename" title={file.originalName}>
                              {file.originalName}
                            </strong>
                            <div className="pd-attachment-badges">
                              {isChecked && (
                                <span className="pd-attachment-pill attached">
                                  <CheckCircle2 size={10} /> แนบแล้ว
                                </span>
                              )}
                              {isOriginallyAttached && mode === "edit" && (
                                <span className="pd-attachment-pill saved">บันทึกแล้ว</span>
                              )}
                            </div>
                          </div>
                          <div className="pd-attachment-meta-row">
                            <span className="pd-attachment-type-tag">{fileTypeBadge(file)}</span>
                            {file.fileSize != null && <span>{formatFileSize(file.fileSize)}</span>}
                            {file.uploadedAtLabel && <span>อัปโหลดเมื่อ {file.uploadedAtLabel}</span>}
                          </div>
                        </div>

                        <div className="pd-attachment-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="pd-attachment-action-btn view-btn"
                            title="ดูตัวอย่างไฟล์"
                            onClick={() => void handlePreviewFile(file)}
                            disabled={previewingFileId === file.fileId}
                          >
                            {previewingFileId === file.fileId ? (
                              <Loader2 size={12} className="filepicker-spin" />
                            ) : (
                              <Eye size={12} />
                            )}
                            <span>{previewingFileId === file.fileId ? "กำลังโหลด…" : "ดู"}</span>
                          </button>
                          {isChecked && (
                            <button
                              type="button"
                              className="pd-attachment-action-btn remove-btn"
                              title="นำไฟล์แนบนี้ออก"
                              disabled={readOnly}
                              onClick={() => toggleAttachment(file.fileId)}
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {isChecked && (
                        <div className="pd-attachment-note-section">
                          <div className="pd-attachment-note-header">
                            <FileText size={12} className="pd-attachment-note-icon" />
                            <span>บันทึกทางคลินิก / บริบทของแผน</span>
                          </div>
                          <div className="pd-attachment-note-input-wrap">
                            <input
                              type="text"
                              className="pd-attachment-note-input"
                              placeholder="เช่น ภาพ MRI เริ่มต้น สรุปการจำหน่าย หรือผล CT"
                              value={selectedAttachmentsMap[file.fileId] ?? ""}
                              disabled={readOnly}
                              onChange={(e) => updateAttachmentDescription(file.fileId, e.target.value)}
                            />
                            {selectedAttachmentsMap[file.fileId] && (
                              <button
                                type="button"
                                className="pd-attachment-note-clear"
                                title="ล้างบันทึก"
                                disabled={readOnly}
                                onClick={() => updateAttachmentDescription(file.fileId, "")}
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="pd-modal-hint">
            <Calendar size={12} />{" "}
            {readOnly
              ? "ดูอย่างเดียว — เฉพาะนักกายภาพบำบัดที่ได้รับมอบหมายให้ดูแลผู้ป่วยรายนี้เท่านั้นที่แก้ไขแผนได้"
              : mode === "create"
                ? "สร้างตารางฝึกรายวันใหม่และเชื่อมโยงไฟล์ทางการแพทย์ที่เลือก"
                : "การแก้ไขจะอัปเดตข้อมูลแผนและซิงก์ไฟล์ทางการแพทย์ที่แนบไว้"}
          </p>

          {/* Read-only viewers get Close instead of a submit button — there is
              nothing they can change, and handleSavePlan would reject it anyway. */}
          {readOnly ? (
            <button type="button" className="primary-button full-width" onClick={onClose}>
              ปิด
            </button>
          ) : (
            <button type="submit" className="primary-button full-width">
              {mode === "create" ? "สร้างแผน" : "บันทึกการเปลี่ยนแปลง"}
            </button>
          )}
        </form>
      </div>

      {previewFile && (
        <>
          <div className="therapist-panel-scrim" style={{ zIndex: 299 }} onClick={handleClosePreview} />
          <div
            className={`pd-attachment-preview-modal ${isPreviewMaximized ? "maximized" : ""}`}
            role="dialog"
            aria-label={`ตัวอย่างไฟล์ ${previewFile.file.originalName}`}
          >
            <div className="pd-attachment-preview-header">
              <div className="pd-attachment-preview-title" title={previewFile.file.originalName}>
                {getFileIcon(previewFile.file.fileType)}
                <span>{previewFile.file.originalName}</span>
                <span className="pd-attachment-type-tag" style={{ marginLeft: 6 }}>
                  {fileTypeBadge(previewFile.file)}
                </span>
              </div>
              <div className="pd-attachment-preview-header-actions">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setIsPreviewMaximized(!isPreviewMaximized)}
                  title={isPreviewMaximized ? "คืนค่าขนาดเดิม" : "ขยายเต็มหน้าจอ"}
                  aria-label={isPreviewMaximized ? "คืนค่าขนาดเดิม" : "ขยายเต็มหน้าจอ"}
                >
                  {isPreviewMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={handleClosePreview}
                  aria-label="ปิดตัวอย่างไฟล์"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="pd-attachment-preview-body">
              {previewFile.file.fileType === "image" || previewFile.mime.startsWith("image/") ? (
                <img
                  src={previewFile.url}
                  alt={previewFile.file.originalName}
                  className="pd-attachment-preview-img"
                />
              ) : previewFile.file.fileType === "video" || previewFile.mime.startsWith("video/") ? (
                <video
                  src={previewFile.url}
                  controls
                  autoPlay
                  className="pd-attachment-preview-video"
                />
              ) : previewFile.mime.includes("pdf") || previewFile.file.originalName.toLowerCase().endsWith(".pdf") ? (
                <iframe
                  src={previewFile.url}
                  title={previewFile.file.originalName}
                  className="pd-attachment-preview-iframe"
                />
              ) : (
                <div className="pd-attachment-preview-fallback">
                  <FileText size={48} style={{ opacity: 0.6, marginBottom: 12 }} />
                  <p style={{ margin: "0 0 6px", fontSize: "0.92rem", fontWeight: 600 }}>
                    {previewFile.file.originalName}
                  </p>
                  <p style={{ margin: 0, fontSize: "0.78rem", opacity: 0.7 }}>
                    ไฟล์ประเภทนี้ควรเปิดดูในแท็บเบราว์เซอร์หรือโปรแกรมดูไฟล์แยกต่างหาก
                  </p>
                </div>
              )}
            </div>

            <div className="pd-attachment-preview-actions">
              <a
                href={previewFile.url}
                target="_blank"
                rel="noreferrer"
                className="secondary-button"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
              >
                <ExternalLink size={14} /> เปิดในหน้าต่างใหม่
              </a>
              <button type="button" className="primary-button" onClick={handleClosePreview}>
                ปิด
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
