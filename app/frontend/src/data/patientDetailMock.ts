import type {
  HeatmapDayStatus,
  PatientDetailProfile,
  PatientRehabPlan,
  PickedFile,
  ScheduleDay,
  ScheduledExercise,
  TherapistPatientSummary
} from "../types";

// Lightweight inline SVG placeholder used as the `previewUrl` for pre-seeded mock
// attachments below. These records were never actually uploaded through
// FilePicker (there's no backend to have uploaded them to), so there's no real
// object URL to point at — this stands in for "some scanned document/photo"
// without pretending a fake blob URL is a real file. Flagged here rather than
// silently faking a `URL.createObjectURL` result.
const MOCK_IMAGE_PREVIEW =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="%23eff6ff"/><rect x="40" y="30" width="120" height="150" rx="8" fill="%23bfdbfe"/><rect x="55" y="55" width="90" height="10" rx="3" fill="%232563eb"/><rect x="55" y="75" width="90" height="8" rx="3" fill="%2393c5fd"/><rect x="55" y="90" width="60" height="8" rx="3" fill="%2393c5fd"/></svg>'
  );

// Mock attachments are pre-seeded (not uploaded via FilePicker), so the video
// entry's `previewUrl` is intentionally "#" rather than a fake blob URL — see
// MOCK_IMAGE_PREVIEW's comment above.
const mh1Attachments: PickedFile[] = [
  {
    id: "file-mh1-1",
    fileName: "initial-assessment-scan.jpg",
    fileType: "image",
    sizeLabel: "1.2 MB",
    previewUrl: MOCK_IMAGE_PREVIEW,
    uploadedAtLabel: "2026-07-27"
  }
];

const mh2Attachments: PickedFile[] = [
  {
    id: "file-mh2-1",
    fileName: "referral-letter.jpg",
    fileType: "image",
    sizeLabel: "0.8 MB",
    previewUrl: MOCK_IMAGE_PREVIEW,
    uploadedAtLabel: "2026-07-20"
  },
  {
    id: "file-mh2-2",
    fileName: "ct-scan-clip.mp4",
    fileType: "video",
    sizeLabel: "12.4 MB",
    previewUrl: "#",
    uploadedAtLabel: "2026-07-20",
    durationLabel: "0:34"
  }
];

// Builds a ScheduleDay[] with every day empty (no exercises assigned yet) from a
// plan's heatmap - used for plans/fallbacks that don't need a curated schedule.
// PT_EXERCISE_PATH_MOCKUP_PLAN.md section 4.2.
function emptyDays(heatmap: HeatmapDayStatus[]): ScheduleDay[] {
  return heatmap.map((status) => ({ status, exercises: [] }));
}

// Sample scheduled exercises for plan-101-2's Day 5, matching
// docs/04-design/mockups/program-editor.html's "Shoulder circle" / "Hold and drop
// box" example, sourced from the same exercise families as
// data/exerciseLibraryMock.ts's ex-001 (Shoulder Flexion, pose) and ex-003 (Grip
// Strength Trainer, virtual_grip) so Program Editor's "currently assigned" rows
// point at real library items.
const day5Exercises: ScheduledExercise[] = [
  {
    id: "se-101-5-1",
    exerciseLibraryId: "ex-001-v3",
    exerciseName: "Shoulder Flexion Exercise",
    versionLabel: "v3",
    movementTracking: "pose",
    orderNumber: 1,
    targetType: "repetitions",
    targetValueLabel: "10 reps",
    difficultyLevel: "medium",
    status: "in_progress"
  },
  {
    id: "se-101-5-2",
    exerciseLibraryId: "ex-003-v2",
    exerciseName: "Grip Strength Trainer",
    versionLabel: "v2",
    movementTracking: "virtual_grip",
    orderNumber: 2,
    targetType: "repetitions",
    targetValueLabel: "15 reps",
    difficultyLevel: "hard",
    status: "pending"
  }
];

const plan101Day5Days: ScheduleDay[] = [
  { status: "completed", exercises: [] },
  { status: "completed", exercises: [] },
  { status: "completed", exercises: [] },
  { status: "skipped", exercises: [] },
  { status: "in_progress", exercises: day5Exercises },
  ...Array.from({ length: 16 }, () => ({ status: "pending" as HeatmapDayStatus, exercises: [] }))
];

