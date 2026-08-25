import type {
  AdminProfile,
  AdminUserSummary,
  RoleDistributionSlice,
  SystemLogEntry,
  WeeklyActivityPoint
} from "../types";

export const adminProfile: AdminProfile = {
  displayName: "Admin Suda",
  title: "System Administrator",
  initials: "SA"
};

export const adminUsers: AdminUserSummary[] = [
  {
    id: "staff-201",
    name: "Dr. Pattarapong Srirak",
    role: "therapist",
    username: "pattarapong",
    status: "active",
    lastLoginLabel: "2 hours ago",
    patientCount: 5
  },
  {
    id: "staff-202",
    name: "Dr. Nattaya Jantarasri",
    role: "therapist",
    username: "nattaya",
    status: "active",
    lastLoginLabel: "Yesterday",
    patientCount: 8
  },
  {
    id: "staff-203",
    name: "Admin Suda",
    role: "admin",
    username: "admin",
    status: "active",
    lastLoginLabel: "1 hour ago"
  },
  {
    id: "staff-204",
    name: "Dr. Chanon Wimonsit",
    role: "therapist",
    username: "chanon",
    status: "disabled",
    lastLoginLabel: "5 days ago",
    patientCount: 3
  },
  // Mock Patient row (UI_MOCKUP_PLAN_NEWDB.md §6 progress note, 2026-08-08) —
  // demonstrates the same Edit-popup pattern for a 3rd account kind. `username`
  // holds her phone number, matching newdb.txt's users.username comment for
  // patients (see AdminUserSummary's comment in types/index.ts). Fields below
  // match the `patients` DBML the user supplied 2026-08-08 (first_name/last_name/
  // gender/date_of_birth/height_cm/weight_kg) — replaces an earlier affectedSide
  // guess sourced from the old schema.prisma Patient model, since this DBML has
  // no affected_side column at all.
  {
    id: "patient-901",
    name: "Ploy Sirichai",
    role: "patient",
    username: "0891234567",
    status: "active",
    lastLoginLabel: "3 hours ago",
    firstName: "Ploy",
    lastName: "Sirichai",
    gender: "female",
    dateOfBirthLabel: "1958-05-12",
    heightCm: 160,
    weightKg: 58
  }
];

export const weeklyActivityData: WeeklyActivityPoint[] = [
  { day: "Mon", sessions: 18, aiCalls: 240 },
  { day: "Tue", sessions: 24, aiCalls: 310 },
  { day: "Wed", sessions: 21, aiCalls: 280 },
  { day: "Thu", sessions: 31, aiCalls: 420 },
  { day: "Fri", sessions: 28, aiCalls: 380 },
  { day: "Sat", sessions: 12, aiCalls: 160 },
  { day: "Sun", sessions: 8, aiCalls: 105 }
];

export const roleDistributionData: RoleDistributionSlice[] = [
  { name: "Patients", value: 18, color: "var(--primary)" },
  { name: "Therapists", value: 4, color: "var(--teal)" },
  { name: "Admins", value: 2, color: "#8b5cf6" }
];

export const systemLogs: SystemLogEntry[] = [
  { level: "info", message: "AI model inference completed \u2014 98.2ms avg", timeLabel: "2 min ago" },
  { level: "warning", message: "High memory usage on pose-estimation service (82%)", timeLabel: "15 min ago" },
  { level: "info", message: "Scheduled backup completed successfully", timeLabel: "1 hour ago" },
  { level: "error", message: "WebSocket timeout \u2014 patient session 4412 disconnected", timeLabel: "2 hours ago" },
  { level: "info", message: "User Dr. Nattaya logged in from 203.154.x.x", timeLabel: "3 hours ago" }
];
