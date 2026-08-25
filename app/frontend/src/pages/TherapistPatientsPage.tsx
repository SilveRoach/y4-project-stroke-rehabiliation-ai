import { Eye, Search, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { therapistPatients, therapistProfile } from "../data/therapistMock";
import type { TherapistPatientSummary } from "../types";

// Sidebar "Patients" page — a full, searchable/filterable caseload directory.
// Distinct from Therapist Dashboard (frontend-design.md §8, which pairs a
// trimmed version of this same table with stat cards/charts): this page is
// patient-management-focused, no stats, and its "View" action jumps straight
// into Patient Detail rather than opening the Dashboard's quick-look slide-over.

interface TherapistPatientsPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  onViewPatient: (patient: TherapistPatientSummary) => void;
}

type StandingFilter = "all" | "active" | "at_risk";

const standingFilters: Array<{ key: StandingFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "at_risk", label: "At risk" }
];

function complianceTone(percent: number): "good" | "fair" | "poor" {
  if (percent >= 80) return "good";
  if (percent >= 60) return "fair";
  return "poor";
}

export function TherapistPatientsPage({ onLogout, onNavigate, onViewPatient }: TherapistPatientsPageProps) {
  const [search, setSearch] = useState("");
  const [standingFilter, setStandingFilter] = useState<StandingFilter>("all");

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return therapistPatients.filter((patient) => {
      const matchesQuery =
        !query || patient.name.toLowerCase().includes(query) || patient.condition.toLowerCase().includes(query);
      const matchesStanding = standingFilter === "all" || patient.standing === standingFilter;
      return matchesQuery && matchesStanding;
    });
  }, [search, standingFilter]);

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Patients" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Patients</h1>
            <p>{therapistPatients.length} patients on your caseload</p>
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
              <div className="library-filter-chips">
                {standingFilters.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={`library-filter-chip ${standingFilter === chip.key ? "active" : ""}`}
                    onClick={() => setStandingFilter(chip.key)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <div className="therapist-patient-toolbar-actions">
                <div className="therapist-search">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search patients…"
                    aria-label="Search patients"
                  />
                </div>
                {/* Stub: no patient-creation endpoint exists yet — kept as a visible
                    but inert affordance matching the Dashboard's identical button. */}
                <button type="button" className="primary-button therapist-add-patient" disabled title="Add patient not wired up yet">
                  <UserPlus size={14} /> Add Patient
                </button>
              </div>
            </div>

            <div className="therapist-table-scroll">
              <table className="therapist-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Condition</th>
                    <th>Last Session</th>
                    <th>Compliance</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filteredPatients.map((patient) => (
                    <tr key={patient.id}>
                      <td>
                        <div className="therapist-table-patient">
                          <span className="therapist-avatar">{patient.avatarInitials}</span>
                          <div>
                            <strong>{patient.name}</strong>
                            <small>
                              Age {patient.age} · {patient.sessionsCompleted} sessions
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>{patient.condition}</td>
                      <td>{patient.lastSessionLabel}</td>
                      <td>
                        <div className="therapist-compliance-bar">
                          <span className="therapist-compliance-track">
                            <span
                              className={`therapist-compliance-fill ${complianceTone(patient.compliancePercent)}`}
                              style={{ width: `${patient.compliancePercent}%` }}
                            />
                          </span>
                          <span className="therapist-compliance-value">{patient.compliancePercent}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge-pill ${patient.standing === "active" ? "good" : "fair"}`}>
                          {patient.standing === "active" ? "Active" : "At Risk"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary-button therapist-view-button"
                          onClick={() => onViewPatient(patient)}
                        >
                          <Eye size={13} /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredPatients.length === 0 && <p className="pd-empty-note ts-table-empty">No patients match your search.</p>}
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}
