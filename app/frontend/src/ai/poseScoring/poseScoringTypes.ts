// Pose scoring types (client side) — mirrors the backend pose-scoring module's
// wire types (app/backend/src/modules/pose-scoring/poseScoring.types.ts),
// originally adapted from projectimport/Rehab-AI's types/ai.d.ts.
//
// The client uses these to (a) read the exercise's starting-position/rep
// criteria (PoseReferencePublic from GET /scheduled-exercises/:id/pose-reference)
// and (b) build per-frame features (FrameFeature) from MediaPipe pose landmarks.
// Final scoring happens on the backend — the client never computes the score.

export type AngleComparator = "greaterThan" | "lessThan";

export interface PoseLandmarkTriplet {
  a: number;
  vertex: number;
  c: number;
}

export interface PoseVectorPair {
  from: number;
  to: number;
  reference: "vertical" | "horizontal";
}

export interface JointAngleDefinition {
  type: "joint";
  bilateral: boolean;
  left?: PoseLandmarkTriplet;
  right?: PoseLandmarkTriplet;
  single?: PoseLandmarkTriplet;
}

export interface VectorAngleDefinition {
  type: "vector";
  bilateral: boolean;
  left?: PoseVectorPair;
  right?: PoseVectorPair;
  single?: PoseVectorPair;
}

export type AngleDefinition = JointAngleDefinition | VectorAngleDefinition;

export interface ExerciseFSMConfig {
  readyAngleThreshold: number;
  readyComparator: AngleComparator;
  readyHoldSeconds: number;
  activationThreshold: number;
  activationComparator: AngleComparator;
  returnThreshold: number;
  returnComparator: AngleComparator;
  minRepFrames: number;
  romReferenceAngle?: number;
  /** Optional start-pose gate on the SECONDARY angle: the pose only counts as
   *  "ready" when the secondary angle is within readySecondaryAngleTolerance
   *  (default 40 deg) of this target. Separates start poses the primary angle
   *  alone cannot (e.g. Side Bend with the hand pointing up vs down). From the
   *  therapist's `ready` checkpoint. Unset = no gate. */
  readySecondaryAngleTarget?: number;
  readySecondaryAngleTolerance?: number;
}

/** Per-frame feature sent to the backend for scoring (one repetition's worth). */
export interface FrameFeature {
  elbowAngle: number;
  shoulderAngle: number;
  leftElbowAngle?: number;
  rightElbowAngle?: number;
  pinchDistance: number;
  trunkCentroid: { x: number; y: number };
  /** Left-right shoulder distance divided by torso length (lTorso) of the same
   *  frame — shrinks the more the torso twists away from the camera. Lets the
   *  backend detect "twisting the whole torso" as a compensation on exercises
   *  that measure a vector angle against a fixed reference axis. Optional:
   *  only meaningful when paired with baseShoulderWidthNorm on the scoring
   *  request (see scorePoseRep in services/api.ts). */
  shoulderWidthNorm?: number;
  /** Trunk centroid from the raw landmarks. With baseRawTrunkPoint +
   *  baseTrunkLength on the scoring request, the backend derives meanTrunkDrift
   *  (whole-body sway in torso lengths). */
  rawTrunkCentroid?: { x: number; y: number };
  /** Left-right wrist distance divided by torso length of the same frame —
   *  lets the backend detect "released the hands" on exercises that set
   *  checksHandProximity (see peakHandSeparation in the scoring result). */
  wristDistanceNorm?: number;
  /** Capture time of this frame (ms). Lets the backend resample the rep to the
   *  reference clips' 30 fps (live detection runs at ~15 fps). */
  timestampMs?: number;
  /** Torso length (mean shoulder-midpoint -> hip distance, image units) of
   *  this frame. CLIENT-SIDE ONLY: the FSM snapshots it at rep start as
   *  baseTrunkLength; the backend ignores it. */
  trunkLength?: number;
}

/** GET /scheduled-exercises/:id/pose-reference response payload. */
export interface PoseReferencePublic {
  angleDefinition: AngleDefinition;
  secondaryAngleDefinition: AngleDefinition;
  fsmConfig: ExerciseFSMConfig;
  targetRom: number;
  bveThreshold: number;
  enableTrunkBve: boolean;
  /** true = this exercise naturally requires torso movement (e.g. Shoulder
   *  Rotation) — the backend disables its torso-twist penalty for this
   *  exercise even though angleDefinition is 'vector'. Not used to change any
   *  client-side behavior; carried here only because it's part of the same
   *  wire payload the backend sends. */
  allowsTorsoMovement?: boolean;
  /** true = this exercise requires keeping both hands together (e.g. Shoulder
   *  Rotation) — the backend then penalizes the hands drifting apart
   *  (handSeparationPenalty). Like allowsTorsoMovement it changes nothing on
   *  the client; it is carried here because it is part of the same wire payload. */
  checksHandProximity?: boolean;
}

/** One per-rep, per-body-part coaching item (backend detailedFeedback.ts). */
export interface PoseDetailedFeedbackItem {
  /** Body part, e.g. "ข้อศอก", "ลำตัว", "แขนซ้าย". */
  part: string;
  /** Thai message telling the patient what to adjust. */
  message: string;
  severity: "info" | "warn" | "critical";
}

/** POST /scheduled-exercises/:id/pose-rep-score response payload. */
export interface PoseRepScoringResult {
  repNumber: number;
  score: number;
  feedback: string;
  metrics: {
    dtwScore: number;
    dtwDistance: number;
    peakRom: number;
    targetRom: number;
    romScore: number;
    meanBve: number;
    /** Whole-body trunk drift in torso lengths (0 when raw trunk data absent). */
    meanTrunkDrift: number;
    bveThreshold: number;
    bvePenalty: number;
    peakTorsoTwist: number;
    torsoTwistPenalty: number;
    /** Peak widening of wrist distance over the rep baseline (torso lengths). */
    peakHandSeparation: number;
    handSeparationPenalty: number;
    /** |range(left angle) - range(right angle)| in degrees (bilateral exercises, else 0). */
    peakAsymmetryDeg: number;
    bilateralAsymmetryPenalty: number;
    isKnnPass: boolean;
  };
  detailedFeedback: PoseDetailedFeedbackItem[];
}
