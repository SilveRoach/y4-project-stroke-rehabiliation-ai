import { AlertTriangle, Ban, Bell, Dumbbell, Hand, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FilePicker } from "../components/FilePicker";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { exerciseLibrary as seedExerciseLibrary } from "../data/exerciseLibraryMock";
import { therapistProfile } from "../data/therapistMock";
import type {
  ExerciseBaseCriteria,
  ExerciseLibraryDifficulty,
  ExerciseLibraryItem,
  ExerciseLibraryStatus,
  ExerciseTrackingType,
  PickedFile
} from "../types";

// Exercise Library page (frontend-design.md §6, revised per
// UI_MOCKUP_PLAN_NEWDB.md §2.5 for newdb.txt's versioned exercise_library schema).
// Mirrors docs/04-design/mockups/exercise-library.html's layout and the versioning
// decisions made there: a version badge + status badge per card, a "History" panel
// listing every row under the same parent_exercise_id, editing an ACTIVE exercise
// creates a new draft version (BR-6 propagation warning) rather than mutating the
// row in place, and the base-criteria form branches by movement_tracking instead of
// one generic JSON field. Demo video now uses the real FilePicker component
// (components/FilePicker.tsx) instead of the mockup's dashed-box placeholder — same
// caveat as everywhere else FilePicker is used: no upload backend exists, so a
// chosen file is a client-side object URL for this session only, not persisted.
//
// Real, client-side only (same pattern as PatientDetailPage's "Add record"): create/
// edit/archive all mutate local component state seeded from
// data/exerciseLibraryMock.ts. No exercise_library backend endpoint exists yet, so
// nothing survives a page reload — flagged here rather than silently presented as
// persisted.

interface ExerciseLibraryPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
}

type StatusFilter = "all" | ExerciseLibraryStatus;

const statusFilters: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "draft", label: "Draft" },
  { key: "archived", label: "Archived" }
];

const trackingLabels: Record<ExerciseTrackingType, string> = {
  pose: "Pose tracking",
  virtual_grip: "Virtual grip",
  none: "No AI tracking"
};

const difficultyLabels: Record<ExerciseLibraryDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard"
};

const trackingIcon: Record<ExerciseTrackingType, typeof Dumbbell> = {
  pose: Dumbbell,
  virtual_grip: Hand,
  none: Ban
};

function statusLabel(status: ExerciseLibraryStatus): string {
  if (status === "active") return "Active";
  if (status === "draft") return "Draft";
  return "Archived";
}

