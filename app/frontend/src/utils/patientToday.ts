import type { ExerciseTrackingType, PatientExercise, PatientRehabPlan, ScheduleDay, ScheduledExercise, TrackingType } from "../types";
import type { PatientTodayPlan } from "../services/api";
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

// One group per *active* plan that actually has exercises scheduled for TODAY's
// calendar date (§2.1: no plan switcher on Home). The day is matched by its real
// scheduled date (day.dateLabel) rather than the plan's "current day" fallback —
// so a plan whose next pending day falls tomorrow contributes no group today,
// and overlapping plans only surface the exercises actually due today. Plans
// with more than one active plan overlapping produce more than one group —
// PatientTodayPage.tsx renders a group header only when there's more than one.
export function getTodayExerciseGroups(plans: PatientRehabPlan[]): TodayExerciseGroup[] {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return plans
    .filter((plan) => plan.status === "active")
    .map((plan) => {
      const dayIndex = plan.days.findIndex((day) => day.dateLabel === todayStr);
      return { planId: plan.id, planName: plan.name, dayIndex, exercises: plan.days[dayIndex]?.exercises ?? [] };
    })
    .filter((group) => group.dayIndex !== -1 && group.exercises.length > 0);
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

// --- Per-date completion status for the Home strip/calendar ---
// Unlike buildExerciseDateSet (a plain yes/no "is anything scheduled"), the
// scrollable strip needs to say whether that day's exercises were actually
// *done* — completed (green), missing (red, scheduled but not fully done), or
// no exercise that day at all (dark gray). Merged across every *visible* plan
// (the caller passes selectedPlanId's filtered list), so switching the plan
// chip updates these colors too, not just which dots show up.
//
// Takes the page's real data shape (PatientTodayPlan from
// GET /patients/:id/today): scheduled dates come from plan.scheduleDates with
// each date's real day status in plan.dateStatuses (rehabilitation_schedule_days
// status — completed/skipped/etc.). A date is "completed" when the backend says
// the schedule day completed; "missing" for past dates that weren't (skipped,
// cancelled, or still pending/in_progress after their day passed); future
// scheduled dates report "none" until their day arrives. Today's own cell uses
// today's exercise statuses when available (all done → completed), falling back
// to the day status. Completed wins over missing when several plans share a date.
export type DayCellStatus = "completed" | "missing" | "none";

export function buildExerciseDateStatusMap(plans: PatientTodayPlan[]): Map<string, DayCellStatus> {
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const statusMap = new Map<string, DayCellStatus>();
  const outrank = (current: DayCellStatus | undefined, next: DayCellStatus): DayCellStatus => {
    if (current === "completed" || next === "completed") return "completed";
    // Two plans both still pending on a future date must stay "none" (no
    // exercise yet) — collapsing none+none to "missing" painted not-yet-due
    // overlapping days red as if they'd been missed.
    if ((current ?? "none") === "none" && next === "none") return "none";
    return "missing";
  };

  plans.forEach((plan) => {
    // Today's completion, when this plan has a "today" day with exercises.
    let todayStatus: DayCellStatus | null = null;
    if (plan.today && plan.today.exercises.length > 0) {
      const total = plan.today.exercises.length;
      const completed = plan.today.exercises.filter((exercise) => exercise.status === "completed").length;
      todayStatus = completed >= total ? "completed" : "missing";
    }

    plan.scheduleDates.forEach((iso) => {
      if (!ISO_DATE_RE.test(iso)) return;
      // Real day status from the backend decides completed vs missed — a past
      // day whose schedule_day row is "completed" must show as completed, not
      // defaulted to missed (the old behavior, since scheduleDates carried no
      // statuses at all).
      const dayStatus = plan.dateStatuses[iso];
      let status: DayCellStatus;
      if (dayStatus === "completed") {
        status = "completed";
      } else if (iso === todayIso && todayStatus) {
        status = todayStatus;
      } else if (iso > todayIso) {
        status = "none";
      } else {
        // Past (or today without a today-block) and not completed — skipped,
        // cancelled, or never finished.
        status = "missing";
      }
      statusMap.set(iso, outrank(statusMap.get(iso), status));
    });
  });
  return statusMap;
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

// Adapter that reshapes the Today payload into the PatientRehabPlan shape the
// Progress page's month calendar (PatientDetailPage's buildMonthCalendar/
// planMonthRange) consumes. Day statuses come from the same completed/missing/
// none derivation the strip uses (completed → completed, missing → skipped,
// none/scheduled → pending), and the union of every visible plan's schedule
// dates defines the plan range the month navigation is constrained to.
export function buildScheduleCalendarPlan(
  plans: PatientTodayPlan[],
  statusMap: Map<string, DayCellStatus>
): PatientRehabPlan {
  const dates = Array.from(new Set(plans.flatMap((plan) => plan.scheduleDates)))
    .filter((iso) => ISO_DATE_RE.test(iso))
    .sort();
  const days: ScheduleDay[] = dates.map((iso) => {
    const stripStatus = statusMap.get(iso);
    return {
      id: `cal-${iso}`,
      dateLabel: iso,
      status: stripStatus === "completed" ? "completed" : stripStatus === "missing" ? "skipped" : "pending",
      exercises: []
    };
  });
  return {
    id: plans.length === 1 ? plans[0].id : "all",
    name: plans.length === 1 ? plans[0].name : "All Plans",
    status: "active",
    startDateLabel: dates[0] ?? "",
    endDateLabel: dates[dates.length - 1],
    heatmap: days.map((day) => day.status),
    days
  };
}

// --- Scrollable "today ± 10 days" exercise strip for Home's default calendar view ---
// Per the person's request: the strip covers 10 days before today through 10
// days after (21 cells total) and scrolls freely both directions — CSS handles
// the horizontal scroll (.week-strip is overflow-x, not a fixed 7-col grid),
// this just builds the flat list of cells to render. PatientTodayPage.tsx
// scrolls/snaps today's cell to the strip's horizontal *center* on load and on
// plan-switch, then tracks whichever cell is closest to center as the person
// scrolls or taps one (the "centered" blue highlight) — each cell's own fill
// color comes from `status` (completed/missing/none) independent of whether
// it's the centered one.

export interface TodayExerciseStripCell {
  key: string;
  iso: string;
  dateNumber: number;
  weekdayLabel: string;
  status: DayCellStatus;
  isToday: boolean;
}

export function buildTodayExerciseStripCells(
  dateStatusMap: Map<string, DayCellStatus>,
  todayIso: string,
  daysBefore = 10,
  daysAfter = 10
): TodayExerciseStripCell[] {
  const start = new Date(`${todayIso}T00:00:00`);
  const cells: TodayExerciseStripCell[] = [];
  for (let i = -daysBefore; i <= daysAfter; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    cells.push({
      key: iso,
      iso,
      dateNumber: date.getDate(),
      weekdayLabel: date.toLocaleDateString("en-US", { weekday: "short" }),
      status: dateStatusMap.get(iso) ?? "none",
      isToday: i === 0
    });
  }
  return cells;
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
