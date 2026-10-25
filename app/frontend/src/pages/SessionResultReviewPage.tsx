// Reviews persisted exercise attempts for one schedule day. The selected
// attempt's recording and AI/PT evaluations come from GET /schedule-days/:id/results;
// therapist reviews are saved through PATCH /performance-results/:id/scoring.

import { ArrowLeft, Save, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { PoseVideoPlayer } from "../components/PoseVideoPlayer";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { ApiError, getFileContent, getScheduleDayReview, updateAttemptScoring } from "../services/api";
import { useAuth } from "../store/authStore";
import type {
  ExercisePerformanceAttempt,
  SessionExerciseReview,
  SessionReviewData
} from "../types";
import type { ScheduleDayReviewData } from "../services/api";

// Maps the real GET /schedule-days/:id/results payload onto the page's
// SessionExerciseReview/attempt shape. The video comes through as a server
// files-row id (referenceVideoFileId) — AttemptReview streams it via
// getFileContent and renders a real <video> player in place of the placeholder.
function mapRealReviewToExercises(real: ScheduleDayReviewData): SessionExerciseReview[] {
  return real.exercises.map((exercise) => ({
    id: exercise.id,
    scheduledExerciseId: exercise.scheduledExerciseId,
    exerciseName: exercise.exerciseName,
    exerciseVersionLabel: exercise.exerciseVersionLabel,
    description: exercise.description,
    difficultyLevel: exercise.difficultyLevel,
    movementTracking: exercise.movementTracking,
    baseCriteria: exercise.baseCriteria,
    targetValueLabel: exercise.targetValueLabel,
    therapistInstruction: exercise.therapistInstruction,
    attempts: exercise.attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      completedAtIso: attempt.completedAtIso,
      referenceVideo: null,
      referenceVideoFileId: attempt.referenceVideoFileId ?? null,
      aiScore: attempt.aiScore ?? undefined,
      aiFeedback: attempt.aiFeedback ?? undefined,
      aiMetrics: attempt.aiMetrics ?? undefined,
      aiEvaluatedAtLabel: attempt.aiEvaluatedAtIso
        ? new Date(attempt.aiEvaluatedAtIso).toLocaleString("th-TH")
        : undefined,
      ptScore: attempt.ptScore ?? undefined,
      ptFeedback: attempt.ptFeedback ?? undefined,
      finalScore: attempt.finalScore ?? undefined,
      evaluationSource: attempt.evaluationSource ?? undefined,
      currentScore: attempt.currentScore,
      currentScoreSource: attempt.currentScoreSource,
      therapistReviewed: attempt.therapistReviewed
    }))
  }));
}

function exerciseDifficultyLabel(value: string): string {
  const labels: Record<string, string> = { easy: "ง่าย", medium: "ปานกลาง", moderate: "ปานกลาง", hard: "ยาก" };
  return labels[value.toLowerCase()] ?? value;
}

function movementTrackingLabel(value: string): string {
  if (value === "pose") return "ติดตามท่าทาง";
  if (value === "virtual_grip") return "วัดแรงบีบมือ";
  if (value === "none") return "ไม่ใช้ AI ติดตาม";
  return value.replace(/_/g, " ");
}

function criterionLabel(value: string): string {
  const labels: Record<string, string> = {
    "target angle": "มุมเป้าหมาย",
    "target angle (degrees)": "มุมเป้าหมาย (องศา)",
    "target grip strength": "แรงบีบมือเป้าหมาย",
    "grip strength": "แรงบีบมือ",
    repetitions: "จำนวนครั้ง",
    reps: "จำนวนครั้ง",
    "hold duration": "ระยะเวลาค้างไว้",
    "hold duration (seconds)": "ระยะเวลาค้างไว้ (วินาที)"
  };
  return labels[value.trim().toLowerCase()] ?? value;
}

function reviewDayLabel(value: string): string {
  return value.replace(/^day\s+(\d+)$/i, "วันที่ $1");
}

