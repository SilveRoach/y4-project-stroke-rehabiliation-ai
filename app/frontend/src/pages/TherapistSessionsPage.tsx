import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { useOwnProfilePicture } from "../hooks/useProfilePicture";
import { ApiError, getTherapistExerciseSessions } from "../services/api";
import { useAuth } from "../store/authStore";
import type { EvaluationSource, TherapistExerciseSessionEntry } from "../types";
import { initialsFromName } from "../utils/displayName";

interface TherapistSessionsPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  onReviewSession: (session: TherapistExerciseSessionEntry) => void;
}

type SourceFilter = "all" | EvaluationSource;

interface ViewedMonth {
  year: number;
  month: number;
}

interface CalendarCell {
  key: string;
  dateNumber: number | null;
  dateIso: string | null;
}

const filterOptions: Array<{ key: SourceFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "ai", label: "AI-scored" },
  { key: "pt_reviewed", label: "Therapist-reviewed" }
];

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonthCells(viewed: ViewedMonth): CalendarCell[] {
  const firstOfMonth = new Date(viewed.year, viewed.month, 1);
  const daysInMonth = new Date(viewed.year, viewed.month + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  for (let index = 0; index < firstOfMonth.getDay(); index += 1) {
    cells.push({ key: `lead-${index}`, dateNumber: null, dateIso: null });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      key: `day-${day}`,
      dateNumber: day,
      dateIso: `${viewed.year}-${String(viewed.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, dateNumber: null, dateIso: null });
  }
  return cells;
}

function monthLabel(viewed: ViewedMonth): string {
  return new Date(viewed.year, viewed.month, 1).toLocaleDateString("th-TH-u-ca-gregory", {
    month: "long",
    year: "numeric"
  });
}

function formatSessionTime(completedAtIso: string): string {
  return new Date(completedAtIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function TherapistSessionsPage({ onLogout, onNavigate, onReviewSession }: TherapistSessionsPageProps) {
  const { token, user } = useAuth();
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [sessions, setSessions] = useState<TherapistExerciseSessionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = new Date();
  const [selectedDateIso, setSelectedDateIso] = useState(() => localIsoDate(today));
  const [viewedMonth, setViewedMonth] = useState<ViewedMonth>(() => ({
    year: today.getFullYear(),
    month: today.getMonth()
  }));

  useEffect(() => {
    if (!token || !user) {
      setLoading(false);
      setError("Please sign in again to view your session results.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTherapistExerciseSessions(token, user.id)
      .then((data) => {
        if (cancelled) return;
        setSessions(data.sessions);
        if (data.sessions.length > 0 && !data.sessions.some((session) => session.dateIso === selectedDateIso)) {
          const newestDate = data.sessions[0].dateIso;
          setSelectedDateIso(newestDate);
          const [year, month] = newestDate.split("-").map(Number);
          setViewedMonth({ year, month: month - 1 });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't load your session results. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const datesWithSessions = useMemo(() => new Set(sessions.map((session) => session.dateIso)), [sessions]);
  const datesNeedingReview = useMemo(
    () => new Set(sessions.filter((session) => !session.reviewed).map((session) => session.dateIso)),
    [sessions]
  );
  const calendarCells = useMemo(() => getMonthCells(viewedMonth), [viewedMonth]);
  const visibleSessions = useMemo(
    () => sessions.filter((session) =>
      session.dateIso === selectedDateIso &&
      (filter === "all" || session.currentScoreSource === filter)
    ),
    [sessions, selectedDateIso, filter]
  );

  const changeMonth = (delta: -1 | 1) => {
    const total = viewedMonth.year * 12 + viewedMonth.month + delta;
    const next = { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
    setViewedMonth(next);
    setSelectedDateIso(`${next.year}-${String(next.month + 1).padStart(2, "0")}-01`);
  };

  const displayName = user?.displayName || user?.username || "Therapist";
  const ownAvatarUrl = useOwnProfilePicture();

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Sessions" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Sessions</h1>
            <p>Review submitted exercise results across your assigned patients</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{displayName}</strong>
                <small>Physical Therapist</small>
              </div>
              <span className={`avatar-badge${ownAvatarUrl ? " with-photo" : ""}`}>
                {ownAvatarUrl ? <img src={ownAvatarUrl} alt={`${displayName}'s profile picture`} /> : initialsFromName(displayName)}
              </span>
            </div>
          </div>
        </header>

        <main className="therapist-main">
          {error && (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", marginBottom: 16 }}>
              <p style={{ margin: 0 }}>{error}</p>
            </div>
          )}

          <div className="pp-history-layout therapist-session-calendar-layout">
            <div className="summary-card pd-calendar-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>Session calendar</strong>
                  <p>Dates with submitted exercise results</p>
                </div>
              </div>

              <div className="pp-calendar-month-nav">
                <button type="button" className="icon-button" onClick={() => changeMonth(-1)} aria-label="Previous month">
                  <ChevronLeft size={16} />
                </button>
                <strong>{monthLabel(viewedMonth)}</strong>
                <button type="button" className="icon-button" onClick={() => changeMonth(1)} aria-label="Next month">
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="pd-calendar-weekdays">
                {["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."].map((day, index) => <span key={index}>{day}</span>)}
              </div>
              <div className="pd-calendar-grid">
                {calendarCells.map((cell) => {
                  const hasSessions = cell.dateIso !== null && datesWithSessions.has(cell.dateIso);
                  const needsReview = cell.dateIso !== null && datesNeedingReview.has(cell.dateIso);
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      className={`pd-calendar-cell ${cell.dateNumber === null ? "blank" : needsReview ? "needs_review" : hasSessions ? "completed" : "no_plan"} ${
                        cell.dateIso === selectedDateIso ? "selected" : ""
                      }`}
                      disabled={cell.dateIso === null}
                      aria-pressed={cell.dateIso === selectedDateIso}
                      aria-label={cell.dateIso
                        ? `${cell.dateIso}${needsReview ? ", sessions need therapist review" : hasSessions ? ", all sessions reviewed" : ""}`
                        : undefined}
                      onClick={() => cell.dateIso && setSelectedDateIso(cell.dateIso)}
                    >
                      {cell.dateNumber ?? ""}
                    </button>
                  );
                })}
              </div>
              <div className="pd-legend">
                <span><span className="pd-legend-dot needs_review" />Needs review</span>
                <span><span className="pd-legend-dot completed" />Reviewed sessions</span>
                <span><span className="pd-legend-dot no_plan" />No sessions</span>
              </div>
            </div>

            <div className="summary-card pp-history-panel">
              <div className="therapist-chart-heading therapist-session-list-heading">
                <div>
                  <strong>Exercise results</strong>
                  <p>{new Date(`${selectedDateIso}T00:00:00`).toLocaleDateString()}</p>
                </div>
                <div className="library-filter-chips">
                  {filterOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`library-filter-chip ${filter === option.key ? "active" : ""}`}
                      onClick={() => setFilter(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pd-session-list">
                {!loading && visibleSessions.length > 0 && (
                  <div className="ts-session-list-header" aria-hidden="true">
                    <span>Patient / exercise</span>
                    <span>Score</span>
                    <span>Source</span>
                    <span>Review</span>
                    <span>Action</span>
                  </div>
                )}
                {loading ? (
                  <p className="pd-empty-note" role="status">Loading session results…</p>
                ) : visibleSessions.length === 0 ? (
                  <p className="pd-empty-note">
                    {sessions.some((session) => session.dateIso === selectedDateIso)
                      ? "No sessions match this score-source filter."
                      : "No submitted exercise sessions for this date."}
                  </p>
                ) : visibleSessions.map((session) => (
                  <div
                    key={session.performanceResultId}
                    className="pd-session-row ts-session-row-clickable"
                    role="button"
                    tabIndex={0}
                    aria-label={`Review ${session.exerciseName} for ${session.patientName}, submitted at ${formatSessionTime(session.completedAtIso)}`}
                    onClick={() => onReviewSession(session)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onReviewSession(session);
                      }
                    }}
                  >
                    <div className="ts-session-patient">
                      <span className="therapist-avatar">{session.patientAvatarInitials}</span>
                      <div>
                        <span>{session.patientName}</span>
                        <small>
                          <span className="ts-session-exercise-name" title={session.exerciseName}>
                            {session.exerciseName}
                          </span>
                          <span className="ts-session-time">· {formatSessionTime(session.completedAtIso)}</span>
                        </small>
                      </div>
                    </div>
                    <span className="pd-session-score">
                      Score: {session.currentScore ?? "—"}
                    </span>
                    <span className={`pd-session-source ${session.currentScoreSource ?? ""}`}>
                      {session.currentScoreSource
                        ? session.currentScoreSource === "ai" ? "AI" : "Therapist"
                        : "—"}
                    </span>
                    <span className={`badge-pill ${session.reviewed ? "good" : "fair"}`}>
                      {session.reviewed ? "Reviewed" : "Not reviewed"}
                    </span>
                    <span className="text-action">Review <ChevronRight size={12} /></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}
