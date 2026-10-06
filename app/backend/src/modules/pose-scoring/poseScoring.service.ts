import { ForbiddenError, NotFoundError, ValidationError } from "../../common/errors";
import { prisma } from "../../config/prisma";
import { calculateBVE } from "./bveEvaluator";
import { classifyRep, extractRepFeatures, trainKnnModel } from "./binaryKNN";
import { computeDetailedFeedback, rangeOf } from "./detailedFeedback";
import { evaluateDTW } from "./dtwEvaluator";
import { resolvePoseReference, toPublicReference } from "./poseReference";
import { resampleFramesToRate } from "./frameResample";
import { computeRepScore } from "./scoreEngine";
import { buildRealWrongFormExamples, generateSyntheticTrainingSet } from "./syntheticData";
import {
  DetailedFeedbackItem,
  FrameFeature,
  PoseReference,
  PoseReferencePublic,
  PoseRepScoringRequest,
  TestPoseRepScoringRequest
} from "./poseScoring.types";

export interface PoseRepScoreResult {
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
    meanTrunkDrift: number;
    bveThreshold: number;
    bvePenalty: number;
    peakTorsoTwist: number;
    torsoTwistPenalty: number;
    peakHandSeparation: number;
    handSeparationPenalty: number;
    peakAsymmetryDeg: number;
    bilateralAsymmetryPenalty: number;
    isKnnPass: boolean;
  };
  /** Per-body-part coaching items for this rep (see detailedFeedback.ts). */
  detailedFeedback: DetailedFeedbackItem[];
}

interface ScheduledExerciseWithReference {
  id: string;
  exerciseLibrary: { baseCriteria: unknown };
  scheduleDay: { rehabilitationPlan: { patientId: string } };
}

// Same patient-scoping rule as session-results' findPatientScheduledExercise:
// patients may only touch their own scheduled exercises; admins may touch any.
async function findScheduledExerciseForPatient(
  patientId: string,
  scheduledExerciseId: string,
  isAdmin: boolean
): Promise<ScheduledExerciseWithReference> {
  const scheduledExercise = await prisma.scheduledExercise.findUnique({
    where: { id: scheduledExerciseId },
    select: {
      id: true,
      exerciseLibrary: { select: { baseCriteria: true } },
      scheduleDay: { select: { rehabilitationPlan: { select: { patientId: true } } } }
    }
  });
  if (!scheduledExercise) throw new NotFoundError("Scheduled exercise not found.");

  const ownerPatientId = scheduledExercise.scheduleDay.rehabilitationPlan.patientId;
  if (!isAdmin && ownerPatientId !== patientId) {
    throw new ForbiddenError("This scheduled exercise is not part of your rehabilitation plan.");
  }

  return scheduledExercise;
}

function loadReference(scheduledExercise: ScheduledExerciseWithReference): PoseReference {
  const reference = resolvePoseReference(scheduledExercise.exerciseLibrary.baseCriteria);
  if (!reference) {
    throw new ValidationError(
      "This exercise has no pose reference criteria stored (exercise_library.base_criteria.poseReference) and cannot be scored."
    );
  }
  return reference;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeFrame(raw: unknown): FrameFeature {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Every frame must be an object.");
  }
  const f = raw as Record<string, unknown>;
  if (!isFiniteNumber(f.elbowAngle) || !isFiniteNumber(f.shoulderAngle)) {
    throw new ValidationError('Every frame requires numeric "elbowAngle" and "shoulderAngle".');
  }
  const centroid = f.trunkCentroid as { x?: unknown; y?: unknown } | undefined;
  if (!centroid || !isFiniteNumber(centroid.x) || !isFiniteNumber(centroid.y)) {
    throw new ValidationError('Every frame requires a numeric "trunkCentroid" {x, y}.');
  }
  const frame: FrameFeature = {
    elbowAngle: f.elbowAngle,
    shoulderAngle: f.shoulderAngle,
    pinchDistance: isFiniteNumber(f.pinchDistance) ? f.pinchDistance : 0,
    trunkCentroid: { x: centroid.x, y: centroid.y }
  };
  if (isFiniteNumber(f.leftElbowAngle)) frame.leftElbowAngle = f.leftElbowAngle;
  if (isFiniteNumber(f.rightElbowAngle)) frame.rightElbowAngle = f.rightElbowAngle;
  if (isFiniteNumber(f.shoulderWidthNorm)) frame.shoulderWidthNorm = f.shoulderWidthNorm;
  const rawCentroid = f.rawTrunkCentroid as { x?: unknown; y?: unknown } | undefined;
  if (rawCentroid && isFiniteNumber(rawCentroid.x) && isFiniteNumber(rawCentroid.y)) {
    frame.rawTrunkCentroid = { x: rawCentroid.x, y: rawCentroid.y };
  }
  if (isFiniteNumber(f.wristDistanceNorm)) frame.wristDistanceNorm = f.wristDistanceNorm;
  if (isFiniteNumber(f.timestampMs)) frame.timestampMs = f.timestampMs;
  return frame;
}

