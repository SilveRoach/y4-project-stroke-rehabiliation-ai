import {
  ArrowLeft,
  Bell,
  Calendar,
  ChevronRight,
  ClipboardList,
  FileText,
  Paperclip,
  Plus,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { FilePicker } from "../components/FilePicker";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { ApiError, getTherapistSessions } from "../services/api";
import { useAuth } from "../store/authStore";
import type {
  HeatmapDayStatus,
  MedicalHistoryRecord,
  MedicalRecordType,
  PatientRehabPlan,
  PickedFile,
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

const recordTypeLabels: Record<MedicalRecordType, string> = {
  diagnosis: "Diagnosis",
  pt_assessment: "PT Assessment",
  progress_note: "Progress Note",
  rehab_followup: "Rehab Follow-up",
  discharge: "Discharge",
  referral: "Referral",
  other: "Other"
};

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

  const [medicalHistory, setMedicalHistory] = useState<MedicalHistoryRecord[]>([]);
  const [showAddRecordModal, setShowAddRecordModal] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  // No patient_rehabilitation_plans backend endpoint exists yet (api-design.md
  // documents POST /plans / GET /patients/:id/plans, but no "plans" module has
  // actually been implemented — see backend/src/modules), so this starts empty
  // rather than seeding a fabricated calendar/heatmap. Create/edit below remains
  // real, client-side-only state, same as before (see handleSavePlan's comment).
  const [plans, setPlans] = useState<PatientRehabPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    plans.find((plan) => plan.status === "active")?.id ?? plans[0]?.id ?? null
  );
  const [showPlanModal, setShowPlanModal] = useState(false);

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
  // earlierMedicalHistoryCount/hasEarlierSessions have no real source either (no
  // pagination endpoint for either resource yet), so both are fixed at 0/false
  // rather than a fabricated count.
  const earlierMedicalHistoryCount = 0;
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

  // Real, client-side: no patient_rehabilitation_plans backend endpoint exists yet
  // (see PlanModal's hint text), so creating/editing a plan only lives in this
  // browser tab — but the shape matches the real table exactly.
  const handleSavePlan = (plan: PatientRehabPlan, mode: "edit" | "create") => {
    setPlans((current) => (mode === "create" ? [plan, ...current] : current.map((p) => (p.id === plan.id ? plan : p))));
    setSelectedPlanId(plan.id);
    setShowPlanModal(false);
  };

  const handleAddRecord = (record: MedicalHistoryRecord) => {
    setMedicalHistory((current) => [record, ...current]);
    setShowAddRecordModal(false);
  };

  const handleAttachFile = (recordId: string, file: PickedFile) => {
    setMedicalHistory((current) =>
      current.map((record) =>
        record.id === recordId ? { ...record, attachments: [...record.attachments, file] } : record
      )
    );
  };

  const handleRemoveAttachment = (recordId: string, fileId: string) => {
    setMedicalHistory((current) =>
      current.map((record) => {
        if (record.id !== recordId) return record;
        // Real (session-uploaded) attachments hold a blob: object URL that should be
        // released; pre-seeded mock attachments use a data:/"#" previewUrl, which
        // revokeObjectURL simply no-ops on — safe either way.
        const removed = record.attachments.find((attachment) => attachment.id === fileId);
        if (removed) URL.revokeObjectURL(removed.previewUrl);
        return { ...record, attachments: record.attachments.filter((attachment) => attachment.id !== fileId) };
      })
    );
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
                </div>

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

          {/* 3 & 4. Medical history + Session history, side by side as their own
              blocky cards. Medical history shows only the latest record — "View
              full history" (bottom-right of the card) opens every record in a
              slide-over. Previously every record rendered inline in a long
              single-column stack, which made the page feel dense before you'd
              even reached Session history. */}
          <div className="pd-bottom-grid">
            <div className="summary-card pd-medical-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>Medical history</strong>
                  <p>Most recent record</p>
                </div>
                <div className="therapist-chart-heading-actions">
                  <button type="button" className="text-action" onClick={() => setShowAddRecordModal(true)}>
                    <Plus size={14} /> Add record
                  </button>
                </div>
              </div>

              {medicalHistory.length === 0 ? (
                <p className="pd-empty-note">No medical history records yet.</p>
              ) : (
                <>
                  <MedicalRecordCard
                    record={medicalHistory[0]}
                    embedded
                    onAttachFile={handleAttachFile}
                    onRemoveAttachment={handleRemoveAttachment}
                  />
                  <div className="pd-medical-card-footer">
                    <button type="button" className="text-action" onClick={() => setShowHistoryPanel(true)}>
                      View full history ({medicalHistory.length + earlierMedicalHistoryCount})
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </>
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

      {showAddRecordModal && (
        <AddRecordModal
          onClose={() => setShowAddRecordModal(false)}
          onSubmit={handleAddRecord}
          recordedByLabel={therapistDisplayName}
        />
      )}

      {showPlanModal && (
        <PlanModal selectedPlan={selectedPlan} onClose={() => setShowPlanModal(false)} onSave={handleSavePlan} />
      )}

      {showHistoryPanel && (
        <MedicalHistoryPanel
          records={medicalHistory}
          earlierCount={earlierMedicalHistoryCount}
          onClose={() => setShowHistoryPanel(false)}
          onAttachFile={handleAttachFile}
          onRemoveAttachment={handleRemoveAttachment}
        />
      )}
    </section>
  );
}

function MedicalRecordCard({
  record,
  onAttachFile,
  onRemoveAttachment,
  embedded
}: {
  record: MedicalHistoryRecord;
  onAttachFile: (recordId: string, file: PickedFile) => void;
  onRemoveAttachment: (recordId: string, fileId: string) => void;
  // True when shown as the "latest record" preview inside the Medical History
  // card (no border of its own); false/undefined for every record in the full
  // history slide-over, which still look like distinct cards.
  embedded?: boolean;
}) {
  return (
    <div className={`pd-record-card ${embedded ? "embedded" : ""}`}>
      <div className="pd-record-top">
        <div>
          <p className="pd-record-title">
            <span className={`pd-record-badge ${record.recordType}`}>{recordTypeLabels[record.recordType]}</span>
            &nbsp;{record.title}
          </p>
          <p className="pd-record-meta">
            {record.dateLabel} &middot; recorded by {record.recordedByLabel}
          </p>
        </div>
        <ChevronRight size={15} className="pd-record-chevron" />
      </div>

      {record.details && record.details.length > 0 && (
        <div className="pd-record-details">
          {record.details.map((detail) => (
            <span key={detail.label}>
              {detail.label}: <strong>{detail.value}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="pd-record-attachments-section">
        <p className="pd-record-attachments-label">
          <Paperclip size={12} /> Attachments
        </p>
        <div className="pd-record-attachments-list">
          {record.attachments.map((file) => (
            <FilePicker
              key={file.id}
              value={file}
              compact
              onAttach={() => {}}
              onRemove={() => onRemoveAttachment(record.id, file.id)}
            />
          ))}
          <FilePicker key={`${record.id}-add`} value={null} compact onAttach={(file) => onAttachFile(record.id, file)} />
        </div>
      </div>
    </div>
  );
}

function MedicalHistoryPanel({
  records,
  earlierCount,
  onClose,
  onAttachFile,
  onRemoveAttachment
}: {
  records: MedicalHistoryRecord[];
  earlierCount: number;
  onClose: () => void;
  onAttachFile: (recordId: string, file: PickedFile) => void;
  onRemoveAttachment: (recordId: string, fileId: string) => void;
}) {
  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <aside className="therapist-detail-panel pd-history-panel" aria-label="Full medical history">
        <div className="therapist-detail-header">
          <strong>Medical history — all records</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {records.map((record) => (
          <MedicalRecordCard
            key={record.id}
            record={record}
            onAttachFile={onAttachFile}
            onRemoveAttachment={onRemoveAttachment}
          />
        ))}

        {earlierCount > 0 && (
          <div className="pd-more-records">
            + {earlierCount} earlier record{earlierCount === 1 ? "" : "s"} not loaded yet
          </div>
        )}
      </aside>
    </>
  );
}

function AddRecordModal({
  onClose,
  onSubmit,
  recordedByLabel
}: {
  onClose: () => void;
  onSubmit: (record: MedicalHistoryRecord) => void;
  recordedByLabel: string;
}) {
  const [recordType, setRecordType] = useState<MedicalRecordType>("progress_note");
  const [title, setTitle] = useState("");
  const [dateLabel, setDateLabel] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !dateLabel.trim()) return;

    onSubmit({
      id: `mh-${Date.now()}`,
      recordType,
      title: title.trim(),
      dateLabel: dateLabel.trim(),
      recordedByLabel,
      details: notes.trim() ? [{ label: "Notes", value: notes.trim() }] : undefined,
      attachments: []
    });
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="pd-modal" role="dialog" aria-label="Add medical history record">
        <div className="therapist-detail-header">
          <strong>Add medical history record</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form className="pd-modal-form" onSubmit={handleSubmit}>
          <label>
            Record type
            <select
              className="admin-role-select"
              value={recordType}
              onChange={(event) => setRecordType(event.target.value as MedicalRecordType)}
            >
              {Object.entries(recordTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Follow-up mobility check"
              required
            />
          </label>

          <label>
            Date
            <input type="date" value={dateLabel} onChange={(event) => setDateLabel(event.target.value)} required />
          </label>

          <label>
            Notes (optional)
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </label>

          <p className="pd-modal-hint">
            <Calendar size={12} /> Structured assessment fields (muscle strength, balance score, etc.) aren&apos;t
            wired up yet — this saves a basic record locally per UI_MOCKUP_PLAN_NEWDB.md §2.3. Attachments can be
            added from the record card once it&apos;s saved, via the file picker.
          </p>

          <button type="submit" className="primary-button full-width">
            Save record
          </button>
        </form>
      </div>
    </>
  );
}

function PlanModal({
  selectedPlan,
  onClose,
  onSave
}: {
  selectedPlan: PatientRehabPlan | null;
  onClose: () => void;
  onSave: (plan: PatientRehabPlan, mode: "edit" | "create") => void;
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

  // Switching between "edit the selected plan" and "start a new one" resets the
  // form to that mode's starting values, rather than carrying over half-edited
  // fields from the other mode.
  const switchMode = (nextMode: "edit" | "create") => {
    setMode(nextMode);
    if (nextMode === "edit" && selectedPlan) {
      setName(selectedPlan.name);
      setDescription(selectedPlan.description ?? "");
      setStatus(selectedPlan.status);
      setStartDateLabel(ISO_DATE_RE.test(selectedPlan.startDateLabel) ? selectedPlan.startDateLabel : "");
      setEndDateLabel(selectedPlan.endDateLabel && ISO_DATE_RE.test(selectedPlan.endDateLabel) ? selectedPlan.endDateLabel : "");
    } else {
      setName("");
      setDescription("");
      setStatus("draft");
      setStartDateLabel("");
      setEndDateLabel("");
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !startDateLabel || !endDateLabel) return;

    if (mode === "edit" && selectedPlan) {
      // Editing only changes the plan's own fields — it deliberately keeps the
      // existing heatmap (day-by-day progress) as-is rather than regenerating
      // rehabilitation_schedule_days from a new date range, which would silently
      // discard real completed/skipped days.
      onSave(
        {
          ...selectedPlan,
          name: name.trim(),
          description: description.trim() || undefined,
          status,
          startDateLabel,
          endDateLabel
        },
        "edit"
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
          // Fresh plan starts with every day scheduled but empty (no exercises
          // assigned yet) — filling these in is Program Editor's job, not this
          // modal's (PT_EXERCISE_PATH_MOCKUP_PLAN.md §4.5).
          days: Array.from({ length: daysBetweenInclusive(startDateLabel, endDateLabel) }, () => ({
            status: "pending" as HeatmapDayStatus,
            exercises: []
          }))
        },
        "create"
      );
    }
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="pd-modal" role="dialog" aria-label="Manage rehabilitation plan">
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
              {(Object.keys(planStatusLabels) as RehabPlanStatus[]).map((value) => (
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

          <p className="pd-modal-hint">
            <Calendar size={12} />{" "}
            {mode === "create"
              ? "Creates a fresh day-by-day schedule with every day pending, matching patient_rehabilitation_plans + rehabilitation_schedule_days \u2014 but no backend endpoint exists yet, so this only lives in this browser tab."
              : "Editing keeps this plan's existing day-by-day progress as-is \u2014 only the plan's own fields (name/description/status/dates) change here."}
          </p>

          <button type="submit" className="primary-button full-width">
            {mode === "create" ? "Create plan" : "Save changes"}
          </button>
        </form>
      </div>
    </>
  );
}
