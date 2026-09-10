import { AlertTriangle, Ban, Bell, CheckCircle2, Dumbbell, Hand, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { FilePicker } from "../components/FilePicker";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import {
  ApiError,
  archiveExercise,
  createExercise,
  createExerciseVersion,
  getFileThumbnail,
  getExerciseLibrary,
  publishExercise,
  updateExerciseDraft,
  type ExerciseInputPayload
} from "../services/api";
import { useAuth } from "../store/authStore";
import { useOwnProfilePicture } from "../hooks/useProfilePicture";
import { initialsFromName } from "../utils/displayName";
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
// one generic JSON field.
//
// Backed by modules/exercise-program-library/* on the backend — replaces the
// former data/exerciseLibraryMock.ts and data/therapistMock.ts (therapistProfile)
// imports, same "wire it to the real backend" pass already done for
// TherapistDashboardPage.tsx / TherapistPatientsPage.tsx. See
// services/api.ts's Exercise Library section and exercise.service.ts's own
// comments for the schema gaps this works around:
//   - No nameTh column — the version-history mock had Thai names, real rows never
//     will, so `nameTh` is simply never rendered here (dropped from this page
//     entirely rather than always showing an empty string).
//   - Editing a still-`draft` exercise's fields in place goes to
//     `PATCH /exercises/:id`, an endpoint added beyond api-design.md — see that
//     file's own header comment.

interface ExerciseLibraryPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  // Called after the therapist fills in Step 1 of the "New exercise" flow
  // (name + movement tracking). The library page delegates the remaining
  // creation form to ExerciseCreationPage, which lives at a separate view.
  onCreateNew?: (name: string, tracking: ExerciseTrackingType) => void;
  // Called when the user clicks on an exercise card or clicks View/Edit.
  // Navigates to the comprehensive ExerciseCreationPage for that exercise.
  onSelectExercise?: (exercise: ExerciseLibraryItem) => void;
}

type StatusFilter = "all" | ExerciseLibraryStatus;

