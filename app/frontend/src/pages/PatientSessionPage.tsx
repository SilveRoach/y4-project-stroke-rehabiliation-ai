import { ArrowUp, Check, Dumbbell, Hand, LogOut, Play, RotateCcw, Signal, SignalZero, Square, TimerReset, Video, VideoOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCamera } from "../hooks/useCamera";
import { useSessionRecording } from "../hooks/useSessionRecording";
import type { RecordingResult } from "../hooks/useSessionRecording";
import { HandTracker, drawHandSkeleton, type Landmark } from "../ai/handDetection";
import { PoseTracker, drawSkeleton, type PoseLandmark } from "../ai/poseDetection";
import { useAuth } from "../store/authStore";
import { getPatientScheduledExerciseDemoVideo } from "../services/api";
import type { PatientExercise, TrackingType } from "../types";

interface PatientSessionPageProps {
  exercise: PatientExercise;
  paused: boolean;
  lowConfidence: boolean;
  onBack: () => void;
  onRestart: () => void;
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

// REAL TRACKING — detect() is throttled to ~15fps (rather than every rAF tick)
// because tasks-vision's detectForVideo runs WASM synchronously on the main
// thread (pose is heavier than hand; the lite pose model keeps this fine at
// 15fps); the skeleton redraws every frame from the cached landmarks.
const HAND_DETECT_INTERVAL_MS = 66;

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

// The exercise's actual demo video (exercise_library.demo_video_file_id, fetched
// through the auth'd GET /scheduled-exercises/:id/demo-video endpoint — the same
// source the instruction page plays). Auto-plays muted + loops so the reference
// movement is visible while the patient records. Returns null while loading or
// when the exercise has no video / the fetch fails; callers fall back to the
// static ReferenceThumb.
function useDemoVideoUrl(scheduledExerciseId: string): string | null {
  const { token } = useAuth();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    getPatientScheduledExerciseDemoVideo(token, scheduledExerciseId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      })
      .catch(() => {
        // No demo video on this exercise (404) or fetch failed — the static
        // reference thumb fallback renders instead.
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, scheduledExerciseId]);

  return url;
}

// The demo/reference illustration (actual demo video when the exercise has one,
// otherwise the static pose/hand SVG on the gradient tile). Rendered inside the
// floating camera reference panel on phone/tablet AND inside the desktop
// sidebar's "Exercise demo" section — a single shared definition so the two
// placements can never drift (only one is visible at a time via CSS).
function ReferenceThumb({ trackingType }: { trackingType: TrackingType }) {
  return (
    <span className="reference-thumb">
      {(trackingType === "pose" || trackingType === "both") && (
        <PoseOverlay className="reference-thumb-svg" />
      )}
      {(trackingType === "virtual_grip" || trackingType === "both") && (
        <HandOverlay className="reference-thumb-svg" />
      )}
    </span>
  );
}

