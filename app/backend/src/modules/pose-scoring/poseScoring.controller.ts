// Pose scoring module — HTTP handlers. Follows the same controller patterns as
// modules/session-results/session.controller.ts: requireAuth already applied at
// the router level, self-patient-or-admin scoping, requireParam validation,
// and next(err) error forwarding.

import { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../common/errors";
import * as poseScoringService from "./poseScoring.service";

function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Missing "${name}" route parameter.`);
  }
  return value;
}

// Same self-patient-or-admin rule as session.controller's
// requireSelfPatientOrAdmin: patients act on their own data, admins on any.
function requireSelfPatientOrAdmin(req: Request): { callerId: string; isAdmin: boolean } {
  if (!req.user) throw new UnauthenticatedError();
  if (req.user.role === "patient" || req.user.role === "admin") {
    return { callerId: req.user.sub, isAdmin: req.user.role === "admin" };
  }
  throw new ForbiddenError("Only a patient can access pose scoring.");
}

export async function getPoseReferenceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const scheduledExerciseId = requireParam(req, "id");
    const { callerId, isAdmin } = requireSelfPatientOrAdmin(req);
    res.json(await poseScoringService.getPoseReference(callerId, scheduledExerciseId, isAdmin));
  } catch (err) {
    next(err);
  }
}

export async function scorePoseRepHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const scheduledExerciseId = requireParam(req, "id");
    const { callerId, isAdmin } = requireSelfPatientOrAdmin(req);
    const body = req.body ?? {};
    res.status(201).json(
      await poseScoringService.scorePoseRep(callerId, scheduledExerciseId, isAdmin, {
        repNumber: body.repNumber,
        frames: body.frames,
        peakRom: body.peakRom,
        baseTrunkPoint: body.baseTrunkPoint,
        // Forwarded so the torso-twist penalty gets its rep-start baseline —
        // without it computePeakTorsoTwist falls back to frame 0's ratio.
        baseShoulderWidthNorm: body.baseShoulderWidthNorm,
        baseRawTrunkPoint: body.baseRawTrunkPoint,
        baseTrunkLength: body.baseTrunkLength,
        baseWristDistanceNorm: body.baseWristDistanceNorm
      })
    );
  } catch (err) {
    next(err);
  }
}

// POST /exercises/test-pose-rep-score — therapist/admin AI exercise test
// (ExerciseAiPage's "Test exercise" button → PatientSessionPage testConfig).
// No patient or scheduled exercise is involved: the reference comes from the
// request body (the therapist's on-screen criteria, possibly unsaved) or the
// exercise_library row named by exerciseId. Role gating happens at the route
// (requireRole("therapist", "admin")).
export async function scoreTestPoseRepHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body ?? {};
    res.status(201).json(
      await poseScoringService.scoreTestPoseRep({
        exerciseId: typeof body.exerciseId === "string" && body.exerciseId.length > 0 ? body.exerciseId : undefined,
        poseReference: body.poseReference,
        repNumber: body.repNumber,
        frames: body.frames,
        peakRom: body.peakRom,
        baseTrunkPoint: body.baseTrunkPoint,
        baseShoulderWidthNorm: body.baseShoulderWidthNorm,
        baseRawTrunkPoint: body.baseRawTrunkPoint,
        baseTrunkLength: body.baseTrunkLength,
        baseWristDistanceNorm: body.baseWristDistanceNorm
      })
    );
  } catch (err) {
    next(err);
  }
}
