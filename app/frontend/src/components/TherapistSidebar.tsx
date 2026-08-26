import { Activity, Dumbbell, Home, Settings, Users } from "lucide-react";
import type { ComponentType } from "react";
import { useAuth } from "../store/authStore";
import { initialsFromName } from "../utils/displayName";

// Shared sidebar for every therapist-role page (Dashboard, Patients, Sessions,
// Settings, and Patient Detail). Previously each page copy-pasted its own
// <aside className="therapist-sidebar"> block with a locally-scoped `navItems`
// array; clicking anything other than "Dashboard" just set local highlight state
// and went nowhere. Centralizing it here means every page shares one real
// navigation contract (`onNavigate`) instead of four near-identical stubs
// drifting out of sync — see App.tsx's `handleTherapistNavigate` for where the
// label actually turns into a view change.
//
// Profile display (name/initials) now reads from the real logged-in user via
// useAuth() instead of the static data/therapistMock.ts placeholder — the
// therapist backend module (modules/therapist/*) is wired in, so this no longer
// needs to be mock data. Falls back to "Therapist" if displayName/username are
// both somehow unavailable (shouldn't happen once logged in, but keeps this from
// rendering blank instead of failing loudly elsewhere).

export type TherapistNavLabel = "Dashboard" | "Patients" | "Exercise Library" | "Sessions" | "Settings";

interface TherapistSidebarProps {
  activeLabel: TherapistNavLabel;
  onNavigate: (label: TherapistNavLabel) => void;
  onLogout: () => void;
}

const navItems: Array<{ icon: ComponentType<{ size?: number }>; label: TherapistNavLabel }> = [
  { icon: Home, label: "Dashboard" },
  { icon: Users, label: "Patients" },
  { icon: Dumbbell, label: "Exercise Library" },
  { icon: Activity, label: "Sessions" },
  { icon: Settings, label: "Settings" }
];

export function TherapistSidebar({ activeLabel, onNavigate, onLogout }: TherapistSidebarProps) {
  const { user } = useAuth();
  const displayName = user?.displayName || user?.username || "Therapist";
  const initials = initialsFromName(displayName);

  return (
    <aside className="therapist-sidebar">
      <div className="therapist-brand">
        <span className="therapist-brand-mark">R</span>
        <div>
          <strong>{displayName}</strong>
          <small>นักกายภาพบำบัด</small>
        </div>
      </div>

      <nav aria-label="Therapist navigation" className="therapist-nav">
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
        <span className="avatar-badge">{initials}</span>
        <div>
          <strong>{displayName}</strong>
          <small>Physical Therapist</small>
        </div>
      </div>

      <button type="button" className="sidebar-link logout" onClick={onLogout}>
        Log out
      </button>
    </aside>
  );
}
