// Session Result Review page (UI_MOCKUP_PLAN_NEWDB.md §2.7, new page — no prior
// frontend-design.md section). Mirrors
// docs/04-design/mockups/session-result-review.html: an exercise switcher (when a
// session has more than one exercise), an attempt-number chip row per exercise, the
// AI score/feedback/metrics shown read-only next to an editable PT score/feedback
// panel, and a "Use AI score" / "Use my score" decision that sets
// evaluationSource/finalScore. Reached from Patient Detail's per-session
// "Review ›" action.
//
// Real, client-side only (same pattern as every other still-mock page): the PT
// score/feedback edits and the AI-vs-PT decision update local component state
// seeded from data/sessionReviewMock.ts. No exercise_performance_results backend
// endpoint exists yet — see UI_MOCKUP_PLAN_NEWDB.md §5: the running schema doesn't
// even have the ai_score/pt_score/evaluation_source/final_score columns this page
// is designed against yet, only a single `score` field.

import { ArrowLeft, Bell, Video } from "lucide-react";
import { useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { therapistProfile } from "../data/therapistMock";
import type { ExercisePerformanceAttempt, SessionExerciseReview, SessionReviewData } from "../types";

interface SessionResultReviewPageProps {
  review: SessionReviewData;
  onBack: () => void;
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
}

export function SessionResultReviewPage({ review, onBack, onLogout, onNavigate }: SessionResultReviewPageProps) {
  const [exercises, setExercises] = useState<SessionExerciseReview[]>(review.exercises);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | undefined>(review.exercises[0]?.id);
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
  };

  const useAiScore = (exerciseId: string, attempt: ExercisePerformanceAttempt) => {
    if (attempt.aiScore == null) return;
    updateAttempt(exerciseId, attempt.id, { finalScore: attempt.aiScore, evaluationSource: "ai" });
  };

  const useMyScore = (exerciseId: string, attempt: ExercisePerformanceAttempt) => {
    if (attempt.ptScore == null) return;
    updateAttempt(exerciseId, attempt.id, { finalScore: attempt.ptScore, evaluationSource: "pt" });
  };

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
                    onUpdate={(patch) => updateAttempt(selectedExercise.id, selectedAttempt.id, patch)}
                    onUseAiScore={() => useAiScore(selectedExercise.id, selectedAttempt)}
                    onUseMyScore={() => useMyScore(selectedExercise.id, selectedAttempt)}
                  />
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
  onUpdate,
  onUseAiScore,
  onUseMyScore
}: {
  attempt: ExercisePerformanceAttempt;
  onUpdate: (patch: Partial<ExercisePerformanceAttempt>) => void;
  onUseAiScore: () => void;
  onUseMyScore: () => void;
}) {
  const finalLabel =
    attempt.evaluationSource === "pt" ? "PT-reviewed" : attempt.evaluationSource === "manual" ? "Manual" : "AI-scored";

  return (
    <div className="srr-layout">
      <div className="srr-video-col">
        <p className="pd-record-attachments-label">Reference video</p>
        <div className="srr-video-placeholder">
          <Video size={26} />
        </div>
        <p>{attempt.referenceVideo ? attempt.referenceVideo.fileName : "No reference video attached yet"}</p>
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
