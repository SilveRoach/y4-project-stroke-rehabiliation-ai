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
// Every row's display name goes through fallbackDisplayName() below (the same
// `displayName -> first+last -> username -> email/phone -> role label` chain
// AdminSidebar/TherapistSidebar/AdminSettingsPage use for their profile chrome),
// so a partly-filled account never renders a blank Name cell or "?" avatar.
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

import { AlertCircle, ArrowDown, ArrowUp, ChevronRight, Pencil, Plus, Search, Shield, User, UserMinus, UserPlus, Users, X } from "lucide-react";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { AdminSidebar } from "../components/AdminSidebar";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { ApiError, assignPatient, createUser, getUsers, unassignPatient, updateUserProfile, type AdminUserListItem } from "../services/api";
import { useAuth } from "../store/authStore";
import { useProfilePicture, useOwnProfilePicture } from "../hooks/useProfilePicture";
import { initialsFromName } from "../utils/displayName";
import type { AdminManagedRole, AdminUserSummary, StaffRole } from "../types";

interface AdminUserManagementPageProps {
  onLogout: () => void;
  onNavigateDashboard: () => void;
  onNavigateSettings: () => void;
  // Routes into the shared Exercise Library section (see handleAdminNavigate).
  onNavigateExerciseLibrary: () => void;
}

// Column-header sorting (replaces the old role-filter dropdown): each sortable
// header toggles asc/desc and shows an ArrowUp/ArrowDown indicator.
type UserSortKey = "name" | "role" | "username" | "status" | "lastLogin";
type SortDir = "asc" | "desc";

// Role sort order — mirrors schema.prisma's Role enum (PATIENT, THERAPIST, ADMIN).
const ROLE_SORT_ORDER: Record<AdminUserSummary["role"], number> = {
  patient: 0,
  therapist: 1,
  admin: 2
};

// Status sort order — mirrors schema.prisma's UserStatus enum order
// (active, inactive, suspended). GET /users already collapses
// inactive/suspended into "disabled" (user.service.ts's toAccountStatus),
// so at the UI level this is active → disabled.
const STATUS_SORT_ORDER: Record<AdminUserSummary["status"], number> = {
  active: 0,
  disabled: 1
};

