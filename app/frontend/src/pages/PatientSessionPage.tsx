import { ArrowUp, Check, Dumbbell, Hand, LogOut, Play, RotateCcw, Signal, SignalZero, Square, TimerReset, Video, VideoOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCamera } from "../hooks/useCamera";
import { useSessionRecording } from "../hooks/useSessionRecording";
import type { RecordingResult } from "../hooks/useSessionRecording";
import { HandTracker, drawHandSkeleton, type Landmark } from "../ai/handDetection";
import { PoseTracker, drawSkeleton, type PoseLandmark } from "../ai/poseDetection";
import {
  DEFAULT_FSM_CONFIG,
  DEFAULT_PRIMARY_ANGLE_DEFINITION,
  DEFAULT_SECONDARY_ANGLE_DEFINITION,
  ExerciseFSM,
  buildFrameFeature,
  calculateTrunkCentroid,
  type CompletedRep
} from "../ai/poseScoring/posePipeline";
import type { PoseReferencePublic } from "../ai/poseScoring/poseScoringTypes";
import { OneEuroFilter } from "../ai/poseScoring/oneEuroFilter";
import { GripMinigame, computeGripVisibleFrame } from "../ai/grip/gripMinigame";
import { drawGripMinigame } from "../ai/grip/gripMinigameRenderer";
import { useAuth } from "../store/authStore";
import {
  getPatientScheduledExerciseDemoVideo,
  getPatientScheduledExercisePoseReference,
  scoreExerciseTestRep,
  scorePoseRep
} from "../services/api";
import type { PatientExercise, TrackingType } from "../types";

/** Authoring-test session config — passed by ExerciseAiPage's "Test exercise"
 * button. A test runs the exact same PatientSessionPage flow a patient gets,
 * but against criteria that may not be saved (nor scheduled) yet, so both
 * network-backed pieces are redirected: the pose criteria come from here
 * instead of GET /scheduled-exercises/:id/pose-reference, and each completed
 * rep is scored through POST /exercises/test-pose-rep-score (therapist/admin
 * scoped — the patient endpoint requires a scheduled exercise), so a test run
 * gets REAL scores from the same scoring engine. The caller owns the
 * lifecycle: finishing hands the recording to onFinishRecording as usual, and
 * the caller discards it (there is no upload/confirmation step) and returns to
 * the authoring page. */
export interface SessionTestConfig {
  /** Just-authored criteria (fresh calibration/checkpoints, or the stored copy
   * of the exercise being edited) — used BOTH to build the client-side FSM and
   * (masterSamples included) as the scoring reference. Null falls back to the
   * shared defaults, same as a normal session with no stored reference. */
  poseReference: PoseReferencePublic | null;
  /** exercise_library row id when editing an already-saved exercise — lets
   * the test-scoring endpoint fall back to the stored reference if the body
   * copy carries no master samples. Null/undefined for a brand-new exercise. */
  exerciseLibraryId?: string | null;
  /** Object URL of the therapist's base demo clip, shown as the reference media. */
  demoVideoUrl?: string | null;
}

interface PatientSessionPageProps {
  exercise: PatientExercise;
  paused: boolean;
  lowConfidence: boolean;
  /** Non-null = authoring test run (see SessionTestConfig); null/omitted = a
   * normal patient session with server-backed reference + scoring. */
  testConfig?: SessionTestConfig | null;
  onBack: () => void;
  onRestart: () => void;
  onTogglePause: () => void;
  // §6.3/§6.4 — called once STOP ends a recording with a result to review;
  // App.tsx routes to pages/SessionUploadConfirmPage.tsx from here instead of
  // going straight back to Today.
  onFinishRecording: (result: RecordingResult, poseSummary?: PoseSessionSummary) => void;
}

