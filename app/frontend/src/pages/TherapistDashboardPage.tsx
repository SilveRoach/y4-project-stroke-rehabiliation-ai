import {
  Activity,
  Bell,
  Clock,
  Search,
  TrendingUp,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TherapistSidebar } from "../components/TherapistSidebar";
import AssignPatientModal from "../components/AssignPatientModal";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import {
  ApiError,
  getPatientProgressTrend,
  getTherapistDashboard,
  type TherapistDashboardData
} from "../services/api";
import { useAuth } from "../store/authStore";
import { useProfilePicture, useOwnProfilePicture } from "../hooks/useProfilePicture";
import type { PatientProgressTrend, TherapistPatientSummary } from "../types";
import { initialsFromName } from "../utils/displayName";

interface TherapistDashboardPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  onViewPatient: (patient: TherapistPatientSummary) => void;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric" });

// One patient-table avatar: resolves the row's profilePictureFileId to a blob
// object URL via the shared useProfilePicture hook (the file lives behind the
// auth'd GET /files/:id/content endpoint, so an <img src> can't point at it
// directly). A hook can't be called per-row in the table's map callback, hence
// this small wrapper — same pattern as AdminUserManagementPage's UserAvatar:
// photo when resolved, initials badge otherwise (no file / loading / failed).
function PatientAvatar({ token, fileId, name }: { token: string | null | undefined; fileId?: string | null; name: string }) {
  const avatarUrl = useProfilePicture(token, fileId ?? null);
  return (
    <span className={`therapist-avatar${avatarUrl ? " with-photo" : ""}`}>
      {avatarUrl ? <img src={avatarUrl} alt={`${name}'s profile picture`} /> : initialsFromName(name)}
    </span>
  );
}

