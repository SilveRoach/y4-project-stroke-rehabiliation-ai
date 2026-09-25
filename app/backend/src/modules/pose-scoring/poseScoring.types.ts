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
  bvePenalty: number;
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
}

/** What the backend scoring engine consumes per repetition request. */
export interface PoseRepScoringRequest {
  repNumber: number;
  frames: FrameFeature[];
  /** FSM output: |romReferenceAngle - extreme angle| achieved during the rep. */
  peakRom: number;
  /** Trunk centroid captured when the rep started (BVE baseline). */
  baseTrunkPoint: { x: number; y: number } | null;
}

/** Full reference payload — ExerciseLibrary.baseCriteria.poseReference shape. */
export interface PoseReference extends PoseReferencePublic {
  masterSamples: MasterSample[];
  wrongFormSamples?: MasterSample[];
}