/** The real aggregate sent to the upload-confirmation page after pose scoring. */
export interface PoseSessionSummary {
  averageScore: number;
  repScores: number[];
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

// Parses the two target formats used by PatientExercise:
//   - legacy/mock progress: "X of Y"
//   - scheduled exercise target: "Y reps" / "Y repetitions"
// The real patient-session route supplies the second form via targetValueLabel.
// Backs both the progress ring/percent and the live rep counter below.
function parseProgress(progressLabel: string) {
  const progressMatch = progressLabel.match(/(\d+)\s*of\s*(\d+)/i);
  if (progressMatch) {
    return { done: Number(progressMatch[1]), total: Number(progressMatch[2]) };
  }

  const repsMatch = progressLabel.match(/(\d+)\s*(?:reps?|repetitions?)\b/i);
  if (repsMatch) {
    return { done: 0, total: Number(repsMatch[1]) };
  }

  return { done: 0, total: 0 };
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

// Client-side fallback criteria when an exercise's Exercise Library row has no
// stored poseReference yet — identical to the backend pose-scoring module's
// defaults (bilateral elbow extension, from projectimport/Rehab-AI's
// exercisePresets.ts). Scoring still fails server-side in that case with a
// clear "no pose reference stored" error.
const DEFAULT_POSE_REFERENCE = {
  angleDefinition: DEFAULT_PRIMARY_ANGLE_DEFINITION,
  secondaryAngleDefinition: DEFAULT_SECONDARY_ANGLE_DEFINITION,
  fsmConfig: DEFAULT_FSM_CONFIG,
  targetRom: 90,
  bveThreshold: 0.03,
  enableTrunkBve: true
} satisfies PoseReferencePublic;


// The exercise's actual demo video (exercise_library.demo_video_file_id, fetched
// through the auth'd GET /scheduled-exercises/:id/demo-video endpoint — the same
// source the instruction page plays). Auto-plays muted + loops so the reference
// movement is visible while the patient records. Returns null while loading or
// when the exercise has no video / the fetch fails; callers fall back to the
// static ReferenceThumb.
function useDemoVideoUrl(scheduledExerciseId: string | null): string | null {
  const { token } = useAuth();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // null id = the caller supplies its own demo media (a test run's local
    // base clip) — there is no scheduled exercise to fetch from.
    if (!token || !scheduledExerciseId) return;
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
function ExerciseDemoMedia({ exercise, overrideUrl }: { exercise: PatientExercise; overrideUrl?: string | null }) {
  // A test run plays the therapist's own (possibly still unsaved) base clip —
  // there is no scheduled exercise whose demo video could be fetched.
  const fetchedUrl = useDemoVideoUrl(overrideUrl ? null : exercise.id);
  const demoUrl = overrideUrl ?? fetchedUrl;
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
  testConfig = null,
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
  // Tracking model load lifecycle, surfaced in the overlay caption — the
  // MediaPipe WASM + .task model load from CDN on first use, and a failure
  // here used to be swallowed silently (live video, but no skeleton and no
  // hint why). "loading" until every enabled tracker's init() resolves.
  const [trackingLoadState, setTrackingLoadState] = useState<"loading" | "ready" | "error">("loading");

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
    setTrackingLoadState("loading");
    // One grip minigame per session flow; reset()s happen on Start/Restart/
    // exercise change (time discontinuity), matching the landmark filters.
    if (handTrackingEnabled && !gripGameRef.current) {
      gripGameRef.current = new GripMinigame();
    }

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
            // Virtual-grip minigame tick (grab/follow/drop state machine +
            // rep completion). Wrapped so a bug here can never take down the
            // rAF loop that draws the skeleton overlay.
            if (gripGameRef.current && sessionStartedRef.current && !pausedRef.current) {
              try {
                // Keep the minigame inside the region the patient can actually
                // see: the canvas displays the video with object-fit: cover, so
                // aspect-mismatched clients crop the frame — derive the visible
                // sub-frame from the canvas's intrinsic (video) size vs its CSS
                // (container) size and feed it to the game every detect tick.
                // Gated on an active session (like the pose FSM) so the ball
                // cannot be grabbed/scored during the pre-roll or while paused.
                const visibleFrame = computeGripVisibleFrame(
                  canvas.width,
                  canvas.height,
                  canvas.clientWidth,
                  canvas.clientHeight
                );
                gripGameRef.current.setViewport(visibleFrame, canvas.width / Math.max(1, canvas.height));
                gripGameRef.current.update(lastHandLandmarksRef.current, now);
                const gripCaption = gripGameRef.current.snapshot().statusText;
                if (gripCaption !== lastGripCaptionRef.current) {
                  lastGripCaptionRef.current = gripCaption;
                  setGripStatusText(gripCaption);
                }
              } catch (gripError) {
                console.error("grip minigame update failed", gripError);
              }
            }
          }
          if (poseTracker) {
            const rawPose = poseTracker.detect(video, now);
            // One-Euro smooth x/y per landmark before drawing/rep tracking —
            // the reference pipeline's exact post-detection step (z/visibility
            // pass through unfiltered).
            lastPoseLandmarksRef.current = rawPose
              ? rawPose.map((p, i) => {
                  const pair =
                    landmarkFiltersRef.current[i] ??
                    (landmarkFiltersRef.current[i] = { x: new OneEuroFilter(1.0, 0.005), y: new OneEuroFilter(1.0, 0.005) });
                  return { ...p, x: pair.x.filter(p.x, now), y: pair.y.filter(p.y, now) };
                })
              : null;
            setPoseDetected(lastPoseLandmarksRef.current !== null);
            // movementTracking=pose rep tracking (ExerciseFSM + backend
            // scoring). Wrapped so a bug here can never take down the rAF
            // loop that draws the skeleton overlay.
            try {
              poseLoopHookRef.current?.(lastPoseLandmarksRef.current, now);
            } catch (hookError) {
              console.error("pose rep-tracking hook failed", hookError);
            }
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
            // Virtual-grip ball + target ring, layered over the hand skeleton.
            if (gripGameRef.current) {
              try {
                drawGripMinigame(ctx, gripGameRef.current, canvas.width, canvas.height);
              } catch (gripDrawError) {
                console.error("grip minigame render failed", gripDrawError);
              }
            }
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
        if (cancelled) return;
        setTrackingLoadState("ready");
        if (runningRef.current) {
          rafIdRef.current = requestAnimationFrame(loop);
        }
      })
      .catch((initError) => {
        // Model load failed (e.g. offline / CDN blocked) — the session itself
        // (recording, upload flow) still works, just without the live skeleton
        // overlay. Surface it instead of failing silently: the overlay caption
        // explains why there is no skeleton.
        if (cancelled) return;
        console.error("Tracking model load failed (skeleton overlay disabled)", initError);
        setTrackingLoadState("error");
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
  // Current score — null until a real backend score arrives (pose flow). No
  // mock/empty-state number: before the first scored repetition both the
  // camera HUD and the sidebar show a "—" placeholder.
  const [demoScore, setDemoScore] = useState<number | null>(null);
  const [feedbackIndex, setFeedbackIndex] = useState(0);

  // -------------------------------------------------------------------------
  // REAL pose rep tracking (movementTracking = pose) — adapted from
  // projectimport/Rehab-AI's ExerciseLiveView pipeline, now split client/
  // server: the client runs the ExerciseFSM (starting-position detection +
  // one-repetition detection) on live MediaPipe landmarks; each COMPLETED rep
  // is captured as a FrameFeature[] sequence and sent to the backend
  // pose-scoring endpoint (DTW/BVE/K-NN + scoreEngine live server-side). A rep
  // only counts after the scoring request SUCCEEDS.
  // -------------------------------------------------------------------------
  const { token } = useAuth();

  // The exercise's stored criteria (Exercise Library base_criteria
  // .poseReference via GET /scheduled-exercises/:id/pose-reference). Kept in a
  // ref (not state) because the rAF loop consumes it. Null = the exercise has
  // no poseReference stored — the FSM then falls back to the shared defaults
  // and the backend rejects scoring with a clear error.
  // Live status line for the camera overlay (starting-position prompt,
  // hold countdown, "performing rep", scoring, next-rep countdown).
  const [poseStatusText, setPoseStatusText] = useState<string | null>(null);
  // Latest successful per-rep backend feedback (from scoreEngine).
  const [repFeedback, setRepFeedback] = useState<string | null>(null);

  const poseReferenceRef = useRef<PoseReferencePublic | null>(null);
  const fsmRef = useRef<ExerciseFSM | null>(null);
  // Mirrors sessionStarted/paused for the rAF loop (created once at mount).
  const sessionStartedRef = useRef(false);
  const pausedRef = useRef(false);
  // Hold gate: set while a completed rep is being scored (or between reps) so
  // the FSM stops consuming frames — no rep can complete while held.
  const scoringHoldRef = useRef(false);
  // Monotonic id of the current rep cycle — stale scoring responses /
  // countdown timers after Restart/unmount are ignored via this.
  const repCycleRef = useRef(0);
  const demoDoneRef = useRef(initialDone);
  // Every value here is a successful server-side score for this recording. A
  // ref keeps the complete set available when MediaRecorder asynchronously
  // finishes and hands the recording to the confirmation screen.
  const poseRepScoresRef = useRef<number[]>([]);
  // handleStop captured for submitCompletedRep's auto-finish (all reps done →
  // existing STOP → SessionUploadConfirmPage flow). Assigned every render.
  const stopRef = useRef<() => void>(() => {});
  const poseLoopHookRef = useRef<((landmarks: PoseLandmark[] | null, nowMs: number) => void) | null>(null);
  const lastPoseCaptionRef = useRef("");
  // One-Euro smoothing for pose landmarks — 1 instance per coordinate per
  // landmark (the reference pipeline's exact convention; see oneEuroFilter.ts).
  // The reference applied this before BOTH drawing and feature extraction, so
  // the overlay and the rep-tracking angles share the same smoothed signal.
  const landmarkFiltersRef = useRef<Array<{ x: OneEuroFilter; y: OneEuroFilter }>>([]);

  // -------------------------------------------------------------------------
  // Virtual-grip minigame (movementTracking = virtual_grip): close the hand
  // over the displayed ball to grab it, drag it into the target circle, hold
  // to score a repetition. Pure logic lives in ai/grip/gripMinigame.ts; the
  // ball/target render on the shared overlay canvas next to the hand skeleton.
  // -------------------------------------------------------------------------
  const gripGameRef = useRef<GripMinigame | null>(null);
  const [gripStatusText, setGripStatusText] = useState<string | null>(null);
  const lastGripCaptionRef = useRef("");

  useEffect(() => {
    sessionStartedRef.current = sessionStarted;
    pausedRef.current = paused;
  }, [sessionStarted, paused]);


  useEffect(() => {
    setSessionStarted(false);
    setReferenceOpen(false);
    const parsed = parseProgress(exercise.progressLabel);
    setDemoDone(parsed.done);
    setDemoScore(null);
    setFeedbackIndex(0);
    // Pose rep tracking resets with the exercise switch too.
    demoDoneRef.current = parsed.done;
    poseRepScoresRef.current = [];
    repCycleRef.current += 1;
    scoringHoldRef.current = false;
    setRepFeedback(null);
    setPoseStatusText(null);
    lastPoseCaptionRef.current = "";
    landmarkFiltersRef.current = [];
    gripGameRef.current?.reset();
    setGripStatusText(null);
    lastGripCaptionRef.current = "";
    fsmRef.current?.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    if (!sessionStarted || paused || total === 0 || demoDone >= total) {
      return;
    }
    // movementTracking=pose: real rep counting (ExerciseFSM + backend scoring)
    // drives demoDone — the fake timer only runs for non-pose exercises.
    // movementTracking=virtual_grip: the grip minigame drives demoDone, so the
    // fake timer is off there too (same rationale).
    if (poseTrackingEnabled || handTrackingEnabled) {
      return;
    }
    const interval = setInterval(() => {
      setDemoDone((current) => Math.min(current + 1, total));
      setFeedbackIndex((current) => (current + 1) % demoFeedbackMessages(exercise).length);
    }, 3500);
    return () => clearInterval(interval);
  }, [sessionStarted, paused, total, demoDone, exercise]);

  // Fetch the exercise's stored pose criteria and (re)build the FSM. Skipped
  // for non-pose exercises (their demo-timer flow above stays unchanged).
  useEffect(() => {
    if (!poseTrackingEnabled) return;
    // Test run (ExerciseAiPage's "Test exercise"): use the just-authored
    // criteria directly — there is no scheduled exercise to fetch them from.
    // testConfig's identity is stable for the whole run (it's held in the
    // caller's state), so this builds the FSM once, not on every render.
    if (testConfig) {
      poseReferenceRef.current = testConfig.poseReference;
      fsmRef.current = new ExerciseFSM((testConfig.poseReference ?? DEFAULT_POSE_REFERENCE).fsmConfig);
      return;
    }
    if (!token) return;
    let cancelled = false;
    getPatientScheduledExercisePoseReference(token, exercise.id)
      .then((response) => {
        if (cancelled) return;
        poseReferenceRef.current = response.poseReference;
        fsmRef.current = new ExerciseFSM((response.poseReference ?? DEFAULT_POSE_REFERENCE).fsmConfig);
      })
      .catch(() => {
        if (cancelled) return;
        // Network/auth failure — fall back to the shared defaults so the
        // session still runs; scoring requests will surface a clear error.
        poseReferenceRef.current = null;
        fsmRef.current = new ExerciseFSM(DEFAULT_POSE_REFERENCE.fsmConfig);
      });
    return () => {
      cancelled = true;
    };
  }, [poseTrackingEnabled, token, exercise.id, testConfig]);

  // Shared "rep accepted" continuation: advances the "X of Y" counter (demoDone
  // drives the camera HUD + sidebar progress bar), then either auto-finishes
  // the session (all prescribed reps done → the normal STOP completion flow) or
  // runs the short next-rep countdown back into starting-position detection.
  // Runs for every backend-scored rep, patient session or therapist test alike.
  function advanceAfterRep(
    cycle: number,
    repNumber: number,
    score: number | null,
    feedback: string | null,
    countedStatus: string
  ) {
    demoDoneRef.current = Math.min(repNumber, total > 0 ? total : repNumber);
    setDemoDone(demoDoneRef.current);
    if (score !== null) {
      setDemoScore(score);
      poseRepScoresRef.current.push(score);
    }
    setRepFeedback(feedback);
    setPoseStatusText(countedStatus);

    if (total > 0 && demoDoneRef.current >= total) {
      // All prescribed reps done → transition into the existing
      // session-completion flow (STOP → SessionUploadConfirmPage for a real
      // session; straight back to the authoring page for a test run).
      setPoseStatusText("All reps completed — finishing… · ทำครบทุกรอบแล้ว กำลังจบเซสชัน");
      window.setTimeout(() => {
        if (cycle === repCycleRef.current) stopRef.current();
      }, 2000);
      return;
    }

    // Short countdown before allowing the next repetition, then return to
    // starting-position detection (FSM reset).
    let remaining = 3;
    const tick = () => {
      if (cycle !== repCycleRef.current) return;
      if (remaining <= 0) {
        scoringHoldRef.current = false;
        fsmRef.current?.reset();
        setPoseStatusText("Move into the starting position · กลับสู่ท่าเริ่มต้น");
        return;
      }
      setPoseStatusText(`Next rep in ${remaining}… · รอบถัดไปในอีก ${remaining}…`);
      remaining -= 1;
      window.setTimeout(tick, 1000);
    };
    window.setTimeout(tick, 1000);
  }

  // Submits one captured repetition to the backend and updates the session UI.
  // Invoked from the rAF loop when the FSM reports repCompleted. A test run
  // scores through the therapist-scoped test endpoint (same engine, no patient
  // scheduled exercise involved); a normal session uses the patient endpoint.
  // Either way the rep only counts after the backend responds successfully.
  async function submitCompletedRep(completed: CompletedRep) {
    const cycle = repCycleRef.current;
    const repNumber = demoDoneRef.current + 1;
    setPoseStatusText(`Scoring rep ${repNumber}… · กำลังให้คะแนนรอบที่ ${repNumber}`);
    try {
      if (!token) throw new Error("Not signed in.");
      const repRequest = {
        repNumber,
        frames: completed.sequence,
        peakRom: completed.peakRom,
        baseTrunkPoint: completed.baseTrunkPoint,
        baseShoulderWidthNorm: completed.baseShoulderWidthNorm
      };
      const { rep } = testConfig
        ? await scoreExerciseTestRep(token, {
            ...repRequest,
            exerciseId: testConfig.exerciseLibraryId ?? undefined,
            // The full on-screen reference (masterSamples included) — the
            // therapist tests exactly what they're looking at, even before
            // saving. The server falls back to the stored library reference
            // when this copy carries no master samples.
            poseReference: testConfig.poseReference ?? undefined
          })
        : await scorePoseRep(token, exercise.id, repRequest);
      if (cycle !== repCycleRef.current) return; // session restarted meanwhile

      // Success — NOW the rep counts (demoDone drives "X of Y" + progress %).
      advanceAfterRep(
        cycle,
        repNumber,
        rep.score,
        rep.feedback,
        `Rep ${repNumber}: ${rep.score} pts · รอบที่ ${repNumber}: ${rep.score} คะแนน`
      );
    } catch (err) {
      if (cycle !== repCycleRef.current) return;
      // Failed scoring (network/backend error) — the rep is NOT counted; the
      // patient repeats this repetition from the starting position.
      const message = err instanceof Error ? err.message : "Scoring request failed.";
      setRepFeedback(null);
      setPoseStatusText(`Scoring failed — please repeat this rep · ให้คะแนนไม่สำเร็จ โปรดทำรอบนี้ซ้ำ (${message})`);
      scoringHoldRef.current = false;
      fsmRef.current?.reset();
    }
  }

  // Per-frame pose rep tracking, invoked from the rAF loop. Keeping this in a
  // ref (assigned every render) lets the long-lived loop closure stay stable
  // while still seeing the latest values through refs.
  poseLoopHookRef.current = (landmarks, nowMs) => {
    if (!landmarks) return;
    const fsm = fsmRef.current;
    if (!fsm) return;
    // Falls back to the shared default criteria when the exercise has no
    // stored poseReference (scoring will surface a clear backend error).
    const activeReference = poseReferenceRef.current ?? DEFAULT_POSE_REFERENCE;
    if (!sessionStartedRef.current || pausedRef.current || scoringHoldRef.current) return;

    const frameFeature = buildFrameFeature(
      landmarks,
      activeReference.angleDefinition,
      activeReference.secondaryAngleDefinition
    );
    const output = fsm.processFrame(
      { angle: frameFeature.elbowAngle, trunkCentroid: calculateTrunkCentroid(landmarks), timestampMs: nowMs },
      frameFeature
    );

    // Caption (only on change — the loop runs ~15fps).
    let caption = "Move into the starting position · เข้าสู่ท่าเริ่มต้น";
    if (output.state === "WAITING_READY_POSE" && output.readyCountdownSeconds !== null) {
      caption = `Hold the starting position — ${output.readyCountdownSeconds}s · ค้างท่าเริ่มต้น — ${output.readyCountdownSeconds}s`;
    } else if (output.state === "IN_REP_ACTIVE") {
      caption = "Performing one repetition · กำลังทำ 1 รอบ";
    } else if (output.state === "IN_REP_RETURN") {
      caption = "Return to the starting position · กลับสู่ท่าเริ่มต้น";
    }
    if (caption !== lastPoseCaptionRef.current) {
      lastPoseCaptionRef.current = caption;
      setPoseStatusText(caption);
    }

    if (output.repCompleted && output.completedRep) {
      // Pause progression: stop feeding the FSM until scoring resolves and
      // the next-rep countdown finishes (submitCompletedRep releases it).
      scoringHoldRef.current = true;
      void submitCompletedRep(output.completedRep);
    }
  };


  // "1 / 10" repetition counter — completed reps / prescribed total (both the
  // camera HUD and the sidebar target section render from this).
  const progressLabel = total > 0 ? `${demoDone} / ${total}` : exercise.progressLabel;
  const progressPercent = total > 0 ? Math.round((demoDone / total) * 100) : 0;
  const score = demoScore;
  const trackingIcons = trackingIconsFor(exercise.trackingType);
  // movementTracking=pose: real per-rep AI feedback from the backend scoring
  // engine (Thai, generated by scoreEngine) once a rep has been scored; the
  // canned demo messages only apply to non-pose exercises.
  const feedbackText = poseTrackingEnabled
    ? repFeedback ?? exercise.feedback
    : demoFeedbackMessages(exercise)[feedbackIndex] ?? exercise.feedback;

  // Virtual-grip rep completed (ball dropped + held in the target) — advance
  // the shared rep counter / green bar. Counted locally: grip interactions
  // have no backend scoring endpoint yet, so no score is fabricated here
  // (the score chip stays "—" per the no-mock policy).
  function handleGripRepComplete() {
    // Ignore stray completions outside an active session (e.g. a rep that
    // finished on the very frame Pause was pressed), and on "both" exercises
    // where the pose FSM owns the scored rep counter — the minigame stays
    // playable there but must not double-count into the same "1 / N" counter.
    if (!sessionStartedRef.current || pausedRef.current || poseTrackingEnabled) return;

    const next = total > 0 ? Math.min(demoDoneRef.current + 1, total) : demoDoneRef.current + 1;
    demoDoneRef.current = next;
    setDemoDone(next);

    // Prescribed reps reached → transition into the existing session-completion
    // flow (STOP → SessionUploadConfirmPage), same as the pose flow. The
    // repCycle guard drops this if the session was restarted meanwhile.
    if (total > 0 && next >= total) {
      const cycle = repCycleRef.current;
      lastGripCaptionRef.current = "All reps completed — finishing… · ทำครบทุกรอบแล้ว กำลังจบเซสชัน";
      setGripStatusText(lastGripCaptionRef.current);
      window.setTimeout(() => {
        if (cycle === repCycleRef.current) stopRef.current();
      }, 2000);
    }
  }
  if (gripGameRef.current) {
    gripGameRef.current.onRepComplete = handleGripRepComplete;
  }

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
      const repScores = poseRepScoresRef.current;
      const poseSummary = repScores.length > 0
        ? {
            averageScore: Math.round(repScores.reduce((sum, score) => sum + score, 0) / repScores.length),
            repScores: [...repScores]
          }
        : undefined;
      onFinishRecording(recording.result, poseSummary);
    }
  }, [recording.result, onFinishRecording]);

