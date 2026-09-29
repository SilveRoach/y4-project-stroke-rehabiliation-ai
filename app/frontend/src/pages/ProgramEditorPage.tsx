import { ArrowLeft, Ban, Dumbbell, GripVertical, Hand, Plus, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import {
  ApiError,
  createScheduleDay as apiCreateScheduleDay,
  createScheduledExercise as apiCreateScheduledExercise,
  getExerciseLibrary,
  getPatientPlans
} from "../services/api";
import { useAuth } from "../store/authStore";
import type {
  ExerciseLibraryItem,
  ExerciseTrackingType,
  HeatmapDayStatus,
  PatientRehabPlan,
  ScheduleDay,
  ScheduledExercise,
  ScheduledExerciseTargetType
} from "../types";
import { initialsFromName } from "../utils/displayName";

// Program Editor — wired to the real backend (rehabilitation-plans module).
//
// Day queue (left) and per-day exercises (right) are seeded from the plan
// already fetched by PatientDetailPage (GET /patients/:id/plans). Each
// write operation below calls the corresponding endpoint:
//
//   Add day      → POST /plans/:planId/schedule-days
//   Add exercise → POST /schedule-days/:dayId/exercises
//   Save         → GET  /patients/:patientId/plans (refresh) then onSave
//
// Backend gaps surfaced, not worked around silently:
//   - No DELETE for scheduled_exercises → remove is disabled for persisted exercises.
//   - No PATCH for exercise fields (only status) → target input / reorder are
//     read-only for persisted exercises; free for new (unsaved) ones.

interface ProgramEditorPageProps {
  plan: PatientRehabPlan;
  patientId: string; // needed to refresh plans after saves
  patientName: string;
  onSave: (plan: PatientRehabPlan) => void;
  onBack: () => void;
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
}

// Exported so pages/PatientProgressPage.tsx can reuse the exact same icon/label
// mapping for its ScheduledExercise-based table (PATIENT_PROGRESS_MOCKUP_PLAN.md
// §2.3), rather than a second, drifting copy of the same lookup.
export const trackingIcon: Record<ExerciseTrackingType, typeof Dumbbell> = {
  pose: Dumbbell,
  virtual_grip: Hand,
  none: Ban
};

export const trackingLabel: Record<ExerciseTrackingType, string> = {
  pose: "Pose tracking",
  virtual_grip: "Virtual grip",
  none: "No AI tracking"
};

const dayStatusLabel: Record<HeatmapDayStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  skipped: "Skipped",
  pending: "Pending",
  cancelled: "Cancelled"
};

// A ScheduledExercise whose id starts with "se-" was created client-side and
// has NOT been persisted to the server yet. Persisted exercises get their id
// from the database (a UUID). This predicate drives whether edit/remove/reorder
// controls are enabled for a given row.
function isNewExercise(exercise: ScheduledExercise): boolean {
  return exercise.id.startsWith("se-");
}

// Sensible starting target per target_type — matches the library item's own
// base_criteria when it has a relevant field, so a freshly-added exercise
// doesn't start at an arbitrary "10 reps" if the exercise says otherwise.
function defaultTargetForExercise(item: ExerciseLibraryItem): {
  targetType: ScheduledExerciseTargetType;
  targetValueLabel: string;
} {
  if (item.baseCriteria.repetitions !== undefined) {
    return { targetType: "repetitions", targetValueLabel: `${item.baseCriteria.repetitions} reps` };
  }
  return { targetType: "repetitions", targetValueLabel: "10 reps" };
}

function daysToHeatmap(days: ScheduleDay[]): HeatmapDayStatus[] {
  return days.map((day) => day.status);
}

// Map a server plan response (any-typed from api.ts) into the client
// PatientRehabPlan shape. Mirrors PatientDetailPage.mapServerPlans exactly so
// both pages keep the same mapping logic.
function mapSingleServerPlan(sp: any): PatientRehabPlan {
  const start = sp.startDate
    ? sp.startDate.slice?.(0, 10) ?? new Date(sp.startDate).toISOString().slice(0, 10)
    : "";
  const end = sp.endDate
    ? sp.endDate.slice?.(0, 10) ?? new Date(sp.endDate).toISOString().slice(0, 10)
    : "";
  const days: ScheduleDay[] = (sp.scheduleDays || []).map((sd: any) => ({
    id: sd.id,
    dateLabel: sd.scheduledDate
      ? sd.scheduledDate.slice?.(0, 10) ?? new Date(sd.scheduledDate).toISOString().slice(0, 10)
      : undefined,
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
      targetValueLabel: ex.targetValue ? String(ex.targetValue) : "",
      difficultyLevel: ex.exerciseLibrary?.difficultyLevel ?? ex.difficultyLevel ?? undefined,
      therapistInstruction: ex.therapistInstruction ?? undefined,
      status: ex.status ?? "pending"
    }))
  }));
  return {
    id: sp.id,
    name: sp.name,
    description: sp.description ?? undefined,
    status: sp.status,
    startDateLabel: start,
    endDateLabel: end || undefined,
    heatmap: (sp.scheduleDays || []).map((sd: any) => sd.status as HeatmapDayStatus),
    days
  };
}

