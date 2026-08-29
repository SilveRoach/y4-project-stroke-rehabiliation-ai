import {
  ArrowLeft,
  Bell,
  Calendar,
  ChevronRight,
  ClipboardList,
  Eye,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import {
  ApiError,
  getTherapistSessions,
  getPatientPlans,
  createPatientPlan,
  patchPlan,
  createScheduleDay,
  createScheduledExercise,
  patchScheduleDay,
  patchScheduledExerciseStatus,
  getPatientAttachments,
  addPlanAttachment,
  deletePlanAttachment
} from "../services/api";
import { useAuth } from "../store/authStore";
import type {
  HeatmapDayStatus,
  PatientRehabPlan,
  PlanAttachment,
  PlanAttachmentFile,
  RehabPlanStatus,
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
  // Program Editor entry point (PT_EXERCISE_PATH_MOCKUP_PLAN.md §4.5) — opens the
  // currently-selected plan for schedule/exercise editing. pendingPlanUpdate is how
  // Program Editor's Save hands the edited plan back down once the PT returns here
  // (App.tsx owns that piece of state since this page and Program Editor are
  // siblings, not parent/child — see App.tsx's comment on pendingPlanUpdate).
  onOpenProgramEditor: (plan: PatientRehabPlan) => void;
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

interface CalendarCell {
  key: string;
  status: HeatmapDayStatus | null;
  dateNumber: number | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Lays a plan's heatmap out as a real Sun-first calendar grid (leading/trailing
// blank cells padding each week row) instead of a flat strip, so it reads like an
// actual calendar rather than an abstract heatmap. Falls back to date-less cells
// when there's no real startDateLabel to anchor on (e.g. a freshly-created plan
// mid-edit in PlanModal, before Start date is filled in).
function buildCalendarCells(plan: PatientRehabPlan): CalendarCell[] {
  if (!ISO_DATE_RE.test(plan.startDateLabel)) {
    return plan.heatmap.map((status, index) => ({ key: `d${index}`, status, dateNumber: null }));
  }

  const startDate = new Date(`${plan.startDateLabel}T00:00:00`);
  const cells: CalendarCell[] = [];

  for (let i = 0; i < startDate.getDay(); i++) {
    cells.push({ key: `lead-${i}`, status: null, dateNumber: null });
  }

  plan.heatmap.forEach((status, index) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + index);
    cells.push({ key: `day-${index}`, status, dateNumber: date.getDate() });
  });

  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, status: null, dateNumber: null });
  }

  return cells;
}

