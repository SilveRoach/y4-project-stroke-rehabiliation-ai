import { Award, CalendarDays, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import { ApiError, getPatientPlans } from "../services/api";
import { useAuth } from "../store/authStore";
import { initialsFromName } from "../utils/displayName";
import { trackingIcon, trackingLabel } from "./ProgramEditorPage";
import { computeStreak, currentDayIndex, dayDateLabel, ISO_DATE_RE } from "../utils/rehabPlan";
import type {
  ExerciseLibraryDifficulty,
  HeatmapDayStatus,
  PatientRehabPlan,
  RehabPlanStatus,
  ScheduledExercise,
  ScheduledExerciseStatus
} from "../types";

// Patient Progress page (sidebar/bottom-nav "Progress").
// Fetches live rehabilitation plans, schedule days, and performance results
// for the authenticated patient via GET /api/v1/patients/:patientId/plans.
// Calculates real completion rate, average score from recorded attempts,
// current streak, and day-by-day calendar heatmap.

interface PatientProgressPageProps {
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

const planStatusLabels: Record<RehabPlanStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled"
};

const difficultyLabels: Record<ExerciseLibraryDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard"
};

const difficultyBadgeClass: Record<ExerciseLibraryDifficulty, string> = {
  easy: "easy",
  medium: "moderate",
  hard: "hard"
};

const exerciseStatusLabels: Record<ScheduledExerciseStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped",
  cancelled: "Cancelled"
};

const exerciseStatusBadgeClass: Record<ScheduledExerciseStatus, string> = {
  completed: "good",
  in_progress: "fair",
  pending: "poor",
  skipped: "poor",
  cancelled: "poor"
};

interface CalendarCell {
  key: string;
  status: HeatmapDayStatus | null;
  dateNumber: number | null;
}

function buildCalendarCells(plan: PatientRehabPlan): CalendarCell[] {
  if (!ISO_DATE_RE.test(plan.startDateLabel)) {
    return plan.days.map((day, index) => ({ key: `d${index}`, status: day.status, dateNumber: null }));
  }

  const startDate = new Date(`${plan.startDateLabel}T00:00:00`);
  const cells: CalendarCell[] = [];

  for (let i = 0; i < startDate.getDay(); i++) {
    cells.push({ key: `lead-${i}`, status: null, dateNumber: null });
  }

  plan.days.forEach((day, index) => {
    const date = day.dateLabel && ISO_DATE_RE.test(day.dateLabel)
      ? new Date(`${day.dateLabel}T00:00:00`)
      : new Date(startDate.getTime() + index * 86400000);
    cells.push({ key: `day-${index}`, status: day.status, dateNumber: date.getDate() });
  });

  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, status: null, dateNumber: null });
  }

  return cells;
}

// Mirrors backend session.service.ts's `targetValueLabel()`. Turns a raw JSON
// target value (which Prisma returns as a JS object/array/primitive/null) into
// a human-readable string. Without this, JSON objects produce "[object Object]".
function formatTargetValue(targetValue: unknown): string {
  if (targetValue === null || targetValue === undefined) return "";
  if (typeof targetValue === "string" || typeof targetValue === "number") return String(targetValue);
  if (Array.isArray(targetValue)) return targetValue.map(String).join(" · ");
  if (typeof targetValue === "object") {
    return Object.entries(targetValue as Record<string, unknown>)
      .map(([key, value]) => `${String(value)} ${key}`)
      .join(" · ");
  }
  return String(targetValue);
}

function mapServerPlans(serverPlans: any[]): PatientRehabPlan[] {
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
    const days = (sp.scheduleDays || []).map((sd: any) => ({
      id: sd.id,
      dateLabel: sd.scheduledDate
        ? sd.scheduledDate.slice?.(0, 10) ?? new Date(sd.scheduledDate).toISOString().slice(0, 10)
        : undefined,
      status: sd.status,
      therapistNote: sd.therapistNote ?? undefined,
      exercises: (sd.scheduledExercises || []).map((ex: any): ScheduledExercise => ({
        id: ex.id,
        exerciseLibraryId: ex.exerciseLibraryId,
        exerciseName: ex.exerciseLibrary?.name ?? ex.exerciseName ?? (ex.exerciseLibraryId ?? ""),
        versionLabel:
          ex.exerciseLibrary?.versionNumber != null ? `v${ex.exerciseLibrary.versionNumber}` : (ex.versionLabel ?? undefined),
        movementTracking: ex.exerciseLibrary?.movementTracking ?? ex.movementTracking ?? "none",
        orderNumber: ex.orderNumber ?? 0,
        targetType: ex.targetType ?? "free",
        targetValueLabel: formatTargetValue(ex.targetValue),
        difficultyLevel: ex.exerciseLibrary?.difficultyLevel ?? ex.difficultyLevel ?? undefined,
        therapistInstruction: ex.therapistInstruction ?? undefined,
        status: ex.status ?? "pending",
        performanceResults: ex.performanceResults ?? []
      }))
    }));
    const heatmap = (sp.scheduleDays || []).map((sd: any) => sd.status as HeatmapDayStatus);
    return {
      id: sp.id,
      name: sp.name,
      description: sp.description ?? undefined,
      status: sp.status,
      startDateLabel: start,
      endDateLabel: end || undefined,
      heatmap,
      days
    } as PatientRehabPlan;
  });
}

