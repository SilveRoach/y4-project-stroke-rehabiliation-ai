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
/** lTorso: mean distance from the shoulder midpoint to each hip (image units). */
export function calculateTorsoLength(landmarks: PoseLandmark[]): number {
  const neckX = (landmarks[11].x + landmarks[12].x) / 2;
  const neckY = (landmarks[11].y + landmarks[12].y) / 2;
  const distLeft = Math.hypot(neckX - landmarks[23].x, neckY - landmarks[23].y);
  const distRight = Math.hypot(neckX - landmarks[24].x, neckY - landmarks[24].y);
  return (distLeft + distRight) / 2 || 1;
}

function calculateShoulderWidthNorm(landmarks: PoseLandmark[]): number {
  const lTorso = calculateTorsoLength(landmarks);
  return Math.hypot(landmarks[11].x - landmarks[12].x, landmarks[11].y - landmarks[12].y) / lTorso;
}

// Left-right wrist (landmarks 15/16, same points the forearm vector angle
// uses) distance over the same frame's torso length — the "are the hands still
// together" signal for exercises with checksHandProximity.
function calculateWristDistanceNorm(landmarks: PoseLandmark[]): number {
  const lTorso = calculateTorsoLength(landmarks);
  return Math.hypot(landmarks[15].x - landmarks[16].x, landmarks[15].y - landmarks[16].y) / lTorso;
}

export type ExerciseFSMState = "WAITING_READY_POSE" | "IN_REP_ACTIVE" | "IN_REP_RETURN";

export interface ExerciseFSMFrameInput {
  /** The frame's primary angle (extractConfiguredAngle per the exercise's definition). */
  angle: number;
  trunkCentroid: { x: number; y: number };
  /** Current time, in the same unit as readyHoldSeconds (performance.now() ms). */
  timestampMs: number;
  /** Raw (un-normalized) body point used to check the patient is actually STILL
   *  while holding the start pose; the hold restarts if it drifts. Optional. */
  stabilityPoint?: { x: number; y: number };
  /** The frame's secondary angle - only consulted when the exercise's FSM config
   *  sets readySecondaryAngleTarget (telling apart start poses the primary angle
   *  alone cannot, e.g. hand pointing up vs down). Optional. */
  secondaryAngle?: number;
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
  /** Raw trunk centroid at rep start — baseline for the backend's meanTrunkDrift. */
  baseRawTrunkPoint: { x: number; y: number } | null;
  /** Torso length at rep start (image units) — scales meanTrunkDrift. */
  baseTrunkLength: number | null;
  /** wristDistanceNorm at rep start — baseline for peakHandSeparation. */
  baseWristDistanceNorm: number | null;
}

export interface ExerciseFSMOutput {
  state: ExerciseFSMState;
  /** Seconds left before rep counting starts (while holding the start pose), or null. */
  readyCountdownSeconds: number | null;
  repCompleted: boolean;
  completedRep?: CompletedRep;
}

// Start-pose hold: how far (normalized image units) the body may drift while
// holding the start pose before the countdown restarts.
const READY_HOLD_POSITION_TOLERANCE = 0.05;
// Start-pose tolerance: a resting arm rarely sits perfectly still, and the ready
// threshold comes from a single demo clip, so the angle is allowed to be up to
// READY_TOLERANCE_RATIO of the ready->activation range on the wrong side of it
// (but never more than 75% of the way to the return threshold, so "ready" cannot
// overlap "rep finished"). Without this a patient whose rest angle hovers around
// the threshold (e.g. 35-47 deg against 42.6) can never finish the countdown.
const READY_TOLERANCE_RATIO = 0.15;
// Default tolerance for readySecondaryAngleTarget when none is configured.
const DEFAULT_READY_SECONDARY_ANGLE_TOLERANCE = 40;
// Far-end detection: a rep's far end counts when the angle crosses the
// calibrated activationThreshold, OR once the patient has covered at least this
// share of the ready->activation range AND holds the angle steady (within
// ACTIVATION_HOLD_TOLERANCE_DEG) for ACTIVATION_HOLD_SECONDS. The second path
// matters because thresholds calibrated from a single demo clip sit at the
// demo's peak, so a patient who reaches 90% of that range (very common in
// rehab) would otherwise be stuck "performing the exercise" forever. How FAR
// they got is scored separately (romScore), not by rep detection.
const MIN_ACTIVATION_PROGRESS_RATIO = 0.3;
const ACTIVATION_HOLD_SECONDS = 0.5;
const ACTIVATION_HOLD_TOLERANCE_DEG = 4;

