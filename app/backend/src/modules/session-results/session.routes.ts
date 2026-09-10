// Session & Results module — Express router, wires routes to session.controller.ts

import { Router } from "express";
import multer from "multer";
import { ValidationError } from "../../common/errors";
import { requireAuth } from "../../middleware/auth.middleware";
import { uploadMiddleware } from "../files/file.storage";
import {
  getPatientScheduledExerciseHandler,
  getPatientScheduledExerciseDemoVideoHandler,
  getPatientTodayHandler,
  getScheduleDayReviewHandler,
  getTherapistSessionsHandler,
  submitExerciseResultHandler,
  updateAttemptScoringHandler
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

// GET /schedule-days/:id/results — real attempt data for the therapist's
// Session Result Review page (assigned therapist or admin).
sessionRouter.get("/schedule-days/:id/results", requireAuth, getScheduleDayReviewHandler);

// PATCH /performance-results/:id/scoring — therapist PT score/feedback and the
// AI-vs-PT final-score decision for one recorded attempt (assigned therapist
// or admin). Powers Session Result Review's scoring panel.
sessionRouter.patch("/performance-results/:id/scoring", requireAuth, updateAttemptScoringHandler);

// POST /scheduled-exercises/:id/results — patient submits a recorded attempt
// (multipart: "file" video + optional aiScore/aiFeedback fields). Same multer
// error-mapping wrapper as file.routes.ts's upload route.
sessionRouter.post(
  "/scheduled-exercises/:id/results",
  requireAuth,
  (req, res, next) => {
    uploadMiddleware.single("file")(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        const message = error.code === "LIMIT_FILE_SIZE"
          ? "Recording exceeds the 100 MB size limit."
          : error.message;
        return next(new ValidationError(message));
      }
      if (error) return next(error);
      next();
    });
  },
  submitExerciseResultHandler
);
