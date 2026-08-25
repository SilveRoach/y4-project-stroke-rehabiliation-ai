// Admin User Management page (frontend-design.md §9, route /admin/users).
//
// SCOPE for this pass: the "Create account" flow is REAL — it calls the already-built
// backend `POST /api/v1/users` (Admin-only, user-management module) via
// `services/api.ts`'s `createUser()`. The user LIST is still mock data
// (`data/adminMock.ts`) with newly-created accounts merged in locally, because the
// backend's `GET /users` (api-design.md) is not implemented yet — see
// `user.service.ts`'s scope note. "Edit" (display name/username/schema fields) is
// client-side only for the same reason — no `PATCH /users/:id` endpoint exists yet
// (see EditAccountModal's comment). Per-row enable/disable is a disabled placeholder
// for the same reason (`PATCH /users/:id/status` doesn't exist yet). Admin Dashboard
// (frontend-design.md §8 — system health panel, `/admin/dashboard`) is a separate,
// not-yet-built page; this page only covers §9.
//
// A single mock Patient row was added to the table (UI_MOCKUP_PLAN_NEWDB.md §6
// progress note, 2026-08-08) to demonstrate the Edit-popup pattern for a 3rd
// account kind, and "Create account" now also offers a Patient role option
// (2026-08-08). Both are **mock-only** for Patient: real patient accounts
// self-register via `POST /auth/register` (FR-AUTH-01b, phone + password only) —
// there is no real "admin creates a patient" endpoint, and `CreateUserPayload` is
// intentionally still typed to `"therapist" | "admin"` only, so the Patient branch
// of `CreateAccountModal.submit()` never calls `createUser()` at all, unlike the
// Therapist/Admin branch which is real. Patient's fields (first/last name, gender,
// date of birth, height, weight) come from a `patients` DBML the user supplied
// directly in chat 2026-08-08 — not yet reflected in `schema.prisma` or
// `newdb.txt` itself, see the plan doc's §5/§6 for the reconciliation note.

import { AlertCircle, Pencil, Plus, Search, Shield, Users, X } from "lucide-react";
import { FormEvent, ReactNode, useMemo, useState } from "react";
import { AdminSidebar } from "../components/AdminSidebar";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { adminProfile, adminUsers as initialAdminUsers } from "../data/adminMock";
import { ApiError, createUser } from "../services/api";
import { useAuth } from "../store/authStore";
import type { AdminManagedRole, AdminUserSummary, StaffRole } from "../types";

interface AdminUserManagementPageProps {
  onLogout: () => void;
  onNavigateDashboard: () => void;
  onNavigateSettings: () => void;
}

type RoleFilter = "all" | "patient" | StaffRole;

