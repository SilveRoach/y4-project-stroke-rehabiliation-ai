// Admin Dashboard page (frontend-design.md §8, route /admin/dashboard) — the Admin
// role's actual landing page (User Management, §9, is reached from here via the
// sidebar's "Users" nav item or the quick-link card below).
//
// Data reality check, per section:
// - System status panel (server/DB reachability) is REAL — calls the existing
//   `/health`/`/health/db` backend endpoints via `services/api.ts`'s `checkHealth()`.
// - System status panel (server/DB reachability) is REAL — calls the existing
//   `/health`/`/health/db` backend endpoints via `services/api.ts`'s `checkHealth()`.
// - Active patient/therapist counts and "Sessions today" are REAL — fetched from
//   backend GET `/admin/dashboard` via `services/api.ts`'s `getAdminDashboard()`.
// - User role distribution uses real counts from `/admin/dashboard`.
// - Activity logs are REAL — pulled from Exercise Library and Users tables via
//   backend GET `/admin/dashboard`.

import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Database, RefreshCw, Server } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AdminSidebar } from "../components/AdminSidebar";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { checkHealth, getAdminDashboard, syncScheduleStatuses } from "../services/api";
import type { AdminDashboardData, HealthStatus } from "../services/api";
import { useAuth } from "../store/authStore";
import type { RoleDistributionSlice } from "../types";
import { initialsFromName } from "../utils/displayName";

interface AdminDashboardPageProps {
  onLogout: () => void;
  onNavigateUsers: () => void;
  onNavigateSettings: () => void;
  // Routes into the shared Exercise Library section (see handleAdminNavigate).
  onNavigateExerciseLibrary: () => void;
}

