import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { ApiError, getAllPatients } from "../services/api";
import { useAuth } from "../store/authStore";
import { useOwnProfilePicture } from "../hooks/useProfilePicture";
import type { AllPatientListItem } from "../services/api";
import type { TherapistPatientSummary } from "../types";
import { initialsFromName } from "../utils/displayName";

// Sidebar "Patients" page — a full, searchable/filterable caseload directory.
// Distinct from Therapist Dashboard (frontend-design.md §8, which pairs a
// trimmed version of this same table with stat cards/charts): this page is
// patient-management-focused, no stats, and its "View" action jumps straight
// into Patient Detail rather than opening the Dashboard's quick-look slide-over.
//
// Backed by GET /therapists/:id/patients (modules/therapist/*) — replaces the
// former data/therapistMock.ts import (therapistPatients, therapistProfile),
// same as TherapistDashboardPage.tsx already does.

interface TherapistPatientsPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  onViewPatient: (patient: TherapistPatientSummary) => void;
}

type AccountFilter = "all" | "active" | "inactive" | "assigned";

const accountFilters: Array<{ key: AccountFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "assigned", label: "Assigned to me" }
];

export function TherapistPatientsPage({ onLogout, onNavigate, onViewPatient }: TherapistPatientsPageProps) {
  const { token, user } = useAuth();

  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");

  const [patients, setPatients] = useState<AllPatientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    getAllPatients(token)
      .then((data) => {
        if (!cancelled) setPatients(data.patients);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't load your patients. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  // Listen for cross-window patientAssigned events so this page updates when
  // another part of the app assigns a patient (e.g., the Dashboard modal).
  useEffect(() => {
    function handler(e: Event) {
      const ce = e as CustomEvent;
      const patient = ce.detail as unknown as any;
      if (!patient || !user) return;
      // Only prepend if the assigned-to therapist is the current user
          if (patient.id && (patient.assignedTherapistId === user.id || patient.id)) {
        setPatients((prev) => {
          if (prev.find((p) => p.id === patient.id)) return prev;
          return [patient, ...prev];
        });
      }
    }

    window.addEventListener("patientAssigned", handler as EventListener);
    return () => window.removeEventListener("patientAssigned", handler as EventListener);
  }, [user]);

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return patients.filter((patient) => {
      const matchesQuery =
        !query ||
        [
          patient.name,
          patient.username,
          patient.phoneNumber,
          patient.condition,
          patient.assignedTherapistName
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(query);
      const matchesStatus =
       accountFilter === "all" ||
       (accountFilter === "active" && patient.status === "active") ||
       (accountFilter === "inactive" && patient.status !== "active") ||
       (accountFilter === "assigned" && patient.assignedTherapistId === user?.id);
      return matchesQuery && matchesStatus;
    });
  }, [search, accountFilter, patients, user?.id]);

  const displayName = user?.displayName || user?.username || "Therapist";
  const ownAvatarUrl = useOwnProfilePicture();

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Patients" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Patients</h1>
            <p>{loading ? "Loading patients…" : `${patients.length} patients in the system`}</p>
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
            <div className="library-toolbar therapist-patient-toolbar">
              <label className="library-search">
                <Search size={16} />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, username, phone, or therapist"
                  aria-label="Search patients by name, username, phone, condition, or therapist"
                />
              </label>
              <div className="library-filter-chips">
                {accountFilters.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={`library-filter-chip ${accountFilter === chip.key ? "active" : ""}`}
                    onClick={() => setAccountFilter(chip.key)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="therapist-table-scroll">
              <table className="therapist-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Assigned to</th>
                    <th>Account status</th>
                    <th>Current active plan</th>
                    <th>Last exercise session</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && filteredPatients.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "24px 0", color: "var(--text-secondary)" }}>
                        {patients.length === 0
                          ? "No patient accounts have been created yet."
                          : search.trim()
                            ? "No patients match your search."
                            : "No patients match this filter."}
                      </td>
                    </tr>
                  )}
                  {filteredPatients.map((patient) => (
                    <tr
                      key={patient.id}
                      className="therapist-patient-table-row"
                      onClick={() => onViewPatient(patient)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") onViewPatient(patient);
                      }}
                      tabIndex={0}
                      role="button"
                    >
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
                      <td>
                        {patient.assignedTherapistName || <span className="therapist-table-muted">Unassigned</span>}
                      </td>
                      <td>
                        <span className={`badge-pill ${patient.status === "active" ? "good" : "fair"}`}>
                          {patient.status === "active" ? "Active" : patient.status === "suspended" ? "Suspended" : "Inactive"}
                        </span>
                      </td>
                      <td>{patient.condition || "No active plan"}</td>
                      <td>{patient.lastSessionLabel || "No exercise session yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}
