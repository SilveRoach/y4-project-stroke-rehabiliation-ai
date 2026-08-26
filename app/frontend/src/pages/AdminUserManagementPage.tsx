// Admin User Management page (frontend-design.md §9, route /admin/users).
//
// SCOPE for this pass: the "Create account" flow is REAL for all three roles —
// Therapist, Admin, AND Patient — it calls the already-built backend
// `POST /api/v1/users` (Admin-only, user-management module) via
// `services/api.ts`'s `createUser()`. Therapist/Admin creation collects
// firstName/lastName (required) and email/phoneNumber (optional); Patient
// creation collects firstName/lastName, phone number (the login identifier,
// same convention as self-registration), password, and optionally gender/date
// of birth/height/weight — all matching users.*/patients.* on schema.prisma.
//
// The account LIST is now REAL too — `GET /users` (Admin-only,
// user-management module's new `listUsers()`) via `services/api.ts`'s
// `getUsers()`, fetched on mount. Replaces the former `data/adminMock.ts`
// `adminUsers` seed list entirely; a newly-created account is still prepended
// to local state immediately after `POST /users` succeeds (rather than
// re-fetching the whole list) for a snappier create flow.
//
// "Edit" is now REAL for the Patient row — `PATCH /users/:id` accepts an
// Admin caller editing a Patient target (user-management module's
// `updateUserProfile()`), saving firstName/lastName/phone/gender/dateOfBirth/
// heightCm/weightKg for real. Therapist/Admin rows stay client-side only for
// now — that branch of PATCH /users/:id doesn't accept an Admin-editing-others
// caller yet (see EditAccountModal's comment). Per-row enable/disable is a
// disabled placeholder for the same reason (`PATCH /users/:id/status` doesn't
// exist yet). Admin Dashboard (frontend-design.md §8 — system health panel,
// `/admin/dashboard`) is a separate, already-built page; this page only
// covers §9.

import { AlertCircle, Pencil, Plus, Search, Shield, User, Users, X } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { AdminSidebar } from "../components/AdminSidebar";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { adminProfile } from "../data/adminMock";
import { ApiError, createUser, getUsers, updateUserProfile, type AdminUserListItem } from "../services/api";
import { useAuth } from "../store/authStore";
import type { AdminManagedRole, AdminUserSummary, StaffRole } from "../types";

interface AdminUserManagementPageProps {
  onLogout: () => void;
  onNavigateDashboard: () => void;
  onNavigateSettings: () => void;
}

type RoleFilter = "all" | "patient" | StaffRole;

// AdminUserListItem (services/api.ts, mirrors user.service.ts's UserListItem)
// -> AdminUserSummary (types/index.ts, this page's local row shape). Mostly a
// rename (displayName -> name) plus normalizing `null` to `undefined` for the
// optional fields, same nullability gap CreateAccountModal's onCreated already
// works around.
function toAdminUserSummary(item: AdminUserListItem): AdminUserSummary {
  return {
    id: item.id,
    name: item.displayName,
    role: item.role,
    username: item.username,
    status: item.status,
    lastLoginLabel: item.lastLoginLabel,
    patientCount: item.patientCount,
    licenseNumber: item.licenseNumber ?? undefined,
    licenseIssuedLabel: item.licenseIssuedLabel ?? undefined,
    licenseExpiryLabel: item.licenseExpiryLabel ?? undefined,
    employeeId: item.employeeId ?? undefined,
    firstName: item.firstName ?? undefined,
    lastName: item.lastName ?? undefined,
    email: item.email ?? undefined,
    phoneNumber: item.phoneNumber ?? undefined,
    gender: item.gender,
    dateOfBirthLabel: item.dateOfBirthLabel ?? undefined,
    heightCm: item.heightCm ?? undefined,
    weightKg: item.weightKg ?? undefined
  };
}

