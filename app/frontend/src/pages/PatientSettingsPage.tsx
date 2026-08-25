import { LogOut, Pencil, Phone, Save, User, X } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import { therapistProfile } from "../data/therapistMock";
import type { PatientProgramDay } from "../types";

// Sidebar/bottom-nav "Settings" page — profile + assigned PT + contact info,
// mirroring pages/TherapistSettingsPage.tsx's stub reasoning (no profile-edit
// endpoint exists for `users`/`patients` yet, so every field here is local
// component state only — saving updates nothing beyond this page's own
// render). Notifications/Language/Security were dropped from this page (no
// longer part of the design) in favor of a view/edit toggle: fields render as
// plain text until "Edit profile" is pressed, matching the two-panel
// Profile+assigned-PT / Contact layout from the reference wireframe. The
// assigned PT (therapistProfile, from data/therapistMock.ts — the same "Dr.
// Pattarapong" who owns this mock patient in therapistMock.ts's patient list)
// is shown read-only; it isn't part of `form` since the patient can't edit it.

interface PatientSettingsPageProps {
  program: PatientProgramDay;
  onLogout: () => void;
  onNavigate: (label: PatientNavLabel) => void;
}

interface PatientContactForm {
  displayName: string;
  phoneNumber: string;
  dateOfBirth: string;
  email: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

// Account creation date ("admission date") — read-only, system-set, so it lives
// outside `form` next to the assigned-PT constant rather than as an editable
// field. Mock value only: no `users`/`patients`.created_at is wired up yet.
const ADMISSION_DATE_ISO = "2026-01-14";

function formatDateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function PatientSettingsPage({ program, onLogout, onNavigate }: PatientSettingsPageProps) {
  const [form, setForm] = useState<PatientContactForm>({
    displayName: `${program.patient.displayName} Rodthong`,
    phoneNumber: program.patient.phoneNumber,
    dateOfBirth: "1959-03-14",
    email: "somchai.r@example.com",
    address: "88/12 Sukhumvit Soi 24, Khlong Toei, Bangkok 10110",
    emergencyContactName: "Ananya Rodthong (spouse)",
    emergencyContactPhone: "0898765432"
  });
  const [isEditing, setIsEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  // Snapshot taken when edit mode starts, restored on "Discard changes" —
  // lets fields be edited freely without a cancel undoing more than this pass.
  const beforeEditRef = useRef(form);

  const updateField = (key: keyof PatientContactForm) => (event: { target: { value: string } }) => {
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
      <PatientSidebar
        activeLabel="Settings"
        onNavigate={onNavigate}
        onLogout={onLogout}
        displayName={form.displayName}
        avatarInitials="SR"
      />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Settings</h1>
            <p>Profile and contact information</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{form.displayName}</strong>
                <small>Patient</small>
              </div>
              <span className="avatar-badge">SR</span>
            </div>
          </div>
        </header>

        <main className="therapist-main settings-main patient-page-main ps-main">
          <form className="ps-card" onSubmit={handleSubmit}>
            <div className="ps-avatar-circle">SR</div>

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
                <SettingsField
                  label="Phone number"
                  value={form.phoneNumber}
                  editing={isEditing}
                  onChange={updateField("phoneNumber")}
                />
                <SettingsField
                  label="Date of birth"
                  type="date"
                  value={form.dateOfBirth}
                  editing={isEditing}
                  onChange={updateField("dateOfBirth")}
                  displayValue={formatDateLabel(form.dateOfBirth)}
                />
                <div className="ps-field">
                  <span className="ps-field-label">Assigned PT</span>
                  <p className="ps-field-value">
                    {therapistProfile.displayName} · {therapistProfile.title}
                  </p>
                </div>
                <div className="ps-field">
                  <span className="ps-field-label">Admission date</span>
                  <p className="ps-field-value">{formatDateLabel(ADMISSION_DATE_ISO)}</p>
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
                  label="Home address"
                  value={form.address}
                  editing={isEditing}
                  onChange={updateField("address")}
                />
                <SettingsField
                  label="Emergency contact name"
                  value={form.emergencyContactName}
                  editing={isEditing}
                  onChange={updateField("emergencyContactName")}
                />
                <SettingsField
                  label="Emergency contact phone"
                  value={form.emergencyContactPhone}
                  editing={isEditing}
                  onChange={updateField("emergencyContactPhone")}
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
                  <button type="button" className="secondary-button" onClick={onLogout}>
                    <LogOut size={14} /> Log out
                  </button>
                  <button type="button" className="primary-button" onClick={startEditing}>
                    <Pencil size={14} /> Edit profile
                  </button>
                </>
              )}
            </div>
          </form>
        </main>
      </div>

      <PatientBottomNav activeLabel="Settings" onNavigate={onNavigate} />
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
