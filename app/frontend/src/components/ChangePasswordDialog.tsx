import { KeyRound, LockKeyhole, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, changeUserPassword } from "../services/api";

interface ChangePasswordDialogProps {
  token: string | null;
}

export function ChangePasswordDialog({ token }: ChangePasswordDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const currentPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    currentPasswordRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) closeDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, saving]);

  const closeDialog = () => {
    if (saving) return;
    setIsOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setChanged(false);
  };

  const openDialog = () => {
    setError(null);
    setChanged(false);
    setIsOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }
    if (!token) {
      setError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
      return;
    }

    setSaving(true);
    try {
      await changeUserPassword(token, { currentPassword, newPassword });
      setChanged(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button type="button" className="secondary-button" onClick={openDialog} disabled={!token}>
        <KeyRound size={14} /> เปลี่ยนรหัสผ่าน
      </button>
      {isOpen &&
        createPortal(
          <div
            className="password-change-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDialog();
            }}
          >
            <section
              className="admin-modal password-change-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="password-change-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="password-change-header">
                <h2 id="password-change-title">
                  <LockKeyhole size={20} /> เปลี่ยนรหัสผ่าน
                </h2>
                <button type="button" className="icon-button" onClick={closeDialog} aria-label="ปิด" disabled={saving}>
                  <X size={18} />
                </button>
              </header>

              {changed ? (
                <>
                  <p className="password-change-success" role="status">เปลี่ยนรหัสผ่านเรียบร้อยแล้ว</p>
                  <div className="password-change-actions">
                    <button type="button" className="primary-button" onClick={closeDialog}>ปิด</button>
                  </div>
                </>
              ) : (
                <form className="admin-modal-form password-change-form" onSubmit={handleSubmit}>
                  <label>
                    รหัสผ่านเดิม
                    <input
                      ref={currentPasswordRef}
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    รหัสผ่านใหม่
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    ยืนยันรหัสผ่านใหม่
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                    />
                  </label>
                  {error && <p className="password-change-error" role="alert">{error}</p>}
                  <div className="password-change-actions">
                    <button type="button" className="secondary-button" onClick={closeDialog} disabled={saving}>ยกเลิก</button>
                    <button type="submit" className="primary-button" disabled={saving}>
                      {saving ? "กำลังบันทึก…" : "บันทึกรหัสผ่าน"}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
