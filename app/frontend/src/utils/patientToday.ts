import type { ExerciseTrackingType, PatientExercise, PatientRehabPlan, ScheduledExercise, TrackingType } from "../types";
import { currentDayIndex, dayIsoDate, ISO_DATE_RE } from "./rehabPlan";

// Shared Home-page ("Today") derivation logic — PATIENT_TODAY_MOCKUP_PLAN.md §2.1/
// §2.2/§2.3. Pulled out of pages/PatientTodayPage.tsx so App.tsx's Start Session
// wiring resolves an exercise id against the *exact same* grouped "today" list the
// page renders, rather than a second, potentially-drifting lookup.

export interface TodayExerciseGroup {
  planId: string;
  planName: string;
  dayIndex: number;
  exercises: ScheduledExercise[];
}

// One group per *active* plan that actually has exercises scheduled today (§2.1:
// no plan switcher on Home, so a plan with nothing scheduled today just doesn't
// show up rather than rendering an empty group). Plans with more than one active
// plan overlapping produce more than one group — PatientTodayPage.tsx renders a
// group header only when there's more than one.
export function getTodayExerciseGroups(plans: PatientRehabPlan[]): TodayExerciseGroup[] {
  return plans
    .filter((plan) => plan.status === "active")
    .map((plan) => {
      const dayIndex = currentDayIndex(plan.days);
      return { planId: plan.id, planName: plan.name, dayIndex, exercises: plan.days[dayIndex]?.exercises ?? [] };
    })
    .filter((group) => group.exercises.length > 0);
}

// Resolves a Start Session click against today's grouped exercises
// (PATIENT_TODAY_MOCKUP_PLAN.md §2.3): with an explicit id, searches every
// group's exercises for a match (ids are unique per ScheduledExercise regardless
// of which plan they came from, so the search doesn't need to know the plan
// upfront); with no id (the hero "Start Session" button), returns the first
// not-yet-completed exercise across all groups, in group order.
export function findTodayScheduledExercise(
  groups: TodayExerciseGroup[],
  exerciseId?: string
): ScheduledExercise | undefined {
  if (exerciseId) {
    for (const group of groups) {
      const match = group.exercises.find((exercise) => exercise.id === exerciseId);
      if (match) return match;
    }
    return undefined;
  }

  for (const group of groups) {
    const next = group.exercises.find((exercise) => exercise.status !== "completed");
    if (next) return next;
  }
  return groups[0]?.exercises[0];
}

const trackingTypeFallback: Record<ExerciseTrackingType, TrackingType> = {
  pose: "pose",
  virtual_grip: "virtual_grip",
  // TrackingType (PatientSessionPage's camera-overlay switch) has no "no AI
  // tracking" option — it only ever expects pose/virtual_grip/both. "none" falls
  // back to "pose" here purely so the shim always produces a valid TrackingType;
  // it doesn't change what Program Editor recorded for the real exercise.
  none: "pose"
};

// Option B from PATIENT_TODAY_MOCKUP_PLAN.md §2.3: shim a ScheduledExercise into
// the PatientSessionPage's existing PatientExercise shape at the point Start
// Session is called, rather than teaching PatientSessionPage the real schema.
// sets/reps/durationMinutes/nameTh have no ScheduledExercise equivalent and
// aren't actually read by PatientSessionPage.tsx's UI — filled with harmless
// placeholders rather than left to silently be `undefined`.
export function shimScheduledExerciseToPatientExercise(exercise: ScheduledExercise): PatientExercise {
  return {
    id: exercise.id,
    name: exercise.exerciseName,
    trackingType: trackingTypeFallback[exercise.movementTracking],
    targetLabel: exercise.targetValueLabel,
    status: exercise.status === "completed" ? "done" : exercise.status === "in_progress" ? "in_progress" : "not_started",
    feedback: exercise.therapistInstruction ?? "Follow the on-screen guidance and keep your movements steady.",
    progressLabel: exercise.status === "completed" ? "1 of 1" : "0 of 1",
    durationMinutes: 10,
    sets: 1,
    reps: 1,
    difficulty: exercise.difficultyLevel === "easy" ? "Easy" : exercise.difficultyLevel === "hard" ? "Hard" : "Moderate"
  };
}