function computePlanAverageScore(plan: PatientRehabPlan): number | null {
  const scores: number[] = [];
  for (const day of plan.days) {
    for (const exercise of day.exercises) {
      if (exercise.performanceResults && exercise.performanceResults.length > 0) {
        const latest = exercise.performanceResults.reduce<any>(
          (result, candidate) => (!result || candidate.attemptNumber > result.attemptNumber ? candidate : result),
          null
        );
        const score = latest?.finalScore ?? latest?.ptScore ?? latest?.aiScore;
        if (score !== null && score !== undefined) {
          const num = typeof score === "number" ? score : Number(score);
          if (!Number.isNaN(num)) scores.push(num);
        }
      }
    }
  }
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

export function PatientProgressPage({ onLogout, onNavigate }: PatientProgressPageProps) {
  const { token, user } = useAuth();
  const [plans, setPlans] = useState<PatientRehabPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const displayName = user?.displayName ?? user?.username ?? "Patient";
  const avatarInitials = initialsFromName(displayName);

  useEffect(() => {
    if (!token || !user) {
      setLoading(false);
      setError("Please log in again to view your progress.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getPatientPlans(token, user.id)
      .then((res) => {
        if (!cancelled) {
          const mapped = mapServerPlans(res.plans || []);
          setPlans(mapped);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't load your progress. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user, reloadKey]);

  const activePlans = plans.filter((plan) => plan.status === "active");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  // Default to the first active plan if available, otherwise the first plan
  const selectedPlan =
    activePlans.find((plan) => plan.id === selectedPlanId) ??
    activePlans[0] ??
    plans.find((plan) => plan.id === selectedPlanId) ??
    plans[0] ??
    null;

  return (
    <section className="therapist-shell">
      <PatientSidebar
        activeLabel="Progress"
        onNavigate={onNavigate}
        onLogout={onLogout}
        displayName={displayName}
        avatarInitials={avatarInitials}
      />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Progress</h1>
            <p>How your rehab program is going</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{displayName}</strong>
                <small>Patient</small>
              </div>
              <span className="avatar-badge">{avatarInitials}</span>
            </div>
          </div>
        </header>

        <main className="therapist-main patient-page-main">
          {loading ? (
            <div className="summary-card">
              <p className="pd-empty-note">Loading your progress…</p>
            </div>
          ) : error ? (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)" }}>
              <p className="pd-empty-note" style={{ color: "var(--danger, #d33)" }}>{error}</p>
              <button
                type="button"
                className="secondary-button"
                style={{ marginTop: 12 }}
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Try again
              </button>
            </div>
          ) : !selectedPlan ? (
            <div className="summary-card">
              <p className="pd-empty-note">No active rehab plan right now &mdash; check History for past plans.</p>
            </div>
          ) : (
            <PlanProgress
              plan={selectedPlan}
              allPlans={plans}
              onSelectPlan={setSelectedPlanId}
            />
          )}
        </main>
      </div>

      <PatientBottomNav activeLabel="Progress" onNavigate={onNavigate} />
    </section>
  );
}

function PlanProgress({
  plan,
  allPlans,
  onSelectPlan
}: {
  plan: PatientRehabPlan;
  allPlans: PatientRehabPlan[];
  onSelectPlan: (planId: string) => void;
}) {
  const calendarCells = buildCalendarCells(plan);
  const todayIndex = currentDayIndex(plan.days);
  const todayDay = plan.days[todayIndex] ?? { status: "pending" as HeatmapDayStatus, exercises: [] };
  const streak = computeStreak(plan.days, todayIndex);
  const completedDays = plan.days.filter((day) => day.status === "completed").length;
  const completionPercent = plan.days.length > 0 ? Math.round((completedDays / plan.days.length) * 100) : 0;
  const averageScore = computePlanAverageScore(plan);

  // Next 2-3 pending days that already have exercises pre-scheduled by a PT
  const comingUp = plan.days
    .map((day, index) => ({ day, index }))
    .filter(({ day, index }) => index > todayIndex && day.status === "pending" && day.exercises.length > 0)
    .slice(0, 3);

  return (
    <>
      {allPlans.length > 1 && (
        <div className="summary-card">
          <p className="pd-plan-selector-label">Rehabilitation plans</p>
          <div className="pd-plan-list">
            {allPlans.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`pd-plan-row ${candidate.id === plan.id ? "active" : ""}`}
                onClick={() => onSelectPlan(candidate.id)}
              >
                <strong>{candidate.name}</strong>
                <span className={`pd-program-status ${candidate.status}`}>{planStatusLabels[candidate.status]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="summary-card">
        <div className="therapist-chart-heading">
          <div>
            <strong>{plan.name}</strong>
            <p>
              <span className={`pd-program-status ${plan.status}`}>{planStatusLabels[plan.status]}</span>
              {plan.startDateLabel && (
                <>
                  &nbsp;&middot; {plan.startDateLabel}
                  {plan.endDateLabel ? ` \u2013 ${plan.endDateLabel}` : ""}
                </>
              )}
            </p>
          </div>
        </div>
        {plan.description && <p>{plan.description}</p>}
      </div>

      <div className="therapist-stat-grid">
        <StatCard icon={<TrendingUp size={20} />} label="Plan completion" value={`${completionPercent}%`} accent="primary" />
        <StatCard
          icon={<Award size={20} />}
          label="Avg score"
          value={averageScore !== null ? averageScore : "—"}
          accent="success"
        />
        <StatCard
          icon={<CalendarDays size={20} />}
          label="Program day"
          value={plan.days.length > 0 ? `${todayIndex + 1} / ${plan.days.length}` : "—"}
          accent="teal"
        />
        <StatCard icon={<Award size={20} />} label="Current streak" value={`${streak} day${streak === 1 ? "" : "s"}`} accent="warning" />
      </div>

      <div className="summary-card">
        <p className="eyebrow">
          <CalendarDays size={14} /> {plan.days.length}-day plan
        </p>
        <div className="pd-calendar-weekdays">
          {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
            <span key={index}>{day}</span>
          ))}
        </div>
        <div className="pd-calendar-grid">
          {calendarCells.map((cell) => (
            <div
              key={cell.key}
              className={`pd-calendar-cell ${cell.status ?? "blank"}`}
              title={cell.status ? heatmapLabels[cell.status] : undefined}
            >
              {cell.dateNumber ?? ""}
            </div>
          ))}
        </div>
        <div className="pd-legend">
          {(["completed", "in_progress", "skipped", "pending", "cancelled"] as HeatmapDayStatus[]).map((status) => (
            <span key={status}>
              <span className={`pd-legend-dot ${status}`} />
              {heatmapLabels[status]}
            </span>
          ))}
        </div>
      </div>

      <div className="summary-card">
        <p className="eyebrow">{dayDateLabel(plan, todayIndex)}&apos;s exercises</p>
        {todayDay.exercises.length === 0 ? (
          <p className="pd-empty-note">No exercises assigned for today yet.</p>
        ) : (
          <div className="therapist-table-scroll">
            <table className="therapist-table">
              <thead>
                <tr>
                  <th>Exercise</th>
                  <th>Tracking</th>
                  <th>Target</th>
                  <th>Difficulty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {todayDay.exercises.map((exercise) => {
                  const Icon = trackingIcon[exercise.movementTracking];
                  return (
                    <tr key={exercise.id}>
                      <td>
                        <strong style={{ color: "var(--text-primary)" }}>{exercise.exerciseName}</strong>
                        {exercise.versionLabel && <small> &middot; {exercise.versionLabel}</small>}
                        {exercise.therapistInstruction && (
                          <>
                            <br />
                            <small>{exercise.therapistInstruction}</small>
                          </>
                        )}
                      </td>
                      <td>
                        <span className={`pe-exercise-icon tracking-${exercise.movementTracking}`} style={{ width: 28, height: 28 }}>
                          <Icon size={14} />
                        </span>{" "}
                        {trackingLabel[exercise.movementTracking]}
                      </td>
                      <td>{exercise.targetValueLabel || "—"}</td>
                      <td>
                        {exercise.difficultyLevel ? (
                          <span className={`difficulty-badge ${difficultyBadgeClass[exercise.difficultyLevel]}`}>
                            {difficultyLabels[exercise.difficultyLevel]}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span className={`badge-pill ${exerciseStatusBadgeClass[exercise.status]}`}>
                          {exerciseStatusLabels[exercise.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="summary-card">
        <p className="eyebrow">Coming up</p>
        {comingUp.length === 0 ? (
          <p className="pd-empty-note">No upcoming days have exercises scheduled yet.</p>
        ) : (
          <div className="pd-session-list">
            {comingUp.map(({ day, index }) => (
              <div className="pd-session-row" key={index}>
                <div className="pp-history-row-label">
                  <strong>{dayDateLabel(plan, index)}</strong>
                  <small>
                    {day.exercises.length} exercise{day.exercises.length === 1 ? "" : "s"} &middot;{" "}
                    {day.exercises.map((exercise) => exercise.exerciseName).join(", ")}
                  </small>
                </div>
                <div className="pd-session-actions">
                  <span className="badge-pill poor">{heatmapLabels[day.status]}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent = "primary"
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  accent?: "primary" | "teal" | "success" | "warning";
}) {
  return (
    <div className={`summary-card therapist-stat-card accent-${accent}`}>
      <div className="therapist-stat-top">
        <span className="therapist-stat-icon">{icon}</span>
      </div>
      <div className="therapist-stat-value">{value}</div>
      <p className="therapist-stat-label">{label}</p>
    </div>
  );
}
