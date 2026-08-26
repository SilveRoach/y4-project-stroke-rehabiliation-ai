import { useEffect, useMemo, useState } from "react";
import { Award, CheckCircle2, ChevronLeft, ChevronRight, Flame, Play, UserRound } from "lucide-react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import { ApiError, getPatientToday, type PatientTodayData, type PatientTodayExercise } from "../services/api";
import { useAuth } from "../store/authStore";
import type { ExerciseLibraryDifficulty, ScheduledExerciseStatus } from "../types";
import { buildMonthExerciseCells, viewedMonthLabel } from "../utils/patientToday";
import type { ViewedMonth } from "../utils/patientToday";
import { trackingIcon, trackingLabel } from "./ProgramEditorPage";

interface PatientTodayPageProps { onLogout: () => void; onNavigate: (label: PatientNavLabel) => void; onOpenInstruction: (exercise?: PatientTodayExercise) => void; }

const difficultyLabels: Record<ExerciseLibraryDifficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const difficultyBadgeClass: Record<ExerciseLibraryDifficulty, string> = { easy: "easy", medium: "moderate", hard: "hard" };
const exerciseStatusLabel: Record<ScheduledExerciseStatus, string> = { pending: "Not started", in_progress: "In progress", completed: "Done today", skipped: "Skipped", cancelled: "Cancelled" };

