// Post-session Confirm screen (CAMERA_TRACKING_MOCKUP_PLAN.md §6.3). Shown after
// PatientSessionPage's STOP control ends a recording, before returning to Today —
// the patient must explicitly act here; nothing uploads automatically. Reuses
// SessionResultReviewPage.tsx's .srr-video-col/.srr-score-panel visual language
// (this screen is patient-only, so there's no PT panel here — just the AI half of
// that page's two-panel layout).
//
// REAL submission now: "Confirm & upload" POSTs the recording blob + the AI
// score/feedback to /scheduled-exercises/:id/results (backend session-results
// module), which stores the video via the files module, creates the
// exercise_performance_results row, and marks the exercise/day completed —
// then App.tsx's onConfirm updates the local Today/Progress state to match.

import { AlertCircle, Loader2, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import { useState } from "react";
import { PoseVideoPlayer } from "../components/PoseVideoPlayer";
import { submitExerciseResult } from "../services/api";
import { useAuth } from "../store/authStore";
import type { PendingSessionAttempt } from "../types";

interface SessionUploadConfirmPageProps {
  attempt: PendingSessionAttempt;
  // attempt_number is only assigned once Confirm is pressed (§6.1) — this is a
  // preview of what it *would* be, not an already-consumed number (a Retry here
  // doesn't consume one). The server computes the authoritative number.
  attemptNumber: number;
  onConfirm: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}

export function SessionUploadConfirmPage({ attempt, attemptNumber, onConfirm, onRetry, onDiscard }: SessionUploadConfirmPageProps) {
  const { token } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const roundScores = attempt.repScores ?? [];
  const averageScore = roundScores.length > 0
    ? Math.round(roundScores.reduce((sum, score) => sum + score, 0) / roundScores.length)
    : attempt.aiScore;
  const scoreRange = roundScores.length > 0
    ? `${Math.min(...roundScores)} - ${Math.max(...roundScores)}`
    : "—";

  const handleConfirm = async () => {
    if (!token) {
      setUploadError("กรุณาเข้าสู่ระบบอีกครั้งเพื่อส่งวิดีโอนี้");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      await submitExerciseResult(token, attempt.scheduledExerciseId, attempt.videoBlob, attempt.videoFileName, attempt.videoMimeType, {
        aiScore: attempt.aiScore,
        aiFeedback: attempt.aiFeedback,
        aiMetrics: Object.fromEntries(attempt.aiMetrics.map((metric) => [metric.label, metric.value])),
        videoIncludesOverlay: true,
        ...(attempt.repsCompleted !== undefined
          ? {
              performanceData: {
                repsCompleted: attempt.repsCompleted,
                targetReps: attempt.targetReps ?? null,
                repScores: attempt.repScores ?? []
              }
            }
          : {})
      });
      setUploaded(true);
      window.setTimeout(onConfirm, 500);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "อัปโหลดวิดีโอไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="sud-shell">
      <div className="sud-card">
        <header className="sud-header">
          <p className="eyebrow">ตรวจสอบผลการฝึกครั้งนี้</p>
          <h1>{attempt.exerciseName}</h1>
          {attempt.exerciseNameTh && <p className="side-name-th">{attempt.exerciseNameTh}</p>}
        </header>

        <div className="srr-layout">
          <div className="srr-video-col">
            <p className="pd-record-attachments-label">วิดีโอของคุณ · ครั้งที่ {attemptNumber} (เมื่อยืนยัน)</p>
              <PoseVideoPlayer
                src={attempt.videoBlobUrl}
                trackingType={attempt.trackingType}
                overlayAlreadyIncluded
              />
          </div>

          <div>
            <div className="srr-score-panel">
              <div className="srr-score-panel-top">
                <strong>คะแนนเฉลี่ย</strong>
                <span className="srr-score-value">{averageScore}/100</span>
              </div>
              <div className="srr-metrics-list">
                <span>ช่วงคะแนน: <strong>{scoreRange}</strong></span>
                <span>จำนวนรอบที่ทำ: <strong>{attempt.repsCompleted ?? 0}</strong></span>
              </div>
            </div>
          </div>
        </div>

        {uploadError && (
          <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", marginBottom: 12 }}>
            <p style={{ margin: 0, color: "var(--danger, #d33)", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertCircle size={16} /> {uploadError}
            </p>
          </div>
        )}

        <div className="sud-actions">
          {uploaded ? (
            <p className="ps-saved-note">อัปโหลดแล้ว</p>
          ) : uploading ? (
            <button type="button" className="primary-button full-width" disabled>
              <Loader2 size={16} className="filepicker-spin" /> กำลังอัปโหลด…
            </button>
          ) : (
            <>
              <button type="button" className="primary-button full-width" onClick={handleConfirm}>
                <UploadCloud size={16} /> ยืนยันและอัปโหลด
              </button>
              <div className="sud-secondary-actions">
                <button type="button" className="secondary-button" onClick={onRetry}>
                  <RotateCcw size={14} /> ลองใหม่
                </button>
                <button type="button" className="text-action sud-discard" onClick={onDiscard}>
                  <Trash2 size={14} /> ยกเลิก
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