/** The ready threshold widened by the start-pose tolerance (see READY_TOLERANCE_RATIO). */
export function effectiveReadyThreshold(cfg: ExerciseFSMConfig): number {
  const range = Math.abs(cfg.activationThreshold - cfg.readyAngleThreshold);
  const toReturn = Math.abs(cfg.returnThreshold - cfg.readyAngleThreshold);
  const margin = Math.min(range * READY_TOLERANCE_RATIO, toReturn * 0.75);
  return cfg.readyComparator === "lessThan" ? cfg.readyAngleThreshold + margin : cfg.readyAngleThreshold - margin;
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
  private readyHoldAnchorPoint: { x: number; y: number } | null = null;
  private activationHoldStartMs: number | null = null;
  private activationHoldAnchorAngle: number | null = null;
  private repSequence: FrameFeature[] = [];
  private baseTrunkPoint: { x: number; y: number } | null = null;
  private baseShoulderWidthNorm: number | null = null;
  private baseRawTrunkPoint: { x: number; y: number } | null = null;
  private baseTrunkLength: number | null = null;
  private baseWristDistanceNorm: number | null = null;
  private extremeAngleInRep = 0;
  private repCount = 0;

  constructor(config: ExerciseFSMConfig) {
    this.config = config;
  }

  reset(): void {
    this.state = "WAITING_READY_POSE";
    this.readyHoldStartMs = null;
    this.readyHoldAnchorPoint = null;
    this.activationHoldStartMs = null;
    this.activationHoldAnchorAngle = null;
    this.repSequence = [];
    this.baseTrunkPoint = null;
    this.baseShoulderWidthNorm = null;
    this.baseRawTrunkPoint = null;
    this.baseTrunkLength = null;
    this.baseWristDistanceNorm = null;
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
    const { angle, trunkCentroid, timestampMs, stabilityPoint, secondaryAngle } = input;
    const cfg = this.config;

    let readyCountdownSeconds: number | null = null;
    let repCompleted = false;
    let completedRep: CompletedRep | undefined;

    if (this.state === "WAITING_READY_POSE") {
      const angleReady = compare(angle, cfg.readyComparator, effectiveReadyThreshold(cfg));
      // Optional orientation gate (see ExerciseFSMConfig.readySecondaryAngleTarget).
      const orientationReady =
        cfg.readySecondaryAngleTarget === undefined ||
        secondaryAngle === undefined ||
        Math.abs(secondaryAngle - cfg.readySecondaryAngleTarget) <=
          (cfg.readySecondaryAngleTolerance ?? DEFAULT_READY_SECONDARY_ANGLE_TOLERANCE);
      const isReady = angleReady && orientationReady;

      if (isReady) {
        // The hold restarts if the body drifts away from where it started.
        const driftedTooFar =
          !!stabilityPoint &&
          !!this.readyHoldAnchorPoint &&
          Math.hypot(stabilityPoint.x - this.readyHoldAnchorPoint.x, stabilityPoint.y - this.readyHoldAnchorPoint.y) >
            READY_HOLD_POSITION_TOLERANCE;
        if (this.readyHoldStartMs === null || driftedTooFar) {
          this.readyHoldStartMs = timestampMs;
          this.readyHoldAnchorPoint = stabilityPoint ?? null;
        }
        const elapsedSeconds = (timestampMs - this.readyHoldStartMs) / 1000;
        readyCountdownSeconds = Math.max(0, Math.ceil((cfg.readyHoldSeconds - elapsedSeconds) * 10) / 10);

        if (elapsedSeconds >= cfg.readyHoldSeconds) {
          this.state = "IN_REP_ACTIVE";
          readyCountdownSeconds = null;
          this.baseTrunkPoint = trunkCentroid;
          this.baseShoulderWidthNorm = frameFeature.shoulderWidthNorm ?? null;
          this.baseRawTrunkPoint = frameFeature.rawTrunkCentroid ?? null;
          this.baseTrunkLength = frameFeature.trunkLength ?? null;
          this.baseWristDistanceNorm = frameFeature.wristDistanceNorm ?? null;
          this.repSequence = [];
          this.extremeAngleInRep = angle;
          this.readyHoldAnchorPoint = null;
          this.activationHoldStartMs = null;
          this.activationHoldAnchorAngle = null;
        }
      } else {
        this.readyHoldStartMs = null;
        this.readyHoldAnchorPoint = null;
      }
    } else if (this.state === "IN_REP_ACTIVE") {
      this.repSequence.push(frameFeature);
      this.extremeAngleInRep =
        cfg.activationComparator === "lessThan"
          ? Math.min(this.extremeAngleInRep, angle)
          : Math.max(this.extremeAngleInRep, angle);

      const fullDistance = Math.abs(cfg.activationThreshold - cfg.readyAngleThreshold) || 1;
      const isIncreasingDirection = cfg.activationComparator === "greaterThan";
      const progressedDistance = isIncreasingDirection
        ? this.extremeAngleInRep - cfg.readyAngleThreshold
        : cfg.readyAngleThreshold - this.extremeAngleInRep;
      const metMinimumProgress = progressedDistance >= fullDistance * MIN_ACTIVATION_PROGRESS_RATIO;

      // "Held steady" tracking: the anchor resets whenever the angle moves more
      // than the tolerance away from it, so only a real pause at the far end
      // (not just passing through) accumulates hold time.
      const driftedFromHoldAnchor =
        this.activationHoldAnchorAngle === null ||
        Math.abs(angle - this.activationHoldAnchorAngle) > ACTIVATION_HOLD_TOLERANCE_DEG;
      if (driftedFromHoldAnchor) {
        this.activationHoldStartMs = timestampMs;
        this.activationHoldAnchorAngle = angle;
      }
      const activationHeldSeconds = (timestampMs - (this.activationHoldStartMs ?? timestampMs)) / 1000;

      // Either the calibrated far-end angle was actually reached (fast swing, no
      // pause needed) or the patient paused steadily at a point that covers a
      // good part of the range (they cannot reach the demo's peak).
      const crossedActivation = compare(angle, cfg.activationComparator, cfg.activationThreshold);
      if (crossedActivation || (metMinimumProgress && activationHeldSeconds >= ACTIVATION_HOLD_SECONDS)) {
        this.state = "IN_REP_RETURN";
        this.activationHoldStartMs = null;
        this.activationHoldAnchorAngle = null;
      }
    } else if (this.state === "IN_REP_RETURN") {
      this.repSequence.push(frameFeature);

      const reachedReturn = compare(angle, cfg.returnComparator, cfg.returnThreshold);
      if (reachedReturn && this.repSequence.length > cfg.minRepFrames) {
        this.state = "WAITING_READY_POSE";
        this.readyHoldStartMs = null;
        this.readyHoldAnchorPoint = null;
        this.repCount += 1;
        repCompleted = true;

        const romReferenceAngle = cfg.romReferenceAngle ?? 180;
        completedRep = {
          sequence: this.repSequence,
          peakRom: Math.abs(romReferenceAngle - this.extremeAngleInRep),
          baseTrunkPoint: this.baseTrunkPoint ?? trunkCentroid,
          baseShoulderWidthNorm: this.baseShoulderWidthNorm,
          baseRawTrunkPoint: this.baseRawTrunkPoint,
          baseTrunkLength: this.baseTrunkLength,
          baseWristDistanceNorm: this.baseWristDistanceNorm
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
    // The trunk centroid here is already built from raw landmarks (nothing is
    // neck-normalized in this pipeline), so the raw copy equals it; it is sent
    // as its own field because the backend pairs it with trunkLength to get a
    // torso-length-scaled drift.
    rawTrunkCentroid: { ...trunkCentroid },
    shoulderWidthNorm: calculateShoulderWidthNorm(landmarks),
    wristDistanceNorm: calculateWristDistanceNorm(landmarks),
    trunkLength: calculateTorsoLength(landmarks)
  };
  if (primary.left !== undefined) feature.leftElbowAngle = primary.left;
  if (primary.right !== undefined) feature.rightElbowAngle = primary.right;
  return feature;
}