export function PatientTodayPage({ onLogout, onNavigate, onOpenInstruction }: PatientTodayPageProps) {
  const { token, user } = useAuth();
  const [today, setToday] = useState<PatientTodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewedMonth, setViewedMonth] = useState<ViewedMonth>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  useEffect(() => {
    if (!token || !user) { setLoading(false); setError("Please log in again to view your rehabilitation schedule."); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    getPatientToday(token, user.id)
      .then((data) => { if (!cancelled) setToday(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load your rehabilitation schedule. Please try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, user, reloadKey]);

  const scheduleDay = today?.scheduleDay ?? null;
  const exercises = scheduleDay?.exercises ?? [];
  const completedCount = exercises.filter((exercise) => exercise.status === "completed").length;
  const totalCount = exercises.length;
  const completionPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const nextExercise = exercises.find((exercise) => exercise.status === "in_progress" || exercise.status === "pending");
  const exerciseDates = useMemo(() => new Set(scheduleDay?.plan.scheduleDates ?? []), [scheduleDay]);
  const calendarCells = useMemo(() => buildMonthExerciseCells(exerciseDates, viewedMonth), [exerciseDates, viewedMonth]);

  useEffect(() => {
    if (!scheduleDay) return;
    const date = new Date(`${scheduleDay.scheduledDate}T00:00:00`);
    setViewedMonth({ year: date.getFullYear(), month: date.getMonth() });
  }, [scheduleDay]);

  const changeMonth = (delta: 1 | -1) => setViewedMonth((current) => {
    const total = current.year * 12 + current.month + delta;
    return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
  });
  const patientName = today?.patient.displayName ?? user?.displayName ?? user?.username ?? "Patient";
  const avatarInitials = today?.patient.avatarInitials ?? patientName.slice(0, 2).toUpperCase();

  if (loading || error) return <section className="therapist-shell">
    <PatientSidebar activeLabel="Home" onNavigate={onNavigate} onLogout={onLogout} displayName={patientName} avatarInitials={avatarInitials} />
    <div className="therapist-workspace"><section className="today-main-panel exercise-panel" role={error ? "alert" : "status"}><p className="pd-empty-note">{loading ? "Loading your rehabilitation schedule…" : error}</p>{error && <button className="secondary-button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>}</section></div>
    <PatientBottomNav activeLabel="Home" onNavigate={onNavigate} />
  </section>;

  return <section className="therapist-shell">
    <PatientSidebar activeLabel="Home" onNavigate={onNavigate} onLogout={onLogout} displayName={patientName} avatarInitials={avatarInitials} />
    <div className="therapist-workspace">
      <header className="therapist-topbar"><div><p className="eyebrow">Hello</p><h1>{patientName}</h1></div><div className="therapist-topbar-actions"><span className="streak-pill"><Flame size={15} /> {scheduleDay?.streak ?? 0} day{scheduleDay?.streak === 1 ? "" : "s"} streak</span><div className="therapist-topbar-profile"><div><strong>{patientName}</strong><small>Patient</small></div><span className="avatar-badge">{avatarInitials}</span></div></div></header>
      <div className="today-grid">
        <section className="today-main-panel hero-progress-card"><div><p>Today's Progress</p><div className="hero-progress-row"><div><strong>{completedCount}/{totalCount}</strong><span>Exercises completed</span></div><ProgressRing value={completionPercent} label={`${completionPercent}%`} tone="light" /></div><div className="linear-progress" aria-hidden="true"><span style={{ width: `${completionPercent}%` }} /></div></div><button className="primary-button patient-start-button" onClick={() => onOpenInstruction(nextExercise)} disabled={!nextExercise}><Play size={20} fill="currentColor" />{nextExercise ? "Start Session" : totalCount > 0 ? "Today's session complete" : "No exercises today"}</button></section>
        <section className="today-main-panel exercise-panel"><div className="program-heading"><div><p className="eyebrow">Your program</p><h2>{scheduleDay ? `Day ${scheduleDay.dayNumber} of ${scheduleDay.plan.totalDays}` : "No active schedule"}</h2></div><span className="completion-pill">{completedCount}/{totalCount} complete</span></div>
          {!scheduleDay ? <p className="pd-empty-note">You have no active or available schedule.</p> : exercises.length === 0 ? <p className="pd-empty-note">No exercises are scheduled for this program day.</p> : <div className="exercise-list" aria-label="Today's exercises">{exercises.map((exercise) => {
            const Icon = trackingIcon[exercise.movementTracking];
            return <button className="exercise-card" key={exercise.id} onClick={() => onOpenInstruction(exercise)} type="button"><span className={`exercise-icon ${exercise.status === "completed" ? "done" : exercise.status}`} aria-hidden="true">{exercise.status === "completed" ? <CheckCircle2 size={24} /> : <UserRound size={24} />}</span><span><strong>{exercise.exerciseName}{exercise.versionLabel ? ` · ${exercise.versionLabel}` : ""}</strong><small><Icon size={12} /> {trackingLabel[exercise.movementTracking]} &middot; {exercise.targetValueLabel}</small>{exercise.therapistInstruction && <small>{exercise.therapistInstruction}</small>}</span><span className="exercise-meta"><span className={`difficulty-badge ${difficultyBadgeClass[exercise.difficultyLevel]}`}>{difficultyLabels[exercise.difficultyLevel]}</span><small>{exerciseStatusLabel[exercise.status]}</small></span></button>;
          })}</div>}
        </section>
        <aside className="today-side-panel">
          <section className="summary-card"><p className="eyebrow">Next exercise</p><h2>{nextExercise?.exerciseName ?? (scheduleDay ? "All done today" : "No scheduled session")}</h2><p>{nextExercise?.therapistInstruction ?? scheduleDay?.therapistNote ?? "There are no incomplete exercises to continue."}</p><button className="secondary-button" onClick={() => onOpenInstruction(nextExercise)} disabled={!nextExercise}>Continue <ChevronRight size={16} /></button></section>
          <section className="summary-card"><div className="pp-calendar-month-nav"><button type="button" className="icon-button" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button><strong>{viewedMonthLabel(viewedMonth)}</strong><button type="button" className="icon-button" onClick={() => changeMonth(1)} aria-label="Next month"><ChevronRight size={16} /></button></div><div className="pd-calendar-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={index}>{day}</span>)}</div><div className="pd-calendar-grid">{calendarCells.map((cell) => <div key={cell.key} className={`pd-calendar-cell ${!cell.inMonth ? "blank" : cell.hasExercise ? "completed" : "no_plan"}`} title={cell.inMonth ? (cell.hasExercise ? "Exercises scheduled" : "No exercises scheduled") : undefined}>{cell.dateNumber ?? ""}</div>)}</div><div className="pd-legend"><span><span className="pd-legend-dot completed" />Has exercises</span><span><span className="pd-legend-dot no_plan" />No exercises</span></div></section>
          <section className="summary-card stats-row"><span><strong>{today?.stats.averageScore ?? "—"}</strong>Avg score</span><span><strong>{today?.stats.completedSessions ?? 0}</strong>Sessions</span></section>
          <section className="achievement-card"><Award size={24} /><div><strong>{(scheduleDay?.streak ?? 0) > 0 ? `${scheduleDay?.streak}-Day Streak` : "Start your streak"}</strong><p>{(scheduleDay?.streak ?? 0) > 0 ? "Keep going. Small daily wins build recovery momentum." : "Complete today's exercises to start a new streak."}</p></div></section>
        </aside>
      </div>
    </div>
    <PatientBottomNav activeLabel="Home" onNavigate={onNavigate} />
  </section>;
}

function ProgressRing({ value, label, tone = "normal" }: { value: number; label: string; tone?: "normal" | "light" }) {
  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  return <span className={`progress-ring ${tone}`}><svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r={radius} /><circle cx="38" cy="38" r={radius} strokeDasharray={`${dash} ${circumference}`} /></svg><strong>{label}</strong></span>;
}
