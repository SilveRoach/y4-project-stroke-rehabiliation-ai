// Pose scoring module — Express router. Mounted at /api/v1 root (app.ts), so
// the full paths are:
//   GET  /api/v1/scheduled-exercises/:id/pose-reference
//   POST /api/v1/scheduled-exercises/:id/pose-rep-score
// Same requireAuth + self-patient-or-admin patterns as session.routes.ts.

import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { getPoseReferenceHandler, scorePoseRepHandler } from "./poseScoring.controller";

export const poseScoringRouter = Router();

// Client asks for the exercise's FSM/angle criteria (starting-position check +
// rep detection), not the scoring reference samples.
poseScoringRouter.get("/scheduled-exercises/:id/pose-reference", requireAuth, getPoseReferenceHandler);

// Client submits one captured repetition's skeleton features for scoring.
poseScoringRouter.post("/scheduled-exercises/:id/pose-rep-score", requireAuth, scorePoseRepHandler);
