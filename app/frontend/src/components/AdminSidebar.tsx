import { Settings, Shield, Users } from "lucide-react";
import type { ComponentType } from "react";
import { adminProfile } from "../data/adminMock";

// Shared sidebar for every admin-role page (Dashboard, Users, Settings).
// Previously AdminDashboardPage.tsx and AdminUserManagementPage.tsx each
// copy-pasted their own <aside className="therapist-sidebar admin-sidebar">
// block with a locally-scoped two-item `navItems` array and no "Settings" entry
// at all — mirrors the same duplication TherapistSidebar.tsx was written to
// remove on the Therapist side. Centralizing it here means every admin page
// shares one real navigation contract (`onNavigate`) instead of near-identical
// copies drifting out of sync — see App.tsx's `handleAdminNavigate` for where
// the label turns into a view change.

export type AdminNavLabel = "Dashboard" | "Users" | "Settings";

interface AdminSidebarProps {
  activeLabel: AdminNavLabel;
  onNavigate: (label: AdminNavLabel) => void;
  onLogout: () => void;
}

const navItems: Array<{ icon: ComponentType<{ size?: number }>; label: AdminNavLabel }> = [
  { icon: Shield, label: "Dashboard" },
  { icon: Users, label: "Users" },
  { icon: Settings, label: "Settings" }
];

export function AdminSidebar({ activeLabel, onNavigate, onLogout }: AdminSidebarProps) {
  return (
    <aside className="therapist-sidebar admin-sidebar">
      <div className="therapist-brand">
        <span className="therapist-brand-mark">R</span>
        <div>
          <strong>RehabiAI</strong>
          <small>Admin Console</small>
        </div>
      </div>

      <nav aria-label="Admin navigation" className="therapist-nav">
        {navItems.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            className={`therapist-nav-link ${activeLabel === label ? "active" : ""}`}
            onClick={() => onNavigate(label)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>

      <div className="therapist-sidebar-profile">
        <span className="avatar-badge admin-avatar">{adminProfile.initials}</span>
        <div>
          <strong>{adminProfile.displayName}</strong>
          <small>{adminProfile.title}</small>
        </div>
      </div>

      <button type="button" className="sidebar-link logout" onClick={onLogout}>
        Log out
      </button>
    </aside>
  );
}
