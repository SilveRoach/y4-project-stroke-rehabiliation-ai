import { ArrowLeft, Ban, Bell, Dumbbell, GripVertical, Hand, Plus, Save, X } from "lucide-react";
import { useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { exerciseLibrary } from "../data/exerciseLibraryMock";
import { therapistProfile } from "../data/therapistMock";
import type {
  ExerciseLibraryItem,
  ExerciseTrackingType,
  HeatmapDayStatus,
  PatientRehabPlan,
  ScheduleDay,
  ScheduledExerciseTargetType
} from "../types";

// Program Editor (PT_EXERCISE_PATH_MOCKUP_PLAN.md §4.3). Ports
// docs/04-design/mockups/program-editor.html to a real page: a day queue on the
// left, the selected day's assigned exercises on the right, and a picker that adds
// exercises straight from the real Exercise Library state
// (data/exerciseLibraryMock.ts — the same array ExerciseLibraryPage.tsx uses, so
// the two pages never drift out of sync). This is the one missing link between
// Exercise Library (browse/manage exercises) and Session Result Review (review a
// completed attempt) — see the plan's §1 audit table.
//
// Real, client-side only, same pattern as every other page here: no
// scheduled_exercises/rehabilitation_schedule_days backend endpoint exists yet, so
// edits only live in this browser tab until Save is pressed, and Save only updates
// the in-memory plan passed down from PatientDetailPage — nothing persists across
// a reload. Flagged in the footer hint text rather than silently implied.

interface ProgramEditorPageProps {
  plan: PatientRehabPlan;
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
  pending: "Pending"
};

// Sensible starting target per target_type, matching newdb.txt's
// scheduled_exercises_target_type enum (repetitions/duration/sets/distance/free).
// Seeded from the library item's own base_criteria when it has a relevant field,
// so a freshly-added exercise doesn't start at an arbitrary "10 reps" if the
// exercise's own criteria says otherwise.
function defaultTargetForExercise(item: ExerciseLibraryItem): { targetType: ScheduledExerciseTargetType; targetValueLabel: string } {
  if (item.baseCriteria.repetitions !== undefined) {
    return { targetType: "repetitions", targetValueLabel: `${item.baseCriteria.repetitions} reps` };
  }
  return { targetType: "repetitions", targetValueLabel: "10 reps" };
}

function daysToHeatmap(days: ScheduleDay[]): HeatmapDayStatus[] {
  return days.map((day) => day.status);
}

export function ProgramEditorPage({ plan, patientName, onSave, onBack, onLogout, onNavigate }: ProgramEditorPageProps) {
  const [days, setDays] = useState<ScheduleDay[]>(plan.days.length > 0 ? plan.days : [{ status: "pending", exercises: [] }]);
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => {
    // Default to the first non-completed day (mirrors the mockup's "Day 5
    // (current)" highlight), falling back to the last day if every day is done.
    const firstOpen = days.findIndex((day) => day.status === "pending" || day.status === "in_progress");
    return firstOpen === -1 ? days.length - 1 : firstOpen;
  });
  const [showPicker, setShowPicker] = useState(false);
  const [saved, setSaved] = useState(false);

  const selectedDay = days[selectedDayIndex];

  const updateSelectedDay = (updater: (day: ScheduleDay) => ScheduleDay) => {
    setDays((current) => current.map((day, index) => (index === selectedDayIndex ? updater(day) : day)));
    setSaved(false);
  };

  const handleAddDay = () => {
    setDays((current) => [...current, { status: "pending", exercises: [] }]);
    setSelectedDayIndex(days.length); // the new day, once appended
    setSaved(false);
  };

  const handleAddExercise = (item: ExerciseLibraryItem) => {
    const { targetType, targetValueLabel } = defaultTargetForExercise(item);
    updateSelectedDay((day) => ({
      ...day,
      exercises: [
        ...day.exercises,
        {
          id: `se-${Date.now()}`,
          exerciseLibraryId: item.id,
          exerciseName: item.name,
          versionLabel: `v${item.versionNumber}`,
          movementTracking: item.movementTracking,
          orderNumber: day.exercises.length + 1,
          targetType,
          targetValueLabel,
          difficultyLevel: item.difficultyLevel,
          status: "pending"
        }
      ]
    }));
    setShowPicker(false);
  };

  const handleTargetChange = (exerciseId: string, value: string) => {
    updateSelectedDay((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) => (exercise.id === exerciseId ? { ...exercise, targetValueLabel: value } : exercise))
    }));
  };

  const handleRemoveExercise = (exerciseId: string) => {
    updateSelectedDay((day) => ({
      ...day,
      exercises: day.exercises
        .filter((exercise) => exercise.id !== exerciseId)
        .map((exercise, index) => ({ ...exercise, orderNumber: index + 1 }))
    }));
  };

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

  const handleSave = () => {
    onSave({ ...plan, days, heatmap: daysToHeatmap(days) });
    setSaved(true);
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
            <button type="button" className="icon-button therapist-bell" aria-label="Notifications">
              <Bell size={17} />
            </button>
            <div className="therapist-topbar-profile">
              <div>
                <strong>{therapistProfile.displayName}</strong>
                <small>{therapistProfile.title}</small>
              </div>
              <span className="avatar-badge">{therapistProfile.initials}</span>
            </div>
          </div>
        </header>

        <main className="therapist-main">
          <button type="button" className="text-action pd-back-link" onClick={onBack}>
            <ArrowLeft size={14} /> Back to patient
          </button>

          <div className="summary-card pe-layout">
            <div className="pe-day-queue-col">
              <p className="pe-col-label">DAY QUEUE</p>
              <div className="pe-day-queue">
                {days.map((day, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`pe-day-item ${day.status} ${index === selectedDayIndex ? "active" : ""}`}
                    onClick={() => setSelectedDayIndex(index)}
                  >
                    <span>Day {index + 1}</span>
                    <small>{dayStatusLabel[day.status]}</small>
                    {day.exercises.length > 0 && <span className="pe-day-count">{day.exercises.length}</span>}
                  </button>
                ))}
                <button type="button" className="pe-day-add" onClick={handleAddDay}>
                  <Plus size={13} /> Add day
                </button>
              </div>
            </div>

            <div className="pe-day-detail-col">
              <p className="pe-col-label">
                DAY {selectedDayIndex + 1} &mdash; EXERCISES
              </p>

              {selectedDay.exercises.length === 0 ? (
                <p className="pd-empty-note">No exercises assigned to this day yet.</p>
              ) : (
                <div className="pe-exercise-list">
                  {selectedDay.exercises.map((exercise, index) => {
                    const Icon = trackingIcon[exercise.movementTracking];
                    return (
                      <div key={exercise.id} className="pe-exercise-row">
                        <span className={`pe-exercise-icon tracking-${exercise.movementTracking}`}>
                          <Icon size={17} />
                        </span>
                        <div className="pe-exercise-info">
                          <strong>{exercise.exerciseName}</strong>
                          <small>
                            from Exercise Library {exercise.versionLabel ? `\u00b7 ${exercise.versionLabel}` : ""} &middot;{" "}
                            {trackingLabel[exercise.movementTracking]}
                          </small>
                          {exercise.therapistInstruction && <small className="pe-exercise-note">{exercise.therapistInstruction}</small>}
                        </div>
                        <input
                          type="text"
                          className="pe-target-input"
                          value={exercise.targetValueLabel}
                          onChange={(event) => handleTargetChange(exercise.id, event.target.value)}
                          aria-label={`Target for ${exercise.exerciseName}`}
                        />
                        <div className="pe-exercise-actions">
                          <button
                            type="button"
                            className="icon-button"
                            disabled={index === 0}
                            onClick={() => handleMoveExercise(exercise.id, -1)}
                            aria-label="Move up"
                          >
                            <GripVertical size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => handleRemoveExercise(exercise.id)}
                            aria-label="Remove exercise"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button type="button" className="pe-add-exercise" onClick={() => setShowPicker(true)}>
                <Plus size={14} /> Add exercise from library
              </button>

              <p className="pd-modal-hint">
                Editing an exercise&apos;s media or base criteria (in Exercise Library) updates it everywhere it&apos;s
                used &mdash; only the target above is specific to this day. No scheduled_exercises backend endpoint
                exists yet, so Save only updates this plan in the current browser tab.
              </p>
            </div>
          </div>

          <div className="pe-save-row">
            {saved && <span className="ps-saved-note">Saved</span>}
            <button type="button" className="primary-button" onClick={handleSave}>
              <Save size={14} /> Save schedule
            </button>
          </div>
        </main>
      </div>

      {showPicker && (
        <ExercisePickerPanel
          onClose={() => setShowPicker(false)}
          onPick={handleAddExercise}
          alreadyAddedIds={selectedDay.exercises.map((exercise) => exercise.exerciseLibraryId)}
        />
      )}
    </section>
  );
}

function ExercisePickerPanel({
  onClose,
  onPick,
  alreadyAddedIds
}: {
  onClose: () => void;
  onPick: (item: ExerciseLibraryItem) => void;
  alreadyAddedIds: string[];
}) {
  // Only status: "active" items are assignable — drafts aren't ready and archived
  // items shouldn't be newly assigned, matching exercise_library_status's intent
  // (PT_EXERCISE_PATH_MOCKUP_PLAN.md §8's open question flags this as an
  // assumption, not a hard FR).
  const assignable = exerciseLibrary.filter((item) => item.status === "active");

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

        {assignable.length === 0 ? (
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
                  disabled={alreadyAdded}
                  onClick={() => onPick(item)}
                >
                  <span className={`pe-exercise-icon tracking-${item.movementTracking}`}>
                    <Icon size={17} />
                  </span>
                  <div className="pe-exercise-info">
                    <strong>
                      {item.name} <small style={{ color: "var(--text-secondary)" }}>v{item.versionNumber}</small>
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
