import type { PatientRehabPlan } from "../types";
import { patient101Plans } from "./patientDetailMock";

// Backs the patient's own Progress page (sidebar "Progress",
// pages/PatientProgressPage.tsx). PATIENT_PROGRESS_MOCKUP_PLAN.md §2.2: this
// patient (id "patient-101", reconciled in data/patientMock.ts §2.1) re-exports
// the *same* plan-101-2 / day5Exercises data already seeded in
// data/patientDetailMock.ts for the therapist-side "Somchai P." record — not a
// re-typed copy — so a PT's Program Editor assignment and this patient's own
// Progress view of that plan can never drift apart, the same way
// data/patientHistoryMock.ts already commits to staying consistent with
// data/patientDetailMock.ts for History.
export const patientRehabPlans: PatientRehabPlan[] = patient101Plans;