export function AdminDashboardPage({ onLogout, onNavigateUsers, onNavigateSettings, onNavigateExerciseLibrary }: AdminDashboardPageProps) {
  const { token, user } = useAuth();
  const adminDisplayName = user?.displayName || user?.username || "Admin";
  const adminInitials = initialsFromName(adminDisplayName);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<AdminDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    type: "success" | "error";
    message: string;
    details?: string;
  } | null>(null);

  const handleSyncSchedules = async () => {
    if (!token || syncing) return;
    setSyncing(true);
    setSyncFeedback(null);
    try {
      const now = new Date();
      const localTodayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const result = await syncScheduleStatuses(token, localTodayIso);
      setSyncFeedback({
        type: "success",
        message: result.message || "Schedule synchronization completed successfully.",
        details: `Updated ${result.updatedDaysCount} schedule day(s) and ${result.updatedExercisesCount} scheduled exercise(s)${
          result.updatedPlansCount > 0 ? `, completed ${result.updatedPlansCount} plan(s) past their end date` : ""
        } (Skipped: ${result.summary.daysSkipped} days, ${result.summary.exercisesSkipped} exercises).`
      });
      // Refresh dashboard data so stats and logs update immediately
      getAdminDashboard(token).then((data) => setDashboardData(data)).catch(() => {});
    } catch (err: any) {
      console.error("Failed to sync schedules:", err);
      setSyncFeedback({
        type: "error",
        message: err?.message || "Failed to synchronize schedules. Please try again."
      });
    } finally {
      setSyncing(false);
    }
  };

  // Auto-trigger the schedule sync once when the admin lands on the dashboard
  // (i.e., after login). The manual button remains available for re-syncing.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (token && !autoSyncedRef.current) {
      autoSyncedRef.current = true;
      handleSyncSchedules();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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

  useEffect(() => {
    if (!token) {
      setDashboardLoading(false);
      return;
    }
    let cancelled = false;
    setDashboardLoading(true);
    getAdminDashboard(token)
      .then((data) => {
        if (!cancelled) {
          setDashboardData(data);
          setDashboardLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load admin dashboard data:", err);
        if (!cancelled) {
          setDashboardLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);


  const roleColors: Record<string, string> = {
    patient: "var(--primary)",
    therapist: "var(--teal)",
    admin: "#8b5cf6"
  };
  const roleLabels: Record<string, string> = {
    patient: "Patients",
    therapist: "Therapists",
    admin: "Admins"
  };

  const roleDistribution: RoleDistributionSlice[] = dashboardData?.roleDistribution
    ? dashboardData.roleDistribution.map((slice) => ({
        name: roleLabels[slice.role] || slice.role,
        value: slice.count,
        color: roleColors[slice.role] || "#8b5cf6"
      }))
    : [
        { name: "Patients", value: 0, color: "var(--primary)" },
        { name: "Therapists", value: 0, color: "var(--teal)" },
        { name: "Admins", value: 0, color: "#8b5cf6" }
      ];

  const logsToDisplay = dashboardData?.logs ?? [];

  // Activity log filtering — type/table dropdown filters plus a free-text
  // search across object name, time, and "by who".
  const [logTypeFilter, setLogTypeFilter] = useState("all");
  const [logTableFilter, setLogTableFilter] = useState("all");
  const [logSearch, setLogSearch] = useState("");

  const logTypes = useMemo(() => Array.from(new Set(logsToDisplay.map((log) => log.type))).sort(), [logsToDisplay]);
  const logTables = useMemo(() => Array.from(new Set(logsToDisplay.map((log) => log.table))).sort(), [logsToDisplay]);

  const filteredLogs = useMemo(() => {
    const search = logSearch.trim().toLowerCase();
    return logsToDisplay.filter((log) => {
      if (logTypeFilter !== "all" && log.type !== logTypeFilter) return false;
      if (logTableFilter !== "all" && log.table !== logTableFilter) return false;
      if (search) {
        const haystack = [log.objectName, log.timeLabel, log.timestamp, log.byWho]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [logsToDisplay, logTypeFilter, logTableFilter, logSearch]);

  const LOG_PAGE_SIZE = 10;
  const [logPage, setLogPage] = useState(0);
  const totalLogPages = Math.max(1, Math.ceil(filteredLogs.length / LOG_PAGE_SIZE));
  const pagedLogs = filteredLogs.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE);

  // Keep the page in range whenever filters/search change the result set.
  useEffect(() => {
    setLogPage(0);
  }, [logTypeFilter, logTableFilter, logSearch]);


  const degraded = !!health && (health.server !== "ok" || health.database !== "ok");

  return (
    <section className="therapist-shell">
      <AdminSidebar
        activeLabel="Dashboard"
        onNavigate={(label: AdminNavLabel) => {
          if (label === "Users") onNavigateUsers();
          if (label === "Settings") onNavigateSettings();
          if (label === "Exercise Library") onNavigateExerciseLibrary();
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
            <button
              type="button"
              className="admin-sync-button"
              onClick={handleSyncSchedules}
              disabled={syncing}
              title="Synchronize schedule day and exercise statuses based on assignment date and current today's date, and complete patient plans whose end date has passed"
            >
              <RefreshCw size={15} className={syncing ? "spin-icon" : ""} />
              <span>{syncing ? "Syncing Schedules…" : "Sync Schedules"}</span>
            </button>
            <div className="therapist-topbar-profile">
              <div>
                <strong>{adminDisplayName}</strong>
                <small>System Administrator</small>
              </div>
              <span className="avatar-badge admin-avatar">{adminInitials}</span>
            </div>
          </div>
        </header>

        <main className="therapist-main">
          {syncFeedback && (
            <div
              className={`auth-error-banner ${syncFeedback.type === "success" ? "admin-success-banner" : ""} admin-sync-banner`}
              role="status"
            >
              <div className="admin-sync-banner-content">
                {syncFeedback.type === "success" ? (
                  <CheckCircle2 size={18} className="admin-sync-banner-icon" />
                ) : (
                  <AlertCircle size={18} className="admin-sync-banner-icon" />
                )}
                <div>
                  <strong>{syncFeedback.message}</strong>
                  {syncFeedback.details && <p>{syncFeedback.details}</p>}
                </div>
              </div>
              <button
                type="button"
                className="admin-sync-banner-close"
                onClick={() => setSyncFeedback(null)}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}

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

          <div className="therapist-chart-grid">
            <div className="summary-card therapist-chart-card admin-log-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>Activity logs</strong>
                  <p>Recent changes from User Management and Exercise Library</p>
                </div>
                {filteredLogs.length > 0 && (
                  <div className="admin-log-pagination">
                    <span className="admin-log-pagination-label">
                      {logPage * LOG_PAGE_SIZE + 1}–{Math.min((logPage + 1) * LOG_PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length}
                    </span>
                    <button
                      className="admin-log-pagination-btn"
                      onClick={() => setLogPage((p) => Math.max(0, p - 1))}
                      disabled={logPage === 0}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <button
                      className="admin-log-pagination-btn"
                      onClick={() => setLogPage((p) => Math.min(totalLogPages - 1, p + 1))}
                      disabled={logPage >= totalLogPages - 1}
                      aria-label="Next page"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                )}
              </div>
              <div className="admin-log-filters">
                <input
                  type="search"
                  className="admin-log-search"
                  placeholder="Search object name, time, or user…"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  aria-label="Search activity logs"
                />
                <select
                  className="admin-log-filter-select"
                  value={logTypeFilter}
                  onChange={(e) => setLogTypeFilter(e.target.value)}
                  aria-label="Filter by type"
                >
                  <option value="all">All types</option>
                  {logTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <select
                  className="admin-log-filter-select"
                  value={logTableFilter}
                  onChange={(e) => setLogTableFilter(e.target.value)}
                  aria-label="Filter by table"
                >
                  <option value="all">All tables</option>
                  {logTables.map((table) => (
                    <option key={table} value={table}>{table}</option>
                  ))}
                </select>
              </div>
              <div className="therapist-table-scroll admin-log-table-scroll">
                <table className="therapist-table admin-log-table">
                  <thead>
                    <tr>
                      <th style={{ width: "100px" }}>Type</th>
                      <th style={{ width: "110px" }}>Table</th>
                      <th>Object Name</th>
                      <th style={{ width: "130px" }}>Time</th>
                      <th style={{ width: "170px" }}>By Who</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardLoading && !dashboardData ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "28px", color: "var(--text-secondary)" }}>
                          Loading activity logs…
                        </td>
                      </tr>
                    ) : filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "28px", color: "var(--text-secondary)" }}>
                          {logsToDisplay.length === 0 ? "No activity logs recorded yet." : "No activity logs match your search or filters."}
                        </td>
                      </tr>
                    ) : (
                      pagedLogs.map((log, index) => (
                        <tr key={log.id || index}>
                          <td>
                            <span className={`admin-log-badge admin-log-badge--${log.type}`}>
                              {log.type}
                            </span>
                          </td>
                          <td>
                            <span className={`admin-log-table-pill admin-log-table-pill--${log.table}`}>
                              {log.table}
                            </span>
                          </td>
                          <td>
                            <span className="admin-log-object-name" title={log.message || log.objectName}>
                              {log.objectName}
                            </span>
                          </td>
                          <td>
                            <span className="admin-log-time" title={log.timestamp || log.timeLabel}>
                              <Clock size={11} /> {log.timeLabel}
                            </span>
                          </td>
                          <td>
                            <span className="admin-log-bywho">{log.byWho}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

            </div>

            <div className="summary-card therapist-chart-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>User roles</strong>
                  <p>Distribution by role</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={roleDistribution} innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                    {roleDistribution.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="admin-role-legend">
                {roleDistribution.map((slice) => (
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

