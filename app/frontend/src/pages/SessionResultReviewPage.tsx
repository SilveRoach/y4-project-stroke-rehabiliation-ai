// Session Result Review page (UI_MOCKUP_PLAN_NEWDB.md §2.7, new page — no prior
// frontend-design.md section). Mirrors
// docs/04-design/mockups/session-result-review.html: an exercise switcher (when a
// session has more than one exercise), an attempt-number chip row per exercise, the
// AI score/feedback/metrics shown read-only next to an editable PT score/feedback
// panel, and a "Use AI score" / "Use my score" decision that sets
// evaluationSource/finalScore. Reached from Patient Detail's per-session
// "Review ›" action.
//
// Real: the PT score/feedback edits and the AI-vs-PT decision persist for real
// recorded attempts via PATCH /performance-results/:id/scoring (assigned
// therapist or admin) — see session.service.ts's updateAttemptScoring. Only
// synthesized/mock fallback attempts (no server row) remain client-side only.

import { ArrowLeft, Bell, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { ApiError, getFileContent, getScheduleDayReview, updateAttemptScoring } from "../services/api";
import { useAuth } from "../store/authStore";
import { therapistProfile } from "../data/therapistMock";
import type {
  ExercisePerformanceAttempt,
  SessionExerciseReview,
  SessionReviewData
} from "../types";

// Maps the real GET /schedule-days/:id/results payload onto the page's
// SessionExerciseReview/attempt shape. The video comes through as a server
// files-row id (referenceVideoFileId) — AttemptReview streams it via
// getFileContent and renders a real <video> player in place of the placeholder.
function mapRealReviewToExercises(real: any): SessionExerciseReview[] {
  return (real.exercises ?? []).map((exercise: any) => ({
    id: exercise.id,
    scheduledExerciseId: exercise.scheduledExerciseId,
    exerciseName: exercise.exerciseName,
    exerciseVersionLabel: exercise.exerciseVersionLabel,
    attempts: (exercise.attempts ?? []).map((attempt: any) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      referenceVideo: null,
      referenceVideoFileId: attempt.referenceVideoFileId ?? null,
      aiScore: attempt.aiScore ?? undefined,
      aiFeedback: attempt.aiFeedback ?? undefined,
      ptScore: attempt.ptScore ?? undefined,
      ptFeedback: attempt.ptFeedback ?? undefined,
      finalScore: attempt.finalScore ?? undefined,
      evaluationSource: attempt.evaluationSource ?? undefined
    }))
  }));
}

interface SessionResultReviewPageProps {
  review: SessionReviewData;
  onBack: () => void;
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  // Scheduled-exercise id to focus when the review was opened from a specific
  // exercise (PatientDetailPage's per-exercise "Review" action); undefined =
  // whole-day review, starting on the first exercise.
  focusExerciseId?: string;
}

