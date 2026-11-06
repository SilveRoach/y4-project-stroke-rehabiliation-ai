// Exercise & Program module — Express router, wires routes to
// exercise.controller.ts. Matches docs/04-design/api-design.md's "Exercise
// Library" section, plus one addition (see below).
//
// Role gate: every route requires an authenticated Therapist or Admin — GET
// routes allow both (Admin can view any therapist's library per api-design.md),
// write routes (create/edit/version/publish/archive) are Therapist-only per the
// docs' "Owning Therapist" column; the *specific-row* ownership check (must be
// the row's actual creator, not just any therapist) happens inside
// exercise.controller.ts/exercise.service.ts, same split as
// modules/therapist/therapist.routes.ts already uses for its own dynamic
// self-or-admin checks.

import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import {
  archiveExerciseHandler,
  createExerciseHandler,
  createExerciseVersionHandler,
  duplicateExerciseHandler,
  getExerciseByIdHandler,
  getExerciseLibraryHandler,
  publishExerciseHandler,
  updateExerciseDraftHandler
} from "./exercise.controller";

export const exerciseRouter = Router();

exerciseRouter.get("/exercises", requireAuth, requireRole("therapist", "admin"), getExerciseLibraryHandler);
exerciseRouter.get("/exercises/:id", requireAuth, requireRole("therapist", "admin"), getExerciseByIdHandler);
exerciseRouter.post("/exercises", requireAuth, requireRole("therapist"), createExerciseHandler);

// PATCH /exercises/:id — NOT in api-design.md. Added to support editing a
// draft exercise's fields in place (no version bump), which
// ExerciseLibraryPage.tsx's existing UI already assumed was possible before
// this pass wired it to a real backend. See exercise.service.ts's gap #4
exerciseRouter.patch("/exercises/:id", requireAuth, requireRole("therapist"), updateExerciseDraftHandler);
exerciseRouter.put("/exercises/:id", requireAuth, requireRole("therapist"), updateExerciseDraftHandler);

exerciseRouter.post("/exercises/:id/versions", requireAuth, requireRole("therapist"), createExerciseVersionHandler);
exerciseRouter.patch("/exercises/:id/publish", requireAuth, requireRole("therapist"), publishExerciseHandler);
exerciseRouter.post("/exercises/:id/publish", requireAuth, requireRole("therapist"), publishExerciseHandler);
exerciseRouter.patch("/exercises/:id/archive", requireAuth, requireRole("therapist"), archiveExerciseHandler);
exerciseRouter.post("/exercises/:id/archive", requireAuth, requireRole("therapist"), archiveExerciseHandler);
exerciseRouter.post("/exercises/:id/duplicate", requireAuth, requireRole("therapist"), duplicateExerciseHandler);
