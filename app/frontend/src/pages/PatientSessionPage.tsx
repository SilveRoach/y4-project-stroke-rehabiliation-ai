import { Dumbbell, Hand, LogOut, RotateCcw, Signal, SignalZero, Square, TimerReset, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCamera } from "../hooks/useCamera";
import { useSessionRecording } from "../hooks/useSessionRecording";
import type { RecordingResult } from "../hooks/useSessionRecording";
import type { PatientExercise, TrackingType } from "../types";

interface PatientSessionPageProps {
  exercise: PatientExercise;
  paused: boolean;
  lowConfidence: boolean;
  onBack: () => void;
  onRestart: () => void;
  onToggleConfidence: () => void;
  onTogglePause: () => void;
  // §6.3/§6.4 — called once STOP ends a recording with a result to review;
  // App.tsx routes to pages/SessionUploadConfirmPage.tsx from here instead of
  // going straight back to Today.
  onFinishRecording: (result: RecordingResult) => void;
}

const trackingCopy = {
  good: "Good · ดี",
  fair: "Fair · พอใช้",
  poor: "Poor · แย่"
} as const;

// Parses PatientExercise.progressLabel's "X of Y" shape (data/patientMock.ts) into
// its two numbers. Backs both the progress ring/percent and §2.5's local demo-motion
// counter below — {total: 0} means the label didn't match, so the demo timer stays off.
function parseProgress(progressLabel: string) {
  const match = progressLabel.match(/(\d+)\s*of\s*(\d+)/i);
  if (!match) {
    return { done: 0, total: 0 };
  }
  return { done: Number(match[1]), total: Number(match[2]) };
}

// CAMERA_TRACKING_MOCKUP_PLAN.md §2.6 — same icon used for this trackingType
// everywhere else an exercise is referenced (pages/ProgramEditorPage.tsx's
// trackingIcon), widened here to also cover PatientExercise's "both" case (that
// map only has pose/virtual_grip/none) by showing both icons together.
function trackingIconsFor(trackingType: TrackingType) {
  if (trackingType === "pose") return [Dumbbell];
  if (trackingType === "virtual_grip") return [Hand];
  return [Dumbbell, Hand];
}

// §2.5 — 2-3 canned encouragement lines the feedback panel cycles through once a
// demo session is running, so the screen visibly changes during a demo instead of
// sitting static for the whole "session". Not real feedback on the patient's actual
// movement (ai/scoring.ts is still a stub) — just demo fidelity.
function demoFeedbackMessages(exercise: PatientExercise) {
  return [
    exercise.feedback,
    "Nice control, keep the movement steady. \u00b7 \u0e04\u0e27\u0e1a\u0e04\u0e38\u0e21\u0e44\u0e14\u0e49\u0e14\u0e35 \u0e17\u0e33\u0e15\u0e48\u0e2d\u0e44\u0e1b",
    "Good pace, stay in frame. \u00b7 \u0e08\u0e31\u0e07\u0e2b\u0e27\u0e30\u0e14\u0e35\u0e21\u0e32\u0e01 \u0e2d\u0e22\u0e39\u0e48\u0e43\u0e19\u0e01\u0e23\u0e2d\u0e1a\u0e15\u0e48\u0e2d\u0e44\u0e1b"
  ];
}