// This patient's ("patient-101", Somchai P., #P-0142) own PatientRehabPlan[],
// extracted to a named export so data/patientRehabPlanMock.ts can reuse the exact
// same plan-101-2 / day5Exercises data for the *patient's own* Progress page
// (PATIENT_PROGRESS_MOCKUP_PLAN.md §2.2) rather than a re-typed copy — keeping
// the therapist's Program Editor view and the patient's Progress view of this
// plan from ever drifting apart.
export const patient101Plans: PatientRehabPlan[] = [
  {
    id: "plan-101-2",
    name: "Initial Stroke Recovery Plan",
    description: "3-week upper-limb mobility program following the initial PT assessment.",
    status: "active",
    startDateLabel: "2026-07-28",
    endDateLabel: "2026-08-17",
    heatmap: [
      "completed",
      "completed",
      "completed",
      "skipped",
      "in_progress",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending"
    ],
    // Day 5 (index 4, "in_progress") seeded with real ScheduledExercises so
    // Program Editor (PT_EXERCISE_PATH_MOCKUP_PLAN.md §4.2) has something real
    // to render/edit on first load, matching program-editor.html's sample day.
    // Every other day starts empty (not yet scheduled) — same convention as a
    // freshly-created plan.
    days: plan101Day5Days
  },
  {
    id: "plan-101-1",
    name: "Pre-Assessment Baseline Plan",
    description: "Short baseline week used to inform the initial PT assessment before the main plan started.",
    status: "completed",
    startDateLabel: "2026-07-20",
    endDateLabel: "2026-07-26",
    heatmap: ["completed", "completed", "completed", "completed", "completed", "completed", "completed"],
    days: emptyDays(["completed", "completed", "completed", "completed", "completed", "completed", "completed"])
  }
];

// Curated to match docs/04-design/mockups/patient-detail.html's sample data
// (Somchai P., #P-0142) exactly, so the rendered page matches the approved mockup.
// Keyed by TherapistPatientSummary.id (data/therapistMock.ts) so any patient row's
// "View Full Report" action can look up a detail profile.
const curatedPatientDetailProfiles: Record<string, PatientDetailProfile> = {
  "patient-101": {
    id: "patient-101",
    name: "Somchai P.",
    sex: "Male",
    age: 58,
    affectedSide: "Right",
    patientCode: "#P-0142",
    plans: patient101Plans,
    medicalHistory: [
      {
        id: "mh-1",
        recordType: "pt_assessment",
        title: "Initial mobility assessment",
        dateLabel: "2026-07-27",
        recordedByLabel: "Dr. Nisa",
        details: [
          { label: "Muscle strength", value: "3/5" },
          { label: "Balance score", value: "70" },
          { label: "Affected side", value: "Right" }
        ],
        attachments: mh1Attachments
      },
      {
        id: "mh-2",
        recordType: "diagnosis",
        title: "Ischemic stroke, right hemisphere",
        dateLabel: "2026-07-20",
        recordedByLabel: "Dr. Preecha (referring)",
        attachments: mh2Attachments
      }
    ],
    earlierMedicalHistoryCount: 3,
    sessionHistory: [
      {
        id: "sh-1",
        dateLabel: "2026-08-01",
        dayLabel: "Day 5",
        exercisesAttempted: 3,
        outcome: "completed",
        avgScore: 84,
        evaluationSource: "ai"
      },
      {
        id: "sh-2",
        dateLabel: "2026-07-31",
        dayLabel: "Day 4",
        exercisesAttempted: 0,
        outcome: "skipped"
      },
      {
        id: "sh-3",
        dateLabel: "2026-07-30",
        dayLabel: "Day 3",
        exercisesAttempted: 3,
        outcome: "completed",
        avgScore: 91,
        evaluationSource: "pt_reviewed"
      },
      {
        id: "sh-4",
        dateLabel: "2026-07-29",
        dayLabel: "Day 2",
        exercisesAttempted: 2,
        outcome: "completed",
        avgScore: 78,
        evaluationSource: "ai"
      }
    ],
    hasEarlierSessions: true
  }
};

// Builds a plausible detail profile for any patient row that doesn't have a
// curated mockup match above, derived from the same TherapistPatientSummary
// already shown in the dashboard table — so "View Full Report" never dead-ends,
// but only patient-101 is guaranteed to match the reviewed mockup 1:1. Clearly a
// mock fallback (no medical history / session history invented from nothing),
// flagged here rather than silently fabricated clinical detail.
function buildFallbackProfile(patient: TherapistPatientSummary): PatientDetailProfile {
  const completedDays = Math.round((patient.progressPercent / 100) * 21);
  const heatmap: HeatmapDayStatus[] = Array.from({ length: 21 }, (_, index) =>
    index < completedDays ? "completed" : "pending"
  );

  return {
    id: patient.id,
    name: patient.name,
    sex: "Other",
    age: patient.age,
    affectedSide: "None",
    patientCode: `#${patient.id.toUpperCase()}`,
    plans: [
      {
        id: `${patient.id}-plan-fallback`,
        name: `${patient.condition} Recovery Plan`,
        status: patient.standing === "active" ? "active" : "paused",
        // No real program.start_date to anchor on for a patient with no curated
        // mockup match — the calendar block falls back to date-less cells for
        // this (buildCalendarCells() checks for a valid ISO date).
        startDateLabel: "—",
        heatmap,
        // No curated schedule for a fallback patient — every day starts with no
        // exercises assigned yet, same as a brand-new plan.
        days: emptyDays(heatmap)
      }
    ],
    medicalHistory: [],
    earlierMedicalHistoryCount: 0,
    sessionHistory: [],
    hasEarlierSessions: false
  };
}

export function getPatientDetailProfile(patient: TherapistPatientSummary): PatientDetailProfile {
  return curatedPatientDetailProfiles[patient.id] ?? buildFallbackProfile(patient);
}