// "Login sort by day": converts the display label back into a comparable
// timestamp. Labels come from backend relativeDateLabel(): "Today",
// "Yesterday", "N days ago", an absolute "12 Aug 2026" date, or "Never".
// Accounts that never logged in sort as the oldest in either direction.
function lastLoginSortKey(label: string): number {
  if (!label || label === "Never") return Number.NEGATIVE_INFINITY;
  const now = Date.now();
  const dayMs = 86_400_000;
  if (label === "Today") return now;
  if (label === "Yesterday") return now - dayMs;
  const daysAgo = label.match(/^(\d+) days? ago$/);
  if (daysAgo) return now - Number(daysAgo[1]) * dayMs;
  const parsed = Date.parse(label);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

// Display-name fallback for a row, mirroring the chrome's own fallback style
// (AdminSidebar/TherapistSidebar: `displayName || username || "Admin"`;
// AdminSettingsPage: `displayName || [firstName, lastName].join(" ") ||
// authDisplayName`). The account table must never render a blank Name cell or a
// bare "?" avatar for a partly-filled profile — patients register with just a
// phone number and Therapist/Admin rows can be created with no name parts at
// all. Chain: displayName -> composed first+last -> username -> email/phone ->
// the role's generic label.
function fallbackDisplayName(profile: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  role: AdminUserSummary["role"];
}): string {
  const composed = [profile.firstName, profile.lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .trim();
  const roleFallback = profile.role === "admin" ? "Admin" : profile.role === "therapist" ? "Therapist" : "Patient";
  return (
    profile.displayName?.trim() ||
    composed ||
    profile.username?.trim() ||
    profile.email?.trim() ||
    profile.phoneNumber?.trim() ||
    roleFallback
  );
}

// AdminUserListItem (services/api.ts, mirrors user.service.ts's UserListItem)
// -> AdminUserSummary (types/index.ts, this page's local row shape). Mostly a
// rename (displayName -> name) plus normalizing `null` to `undefined` for the
// optional fields, same nullability gap CreateAccountModal's onCreated already
// works around. `name` goes through fallbackDisplayName() rather than copying
// `displayName` verbatim, so a row can never render blank.
function toAdminUserSummary(item: AdminUserListItem): AdminUserSummary {
  return {
    id: item.id,
    name: fallbackDisplayName(item),
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
    profilePictureFileId: item.profilePictureFileId ?? undefined,
    gender: item.gender,
    dateOfBirthLabel: item.dateOfBirthLabel ?? undefined,
    heightCm: item.heightCm ?? undefined,
    weightKg: item.weightKg ?? undefined,
    assignedTherapist: item.assignedTherapist ?? null
  };
}

// One account-table avatar cell: resolves the row's profilePictureFileId to a
// blob object URL via the shared useProfilePicture hook (the file lives behind
// the auth'd GET /files/:id/content endpoint, so an <img src> can't point at it
// directly). A hook can't be called per-row in the map callback, hence this
// small wrapper — same avatar-badge pattern as the topbar/sidebar chrome
// (photo when resolved, initials otherwise: no file, still loading, or fetch
// failed).
function UserAvatar({ token, fileId, name }: { token: string | null | undefined; fileId?: string; name: string }) {
  const avatarUrl = useProfilePicture(token, fileId ?? null);
  return (
    <span className={`therapist-avatar admin-avatar${avatarUrl ? " with-photo" : ""}`}>
      {avatarUrl ? <img src={avatarUrl} alt={`${name}'s profile picture`} /> : initialsFromName(name)}
    </span>
  );
}

// Avatar for AccountInfoModal's profile header — same resolution as UserAvatar
// (useProfilePicture → auth'd GET /files/:id/content) but keeping the larger
// admin-info-avatar sizing class. Works for every role: the backend's
// GET /users returns profilePictureFileId for patients, therapists, and admins
// alike (users.profile_picture_file_id).
function InfoModalAvatar({ token, fileId, name }: { token: string | null; fileId?: string | null; name: string }) {
  const avatarUrl = useProfilePicture(token, fileId ?? null);
  return (
    <span className={`therapist-avatar admin-avatar admin-info-avatar${avatarUrl ? " with-photo" : ""}`}>
      {avatarUrl ? <img src={avatarUrl} alt={`${name}'s profile picture`} /> : initialsFromName(name)}
    </span>
  );
}

// Avatar for the assigned-therapist / assignment-picker rows: AccountInfoModal's
// assignedTherapist payload only carries {id, displayName, licenseNumber} — no
// picture file id — so the photo is looked up from the full therapists list
// (GET /users rows, which do include profilePictureFileId) and resolved through
// useProfilePicture. Falls back to initials when the therapist isn't in the
// active list or has no uploaded picture.
function TherapistRowAvatar({
  token,
  therapistId,
  therapistName,
  therapists
}: {
  token: string | null;
  therapistId: string | undefined;
  therapistName: string;
  therapists: AdminUserSummary[];
}) {
  const record = therapists.find((t) => t.id === therapistId);
  const avatarUrl = useProfilePicture(token, record?.profilePictureFileId ?? null);
  return (
    <span className={`therapist-avatar${avatarUrl ? " with-photo" : ""}`}>
      {avatarUrl ? <img src={avatarUrl} alt={`${therapistName}'s profile picture`} /> : initialsFromName(therapistName)}
    </span>
  );
}

export function AdminUserManagementPage({ onLogout, onNavigateDashboard, onNavigateSettings, onNavigateExerciseLibrary }: AdminUserManagementPageProps) {
  const { token, user } = useAuth();
  // Real logged-in admin for the sidebar/topbar profile chrome, same idiom as
  // the patient pages (PatientTodayPage.tsx) — replaces the static
  // data/adminMock.ts "Admin Suda" placeholder.
  const adminDisplayName = user?.displayName || user?.username || "Admin";
  const adminInitials = initialsFromName(adminDisplayName);
  // Real profile picture for the topbar chrome, same idiom as the therapist
  // pages (TherapistPatientsPage/TherapistSessionsPage) and AdminSettingsPage:
  // resolve the logged-in admin's own picture via useOwnProfilePicture, falling
  // back to the initials badge while it loads / when none is uploaded / if the
  // fetch fails. Previously this page's topbar was hardcoded to initials only.
  const adminAvatarUrl = useOwnProfilePicture();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Column-header sorting state (replaces the role-filter dropdown).
  const [sort, setSort] = useState<{ key: UserSortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const toggleSort = (key: UserSortKey) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserSummary | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // --- Account Information popup (replaces row-level action buttons) ---------
  // The whole row opens this popup; edit mode + patient↔therapist assignment
  // management live inside it (reusing the real POST/DELETE therapist-module
  // endpoints and PATCH /users/:id for Patient rows).
  const [infoUser, setInfoUser] = useState<AdminUserSummary | null>(null);
  const [usersReloadKey, setUsersReloadKey] = useState(0);

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
  }, [token, usersReloadKey]);

  // Keep the open AccountInfoModal's snapshot in sync with the refetched users
  // list — assignment changes inside the popup bump usersReloadKey (GET /users
  // refetch), and without this the popup's "Assigned therapist" line would keep
  // showing the pre-change therapist until it was closed and reopened.
  useEffect(() => {
    if (!infoUser) return;
    const fresh = users.find((u) => u.id === infoUser.id);
    if (fresh && fresh !== infoUser) setInfoUser(fresh);
    // Only users is a dependency by design: re-sync whenever the list refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = users.filter((u) => {
      const matchesQuery =
        !query || u.name.toLowerCase().includes(query) || u.username.toLowerCase().includes(query);
      return matchesQuery;
    });

    const dirFactor = sort.dir === "asc" ? 1 : -1;
    return [...matched].sort((a, b) => {
      switch (sort.key) {
        case "role":
          return (ROLE_SORT_ORDER[a.role] - ROLE_SORT_ORDER[b.role]) * dirFactor;
        case "username":
          return a.username.localeCompare(b.username) * dirFactor;
        case "status":
          return (STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]) * dirFactor;
        case "lastLogin":
          return (lastLoginSortKey(a.lastLoginLabel) - lastLoginSortKey(b.lastLoginLabel)) * dirFactor;
        case "name":
        default:
          return a.name.localeCompare(b.name) * dirFactor;
      }
    });
  }, [users, search, sort]);

  const USER_PAGE_SIZE = 8;
  const [userPage, setUserPage] = useState(0);
  // Reset to first page whenever the filter/sort changes
  useEffect(() => { setUserPage(0); }, [filteredUsers]);
  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / USER_PAGE_SIZE));
  const pagedUsers = filteredUsers.slice(userPage * USER_PAGE_SIZE, (userPage + 1) * USER_PAGE_SIZE);


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

  const activeTherapists = users.filter((u) => u.role === "therapist" && u.status === "active");

  return (
    <section className="therapist-shell">
      <AdminSidebar
        activeLabel="Users"
        onNavigate={(label: AdminNavLabel) => {
          if (label === "Dashboard") onNavigateDashboard();
          if (label === "Settings") onNavigateSettings();
          if (label === "Exercise Library") onNavigateExerciseLibrary();
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
                <strong>{adminDisplayName}</strong>
                <small>System Administrator</small>
              </div>
              <span className={`avatar-badge admin-avatar${adminAvatarUrl ? " with-photo" : ""}`}>
                {adminAvatarUrl ? <img src={adminAvatarUrl} alt={`${adminDisplayName}'s profile picture`} /> : adminInitials}
              </span>
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

            <div className="therapist-table-scroll admin-account-list-scroll">
              <table className="therapist-table">
                <thead>
                  <tr>
                    <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Role" sortKey="role" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Username / Phone" sortKey="username" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Last login" sortKey="lastLogin" sort={sort} onSort={toggleSort} />
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
                    // The whole row is the entry point to the Account Information
                    // popup — all per-account actions (edit, patient↔therapist
                    // assignment) live inside that popup now, so the old row-level
                    // Edit / Enable-Disable / Assign-therapist buttons are gone.
                    <tr
                      key={user.id}
                      className="admin-user-row"
                      tabIndex={0}
                      role="button"
                      aria-label={`Open account information for ${user.name}`}
                      onClick={() => {
                        setSuccessMessage(null);
                        setInfoUser(user);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSuccessMessage(null);
                          setInfoUser(user);
                        }
                      }}
                    >
                      <td>
                        <div className="therapist-table-patient">
                          <UserAvatar token={token} fileId={user.profilePictureFileId} name={user.name} />
                          <div>
                            <strong>{user.name}</strong>
                            {typeof user.patientCount === "number" && <small>{user.patientCount} patients</small>}
                            {user.role === "patient" && (
                              <small className={user.assignedTherapist ? "admin-assigned-therapist" : "admin-unassigned-therapist"}>
                                {user.assignedTherapist
                                  ? `Assigned to ${user.assignedTherapist.displayName}`
                                  : "No therapist assigned"}
                              </small>
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
                      <td className="admin-row-open-hint" aria-hidden="true">
                        <ChevronRight size={16} />
                      </td>
                    </tr>
                    ))}
                  {!usersLoading && filteredUsers.length === 0 && (
                    <tr className="admin-table-empty">
                      <td colSpan={6}>
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
                name: fallbackDisplayName({ ...created, role: created.role }),
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

      {infoUser && (
        <AccountInfoModal
          token={token}
          user={infoUser}
          therapists={activeTherapists}
          onClose={() => setInfoUser(null)}
          onUpdated={(updated, persisted) => {
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
            setSuccessMessage(
              persisted
                ? `Account "${updated.username}" updated.`
                : `Account "${updated.username}" updated (local only — PATCH /users/:id doesn't accept an Admin editing a ${updated.role} target yet).`
            );
          }}
          onAssignmentChanged={(message) => {
            setUsersReloadKey((key) => key + 1);
            setSuccessMessage(message);
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

// Modal for assigning a patient to a therapist (Admin User Management).
// Mirrors components/AssignPatientModal.tsx's look & flow (admin-modal shell,
// search box, per-row Assign button) but reversed: pick a THERAPIST for an
// already-known patient, and an admin may assign anyone (POST
// /therapists/:id/patients accepts an admin caller via
// requireSelfTherapistOrAdmin — the same endpoint the therapist dashboard's
// self-assignment flow uses, no duplicate backend work).
function AssignTherapistModal({
  token,
  patient,
  therapists,
  busy,
  onClose,
  onAssign,
  onAssigned
}: {
  token: string | null;
  patient: AdminUserSummary;
  therapists: AdminUserSummary[];
  busy: boolean;
  onClose: () => void;
  // Performs POST /therapists/:therapistId/patients for this patient; throws on failure.
  onAssign: (therapist: AdminUserSummary) => Promise<void>;
  onAssigned: (patientName: string, therapistName: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const filtered = therapists.filter(
    (t) => !query || t.name.toLowerCase().includes(query) || t.username.toLowerCase().includes(query)
  );

  const handleAssign = async (therapist: AdminUserSummary) => {
    setAssignError(null);
    setAssigningId(therapist.id);
    try {
      await onAssign(therapist);
      onAssigned(patient.name, therapist.name);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Couldn't assign the therapist. Please try again.");
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="admin-modal assign-patient-modal" role="dialog" aria-label="Assign therapist to patient">
        <div className="therapist-detail-header">
          <strong>Assign therapist — {patient.name}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <p className="assign-patient-subtitle">
          {patient.assignedTherapist
            ? `Currently assigned to ${patient.assignedTherapist.displayName}. Pick another therapist to reassign (the current assignment is ended first).`
            : "Pick an active therapist account to assign to this patient."}
        </p>

        <div className="therapist-search assign-patient-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or username…"
            aria-label="Search therapists"
            autoFocus
          />
        </div>

        {assignError && (
          <p className="auth-error-banner" role="alert">
            {assignError}
          </p>
        )}

        <div className="assign-patient-list">
          {therapists.length === 0 && <p className="assign-patient-empty">No therapist accounts exist yet.</p>}
          {therapists.length > 0 && filtered.length === 0 && (
            <p className="assign-patient-empty">No therapists match your search.</p>
          )}

          {filtered.map((therapist) => {
            const isCurrent = patient.assignedTherapist?.id === therapist.id;
            return (
              <div className="assign-patient-row" key={therapist.id}>
                <div className="assign-patient-row-info">
                  <TherapistRowAvatar
                    token={token}
                    therapistId={therapist.id}
                    therapistName={therapist.name}
                    therapists={therapists}
                  />
                  <div>
                    <strong>{therapist.name}</strong>
                    <small>
                      {therapist.licenseNumber ? `License ${therapist.licenseNumber}` : therapist.username}
                      {typeof therapist.patientCount === "number" ? ` Â· ${therapist.patientCount} patients` : ""}
                    </small>
                  </div>
                </div>

                <div className="assign-patient-row-actions">
                  {isCurrent ? (
                    <span className="badge-pill good">Current</span>
                  ) : (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy || assigningId !== null}
                      onClick={() => handleAssign(therapist)}
                    >
                      <UserPlus size={13} /> {assigningId === therapist.id ? "Assigning…" : "Assign"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// Sortable table-header cell: shows the column label plus an ArrowUp/ArrowDown
// indicator. Clicking toggles asc ↔ desc for that column (starting asc when a
// different column is first selected).
function SortHeader({
  label,
  sortKey,
  sort,
  onSort
}: {
  label: string;
  sortKey: UserSortKey;
  sort: { key: UserSortKey; dir: SortDir };
  onSort: (key: UserSortKey) => void;
}) {
  const isActive = sort.key === sortKey;
  return (
    <th aria-sort={isActive ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        className={`admin-sort-button${isActive ? " active" : ""}`}
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label.toLowerCase()} (${isActive ? (sort.dir === "asc" ? "currently A→Z / oldest first" : "currently Z→A / newest first") : "ascending"})`}
      >
        {label}
        <span className="admin-sort-arrow">
          {isActive ? (
            sort.dir === "asc" ? (
              <ArrowUp size={12} />
            ) : (
              <ArrowDown size={12} />
            )
          ) : (
            <>
              <ArrowUp size={9} className="admin-sort-arrow-idle-up" />
              <ArrowDown size={9} className="admin-sort-arrow-idle-down" />
            </>
          )}
        </span>
      </button>
    </th>
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
// Account Information popup (mini profile) — the single entry point for managing
// an account from this page (the whole table row opens it; the old row-level
// Edit / Assign-therapist / Unassign buttons moved in here).
//
// View mode → Edit mode → Confirm dialog → Save, per role:
//   Patient   — REAL save via PATCH /users/:id (Admin editing a Patient target,
//               user-management module's updateUserProfile). Also shows the
//               patient's assigned therapist and hosts the assign/unassign
//               management (moved here from the removed row buttons; same real
//               POST/DELETE /therapists/... endpoints the dashboard uses).
//   Therapist — license fields and patient count shown; edits stay client-side
//               only (PATCH /users/:id doesn't accept an Admin editing a
//               Therapist/Admin target yet — same caveat as the old
//               EditAccountModal this replaces).
//   Admin     — employee ID; edits client-side only, same reason.
// Read-only in every role: role, status, last login, email/phone (no PATCH
// support for those yet), patient count (derived from assignments).
function AccountInfoModal({
  token,
  user,
  therapists,
  onClose,
  onUpdated,
  onAssignmentChanged
}: {
  token: string | null;
  user: AdminUserSummary;
  therapists: AdminUserSummary[];
  onClose: () => void;
  onUpdated: (updated: AdminUserSummary, persisted: boolean) => void;
  onAssignmentChanged: (message: string) => void;
}) {
  const isPatient = user.role === "patient";
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Edit-mode form state (same fields/structure as the create form, minus
  // password/role which aren't editable after creation).
  const [displayName, setDisplayName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [firstName, setFirstName] = useState(user.firstName ?? user.name.split(" ")[0] ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? user.name.split(" ").slice(1).join(" "));
   const [gender, setGender] = useState<"male" | "female" | "other" | "unknown">(user.gender ?? "unknown");
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirthLabel ?? "");
  const [heightCm, setHeightCm] = useState(user.heightCm?.toString() ?? "");
  const [weightKg, setWeightKg] = useState(user.weightKg?.toString() ?? "");
  const [licenseNumber, setLicenseNumber] = useState(user.licenseNumber ?? "");
  const [licenseIssued, setLicenseIssued] = useState(user.licenseIssuedLabel ?? "");
  const [licenseExpiry, setLicenseExpiry] = useState(user.licenseExpiryLabel ?? "");
 const [employeeId, setEmployeeId] = useState(user.employeeId ?? "");
const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState<string | null>(null);

 // Patient ↔ therapist assignment management (moved from the removed row buttons).
 const [showAssignModal, setShowAssignModal] = useState(false);
const [assignmentBusy, setAssignmentBusy] = useState(false);
 const [assignmentError, setAssignmentError] = useState<string | null>(null);
 // In-app unassign confirmation (same .admin-info-confirm idiom as the
 // save-changes dialog) instead of the browser's unstyled window.confirm().
 const [unassignConfirmOpen, setUnassignConfirmOpen] = useState(false);

 const roleText = user.role === "admin" ? "Admin" : user.role === "therapist" ? "Therapist" : "Patient";
const roleTone = user.role === "admin" ? "poor" : user.role === "therapist" ? "good" : "fair";

 const startEdit = () => {
    // Re-seed the form from the latest row data each time edit mode is entered.

    setDisplayName(user.name);
    setUsername(user.username);
    setFirstName(user.firstName ?? user.name.split(" ")[0] ?? "");
    setLastName(user.lastName ?? user.name.split(" ").slice(1).join(" "));
    setGender(user.gender ?? "unknown");
    setDateOfBirth(user.dateOfBirthLabel ?? "");
    setHeightCm(user.heightCm?.toString() ?? "");
    setWeightKg(user.weightKg?.toString() ?? "");
    setLicenseNumber(user.licenseNumber ?? "");
    setLicenseIssued(user.licenseIssuedLabel ?? "");
    setLicenseExpiry(user.licenseExpiryLabel ?? "");
    setEmployeeId(user.employeeId ?? "");
    setError(null);
    setMode("edit");
  };

  const cancelEdit = () => {
    setError(null);
    setConfirmOpen(false);
    setMode("view");
  };

  // Patient: real save — PATCH /users/:id (Admin editing a Patient target..
  // Therapist/Admin: local-only save (backend doesn't accept those targets yet),
  // exactly the behavior of the EditAccountModal this replaces.

   const submit = async () => {
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

    if (!token) {
      setError("Your session has expired. Please log in again.");
      return;
    }

    setSubmitting(true);
    try {
      if (isPatient) {
        const { user: updated } = await updateUserProfile(token, user.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          username: username.trim(),
          gender,
          dateOfBirth: dateOfBirth.trim() || undefined,
          heightCm: heightCm.trim() ? Number(heightCm) : undefined,
          weightKg: weightKg.trim() ? Number(weightKg) : undefined
        });
        onUpdated(
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
      } else {
        onUpdated(
          {
            ...user,
            name: displayName.trim(),
            username: username.trim(),
            licenseNumber: licenseNumber.trim() || undefined,
            licenseIssuedLabel: licenseIssued.trim() || undefined,
            licenseExpiryLabel: licenseExpiry.trim() || undefined,
            employeeId: employeeId.trim() || undefined
          },
          false
        );
      }
      setConfirmOpen(false);
      setMode("view");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save changes. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // DELETE /therapists/:id/patients/:patientId — moved here from the removed
  // row-level Unassign button (same endpoint, and same confirm-then-act flow).
  const handleUnassign = async () => {
    if (!token || !user.assignedTherapist) return;
    setUnassignConfirmOpen(false);
    setAssignmentBusy(true);
    setAssignmentError(null);
    try {
      await unassignPatient(token, user.assignedTherapist.id, user.id);
      onAssignmentChanged(`${user.assignedTherapist.displayName} was unassigned from "${user.name}".`);
    } catch (err) {
      setAssignmentError(err instanceof ApiError ? err.message : "Couldn't unassign the therapist. Please try again.");
    } finally {
      setAssignmentBusy(false);
    }
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="admin-modal admin-info-modal" role="dialog" aria-label="Account information">
        <div className="therapist-detail-header">
          <strong>Account information</strong>
          <div className="admin-info-header-actions">
            {mode === "view" ? (
              <button type="button" className="secondary-button admin-info-header-btn" onClick={startEdit}>
                <Pencil size={12} /> Edit
              </button>
            ) : (
              <button type="button" className="secondary-button admin-info-header-btn" onClick={cancelEdit}>
                <X size={12} /> Cancel
              </button>
            )}
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Mini profile header — consistent across roles. The avatar resolves the
            user's profilePictureFileId via useProfilePicture (same idiom as the
            account table's UserAvatar wrapper) so an uploaded photo shows here
            too, with initials as the fallback when unset/loading/failed. */}
        <div className="admin-info-header">
          <InfoModalAvatar token={token} fileId={user.profilePictureFileId} name={user.name} />
          <div className="admin-info-header-text">
            <strong>{user.name}</strong>
            <div className="admin-info-badges">
              <span className={`badge-pill ${roleTone}`}>{roleText}</span>
              <span className={`badge-pill ${user.status === "active" ? "good" : "fair"}`}>
                {user.status === "active" ? "Active" : "Disabled"}
              </span>
            </div>
          </div> 
        </div>

        {mode === "view" ? (
          <>
            <div className="admin-info-grid">
              <div className="admin-info-item">
                <span className="admin-info-label">{isPatient ? "Phone number" : "Username"}</span>
                <span className="admin-info-value">{user.username}</span>
              </div>
              <div className="admin-info-item">
                <span className="admin-info-label">Last login</span>
                <span className="admin-info-value">{user.lastLoginLabel}</span>
              </div>
              {!isPatient && (
                <>
                  <div className="admin-info-item">
                    <span className="admin-info-label">Email</span>
                    <span className="admin-info-value">{user.email ?? "—"}</span>
                  </div>
                  <div className="admin-info-item">
                    <span className="admin-info-label">Contact phone</span>
                    <span className="admin-info-value">{user.phoneNumber ?? "—"}</span>
                  </div>
                </>
              )}
              {user.role === "patient" && (
                <>
                  <div className="admin-info-item">
                    <span className="admin-info-label">Gender</span>
                    <span className="admin-info-value">{user.gender && user.gender !== "unknown" ? user.gender[0].toUpperCase() + user.gender.slice(1) : "Unknown"}</span>
                  </div>
                  <div className="admin-info-item">
                    <span className="admin-info-label">Date of birth</span>
                    <span className="admin-info-value">{user.dateOfBirthLabel ?? "—"}</span>
                  </div>
                  <div className="admin-info-item">
                    <span className="admin-info-label">Height (cm)</span>
                    <span className="admin-info-value">{user.heightCm ?? "—"}</span>
                  </div>
                  <div className="admin-info-item">
                    <span className="admin-info-label">Weight (kg)</span>
                    <span className="admin-info-value">{user.weightKg ?? "—"}</span>
                  </div>
                </>
              )}
              {user.role === "therapist" && (
                <>
                  <div className="admin-info-item">
                    <span className="admin-info-label">License number</span>
                    <span className="admin-info-value">{user.licenseNumber ?? "—"}</span>
                  </div>
                  <div className="admin-info-item">
                    <span className="admin-info-label">License issued</span>
                    <span className="admin-info-value">{user.licenseIssuedLabel ?? "—"}</span>
                  </div>
                  <div className="admin-info-item">
                    <span className="admin-info-label">License expiry</span>
                    <span className="admin-info-value">{user.licenseExpiryLabel ?? "—"}</span>
                  </div>
                  <div className="admin-info-item">
                    <span className="admin-info-label">Patients</span>
                    <span className="admin-info-value">{typeof user.patientCount === "number" ? user.patientCount : "—"}</span>
                  </div>
                </>
              )}
              {user.role === "admin" && (
                <div className="admin-info-item">
                  <span className="admin-info-label">Employee ID</span>
                  <span className="admin-info-value">{user.employeeId ?? "—"}</span>
                </div>
              )}
            </div>

            {/* Patient-only management: assigned therapist (moved from row buttons) */}
            {isPatient && (
              <div className="admin-info-section">
                <strong>Assigned therapist</strong>
                {assignmentError && (
                  <p className="auth-error-banner admin-info-error" role="alert">
                    {assignmentError}
                  </p>
                )}
                {user.assignedTherapist ? (
                  <div className="assign-patient-row">
                    <div className="assign-patient-row-info">
                      <TherapistRowAvatar
                        token={token}
                        therapistId={user.assignedTherapist.id}
                        therapistName={user.assignedTherapist.displayName}
                        therapists={therapists}
                      />
                      <div>
                        <strong>{user.assignedTherapist.displayName}</strong>
                        <small>{user.assignedTherapist.licenseNumber ? `License ${user.assignedTherapist.licenseNumber}` : "Active therapist"}</small>
                      </div>
                    </div>
                    <div className="assign-patient-row-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={assignmentBusy}
                        onClick={() => setUnassignConfirmOpen(true)}
                        title="Unassign this therapist"
                      >
                        <UserMinus size={13} /> {assignmentBusy ? "Working…" : "Unassign"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="assign-patient-row">
                    <div className="assign-patient-row-info">
                      <div>
                        <strong>No therapist assigned</strong>
                        <small>Assign one so this patient can start rehabilitation.</small>
                      </div>
                    </div>
                    <div className="assign-patient-row-actions">
                      <button
                        type="button"
                        className="primary-button"
                        disabled={assignmentBusy}
                        onClick={() => setShowAssignModal(true)}
                      >
                        <UserPlus size={13} /> Assign therapist
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="admin-info-editnote">
              <AlertCircle size={13} />
              Editing enabled for the fields below. Role, status, and last login can't be changed here.
            </div>

            {error && (
              <p className="auth-error-banner admin-info-error" role="alert">
                <AlertCircle size={14} />
                {error}
              </p>
            )}
 

            {isPatient ? (
              <>
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
                <label>
                  Phone number
                  <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" />
                </label>
                <div className="library-toggle-row">
                  <label>
                    Gender
                    <select
                      className="admin-role-select"
                      value={gender}
                      onChange={(e) => setGender(e.target.value as "male" | "female" | "other" | "unknown")}
                    >
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </label>
                  <label>
                    Date of birth
                    <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                  </label>
                </div>
                <div className="library-toggle-row">
                  <label>
                    Height (cm)
                    <input type="number" step="0.1" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="e.g. 160" />
                  </label>
                  <label>
                    Weight (kg)
                    <input type="number" step="0.1" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="e.g. 58" />
                  </label>
                </div>
              </>
            ) : (
              <>
                <label>
                  Display name
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
                </label>
                <label>
                  Username
                  <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
                </label>
              </>
            )}

            {user.role === "therapist" && (
              <>
                <label>
                  License number
                  <input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} placeholder="e.g. PT-2024-00123" autoComplete="off" />
                </label>
                <div className="library-toggle-row">
                  <label>
                    License issued
                    <input type="date" value={licenseIssued} onChange={(e) => setLicenseIssued(e.target.value)} />
                  </label>
                  <label>
                    License expiry
                    <input type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} />
                  </label>
                </div>
              </>
            )}

            {user.role === "admin" && (
              <label>
                Employee ID
                <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="e.g. EMP-0042" autoComplete="off" />
              </label>
            )}

            <div className="admin-info-edit-actions">
              <button type="button" className="secondary-button" onClick={cancelEdit} disabled={submitting}>
                Discard
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => setConfirmOpen(true)}
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Confirm changes"}
              </button>
            </div>
          </>
        )}

        {/* Confirmation dialog — Confirm runs the real save; Cancel keeps editing */}
        {confirmOpen && (
          <>
            <div className="therapist-panel-scrim admin-info-confirm-scrim" onClick={() => setConfirmOpen(false)} />
            <div className="admin-modal admin-info-confirm" role="dialog" aria-label="Confirm account changes">
              <span className="admin-info-confirm-icon">
                <AlertCircle size={20} />
              </span>
              <strong>Save changes?</strong>
              <p>
                Update {isPatient ? `${firstName.trim()} ${lastName.trim()}`.trim() || user.name : user.name}&#39;s
                account information?
              </p>
              <div className="admin-info-confirm-actions">
                <button type="button" className="secondary-button" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                  Cancel
                </button>
                <button type="button" className="primary-button" onClick={submit} disabled={submitting}>
                  {submitting ? "Saving…" : "Confirm & save"}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Unassign confirmation — in-app dialog (same .admin-info-confirm
            idiom as the save-changes dialog), not the browser's unstyled
            window.confirm(). Confirm runs the real DELETE; Cancel keeps the
            assignment untouched. */}
        {unassignConfirmOpen && user.assignedTherapist && (
          <>
            <div className="therapist-panel-scrim admin-info-confirm-scrim" onClick={() => setUnassignConfirmOpen(false)} />
            <div className="admin-modal admin-info-confirm" role="dialog" aria-label="Confirm therapist unassignment">
              <span className="admin-info-confirm-icon">
                <AlertCircle size={20} />
              </span>
              <strong>Unassign therapist?</strong>
              <p>
                Remove {user.assignedTherapist.displayName}&#39;s assignment from &quot;{user.name}&quot;?
                The patient will have no assigned therapist until one is assigned again.
              </p>
              <div className="admin-info-confirm-actions">
                <button type="button" className="secondary-button" onClick={() => setUnassignConfirmOpen(false)} disabled={assignmentBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  style={{ background: "var(--danger, #d33)" }}
                  onClick={handleUnassign}
                  disabled={assignmentBusy}
                >
                  {assignmentBusy ? "Unassigning…" : "Confirm unassign"}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Assignment picker (reuses the same AssignTherapistModal as the old row flow) */}
        {showAssignModal && isPatient && (
          <AssignTherapistModal
            token={token}
            patient={user}
            therapists={therapists}
            busy={assignmentBusy}
            onClose={() => setShowAssignModal(false)}
            onAssign={async (therapist) => {
              if (!token) throw new Error("Your session has expired. Please log in again.");
              setAssignmentBusy(true);
              setAssignmentError(null);
              try {
                // Reassign flow: if the patient already has an active assignment,
                // the backend's POST /therapists/:id/patients refuses to create a
                // second one (ConflictError). Admins may unassign anyone
                // (requireSelfTherapistOrAdmin), so end the current assignment
                // first — exactly what the picker's subtitle promises. The
                // therapist-side flow never hits this branch, so its
                // self-assign-only behavior is unchanged.
                if (user.assignedTherapist) {
                  await unassignPatient(token, user.assignedTherapist.id, user.id);
                }
                await assignPatient(token, therapist.id, user.id);
              } finally {
                setAssignmentBusy(false);
              }
            }}
            onAssigned={(patientName, therapistName) => onAssignmentChanged(`${therapistName} was assigned to "${patientName}".`)}
          />
        )}
      </div>
    </>
  );
}