// CAMERA_TRACKING_MOCKUP_PLAN.md §6.6 — marks the ScheduledExercise a confirmed
// upload was for as "completed", the same shape Program Editor/Patient Detail's
// calendar already read status from. Scans every plan/day rather than just
// today's (App.tsx's activeExercise.id is the shimmed ScheduledExercise.id per
// the Option B comment above, but which plan/day it lives in isn't tracked
// separately, and ids are unique across plans) — a plain, non-mutating map, same
// pattern as the rest of this file.
export function markScheduledExerciseCompleted(plans: PatientRehabPlan[], scheduledExerciseId: string): PatientRehabPlan[] {
  return plans.map((plan) => ({
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) =>
        exercise.id === scheduledExerciseId ? { ...exercise, status: "completed" as const } : exercise
      )
    }))
  }));
}

// --- Merged "any plan has exercises today" calendar ---
// Per the person's request: unlike Progress's per-plan calendar (which colors by
// day status), Home's calendar only needs to answer "is there an exercise
// scheduled this day, from any active plan, yes or no" — styled like History's
// month grid (pd-calendar-* CSS classes) rather than the old fixed 14-cell strip.

export interface ExerciseCalendarCell {
  key: string;
  dateNumber: number | null;
  hasExercise: boolean;
  inMonth: boolean;
}

export interface ViewedMonth {
  year: number;
  month: number; // 0-indexed, matches Date.getMonth()
}

// Every ISO date, across every active plan, that has at least one exercise
// scheduled — plans with no valid startDateLabel (not date-anchored) can't
// contribute to a real calendar and are skipped here.
export function buildExerciseDateSet(plans: PatientRehabPlan[]): Set<string> {
  const dates = new Set<string>();
  plans
    .filter((plan) => plan.status === "active")
    .forEach((plan) => {
      plan.days.forEach((day, index) => {
        if (day.exercises.length === 0) return;
        const iso = dayIsoDate(plan, index);
        if (iso) dates.add(iso);
      });
    });
  return dates;
}

// Sun-first month grid (leading/trailing padding cells), same layout convention
// as PatientHistoryPage.tsx's buildMonthCalendarCells — every day of the viewed
// month renders, marked has-exercise or not, regardless of which plan (if any)
// it belongs to.
export function buildMonthExerciseCells(exerciseDates: Set<string>, viewed: ViewedMonth): ExerciseCalendarCell[] {
  const firstOfMonth = new Date(viewed.year, viewed.month, 1);
  const daysInMonth = new Date(viewed.year, viewed.month + 1, 0).getDate();
  const cells: ExerciseCalendarCell[] = [];

  for (let i = 0; i < firstOfMonth.getDay(); i++) {
    cells.push({ key: `lead-${i}`, dateNumber: null, hasExercise: false, inMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(viewed.year, viewed.month, day);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    cells.push({ key: `day-${day}`, dateNumber: day, hasExercise: exerciseDates.has(iso), inMonth: true });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, dateNumber: null, hasExercise: false, inMonth: false });
  }

  return cells;
}

export function viewedMonthLabel(viewed: ViewedMonth): string {
  return new Date(viewed.year, viewed.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Defaults the calendar to the month containing the primary (first active) plan's
// own "today" date, same anchor Home's hero/streak/exercise-list already use —
// falls back to the real current month when no active plan is date-anchored.
export function monthOfPrimaryPlanToday(plans: PatientRehabPlan[]): ViewedMonth {
  const primary = plans.find((plan) => plan.status === "active");
  if (primary && ISO_DATE_RE.test(primary.startDateLabel)) {
    const iso = dayIsoDate(primary, currentDayIndex(primary.days));
    if (iso) {
      const date = new Date(`${iso}T00:00:00`);
      return { year: date.getFullYear(), month: date.getMonth() };
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}
