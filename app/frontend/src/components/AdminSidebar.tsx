import { Dumbbell, Home, Settings, Users } from "lucide-react";
import type { ComponentType } from "react";
import rehabAiImage from "../assets/RehabAIimage.png";
import { useAuth } from "../store/authStore";
import { useOwnProfilePicture } from "../hooks/useProfilePicture";
import { initialsFromName } from "../utils/displayName";

// Shared sidebar for every admin-role page (Dashboard, Users, Exercise Library,
// Settings). Previously AdminDashboardPage.tsx and AdminUserManagementPage.tsx each
// copy-pasted their own <aside className="therapist-sidebar admin-sidebar">
// block with a locally-scoped two-item `navItems` array and no "Settings" entry
// at all — mirrors the same duplication TherapistSidebar.tsx was written to
// remove on the Therapist side. Centralizing it here means every admin page
// shares one real navigation contract (`onNavigate`) instead of near-identical
// copies drifting out of sync — see App.tsx's `handleAdminNavigate` for where
// the label turns into a view change.
//
// "Exercise Library" routes admins into the therapist-authored Exercise
// Library/AI-workspace section (ExerciseLibraryPage/ExerciseAiPage — those
// pages swap this sidebar in for admins, so the label reappears here with the
// section's active state and gives a way back out).

export type AdminNavLabel = "Dashboard" | "Users" | "Exercise Library" | "Settings";

interface AdminSidebarProps {
  activeLabel: AdminNavLabel;
  onNavigate: (label: AdminNavLabel) => void;
  onLogout: () => void;
  // Resolved profile-picture object URL (useProfilePicture) — when present it
  // replaces the initials badge; initials remain the fallback otherwise.
  avatarUrl?: string | null;
}

const navItems: Array<{ icon: ComponentType<{ size?: number }>; label: AdminNavLabel }> = [
  { icon: Home, label: "Dashboard" },
  { icon: Users, label: "Users" },
  // Same icon the therapist sidebar uses for this section, so the item reads
  // identically for both roles.
  { icon: Dumbbell, label: "Exercise Library" },
  { icon: Settings, label: "Settings" }
];

export function AdminSidebar({ activeLabel, onNavigate, onLogout, avatarUrl }: AdminSidebarProps) {
  // Real logged-in admin from the auth store, mirroring TherapistSidebar.tsx —
  // previously this profile block hardcoded data/adminMock.ts's static
  // "Admin Suda" placeholder regardless of who was actually signed in.
  const { user } = useAuth();
  const displayName = user?.displayName || user?.username || "ผู้ดูแลระบบ";
  const initials = initialsFromName(displayName);
  // Resolve the logged-in admin's own picture from the auth store, mirroring
  // TherapistSidebar.tsx — so every admin page sharing this sidebar shows the
  // photo without the page having to pass `avatarUrl`. Pages that resolve it
  // themselves (AdminSettingsPage, ExerciseLibraryPage) still win via the prop.
  // Initials remain the fallback (no file / still loading / fetch failed).
  const ownAvatarUrl = useOwnProfilePicture();
  const resolvedAvatarUrl = avatarUrl ?? ownAvatarUrl;

  return (
    <aside className="therapist-sidebar admin-sidebar">
      <div className="therapist-brand">
        <img className="therapist-brand-mark" src={rehabAiImage} alt="ระบบฟื้นฟูผู้ป่วย" />
        <div>
          <strong>ระบบฟื้นฟูผู้ป่วย</strong>
          <small>ระบบผู้ดูแล</small>
        </div>
      </div>

      <nav aria-label="เมนูผู้ดูแลระบบ" className="therapist-nav">
        {navItems.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            className={`therapist-nav-link ${activeLabel === label ? "active" : ""}`}
            onClick={() => onNavigate(label)}
          >
            <Icon size={17} />
            {label === "Dashboard" ? "แดชบอร์ด" : label === "Users" ? "จัดการผู้ใช้" : label === "Exercise Library" ? "คลังท่าบริหาร" : "ตั้งค่า"}
          </button>
        ))}
      </nav>

      <div className="therapist-sidebar-profile">
        <span className={`avatar-badge admin-avatar${resolvedAvatarUrl ? " with-photo" : ""}`}>
          {resolvedAvatarUrl ? <img src={resolvedAvatarUrl} alt={`รูปโปรไฟล์ของ ${displayName}`} /> : initials}
        </span>
        <div>
          <strong>{displayName}</strong>
          <small>ผู้ดูแลระบบ</small>
        </div>
      </div>

      <button type="button" className="sidebar-link logout" onClick={onLogout}>
        ออกจากระบบ
      </button>
    </aside>
  );
}
