import { ArrowLeft, ChevronLeft, ChevronRight, Dumbbell, Hand, Ban, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import { useProfilePicture } from "../hooks/useProfilePicture";
import { ApiError, getPatientPlans } from "../services/api";
import { useAuth } from "../store/authStore";
import { initialsFromName } from "../utils/displayName";
import type { ExerciseTrackingType, HeatmapDayStatus, RehabPlanStatus } from "../types";
import { formatTargetValue } from "../utils/targetValue";

export interface HistoryExercise {
  id: string;
  name: string;
  trackingType: ExerciseTrackingType;
  difficultyLevel?: string;
  targetValueLabel: string;
  status: string;
  score?: number;
}

export interface HistoryDay {
  id: string;
  dateLabel: string; // YYYY-MM-DD
  status: HeatmapDayStatus;
  therapistNote?: string;
  exercises: HistoryExercise[];
}

export interface HistoryPlan {
  id: string;
  name: string;
  status: RehabPlanStatus;
  startDateLabel: string;
  endDateLabel?: string;
  days: HistoryDay[];
}

interface PatientHistoryPageProps {
  onLogout: () => void;
  onNavigate: (label: PatientNavLabel) => void;
}

const heatmapLabels: Record<HeatmapDayStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  skipped: "Skipped",
  pending: "Upcoming",
  cancelled: "Cancelled"
};

const trackingIcons: Record<ExerciseTrackingType, typeof Dumbbell> = {
  pose: Dumbbell,
  virtual_grip: Hand,
  none: Ban
};

const trackingLabels: Record<ExerciseTrackingType, string> = {
  pose: "Pose tracking",
  virtual_grip: "Virtual grip",
  none: "No AI tracking"
};

interface CalendarCell {
  key: string;
  dateNumber: number | null;
  dateStr: string | null; // YYYY-MM-DD
  status: HeatmapDayStatus | null;
  dayIndex: number | null;
}