// Wrapper that swaps the static reference thumb for the actual demo video once
// it resolves — used by both the floating reference panel and the desktop
// sidebar's "Exercise demo" section.
function ExerciseDemoMedia({ exercise }: { exercise: PatientExercise }) {
  const demoUrl = useDemoVideoUrl(exercise.id);
  if (demoUrl) {
    return (
      <video
        className="session-demo-video"
        src={demoUrl}
        controls
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }
  return <ReferenceThumb trackingType={exercise.trackingType} />;
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
  onTogglePause,
  onFinishRecording
}: PatientSessionPageProps) {
  const trackingStatus = lowConfidence ? "poor" : paused ? "fair" : "good";
  const camera = useCamera(true);
  const recording = useSessionRecording(camera.stream);
  const { done: initialDone, total } = parseProgress(exercise.progressLabel);

  // REAL TRACKING — replaces the static SVG overlay mockups with live MediaPipe
  // inference drawn onto a canvas over the camera feed:
  //   virtual_grip/both → HandLandmarker (blue hand skeleton, ai/handDetection.ts)
  //   pose/both         → PoseLandmarker (green upper-body skeleton with yellow
  //                       joints, ai/poseDetection.ts, reference
  //                       skeletonRenderer.ts style)
  // Both trackers load their models during the pre-roll (as soon as the camera
  // is streaming), so the overlay is ready by the time Start is pressed.
  const handTrackingEnabled =
    exercise.trackingType === "virtual_grip" || exercise.trackingType === "both";
  const poseTrackingEnabled =
    exercise.trackingType === "pose" || exercise.trackingType === "both";
  const skeletonCanvasRef = useRef<HTMLCanvasElement>(null);
  const handTrackerRef = useRef<HandTracker | null>(null);
  const poseTrackerRef = useRef<PoseTracker | null>(null);
  const runningRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const lastDetectMsRef = useRef(0);
  const lastHandLandmarksRef = useRef<Landmark[] | null>(null);
  const lastPoseLandmarksRef = useRef<PoseLandmark[] | null>(null);
  const [handDetected, setHandDetected] = useState(false);
  const [poseDetected, setPoseDetected] = useState(false);

  useEffect(() => {
    if ((!handTrackingEnabled && !poseTrackingEnabled) || camera.status !== "streaming") return;
    const handTracker = handTrackingEnabled
      ? handTrackerRef.current ?? new HandTracker()
      : null;
    if (handTracker) handTrackerRef.current = handTracker;
    const poseTracker = poseTrackingEnabled
      ? poseTrackerRef.current ?? new PoseTracker()
      : null;
    if (poseTracker) poseTrackerRef.current = poseTracker;
    runningRef.current = true;
    let cancelled = false;

    const loop = () => {
      if (!runningRef.current) return;
      const video = camera.videoRef.current;
      const canvas = skeletonCanvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        // Match the video's intrinsic resolution so the canvas's own
        // object-fit: cover crops identically to .camera-feed's cover crop.
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext("2d");
        const now = performance.now();
        if (ctx && now - lastDetectMsRef.current >= HAND_DETECT_INTERVAL_MS) {
          lastDetectMsRef.current = now;
          if (handTracker) {
            lastHandLandmarksRef.current = handTracker.detect(video, now);
            setHandDetected(lastHandLandmarksRef.current !== null);
          }
          if (poseTracker) {
            lastPoseLandmarksRef.current = poseTracker.detect(video, now);
            setPoseDetected(lastPoseLandmarksRef.current !== null);
          }
        }
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // mirror=true flips x in the drawing itself to match .camera-feed's
          // CSS scaleX(-1) selfie flip (the canvas gets no CSS transform of
          // its own). "both" draws the body skeleton + hand skeleton together.
          if (lastPoseLandmarksRef.current) {
            drawSkeleton(ctx, lastPoseLandmarksRef.current, canvas.width, canvas.height);
          }
          if (lastHandLandmarksRef.current) {
            drawHandSkeleton(ctx, lastHandLandmarksRef.current, canvas.width, canvas.height);
          }
        }
      }
      rafIdRef.current = requestAnimationFrame(loop);
    };

    // Model + WASM load from CDN on first use; the rAF loop only starts once
    // every enabled tracker is ready (GPU delegate with CPU fallback inside
    // each init()).
    const inits: Array<Promise<void>> = [];
    if (handTracker) inits.push(handTracker.init());
    if (poseTracker) inits.push(poseTracker.init());
    Promise.all(inits)
      .then(() => {
        if (!cancelled && runningRef.current) {
          rafIdRef.current = requestAnimationFrame(loop);
        }
      })
      .catch(() => {
        // Model load failed (e.g. offline) — the session itself (recording,
        // upload flow) still works, just without the live skeleton overlay.
      });

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      lastHandLandmarksRef.current = null;
      lastPoseLandmarksRef.current = null;
      setHandDetected(false);
      setPoseDetected(false);
      handTracker?.dispose();
      poseTracker?.dispose();
      handTrackerRef.current = null;
      poseTrackerRef.current = null;
    };
  }, [handTrackingEnabled, poseTrackingEnabled, camera.status, camera.videoRef]);

  // §2.1 — a brief "get positioned in frame" state before the tracking HUD/controls
  // appear, instead of jumping straight from a live camera feed into the full
  // session UI. Pure client-side UI state; resets whenever a different exercise's
  // session is opened (App.tsx swaps `exercise`, not this page).
  const [sessionStarted, setSessionStarted] = useState(false);
  // §10 (responsive redesign) — the demo/reference thumbnail collapses into a
  // small floating "Demo" button on camera-centric layouts; tapping it expands
  // the existing reference panel. Purely display state.
  const [referenceOpen, setReferenceOpen] = useState(false);
  // §2.5 — local, session-only "live" demo motion: ticks once sessionStarted and
  // not paused, purely for demo fidelity (never a stand-in for ai/scoring.ts).
  const [demoDone, setDemoDone] = useState(initialDone);
  const [demoScore, setDemoScore] = useState(exercise.score ?? 86);
  const [feedbackIndex, setFeedbackIndex] = useState(0);

  useEffect(() => {
    setSessionStarted(false);
    setReferenceOpen(false);
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
  // prompts first — now with a real in-app dialog (the same .pd-modal
  // .pd-confirm-modal idiom PatientDetailPage uses) instead of the browser's
  // native window.confirm(), which can't be styled and looks alien inside the
  // dark immersive session screen. When nothing is recording there's nothing
  // to discard, so Exit just navigates back immediately.
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  const handleExit = () => {
    if (recording.status === "recording" || recording.status === "paused") {
      setExitConfirmOpen(true);
      return;
    }
    onBack();
  };

  const confirmExit = () => {
    setExitConfirmOpen(false);
    recording.reset();
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
            <div className="session-topbar-info">
              <strong className="session-topbar-title">
                <span className="session-topbar-icons" aria-hidden="true">
                  {trackingIcons.map((Icon, index) => (
                    <Icon key={index} size={14} />
                  ))}
                </span>
                {/* min-width:0 + ellipsis (CSS) so a long exercise name can never
                    push the Exit button off-screen on narrow phones. */}
                <span className="session-topbar-name">{exercise.name}</span>
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
              <p>Position yourself in frame · ยืนให้อยู่ในกรอบกล้อง</p>
              <FramingGuide />
              <button type="button" className="primary-button" onClick={handleStart}>
                Start · เริ่ม
              </button>
            </div>
          )}

          {sessionStarted && (
            <>
              <div className={`tracking-status ${trackingStatus}`} role="status">
                <span />
                Tracking: {trackingCopy[trackingStatus]}
              </div>

              {/* §10/§12 — the old circular progress badge was removed: the bottom
                  progress line is the single camera HUD progress indicator (the
                  desktop side panel has its own target section). */}

              <div className={`reference-panel${referenceOpen ? " open" : ""}`}>
                <ExerciseDemoMedia exercise={exercise} />
                <span>Reference · ท่าอ้างอิง</span>
              </div>
              {/* Compact floating toggle: the reference thumb stays hidden behind
                  this button on phone/tablet so it never covers the patient's
                  tracking area. On desktop (≥1100px) CSS hides BOTH this toggle
                  and the floating panel — the demo lives in the sidebar there. */}
              <button
                type="button"
                className="reference-toggle"
                onClick={() => setReferenceOpen((open) => !open)}
                aria-expanded={referenceOpen}
                aria-label={referenceOpen ? "Hide reference pose · ซ่อนท่าอ้างอิง" : "Show reference pose · ดูท่าอ้างอิง"}
              >
                <Play size={13} />
                Demo
              </button>

              {/* REAL tracking: the static SVG overlay mockups are replaced by
                  live MediaPipe skeletons drawn on one canvas (see the effect
                  at the top of this component) — green body skeleton
                  (poseDetection.ts, reference skeletonRenderer.ts style) and/or
                  blue hand skeleton (handDetection.ts). The canvas needs no CSS
                  transform — landmarks are drawn pre-mirrored. */}
              {(poseTrackingEnabled || handTrackingEnabled) && (
                <canvas
                  ref={skeletonCanvasRef}
                  className="hand-tracking-overlay"
                  aria-hidden="true"
                />
              )}
              <div className="overlay-caption" role="status">
                {handTrackingEnabled && handDetected
                  ? "Hand tracking active · กำลังติดตามมือ"
                  : poseTrackingEnabled && poseDetected
                    ? "Pose tracking active · กำลังติดตามร่างกาย"
                    : handTrackingEnabled
                      ? "Show your hand to the camera · ยกมือขึ้นให้เห็นในกล้อง"
                      : poseTrackingEnabled
                        ? "Step back so your full body is in frame · ยืนให้เห็นทั้งตัวในกล้อง"
                        : "Reference pose · ท่าอ้างอิง"}
              </div>

              {paused && <div className="session-state">Paused · หยุดชั่วคราว</div>}

              <div className="session-bottom-stack">
                {/* §9 — compact feedback chip instead of the old large permanent
                    feedback panel: icon indicates state (✓ good / ↑ correction
                    needed) so it doesn't rely on color alone. */}
                <div className={`feedback-chip ${lowConfidence ? "warning" : ""}`} role="status" aria-live="polite">
                  <span className="feedback-chip-icon" aria-hidden="true">
                    {lowConfidence ? <ArrowUp size={14} /> : <Check size={14} />}
                  </span>
                  <p>
                    {lowConfidence
                      ? "Move a little farther back so your arm stays in frame. · ถอยออกมาอีกนิดให้แขนอยู่ในกรอบ"
                      : feedbackText}
                  </p>
                </div>

                {/* §8 — single primary progress representation on the camera:
                    "X of Y" count + bar. The score chip is hidden on phones
                    (CSS) where the spec deprioritizes it, visible on tablet+. */}
                <div className="session-progress-line" role="status" aria-label={`Session progress: ${progressLabel}`}>
                  <span className="session-progress-score">
                    <strong>{score}</strong> pts
                  </span>
                  <span className="session-progress-count">{progressLabel}</span>
                  <span className="session-progress-track" aria-hidden="true">
                    <span className="session-progress-fill" style={{ width: `${progressPercent}%` }} />
                  </span>
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
                    {paused ? <TimerReset size={18} /> : <Square size={18} />}
                    <span>{paused ? "Resume" : "Pause"}</span>
                  </button>
                  <button
                    type="button"
                    className="session-control-btn stop"
                    onClick={handleStop}
                    aria-label="Finish session · จบเซสชัน"
                  >
                    STOP
                  </button>
                  <button
                    type="button"
                    className="session-control-btn"
                    onClick={handleRestart}
                    aria-label="Restart · เริ่มใหม่"
                  >
                    <RotateCcw size={18} />
                    <span>Restart</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Desktop-only session dashboard (CSS hides this below 1100px). All
            values are the same live session state the camera HUD uses — no
            duplicated data sources, just a desktop-priority presentation. */}
        <aside className="session-side-panel">
          {/* A — session/exercise information */}
          <div className="side-section side-heading">
            <p className="eyebrow">Training session · เซสชันฝึก</p>
            <div className="side-name-row">
              <span className="side-tracking-icons" aria-hidden="true">
                {trackingIcons.map((Icon, index) => (
                  <Icon key={index} size={16} />
                ))}
              </span>
              <h1 className="side-exercise-name">{exercise.name}</h1>
            </div>
            {exercise.nameTh && <p className="side-name-th">{exercise.nameTh}</p>}
          </div>

          {/* Exercise demo/reference — a normal sidebar section on desktop (the
              camera keeps no floating demo there). Same shared ReferenceThumb as
              the floating phone/tablet panel; sized 16:9 and responsive to the
              sidebar width via CSS. */}
          <div className="side-section side-reference">
            <p className="side-label">Exercise demo · ท่าอ้างอิง</p>
            <ExerciseDemoMedia exercise={exercise} />
          </div>

          {/* Therapist instruction (exercise.feedback carries the scheduled
              exercise's therapistInstruction) — its own section above the score
              so the patient reads it before their current performance. */}
          <div className="side-section side-instruction">
            <p className="side-label">คำแนะนำนักกายภาพ</p>
            <p className="side-instruction-text">{exercise.feedback}</p>
          </div>

          {/* B — current performance: the score is the visual focal point */}
          <div className="side-section side-score">
            <p className="side-label">Current score · คะแนนปัจจุบัน</p>
            <p className="side-score-value">
              <strong>{score}</strong>
              <span aria-hidden="true">/100</span>
            </p>
          </div>

          {/* C — target/progress (same parsed "X of Y" data as the camera HUD) */}
          <div className="side-section side-target">
            <p className="side-label">Target · เป้าหมาย</p>
            <span className="session-progress-track side-target-track" aria-hidden="true">
              <span className="session-progress-fill" style={{ width: `${progressPercent}%` }} />
            </span>
            <span className="side-target-count">{progressLabel}</span>
          </div>

          {/* D — live feedback (same state/text as the camera feedback chip) */}
          <div className="side-section side-feedback">
            <p className="side-label">Live feedback · คำแนะนำ</p>
            <div className={`side-feedback-body ${lowConfidence ? "warning" : ""}`} role="status" aria-live="polite">
              <span className="feedback-chip-icon" aria-hidden="true">
                {lowConfidence ? <ArrowUp size={15} /> : <Check size={15} />}
              </span>
              <p>{lowConfidence
                ? "Move a little farther back so your arm stays in frame. · ถอยออกมาอีกนิดให้แขนอยู่ในกรอบ"
                : feedbackText}</p>
            </div>
          </div>

          {/* E — session controls, grouped: secondary first, then the
              session-ending Finish action, visually distinct. Same handlers as
              the on-camera controls (handleStop keeps its existing behavior). */}
          <div className="side-section side-controls">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (paused) {
                  recording.resume();
                } else {
                  recording.pause();
                }
                onTogglePause();
              }}
            >
              {paused ? <TimerReset size={16} /> : <Square size={16} />}
              {paused ? "Resume · เล่นต่อ" : "Pause · หยุดชั่วคราว"}
            </button>
            <button type="button" className="secondary-button" onClick={handleRestart}>
              <RotateCcw size={16} />
              Restart · เริ่มใหม่
            </button>
            <button type="button" className="primary-button full-width finish-button" onClick={handleStop}>
              Finish session · จบเซสชัน
            </button>
          </div>
        </aside>
      </div>

      {/* Exit confirmation — real in-app dialog (same .pd-modal .pd-confirm-modal
          idiom as PatientDetailPage's remove-day/remove-exercise confirms) so it
          matches the app instead of the browser's unstyled window.confirm().
          Shown only when a recording is actually in flight; Cancel keeps the
          session open exactly as it was. */}
      {exitConfirmOpen && (
        <div className="therapist-panel-scrim" onClick={() => setExitConfirmOpen(false)}>
          <div
            className="pd-modal pd-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-session-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="therapist-detail-header">
              <strong id="exit-session-title">Exit session?</strong>
              <button
                type="button"
                className="icon-button"
                onClick={() => setExitConfirmOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <p className="pd-confirm-message">
              Discard this attempt? Your recording hasn&apos;t been saved yet. ·
              ยกเลิกครั้งนี้? การบันทึกยังไม่ถูกบันทึก
            </p>
            <div className="pd-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setExitConfirmOpen(false)}>
                Keep recording
              </button>
              <button type="button" className="primary-button" style={{ background: "var(--danger, #d33)" }} onClick={confirmExit}>
                Discard &amp; exit
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// §2.1 — dashed person-silhouette outline shown during the pre-session preroll,
// reusing the same overlay SVG viewBox/color language as PoseOverlay/HandOverlay
// below rather than a new visual style. Cropped to the UPPER half of the body
// (head/shoulders/arms/torso) via the viewBox — the full-body outline extended
// past what a seated/upper-body exercise session actually frames.
function FramingGuide() {
  return (
    <svg className="framing-guide" viewBox="0 0 260 210" aria-hidden="true">
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