// Compute the next calendar date to assign when "Add day" is pressed.
// If the plan's days already have ISO dateLabels, advance by one day from
// the last dated day. If no dates are available, fall back to today.
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

export function ProgramEditorPage({
  plan,
  patientId,
  patientName,
  onSave,
  onBack,
  onLogout,
  onNavigate
}: ProgramEditorPageProps) {
  const { token, user } = useAuth();
  const therapistDisplayName = user?.displayName ?? user?.username ?? "Therapist";

  const [days, setDays] = useState<ScheduleDay[]>(
    plan.days.length > 0 ? plan.days : [{ status: "pending", exercises: [] }]
  );
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => {
    // Default to the first non-completed day, falling back to the last day.
    const firstOpen = days.findIndex(
      (day) => day.status === "pending" || day.status === "in_progress"
    );
    return firstOpen === -1 ? days.length - 1 : firstOpen;
  });
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addDayLoading, setAddDayLoading] = useState(false);
  const [addDayError, setAddDayError] = useState<string | null>(null);
  const [addExerciseLoading, setAddExerciseLoading] = useState(false);
  const [addExerciseError, setAddExerciseError] = useState<string | null>(null);

  const selectedDay = days[selectedDayIndex];

  const updateSelectedDay = (updater: (day: ScheduleDay) => ScheduleDay) => {
    setDays((current) =>
      current.map((day, index) => (index === selectedDayIndex ? updater(day) : day))
    );
    setSaved(false);
  };

  // ---- Add day ---------------------------------------------------------------
  // Calls POST /plans/:planId/schedule-days with the next computed date.
  // On success the API returns the created day (with a real id) which we
  // merge into local state so subsequent exercise additions can use its id.
  const handleAddDay = async () => {
    if (!token) {
      setSaveError("Not authenticated.");
      return;
    }
    setAddDayLoading(true);
    setAddDayError(null);
    setSaved(false);
    const scheduledDate = nextScheduledDate(days);
    try {
      const res = await apiCreateScheduleDay(token, plan.id, scheduledDate);
      const newDay: ScheduleDay = {
        id: res.day.id,
        dateLabel: scheduledDate,
        status: "pending",
        exercises: []
      };
      setDays((current) => [...current, newDay]);
      setSelectedDayIndex(days.length); // will be the appended index
    } catch (err) {
      setAddDayError(err instanceof ApiError ? err.message : "Could not add day. Please try again.");
    } finally {
      setAddDayLoading(false);
    }
  };

  // ---- Add exercise -----------------------------------------------------------
  // Called by the exercise picker. Calls POST /schedule-days/:dayId/exercises.
  // If the selected day has no server id yet, the add is blocked (the day must
  // be persisted first — always true for days created via handleAddDay above,
  // which waits for the server response before adding to state).
  const handleAddExercise = async (item: ExerciseLibraryItem) => {
    if (!token) {
      setAddExerciseError("Not authenticated.");
      return;
    }
    if (!selectedDay.id) {
      setAddExerciseError(
        "This day hasn't been saved to the server yet. Please save before adding exercises."
      );
      return;
    }

    setAddExerciseLoading(true);
    setAddExerciseError(null);
    setSaved(false);

    const { targetType, targetValueLabel } = defaultTargetForExercise(item);

    try {
      const res = await apiCreateScheduledExercise(token, selectedDay.id, {
        exerciseLibraryId: item.id,
        orderNumber: selectedDay.exercises.length + 1,
        targetType,
        // Store the freeform label as targetValue — matches how PatientDetailPage
        // reads it back: `ex.targetValue ? String(ex.targetValue) : ""`
        targetValue: targetValueLabel,
        therapistInstruction: undefined
      });

      const se = res.scheduledExercise;
      const newExercise: ScheduledExercise = {
        id: se.id, // real server id — no longer "se-*"
        exerciseLibraryId: item.id,
        exerciseName: item.name,
        versionLabel: `v${item.versionNumber}`,
        movementTracking: item.movementTracking,
        orderNumber: selectedDay.exercises.length + 1,
        targetType,
        targetValueLabel,
        difficultyLevel: item.difficultyLevel,
        status: "pending"
      };

      updateSelectedDay((day) => ({
        ...day,
        exercises: [...day.exercises, newExercise]
      }));
      setShowPicker(false);
    } catch (err) {
      setAddExerciseError(
        err instanceof ApiError ? err.message : "Could not add exercise. Please try again."
      );
    } finally {
      setAddExerciseLoading(false);
    }
  };

  // ---- Target change ----------------------------------------------------------
  // Local-only: allowed for new (unsaved) exercises; read-only for persisted ones.
  const handleTargetChange = (exerciseId: string, value: string) => {
    updateSelectedDay((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) =>
        exercise.id === exerciseId ? { ...exercise, targetValueLabel: value } : exercise
      )
    }));
  };

  // ---- Remove exercise --------------------------------------------------------
  // Only allowed for exercises that haven't been persisted yet — the remove
  // button is disabled={persisted} in JSX so this handler is only ever called
  // for new exercises. Guarded here as well for safety.
  const handleRemoveExercise = (exerciseId: string) => {
    updateSelectedDay((day) => ({
      ...day,
      exercises: day.exercises
        .filter((exercise) => !(exercise.id === exerciseId && isNewExercise(exercise)))
        .map((exercise, index) => ({ ...exercise, orderNumber: index + 1 }))
    }));
  };

  // ---- Reorder exercise -------------------------------------------------------
  // Only allowed for new (unsaved) exercises; disabled for persisted ones (no
  // PATCH orderNumber endpoint exists).
  const handleMoveExercise = (exerciseId: string, direction: -1 | 1) => {
    updateSelectedDay((day) => {
      const index = day.exercises.findIndex((exercise) => exercise.id === exerciseId);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= day.exercises.length) return day;
      const reordered = [...day.exercises];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      return { ...day, exercises: reordered.map((exercise, i) => ({ ...exercise, orderNumber: i + 1 })) };
    });
  };

  // ---- Save -------------------------------------------------------------------
  // Refreshes the plan from the server (GET /patients/:patientId/plans) and
  // hands the real, server-authoritative plan back to the parent via onSave.
  // This is the authoritative source of truth — we don't compute the final shape
  // ourselves, we read it back.
  const handleSave = async () => {
    if (!token) {
      setSaveError("Not authenticated.");
      return;
    }
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await getPatientPlans(token, patientId);
      const serverPlans: any[] = res.plans || [];
      const serverPlan = serverPlans.find((sp: any) => sp.id === plan.id);
      if (!serverPlan) {
        throw new Error("Plan not found after save. Please go back and reopen.");
      }
      const mapped = mapSingleServerPlan(serverPlan);
      // Sync local day state from the freshly-mapped server plan
      setDays(mapped.days.length > 0 ? mapped.days : [{ status: "pending", exercises: [] }]);
      setSaved(true);
      onSave({ ...mapped, heatmap: daysToHeatmap(mapped.days) });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Patients" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Program Editor</h1>
            <p>
              {patientName} &middot; {plan.name}
            </p>
          </div>
          <div className="therapist-topbar-actions">
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
            <ArrowLeft size={14} /> Back to patient
          </button>

          <div className="summary-card pe-layout">
            {/* ── Day queue column ───────────────────────────────────────── */}
            <div className="pe-day-queue-col">
              <p className="pe-col-label">DAY QUEUE</p>
              <div className="pe-day-queue">
                {days.map((day, index) => (
                  <button
                    key={day.id ?? index}
                    type="button"
                    className={`pe-day-item ${day.status} ${index === selectedDayIndex ? "active" : ""}`}
                    onClick={() => setSelectedDayIndex(index)}
                  >
                    <span>Day {index + 1}</span>
                    <small>
                      {dayStatusLabel[day.status]}
                      {day.dateLabel ? ` · ${day.dateLabel}` : ""}
                    </small>
                    {day.exercises.length > 0 && (
                      <span className="pe-day-count">{day.exercises.length}</span>
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  className="pe-day-add"
                  onClick={handleAddDay}
                  disabled={addDayLoading}
                >
                  <Plus size={13} /> {addDayLoading ? "Adding…" : "Add day"}
                </button>
                {addDayError && (
                  <p className="pd-empty-note" role="alert" style={{ color: "var(--error, #c0392b)" }}>
                    {addDayError}
                  </p>
                )}
              </div>
            </div>

            {/* ── Day detail column ─────────────────────────────────────── */}
            <div className="pe-day-detail-col">
              <p className="pe-col-label">
                DAY {selectedDayIndex + 1} &mdash; EXERCISES
                {selectedDay?.dateLabel && (
                  <span style={{ fontWeight: 400, marginLeft: 8, textTransform: "none" }}>
                    ({selectedDay.dateLabel})
                  </span>
                )}
              </p>

              {addExerciseError && (
                <p className="pd-empty-note" role="alert" style={{ color: "var(--error, #c0392b)" }}>
                  {addExerciseError}
                </p>
              )}

              {selectedDay.exercises.length === 0 ? (
                <p className="pd-empty-note">No exercises assigned to this day yet.</p>
              ) : (
                <div className="pe-exercise-list">
                  {selectedDay.exercises.map((exercise, index) => {
                    const Icon = trackingIcon[exercise.movementTracking];
                    const persisted = !isNewExercise(exercise);
                    return (
                      <div key={exercise.id} className="pe-exercise-row">
                        <span className={`pe-exercise-icon tracking-${exercise.movementTracking}`}>
                          <Icon size={17} />
                        </span>
                        <div className="pe-exercise-info">
                          <strong>{exercise.exerciseName}</strong>
                          <small>
                            from Exercise Library {exercise.versionLabel ? `· ${exercise.versionLabel}` : ""} &middot;{" "}
                            {trackingLabel[exercise.movementTracking]}
                          </small>
                          {exercise.therapistInstruction && (
                            <small className="pe-exercise-note">{exercise.therapistInstruction}</small>
                          )}
                        </div>
                        {persisted ? (
                          // Persisted exercises: target is read-only (no PATCH endpoint for
                          // exercise fields — only status can be updated via its own route).
                          <span className="pe-target-input" title="Target cannot be changed after saving">
                            {exercise.targetValueLabel || "—"}
                          </span>
                        ) : (
                          <input
                            type="text"
                            className="pe-target-input"
                            value={exercise.targetValueLabel}
                            onChange={(event) => handleTargetChange(exercise.id, event.target.value)}
                            aria-label={`Target for ${exercise.exerciseName}`}
                          />
                        )}
                        <div className="pe-exercise-actions">
                          <button
                            type="button"
                            className="icon-button"
                            // Reorder disabled for persisted exercises (no PATCH orderNumber endpoint).
                            disabled={index === 0 || persisted}
                            onClick={() => handleMoveExercise(exercise.id, -1)}
                            aria-label="Move up"
                            title={persisted ? "Reorder not available for saved exercises" : "Move up"}
                          >
                            <GripVertical size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            // Remove disabled for persisted exercises (no DELETE endpoint).
                            disabled={persisted}
                            onClick={() => handleRemoveExercise(exercise.id)}
                            aria-label="Remove exercise"
                            title={
                              persisted
                                ? "Remove not available — no delete endpoint exists for saved exercises"
                                : "Remove exercise"
                            }
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                className="pe-add-exercise"
                onClick={() => {
                  setAddExerciseError(null);
                  setShowPicker(true);
                }}
                disabled={addExerciseLoading}
              >
                <Plus size={14} />{" "}
                {addExerciseLoading ? "Adding…" : "Add exercise from library"}
              </button>

              <p className="pd-modal-hint">
                Target values and exercise order can only be changed for exercises that haven&apos;t
                been saved yet. Once an exercise is saved to the server, its target value is
                read-only (no update endpoint exists) and reorder/remove are disabled. Add new
                exercises and days freely; they are persisted immediately.
              </p>
            </div>
          </div>

          {/* ── Save row ──────────────────────────────────────────────────── */}
          <div className="pe-save-row">
            {saveError && (
              <span className="ps-saved-note" role="alert" style={{ color: "var(--error, #c0392b)" }}>
                {saveError}
              </span>
            )}
            {saved && !saveError && <span className="ps-saved-note">Saved</span>}
            <button
              type="button"
              className="primary-button"
              onClick={handleSave}
              disabled={saving}
            >
              <Save size={14} /> {saving ? "Saving…" : "Save schedule"}
            </button>
          </div>
        </main>
      </div>

      {showPicker && (
        <ExercisePickerPanel
          token={token}
          onClose={() => setShowPicker(false)}
          onPick={handleAddExercise}
          alreadyAddedIds={selectedDay.exercises.map((exercise) => exercise.exerciseLibraryId)}
          loading={addExerciseLoading}
        />
      )}
    </section>
  );
}

// ── Exercise picker panel ─────────────────────────────────────────────────────
// Loads exercises from GET /exercises (real API) instead of the former static
// exerciseLibraryMock import. Only status: "active" exercises are assignable.

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
          setFetchError(
            err instanceof ApiError ? err.message : "Could not load exercises. Please try again."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setFetchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Only status: "active" items are assignable — drafts aren't ready and archived
  // items shouldn't be newly assigned (matching exercise_library_status intent).
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
          <p className="pd-empty-note">Loading exercises…</p>
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
                    <small>{trackingLabel[item.movementTracking]}</small>
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