export function ExerciseLibraryPage({ onLogout, onNavigate }: ExerciseLibraryPageProps) {
  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>(seedExerciseLibrary);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingExercise, setEditingExercise] = useState<ExerciseLibraryItem | "new" | null>(null);
  const [historyExercise, setHistoryExercise] = useState<ExerciseLibraryItem | null>(null);

  const filteredExercises = useMemo(() => {
    if (statusFilter === "all") return exercises;
    return exercises.filter((exercise) => exercise.status === statusFilter);
  }, [exercises, statusFilter]);

  const handleArchive = (exerciseId: string) => {
    setExercises((current) =>
      current.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              status: "archived",
              versions: exercise.versions.map((version) =>
                version.id === exerciseId ? { ...version, status: "archived" } : version
              )
            }
          : exercise
      )
    );
  };

  const handleSaveNew = (item: ExerciseLibraryItem) => {
    setExercises((current) => [item, ...current]);
    setEditingExercise(null);
  };

  const handleSaveEdit = (updated: ExerciseLibraryItem, createdNewVersion: boolean) => {
    if (!createdNewVersion) {
      // Draft → editing in place is safe; nothing has ever gone live.
      setExercises((current) => current.map((exercise) => (exercise.id === updated.id ? updated : exercise)));
    } else {
      // Active → the old row is archived, and a new draft version takes its place
      // in the grid, matching the mockup's "Save as v4 · draft" + propagation
      // warning (BR-6): exercise_library rows are immutable-per-version by design.
      setExercises((current) => {
        const withOldArchived = current.map((exercise) =>
          exercise.parentExerciseId === updated.parentExerciseId && exercise.status === "active"
            ? {
                ...exercise,
                status: "archived" as ExerciseLibraryStatus,
                versions: exercise.versions.map((v) =>
                  v.id === exercise.id ? { ...v, status: "archived" as ExerciseLibraryStatus } : v
                )
              }
            : exercise
        );
        return [updated, ...withOldArchived];
      });
    }
    setEditingExercise(null);
  };

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Exercise Library" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Exercise Library</h1>
            <p>{exercises.length} exercises</p>
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
          <div className="summary-card">
            <div className="library-toolbar">
              <div className="library-filter-chips">
                {statusFilters.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={`library-filter-chip ${statusFilter === chip.key ? "active" : ""}`}
                    onClick={() => setStatusFilter(chip.key)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <button type="button" className="primary-button" onClick={() => setEditingExercise("new")}>
                <Plus size={16} /> New exercise
              </button>
            </div>
          </div>

          {filteredExercises.length === 0 ? (
            <p className="pd-empty-note">No exercises match this filter.</p>
          ) : (
            <div className="library-grid">
              {filteredExercises.map((exercise) => {
                const Icon = trackingIcon[exercise.movementTracking];
                return (
                  <div key={exercise.id} className={`library-card ${exercise.status === "archived" ? "is-archived" : ""}`}>
                    <div className="library-card-top">
                      <span className={`library-card-icon tracking-${exercise.movementTracking}`}>
                        <Icon size={22} />
                      </span>
                      <div>
                        <strong className="library-card-title">{exercise.name}</strong>
                        <p className="library-card-sub">
                          {trackingLabels[exercise.movementTracking]} &middot; {difficultyLabels[exercise.difficultyLevel]}
                        </p>
                      </div>
                    </div>

                    <div className="library-card-badges">
                      <span className={`library-status-badge ${exercise.status}`}>{statusLabel(exercise.status)}</span>
                      <span className="library-version-badge">v{exercise.versionNumber}</span>
                      {exercise.versions.length > 1 ? (
                        <button
                          type="button"
                          className="text-action library-card-history-link"
                          onClick={() => setHistoryExercise(exercise)}
                        >
                          History
                        </button>
                      ) : (
                        <span className="library-card-history-link" style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>
                          No versions yet
                        </span>
                      )}
                    </div>

                    <div className="library-card-actions">
                      {exercise.status === "archived" ? (
                        <span style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>Kept for history &middot; read-only</span>
                      ) : (
                        <>
                          <button type="button" className="text-action" onClick={() => setEditingExercise(exercise)}>
                            Edit
                          </button>
                          <button type="button" className="text-action danger" onClick={() => handleArchive(exercise.id)}>
                            Archive
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {editingExercise && (
        <ExerciseFormModal
          exercise={editingExercise === "new" ? null : editingExercise}
          onClose={() => setEditingExercise(null)}
          onSaveNew={handleSaveNew}
          onSaveEdit={handleSaveEdit}
        />
      )}

      {historyExercise && (
        <ExerciseHistoryPanel exercise={historyExercise} onClose={() => setHistoryExercise(null)} />
      )}
    </section>
  );
}

function ExerciseHistoryPanel({ exercise, onClose }: { exercise: ExerciseLibraryItem; onClose: () => void }) {
  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="therapist-detail-panel library-history-panel" role="dialog" aria-label="Version history">
        <div className="therapist-detail-header">
          <strong>History &middot; {exercise.name}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="library-history-list">
          {exercise.versions.map((version) => (
            <div key={version.id} className="library-history-row">
              <div className="library-history-row-top">
                <strong>v{version.versionNumber}</strong>
                <span className={`library-status-badge ${version.status}`}>{statusLabel(version.status)}</span>
              </div>
              <p className="library-history-criteria">{describeCriteria(version.baseCriteria)}</p>
              <p className="pd-record-meta">{version.createdAtLabel}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function describeCriteria(criteria: ExerciseBaseCriteria): string {
  const parts: string[] = [];
  if (criteria.targetAngleDeg !== undefined) parts.push(`target angle ${criteria.targetAngleDeg}\u00b0`);
  if (criteria.targetGripStrength !== undefined) parts.push(`grip strength ${criteria.targetGripStrength}`);
  if (criteria.repetitions !== undefined) parts.push(`${criteria.repetitions} reps`);
  if (criteria.holdSeconds !== undefined) parts.push(`${criteria.holdSeconds}s hold`);
  return parts.length > 0 ? parts.join(", ") : "No criteria set";
}

interface ExerciseFormModalProps {
  exercise: ExerciseLibraryItem | null;
  onClose: () => void;
  onSaveNew: (item: ExerciseLibraryItem) => void;
  onSaveEdit: (item: ExerciseLibraryItem, createdNewVersion: boolean) => void;
}

function ExerciseFormModal({ exercise, onClose, onSaveNew, onSaveEdit }: ExerciseFormModalProps) {
  const isEditingActive = exercise?.status === "active";

  const [name, setName] = useState(exercise?.name ?? "");
  const [description, setDescription] = useState(exercise?.description ?? "");
  const [movementTracking, setMovementTracking] = useState<ExerciseTrackingType>(
    exercise?.movementTracking ?? "pose"
  );
  const [difficultyLevel, setDifficultyLevel] = useState<ExerciseLibraryDifficulty>(
    exercise?.difficultyLevel ?? "medium"
  );
  const [demoFile, setDemoFile] = useState<PickedFile | null>(null);
  const [targetAngleDeg, setTargetAngleDeg] = useState(exercise?.baseCriteria.targetAngleDeg?.toString() ?? "90");
  const [targetGripStrength, setTargetGripStrength] = useState(
    exercise?.baseCriteria.targetGripStrength?.toString() ?? "50"
  );
  const [repetitions, setRepetitions] = useState(exercise?.baseCriteria.repetitions?.toString() ?? "10");
  const [holdSeconds, setHoldSeconds] = useState(exercise?.baseCriteria.holdSeconds?.toString() ?? "5");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    const baseCriteria: ExerciseBaseCriteria = {};
    if (movementTracking === "pose") {
      baseCriteria.targetAngleDeg = Number(targetAngleDeg) || undefined;
      baseCriteria.repetitions = Number(repetitions) || undefined;
      baseCriteria.holdSeconds = Number(holdSeconds) || undefined;
    } else if (movementTracking === "virtual_grip") {
      baseCriteria.targetGripStrength = Number(targetGripStrength) || undefined;
      baseCriteria.repetitions = Number(repetitions) || undefined;
      baseCriteria.holdSeconds = Number(holdSeconds) || undefined;
    } else {
      baseCriteria.repetitions = Number(repetitions) || undefined;
    }

    if (!exercise) {
      // New exercise family — starts its own parent_exercise_id at v1/draft.
      const id = `ex-new-${Date.now()}`;
      onSaveNew({
        id,
        parentExerciseId: id,
        versionNumber: 1,
        name: name.trim(),
        description: description.trim(),
        movementTracking,
        difficultyLevel,
        hasDemoVideo: demoFile !== null,
        baseCriteria,
        status: "draft",
        createdAtLabel: "Just now",
        createdByName: therapistProfile.displayName,
        versions: [
          {
            id,
            versionNumber: 1,
            status: "draft",
            baseCriteria,
            createdAtLabel: "Just now"
          }
        ]
      });
      return;
    }

    const createdNewVersion = isEditingActive;
    const nextVersionNumber = createdNewVersion ? exercise.versionNumber + 1 : exercise.versionNumber;
    const nextId = createdNewVersion ? `${exercise.parentExerciseId}-v${nextVersionNumber}` : exercise.id;
    const nextStatus: ExerciseLibraryStatus = createdNewVersion ? "draft" : exercise.status;

    const updated: ExerciseLibraryItem = {
      ...exercise,
      id: nextId,
      versionNumber: nextVersionNumber,
      name: name.trim(),
      description: description.trim(),
      movementTracking,
      difficultyLevel,
      hasDemoVideo: demoFile !== null || exercise.hasDemoVideo,
      baseCriteria,
      status: nextStatus,
      versions: createdNewVersion
        ? [
            { id: nextId, versionNumber: nextVersionNumber, status: "draft", baseCriteria, createdAtLabel: "Just now" },
            ...exercise.versions
          ]
        : exercise.versions.map((v) => (v.id === exercise.id ? { ...v, baseCriteria } : v))
    };

    onSaveEdit(updated, createdNewVersion);
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="library-modal" role="dialog" aria-label={exercise ? "Edit exercise" : "New exercise"}>
        <div className="therapist-detail-header">
          <strong>{exercise ? "Edit exercise" : "New exercise"}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {isEditingActive && (
          <div className="library-warning-banner">
            <AlertTriangle size={16} />
            <span>
              Editing an active exercise creates a new version. This will update the exercise everywhere it&apos;s
              currently used (BR-6).
            </span>
          </div>
        )}

        <form className="library-modal-form" onSubmit={handleSubmit}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>

          <label>
            Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
          </label>

          <div className="library-toggle-row">
            <label>
              Movement tracking
              <div className="library-segmented">
                {(["pose", "virtual_grip", "none"] as ExerciseTrackingType[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={movementTracking === option ? "active" : ""}
                    onClick={() => setMovementTracking(option)}
                  >
                    {trackingLabels[option]}
                  </button>
                ))}
              </div>
            </label>

            <label>
              Difficulty
              <div className="library-segmented">
                {(["easy", "medium", "hard"] as ExerciseLibraryDifficulty[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={difficultyLevel === option ? "active" : ""}
                    onClick={() => setDifficultyLevel(option)}
                  >
                    {difficultyLabels[option]}
                  </button>
                ))}
              </div>
            </label>
          </div>

          <label>
            Demo video
            <FilePicker value={demoFile} onAttach={setDemoFile} onRemove={() => setDemoFile(null)} accept="video/*" />
          </label>

          <div>
            <p className="filepicker-label" style={{ marginBottom: 8 }}>
              Base criteria &mdash; {trackingLabels[movementTracking]} fields
            </p>
            <div className="library-criteria-grid">
              {movementTracking === "pose" && (
                <>
                  <label>
                    Target angle (&deg;)
                    <input
                      type="number"
                      value={targetAngleDeg}
                      onChange={(event) => setTargetAngleDeg(event.target.value)}
                    />
                  </label>
                  <label>
                    Repetitions
                    <input type="number" value={repetitions} onChange={(event) => setRepetitions(event.target.value)} />
                  </label>
                  <label>
                    Hold (seconds)
                    <input type="number" value={holdSeconds} onChange={(event) => setHoldSeconds(event.target.value)} />
                  </label>
                </>
              )}
              {movementTracking === "virtual_grip" && (
                <>
                  <label>
                    Target grip strength
                    <input
                      type="number"
                      value={targetGripStrength}
                      onChange={(event) => setTargetGripStrength(event.target.value)}
                    />
                  </label>
                  <label>
                    Repetitions
                    <input type="number" value={repetitions} onChange={(event) => setRepetitions(event.target.value)} />
                  </label>
                  <label>
                    Hold (seconds)
                    <input type="number" value={holdSeconds} onChange={(event) => setHoldSeconds(event.target.value)} />
                  </label>
                </>
              )}
              {movementTracking === "none" && (
                <label>
                  Repetitions
                  <input type="number" value={repetitions} onChange={(event) => setRepetitions(event.target.value)} />
                </label>
              )}
            </div>
          </div>

          <button type="submit" className="primary-button full-width">
            {exercise ? (isEditingActive ? `Save as v${exercise.versionNumber + 1} \u00b7 draft` : "Save changes") : "Save as v1 \u00b7 draft"}
          </button>
        </form>
      </div>
    </>
  );
}
