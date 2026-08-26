import { Award, CalendarDays, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import { trackingIcon, trackingLabel } from "./ProgramEditorPage";
import { computeStreak, currentDayIndex, dayDateLabel, ISO_DATE_RE } from "../utils/rehabPlan";
import type {
  ExerciseLibraryDifficulty,
  HeatmapDayStatus,
  PatientProgramDay,
  PatientRehabPlan,
  RehabPlanStatus,
  ScheduledExerciseStatus
} from "../types";

// Patient Progress page (sidebar/bottom-nav "Progress"). Redesigned per
// PATIENT_PROGRESS_MOCKUP_PLAN.md §2.3 to consume the real Program Editor schema
// (PatientRehabPlan / ScheduleDay / ScheduledExercise, data/patientRehabPlanMock.ts)
// instead of the old flat, hardcoded `PatientProgramDay` (data/patientMock.ts) —
// so anything a PT actually assigns through Program Editor now shows up here.
// `program` is still passed down for the sidebar/topbar's patient identity
// (display name + avatar initials), which isn't part of the plan schema.
//
// Real, client-side only, same pattern as every other page here: no
// patient_rehabilitation_plans/rehabilitation_schedule_days backend endpoint
// exists yet, so this only ever reads the mock plans passed down from App.tsx —
// there's nothing to persist or refetch.

interface PatientProgressPageProps {
  program: PatientProgramDay;
  plans: PatientRehabPlan[];
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

// .difficulty-badge's CSS only defines easy/moderate/hard modifier classes
// (from the mockup's original Easy/Moderate/Hard difficulty set) — "medium" maps
// onto "moderate" here rather than adding a fourth, near-duplicate CSS class.
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

// Same Sun-first calendar-grid layout PatientDetailPage.tsx's Rehab Plan card
// already uses (pd-calendar-* CSS classes) — sized to exactly `plan.days.length`
// cells (padded to full weeks) rather than a fixed 14-cell strip, so a longer or
// shorter plan renders its real length instead of an arbitrary two weeks.
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
    const date = new Date(startDate);
    date.setDate(date.getDate() + index);
    cells.push({ key: `day-${index}`, status: day.status, dateNumber: date.getDate() });
  });

  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, status: null, dateNumber: null });
  }

  return cells;
}

export function PatientProgressPage({ program, plans, onLogout, onNavigate }: PatientProgressPageProps) {
  // Plan switcher scoped to *active* plans only (PATIENT_PROGRESS_MOCKUP_PLAN.md
  // §2.3/§5) — a completed baseline plan or a paused one stays out of Progress
  // and remains History's job to browse. Defaults to the first active plan.
  const activePlans = plans.filter((plan) => plan.status === "active");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(activePlans[0]?.id ?? null);
  const selectedPlan = activePlans.find((plan) => plan.id === selectedPlanId) ?? activePlans[0] ?? null;

  return (
    <section className="therapist-shell">
      <PatientSidebar
        activeLabel="Progress"
        onNavigate={onNavigate}
        onLogout={onLogout}
        displayName={`${program.patient.displayName} Rodthong`}
        avatarInitials="SR"
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
                <strong>{program.patient.displayName} Rodthong</strong>
                <small>Patient</small>
              </div>
              <span className="avatar-badge">SR</span>
            </div>
          </div>
        </header>

        <main className="therapist-main patient-page-main">
          {!selectedPlan ? (
            <div className="summary-card">
              <p className="pd-empty-note">No active rehab plan right now &mdash; check History for past plans.</p>
            </div>
          ) : (
            <PlanProgress
              plan={selectedPlan}
              allActivePlans={activePlans}
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
  allActivePlans,
  onSelectPlan
}: {
  plan: PatientRehabPlan;
  allActivePlans: PatientRehabPlan[];
  onSelectPlan: (planId: string) => void;
}) {
  const calendarCells = buildCalendarCells(plan);
  const todayIndex = currentDayIndex(plan.days);
  const todayDay = plan.days[todayIndex];
  const streak = computeStreak(plan.days, todayIndex);
  const completedDays = plan.days.filter((day) => day.status === "completed").length;
  const completionPercent = plan.days.length > 0 ? Math.round((completedDays / plan.days.length) * 100) : 0;

  // Next 2-3 pending days that already have exercises pre-scheduled by a PT —
  // only possible now that Program Editor lets a PT assign exercises to future
  // days ahead of time, which the old flat model had no way to represent
  // (PATIENT_PROGRESS_MOCKUP_PLAN.md §2.3's "Coming up" section).
  const comingUp = plan.days
    .map((day, index) => ({ day, index }))
    .filter(({ day, index }) => index > todayIndex && day.status === "pending" && day.exercises.length > 0)
    .slice(0, 3);

  return (
    <>
      {allActivePlans.length > 1 && (
        <div className="summary-card">
          <p className="pd-plan-selector-label">Active rehab plans</p>
          <div className="pd-plan-list">
            {allActivePlans.map((candidate) => (
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
              &nbsp;&middot; {plan.startDateLabel}
              {plan.endDateLabel ? ` \u2013 ${plan.endDateLabel}` : ""}
            </p>
          </div>
        </div>
        {plan.description && <p>{plan.description}</p>}
      </div>

      <div className="therapist-stat-grid">
        <StatCard icon={<TrendingUp size={20} />} label="Plan completion" value={`${completionPercent}%`} accent="primary" />
        {/* Illustrative only — ScheduledExercise has no score field yet; real
            scoring lives in Session Result Review's attempt model
            (exercise_performance_results), a separate schema kept out of this
            rebuild (PATIENT_PROGRESS_MOCKUP_PLAN.md §2.4). */}
        <StatCard icon={<Award size={20} />} label="Avg score" value={84} accent="success" />
        <StatCard
          icon={<CalendarDays size={20} />}
          label="Program day"
          value={`${todayIndex + 1} / ${plan.days.length}`}
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
                      <td>{exercise.targetValueLabel}</td>
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
