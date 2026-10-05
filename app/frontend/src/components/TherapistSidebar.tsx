import { Activity, Dumbbell, Home, Settings, Users } from "lucide-react";
import type { ComponentType } from "react";
import rehabAiImage from "../assets/RehabAIimage.png";
import { useAuth } from "../store/authStore";
import { useOwnProfilePicture } from "../hooks/useProfilePicture";
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
  // Resolved profile-picture object URL (useProfilePicture) — when present it
  // replaces the initials badge; initials remain the fallback otherwise.
  avatarUrl?: string | null;
}

const navItems: Array<{ icon: ComponentType<{ size?: number }>; label: TherapistNavLabel }> = [
  { icon: Home, label: "Dashboard" },
  { icon: Users, label: "Patients" },
  { icon: Dumbbell, label: "Exercise Library" },
  { icon: Activity, label: "Sessions" },
  { icon: Settings, label: "Settings" }
];

const navLabels: Record<TherapistNavLabel, string> = {
  Dashboard: "แดชบอร์ด",
  Patients: "ผู้ป่วย",
  "Exercise Library": "คลังท่าบริหาร",
  Sessions: "การฝึก",
  Settings: "ตั้งค่า"
};

export function TherapistSidebar({ activeLabel, onNavigate, onLogout, avatarUrl }: TherapistSidebarProps) {
  const { user } = useAuth();
  const displayName = user?.displayName || user?.username || "นักกายภาพบำบัด";
  const initials = initialsFromName(displayName);
  // Resolve the logged-in therapist's own picture from the auth store, so every
  // page sharing this sidebar shows the photo without passing props. Pages that
  // resolve it themselves (patient pages) can still override via the prop.
  const ownAvatarUrl = useOwnProfilePicture();
  const resolvedAvatarUrl = avatarUrl ?? ownAvatarUrl;

  return (
    <aside className="therapist-sidebar">
      <div className="therapist-brand">
        <img className="therapist-brand-mark" src={rehabAiImage} alt="ระบบฟื้นฟูผู้ป่วย" />
        <div>
          <strong>ระบบฟื้นฟูผู้ป่วย</strong>
          <small>นักกายภาพบำบัด</small>
        </div>
      </div>

      <nav aria-label="เมนูนักกายภาพบำบัด" className="therapist-nav">
        {navItems.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            className={`therapist-nav-link ${activeLabel === label ? "active" : ""}`}
            onClick={() => onNavigate(label)}
          >
            <Icon size={17} />
            {navLabels[label]}
          </button>
        ))}
      </nav>

      <div className="therapist-sidebar-profile">
        <span className={`avatar-badge${resolvedAvatarUrl ? " with-photo" : ""}`}>
          {resolvedAvatarUrl ? <img src={resolvedAvatarUrl} alt={`${displayName}'s profile picture`} /> : initials}
        </span>
        <div>
          <strong>{displayName}</strong>
          <small>นักกายภาพบำบัด</small>
        </div>
      </div>

      <button type="button" className="sidebar-link logout" onClick={onLogout}>
        Log out
      </button>
    </aside>
  );
}
