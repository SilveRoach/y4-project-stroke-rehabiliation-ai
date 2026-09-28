import { ForbiddenError, NotFoundError, ValidationError } from "../../common/errors";
import { prisma } from "../../config/prisma";
import { calculateBVE } from "./bveEvaluator";
import { classifyRep, extractRepFeatures, trainKnnModel } from "./binaryKNN";
import { evaluateDTW } from "./dtwEvaluator";
import { resolvePoseReference, toPublicReference } from "./poseReference";
import { computeRepScore } from "./scoreEngine";
import { buildRealWrongFormExamples, generateSyntheticTrainingSet } from "./syntheticData";
import { FrameFeature, PoseReference, PoseReferencePublic, PoseRepScoringRequest } from "./poseScoring.types";

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
    bveThreshold: number;
    bvePenalty: number;
    peakTorsoTwist: number;
    torsoTwistPenalty: number;
    isKnnPass: boolean;
  };
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

// POST /scheduled-exercises/:id/pose-rep-score — score one captured repetition.
export async function scorePoseRep(
  patientId: string,
  scheduledExerciseId: string,
  isAdmin: boolean,
  request: PoseRepScoringRequest
): Promise<{ rep: PoseRepScoreResult }> {
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

  const scheduledExercise = await findScheduledExerciseForPatient(patientId, scheduledExerciseId, isAdmin);
  const reference = loadReference(scheduledExercise);

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

  // Final combination — the import project's exact scoring formula.
  const result = computeRepScore(
    request.repNumber,
    dtwScore,
    bestDistance,
    request.peakRom,
    reference.targetRom,
    meanBve,
    reference.bveThreshold,
    peakTorsoTwist,
    knnResult.isPass,
    reference.enableTrunkBve,
    isVectorAngleExercise
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
        bveThreshold: reference.bveThreshold,
        bvePenalty: result.bvePenalty,
        peakTorsoTwist: result.peakTorsoTwist,
        torsoTwistPenalty: result.torsoTwistPenalty,
        isKnnPass: result.isKnnPass
      }
    }
  };
}