// peakTorsoTwist = the point where the shoulder-width ratio shrinks the most
// from the rep's starting baseline (0 = still facing the camera the whole
// rep, closer to 1 = twisted nearly sideways). Uses the peak, not the rep
// average, because torso-twist compensation usually only shows up briefly at
// the extreme of the movement — averaging over the whole rep (including the
// start/return where the torso is usually still upright) would dilute the
// signal past detection (see TORSO_TWIST_THRESHOLD in scoreEngine.ts). Frames
// without shoulderWidthNorm (older clients, or master samples) fall back to
// the baseline itself, contributing a ratio of 0 for that frame.
function computePeakTorsoTwist(frames: FrameFeature[], baseShoulderWidthNorm: number | null | undefined): number {
  const baseline =
    isFiniteNumber(baseShoulderWidthNorm) && baseShoulderWidthNorm > 0
      ? baseShoulderWidthNorm
      : frames[0]?.shoulderWidthNorm || 1;
  const twistRatios = frames.map((f) => Math.max(0, 1 - (f.shoulderWidthNorm ?? baseline) / baseline));
  return twistRatios.length > 0 ? Math.max(...twistRatios) : 0;
}

// meanTrunkDrift = RMS distance of the raw trunk centroid from the rep's base
// raw point, divided by the base torso length (scale-invariant). Unlike
// meanBve it needs the client's raw-trunk fields; without them (older client,
// or no base torso length) it is 0 so the previous scoring is unchanged.
function computeMeanTrunkDrift(frames: FrameFeature[], request: PoseRepScoringRequest): number {
  const points = frames.map((f) => f.rawTrunkCentroid).filter((p): p is { x: number; y: number } => p !== undefined);
  if (points.length === 0) return 0;
  const trunkLength = request.baseTrunkLength;
  if (!isFiniteNumber(trunkLength) || trunkLength <= 0) return 0;
  const base =
    request.baseRawTrunkPoint && isFiniteNumber(request.baseRawTrunkPoint.x) && isFiniteNumber(request.baseRawTrunkPoint.y)
      ? request.baseRawTrunkPoint
      : points[0];
  return calculateBVE(points, base) / trunkLength;
}

// peakHandSeparation = the largest widening of the wrist distance over the
// rep's starting baseline (0 = hands as close as at the start). Peak, not
// mean, for the same reason as peakTorsoTwist (letting go is brief, at the
// extreme of the movement). 0 when frames carry no wristDistanceNorm.
function computePeakHandSeparation(frames: FrameFeature[], baseWristDistanceNorm: number | null | undefined): number {
  const distances = frames.map((f) => f.wristDistanceNorm).filter(isFiniteNumber);
  if (distances.length === 0) return 0;
  const baseline = isFiniteNumber(baseWristDistanceNorm) ? baseWristDistanceNorm : distances[0];
  return Math.max(0, ...distances.map((d) => d - baseline));
}

// GET /scheduled-exercises/:id/pose-reference — the client-visible FSM/angle
// criteria (reference master samples are deliberately NOT included).
export async function getPoseReference(
  patientId: string,
  scheduledExerciseId: string,
  isAdmin: boolean
): Promise<{ poseReference: PoseReferencePublic | null }> {
  const scheduledExercise = await findScheduledExerciseForPatient(patientId, scheduledExerciseId, isAdmin);
  const reference = resolvePoseReference(scheduledExercise.exerciseLibrary.baseCriteria);
  return { poseReference: reference ? toPublicReference(reference) : null };
}

