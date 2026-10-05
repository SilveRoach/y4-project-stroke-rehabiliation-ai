import { FormEvent, useState } from "react";
import { Lock, Plus, User } from "lucide-react";
import rehabAiImage from "../assets/RehabAIimage.png";
import { useAuth } from "../store/authStore";
import type { Role } from "../types";

interface LoginPageProps {
  onLogin: (role: Role) => void;
  onRegister: () => void;
}

export function LoginPage({ onLogin, onRegister }: LoginPageProps) {
  const { login, status, error, clearError } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);

  const isLoading = status === "loading";
  const identifierMissing = touched && identifier.trim().length === 0;
  const passwordMissing = touched && password.length === 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    clearError();

    if (identifier.trim().length === 0 || password.length === 0) {
      return;
    }

    const authenticatedUser = await login(identifier.trim(), password);
    if (authenticatedUser) {
      onLogin(authenticatedUser.role);
    }
  };

  return (
    <section className="auth-page">
      <div className="auth-shell">
        {/* Desktop-only decorative panel (see .auth-visual's `display: none` base
            rule / 900px override in styles.css) — purely visual, so it's
            aria-hidden; the same heading/subtitle text is still spoken via the
            visually-hidden <h1> and <p className="auth-subtitle"> inside the
            form for screen readers and for phones (where this panel is
            hidden). */}
        <div className="auth-visual" aria-hidden="true">
          <span className="auth-visual-icon auth-visual-icon--plus">
            <Plus size={22} />
          </span>
          <span className="auth-visual-icon auth-visual-icon--circle" />
          <span className="auth-visual-dots" />
          <div className="auth-visual-copy">
            <h2>เข้าสู่ระบบ</h2>
            <p className="auth-subtitle">เข้าสู่ระบบเพื่อเริ่มทำงาน</p>
          </div>
        </div>

        <div className="auth-panel">
          <form className="auth-card" onSubmit={submit} noValidate>
            <h1 className="visually-hidden">เข้าสู่ระบบ</h1>
            <img className="auth-brand-logo" src={rehabAiImage} alt="โลโก้ RehabAI" />
            <p className="auth-brand-name auth-brand-name--login">ระบบฟื้นฟูผู้ป่วยโรคหลอดเลือดสมอง</p>
            {/* Visible only at the 900px+ split-panel layout — on phones the
                heading stays screen-reader-only (h1 above) so the card can go
                straight into the fields, matching the reference. */}
            <p className="auth-heading">เข้าสู่ระบบ</p>

            {error && (
              <p className="auth-error-banner" role="alert">
                {error}
              </p>
            )}

            <label>
              เลขโทรศัพท์หรือชื่อผู้ใช้
              <span className="auth-input-icon">
                <User size={16} />
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="081 234 5678"
                  inputMode="tel"
                  autoComplete="username"
                  aria-invalid={identifierMissing}
                />
              </span>
              {identifierMissing && <span className="field-error">ใส่เลขโทรศัพท์หรือชื่อผู้ใช้</span>}
            </label>
            <label>
              รหัสผ่าน
              <span className="password-field">
                <span className="auth-input-icon">
                  <Lock size={16} />
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="ใส่รหัสผ่าน"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    aria-invalid={passwordMissing}
                  />
                </span>
                <button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? "ซ้อนรหัสผ่าน" : "เเสดงรหัสผ่าน"}
                </button>
              </span>
              {passwordMissing && <span className="field-error">ใส่รหัสผ่าน</span>}
            </label>
            <button className="primary-button" type="submit" disabled={isLoading}>
              {isLoading ? "กำลังเข้าสู่ระบบ\u2026" : "เข้าสู่ระบบ"}
            </button>
            <button type="button" className="link-button" onClick={onRegister} disabled={isLoading}>
              ลงทะเบียนบัญชีผู้ใช้งานใหม่
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}