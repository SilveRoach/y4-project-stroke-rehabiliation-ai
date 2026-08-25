import { Pencil, Phone, Save, ShieldCheck, User, X } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { therapistProfile } from "../data/therapistMock";

// Sidebar "Settings" page — profile + license + contact info, built on
// pages/PatientSettingsPage.tsx's view/edit-toggle layout (avatar circle over a
// bordered two-panel card) but adapted to the `therapists` table's own schema
// instead of `patients`': license_number/license_issued_date/license_expiry_date
// replace "assigned PT"/"date of birth", and there's no assigned-PT-style
// read-only relationship field since a therapist doesn't have one. Same stub
// reasoning as before (UI_MOCKUP_PLAN_NEWDB.md §2.1): no `users`/`user_contacts`/
// `therapists` profile-edit endpoint exists yet, so every field is local
// component state only — saving updates nothing beyond this page's own render.
// Notifications/Language/Security (this page's old contents) were dropped in
// favor of matching the Patient Settings layout exactly; they weren't backed by
// any schema table anyway (no `notification_preferences`/`language` column
// exists on `users` or `therapists`).

interface TherapistSettingsPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
}

interface TherapistProfileForm {
  displayName: string;
  title: string;
  licenseNumber: string;
  licenseIssuedDate: string;
  licenseExpiryDate: string;
  email: string;
  phoneNumber: string;
  address: string;
}

// Account creation date (`therapists.created_at`) — read-only, system-set, so it
// lives outside `form` next to the license-expiry check below rather than as an
// editable field. Mock value only: no `therapists.created_at` is wired up yet.
const PROFILE_CREATED_ISO = "2023-02-10";

function formatDateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function TherapistSettingsPage({ onLogout, onNavigate }: TherapistSettingsPageProps) {
  const [form, setForm] = useState<TherapistProfileForm>({
    displayName: therapistProfile.displayName,
    title: therapistProfile.title,
    licenseNumber: "PT-48213-BKK",
    licenseIssuedDate: "2014-06-01",
    licenseExpiryDate: "2027-06-01",
    email: "pattarapong.t@rehabclinic.example",
    phoneNumber: "0812345678",
    address: "Bangkok Rehabilitation Center, 45 Phahonyothin Rd, Bangkok 10400"
  });
  const [isEditing, setIsEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  // Snapshot taken when edit mode starts, restored on "Discard changes" — lets
  // fields be edited freely without a cancel undoing more than this pass.
  const beforeEditRef = useRef(form);

  const updateField = (key: keyof TherapistProfileForm) => (event: { target: { value: string } }) => {
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

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Settings" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Settings</h1>
            <p>Profile, license, and contact information</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{form.displayName}</strong>
                <small>{form.title}</small>
              </div>
              <span className="avatar-badge">{therapistProfile.initials}</span>
            </div>
          </div>
        </header>

        <main className="therapist-main settings-main ps-main">
          <form className="ps-card" onSubmit={handleSubmit}>
            <div className="ps-avatar-circle">{therapistProfile.initials}</div>

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
                  <ShieldCheck size={15} /> <strong>License</strong>
                </div>
                <SettingsField
                  label="License number"
                  value={form.licenseNumber}
                  editing={isEditing}
                  onChange={updateField("licenseNumber")}
                />
                <SettingsField
                  label="License issued"
                  type="date"
                  value={form.licenseIssuedDate}
                  editing={isEditing}
                  onChange={updateField("licenseIssuedDate")}
                  displayValue={formatDateLabel(form.licenseIssuedDate)}
                />
                <SettingsField
                  label="License expires"
                  type="date"
                  value={form.licenseExpiryDate}
                  editing={isEditing}
                  onChange={updateField("licenseExpiryDate")}
                  displayValue={formatDateLabel(form.licenseExpiryDate)}
                />
                <div className="ps-field">
                  <span className="ps-field-label">Therapist since</span>
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
                  label="Clinic address"
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
