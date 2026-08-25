import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { trackingLabels } from "../data/patientMock";
import { patientHistoryPlans } from "../data/patientHistoryMock";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import type { HeatmapDayStatus, PatientHistoryPlan, PatientProgramDay } from "../types";

// Sidebar/bottom-nav "History" page. Top block is a real full-month calendar for
// the selected rehab plan (data/patientHistoryMock.ts) — every day of the
// currently viewed month renders, not just the plan's own day range, so days
// with no plan scheduled are visible too (as a distinct "no plan" cell) instead
// of the calendar shrinking down to whatever a short plan's length happens to
// be. Month nav (‹ ›) lets a plan that spans more than one month (or a patient
// browsing outside their plan's range entirely) move between months. Clicking a
// plan day drills the bottom block down to just that day's exercises (each with
// its own score); with no day selected, the bottom block instead shows a
// rehab-plan selector plus the full day-by-day list for whichever plan is
// chosen — both driven by the same `selectedPlanId` state so the calendar above
// and the list below always agree on which plan they're showing.

interface PatientHistoryPageProps {
  program: PatientProgramDay;
  onLogout: () => void;
  onNavigate: (label: PatientNavLabel) => void;
}

const heatmapLabels: Record<HeatmapDayStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  skipped: "Skipped",
  pending: "Upcoming"
};

interface CalendarCell {
  key: string;
  // Day-of-month number, or null for a leading/trailing padding cell outside the
  // viewed month entirely.
  dateNumber: number | null;
  // The plan's status for this date, or null if this date has no scheduled day
  // in the plan (either outside the plan's date range, or a padding cell).
  status: HeatmapDayStatus | null;
  // Index into plan.days, only set when `status` is set.
  dayIndex: number | null;
}