interface ViewedMonth {
  year: number;
  month: number; // 0-indexed, matches Date.getMonth()
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function mapServerPlansToHistory(serverPlans: any[]): HistoryPlan[] {
  return serverPlans.map((sp: any) => {
    const firstScheduleDate = sp.scheduleDays?.[0]?.scheduledDate
      ? sp.scheduleDays[0].scheduledDate.slice?.(0, 10) ?? new Date(sp.scheduleDays[0].scheduledDate).toISOString().slice(0, 10)
      : "";
    const start = sp.startDate
      ? sp.startDate.slice?.(0, 10) ?? new Date(sp.startDate).toISOString().slice(0, 10)
      : firstScheduleDate;
    const end = sp.endDate
      ? sp.endDate.slice?.(0, 10) ?? new Date(sp.endDate).toISOString().slice(0, 10)
      : "";

    const days: HistoryDay[] = (sp.scheduleDays || []).map((sd: any) => {
      const dateLabel = sd.scheduledDate
        ? sd.scheduledDate.slice?.(0, 10) ?? new Date(sd.scheduledDate).toISOString().slice(0, 10)
        : "";

      const exercises: HistoryExercise[] = (sd.scheduledExercises || []).map((ex: any) => {
        const results = ex.performanceResults || [];
        let score: number | undefined = undefined;
        if (results.length > 0) {
          const sorted = [...results].sort((a, b) => (b.attemptNumber || 0) - (a.attemptNumber || 0));
          const latest = sorted[0];
          const rawScore = latest?.finalScore ?? latest?.ptScore ?? latest?.aiScore;
          if (rawScore !== null && rawScore !== undefined) {
            const num = typeof rawScore === "number" ? rawScore : Number(rawScore);
            if (!Number.isNaN(num)) score = Math.round(num);
          }
        }

        return {
          id: ex.id,
          name: ex.exerciseLibrary?.name ?? ex.exerciseName ?? "Exercise",
          trackingType: ex.exerciseLibrary?.movementTracking ?? ex.movementTracking ?? "none",
          difficultyLevel: ex.exerciseLibrary?.difficultyLevel ?? ex.difficultyLevel,
          targetValueLabel: formatTargetValue(ex.targetValue),
          status: ex.status,
          score
        };
      });

      return {
        id: sd.id,
        dateLabel,
        status: sd.status as HeatmapDayStatus,
        therapistNote: sd.therapistNote ?? undefined,
        exercises
      };
    });

    return {
      id: sp.id,
      name: sp.name,
      status: sp.status as RehabPlanStatus,
      startDateLabel: start,
      endDateLabel: end,
      days
    };
  });
}

function buildMonthCalendarCells(plan: HistoryPlan, viewed: ViewedMonth): CalendarCell[] {
  const firstOfMonth = new Date(viewed.year, viewed.month, 1);
  const daysInMonth = new Date(viewed.year, viewed.month + 1, 0).getDate();
  const cells: CalendarCell[] = [];

  // Map of YYYY-MM-DD -> { status, dayIndex }
  const dayMap = new Map<string, { status: HeatmapDayStatus; dayIndex: number }>();
  plan.days.forEach((day, index) => {
    if (day.dateLabel && ISO_DATE_RE.test(day.dateLabel)) {
      dayMap.set(day.dateLabel, { status: day.status, dayIndex: index });
    }
  });

  for (let i = 0; i < firstOfMonth.getDay(); i++) {
    cells.push({ key: `lead-${i}`, dateNumber: null, dateStr: null, status: null, dayIndex: null });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const monthStr = String(viewed.month + 1).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    const fullDateStr = `${viewed.year}-${monthStr}-${dayStr}`;

    const match = dayMap.get(fullDateStr);
    // Today's own day reads as in-progress (yellow) while its exercises aren't
    // all completed yet — same semantics as the Today/Progress calendars.
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    let status = match ? match.status : null;
    if (fullDateStr === todayIso && status === "pending") {
      status = "in_progress";
    }
    cells.push({
      key: `day-${day}`,
      dateNumber: day,
      dateStr: fullDateStr,
      status,
      dayIndex: match !== undefined ? match.dayIndex : null
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, dateNumber: null, dateStr: null, status: null, dayIndex: null });
  }

  return cells;
}

function monthOfPlanStart(plan: HistoryPlan | undefined): ViewedMonth {
  if (plan && ISO_DATE_RE.test(plan.startDateLabel)) {
    const date = new Date(`${plan.startDateLabel}T00:00:00`);
    return { year: date.getFullYear(), month: date.getMonth() };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

// Opening/switching the calendar lands on TODAY's month (so the current/
// in-progress day is visible immediately) whenever today falls inside the
// selected plan's date span; otherwise it falls back to the plan's start month.
function monthOfTodayOrPlanStart(plan: HistoryPlan | undefined): ViewedMonth {
  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth() };
  if (!plan || !ISO_DATE_RE.test(plan.startDateLabel)) return today;
  const startKey = plan.startDateLabel.slice(0, 7);
  const todayKey = `${today.year}-${String(today.month + 1).padStart(2, "0")}`;
  const endIso = plan.days
    .map((day) => day.dateLabel)
    .filter((label): label is string => !!label && ISO_DATE_RE.test(label))
    .sort()
    .pop();
  const endKey = endIso ? endIso.slice(0, 7) : startKey;
  return todayKey >= startKey && todayKey <= endKey ? today : monthOfPlanStart(plan);
}

function viewedMonthLabel(viewed: ViewedMonth): string {
  return new Date(viewed.year, viewed.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function dayDateLabel(day: HistoryDay, index: number): string {
  if (day.dateLabel && ISO_DATE_RE.test(day.dateLabel)) {
    const date = new Date(`${day.dateLabel}T00:00:00`);
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  return `Day ${index + 1}`;
}

export function PatientHistoryPage({ onLogout, onNavigate }: PatientHistoryPageProps) {
  const { token, user } = useAuth();
  const [plans, setPlans] = useState<HistoryPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Server-computed name from GET /patients/:id/plans — the same source of
  // truth PatientTodayPage uses via /patients/:id/today. The auth-store user
  // carries no displayName for patients (patient login returns only
  // id/role/phone/name fields), which is why this page used to show a bare
  // "Patient" where the name should be.
  const [serverPatient, setServerPatient] = useState<{ displayName: string; avatarInitials: string; profilePictureFileId?: string | null } | null>(null);

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [viewedMonth, setViewedMonth] = useState<ViewedMonth>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Same fallback chain as PatientTodayPage: server name first, then whatever
  // the auth store has, then the generic label.
  const displayName = serverPatient?.displayName ?? user?.displayName ?? user?.username ?? "Patient";
  const avatarInitials = serverPatient?.avatarInitials ?? initialsFromName(displayName);
  const avatarUrl = useProfilePicture(token, serverPatient?.profilePictureFileId ?? null);

  useEffect(() => {
    if (!token || !user) {
      setLoading(false);
      setError("Please log in again to view your rehabilitation history.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getPatientPlans(token, user.id)
      .then((res) => {
        if (!cancelled) {
          const mapped = mapServerPlansToHistory(res.plans || []).filter(
            (p) => p.status === "active" || p.status === "completed"
          );
          setPlans(mapped);
          setServerPatient(res.patient ?? null);
          if (mapped.length > 0) {
            const activeOrFirst = mapped.find((p) => p.status === "active") ?? mapped[0];
            setSelectedPlanId((cur) => cur ?? activeOrFirst.id);
            setViewedMonth(monthOfTodayOrPlanStart(activeOrFirst));
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't load your history. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user, reloadKey]);

  // Only active or completed plans are selectable in the "Rehab plan" dropdown —
  // draft/cancelled plans have no meaningful day-by-day history to browse.
  const selectablePlans = useMemo(
    () => plans.filter((plan) => plan.status === "active" || plan.status === "completed"),
    [plans]
  );

  const selectedPlan = selectablePlans.find((plan) => plan.id === selectedPlanId) ?? selectablePlans[0] ?? null;

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
    const chosen = plans.find((plan) => plan.id === planId);
    setViewedMonth(monthOfTodayOrPlanStart(chosen));
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
        displayName={displayName}
        avatarInitials={avatarInitials}
        avatarUrl={avatarUrl}
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
                <strong>{displayName}</strong>
                <small>Patient</small>
              </div>
              <span className={`avatar-badge${avatarUrl ? " with-photo" : ""}`}>
                {avatarUrl ? <img src={avatarUrl} alt={`${displayName}'s profile picture`} /> : avatarInitials}
              </span>
            </div>
          </div>
        </header>

        <main className="therapist-main patient-page-main">
          {loading ? (
            <div className="summary-card" role="status">
              <p className="pd-empty-note">Loading your rehabilitation history…</p>
            </div>
          ) : error ? (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)" }}>
              <p style={{ margin: "0 0 12px", color: "var(--danger, #d33)" }}>{error}</p>
              <button type="button" className="secondary-button" onClick={() => setReloadKey((k) => k + 1)}>
                Try again
              </button>
            </div>
          ) : selectedPlan ? (
            <div className="pp-history-layout">
              <div className="summary-card pd-calendar-card">
                <div className="therapist-chart-heading">
                  <div>
                    <strong>{selectedPlan.name}</strong>
                    <p>
                      {selectedPlan.status.charAt(0).toUpperCase() + selectedPlan.status.slice(1)} plan &middot;{" "}
                      {selectedPlan.startDateLabel || "No start date"}
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
                  {(["completed", "in_progress", "skipped", "pending", "cancelled"] as HeatmapDayStatus[]).map((status) => (
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
                      <strong>{dayDateLabel(selectedDay, selectedDayIndex)}</strong>
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
                      {selectedDay.exercises.map((exercise) => {
                        const Icon = trackingIcons[exercise.trackingType] || Dumbbell;
                        return (
                          <div className="pd-session-row" key={exercise.id}>
                            <div className="pp-history-row-label">
                              <strong>{exercise.name}</strong>
                              <small>
                                <Icon size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                                {trackingLabels[exercise.trackingType]}
                                {exercise.targetValueLabel ? ` · ${exercise.targetValueLabel}` : ""}
                              </small>
                            </div>
                            <div className="pd-session-actions">
                              {exercise.score !== undefined ? (
                                <span className="pd-session-score">Score {exercise.score}</span>
                              ) : (
                                <span className="pd-session-skipped">
                                  {exercise.status === "completed" ? "Completed" : "Not scored"}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
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

                  {plans.length > 1 && (
                    <label className="pp-plan-select" style={{ marginBottom: 16 }}>
                      Rehab plan
                      <select
                        className="admin-role-select"
                        value={selectedPlan.id}
                        onChange={(event) => handleSelectPlan(event.target.value)}
                      >
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name} ({plan.status})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <div className="pd-session-list">
                    {selectedPlan.days.length === 0 ? (
                      <p className="pd-empty-note">No schedule days have been created for this plan yet.</p>
                    ) : (
                      selectedPlan.days.map((day, index) => {
                        const scoredExercises = day.exercises.filter((ex) => ex.score !== undefined);
                        const avgScore =
                          scoredExercises.length > 0
                            ? Math.round(scoredExercises.reduce((sum, ex) => sum + (ex.score ?? 0), 0) / scoredExercises.length)
                            : null;

                        return (
                          <div
                            className={`pd-session-row ${day.status !== "pending" ? "pp-clickable-row" : ""}`}
                            key={day.id || index}
                            onClick={day.status !== "pending" ? () => handleSelectDay(index, day.status) : undefined}
                          >
                            <div className="pp-history-row-label">
                              <strong>{dayDateLabel(day, index)}</strong>
                              <small>
                                {day.exercises.length > 0
                                  ? `${day.exercises.length} exercise${day.exercises.length === 1 ? "" : "s"}`
                                  : "No exercises"}
                              </small>
                            </div>
                            <div className="pd-session-actions">
                              {day.status === "skipped" ? (
                                <span className="pd-session-skipped">Skipped</span>
                              ) : avgScore !== null ? (
                                <span className="pd-session-score">Avg {avgScore}</span>
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
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="summary-card">
              <p className="pd-empty-note">You have no rehabilitation plans yet.</p>
            </div>
          )}
        </main>
      </div>

      <PatientBottomNav activeLabel="History" onNavigate={onNavigate} />
    </section>
  );
}