  const handleStart = () => {
    setSessionStarted(true);
    recording.start();
    // Pose rep tracking begins fresh: cancel any in-flight rep cycle, clear
    // the scoring hold, and re-arm the FSM from the starting-position state.
    repCycleRef.current += 1;
    scoringHoldRef.current = false;
    demoDoneRef.current = demoDone;
    poseRepScoresRef.current = [];
    // New session = time discontinuity — landmark filters start fresh.
    landmarkFiltersRef.current = [];
    gripGameRef.current?.reset();
    setGripStatusText(null);
    lastGripCaptionRef.current = "";
    fsmRef.current?.reset();
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
  // Pose rep tracking completes all prescribed reps → the existing
  // session-completion flow (stopRef is called by submitCompletedRep).
  stopRef.current = handleStop;

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
    setDemoScore(null);
    setFeedbackIndex(0);
    // §6.4 — Restart discards the current recording and begins a fresh one (same
    // semantics as Retry on the confirm screen, just reachable mid-recording).
    recording.reset();
    if (sessionStarted) {
      recording.start();
    }
    // Invalidate the old rep cycle (stale scoring responses/countdowns are
    // dropped) and re-arm the FSM from the starting-position state.
    repCycleRef.current += 1;
    scoringHoldRef.current = false;
    demoDoneRef.current = initialDone;
    poseRepScoresRef.current = [];
    setRepFeedback(null);
    lastPoseCaptionRef.current = "";
    landmarkFiltersRef.current = [];
    gripGameRef.current?.reset();
    setGripStatusText(null);
    lastGripCaptionRef.current = "";
    fsmRef.current?.reset();
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

          {/* REAL tracking overlay canvas — mounted as soon as the camera is
              streaming (not only after Start), so the live skeleton is visible
              during the preroll too and the patient can see the tracker working
              while positioning themselves. The preroll (framing guide, z-index 3)
              layers above it; rep tracking itself stays gated on Start. */}
          {(poseTrackingEnabled || handTrackingEnabled) && camera.status === "streaming" && (
            <canvas
              ref={skeletonCanvasRef}
              className="hand-tracking-overlay"
              aria-hidden="true"
            />
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
                <ExerciseDemoMedia exercise={exercise} overrideUrl={testConfig?.demoVideoUrl} />
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

              {/* The live skeleton canvas itself is mounted above (as soon as the
                  camera streams) so it is visible during the preroll as well. */}
              <div className="overlay-caption" role="status">
                {(poseTrackingEnabled || handTrackingEnabled) && trackingLoadState === "error"
                  ? "Tracking unavailable — check your internet connection · โหลดโมเดลไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ต"
                  : (poseTrackingEnabled || handTrackingEnabled) && trackingLoadState === "loading"
                  ? "Loading tracking… · กำลังโหลดโมเดล…"
                  : poseTrackingEnabled && poseStatusText
                  ? poseStatusText
                  : handTrackingEnabled && gripStatusText
                  ? gripStatusText
                  : handTrackingEnabled && handDetected
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
                    {/* "—" until a real backend score exists — no mock number. */}
                    {score === null ? <strong>—</strong> : <><strong>{score}</strong> pts</>}
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
            <ExerciseDemoMedia exercise={exercise} overrideUrl={testConfig?.demoVideoUrl} />
          </div>

          {/* Therapist instruction (exercise.feedback carries the scheduled
              exercise's therapistInstruction) — its own section above the score
              so the patient reads it before their current performance. */}
          <div className="side-section side-instruction">
            <p className="side-label">คำแนะนำนักกายภาพ</p>
            <p className="side-instruction-text">{exercise.feedback}</p>
          </div>

          {/* C — target/progress: repetition counter ("1 / 10") + the green
              completion bar, placed ABOVE the score so the patient reads how far
              they are before their current performance. Same parsed data as the
              camera HUD — demoDone only advances after a successful backend
              scoring response, so the bar reflects scored repetitions. */}
          <div className="side-section side-target">
            <p className="side-label">Target repetitions · เป้าหมายจำนวนครั้ง</p>
            <span className="session-progress-track side-target-track" aria-hidden="true">
              <span className="session-progress-fill" style={{ width: `${progressPercent}%` }} />
            </span>
            <span className="side-target-count">
              {total > 0 ? (
                <>
                  <strong className="side-target-done">{demoDone}</strong>
                  {` / ${total} repetitions · ครั้ง`}
                </>
              ) : (
                progressLabel
              )}
            </span>
          </div>

          {/* B — current performance: the score is the visual focal point.
              "—" until the first backend-scored repetition — no mock number. */}
          <div className="side-section side-score">
            <p className="side-label">Current score · คะแนนปัจจุบัน</p>
            <p className="side-score-value">
              <strong>{score ?? "—"}</strong>
              <span aria-hidden="true">{score === null ? "" : "/100"}</span>
            </p>
            {score === null && (
              <p className="side-score-hint">Score appears after your first scored repetition · คะแนนจะแสดงหลังให้คะแนนรอบแรก</p>
            )}
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
