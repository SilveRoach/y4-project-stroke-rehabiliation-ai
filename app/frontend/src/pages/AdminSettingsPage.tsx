import { Pencil, Phone, Save, Shield, User, X } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { AdminSidebar } from "../components/AdminSidebar";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { adminProfile } from "../data/adminMock";

// Sidebar "Settings" page — profile + employee ID + contact info, built on
// pages/TherapistSettingsPage.tsx's view/edit-toggle layout (avatar circle over a
// bordered two-panel card, itself built on PatientSettingsPage.tsx) but adapted to
// the `admins` table's own schema instead of `therapists`': employee_id replaces
// license_number/license_issued_date/license_expiry_date, and there's no
// assigned-PT-style read-only relationship field, same as the Therapist version.
// Same stub reasoning as both of those pages (UI_MOCKUP_PLAN_NEWDB.md §2.1): no
// `users`/`user_contacts`/`admins` profile-edit endpoint exists yet, so every
// field is local component state only — saving updates nothing beyond this page's
// own render.

interface AdminSettingsPageProps {
  onLogout: () => void;
  onNavigateDashboard: () => void;
  onNavigateUsers: () => void;
}

interface AdminProfileForm {
  displayName: string;
  title: string;
  employeeId: string;
  email: string;
  phoneNumber: string;
  address: string;
}

// Account creation date (`admins.created_at`) — read-only, system-set, so it lives
// outside `form` next to the employee-ID fields below rather than as an editable
// field. Mock value only: no `admins.created_at` is wired up yet.
const PROFILE_CREATED_ISO = "2022-11-03";

function formatDateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function AdminSettingsPage({ onLogout, onNavigateDashboard, onNavigateUsers }: AdminSettingsPageProps) {
  const [form, setForm] = useState<AdminProfileForm>({
    displayName: adminProfile.displayName,
    title: adminProfile.title,
    employeeId: "EMP-0001",
    email: "suda.admin@rehabclinic.example",
    phoneNumber: "0898765432",
    address: "Bangkok Rehabilitation Center, 45 Phahonyothin Rd, Bangkok 10400"
  });
  const [isEditing, setIsEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  // Snapshot taken when edit mode starts, restored on "Discard changes" — lets
  // fields be edited freely without a cancel undoing more than this pass.
  const beforeEditRef = useRef(form);

  const updateField = (key: keyof AdminProfileForm) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const startEditing = () => {
    beforeEditRef.current = form;
    setSaved(false);
    setIsEditing(true);
  };

  const discardChanges = () => {
    setForm(beforeEditRef.current);
    setIsEditing(false);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    // Stub: no profile-edit endpoint exists yet — this only updates local state
    // (and the "Saved" confirmation resets after a moment) so the form is
    // demoable end to end without pretending a backend call happened.
    setIsEditing(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const handleNavigate = (label: AdminNavLabel) => {
    if (label === "Dashboard") onNavigateDashboard();
    if (label === "Users") onNavigateUsers();
  };

  return (
    <section className="therapist-shell">
      <AdminSidebar activeLabel="Settings" onNavigate={handleNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Settings</h1>
            <p>Profile, employee ID, and contact information</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{form.displayName}</strong>
                <small>{form.title}</small>
              </div>
              <span className="avatar-badge admin-avatar">{adminProfile.initials}</span>
            </div>
          </div>
        </header>

        <main className="therapist-main settings-main ps-main">
          <form className="ps-card" onSubmit={handleSubmit}>
            <div className="ps-avatar-circle">{adminProfile.initials}</div>

            <div className="ps-panels">
              <section className="ps-panel">
                <div className="settings-section-heading">
                  <User size={15} /> <strong>Profile</strong>
                </div>
                <SettingsField
                  label="Display name"
                  value={form.displayName}
                  editing={isEditing}
                  onChange={updateField("displayName")}
                />
                <SettingsField label="Title" value={form.title} editing={isEditing} onChange={updateField("title")} />
                <div className="settings-section-heading">
                  <Shield size={15} /> <strong>Employee</strong>
                </div>
                <SettingsField
                  label="Employee ID"
                  value={form.employeeId}
                  editing={isEditing}
                  onChange={updateField("employeeId")}
                />
                <div className="ps-field">
                  <span className="ps-field-label">Admin since</span>
                  <p className="ps-field-value">{formatDateLabel(PROFILE_CREATED_ISO)}</p>
                </div>
              </section>

              <section className="ps-panel">
                <div className="settings-section-heading">
                  <Phone size={15} /> <strong>Contact Information</strong>
                </div>
                <SettingsField
                  label="Email address"
                  type="email"
                  value={form.email}
                  editing={isEditing}
                  onChange={updateField("email")}
                />
                <SettingsField
                  label="Phone number"
                  value={form.phoneNumber}
                  editing={isEditing}
                  onChange={updateField("phoneNumber")}
                />
                <SettingsField
                  label="Office address"
                  value={form.address}
                  editing={isEditing}
                  onChange={updateField("address")}
                />
              </section>
            </div>

            <div className="ps-edit-actions">
              {isEditing ? (
                <>
                  <button type="button" className="secondary-button" onClick={discardChanges}>
                    <X size={14} /> Discard changes
                  </button>
                  <button type="submit" className="primary-button">
                    <Save size={14} /> Save changes
                  </button>
                </>
              ) : (
                <>
                  {saved && <span className="ps-saved-note">Saved</span>}
                  <button type="button" className="primary-button" onClick={startEditing}>
                    <Pencil size={14} /> Edit profile
                  </button>
                </>
              )}
            </div>
          </form>
        </main>
      </div>
    </section>
  );
}

function SettingsField({
  label,
  value,
  editing,
  onChange,
  type = "text",
  displayValue
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (event: { target: { value: string } }) => void;
  type?: string;
  displayValue?: string;
}) {
  return (
    <div className="ps-field">
      <span className="ps-field-label">{label}</span>
      {editing ? (
        <input type={type} value={value} onChange={onChange} />
      ) : (
        <p className="ps-field-value">{displayValue ?? value}</p>
      )}
    </div>
  );
}
