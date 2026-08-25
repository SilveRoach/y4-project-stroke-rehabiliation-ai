import { useMemo, useState } from "react";
import {
  Award,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  Play,
  UserRound
} from "lucide-react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import { trackingIcon, trackingLabel } from "./ProgramEditorPage";
import { computeStreak, currentDayIndex } from "../utils/rehabPlan";
import {
  buildExerciseDateSet,
  buildMonthExerciseCells,
  findTodayScheduledExercise,
  getTodayExerciseGroups,
  monthOfPrimaryPlanToday,
  viewedMonthLabel
} from "../utils/patientToday";
import type { ViewedMonth } from "../utils/patientToday";
import type { ExerciseLibraryDifficulty, PatientProgramDay, PatientRehabPlan, ScheduledExerciseStatus } from "../types";

// Home page (sidebar/bottom-nav "Home"). Redesigned per PATIENT_TODAY_MOCKUP_PLAN.md
// §2.2 to read the same PatientRehabPlan[] Progress reads (data/patientRehabPlanMock.ts)
// instead of the flat, hardcoded `patientProgram.exercises` — so anything a PT
// actually assigns via Program Editor now shows up here too, on the day it's
// scheduled for. `program` is still passed down for the sidebar/topbar's patient
// identity (display name + avatar), which isn't part of the plan schema.
//
// No plan switcher (§2.1/§5 decision) — Home always shows *today*. When more than
// one active plan has exercises scheduled today, the list is grouped by plan
// rather than merged or picking just one. The calendar card is deliberately
// simpler than Progress's: it doesn't color by day status, it just answers
// "does any active plan have exercises this day, yes or no" (styled like
// PatientHistoryPage.tsx's month grid), since that's the only thing Home's
// calendar needs to tell the patient.
//
// Start Session (onStartSession) still takes an optional ScheduledExercise id —
// App.tsx resolves it via utils/patientToday.ts's findTodayScheduledExercise/
// shimScheduledExerciseToPatientExercise (PATIENT_TODAY_MOCKUP_PLAN.md §2.3,
// Option B: shim into PatientSessionPage's existing PatientExercise shape rather
// than teaching that page the real schema).

interface PatientTodayPageProps {
  program: PatientProgramDay;
  plans: PatientRehabPlan[];
  onLogout: () => void;
  onNavigate: (label: PatientNavLabel) => void;
  onStartSession: (exerciseId?: string) => void;
}

const difficultyLabels: Record<ExerciseLibraryDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard"
};

// .difficulty-badge's CSS only defines easy/moderate/hard modifier classes —
// "medium" maps onto "moderate", same convention as PatientProgressPage.tsx.
const difficultyBadgeClass: Record<ExerciseLibraryDifficulty, string> = {
  easy: "easy",
  medium: "moderate",
  hard: "hard"
};

const exerciseStatusLabel: Record<ScheduledExerciseStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  completed: "Done today",
  skipped: "Skipped",
  cancelled: "Cancelled"
};

