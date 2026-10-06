// Pose scoring types — adapted from projectimport/Rehab-AI's frontend/src/types/ai.d.ts
// (FrameFeature, ExerciseFSMConfig, AngleDefinition, MasterSample, RepResult).
// These are the wire types shared by the client (which extracts features from
// MediaPipe pose landmarks) and this backend module (which scores a captured
// repetition against the exercise's stored reference criteria).
//
// IMPORTANT DELIBERATE DIFFERENCE vs the import project: scoring runs on the
// BACKEND here (the import project ran scoreEngine client-side). The client
// only extracts per-frame features (angles + trunk centroid) and ships those
// to POST /scheduled-exercises/:id/pose-rep-score; the final score is never
// computed on the client.

export interface FrameFeature {
  /** Primary angle of the frame (mean of both sides, or the single side). */
  elbowAngle: number;
  /** Secondary angle of the frame (mean of both sides, or the single side). */
  shoulderAngle: number;
  leftElbowAngle?: number;
  rightElbowAngle?: number;
  pinchDistance: number;
  trunkCentroid: { x: number; y: number };
  /** Left-right shoulder distance divided by that frame's torso length —
   *  shrinks (foreshortens) the more the torso twists away from the camera.
   *  Used to detect "twisting the whole torso" as a compensation on exercises
   *  that measure a vector angle against a fixed reference axis (see
   *  peakTorsoTwist on RepResult below). Optional: only sent for exercises
   *  that need the torso-twist penalty; absent on master-sample frames seeded
   *  before this field existed. */
  shoulderWidthNorm?: number;
  /** Trunk centroid from the RAW (un-normalized) landmarks. With
   *  baseRawTrunkPoint + baseTrunkLength on the request it yields
   *  meanTrunkDrift — whole-body sway measured in torso lengths (see
   *  RepResult.meanTrunkDrift). Optional: absent => drift 0. */
  rawTrunkCentroid?: { x: number; y: number };
  /** Left-right wrist distance divided by that frame's torso length. Used for
   *  peakHandSeparation on exercises with checksHandProximity. Optional:
   *  absent => hand separation 0. */
  wristDistanceNorm?: number;
  /** Capture time of this frame in ms (client clock). When present on every frame
   *  the backend resamples the rep to the reference clips' 30 fps before scoring
   *  (see frameResample.ts). */
  timestampMs?: number;
}

/** One per-rep, per-body-part coaching item (see detailedFeedback.ts). */
export interface DetailedFeedbackItem {
  /** Body part the item is about, e.g. "ข้อศอก", "ลำตัว", "แขนซ้าย". */
  part: string;
  /** Thai message telling the patient what to adjust. */
  message: string;
  severity: "info" | "warn" | "critical";
}

export type AngleComparator = "greaterThan" | "lessThan";

export interface ExerciseFSMConfig {
  /** Angle that must be reached before the pose counts as "ready to start". */
  readyAngleThreshold: number;
  readyComparator: AngleComparator;
  /** Seconds the ready pose must be held before rep counting begins. */
  readyHoldSeconds: number;
  /** End-of-movement threshold (where the rep enters its "far" phase). */
  activationThreshold: number;
  activationComparator: AngleComparator;
  /** Return-to-start threshold — crossing it (plus minRepFrames) completes 1 rep. */
  returnThreshold: number;
  returnComparator: AngleComparator;
  /** Minimum frames in a rep, guarding against noise-triggered counts. */
  minRepFrames: number;
  /** ROM reference: peakRom = |romReferenceAngle - extreme angle in rep|. */
  romReferenceAngle?: number;
  /** Optional start-pose gate on the secondary angle (client FSM): "ready" only
   *  when the secondary angle is within readySecondaryAngleTolerance (default
   *  40 deg) of this target. Unset = no gate. */
  readySecondaryAngleTarget?: number;
  readySecondaryAngleTolerance?: number;
}

export interface JointLandmarkTriplet {
  a: number;
  vertex: number;
  c: number;
}

export interface VectorLandmarkPair {
  from: number;
  to: number;
  reference: "vertical" | "horizontal";
}

export interface JointAngleDefinition {
  type: "joint";
  bilateral: boolean;
  left?: JointLandmarkTriplet;
  right?: JointLandmarkTriplet;
  single?: JointLandmarkTriplet;
}

export interface VectorAngleDefinition {
  type: "vector";
  bilateral: boolean;
  left?: VectorLandmarkPair;
  right?: VectorLandmarkPair;
  single?: VectorLandmarkPair;
}

export type AngleDefinition = JointAngleDefinition | VectorAngleDefinition;

export interface MasterSample {
  sampleId: number;
  description: string;
  totalFrames: number;
  frames: FrameFeature[];
}