export function SessionResultReviewPage({ review, onBack, onLogout, onNavigate, focusExerciseId }: SessionResultReviewPageProps) {
  const { token } = useAuth();
  const [exercises, setExercises] = useState<SessionExerciseReview[]>(review.exercises);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | undefined>(() => {
    return review.exercises.find((exercise) => exercise.id === focusExerciseId)?.id ?? review.exercises[0]?.id;
  });

  // Real attempts: the review payload handed in from App.tsx is mock/synthesized
  // (data/sessionReviewMock.ts). Fetch the REAL exercise_performance_results for
  // this schedule day and swap them in when they exist — mock data stays as the
  // fallback for seeded days that never had a real recorded attempt. The real
  // attempt ids are recorded in persistedAttemptIds: only those can be scored
  // for real (PATCH /performance-results/:id/scoring) — mock/synthesized
  // attempts have no server row, so their edits stay client-side.
  const [persistedAttemptIds, setPersistedAttemptIds] = useState<Set<string>>(new Set());
  const [scoringStatus, setScoringStatus] = useState<{ tone: "saved" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getScheduleDayReview(token, review.sessionId)
      .then((res) => {
        if (cancelled) return;
        const mapped = mapRealReviewToExercises(res.review);
        if (mapped.length > 0) {
          setExercises(mapped);
          // Same focus rule as the initial state: the requested exercise when
          // present, else the day's first exercise.
          setSelectedExerciseId(mapped.find((exercise) => exercise.id === focusExerciseId)?.id ?? mapped[0].id);
          setPersistedAttemptIds(
            new Set(mapped.flatMap((exercise) => exercise.attempts.map((attempt) => attempt.id)))
          );
        }
      })
      .catch(() => {
        // Not found / not permitted / no real attempts — keep the fallback data.
      });
    return () => {
      cancelled = true;
    };
  }, [token, review.sessionId]);

  const [selectedAttemptByExercise, setSelectedAttemptByExercise] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const exercise of review.exercises) {
      if (exercise.attempts[0]) initial[exercise.id] = exercise.attempts[0].id;
    }
    return initial;
  });

  const selectedExercise = exercises.find((exercise) => exercise.id === selectedExerciseId) ?? exercises[0];
  const selectedAttemptId = selectedExercise ? selectedAttemptByExercise[selectedExercise.id] : undefined;
  const selectedAttempt = selectedExercise?.attempts.find((attempt) => attempt.id === selectedAttemptId) ?? selectedExercise?.attempts[0];

  // Applies a scoring patch locally, and persists it to
  // PATCH /performance-results/:id/scoring when the attempt is a real server
  // row (mock/synthesized fallback attempts stay client-side only). PT
  // edits are debounced per attempt by the caller (the inputs fire per
  // keystroke — debounce keeps request volume sane); the final-score decision
  // buttons persist immediately.
  const updateAttempt = (exerciseId: string, attemptId: string, patch: Partial<ExercisePerformanceAttempt>) => {
    setExercises((current) =>
      current.map((exercise) =>
        exercise.id !== exerciseId
          ? exercise
          : {
              ...exercise,
              attempts: exercise.attempts.map((attempt) =>
                attempt.id !== attemptId ? attempt : { ...attempt, ...patch }
              )
            }
      )
    );

    const scoringPatch: Record<string, unknown> = {};
    for (const key of ["ptScore", "ptFeedback", "finalScore", "evaluationSource"] as const) {
      if (key in patch) scoringPatch[key] = patch[key];
    }
    if (Object.keys(scoringPatch).length === 0) return;
    if (!token || !persistedAttemptIds.has(attemptId)) return;

    setScoringStatus({ tone: "saved", message: "Saving…" });
    window.clearTimeout(scoringTimerRef.current);
    scoringTimerRef.current = window.setTimeout(() => {
      updateAttemptScoring(token, attemptId, scoringPatch)
        .then(() => setScoringStatus({ tone: "saved", message: "Scoring saved" }))
        .catch((err) => {
          setScoringStatus({
            tone: "error",
            message: err instanceof ApiError ? err.message : "Couldn't save your scoring. Please try again."
          });
        });
    }, 600);
  };

  const useAiScore = (exerciseId: string, attempt: ExercisePerformanceAttempt) => {
    if (attempt.aiScore == null) return;
    updateAttempt(exerciseId, attempt.id, { finalScore: attempt.aiScore, evaluationSource: "ai" });
  };

  const useMyScore = (exerciseId: string, attempt: ExercisePerformanceAttempt) => {
    if (attempt.ptScore == null) return;
    updateAttempt(exerciseId, attempt.id, { finalScore: attempt.ptScore, evaluationSource: "pt" });
  };

  // Debounce handle for PT-scoring persistence (see updateAttempt).
  const scoringTimerRef = useRef<number | undefined>(undefined);

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Patients" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Session Result Review</h1>
            <p>
              {review.patientName} &middot; {review.dateLabel} &middot; {review.dayLabel}
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

          {exercises.length === 0 ? (
            <p className="srr-empty-note">No exercises were attempted this session.</p>
          ) : (
            selectedExercise && (
              <>
                {exercises.length > 1 && (
                  <div className="srr-exercise-tabs">
                    {exercises.map((exercise) => (
                      <button
                        key={exercise.id}
                        type="button"
                        className={`srr-exercise-tab ${exercise.id === selectedExercise.id ? "active" : ""}`}
                        onClick={() => setSelectedExerciseId(exercise.id)}
                      >
                        {exercise.exerciseName}
                        {exercise.exerciseVersionLabel ? ` · ${exercise.exerciseVersionLabel}` : ""}
                      </button>
                    ))}
                  </div>
                )}

                {selectedExercise.attempts.length > 1 && (
                  <div className="srr-attempt-chips">
                    {selectedExercise.attempts.map((attempt) => (
                      <button
                        key={attempt.id}
                        type="button"
                        className={`srr-attempt-chip ${attempt.id === selectedAttempt?.id ? "active" : ""}`}
                        onClick={() =>
                          setSelectedAttemptByExercise((current) => ({ ...current, [selectedExercise.id]: attempt.id }))
                        }
                      >
                        Attempt {attempt.attemptNumber}
                      </button>
                    ))}
                  </div>
                )}

                {selectedAttempt && (
                  <AttemptReview
                    attempt={selectedAttempt}
                    token={token}
                    onUpdate={(patch) => updateAttempt(selectedExercise.id, selectedAttempt.id, patch)}
                    onUseAiScore={() => useAiScore(selectedExercise.id, selectedAttempt)}
                    onUseMyScore={() => useMyScore(selectedExercise.id, selectedAttempt)}
                  />
                )}

                {/* PT-scoring persistence feedback — "Saved" after the debounced
                    PATCH resolves, or the API's error message if it fails. Only
                    real (server-persisted) attempts can be saved; synthesized
                    fallback attempts are local-only. */}
                {scoringStatus && (
                  <p
                    className="pd-modal-hint"
                    role="status"
                    style={{ color: scoringStatus.tone === "error" ? "var(--danger, #d33)" : undefined }}
                  >
                    {scoringStatus.message}
                  </p>
                )}
              </>
            )
          )}
        </main>
      </div>
    </section>
  );
}

