// Therapist module — HTTP handlers for the Dashboard & Reporting endpoints
// (docs/04-design/api-design.md). Authorization here is "self-or-admin" /
// "assigned-therapist-or-admin" — dynamic checks against req.params, which is
// why these live inline in the controller rather than as a static
// requireRole(...) middleware (that only covers fixed roles, not "this
// specific id belongs to the caller").

import { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../common/errors";
import * as therapistService from "./therapist.service";

// Express types req.params values as `string | string[]` (a route param can
// repeat, e.g. `/:id/:id`), even though none of this module's routes actually
// allow that. Narrows to a single string, or fails loudly if a route param is
// somehow missing/repeated instead of silently passing an array downstream
// into a Prisma `where` clause.
function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Missing "${name}" route parameter.`);
  }
  return value;
}

/** Allows the request through only if the caller is Admin, or is the therapist named in :id. */
function requireSelfTherapistOrAdmin(req: Request, therapistId: string): void {
  if (!req.user) throw new UnauthenticatedError();
  if (req.user.role === "admin") return;
  if (req.user.role === "therapist" && req.user.sub === therapistId) return;
  throw new ForbiddenError("You can only view your own dashboard.");
}

export async function getTherapistPatientsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireParam(req, "id");
    requireSelfTherapistOrAdmin(req, id);
    const patients = await therapistService.getTherapistPatients(id);
    res.json({ patients });
  } catch (err) {
    next(err);
  }
}

export async function getTherapistDashboardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireParam(req, "id");
    requireSelfTherapistOrAdmin(req, id);
    const dashboard = await therapistService.getTherapistDashboard(id);
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
}

export async function getPatientReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new UnauthenticatedError();
    const patientId = requireParam(req, "id");

    if (req.user.role === "therapist") {
      await therapistService.assertTherapistAssignedToPatient(req.user.sub, patientId);
    } else if (req.user.role !== "admin") {
      throw new ForbiddenError("Only the assigned therapist or an admin can view this report.");
    }

    const report = await therapistService.getPatientReport(patientId);
    res.json(report);
  } catch (err) {
    next(err);
  }
}
