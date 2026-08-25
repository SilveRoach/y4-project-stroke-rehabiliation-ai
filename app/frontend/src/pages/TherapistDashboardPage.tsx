import {
  Activity,
  Bell,
  Clock,
  Dumbbell,
  Eye,
  FileText,
  MessageSquare,
  Search,
  TrendingUp,
  Users,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { patientProgressTrends, therapistPatients, therapistProfile, weeklySessionData } from "../data/therapistMock";
import type { TherapistPatientSummary } from "../types";

interface TherapistDashboardPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  // Navigates to the full Patient Detail page (frontend-design.md §5,
  // pages/PatientDetailPage.tsx) — wired from the slide-over panel's
  // "View Full Report" button, which was previously a non-functional placeholder.
  onViewFullReport: (patient: TherapistPatientSummary) => void;
}

export function TherapistDashboardPage({ onLogout, onNavigate, onViewFullReport }: TherapistDashboardPageProps) {
  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<TherapistPatientSummary | null>(null);
  // Drives the "Avg. Recovery Progress" chart — null until the PT picks a patient
  // (top-right selector, or clicking a row in the table below), matching the
  // requested UX: don't plot anything until a patient/plan is chosen. Previously
  // this chart always plotted a fixed all-patients aggregate (progressTrendData)
  // with no selection step at all.
  const [trendPatientId, setTrendPatientId] = useState<string | null>(null);

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return therapistPatients;
    return therapistPatients.filter(
      (patient) => patient.name.toLowerCase().includes(query) || patient.condition.toLowerCase().includes(query)
    );
  }, [search]);

  const activePatientCount = therapistPatients.filter((p) => p.standing === "active").length;
  const avgCompliance = Math.round(
    therapistPatients.reduce((sum, p) => sum + p.compliancePercent, 0) / therapistPatients.length
  );

  const trendPatient = trendPatientId ? therapistPatients.find((p) => p.id === trendPatientId) ?? null : null;
  const trend = trendPatientId ? patientProgressTrends.find((t) => t.patientId === trendPatientId) ?? null : null;
  const trendDelta =
    trend && trend.points.length > 1 ? trend.points[trend.points.length - 1].score - trend.points[0].score : null;

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Dashboard" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Dashboard</h1>
            <p>Monday, 27 July 2026</p>
          </div>
          <div className="therapist-topbar-actions">
            <button type="button" className="icon-button therapist-bell" aria-label="Notifications">
              <Bell size={17} />
            </button>
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
          <div className="therapist-stat-grid">
            <StatCard
              icon={<Users size={20} />}
              label="Active Patients"
              value={activePatientCount}
              change="2 this month"
              positive
            />
            <StatCard icon={<Activity size={20} />} label="Sessions Today" value={8} change="12%" positive accent="teal" />
            <StatCard
              icon={<TrendingUp size={20} />}
              label="Avg. Compliance"
              value={`${avgCompliance}%`}
              change="5%"
              positive
              accent="success"
            />
            <StatCard icon={<Clock size={20} />} label="Pending Reviews" value={3} accent="warning" />
          </div>

          <div className="therapist-chart-grid">
            <div className="summary-card therapist-chart-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>Avg. Recovery Progress</strong>
                  <p>{trendPatient ? trend?.planName : "Select a patient to view their 6-week trend"}</p>
                </div>
                <div className="therapist-chart-heading-actions">
                  <select
                    className="admin-role-select"
                    value={trendPatientId ?? ""}
                    onChange={(event) => setTrendPatientId(event.target.value || null)}
                    aria-label="Select patient for recovery progress chart"
                  >
                    <option value="">Select patient…</option>
                    {therapistPatients.map((patient) => (
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
              {trend ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trend.points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
                      axisLine={false}
                      tickLine={false}
                      domain={[30, 100]}
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
                <BarChart data={weeklySessionData} barSize={24}>
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
                <button type="button" className="primary-button therapist-add-patient">
                  <Users size={14} /> Add Patient
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
                    <th>Progress</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filteredPatients.map((patient) => (
                    <tr
                      key={patient.id}
                      className={trendPatientId === patient.id ? "trend-selected" : ""}
                      onClick={() => setTrendPatientId(patient.id)}
                      style={{ cursor: "pointer" }}
                      title="Click to plot this patient's recovery trend above"
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
                      <td>
                        <button
                          type="button"
                          className="secondary-button therapist-view-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedPatient(patient);
                          }}
                        >
                          <Eye size={13} /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {selectedPatient && (
        <PatientDetailPanel
          patient={selectedPatient}
          onClose={() => setSelectedPatient(null)}
          onViewFullReport={() => {
            onViewFullReport(selectedPatient);
            setSelectedPatient(null);
          }}
        />
      )}
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

function PatientDetailPanel({
  patient,
  onClose,
  onViewFullReport
}: {
  patient: TherapistPatientSummary;
  onClose: () => void;
  onViewFullReport: () => void;
}) {
  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <aside className="therapist-detail-panel" aria-label="Patient profile">
        <div className="therapist-detail-header">
          <strong>Patient Profile</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close patient profile">
            <X size={16} />
          </button>
        </div>

        <div className="therapist-detail-identity">
          <span className="therapist-avatar large">{patient.avatarInitials}</span>
          <div>
            <strong>{patient.name}</strong>
            {patient.nameTh && <small className="therapist-detail-nameTh">{patient.nameTh}</small>}
            <p>{patient.condition}</p>
            <span className={`badge-pill ${patient.standing === "active" ? "good" : "fair"}`}>
              {patient.standing === "active" ? "Active" : "At Risk"}
            </span>
          </div>
        </div>

        <div className="therapist-detail-stats">
          <div>
            <span>Age</span>
            <strong>{patient.age} years</strong>
          </div>
          <div>
            <span>Sessions</span>
            <strong>{patient.sessionsCompleted}</strong>
          </div>
          <div>
            <span>Compliance</span>
            <strong>{patient.compliancePercent}%</strong>
          </div>
          <div>
            <span>Last Session</span>
            <strong>{patient.lastSessionLabel}</strong>
          </div>
        </div>

        <div className="therapist-detail-progress">
          <strong>Overall Recovery Progress</strong>
          <div className="therapist-detail-progress-row">
            <MiniProgressRing value={patient.progressPercent} size={80} strokeWidth={8} />
            <p>{patient.summary}</p>
          </div>
        </div>

        <div className="therapist-detail-actions">
          <button type="button" className="primary-button">
            <Dumbbell size={15} /> Assign New Exercise
          </button>
          <button type="button" className="secondary-button">
            <MessageSquare size={15} /> Send Message
          </button>
          <button type="button" className="link-button" onClick={onViewFullReport}>
            <FileText size={15} /> View Full Report
          </button>
        </div>
      </aside>
    </>
  );
}
