import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bell,
  Dumbbell,
  Hand,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { FilePicker } from "../components/FilePicker";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import {
  ApiError,
  archiveExercise,
  createExercise,
  createExerciseVersion,
  getFileContent,
  publishExercise,
  uploadFile,
  updateExerciseDraft,
  type ExerciseInputPayload
} from "../services/api";
import { useAuth } from "../store/authStore";
import { initialsFromName } from "../utils/displayName";
import type {
  ExerciseBaseCriteria,
  ExerciseLibraryItem,
  ExerciseLibraryStatus,
  ExerciseTrackingType,
  PickedFile
} from "../types";

// Exercise Creation & Detail / Editor page.
// Reached either:
//   1. From the "New exercise" 2-step popup in Exercise Library (exercise is null)
//   2. By clicking an existing exercise in the Exercise Library (exercise is provided)
//
// Collects and displays the fields persisted by ExerciseLibrary plus its demo video.
//
// Handles creation (POST /exercises), draft updates (PATCH /exercises/:id),
// version bumping for active exercises (POST /exercises/:id/versions), and publishing.

interface ExerciseCreationPageProps {
  initialName?: string;
  initialTracking?: ExerciseTrackingType;
  exercise?: ExerciseLibraryItem | null;
  onBack: () => void;
  onSaved: () => void;
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  onOpenAi: () => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExerciseCreationPage({
  initialName = "",
  initialTracking = "pose",
  exercise,
  onBack,
  onSaved,
  onLogout,
  onNavigate,
  onOpenAi
}: ExerciseCreationPageProps) {
  const { token, user } = useAuth();

  const isEditing = !!exercise;
  const isOwner = !exercise || (user ? (exercise.createdById === user.id || user.role === "admin") : false);
  const isEditingActive = exercise?.status === "active";
  const isArchived = exercise?.status === "archived";

  const [name, setName] = useState(exercise?.name ?? initialName);
  const [movementTracking, setMovementTracking] = useState<ExerciseTrackingType>(
    exercise?.movementTracking ?? initialTracking
  );
  const [description, setDescription] = useState(exercise?.description ?? "");
  const [demoFile, setDemoFile] = useState<PickedFile | null>(null);
  const [difficultyLevel, setDifficultyLevel] = useState(exercise?.difficultyLevel ?? "medium");
  const [status, setStatus] = useState<ExerciseLibraryStatus>(exercise?.status ?? "draft");

  // ── Pose-tracking criteria ──────────────────────────────────────────────────
  const [targetAngleDeg, setTargetAngleDeg] = useState(
    exercise?.baseCriteria?.targetAngleDeg ?? 90
  );
  // ── Virtual-grip criteria ───────────────────────────────────────────────────
  const [targetGripStrength, setTargetGripStrength] = useState(
    exercise?.baseCriteria?.targetGripStrength?.toString() ?? "50"
  );
  const [repetitions, setRepetitions] = useState(
    exercise?.baseCriteria?.repetitions?.toString() ?? "10"
  );
  const [holdSeconds, setHoldSeconds] = useState(
    exercise?.baseCriteria?.holdSeconds?.toString() ?? "5"
  );

  // ── Action states ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Sync state whenever the selected exercise prop changes
  useEffect(() => {
    if (exercise) {
      setName(exercise.name);
      setStatus(exercise.status);
      setMovementTracking(exercise.movementTracking);
      setDescription(exercise.description ?? "");
      setDifficultyLevel(exercise.difficultyLevel);
      if (exercise.baseCriteria?.targetAngleDeg !== undefined) {
        setTargetAngleDeg(exercise.baseCriteria.targetAngleDeg);
      }
      if (exercise.baseCriteria?.targetGripStrength !== undefined) {
        setTargetGripStrength(exercise.baseCriteria.targetGripStrength.toString());
      }
      if (exercise.baseCriteria?.repetitions !== undefined) {
        setRepetitions(exercise.baseCriteria.repetitions.toString());
      }
      if (exercise.baseCriteria?.holdSeconds !== undefined) {
        setHoldSeconds(exercise.baseCriteria.holdSeconds.toString());
      }
    } else {
      setName(initialName);
      setMovementTracking(initialTracking);
      setStatus("draft");
    }
  }, [exercise, initialName, initialTracking]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setDemoFile(null);
    if (!token || !exercise?.demoVideoFileId) return;

    getFileContent(token, exercise.demoVideoFileId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setDemoFile({
          id: exercise.demoVideoFileId!,
          fileName: exercise.demoVideoFile?.originalName ?? "Demo video",
          fileType: "video",
          sizeLabel: exercise.demoVideoFile?.fileSize
            ? `${(exercise.demoVideoFile.fileSize / (1024 * 1024)).toFixed(1)} MB`
            : "",
          previewUrl: objectUrl,
          uploadedAtLabel: ""
        });
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not load the existing demo video.");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [exercise, token]);

  useEffect(() => {
    if (error) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, demoFile, difficultyLevel, targetAngleDeg, targetGripStrength, repetitions, holdSeconds]);

  // ── Save handler ────────────────────────────────────────────────────────────
  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      setError("Please log in again to save.");
      return;
    }

    if (!name.trim()) {
      setError("Please enter an exercise name.");
      return;
    }

    setConfirmOpen(true);
  };

  const confirmSave = async () => {
    setConfirmOpen(false);
    if (!token) {
      setError("Please log in again to save.");
      return;
    }

    setSaving(true);
    setError(null);

    const baseCriteria: ExerciseBaseCriteria = {};
    if (movementTracking === "pose") {
      baseCriteria.targetAngleDeg = targetAngleDeg;
      if (repetitions) baseCriteria.repetitions = Number(repetitions);
      if (holdSeconds) baseCriteria.holdSeconds = Number(holdSeconds);
    } else if (movementTracking === "virtual_grip") {
      if (targetGripStrength) baseCriteria.targetGripStrength = Number(targetGripStrength);
      if (repetitions) baseCriteria.repetitions = Number(repetitions);
      if (holdSeconds) baseCriteria.holdSeconds = Number(holdSeconds);
    } else {
      if (repetitions) baseCriteria.repetitions = Number(repetitions);
    }

    const payload: ExerciseInputPayload = {
      name: name.trim(),
      description: description.trim(),
      movementTracking,
      difficultyLevel,
      baseCriteria,
      demoVideoFileId: demoFile?.id ?? null
    };

    try {
      if (!exercise) {
        // New exercise
        await createExercise(token, payload);
      } else if (isEditingActive) {
        // Active exercise: editing generates a new version (BR-6)
        await createExerciseVersion(token, exercise.id, payload);
      } else {
        // Draft: updates in place
        await updateExerciseDraft(token, exercise.id, payload);
      }
      if (exercise && status !== exercise.status) {
        if (status === "active" && exercise.status === "draft") {
          await publishExercise(token, exercise.id);
        } else if (status === "archived") {
          await archiveExercise(token, exercise.id);
        }
      }
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't save the exercise. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const displayName = user?.displayName || user?.username || "Therapist";

  return (
    <section className="therapist-shell exercise-creation-page">
      <TherapistSidebar activeLabel="Exercise Library" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div className="creation-topbar-title">
            <Dumbbell size={18} />
            <div>
              <strong>{isEditing ? "Edit exercise" : "Create exercise"}</strong>
              <span>Build a guided rehabilitation activity</span>
            </div>
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
              <span className="avatar-badge">{initialsFromName(displayName)}</span>
            </div>
          </div>
        </header>

        <main className="therapist-main exercise-creation-main" style={{ maxWidth: 1320, margin: "0 auto", width: "100%" }}>
          <button
            type="button"
            className="text-action pd-back-link"
            onClick={onBack}
            style={{ marginBottom: 14 }}
          >
            <ArrowLeft size={14} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            Back to Exercise Library
          </button>
          {error && (
            <div
              className="summary-card"
              role="alert"
              style={{ borderColor: "var(--danger, #d33)", marginBottom: 16 }}
            >
              <p style={{ margin: 0 }}>{error}</p>
            </div>
          )}


          {!isOwner && exercise && (
            <div
              className="library-warning-banner"
              style={{
                marginBottom: 16,
                borderColor: "var(--warning, #f59e0b)",
                background: "rgba(245, 158, 11, 0.1)"
              }}
            >
              <AlertTriangle size={16} />
              <span>
                This exercise was created by {exercise.createdByName || "another therapist"}. It is opened in read-only mode.
              </span>
            </div>
          )}

          <form
            className="creation-two-column-layout exercise-creation-form"
            onSubmit={handleSave}
            style={{ width: "100%", paddingBottom: 40 }}
          >
            {/* ══════════════ LEFT COLUMN ══════════════ */}
            <div className="creation-left-col">
              {/* 1. Video Box */}
              <div className="creation-video-card">
                {/* 16:9 Video Area */}
                <div className="checkpoint-video-area">
                  {demoFile && (
                    <video
                      src={demoFile.previewUrl}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      controls
                    />
                  )}

                  {/* Badge overlay on bottom-left */}
                  <div
                    className="checkpoint-video-badge"
                    style={{
                      bottom: 12,
                      left: 14,
                      background: "rgba(255, 255, 255, 0.92)",
                      color: "#0f172a",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.25)"
                    }}
                  >
                    {name || "Exercise"}
                  </div>

                </div>

                {/* Demo video file picker */}
                <div style={{ marginTop: 4 }}>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, display: "block" }}>
                    Demo Video
                  </label>
                  <FilePicker
                    value={demoFile}
                    onAttach={(file) => {
                      if (demoFile) URL.revokeObjectURL(demoFile.previewUrl);
                      setDemoFile(file);
                    }}
                    onRemove={() => {
                      if (demoFile) URL.revokeObjectURL(demoFile.previewUrl);
                      setDemoFile(null);
                    }}
                    accept="video/*"
                    maxSizeMB={100}
                    onUpload={async (file, localPreviewUrl) => {
                      const response = await uploadFile(token!, file);
                      if (response.file.fileType !== "video") {
                        throw new Error("The selected demo file must be a video.");
                      }
                      return {
                        id: response.file.id,
                        fileName: response.file.originalName,
                        fileType: "video",
                        sizeLabel: response.file.fileSize
                          ? `${(response.file.fileSize / (1024 * 1024)).toFixed(1)} MB`
                          : "",
                        previewUrl: localPreviewUrl,
                        uploadedAtLabel: new Date(response.file.createdAt).toISOString().slice(0, 10)
                      };
                    }}
                  />
                </div>
              </div>

              <div className="creation-info-combined creation-section-card">
              <div className="creation-section-header">
                <Dumbbell size={20} />
                <div><strong>Exercise information</strong><p className="library-card-sub">Define the core details for this exercise.</p></div>
              </div>
              {/* 2. Exercise Name */}
              <label style={{ display: "grid", gap: 6, fontWeight: 600, fontSize: "0.88rem" }}>
                Exercise name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Elbow Extension"
                  required
                  disabled={isArchived || (!isOwner && isEditing)}
                  style={{
                    height: 42,
                    border: "1.5px solid var(--border)",
                    borderRadius: 12,
                    padding: "8px 14px",
                    background: "var(--card)",
                    color: "var(--text-primary)",
                    font: "inherit"
                  }}
                />
              </label>

              <div className="creation-meta-row">
                <label className="creation-status-field">
                  Status
                  <select
                    className={`creation-select status-${status}`}
                    value={status}
                    disabled={isArchived || (!isOwner && isEditing) || saving || publishing}
                    onChange={(event) => setStatus(event.target.value as ExerciseLibraryStatus)}
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>

                <label className="creation-status-field">
                  Movement tracking
                  <select
                    className="creation-select"
                    value={movementTracking}
                    disabled={isArchived || (!isOwner && isEditing)}
                    onChange={(e) => setMovementTracking(e.target.value as ExerciseTrackingType)}
                  >
                    <option value="pose">Pose tracking</option>
                    <option value="virtual_grip">Virtual grip</option>
                    <option value="none">No AI tracking</option>
                  </select>
                </label>
              </div>

              {/* 4. Description Box */}
              <label style={{ display: "grid", gap: 6, fontWeight: 600, fontSize: "0.88rem" }}>
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the exercise, its purpose, and how it should be performed…"
                  rows={4}
                  disabled={isArchived || (!isOwner && isEditing)}
                  required
                  style={{
                    border: "1.5px solid var(--border)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    background: "var(--card)",
                    color: "var(--text-primary)",
                    font: "inherit",
                    resize: "vertical"
                  }}
                />
              </label>

              </div>

              <div className="creation-section-card exercise-difficulty-card">
                <div className="creation-section-header">
                  <Dumbbell size={20} />
                  <div><strong>Difficulty</strong><p className="library-card-sub">Choose the exercise difficulty level.</p></div>
                </div>
                <div className="library-segmented" aria-label="Exercise difficulty">
                  {(["easy", "medium", "hard"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={difficultyLevel === level ? "active" : ""}
                      aria-pressed={difficultyLevel === level}
                      disabled={isArchived || (!isOwner && isEditing)}
                      onClick={() => setDifficultyLevel(level)}
                    >
                      {level[0].toUpperCase() + level.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 5. Submit / Action Buttons */}
              <div className="exercise-save-actions" style={{ display: "flex", gap: 12, marginTop: 4 }}>
                <button
                  type="submit"
                  className="primary-button full-width"
                  disabled={saving || publishing || isArchived || (!isOwner && isEditing)}
                >
                  {saving
                    ? "Saving…"
                    : !exercise
                      ? "Save as v1 · draft"
                      : !isOwner
                        ? "Read-only (not creator)"
                        : isArchived
                          ? "Archived · Read-only"
                          : isEditingActive
                            ? `Save as v${exercise.versionNumber + 1} · draft`
                            : "Save changes"}
                </button>
              </div>
            </div>

            {/* ══════════════ RIGHT COLUMN (criteria) ══════════════ */}
            <div className="creation-right-col">
              {movementTracking === "pose" ? (
                <div className="creation-section-card" style={{ margin: 0 }}>
                  <div className="creation-section-header">
                    <Dumbbell size={20} />
                    <div>
                      <strong>Exercise criteria</strong>
                      <p className="library-card-sub">Configure the persisted pose criteria.</p>
                    </div>
                  </div>
                  <label style={{ display: "grid", gap: 6, fontWeight: 600, fontSize: "0.85rem" }}>
                    Target angle (degrees)
                    <input type="number" min={0} max={180} value={targetAngleDeg} disabled={isArchived || (!isOwner && isEditing)} onChange={(e) => setTargetAngleDeg(Number(e.target.value))} />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontWeight: 600, fontSize: "0.85rem", marginTop: 14 }}>
                    Repetitions
                    <input type="number" min={1} value={repetitions} disabled={isArchived || (!isOwner && isEditing)} onChange={(e) => setRepetitions(e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontWeight: 600, fontSize: "0.85rem", marginTop: 14 }}>
                    Hold (seconds)
                    <input type="number" min={0} value={holdSeconds} disabled={isArchived || (!isOwner && isEditing)} onChange={(e) => setHoldSeconds(e.target.value)} />
                  </label>
                </div>
              ) : movementTracking === "virtual_grip" ? (
                <div className="creation-section-card" style={{ margin: 0 }}>
                  <div className="creation-section-header">
                    <Hand size={20} />
                    <div>
                      <strong>Exercise criteria</strong>
                      <p className="library-card-sub">Configure the persisted virtual grip criteria.</p>
                    </div>
                  </div>
                  <label style={{ display: "grid", gap: 6, fontWeight: 600, fontSize: "0.85rem" }}>
                    Target grip strength
                    <input type="number" min={0} value={targetGripStrength} disabled={isArchived || (!isOwner && isEditing)} onChange={(e) => setTargetGripStrength(e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontWeight: 600, fontSize: "0.85rem", marginTop: 14 }}>
                    Repetitions
                    <input type="number" min={1} value={repetitions} disabled={isArchived || (!isOwner && isEditing)} onChange={(e) => setRepetitions(e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontWeight: 600, fontSize: "0.85rem", marginTop: 14 }}>
                    Hold (seconds)
                    <input type="number" min={0} value={holdSeconds} disabled={isArchived || (!isOwner && isEditing)} onChange={(e) => setHoldSeconds(e.target.value)} />
                  </label>
                </div>
              ) : (
                <div className="creation-section-card" style={{ margin: 0 }}>
                  <div className="creation-section-header">
                    <Ban size={20} />
                    <div>
                      <strong>Exercise criteria</strong>
                      <p className="library-card-sub">Configure the persisted repetition criteria.</p>
                    </div>
                  </div>
                  <label style={{ display: "grid", gap: 6, fontWeight: 600, fontSize: "0.85rem" }}>
                    Repetitions
                    <input type="number" min={1} value={repetitions} disabled={isArchived || (!isOwner && isEditing)} onChange={(e) => setRepetitions(e.target.value)} />
                  </label>
                </div>
              )}
            </div>

          </form>
          {confirmOpen && (
            <>
              <div
                className="therapist-panel-scrim admin-info-confirm-scrim"
                onClick={() => setConfirmOpen(false)}
              />
              <div
                className="admin-modal admin-info-confirm"
                role="dialog"
                aria-modal="true"
                aria-label={exercise ? "Confirm exercise changes" : "Confirm exercise creation"}
              >
                <span className="admin-info-confirm-icon">
                  <AlertCircle size={20} />
                </span>
                <strong>{exercise ? "Save exercise changes?" : "Create exercise?"}</strong>
                <p>
                  {exercise
                    ? `Save the changes to "${name.trim() || exercise.name}"?`
                    : `Create "${name.trim()}" as a new exercise?`}
                </p>
                <div className="admin-info-confirm-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setConfirmOpen(false)}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={confirmSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Confirm & save"}
                  </button>
                </div>
              </div>
            </>
          )}
          <div className="ai-workspace-footer">
            <button type="button" className="secondary-button" onClick={onOpenAi}>
              Open AI workspace
            </button>
          </div>
        </main>
      </div>
    </section>
  );
}
