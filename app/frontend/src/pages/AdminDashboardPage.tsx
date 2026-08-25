// Admin Dashboard page (frontend-design.md §8, route /admin/dashboard) — the Admin
// role's actual landing page (User Management, §9, is reached from here via the
// sidebar's "Users" nav item or the quick-link card below).
//
// Data reality check, per section:
// - System status panel (server/DB reachability) is REAL — calls the existing
//   `/health`/`/health/db` backend endpoints via `services/api.ts`'s `checkHealth()`.
// - Active patient/therapist counts are MOCK, same caveat as
//   `AdminUserManagementPage.tsx`'s staff list: `GET /users` isn't built yet, and
//   there's no admin-facing patient list at all yet, so the patient figure is
//   sourced from `data/adminMock.ts`'s `roleDistributionData` (pre-existing mock
//   scaffolding) rather than invented fresh.
// - "Sessions today" has no backend data source yet (no session-results/logging
//   module) — mock, taken illustratively from `weeklyActivityData`.
// - Weekly activity chart, role-distribution chart, and the system log feed are all
//   mock (`data/adminMock.ts`) for the same reason. Each mock section is labelled
//   inline rather than presented as real.

import { Activity, ArrowRight, Clock, Database, Server, Shield, Users } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AdminSidebar } from "../components/AdminSidebar";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { adminProfile, adminUsers, roleDistributionData, systemLogs, weeklyActivityData } from "../data/adminMock";
import { checkHealth } from "../services/api";
import type { HealthStatus } from "../services/api";

interface AdminDashboardPageProps {
  onLogout: () => void;
  onNavigateUsers: () => void;
  onNavigateSettings: () => void;
}

export function AdminDashboardPage({ onLogout, onNavigateUsers, onNavigateSettings }: AdminDashboardPageProps) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setHealthLoading(true);
    checkHealth().then((result) => {
      if (!cancelled) {
        setHealth(result);
        setHealthLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTherapistCount = adminUsers.filter((u) => u.role === "therapist" && u.status === "active").length;
  const activePatientCount = roleDistributionData.find((slice) => slice.name === "Patients")?.value ?? 0;
  const sessionsToday = weeklyActivityData[weeklyActivityData.length - 1]?.sessions ?? 0;

  const degraded = !!health && (health.server !== "ok" || health.database !== "ok");

  return (
    <section className="therapist-shell">
      <AdminSidebar
        activeLabel="Dashboard"
        onNavigate={(label: AdminNavLabel) => {
          if (label === "Users") onNavigateUsers();
          if (label === "Settings") onNavigateSettings();
        }}
        onLogout={onLogout}
      />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Admin Dashboard</h1>
            <p>System status and platform overview</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{adminProfile.displayName}</strong>
                <small>{adminProfile.title}</small>
              </div>
              <span className="avatar-badge admin-avatar">{adminProfile.initials}</span>
            </div>
          </div>
        </header>

        <main className="therapist-main">
          <div className="summary-card admin-status-card">
            <div className="admin-status-heading">
              <strong>System status</strong>
              {!healthLoading && (
                <span className={`badge-pill ${degraded ? "poor" : "good"}`}>
                  {degraded ? "Degraded" : "All systems normal"}
                </span>
              )}
            </div>
            <div className="admin-status-grid">
              <StatusRow
                icon={<Server size={17} />}
                label="Application server"
                loading={healthLoading}
                ok={health?.server === "ok"}
                okLabel="Reachable"
                downLabel="Unreachable"
              />
              <StatusRow
                icon={<Database size={17} />}
                label="Database"
                loading={healthLoading}
                ok={health?.database === "ok"}
                okLabel="Connected"
                downLabel="Unreachable"
              />
            </div>
          </div>

          <div className="therapist-stat-grid admin-stat-grid">
            <StatCard icon={<Users size={20} />} label="Active patients (mock)" value={activePatientCount} accent="primary" />
            <StatCard
              icon={<Shield size={20} />}
              label="Active therapists (mock)"
              value={activeTherapistCount}
              accent="teal"
            />
            <StatCard icon={<Activity size={20} />} label="Sessions today (mock)" value={sessionsToday} accent="success" />
          </div>

          <div className="therapist-chart-grid">
            <div className="summary-card therapist-chart-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>Weekly platform activity</strong>
                  <p>Sessions and AI inference calls — mock data</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklyActivityData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
                  <Bar dataKey="sessions" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="aiCalls" fill="var(--teal)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="summary-card therapist-chart-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>User roles</strong>
                  <p>Distribution by role — mock data</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={roleDistributionData} innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                    {roleDistributionData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="admin-role-legend">
                {roleDistributionData.map((slice) => (
                  <div className="admin-role-legend-row" key={slice.name}>
                    <span>
                      <span className="admin-role-legend-dot" style={{ backgroundColor: slice.color }} />
                      {slice.name}
                    </span>
                    <strong>{slice.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="therapist-chart-grid">
            <div className="summary-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>System logs</strong>
                  <p>Most recent activity — mock data</p>
                </div>
              </div>
              <div className="admin-log-list">
                {systemLogs.map((log, index) => (
                  <div className={`admin-log-entry ${log.level}`} key={index}>
                    <div className="admin-log-entry-top">
                      <span className="admin-log-level">{log.level}</span>
                      <span className="admin-log-time">
                        <Clock size={11} /> {log.timeLabel}
                      </span>
                    </div>
                    <p>{log.message}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="summary-card admin-quicklink-card">
              <div>
                <strong>User Management</strong>
                <p>Create and review Therapist and Administrator accounts.</p>
              </div>
              <button type="button" className="primary-button" onClick={onNavigateUsers}>
                Go to User Management <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}

function StatusRow({
  icon,
  label,
  loading,
  ok,
  okLabel,
  downLabel
}: {
  icon: ReactNode;
  label: string;
  loading: boolean;
  ok?: boolean;
  okLabel: string;
  downLabel: string;
}) {
  return (
    <div className="admin-status-row">
      <span className="admin-status-icon">{icon}</span>
      <div>
        <strong>{label}</strong>
        {loading ? (
          <span className="badge-pill fair">Checking…</span>
        ) : ok ? (
          <span className="badge-pill good">{okLabel}</span>
        ) : (
          <span className="badge-pill poor">{downLabel}</span>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent = "primary"
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  accent?: "primary" | "teal" | "success" | "warning";
}) {
  return (
    <div className={`summary-card therapist-stat-card accent-${accent}`}>
      <div className="therapist-stat-top">
        <span className="therapist-stat-icon">{icon}</span>
      </div>
      <div className="therapist-stat-value">{value}</div>
      <p className="therapist-stat-label">{label}</p>
    </div>
  );
}
