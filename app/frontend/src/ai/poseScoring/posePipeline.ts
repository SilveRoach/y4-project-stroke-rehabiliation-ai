// Pose rep-tracking pipeline (client side) — adapted from projectimport/
// Rehab-AI's ai/pipelineCoordinator.ts (ExerciseFSM) + ai/extractors/
// centroidExtractor.ts, typed against this project's PoseLandmark and the
// exercise's criteria from the Exercise Library (poseReferencePublic).
//
// ExerciseFSM drives the exact per-repetition flow:
//   WAITING_READY_POSE → (patient holds the defined starting position for
//   readyHoldSeconds; readyCountdownSeconds ticks down) → IN_REP_ACTIVE →
//   (primary angle passes the activation threshold) → IN_REP_RETURN →
//   (returns past the return threshold with >= minRepFrames frames) →
//   repCompleted with the captured frame sequence + peakRom.

import type { PoseLandmark } from "../poseDetection";
import { extractConfiguredAngle } from "./angleExtraction";
import type { AngleDefinition, ExerciseFSMConfig, FrameFeature } from "./poseScoringTypes";

/** Mean of shoulders (11/12) + hips (23/24) — the trunk centroid signal. */
export function calculateTrunkCentroid(landmarks: PoseLandmark[]): { x: number; y: number } {
  const x = (landmarks[11].x + landmarks[12].x + landmarks[23].x + landmarks[24].x) / 4;
  const y = (landmarks[11].y + landmarks[12].y + landmarks[23].y + landmarks[24].y) / 4;
  return { x, y };
}

// Left-right shoulder distance divided by torso length (lTorso) of the same
// frame — adapted from projectimport/Rehab-AI's ai/normalizers/torsoNormalizer.ts
// (lTorso = mean distance from the shoulder midpoint to each hip landmark).
// Computed directly from raw landmarks (this pipeline doesn't keep a fully
// normalized landmark set around like the import project's ExerciseLiveView
// did) — dividing by lTorso here has the same translation/scale-cancelling
// effect as the import project's normalizedLandmarks[11]/[12] difference.
function calculateShoulderWidthNorm(landmarks: PoseLandmark[]): number {
  const neckX = (landmarks[11].x + landmarks[12].x) / 2;
  const neckY = (landmarks[11].y + landmarks[12].y) / 2;
  const distLeft = Math.hypot(neckX - landmarks[23].x, neckY - landmarks[23].y);
  const distRight = Math.hypot(neckX - landmarks[24].x, neckY - landmarks[24].y);
  const lTorso = (distLeft + distRight) / 2 || 1;
  return Math.hypot(landmarks[11].x - landmarks[12].x, landmarks[11].y - landmarks[12].y) / lTorso;
}

export type ExerciseFSMState = "WAITING_READY_POSE" | "IN_REP_ACTIVE" | "IN_REP_RETURN";

export interface ExerciseFSMFrameInput {
  /** The frame's primary angle (extractConfiguredAngle per the exercise's definition). */
  angle: number;
  trunkCentroid: { x: number; y: number };
  /** Current time, in the same unit as readyHoldSeconds (performance.now() ms). */
  timestampMs: number;
}

export interface CompletedRep {
  /** Full frame sequence of the rep — sent to the backend for scoring. */
  sequence: FrameFeature[];
  /** |romReferenceAngle - extreme angle reached during the rep|. */
  peakRom: number;
  /** Trunk centroid captured when the rep started (backend BVE baseline). */
  baseTrunkPoint: { x: number; y: number };
  /** shoulderWidthNorm captured when the rep started — the baseline the
   *  backend measures torso-twist shrinkage against. Null when the frame at
   *  rep-start didn't have a computable value (should not normally happen). */
  baseShoulderWidthNorm: number | null;
}

export interface ExerciseFSMOutput {
  state: ExerciseFSMState;
  /** Seconds left before rep counting starts (while holding the start pose), or null. */
  readyCountdownSeconds: number | null;
  repCompleted: boolean;
  completedRep?: CompletedRep;
}

export function compare(value: number, comparator: "greaterThan" | "lessThan", threshold: number): boolean {
  return comparator === "greaterThan" ? value > threshold : value < threshold;
}

// Fallback criteria for exercises whose Exercise Library row has no stored
// poseReference yet — identical to the backend pose-scoring module's defaults
// (bilateral elbow extension, from projectimport/Rehab-AI's exercisePresets).
export const DEFAULT_PRIMARY_ANGLE_DEFINITION: AngleDefinition = {
  type: "joint",
  bilateral: true,
  left: { a: 11, vertex: 13, c: 15 },
  right: { a: 12, vertex: 14, c: 16 }
};

export const DEFAULT_SECONDARY_ANGLE_DEFINITION: AngleDefinition = {
  type: "joint",
  bilateral: true,
  left: { a: 23, vertex: 11, c: 13 },
  right: { a: 24, vertex: 12, c: 14 }
};

export const DEFAULT_FSM_CONFIG: ExerciseFSMConfig = {
  readyAngleThreshold: 85,
  readyComparator: "greaterThan",
  readyHoldSeconds: 1.5,
  activationThreshold: 45,
  activationComparator: "lessThan",
  returnThreshold: 80,
  returnComparator: "greaterThan",
  minRepFrames: 20,
  romReferenceAngle: 180
};