export function AdminUserManagementPage({ onLogout, onNavigateDashboard, onNavigateSettings }: AdminUserManagementPageProps) {
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserSummary | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    setUsersLoading(true);
    setUsersError(null);

    getUsers(token)
      .then(({ users: fetched }) => {
        if (!cancelled) setUsers(fetched.map(toAdminUserSummary));
      })
      .catch((err) => {
        if (!cancelled) {
          setUsersError(err instanceof ApiError ? err.message : "Couldn't load accounts. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

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
  const patientCount = users.filter((u) => u.role === "patient").length;
  const activeTherapistCount = users.filter((u) => u.role === "therapist" && u.status === "active").length;
  const activeAdminCount = users.filter((u) => u.role === "admin" && u.status === "active").length;
  const activePatientCount = users.filter((u) => u.role === "patient" && u.status === "active").length;

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
            <StatCard
              icon={<User size={20} />}
              label="Patient accounts"
              value={patientCount}
              change={`${activePatientCount} active`}
              positive
              accent="success"
            />
          </div>

          {successMessage && (
            <p className="auth-error-banner admin-success-banner" role="status">
              {successMessage}
            </p>
          )}

          {usersError && (
            <p className="auth-error-banner" role="alert">
              <AlertCircle size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              {usersError}
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
                  {usersLoading && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "24px 0", color: "var(--text-secondary)" }}>
                        Loading accounts…
                      </td>
                    </tr>
                  )}
                  {!usersLoading &&
                    filteredUsers.map((user) => (
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
                  {!usersLoading && filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "24px 0" }}>
                        {users.length === 0 ? "No accounts yet." : "No accounts match your search."}
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
                // AdminUserSummary types these as `string | undefined` (not
                // `| null`) — normalize here since `created` can carry `null`
                // for the Therapist/Admin branch (CreatedUser's fields come back
                // nullable from Prisma via services/api.ts).
                firstName: created.firstName ?? undefined,
                lastName: created.lastName ?? undefined,
                email: created.email ?? undefined,
                phoneNumber: created.phoneNumber ?? undefined,
                gender: created.gender,
                dateOfBirthLabel: created.dateOfBirthLabel ?? undefined,
                heightCm: created.heightCm ?? undefined,
                weightKg: created.weightKg ?? undefined
              },
              ...prev
            ]);
            setShowCreateForm(false);
            setSuccessMessage(`${roleLabel(created.role)} account "${created.username}" created.`);
          }}
        />
      )}

      {editingUser && (
        <EditAccountModal
          token={token}
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={(updated, persisted) => {
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
            setEditingUser(null);
            setSuccessMessage(
              persisted
                ? `Account "${updated.username}" updated.`
                : `Account "${updated.username}" updated (local only — no PATCH /users/:id endpoint exists yet, see UI_MOCKUP_PLAN_NEWDB.md §5).`
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
    // string | null (not just | undefined) because `submit()` spreads `...user`
    // here straight from CreatedUser (services/api.ts) for every role now —
    // Patient included — and CreatedUser's fields come back nullable from
    // Prisma.
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    gender?: "male" | "female" | "other" | "unknown";
    dateOfBirthLabel?: string | null;
    heightCm?: number | null;
    weightKg?: number | null;
  }) => void;
}) {
  const [role, setRole] = useState<AdminManagedRole>("therapist");
  const isPatient = role === "patient";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseIssued, setLicenseIssued] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  // firstName/lastName: shared by every role now (users.first_name/last_name on
  // schema.prisma covers Therapist/Admin too, not just the `patients` DBML this
  // comment used to describe as Patient-only) — there's no single display-name
  // column for any role, so this replaces the old Therapist/Admin-only
  // `displayName` free-text input.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // Therapist/Admin only — users.email/phone_number. Optional, mirrors the same
  // validation PATCH /users/:id already applies (see user.service.ts).
  const [email, setEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "unknown">("unknown");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("Your session has expired. Please log in again.");
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !username.trim() || password.length === 0) {
      setError(
        isPatient
          ? "Fill in first name, last name, phone number, and password."
          : "Fill in first name, last name, username, and password."
      );
      return;
    }

    setSubmitting(true);
    try {
      // Patient's login identifier is the phone number itself (same convention
      // as self-registration, auth.service.ts's `register()`) — sent as
      // `username` here, same as the Therapist/Admin branch, so the backend's
      // single role branch in user.service.ts's `createAccount()` handles both.
      const { user } = await createUser(token, {
        role,
        username: username.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: !isPatient ? email.trim() || undefined : undefined,
        phoneNumber: !isPatient ? contactPhone.trim() || undefined : undefined,
        gender: isPatient ? gender : undefined,
        dateOfBirth: isPatient ? dateOfBirth.trim() || undefined : undefined,
        heightCm: isPatient && heightCm.trim() ? Number(heightCm) : undefined,
        weightKg: isPatient && weightKg.trim() ? Number(weightKg) : undefined
      });
      // License/Employee ID fields still aren't part of CreateUserPayload — the
      // backend has no columns for them yet (UI_MOCKUP_PLAN_NEWDB.md §5) — so
      // they're merged in locally rather than sent to the API call above. Every
      // other field (firstName/lastName/email/phoneNumber, and now
      // gender/dateOfBirth/heightCm/weightKg for Patient) IS real: `user`
      // already carries the server's echoed-back values (including the derived
      // `displayName`), so no local merge is needed for them.
      onCreated({
        ...user,
        licenseNumber: role === "therapist" ? licenseNumber.trim() || undefined : undefined,
        licenseIssuedLabel: role === "therapist" ? licenseIssued.trim() || undefined : undefined,
        licenseExpiryLabel: role === "therapist" ? licenseExpiry.trim() || undefined : undefined,
        employeeId: role === "admin" ? employeeId.trim() || undefined : undefined,
        dateOfBirthLabel: user.dateOfBirth ?? undefined
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

          <div className="library-toggle-row">
            <label>
              First name
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder={isPatient ? undefined : "e.g. Somsri"}
                autoComplete="given-name"
              />
            </label>
            <label>
              Last name
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder={isPatient ? undefined : "e.g. Rattanakul"}
                autoComplete="family-name"
              />
            </label>
          </div>

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

          {!isPatient && (
            <div className="library-toggle-row">
              <label>
                Email <span className="pd-empty-note" style={{ fontWeight: 400 }}>(optional)</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="e.g. somsri@clinic.example"
                  autoComplete="email"
                />
              </label>
              <label>
                Phone number <span className="pd-empty-note" style={{ fontWeight: 400 }}>(optional)</span>
                <input
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  placeholder="e.g. 0891234567"
                  autoComplete="tel"
                />
              </label>
            </div>
          )}

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
//
// PATIENT ROW: REAL now — calls the backend `PATCH /api/v1/users/:id`
// (user-management module's `updateUserProfile()`, now Admin-editable for a
// Patient target) via `services/api.ts`'s `updateUserProfile()`. Saves
// firstName/lastName/username(=phone)/gender/dateOfBirth/heightCm/weightKg for
// real.
//
// THERAPIST/ADMIN ROWS: still client-side only — Admin editing a
// Therapist/Admin account isn't wired up on the backend yet (only the Patient
// branch of PATCH /users/:id accepts an Admin caller so far), so those two
// branches keep updating local state only, same as before this pass.
function EditAccountModal({
  token,
  user,
  onClose,
  onSave
}: {
  token: string | null;
  user: AdminUserSummary;
  onClose: () => void;
  onSave: (updated: AdminUserSummary, persisted: boolean) => void;
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleLabel = user.role === "admin" ? "Admin" : user.role === "therapist" ? "Therapist" : "Patient";
  const roleTone = user.role === "admin" ? "poor" : user.role === "therapist" ? "good" : "fair";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (isPatient) {
      if (!firstName.trim() || !lastName.trim() || !username.trim()) {
        setError("Fill in first name, last name, and phone number.");
        return;
      }
    } else if (!displayName.trim() || !username.trim()) {
      setError("Fill in display name and username.");
      return;
    }

    if (isPatient) {
      if (!token) {
        setError("Your session has expired. Please log in again.");
        return;
      }
      setSubmitting(true);
      try {
        const { user: updated } = await updateUserProfile(token, user.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          username: username.trim(),
          gender,
          dateOfBirth: dateOfBirth.trim() || undefined,
          heightCm: heightCm.trim() ? Number(heightCm) : undefined,
          weightKg: weightKg.trim() ? Number(weightKg) : undefined
        });
        onSave(
          {
            ...user,
            name: updated.displayName,
            username: updated.username,
            firstName: updated.firstName ?? undefined,
            lastName: updated.lastName ?? undefined,
            gender: updated.gender,
            dateOfBirthLabel: updated.dateOfBirth ?? undefined,
            heightCm: updated.heightCm ?? undefined,
            weightKg: updated.weightKg ?? undefined
          },
          true
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't save changes. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Therapist/Admin — still client-side only, see this component's header comment.
    onSave(
      {
        ...user,
        name: displayName.trim(),
        username: username.trim(),
        licenseNumber: user.role === "therapist" ? licenseNumber.trim() || undefined : undefined,
        licenseIssuedLabel: user.role === "therapist" ? licenseIssued.trim() || undefined : undefined,
        licenseExpiryLabel: user.role === "therapist" ? licenseExpiry.trim() || undefined : undefined,
        employeeId: user.role === "admin" ? employeeId.trim() || undefined : undefined
      },
      false
    );
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

          <button className="primary-button full-width" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>
    </>
  );
}
