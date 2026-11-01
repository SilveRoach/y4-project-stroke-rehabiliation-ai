// Exercise & Program module — HTTP handlers for Exercise library CRUD
// (docs/04-design/api-design.md's "Exercise Library" section).
//
// Authorization pattern mirrors modules/therapist/therapist.controller.ts:
// ownership ("owning therapist") is a dynamic check against the row being acted
// on, so it lives in exercise.service.ts (which has the row already loaded)
// rather than as a static requireRole(...) — role-only middleware can't express
// "this specific exercise belongs to the caller". requireRole(...) in
// exercise.routes.ts still handles the coarser "must be a therapist at all"
// gate before we even look up the row.

import { NextFunction, Request, Response } from "express";
import { UnauthenticatedError, ValidationError } from "../../common/errors";
import * as exerciseService from "./exercise.service";
import type { ExerciseInput } from "./exercise.service";

function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Missing "${name}" route parameter.`);
  }
  return value;
}

function requireUser(req: Request) {
  if (!req.user) throw new UnauthenticatedError();
  return req.user;
}

// Shared body parsing for POST /exercises, PATCH /exercises/:id, and
// POST /exercises/:id/versions — all three accept the same shape. Deep
// validation (name length, allowed enum values, etc.) happens in
// exercise.service.ts's sanitizeInput(); this only checks the body isn't
// missing entirely, so the service always gets an object to work with.
function parseExerciseInput(req: Request): ExerciseInput {
  const body = req.body as Partial<ExerciseInput> | undefined;
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body is required.");
  }
  return {
    name: body.name ?? "",
    description: body.description,
    movementTracking: body.movementTracking as ExerciseInput["movementTracking"],
    difficultyLevel: body.difficultyLevel as ExerciseInput["difficultyLevel"],
    baseCriteria: body.baseCriteria,
    demoVideoFileId: body.demoVideoFileId
  };
}

export async function getExerciseLibraryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const exercises = await exerciseService.getExerciseLibrary({ id: user.sub, role: user.role });
    res.json({ exercises });
  } catch (err) {
    next(err);
  }
}

export async function getExerciseByIdHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const id = requireParam(req, "id");
    const exercise = await exerciseService.getExerciseById({ id: user.sub, role: user.role }, id);
    res.json({ exercise });
  } catch (err) {
    next(err);
  }
}

export async function createExerciseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const input = parseExerciseInput(req);
    const exercise = await exerciseService.createExercise(user.sub, input);
    res.status(201).json({ exercise });
  } catch (err) {
    next(err);
  }
}

// PATCH /exercises/:id — addition beyond api-design.md (see exercise.service.ts
// gap #4): edits a still-`draft` version's fields in place, without bumping the
// version number. Returns 409 (via ConflictError) if the target isn't a draft.
export async function updateExerciseDraftHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const id = requireParam(req, "id");
    const input = parseExerciseInput(req);
    const exercise = await exerciseService.updateExerciseDraft(user.sub, id, input);
    res.json({ exercise });
  } catch (err) {
    next(err);
  }
}

export async function createExerciseVersionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const id = requireParam(req, "id");
    const input = parseExerciseInput(req);
    const exercise = await exerciseService.createExerciseVersion(user.sub, id, input);
    res.status(201).json({ exercise });
  } catch (err) {
    next(err);
  }
}

// Not currently called by ExerciseLibraryPage.tsx — see exercise.service.ts's
// publishExercise() comment. Wired here so the documented route exists even
// though no UI button triggers it yet.
export async function publishExerciseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const id = requireParam(req, "id");
    const exercise = await exerciseService.publishExercise(user.sub, id);
    res.json({ exercise });
  } catch (err) {
    next(err);
  }
}

export async function archiveExerciseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const id = requireParam(req, "id");
    const exercise = await exerciseService.archiveExercise(user.sub, id);
    res.json({ exercise });
  } catch (err) {
    next(err);
  }
}

// POST /exercises/:id/duplicate — clone an exercise into a new family root (v1, draft).
export async function duplicateExerciseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const id = requireParam(req, "id");
    const exercise = await exerciseService.duplicateExercise(user.sub, id);
    res.status(201).json({ exercise });
  } catch (err) {
    next(err);
  }
}
