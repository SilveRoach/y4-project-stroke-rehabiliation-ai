// Therapist module — Express router, wires routes to therapist.controller.ts.
// Matches the routes documented in docs/04-design/api-design.md's
// "Dashboard & Reporting" section (plus /therapists/:id/patients from the
// "Users" section, which lives here rather than user-management since it's
// therapist-dashboard-shaped data, not account-management data).

import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { getPatientReportHandler, getTherapistDashboardHandler, getTherapistPatientsHandler } from "./therapist.controller";

export const therapistRouter = Router();

therapistRouter.get("/therapists/:id/patients", requireAuth, getTherapistPatientsHandler);
therapistRouter.get("/therapists/:id/dashboard", requireAuth, getTherapistDashboardHandler);
therapistRouter.get("/patients/:id/report", requireAuth, getPatientReportHandler);
