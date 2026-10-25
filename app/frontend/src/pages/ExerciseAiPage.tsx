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

import { AlertTriangle, Archive, ArrowLeft, CheckCircle2, Dumbbell, Film, Hand, History, Loader2, Minus, Pause, Play, Plus, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { AdminSidebar } from "../components/AdminSidebar";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { useAuth } from "../store/authStore";
import { drawSkeleton } from "../ai/poseDetection";
import {
  DEFAULT_FSM_MARGIN_SCALE,
  calibrateFromFrames,
  deriveFsmConfigFromCheckpoints,
  deriveFsmConfigFromSeries,
  rankCandidates,
  type CalibrationResult,
  type FrameSample,
  type ScoredCandidate
} from "../ai/poseScoring/exerciseAutoCalibrator";
import { scanVideoPoseFrames } from "../ai/poseScoring/videoPoseScanner";
import { extractConfiguredAngle } from "../ai/poseScoring/angleExtraction";
import { inferTechniqueFlags, techniqueFramesFromLandmarks } from "../ai/poseScoring/exerciseTechniqueFlags";
import type { ExerciseFSMConfig, FrameFeature, AngleDefinition, PoseReferencePublic } from "../ai/poseScoring/poseScoringTypes";
import { ApiError, archiveExercise, createExercise, createExerciseVersion, getFileContent, publishExercise, updateExerciseDraft, uploadFile } from "../services/api";
import type { ExerciseBaseCriteria, ExerciseLibraryDifficulty, ExerciseLibraryItem, ExerciseTrackingType, HandTrackingGameType, PatientExercise } from "../types";
import { PatientSessionPage } from "./PatientSessionPage";
import type { SessionTestConfig } from "./PatientSessionPage";

interface ExerciseAiPageProps {
  exercise?: ExerciseLibraryItem | null;
  initialName?: string;
  initialTracking?: ExerciseTrackingType;
  onBack: () => void;
  onSaved: () => void;
  onCreated: (name: string) => void;
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

interface StoredPoseReference extends PoseReferencePublic, Record<string, unknown> {
  checkpoints?: ExerciseCheckpoint[];
  poseFrames?: StoredPoseFrame[];
  movementLandmarks?: MovementLandmarkIndices;
}

interface StoredPoseFrame {
  landmarks: Array<[number, number, number, number?]>;
  trunkCentroid: { x: number; y: number };
  timestampMs: number;
  videoTimeSeconds: number;
}

type MovementLandmarkRole = "start" | "middle" | "end";

interface MovementLandmarkIndices {
  startFrameIndex: number;
  middleFrameIndex: number;
  endFrameIndex: number;
}

const DEFAULT_MOVEMENT_LANDMARKS: MovementLandmarkIndices = {
  startFrameIndex: 0,
  middleFrameIndex: 1,
  endFrameIndex: 2
};

function defaultMovementLandmarks(frameCount: number): MovementLandmarkIndices {
  if (frameCount < 3) return DEFAULT_MOVEMENT_LANDMARKS;
  return {
    startFrameIndex: 0,
    middleFrameIndex: Math.floor((frameCount - 1) / 2),
    endFrameIndex: frameCount - 1
  };
}

function validMovementLandmarks(value: MovementLandmarkIndices | undefined, frameCount: number): MovementLandmarkIndices {
  if (
    value &&
    Number.isInteger(value.startFrameIndex) &&
    Number.isInteger(value.middleFrameIndex) &&
    Number.isInteger(value.endFrameIndex) &&
    value.startFrameIndex >= 0 &&
    value.startFrameIndex < value.middleFrameIndex &&
    value.middleFrameIndex < value.endFrameIndex &&
    value.endFrameIndex < frameCount
  ) {
    return value;
  }
  return defaultMovementLandmarks(frameCount);
}

function movementLandmarkFrameIndex(indices: MovementLandmarkIndices, role: MovementLandmarkRole): number {
  if (role === "start") return indices.startFrameIndex;
  if (role === "middle") return indices.middleFrameIndex;
  return indices.endFrameIndex;
}

function isStoredPoseFrame(value: unknown): value is StoredPoseFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<StoredPoseFrame>;
  return (
    Number.isFinite(frame.timestampMs) &&
    Number.isFinite(frame.videoTimeSeconds) &&
    Boolean(frame.trunkCentroid && Number.isFinite(frame.trunkCentroid.x) && Number.isFinite(frame.trunkCentroid.y)) &&
    Array.isArray(frame.landmarks) &&
    frame.landmarks.length >= 33 &&
    frame.landmarks.every((landmark) =>
      Boolean(
        Array.isArray(landmark) &&
          landmark.length >= 3 &&
          Number.isFinite(landmark[0]) &&
          Number.isFinite(landmark[1]) &&
          Number.isFinite(landmark[2]) &&
          (landmark[3] === undefined || Number.isFinite(landmark[3]))
      )
    )
  );
}

function serializePoseFrames(frames: FrameSample[], preserveAllFrames = false): StoredPoseFrame[] {
  return frames
    .filter((_, index) => preserveAllFrames || index % 3 === 0)
    .map(({ landmarks, trunkCentroid, timestampMs, videoTimeSeconds }) => ({
      landmarks: landmarks.map(({ x, y, z, visibility }): [number, number, number, number?] =>
        visibility === undefined
          ? [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000, Math.round(z * 10000) / 10000]
          : [
              Math.round(x * 10000) / 10000,
              Math.round(y * 10000) / 10000,
              Math.round(z * 10000) / 10000,
              Math.round(visibility * 100) / 100
            ]
      ),
      trunkCentroid,
      timestampMs,
      videoTimeSeconds
    }));
}

/** The 3 FSM states the therapist marks on the base clip (reference order). */
const CHECKPOINT_ROLES: { role: CheckpointRole; title: string; icon: string }[] = [
  { role: "ready", title: "ท่าเริ่มต้น", icon: "📍" },
  { role: "active", title: "ท่าเป้าหมาย", icon: "💪" },
  { role: "return", title: "กลับสู่ท่าเริ่มต้น", icon: "🔁" }
];

const MOVEMENT_LANDMARK_ROLES: { role: MovementLandmarkRole; label: string; colorClass: string }[] = [
  { role: "start", label: "ท่าเริ่มต้น", colorClass: "start" },
  { role: "middle", label: "ท่าเป้าหมาย", colorClass: "middle" },
  { role: "end", label: "กลับสู่ท่าเริ่มต้น", colorClass: "end" }
];

const CHECKPOINT_LANDMARK_ROLES: Record<CheckpointRole, MovementLandmarkRole> = {
  ready: "start",
  active: "middle",
  return: "end"
};

const CHECKPOINT_ROLE_BY_LANDMARK: Record<MovementLandmarkRole, CheckpointRole> = {
  start: "ready",
  middle: "active",
  end: "return"
};

function describeCriteriaThai(criteria: ExerciseBaseCriteria): string {
  const parts: string[] = [];
  if (criteria.targetAngleDeg !== undefined) parts.push(`มุมเป้าหมาย ${criteria.targetAngleDeg}°`);
  if (criteria.targetGripStrength !== undefined) parts.push(`แรงบีบมือ ${criteria.targetGripStrength}`);
  if (criteria.repetitions !== undefined) parts.push(`${criteria.repetitions} ครั้ง`);
  if (criteria.holdSeconds !== undefined) parts.push(`ค้างไว้ ${criteria.holdSeconds} วินาที`);
  return parts.length > 0 ? parts.join(", ") : "ยังไม่ได้กำหนดเกณฑ์";
}

/** Rep-counting strictness levels per difficulty (from the reference view) —
 * level 2 is always the value the auto-calibration derived (scale = 1). */
const DIFFICULTY_REP_SENSITIVITY: Record<Difficulty, { scale: number; label: string; desc: string }[]> = {
  easy: [
    { scale: 1.15, label: "ผ่อนปรนมาก", desc: "นับจำนวนครั้งได้ง่ายขึ้นเล็กน้อย เหมาะกับผู้ที่เคลื่อนไหวได้จำกัด" },
    { scale: 1.075, label: "ผ่อนปรน", desc: "ผู้ป่วยไม่จำเป็นต้องเคลื่อนไหวได้เต็มช่วงเพื่อให้นับเป็นหนึ่งครั้ง" },
    { scale: DEFAULT_FSM_MARGIN_SCALE, label: "ปานกลาง (แนะนำอัตโนมัติ)", desc: "ค่าที่วิเคราะห์จากวิดีโอสาธิต เหมาะกับผู้ป่วยส่วนใหญ่" },
    { scale: 0.925, label: "เข้มงวด", desc: "การเคลื่อนไหวต้องใกล้เคียงกับวิดีโอสาธิต" },
    { scale: 0.85, label: "เข้มงวดมาก", desc: "ต้องเคลื่อนไหวใกล้เคียงวิดีโอสาธิตมาก เหมาะกับผู้ป่วยที่ฟื้นตัวได้ดี" }
  ],
  medium: [
    { scale: 1.35, label: "ผ่อนปรนมาก", desc: "นับจำนวนครั้งได้ง่ายขึ้น เหมาะกับผู้ที่เคลื่อนไหวได้จำกัดชัดเจน" },
    { scale: 1.175, label: "ผ่อนปรน", desc: "เคลื่อนไหวได้ไม่เต็มช่วงตามวิดีโอสาธิตก็ยังนับเป็นหนึ่งครั้ง" },
    { scale: DEFAULT_FSM_MARGIN_SCALE, label: "ปานกลาง (แนะนำอัตโนมัติ)", desc: "ค่าที่วิเคราะห์จากวิดีโอสาธิต เหมาะกับผู้ป่วยส่วนใหญ่" },
    { scale: 0.825, label: "เข้มงวด", desc: "การเคลื่อนไหวต้องใกล้เคียงกับวิดีโอสาธิต" },
    { scale: 0.65, label: "เข้มงวดมาก", desc: "ต้องเคลื่อนไหวได้เกือบเต็มช่วงตามวิดีโอ เหมาะกับผู้ป่วยที่ฟื้นตัวได้ดี" }
  ],
  hard: [
    { scale: 1.6, label: "ผ่อนปรนมาก", desc: "นับจำนวนครั้งได้ง่ายขึ้นมาก เหมาะกับผู้ที่เคลื่อนไหวได้น้อยหรือเพิ่งเริ่มฝึกท่านี้" },
    { scale: 1.4, label: "ผ่อนปรน", desc: "เคลื่อนไหวได้ไม่เต็มช่วงตามวิดีโอสาธิตก็ยังนับเป็นหนึ่งครั้ง" },
    { scale: DEFAULT_FSM_MARGIN_SCALE, label: "ปานกลาง (แนะนำอัตโนมัติ)", desc: "ค่าที่วิเคราะห์จากวิดีโอสาธิต เหมาะกับผู้ป่วยส่วนใหญ่" },
    { scale: 0.6, label: "เข้มงวด", desc: "การเคลื่อนไหวต้องใกล้เคียงกับวิดีโอสาธิต" },
    { scale: 0.45, label: "เข้มงวดมาก", desc: "ต้องเคลื่อนไหวได้เกือบเต็มช่วงตามวิดีโอ เหมาะกับผู้ป่วยที่ฟื้นตัวได้ดี" }
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
  easy: { icon: "🟢", rangeText: "±15%", desc: "ท่านี้ค่อนข้างง่าย ช่วงที่ปรับได้จึงอยู่ใกล้กับค่าที่วิเคราะห์" },
  medium: { icon: "🟡", rangeText: "±35%", desc: "ระดับมาตรฐาน เหมาะกับท่าบริหารทั่วไปส่วนใหญ่" },
  hard: { icon: "🔴", rangeText: "±60%", desc: "ท่านี้อาจยากสำหรับผู้ป่วยบางราย จึงปรับช่วงได้กว้างเพื่อผ่อนระดับความยาก" }
};

/** Trunk-compensation sensitivity presets, replacing the raw bveThreshold. */
const BVE_SENSITIVITY_LEVELS: { value: number; label: string; desc: string }[] = [
  { value: 0.08, label: "เข้มงวดมาก", desc: "ไม่อนุญาตให้เอนลำตัว เหมาะกับผู้ป่วยที่ควบคุมแกนกลางลำตัวได้ดี" },
  { value: 0.12, label: "เข้มงวด", desc: "ตรวจจับการชดเชยด้วยการเอนลำตัวได้ตั้งแต่เนิ่นๆ" },
  { value: 0.15, label: "ปานกลาง (แนะนำ)", desc: "สมดุลระหว่างความแม่นยำและการใช้งานจริง" },
  { value: 0.2, label: "ผ่อนปรน", desc: "อนุญาตให้ใช้ลำตัวช่วยในการเคลื่อนไหวได้บ้าง" },
  { value: 0.28, label: "ผ่อนปรนมาก", desc: "เหมาะกับผู้ป่วยระยะแรกที่ยังเอนตัวเพื่อช่วยพยุงตนเอง" }
];

export function ExerciseAiPage({
  exercise = null,
  initialName = "",
  initialTracking = "pose",
  onBack,
  onSaved,
  onCreated,
  onLogout,
  onNavigate,
  isVersionView = false
}: ExerciseAiPageProps) {
  const { token, user } = useAuth();

  // Exercise identity / payload fields.
  const [exerciseName, setExerciseName] = useState(exercise?.name ?? initialName);
  const [exerciseDescription, setExerciseDescription] = useState(exercise?.description ?? "");
  const [movementTracking, setMovementTracking] = useState<ExerciseTrackingType>(exercise?.movementTracking ?? initialTracking);
  const [difficulty, setDifficulty] = useState<Difficulty>(exercise?.difficultyLevel ?? "medium");
  const [repetitions, setRepetitions] = useState(exercise?.baseCriteria.repetitions?.toString() ?? "10");
  const [holdSeconds, setHoldSeconds] = useState(exercise?.baseCriteria.holdSeconds?.toString() ?? "5");
  const [targetGripStrength, setTargetGripStrength] = useState(exercise?.baseCriteria.targetGripStrength?.toString() ?? "50");
  const [virtualGripGameType, setVirtualGripGameType] = useState<HandTrackingGameType | null>(exercise?.baseCriteria?.virtualGripGameType ?? null);

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
  const [loadedDemoFileId, setLoadedDemoFileId] = useState<string | null>(null);

  // Calibration results (null until the base clip has been scanned).
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [baseFrames, setBaseFrames] = useState<FrameSample[]>([]);
  const [baseFramesFromStoredReference, setBaseFramesFromStoredReference] = useState(false);
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

  // Frame preview scrubber (skeleton-only preview over a dark backdrop) — also
  // the frame picker used when marking checkpoints.
  const [previewIndex, setPreviewIndex] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkTrackRef = useRef<HTMLDivElement>(null);
  const draggingLandmarkRef = useRef<MovementLandmarkRole | null>(null);
  const [movementLandmarks, setMovementLandmarks] = useState<MovementLandmarkIndices>(DEFAULT_MOVEMENT_LANDMARKS);
  // Live scan preview canvas (video frame + skeleton while scanning, the
  // reference's behavior) — separate from the post-scan preview above.
  const scanPreviewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Full per-clip candidate list from the last scan (id + label + the actual
  // AngleDefinition + series/range/score), populated by handleScanBaseClip.
  // getAngleDefinitionById resolves against this instead of the static
  // CANDIDATE_ANGLE_DEFINITIONS export, because candidates are now generated
  // per clip (buildLateralityAwareCandidates in exerciseAutoCalibrator.ts) —
  // a single-arm clip's candidate ids (e.g. "elbow_single_right") only exist
  // in this per-clip list, not in the static bilateral-only array.
  const rankedCandidatesRef = useRef<ScoredCandidate[]>([]);

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

  // Save state.
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedExerciseName, setSavedExerciseName] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState<"publish" | "archive" | null>(null);

  // "Test exercise" run — mounts PatientSessionPage with the criteria
  // currently on screen while THIS component stays mounted (so scanned clips,
  // checkpoints and calibration all survive the round-trip). null = the
  // authoring workspace is showing. Unlike a patient's session there is no
  // upload/confirmation step: finishing (or exiting) comes straight back here
  // and the take is discarded.
  const [testSession, setTestSession] = useState<{
    exercise: PatientExercise;
    testConfig: SessionTestConfig;
    ownsDemoVideoUrl: boolean;
  } | null>(null);
  const [testPaused, setTestPaused] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  const sensitivityLevels = DIFFICULTY_REP_SENSITIVITY[difficulty];

  const targetExercise = exercise ?? null;
  const storedPoseReference = targetExercise?.baseCriteria.poseReference as unknown as StoredPoseReference | undefined;
  const timelineFrames = useMemo(
    () => baseFramesFromStoredReference ? baseFrames : baseFrames.filter((_, index) => index % 3 === 0),
    [baseFrames, baseFramesFromStoredReference]
  );
  const isOwner = !targetExercise || (user ? targetExercise.createdById === user.id || user.role === "admin" : false);
  const isArchived = targetExercise?.status === "archived";
  const isPoseExercise = movementTracking === "pose";
  const isHandTrackingExercise = movementTracking === "virtual_grip";
  const canEditPoseCriteria = Boolean(calibration || storedPoseReference);
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
    setLoadedDemoFileId(null);
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
        setLoadedDemoFileId(fileId);
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
    setVirtualGripGameType(exercise?.baseCriteria?.virtualGripGameType ?? null);
    setSavedExerciseName(null);
  }, [exercise, initialName, initialTracking]);

  // Switching the library target must discard clip-specific authoring state;
  // otherwise an old calibration/base clip can suppress the saved-video scan
  // for the newly selected exercise.
  useEffect(() => {
    setExerciseName(targetExercise?.name ?? initialName);
    setExerciseDescription(targetExercise?.description ?? "");
    setMovementTracking(targetExercise?.movementTracking ?? initialTracking);
    setDifficulty(targetExercise?.difficultyLevel ?? "medium");
    setRepetitions(targetExercise?.baseCriteria.repetitions?.toString() ?? "10");
    setHoldSeconds(targetExercise?.baseCriteria.holdSeconds?.toString() ?? "5");
    setTargetGripStrength(targetExercise?.baseCriteria.targetGripStrength?.toString() ?? "50");
    setVirtualGripGameType(targetExercise?.baseCriteria?.virtualGripGameType ?? null);
    setBaseClip(null);
    setCalibration(null);
    setBaseFrames([]);
    setBaseFramesFromStoredReference(false);
    setSelectedPrimaryId(null);
    setSelectedSecondaryId(null);
    setFsmConfig(storedPoseReference?.fsmConfig ?? null);
    setTargetRom(storedPoseReference?.targetRom ?? 90);
    setBveThreshold(storedPoseReference?.bveThreshold ?? 0.15);
    setEnableTrunkBve(storedPoseReference?.enableTrunkBve === true);
    setMasterClips([]);
    setWrongFormClips([]);
    setPreviewIndex(0);
    setIsPreviewPlaying(false);
    setMovementLandmarks(storedPoseReference?.movementLandmarks ?? DEFAULT_MOVEMENT_LANDMARKS);
    rankedCandidatesRef.current = [];
    const savedCheckpoints = storedPoseReference?.checkpoints ?? [];
    setCheckpoints({
      ready: savedCheckpoints.find((checkpoint) => checkpoint.role === "ready") ?? null,
      active: savedCheckpoints.find((checkpoint) => checkpoint.role === "active") ?? null,
      return: savedCheckpoints.find((checkpoint) => checkpoint.role === "return") ?? null
    });
    setScanProgressText(null);
    setScanError(null);
    setSavedExerciseName(null);
  // The exercise id is the identity boundary; library refreshes should not
  // overwrite unsaved edits to the same exercise.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetExercise?.id]);

  // Reopening a SAVED pose exercise: scan its stored demo video right away so the
  // skeleton preview (Step 3) is populated without re-uploading or pressing
  // "scan". Preview only — this deliberately does NOT calibrate or touch the
  // stored criteria (masterSamples, wrong-form takes, checkpoints), so saving
  // afterwards keeps the exercise's AI reference exactly as it was; pressing
  // "scan and calibrate" with a new clip still recalibrates as before.
  const autoScannedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const savedFrames = storedPoseReference?.poseFrames;
    const hasStoredPoseFrames = Boolean(savedFrames && savedFrames.length > 0 && savedFrames.every(isStoredPoseFrame));
    if (
      (!hasStoredPoseFrames &&
        (!savedDemoUrl || loadedDemoFileId !== targetExercise?.demoVideoFileId)) ||
      baseClip ||
      scanBusy ||
      !isPoseExercise
    ) return;
    const previewSourceKey = hasStoredPoseFrames ? `pose-reference:${targetExercise?.id}` : savedDemoUrl;
    if (!previewSourceKey || autoScannedUrlRef.current === previewSourceKey) return;
    autoScannedUrlRef.current = previewSourceKey;
    let cancelled = false;
    (async () => {
      setScanBusy(true);
      setScanError(null);
      setScanProgressText(hasStoredPoseFrames ? "กำลังโหลดโครงกระดูกจากข้อมูลท่าทางที่บันทึกไว้…" : "กำลังโหลดโครงกระดูกจากวิดีโอสาธิตที่บันทึกไว้…");
      try {
        let frames: FrameSample[];
        if (hasStoredPoseFrames && savedFrames) {
          frames = savedFrames.map((frame) => ({
            ...frame,
            landmarks: frame.landmarks.map(([x, y, z, visibility]) => ({
              x,
              y,
              z,
              ...(visibility === undefined ? {} : { visibility })
            }))
          }));
        } else {
          if (!savedDemoUrl) return;
          const blob = await (await fetch(savedDemoUrl)).blob();
          const file = new File([blob], "saved-demo-video", { type: blob.type || "video/mp4" });
          frames = await scanVideoPoseFrames(
            file,
            ({ currentTimeSeconds, durationSeconds, sampledFrames }) => {
              if (!cancelled) {
                setScanProgressText(`กำลังโหลดโครงกระดูก ${currentTimeSeconds.toFixed(1)} / ${durationSeconds.toFixed(1)} วินาที — ติดตามแล้ว ${sampledFrames} เฟรม`);
              }
            }
          );
        }
        if (cancelled) return;
        if (frames.length === 0) {
          setScanProgressText(null);
          setScanError("ข้อมูลโครงกระดูกของท่าบริหารนี้ไม่มีเฟรมให้แสดง");
          return;
        }
        const candidates = rankCandidates(frames);
        rankedCandidatesRef.current = candidates;
        setSelectedPrimaryId(
          candidates.find((candidate) => JSON.stringify(candidate.angleDefinition) === JSON.stringify(storedPoseReference?.angleDefinition))?.id ?? null
        );
        setSelectedSecondaryId(
          candidates.find((candidate) => JSON.stringify(candidate.angleDefinition) === JSON.stringify(storedPoseReference?.secondaryAngleDefinition))?.id ?? null
        );
        setBaseFramesFromStoredReference(hasStoredPoseFrames);
        setBaseFrames(frames);
        setPreviewIndex(0);
        const timelineFrameCount = hasStoredPoseFrames ? frames.length : frames.filter((_, index) => index % 3 === 0).length;
        setMovementLandmarks(validMovementLandmarks(storedPoseReference?.movementLandmarks, timelineFrameCount));
        setScanProgressText(`โหลดโครงกระดูกจากวิดีโอสาธิตที่บันทึกไว้แล้ว — ${frames.length} เฟรม`);
      } catch {
        if (!cancelled) {
          setScanProgressText(null);
          setScanError("โหลดเฟรมโครงกระดูกที่บันทึกไว้ไม่สำเร็จ");
        }
      } finally {
        setScanBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      // StrictMode/dep-change remount: allow the scan to run again.
      if (autoScannedUrlRef.current === previewSourceKey) autoScannedUrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedDemoUrl, loadedDemoFileId, baseClip, isPoseExercise, targetExercise?.demoVideoFileId, targetExercise?.id]);

  const getAngleDefinitionById = (id: string | null): AngleDefinition | null =>
    id ? rankedCandidatesRef.current.find((c) => c.id === id)?.angleDefinition ?? null : null;

  const primaryDef =
    getAngleDefinitionById(selectedPrimaryId) ?? calibration?.primary.angleDefinition ?? storedPoseReference?.angleDefinition ?? null;
  const secondaryDef =
    getAngleDefinitionById(selectedSecondaryId) ?? calibration?.secondary.angleDefinition ?? storedPoseReference?.secondaryAngleDefinition ?? null;

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
  const selectedTimelineIndex = timelineFrames.length === 0
    ? 0
    : Math.min(timelineFrames.length - 1, baseFramesFromStoredReference ? previewIndex : Math.floor(previewIndex / 3));
  const selectedTimelineFrame = timelineFrames[selectedTimelineIndex];

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
      ctx.fillText("สแกนวิดีโอสาธิตเพื่อดูโครงกระดูก", 48, canvas.height / 2);
    }
  };
  useEffect(() => {
    previewDrawRef.current?.();
  }, [previewFrame]);

  useEffect(() => {
    if (!isPreviewPlaying || baseFrames.length < 2) return;
    const frameDurationMs =
      baseFrames.length > 1
        ? Math.max(16, Math.min(250, ((baseFrames[baseFrames.length - 1].videoTimeSeconds - baseFrames[0].videoTimeSeconds) * 1000) / (baseFrames.length - 1)))
        : 100;
    const timer = window.setInterval(() => {
      setPreviewIndex((current) => (current + 1) % baseFrames.length);
    }, frameDurationMs);
    return () => window.clearInterval(timer);
  }, [isPreviewPlaying, baseFrames]);

  // Scans the base demo clip and auto-calibrates everything from it.
  const handleScanBaseClip = async () => {
    if (!baseClip || scanBusy) return;
    setScanBusy(true);
    setScanError(null);
    setScanProgressText("กำลังสแกนวิดีโอสาธิต…");
    try {
      const frames = await scanVideoPoseFrames(
        baseClip,
        ({ currentTimeSeconds, durationSeconds, sampledFrames }) => {
          setScanProgressText(`กำลังสแกน ${currentTimeSeconds.toFixed(1)} / ${durationSeconds.toFixed(1)} วินาที — ติดตามแล้ว ${sampledFrames} เฟรม`);
        },
        // Live preview: the video frame + tracked skeleton, drawn while scanning.
        scanPreviewCanvasRef.current ? { canvas: scanPreviewCanvasRef.current } : undefined
      );
      if (frames.length < 10) {
        throw new Error("ติดตามเฟรมได้น้อยเกินไป — ตรวจสอบให้แน่ใจว่ามองเห็นร่างกายทั้งหมดในวิดีโอ");
      }
      // Ranked once here (per-clip laterality detection depends on this clip's
      // own frames) and kept in rankedCandidatesRef so getAngleDefinitionById
      // can resolve every candidate id shown in Step 3, not just the primary/
      // secondary ones calibrateFromFrames already returns full definitions for.
      rankedCandidatesRef.current = rankCandidates(frames);
      const result = calibrateFromFrames(frames);
      setBaseFramesFromStoredReference(false);
      setBaseFrames(frames);
      setCalibration(result);
      setSelectedPrimaryId(result.primary.id);
      setSelectedSecondaryId(result.secondary.id);
      setFsmConfig(result.derived.fsmConfig);
      setTargetRom(result.suggestedTargetRom);
      setRepSensitivityIndex(2);
      setPreviewIndex(0);
      setMovementLandmarks(defaultMovementLandmarks(frames.filter((_, index) => index % 3 === 0).length));
      // A new base clip invalidates any checkpoints marked on the previous one.
      setCheckpoints({ ready: null, active: null, return: null });
      setActiveCheckpointRole("ready");
      setScanProgressText(null);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "สแกนไม่สำเร็จ");
      setScanProgressText(null);
    } finally {
      setScanBusy(false);
    }
  };

  const checkpointForLandmark = (
    role: CheckpointRole,
    landmarks = movementLandmarks
  ): ExerciseCheckpoint | null => {
    const timelineIndex = movementLandmarkFrameIndex(landmarks, CHECKPOINT_LANDMARK_ROLES[role]);
    const frameIndex = Math.min(
      baseFrames.length - 1,
      timelineIndex * (baseFramesFromStoredReference ? 1 : 3)
    );
    const frame = baseFrames[frameIndex];
    if (!frame) return null;
    const existing = checkpoints[role];
    const definition = getAngleDefinitionById(selectedPrimaryId) ?? calibration?.primary.angleDefinition;
    const angle = definition
      ? Math.round(extractConfiguredAngle(frame.landmarks, definition).mean * 10) / 10
      : existing?.angle;
    if (angle === undefined) return null;
    const roleInfo = CHECKPOINT_ROLES.find((checkpointRole) => checkpointRole.role === role);
    return {
      role,
      label: roleInfo?.title || role,
      description: existing?.description,
      timestampSeconds: frame.videoTimeSeconds,
      angle
    };
  };
  const landmarkCheckpoints = CHECKPOINT_ROLES
    .map(({ role }) => checkpointForLandmark(role))
    .filter((checkpoint): checkpoint is ExerciseCheckpoint => checkpoint !== null);
  const allCheckpointsSet = landmarkCheckpoints.length === CHECKPOINT_ROLES.length;

  // Recomputes ready/activation/return using the timeline checkpoints when
  // available, otherwise inferring from the selected primary angle series.
  const deriveWithScale = (
    scale: number,
    landmarks = movementLandmarks
  ): ExerciseFSMConfig | null => {
    const selectedCheckpoints = landmarks === movementLandmarks
      ? landmarkCheckpoints
      : CHECKPOINT_ROLES
          .map(({ role }) => checkpointForLandmark(role, landmarks))
          .filter((checkpoint): checkpoint is ExerciseCheckpoint => checkpoint !== null);
    if (selectedCheckpoints.length === CHECKPOINT_ROLES.length) {
      return deriveFsmConfigFromCheckpoints(
        selectedCheckpoints[0].angle,
        selectedCheckpoints[1].angle,
        selectedCheckpoints[2].angle,
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

  // Selecting a checkpoint focuses its corresponding landmark on the timeline.
  const selectRoleForEditing = (role: CheckpointRole) => {
    setActiveCheckpointRole(role);
    const landmarkIndex = movementLandmarkFrameIndex(movementLandmarks, CHECKPOINT_LANDMARK_ROLES[role]);
    setPreviewIndex(Math.min(
      Math.max(0, baseFrames.length - 1),
      landmarkIndex * (baseFramesFromStoredReference ? 1 : 3)
    ));
  };


  // Scans an additional master take or wrong-form clip (same scanner).
  const handleScanExtraClip = async (kind: "master" | "wrong-form", file: File) => {
    if (scanBusy) return;
    setScanBusy(true);
    setScanError(null);
    setScanProgressText(`กำลังสแกน${kind === "master" ? "วิดีโอตัวอย่างท่าที่ถูกต้อง" : "วิดีโอตัวอย่างท่าที่ไม่ถูกต้อง"}…`);
    try {
      const frames = await scanVideoPoseFrames(
        file,
        ({ currentTimeSeconds, durationSeconds, sampledFrames }) => {
          setScanProgressText(`กำลังสแกน ${currentTimeSeconds.toFixed(1)} / ${durationSeconds.toFixed(1)} วินาที — ติดตามแล้ว ${sampledFrames} เฟรม`);
        },
        scanPreviewCanvasRef.current ? { canvas: scanPreviewCanvasRef.current } : undefined
      );
      const clip: ScannedClip = {
        id: Date.now(),
        description: `${kind === "master" ? "ตัวอย่างท่าที่ถูกต้อง" : "ตัวอย่างท่าที่ไม่ถูกต้อง"} #${(kind === "master" ? masterClips : wrongFormClips).length + 1}`,
        frames
      };
      if (kind === "master") {
        setMasterClips((prev) => [...prev, clip]);
      } else {
        setWrongFormClips((prev) => [...prev, clip]);
      }
      setScanProgressText(`เสร็จแล้ว — เพิ่ม ${frames.length} เฟรม`);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "สแกนไม่สำเร็จ");
    } finally {
      setScanBusy(false);
    }
  };

  /** Assembles the poseReference payload (the shape the backend stores under
   * base_criteria.poseReference and scores against). */
  const buildPoseReference = () => {
    if (!primaryDef || !secondaryDef || !fsmConfig) return null;
    // Technique flags (hands-together check / torso-movement allowance) are no
    // longer therapist checkboxes: they are inferred from the therapist's own
    // demo clips (base clip + extra correct takes; wrong-form clips excluded).
    // See ai/poseScoring/exerciseTechniqueFlags.ts for the rules.
    const techniqueFlags = inferTechniqueFlags({
      angleType: primaryDef.type,
      clips: [baseFrames, ...masterClips.map((clip) => clip.frames)].map((frames) =>
        techniqueFramesFromLandmarks(frames.map((f) => f.landmarks))
      )
    });
    return {
      angleDefinition: primaryDef,
      secondaryAngleDefinition: secondaryDef,
      fsmConfig,
      targetRom,
      bveThreshold,
      enableTrunkBve,
      allowsTorsoMovement: techniqueFlags.allowsTorsoMovement,
      checksHandProximity: techniqueFlags.checksHandProximity,
      // Authoring labels kept server-side only, to word the per-rep
      // detailedFeedback (which joint is primary / which is the secondary).
      targetJoint: rankedCandidatesRef.current.find((c) => c.id === selectedPrimaryId)?.label ?? calibration?.primary.label,
      autoAnalysis: calibration
        ? {
            primaryCandidateId: selectedPrimaryId ?? calibration.primary.id,
            secondaryCandidateId: selectedSecondaryId ?? calibration.secondary.id,
            rankedCandidates: calibration.rankedCandidates.map((c) => ({ id: c.id, label: c.label, range: c.range, score: c.score })),
            // Evidence behind the two inferred technique flags (audit only).
            techniqueFlags: techniqueFlags.evidence
          }
        : undefined,
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
      checkpoints: landmarkCheckpoints.length === CHECKPOINT_ROLES.length ? landmarkCheckpoints : undefined,
      movementLandmarks,
      // Keep a compact 10 fps pose sequence in the JSON reference. Stored
      // joint coordinates let reopened exercises replay without rerunning pose
      // detection; older references fall back to scanning their demo video.
      poseFrames: serializePoseFrames(baseFrames, baseFramesFromStoredReference)
    };
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
    if (isPoseExercise && !hasValidMovementLandmarks) {
      setSaveError(
        timelineFrames.length < 3
          ? "ข้อมูลโครงกระดูกต้องมีอย่างน้อย 3 เฟรมเพื่อกำหนดจุดตรวจสอบทั้งสามจุด"
          : "กำหนดจุดตรวจสอบท่าเริ่มต้น จุดสูงสุด และการกลับสู่ท่าเริ่มต้นตามลำดับก่อนบันทึก"
      );
      return;
    }
    const poseReference =
      (calibration
        ? buildPoseReference()
        : storedPoseReference && baseFrames.length > 0
          ? {
              ...storedPoseReference,
              poseFrames: serializePoseFrames(baseFrames, baseFramesFromStoredReference),
              movementLandmarks,
              checkpoints: landmarkCheckpoints.length === CHECKPOINT_ROLES.length
                ? landmarkCheckpoints
                : storedPoseReference.checkpoints
            }
          : storedPoseReference
            ? {
                ...storedPoseReference,
                movementLandmarks,
                checkpoints: landmarkCheckpoints.length === CHECKPOINT_ROLES.length
                  ? landmarkCheckpoints
                  : storedPoseReference.checkpoints
              }
            : undefined) ?? undefined;
    if (isPoseExercise && !poseReference) {
      setSaveError("สแกนวิดีโอสาธิตเพื่อสร้างข้อมูลอ้างอิงท่าทางก่อนบันทึก");
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
    try {
      let uploadedClipId: string | null = null;
      if (baseClip) {
        const { file: uploaded } = await uploadFile(token, baseClip);
        if (uploaded.fileType !== "video") {
          throw new Error("ไฟล์วิดีโอสาธิตที่เลือกต้องเป็นวิดีโอ");
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
                  holdSeconds: holdSeconds ? Number(holdSeconds) : undefined,
                  virtualGripGameType: virtualGripGameType ?? undefined
                }
              : { repetitions: repetitions ? Number(repetitions) : undefined },
          demoVideoFileId: uploadedClipId ?? targetExercise.demoVideoFileId ?? null
        };
        if (targetExercise.status === "draft") {
          await updateExerciseDraft(token, targetExercise.id, payload);
          targetExercise.baseCriteria = payload.baseCriteria;
          setSavedExerciseName(targetExercise.name);
        } else {
          const { exercise: created } = await createExerciseVersion(token, targetExercise.id, payload);
          setSavedExerciseName(`${created.name} (new draft v${created.versionNumber})`);
        }
        return;
      }

      if (isPoseExercise && !uploadedClipId) {
        throw new Error("เลือกวิดีโอสาธิตหลัก ซึ่งจะถูกบันทึกเป็นวิดีโอสาธิตของท่าบริหาร");
      }
      await createExercise(token, {
        name: exerciseName.trim(),
        description: exerciseDescription.trim(),
        movementTracking,
        difficultyLevel: difficulty,
        baseCriteria: isPoseExercise
          ? { repetitions: repetitions ? Number(repetitions) : undefined, holdSeconds: holdSeconds ? Number(holdSeconds) : undefined, targetAngleDeg: targetRom, poseReference }
          : movementTracking === "virtual_grip"
            ? {
                targetGripStrength: targetGripStrength ? Number(targetGripStrength) : undefined,
                repetitions: repetitions ? Number(repetitions) : undefined,
                holdSeconds: holdSeconds ? Number(holdSeconds) : undefined,
                virtualGripGameType: virtualGripGameType ?? undefined,
              }
            : { repetitions: repetitions ? Number(repetitions) : undefined },
        demoVideoFileId: uploadedClipId
      });
      setSavedExerciseName(exerciseName.trim());
      onCreated(exerciseName.trim());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
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
      setSaveError(err instanceof ApiError ? err.message : action === "publish" ? "เผยแพร่ท่าบริหารไม่สำเร็จ" : "เก็บท่าบริหารเข้าคลังไม่สำเร็จ");
    } finally {
      setLifecycleBusy(null);
    }
  };

  const moveLandmarkToFrame = (role: MovementLandmarkRole, requestedIndex: number) => {
    const lastFrameIndex = timelineFrames.length - 1;
    if (lastFrameIndex < 2) return;

    const next = { ...movementLandmarks };
    const frameIndex = Math.max(0, Math.min(lastFrameIndex, Math.round(requestedIndex)));
    if (role === "start") {
      next.startFrameIndex = Math.min(frameIndex, next.middleFrameIndex - 1);
    } else if (role === "middle") {
      next.middleFrameIndex = Math.max(next.startFrameIndex + 1, Math.min(frameIndex, next.endFrameIndex - 1));
    } else {
      next.endFrameIndex = Math.max(next.middleFrameIndex + 1, frameIndex);
    }

    setMovementLandmarks(next);
    setPreviewIndex(movementLandmarkFrameIndex(next, role) * (baseFramesFromStoredReference ? 1 : 3));
    applyDerivedThresholds(deriveWithScale(sensitivityLevels[repSensitivityIndex].scale, next));
  };

  const handleLandmarkPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const role = draggingLandmarkRef.current;
    const track = landmarkTrackRef.current;
    if (!role || !track || timelineFrames.length < 3) return;
    const bounds = track.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    moveLandmarkToFrame(role, fraction * (timelineFrames.length - 1));
  };

  const handleLandmarkKeyDown = (event: KeyboardEvent<HTMLButtonElement>, role: MovementLandmarkRole) => {
    const frameIndex = movementLandmarkFrameIndex(movementLandmarks, role);
    const minimum = role === "start" ? 0 : role === "middle" ? movementLandmarks.startFrameIndex + 1 : movementLandmarks.middleFrameIndex + 1;
    const maximum = role === "start"
      ? movementLandmarks.middleFrameIndex - 1
      : role === "middle"
        ? movementLandmarks.endFrameIndex - 1
        : timelineFrames.length - 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      moveLandmarkToFrame(role, Math.max(minimum, frameIndex - 1));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      moveLandmarkToFrame(role, Math.min(maximum, frameIndex + 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      moveLandmarkToFrame(role, minimum);
    } else if (event.key === "End") {
      event.preventDefault();
      moveLandmarkToFrame(role, maximum);
    }
  };

  // New exercises need a name + the base clip (it becomes the demo video);
  // attaching to an existing exercise needs neither when it already has a name
  // and a demo video.
  const needsBaseClip = isPoseExercise && (!targetExercise || !targetExercise.demoVideoFileId);
  const hasValidMovementLandmarks =
    timelineFrames.length >= 3 &&
    movementLandmarks.startFrameIndex >= 0 &&
    movementLandmarks.startFrameIndex < movementLandmarks.middleFrameIndex &&
    movementLandmarks.middleFrameIndex < movementLandmarks.endFrameIndex &&
    movementLandmarks.endFrameIndex < timelineFrames.length;
  const canSave = Boolean(
    isOwner &&
      !isArchived &&
      exerciseName.trim() &&
      (!isPoseExercise ||
        (hasValidMovementLandmarks &&
          ((calibration && fsmConfig && primaryDef && secondaryDef && baseFrames.length >= 10) ||
            targetExercise?.baseCriteria.poseReference))) &&
      (!needsBaseClip || baseClip)
  );

  // --- "Test exercise" run ------------------------------------------------
  // A pose test needs runnable AI criteria: either a fresh calibration (plus
  // the angle/FSM config derived from it) from this page, or a poseReference
  // already stored on the exercise being edited. Virtual-grip tests need
  // nothing extra; "none" has no AI tracking to exercise at all.
  const hasTestablePoseReference = Boolean(
    (calibration && fsmConfig && primaryDef && secondaryDef && baseFrames.length >= 10) || storedPoseReference
  );
  const testDisabledReason =
    !isOwner || isArchived
      ? "ท่าบริหารนี้ดูได้อย่างเดียว จึงไม่สามารถทดสอบได้"
      : scanBusy
          ? "รอให้สแกนคลิปปัจจุบันเสร็จก่อนเริ่มทดสอบ"
        : targetExercise?.demoVideoFileId && savedDemoState === "loading"
          ? "กำลังโหลดวิดีโอสาธิตที่บันทึกไว้ กรุณารอสักครู่"
        : targetExercise?.demoVideoFileId && savedDemoState === "error"
          ? "โหลดวิดีโอสาธิตที่บันทึกไว้ไม่สำเร็จ กรุณาลองใหม่ก่อนทดสอบ"
        : movementTracking === "none"
            ? "ท่าบริหารนี้ไม่ได้ใช้ AI ติดตาม จึงไม่สามารถทดสอบได้"
          : isPoseExercise && !hasTestablePoseReference
              ? "สแกนวิดีโอสาธิตหลักก่อน การทดสอบจะใช้เกณฑ์ AI ที่กำหนดไว้"
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
    const demoVideoUrl = baseClip ? URL.createObjectURL(baseClip) : savedDemoUrl;
    setTestSession({
      exercise: {
        // Library id when editing an existing row (harmless in a test — no
        // backend call uses it), a synthetic id for a brand-new exercise.
        id: targetExercise?.id ?? "ai-authoring-test",
        name: exerciseName.trim() || "AI test exercise",
        trackingType: movementTracking === "virtual_grip" ? "virtual_grip" : "pose",
        targetLabel: `${Number(repetitions) || 0} ครั้ง`,
        progressLabel: `${Number(repetitions) || 0} ครั้ง`,
        status: "not_started",
        feedback: exerciseDescription.trim() || "Follow the movement instructions you authored.",
        durationMinutes: 0,
        sets: 0,
        reps: Number(repetitions) || 0,
        difficulty: difficulty === "easy" ? "Easy" : difficulty === "medium" ? "Moderate" : "Hard",
        virtualGripGameType: movementTracking === "virtual_grip" ? (virtualGripGameType ?? undefined) : undefined
      },
      testConfig: { poseReference, exerciseLibraryId: targetExercise?.id ?? null, demoVideoUrl, virtualGripGameType: movementTracking === "virtual_grip" ? virtualGripGameType : null },
      ownsDemoVideoUrl: Boolean(baseClip)
    });
    setTestPaused(false);
    setTestNote(null);
  };

  // Ends the test run — whether it finished (STOP / all prescribed reps done)
  // or was abandoned (Exit / Discard & exit). Releases the local demo-clip
  // object URL and returns to the authoring workspace; the RecordingResult and
  // pose summary are deliberately dropped, since a test never uploads anything.
  const closeTest = (note: string | null) => {
    if (testSession?.ownsDemoVideoUrl && testSession.testConfig.demoVideoUrl) {
      URL.revokeObjectURL(testSession.testConfig.demoVideoUrl);
    }
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
        onBack={() => closeTest("สิ้นสุดการทดสอบ — ไม่มีการอัปโหลด")}
        onRestart={() => setTestPaused(false)}
        onTogglePause={() => setTestPaused((value) => !value)}
        onFinishRecording={() =>
          closeTest(
            "การทดสอบเสร็จสิ้น — ยกเลิกวิดีโอที่บันทึกไว้แล้ว และไม่มีการอัปโหลด"
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
              <strong>พื้นที่สร้างท่าบริหารด้วย AI</strong>
              <span>สร้างข้อมูลอ้างอิงท่าทางจากวิดีโอสาธิต</span>
            </div>
          </div>
        </header>

        <main className="therapist-main exercise-creation-main ai-workspace-main">
          <button type="button" className="text-action pd-back-link" onClick={onBack}>
            <ArrowLeft size={14} /> {isVersionView ? "กลับไปยังคลังท่าบริหาร" : "กลับไปสร้างท่าบริหาร"}
          </button>

          {/* Page heading */}
          <div className="ai-workspace-heading" style={{ marginBottom: 20 }}>
            <div>
              <h1>{exerciseName.trim() || "สร้างข้อมูลอ้างอิงท่าบริหารด้วย AI"}</h1>
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
                "ทดสอบท่าบริหารนี้กับกล้องโดยใช้เกณฑ์ที่กำหนดไว้ ไม่มีการอัปโหลด และจะกลับมาหน้านี้เมื่อทดสอบเสร็จ"
              }
            >
              <Play size={16} /> ทดสอบท่าบริหาร
            </button>
          </div>

          {/* Result of the last test run — a test always discards its take, so
              there is never an upload/confirmation step to walk through. */}
          {testNote && (
            <div className="ai-banner ai-banner-success">
              <CheckCircle2 size={20} />
              <div>
                <strong>ทดสอบเสร็จสิ้น</strong>
                <div>{testNote}</div>
              </div>
            </div>
          )}

          {/* Success banner */}
          {savedExerciseName && (
            <div className="ai-banner ai-banner-success">
              <CheckCircle2 size={20} />
              <div>
                <strong>สร้างท่าบริหารสำเร็จ</strong>
                <div>บันทึก “{savedExerciseName}” เป็นฉบับร่างแล้ว สามารถเผยแพร่ได้จากคลังท่าบริหาร</div>
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
                  ประวัติเวอร์ชัน · v{targetExercise.versionNumber}
                  {targetExercise.versions.length > 1 ? ` จาก ${targetExercise.versions.length}` : ""} · {targetExercise.name}
                </strong>
                <div>
                  สร้างเมื่อ {targetExercise.createdAtLabel} โดย {targetExercise.createdByName || "นักกายภาพบำบัด"} ·{" "}
                  {describeCriteriaThai(targetExercise.baseCriteria)}
                </div>
              </div>
            </div>
          )}

          {targetExercise && (
            <div className={`ai-lifecycle-bar ${targetExercise.status}`}>
              <div>
                <strong>{targetExercise.name} · v{targetExercise.versionNumber}</strong>
                <span>{targetExercise.status === "active" ? "กำลังใช้งาน — การบันทึกการแก้ไขจะสร้างฉบับร่างเวอร์ชันใหม่" : targetExercise.status === "draft" ? "ฉบับร่าง — การเปลี่ยนแปลงจะบันทึกในเวอร์ชันนี้" : "เก็บถาวร — เวอร์ชันนี้ดูได้อย่างเดียว"}</span>
              </div>
              {isOwner && !isArchived && (
                <div className="ai-lifecycle-actions">
                  {targetExercise.status === "draft" && <button type="button" className="secondary-button" disabled={lifecycleBusy !== null} onClick={() => void handleLifecycleAction("publish")}>{lifecycleBusy === "publish" ? "กำลังเผยแพร่…" : "เผยแพร่"}</button>}
                  <button type="button" className="text-action danger" disabled={lifecycleBusy !== null} onClick={() => void handleLifecycleAction("archive")}>{lifecycleBusy === "archive" ? "กำลังเก็บถาวร…" : <><Archive size={14} /> เก็บถาวร</>}</button>
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
                <p className="ai-progress">กำลังโหลดวิดีโอสาธิตที่บันทึกไว้…</p>
              ) : savedDemoState === "error" ? (
                <p className="ai-error">โหลดวิดีโอสาธิตที่บันทึกไว้ไม่สำเร็จ</p>
              ) : null}
            </div>
          )}

          {!isOwner && targetExercise && (
            <div className="library-warning-banner">
              <AlertTriangle size={16} /> ท่าบริหารนี้สร้างโดย {targetExercise.createdByName || "นักกายภาพบำบัดท่านอื่น"} และเปิดในโหมดดูอย่างเดียว
            </div>
          )}

          {/* Mixed step flow: paired two-column rows (1 | 2, 3 | 4, 7 | 8) with the dense steps (5, 6, 9) spanning both columns. */}
          <div className={`ai-author-stack ${isPoseExercise ? "" : isHandTrackingExercise ? "hand-tracking" : "manual"} ${!isOwner || isArchived ? "readonly" : ""}`}>

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
                {movementTracking === "virtual_grip" && (
                  <div className="ai-field">
                    <label>เลือกชนิดเกม</label>
                    <select
                      className="ai-input"
                      value={virtualGripGameType ?? ""}
                      onChange={(event) => setVirtualGripGameType(event.target.value as HandTrackingGameType | null)}
                    >
                      <option value="">— เลือกเกม —</option>
                      <option value="ball-grip">จับลูกบอลเสมือน (Ball Grip)</option>
                      <option value="path-drag">ลากตามเส้นทาง (Path Drag)</option>
                      <option value="falling-cup">จับถ้วยตกลงมา (Falling Cup)</option>
                    </select>
                  </div>
                )}
                <div className="ai-field">
                  <label>จำนวนครั้งเริ่มต้น</label>
                  <div className="ai-reps-stepper">
                    <button
                      type="button"
                      className="ai-reps-step-button"
                      onClick={() => setRepetitions(String(Math.max(1, (Number(repetitions) || 1) - 1)))}
                      disabled={isArchived || !isOwner || (Number(repetitions) || 1) <= 1}
                      aria-label="ลดจำนวนครั้งเริ่มต้น"
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      className="ai-reps-step-input"
                      type="number"
                      min={1}
                      step={1}
                      value={repetitions}
                      onChange={(event) => setRepetitions(event.target.value)}
                      disabled={isArchived || !isOwner}
                      aria-label="จำนวนครั้งเริ่มต้น"
                    />
                    <span className="ai-reps-step-unit">ครั้ง</span>
                    <button
                      type="button"
                      className="ai-reps-step-button"
                      onClick={() => setRepetitions(String((Number(repetitions) || 0) + 1))}
                      disabled={isArchived || !isOwner}
                      aria-label="เพิ่มจำนวนครั้งเริ่มต้น"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
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
              <section className="creation-section-card ai-base-demo-step">
                <div className="ai-card-step-tag">ขั้นตอนที่ 2 · วิดีโอสาธิตหลัก</div>
                <div className="creation-section-header">
                  <Film size={20} />
                  <div>
                    <strong>วิดีโอสาธิตหลัก</strong>
                    <p className="library-card-sub">
                      {isPoseExercise
                        ? "วิดีโอสาธิตที่ชัดเจนหนึ่งคลิปสำหรับวิเคราะห์มุมการเคลื่อนไหวและเกณฑ์การนับครั้ง"
                        : "เพิ่มวิดีโอสาธิตเพื่อให้ผู้ป่วยดูประกอบการทำกิจกรรม"}
                    </p>
                  </div>
                </div>

                <label className="ai-file-upload-area">
                  <Upload size={24} className="ai-file-upload-icon" />
                  <span className="ai-file-upload-label">
                    {baseClip ? baseClip.name : "คลิกเพื่อเลือกวิดีโอสาธิต (.mp4, .webm)"}
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    className="ai-file-hidden-input"
                    onChange={(e) => setBaseClip(e.target.files?.[0] ?? null)}
                    disabled={scanBusy || !isOwner || isArchived}
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
                          ? "คลิปที่เลือก — ดูซ้ำได้ตลอด"
                          : "วิดีโอสาธิตที่บันทึกไว้ — ดูซ้ำได้ตลอด"}
                      </p>
                    </>
                  ) : savedDemoState === "loading" ? (
                    <p className="ai-progress">กำลังโหลดวิดีโอสาธิตที่บันทึกไว้…</p>
                  ) : savedDemoState === "error" ? (
                    <p className="ai-error">โหลดวิดีโอสาธิตที่บันทึกไว้ไม่สำเร็จ</p>
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
                {isPoseExercise && (
                  <>
                    <canvas
                      ref={scanPreviewCanvasRef}
                      className="ai-frame-preview"
                      width={480}
                      height={270}
                      style={{ display: scanBusy ? "block" : "none" }}
                    />

                    <div className="ai-base-demo-actions">
                  <button
                    type="button"
                    className="primary-button"
                    style={{ width: "100%", marginTop: 12, justifyContent: "center" }}
                    onClick={handleScanBaseClip}
                    disabled={!baseClip || scanBusy}
                  >
                    {scanBusy ? <Loader2 size={16} className="spin-icon" /> : <Upload size={16} />}
                    สแกนและปรับเทียบ
                  </button>
                  {scanProgressText && <p className="ai-progress">{scanProgressText}</p>}
                  {scanError && <p className="ai-error">{scanError}</p>}

                  <details className="ai-extra-clips">
                  <summary className="ai-extra-clips-toggle">
                    <span>ตัวอย่างวิดีโอเพิ่มเติม (ไม่บังคับ)</span>
                    <span className="ai-extra-clips-counts">
                      {masterClips.length > 0 && <span className="ai-clip-count">{masterClips.length}</span>}
                      {wrongFormClips.length > 0 && <span className="ai-clip-count ai-clip-count-err">{wrongFormClips.length}</span>}
                    </span>
                  </summary>
                  <div className="ai-extra-clips-content">
                <section className="ai-extra-clip-field">
                <div className="creation-section-header">
                  <Film size={20} />
                  <div>
                    <strong>วิดีโอตัวอย่างท่าที่ถูกต้องเพิ่มเติม</strong>
                    <p className="library-card-sub">เพิ่มวิดีโอตัวอย่างท่าที่ถูกต้องเพื่อปรับปรุงความแม่นยำในการจับคู่การเคลื่อนไหว</p>
                  </div>
                </div>
                <label className="ai-file-upload-area ai-file-upload-area-sm">
                  <Upload size={16} className="ai-file-upload-icon" />
                  <span className="ai-file-upload-label">อัปโหลดวิดีโอตัวอย่างท่าที่ถูกต้องเพิ่มเติม</span>
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
                        <small>{clip.frames.length} เฟรม</small>
                        <button
                          type="button"
                          className="text-action danger"
                          aria-label="นำออก"
                          onClick={() => setMasterClips((prev) => prev.filter((c) => c.id !== clip.id))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="ai-extra-clip-field">
                <div className="creation-section-header">
                  <Film size={20} />
                  <div>
                    <strong>วิดีโอตัวอย่างท่าที่ไม่ถูกต้อง</strong>
                    <p className="library-card-sub">วิดีโอตัวอย่างท่าที่ไม่ถูกต้องสำหรับฝึกตรวจจับความผิดพลาดของท่าทาง</p>
                  </div>
                </div>
                <label className="ai-file-upload-area ai-file-upload-area-sm">
                  <Upload size={16} className="ai-file-upload-icon" />
                  <span className="ai-file-upload-label">อัปโหลดวิดีโอตัวอย่างท่าที่ไม่ถูกต้อง</span>
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
                        <small>{clip.frames.length} เฟรม</small>
                        <button
                          type="button"
                          className="text-action danger"
                          aria-label="นำออก"
                          onClick={() => setWrongFormClips((prev) => prev.filter((c) => c.id !== clip.id))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
                  </div>
                  </details>
                </div>
                  </>
                )}
              </section>

              {/* Step 3 — Exercise skeleton preview and Pose Landmarker setup */}
              <section className="creation-section-card ai-card-full ai-pose-setup-step">
                <div className="ai-card-step-tag">ขั้นตอนที่ 3 · ตัวอย่างการเคลื่อนไหวและกำหนดจุดตรวจสอบ</div>
                <div className="ai-pose-content-grid">
                  <div className="ai-pose-preview-column">
                    <div className="creation-section-header">
                      <Film size={20} />
                      <div>
                        <strong>ตัวอย่างการเคลื่อนไหวของโครงกระดูก</strong>
                        <p className="library-card-sub">กำหนดจุดตรวจสอบจากเฟรมของท่าบริหารนี้</p>
                      </div>
                    </div>
                <div className="ai-save-actions" style={{ margin: "6px 0" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      if (previewIndex >= baseFrames.length - 1) setPreviewIndex(0);
                      setIsPreviewPlaying((playing) => !playing);
                    }}
                    disabled={baseFrames.length < 2}
                    aria-label={isPreviewPlaying ? "หยุดเล่นโครงกระดูกชั่วคราว" : "เล่นโครงกระดูก"}
                  >
                    {isPreviewPlaying ? <Pause size={16} /> : <Play size={16} />}
                    {isPreviewPlaying ? "หยุดชั่วคราว" : "เล่น"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setPreviewIndex(0);
                      setIsPreviewPlaying(true);
                    }}
                    disabled={baseFrames.length < 2}
                    aria-label="เล่นโครงกระดูกซ้ำตั้งแต่ต้น"
                  >
                    <RotateCcw size={16} /> เล่นซ้ำ
                  </button>
                </div>
                <canvas ref={previewCanvasRef} className="ai-frame-preview" width={480} height={270} />
                  </div>

                  <div className="ai-checkpoint-details">
                    <div className="creation-section-header">
                      <div>
                        <strong>รายละเอียดจุดตรวจสอบ</strong>
                        <p className="library-card-sub">หมุดทั้งสามกำหนดเฟรมท่าเริ่มต้น จุดสูงสุด และการกลับสู่ท่าเริ่มต้นตามลำดับ การลากหมุดจะอัปเดตภาพตัวอย่าง เฟรม เวลา และมุม พร้อมใช้จุดเหล่านี้คำนวณเกณฑ์การนับครั้ง</p>
                      </div>
                    </div>
                    <div className="ai-checkpoint-grid">
                      {CHECKPOINT_ROLES.map(({ role, title, icon }) => {
                        const checkpoint = checkpointForLandmark(role);
                        const timelineIndex = movementLandmarkFrameIndex(movementLandmarks, CHECKPOINT_LANDMARK_ROLES[role]);
                        return (
                          <button
                            key={role}
                            type="button"
                            className={`ai-checkpoint-card checkpoint-${CHECKPOINT_LANDMARK_ROLES[role]}${activeCheckpointRole === role ? " active" : ""}`}
                            onClick={() => selectRoleForEditing(role)}
                            disabled={timelineFrames.length === 0}
                          >
                            <span className="ai-checkpoint-number">{checkpoint ? "✓" : icon}</span>
                            <div>
                              <strong>{title}</strong>
                              <small>
                                {checkpoint
                                    ? `เฟรม ${timelineIndex + 1} · ${checkpoint.timestampSeconds.toFixed(2)} วินาที`
                                  : "ยังไม่มีเฟรม"}
                              </small>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                  </div>
                </div>
                <div className="ai-landmark-setup">
                  <strong className="ai-landmark-timeline-title">ไทม์ไลน์แสดงการเคลื่อนไหว</strong>
                  <p className="ai-landmark-instruction">
                    ลากหมุดบนไทม์ไลน์เพื่อกำหนดจุดตรวจสอบท่าเริ่มต้น จุดสูงสุด และการกลับสู่ท่าเริ่มต้นตามลำดับการเคลื่อนไหว
                  </p>
                  {timelineFrames.length >= 3 ? (
                    <>
                      <div
                        ref={landmarkTrackRef}
                        className="ai-landmark-track"
                        onPointerMove={handleLandmarkPointerMove}
                        onPointerUp={() => { draggingLandmarkRef.current = null; }}
                        onPointerCancel={() => { draggingLandmarkRef.current = null; }}
                        aria-label="ไทม์ไลน์แสดงการเคลื่อนไหว"
                      >
                        <div className="ai-landmark-track-fill" />
                        {MOVEMENT_LANDMARK_ROLES.map(({ role, label, colorClass }) => {
                          const frameIndex = movementLandmarkFrameIndex(movementLandmarks, role);
                          const minimum = role === "start"
                            ? 0
                            : role === "middle"
                              ? movementLandmarks.startFrameIndex + 1
                              : movementLandmarks.middleFrameIndex + 1;
                          const maximum = role === "start"
                            ? movementLandmarks.middleFrameIndex - 1
                            : role === "middle"
                              ? movementLandmarks.endFrameIndex - 1
                              : timelineFrames.length - 1;
                          return (
                            <button
                              key={role}
                              type="button"
                              className={`ai-landmark-pin ${colorClass}${activeCheckpointRole === CHECKPOINT_ROLE_BY_LANDMARK[role] ? " selected" : ""}`}
                              style={{ left: `${(frameIndex / (timelineFrames.length - 1)) * 100}%` }}
                              role="slider"
                              aria-label={`จุดตรวจสอบ: ${label}`}
                              aria-valuemin={minimum}
                              aria-valuemax={maximum}
                              aria-valuenow={frameIndex}
                              aria-valuetext={`เฟรม ${frameIndex + 1} · ${timelineFrames[frameIndex]?.videoTimeSeconds.toFixed(2) ?? "0.00"} วินาที`}
                              disabled={!isOwner || isArchived}
                              onPointerDown={(event) => {
                                setActiveCheckpointRole(CHECKPOINT_ROLE_BY_LANDMARK[role]);
                                draggingLandmarkRef.current = role;
                                event.currentTarget.setPointerCapture(event.pointerId);
                                const bounds = landmarkTrackRef.current?.getBoundingClientRect();
                                if (bounds && bounds.width > 0) {
                                  const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
                                  moveLandmarkToFrame(role, fraction * (timelineFrames.length - 1));
                                }
                              }}
                              onPointerUp={() => { draggingLandmarkRef.current = null; }}
                              onKeyDown={(event) => handleLandmarkKeyDown(event, role)}
                            />
                          );
                        })}
                      </div>
                    </>
                  ) : baseFrames.length > 0 ? (
                    <p className="ai-error" role="alert">
                      ข้อมูลโครงกระดูกมีเพียง {timelineFrames.length} เฟรม ต้องมีอย่างน้อย 3 เฟรมเพื่อกำหนดจุดตรวจสอบ
                    </p>
                  ) : (
                    <p className="library-card-sub">โหลดข้อมูลโครงกระดูกของท่าบริหารเพื่อกำหนดจุดตรวจสอบ</p>
                  )}
                </div>

                <div className="ai-landmark-scrubber">
                  <label htmlFor="ai-selected-frame">เฟรมที่เลือก</label>
                  <input
                    id="ai-selected-frame"
                    type="range"
                    min={0}
                    max={Math.max(0, timelineFrames.length - 1)}
                    value={selectedTimelineIndex}
                    onChange={(event) => {
                      const index = Number(event.target.value);
                      setPreviewIndex(index * (baseFramesFromStoredReference ? 1 : 3));
                    }}
                    disabled={timelineFrames.length === 0}
                    aria-label="เฟรมที่เลือก"
                  />
                  <p className="library-card-sub" style={{ marginTop: 4 }}>
                    {timelineFrames.length > 0
                      ? `เฟรม ${selectedTimelineIndex + 1} / ${timelineFrames.length} · เวลา: ${(selectedTimelineFrame?.videoTimeSeconds ?? 0).toFixed(2)} วินาที`
                      : "ยังไม่มีเฟรมที่สแกน"}
                  </p>
                  {scanError && <p className="ai-error">{scanError}</p>}
                </div>
              </section>

              {/* Step 4 — Save to Library */}
              <section className="creation-section-card ai-card-full ai-save-step">
                <div className="ai-card-step-tag">ขั้นตอนที่ 4 · บันทึกลงคลัง</div>
                <div className="creation-section-header">
                  <Save size={20} />
                  <div>
                    <strong>บันทึกเกณฑ์ท่าบริหาร</strong>
                    <p className="library-card-sub">บันทึกข้อมูลอ้างอิงและเกณฑ์ที่กำหนดไว้ลงในคลังท่าบริหาร</p>
                  </div>
                </div>

                <div className="ai-save-target">
                  {targetExercise ? (
                    <>
                      <strong>
                        กำลังแก้ไข: {targetExercise.name} · v{targetExercise.versionNumber}
                      </strong>
                      <span>
                        {targetExercise.status === "active"
                          ? `บันทึกแล้วจะสร้างฉบับร่าง v${targetExercise.versionNumber + 1} โดยฉบับที่ใช้งานอยู่จะไม่เปลี่ยนแปลง`
                          : targetExercise.status === "archived"
                            ? "เวอร์ชันเก็บถาวรเปิดดูได้อย่างเดียว"
                            : "บันทึกการเปลี่ยนแปลงลงในฉบับร่างนี้"}
                      </span>
                      {targetExercise.status === "active" && (
                        <span>
                          หลังเผยแพร่ฉบับใหม่แล้ว ให้เพิ่มหรืออัปเดตท่านี้ในแผนผู้ป่วยเพื่อใช้เกณฑ์ใหม่
                        </span>
                      )}
                      {!targetExercise.demoVideoFileId && !baseClip && (
                        <span className="ai-error">ท่าบริหารนี้ยังไม่มีวิดีโอสาธิต — เลือกวิดีโอสาธิตหลักเพื่อเพิ่ม</span>
                      )}
                    </>
                  ) : (
                    <>
                      <strong>พร้อมสร้างท่าบริหารฉบับร่างใหม่</strong>
                      <span>รายละเอียดและข้อมูลอ้างอิงจาก AI จะถูกบันทึกลงในคลังท่าบริหาร</span>
                    </>
                  )}
                </div>

                <div className="ai-field">
                  <div className="ai-exercise-status-heading">
                    <label>สถานะท่าบริหาร</label>
                    <span className={`library-status-badge ${targetExercise?.status ?? "draft"}`}>
                      {targetExercise?.status === "active"
                        ? "ใช้งาน"
                        : targetExercise?.status === "archived"
                          ? "เก็บถาวร"
                          : "ฉบับร่าง"}
                    </span>
                  </div>
                  <p className="library-card-sub" style={{ margin: 0 }}>
                    {targetExercise?.status === "active"
                      ? "เวอร์ชันนี้กำลังใช้งาน การแก้ไขจะสร้างฉบับร่างเวอร์ชันใหม่"
                      : targetExercise?.status === "archived"
                        ? "เวอร์ชันนี้เก็บถาวรและไม่สามารถแก้ไขได้"
                        : "ท่าบริหารฉบับร่างยังไม่เปิดให้ใช้งานจนกว่าจะเผยแพร่"}
                  </p>
                </div>

                <div className="ai-field">
                  <label>ระดับความเข้มงวดในการนับจำนวนครั้ง</label>
                  <p className="library-card-sub" style={{ margin: 0 }}>
                    {sensitivityLevels[repSensitivityIndex].desc} (ระดับความยาก {DIFFICULTY_INFO[difficulty].icon}{" "}
                    {DIFFICULTY_LABELS_TH[difficulty]} ปรับได้ {DIFFICULTY_INFO[difficulty].rangeText} จากค่าที่วิเคราะห์)
                  </p>
                  <div className="ai-choice-row">
                    {sensitivityLevels.map((level, index) => (
                      <button
                        key={level.label}
                        type="button"
                        className={`ai-choice ${repSensitivityIndex === index ? "active" : ""}`}
                        onClick={() => handleSensitivityChange(index)}
                        disabled={!canEditPoseCriteria}
                        aria-pressed={repSensitivityIndex === index}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ai-field">
                  <label>ความเข้มงวดในการตรวจจับการเอนลำตัวชดเชย (BVE)</label>
                  <p className="library-card-sub" style={{ margin: 0 }}>
                    {enableTrunkBve
                      ? BVE_SENSITIVITY_LEVELS.find((level) => Math.abs(bveThreshold - level.value) < 1e-6)?.desc ?? "กำหนดเกณฑ์เองไว้แล้ว"
                      : "ปิดอยู่ — ไม่หักคะแนนเมื่อผู้ป่วยเอนลำตัวช่วยแทนการเคลื่อนไหว"}
                  </p>
                  <div className="ai-choice-row">
                    <button
                      type="button"
                      className={`ai-choice ${!enableTrunkBve ? "active" : ""}`}
                      onClick={() => setEnableTrunkBve(false)}
                      disabled={!canEditPoseCriteria}
                      aria-pressed={!enableTrunkBve}
                    >
                      ปิด
                    </button>
                    {[...BVE_SENSITIVITY_LEVELS].reverse().map((level) => {
                      const selected = enableTrunkBve && Math.abs(bveThreshold - level.value) < 1e-6;
                      return (
                        <button
                          key={level.value}
                          type="button"
                          className={`ai-choice ${selected ? "active" : ""}`}
                          onClick={() => {
                            setEnableTrunkBve(true);
                            setBveThreshold(level.value);
                          }}
                          disabled={!canEditPoseCriteria}
                          aria-pressed={selected}
                        >
                          {level.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="ai-save-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleSave}
                    disabled={!canSave || saveBusy}
                  >
                    {saveBusy ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                    {targetExercise?.status === "active"
                      ? `บันทึกเป็นฉบับร่าง v${targetExercise.versionNumber + 1}`
                      : targetExercise
                        ? "บันทึกการเปลี่ยนแปลง"
                        : "สร้างท่าบริหาร"}
                  </button>
                </div>

                {saveError && <p className="ai-error">{saveError}</p>}
                {savedExerciseName && (
                  <p className="ai-success">
                    <CheckCircle2 size={16} /> สร้าง “{savedExerciseName}” เป็นฉบับร่างแล้ว — เผยแพร่ได้จากคลังท่าบริหาร
                  </p>
                )}
              </section>

              <section className="creation-section-card ai-manual-criteria-card ai-card-full">
                <div className="ai-card-step-tag">
                  ขั้นตอนที่ {isHandTrackingExercise ? 3 : 2} · เกณฑ์ท่าบริหาร
                </div>
                <div className="creation-section-header">
                  {movementTracking === "virtual_grip" ? <Hand size={20} /> : <Dumbbell size={20} />}
                  <div>
                    <strong>{movementTracking === "virtual_grip" ? "เกณฑ์การวัดแรงบีบมือ" : "เกณฑ์ท่าบริหาร"}</strong>
                    <p className="library-card-sub">กำหนดเกณฑ์ที่จะใช้เมื่อมอบหมายกิจกรรมนี้ให้ผู้ป่วย</p>
                  </div>
                </div>
                {movementTracking === "virtual_grip" && (
                  <label className="ai-field">แรงบีบมือเป้าหมาย
                    <input className="ai-input" type="number" min="0" value={targetGripStrength} onChange={(event) => setTargetGripStrength(event.target.value)} disabled={isArchived || !isOwner} />
                  </label>
                )}
                {movementTracking === "virtual_grip" && (
                  <label className="ai-field">ระยะเวลาค้างไว้ (วินาที)
                    <input className="ai-input" type="number" min="0" value={holdSeconds} onChange={(event) => setHoldSeconds(event.target.value)} disabled={isArchived || !isOwner} />
                  </label>
                )}
                <div className="ai-save-actions">
                  <button type="button" className="primary-button" onClick={handleSave} disabled={!canSave || saveBusy}>
                    {saveBusy ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                    {targetExercise?.status === "active" ? `บันทึกเป็นฉบับร่าง v${targetExercise.versionNumber + 1}` : targetExercise ? "บันทึกการเปลี่ยนแปลง" : "สร้างฉบับร่าง"}
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
