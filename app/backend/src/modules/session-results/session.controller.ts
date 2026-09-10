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

// §2.7 — therapist scoring for one recorded attempt (assigned therapist or admin).
export async function updateAttemptScoringHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const resultId = requireParam(req, "id");
    if (!req.user) throw new UnauthenticatedError();
    if (req.user.role !== "therapist" && req.user.role !== "admin") {
      throw new ForbiddenError("Only a therapist can score session results.");
    }
    const payload = {
      ptScore: req.body?.ptScore,
      ptFeedback: req.body?.ptFeedback,
      finalScore: req.body?.finalScore,
      evaluationSource: req.body?.evaluationSource
    };
    const attempt = await sessionService.updateAttemptScoring(req.user.sub, req.user.role, resultId, payload);
    res.json({ attempt });
  } catch (err) {
    next(err);
  }
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

// §2.7 — real review data for one schedule day (assigned therapist or admin).
export async function getScheduleDayReviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const dayId = requireParam(req, "id");
    if (!req.user) throw new UnauthenticatedError();
    if (req.user.role !== "therapist" && req.user.role !== "admin") {
      throw new ForbiddenError("Only a therapist can review session results.");
    }
    const review = await sessionService.getScheduleDayReview(dayId, req.user.sub, req.user.role === "admin");
    res.json({ review });
  } catch (err) {
    next(err);
  }
}

// §6.7 — multipart submission of a recorded attempt: "file" = the video blob,
// "aiScore"/"aiFeedback" = the (currently mock) AI evaluation fields.
export async function submitExerciseResultHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const scheduledExerciseId = requireParam(req, "id");
    const callerId = requireSelfPatientOrAdmin(req);
    if (!req.file) throw new ValidationError('A recorded video is required in the "file" field.');

    const aiScoreRaw = typeof req.body?.aiScore === "string" ? Number(req.body.aiScore) : req.body?.aiScore;
    const aiScore = typeof aiScoreRaw === "number" && Number.isFinite(aiScoreRaw) ? aiScoreRaw : undefined;
    const aiFeedback = typeof req.body?.aiFeedback === "string" && req.body.aiFeedback.trim().length > 0 ? req.body.aiFeedback.trim() : undefined;

    const submission = await sessionService.submitExerciseResult(
      callerId,
      scheduledExerciseId,
      req.file,
      { aiScore, aiFeedback },
      req.user?.role === "admin"
    );
    res.status(201).json(submission);
  } catch (err) {
    next(err);
  }
}