export function AdminUserManagementPage({ onLogout, onNavigateDashboard, onNavigateSettings }: AdminUserManagementPageProps) {
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[]>(initialAdminUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserSummary | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesRole = roleFilter === "all" || u.role === roleFilter;
      const matchesQuery =
        !query || u.name.toLowerCase().includes(query) || u.username.toLowerCase().includes(query);
      return matchesRole && matchesQuery;
    });
  }, [users, search, roleFilter]);

  const therapistCount = users.filter((u) => u.role === "therapist").length;
  const adminCount = users.filter((u) => u.role === "admin").length;
  const activeTherapistCount = users.filter((u) => u.role === "therapist" && u.status === "active").length;
  const activeAdminCount = users.filter((u) => u.role === "admin" && u.status === "active").length;

  function roleLabel(role: AdminUserSummary["role"]): string {
    if (role === "admin") return "Admin";
    if (role === "therapist") return "Therapist";
    return "Patient";
  }

  function roleTone(role: AdminUserSummary["role"]): "good" | "fair" | "poor" {
    if (role === "admin") return "poor";
    if (role === "therapist") return "good";
    return "fair";
  }

  return (
    <section className="therapist-shell">
      <AdminSidebar
        activeLabel="Users"
        onNavigate={(label: AdminNavLabel) => {
          if (label === "Dashboard") onNavigateDashboard();
          if (label === "Settings") onNavigateSettings();
        }}
        onLogout={onLogout}
      />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>User Management</h1>
            <p>Create Therapist/Admin/Patient accounts and manage existing ones</p>
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
          <div className="therapist-stat-grid admin-stat-grid">
            <StatCard
              icon={<Users size={20} />}
              label="Therapist accounts"
              value={therapistCount}
              change={`${activeTherapistCount} active`}
              positive
            />
            <StatCard
              icon={<Shield size={20} />}
              label="Admin accounts"
              value={adminCount}
              change={`${activeAdminCount} active`}
              positive
              accent="teal"
            />
          </div>

          {successMessage && (
            <p className="auth-error-banner admin-success-banner" role="status">
              {successMessage}
            </p>
          )}

          <div className="summary-card therapist-patient-card">
            <div className="therapist-patient-toolbar">
              <strong>Accounts</strong>
              <div className="therapist-patient-toolbar-actions">
                <div className="therapist-search">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search accounts…"
                    aria-label="Search accounts"
                  />
                </div>
                <select
                  className="admin-role-select"
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                  aria-label="Filter by role"
                >
                  <option value="all">All roles</option>
                  <option value="therapist">Therapist</option>
                  <option value="admin">Admin</option>
                  <option value="patient">Patient</option>
                </select>
                <button
                  type="button"
                  className="primary-button therapist-add-patient"
                  onClick={() => {
                    setSuccessMessage(null);
                    setShowCreateForm(true);
                  }}
                >
                  <Plus size={14} /> Create account
                </button>
              </div>
            </div>

            <div className="therapist-table-scroll">
              <table className="therapist-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Username / Phone</th>
                    <th>Status</th>
                    <th>Last login</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="therapist-table-patient">
                          <span className="therapist-avatar admin-avatar">
                            {user.name
                              .split(" ")
                              .map((word) => word[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <div>
                            <strong>{user.name}</strong>
                            {typeof user.patientCount === "number" && <small>{user.patientCount} patients</small>}
                            {user.licenseNumber && <small>License {user.licenseNumber}</small>}
                            {user.employeeId && <small>Employee ID {user.employeeId}</small>}
                            {user.role === "patient" && user.gender && user.gender !== "unknown" && (
                              <small>{user.gender[0].toUpperCase() + user.gender.slice(1)}</small>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge-pill ${roleTone(user.role)}`}>{roleLabel(user.role)}</span>
                      </td>
                      <td>{user.username}</td>
                      <td>
                        <span className={`badge-pill ${user.status === "active" ? "good" : "fair"}`}>
                          {user.status === "active" ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td>{user.lastLoginLabel}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            className="secondary-button therapist-view-button"
                            onClick={() => {
                              setSuccessMessage(null);
                              setEditingUser(user);
                            }}
                          >
                            <Pencil size={13} /> Edit
                          </button>
                          <button
                            type="button"
                            className="secondary-button therapist-view-button"
                            disabled
                            title="Enable/disable isn't wired to the backend yet (PATCH /users/:id/status not implemented)."
                          >
                            {user.status === "active" ? "Disable" : "Enable"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "24px 0" }}>
                        No accounts match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {showCreateForm && (
        <CreateAccountModal
          token={token}
          onClose={() => setShowCreateForm(false)}
          onCreated={(created) => {
            setUsers((prev) => [
              {
                id: created.id,
                name: created.displayName,
                role: created.role,
                username: created.username,
                status: "active",
                lastLoginLabel: "Never",
                patientCount: created.role === "therapist" ? 0 : undefined,
                licenseNumber: created.licenseNumber,
                licenseIssuedLabel: created.licenseIssuedLabel,
                licenseExpiryLabel: created.licenseExpiryLabel,
                employeeId: created.employeeId,
                firstName: created.firstName,
                lastName: created.lastName,
                gender: created.gender,
                dateOfBirthLabel: created.dateOfBirthLabel,
                heightCm: created.heightCm,
                weightKg: created.weightKg
              },
              ...prev
            ]);
            setShowCreateForm(false);
            setSuccessMessage(
              `${roleLabel(created.role)} account "${created.username}" created${created.role === "patient" ? " (mock only — no backend endpoint for admin-created patients exists)" : ""}.`
            );
          }}
        />
      )}

      {editingUser && (
        <EditAccountModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={(updated) => {
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
            setEditingUser(null);
            setSuccessMessage(
              `Account "${updated.username}" updated (local only — no PATCH /users/:id endpoint exists yet, see UI_MOCKUP_PLAN_NEWDB.md §5).`
            );
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

function CreateAccountModal({
  token,
  onClose,
  onCreated
}: {
  token: string | null;
  onClose: () => void;
  onCreated: (user: {
    id: string;
    role: AdminManagedRole;
    username: string;
    displayName: string;
    licenseNumber?: string;
    licenseIssuedLabel?: string;
    licenseExpiryLabel?: string;
    employeeId?: string;
    firstName?: string;
    lastName?: string;
    gender?: "male" | "female" | "other" | "unknown";
    dateOfBirthLabel?: string;
    heightCm?: number;
    weightKg?: number;
  }) => void;
}) {
  const [role, setRole] = useState<AdminManagedRole>("therapist");
  const isPatient = role === "patient";

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseIssued, setLicenseIssued] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  // Patient fields, matching the `patients` DBML the user supplied 2026-08-08 (see
  // EditAccountModal's comment) — no single display-name column for this role.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "unknown">("unknown");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (isPatient) {
      if (!firstName.trim() || !lastName.trim() || !username.trim() || password.length === 0) {
        setError("Fill in first name, last name, phone number, and password.");
        return;
      }

      // Patients self-register from the app with just phone + password
      // (FR-AUTH-01b, services/api.ts's `register()`); POST /users is Admin-only
      // and its CreateUserPayload is typed to "therapist" | "admin" only — there is
      // no real "admin creates a patient" endpoint to call. So unlike the
      // Therapist/Admin branch below, this never touches the network: it's a mock
      // row only, same as everything else about this Patient row
      // (UI_MOCKUP_PLAN_NEWDB.md §6 progress note).
      setSubmitting(true);
      onCreated({
        id: `patient-${Date.now()}`,
        role: "patient",
        username: username.trim(),
        displayName: `${firstName.trim()} ${lastName.trim()}`.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        gender,
        dateOfBirthLabel: dateOfBirth.trim() || undefined,
        heightCm: heightCm.trim() ? Number(heightCm) : undefined,
        weightKg: weightKg.trim() ? Number(weightKg) : undefined
      });
      setSubmitting(false);
      return;
    }

    if (!token) {
      setError("Your session has expired. Please log in again.");
      return;
    }
    if (!displayName.trim() || !username.trim() || password.length === 0) {
      setError("Fill in display name, username, and password.");
      return;
    }

    setSubmitting(true);
    try {
      const { user } = await createUser(token, {
        role,
        username: username.trim(),
        password,
        displayName: displayName.trim()
      });
      // License/Employee ID fields aren't part of CreateUserPayload — the backend
      // has no columns for them yet (UI_MOCKUP_PLAN_NEWDB.md §5) — so they're
      // merged in locally rather than sent to the API call above.
      onCreated({
        ...user,
        licenseNumber: role === "therapist" ? licenseNumber.trim() || undefined : undefined,
        licenseIssuedLabel: role === "therapist" ? licenseIssued.trim() || undefined : undefined,
        licenseExpiryLabel: role === "therapist" ? licenseExpiry.trim() || undefined : undefined,
        employeeId: role === "admin" ? employeeId.trim() || undefined : undefined
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="admin-modal" role="dialog" aria-label="Create account">
        <div className="therapist-detail-header">
          <strong>Create account</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form className="admin-modal-form" onSubmit={submit} noValidate>
          {error && (
            <p className="auth-error-banner" role="alert">
              <AlertCircle size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              {error}
            </p>
          )}

          <label>
            Role
            <div className="admin-role-toggle">
              <button
                type="button"
                className={`secondary-button ${role === "therapist" ? "active" : ""}`}
                onClick={() => setRole("therapist")}
              >
                Therapist
              </button>
              <button
                type="button"
                className={`secondary-button ${role === "admin" ? "active" : ""}`}
                onClick={() => setRole("admin")}
              >
                Admin
              </button>
              <button
                type="button"
                className={`secondary-button ${role === "patient" ? "active" : ""}`}
                onClick={() => setRole("patient")}
              >
                Patient
              </button>
            </div>
          </label>

          {isPatient && (
            <p className="pd-empty-note" style={{ margin: 0 }}>
              Patients normally self-register from the app with just a phone number and
              password. This creates a mock account only — there's no real "admin creates
              a patient" backend endpoint to call.
            </p>
          )}

          {isPatient ? (
            <div className="library-toggle-row">
              <label>
                First name
                <input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" />
              </label>
              <label>
                Last name
                <input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" />
              </label>
            </div>
          ) : (
            <label>
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="e.g. Dr. Somsri Rattanakul"
                autoComplete="name"
              />
            </label>
          )}

          <label>
            {isPatient ? "Phone number" : "Username"}
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={isPatient ? "e.g. 0891234567" : "e.g. somsri"}
              autoComplete="off"
            />
          </label>

          <label>
            Temporary password
            <span className="password-field">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
              <button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
          </label>

          {role === "therapist" && (
            <>
              <label>
                License number
                <input
                  value={licenseNumber}
                  onChange={(event) => setLicenseNumber(event.target.value)}
                  placeholder="e.g. PT-2024-00123"
                  autoComplete="off"
                />
              </label>
              <div className="library-toggle-row">
                <label>
                  License issued
                  <input
                    type="date"
                    value={licenseIssued}
                    onChange={(event) => setLicenseIssued(event.target.value)}
                  />
                </label>
                <label>
                  License expiry
                  <input
                    type="date"
                    value={licenseExpiry}
                    onChange={(event) => setLicenseExpiry(event.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          {role === "admin" && (
            <label>
              Employee ID
              <input
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                placeholder="e.g. EMP-0042"
                autoComplete="off"
              />
            </label>
          )}

          {isPatient && (
            <>
              <div className="library-toggle-row">
                <label>
                  Gender
                  <select
                    className="admin-role-select"
                    value={gender}
                    onChange={(event) => setGender(event.target.value as "male" | "female" | "other" | "unknown")}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <label>
                  Date of birth
                  <input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
                </label>
              </div>
              <div className="library-toggle-row">
                <label>
                  Height (cm)
                  <input
                    type="number"
                    step="0.1"
                    value={heightCm}
                    onChange={(event) => setHeightCm(event.target.value)}
                    placeholder="e.g. 160"
                  />
                </label>
                <label>
                  Weight (kg)
                  <input
                    type="number"
                    step="0.1"
                    value={weightKg}
                    onChange={(event) => setWeightKg(event.target.value)}
                    placeholder="e.g. 58"
                  />
                </label>
              </div>
            </>
          )}

          <button className="primary-button full-width" type="submit" disabled={submitting}>
            {submitting ? "Creating…" : `Create ${role === "therapist" ? "Therapist" : role === "admin" ? "Admin" : "Patient"} account`}
          </button>
        </form>
      </div>
    </>
  );
}

// Edit account details — following the same schema fields as CreateAccountModal
// (UI_MOCKUP_PLAN_NEWDB.md §2.2/§5/§6#1): display name, username, and the
// role-specific fields (License Number/Issued/Expiry for Therapist, Employee ID for
// Admin, and — for Patient — the fields from the `patients` DBML the user supplied
// 2026-08-08: first_name, last_name, gender, date_of_birth, height_cm, weight_kg).
// Role itself is fixed once an account exists — changing it is a bigger operation
// (re-provisioning the Therapist/Admin/Patient extension row) that isn't in scope
// here, so it's shown read-only rather than offered as a toggle like the create
// form's. No password field — that's a separate reset-password flow, not covered.
// **Client-side only**: `user.service.ts`'s own scope note says PATCH /users/:id
// isn't implemented yet, so this updates local state and nothing else — same
// pattern as every other still-mock write in this app.
function EditAccountModal({
  user,
  onClose,
  onSave
}: {
  user: AdminUserSummary;
  onClose: () => void;
  onSave: (updated: AdminUserSummary) => void;
}) {
  const isPatient = user.role === "patient";

  const [displayName, setDisplayName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [licenseNumber, setLicenseNumber] = useState(user.licenseNumber ?? "");
  const [licenseIssued, setLicenseIssued] = useState(user.licenseIssuedLabel ?? "");
  const [licenseExpiry, setLicenseExpiry] = useState(user.licenseExpiryLabel ?? "");
  const [employeeId, setEmployeeId] = useState(user.employeeId ?? "");
  // patients.first_name/last_name replace the generic display-name input for this
  // role — the DBML has no single name/display_name column on `patients` the way
  // User.displayName covers Therapist/Admin.
  const [firstName, setFirstName] = useState(user.firstName ?? user.name.split(" ")[0] ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? user.name.split(" ").slice(1).join(" "));
  const [gender, setGender] = useState<"male" | "female" | "other" | "unknown">(user.gender ?? "unknown");
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirthLabel ?? "");
  const [heightCm, setHeightCm] = useState(user.heightCm?.toString() ?? "");
  const [weightKg, setWeightKg] = useState(user.weightKg?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  const roleLabel = user.role === "admin" ? "Admin" : user.role === "therapist" ? "Therapist" : "Patient";
  const roleTone = user.role === "admin" ? "poor" : user.role === "therapist" ? "good" : "fair";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isPatient) {
      if (!firstName.trim() || !lastName.trim() || !username.trim()) {
        setError("Fill in first name, last name, and phone number.");
        return;
      }
    } else if (!displayName.trim() || !username.trim()) {
      setError("Fill in display name and username.");
      return;
    }

    onSave({
      ...user,
      name: isPatient ? `${firstName.trim()} ${lastName.trim()}`.trim() : displayName.trim(),
      username: username.trim(),
      licenseNumber: user.role === "therapist" ? licenseNumber.trim() || undefined : undefined,
      licenseIssuedLabel: user.role === "therapist" ? licenseIssued.trim() || undefined : undefined,
      licenseExpiryLabel: user.role === "therapist" ? licenseExpiry.trim() || undefined : undefined,
      employeeId: user.role === "admin" ? employeeId.trim() || undefined : undefined,
      firstName: isPatient ? firstName.trim() || undefined : undefined,
      lastName: isPatient ? lastName.trim() || undefined : undefined,
      gender: isPatient ? gender : undefined,
      dateOfBirthLabel: isPatient ? dateOfBirth.trim() || undefined : undefined,
      heightCm: isPatient && heightCm.trim() ? Number(heightCm) : undefined,
      weightKg: isPatient && weightKg.trim() ? Number(weightKg) : undefined
    });
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="admin-modal" role="dialog" aria-label="Edit account">
        <div className="therapist-detail-header">
          <strong>Edit account</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form className="admin-modal-form" onSubmit={submit} noValidate>
          {error && (
            <p className="auth-error-banner" role="alert">
              <AlertCircle size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              {error}
            </p>
          )}

          <label>
            Role
            <span className={`badge-pill ${roleTone}`} style={{ width: "fit-content" }}>
              {roleLabel}
            </span>
          </label>

          {isPatient ? (
            <div className="library-toggle-row">
              <label>
                First name
                <input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" />
              </label>
              <label>
                Last name
                <input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" />
              </label>
            </div>
          ) : (
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
            </label>
          )}

          <label>
            {isPatient ? "Phone number" : "Username"}
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" />
          </label>

          {user.role === "therapist" && (
            <>
              <label>
                License number
                <input
                  value={licenseNumber}
                  onChange={(event) => setLicenseNumber(event.target.value)}
                  placeholder="e.g. PT-2024-00123"
                  autoComplete="off"
                />
              </label>
              <div className="library-toggle-row">
                <label>
                  License issued
                  <input
                    type="date"
                    value={licenseIssued}
                    onChange={(event) => setLicenseIssued(event.target.value)}
                  />
                </label>
                <label>
                  License expiry
                  <input
                    type="date"
                    value={licenseExpiry}
                    onChange={(event) => setLicenseExpiry(event.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          {user.role === "admin" && (
            <label>
              Employee ID
              <input
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                placeholder="e.g. EMP-0042"
                autoComplete="off"
              />
            </label>
          )}

          {isPatient && (
            <>
              <div className="library-toggle-row">
                <label>
                  Gender
                  <select
                    className="admin-role-select"
                    value={gender}
                    onChange={(event) => setGender(event.target.value as "male" | "female" | "other" | "unknown")}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <label>
                  Date of birth
                  <input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
                </label>
              </div>
              <div className="library-toggle-row">
                <label>
                  Height (cm)
                  <input
                    type="number"
                    step="0.1"
                    value={heightCm}
                    onChange={(event) => setHeightCm(event.target.value)}
                    placeholder="e.g. 160"
                  />
                </label>
                <label>
                  Weight (kg)
                  <input
                    type="number"
                    step="0.1"
                    value={weightKg}
                    onChange={(event) => setWeightKg(event.target.value)}
                    placeholder="e.g. 58"
                  />
                </label>
              </div>
            </>
          )}

          <button className="primary-button full-width" type="submit">
            Save changes
          </button>
        </form>
      </div>
    </>
  );
}
