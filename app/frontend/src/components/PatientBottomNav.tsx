import { patientNavItems, patientNavLabels } from "./PatientSidebar";
import type { PatientNavLabel } from "./PatientSidebar";

// Mobile counterpart to PatientSidebar.tsx (hidden ≥900px via `.patient-bottom-nav`'s
// existing media query in styles.css — unchanged, just now driven by real
// navigation instead of four dead buttons). Shares `patientNavItems` with the
// sidebar so mobile and desktop can never drift out of sync on labels/icons/order.

interface PatientBottomNavProps {
  activeLabel: PatientNavLabel;
  onNavigate: (label: PatientNavLabel) => void;
}

export function PatientBottomNav({ activeLabel, onNavigate }: PatientBottomNavProps) {
  return (
    <nav className="patient-bottom-nav" aria-label="เมนูสำหรับผู้ป่วย (มือถือ)">
      {patientNavItems.map(({ icon: Icon, label }) => (
        <button
          key={label}
          type="button"
          className={activeLabel === label ? "active" : ""}
          onClick={() => onNavigate(label)}
        >
          <Icon size={22} />
          <span>{patientNavLabels[label]}</span>
        </button>
      ))}
    </nav>
  );
}
