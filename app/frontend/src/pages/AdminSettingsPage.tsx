import { AlertCircle, Camera, Pencil, Phone, Save, Shield, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AdminSidebar } from "../components/AdminSidebar";
import { ChangePasswordDialog } from "../components/ChangePasswordDialog";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { useProfilePicture, useProfilePictureUpload } from "../hooks/useProfilePicture";
import { ApiError, getUserProfile, updateUserProfile, type UserProfile } from "../services/api";

import { useAuth } from "../store/authStore";
import { initialsFromName } from "../utils/displayName";

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
  // Routes into the shared Exercise Library section (see handleAdminNavigate).
  onNavigateExerciseLibrary: () => void;
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
  return new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function AdminSettingsPage({ onLogout, onNavigateDashboard, onNavigateUsers, onNavigateExerciseLibrary }: AdminSettingsPageProps) {
  // Real logged-in admin for the topbar/sidebar profile chrome and the form's
  // pre-filled display name — mirrors PatientSettingsPage.tsx's idiom of
  // sourcing the shared chrome from the auth store instead of a static mock.
  const { token, user, updateUser } = useAuth();
  const authDisplayName = user?.displayName || user?.username || "ผู้ดูแลระบบ";

  // --- Real profile picture (same flow as Patient/TherapistSettingsPage) ---
  // The other form fields remain local-only stubs, but the picture is real:
  // GET /users/:id supplies profilePictureFileId, upload goes through
  // POST /files -> PATCH /users/:id, pixels via useProfilePicture.
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [uploadBanner, setUploadBanner] = useState<string | null>(null);

  const [form, setForm] = useState<AdminProfileForm>({
    displayName: authDisplayName,
    title: "ผู้ดูแลระบบ",
    employeeId: "EMP-0001",
    email: "suda.admin@rehabclinic.example",
    phoneNumber: "0898765432",
    address: "ศูนย์ฟื้นฟูสมรรถภาพกรุงเทพฯ ถนนพหลโยธิน กรุงเทพมหานคร 10400"
  });
  const [isEditing, setIsEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    getUserProfile(token, user.id)
      .then((res) => {
        if (!cancelled) setProfile(res.user);
        if (!cancelled) {
          const u = res.user;
          setProfile(u);
          const name = u.displayName || [u.firstName, u.lastName].filter(Boolean).join(" ") || authDisplayName;
          setForm((prev) => ({
            ...prev,
            displayName: name,
            email: u.email ?? prev.email,
            phoneNumber: u.phoneNumber ?? prev.phoneNumber,
            address: u.address ?? prev.address
          }));
        }
      })
      .catch((err) => {
        // The picture is chrome, not the page's core form — a failed load just
        // leaves the initials fallback.
        if (!cancelled && err instanceof ApiError) setUploadBanner(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const avatarUrl = useProfilePicture(token, profile?.profilePictureFileId ?? null);
  const picUpload = useProfilePictureUpload(token, user?.id ?? null, (updated) => {
    setProfile(updated);
    setUploadBanner(null);
  });

  // Snapshot taken when edit mode starts, restored on "Discard changes" — lets
  // fields be edited freely without a cancel undoing more than this pass.
  const beforeEditRef = useRef(form);

  const updateField = (key: keyof AdminProfileForm) => (event: { target: { value: string } }) => {
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
    // Stub: no profile-edit endpoint exists yet — this only updates local state
    // (and the "Saved" confirmation resets after a moment) so the form is
    // demoable end to end without pretending a backend call happened.
    setIsEditing(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
    if (!isEditing) return;
    if (!token || !user) return;

    setSaving(true);
    setSaveError(null);
    try {
      const parts = form.displayName.trim().split(/\s+/);
      const firstName = parts[0] || form.displayName.trim();
      const lastName = parts.slice(1).join(" ") || undefined;

      const res = await updateUserProfile(token, user.id, {
        firstName,
        lastName,
        email: form.email.trim() || undefined,
        phoneNumber: form.phoneNumber.trim() || undefined,
        address: form.address.trim() || undefined
      });
      setProfile(res.user);
      updateUser({ displayName: res.user.displayName, profilePictureFileId: res.user.profilePictureFileId });
      setIsEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "บันทึกข้อมูลโปรไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setSaving(false);
    }
  };


  const handleNavigate = (label: AdminNavLabel) => {
    if (label === "Dashboard") onNavigateDashboard();
    if (label === "Users") onNavigateUsers();
    if (label === "Exercise Library") onNavigateExerciseLibrary();
  };

  return (
    <section className="therapist-shell">
      <AdminSidebar activeLabel="Settings" onNavigate={handleNavigate} onLogout={onLogout} avatarUrl={avatarUrl} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>ตั้งค่า</h1>
            <p>โปรไฟล์ รหัสพนักงาน และข้อมูลติดต่อ</p>
          </div>
        </header>

        <main className="therapist-main settings-main ps-main">
          {(uploadBanner || picUpload.uploadError || saveError) && (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", marginBottom: 16 }}>
              <p style={{ margin: 0, color: "var(--danger, #d33)", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertCircle size={16} /> {uploadBanner ?? picUpload.uploadError ?? saveError}
              </p>
            </div>
          )}

          <form className={`ps-card${isEditing ? " editing" : ""}`} onSubmit={handleSubmit}>
            <div className={`ps-avatar-circle lg${avatarUrl ? " with-photo" : ""}`}>
              {avatarUrl ? (
                <img className="ps-avatar-img" src={avatarUrl} alt={`${form.displayName}'s profile picture`} />
              ) : (
                initialsFromName(form.displayName)
              )}
            </div>

            {/* Same real profile-picture upload as Patient/TherapistSettingsPage. */}
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
              <Camera size={13} /> {picUpload.uploading ? "กำลังอัปโหลด…" : avatarUrl ? "เปลี่ยนรูปภาพ" : "อัปโหลดรูปภาพ"}
            </button>

            {isEditing && (
              <span className="ps-editing-pill">
                <Pencil size={12} /> กำลังแก้ไขโปรไฟล์
              </span>
            )}

            <div className="ps-panels">
              <section className="ps-panel">
                <div className="settings-section-heading">
                  <User size={15} /> <strong>โปรไฟล์</strong>
                </div>
                <SettingsField
                  label="ชื่อที่แสดง"
                  value={form.displayName}
                  editing={isEditing}
                  onChange={updateField("displayName")}
                />
                <SettingsField label="ตำแหน่ง" value={form.title} editing={isEditing} onChange={updateField("title")} />
                <div className="settings-section-heading">
                  <Shield size={15} /> <strong>ข้อมูลพนักงาน</strong>
                </div>
                <SettingsField
                  label="รหัสพนักงาน"
                  value={form.employeeId}
                  editing={isEditing}
                  onChange={updateField("employeeId")}
                />
                <div className="ps-field">
                  <span className="ps-field-label">ผู้ดูแลระบบตั้งแต่</span>
                  <p className="ps-field-value">{formatDateLabel(PROFILE_CREATED_ISO)}</p>
                </div>
              </section>

              <section className="ps-panel">
                <div className="settings-section-heading">
                  <Phone size={15} /> <strong>ข้อมูลติดต่อ</strong>
                </div>
                <SettingsField
                  label="อีเมล"
                  type="email"
                  value={form.email}
                  editing={isEditing}
                  onChange={updateField("email")}
                />
                <SettingsField
                  label="หมายเลขโทรศัพท์"
                  value={form.phoneNumber}
                  editing={isEditing}
                  onChange={updateField("phoneNumber")}
                />
                <SettingsField
                  label="ที่อยู่สำนักงาน"
                  value={form.address}
                  editing={isEditing}
                  onChange={updateField("address")}
                />
              </section>
            </div>

            <div className="ps-edit-actions">
              {isEditing ? (
                <>
                  <button
                    key="admin-discard-btn"
                    type="button"
                    className="secondary-button"
                    onClick={discardChanges}
                    disabled={saving}
                  >
                    <X size={14} /> ยกเลิกการเปลี่ยนแปลง
                  </button>
                  <button
                    key="admin-save-btn"
                    type="submit"
                    className="primary-button"
                    disabled={saving}
                  >
                    <Save size={14} /> {saving ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}
                  </button>
                </>
              ) : (
                <>
                  {saved && <span className="ps-saved-note">บันทึกแล้ว</span>}
                  <button
                    key="admin-edit-btn"
                    type="button"
                    className="primary-button"
                    onClick={startEditing}
                  >
                    <Pencil size={14} /> แก้ไขโปรไฟล์
                  </button>
                  <ChangePasswordDialog token={token} />
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
