// Session & Results module — HTTP handlers.
// SCOPE: only GET /therapists/:id/sessions (cross-patient session log for
// TherapistSessionsPage.tsx) is implemented this pass. Everything else
// api-design.md's "Training Sessions" section documents — patient-facing
// today/results submission, per-patient sessions/heatmap, PT evaluation — is
// still not built. See session.service.ts for the full gap list.

import { NextFunction, Request, Response } from "express";
import path from "path";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../common/errors";
import * as sessionService from "./session.service";

function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Missing "${name}" route parameter.`);
  }
  return value;
}

export async function getTherapistSessionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireParam(req, "id");
    if (!req.user) throw new UnauthenticatedError();
    if (req.user.role !== "admin" && !(req.user.role === "therapist" && req.user.sub === id)) {
      throw new ForbiddenError("You can only view your own session log.");
    }
    const sessions = await sessionService.getTherapistSessions(id);
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
}

export async function getPatientTodayHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new UnauthenticatedError();
    const patientId = requireParam(req, "id");
    if (req.user.role !== "admin" && !(req.user.role === "patient" && req.user.sub === patientId)) {
      throw new ForbiddenError("You can only view your own rehabilitation schedule.");
    }
    res.json(await sessionService.getPatientToday(patientId));
  } catch (err) {
    next(err);
  }
}

function requireSelfPatientOrAdmin(req: Request): string {
  if (!req.user) throw new UnauthenticatedError();
  if (req.user.role === "patient" || req.user.role === "admin") return req.user.sub;
  throw new ForbiddenError("Only a patient can view scheduled exercise instructions.");
}

export async function getPatientScheduledExerciseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const scheduledExerciseId = requireParam(req, "id");
    const callerId = requireSelfPatientOrAdmin(req);
    const instruction = await sessionService.getPatientScheduledExercise(callerId, scheduledExerciseId, req.user?.role === "admin");
    res.json({ scheduledExercise: instruction });
  } catch (err) {
    next(err);
  }
}

export async function getPatientScheduledExerciseDemoVideoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const scheduledExerciseId = requireParam(req, "id");
    const callerId = requireSelfPatientOrAdmin(req);
    const demoVideo = await sessionService.getPatientScheduledExerciseDemoVideo(callerId, scheduledExerciseId, req.user?.role === "admin");
    res.type(demoVideo.mimeType ?? "video/mp4");
    res.sendFile(path.resolve(demoVideo.storagePath));
  } catch (err) {
    next(err);
  }
}
