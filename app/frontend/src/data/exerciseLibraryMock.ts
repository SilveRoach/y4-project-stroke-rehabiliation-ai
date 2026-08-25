import type { ExerciseLibraryItem } from "../types";

// Exercise Library mock data (frontend-design.md §6, revised per
// UI_MOCKUP_PLAN_NEWDB.md §2.5 to match newdb.txt's actual exercise_library schema:
// no category/targetArea columns, movement_tracking is pose/virtual_grip/none (no
// "both"), difficulty_level is easy/medium/hard, and versioning is modeled via
// parent_exercise_id/version_number rather than a single currentVersion counter.
// Each entry below is the CURRENT (latest) version of its exercise family; `versions`
// holds the full history for that family, newest first, including this row.

export const exerciseLibrary: ExerciseLibraryItem[] = [
  {
    id: "ex-001-v3",
    parentExerciseId: "ex-001",
    versionNumber: 3,
    name: "Shoulder Flexion Exercise",
    nameTh: "ยกแขนขึ้นระดับไหล่",
    description:
      "Raise the affected arm forward to shoulder height, hold, then lower slowly.",

    movementTracking: "pose",
    difficultyLevel: "medium",

    hasDemoVideo: true,
    baseCriteria: { targetAngleDeg: 90, repetitions: 10, holdSeconds: 5 },

    status: "active",

    createdAtLabel: "2 days ago",
    createdByName: "Dr. Nisa",

    versions: [
      {
        id: "ex-001-v3",
        versionNumber: 3,
        status: "active",
        baseCriteria: { targetAngleDeg: 90, repetitions: 10, holdSeconds: 5 },
        createdAtLabel: "2 days ago"
      },
      {
        id: "ex-001-v2",
        versionNumber: 2,
        status: "archived",
        baseCriteria: { targetAngleDeg: 80, repetitions: 10 },
        createdAtLabel: "3 weeks ago"
      },
      {
        id: "ex-001-v1",
        versionNumber: 1,
        status: "archived",
        baseCriteria: { targetAngleDeg: 80, repetitions: 8 },
        createdAtLabel: "2 months ago"
      }
    ]
  },

  {
    id: "ex-002-v1",
    parentExerciseId: "ex-002",
    versionNumber: 1,
    name: "Wrist Extension Stretch",
    nameTh: "ยืดข้อมือ",
    description: "Gently extend the wrist upward and hold before returning to neutral.",

    movementTracking: "pose",
    difficultyLevel: "easy",

    hasDemoVideo: false,
    baseCriteria: { targetAngleDeg: 45, repetitions: 12, holdSeconds: 3 },

    status: "draft",

    createdAtLabel: "1 day ago",
    createdByName: "Dr. Nisa",

    versions: [
      {
        id: "ex-002-v1",
        versionNumber: 1,
        status: "draft",
        baseCriteria: { targetAngleDeg: 45, repetitions: 12, holdSeconds: 3 },
        createdAtLabel: "1 day ago"
      }
    ]
  },

  {
    id: "ex-003-v2",
    parentExerciseId: "ex-003",
    versionNumber: 2,
    name: "Grip Strength Trainer",
    nameTh: "ฝึกกำลังมือ",
    description: "Squeeze and release a virtual object to build grip strength and control.",

    movementTracking: "virtual_grip",
    difficultyLevel: "hard",

    hasDemoVideo: true,
    baseCriteria: { targetGripStrength: 60, repetitions: 15, holdSeconds: 4 },

    status: "active",

    createdAtLabel: "1 week ago",
    createdByName: "Dr. Preecha",

    versions: [
      {
        id: "ex-003-v2",
        versionNumber: 2,
        status: "active",
        baseCriteria: { targetGripStrength: 60, repetitions: 15, holdSeconds: 4 },
        createdAtLabel: "1 week ago"
      },
      {
        id: "ex-003-v1",
        versionNumber: 1,
        status: "archived",
        baseCriteria: { targetGripStrength: 50, repetitions: 15 },
        createdAtLabel: "2 months ago"
      }
    ]
  },

  {
    id: "ex-004-v1",
    parentExerciseId: "ex-004",
    versionNumber: 1,
    name: "Balance Reach (legacy)",
    description: "Reach toward a target while maintaining standing balance. No AI tracking.",

    movementTracking: "none",
    difficultyLevel: "medium",

    hasDemoVideo: false,
    baseCriteria: { repetitions: 10 },

    status: "archived",

    createdAtLabel: "6 months ago",
    createdByName: "Dr. Nisa",

    versions: [
      {
        id: "ex-004-v1",
        versionNumber: 1,
        status: "archived",
        baseCriteria: { repetitions: 10 },
        createdAtLabel: "6 months ago"
      }
    ]
  }
];