import { Pencil, Phone, Save, ShieldCheck, User, X, Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { useProfilePicture, useProfilePictureUpload } from "../hooks/useProfilePicture";
import { ApiError, getUserProfile, updateUserProfile, type UpdateProfilePayload, type UserProfile } from "../services/api";
import { useAuth } from "../store/authStore";
import { initialsFromName } from "../utils/displayName";

// Sidebar "Settings" page — profile + license + contact info, built on
// pages/PatientSettingsPage.tsx's view/edit-toggle layout (avatar circle over a
// bordered two-panel card) but adapted to the `therapists` table's own schema
// instead of `patients`'.
//
// Backed by modules/user-management/*'s new GET/PATCH /users/:id — replaces the
// former data/therapistMock.ts (therapistProfile) import and local-only form
// state, same "wire it to the real backend" pass already done for
// TherapistDashboardPage.tsx / TherapistPatientsPage.tsx / ExerciseLibraryPage.tsx.
// See services/api.ts's UserProfile/updateUserProfile and
// user.service.ts's own comments for the schema gaps this works around:
//   - No `address` column exists on `users`/`therapists` (only `patients.address`
//     does) and no job-title column exists anywhere — the original mock form's
//     "Clinic address" and "Title" fields are dropped entirely rather than kept
//     as dead, never-persisted inputs.
//   - "Display name" is now two real fields (First name / Last name) matching
//     `users.first_name`/`users.last_name`, instead of one freeform field that
//     had nowhere real to save to.
//   - "Therapist since" now reads the real `users.created_at` instead of a
//     hardcoded mock date.
//   - There's no self-service password-change route documented in
//     api-design.md (only an Admin-triggered reset-password flow) — this page
//     doesn't offer one.

interface TherapistSettingsPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
}

interface TherapistProfileForm {
  firstName: string;
  lastName: string;
  licenseNumber: string;
  licenseIssuedDate: string;
  licenseExpiryDate: string;
  email: string;
  phoneNumber: string;
}

function emptyForm(): TherapistProfileForm {
  return {
    firstName: "",
    lastName: "",
    licenseNumber: "",
    licenseIssuedDate: "",
    licenseExpiryDate: "",
    email: "",
    phoneNumber: ""
  };
}

function formFromProfile(profile: UserProfile): TherapistProfileForm {
  return {
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    licenseNumber: profile.licenseNumber ?? "",
    licenseIssuedDate: profile.licenseIssuedDate ?? "",
    licenseExpiryDate: profile.licenseExpiryDate ?? "",
    email: profile.email ?? "",
    phoneNumber: profile.phoneNumber ?? ""
  };
}

