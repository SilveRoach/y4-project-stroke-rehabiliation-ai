import { AlertCircle, Camera, CheckCircle2, LogOut, Pencil, Phone, Save, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import { useProfilePicture, useProfilePictureUpload } from "../hooks/useProfilePicture";
import {
  ApiError,
  getUserProfile,
  updateUserProfile,
  type UpdateProfilePayload,
  type UserProfile
} from "../services/api";
import { useAuth } from "../store/authStore";
import { initialsFromName } from "../utils/displayName";

interface PatientSettingsPageProps {
  onLogout: () => void;
  onNavigate: (label: PatientNavLabel) => void;
}

interface PatientContactForm {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string;
  gender: "male" | "female" | "other" | "unknown";
  email: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

function formatDateLabel(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

const genderLabels: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  unknown: "Not specified"
};

export function PatientSettingsPage({ onLogout, onNavigate }: PatientSettingsPageProps) {
  const { token, user: authUser } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [form, setForm] = useState<PatientContactForm>({
    firstName: "",
    lastName: "",
    phoneNumber: "",
    dateOfBirth: "",
    gender: "unknown",
    email: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: ""
  });

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // --- Profile picture (real upload via the backend files module) ---
  // Flow: pick an image -> POST /files (multer, files module) -> PATCH /users/:id
  // { profilePictureFileId } -> the user row points at the files row. Pixels come
  // back via GET /files/:fileId/content (auth'd fetch -> blob -> object URL),
  // resolved by the shared useProfilePicture hook.
  const profilePicFileId = profile?.profilePictureFileId ?? null;
  const profilePicUrl = useProfilePicture(token, profilePicFileId);
  const picUpload = useProfilePictureUpload(token, authUser?.id ?? null, (updated) => {
    setProfile(updated);
    setSavedSuccess(true);
    window.setTimeout(() => setSavedSuccess(false), 3000);
  });

  const beforeEditRef = useRef(form);

  useEffect(() => {
    if (!token || !authUser) {
      setLoading(false);
      setFetchError("Please log in again to view your settings.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    getUserProfile(token, authUser.id)
      .then((res) => {
        if (!cancelled) {
          const u = res.user;
          setProfile(u);
          const initialForm: PatientContactForm = {
            firstName: u.firstName ?? "",
            lastName: u.lastName ?? "",
            phoneNumber: u.phoneNumber ?? u.username ?? "",
            dateOfBirth: u.dateOfBirth ?? "",
            gender: u.gender ?? "unknown",
            email: u.email ?? "",
            address: u.address ?? "",
            emergencyContactName: u.emergencyContactName ?? "",
            emergencyContactPhone: u.emergencyContactPhone ?? ""
          };
          setForm(initialForm);
          beforeEditRef.current = initialForm;
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err instanceof ApiError ? err.message : "Couldn't load your profile. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, authUser, reloadKey]);

  const updateField = (key: keyof PatientContactForm) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const startEditing = () => {
    beforeEditRef.current = form;
    setSavedSuccess(false);
    setSaveError(null);
    setIsEditing(true);
    // Move focus into the first editable field once the inputs have rendered,
    // so entering edit mode is immediately obvious (keyboard/mobile users
    // land straight in the form instead of hunting for it).
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(".ps-card input, .ps-card select")?.focus();
    });
  };

  const discardChanges = () => {
    setForm(beforeEditRef.current);
    setIsEditing(false);
    setSaveError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !authUser) return;

    setSaving(true);
    setSaveError(null);
    setSavedSuccess(false);

    const payload: UpdateProfilePayload = {
      firstName: form.firstName.trim() || undefined,
      lastName: form.lastName.trim() || undefined,
      phoneNumber: form.phoneNumber.trim() || undefined,
      dateOfBirth: form.dateOfBirth.trim() || undefined,
      gender: form.gender,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
      emergencyContactName: form.emergencyContactName.trim() || undefined,
      emergencyContactPhone: form.emergencyContactPhone.trim() || undefined
    };

    try {
      const res = await updateUserProfile(token, authUser.id, payload);
      const updated = res.user;
      setProfile(updated);
      const updatedForm: PatientContactForm = {
        firstName: updated.firstName ?? "",
        lastName: updated.lastName ?? "",
        phoneNumber: updated.phoneNumber ?? updated.username ?? "",
        dateOfBirth: updated.dateOfBirth ?? "",
        gender: updated.gender ?? "unknown",
        email: updated.email ?? "",
        address: updated.address ?? "",
        emergencyContactName: updated.emergencyContactName ?? "",
        emergencyContactPhone: updated.emergencyContactPhone ?? ""
      };
      setForm(updatedForm);
      beforeEditRef.current = updatedForm;
      setIsEditing(false);
      setSavedSuccess(true);
      window.setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const displayName =
    profile?.displayName ||
    [form.firstName, form.lastName].filter(Boolean).join(" ") ||
    authUser?.displayName ||
    authUser?.username ||
    "Patient";

  const avatarInitials = initialsFromName(displayName);

  return (
    <section className="therapist-shell">
      <PatientSidebar
        activeLabel="Settings"
        onNavigate={onNavigate}
        onLogout={onLogout}
        displayName={displayName}
        avatarInitials={avatarInitials}
        avatarUrl={profilePicUrl}
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
                <strong>{displayName}</strong>
                <small>Patient</small>
              </div>
              <span className={`avatar-badge${profilePicUrl ? " with-photo" : ""}`}>
                {profilePicUrl ? <img src={profilePicUrl} alt={`${displayName}'s profile picture`} /> : avatarInitials}
              </span>
            </div>
          </div>
        </header>

        <main className="therapist-main settings-main patient-page-main ps-main">
          {loading ? (
            <div className="summary-card" role="status">
              <p className="pd-empty-note">Loading your profile…</p>
            </div>
          ) : fetchError ? (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)" }}>
              <p style={{ margin: "0 0 12px", color: "var(--danger, #d33)" }}>{fetchError}</p>
              <button type="button" className="secondary-button" onClick={() => setReloadKey((k) => k + 1)}>
                Try again
              </button>
            </div>
          ) : (
            <form className={`ps-card${isEditing ? " editing" : ""}`} onSubmit={handleSubmit}>
              <div className={`ps-avatar-circle lg${profilePicUrl ? " with-photo" : ""}`}>
                {profilePicUrl ? (
                  <img className="ps-avatar-img" src={profilePicUrl} alt={`${displayName}'s profile picture`} />
                ) : (
                  avatarInitials
                )}
              </div>

              {/* Real profile-picture upload: POST /files -> PATCH /users/:id
                  { profilePictureFileId }. Hidden input + camera-button keeps the
                  existing card layout. */}
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
                {picUpload.uploading
                  ? "Uploading…"
                  : profilePicUrl
                    ? "Change photo"
                    : "Upload photo"}
              </button>

              {isEditing && (
                <span className="ps-editing-pill">
                  <Pencil size={12} /> Editing profile
                </span>
              )}

              {(saveError || picUpload.uploadError) && (
                <div
                  className="summary-card"
                  role="alert"
                  style={{ borderColor: "var(--danger, #d33)", margin: "0 20px 16px", width: "calc(100% - 40px)" }}
                >
                  <p style={{ margin: 0, color: "var(--danger, #d33)", display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertCircle size={16} /> {saveError ?? picUpload.uploadError}
                  </p>
                </div>
              )}

              {savedSuccess && (
                <div
                  className="summary-card"
                  role="status"
                  style={{ borderColor: "var(--primary, #2e7559)", margin: "0 20px 16px", width: "calc(100% - 40px)", background: "rgba(46, 117, 89, 0.08)" }}
                >
                  <p style={{ margin: 0, color: "var(--primary, #2e7559)", display: "flex", alignItems: "center", gap: 6 }}>
                    <CheckCircle2 size={16} /> Profile updated successfully.
                  </p>
                </div>
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
                    <span className="ps-field-label">Gender</span>
                    {isEditing ? (
                      <select
                        className="admin-role-select"
                        style={{ width: "100%", marginTop: 4 }}
                        value={form.gender}
                        onChange={(e) =>
                          setForm((cur) => ({
                            ...cur,
                            gender: e.target.value as PatientContactForm["gender"]
                          }))
                        }
                      >
                        <option value="unknown">Not specified</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    ) : (
                      <p className="ps-field-value">{genderLabels[form.gender] ?? form.gender}</p>
                    )}
                  </div>
                  <div className="ps-field">
                    <span className="ps-field-label">Assigned PT</span>
                    <p className="ps-field-value">
                      {profile?.assignedTherapist
                        ? `${profile.assignedTherapist.displayName}${profile.assignedTherapist.licenseNumber ? ` · ${profile.assignedTherapist.licenseNumber}` : ""}`
                        : "No physical therapist assigned yet"}
                    </p>
                  </div>
                  <div className="ps-field">
                    <span className="ps-field-label">Admission date</span>
                    <p className="ps-field-value">{formatDateLabel(profile?.createdAtIso ?? profile?.createdAtLabel)}</p>
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
                    <button type="button" className="secondary-button" onClick={discardChanges} disabled={saving}>
                      <X size={14} /> Discard changes
                    </button>
                    <button type="submit" className="primary-button" disabled={saving}>
                      <Save size={14} /> {saving ? "Saving…" : "Save changes"}
                    </button>
                  </>
                ) : (
                  <>
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
          )}
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
        <p className="ps-field-value">{displayValue || value || "—"}</p>
      )}
    </div>
  );
}
