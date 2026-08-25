// Post-session Confirm screen (CAMERA_TRACKING_MOCKUP_PLAN.md §6.3). Shown after
// PatientSessionPage's STOP control ends a recording, before returning to Today —
// the patient must explicitly act here; nothing uploads automatically. Reuses
// SessionResultReviewPage.tsx's .srr-video-col/.srr-score-panel visual language
// (this screen is patient-only, so there's no PT panel here — just the AI half of
// that page's two-panel layout).
//
// Real, client-side only: no files/exercise_performance_results upload endpoint
// exists yet (§6.7), so "Confirm & upload" is a simulated delay, kept in
// App.tsx's local state — same "real UI, mock persistence" pattern as every other
// still-mock write flow in this app (Add Record, Create Plan, etc.).

import { Loader2, RotateCcw, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { useState } from "react";
import type { PendingSessionAttempt } from "../types";

interface SessionUploadConfirmPageProps {
  attempt: PendingSessionAttempt;
  // attempt_number is only assigned once Confirm is pressed (§6.1) — this is a
  // preview of what it *would* be, not an already-consumed number (a Retry here
  // doesn't consume one).
  attemptNumber: number;
  onConfirm: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}

export function SessionUploadConfirmPage({ attempt, attemptNumber, onConfirm, onRetry, onDiscard }: SessionUploadConfirmPageProps) {
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  const handleConfirm = () => {
    setUploading(true);
    // Simulated delay — reuses the same "spinner then success" shape as
    // components/FilePicker.tsx's upload-progress pattern rather than a new one.
    window.setTimeout(() => {
      setUploading(false);
      setUploaded(true);
      window.setTimeout(onConfirm, 500);
    }, 1100);
  };

  return (
    <section className="sud-shell">
      <div className="sud-card">
        <header className="sud-header">
          <p className="eyebrow">Review attempt &middot; ตรวจสอบครั้งนี้</p>
          <h1>{attempt.exerciseName}</h1>
          {attempt.exerciseNameTh && <p className="side-name-th">{attempt.exerciseNameTh}</p>}
        </header>

        <div className="srr-layout">
          <div className="srr-video-col">
            <p className="pd-record-attachments-label">Your recording &middot; attempt {attemptNumber} if confirmed</p>
            <video className="sud-video" src={attempt.videoBlobUrl} controls playsInline />
            <p>
              {attempt.videoFileName} &middot; {attempt.videoSizeLabel}
            </p>
          </div>

          <div>
            <div className="srr-score-panel">
              <div className="srr-score-panel-top">
                <strong className="sud-ai-title">
                  <Sparkles size={14} /> AI prediction
                </strong>
                <span className="srr-score-value">{attempt.aiScore}</span>
              </div>
              <p>{attempt.aiFeedback}</p>
              {attempt.aiMetrics.length > 0 && (
                <div className="srr-metrics-list">
                  {attempt.aiMetrics.map((metric) => (
                    <span key={metric.label}>
                      {metric.label}: <strong>{metric.value}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <p className="pd-modal-hint sud-hint">
              This score is a mock preview &mdash; real AI evaluation isn&apos;t wired up yet. Your therapist can still
              review this recording and add their own score later.
            </p>
          </div>
        </div>

        <div className="sud-actions">
          {uploaded ? (
            <p className="ps-saved-note">Saved &middot; บันทึกแล้ว</p>
          ) : uploading ? (
            <button type="button" className="primary-button full-width" disabled>
              <Loader2 size={16} className="filepicker-spin" /> Uploading&hellip; &middot; กำลังอัปโหลด
            </button>
          ) : (
            <>
              <button type="button" className="primary-button full-width" onClick={handleConfirm}>
                <UploadCloud size={16} /> Confirm &amp; upload &middot; ยืนยันและอัปโหลด
              </button>
              <div className="sud-secondary-actions">
                <button type="button" className="secondary-button" onClick={onRetry}>
                  <RotateCcw size={14} /> Retry &middot; ลองใหม่
                </button>
                <button type="button" className="text-action sud-discard" onClick={onDiscard}>
                  <Trash2 size={14} /> Discard &middot; ยกเลิก
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
