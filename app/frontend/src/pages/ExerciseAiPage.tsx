// AI exercise authoring workspace — the CreateExerciseView flow from
// projectimport/Rehab-AI, adapted to this project: the therapist uploads a
// demo clip, the page scans it frame-by-frame with this project's PoseTracker
// (ai/poseDetection.ts, tasks-vision), auto-calibrates the tracking angle +
// rep-counting criteria (ai/poseScoring/exerciseAutoCalibrator.ts), and saves
// the result as exercise_library.base_criteria.poseReference via the normal
// POST /exercises endpoint — closing the loop so patient sessions score
// against a real therapist-authored reference instead of seeded defaults.
// Layout mirrors the import's two-column workspace; styling stays on this
// project's color scheme (creation-section-card / CSS variables).

import { AlertTriangle, Archive, ArrowLeft, CheckCircle2, Dumbbell, Film, Flag, Hand, History, Loader2, Play, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { AdminSidebar } from "../components/AdminSidebar";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { useAuth } from "../store/authStore";
import { describeCriteria } from "../utils/exerciseCriteria";
import { initialsFromName } from "../utils/displayName";
import { drawSkeleton } from "../ai/poseDetection";
import {
  CANDIDATE_ANGLE_DEFINITIONS,
  DEFAULT_FSM_MARGIN_SCALE,
  calibrateFromFrames,
  deriveFsmConfigFromCheckpoints,
  deriveFsmConfigFromSeries,
  type CalibrationResult,
  type FrameSample
} from "../ai/poseScoring/exerciseAutoCalibrator";
import { scanVideoPoseFrames } from "../ai/poseScoring/videoPoseScanner";
import { extractConfiguredAngle } from "../ai/poseScoring/angleExtraction";
import type { ExerciseFSMConfig, FrameFeature, AngleDefinition, PoseReferencePublic } from "../ai/poseScoring/poseScoringTypes";
import { ApiError, archiveExercise, createExercise, createExerciseVersion, getFileContent, getExerciseLibrary, publishExercise, updateExerciseDraft, uploadFile } from "../services/api";
import type { ExerciseBaseCriteria, ExerciseLibraryDifficulty, ExerciseLibraryItem, ExerciseTrackingType, PatientExercise } from "../types";
import { PatientSessionPage } from "./PatientSessionPage";
import type { SessionTestConfig } from "./PatientSessionPage";

interface ExerciseAiPageProps {
  exercise?: ExerciseLibraryItem | null;
  initialName?: string;
  initialTracking?: ExerciseTrackingType;
  onBack: () => void;
  onSaved: () => void;
  onLogout: () => void;
  // Union of both sidebars' contracts — this page renders TherapistSidebar for
  // therapists and AdminSidebar for admins (same section, same label), so App
  // passes one role-dispatching handler (handleExerciseLibraryNavigate).
  onNavigate: (label: TherapistNavLabel | AdminNavLabel) => void;
  // True only when this workspace was opened from the Exercise Library's Version
  // History panel (App's openExerciseVersion): the row in hand is ONE link of the
  // family's version chain rather than "the exercise the library card points at",
  // so the page orients the therapist with a version banner and a back-link that
  // names the library instead of the creation flow. Read-only-ness needs no flag:
  // POST /exercises/:id/versions archives the superseded rows, so the existing
  // `isArchived` gate already turns every history row into an audit view.
  isVersionView?: boolean;
}

type Difficulty = Extract<ExerciseLibraryDifficulty, "easy" | "medium" | "hard">;

interface ScannedClip {
  id: number;
  description: string;
  frames: FrameSample[];
}

type CheckpointRole = "ready" | "active" | "return";

interface ExerciseCheckpoint {
  role: CheckpointRole;
  label: string;
  description?: string;
  timestampSeconds: number;
  angle: number;
}

/** The 3 FSM states the therapist marks on the base clip (reference order). */
const CHECKPOINT_ROLES: { role: CheckpointRole; title: string; hint: string; icon: string }[] = [
  { role: "ready", title: "Starting position", hint: "Pose the patient must hold before moving", icon: "📍" },
  { role: "active", title: "Peak of movement", hint: "Furthest point they move to in this exercise", icon: "💪" },
  { role: "return", title: "Return to start", hint: "Where a repetition counts as complete", icon: "🔁" }
];

/** Rep-counting strictness levels per difficulty (from the reference view) —
 * level 2 is always the value the auto-calibration derived (scale = 1). */
const DIFFICULTY_REP_SENSITIVITY: Record<Difficulty, { scale: number; label: string; desc: string }[]> = {
  easy: [
    { scale: 1.15, label: "Very lenient", desc: "Slightly easier rep counting for limited mobility." },
    { scale: 1.075, label: "Lenient", desc: "The patient does not need the full range for a rep to count." },
    { scale: DEFAULT_FSM_MARGIN_SCALE, label: "Medium (auto-suggested)", desc: "The value analyzed from the demo clip — right for most patients." },
    { scale: 0.925, label: "Strict", desc: "Movement must closely match the demo clip." },
    { scale: 0.85, label: "Very strict", desc: "Closest match to the demo clip — for well-recovered patients." }
  ],
  medium: [
    { scale: 1.35, label: "Very lenient", desc: "Easier rep counting for noticeably limited mobility." },
    { scale: 1.175, label: "Lenient", desc: "Less range than the demo still counts as a rep." },
    { scale: DEFAULT_FSM_MARGIN_SCALE, label: "Medium (auto-suggested)", desc: "The value analyzed from the demo clip — right for most patients." },
    { scale: 0.825, label: "Strict", desc: "Movement must closely match the demo clip." },
    { scale: 0.65, label: "Very strict", desc: "Nearly full demo range required — for well-recovered patients." }
  ],
  hard: [
    { scale: 1.6, label: "Very lenient", desc: "Much easier rep counting — for very limited mobility or a first attempt at this exercise." },
    { scale: 1.4, label: "Lenient", desc: "Less range than the demo still counts as a rep." },
    { scale: DEFAULT_FSM_MARGIN_SCALE, label: "Medium (auto-suggested)", desc: "The value analyzed from the demo clip — right for most patients." },
    { scale: 0.6, label: "Strict", desc: "Movement must closely match the demo clip." },
    { scale: 0.45, label: "Very strict", desc: "Nearly the full demo range required — for well-recovered patients." }
  ]
};

/** Thai display labels for Step 1's difficulty buttons — the underlying
 *  value (easy/medium/hard) stays English for state, classNames and payload. */
const DIFFICULTY_LABELS_TH: Record<Difficulty, string> = {
  easy: "ง่าย",
  medium: "ปานกลาง",
  hard: "ยาก"
};

/** Difficulty meta shown under the selector (reference DIFFICULTY_INFO). */
const DIFFICULTY_INFO: Record<Difficulty, { icon: string; rangeText: string; desc: string }> = {
  easy: { icon: "🟢", rangeText: "±15%", desc: "This exercise is already easy — the adjustable range stays close to the analyzed value." },
  medium: { icon: "🟡", rangeText: "±35%", desc: "Standard — suits most general exercises." },
  hard: { icon: "🔴", rangeText: "±60%", desc: "This exercise is hard for some patients — the widest adjustable range, so it can be eased a lot." }
};

/** Trunk-compensation sensitivity presets, replacing the raw bveThreshold. */
const BVE_SENSITIVITY_LEVELS: { value: number; label: string; desc: string }[] = [
  { value: 0.08, label: "Very strict", desc: "No trunk lean allowed — for patients with good core control." },
  { value: 0.12, label: "Strict", desc: "Catches trunk compensation early." },
  { value: 0.15, label: "Medium (recommended)", desc: "Balance between accuracy and real-world use." },
  { value: 0.2, label: "Lenient", desc: "Allows some trunk assistance." },
  { value: 0.28, label: "Very lenient", desc: "For early-stage patients who still lean to support themselves." }
];

export function ExerciseAiPage({
  exercise = null,
  initialName = "",
  initialTracking = "pose",
  onBack,
  onSaved,
  onLogout,
  onNavigate,
  isVersionView = false
}: ExerciseAiPageProps) {
  const { token, user } = useAuth();
  const displayName = user?.displayName || user?.username || "Therapist";

  // Exercise identity / payload fields.
  const [exerciseName, setExerciseName] = useState(exercise?.name ?? initialName);
  const [exerciseDescription, setExerciseDescription] = useState(exercise?.description ?? "");
  const [movementTracking, setMovementTracking] = useState<ExerciseTrackingType>(exercise?.movementTracking ?? initialTracking);
  const [difficulty, setDifficulty] = useState<Difficulty>(exercise?.difficultyLevel ?? "medium");
  const [repetitions, setRepetitions] = useState(exercise?.baseCriteria.repetitions?.toString() ?? "10");
  const [holdSeconds, setHoldSeconds] = useState(exercise?.baseCriteria.holdSeconds?.toString() ?? "5");
  const [targetGripStrength, setTargetGripStrength] = useState(exercise?.baseCriteria.targetGripStrength?.toString() ?? "50");

  // Demo-clip scanning state. Only ONE clip can scan at a time (the scanner
  // drives a hidden <video> element); one shared busy flag guards all inputs.
  const [baseClip, setBaseClip] = useState<File | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanProgressText, setScanProgressText] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Replayable demo-video playback for Step 2:
  //   baseClipUrl — object URL of the locally selected file, so the clip can be
  //                 replayed any time in this session (including after the
  //                 scan has consumed it for calibration);
  //   savedDemo*  — the exercise's STORED demo video, streamed back through the
  //                 auth'd files endpoint, so a therapist revisiting this page
  //                 later can replay it without re-uploading anything.
  const [baseClipUrl, setBaseClipUrl] = useState<string | null>(null);
  const [savedDemoUrl, setSavedDemoUrl] = useState<string | null>(null);
  const [savedDemoState, setSavedDemoState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // Calibration results (null until the base clip has been scanned).
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [baseFrames, setBaseFrames] = useState<FrameSample[]>([]);
  const [selectedPrimaryId, setSelectedPrimaryId] = useState<string | null>(null);
  const [selectedSecondaryId, setSelectedSecondaryId] = useState<string | null>(null);

  // Editable criteria.
  const [fsmConfig, setFsmConfig] = useState<ExerciseFSMConfig | null>(null);
  const [targetRom, setTargetRom] = useState(90);
  const [bveThreshold, setBveThreshold] = useState(0.15);
  const [enableTrunkBve, setEnableTrunkBve] = useState(true);
  const [repSensitivityIndex, setRepSensitivityIndex] = useState(2);

  // Additional takes (raw frames kept so features can be re-derived if the
  // therapist switches the primary/secondary angle before saving).
  const [masterClips, setMasterClips] = useState<ScannedClip[]>([]);
  const [wrongFormClips, setWrongFormClips] = useState<ScannedClip[]>([]);
  const [masterDescription, setMasterDescription] = useState("");
  const [wrongFormDescription, setWrongFormDescription] = useState("");

  // Frame preview scrubber (skeleton-only preview over a dark backdrop) — also
  // the frame picker used when marking checkpoints.
  const [previewIndex, setPreviewIndex] = useState(0);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  // Live scan preview canvas (video frame + skeleton while scanning, the
  // reference's behavior) — separate from the post-scan preview above.
  const scanPreviewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Therapist-marked checkpoints: ready / active / return angles taken from
  // scrubbed frames of the base clip. When all three are marked, the FSM
  // criteria are derived from these angles directly (more accurate than
  // inferring from the whole signal).
  const [checkpoints, setCheckpoints] = useState<Record<CheckpointRole, ExerciseCheckpoint | null>>({
    ready: null,
    active: null,
    return: null
  });
  const [activeCheckpointRole, setActiveCheckpointRole] = useState<CheckpointRole>("ready");
  const [checkpointLabelDraft, setCheckpointLabelDraft] = useState("");
  const [checkpointDescDraft, setCheckpointDescDraft] = useState("");

  // Save state.
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedExerciseName, setSavedExerciseName] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState<"publish" | "archive" | null>(null);
  // "new" = create a new exercise; otherwise the id of an existing pose exercise
  // to attach this reference to (draft → update in place, active → new version).
  const [targetExerciseId, setTargetExerciseId] = useState<string>("new");
  const [libraryExercises, setLibraryExercises] = useState<ExerciseLibraryItem[]>([]);

  // "Test exercise" run — mounts PatientSessionPage with the criteria
  // currently on screen while THIS component stays mounted (so scanned clips,
  // checkpoints and calibration all survive the round-trip). null = the
  // authoring workspace is showing. Unlike a patient's session there is no
  // upload/confirmation step: finishing (or exiting) comes straight back here
  // and the take is discarded.
  const [testSession, setTestSession] = useState<{ exercise: PatientExercise; testConfig: SessionTestConfig } | null>(null);
  const [testPaused, setTestPaused] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  const sensitivityLevels = DIFFICULTY_REP_SENSITIVITY[difficulty];
  const allCheckpointsSet = Boolean(checkpoints.ready && checkpoints.active && checkpoints.return);

  // Pose exercises already in the library (this therapist's own rows included),
  // offered as attach targets so a reference can be applied to an existing
  // exercise instead of always creating a new one. Archived versions are
  // excluded — attaching to them would resurrect a retired row.
  const targetExercise =
    exercise ?? (targetExerciseId === "new" ? null : libraryExercises.find((item) => item.id === targetExerciseId) ?? null);
  const isOwner = !targetExercise || (user ? targetExercise.createdById === user.id || user.role === "admin" : false);
  const isArchived = targetExercise?.status === "archived";
  const isPoseExercise = movementTracking === "pose";
  // Admins reach this workspace from AdminSidebar's "Exercise Library" item —
  // they get the AdminSidebar back (same section highlighted) so they can
  // navigate out again; therapists keep the TherapistSidebar exactly as before.
  const isAdmin = user?.role === "admin";

  // One object URL per selected file — created on selection and revoked when
  // it's replaced or removed, so the Step 2 player can replay the clip freely
  // (the scan never consumes the file itself).
  useEffect(() => {
    if (!baseClip) {
      setBaseClipUrl(null);
      return;
    }
    const url = URL.createObjectURL(baseClip);
    setBaseClipUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [baseClip]);

  // Stored demo video — resolved whenever the edited exercise already has one
  // attached (same pattern as ExerciseCreationPage): the blob comes through
  // GET /files/:id/content and lives in an object URL revoked on change or
  // unmount. This is what makes the demo replayable on LATER visits to this
  // page — the file id comes back with the exercise row, so reopening the
  // exercise fetches it again instead of showing an empty upload box.
  useEffect(() => {
    const fileId = targetExercise?.demoVideoFileId ?? null;
    setSavedDemoUrl(null);
    if (!token || !fileId) {
      setSavedDemoState("idle");
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setSavedDemoState("loading");
    getFileContent(token, fileId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setSavedDemoUrl(objectUrl);
        setSavedDemoState("ready");
      })
      .catch(() => {
        if (!cancelled) setSavedDemoState("error");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, targetExercise?.demoVideoFileId]);

  useEffect(() => {
    setExerciseName(exercise?.name ?? initialName);
    setExerciseDescription(exercise?.description ?? "");
    setMovementTracking(exercise?.movementTracking ?? initialTracking);
    setDifficulty(exercise?.difficultyLevel ?? "medium");
    setRepetitions(exercise?.baseCriteria.repetitions?.toString() ?? "10");
    setHoldSeconds(exercise?.baseCriteria.holdSeconds?.toString() ?? "5");
    setTargetGripStrength(exercise?.baseCriteria.targetGripStrength?.toString() ?? "50");
    setSavedExerciseName(null);
  }, [exercise, initialName, initialTracking]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getExerciseLibrary(token)
      .then((response) => {
        if (cancelled) return;
        setLibraryExercises(
          response.exercises
            .filter((item) => item.movementTracking === "pose" && item.status !== "archived")
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      })
      .catch(() => {
        // Non-fatal: the picker just stays empty and "New exercise" still works.
        if (!cancelled) setLibraryExercises([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, savedExerciseName]);

  const getAngleDefinitionById = (id: string | null): AngleDefinition | null =>
    id ? CANDIDATE_ANGLE_DEFINITIONS.find((c) => c.id === id)?.angleDefinition ?? null : null;

  const primaryDef = getAngleDefinitionById(selectedPrimaryId) ?? calibration?.primary.angleDefinition ?? null;
  const secondaryDef = getAngleDefinitionById(selectedSecondaryId) ?? calibration?.secondary.angleDefinition ?? null;

  /** Primary-angle series over the scanned base frames (for FSM re-derivation). */
  const seriesFor = (def: AngleDefinition): number[] => baseFrames.map((f) => extractConfiguredAngle(f.landmarks, def).mean);

  /** Raw landmark frames → FrameFeature[] with the CURRENT primary/secondary
   * definitions (re-derived at save time, matching the reference flow). */
  const convertFramesToFeatures = (frames: FrameSample[]): FrameFeature[] => {
    if (!primaryDef || !secondaryDef) return [];
    return frames.map((f) => {
      const primary = extractConfiguredAngle(f.landmarks, primaryDef);
      const secondary = extractConfiguredAngle(f.landmarks, secondaryDef);
      return {
        elbowAngle: Math.round(primary.mean * 10) / 10,
        shoulderAngle: Math.round(secondary.mean * 10) / 10,
        leftElbowAngle: primary.left !== undefined ? Math.round(primary.left * 10) / 10 : undefined,
        rightElbowAngle: primary.right !== undefined ? Math.round(primary.right * 10) / 10 : undefined,
        pinchDistance: 0,
        trunkCentroid: f.trunkCentroid
      };
    });
  };

  // Frame preview: draw the scrubbed frame's skeleton on a dark canvas.
  const previewFrame = baseFrames[Math.min(previewIndex, Math.max(0, baseFrames.length - 1))];

  // Redraw the skeleton preview whenever the scrubbed frame changes.
  const previewDrawRef = useRef<(() => void) | null>(null);
  previewDrawRef.current = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 960×540 buffer (16:9) — the canvas fills its card via .ai-frame-preview's
    // width:100%, so a 480px buffer would upscale and blur the skeleton.
    canvas.width = 960;
    canvas.height = 540;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (previewFrame) {
      // mirror: false — same reasoning as videoPoseScanner.ts's scan-preview
      // draw: these landmarks come from the raw (unmirrored) uploaded demo
      // clip, not a CSS-mirrored live camera feed.
      drawSkeleton(ctx, previewFrame.landmarks, canvas.width, canvas.height, { lineWidth: 6, jointRadius: 8, mirror: false });
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "26px sans-serif";
      ctx.fillText("Scan a demo clip to preview its skeleton", 48, canvas.height / 2);
    }
  };
  previewDrawRef.current();

  // Scans the base demo clip and auto-calibrates everything from it.
  const handleScanBaseClip = async () => {
    if (!baseClip || scanBusy) return;
    setScanBusy(true);
    setScanError(null);
    setScanProgressText("Scanning demo clip…");
    try {
      const frames = await scanVideoPoseFrames(
        baseClip,
        ({ currentTimeSeconds, durationSeconds, sampledFrames }) => {
          setScanProgressText(`Scanning ${currentTimeSeconds.toFixed(1)}s / ${durationSeconds.toFixed(1)}s — ${sampledFrames} frames tracked`);
        },
        // Live preview: the video frame + tracked skeleton, drawn while scanning.
        scanPreviewCanvasRef.current ? { canvas: scanPreviewCanvasRef.current } : undefined
      );
      if (frames.length < 10) {
        throw new Error("Too few trackable frames — make sure the full body is visible in the clip.");
      }
      const result = calibrateFromFrames(frames);
      setBaseFrames(frames);
      setCalibration(result);
      setSelectedPrimaryId(result.primary.id);
      setSelectedSecondaryId(result.secondary.id);
      setFsmConfig(result.derived.fsmConfig);
      setTargetRom(result.suggestedTargetRom);
      setRepSensitivityIndex(2);
      setPreviewIndex(0);
      // A new base clip invalidates any checkpoints marked on the previous one.
      setCheckpoints({ ready: null, active: null, return: null });
      setCheckpointLabelDraft("");
      setCheckpointDescDraft("");
      setActiveCheckpointRole("ready");
      const confidenceText = { high: "high confidence", medium: "medium confidence — verify the numbers", low: "low confidence — the clip may not contain a clear movement, please verify" }[result.derived.confidence];
      setScanProgressText(`Done — ${frames.length} frames analyzed. Suggested primary angle: “${result.primary.label}” (${confidenceText}).`);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scanning failed.");
      setScanProgressText(null);
    } finally {
      setScanBusy(false);
    }
  };

  // Recomputes ready/activation/return with the given strictness scale —
  // using the therapist's marked checkpoints when all three exist (reference
  // behavior: more accurate, matches their intent), else inferring from the
  // selected primary angle's series over the base clip.
  const deriveWithScale = (scale: number): ExerciseFSMConfig | null => {
    if (checkpoints.ready && checkpoints.active && checkpoints.return) {
      return deriveFsmConfigFromCheckpoints(
        checkpoints.ready.angle,
        checkpoints.active.angle,
        checkpoints.return.angle,
        scale
      ).fsmConfig;
    }
    if (!selectedPrimaryId || baseFrames.length === 0) return null;
    const def = getAngleDefinitionById(selectedPrimaryId);
    if (!def) return null;
    return deriveFsmConfigFromSeries(seriesFor(def), scale).fsmConfig;
  };

  /** Applies a derived FSM's threshold/comparator fields, keeping any manual
   * advanced-panel edits to minRepFrames / readyHoldSeconds / romReferenceAngle. */
  const applyDerivedThresholds = (derived: ExerciseFSMConfig | null) => {
    if (!derived) return;
    setFsmConfig((prev) =>
      prev
        ? {
            ...prev,
            readyAngleThreshold: derived.readyAngleThreshold,
            readyComparator: derived.readyComparator,
            activationThreshold: derived.activationThreshold,
            activationComparator: derived.activationComparator,
            returnThreshold: derived.returnThreshold,
            returnComparator: derived.returnComparator
          }
        : derived
    );
  };

  // Strictness slider — re-derives ready/activation/return thresholds from the
  // checkpoints (if marked) or the primary series, at the new scale.
  const handleSensitivityChange = (index: number) => {
    setRepSensitivityIndex(index);
    applyDerivedThresholds(deriveWithScale(sensitivityLevels[index].scale));
  };

  // Difficulty change resets strictness to the auto-suggested middle level.
  const handleDifficultyChange = (level: Difficulty) => {
    setDifficulty(level);
    setRepSensitivityIndex(2);
    applyDerivedThresholds(deriveWithScale(DEFAULT_FSM_MARGIN_SCALE));
  };

  /** Primary angle at the currently scrubbed base-clip frame. */
  const angleAtPreviewFrame = (): number | null => {
    const frame = baseFrames[previewIndex];
    const def = getAngleDefinitionById(selectedPrimaryId) ?? calibration?.primary.angleDefinition ?? null;
    if (!frame || !def) return null;
    return Math.round(extractConfiguredAngle(frame.landmarks, def).mean * 10) / 10;
  };

  // Therapist marks the scrubbed frame as the active checkpoint role: the
  // primary angle there is stored, and once all three roles exist the FSM
  // criteria are derived from those angles (reference behavior), then the UI
  // auto-advances to the next unmarked role.
  const handleMarkCheckpoint = () => {
    const angle = angleAtPreviewFrame();
    const frame = baseFrames[previewIndex];
    if (angle === null || !frame) return;
    const roleInfo = CHECKPOINT_ROLES.find((r) => r.role === activeCheckpointRole);
    const checkpoint: ExerciseCheckpoint = {
      role: activeCheckpointRole,
      label: checkpointLabelDraft.trim() || roleInfo?.title || activeCheckpointRole,
      description: checkpointDescDraft.trim() || undefined,
      timestampSeconds: frame.videoTimeSeconds,
      angle
    };
    const next = { ...checkpoints, [activeCheckpointRole]: checkpoint };
    setCheckpoints(next);

    if (next.ready && next.active && next.return) {
      const derived = deriveFsmConfigFromCheckpoints(
        next.ready.angle,
        next.active.angle,
        next.return.angle,
        sensitivityLevels[repSensitivityIndex].scale
      );
      setFsmConfig(derived.fsmConfig);
      setTargetRom(Math.max(10, Math.round(derived.range)));
    }

    setCheckpointLabelDraft("");
    setCheckpointDescDraft("");
    const nextRole = CHECKPOINT_ROLES.map((r) => r.role).find((role) => role !== activeCheckpointRole && !next[role]);
    if (nextRole) setActiveCheckpointRole(nextRole);
  };

  const handleClearCheckpoint = (role: CheckpointRole) => {
    setCheckpoints((prev) => ({ ...prev, [role]: null }));
  };

  // Selecting a role to edit prefills its drafts and jumps the scrubber to the
  // nearest already-marked time (reference behavior).
  const selectRoleForEditing = (role: CheckpointRole) => {
    setActiveCheckpointRole(role);
    const existing = checkpoints[role];
    if (existing) {
      setCheckpointLabelDraft(existing.label);
      setCheckpointDescDraft(existing.description ?? "");
      let bestIndex = 0;
      let bestDiff = Infinity;
      baseFrames.forEach((frame, index) => {
        const diff = Math.abs(frame.videoTimeSeconds - existing.timestampSeconds);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIndex = index;
        }
      });
      setPreviewIndex(bestIndex);
    } else {
      setCheckpointLabelDraft("");
      setCheckpointDescDraft("");
    }
  };


  // Scans an additional master take or wrong-form clip (same scanner).
  const handleScanExtraClip = async (kind: "master" | "wrong-form", file: File) => {
    if (scanBusy) return;
    setScanBusy(true);
    setScanError(null);
    setScanProgressText(`Scanning ${kind === "master" ? "master take" : "wrong-form clip"}…`);
    try {
      const frames = await scanVideoPoseFrames(
        file,
        ({ currentTimeSeconds, durationSeconds, sampledFrames }) => {
          setScanProgressText(`Scanning ${currentTimeSeconds.toFixed(1)}s / ${durationSeconds.toFixed(1)}s — ${sampledFrames} frames tracked`);
        },
        scanPreviewCanvasRef.current ? { canvas: scanPreviewCanvasRef.current } : undefined
      );
      const clip: ScannedClip = {
        id: Date.now(),
        description:
          (kind === "master" ? masterDescription : wrongFormDescription).trim() ||
          `${kind === "master" ? "Master take" : "Wrong-form clip"} #${(kind === "master" ? masterClips : wrongFormClips).length + 1}`,
        frames
      };
      if (kind === "master") {
        setMasterClips((prev) => [...prev, clip]);
        setMasterDescription("");
      } else {
        setWrongFormClips((prev) => [...prev, clip]);
        setWrongFormDescription("");
      }
      setScanProgressText(`Done — ${frames.length} frames added.`);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scanning failed.");
    } finally {
      setScanBusy(false);
    }
  };

  /** Assembles the poseReference payload (the shape the backend stores under
   * base_criteria.poseReference and scores against). */
  const buildPoseReference = () => {
    if (!primaryDef || !secondaryDef || !fsmConfig) return null;
    return {
      angleDefinition: primaryDef,
      secondaryAngleDefinition: secondaryDef,
      fsmConfig,
      targetRom,
      bveThreshold,
      enableTrunkBve,
      masterSamples: [
        {
          sampleId: 1,
          description: `Doctor Master Reference (${(targetExercise?.name ?? exerciseName).trim() || "Exercise"})`,
          totalFrames: baseFrames.length,
          frames: convertFramesToFeatures(baseFrames)
        },
        ...masterClips.map((clip, index) => ({
          sampleId: index + 2,
          description: clip.description,
          totalFrames: clip.frames.length,
          frames: convertFramesToFeatures(clip.frames)
        }))
      ],
      wrongFormSamples: wrongFormClips.map((clip, index) => ({
        sampleId: index + 1,
        description: clip.description,
        totalFrames: clip.frames.length,
        frames: convertFramesToFeatures(clip.frames)
      })),
      // Therapist-marked checkpoints — included only when all three exist
      // (reference behavior: a partial set would be worse than the generic
      // captions, since the session view falls back when the field is absent).
      checkpoints:
        checkpoints.ready && checkpoints.active && checkpoints.return
          ? [checkpoints.ready, checkpoints.active, checkpoints.return]
          : undefined
    };
  };

  const handleDownloadReference = () => {
    const reference = buildPoseReference();
    if (!reference) return;
    const blob = new Blob([JSON.stringify(reference, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reference_data.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Saves the authored reference. Two paths:
  //   • New exercise  — uploads the demo clip (it becomes the exercise's demo
  //     video) and creates a draft via POST /exercises.
  //   • Attach to an existing exercise — keeps that exercise's identity
  //     (name/description/difficulty) and merges poseReference into its base
  //     criteria: PATCH in place when it is still a draft, or a new draft
  //     version when it is active (BR-6 — active versions are immutable).
  const handleSave = async () => {
    if (!token || !isOwner || isArchived) return;
    const poseReference = (calibration ? buildPoseReference() : targetExercise?.baseCriteria.poseReference) ?? undefined;
    if (isPoseExercise && !poseReference) {
      setSaveError("Scan a demo clip to create the pose reference before saving.");
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
    try {
      let uploadedClipId: string | null = null;
      if (baseClip) {
        const { file: uploaded } = await uploadFile(token, baseClip);
        if (uploaded.fileType !== "video") {
          throw new Error("The selected demo file must be a video.");
        }
        uploadedClipId = uploaded.id;
      }

      if (targetExercise) {
        const payload = {
          name: exerciseName.trim(),
          description: exerciseDescription.trim(),
          movementTracking,
          difficultyLevel: difficulty,
          // Merge, never replace: keeps the exercise's manual criteria
          // (targetAngleDeg/repetitions/…) alongside the new AI reference.
          baseCriteria: isPoseExercise
            ? {
                ...targetExercise.baseCriteria,
                repetitions: repetitions ? Number(repetitions) : undefined,
                holdSeconds: holdSeconds ? Number(holdSeconds) : undefined,
                targetAngleDeg: targetRom,
                poseReference
              }
            : movementTracking === "virtual_grip"
              ? {
                  targetGripStrength: targetGripStrength ? Number(targetGripStrength) : undefined,
                  repetitions: repetitions ? Number(repetitions) : undefined,
                  holdSeconds: holdSeconds ? Number(holdSeconds) : undefined
                }
              : { repetitions: repetitions ? Number(repetitions) : undefined },
          demoVideoFileId: uploadedClipId ?? targetExercise.demoVideoFileId ?? null
        };
        if (targetExercise.status === "draft") {
          await updateExerciseDraft(token, targetExercise.id, payload);
          setSavedExerciseName(targetExercise.name);
        } else {
          const { exercise: created } = await createExerciseVersion(token, targetExercise.id, payload);
          setSavedExerciseName(`${created.name} (new draft v${created.versionNumber})`);
        }
        return;
      }

      if (isPoseExercise && !uploadedClipId) {
        throw new Error("Select the base demo clip — it is stored as the exercise's demo video.");
      }
      await createExercise(token, {
        name: exerciseName.trim(),
        description: exerciseDescription.trim(),
        movementTracking,
        difficultyLevel: difficulty,
        baseCriteria: isPoseExercise
          ? { repetitions: repetitions ? Number(repetitions) : undefined, holdSeconds: holdSeconds ? Number(holdSeconds) : undefined, targetAngleDeg: targetRom, poseReference }
          : movementTracking === "virtual_grip"
            ? { targetGripStrength: targetGripStrength ? Number(targetGripStrength) : undefined, repetitions: repetitions ? Number(repetitions) : undefined, holdSeconds: holdSeconds ? Number(holdSeconds) : undefined }
            : { repetitions: repetitions ? Number(repetitions) : undefined },
        demoVideoFileId: uploadedClipId
      });
      setSavedExerciseName(exerciseName.trim());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Saving failed.");
    } finally {
      setSaveBusy(false);
    }
  };

  const handleLifecycleAction = async (action: "publish" | "archive") => {
    if (!token || !targetExercise || !isOwner) return;
    setLifecycleBusy(action);
    setSaveError(null);
    try {
      if (action === "publish") await publishExercise(token, targetExercise.id);
      else await archiveExercise(token, targetExercise.id);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : `Couldn't ${action} this exercise.`);
    } finally {
      setLifecycleBusy(null);
    }
  };

  // New exercises need a name + the base clip (it becomes the demo video);
  // attaching to an existing exercise needs neither when it already has a name
  // and a demo video.
  const needsBaseClip = isPoseExercise && (!targetExercise || !targetExercise.demoVideoFileId);
  const canSave = Boolean(
    isOwner &&
      !isArchived &&
      exerciseName.trim() &&
      (!isPoseExercise || (calibration && fsmConfig && primaryDef && secondaryDef && baseFrames.length >= 10) || targetExercise?.baseCriteria.poseReference) &&
      (!needsBaseClip || baseClip)
  );

  // --- "Test exercise" run ------------------------------------------------
  // A pose test needs runnable AI criteria: either a fresh calibration (plus
  // the angle/FSM config derived from it) from this page, or a poseReference
  // already stored on the exercise being edited. Virtual-grip tests need
  // nothing extra; "none" has no AI tracking to exercise at all.
  const storedPoseReference = targetExercise?.baseCriteria.poseReference as unknown as PoseReferencePublic | undefined;
  const hasTestablePoseReference = Boolean(
    (calibration && fsmConfig && primaryDef && secondaryDef && baseFrames.length >= 10) || storedPoseReference
  );
  const testDisabledReason =
    !isOwner || isArchived
      ? "This exercise is read-only, so it can't be tested."
      : scanBusy
        ? "Wait for the current clip scan to finish before testing."
        : movementTracking === "none"
          ? "This exercise has no AI tracking to test."
          : isPoseExercise && !hasTestablePoseReference
            ? "Scan a base demo clip first — the test runs against the authored AI criteria."
            : null;
  const canTest = testDisabledReason === null;

  // Starts a test run: shims the current form into PatientSessionPage's
  // PatientExercise shape (the same approach App.tsx's Start Session uses) and
  // hands the just-authored criteria along as a SessionTestConfig. The session
  // itself is the patient flow (preroll → camera → tracking → STOP), with each
  // completed rep scored FOR REAL through POST /exercises/test-pose-rep-score
  // against the criteria passed here — saved or not. When it ends, its
  // onFinishRecording/onBack simply land back on this workspace — no upload,
  // no confirmation page, and the recording itself is discarded.
  const handleStartTest = () => {
    if (!canTest) return;
    // buildPoseReference() carries extra authoring fields (masterSamples etc.);
    // narrow it to the wire shape PatientSessionPage consumes. A stored
    // reference is used when the clip hasn't (re)been scanned this session —
    // or when the fresh calibration couldn't produce one.
    const poseReference = (
      isPoseExercise
        ? (calibration ? buildPoseReference() : null) ?? storedPoseReference ?? null
        : null
    ) as unknown as PoseReferencePublic | null;
    const demoVideoUrl = baseClip ? URL.createObjectURL(baseClip) : null;
    setTestSession({
      exercise: {
        // Library id when editing an existing row (harmless in a test — no
        // backend call uses it), a synthetic id for a brand-new exercise.
        id: targetExercise?.id ?? "ai-authoring-test",
        name: exerciseName.trim() || "AI test exercise",
        trackingType: movementTracking === "virtual_grip" ? "virtual_grip" : "pose",
        targetLabel: `${Number(repetitions) || 0} reps`,
        progressLabel: `${Number(repetitions) || 0} reps`,
        status: "not_started",
        feedback: exerciseDescription.trim() || "Follow the movement instructions you authored.",
        durationMinutes: 0,
        sets: 0,
        reps: Number(repetitions) || 0,
        difficulty: difficulty === "easy" ? "Easy" : difficulty === "medium" ? "Moderate" : "Hard"
      },
      testConfig: { poseReference, exerciseLibraryId: targetExercise?.id ?? null, demoVideoUrl }
    });
    setTestPaused(false);
    setTestNote(null);
  };

  // Ends the test run — whether it finished (STOP / all prescribed reps done)
  // or was abandoned (Exit / Discard & exit). Releases the local demo-clip
  // object URL and returns to the authoring workspace; the RecordingResult and
  // pose summary are deliberately dropped, since a test never uploads anything.
  const closeTest = (note: string | null) => {
    const demoVideoUrl = testSession?.testConfig.demoVideoUrl;
    if (demoVideoUrl) URL.revokeObjectURL(demoVideoUrl);
    setTestSession(null);
    setTestPaused(false);
    setTestNote(note);
  };

  // Test run in progress — the same immersive PatientSessionPage patients get,
  // rendered INSTEAD of the authoring workspace (this component stays mounted,
  // so no authored state is lost). It comes straight back here on finish/exit.
  if (testSession) {
    return (
      <PatientSessionPage
        exercise={testSession.exercise}
        paused={testPaused}
        lowConfidence={false}
        testConfig={testSession.testConfig}
        onBack={() => closeTest("Test session ended — nothing was uploaded · จบการทดสอบ — ไม่มีการอัปโหลด")}
        onRestart={() => setTestPaused(false)}
        onTogglePause={() => setTestPaused((value) => !value)}
        onFinishRecording={() =>
          closeTest(
            "Test session finished — the take was discarded, nothing was uploaded · จบการทดสอบ — บันทึกนี้ถูกยกเลิก ไม่มีการอัปโหลด"
          )
        }
      />
    );
  }

  return (
    <section className="therapist-shell exercise-creation-page">
      {isAdmin ? (
        <AdminSidebar activeLabel="Exercise Library" onNavigate={onNavigate} onLogout={onLogout} />
      ) : (
        <TherapistSidebar activeLabel="Exercise Library" onNavigate={onNavigate} onLogout={onLogout} />
      )}
      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div className="creation-topbar-title">
            <Dumbbell size={20} />
            <div>
              <strong>AI Exercise Workspace</strong>
              <span>Author a pose reference from demo clips</span>
            </div>
          </div>
          <div className="therapist-topbar-profile">
            <div><strong>{displayName}</strong><small>Physical Therapist</small></div>
            <span className="avatar-badge">{initialsFromName(displayName)}</span>
          </div>
        </header>

        <main className="therapist-main exercise-creation-main ai-workspace-main">
          <button type="button" className="text-action pd-back-link" onClick={onBack}>
            <ArrowLeft size={14} /> {isVersionView ? "Back to the Exercise Library" : "Back to exercise creation"}
          </button>

          {/* Page heading */}
          <div className="ai-workspace-heading" style={{ marginBottom: 20 }}>
            <div>
              <h1>{exerciseName.trim() || "AI Reference Authoring"}</h1>
            </div>
            {/* Test the exercise live against the camera with the criteria on
                screen right now — the patient session flow, minus the upload /
                confirmation step: it lands back on this page when finished. */}
            <button
              type="button"
              className="secondary-button"
              onClick={handleStartTest}
              disabled={!canTest}
              title={
                testDisabledReason ??
                "Run this exercise against the live camera using the criteria you've authored. Nothing is uploaded — you return here when the test ends."
              }
            >
              <Play size={16} /> Test exercise · ทดสอบท่า
            </button>
          </div>

          {/* Result of the last test run — a test always discards its take, so
              there is never an upload/confirmation step to walk through. */}
          {testNote && (
            <div className="ai-banner ai-banner-success">
              <CheckCircle2 size={20} />
              <div>
                <strong>Test run complete</strong>
                <div>{testNote}</div>
              </div>
            </div>
          )}

          {/* Success banner */}
          {savedExerciseName && (
            <div className="ai-banner ai-banner-success">
              <CheckCircle2 size={20} />
              <div>
                <strong>Exercise created successfully!</strong>
                <div>"{savedExerciseName}" was saved as a draft. You can publish it anytime from the Exercise Library.</div>
              </div>
            </div>
          )}

          {/* Version-history drill-in (App's openExerciseVersion): the row in hand
              is ONE link in the family's version chain, so state which one it is,
              when it was created and the criteria it carries before the workspace
              below. Superseded rows are archived by POST /exercises/:id/versions,
              so the existing read-only gate + the lifecycle bar's own status line
              already make this an audit view — nothing new to lock down here. */}
          {isVersionView && targetExercise && (
            <div className="ai-version-view-banner">
              <History size={16} />
              <div>
                <strong>
                  Version history · v{targetExercise.versionNumber}
                  {targetExercise.versions.length > 1 ? ` of ${targetExercise.versions.length}` : ""} · {targetExercise.name}
                </strong>
                <div>
                  Created {targetExercise.createdAtLabel} by {targetExercise.createdByName || "Therapist"} ·{" "}
                  {describeCriteria(targetExercise.baseCriteria)}
                </div>
              </div>
            </div>
          )}

          {targetExercise && (
            <div className={`ai-lifecycle-bar ${targetExercise.status}`}>
              <div>
                <strong>{targetExercise.name} · v{targetExercise.versionNumber}</strong>
                <span>{targetExercise.status === "active" ? "Active — saving edits creates a new draft version." : targetExercise.status === "draft" ? "Draft — changes save to this version." : "Archived — this version is read-only."}</span>
              </div>
              {isOwner && !isArchived && (
                <div className="ai-lifecycle-actions">
                  {targetExercise.status === "draft" && <button type="button" className="secondary-button" disabled={lifecycleBusy !== null} onClick={() => void handleLifecycleAction("publish")}>{lifecycleBusy === "publish" ? "Publishing…" : "Publish"}</button>}
                  <button type="button" className="text-action danger" disabled={lifecycleBusy !== null} onClick={() => void handleLifecycleAction("archive")}>{lifecycleBusy === "archive" ? "Archiving…" : <><Archive size={14} /> Archive</>}</button>
                </div>
              )}
            </div>
          )}

          {/* A non-pose row never reaches Step 2 — manual mode hides every
              pose-authoring card above the criteria card — so a history view of
              one plays that version's saved demo clip here instead. Same source
              as Step 2's player (the effect above resolves
              targetExercise.demoVideoFileId through GET /files/:id/content), and
              it sits OUTSIDE the read-only stack, so the transport controls stay
              usable. */}
          {isVersionView && !isPoseExercise && targetExercise?.demoVideoFileId && (
            <div className="ai-version-view-clip">
              {savedDemoUrl ? (
                <video className="ai-demo-video" src={savedDemoUrl} controls playsInline preload="metadata" />
              ) : savedDemoState === "loading" ? (
                <p className="ai-progress">Loading saved demo video… · กำลังโหลดวิดีโอสาธิต…</p>
              ) : savedDemoState === "error" ? (
                <p className="ai-error">Couldn't load the saved demo video. · โหลดวิดีโอสาธิตไม่สำเร็จ</p>
              ) : null}
            </div>
          )}

          {!isOwner && targetExercise && (
            <div className="library-warning-banner">
              <AlertTriangle size={16} /> This exercise was created by {targetExercise.createdByName || "another therapist"}. It is open in read-only mode.
            </div>
          )}

          {/* Mixed step flow: paired two-column rows (1 | 2, 3 | 4, 7 | 8) with the dense steps (5, 6, 9) spanning both columns. */}
          <div className={`ai-author-stack ${isPoseExercise ? "" : "manual"} ${!isOwner || isArchived ? "readonly" : ""}`}>

              {/* Step 1 — Exercise Identity */}
              <section className="creation-section-card ai-setup-card">
                <div className="ai-card-step-tag">ขั้นตอนที่ 1 · การตั้งค่าท่า</div>
                <div className="creation-section-header">
                  <Dumbbell size={20} />
                  <div>
                    <strong>การตั้งค่าท่า</strong>
                  </div>
                </div>
                <div className="ai-field">
                  <label>ชื่อของท่า</label>
                  <input
                    className="ai-input"
                    value={exerciseName}
                    onChange={(e) => setExerciseName(e.target.value)}
                    placeholder="เช่น การยืดข้อศอกสองข้าง"
                  />
                </div>
                <div className="ai-field">
                  <label>ระดับความยากของท่า</label>
                  <div className="ai-choice-row">
                    {(["easy", "medium", "hard"] as Difficulty[]).map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`ai-choice ${difficulty === level ? "active" : ""}`}
                        onClick={() => handleDifficultyChange(level)}
                      >
                        {DIFFICULTY_LABELS_TH[level]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ai-field">
                  <label>การติดตามท่าทาง</label>
                  <select
                    className="ai-input"
                    value={movementTracking}
                    disabled={Boolean(targetExercise) || isArchived || !isOwner}
                    onChange={(event) => setMovementTracking(event.target.value as ExerciseTrackingType)}
                  >
                    <option value="pose">ติดตามท่าทาง (Pose)</option>
                    <option value="virtual_grip">การจับเสมือน (Virtual grip)</option>
                    <option value="none">ไม่ติดตามด้วย AI</option>
                  </select>
                </div>
                {/* Description sits last so its box absorbs the card's leftover
                    height (Step 1 shares its grid row with the taller Step 2). */}
                <div className="ai-field">
                  <label>คำอธิบายท่า</label>
                  <textarea
                    className="ai-input"
                    rows={3}
                    value={exerciseDescription}
                    onChange={(e) => setExerciseDescription(e.target.value)}
                    placeholder="คำอธิบายสั้นๆ เกี่ยวกับท่าที่ป่วยจะอ่านก่อนเริ่มออกกำลังกาย"
                    style={{ fontFamily: "inherit", resize: "vertical" }}
                  />
                </div>
              </section>

              {/* Step 2 — Base Demo Clip */}
              <section className="creation-section-card">
                <div className="ai-card-step-tag">Step 2 · Base Demo Clip</div>
                <div className="creation-section-header">
                  <Film size={20} />
                  <div>
                    <strong>Base demo clip</strong>
                    <p className="library-card-sub">One clean demonstration video to extract tracking angles &amp; rep thresholds.</p>
                  </div>
                </div>

                <label className="ai-file-upload-area">
                  <Upload size={24} className="ai-file-upload-icon" />
                  <span className="ai-file-upload-label">
                    {baseClip ? baseClip.name : "Click to select demo video (.mp4, .webm)"}
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    className="ai-file-hidden-input"
                    onChange={(e) => setBaseClip(e.target.files?.[0] ?? null)}
                    disabled={scanBusy}
                  />
                </label>

                {/* Replayable demo player — the freshly selected clip wins (it's
                    the one that was just scanned/will be uploaded); otherwise the
                    exercise's SAVED demo video streams back in, so the demo can be
                    replayed whenever this page is reopened later. Hidden while a
                    scan is running: the canvas below is the live scan preview and
                    the card should only ever show ONE video-like surface. */}
                {!scanBusy &&
                  (baseClipUrl || savedDemoUrl ? (
                    <>
                      <video
                        className="ai-demo-video"
                        src={baseClipUrl ?? savedDemoUrl ?? undefined}
                        controls
                        playsInline
                        preload="metadata"
                      />
                      <p className="library-card-sub" style={{ marginTop: 4 }}>
                        {baseClipUrl
                          ? "Selected clip — replay it any time · คลิปที่เลือก — ดูซ้ำได้ตลอด"
                          : "Saved demo video — replay it any time · วิดีโอสาธิตที่บันทึกไว้ — ดูซ้ำได้ตลอด"}
                      </p>
                    </>
                  ) : savedDemoState === "loading" ? (
                    <p className="ai-progress">Loading saved demo video… · กำลังโหลดวิดีโอสาธิต…</p>
                  ) : savedDemoState === "error" ? (
                    <p className="ai-error">Couldn't load the saved demo video. · โหลดวิดีโอสาธิตไม่สำเร็จ</p>
                  ) : null)}

                {/* Live scan preview — the video frame plus the tracked skeleton,
                    drawn for every scanned frame (reference CreateExerciseView
                    behavior). Doubles as the "no pose detected" warning surface.
                    Kept ALWAYS MOUNTED (handleScanBaseClip reads this ref
                    synchronously the moment Scan is pressed, before React can
                    re-render) but hidden via display whenever no scan is running —
                    the scanner only draws into the attribute-sized canvas, so it
                    doesn't need to be visible to work, and the demo player above
                    becomes the card's single video surface when idle. */}
                <canvas
                  ref={scanPreviewCanvasRef}
                  className="ai-frame-preview"
                  width={480}
                  height={270}
                  style={{ display: scanBusy ? "block" : "none" }}
                />

                <button
                  type="button"
                  className="primary-button"
                  style={{ width: "100%", marginTop: 12, justifyContent: "center" }}
                  onClick={handleScanBaseClip}
                  disabled={!baseClip || scanBusy}
                >
                  {scanBusy ? <Loader2 size={16} className="spin-icon" /> : <Upload size={16} />}
                  Scan &amp; Calibrate
                </button>
                {scanProgressText && <p className="ai-progress">{scanProgressText}</p>}
                {scanError && <p className="ai-error">{scanError}</p>}
              </section>

              {/* Step 3 — Extra Master Takes (optional) */}
              <section className={`creation-section-card${!calibration ? " ai-card-locked" : ""}`}>
                <div className="ai-card-step-tag">Step 3 · Extra Master Takes (optional)</div>
                <div className="creation-section-header">
                  <Film size={20} />
                  <div>
                    <strong>
                      Extra master takes
                      {masterClips.length > 0 && <span className="ai-clip-count">{masterClips.length}</span>}
                      {" "}<small>(optional)</small>
                    </strong>
                    <p className="library-card-sub">Additional correct demonstrations to improve DTW matching variance.</p>
                  </div>
                </div>
                <div className="ai-field">
                  <label>Take description</label>
                  <input
                    className="ai-input"
                    value={masterDescription}
                    onChange={(e) => setMasterDescription(e.target.value)}
                    placeholder="e.g. Take 2, slightly faster tempo"
                    disabled={scanBusy || !calibration}
                  />
                </div>
                <label className="ai-file-upload-area ai-file-upload-area-sm">
                  <Upload size={16} className="ai-file-upload-icon" />
                  <span className="ai-file-upload-label">Upload additional master clip</span>
                  <input
                    type="file"
                    accept="video/*"
                    className="ai-file-hidden-input"
                    disabled={scanBusy || !calibration}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleScanExtraClip("master", f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {masterClips.length > 0 && (
                  <div className="ai-clip-list">
                    {masterClips.map((clip) => (
                      <div className="ai-clip-row" key={clip.id}>
                        <CheckCircle2 size={14} className="ai-clip-ok" />
                        <span style={{ flex: 1 }}>{clip.description}</span>
                        <small>{clip.frames.length} frames</small>
                        <button
                          type="button"
                          className="text-action danger"
                          aria-label="Remove"
                          onClick={() => setMasterClips((prev) => prev.filter((c) => c.id !== clip.id))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Step 4 — Wrong-Form Clips (optional) */}
              <section className={`creation-section-card${!calibration ? " ai-card-locked" : ""}`}>
                <div className="ai-card-step-tag">Step 4 · Wrong-Form Clips (optional)</div>
                <div className="creation-section-header">
                  <Film size={20} />
                  <div>
                    <strong>
                      Wrong-form clips
                      {wrongFormClips.length > 0 && <span className="ai-clip-count ai-clip-count-err">{wrongFormClips.length}</span>}
                      {" "}<small>(optional)</small>
                    </strong>
                    <p className="library-card-sub">Demonstrations of incorrect posture to train form boundary checks.</p>
                  </div>
                </div>
                <div className="ai-field">
                  <label>Form defect description</label>
                  <input
                    className="ai-input"
                    value={wrongFormDescription}
                    onChange={(e) => setWrongFormDescription(e.target.value)}
                    placeholder="e.g. Trunk leaning forward, shoulder hike"
                    disabled={scanBusy || !calibration}
                  />
                </div>
                <label className="ai-file-upload-area ai-file-upload-area-sm">
                  <Upload size={16} className="ai-file-upload-icon" />
                  <span className="ai-file-upload-label">Upload wrong-form video clip</span>
                  <input
                    type="file"
                    accept="video/*"
                    className="ai-file-hidden-input"
                    disabled={scanBusy || !calibration}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleScanExtraClip("wrong-form", f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {wrongFormClips.length > 0 && (
                  <div className="ai-clip-list">
                    {wrongFormClips.map((clip) => (
                      <div className="ai-clip-row" key={clip.id}>
                        <CheckCircle2 size={14} className="ai-clip-ok" />
                        <span style={{ flex: 1 }}>{clip.description}</span>
                        <small>{clip.frames.length} frames</small>
                        <button
                          type="button"
                          className="text-action danger"
                          aria-label="Remove"
                          onClick={() => setWrongFormClips((prev) => prev.filter((c) => c.id !== clip.id))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Step 5 — Scanned Frame Preview */}
              <section className="creation-section-card">
                <div className="ai-card-step-tag">Step 5 · Verify Tracked Frames</div>
                <div className="creation-section-header">
                  <Film size={20} />
                  <div>
                    <strong>Scanned skeleton preview</strong>
                    <p className="library-card-sub">Scrub through the tracked skeleton frames of your base clip.</p>
                  </div>
                </div>

                <canvas ref={previewCanvasRef} className="ai-frame-preview" width={480} height={270} />

                <div style={{ marginTop: 12 }}>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, baseFrames.length - 1)}
                    value={Math.min(previewIndex, Math.max(0, baseFrames.length - 1))}
                    onChange={(e) => setPreviewIndex(Number(e.target.value))}
                    disabled={baseFrames.length === 0}
                    style={{ width: "100%", accentColor: "var(--primary)" }}
                    aria-label="Preview frame"
                  />
                  <p className="library-card-sub" style={{ marginTop: 4 }}>
                    {baseFrames.length > 0
                      ? `Frame ${Math.min(previewIndex, baseFrames.length - 1) + 1} / ${baseFrames.length} · Timestamp: ${(previewFrame?.videoTimeSeconds ?? 0).toFixed(2)}s`
                      : "No frames scanned yet."}
                  </p>
                </div>
              </section>

              {/* Step 6 — Checkpoint marking (reference CreateExerciseView):
                  mark the starting position / peak / return frames on the base
                  clip; all three angles re-derive the FSM criteria directly. */}
              <section className={`creation-section-card${!calibration ? " ai-card-locked" : ""}`}>
                <div className="ai-card-step-tag">Step 6 · Movement Checkpoints (optional)</div>
                <div className="creation-section-header">
                  <Flag size={20} />
                  <div>
                    <strong>
                      Checkpoints
                      {allCheckpointsSet && <span className="ai-clip-count">{CHECKPOINT_ROLES.length}</span>}
                    </strong>
                    <p className="library-card-sub">
                      Scrub the preview to each movement moment and mark it — when all three are marked the rep
                      thresholds come from your own reference frames instead of statistics.
                    </p>
                  </div>
                </div>

                <div className="ai-checkpoint-grid">
                  {CHECKPOINT_ROLES.map(({ role, title, icon }) => (
                    <button
                      key={role}
                      type="button"
                      className={`ai-checkpoint-card${activeCheckpointRole === role ? " active" : ""}`}
                      onClick={() => selectRoleForEditing(role)}
                      disabled={!calibration}
                    >
                      <span className="ai-checkpoint-number">{checkpoints[role] ? "✓" : icon}</span>
                      <div>
                        <strong>{title}</strong>
                        <small>
                          {checkpoints[role]
                            ? `${checkpoints[role]!.angle}° · ${checkpoints[role]!.timestampSeconds.toFixed(2)}s`
                            : "not marked yet"}
                        </small>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="ai-field">
                  <label>Checkpoint name</label>
                  <input
                    className="ai-input"
                    value={checkpointLabelDraft}
                    onChange={(e) => setCheckpointLabelDraft(e.target.value)}
                    placeholder={CHECKPOINT_ROLES.find((r) => r.role === activeCheckpointRole)?.hint}
                    disabled={!calibration}
                  />
                </div>
                <div className="ai-field">
                  <label>Description (optional) — shown to the patient at this moment</label>
                  <textarea
                    className="ai-input"
                    value={checkpointDescDraft}
                    onChange={(e) => setCheckpointDescDraft(e.target.value)}
                    placeholder="e.g. Extend the elbow fully without shrugging"
                    style={{ minHeight: 54, fontFamily: "inherit", resize: "vertical" }}
                    disabled={!calibration}
                  />
                </div>

                <button
                  type="button"
                  className="primary-button"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={handleMarkCheckpoint}
                  disabled={!calibration || baseFrames.length === 0}
                >
                  📌 Mark this frame as “{CHECKPOINT_ROLES.find((r) => r.role === activeCheckpointRole)?.title}”
                </button>
                <p className="ai-progress">
                  {baseFrames.length > 0
                    ? `Selected frame ${Math.min(previewIndex, baseFrames.length - 1) + 1} · primary angle here: ${
                        angleAtPreviewFrame() ?? "—"
                      }°`
                    : "Scan a demo clip first."}
                  {allCheckpointsSet ? " — rep thresholds are now derived from your checkpoints." : ""}
                </p>

                {CHECKPOINT_ROLES.filter(({ role }) => checkpoints[role]).length > 0 && (
                  <div className="ai-checkpoint-list">
                    {CHECKPOINT_ROLES.map(({ role, title }) => {
                      const checkpoint = checkpoints[role];
                      if (!checkpoint) return null;
                      return (
                        <div className="ai-checkpoint-item" key={role}>
                          <div>
                            <strong>{title}: {checkpoint.label}</strong>
                            {checkpoint.description && <p>{checkpoint.description}</p>}
                            <small>{checkpoint.timestampSeconds.toFixed(2)}s · {checkpoint.angle}°</small>
                          </div>
                          <button type="button" className="text-action danger" onClick={() => handleClearCheckpoint(role)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Step 7 — Save to Library */}
              <section className="creation-section-card ai-card-full">
                <div className="ai-card-step-tag">Step 7 · Save to Library</div>
                <div className="creation-section-header">
                  <Save size={20} />
                  <div>
                    <strong>Save exercise criteria</strong>
                    <p className="library-card-sub">Persist this authored reference and criteria to the exercise library.</p>
                  </div>
                </div>

                <div className="ai-field">
                  <label>Save as</label>
                  <select
                    className="ai-input"
                    value={targetExerciseId}
                    onChange={(e) => setTargetExerciseId(e.target.value)}
                  >
                    <option value="new">New exercise (from the setup above)</option>
                    {libraryExercises.map((item) => (
                      <option key={item.id} value={item.id}>
                        Attach to: {item.name} (v{item.versionNumber} · {item.status})
                      </option>
                    ))}
                  </select>
                  {targetExercise ? (
                    <>
                      <p className="library-card-sub" style={{ marginTop: 4 }}>
                        Keeps “{targetExercise.name}” (name, description, difficulty) and merges the AI reference into
                        its criteria
                        {targetExercise.baseCriteria.poseReference
                          ? " — it already has a pose reference, which will be replaced."
                          : "."}
                      </p>
                      {targetExercise.status === "active" && (
                        <>
                          <p className="library-card-sub">
                            This version is active, so saving creates a new draft version (v{targetExercise.versionNumber + 1})
                            — publish it from the library when you're happy.
                          </p>
                          <p className="ai-advanced-warning" style={{ marginTop: 6 }}>
                            ⚠️ Patients' scheduled exercises still point at the current published version — after
                            publishing, re-add/update this exercise in their plan so the new reference reaches sessions.
                          </p>
                        </>
                      )}
                      {!targetExercise.demoVideoFileId && !baseClip && (
                        <p className="ai-error">This exercise has no demo video yet — select a base clip to add one.</p>
                      )}
                    </>
                  ) : (
                    <p className="library-card-sub" style={{ marginTop: 4 }}>
                      Creates a new draft exercise using the name above; the base clip becomes its demo video.
                    </p>
                  )}
                </div>

                <div className="ai-field">
                  <label>Rep-counting strictness level</label>
                  <select
                    className="ai-input"
                    value={repSensitivityIndex}
                    onChange={(e) => handleSensitivityChange(Number(e.target.value))}
                    disabled={!calibration}
                  >
                    {sensitivityLevels.map((level, index) => (
                      <option key={level.label} value={index}>{level.label}</option>
                    ))}
                  </select>
                  <p className="library-card-sub" style={{ marginTop: 4 }}>
                    {sensitivityLevels[repSensitivityIndex].desc} (difficulty {DIFFICULTY_INFO[difficulty].icon}{" "}
                    {difficulty} allows {DIFFICULTY_INFO[difficulty].rangeText} around the analyzed value)
                  </p>
                </div>

                {/* Target ROM — slider bounded to the measured range ±40%/160%
                    (reference behavior), with the clinic's measured value shown. */}
                <div className="ai-field">
                  <label>Target ROM (°) — patient must move at least this far per rep</label>
                  <input
                    type="range"
                    min={Math.max(5, Math.round((calibration?.derived.range ?? targetRom) * 0.4))}
                    max={Math.round((calibration?.derived.range ?? targetRom) * 1.6) || 180}
                    value={targetRom}
                    onChange={(e) => setTargetRom(Number(e.target.value))}
                    disabled={!calibration}
                    style={{ width: "100%", accentColor: "var(--primary)" }}
                  />
                  <div className="ai-slider-row">
                    <span className="library-card-sub">Lenient</span>
                    <input
                      className="ai-input"
                      type="number"
                      min={5}
                      max={180}
                      value={targetRom}
                      onChange={(e) => setTargetRom(Number(e.target.value) || 0)}
                      disabled={!calibration}
                      style={{ width: 88, textAlign: "center" }}
                    />
                    <span className="library-card-sub">Strict</span>
                  </div>
                  {calibration && (
                    <p className="library-card-sub">
                      Measured from the demo clip: ±{Math.round(calibration.derived.range)}°
                    </p>
                  )}
                </div>

                {/* Trunk-compensation sensitivity as labeled presets (reference
                    BVE_SENSITIVITY_LEVELS) instead of a raw number. */}
                <div className="ai-field">
                  <label>Trunk-compensation sensitivity (BVE)</label>
                  <div className="ai-choice-row">
                    {BVE_SENSITIVITY_LEVELS.map((level) => (
                      <button
                        key={level.value}
                        type="button"
                        className={`ai-choice small ${Math.abs(bveThreshold - level.value) < 1e-6 ? "active" : ""}`}
                        onClick={() => setBveThreshold(level.value)}
                        disabled={!calibration}
                        title={level.desc}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                  <p className="library-card-sub" style={{ marginTop: 4 }}>
                    {BVE_SENSITIVITY_LEVELS.find((l) => Math.abs(l.value - bveThreshold) < 1e-6)?.desc ??
                      `Custom trunk-sway sensitivity: ${bveThreshold}`}
                  </p>
                </div>

                <label className="ai-check">
                  <input
                    type="checkbox"
                    checked={enableTrunkBve}
                    onChange={(e) => setEnableTrunkBve(e.target.checked)}
                    disabled={!calibration}
                  />
                  Penalize trunk-lean compensation (BVE)
                </label>

                <div className="ai-save-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleSave}
                    disabled={!canSave || saveBusy}
                  >
                    {saveBusy ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                    Create Exercise
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleDownloadReference}
                    disabled={!calibration}
                  >
                    Download reference_data.json
                  </button>
                </div>

                {saveError && <p className="ai-error">{saveError}</p>}
                {savedExerciseName && (
                  <p className="ai-success">
                    <CheckCircle2 size={16} /> “{savedExerciseName}” was created as a draft — publish it from the
                    Exercise Library.
                  </p>
                )}
              </section>

              <section className="creation-section-card ai-manual-criteria-card ai-card-full">
                <div className="ai-card-step-tag">Step 2 · Exercise criteria</div>
                <div className="creation-section-header">
                  {movementTracking === "virtual_grip" ? <Hand size={20} /> : <Dumbbell size={20} />}
                  <div>
                    <strong>{movementTracking === "virtual_grip" ? "Virtual grip criteria" : "Exercise criteria"}</strong>
                    <p className="library-card-sub">Set the criteria used when this activity is assigned to a patient.</p>
                  </div>
                </div>
                {movementTracking === "virtual_grip" && (
                  <label className="ai-field">Target grip strength
                    <input className="ai-input" type="number" min="0" value={targetGripStrength} onChange={(event) => setTargetGripStrength(event.target.value)} disabled={isArchived || !isOwner} />
                  </label>
                )}
                <label className="ai-field">Repetitions
                  <input className="ai-input" type="number" min="1" value={repetitions} onChange={(event) => setRepetitions(event.target.value)} disabled={isArchived || !isOwner} />
                </label>
                {movementTracking === "virtual_grip" && (
                  <label className="ai-field">Hold duration (seconds)
                    <input className="ai-input" type="number" min="0" value={holdSeconds} onChange={(event) => setHoldSeconds(event.target.value)} disabled={isArchived || !isOwner} />
                  </label>
                )}
                <div className="ai-save-actions">
                  <button type="button" className="primary-button" onClick={handleSave} disabled={!canSave || saveBusy}>
                    {saveBusy ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                    {targetExercise?.status === "active" ? `Save as v${targetExercise.versionNumber + 1} draft` : targetExercise ? "Save changes" : "Create draft"}
                  </button>
                </div>
                {saveError && <p className="ai-error">{saveError}</p>}
              </section>

          </div>
        </main>
      </div>
    </section>
  );
}
