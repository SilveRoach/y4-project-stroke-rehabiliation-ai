import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { therapistProfile } from "../data/therapistMock";
import { therapistSessionLog } from "../data/therapistSessionsMock";
import type { EvaluationSource } from "../types";

// Sidebar "Sessions" page — a cross-patient session log, filterable by evaluation
// source (§2.7's ai_score/pt_score split). The per-entry "Review" action is the
// same stub as Patient Detail's session history: Session Result Review
// (UI_MOCKUP_PLAN_NEWDB.md §2.7) exists only as a static mockup
// (session-result-review.html) so far, not a real React page yet.

interface TherapistSessionsPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
}

type SourceFilter = "all" | EvaluationSource;

const filterOptions: Array<{ key: SourceFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "ai", label: "AI-scored" },
  { key: "pt_reviewed", label: "PT-reviewed" }
];

export function TherapistSessionsPage({ onLogout, onNavigate }: TherapistSessionsPageProps) {
  const [filter, setFilter] = useState<SourceFilter>("all");

  const visibleSessions = therapistSessionLog.filter(
    (session) => filter === "all" || session.evaluationSource === filter
  );

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
                <strong>{therapistProfile.displayName}</strong>
                <small>{therapistProfile.title}</small>
              </div>
              <span className="avatar-badge">{therapistProfile.initials}</span>
            </div>
          </div>
        </header>

        <main className="therapist-main">
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
              {visibleSessions.map((session) => (
                <div key={session.id} className="pd-session-row">
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
                    <span className="text-action pd-stub-link" title="Session Result Review page not built yet">
                      Review <ChevronRight size={12} />
                    </span>
                  </div>
                </div>
              ))}
              {visibleSessions.length === 0 && <p className="pd-empty-note">No sessions match this filter.</p>}
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}
