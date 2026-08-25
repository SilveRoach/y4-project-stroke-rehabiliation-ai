import { FormEvent, useState } from "react";
import { Lock, Plus, User } from "lucide-react";
import { useAuth } from "../store/authStore";

interface RegisterPageProps {
  onLogin: () => void;
}

export function RegisterPage({ onLogin }: RegisterPageProps) {
  const { register, status, error, clearError } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState(false);

  const isLoading = status === "loading";
  const phoneMissing = touched && phoneNumber.trim().length === 0;
  const passwordMissing = touched && password.length === 0;
  const confirmMismatch = touched && password.length > 0 && password !== confirmPassword;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    clearError();

    if (phoneNumber.trim().length === 0 || password.length === 0 || password !== confirmPassword) {
      return;
    }

    const success = await register(phoneNumber.trim(), password);
    if (success) {
      onLogin();
    }
  };

  return (
    <section className="auth-page">
      <div className="auth-shell">
        {/* Same desktop-only decorative panel as LoginPage.tsx — see the comment
            there for why it's aria-hidden and how phones/screen readers still
            get this copy. */}
        <div className="auth-visual" aria-hidden="true">
          <span className="auth-visual-icon auth-visual-icon--plus">
            <Plus size={22} />
          </span>
          <span className="auth-visual-icon auth-visual-icon--circle" />
          <span className="auth-visual-dots" />
          <div className="auth-visual-copy">
            <h2>สร้างบัญชีผู้ใช้งาน</h2>
            <p className="auth-subtitle">ผู้ป่วยลงทะเบียนด้วยเบอร์โทรศัพท์</p>
          </div>
        </div>

        <div className="auth-panel">
          <form className="auth-card" onSubmit={submit} noValidate>
            <h1 className="visually-hidden">สร้างบัญชี</h1>
            <p className="auth-brand-name">ระบบฟื้นฟูผู้ป่วยโรคหลอดเลือดสมอง</p>
            <p className="auth-heading">สร้างบัญชี</p>

            {error && (
              <p className="auth-error-banner" role="alert">
                {error}
              </p>
            )}

            <label>
              เบอร์โทรศัพท์
              <span className="auth-input-icon">
                <User size={16} />
                <input
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="081 234 5678"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-invalid={phoneMissing}
                />
              </span>
              {phoneMissing && <span className="field-error">กรุณาใส่เบอร์โทรศัพท์</span>}
            </label>
            <label>
              รหัสผ่าน
              <span className="auth-input-icon">
                <Lock size={16} />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="ตั้งรหัสผ่าน"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={passwordMissing}
                />
              </span>
              {passwordMissing && <span className="field-error">กรุณาตั้งรหัสผ่าน</span>}
            </label>
            <label>
              ยืนยันรหัสผ่าน
              <span className="auth-input-icon">
                <Lock size={16} />
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="ใส่รหัสผ่านอีกครั้ง"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={confirmMismatch}
                />
              </span>
              {confirmMismatch && <span className="field-error">รหัสผ่านไม่ตรงกัน</span>}
            </label>
            <button className="primary-button" type="submit" disabled={isLoading}>
              {isLoading ? "กำลังสร้างบัญชี\u2026" : "สร้างบัญชี"}
            </button>
            <button type="button" className="link-button" onClick={onLogin} disabled={isLoading}>
              มีบัญชีอยู่แล้ว? เข้าสู่ระบบ
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
