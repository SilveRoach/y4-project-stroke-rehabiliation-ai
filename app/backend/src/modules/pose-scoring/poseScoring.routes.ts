// Pose scoring module — Express router. Mounted at /api/v1 root (app.ts), so
// the full paths are:
//   GET  /api/v1/scheduled-exercises/:id/pose-reference
//   POST /api/v1/scheduled-exercises/:id/pose-rep-score
//   POST /api/v1/exercises/test-pose-rep-score   (therapist/admin test runs)
// Same requireAuth + self-patient-or-admin patterns as session.routes.ts for
// the patient routes; the test route is therapist/admin-only instead.

import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { getPoseReferenceHandler, scorePoseRepHandler, scoreTestPoseRepHandler } from "./poseScoring.controller";

export const poseScoringRouter = Router();

// Client asks for the exercise's FSM/angle criteria (starting-position check +
// rep detection), not the scoring reference samples.
poseScoringRouter.get("/scheduled-exercises/:id/pose-reference", requireAuth, getPoseReferenceHandler);

// Client submits one captured repetition's skeleton features for scoring.
poseScoringRouter.post("/scheduled-exercises/:id/pose-rep-score", requireAuth, scorePoseRepHandler);

// Therapist-side AI exercise test (ExerciseAiPage's "Test exercise" button →
// PatientSessionPage's testConfig): scores one captured repetition against the
// exercise's authored criteria with NO patient/scheduled-exercise context.
// Lives in this router so all scoring stays in one module; it cannot collide
// with exerciseRouter's /exercises/* routes — every one of those is either a
// different method or a different path shape (see exercise.routes.ts).
poseScoringRouter.post(
  "/exercises/test-pose-rep-score",
  requireAuth,
  requireRole("therapist", "admin"),
  scoreTestPoseRepHandler
);