export class ExerciseFSM {
  private readonly config: ExerciseFSMConfig;
  private state: ExerciseFSMState = "WAITING_READY_POSE";
  private readyHoldStartMs: number | null = null;
  private repSequence: FrameFeature[] = [];
  private baseTrunkPoint: { x: number; y: number } | null = null;
  private baseShoulderWidthNorm: number | null = null;
  private extremeAngleInRep = 0;
  private repCount = 0;

  constructor(config: ExerciseFSMConfig) {
    this.config = config;
  }

  reset(): void {
    this.state = "WAITING_READY_POSE";
    this.readyHoldStartMs = null;
    this.repSequence = [];
    this.baseTrunkPoint = null;
    this.baseShoulderWidthNorm = null;
  }

  getState(): ExerciseFSMState {
    return this.state;
  }

  getConfig(): ExerciseFSMConfig {
    return this.config;
  }

  getRepCount(): number {
    return this.repCount;
  }

  /** The rep's baseline trunk point (set on entering IN_REP_ACTIVE). */
  getBaseTrunkPoint(): { x: number; y: number } | null {
    return this.baseTrunkPoint;
  }

  /**
   * Processes one frame — call every detection frame in chronological order
   * (like a state-machine reducer).
   * @param input this frame's primary angle / trunk centroid / timestamp
   * @param frameFeature the full frame feature, accumulated into the rep
   *        sequence sent to the backend when the rep completes
   */
  processFrame(input: ExerciseFSMFrameInput, frameFeature: FrameFeature): ExerciseFSMOutput {
    const { angle, trunkCentroid, timestampMs } = input;
    const cfg = this.config;

    let readyCountdownSeconds: number | null = null;
    let repCompleted = false;
    let completedRep: CompletedRep | undefined;

    if (this.state === "WAITING_READY_POSE") {
      const isReady = compare(angle, cfg.readyComparator, cfg.readyAngleThreshold);

      if (isReady) {
        if (this.readyHoldStartMs === null) {
          this.readyHoldStartMs = timestampMs;
        }
        const elapsedSeconds = (timestampMs - this.readyHoldStartMs) / 1000;
        readyCountdownSeconds = Math.max(0, Math.ceil((cfg.readyHoldSeconds - elapsedSeconds) * 10) / 10);

        if (elapsedSeconds >= cfg.readyHoldSeconds) {
          this.state = "IN_REP_ACTIVE";
          readyCountdownSeconds = null;
          this.baseTrunkPoint = trunkCentroid;
          this.baseShoulderWidthNorm = frameFeature.shoulderWidthNorm ?? null;
          this.repSequence = [];
          this.extremeAngleInRep = angle;
        }
      } else {
        this.readyHoldStartMs = null;
      }
    } else if (this.state === "IN_REP_ACTIVE") {
      this.repSequence.push(frameFeature);
      this.extremeAngleInRep =
        cfg.activationComparator === "lessThan"
          ? Math.min(this.extremeAngleInRep, angle)
          : Math.max(this.extremeAngleInRep, angle);

      if (compare(angle, cfg.activationComparator, cfg.activationThreshold)) {
        this.state = "IN_REP_RETURN";
      }
    } else if (this.state === "IN_REP_RETURN") {
      this.repSequence.push(frameFeature);

      const reachedReturn = compare(angle, cfg.returnComparator, cfg.returnThreshold);
      if (reachedReturn && this.repSequence.length > cfg.minRepFrames) {
        this.state = "WAITING_READY_POSE";
        this.readyHoldStartMs = null;
        this.repCount += 1;
        repCompleted = true;

        const romReferenceAngle = cfg.romReferenceAngle ?? 180;
        completedRep = {
          sequence: this.repSequence,
          peakRom: Math.abs(romReferenceAngle - this.extremeAngleInRep),
          baseTrunkPoint: this.baseTrunkPoint ?? trunkCentroid,
          baseShoulderWidthNorm: this.baseShoulderWidthNorm
        };
      }
    }

    return { state: this.state, readyCountdownSeconds, repCompleted, completedRep };
  }
}

/**
 * Builds one FrameFeature from live pose landmarks using the exercise's
 * configured primary/secondary angle definitions (mirrors what the import
 * project's ExerciseLiveView fed into its FSM).
 */
export function buildFrameFeature(
  landmarks: PoseLandmark[],
  angleDefinition: AngleDefinition,
  secondaryAngleDefinition: AngleDefinition
): FrameFeature {
  const primary = extractConfiguredAngle(landmarks, angleDefinition);
  const secondary = extractConfiguredAngle(landmarks, secondaryAngleDefinition);
  const trunkCentroid = calculateTrunkCentroid(landmarks);

  const feature: FrameFeature = {
    elbowAngle: primary.mean,
    shoulderAngle: secondary.mean,
    pinchDistance: 0,
    trunkCentroid,
    shoulderWidthNorm: calculateShoulderWidthNorm(landmarks)
  };
  if (primary.left !== undefined) feature.leftElbowAngle = primary.left;
  if (primary.right !== undefined) feature.rightElbowAngle = primary.right;
  return feature;
}