function AttemptReview({
  attempt,
  token,
  onUpdate,
  onUseAiScore,
  onUseMyScore
}: {
  attempt: ExercisePerformanceAttempt;
  token?: string | null;
  onUpdate: (patch: Partial<ExercisePerformanceAttempt>) => void;
  onUseAiScore: () => void;
  onUseMyScore: () => void;
}) {
  const finalLabel =
    attempt.evaluationSource === "pt" ? "PT-reviewed" : attempt.evaluationSource === "manual" ? "Manual" : "AI-scored";

  // Stream the patient's recorded attempt video: the real attempt carries a
  // server files-row id (referenceVideoFileId) — fetch the bytes via the auth'd
  // GET /files/:fileId/content endpoint and render a real player. Mock attempts
  // (no file id) keep the placeholder box.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    const fileId = attempt.referenceVideoFileId ?? null;
    if (!token || !fileId) {
      setVideoUrl(null);
      setVideoError(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setVideoUrl(null);
    setVideoError(false);
    getFileContent(token, fileId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setVideoUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setVideoError(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, attempt.referenceVideoFileId]);

  const videoLabel = attempt.referenceVideo?.fileName
    ? attempt.referenceVideo.fileName
    : videoUrl
      ? "Patient's recorded attempt"
      : videoError
        ? "Couldn't load the patient's recording"
        : "No reference video attached yet";

  return (
    <div className="srr-layout">
      <div className="srr-video-col">
        <p className="pd-record-attachments-label">Patient recording · วิดีโอของผู้ป่วย</p>
        {videoUrl ? (
          <video className="sud-video" src={videoUrl} controls playsInline />
        ) : (
          <div className="srr-video-placeholder">
            {videoError ? null : <Video size={26} />}
          </div>
        )}
        <p>{videoLabel}</p>
      </div>

      <div>
        <div className="srr-score-grid">
          <div className="srr-score-panel">
            <div className="srr-score-panel-top">
              <strong>AI score</strong>
              <span className="srr-score-value">{attempt.aiScore ?? "—"}</span>
            </div>
            {attempt.aiFeedback && <p>{attempt.aiFeedback}</p>}
            {attempt.aiMetrics && attempt.aiMetrics.length > 0 && (
              <div className="srr-metrics-list">
                {attempt.aiMetrics.map((metric) => (
                  <span key={metric.label}>
                    {metric.label}: <strong>{metric.value}</strong>
                  </span>
                ))}
              </div>
            )}
            {attempt.aiEvaluatedAtLabel && <p className="small">Evaluated {attempt.aiEvaluatedAtLabel}</p>}
          </div>

          <div className="srr-score-panel">
            <div className="srr-score-panel-top">
              <strong>Your score (PT)</strong>
              <input
                className="srr-score-input"
                value={attempt.ptScore ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  onUpdate({ ptScore: raw === "" ? undefined : Number(raw) });
                }}
                inputMode="numeric"
                placeholder="—"
              />
            </div>
            <textarea
              value={attempt.ptFeedback ?? ""}
              onChange={(event) => onUpdate({ ptFeedback: event.target.value })}
              placeholder="Add your notes for this attempt..."
            />
          </div>
        </div>

        <div className="srr-decision-bar">
          <span>Final score used for this attempt:</span>
          <div className="srr-decision-actions">
            <button
              type="button"
              className={`secondary-button ${attempt.evaluationSource === "ai" ? "active" : ""}`}
              onClick={onUseAiScore}
              disabled={attempt.aiScore == null}
            >
              Use AI score {attempt.aiScore != null ? `(${attempt.aiScore})` : ""}
            </button>
            <button
              type="button"
              className={`secondary-button ${attempt.evaluationSource === "pt" ? "active" : ""}`}
              onClick={onUseMyScore}
              disabled={attempt.ptScore == null}
            >
              Use my score {attempt.ptScore != null ? `(${attempt.ptScore})` : ""}
            </button>
          </div>
        </div>

        {attempt.finalScore != null && (
          <p className="srr-current-final">
            Currently: <strong>{attempt.finalScore}</strong> &middot; {finalLabel}
          </p>
        )}
      </div>
    </div>
  );
}
