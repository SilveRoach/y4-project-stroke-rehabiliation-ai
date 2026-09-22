import type { TherapistSessionLogEntry } from "../types";
import { therapistPatients } from "./therapistMock";

// Cross-patient session log for the sidebar's "Sessions" page. Real per-patient
// session history only exists (as mock data) for patient-101 in
// data/patientDetailMock.ts's curated profile — there's no backend endpoint that
// aggregates `exercise_performance_results` across a therapist's whole caseload
// yet. This derives a plausible recent session (or two) per patient from
// data/therapistMock.ts's existing TherapistPatientSummary fields, so the page has
// something realistic to show without inventing unrelated clinical detail.
export const therapistSessionLog: TherapistSessionLogEntry[] = therapistPatients.flatMap((patient, patientIndex) => {
  // The one at-risk patient in the mock caseload (Pranom Chaisri, index 3) gets a
  // single, skipped session instead of two completed ones — matches her
  // lower compliance/progress numbers instead of contradicting them.
  const isAtRisk = patient.standing === "at_risk";
  const entries: TherapistSessionLogEntry[] = [];

  entries.push({
    id: `${patient.id}-log-0`,
    patientId: patient.id,
    patientName: patient.name,
    patientAvatarInitials: patient.avatarInitials,
    // Mock plan identity: the mock caseload has no real plans, so a synthetic
    // "current program" plan is assumed per patient.
    rehabilitationPlanId: `${patient.id}-plan-0`,
    rehabilitationPlanName: "Current program",
    dateLabel: patient.lastSessionLabel,
    dayLabel: `Day ${patient.sessionsCompleted}`,
    exercisesAttempted: isAtRisk ? 0 : 3,
    outcome: isAtRisk ? "skipped" : "completed",
    avgScore: isAtRisk ? undefined : Math.min(98, Math.max(45, patient.progressPercent + 6)),
    evaluationSource: isAtRisk ? undefined : "ai"
  });

  if (!isAtRisk) {
    entries.push({
      id: `${patient.id}-log-1`,
      patientId: patient.id,
      patientName: patient.name,
      patientAvatarInitials: patient.avatarInitials,
      rehabilitationPlanId: `${patient.id}-plan-0`,
      rehabilitationPlanName: "Current program",
      dateLabel: "—",
      dayLabel: `Day ${Math.max(1, patient.sessionsCompleted - 1)}`,
      exercisesAttempted: 3,
      outcome: "completed",
      avgScore: Math.min(98, Math.max(45, patient.progressPercent - 3)),
      evaluationSource: patientIndex % 2 === 0 ? "pt_reviewed" : "ai"
    });
  }

  return entries;
});
