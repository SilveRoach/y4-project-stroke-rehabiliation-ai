import type {
  PatientProgressTrend,
  ProgressTrendPoint,
  TherapistPatientSummary,
  TherapistProfile,
  WeeklySessionPoint
} from "../types";

export const therapistProfile: TherapistProfile = {
  displayName: "Dr. Pattarapong",
  title: "Physical Therapist",
  initials: "PT"
};

export const therapistPatients: TherapistPatientSummary[] = [
  {
    id: "patient-101",
    name: "Somchai Rodthong",
    nameTh: "สมชาย รอดทอง",
    age: 67,
    condition: "Ischemic Stroke",
    lastSessionLabel: "Today",
    compliancePercent: 92,
    progressPercent: 78,
    sessionsCompleted: 24,
    standing: "active",
    avatarInitials: "SR",
    summary: "Making excellent progress. High compliance rate."
  },
  {
    id: "patient-102",
    name: "Malee Petcharat",
    nameTh: "มาลี เพชรรัตน์",
    age: 54,
    condition: "Hemorrhagic Stroke",
    lastSessionLabel: "Yesterday",
    compliancePercent: 71,
    progressPercent: 55,
    sessionsCompleted: 16,
    standing: "active",
    avatarInitials: "MP",
    summary: "Making steady progress. High compliance rate."
  },
  {
    id: "patient-103",
    name: "Wanchai Srisuwan",
    nameTh: "วันชัย ศรีสุวรรณ",
    age: 72,
    condition: "TIA Recovery",
    lastSessionLabel: "3 days ago",
    compliancePercent: 88,
    progressPercent: 83,
    sessionsCompleted: 31,
    standing: "active",
    avatarInitials: "WS",
    summary: "Making excellent progress. High compliance rate."
  },
  {
    id: "patient-104",
    name: "Pranom Chaisri",
    nameTh: "ประนอม ไชยศรี",
    age: 61,
    condition: "Ischemic Stroke",
    lastSessionLabel: "1 week ago",
    compliancePercent: 43,
    progressPercent: 34,
    sessionsCompleted: 8,
    standing: "at_risk",
    avatarInitials: "PC",
    summary: "Making slow progress. Compliance needs attention."
  },
  {
    id: "patient-105",
    name: "Nakorn Thipjeen",
    nameTh: "นคร ทิพย์จีน",
    age: 78,
    condition: "Post-Stroke",
    lastSessionLabel: "Today",
    compliancePercent: 96,
    progressPercent: 91,
    sessionsCompleted: 42,
    standing: "active",
    avatarInitials: "NT",
    summary: "Making excellent progress. High compliance rate."
  }
];

export const weeklySessionData: WeeklySessionPoint[] = [
  { day: "Mon", sessions: 4, compliancePercent: 88 },
  { day: "Tue", sessions: 6, compliancePercent: 82 },
  { day: "Wed", sessions: 5, compliancePercent: 91 },
  { day: "Thu", sessions: 7, compliancePercent: 76 },
  { day: "Fri", sessions: 3, compliancePercent: 85 },
  { day: "Sat", sessions: 2, compliancePercent: 94 },
  { day: "Sun", sessions: 1, compliancePercent: 89 }
];

export const progressTrendData: ProgressTrendPoint[] = [
  { week: "Wk 1", score: 42 },
  { week: "Wk 2", score: 51 },
  { week: "Wk 3", score: 58 },
  { week: "Wk 4", score: 63 },
  { week: "Wk 5", score: 71 },
  { week: "Wk 6", score: 78 }
];

// One recovery trend per patient, backing the Dashboard chart's patient
// selector/table-click flow (see PatientProgressTrend's comment in types/index.ts).
// Each series' last point is kept consistent with that patient's
// therapistPatients.progressPercent above.
export const patientProgressTrends: PatientProgressTrend[] = [
  {
    patientId: "patient-101",
    planName: "Initial Stroke Recovery Plan",
    points: [
      { week: "Wk 1", score: 48 },
      { week: "Wk 2", score: 57 },
      { week: "Wk 3", score: 64 },
      { week: "Wk 4", score: 69 },
      { week: "Wk 5", score: 74 },
      { week: "Wk 6", score: 78 }
    ]
  },
  {
    patientId: "patient-102",
    planName: "Hemorrhagic Recovery Plan — Phase 2",
    points: [
      { week: "Wk 1", score: 33 },
      { week: "Wk 2", score: 38 },
      { week: "Wk 3", score: 44 },
      { week: "Wk 4", score: 47 },
      { week: "Wk 5", score: 51 },
      { week: "Wk 6", score: 55 }
    ]
  },
  {
    patientId: "patient-103",
    planName: "TIA Recovery Maintenance Plan",
    points: [
      { week: "Wk 1", score: 52 },
      { week: "Wk 2", score: 61 },
      { week: "Wk 3", score: 68 },
      { week: "Wk 4", score: 74 },
      { week: "Wk 5", score: 79 },
      { week: "Wk 6", score: 83 }
    ]
  },
  {
    patientId: "patient-104",
    planName: "Ischemic Recovery Plan — Restart",
    points: [
      { week: "Wk 1", score: 30 },
      { week: "Wk 2", score: 31 },
      { week: "Wk 3", score: 33 },
      { week: "Wk 4", score: 32 },
      { week: "Wk 5", score: 34 },
      { week: "Wk 6", score: 34 }
    ]
  },
  {
    patientId: "patient-105",
    planName: "Post-Stroke Advanced Plan",
    points: [
      { week: "Wk 1", score: 62 },
      { week: "Wk 2", score: 71 },
      { week: "Wk 3", score: 79 },
      { week: "Wk 4", score: 84 },
      { week: "Wk 5", score: 88 },
      { week: "Wk 6", score: 91 }
    ]
  }
];