interface ViewedMonth {
  year: number;
  month: number; // 0-indexed, matches Date.getMonth()
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Builds every cell for the given calendar month (Sun-first, padded to full
// weeks), looking up each date against the plan's day range rather than only
// laying out the plan's own days — see this file's header comment for why.
function buildMonthCalendarCells(plan: PatientHistoryPlan, viewed: ViewedMonth): CalendarCell[] {
  const planStart = ISO_DATE_RE.test(plan.startDateLabel) ? new Date(`${plan.startDateLabel}T00:00:00`) : null;
  const firstOfMonth = new Date(viewed.year, viewed.month, 1);
  const daysInMonth = new Date(viewed.year, viewed.month + 1, 0).getDate();
  const cells: CalendarCell[] = [];

  for (let i = 0; i < firstOfMonth.getDay(); i++) {
    cells.push({ key: `lead-${i}`, dateNumber: null, status: null, dayIndex: null });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(viewed.year, viewed.month, day);
    let status: HeatmapDayStatus | null = null;
    let dayIndex: number | null = null;

    if (planStart) {
      const diffDays = Math.round((date.getTime() - planStart.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays < plan.days.length) {
        status = plan.days[diffDays].status;
        dayIndex = diffDays;
      }
    }

    cells.push({ key: `day-${day}`, dateNumber: day, status, dayIndex });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, dateNumber: null, status: null, dayIndex: null });
  }

  return cells;
}

function monthOfPlanStart(plan: PatientHistoryPlan | undefined): ViewedMonth {
  if (plan && ISO_DATE_RE.test(plan.startDateLabel)) {
    const date = new Date(`${plan.startDateLabel}T00:00:00`);
    return { year: date.getFullYear(), month: date.getMonth() };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function viewedMonthLabel(viewed: ViewedMonth): string {
  return new Date(viewed.year, viewed.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function dayDateLabel(plan: PatientHistoryPlan, dayIndex: number): string {
  if (!ISO_DATE_RE.test(plan.startDateLabel)) {
    return `Day ${dayIndex + 1}`;
  }
  const date = new Date(`${plan.startDateLabel}T00:00:00`);
  date.setDate(date.getDate() + dayIndex);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function PatientHistoryPage({ program, onLogout, onNavigate }: PatientHistoryPageProps) {
  const defaultPlanId = patientHistoryPlans.find((plan) => plan.status === "active")?.id ?? patientHistoryPlans[0]?.id;
  const [selectedPlanId, setSelectedPlanId] = useState(defaultPlanId);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);

  const selectedPlan = patientHistoryPlans.find((plan) => plan.id === selectedPlanId) ?? patientHistoryPlans[0];
  const [viewedMonth, setViewedMonth] = useState<ViewedMonth>(() => monthOfPlanStart(selectedPlan));

  const calendarCells = useMemo(
    () => (selectedPlan ? buildMonthCalendarCells(selectedPlan, viewedMonth) : []),
    [selectedPlan, viewedMonth]
  );
  const selectedDay =
    selectedPlan && selectedDayIndex !== null && selectedPlan.days[selectedDayIndex]
      ? selectedPlan.days[selectedDayIndex]
      : null;

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
    setSelectedDayIndex(null);
    setViewedMonth(monthOfPlanStart(patientHistoryPlans.find((plan) => plan.id === planId)));
  };

  const handleSelectDay = (dayIndex: number, status: HeatmapDayStatus) => {
    if (status === "pending") return;
    setSelectedDayIndex((current) => (current === dayIndex ? null : dayIndex));
  };

  const changeMonth = (delta: 1 | -1) => {
    setSelectedDayIndex(null);
    setViewedMonth((current) => {
      const total = current.year * 12 + current.month + delta;
      return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
    });
  };

  return (
    <section className="therapist-shell">
      <PatientSidebar
        activeLabel="History"
        onNavigate={onNavigate}
        onLogout={onLogout}
        displayName={`${program.patient.displayName} Rodthong`}
        avatarInitials="SR"
      />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>History</h1>
            <p>Your rehab plans and day-by-day progress</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{program.patient.displayName} Rodthong</strong>
                <small>Patient</small>
              </div>
              <span className="avatar-badge">SR</span>
            </div>
          </div>
        </header>

        <main className="therapist-main patient-page-main">
          {selectedPlan ? (
            <div className="pp-history-layout">
              <div className="summary-card pd-calendar-card">
                <div className="therapist-chart-heading">
                  <div>
                    <strong>{selectedPlan.name}</strong>
                    <p>
                      {selectedPlan.status.charAt(0).toUpperCase() + selectedPlan.status.slice(1)} plan &middot;{" "}
                      {selectedPlan.startDateLabel}
                      {selectedPlan.endDateLabel ? ` – ${selectedPlan.endDateLabel}` : ""}
                    </p>
                  </div>
                </div>

                <div className="pp-calendar-month-nav">
                  <button type="button" className="icon-button" onClick={() => changeMonth(-1)} aria-label="Previous month">
                    <ChevronLeft size={16} />
                  </button>
                  <strong>{viewedMonthLabel(viewedMonth)}</strong>
                  <button type="button" className="icon-button" onClick={() => changeMonth(1)} aria-label="Next month">
                    <ChevronRight size={16} />
                  </button>
                </div>

                <div className="pd-calendar-weekdays">
                  {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                    <span key={index}>{day}</span>
                  ))}
                </div>
                <div className="pd-calendar-grid">
                  {calendarCells.map((cell) => (
                    <button
                      key={cell.key}
                      type="button"
                      className={`pd-calendar-cell ${cell.status ?? (cell.dateNumber !== null ? "no_plan" : "blank")} ${
                        cell.dayIndex !== null && cell.status !== "pending" ? "clickable" : ""
                      } ${cell.dayIndex !== null && cell.dayIndex === selectedDayIndex ? "selected" : ""}`}
                      disabled={cell.dayIndex === null || cell.status === "pending"}
                      title={
                        cell.status
                          ? heatmapLabels[cell.status]
                          : cell.dateNumber !== null
                            ? "No plan scheduled"
                            : undefined
                      }
                      onClick={() => cell.dayIndex !== null && cell.status && handleSelectDay(cell.dayIndex, cell.status)}
                    >
                      {cell.dateNumber ?? ""}
                    </button>
                  ))}
                </div>
                <div className="pd-legend">
                  {(["completed", "in_progress", "skipped", "pending"] as HeatmapDayStatus[]).map((status) => (
                    <span key={status}>
                      <span className={`pd-legend-dot ${status}`} />
                      {heatmapLabels[status]}
                    </span>
                  ))}
                  <span>
                    <span className="pd-legend-dot no_plan" />
                    No plan
                  </span>
                </div>
              </div>

              {selectedDay && selectedDayIndex !== null ? (
                <div className="summary-card pp-history-panel">
                  <div className="therapist-chart-heading">
                    <div>
                      <strong>{dayDateLabel(selectedPlan, selectedDayIndex)}</strong>
                      <p>{heatmapLabels[selectedDay.status]}</p>
                    </div>
                    <button type="button" className="text-action" onClick={() => setSelectedDayIndex(null)}>
                      <ArrowLeft size={13} /> Back to day-by-day
                    </button>
                  </div>

                  {selectedDay.exercises.length === 0 ? (
                    <p className="pd-empty-note">No exercises were recorded for this day.</p>
                  ) : (
                    <div className="pd-session-list">
                      {selectedDay.exercises.map((exercise, index) => (
                        <div className="pd-session-row" key={`${exercise.name}-${index}`}>
                          <div className="pp-history-row-label">
                            <strong>{exercise.name}</strong>
                            <small>
                              {exercise.nameTh ? `${exercise.nameTh} · ` : ""}
                              {trackingLabels[exercise.trackingType]}
                            </small>
                          </div>
                          <div className="pd-session-actions">
                            {exercise.score !== undefined ? (
                              <span className="pd-session-score">Score {exercise.score}</span>
                            ) : (
                              <span className="pd-session-skipped">Not scored</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="summary-card pp-history-panel">
                  <div className="therapist-chart-heading">
                    <div>
                      <strong>Day by day</strong>
                      <p>{selectedPlan.days.length} days in this plan</p>
                    </div>
                  </div>

                  <label className="pp-plan-select">
                    Rehab plan
                    <select
                      className="admin-role-select"
                      value={selectedPlan.id}
                      onChange={(event) => handleSelectPlan(event.target.value)}
                    >
                      {patientHistoryPlans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} ({plan.status})
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="pd-session-list">
                    {selectedPlan.days.map((day, index) => (
                      <div
                        className={`pd-session-row ${day.status !== "pending" ? "pp-clickable-row" : ""}`}
                        key={index}
                        onClick={day.status !== "pending" ? () => handleSelectDay(index, day.status) : undefined}
                      >
                        <div className="pp-history-row-label">
                          <strong>{dayDateLabel(selectedPlan, index)}</strong>
                          <small>
                            {day.exercises.length > 0
                              ? `${day.exercises.length} exercise${day.exercises.length === 1 ? "" : "s"}`
                              : "No exercises"}
                          </small>
                        </div>
                        <div className="pd-session-actions">
                          {day.status === "skipped" ? (
                            <span className="pd-session-skipped">Skipped</span>
                          ) : day.exercises.length > 0 ? (
                            <span className="pd-session-score">
                              Avg {Math.round(day.exercises.reduce((sum, ex) => sum + (ex.score ?? 0), 0) / day.exercises.length)}
                            </span>
                          ) : null}
                          <span
                            className={`badge-pill ${
                              day.status === "completed" ? "good" : day.status === "in_progress" ? "fair" : "poor"
                            }`}
                          >
                            {heatmapLabels[day.status]}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="summary-card">
              <p className="pd-empty-note">No rehab plans yet.</p>
            </div>
          )}
        </main>
      </div>

      <PatientBottomNav activeLabel="History" onNavigate={onNavigate} />
    </section>
  );
}