export function TherapistDashboardPage({ onLogout, onNavigate, onViewPatient }: TherapistDashboardPageProps) {
  const { token, user } = useAuth();

  const [search, setSearch] = useState("");
  const [assignModalOpen, setAssignModalOpen] = useState(false);

  // Real dashboard data (modules/therapist/* on the backend) — replaces the
  // former data/therapistMock.ts imports (therapistPatients, weeklySessionData,
  // therapistProfile). Loaded once on mount / whenever the logged-in therapist
  // changes; there's no polling or refetch-on-focus yet, so switching to another
  // tab and back won't pick up changes made elsewhere until the page remounts.
  const [dashboard, setDashboard] = useState<TherapistDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    setDashboardLoading(true);
    setDashboardError(null);

    getTherapistDashboard(token, user.id)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setDashboardError(err instanceof ApiError ? err.message : "Couldn't load the dashboard. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setDashboardLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const patients = dashboard?.patients ?? [];

  // Drives the "Avg. Recovery Progress" chart — null until the PT picks a patient
  // (top-right selector, or clicking a row in the table below), matching the
  // requested UX: don't plot anything until a patient/plan is chosen.
  const [trendPatientId, setTrendPatientId] = useState<string | null>(null);
  const [trend, setTrend] = useState<PatientProgressTrend | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    if (!token || !trendPatientId) {
      setTrend(null);
      return;
    }
    let cancelled = false;
    setTrendLoading(true);

    getPatientProgressTrend(token, trendPatientId)
      .then((data) => {
        if (!cancelled) setTrend(data);
      })
      .catch(() => {
        if (!cancelled) setTrend(null);
      })
      .finally(() => {
        if (!cancelled) setTrendLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, trendPatientId]);

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return patients;
    return patients.filter(
      (patient) => patient.name.toLowerCase().includes(query) || patient.condition.toLowerCase().includes(query)
    );
  }, [search, patients]);

  const stats = dashboard?.stats;
  const weeklySessions = dashboard?.weeklySessions ?? [];

  const trendPatient = trendPatientId ? (patients.find((p) => p.id === trendPatientId) ?? null) : null;
  const trendDelta =
    trend && trend.points.length > 1 ? trend.points[trend.points.length - 1].score - trend.points[0].score : null;

  const displayName = user?.displayName || user?.username || "Therapist";
  const ownAvatarUrl = useOwnProfilePicture();
  const today = new Date();

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Dashboard" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Dashboard</h1>
            <p>
              {WEEKDAY_FORMATTER.format(today)}, {DATE_FORMATTER.format(today)}
            </p>
          </div>
          <div className="therapist-topbar-actions">
            <button type="button" className="icon-button therapist-bell" aria-label="Notifications">
              <Bell size={17} />
            </button>
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
          {dashboardError && (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", marginBottom: 16 }}>
              <p style={{ margin: 0 }}>{dashboardError}</p>
            </div>
          )}

          <div className="therapist-stat-grid">
            <StatCard
              icon={<Users size={20} />}
              label="Active Patients"
              value={dashboardLoading ? "…" : (stats?.activePatients ?? 0)}
            />
            <StatCard
              icon={<Activity size={20} />}
              label="Sessions Today"
              value={dashboardLoading ? "…" : (stats?.sessionsToday ?? 0)}
              accent="teal"
            />
            <StatCard
              icon={<TrendingUp size={20} />}
              label="Avg. Compliance"
              value={dashboardLoading ? "…" : `${stats?.avgCompliancePercent ?? 0}%`}
              accent="success"
            />
            <StatCard
              icon={<Clock size={20} />}
              label="Pending Reviews"
              value={dashboardLoading ? "…" : (stats?.pendingReviews ?? 0)}
              accent="warning"
            />
          </div>

          <div className="therapist-chart-grid">
            <div className="summary-card therapist-chart-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>Avg. Recovery Progress</strong>
                  <p>{trendPatient ? trend?.planName : "Select a patient to view their recovery trend"}</p>
                </div>
                <div className="therapist-chart-heading-actions">
                  <select
                    className="admin-role-select"
                    value={trendPatientId ?? ""}
                    onChange={(event) => setTrendPatientId(event.target.value || null)}
                    aria-label="Select patient for recovery progress chart"
                  >
                    <option value="">Select patient…</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.name}
                      </option>
                    ))}
                  </select>
                  {trendDelta !== null && (
                    <span className={`badge-pill ${trendDelta >= 0 ? "good" : "poor"}`}>
                      {trendDelta >= 0 ? "+" : ""}
                      {trendDelta}pts
                    </span>
                  )}
                </div>
              </div>
              {trendLoading ? (
                <div className="therapist-chart-empty">
                  <TrendingUp size={22} />
                  <p>Loading trend…</p>
                </div>
              ) : trend && trend.points.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trend.points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
                      axisLine={false}
                      tickLine={false}
                      domain={[0, 100]}
                    />
                    <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      dot={{ fill: "var(--primary)", r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : trendPatient ? (
                <div className="therapist-chart-empty">
                  <TrendingUp size={22} />
                  <p>No scored sessions yet for this patient's plan.</p>
                </div>
              ) : (
                <div className="therapist-chart-empty">
                  <TrendingUp size={22} />
                  <p>Pick a patient above, or click a row in the table below, to plot their recovery trend.</p>
                </div>
              )}
            </div>

            <div className="summary-card therapist-chart-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>Weekly Sessions</strong>
                  <p>Sessions completed per day</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklySessions} barSize={24}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
                  <Bar dataKey="sessions" fill="var(--teal)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="summary-card therapist-patient-card">
            <div className="therapist-patient-toolbar">
              <strong>Patients</strong>
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
                <button type="button" className="primary-button therapist-add-patient" onClick={() => setAssignModalOpen(true)}>
                  <Users size={14} /> Add Patient
                </button>
                {assignModalOpen && (
                  <AssignPatientModal
                    therapistId={user?.id ?? ""}
                    onClose={() => setAssignModalOpen(false)}
                    onAssigned={(patient) => {
                      // Prepend the newly assigned patient to the dashboard patients list
                      setDashboard((prev) => {
                        if (!prev) return prev;
                        const already = prev.patients.find((p) => p.id === patient.id);
                        if (already) return prev;
                        return {
                          ...prev,
                          patients: [patient, ...prev.patients],
                          stats: { ...prev.stats, activePatients: (prev.stats.activePatients ?? 0) + 1 }
                        };
                      });
                    }}
                  />
                )}
              </div>
            </div>

            <div className="therapist-table-scroll">
              <table className="therapist-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Current Plan</th>
                    <th>Last Session</th>
                    <th>Compliance</th>
                    <th>Progress</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {!dashboardLoading && filteredPatients.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "24px 0", color: "var(--text-secondary)" }}>
                        {patients.length === 0
                          ? "No patients are currently assigned to you."
                          : "No patients match your search."}
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
                          <PatientAvatar token={token} fileId={patient.profilePictureFileId} name={patient.name} />
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
                        <MiniProgressRing value={patient.progressPercent} size={36} strokeWidth={4} />
                      </td>
                      <td>
                        <span className={`badge-pill ${patient.standing === "active" ? "good" : "fair"}`}>
                          {patient.standing === "active" ? "Active" : "At Risk"}
                        </span>
                      </td>
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

function StatCard({
  icon,
  label,
  value,
  change,
  positive,
  accent = "primary"
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  change?: string;
  positive?: boolean;
  accent?: "primary" | "teal" | "success" | "warning";
}) {
  return (
    <div className={`summary-card therapist-stat-card accent-${accent}`}>
      <div className="therapist-stat-top">
        <span className="therapist-stat-icon">{icon}</span>
        {change && (
          <span className={`therapist-stat-change ${positive ? "positive" : "negative"}`}>
            {positive ? "\u2191" : "\u2193"} {change}
          </span>
        )}
      </div>
      <div className="therapist-stat-value">{value}</div>
      <p className="therapist-stat-label">{label}</p>
    </div>
  );
}

function complianceTone(percent: number): "good" | "fair" | "poor" {
  if (percent >= 80) return "good";
  if (percent >= 60) return "fair";
  return "poor";
}

function MiniProgressRing({ value, size = 36, strokeWidth = 4 }: { value: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  const tone = complianceTone(value);

  return (
    <span className={`mini-progress-ring ${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} className="mini-progress-track" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="mini-progress-fill"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <strong>{value}%</strong>
    </span>
  );
}
