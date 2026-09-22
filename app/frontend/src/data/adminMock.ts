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
  {
    id: "log-1",
    type: "create",
    table: "user",
    objectName: "Dr. Pattarapong Srirak",
    timeLabel: "10 min ago",
    byWho: "Admin Suda",
    level: "info",
    message: "Created therapist user account for Dr. Pattarapong Srirak"
  },
  {
    id: "log-2",
    type: "edit",
    table: "exercise",
    objectName: "Shoulder Abduction v2",
    timeLabel: "45 min ago",
    byWho: "Dr. Nattaya Jantarasri",
    level: "info",
    message: "Updated base criteria targets for Shoulder Abduction v2"
  },
  {
    id: "log-3",
    type: "create",
    table: "exercise",
    objectName: "Bicep Curl with Resistance",
    timeLabel: "2 hours ago",
    byWho: "Dr. Pattarapong Srirak",
    level: "info",
    message: "Created new exercise draft 'Bicep Curl with Resistance'"
  },
  {
    id: "log-4",
    type: "edit",
    table: "user",
    objectName: "Ploy Sirichai",
    timeLabel: "4 hours ago",
    byWho: "Admin Suda",
    level: "info",
    message: "Updated patient demographics and contact number for Ploy Sirichai"
  },
  {
    id: "log-5",
    type: "edit",
    table: "user",
    objectName: "Dr. Chanon Wimonsit",
    timeLabel: "Yesterday",
    byWho: "Admin Suda",
    level: "warning",
    message: "Changed account status to disabled for Dr. Chanon Wimonsit"
  },
  {
    id: "log-6",
    type: "create",
    table: "user",
    objectName: "Somchai Prasert",
    timeLabel: "2 days ago",
    byWho: "Admin Suda",
    level: "info",
    message: "Created patient user account for Somchai Prasert"
  },
  {
    id: "log-7",
    type: "edit",
    table: "exercise",
    objectName: "Finger Tap Coordination",
    timeLabel: "3 days ago",
    byWho: "Dr. Nattaya Jantarasri",
    level: "info",
    message: "Updated difficulty rating and repetitions for Finger Tap Coordination"
  }
];
