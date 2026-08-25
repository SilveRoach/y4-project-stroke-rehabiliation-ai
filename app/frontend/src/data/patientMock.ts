import type { PatientProgramDay, TrackingType } from "../types";

export const patientProgram: PatientProgramDay = {
  // Reconciled to "patient-101" (PATIENT_PROGRESS_MOCKUP_PLAN.md §2.1) so this
  // patient's own mock identity matches the therapist-side curated record
  // ("Somchai P.", #P-0142) in data/patientDetailMock.ts — previously this was
  // "patient-001", a second, disconnected identity for what's meant to be the
  // same person, which meant Progress had no real plan to borrow from. See
  // data/patientRehabPlanMock.ts, which now reuses patientDetailMock.ts's
  // patient-101 plans directly for this patient's Progress page.
  patient: {
    id: "patient-101",
    displayName: "Somchai",
    phoneNumber: "0812345678",
    role: "patient"
  },
  dayNumber: 5,
  totalDays: 14,
  exercises: [
    {
      id: "ex-shoulder-circle",
      name: "Shoulder Flexion",
      nameTh: "ยกแขนไปด้านหน้า",
      trackingType: "pose",
      targetLabel: "10 laps",
      status: "done",
      feedback: "Completed today with steady shoulder control.",
      progressLabel: "10 of 10",
      durationMinutes: 10,
      sets: 3,
      reps: 12,
      difficulty: "Moderate",
      score: 88
    },
    {
      id: "ex-hold-drop",
      name: "Hand Grip Training",
      nameTh: "ฝึกกำมือและปล่อยมือ",
      trackingType: "virtual_grip",
      targetLabel: "Goal: 20 holds",
      status: "in_progress",
      feedback: "Keep the hand open until the box reaches the line.",
      progressLabel: "14 of 20",
      durationMinutes: 8,
      sets: 4,
      reps: 10,
      difficulty: "Easy"
    },
    {
      id: "ex-wrist-extension",
      name: "Wrist Extension",
      nameTh: "เหยียดข้อมือ",
      trackingType: "both",
      targetLabel: "12 reps",
      status: "not_started",
      feedback: "Lift the wrist slowly and keep the forearm relaxed.",
      progressLabel: "0 of 12",
      durationMinutes: 12,
      sets: 3,
      reps: 12,
      difficulty: "Hard"
    }
  ],
  heatmap: [
    "completed",
    "completed",
    "missed",
    "completed",
    "completed",
    "completed",
    "missed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "missed",
    "today"
  ]
};

export const trackingLabels: Record<TrackingType, string> = {
  pose: "Body tracking",
  virtual_grip: "Hand tracking",
  both: "Body and hand"
};
