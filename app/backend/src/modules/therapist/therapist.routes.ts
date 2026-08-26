// Therapist module — Express router, wires routes to therapist.controller.ts.
// Matches the routes documented in docs/04-design/api-design.md's
// "Dashboard & Reporting" section (plus /therapists/:id/patients from the
// "Users" section, which lives here rather than user-management since it's
// therapist-dashboard-shaped data, not account-management data).

import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  getPatientReportHandler,
  getTherapistDashboardHandler,
  getTherapistPatientsHandler,
  listAllPatientsHandler,
  assignPatientHandler
} from "./therapist.controller";

export const therapistRouter = Router();

// List patients assigned to a therapist (dashboard view)
therapistRouter.get("/therapists/:id/patients", requireAuth, getTherapistPatientsHandler);
// Therapist dashboard
therapistRouter.get("/therapists/:id/dashboard", requireAuth, getTherapistDashboardHandler);
// Per-patient report (requires assigned therapist or admin)
therapistRouter.get("/patients/:id/report", requireAuth, getPatientReportHandler);

// Search / list all patients (active + disabled) — available to authenticated users
therapistRouter.get("/patients", requireAuth, listAllPatientsHandler);
// Assign a patient to a therapist (therapist may only assign themselves) — body: { patientId }
therapistRouter.post("/therapists/:id/patients", requireAuth, assignPatientHandler);
