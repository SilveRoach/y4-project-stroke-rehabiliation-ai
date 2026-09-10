import { ClipboardList, History, Home, Settings } from "lucide-react";
import type { ComponentType } from "react";

// Shared desktop sidebar for every patient-role page (Home/Today, Progress,
// History, Settings). Mirrors components/TherapistSidebar.tsx's structure and
// reuses its `.therapist-sidebar`/`.therapist-nav-link`/etc. CSS directly (same
// idiom Admin already uses via `.therapist-sidebar admin-sidebar`) instead of the
// old bespoke `.patient-sidebar` styling, so all three roles now share one visual
// language. Previously each patient page hardcoded its own non-clickable
// <aside>/<nav> pair with no onClick handlers at all — see PatientBottomNav.tsx
// for this component's mobile counterpart, and App.tsx's `handlePatientNavigate`
// for where a clicked label turns into a real view change.

export type PatientNavLabel = "Home" | "Progress" | "History" | "Settings";

export const patientNavItems: Array<{ icon: ComponentType<{ size?: number }>; label: PatientNavLabel }> = [
  { icon: Home, label: "Home" },
  { icon: ClipboardList, label: "Progress" },
  { icon: History, label: "History" },
  { icon: Settings, label: "Settings" }
];

interface PatientSidebarProps {
  activeLabel: PatientNavLabel;
  onNavigate: (label: PatientNavLabel) => void;
  onLogout: () => void;
  displayName: string;
  avatarInitials: string;
  // Resolved profile-picture object URL (useProfilePicture) — when present it
  // replaces the initials badge; initials remain the fallback otherwise.
  avatarUrl?: string | null;
}

export function PatientSidebar({ activeLabel, onNavigate, onLogout, displayName, avatarInitials, avatarUrl }: PatientSidebarProps) {
  return (
    <aside className="therapist-sidebar">
      <div className="therapist-brand">
        <span className="therapist-brand-mark">R</span>
        <div>
          <strong>RehabiAI</strong>
          <small>Patient</small>
        </div>
      </div>

      <nav aria-label="Patient navigation" className="therapist-nav">
        {patientNavItems.map(({ icon: Icon, label }) => (
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
        <span className={`avatar-badge${avatarUrl ? " with-photo" : ""}`}>
          {avatarUrl ? <img src={avatarUrl} alt={`${displayName}'s profile picture`} /> : avatarInitials}
        </span>
        <div>
          <strong>{displayName}</strong>
          <small>Patient</small>
        </div>
      </div>

      <button type="button" className="sidebar-link logout" onClick={onLogout}>
        Log out
      </button>
    </aside>
  );
}