function formatReviewDateTime(value: string): string {
  return new Date(value).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function formatReviewDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

interface SessionResultReviewPageProps {
  review: SessionReviewData;
  onBack: () => void;
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  // Scheduled-exercise id to focus when this review was opened for one exercise;
  // undefined = whole-day review.
  focusExerciseId?: string;
}

export function SessionResultReviewPage({ review, onBack, onLogout, onNavigate, focusExerciseId }: SessionResultReviewPageProps) {
  const { token } = useAuth();
  const [exercises, setExercises] = useState<SessionExerciseReview[]>([]);
  const [sessionDetails, setSessionDetails] = useState({
    planName: review.planName ?? "",
    scheduledDateIso: review.scheduledDateIso ?? ""
  });
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | undefined>();
  const [loadingReview, setLoadingReview] = useState(true);

  // Only persisted attempts are rendered and can be reviewed.
  const [persistedAttemptIds, setPersistedAttemptIds] = useState<Set<string>>(new Set());
  const [scoringStatus, setScoringStatus] = useState<{ tone: "saved" | "error"; message: string } | null>(null);
  const [ptScoreDraft, setPtScoreDraft] = useState("");
  const [ptFeedbackDraft, setPtFeedbackDraft] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [changingScoreSource, setChangingScoreSource] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadingReview(false);
      setScoringStatus({ tone: "error", message: "กรุณาเข้าสู่ระบบอีกครั้งเพื่อตรวจสอบผลการฝึก" });
      return;
    }
    let cancelled = false;
    setLoadingReview(true);
    getScheduleDayReview(token, review.sessionId)
      .then((res) => {
        if (cancelled) return;
        const mapped = mapRealReviewToExercises(res.review);
        setExercises(mapped);
        setSessionDetails({
          planName: res.review.planName,
          scheduledDateIso: res.review.scheduledDateIso
        });
        setSelectedExerciseId(mapped.find((exercise) => exercise.id === focusExerciseId)?.id ?? mapped[0]?.id);
        setPersistedAttemptIds(new Set(mapped.flatMap((exercise) => exercise.attempts.map((attempt) => attempt.id))));
      })
      .catch((err) => {
        if (!cancelled) {
          setExercises([]);
          setScoringStatus({
            tone: "error",
            message: err instanceof ApiError ? err.message : "โหลดผลการฝึกไม่สำเร็จ"
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingReview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, review.sessionId, focusExerciseId]);

  const [selectedAttemptByExercise, setSelectedAttemptByExercise] = useState<Record<string, string>>({});

  const selectedExercise = exercises.find((exercise) => exercise.id === selectedExerciseId) ?? exercises[0];
  const selectedAttemptId = selectedExercise ? selectedAttemptByExercise[selectedExercise.id] : undefined;
  const selectedAttempt = selectedExercise?.attempts.find((attempt) => attempt.id === selectedAttemptId) ?? selectedExercise?.attempts[0];
  const selectedAttemptReviewed = selectedAttempt?.therapistReviewed ??
    (selectedAttempt?.ptScore != null || selectedAttempt?.ptFeedback != null);
  const focusedSession = Boolean(focusExerciseId);

  useEffect(() => {
    if (!selectedAttempt) return;
    setPtScoreDraft(selectedAttempt?.ptScore == null ? "" : String(selectedAttempt.ptScore));
    setPtFeedbackDraft(selectedAttempt?.ptFeedback ?? "");
    setScoringStatus(null);
  }, [selectedAttempt?.id]);

  const saveTherapistReview = async () => {
    if (!selectedAttempt || !selectedExercise || !token || !persistedAttemptIds.has(selectedAttempt.id)) {
      setScoringStatus({ tone: "error", message: "ไม่สามารถบันทึกผลการฝึกนี้ได้" });
      return;
    }
    const score = ptScoreDraft.trim() === "" ? null : Number(ptScoreDraft);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
      setScoringStatus({ tone: "error", message: "กรุณากรอกคะแนนประเมินตั้งแต่ 0 ถึง 100 หรือเว้นว่างไว้" });
      return;
    }

    setSavingReview(true);
    setScoringStatus({ tone: "saved", message: "กำลังบันทึกผลการตรวจสอบ…" });
    try {
      const response = await updateAttemptScoring(token, selectedAttempt.id, {
        ptScore: score,
        ptFeedback: ptFeedbackDraft.trim()
      });
      setExercises((current) =>
        current.map((exercise) => ({
          ...exercise,
          attempts: exercise.attempts.map((attempt) =>
            attempt.id === response.attempt.id
              ? {
                  ...attempt,
                  ptScore: response.attempt.ptScore ?? undefined,
                  ptFeedback: response.attempt.ptFeedback ?? undefined,
                  finalScore: response.attempt.finalScore ?? undefined,
                  evaluationSource: response.attempt.evaluationSource ?? undefined,
                  currentScore: response.attempt.currentScore,
                  currentScoreSource: response.attempt.currentScoreSource,
                  therapistReviewed: response.attempt.therapistReviewed
                }
              : attempt
          )
        }))
      );
      setScoringStatus({ tone: "saved", message: "บันทึกผลการตรวจสอบแล้ว" });
    } catch (err) {
      setScoringStatus({
        tone: "error",
        message: err instanceof ApiError ? err.message : "บันทึกผลการตรวจสอบไม่สำเร็จ กรุณาลองอีกครั้ง"
      });
    } finally {
      setSavingReview(false);
    }
  };

  const selectGradingScore = async (source: "ai" | "pt") => {
    if (!selectedAttempt || !token || !persistedAttemptIds.has(selectedAttempt.id)) return;
    if (source === "ai" && selectedAttempt.aiScore == null) return;
    if (source === "pt" && selectedAttempt.ptScore == null) return;

    setChangingScoreSource(true);
    setScoringStatus({ tone: "saved", message: "กำลังบันทึกคะแนนที่ใช้ประเมิน…" });
    try {
      const response = await updateAttemptScoring(token, selectedAttempt.id, { evaluationSource: source });
      setExercises((current) =>
        current.map((exercise) => ({
          ...exercise,
          attempts: exercise.attempts.map((attempt) =>
            attempt.id === response.attempt.id
              ? {
                  ...attempt,
                  finalScore: response.attempt.finalScore ?? undefined,
                  evaluationSource: response.attempt.evaluationSource ?? undefined,
                  currentScore: response.attempt.currentScore,
                  currentScoreSource: response.attempt.currentScoreSource
                }
              : attempt
          )
        }))
      );
      setScoringStatus({ tone: "saved", message: "บันทึกการเลือกคะแนนที่ใช้ประเมินแล้ว" });
    } catch (err) {
      setScoringStatus({
        tone: "error",
        message: err instanceof ApiError ? err.message : "อัปเดตคะแนนที่ใช้ประเมินไม่สำเร็จ กรุณาลองอีกครั้ง"
      });
    } finally {
      setChangingScoreSource(false);
    }
  };

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Sessions" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>ตรวจสอบผลการฝึก</h1>
            <p>{review.patientName} &middot; {sessionDetails.planName || reviewDayLabel(review.dayLabel)}</p>
          </div>
        </header>

        <main className="therapist-main srr-page-main">
          <button type="button" className="text-action pd-back-link" onClick={onBack}>
            <ArrowLeft size={14} /> กลับ
          </button>

          {loadingReview ? (
            <p className="srr-empty-note" role="status">กำลังโหลดผลการฝึก…</p>
          ) : exercises.length === 0 ? (
            <div className="summary-card" role={scoringStatus?.tone === "error" ? "alert" : undefined}>
              <p className="srr-empty-note">{scoringStatus?.message ?? "ไม่พบผลการฝึกที่ส่งมาสำหรับรอบนี้"}</p>
            </div>
          ) : (
            selectedExercise && (
              <>
                {!focusedSession && exercises.length > 1 && (
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

                {!focusedSession && selectedExercise.attempts.length > 1 && (
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
                        ครั้งที่ {attempt.attemptNumber}
                      </button>
                    ))}
                  </div>
                )}

                {selectedAttempt && (
                  <>
                    <div className="summary-card srr-session-details">
                      <div>
                        <strong>{review.patientName}</strong>
                      </div>
                      <span>
                        {selectedAttempt.completedAtIso
                          ? formatReviewDateTime(selectedAttempt.completedAtIso)
                          : sessionDetails.scheduledDateIso
                            ? formatReviewDate(sessionDetails.scheduledDateIso)
                            : review.dateLabel}
                        {sessionDetails.planName ? ` · ${sessionDetails.planName}` : ""}
                        {` · ${reviewDayLabel(review.dayLabel)}`}
                      </span>
                      <span className={`badge-pill ${selectedAttemptReviewed ? "good" : "fair"}`}>
                        {selectedAttemptReviewed ? "ตรวจสอบแล้ว" : "รอตรวจสอบ"}
                      </span>
                    </div>
                    <AttemptReview
                      attempt={selectedAttempt}
                      exercise={selectedExercise}
                      token={token}
                      ptScoreDraft={ptScoreDraft}
                      ptFeedbackDraft={ptFeedbackDraft}
                      onPtScoreChange={setPtScoreDraft}
                      onPtFeedbackChange={setPtFeedbackDraft}
                      onSave={saveTherapistReview}
                      saving={savingReview}
                      onSelectGradingScore={selectGradingScore}
                      changingScoreSource={changingScoreSource}
                    />
                  </>
                )}

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
  exercise,
  token,
  ptScoreDraft,
  ptFeedbackDraft,
  onPtScoreChange,
  onPtFeedbackChange,
  onSave,
  saving,
  onSelectGradingScore,
  changingScoreSource
}: {
  attempt: ExercisePerformanceAttempt;
  exercise: SessionExerciseReview;
  token?: string | null;
  ptScoreDraft: string;
  ptFeedbackDraft: string;
  onPtScoreChange: (value: string) => void;
  onPtFeedbackChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  onSelectGradingScore: (source: "ai" | "pt") => void;
  changingScoreSource: boolean;
}) {
  const therapistScoreIsActive =
    (attempt.evaluationSource === "pt" || attempt.evaluationSource === "manual") &&
    attempt.ptScore != null;
  const currentScore = attempt.currentScore ??
    (therapistScoreIsActive ? attempt.ptScore ?? attempt.finalScore : attempt.aiScore ?? attempt.finalScore);
  const currentSource = currentScore == null ? "ไม่มีคะแนน" : therapistScoreIsActive ? "นักกายภาพบำบัด" : "AI";
  const hasTherapistReview = attempt.therapistReviewed ?? (attempt.ptScore != null || attempt.ptFeedback != null);

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
      ? "วิดีโอการฝึกของผู้ป่วย"
      : videoError
        ? "โหลดวิดีโอการฝึกของผู้ป่วยไม่สำเร็จ"
        : "ยังไม่มีวิดีโอแนบ";

  return (
    <div className="srr-layout">
      <div className="srr-main-column">
        <div className="srr-video-col">
          <p className="pd-record-attachments-label">วิดีโอการฝึกของผู้ป่วย</p>
          {videoUrl ? (
            <PoseVideoPlayer
              src={videoUrl}
              className="srr-review-video"
              trackingType={exercise.movementTracking}
            />
          ) : (
            <div className="srr-video-placeholder">
              {videoError ? null : <Video size={26} />}
            </div>
          )}
          <p>{videoLabel}</p>
        </div>

        <section className="summary-card srr-exercise-info">
          <div className="srr-exercise-info-heading">
            <strong>{exercise.exerciseName}</strong>
            {exercise.exerciseVersionLabel && <span> · {exercise.exerciseVersionLabel}</span>}
          </div>
          <p className="srr-exercise-info-label">ข้อมูลท่าบริหาร</p>
          {exercise.description && <p>{exercise.description}</p>}
          <div className="srr-exercise-info-fields">
            {exercise.difficultyLevel && (
              <span>ระดับความยาก: <strong>{exerciseDifficultyLabel(exercise.difficultyLevel)}</strong></span>
            )}
            {exercise.movementTracking && (
              <span>การติดตามการเคลื่อนไหว: <strong>{movementTrackingLabel(exercise.movementTracking)}</strong></span>
            )}
            {exercise.targetValueLabel && (
              <span>เป้าหมาย: <strong>{exercise.targetValueLabel}</strong></span>
            )}
            {exercise.baseCriteria?.map((criterion) => (
              <span key={criterion.label}>{criterionLabel(criterion.label)}: <strong>{criterion.value}</strong></span>
            ))}
          </div>
          {exercise.therapistInstruction && (
            <p><strong>คำแนะนำ:</strong> {exercise.therapistInstruction}</p>
          )}
        </section>
      </div>

      <aside className="srr-sidebar">
        <section className="summary-card srr-current-score">
          <span>คะแนนปัจจุบัน</span>
          <strong>{currentScore ?? "—"}</strong>
          <span className={`pd-session-source ${therapistScoreIsActive ? "pt_reviewed" : "ai"}`}>
            {currentScore == null ? "ไม่มีคะแนน" : currentSource}
          </span>
        </section>

        <div className="srr-score-grid">
          <div className="srr-score-panel srr-ai-panel">
            <div className="srr-score-panel-top">
              <strong>คะแนนจาก AI</strong>
              <span className="srr-score-value">{attempt.aiScore ?? "—"}</span>
            </div>
            <p>{attempt.aiFeedback || "ไม่มีข้อเสนอแนะจาก AI สำหรับการฝึกครั้งนี้"}</p>
            {attempt.aiMetrics && attempt.aiMetrics.length > 0 && (
              <div className="srr-metrics-list">
                {attempt.aiMetrics.map((metric) => (
                  <span key={metric.label}>
                    {metric.label}: <strong>{metric.value}</strong>
                  </span>
                ))}
              </div>
            )}
            {attempt.aiEvaluatedAtLabel && <p className="small">AI ประเมินเมื่อ {attempt.aiEvaluatedAtLabel}</p>}
          </div>

          <div className="srr-score-panel srr-therapist-panel">
            <div className="srr-score-panel-top">
              <strong>ผลประเมินจากนักกายภาพบำบัด {hasTherapistReview ? "· ตรวจสอบแล้ว" : "· รอตรวจสอบ"}</strong>
              <input
                className="srr-score-input"
                value={ptScoreDraft}
                onChange={(event) => onPtScoreChange(event.target.value)}
                inputMode="numeric"
                min={0}
                max={100}
                type="number"
                placeholder="—"
                aria-label="คะแนนประเมินจากนักกายภาพบำบัดตั้งแต่ 0 ถึง 100"
                disabled={saving || changingScoreSource}
              />
            </div>
            <textarea
              value={ptFeedbackDraft}
              onChange={(event) => onPtFeedbackChange(event.target.value)}
              placeholder="เพิ่มข้อเสนอแนะจากนักกายภาพบำบัดสำหรับการฝึกครั้งนี้..."
              aria-label="ข้อเสนอแนะจากนักกายภาพบำบัด"
              disabled={saving || changingScoreSource}
            />
          </div>
        </div>

        <div className="srr-decision-bar">
          <strong>คะแนนที่ใช้ประเมิน</strong>
          <div
            className="srr-score-source-options"
            data-selected={therapistScoreIsActive ? "pt" : "ai"}
            role="radiogroup"
            aria-label="คะแนนที่ใช้ประเมิน"
          >
            <label>
              <input
                type="radio"
                name={`grading-score-${attempt.id}`}
                value="ai"
                checked={!therapistScoreIsActive}
                onChange={() => onSelectGradingScore("ai")}
                disabled={attempt.aiScore == null || saving || changingScoreSource}
              />
              <span>คะแนนจาก AI{attempt.aiScore != null ? ` (${attempt.aiScore})` : ""}</span>
            </label>
            <label>
              <input
                type="radio"
                name={`grading-score-${attempt.id}`}
                value="pt"
                checked={therapistScoreIsActive}
                onChange={() => onSelectGradingScore("pt")}
                disabled={attempt.ptScore == null || saving || changingScoreSource}
              />
              <span>คะแนนจากนักกายภาพบำบัด{attempt.ptScore != null ? ` (${attempt.ptScore})` : ""}</span>
            </label>
          </div>
        </div>
        <button type="button" className="primary-button srr-save-review" onClick={onSave} disabled={saving || changingScoreSource}>
          <Save size={14} /> {saving ? "กำลังบันทึก…" : hasTherapistReview ? "อัปเดตผลประเมิน" : "ส่งผลประเมิน"}
        </button>
      </aside>
    </div>
  );
}
