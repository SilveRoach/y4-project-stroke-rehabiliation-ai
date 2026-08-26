// Session & Results module — Express router, wires routes to session.controller.ts

import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  getPatientScheduledExerciseHandler,
  getPatientScheduledExerciseDemoVideoHandler,
  getPatientTodayHandler,
  getTherapistSessionsHandler
} from "./session.controller";

export const sessionRouter = Router();

// GET /therapists/:id/sessions — NOT in api-design.md's "Training Sessions"
// section (which only documents the per-patient GET /patients/:id/sessions).
// TherapistSessionsPage.tsx needs a cross-patient log across the therapist's
// whole caseload; see session.service.ts's header comment for the full
// reasoning. Self-or-admin gated, same pattern as
// modules/therapist/therapist.routes.ts's dashboard/patients routes.
sessionRouter.get("/therapists/:id/sessions", requireAuth, getTherapistSessionsHandler);
sessionRouter.get("/patients/:id/today", requireAuth, getPatientTodayHandler);
sessionRouter.get("/scheduled-exercises/:id", requireAuth, getPatientScheduledExerciseHandler);
sessionRouter.get("/scheduled-exercises/:id/demo-video", requireAuth, getPatientScheduledExerciseDemoVideoHandler);
