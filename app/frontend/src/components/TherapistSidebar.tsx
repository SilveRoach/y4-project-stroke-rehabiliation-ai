import { Activity, Dumbbell, Home, Settings, Users } from "lucide-react";
import type { ComponentType } from "react";
import { therapistProfile } from "../data/therapistMock";

// Shared sidebar for every therapist-role page (Dashboard, Patients, Sessions,
// Settings, and Patient Detail). Previously each page copy-pasted its own
// <aside className="therapist-sidebar"> block with a locally-scoped `navItems`
// array; clicking anything other than "Dashboard" just set local highlight state
// and went nowhere. Centralizing it here means every page shares one real
// navigation contract (`onNavigate`) instead of four near-identical stubs
// drifting out of sync — see App.tsx's `handleTherapistNavigate` for where the
// label actually turns into a view change.

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
  return (
    <aside className="therapist-sidebar">
      <div className="therapist-brand">
        <span className="therapist-brand-mark">R</span>
        <div>
          <strong>{therapistProfile.displayName}</strong>
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
        <span className="avatar-badge">{therapistProfile.initials}</span>
        <div>
          <strong>{therapistProfile.displayName}</strong>
          <small>{therapistProfile.title}</small>
        </div>
      </div>

      <button type="button" className="sidebar-link logout" onClick={onLogout}>
        Log out
      </button>
    </aside>
  );
}