// Shared per-request validation for BOTH the patient endpoint and the
// therapist test endpoint: checks the rep payload and normalizes the captured
// frame sequence.
function validateRepRequest(request: PoseRepScoringRequest): FrameFeature[] {
  if (!isFiniteNumber(request.repNumber) || request.repNumber < 1) {
    throw new ValidationError('"repNumber" must be a positive integer.');
  }
  if (!Array.isArray(request.frames)) {
    throw new ValidationError('"frames" must be an array of frame features.');
  }
  const frames = request.frames.map(normalizeFrame);
  if (frames.length === 0) {
    throw new ValidationError('"frames" must contain at least one frame.');
  }
  if (!isFiniteNumber(request.peakRom) || request.peakRom < 0) {
    throw new ValidationError('"peakRom" must be a non-negative number of degrees.');
  }
  return frames;
}

// The scoring engine itself (BVE → DTW → K-NN → scoreEngine) against an
// already-resolved reference — shared by the patient endpoint (reference from
// the scheduled exercise's library row) and the therapist test endpoint
// (reference from the request body / library row). `frames` is the output of
// validateRepRequest above.
function scoreRepAgainstReference(
  reference: PoseReference,
  request: PoseRepScoringRequest,
  capturedFrames: FrameFeature[]
): { rep: PoseRepScoreResult } {
  // Live capture runs at ~15 fps but the reference clips are 30 fps: compare
  // like-for-like (see frameResample.ts) so the K-NN jerk/length features and
  // DTW alignment are not penalized for the lower sampling rate.
  const frames = resampleFramesToRate(capturedFrames);

  // BVE: trunk-sway penalty, measured from the rep's baseline trunk point
  // (captured when the FSM entered IN_REP_ACTIVE) — same baseline the import
  // project's ExerciseLiveView used.
  const baseTrunkPoint =
    request.baseTrunkPoint && isFiniteNumber(request.baseTrunkPoint.x) && isFiniteNumber(request.baseTrunkPoint.y)
      ? request.baseTrunkPoint
      : frames[0].trunkCentroid;
  const meanBve = calculateBVE(
    frames.map((f) => f.trunkCentroid),
    baseTrunkPoint
  );

  // DTW against the exercise's reference master samples.
  const { bestDistance, dtwScore } = evaluateDTW(
    frames,
    reference.masterSamples.map((s) => s.frames)
  );

  // Binary K-NN form gate, trained per request from the reference samples
  // (+ synthetic wrong-form distortions + any real wrong-form recordings).
  const knnModel = trainKnnModel([
    ...generateSyntheticTrainingSet(reference.masterSamples),
    ...buildRealWrongFormExamples(reference.wrongFormSamples, reference.masterSamples)
  ]);
  const repFeatures = extractRepFeatures(frames, bestDistance);
  const knnResult = classifyRep(knnModel, repFeatures);

  // Only exercises that measure a vector angle against a fixed reference axis
  // (e.g. External Rotation) are vulnerable to torso-twist making the
  // measured angle "fake" — joint-angle exercises don't rely on a fixed
  // reference axis the same way, so twisting the torso doesn't distort them
  // the same way. allowsTorsoMovement opts an exercise out even when its
  // angleDefinition is 'vector' (e.g. Shoulder Rotation, which naturally
  // needs some torso movement as part of the exercise itself).
  const isVectorAngleExercise = reference.angleDefinition?.type === "vector" && !reference.allowsTorsoMovement;
  const peakTorsoTwist = computePeakTorsoTwist(frames, request.baseShoulderWidthNorm);

  const meanTrunkDrift = computeMeanTrunkDrift(frames, request);

  // Hand separation only counts for exercises the therapist flagged with
  // checksHandProximity (hands naturally part in most other exercises).
  const isHandProximityExercise = reference.checksHandProximity === true;
  const peakHandSeparation = computePeakHandSeparation(frames, request.baseWristDistanceNorm);

  // Bilateral asymmetry is auto-detected: the primary angle is bilateral iff
  // frames carry both left and right angles (extractConfiguredAngle only
  // returns them for bilateral definitions), so no authoring flag is needed.
  const leftVals = frames.map((f) => f.leftElbowAngle).filter(isFiniteNumber);
  const rightVals = frames.map((f) => f.rightElbowAngle).filter(isFiniteNumber);
  const isBilateralExercise = leftVals.length > 0 && rightVals.length > 0;
  const peakAsymmetryDeg = isBilateralExercise ? Math.abs(rangeOf(leftVals) - rangeOf(rightVals)) : 0;

  // Final combination — the import project's scoring formula.
  const result = computeRepScore(
    request.repNumber,
    dtwScore,
    bestDistance,
    request.peakRom,
    reference.targetRom,
    meanBve,
    meanTrunkDrift,
    reference.bveThreshold,
    peakTorsoTwist,
    peakHandSeparation,
    peakAsymmetryDeg,
    knnResult.isPass,
    reference.enableTrunkBve,
    isVectorAngleExercise,
    isHandProximityExercise,
    isBilateralExercise
  );

  const detailedFeedback = computeDetailedFeedback(
    frames,
    baseTrunkPoint,
    request.peakRom,
    reference.targetRom,
    meanBve,
    meanTrunkDrift,
    reference.bveThreshold,
    reference.enableTrunkBve,
    reference,
    dtwScore,
    knnResult.isPass
  );

  return {
    rep: {
      repNumber: result.repNumber,
      score: result.finalRepScore,
      feedback: result.feedbackText,
      metrics: {
        dtwScore: result.dtwScore,
        dtwDistance: result.dtwDistance,
        peakRom: result.peakRom,
        targetRom: reference.targetRom,
        romScore: result.romScore,
        meanBve: result.meanBve,
        meanTrunkDrift: result.meanTrunkDrift,
        bveThreshold: reference.bveThreshold,
        bvePenalty: result.bvePenalty,
        peakTorsoTwist: result.peakTorsoTwist,
        torsoTwistPenalty: result.torsoTwistPenalty,
        peakHandSeparation: result.peakHandSeparation,
        handSeparationPenalty: result.handSeparationPenalty,
        peakAsymmetryDeg: result.peakAsymmetryDeg,
        bilateralAsymmetryPenalty: result.bilateralAsymmetryPenalty,
        isKnnPass: result.isKnnPass
      },
      detailedFeedback
    }
  };
}

