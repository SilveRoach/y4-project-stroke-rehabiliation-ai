import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { ApiError, getTherapistSessions } from "../services/api";
import { useAuth } from "../store/authStore";
import { useOwnProfilePicture } from "../hooks/useProfilePicture";
import type { EvaluationSource, TherapistSessionLogEntry } from "../types";
import { initialsFromName } from "../utils/displayName";

// Sidebar "Sessions" page — a cross-patient session log, filterable by evaluation
// source (§2.7's ai_score/pt_score split). Rows are clickable and open the
// Session Result Review view for that session (App.tsx's openSessionReview),
// same action as Patient Detail's session history.
//
// Backed by GET /therapists/:id/sessions (modules/session-results/*) — replaces
// the former data/therapistSessionsMock.ts import (therapistSessionLog) and
// data/therapistMock.ts's therapistProfile, same "wire it to the real backend"
// pass already done for TherapistDashboardPage.tsx / TherapistPatientsPage.tsx /
// TherapistSettingsPage.tsx. See session.service.ts's own comments for the
// schema gaps this works around (no dedicated training_sessions table — "session"
// here means one rehabilitation_schedule_days row — and the evaluationSource
// ai/pt/manual -> ai/pt_reviewed mapping).

interface TherapistSessionsPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  // Opens the Session Result Review view for a clicked log entry.
  onReviewSession: (session: TherapistSessionLogEntry) => void;
}

type SourceFilter = "all" | EvaluationSource;

const filterOptions: Array<{ key: SourceFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "ai", label: "AI-scored" },
  { key: "pt_reviewed", label: "PT-reviewed" }
];

export function TherapistSessionsPage({ onLogout, onNavigate, onReviewSession }: TherapistSessionsPageProps) {
  const { token, user } = useAuth();

  const [filter, setFilter] = useState<SourceFilter>("all");

  const [sessions, setSessions] = useState<TherapistSessionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    getTherapistSessions(token, user.id)
      .then((data) => {
        if (!cancelled) setSessions(data.sessions);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't load your session log. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const visibleSessions = sessions.filter((session) => filter === "all" || session.evaluationSource === filter);

  const displayName = user?.displayName || user?.username || "Therapist";
  const ownAvatarUrl = useOwnProfilePicture();

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Sessions" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Sessions</h1>
            <p>Recent training sessions across your caseload</p>
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

          <div className="summary-card therapist-patient-card">
            <div className="therapist-patient-toolbar">
              <strong>Session log</strong>
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
              {loading ? (
                <p className="pd-empty-note">Loading…</p>
              ) : (
                <>
                  {visibleSessions.map((session) => (
                    <div
                      key={session.id}
                      className="pd-session-row ts-session-row-clickable"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open session review for ${session.patientName}, ${session.dateLabel}`}
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
                            {session.dateLabel} &middot; {session.dayLabel}
                          </small>
                        </div>
                      </div>
                      <div className="pd-session-actions">
                        {session.outcome === "skipped" ? (
                          <span className="pd-session-skipped">Skipped</span>
                        ) : (
                          <span className="pd-session-score">Avg {session.avgScore}</span>
                        )}
                        {session.evaluationSource && (
                          <span className={`pd-session-source ${session.evaluationSource}`}>
                            {session.evaluationSource === "ai" ? "AI-scored" : "PT-reviewed"}
                          </span>
                        )}
                        <span className="text-action">
                          Review <ChevronRight size={12} />
                        </span>
                      </div>
                    </div>
                  ))}
                  {visibleSessions.length === 0 && (
                    <p className="pd-empty-note">
                      {sessions.length === 0 ? "No sessions logged yet for your caseload." : "No sessions match this filter."}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}