export function PatientSessionPage({
  exercise,
  paused,
  lowConfidence,
  onBack,
  onRestart,
  onToggleConfidence,
  onTogglePause,
  onFinishRecording
}: PatientSessionPageProps) {
  const trackingStatus = lowConfidence ? "poor" : paused ? "fair" : "good";
  const camera = useCamera(true);
  const recording = useSessionRecording(camera.stream);
  const { done: initialDone, total } = parseProgress(exercise.progressLabel);

  // §2.1 — a brief "get positioned in frame" state before the tracking HUD/controls
  // appear, instead of jumping straight from a live camera feed into the full
  // session UI. Pure client-side UI state; resets whenever a different exercise's
  // session is opened (App.tsx swaps `exercise`, not this page).
  const [sessionStarted, setSessionStarted] = useState(false);
  // §2.5 — local, session-only "live" demo motion: ticks once sessionStarted and
  // not paused, purely for demo fidelity (never a stand-in for ai/scoring.ts).
  const [demoDone, setDemoDone] = useState(initialDone);
  const [demoScore, setDemoScore] = useState(exercise.score ?? 86);
  const [feedbackIndex, setFeedbackIndex] = useState(0);

  useEffect(() => {
    setSessionStarted(false);
    const parsed = parseProgress(exercise.progressLabel);
    setDemoDone(parsed.done);
    setDemoScore(exercise.score ?? 86);
    setFeedbackIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    if (!sessionStarted || paused || total === 0 || demoDone >= total) {
      return;
    }
    const interval = setInterval(() => {
      setDemoDone((current) => Math.min(current + 1, total));
      setDemoScore((current) => {
        const delta = Math.round((Math.random() - 0.4) * 6);
        return Math.max(60, Math.min(99, current + delta));
      });
      setFeedbackIndex((current) => (current + 1) % demoFeedbackMessages(exercise).length);
    }, 3500);
    return () => clearInterval(interval);
  }, [sessionStarted, paused, total, demoDone, exercise]);

  const progressLabel = total > 0 ? `${demoDone} of ${total}` : exercise.progressLabel;
  const progressPercent = total > 0 ? Math.round((demoDone / total) * 100) : 0;
  const score = demoScore;
  const trackingIcons = trackingIconsFor(exercise.trackingType);
  const feedbackText = demoFeedbackMessages(exercise)[feedbackIndex] ?? exercise.feedback;

  // §6.3/§6.4 — recording.stop() resolves asynchronously (MediaRecorder's onstop
  // fires after any final ondataavailable), so STOP can't hand a result to
  // onFinishRecording synchronously. This ref marks "a STOP is in flight";
  // the effect below fires onFinishRecording exactly once the resulting blob
  // actually lands, not on every recording.result change (a later Restart also
  // clears result via reset(), which must NOT re-trigger this).
  const awaitingFinishRef = useRef(false);

  useEffect(() => {
    if (awaitingFinishRef.current && recording.result) {
      awaitingFinishRef.current = false;
      onFinishRecording(recording.result);
    }
  }, [recording.result, onFinishRecording]);

  const handleStart = () => {
    setSessionStarted(true);
    recording.start();
  };

  // §6.4 — STOP now ends the recording and hands off to
  // SessionUploadConfirmPage.tsx instead of calling onBack directly; leaving the
  // session only happens after Confirm/Retry/Discard resolve there. If recording
  // never actually started (unsupported browser, or the camera never streamed),
  // there's nothing to review, so fall back to the old "just leave" behavior.
  const handleStop = () => {
    if (recording.status === "recording" || recording.status === "paused") {
      awaitingFinishRef.current = true;
      recording.stop();
    } else {
      onBack();
    }
  };

  // §6.4 — Exit (topbar) abandons the whole session, not just this attempt.
  // Mid-recording, that would silently throw away an unconfirmed take, so this
  // prompts first — same simplification pd-* modals elsewhere in this app avoid,
  // but no confirm-dialog primitive exists yet in components/, and this is a
  // rare/destructive action rather than a frequent flow worth building one for.
  const handleExit = () => {
    if (recording.status === "recording" || recording.status === "paused") {
      const shouldDiscard = window.confirm(
        "Discard this attempt? Your recording hasn't been saved yet. · ยกเลิกครั้งนี้? การบันทึกยังไม่ถูกบันทึก"
      );
      if (!shouldDiscard) return;
      recording.reset();
    }
    onBack();
  };

  const handleRestart = () => {
    setDemoDone(initialDone);
    setDemoScore(exercise.score ?? 86);
    setFeedbackIndex(0);
    // §6.4 — Restart discards the current recording and begins a fresh one (same
    // semantics as Retry on the confirm screen, just reachable mid-recording).
    recording.reset();
    if (sessionStarted) {
      recording.start();
    }
    onRestart();
  };

  return (
    <section className="session-shell">
      <div className="session-desktop-layout">
        <div className="camera-stage">
          <video
            ref={camera.videoRef}
            className="camera-feed"
            autoPlay
            playsInline
            muted
            style={{ display: camera.status === "streaming" ? "block" : "none" }}
          />

          {camera.status === "requesting" && (
            <div className="camera-state-overlay">
              <Video size={28} />
              <p>Turning on your camera… · กำลังเปิดกล้อง</p>
            </div>
          )}

          {(camera.status === "denied" ||
            camera.status === "not-found" ||
            camera.status === "insecure-context" ||
            camera.status === "unsupported" ||
            camera.status === "error") && (
            <div className="camera-state-overlay">
              <VideoOff size={28} />
              <p>{camera.errorMessage}</p>
              {(camera.status === "denied" || camera.status === "error" || camera.status === "not-found") && (
                <button type="button" className="secondary-button" onClick={camera.retry}>
                  Try again · ลองอีกครั้ง
                </button>
              )}
            </div>
          )}

          <header className="session-topbar">
            <div>
              <strong className="session-topbar-title">
                {trackingIcons.map((Icon, index) => (
                  <Icon key={index} size={14} />
                ))}
                {exercise.name}
              </strong>
              <span>{exercise.nameTh ? `${exercise.nameTh} · ` : ""}{progressLabel}</span>
            </div>
            <button className="session-icon-button" onClick={handleExit} aria-label="Exit session">
              <LogOut size={18} />
            </button>
          </header>

          {/* §2.1 — shown once the camera is live but before the patient presses Start:
              a framing guide + prompt instead of jumping straight into the full
              tracking HUD/controls below. Pressing Start reveals that HUD exactly as
              it rendered before this plan. */}
          {camera.status === "streaming" && !sessionStarted && (
            <div className="session-preroll">
              <FramingGuide />
              <p>Position yourself in frame · ยืนให้อยู่ในกรอบกล้อง</p>
              <button type="button" className="primary-button" onClick={handleStart}>
                Start · เริ่ม
              </button>
            </div>
          )}

          {sessionStarted && (
            <>
              <div className={`tracking-status ${trackingStatus}`}>
                <span />
                Tracking: {trackingCopy[trackingStatus]}
              </div>

              <div className="session-progress-badge" aria-hidden="true">
                <SessionProgressRing value={progressPercent} label={`${progressPercent}%`} />
              </div>

              <div className="reference-panel">
                <span className="reference-thumb">
                  {(exercise.trackingType === "pose" || exercise.trackingType === "both") && (
                    <PoseOverlay className="reference-thumb-svg" />
                  )}
                  {(exercise.trackingType === "virtual_grip" || exercise.trackingType === "both") && (
                    <HandOverlay className="reference-thumb-svg" />
                  )}
                </span>
                <span>Reference · ท่าอ้างอิง</span>
              </div>

              {/* §2.2 — illustrative reference guides, not real landmark tracking
                  (ai/poseDetection.ts / ai/handDetection.ts are still // TODO stubs).
                  Mirrored (scaleX(-1) in styles.css) to match .camera-feed's own selfie
                  flip, and captioned so this doesn't read as a claim that the app is
                  tracking the patient's real joints. */}
              {(exercise.trackingType === "pose" || exercise.trackingType === "both") && <PoseOverlay />}
              {(exercise.trackingType === "virtual_grip" || exercise.trackingType === "both") && <HandOverlay />}
              <div className="overlay-caption">Reference pose · ท่าอ้างอิง</div>

              {paused && <div className="session-state">Paused · หยุดชั่วคราว</div>}

              <div className="session-demo-toggle">
                <button type="button" className={lowConfidence ? "active" : ""} onClick={onToggleConfidence}>
                  {lowConfidence ? <SignalZero size={14} /> : <Signal size={14} />}
                  {lowConfidence ? "Clear prompt · ล้างคำเตือน" : "Simulate low confidence · จำลองสัญญาณอ่อน"}
                </button>
              </div>

              <div className="session-bottom-stack">
                <div className={`feedback-panel ${lowConfidence ? "warning" : ""}`}>
                  <p>
                    {lowConfidence
                      ? "Move a little farther back so your arm stays in frame. · ถอยออกมาอีกนิดให้แขนอยู่ในกรอบ"
                      : feedbackText}
                  </p>
                  <div className="metric-row">
                    <span>
                      <strong>{score}</strong>
                      Score · คะแนน
                    </span>
                    <span>
                      <strong>{progressLabel}</strong>
                      Progress · ความคืบหน้า
                    </span>
                  </div>
                </div>

                <div className="session-controls">
                  <button
                    type="button"
                    className="session-control-btn"
                    onClick={() => {
                      if (paused) {
                        recording.resume();
                      } else {
                        recording.pause();
                      }
                      onTogglePause();
                    }}
                    aria-label={paused ? "Resume · เล่นต่อ" : "Pause · หยุดชั่วคราว"}
                  >
                    {paused ? <TimerReset size={20} /> : <Square size={20} />}
                  </button>
                  <button
                    type="button"
                    className="session-control-btn stop"
                    onClick={handleStop}
                    aria-label="Finish session · จบเซสชัน"
                  >
                    <span>STOP</span>
                  </button>
                  <button
                    type="button"
                    className="session-control-btn"
                    onClick={handleRestart}
                    aria-label="Restart · เริ่มใหม่"
                  >
                    <RotateCcw size={20} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <aside className="session-side-panel">
          <div>
            <p className="eyebrow">Training session · เซสชันฝึก</p>
            <h1 className="side-name-row">
              {exercise.name}
              <span className="side-tracking-icons">
                {trackingIcons.map((Icon, index) => (
                  <Icon key={index} size={16} />
                ))}
              </span>
            </h1>
            {exercise.nameTh && <p className="side-name-th">{exercise.nameTh}</p>}
            <p>{exercise.feedback}</p>
          </div>
          <div className="desktop-metrics">
            <span>
              <strong>{score}</strong>
              Current score · คะแนนปัจจุบัน
            </span>
            <span>
              <strong>{progressLabel}</strong>
              Target progress · เป้าหมาย
            </span>
          </div>
          <button className="primary-button full-width" onClick={handleStop}>
            Finish session · จบเซสชัน
          </button>
        </aside>
      </div>
    </section>
  );
}

function SessionProgressRing({ value, label }: { value: number; label: string }) {
  const size = 52;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;

  return (
    <span className="session-progress-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.18)" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--teal)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <strong>{label}</strong>
    </span>
  );
}

// §2.1 — dashed person-silhouette outline shown during the pre-session preroll,
// reusing the same overlay SVG viewBox/color language as PoseOverlay/HandOverlay
// below rather than a new visual style.
function FramingGuide() {
  return (
    <svg className="framing-guide" viewBox="0 0 260 360" aria-hidden="true">
      <circle cx="130" cy="70" r="34" />
      <path d="M74 190 Q70 130 130 122 Q190 130 186 190 L196 300 Q196 320 176 320 L146 320 L146 230 L114 230 L114 320 L84 320 Q64 320 64 300 Z" />
    </svg>
  );
}

// className defaults to the full-frame overlay treatment (§2.2); the reference
// panel (§2.4) passes "reference-thumb-svg" to reuse the same geometry at a small,
// statically-positioned size instead of duplicating the paths.
function PoseOverlay({ className = "skeleton-overlay" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 260 360" aria-hidden="true">
      <circle cx="130" cy="78" r="22" />
      <line x1="130" y1="100" x2="130" y2="190" />
      <line x1="130" y1="122" x2="78" y2="132" />
      <line x1="78" y1="132" x2="58" y2="192" />
      <line x1="58" y1="192" x2="66" y2="242" />
      <line x1="130" y1="122" x2="184" y2="130" />
      <line x1="184" y1="130" x2="210" y2="82" />
      <line x1="210" y1="82" x2="206" y2="50" />
      {[130, 78, 58, 66, 184, 210, 206].map((x, index) => (
        <circle
          className="joint"
          cx={x}
          cy={[122, 132, 192, 242, 130, 82, 50][index]}
          key={`${x}-${index}`}
          r="5"
        />
      ))}
    </svg>
  );
}

function HandOverlay({ className = "hand-overlay" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 260 360" aria-hidden="true">
      <rect className="virtual-object" x="64" y="226" width="42" height="42" rx="8" />
      <circle cx="145" cy="214" r="15" />
      <line x1="145" y1="214" x2="122" y2="165" />
      <line x1="145" y1="214" x2="146" y2="160" />
      <line x1="145" y1="214" x2="170" y2="166" />
      <line x1="145" y1="214" x2="188" y2="178" />
      <line x1="145" y1="214" x2="108" y2="184" />
      {[122, 146, 170, 188, 108].map((x, index) => (
        <circle
          className="joint"
          cx={x}
          cy={[165, 160, 166, 178, 184][index]}
          key={`${x}-${index}`}
          r="5"
        />
      ))}
    </svg>
  );
}