export function PatientTodayPage({ program, plans, onLogout, onNavigate, onStartSession }: PatientTodayPageProps) {
  const groups = useMemo(() => getTodayExerciseGroups(plans), [plans]);
  const allTodayExercises = useMemo(() => groups.flatMap((group) => group.exercises), [groups]);
  const completedCount = allTodayExercises.filter((exercise) => exercise.status === "completed").length;
  const totalCount = allTodayExercises.length;
  const completionPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const nextExercise = findTodayScheduledExercise(groups);

  // Streak (and the "Day X of Y" heading below) are computed off the patient's
  // primary/first active plan, same as Progress defaults to — merging multiple
  // active plans' day statuses into one streak number isn't attempted
  // (PATIENT_TODAY_MOCKUP_PLAN.md §2.2/§6, flagged as an open assumption there).
  const activePlans = useMemo(() => plans.filter((plan) => plan.status === "active"), [plans]);
  const primaryPlan = activePlans[0] ?? null;
  const primaryTodayIndex = primaryPlan ? currentDayIndex(primaryPlan.days) : 0;
  const streak = primaryPlan ? computeStreak(primaryPlan.days, primaryTodayIndex) : 0;

  const exerciseDates = useMemo(() => buildExerciseDateSet(plans), [plans]);
  const [viewedMonth, setViewedMonth] = useState<ViewedMonth>(() => monthOfPrimaryPlanToday(plans));
  const calendarCells = useMemo(() => buildMonthExerciseCells(exerciseDates, viewedMonth), [exerciseDates, viewedMonth]);

  const changeMonth = (delta: 1 | -1) => {
    setViewedMonth((current) => {
      const total = current.year * 12 + current.month + delta;
      return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
    });
  };

  return (
    <section className="therapist-shell">
      <PatientSidebar
        activeLabel="Home"
        onNavigate={onNavigate}
        onLogout={onLogout}
        displayName={`${program.patient.displayName} Rodthong`}
        avatarInitials="SR"
      />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <p className="eyebrow">Hello</p>
            <h1>{program.patient.displayName} Rodthong</h1>
          </div>
          <div className="therapist-topbar-actions">
            <span className="streak-pill">
              <Flame size={15} /> {streak} day{streak === 1 ? "" : "s"} streak
            </span>
            <div className="therapist-topbar-profile">
              <div>
                <strong>{program.patient.displayName} Rodthong</strong>
                <small>Patient</small>
              </div>
              <span className="avatar-badge">SR</span>
            </div>
          </div>
        </header>

        <div className="today-grid">
          <section className="today-main-panel hero-progress-card">
            <div>
              <p>Today&apos;s Progress</p>
              <div className="hero-progress-row">
                <div>
                  <strong>
                    {completedCount}/{totalCount}
                  </strong>
                  <span>Exercises completed</span>
                </div>
                <ProgressRing value={completionPercent} label={`${completionPercent}%`} tone="light" />
              </div>
              <div className="linear-progress" aria-hidden="true">
                <span style={{ width: `${completionPercent}%` }} />
              </div>
            </div>

            <button
              className="primary-button patient-start-button"
              onClick={() => onStartSession(nextExercise?.id)}
              disabled={!nextExercise}
            >
              <Play size={20} fill="currentColor" />
              {nextExercise ? "Start Session" : totalCount > 0 ? "Today's session complete" : "No exercises today"}
            </button>
          </section>

          <section className="today-main-panel exercise-panel">
            <div className="program-heading">
              <div>
                <p className="eyebrow">Your program</p>
                <h2>{primaryPlan ? `Day ${primaryTodayIndex + 1} of ${primaryPlan.days.length}` : "Today"}</h2>
              </div>
              <span className="completion-pill">
                {completedCount}/{totalCount} complete
              </span>
            </div>

            {groups.length === 0 ? (
              <p className="pd-empty-note">No exercises are scheduled for today.</p>
            ) : (
              <div className="exercise-list" aria-label="Today's exercises">
                {groups.map((group) => (
                  <div key={group.planId}>
                    {groups.length > 1 && (
                      <p className="pd-plan-selector-label" style={{ marginTop: 8 }}>
                        {group.planName}
                      </p>
                    )}
                    {group.exercises.map((exercise) => {
                      const Icon = trackingIcon[exercise.movementTracking];
                      return (
                        <button
                          className="exercise-card"
                          key={exercise.id}
                          onClick={() => onStartSession(exercise.id)}
                          type="button"
                        >
                          <span
                            className={`exercise-icon ${exercise.status === "completed" ? "done" : exercise.status}`}
                            aria-hidden="true"
                          >
                            {exercise.status === "completed" ? <CheckCircle2 size={24} /> : <UserRound size={24} />}
                          </span>
                          <span>
                            <strong>
                              {exercise.exerciseName}
                              {exercise.versionLabel ? ` \u00b7 ${exercise.versionLabel}` : ""}
                            </strong>
                            <small>
                              <Icon size={12} /> {trackingLabel[exercise.movementTracking]} &middot; {exercise.targetValueLabel}
                            </small>
                            {exercise.therapistInstruction && <small>{exercise.therapistInstruction}</small>}
                          </span>
                          <span className="exercise-meta">
                            {exercise.difficultyLevel ? (
                              <span className={`difficulty-badge ${difficultyBadgeClass[exercise.difficultyLevel]}`}>
                                {difficultyLabels[exercise.difficultyLevel]}
                              </span>
                            ) : (
                              <span className="difficulty-badge">{exerciseStatusLabel[exercise.status]}</span>
                            )}
                            <small>{exerciseStatusLabel[exercise.status]}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="today-side-panel">
            <section className="summary-card">
              <p className="eyebrow">Next exercise</p>
              <h2>{nextExercise?.exerciseName ?? "All done today"}</h2>
              <p>{nextExercise?.therapistInstruction ?? "Today's program day is complete."}</p>
              <button className="secondary-button" onClick={() => onStartSession(nextExercise?.id)} disabled={!nextExercise}>
                Continue <ChevronRight size={16} />
              </button>
            </section>

            <section className="summary-card">
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
                  <div
                    key={cell.key}
                    className={`pd-calendar-cell ${!cell.inMonth ? "blank" : cell.hasExercise ? "completed" : "no_plan"}`}
                    title={cell.inMonth ? (cell.hasExercise ? "Exercises scheduled" : "No exercises scheduled") : undefined}
                  >
                    {cell.dateNumber ?? ""}
                  </div>
                ))}
              </div>
              <div className="pd-legend">
                <span>
                  <span className="pd-legend-dot completed" />
                  Has exercises
                </span>
                <span>
                  <span className="pd-legend-dot no_plan" />
                  No exercises
                </span>
              </div>
            </section>

            <section className="summary-card stats-row">
              <span>
                <strong>86</strong>
                Avg score
              </span>
              <span>
                <strong>11</strong>
                Sessions
              </span>
            </section>

            <section className="achievement-card">
              <Award size={24} />
              <div>
                <strong>{streak > 0 ? `${streak}-Day Streak` : "Start your streak"}</strong>
                <p>
                  {streak > 0
                    ? "Keep going. Small daily wins build recovery momentum."
                    : "Complete today's exercises to start a new streak."}
                </p>
              </div>
            </section>
          </aside>
        </div>
      </div>

      <PatientBottomNav activeLabel="Home" onNavigate={onNavigate} />
    </section>
  );
}

function ProgressRing({ value, label, tone = "normal" }: { value: number; label: string; tone?: "normal" | "light" }) {
  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;

  return (
    <span className={`progress-ring ${tone}`}>
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
        <circle cx="38" cy="38" r={radius} />
        <circle cx="38" cy="38" r={radius} strokeDasharray={`${dash} ${circumference}`} />
      </svg>
      <strong>{label}</strong>
    </span>
  );
}