function calendarPeriodLabel(plan: PatientRehabPlan): string {
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

// Small reusable helper component: day detail panel that calls real APIs and
// refreshes plans via the parent-provided callback. Kept intentionally compact
// to minimize changes to the rest of the page.
function DayDetailPanel({
  token,
  patientId,
  plan,
  dayIndex,
  onRefresh
}: {
  token: string | null | undefined;
  patientId: string;
  plan: PatientRehabPlan;
  dayIndex: number;
  onRefresh: () => Promise<void>;
}) {
  if (!plan || dayIndex == null || !plan.days || dayIndex < 0 || dayIndex >= plan.days.length) return null;
  const day = plan.days[dayIndex];

  return (
    <div className="pd-day-detail">
      <h4>Day details</h4>
      <p>
        Date: {day.dateLabel ?? "(no date)"} &middot; Status: {day.status}
      </p>
      <p>Note: {day.therapistNote ?? "(none)"}</p>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="secondary-button"
          onClick={async () => {
            if (!token) return alert("Not authenticated");
            const note = window.prompt("Edit therapist note:", day.therapistNote ?? "");
            if (note === null) return;
            try {
              await patchScheduleDay(token, day.id!, { therapistNote: note === "" ? undefined : note });
              await onRefresh();
            } catch (err) {
              alert(err instanceof ApiError ? err.message : String(err));
            }
          }}
        >
          Edit note
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={async () => {
            if (!token) return alert("Not authenticated");
            if (!day.id) return alert("Day has no id");
            const exerciseLibraryId = window.prompt("Enter exercise library id:");
            if (!exerciseLibraryId) return;
            const orderString = window.prompt("Optional order number (leave empty to auto-assign):");
            const orderNumber = orderString ? Number(orderString) : undefined;
            try {
              await createScheduledExercise(token, day.id, { exerciseLibraryId, orderNumber });
              await onRefresh();
            } catch (err) {
              alert(err instanceof ApiError ? err.message : String(err));
            }
          }}
        >
          Add exercise to this day
        </button>
      </div>

      <div className="pd-day-exercises">
        <h5>Exercises</h5>
        {(!day.exercises || day.exercises.length === 0) ? (
          <p className="pd-empty-note">No exercises assigned to this day.</p>
        ) : (
          <ul>
            {day.exercises.map((ex) => (
              <li key={ex.id} className="pd-day-exercise-row">
                <div>
                  <strong>{ex.exerciseName}</strong>
                  <small>{ex.targetValueLabel}</small>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span className={`pd-ex-status ${ex.status}`}>{ex.status}</span>
                  <button
                    type="button"
                    className="text-action"
                    onClick={async () => {
                      if (!token) return alert("Not authenticated");
                      try {
                        await patchScheduledExerciseStatus(token, ex.id, { status: "completed" });
                        await onRefresh();
                      } catch (err) {
                        alert(err instanceof ApiError ? err.message : String(err));
                      }
                    }}
                  >
                    Mark completed
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function PatientDetailPage({
  patient,
  onBack,
  onLogout,
  onNavigate,
  onReviewSession,
  onOpenProgramEditor,
  pendingPlanUpdate
}: PatientDetailPageProps) {
  const { token, user } = useAuth();
  const therapistDisplayName = user?.displayName || user?.username || "Therapist";

  // patients.gender / date_of_birth aren't exposed by any endpoint a therapist is
  // authorized to call (GET /users/:id is "Self, or Admin" only — see
  // user.controller.ts's getUserProfileHandler), and schema.prisma's Patient
  // model has no affected-side column at all (dropped from the newdb.txt design
  // — see schema.prisma's own header note). Rather than invent values, these
  // stay fixed fallbacks; "None" already renders as "Affected side not
  // recorded" below, same as the old mock's own generic fallback profile did.
  const sex: "Male" | "Female" | "Other" = "Other";
  const affectedSide: "Left" | "Right" | "Both" | "None" = "None";
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

  // Available medical attachments & files for this patient
  const [availableAttachments, setAvailableAttachments] = useState<PlanAttachment[]>([]);
  const [availableFiles, setAvailableFiles] = useState<PlanAttachmentFile[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [viewingFile, setViewingFile] = useState<{ file: PlanAttachmentFile; description?: string | null } | null>(null);
  const [showAddAttachmentModal, setShowAddAttachmentModal] = useState(false);

  function handleSelectDay(key: string) {
    if (!selectedPlan) return;
    if (!key.startsWith("day-")) return;
    const idx = Number(key.split("-")[1]);
    if (!Number.isFinite(idx)) return;
    if (!selectedPlan.days || idx < 0 || idx >= selectedPlan.days.length) return;
    setSelectedDayIndex(idx);
  }

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
          targetValueLabel: ex.targetValue ? (typeof ex.targetValue === "object" ? JSON.stringify(ex.targetValue) : String(ex.targetValue)) : "",
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
  const calendarCells = selectedPlan ? buildCalendarCells(selectedPlan) : [];

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

  const handleRemoveAttachment = async (attachmentId: string) => {
    if (!token || !selectedPlan) return;
    if (!window.confirm("Remove this medical attachment from the rehabilitation plan?")) return;
    try {
      await deletePlanAttachment(token, selectedPlan.id, attachmentId);
      await refreshPlans();
      await refreshAvailableAttachments();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : String(err));
    }
  };

  const handleAddAttachment = async (fileId: string, description?: string) => {
    if (!token || !selectedPlan) return;
    try {
      await addPlanAttachment(token, selectedPlan.id, { fileId, description });
      await refreshPlans();
      await refreshAvailableAttachments();
      setShowAddAttachmentModal(false);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : String(err));
    }
  };

  // Add a new schedule day to the selected plan (prompts for date & optional note)
  const handleAddScheduleDay = async () => {
    if (!token) return alert("Not authenticated");
    if (!selectedPlan) return alert("No plan selected");
    const date = window.prompt("Enter scheduled date (YYYY-MM-DD):");
    if (!date) return;
    if (!ISO_DATE_RE.test(date)) return alert("Invalid date format");
    const note = window.prompt("Optional therapist note:") || undefined;
    try {
      await createScheduleDay(token, selectedPlan.id, date, note);
      await refreshPlans();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : String(err));
    }
  };

  // Add a scheduled exercise to the first day of the selected plan (simple flow)
  const handleAddExerciseToFirstDay = async () => {
    if (!token) return alert("Not authenticated");
    if (!selectedPlan || !selectedPlan.days || selectedPlan.days.length === 0) return alert("Selected plan has no days");
    const firstDay = selectedPlan.days[0];
    if (!firstDay.id) return alert("Selected day has no id");
    const exerciseLibraryId = window.prompt("Enter exercise library id:");
    if (!exerciseLibraryId) return;
    const orderString = window.prompt("Optional order number (leave empty to auto-assign):");
    const orderNumber = orderString ? Number(orderString) : undefined;
    try {
      const dayId = firstDay.id;
      await createScheduledExercise(token, dayId, { exerciseLibraryId, orderNumber });
      await refreshPlans();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : String(err));
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

          {/* 1. Patient header */}
          <div className="pd-header">
            <div>
              <h1>{patient.name}</h1>
              <p>
                {sex} &middot; Age {patient.age} &middot;{" "}
                {affectedSide === "None"
                  ? "Affected side not recorded"
                  : `${affectedSide} side affected`}{" "}
                &middot; Patient ID {patientCode}
              </p>
            </div>
            {/* Stub: no reporting backend exists yet (session-results/logging still
                unbuilt per PROJECT_STATUS.md) — kept visibly disabled rather than
                faking a download. */}
            <button type="button" className="secondary-button" disabled title="Reporting backend not built yet">
              <FileText size={14} /> Generate summary report
            </button>
          </div>

          {/* 2. Rehab Plan card: calendar on the left, scrollable plan selector on
              the right, full-width like the dashboard's patient table card —
              replaces the old side-by-side Program+Progress cards, and folds
              "Edit program" into a real, working "View / edit / create plan"
              button (previously a disabled stub pointing at a mockup-only Program
              Editor page). */}
          <div className="summary-card pd-plan-card">
            {selectedPlan ? (
              <div className="pd-plan-layout">
                <div>
                  <div className="pd-plan-calendar-heading">
                    <div>
                      <strong>{selectedPlan.name}</strong>
                      <p>
                        <span className={`pd-program-status ${selectedPlan.status}`}>
                          {planStatusLabels[selectedPlan.status]}
                        </span>
                        &nbsp;&middot; Day {planProgress(selectedPlan).current} of {planProgress(selectedPlan).total}
                        &nbsp;&middot; {calendarPeriodLabel(selectedPlan)}
                      </p>
                    </div>
                  </div>
                  <div className="pd-calendar-weekdays">
                    {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                      <span key={index}>{day}</span>
                    ))}
                  </div>
                  <div className="pd-calendar-grid">
                    {calendarCells.map((cell) => (
                      <div
                        key={cell.key}
                        className={`pd-calendar-cell ${cell.status ?? "blank"}`}
                        title={cell.status ? heatmapLabels[cell.status] : undefined}
                      >
                        {cell.dateNumber ?? ""}
                      </div>
                    ))}
                  </div>
                  <div className="pd-legend">
                    {(["completed", "in_progress", "skipped", "pending", "cancelled"] as HeatmapDayStatus[]).map((status) => (
                      <span key={status}>
                        <span className={`pd-legend-dot ${status}`} />
                        {heatmapLabels[status]}
                      </span>
                    ))}
                  </div>

                  {/* Day detail panel (wired to real API) */}
                  {selectedPlan && selectedDayIndex !== null && (
                    <DayDetailPanel token={token} patientId={patient.id} plan={selectedPlan} dayIndex={selectedDayIndex} onRefresh={refreshPlans} />
                  )}                </div>

                <div className="pd-plan-selector">
                  <p className="pd-plan-selector-label">Rehab plans</p>
                  <div className="pd-plan-list">
                    {plans.map((plan) => {
                      const progress = planProgress(plan);
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={`pd-plan-row ${plan.id === selectedPlan.id ? "active" : ""}`}
                          onClick={() => setSelectedPlanId(plan.id)}
                        >
                          <strong>{plan.name}</strong>
                          <span className={`pd-program-status ${plan.status}`}>{planStatusLabels[plan.status]}</span>
                          <small>
                            Day {progress.current} of {progress.total}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                  {/* Real, client-side: opens PlanModal to view/edit the selected plan
                      or start a new one — see handleSavePlan's comment for the
                      backend caveat. */}
                  <button type="button" className="secondary-button full-width" onClick={() => setShowPlanModal(true)}>
                    <ClipboardList size={14} /> View / edit / create plan
                  </button>
                  {/* Real: opens Program Editor for this plan — previously the only
                      way to touch a plan's schedule was this disabled stub
                      (PT_EXERCISE_PATH_MOCKUP_PLAN.md §1's audit). PlanModal above
                      still only edits plan metadata (name/dates/status); this is
                      what actually assigns exercises to specific days. */}
                  <button
                    type="button"
                    className="secondary-button full-width"
                    onClick={() => onOpenProgramEditor(selectedPlan)}
                  >
                    <Calendar size={14} /> Edit schedule / exercises
                  </button>
                  <button
                    type="button"
                    className="secondary-button full-width"
                    onClick={handleAddScheduleDay}
                  >
                    <Plus size={14} /> Add schedule day
                  </button>
                  <button
                    type="button"
                    className="secondary-button full-width"
                    onClick={handleAddExerciseToFirstDay}
                  >
                    <Plus size={14} /> Add exercise to first day
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="pd-empty-note">This patient has no rehabilitation plan yet.</p>
                <button type="button" className="secondary-button" onClick={() => setShowPlanModal(true)}>
                  <ClipboardList size={14} /> Create plan
                </button>
              </>
            )}
          </div>

          {/* 3 & 4. Medical Attachments + Session history, side by side as their own cards */}
          <div className="pd-bottom-grid">
            {/* Plan Medical Attachments card */}
            <div className="summary-card pd-attachments-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Paperclip size={16} /> Plan Medical Attachments
                  </strong>
                  <p>
                    {selectedPlan
                      ? `${selectedPlan.attachments?.length ?? 0} attachment${(selectedPlan.attachments?.length ?? 0) === 1 ? "" : "s"} linked to this plan`
                      : "No plan selected"}
                  </p>
                </div>
                {selectedPlan && (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ minHeight: 32, padding: "4px 10px", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: 4 }}
                    onClick={() => setShowAddAttachmentModal(true)}
                  >
                    <Plus size={13} /> Attach file
                  </button>
                )}
              </div>

              {!selectedPlan ? (
                <p className="pd-empty-note">Select a plan above to view its medical attachments.</p>
              ) : (!selectedPlan.attachments || selectedPlan.attachments.length === 0) ? (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <p className="pd-empty-note">No medical attachments linked to this rehabilitation plan.</p>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ marginTop: 8 }}
                    onClick={() => setShowAddAttachmentModal(true)}
                  >
                    <Paperclip size={14} /> Associate medical attachment
                  </button>
                </div>
              ) : (
                <div className="pd-session-list">
                  {selectedPlan.attachments.map((att) => {
                    const fileType = att.file?.fileType ?? "document";
                    const fileName = att.file?.originalName ?? "Medical Attachment";
                    const fileSizeLabel = formatFileSize(att.file?.fileSize);
                    return (
                      <div key={att.id} className="pd-session-row">
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="filepicker-thumb" style={{ width: 34, height: 34 }}>
                            {getFileIcon(fileType)}
                          </span>
                          <div>
                            <strong style={{ fontSize: "0.85rem", color: "var(--text-primary)" }}>{fileName}</strong>
                            <small>
                              {fileType}
                              {fileSizeLabel ? ` \u00b7 ${fileSizeLabel}` : ""}
                              {att.uploadedAtLabel ? ` \u00b7 ${att.uploadedAtLabel}` : ""}
                            </small>
                            {att.description && (
                              <p style={{ margin: "2px 0 0", fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                                {att.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="pd-session-actions" style={{ gap: 6 }}>
                          {att.file && (
                            <button
                              type="button"
                              className="text-action"
                              onClick={() => setViewingFile({ file: att.file!, description: att.description })}
                              title="View file details"
                            >
                              <Eye size={13} /> View
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-action"
                            style={{ color: "var(--error)" }}
                            onClick={() => handleRemoveAttachment(att.id)}
                            title="Remove attachment from plan"
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

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
          </div>
        </main>
      </div>

      {showPlanModal && (
        <PlanModal
          selectedPlan={selectedPlan}
          availableAttachments={availableAttachments}
          availableFiles={availableFiles}
          onClose={() => setShowPlanModal(false)}
          onSave={handleSavePlan}
        />
      )}

      {showAddAttachmentModal && selectedPlan && (
        <AddAttachmentModal
          selectedPlan={selectedPlan}
          availableAttachments={availableAttachments}
          availableFiles={availableFiles}
          onClose={() => setShowAddAttachmentModal(false)}
          onAdd={handleAddAttachment}
        />
      )}

      {viewingFile && (
        <FileViewModal
          file={viewingFile.file}
          description={viewingFile.description}
          onClose={() => setViewingFile(null)}
        />
      )}
    </section>
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
  availableAttachments,
  availableFiles,
  onClose,
  onSave
}: {
  selectedPlan: PatientRehabPlan | null;
  availableAttachments: PlanAttachment[];
  availableFiles: PlanAttachmentFile[];
  onClose: () => void;
  onSave: (
    plan: PatientRehabPlan,
    mode: "edit" | "create",
    selectedAttachments?: Array<{ fileId: string; description?: string }>
  ) => void;
}) {
  const [mode, setMode] = useState<"edit" | "create">(selectedPlan ? "edit" : "create");
  const [name, setName] = useState(selectedPlan?.name ?? "");
  const [description, setDescription] = useState(selectedPlan?.description ?? "");
  const [status, setStatus] = useState<RehabPlanStatus>(selectedPlan?.status ?? "draft");
  const [startDateLabel, setStartDateLabel] = useState(
    selectedPlan && ISO_DATE_RE.test(selectedPlan.startDateLabel) ? selectedPlan.startDateLabel : ""
  );
  const [endDateLabel, setEndDateLabel] = useState(
    selectedPlan?.endDateLabel && ISO_DATE_RE.test(selectedPlan.endDateLabel) ? selectedPlan.endDateLabel : ""
  );

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

  // Switching between "edit the selected plan" and "start a new one" resets the
  // form to that mode's starting values
  const switchMode = (nextMode: "edit" | "create") => {
    setMode(nextMode);
    if (nextMode === "edit" && selectedPlan) {
      setName(selectedPlan.name);
      setDescription(selectedPlan.description ?? "");
      setStatus(selectedPlan.status);
      setStartDateLabel(ISO_DATE_RE.test(selectedPlan.startDateLabel) ? selectedPlan.startDateLabel : "");
      setEndDateLabel(selectedPlan.endDateLabel && ISO_DATE_RE.test(selectedPlan.endDateLabel) ? selectedPlan.endDateLabel : "");
      const init: Record<string, string> = {};
      for (const att of selectedPlan.attachments ?? []) {
        init[att.fileId] = att.description ?? "";
      }
      setSelectedAttachmentsMap(init);
    } else {
      setName("");
      setDescription("");
      setStatus("draft");
      setStartDateLabel("");
      setEndDateLabel("");
      setSelectedAttachmentsMap({});
    }
  };

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
          <strong>Rehabilitation plan</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {selectedPlan && (
          <div className="library-segmented">
            <button type="button" className={mode === "edit" ? "active" : ""} onClick={() => switchMode("edit")}>
              Edit selected plan
            </button>
            <button type="button" className={mode === "create" ? "active" : ""} onClick={() => switchMode("create")}>
              + New plan
            </button>
          </div>
        )}

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
              <input
                type="date"
                value={startDateLabel}
                onChange={(event) => setStartDateLabel(event.target.value)}
                required
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={endDateLabel}
                onChange={(event) => setEndDateLabel(event.target.value)}
                required
              />
            </label>
          </div>

          {/* Medical Attachments selection */}
          <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <Paperclip size={14} /> Medical Attachments
            </label>
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

          <button type="submit" className="primary-button full-width">
            {mode === "create" ? "Create plan" : "Save changes"}
          </button>
        </form>
      </div>
    </>
  );
}

function AddAttachmentModal({
  selectedPlan,
  availableAttachments,
  availableFiles,
  onClose,
  onAdd
}: {
  selectedPlan: PatientRehabPlan;
  availableAttachments: PlanAttachment[];
  availableFiles: PlanAttachmentFile[];
  onClose: () => void;
  onAdd: (fileId: string, description?: string) => Promise<void> | void;
}) {
  const currentFileIds = new Set((selectedPlan.attachments ?? []).map((a) => a.fileId));

  // Collect available files not currently on this plan
  const candidateFiles: AvailableFileItem[] = [];
  const seenFileIds = new Set<string>();

  for (const att of availableAttachments) {
    if (att.file && !seenFileIds.has(att.fileId) && !currentFileIds.has(att.fileId)) {
      seenFileIds.add(att.fileId);
      candidateFiles.push({
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
    if (!seenFileIds.has(f.id) && !currentFileIds.has(f.id)) {
      seenFileIds.add(f.id);
      candidateFiles.push({
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

  const [selectedFileId, setSelectedFileId] = useState<string>(candidateFiles[0]?.fileId ?? "");
  const [customFileId, setCustomFileId] = useState("");
  const [description, setDescription] = useState("");
  const [useCustomFileId, setUseCustomFileId] = useState(candidateFiles.length === 0);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const fileId = useCustomFileId ? customFileId.trim() : selectedFileId;
    if (!fileId) return;
    onAdd(fileId, description.trim() || undefined);
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="pd-modal" role="dialog" aria-label="Attach Medical File" style={{ width: "min(100%, 480px)" }}>
        <div className="therapist-detail-header">
          <strong>Attach Medical File to Plan</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form className="pd-modal-form" onSubmit={handleSubmit}>
          {candidateFiles.length > 0 && !useCustomFileId ? (
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ margin: 0 }}>Select patient file</label>
              <div style={{ display: "grid", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                {candidateFiles.map((file) => (
                  <button
                    key={file.fileId}
                    type="button"
                    className={`pd-plan-row ${file.fileId === selectedFileId ? "active" : ""}`}
                    onClick={() => {
                      setSelectedFileId(file.fileId);
                      if (file.defaultDescription && !description) {
                        setDescription(file.defaultDescription);
                      }
                    }}
                    style={{ textAlign: "left", width: "100%" }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {getFileIcon(file.fileType)}
                      <div>
                        <strong style={{ fontSize: "0.82rem" }}>{file.originalName}</strong>
                        <small style={{ color: "var(--text-secondary)" }}>
                          {file.fileType} {formatFileSize(file.fileSize) ? ` \u00b7 ${formatFileSize(file.fileSize)}` : ""}
                        </small>
                      </div>
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="link-button"
                style={{ fontSize: "0.78rem", textAlign: "left", padding: 0 }}
                onClick={() => setUseCustomFileId(true)}
              >
                Or enter a specific File ID
              </button>
            </div>
          ) : (
            <label>
              File ID (UUID)
              <input
                value={customFileId}
                onChange={(e) => setCustomFileId(e.target.value)}
                placeholder="e.g. 9b07fc68-a923-45e7-8b13-02aca49dfabe"
                required
              />
              {candidateFiles.length > 0 && (
                <button
                  type="button"
                  className="link-button"
                  style={{ fontSize: "0.78rem", textAlign: "left", padding: 0 }}
                  onClick={() => setUseCustomFileId(false)}
                >
                  Choose from available patient files
                </button>
              )}
            </label>
          )}

          <label>
            Description / Note (optional)
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. MRI scan report from neurologist"
              rows={2}
            />
          </label>

          <button
            type="submit"
            className="primary-button full-width"
            disabled={useCustomFileId ? !customFileId.trim() : !selectedFileId}
          >
            Attach to Plan
          </button>
        </form>
      </div>
    </>
  );
}

function FileViewModal({
  file,
  description,
  onClose
}: {
  file: PlanAttachmentFile;
  description?: string | null;
  onClose: () => void;
}) {
  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="pd-modal" role="dialog" aria-label="Attachment Details" style={{ width: "min(100%, 460px)" }}>
        <div className="therapist-detail-header">
          <strong style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {getFileIcon(file.fileType)} Attachment Details
          </strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <strong style={{ fontSize: "1rem", color: "var(--text-primary)" }}>{file.originalName}</strong>
            <p style={{ margin: "2px 0 0", color: "var(--text-secondary)", fontSize: "0.8rem" }}>
              {file.fileType} {file.mimeType ? ` \u00b7 ${file.mimeType}` : ""} {formatFileSize(file.fileSize) ? ` \u00b7 ${formatFileSize(file.fileSize)}` : ""}
            </p>
          </div>

          {description && (
            <div style={{ border: "1px solid var(--border-light)", borderRadius: 10, padding: "10px 12px", background: "var(--bg)" }}>
              <span style={{ fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700, color: "var(--text-secondary)" }}>
                Note / Description
              </span>
              <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--text-primary)" }}>
                {description}
              </p>
            </div>
          )}

          <div style={{ display: "grid", gap: 6, fontSize: "0.78rem", color: "var(--text-secondary)", borderTop: "1px solid var(--border-light)", paddingTop: 10 }}>
            <div>
              <strong>File ID:</strong> <code style={{ fontSize: "0.75rem" }}>{file.id}</code>
            </div>
            {file.storagePath && (
              <div>
                <strong>Storage Path:</strong> <code style={{ fontSize: "0.75rem" }}>{file.storagePath}</code>
              </div>
            )}
          </div>

          <button type="button" className="secondary-button full-width" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}