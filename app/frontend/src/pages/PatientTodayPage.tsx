import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  Heart,
  MessageSquare,
  Play,
  TrendingUp
} from "lucide-react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import { useProfilePicture } from "../hooks/useProfilePicture";
import { ApiError, getPatientToday, type PatientTodayData, type PatientTodayExercise } from "../services/api";
import { useAuth } from "../store/authStore";
import type { ScheduledExerciseStatus } from "../types";
import { buildExerciseDateStatusMap, buildScheduleCalendarPlan, buildTodayExerciseStripCells } from "../utils/patientToday";
import { buildMonthCalendar, planMonthRange } from "./PatientDetailPage";
import { currentDayIndex } from "../utils/rehabPlan";
import type { HeatmapDayStatus, PatientRehabPlan } from "../types";
import { trackingIcon } from "./ProgramEditorPage";
import { timeOfDayGreeting } from "../utils/displayName";

interface PatientTodayPageProps { onLogout: () => void; onNavigate: (label: PatientNavLabel) => void; onOpenInstruction: (exercise?: PatientTodayExercise) => void; }

const exerciseStatusLabel: Record<ScheduledExerciseStatus, string> = { pending: "Not started", in_progress: "In progress", completed: "Done today", skipped: "Skipped", cancelled: "Cancelled" };

const heatmapLabels: Record<HeatmapDayStatus, string> = { completed: "Completed", in_progress: "In progress", skipped: "Skipped", pending: "Pending", cancelled: "Cancelled" };

// Difficulty tag on the exercise metadata line — same label/class convention as
// PatientDetailPage's difficultyLabels/difficultyBadgeClass ("medium" renders as
// the "moderate" amber badge). Colors come from the shared .difficulty-badge
// rules; only the compact sizing lives in the .exercise-difficulty override.
const exerciseDifficultyLabel: Record<PatientTodayExercise["difficultyLevel"], string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const exerciseDifficultyClass: Record<PatientTodayExercise["difficultyLevel"], string> = { easy: "easy", medium: "moderate", hard: "hard" };

