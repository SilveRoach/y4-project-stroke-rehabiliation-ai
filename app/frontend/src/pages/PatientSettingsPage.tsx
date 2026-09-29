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

// Thai short date with a Gregorian year ("22 ก.ย. 2026") — same convention as
// utils/patientToday.ts#viewedMonthLabel (`th-TH-u-ca-gregory`, not the Buddhist era).
function formatDateLabel(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

const genderLabels: Record<string, string> = {
  male: "ชาย",
  female: "หญิง",
  other: "อื่น ๆ",
  unknown: "ไม่ระบุ"
};

// useProfilePicture is shared with the (English) Admin/Therapist settings pages,
// so its client-side error strings stay English there. Map the known ones to Thai
// for display here — same pattern as PatientProgressPage's thaiPeriodLabel.
// Unknown messages (e.g. backend ApiError text) pass through untranslated.
const uploadErrorLabels: Record<string, string> = {
  "Please log in again to change your profile picture.":
    "กรุณาเข้าสู่ระบบอีกครั้งเพื่อเปลี่ยนรูปโปรไฟล์",
  "Please choose an image file (JPG, PNG, etc.).":
    "กรุณาเลือกไฟล์รูปภาพ (JPG, PNG ฯลฯ)",
  "The selected file must be an image.": "ไฟล์ที่เลือกต้องเป็นรูปภาพ",
  "Failed to upload your profile picture. Please try again.":
    "ไม่สามารถอัปโหลดรูปโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง"
};

function thaiUploadError(message: string | null): string | null {
  if (!message) return message;
  return uploadErrorLabels[message] ?? message;
}

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
      setFetchError("กรุณาเข้าสู่ระบบอีกครั้งเพื่อดูการตั้งค่าของคุณ");
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
          setFetchError(err instanceof ApiError ? err.message : "ไม่สามารถโหลดโปรไฟล์ของคุณได้ กรุณาลองใหม่อีกครั้ง");
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

  const startEditing = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    beforeEditRef.current = form;
    setSavedSuccess(false);
    setSaveError(null);
    setIsEditing(true);
    // Move focus into the first editable field once the inputs have rendered,
    // so entering edit mode is immediately obvious (keyboard/mobile users
    // land straight in the form instead of hunting for it).
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(".ps-card input, .ps-card select")?.focus();
      document.querySelector<HTMLInputElement>(".ps-field input, .ps-field select")?.focus();
    });
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
      setSaveError(err instanceof ApiError ? err.message : "ไม่สามารถอัปเดตโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  };

  const displayName =
    profile?.displayName ||
    [form.firstName, form.lastName].filter(Boolean).join(" ") ||
    authUser?.displayName ||
    authUser?.username ||
    "ผู้ป่วย";

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
            <h1>ตั้งค่า</h1>
            <p>ข้อมูลโปรไฟล์และข้อมูลการติดต่อของคุณ</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{displayName}</strong>
                <small>ผู้ป่วย</small>
              </div>
              <span className={`avatar-badge${profilePicUrl ? " with-photo" : ""}`}>
                {profilePicUrl ? <img src={profilePicUrl} alt={`รูปโปรไฟล์ของ ${displayName}`} /> : avatarInitials}
              </span>
            </div>
          </div>
        </header>

        <main className="therapist-main settings-main patient-page-main ps-main">
          {loading ? (
            <div className="summary-card" role="status">
              <p className="pd-empty-note">กำลังโหลดโปรไฟล์ของคุณ…</p>
            </div>
          ) : fetchError ? (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)" }}>
              <p style={{ margin: "0 0 12px", color: "var(--danger, #d33)" }}>{fetchError}</p>
              <button type="button" className="secondary-button" onClick={() => setReloadKey((k) => k + 1)}>
                ลองใหม่
              </button>
            </div>
          ) : (
            <form className={`ps-card${isEditing ? " editing" : ""}`} onSubmit={handleSubmit}>
              <div className={`ps-avatar-circle lg${profilePicUrl ? " with-photo" : ""}`}>
                {profilePicUrl ? (
                  <img className="ps-avatar-img" src={profilePicUrl} alt={`รูปโปรไฟล์ของ ${displayName}`} />
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
                  ? "กำลังอัปโหลด…"
                  : profilePicUrl
                    ? "เปลี่ยนรูปภาพ"
                    : "อัปโหลดรูปภาพ"}
              </button>

              {isEditing && (
                <span className="ps-editing-pill">
                  <Pencil size={12} /> กำลังแก้ไขโปรไฟล์
                </span>
              )}

              {(saveError || picUpload.uploadError) && (
                <div
                  className="summary-card"
                  role="alert"
                  style={{ borderColor: "var(--danger, #d33)", margin: "0 20px 16px", width: "calc(100% - 40px)" }}
                >
                  <p style={{ margin: 0, color: "var(--danger, #d33)", display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertCircle size={16} /> {saveError ?? thaiUploadError(picUpload.uploadError)}
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
                    <CheckCircle2 size={16} /> อัปเดตโปรไฟล์เรียบร้อยแล้ว
                  </p>
                </div>
              )}

              <div className="ps-panels">
                <section className="ps-panel">
                  <div className="settings-section-heading">
                    <User size={15} /> <strong>ข้อมูลส่วนตัว</strong>
                  </div>
                  <SettingsField
                    label="ชื่อ"
                    value={form.firstName}
                    editing={isEditing}
                    onChange={updateField("firstName")}
                  />
                  <SettingsField
                    label="นามสกุล"
                    value={form.lastName}
                    editing={isEditing}
                    onChange={updateField("lastName")}
                  />
                  <SettingsField
                    label="เบอร์โทรศัพท์"
                    value={form.phoneNumber}
                    editing={isEditing}
                    onChange={updateField("phoneNumber")}
                  />
                  <SettingsField
                    label="วันเกิด"
                    type="date"
                    value={form.dateOfBirth}
                    editing={isEditing}
                    onChange={updateField("dateOfBirth")}
                    displayValue={formatDateLabel(form.dateOfBirth)}
                  />
                  <div className="ps-field">
                    <span className="ps-field-label">เพศ</span>
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
                        <option value="unknown">ไม่ระบุ</option>
                        <option value="male">ชาย</option>
                        <option value="female">หญิง</option>
                        <option value="other">อื่น ๆ</option>
                      </select>
                    ) : (
                      <p className="ps-field-value">{genderLabels[form.gender] ?? form.gender}</p>
                    )}
                  </div>
                  <div className="ps-field">
                    <span className="ps-field-label">นักกายภาพบำบัดที่ดูแล</span>
                    <p className="ps-field-value">
                      {profile?.assignedTherapist
                        ? `${profile.assignedTherapist.displayName}${profile.assignedTherapist.licenseNumber ? ` · ${profile.assignedTherapist.licenseNumber}` : ""}`
                        : "ยังไม่มีนักกายภาพบำบัดที่ดูแล"}
                    </p>
                  </div>
                  <div className="ps-field">
                    <span className="ps-field-label">วันที่เข้ารับการรักษา</span>
                    <p className="ps-field-value">{formatDateLabel(profile?.createdAtIso ?? profile?.createdAtLabel)}</p>
                  </div>
                </section>

                <section className="ps-panel">
                  <div className="settings-section-heading">
                    <Phone size={15} /> <strong>ข้อมูลการติดต่อ</strong>
                  </div>
                  <SettingsField
                    label="อีเมล"
                    type="email"
                    value={form.email}
                    editing={isEditing}
                    onChange={updateField("email")}
                  />
                  <SettingsField
                    label="ที่อยู่"
                    value={form.address}
                    editing={isEditing}
                    onChange={updateField("address")}
                  />
                  <SettingsField
                    label="ชื่อผู้ติดต่อฉุกเฉิน"
                    value={form.emergencyContactName}
                    editing={isEditing}
                    onChange={updateField("emergencyContactName")}
                  />
                  <SettingsField
                    label="เบอร์โทรผู้ติดต่อฉุกเฉิน"
                    value={form.emergencyContactPhone}
                    editing={isEditing}
                    onChange={updateField("emergencyContactPhone")}
                  />
                </section>
              </div>

              <div className="ps-edit-actions">
                {isEditing ? (
                  <>
                    <button
                      key="patient-discard-btn"
                      type="button"
                      className="secondary-button"
                      onClick={discardChanges}
                      disabled={saving}
                    >
                      <X size={14} /> ยกเลิกการแก้ไข
                    </button>
                    <button
                      key="patient-save-btn"
                      type="submit"
                      className="primary-button"
                      disabled={saving}
                    >
                      <Save size={14} /> {saving ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      key="patient-logout-btn"
                      type="button"
                      className="secondary-button"
                      onClick={onLogout}
                    >
                      <LogOut size={14} /> ออกจากระบบ
                    </button>
                    <button
                      key="patient-edit-btn"
                      type="button"
                      className="primary-button"
                      onClick={startEditing}
                    >
                      <Pencil size={14} /> แก้ไขโปรไฟล์
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
