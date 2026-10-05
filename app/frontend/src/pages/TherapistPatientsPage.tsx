import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { ApiError, getAllPatients } from "../services/api";
import { useAuth } from "../store/authStore";
import { useOwnProfilePicture, useProfilePicture } from "../hooks/useProfilePicture";
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

// Per-row avatar: hooks can't be called inside the table's .map(), so each row
// delegates to this tiny component — it resolves the patient's
// profilePictureFileId to a blob object URL (auth'd GET /files/:id/content via
// useProfilePicture) and renders the photo over the initials circle, falling
// back to the initials badge when there's no picture on file or it fails to load.
function PatientAvatar({ patient }: { patient: AllPatientListItem }) {
  const { token } = useAuth();
  const photoUrl = useProfilePicture(token, patient.profilePictureFileId ?? null);
  return (
    <span className={`therapist-avatar${photoUrl ? " with-photo" : ""}`}>
      {photoUrl ? <img src={photoUrl} alt={`${patient.name}'s profile picture`} /> : patient.avatarInitials}
    </span>
  );
}

const accountFilters: Array<{ key: AccountFilter; label: string }> = [
  { key: "all", label: "ทั้งหมด" },
  { key: "active", label: "ใช้งาน" },
  { key: "inactive", label: "ไม่ใช้งาน" },
  { key: "assigned", label: "ที่ฉันดูแล" }
];

const conditionLabels: Record<string, string> = {
  "Ischemic Stroke": "โรคหลอดเลือดสมองชนิดขาดเลือด",
  "Hemorrhagic Stroke": "โรคหลอดเลือดสมองชนิดเลือดออก",
  "TIA Recovery": "ฟื้นฟูภาวะสมองขาดเลือดชั่วคราว",
  "Post-Stroke": "ฟื้นฟูหลังโรคหลอดเลือดสมอง"
};

function conditionLabel(condition: string): string {
  return conditionLabels[condition] ?? condition;
}

function sessionDateLabel(label: string): string {
  const labels: Record<string, string> = {
    Today: "วันนี้",
    Yesterday: "เมื่อวาน",
    "3 days ago": "3 วันที่แล้ว",
    "1 week ago": "1 สัปดาห์ที่แล้ว",
    "No exercise session yet": "ยังไม่มีประวัติการฝึก"
  };
  return labels[label] ?? label;
}

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
          setError(err instanceof ApiError ? err.message : "โหลดรายชื่อผู้ป่วยไม่สำเร็จ กรุณาลองอีกครั้ง");
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

  const displayName = user?.displayName || user?.username || "นักกายภาพบำบัด";
  const ownAvatarUrl = useOwnProfilePicture();

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Patients" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>ผู้ป่วย</h1>
            <p>{loading ? "กำลังโหลดรายชื่อผู้ป่วย…" : `ผู้ป่วยในระบบ ${patients.length} ราย`}</p>
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

          <div className="summary-card therapist-patient-card">
            <div className="library-toolbar therapist-patient-toolbar">
              <label className="library-search">
                <Search size={16} />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ค้นหาชื่อ ชื่อผู้ใช้ เบอร์โทร หรือผู้ดูแล"
                  aria-label="ค้นหาผู้ป่วยด้วยชื่อ ชื่อผู้ใช้ เบอร์โทร ภาวะ หรือผู้ดูแล"
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
                    <th>ผู้ป่วย</th>
                    <th>ผู้ดูแล</th>
                    <th>สถานะบัญชี</th>
                    <th>แผนฟื้นฟูที่ใช้งานอยู่</th>
                    <th>การฝึกล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && filteredPatients.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "24px 0", color: "var(--text-secondary)" }}>
                        {patients.length === 0
                          ? "ยังไม่มีบัญชีผู้ป่วยในระบบ"
                          : search.trim()
                            ? "ไม่พบผู้ป่วยที่ตรงกับคำค้นหา"
                            : "ไม่พบผู้ป่วยที่ตรงกับตัวกรองนี้"}
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
                          <PatientAvatar patient={patient} />
                          <div>
                            <strong>{patient.name}</strong>
                            <small>
                              อายุ {patient.age} ปี · ฝึกแล้ว {patient.sessionsCompleted} ครั้ง
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {patient.assignedTherapistName || <span className="therapist-table-muted">ยังไม่มีผู้ดูแล</span>}
                      </td>
                      <td>
                        <span className={`badge-pill ${patient.status === "active" ? "good" : "fair"}`}>
                          {patient.status === "active" ? "ใช้งาน" : patient.status === "suspended" ? "ระงับ" : "ไม่ใช้งาน"}
                        </span>
                      </td>
                      <td>{patient.condition ? conditionLabel(patient.condition) : "ไม่มีแผนฟื้นฟูที่ใช้งานอยู่"}</td>
                      <td>{sessionDateLabel(patient.lastSessionLabel || "No exercise session yet")}</td>
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