// POST /scheduled-exercises/:id/pose-rep-score — score one captured repetition
// against the reference stored on the patient's scheduled exercise.
export async function scorePoseRep(
  patientId: string,
  scheduledExerciseId: string,
  isAdmin: boolean,
  request: PoseRepScoringRequest
): Promise<{ rep: PoseRepScoreResult }> {
  const frames = validateRepRequest(request);
  const scheduledExercise = await findScheduledExerciseForPatient(patientId, scheduledExerciseId, isAdmin);
  const reference = loadReference(scheduledExercise);
  return scoreRepAgainstReference(reference, request, frames);
}

// Reference resolution for a therapist's test run (ExerciseAiPage's "Test
// exercise"). Prefers the copy carried in the request body — that is the
// criteria actually ON SCREEN, which may be freshly calibrated and not saved
// yet — but only when it carries master samples (the sequences DTW/K-NN
// compare against). Falls back to the exercise_library row's stored reference
// (when an exerciseId was sent), then to the body copy even without samples
// (evaluateDTW's documented empty-reference rule: it abstains neutrally).
async function resolveTestReference(request: TestPoseRepScoringRequest): Promise<PoseReference> {
  const fromBody = request.poseReference ? resolvePoseReference({ poseReference: request.poseReference }) : null;
  if (fromBody && fromBody.masterSamples.length > 0) return fromBody;

  if (request.exerciseId) {
    const row = await prisma.exerciseLibrary.findUnique({
      where: { id: request.exerciseId },
      select: { baseCriteria: true }
    });
    if (!row) throw new NotFoundError("Exercise not found.");
    const stored = resolvePoseReference(row.baseCriteria);
    if (stored && stored.masterSamples.length > 0) return stored;
  }

  if (fromBody) return fromBody;

  throw new ValidationError(
    "This exercise has no pose reference criteria to score against — scan a base demo clip (or save the exercise) first."
  );
}

// POST /exercises/test-pose-rep-score — therapist-side AI exercise TEST:
// identical scoring pipeline to scorePoseRep, but with no patient/scheduled-
// exercise context (the route gates the caller to therapist/admin). This is
// what gives the test run real scores instead of a local approximation.
export async function scoreTestPoseRep(
  request: TestPoseRepScoringRequest
): Promise<{ rep: PoseRepScoreResult }> {
  const frames = validateRepRequest(request);
  const reference = await resolveTestReference(request);
  return scoreRepAgainstReference(reference, request, frames);
}

