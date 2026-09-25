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
}

/** Per-frame feature sent to the backend for scoring (one repetition's worth). */
export interface FrameFeature {
  elbowAngle: number;
  shoulderAngle: number;
  leftElbowAngle?: number;
  rightElbowAngle?: number;
  pinchDistance: number;
  trunkCentroid: { x: number; y: number };
}

/** GET /scheduled-exercises/:id/pose-reference response payload. */
export interface PoseReferencePublic {
  angleDefinition: AngleDefinition;
  secondaryAngleDefinition: AngleDefinition;
  fsmConfig: ExerciseFSMConfig;
  targetRom: number;
  bveThreshold: number;
  enableTrunkBve: boolean;
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
    bveThreshold: number;
    bvePenalty: number;
    isKnnPass: boolean;
  };
}