export function PatientTodayPage({ onLogout, onNavigate, onOpenInstruction }: PatientTodayPageProps) {
  const { token, user } = useAuth();
  const [today, setToday] = useState<PatientTodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Month key ("YYYY-MM") for the month-view calendar; null = follow the visible
  // plan's start month (resets when the plan selection changes), same convention
  // as the Progress page's month calendar.
  const [viewMonthKey, setViewMonthKey] = useState<string | null>(null);
  // Clicked calendar day (index into calendarPlan.days); null = the current
  // program day — the same tap-to-inspect interaction as the Progress page.
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  // Home's calendar defaults to a compact week strip (redesigned for mobile
  // density) with the pre-existing full month grid still reachable via toggle,
  // rather than always showing the month grid up front.
  const [calendarView, setCalendarView] = useState<"week" | "month">("week");
  // Therapist notes on each exercise row are collapsed by default on the
  // redesigned row and expand in place on tap, instead of always rendering a
  // third line of text (or a separate duplicate "Next exercise" card).
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  // Which active plan's "today" to show — "all" merges every active plan's
  // exercises into one list (grouped by plan when there's more than one with
  // something due today); a specific plan id scopes the whole page (hero,
  // calendar, exercise list) down to just that plan, same as before this
  // selector existed for single-plan patients.
  const [selectedPlanId, setSelectedPlanId] = useState<"all" | string>("all");

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

  const activePlans = today?.activePlans ?? [];
  const allPlans = today?.plans ?? [];
  // Reset back to "All Plans" if the selected plan disappears from the active
  // list (e.g. a therapist completes/cancels it mid-session) rather than
  // silently showing an empty page.
  useEffect(() => {
    if (selectedPlanId !== "all" && !activePlans.some((plan) => plan.id === selectedPlanId)) setSelectedPlanId("all");
  }, [activePlans, selectedPlanId]);

  const visiblePlans = useMemo(
    () => (selectedPlanId === "all" ? allPlans : allPlans.filter((plan) => plan.id === selectedPlanId)),
    [allPlans, selectedPlanId]
  );
  // One group per visible plan that actually has exercises due today — a plan
  // with nothing scheduled today just contributes no group, same as it
  // contributed no exercises before this selector existed.
  const exerciseGroups = useMemo(
    () =>
      visiblePlans
        .filter((plan) => plan.today && plan.today.exercises.length > 0)
        .map((plan) => ({ planId: plan.id, planName: plan.name, exercises: plan.today!.exercises })),
    [visiblePlans]
  );
  // Group headers only make sense in "All Plans" view, and only once there's
  // actually more than one plan contributing exercises today.
  const showGroupLabels = selectedPlanId === "all" && exerciseGroups.length > 1;
  const exercises = useMemo(() => exerciseGroups.flatMap((group) => group.exercises), [exerciseGroups]);
  const completedCount = exercises.filter((exercise) => exercise.status === "completed").length;
  const totalCount = exercises.length;
  const completionPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const nextExercise = exercises.find((exercise) => exercise.status === "in_progress" || exercise.status === "pending");
  // Calendar dots are the union of every visible plan's scheduled dates, so
  // switching to "All Plans" shows a day as scheduled if any plan has
  // something on it, not just whichever plan happened to be selected before.
  const exerciseDates = useMemo(() => {
    const dates = new Set<string>();
    visiblePlans.forEach((plan) => plan.scheduleDates.forEach((date) => dates.add(date)));
    return dates;
  }, [visiblePlans]);
  const todayIso = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);
  // Per-date completion status (completed/missing/none) for the same visible
  // plans the dot-presence set above already tracks — drives the strip's
  // green/red/dark-gray fill, distinct from exerciseDates' plain yes/no.
  const dateStatusMap = useMemo(() => buildExerciseDateStatusMap(visiblePlans), [visiblePlans]);
  // Reshape the visible plans into the PatientRehabPlan shape the Progress page's
  // month calendar consumes — same adapter (buildScheduleCalendarPlan) the
  // Progress page uses, so the Today page's month view renders identically.
  const calendarPlan: PatientRehabPlan = useMemo(
    () => buildScheduleCalendarPlan(visiblePlans, dateStatusMap),
    [visiblePlans, dateStatusMap]
  );
  // The scrollable strip covers today ± 10 days (21 cells) and scrolls freely
  // in both directions — see the centering logic below for how the "middle"
  // day gets tracked and highlighted as the user scrolls or taps a cell.
  const stripCells = useMemo(() => buildTodayExerciseStripCells(dateStatusMap, todayIso), [dateStatusMap, todayIso]);

  // --- Scrollable strip centering ---
  // Whichever day's cell sits closest to the strip's horizontal center gets the
  // blue "centered" highlight — starts on today, updates as the person scrolls,
  // and jumps straight to a cell (smooth-scrolled to center) when tapped.
  const [centeredIso, setCenteredIso] = useState(todayIso);
  const weekStripRef = useRef<HTMLDivElement | null>(null);
  const stripCellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const stripScrollFrame = useRef<number | null>(null);

  const registerStripCellRef = (iso: string) => (el: HTMLButtonElement | null) => {
    if (el) stripCellRefs.current.set(iso, el);
    else stripCellRefs.current.delete(iso);
  };

  const recomputeCenteredCell = () => {
    const container = weekStripRef.current;
    if (!container) return;
    const containerCenterX = container.getBoundingClientRect().left + container.getBoundingClientRect().width / 2;
    let closestIso: string | null = null;
    let closestDistance = Infinity;
    stripCellRefs.current.forEach((cellEl, iso) => {
      const rect = cellEl.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - containerCenterX);
      if (distance < closestDistance) { closestDistance = distance; closestIso = iso; }
    });
    if (closestIso) setCenteredIso(closestIso);
  };

  const handleStripScroll = () => {
    if (stripScrollFrame.current !== null) return;
    stripScrollFrame.current = requestAnimationFrame(() => {
      stripScrollFrame.current = null;
      recomputeCenteredCell();
    });
  };

  const handleStripCellClick = (iso: string) => {
    setCenteredIso(iso);
    stripCellRefs.current.get(iso)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  // Re-anchor the strip on today whenever the week view becomes visible or the
  // plan selection changes — same "adaptive" behavior as the month view's own
  // anchor effect below (all-plans view by default, jumps to show that plan's
  // schedule first once one is selected). `today` is a dep because on first
  // load the strip only mounts AFTER the fetch resolves — without it the effect
  // runs once while the strip doesn't exist yet and never again, leaving the
  // strip parked on its leftmost cell (10 days before today) instead of today.
  useEffect(() => {
    if (calendarView !== "week" || !today) return;
    setCenteredIso(todayIso);
    stripCellRefs.current.get(todayIso)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [calendarView, selectedPlanId, todayIso, today]);

  // Switching plans resets both the viewed month and the day selection so the
  // month view always opens on the new plan's start month / current day — same
  // behavior as the Progress page's month calendar.
  useEffect(() => {
    setViewMonthKey(null);
    setSelectedDayIndex(null);
  }, [selectedPlanId]);

  const monthRange = planMonthRange(calendarPlan);
  // Opening the month view lands on TODAY's month (not the plan's start month),
  // so the yellow in-progress/current day is visible immediately. Falls back to
  // the plan's first month when today lies outside the plan's range.
  const todayMonthKey = `${todayIso.slice(0, 4)}-${todayIso.slice(5, 7)}`;
  const effectiveMonthKey =
    viewMonthKey ?? (todayMonthKey >= monthRange.min && todayMonthKey <= monthRange.max ? todayMonthKey : monthRange.min);
  const monthCells = buildMonthCalendar(calendarPlan, effectiveMonthKey);
  const monthLabel = (() => {
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  })();
  const prevMonthKey = (() => {
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const nextMonthKey = (() => {
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  })();
  const toggleNote = (exerciseId: string) => setExpandedNoteIds((current) => {
    const next = new Set(current);
    if (next.has(exerciseId)) next.delete(exerciseId); else next.add(exerciseId);
    return next;
  });
  const patientName = today?.patient.displayName ?? user?.displayName ?? user?.username ?? "Patient";
  const avatarInitials = today?.patient.avatarInitials ?? patientName.slice(0, 2).toUpperCase();
  const avatarUrl = useProfilePicture(token, today?.patient.profilePictureFileId ?? null);

  if (loading || error) return <section className="therapist-shell">
    <PatientSidebar activeLabel="Home" onNavigate={onNavigate} onLogout={onLogout} displayName={patientName} avatarInitials={avatarInitials} avatarUrl={avatarUrl} />
    <div className="therapist-workspace"><section className="today-main-panel exercise-panel" role={error ? "alert" : "status"}><p className="pd-empty-note">{loading ? "Loading your rehabilitation schedule…" : error}</p>{error && <button className="secondary-button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>}</section></div>
    <PatientBottomNav activeLabel="Home" onNavigate={onNavigate} />
  </section>;

  // Streak is per-plan; "All Plans" (or a plan with nothing pending) shows the
  // best streak among the visible plans rather than picking one arbitrarily.
  const streak = Math.max(0, ...visiblePlans.map((plan) => plan.today?.streak ?? 0));
  const avgScore = today?.stats.averageScore;
  const sessions = today?.stats.completedSessions ?? 0;

  return <section className="therapist-shell">
    <PatientSidebar activeLabel="Home" onNavigate={onNavigate} onLogout={onLogout} displayName={patientName} avatarInitials={avatarInitials} avatarUrl={avatarUrl} />
    <div className="therapist-workspace">
      <header className="pt-topbar">
        <div className="pt-identity">
          <span className={`avatar-badge pt-avatar${avatarUrl ? " with-photo" : ""}`}>
            {avatarUrl ? <img src={avatarUrl} alt={`${patientName}'s profile picture`} /> : avatarInitials}
          </span>
          <div><p className="pt-greeting">{timeOfDayGreeting()},</p><h1>{patientName}</h1></div>
        </div>
        <span className="streak-pill"><Flame size={15} /> {streak}-day streak</span>
      </header>
      <div className="today-grid">
        <div className="pt-hero-block">
          <section className="today-main-panel hero-progress-card">
            <div className="pt-hero-left">
              <ProgressRing value={completionPercent} label={`${completionPercent}%`} size={46} />
              <div className="pt-hero-copy"><strong>{completedCount}/{totalCount} Done</strong><span>Today's rehab session</span></div>
            </div>
            <button className="primary-button pt-continue-btn" onClick={() => onOpenInstruction(nextExercise)} disabled={!nextExercise}>
              {nextExercise ? "Continue" : totalCount > 0 ? "Complete" : "No exercises"} <Play size={13} fill="currentColor" />
            </button>
          </section>
          <div className="linear-progress" aria-hidden="true"><span style={{ width: `${completionPercent}%` }} /></div>
        </div>

        <section className="summary-card pt-calendar-card">
          {calendarView === "week" ? <>
            <div className="week-strip-heading"><p className="eyebrow">Upcoming</p><button type="button" className="text-action" onClick={() => setCalendarView("month")}>View month</button></div>
            <div className="week-strip" ref={weekStripRef} onScroll={handleStripScroll}>{stripCells.map((cell) => {
              const isCentered = cell.iso === centeredIso;
              return <button
                type="button"
                key={cell.key}
                ref={registerStripCellRef(cell.iso)}
                className={`week-strip-cell status-${cell.status}${isCentered ? " is-centered" : ""}${cell.isToday ? " is-today" : ""}`}
                aria-current={isCentered ? "date" : undefined}
                onClick={() => handleStripCellClick(cell.iso)}
              >
                <small>{cell.weekdayLabel}</small>
                <strong>{cell.dateNumber}</strong>
              </button>;
            })}</div>
            <div className="pd-legend week-strip-legend">
              <span><span className="pd-legend-dot status-completed" />Completed</span>
              <span><span className="pd-legend-dot status-in_progress" />In progress</span>
              <span><span className="pd-legend-dot status-missing" />Missed</span>
              <span><span className="pd-legend-dot status-pending" />Pending</span>
              <span><span className="pd-legend-dot status-none" />No exercise</span>
            </div>
          </> : <>
            <div className="pd-calendar-header">
              <button
                type="button"
                className="icon-button pd-calendar-nav"
                onClick={() => setViewMonthKey(prevMonthKey)}
                disabled={prevMonthKey < monthRange.min}
                aria-label="Previous month"
              >
                <ChevronLeft size={14} />
              </button>
              <strong>{monthLabel}</strong>
              <button
                type="button"
                className="icon-button pd-calendar-nav"
                onClick={() => setViewMonthKey(nextMonthKey)}
                disabled={nextMonthKey > monthRange.max}
                aria-label="Next month"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="pd-calendar-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={index}>{day}</span>)}</div>
            <div className="pd-calendar-grid">
              {monthCells.map((cell) => {
                const hasPlanDay = cell.dayIndex !== null && cell.status !== null;
                const className = [
                  "pd-calendar-cell",
                  hasPlanDay ? cell.status : "",
                  hasPlanDay && cell.otherMonth ? "adjacent" : "",
                  !hasPlanDay ? (cell.otherMonth ? "other" : cell.outside ? "outside" : "empty") : "",
                  cell.dayIndex !== null ? "clickable" : "",
                  cell.dayIndex !== null && cell.dayIndex === (selectedDayIndex ?? currentDayIndex(calendarPlan.days)) ? "selected" : ""
                ].join(" ").trim();
                return (
                  <button
                    key={cell.key}
                    type="button"
                    className={className}
                    title={
                      hasPlanDay
                        ? `${cell.iso} · ${heatmapLabels[cell.status!]}${cell.otherMonth ? " (next/prev month)" : ""}`
                        : cell.otherMonth
                          ? undefined
                          : `${cell.iso}${cell.outside ? " · No session scheduled" : ""}`
                    }
                    onClick={() => cell.dayIndex !== null && setSelectedDayIndex(cell.dayIndex)}
                  >
                    {cell.dateNumber ?? ""}
                  </button>
                );
              })}
            </div>
            <div className="pd-legend">
              {/* Same statuses as the strip's legend above so the two calendars
                  share one color scheme — except "cancelled", which the month
                  grid renders as gray "no exercise" (no striped red hatch). */}
              {(["completed", "in_progress", "skipped", "pending"] as HeatmapDayStatus[]).map((status) => (
                <span key={status}>
                  <span className={`pd-legend-dot ${status}`} />
                  {heatmapLabels[status]}
                </span>
              ))}
              <span>
                <span className="pd-legend-dot status-none" />
                No exercise
              </span>
            </div>
            <button type="button" className="text-action" onClick={() => setCalendarView("week")}>Back to week</button>
          </>}
        </section>

        <section className="today-main-panel exercise-panel">
          <div className="pt-exercises-heading"><h2>Today's Exercises</h2><span className="pt-count-badge">{totalCount}</span></div>
          {activePlans.length > 1 && (
            // Same dropdown switcher as the Progress page's (pp-plan-switcher):
            // a single full-width select instead of the old chip row that could
            // wrap/overflow on phones. "All Plans" stays the default and merges
            // every active plan's exercises into one list below.
            <select
              className="pp-plan-switcher"
              value={selectedPlanId}
              onChange={(event) => setSelectedPlanId(event.target.value)}
              aria-label="Select rehabilitation plan"
            >
              <option value="all">All Plans</option>
              {activePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          )}
          {allPlans.length === 0 ? <p className="pd-empty-note">You have no active or available schedule.</p> : totalCount === 0 ? <p className="pd-empty-note">No exercises are scheduled for this program day.</p> : <div className="exercise-list" aria-label="Today's exercises">{exerciseGroups.map((group) => <Fragment key={group.planId}>
            {showGroupLabels && <p className="pt-exercise-group-label">{group.planName}</p>}
            {group.exercises.map((exercise) => {
              const Icon = trackingIcon[exercise.movementTracking];
              const isDone = exercise.status === "completed";
              const noteExpanded = expandedNoteIds.has(exercise.id);
              return <button className="exercise-card" key={exercise.id} onClick={() => onOpenInstruction(exercise)} type="button">
                <span className={`exercise-icon ${isDone ? "done" : `tracking-${exercise.movementTracking}`}`} aria-hidden="true">{isDone ? <CheckCircle2 size={22} /> : <Icon size={22} />}</span>
                <span className="exercise-card-body">
                  <span className="exercise-card-title-row">
                    {/* Exercise name only — version ("v1") removed for a cleaner
                        mobile row; long names truncate with an ellipsis (see
                        .exercise-card-title-row strong). */}
                    <strong>{exercise.exerciseName}</strong>
                    {exercise.therapistInstruction && <span
                      className="exercise-note-icon-btn"
                      role="button"
                      tabIndex={0}
                      aria-label={noteExpanded ? "Hide therapist note" : "Show therapist note"}
                      onClick={(event) => { event.stopPropagation(); toggleNote(exercise.id); }}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); event.preventDefault(); toggleNote(exercise.id); } }}
                    ><MessageSquare size={13} /></span>}
                  </span>
                  <small>
                    {exercise.targetValueLabel}
                    {/* Difficulty tag right after the reps/target text — driven by
                        the exercise's real difficultyLevel from
                        GET /patients/:id/today, no hardcoded values. */}
                    {exercise.difficultyLevel && (
                      <span className={`difficulty-badge exercise-difficulty ${exerciseDifficultyClass[exercise.difficultyLevel]}`}>
                        {exerciseDifficultyLabel[exercise.difficultyLevel]}
                      </span>
                    )}
                  </small>
                  {exercise.therapistInstruction && noteExpanded && <small className="exercise-note-text">{exercise.therapistInstruction}</small>}
                </span>
                {/* Rounded-square completion checkbox (not a radio/selection
                    control): green tick when done, neutral empty square
                    otherwise — driven by the same session status as the rest of
                    the row. */}
                <span className={`exercise-status-checkbox${isDone ? " done" : ""}`} aria-hidden="true">
                  {isDone && <Check size={14} strokeWidth={3} />}
                </span>
              </button>;
            })}
          </Fragment>)}</div>}
        </section>

        <div className="pt-stats-grid">
          <div className="summary-card pt-stat-card">
            <span className="pt-stat-icon avg"><Heart size={18} /></span>
            <div className="pt-stat-body"><span className="pt-stat-label">Avg Score</span><strong>{avgScore ?? "—"}{avgScore !== null && avgScore !== undefined ? "%" : ""} <TrendingUp size={14} className="pt-stat-trend" /></strong></div>
          </div>
          <div className="summary-card pt-stat-card">
            <span className="pt-stat-icon sessions"><CalendarCheck size={18} /></span>
            <div className="pt-stat-body"><span className="pt-stat-label">Sessions</span><strong>{sessions} <small>this mo.</small></strong></div>
          </div>
        </div>
      </div>
    </div>
    <PatientBottomNav activeLabel="Home" onNavigate={onNavigate} />
  </section>;
}

export function ProgressRing({ value, label, tone = "normal", size = 76 }: { value: number; label: string; tone?: "normal" | "light"; size?: number }) {
  const strokeWidth = size <= 56 ? 5 : 7;
  const radius = size / 2 - strokeWidth * 1.3;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  const center = size / 2;
  return <span className={`progress-ring ${tone}`}><svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true"><circle cx={center} cy={center} r={radius} style={{ strokeWidth }} /><circle cx={center} cy={center} r={radius} strokeDasharray={`${dash} ${circumference}`} style={{ strokeWidth }} /></svg><strong style={size <= 56 ? { fontSize: "0.6rem" } : undefined}>{label}</strong></span>;
}