const trackingLabels: Record<ExerciseTrackingType, string> = {
  pose: "Pose tracking",
  virtual_grip: "Virtual grip",
  none: "No AI tracking"
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

export function ExerciseLibraryPage({ onLogout, onNavigate, onCreateNew, onSelectExercise }: ExerciseLibraryPageProps) {
  const { token, user } = useAuth();

  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingExercise, setEditingExercise] = useState<ExerciseLibraryItem | "new" | null>(null);
  const [historyExercise, setHistoryExercise] = useState<ExerciseLibraryItem | null>(null);
  // Read-only detail view (separate from Edit) — lets the therapist inspect an
  // exercise's full details, including archived ones, without opening the form
  // and risking an accidental edit/version-bump.
  const [viewingExercise, setViewingExercise] = useState<ExerciseLibraryItem | null>(null);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const thumbnailUrlsRef = useRef<Record<string, string>>({});

  // `reloadToken` just forces the effect below to re-run after a mutation
  // (create/edit/archive) — simpler than duplicating the fetch/cancellation
  // logic in a second, separately-invoked loadExercises() function.
  const [reloadToken, setReloadToken] = useState(0);
  const refetch = () => setReloadToken((value) => value + 1);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    getExerciseLibrary(token)
      .then((data) => {
        if (!cancelled) {
          setExercises(data.exercises);
          Object.values(thumbnailUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
          thumbnailUrlsRef.current = {};
          setThumbnailUrls({});
          data.exercises.forEach((exercise) => {
            if (!exercise.demoVideoFileId) return;
            getFileThumbnail(token, exercise.demoVideoFileId)
              .then((blob) => {
                if (cancelled) return;
                const url = URL.createObjectURL(blob);
                thumbnailUrlsRef.current[exercise.id] = url;
                setThumbnailUrls((current) => ({ ...current, [exercise.id]: url }));
              })
              .catch(() => {
                // Keep the existing placeholder when a thumbnail cannot be generated.
              });
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't load the exercise library. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      Object.values(thumbnailUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrlsRef.current = {};
    };
  }, [token, user, reloadToken]);

  const filteredExercises = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return exercises.filter((exercise) => {
      const matchesStatus = statusFilter === "all" || exercise.status === statusFilter;
      const searchableText = [
        exercise.name,
        trackingLabels[exercise.movementTracking],
        exercise.movementTracking,
        exercise.createdByName || "Therapist"
      ]
        .join(" ")
        .toLocaleLowerCase();
      return matchesStatus && (!query || searchableText.includes(query));
    });
  }, [exercises, searchQuery, statusFilter]);

  const displayName = user?.displayName || user?.username || "Therapist";
  const ownAvatarUrl = useOwnProfilePicture();

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Exercise Library" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Exercise Library</h1>
            <p>{loading ? "Loading…" : `${exercises.length} exercises`}</p>
          </div>
          <div className="therapist-topbar-actions">
            <button type="button" className="icon-button therapist-bell" aria-label="Notifications">
              <Bell size={17} />
            </button>
            <div className="therapist-topbar-profile">
              <div>
                <strong>{displayName}</strong>
                <small>Physical Therapist</small>
              </div>
              <span className={`avatar-badge${ownAvatarUrl ? " with-photo" : ""}`}>
                {ownAvatarUrl ? <img src={ownAvatarUrl} alt={`${displayName}'s profile picture`} /> : initialsFromName(displayName)}
              </span>
            </div>
          </div>
        </header>

        <main className="therapist-main">
          {error && (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", marginBottom: 16 }}>
              <p style={{ margin: 0 }}>{error}</p>
            </div>
          )}

          <div className="summary-card">
            <div className="library-toolbar">
              <label className="library-search">
                <Search size={16} />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by name, type, or creator"
                  aria-label="Search exercises by name, type, or creator"
                />
              </label>
              <label className="library-status-filter">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  aria-label="Filter exercises by status"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <button type="button" className="primary-button" onClick={() => setEditingExercise("new")}>
                <Plus size={16} /> New exercise
              </button>
            </div>
          </div>

          {!loading && filteredExercises.length === 0 ? (
            <p className="pd-empty-note">
              {exercises.length === 0
                ? "No exercises have been created yet."
                : searchQuery.trim()
                  ? "No exercises match your search."
                  : "No exercises match this filter."}
            </p>
          ) : (
            <div className="library-grid">
              {filteredExercises.map((exercise) => {
                const Icon = trackingIcon[exercise.movementTracking];
                return (
                  <div
                    key={exercise.id}
                    className={`library-card ${exercise.status === "archived" ? "is-archived" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectExercise?.(exercise)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectExercise?.(exercise);
                      }
                    }}
                    title="Open exercise editor"
                  >
                    <div className="library-card-media">
                      {thumbnailUrls[exercise.id] ? (
                        <img
                          className="library-card-thumbnail library-card-video-thumbnail"
                          src={thumbnailUrls[exercise.id]}
                          alt={`${exercise.name} demo video thumbnail`}
                        />
                      ) : (
                        <div className="library-card-thumbnail">
                          <Icon size={30} />
                          <span>{exercise.hasDemoVideo ? "Demo video" : "No demo video"}</span>
                        </div>
                      )}
                      <span className={`library-card-type tracking-${exercise.movementTracking}`}>
                        {trackingLabels[exercise.movementTracking]}
                      </span>
                    </div>

                    <div className="library-card-details">
                      <strong className="library-card-title">{exercise.name}</strong>
                      <span>Created by {exercise.createdByName || "Therapist"}</span>
                      <span className={`library-status-badge ${exercise.status}`}>{statusLabel(exercise.status)}</span>
                      {exercise.versions.length > 1 ? (
                        <button
                          type="button"
                          className="text-action library-card-history-link"
                          onClick={(event) => {
                            event.stopPropagation();
                            setHistoryExercise(exercise);
                          }}
                        >
                          History
                        </button>
                      ) : (
                        <span className="library-card-history-link" style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>No history</span>
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
          onSaved={() => {
            setEditingExercise(null);
            refetch();
          }}
          onCreateNew={
            editingExercise === "new" && onCreateNew
              ? (name, tracking) => {
                  setEditingExercise(null);
                  onCreateNew(name, tracking);
                }
              : undefined
          }
        />
      )}

      {historyExercise && (
        <ExerciseHistoryPanel exercise={historyExercise} onClose={() => setHistoryExercise(null)} />
      )}

      {viewingExercise && (
        <ExerciseDetailPanel
          exercise={viewingExercise}
          onClose={() => setViewingExercise(null)}
          onEdit={
            viewingExercise.status !== "archived" && (user?.role === "admin" || viewingExercise.createdById === user?.id)
              ? () => {
                  const target = viewingExercise;
                  setViewingExercise(null);
                  if (onSelectExercise) {
                    onSelectExercise(target);
                  } else {
                    setEditingExercise(target);
                  }
                }
              : undefined
          }
          onViewHistory={
            viewingExercise.versions.length > 1
              ? () => {
                  setHistoryExercise(viewingExercise);
                  setViewingExercise(null);
                }
              : undefined
          }
        />
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

interface ExerciseDetailPanelProps {
  exercise: ExerciseLibraryItem;
  onClose: () => void;
  // Undefined when the exercise is archived (read-only, no edit path) or, for
  // History, when there's only one version to look at.
  onEdit?: () => void;
  onViewHistory?: () => void;
}

// Read-only "View" detail panel (UI_MOCKUP_PLAN_NEWDB.md §2.5's card grid never
// had a way to inspect a full exercise — including an archived one — without
// opening the Edit form, which risks an accidental draft edit or, worse, an
// accidental version bump on an active row. This panel never mutates anything;
// it only offers to hand off into Edit/History.
function ExerciseDetailPanel({ exercise, onClose, onEdit, onViewHistory }: ExerciseDetailPanelProps) {
  const Icon = trackingIcon[exercise.movementTracking];

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="therapist-detail-panel library-history-panel" role="dialog" aria-label={`View ${exercise.name}`}>
        <div className="therapist-detail-header">
          <strong>{exercise.name}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="library-history-list">
          <div className="library-history-row">
            <div className="library-history-row-top">
              <span className="library-card-icon" style={{ width: 36, height: 36 }}>
                <Icon size={18} />
              </span>
              <div className="library-card-badges">
                <span className={`library-status-badge ${exercise.status}`}>{statusLabel(exercise.status)}</span>
                <span className="library-version-badge">v{exercise.versionNumber}</span>
              </div>
            </div>
            <p className="library-history-criteria">
              {trackingLabels[exercise.movementTracking]}
            </p>
          </div>

          <div className="library-history-row">
            <strong style={{ fontSize: "0.82rem" }}>Description</strong>
            <p className="library-history-criteria">{exercise.description || "No description provided."}</p>
          </div>

          <div className="library-history-row">
            <strong style={{ fontSize: "0.82rem" }}>Base criteria</strong>
            <p className="library-history-criteria">{describeCriteria(exercise.baseCriteria)}</p>
          </div>

          <div className="library-history-row">
            <strong style={{ fontSize: "0.82rem" }}>Demo video</strong>
            <p className="library-history-criteria">{exercise.hasDemoVideo ? "Attached" : "None attached"}</p>
          </div>

          <div className="library-history-row">
            <strong style={{ fontSize: "0.82rem" }}>Created</strong>
            <p className="library-history-criteria">
              {exercise.createdAtLabel} by {exercise.createdByName}
            </p>
          </div>
        </div>

        <div className="library-history-row-actions">
          {onEdit && (
            <button type="button" className="primary-button" onClick={onEdit}>
              Edit
            </button>
          )}
          {onViewHistory && (
            <button type="button" className="text-action" onClick={onViewHistory}>
              View history
            </button>
          )}
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
  // Replaces the old onSaveNew/onSaveEdit pair — now there's exactly one
  // "the backend call succeeded, go refetch the list" signal, since the page
  // owns the authoritative post-save state (the server response), not a
  // locally-constructed ExerciseLibraryItem.
  onSaved: () => void;
  // Two-step flow: when set, the "new exercise" modal only collects name +
  // movement tracking and calls this instead of saving. The full details form
  // lives at ExerciseCreationPage. Only provided when exercise===null (new).
  onCreateNew?: (name: string, tracking: ExerciseTrackingType) => void;
}

function ExerciseFormModal({ exercise, onClose, onSaved, onCreateNew }: ExerciseFormModalProps) {
  const { token, user } = useAuth();
  const isOwner = !exercise || (user ? (exercise.createdById === user.id || user.role === "admin") : false);
  const isEditingActive = exercise?.status === "active";
  // Two-step mode: when onCreateNew is provided and this is a new exercise,
  // the modal only collects name + movement tracking then calls onCreateNew.
  const isTwoStep = !exercise && !!onCreateNew;

  const [name, setName] = useState(exercise?.name ?? "");
  const [description, setDescription] = useState(exercise?.description ?? "");
  const [movementTracking, setMovementTracking] = useState<ExerciseTrackingType>(
    exercise?.movementTracking ?? "pose"
  );
  const [difficultyLevel, setDifficultyLevel] = useState<ExerciseLibraryDifficulty>(
    exercise?.difficultyLevel ?? "medium"
  );
  // Local preview only — see this file's header comment: no upload backend
  // exists, so picking a file here never reaches the server.
  const [demoFile, setDemoFile] = useState<PickedFile | null>(null);
  const [targetAngleDeg, setTargetAngleDeg] = useState(exercise?.baseCriteria.targetAngleDeg?.toString() ?? "90");
  const [targetGripStrength, setTargetGripStrength] = useState(
    exercise?.baseCriteria.targetGripStrength?.toString() ?? "50"
  );
  const [repetitions, setRepetitions] = useState(exercise?.baseCriteria.repetitions?.toString() ?? "10");
  const [holdSeconds, setHoldSeconds] = useState(exercise?.baseCriteria.holdSeconds?.toString() ?? "5");

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Status-change actions (Publish / Archive) are separate from the Save
  // button above: they don't touch any of the field state in this form, they
  // just move `exercise.status` directly via their own dedicated routes
  // (PATCH .../publish, PATCH .../archive) — same split as the page-level
  // handleArchive() uses for the card grid's own Archive button.
  const [statusAction, setStatusAction] = useState<"publish" | "archive" | null>(null);
  const [statusActionError, setStatusActionError] = useState<string | null>(null);

  const handlePublish = async () => {
    if (!exercise || !token) return;
    setStatusAction("publish");
    setStatusActionError(null);
    try {
      await publishExercise(token, exercise.id);
      onSaved();
    } catch (err) {
      setStatusActionError(err instanceof ApiError ? err.message : "Couldn't publish this exercise. Please try again.");
    } finally {
      setStatusAction(null);
    }
  };

  const handleArchiveFromModal = async () => {
    if (!exercise || !token) return;
    setStatusAction("archive");
    setStatusActionError(null);
    try {
      await archiveExercise(token, exercise.id);
      onSaved();
    } catch (err) {
      setStatusActionError(err instanceof ApiError ? err.message : "Couldn't archive this exercise. Please try again.");
    } finally {
      setStatusAction(null);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    // Two-step: new exercise with a dedicated creation page — just hand off
    // name + tracking type and let ExerciseCreationPage collect the rest.
    if (isTwoStep) {
      onCreateNew!(name.trim(), movementTracking);
      return;
    }

    if (!token) return;

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

    const payload: ExerciseInputPayload = {
      name: name.trim(),
      description: description.trim(),
      movementTracking,
      difficultyLevel,
      baseCriteria
    };

    setSaving(true);
    setFormError(null);
    try {
      if (!exercise) {
        // New exercise family — starts its own family id at v1/draft.
        await createExercise(token, payload);
      } else if (isEditingActive) {
        // Active -> editing creates a new draft version (BR-6); the backend
        // archives the previously-active row in the same transaction.
        await createExerciseVersion(token, exercise.id, payload);
      } else {
        // Draft -> safe to edit in place; nothing has ever gone live.
        await updateExerciseDraft(token, exercise.id, payload);
      }
      onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't save this exercise. Please try again.");
    } finally {
      setSaving(false);
    }
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

        {!isOwner && exercise && (
          <div className="library-warning-banner" style={{ borderColor: "var(--warning, #f59e0b)", background: "rgba(245, 158, 11, 0.1)" }}>
            <AlertTriangle size={16} />
            <span>
              This exercise was created by {exercise.createdByName || "another therapist"}. Only the creator can edit or version it.
            </span>
          </div>
        )}

        {exercise && (
          <div className="library-history-row" style={{ margin: "0 20px" }}>
            <div className="library-history-row-top">
              <span>
                Current status: <span className={`library-status-badge ${exercise.status}`}>{statusLabel(exercise.status)}</span>
              </span>
            </div>
            {statusActionError && (
              <p className="library-history-criteria" style={{ color: "var(--danger, #d33)" }}>
                {statusActionError}
              </p>
            )}
            {exercise.status !== "archived" && (
              <div className="library-history-row-actions">
                {exercise.status === "draft" && (
                  <button
                    type="button"
                    className="text-action"
                    disabled={statusAction !== null}
                    onClick={handlePublish}
                  >
                    <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                    {statusAction === "publish" ? "Publishing…" : "Publish now"}
                  </button>
                )}
                <button
                  type="button"
                  className="text-action danger"
                  disabled={statusAction !== null}
                  onClick={handleArchiveFromModal}
                >
                  {statusAction === "archive" ? "Archiving…" : "Archive"}
                </button>
              </div>
            )}
          </div>
        )}

        {formError && (
          <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", margin: "0 20px 12px" }}>
            <p style={{ margin: 0 }}>{formError}</p>
          </div>
        )}

        <form className="library-modal-form" onSubmit={handleSubmit}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>

          <div className="library-toggle-row">
            <label>
              Movement tracking
              <select
                className="creation-select"
                value={movementTracking}
                onChange={(event) => setMovementTracking(event.target.value as ExerciseTrackingType)}
              >
                {(["pose", "virtual_grip", "none"] as ExerciseTrackingType[]).map((option) => (
                  <option key={option} value={option}>
                    {trackingLabels[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Two-step mode: stop here and hand off to ExerciseCreationPage */}
          {isTwoStep ? (
            <button type="submit" className="primary-button full-width" disabled={!name.trim()}>
              Continue →
            </button>
          ) : (
            <>
              <label>
                Description
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
              </label>

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

              <button type="submit" className="primary-button full-width" disabled={saving || (!isOwner && !!exercise)}>
                {saving
                  ? "Saving…"
                  : exercise
                    ? !isOwner
                      ? "Read-only (not creator)"
                      : isEditingActive
                        ? `Save as v${exercise.versionNumber + 1} \u00b7 draft`
                        : "Save changes"
                    : "Save as v1 \u00b7 draft"}
              </button>
            </>
          )}
        </form>
      </div>
    </>
  );
}