function formatDateLabel(iso: string): string {
  if (!iso) return "Not set";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function TherapistSettingsPage({ onLogout, onNavigate }: TherapistSettingsPageProps) {
  const { token, user, updateUser } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<TherapistProfileForm>(emptyForm());
  const [isEditing, setIsEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Snapshot taken when edit mode starts, restored on "Discard changes" — lets
  // fields be edited freely without a cancel undoing more than this pass.
  const beforeEditRef = useRef(form);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    setLoading(true);
    setLoadError(null);

    getUserProfile(token, user.id)
      .then((data) => {
        if (cancelled) return;
        setProfile(data.user);
        setForm(formFromProfile(data.user));
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "Couldn't load your profile. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const updateField = (key: keyof TherapistProfileForm) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const startEditing = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    beforeEditRef.current = form;
    setSaved(false);
    setSaveError(null);
    setIsEditing(true);
  };

  const discardChanges = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setForm(beforeEditRef.current);
    setIsEditing(false);
    setSaveError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isEditing) return;
    if (!token || !user) return;


    const payload: UpdateProfilePayload = {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phoneNumber: form.phoneNumber,
      licenseNumber: form.licenseNumber,
      licenseIssuedDate: form.licenseIssuedDate,
      licenseExpiryDate: form.licenseExpiryDate
    };

    setSaving(true);
    setSaveError(null);
    try {
      const result = await updateUserProfile(token, user.id, payload);
      setProfile(result.user);
      setForm(formFromProfile(result.user));
      // Keeps the sidebar/topbar's name in sync without a re-login.
      updateUser({ displayName: result.user.displayName, profilePictureFileId: result.user.profilePictureFileId });
      setIsEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const displayName = profile?.displayName || user?.displayName || user?.username || "Therapist";

  // --- Profile picture (same flow as PatientSettingsPage): pick -> POST /files
  // -> PATCH /users/:id { profilePictureFileId }; pixels via useProfilePicture.
  const avatarUrl = useProfilePicture(token, profile?.profilePictureFileId ?? null);
  const picUpload = useProfilePictureUpload(token, user?.id ?? null, (updated) => {
    setProfile(updated);
    // Syncs the picture across every sidebar/topbar immediately (auth store).
    updateUser({ profilePictureFileId: updated.profilePictureFileId });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  });

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Settings" onNavigate={onNavigate} onLogout={onLogout} avatarUrl={avatarUrl} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>Settings</h1>
            <p>Profile, license, and contact information</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{displayName}</strong>
                <small>Physical Therapist</small>
              </div>
              <span className={`avatar-badge${avatarUrl ? " with-photo" : ""}`}>
                {avatarUrl ? <img src={avatarUrl} alt={`${displayName}'s profile picture`} /> : initialsFromName(displayName)}
              </span>
            </div>
          </div>
        </header>

        <main className="therapist-main settings-main ps-main">
          {(loadError || saveError || picUpload.uploadError) && (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", marginBottom: 16 }}>
              <p style={{ margin: 0 }}>{loadError ?? saveError ?? picUpload.uploadError}</p>
            </div>
          )}

          {loading ? (
            <p className="pd-empty-note">Loading…</p>
          ) : (
            <form className={`ps-card${isEditing ? " editing" : ""}`} onSubmit={handleSubmit}>
              <div className={`ps-avatar-circle${avatarUrl ? " with-photo" : ""}`}>
                {avatarUrl ? (
                  <img className="ps-avatar-img" src={avatarUrl} alt={`${displayName}'s profile picture`} />
                ) : (
                  initialsFromName(displayName)
                )}
              </div>

              {/* Same real profile-picture upload as PatientSettingsPage: hidden
                  input + camera-button keeps the existing card layout. */}
              <input
                ref={picUpload.inputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={picUpload.handleFileChange}
              />
              <button
                type="button"
                className="ps-avatar-upload"
                onClick={picUpload.openFilePicker}
                disabled={picUpload.uploading}
              >
                <Camera size={13} />{" "}
                {picUpload.uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Upload photo"}
              </button>

              {isEditing && (
                <span className="ps-editing-pill">
                  <Pencil size={12} /> Editing profile
                </span>
              )}

              <div className="ps-panels">
                <section className="ps-panel">
                  <div className="settings-section-heading">
                    <User size={15} /> <strong>Profile</strong>
                  </div>
                  <SettingsField
                    label="First name"
                    value={form.firstName}
                    editing={isEditing}
                    onChange={updateField("firstName")}
                  />
                  <SettingsField
                    label="Last name"
                    value={form.lastName}
                    editing={isEditing}
                    onChange={updateField("lastName")}
                  />
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
                    <p className="ps-field-value">{profile?.createdAtLabel ?? "—"}</p>
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
                </section>
              </div>

              <div className="ps-edit-actions">
                {isEditing ? (
                  <>
                    <button
                      key="therapist-discard-btn"
                      type="button"
                      className="secondary-button"
                      onClick={discardChanges}
                      disabled={saving}
                    >
                      <X size={14} /> Discard changes
                    </button>
                    <button
                      key="therapist-save-btn"
                      type="submit"
                      className="primary-button"
                      disabled={saving}
                    >
                      <Save size={14} /> {saving ? "Saving…" : "Save changes"}
                    </button>
                  </>
                ) : (
                  <>
                    {saved && <span className="ps-saved-note">Saved</span>}
                    <button
                      key="therapist-edit-btn"
                      type="button"
                      className="primary-button"
                      onClick={startEditing}
                    >
                      <Pencil size={14} /> Edit profile
                    </button>
                  </>
                )}
              </div>
            </form>
          )}
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
        <p className="ps-field-value">{displayValue ?? (value || "—")}</p>
      )}
    </div>
  );
}
