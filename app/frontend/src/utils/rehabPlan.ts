import type { PatientRehabPlan, ScheduleDay } from "../types";

// Shared "what day is today, in this plan" helpers — originally written inline in
// pages/PatientProgressPage.tsx (PATIENT_PROGRESS_MOCKUP_PLAN.md §2.3), pulled out
// here so pages/PatientTodayPage.tsx and App.tsx's session-start resolution
// (PATIENT_TODAY_MOCKUP_PLAN.md §2.1/§2.3) use the exact same "today" for a plan
// that Progress shows — Home's hero card, exercise list, and Start Session button
// all need to agree with what Progress displays for the same plan.

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "Today" is matching today's calendar date if present; otherwise whichever day is
// actively in_progress; if none is, the next pending day; if every day is resolved, the last day.
export function currentDayIndex(days: ScheduleDay[], todayStr?: string): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const currentDate = todayStr ?? `${year}-${month}-${day}`;

  const todayMatch = days.findIndex((d) => d.dateLabel === currentDate);
  if (todayMatch !== -1) return todayMatch;

  const inProgress = days.findIndex((d) => d.status === "in_progress");
  if (inProgress !== -1) return inProgress;
  const pending = days.findIndex((d) => d.status === "pending");
  if (pending !== -1) return pending;
  return Math.max(days.length - 1, 0);
}

// Thai short date label ("อ. 29 ก.ย.") for the pages that show a day heading.
// Uses the Thai locale but leaves the year out entirely, so the Buddhist-era vs
// Gregorian question (see patientToday.ts#viewedMonthLabel) never arises here.
export function dayDateLabel(plan: PatientRehabPlan, dayIndex: number): string {
  const day = plan.days[dayIndex];
  if (day?.dateLabel && ISO_DATE_RE.test(day.dateLabel)) {
    const date = new Date(`${day.dateLabel}T00:00:00`);
    return date.toLocaleDateString("th-TH", { weekday: "short", month: "short", day: "numeric" });
  }
  if (!ISO_DATE_RE.test(plan.startDateLabel)) {
    return `วันที่ ${dayIndex + 1}`;
  }
  const date = new Date(`${plan.startDateLabel}T00:00:00`);
  date.setDate(date.getDate() + dayIndex);
  return date.toLocaleDateString("th-TH", { weekday: "short", month: "short", day: "numeric" });
}

// ISO (yyyy-mm-dd) date a given day index in a plan falls on, or null if the plan
// isn't date-anchored (no valid startDateLabel).
export function dayIsoDate(plan: PatientRehabPlan, dayIndex: number): string | null {
  if (!ISO_DATE_RE.test(plan.startDateLabel)) return null;
  const date = new Date(`${plan.startDateLabel}T00:00:00`);
  date.setDate(date.getDate() + dayIndex);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
