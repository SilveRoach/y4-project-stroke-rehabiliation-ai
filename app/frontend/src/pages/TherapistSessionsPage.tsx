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
  { key: "all", label: "ทั้งหมด" },
  { key: "ai", label: "ประเมินด้วย AI" },
  { key: "pt_reviewed", label: "นักกายภาพบำบัดตรวจแล้ว" }
];

const SESSION_DATE_FORMATTER = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "long",
  year: "numeric"
});

const SESSION_TIME_FORMATTER = new Intl.DateTimeFormat("th-TH", {
  hour: "numeric",
  minute: "2-digit"
});

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
  return SESSION_TIME_FORMATTER.format(new Date(completedAtIso));
}

function formatCalendarDate(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  return SESSION_DATE_FORMATTER.format(new Date(year, month - 1, day));
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
      setError("กรุณาเข้าสู่ระบบอีกครั้งเพื่อดูผลการฝึก");
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
          setError(err instanceof ApiError ? err.message : "โหลดผลการฝึกไม่สำเร็จ กรุณาลองอีกครั้ง");
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

  const displayName = user?.displayName || user?.username || "นักกายภาพบำบัด";
  const ownAvatarUrl = useOwnProfilePicture();

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Sessions" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>การฝึก</h1>
            <p>ตรวจสอบผลการฝึกที่ส่งมาจากผู้ป่วยที่คุณดูแล</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{displayName}</strong>
                <small>นักกายภาพบำบัด</small>
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
                  <strong>ปฏิทินการฝึก</strong>
                  <p>วันที่มีการส่งผลการฝึก</p>
                </div>
              </div>

              <div className="pp-calendar-month-nav">
                <button type="button" className="icon-button" onClick={() => changeMonth(-1)} aria-label="เดือนก่อนหน้า">
                  <ChevronLeft size={16} />
                </button>
                <strong>{monthLabel(viewedMonth)}</strong>
                <button type="button" className="icon-button" onClick={() => changeMonth(1)} aria-label="เดือนถัดไป">
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
                        ? `${formatCalendarDate(cell.dateIso)}${needsReview ? " มีผลการฝึกที่รอตรวจสอบ" : hasSessions ? " ตรวจสอบผลการฝึกแล้ว" : " ไม่มีผลการฝึก"}`
                        : undefined}
                      onClick={() => cell.dateIso && setSelectedDateIso(cell.dateIso)}
                    >
                      {cell.dateNumber ?? ""}
                    </button>
                  );
                })}
              </div>
              <div className="pd-legend">
                <span><span className="pd-legend-dot needs_review" />รอตรวจสอบ</span>
                <span><span className="pd-legend-dot completed" />ตรวจสอบแล้ว</span>
                <span><span className="pd-legend-dot no_plan" />ไม่มีผลการฝึก</span>
              </div>
            </div>

            <div className="summary-card pp-history-panel">
              <div className="therapist-chart-heading therapist-session-list-heading">
                <div>
                  <strong>ผลการฝึก</strong>
                  <p>{formatCalendarDate(selectedDateIso)}</p>
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
                    <span>ผู้ป่วย / ท่าบริหาร</span>
                    <span>คะแนน</span>
                    <span>แหล่งที่มา</span>
                    <span>การตรวจสอบ</span>
                    <span>การดำเนินการ</span>
                  </div>
                )}
                {loading ? (
                  <p className="pd-empty-note" role="status">กำลังโหลดผลการฝึก…</p>
                ) : visibleSessions.length === 0 ? (
                  <p className="pd-empty-note">
                    {sessions.some((session) => session.dateIso === selectedDateIso)
                      ? "ไม่มีผลการฝึกที่ตรงกับตัวกรองแหล่งคะแนนนี้"
                      : "ไม่มีการส่งผลการฝึกในวันนี้"}
                  </p>
                ) : visibleSessions.map((session) => (
                  <div
                    key={session.performanceResultId}
                    className="pd-session-row ts-session-row-clickable"
                    role="button"
                    tabIndex={0}
                    aria-label={`ตรวจสอบ${session.exerciseName}ของ${session.patientName} ส่งเมื่อเวลา ${formatSessionTime(session.completedAtIso)}`}
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
                      คะแนน: {session.currentScore ?? "—"}
                    </span>
                    <span className={`pd-session-source ${session.currentScoreSource ?? ""}`}>
                      {session.currentScoreSource
                        ? session.currentScoreSource === "ai" ? "AI" : "นักกายภาพบำบัด"
                        : "—"}
                    </span>
                    <span className={`badge-pill ${session.reviewed ? "good" : "fair"}`}>
                      {session.reviewed ? "ตรวจสอบแล้ว" : "รอตรวจสอบ"}
                    </span>
                    <span className="text-action">ตรวจสอบ <ChevronRight size={12} /></span>
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
