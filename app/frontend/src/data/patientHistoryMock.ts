import type { PatientHistoryPlan } from "../types";

// Backs the patient's own History page (sidebar "History") — two plans mirroring
// the same shape (and the same patient/exercise identity — Somchai, matching
// data/patientMock.ts's patientProgram.patient) as the Therapist-side
// "patient-101" curated profile in data/patientDetailMock.ts, so the two views of
// the same patient's history stay recognizably consistent with each other.
export const patientHistoryPlans: PatientHistoryPlan[] = [
  {
    id: "plan-101-2",
    name: "Initial Stroke Recovery Plan",
    status: "active",
    startDateLabel: "2026-07-28",
    endDateLabel: "2026-08-17",
    days: [
      {
        status: "completed",
        exercises: [
          { name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 82 },
          { name: "Hand Grip Training", nameTh: "ฝึกกำมือและปล่อยมือ", trackingType: "virtual_grip", score: 74 }
        ]
      },
      {
        status: "completed",
        exercises: [
          { name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 85 },
          { name: "Hand Grip Training", nameTh: "ฝึกกำมือและปล่อยมือ", trackingType: "virtual_grip", score: 79 },
          { name: "Wrist Extension", nameTh: "เหยียดข้อมือ", trackingType: "both", score: 71 }
        ]
      },
      {
        status: "completed",
        exercises: [
          { name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 88 },
          { name: "Hand Grip Training", nameTh: "ฝึกกำมือและปล่อยมือ", trackingType: "virtual_grip", score: 80 }
        ]
      },
      { status: "skipped", exercises: [] },
      {
        status: "in_progress",
        exercises: [{ name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 88 }]
      },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] },
      { status: "pending", exercises: [] }
    ]
  },
  {
    id: "plan-101-1",
    name: "Pre-Assessment Baseline Plan",
    status: "completed",
    startDateLabel: "2026-07-20",
    endDateLabel: "2026-07-26",
    days: [
      {
        status: "completed",
        exercises: [{ name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 62 }]
      },
      {
        status: "completed",
        exercises: [{ name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 65 }]
      },
      {
        status: "completed",
        exercises: [
          { name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 68 },
          { name: "Hand Grip Training", nameTh: "ฝึกกำมือและปล่อยมือ", trackingType: "virtual_grip", score: 60 }
        ]
      },
      {
        status: "completed",
        exercises: [
          { name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 70 },
          { name: "Hand Grip Training", nameTh: "ฝึกกำมือและปล่อยมือ", trackingType: "virtual_grip", score: 63 }
        ]
      },
      {
        status: "completed",
        exercises: [
          { name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 73 },
          { name: "Hand Grip Training", nameTh: "ฝึกกำมือและปล่อยมือ", trackingType: "virtual_grip", score: 66 }
        ]
      },
      {
        status: "completed",
        exercises: [
          { name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 76 },
          { name: "Hand Grip Training", nameTh: "ฝึกกำมือและปล่อยมือ", trackingType: "virtual_grip", score: 69 }
        ]
      },
      {
        status: "completed",
        exercises: [
          { name: "Shoulder Flexion", nameTh: "ยกแขนไปด้านหน้า", trackingType: "pose", score: 80 },
          { name: "Hand Grip Training", nameTh: "ฝึกกำมือและปล่อยมือ", trackingType: "virtual_grip", score: 72 }
        ]
      }
    ]
  }
];