export interface RepResult {
  repNumber: number;
  dtwDistance: number;
  dtwScore: number;
  peakRom: number;
  romScore: number;
  meanBve: number;
  /** Whole-body trunk drift: RMS distance of rawTrunkCentroid from the rep's
   *  base raw point, divided by the base torso length (scale-invariant). Catches
   *  rigid whole-body swaying that the shape-based meanBve does not. 0 when the
   *  client did not send raw trunk data. */
  meanTrunkDrift: number;
  bvePenalty: number;
  /** Peak "shoulder-width shrink" ratio during the rep (0 = still facing the
   *  camera throughout, closer to 1 = twisted near sideways). See
   *  shoulderWidthNorm on FrameFeature above. Only meaningful (and only
   *  penalized) on exercises whose angleDefinition is 'vector' and that don't
   *  allow torso movement — see isVectorAngleExercise in poseScoring.service.ts. */
  peakTorsoTwist: number;
  /** Penalty derived from peakTorsoTwist — a separate, additive penalty from
   *  bvePenalty (different compensation mechanism: twisting vs. leaning). */
  torsoTwistPenalty: number;
  /** Peak widening of the wrist distance over the rep's baseline (in torso
   *  lengths). Penalized only when the reference has checksHandProximity. */
  peakHandSeparation: number;
  handSeparationPenalty: number;
  /** |range(left angle) - range(right angle)| in degrees over the rep, for
   *  exercises whose primary angle is bilateral (frames carry both
   *  leftElbowAngle and rightElbowAngle); 0 otherwise. */
  peakAsymmetryDeg: number;
  bilateralAsymmetryPenalty: number;
  isKnnPass: boolean;
  finalRepScore: number;
  feedbackText: string;
}

// ---------------------------------------------------------------------------
// Exercise Library reference resolution
// ---------------------------------------------------------------------------

/**
 * What the client is allowed to see of the exercise's pose reference: the
 * FSM/angle criteria it needs to detect the starting position and count reps.
 * masterSamples (the reference skeleton feature sequences) stay server-side —
 * they are only needed by the scoring engine, never by the client.
 */
export interface PoseReferencePublic {
  angleDefinition: AngleDefinition;
  secondaryAngleDefinition: AngleDefinition;
  fsmConfig: ExerciseFSMConfig;
  targetRom: number;
  bveThreshold: number;
  enableTrunkBve: boolean;
  /** true = this exercise naturally requires torso movement (e.g. Shoulder
   *  Rotation), unlike an exercise like External Rotation where the torso
   *  should stay still — disables the torsoTwistPenalty for this exercise
   *  specifically, even when angleDefinition is 'vector'. Not set = defaults
   *  to false (penalty enabled per the vector-type rule). */
  allowsTorsoMovement?: boolean;
  /** true = this exercise requires keeping both hands together (e.g. Shoulder
   *  Rotation with one hand guiding the other) — enables the backend's
   *  handSeparationPenalty. Not set = false (no penalty, the previous
   *  behavior): exercises where the hands naturally part must not be penalized. */
  checksHandProximity?: boolean;
}

/** What the backend scoring engine consumes per repetition request. */
export interface PoseRepScoringRequest {
  repNumber: number;
  frames: FrameFeature[];
  /** FSM output: |romReferenceAngle - extreme angle| achieved during the rep. */
  peakRom: number;
  /** Trunk centroid captured when the rep started (BVE baseline). */
  baseTrunkPoint: { x: number; y: number } | null;
  /** shoulderWidthNorm captured when the rep started — the baseline that
   *  peakTorsoTwist measures shrinkage against. Optional/null for exercises
   *  that don't send shoulderWidthNorm per frame. */
  baseShoulderWidthNorm?: number | null;
  /** Raw (un-normalized) trunk centroid captured when the rep started — the
   *  baseline for meanTrunkDrift. Optional: falls back to frames[0].rawTrunkCentroid. */
  baseRawTrunkPoint?: { x: number; y: number } | null;
  /** Torso length (mean shoulder-midpoint -> hip distance, image units) captured
   *  when the rep started — scales meanTrunkDrift. Optional: without it
   *  meanTrunkDrift is 0. */
  baseTrunkLength?: number | null;
  /** wristDistanceNorm captured when the rep started — the baseline for
   *  peakHandSeparation. Optional: falls back to frames[0].wristDistanceNorm. */
  baseWristDistanceNorm?: number | null;
}

/** Therapist AI-exercise test scoring request (ExerciseAiPage's "Test
 *  exercise" button → POST /exercises/test-pose-rep-score): the normal rep
 *  payload plus where to score against — no patient/scheduled exercise exists
 *  for an authoring test. */
export interface TestPoseRepScoringRequest extends PoseRepScoringRequest {
  /** exercise_library row id — fallback reference source when the body copy
   *  of poseReference is omitted, or carries no master samples. Undefined for
   *  a brand-new, not-yet-saved exercise. */
  exerciseId?: string;
  /** The therapist's ON-SCREEN criteria (full baseCriteria.poseReference
   *  shape, INCLUDING masterSamples) — possibly not saved yet. Raw JSON from
   *  the client, parsed through resolvePoseReference() exactly like a stored
   *  copy. */
  poseReference?: unknown;
}

/** Full reference payload — ExerciseLibrary.baseCriteria.poseReference shape. */
export interface PoseReference extends PoseReferencePublic {
  /** Authoring label of the primary angle (e.g. "Elbow flexion/extension
   *  angle"); only used to word detailedFeedback. Server-side only. */
  targetJoint?: string;
  /** Subset of the authoring auto-analysis metadata — only the ranked
   *  candidates' id/label and the chosen secondary id are kept, to name the
   *  secondary joint in detailedFeedback. Server-side only. */
  autoAnalysis?: {
    secondaryCandidateId: string;
    rankedCandidates: { id: string; label: string }[];
  };
  masterSamples: MasterSample[];
  wrongFormSamples?: MasterSample[];
}
