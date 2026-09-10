// Therapist module — real Prisma queries backing the Dashboard & Reporting
// endpoints in docs/04-design/api-design.md:
//   GET /therapists/:id/patients
//   GET /therapists/:id/dashboard
//   GET /patients/:id/report
//
// IMPORTANT CONTEXT: an earlier pass claimed this module was "fully implemented"
// but the files were never actually written to disk (app.ts already imported
// from ./therapist.routes, which made the backend fail to even start). This is
// the real first implementation.
//
// SCHEMA GAPS this module works around (documented here once, referenced from
// the functions below rather than repeated everywhere):
//   - No `condition`/diagnosis field anywhere on `patients`. The frontend mockup
//     (data/therapistMock.ts) assumed one existed. Falls back to the patient's
//     current rehabilitation plan's `name` (e.g. "Post-Stroke Gait Recovery"),
//     or a placeholder string if they have no plan at all.
//   - No Thai name field on `users`/`patients`, so `nameTh` is always omitted.
//   - No explicit "active/at_risk" standing column. Derived from recent
//     compliance (see the `standing` calculation inside `buildPatientSummary`
//     below) rather than stored.
//   - "Active Patients" (dashboard stat) is defined here as the count of
//     patients with a currently-*active assignment* to this therapist
//     (`patient_therapist_assignments.status = 'active'`), not a filter on the
//     per-patient "standing" badge shown in the table — those are two different
//     axes (assignment vs. recent compliance) that happen to share the word
//     "active". Flagging this explicitly since the two are easy to conflate.

import { ForbiddenError, NotFoundError, ConflictError } from "../../common/errors";
import { ageFromDate, displayName, initialsFromName, relativeDateLabel, weekdayShortLabel } from "../../common/formatting";
import { prisma } from "../../config/prisma";

// --- Response shapes -------------------------------------------------------
// Mirrors frontend/src/types/index.ts (TherapistPatientSummary, WeeklySessionPoint,
// PatientProgressTrend) and services/api.ts (TherapistDashboardData) field-for-field.
// No shared package between frontend/backend in this repo, so these are kept as
// plain parallel interfaces rather than imported.

export type PatientStanding = "active" | "at_risk";

export interface TherapistPatientSummary {
  id: string;
  name: string;
  username: string;
  email: string | null;
  phoneNumber: string | null;
  accountStatus: string;
  lastLoginLabel: string;
  gender: string;
  dateOfBirth: string | null;
  heightCm: number | null;
  weightKg: number | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  profilePictureFileId: string | null;
  nameTh?: string;
  age: number;
  condition: string;
  lastSessionLabel: string;
  compliancePercent: number;
  progressPercent: number;
  sessionsCompleted: number;
  standing: PatientStanding;
  avatarInitials: string;
  summary: string;
  assignedTherapistId?: string | null;
  assignedTherapistName?: string | null;
}

export interface WeeklySessionPoint {
  day: string;
  sessions: number;
  compliancePercent: number;
}

export interface TherapistDashboardStats {
  activePatients: number;
  sessionsToday: number;
  avgCompliancePercent: number;
  pendingReviews: number;
}

export interface TherapistDashboardData {
  stats: TherapistDashboardStats;
  weeklySessions: WeeklySessionPoint[];
  patients: TherapistPatientSummary[];
}

export interface ProgressTrendPoint {
  week: string;
  score: number;
}

export interface PatientProgressTrend {
  patientId: string;
  planName: string;
  points: ProgressTrendPoint[];
}

// --- Shared internal fetch --------------------------------------------------

const PATIENT_INCLUDE = {
  patient: {
    include: {
      user: true,
      rehabilitationPlans: {
        orderBy: { createdAt: "desc" as const },
        include: {
          scheduleDays: {
            orderBy: { scheduledDate: "asc" as const },
            include: {
              scheduledExercises: {
                include: { performanceResults: true }
              }
            }
          }
        }
      }
    }
  }
};

type AssignedPatient = NonNullable<
  Awaited<ReturnType<typeof fetchAssignedPatients>>[number]["patient"]
>;

async function fetchAssignedPatients(therapistId: string) {
  return prisma.patientTherapistAssignment.findMany({
    where: { therapistId, status: "active" },
    include: PATIENT_INCLUDE
  });
}

/** Compliance threshold below which a patient is flagged "at_risk" in the table. */
const COMPLIANCE_AT_RISK_THRESHOLD = 70;

function pickCurrentPlan(patient: AssignedPatient) {
  const plans = patient.rehabilitationPlans;
  return plans.find((plan) => plan.status === "active") ?? plans[0] ?? null;
}

function buildPatientSummary(patient: AssignedPatient): TherapistPatientSummary {
  const currentPlan = pickCurrentPlan(patient);
  const scheduleDays = currentPlan?.scheduleDays ?? [];

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const dueDays = scheduleDays.filter((day) => day.scheduledDate <= startOfToday);
  const completedDueDays = dueDays.filter((day) => day.status === "completed");
  // No days due yet (plan hasn't started) means nothing's been missed — treat as
  // fully compliant rather than 0%, which would misleadingly flag a brand-new
  // plan as behind before it's even begun.
  const compliancePercent = dueDays.length > 0 ? Math.round((completedDueDays.length / dueDays.length) * 100) : 100;

  const completedDaysOverall = scheduleDays.filter((day) => day.status === "completed");
  const progressPercent = scheduleDays.length > 0 ? Math.round((completedDaysOverall.length / scheduleDays.length) * 100) : 0;

  const lastSessionDate = completedDaysOverall.reduce<Date | null>((latest, day) => {
    if (!latest || day.scheduledDate > latest) return day.scheduledDate;
    return latest;
  }, null);

  const name = displayName({
    firstName: patient.user.firstName,
    lastName: patient.user.lastName,
    username: patient.user.username
  });

  const age = ageFromDate(patient.dateOfBirth) ?? 0;
  const condition = currentPlan?.name ?? "No active rehabilitation plan";
  const standing: PatientStanding = dueDays.length === 0 || compliancePercent >= COMPLIANCE_AT_RISK_THRESHOLD ? "active" : "at_risk";

  return {
    id: patient.userId,
    name,
    username: patient.user.username,
    email: patient.user.email,
    phoneNumber: patient.user.phoneNumber,
    accountStatus: patient.user.status,
    lastLoginLabel: relativeDateLabel(patient.user.lastLoginAt),
    gender: patient.gender,
    dateOfBirth: patient.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    heightCm: patient.heightCm === null ? null : Number(patient.heightCm),
    weightKg: patient.weightKg === null ? null : Number(patient.weightKg),
    address: patient.address,
    emergencyContactName: patient.emergencyContactName,
    emergencyContactPhone: patient.emergencyContactPhone,
    profilePictureFileId: patient.user.profilePictureFileId,
    age,
    condition,
    lastSessionLabel: relativeDateLabel(lastSessionDate),
    compliancePercent,
    progressPercent,
    sessionsCompleted: completedDaysOverall.length,
    standing,
    avatarInitials: initialsFromName(name),
    summary: currentPlan
      ? `${progressPercent}% through "${currentPlan.name}" — ${compliancePercent}% compliance on days due so far.`
      : "No rehabilitation plan has been created for this patient yet.",
    assignedTherapistId: null,
    assignedTherapistName: null
  };
}

// --- GET /therapists/:id/patients ------------------------------------------

export async function getTherapistPatients(therapistId: string): Promise<TherapistPatientSummary[]> {
  const assignments = await fetchAssignedPatients(therapistId);
  return assignments.map((assignment) => buildPatientSummary(assignment.patient));
}

// --- New: GET /patients (search/list all patients, active + disabled) --------
// Returns a lightweight patient list including assignment status (active assignment -> therapist id & name)
export interface PatientListItem {
  id: string;
  name: string;
  displayName: string;
  age: number;
  condition: string;
  lastSessionLabel: string;
  sessionsCompleted: number;
  avatarInitials: string;
  progressPercent: number;
  compliancePercent: number;
  standing: PatientStanding;
  summary: string;
  phoneNumber?: string | null;
  status: "active" | "inactive" | "suspended";
  assignedTherapistId?: string | null;
  assignedTherapistName?: string | null;
}

export async function listAllPatients(q?: string): Promise<PatientListItem[]> {
  // Fetch every patient row, include active assignment if any
  const patients = await prisma.patient.findMany({
    include: {
      user: true,
      rehabilitationPlans: {
        orderBy: { createdAt: "desc" as const },
        include: {
          scheduleDays: {
            orderBy: { scheduledDate: "asc" as const },
            include: {
              scheduledExercises: {
                include: { performanceResults: true }
              }
            }
          }
        }
      },
      therapistAssignments: {
        where: { status: "active" },
        include: { therapist: { include: { user: true } } }
      }
    }
  });

  const normalized = patients.map((p) => {
    const assigned = p.therapistAssignments && p.therapistAssignments.length > 0 ? p.therapistAssignments[0] : null;
    const displayNameStr = displayName({ firstName: p.user.firstName, lastName: p.user.lastName, username: p.user.username });
    const summary = buildPatientSummary(p);

    return {
      ...summary,
      id: p.userId,
      name: displayNameStr,
      displayName: displayNameStr,
      username: p.user.username,
      phoneNumber: p.user.phoneNumber ?? null,
      status: p.user.status as "active" | "inactive" | "suspended",
      assignedTherapistId: assigned ? assigned.therapistId : null,
      assignedTherapistName: assigned ? displayName(assigned.therapist.user) : null
    } as PatientListItem;
  });

  if (q && q.trim().length > 0) {
    const ql = q.trim().toLowerCase();
    return normalized.filter((p) => p.displayName.toLowerCase().includes(ql) || (p.phoneNumber && p.phoneNumber.includes(ql)));
  }
  return normalized;
}

// --- GET /therapists/:id/dashboard ------------------------------------------

const WEEKLY_CHART_DAYS = 7;

export async function getTherapistDashboard(therapistId: string): Promise<TherapistDashboardData> {
  const assignments = await fetchAssignedPatients(therapistId);
  const patients = assignments.map((assignment) => buildPatientSummary(assignment.patient));
  const patientIds = assignments.map((assignment) => assignment.patientId);

  const stats = await computeDashboardStats(patientIds, patients);
  const weeklySessions = await computeWeeklySessions(patientIds);

  return { stats, weeklySessions, patients };
}

// --- New: assignPatient — creates an active assignment for a patient ---------
// Ensures no other active assignment exists for the patient; returns the newly
// built TherapistPatientSummary for the assigned patient so callers can update UI.
export async function assignPatient(therapistId: string, patientId: string, assignedById: string): Promise<TherapistPatientSummary> {
  // Check for an existing *active* assignment for this patient
  const existing = await prisma.patientTherapistAssignment.findFirst({ where: { patientId, status: "active" } });
  if (existing) {
    throw new ConflictError("This patient is already assigned to a therapist.");
  }

  // Create the assignment row
  await prisma.patientTherapistAssignment.create({
    data: {
      patientId,
      therapistId,
      status: "active",
      assignedBy: assignedById
    }
  });

  // Fetch the patient's data in the same shape that buildPatientSummary expects
  const patient = await prisma.patient.findUnique({
    where: { userId: patientId },
    include: {
      user: true,
      rehabilitationPlans: {
        orderBy: { createdAt: "desc" as const },
        include: {
          scheduleDays: {
            orderBy: { scheduledDate: "asc" as const },
            include: {
              scheduledExercises: {
                include: { performanceResults: true }
              }
            }
          }
        }
      }
    }
  });

  if (!patient) throw new NotFoundError("Patient not found.");
  // Build and return the TherapistPatientSummary the frontend expects
  return buildPatientSummary(patient as AssignedPatient);
}

// --- New: unassignPatient — ends the patient's ACTIVE assignment ---------------
// Only the therapist who owns the active assignment (self-unassign) or an admin
// (authorization handled by the controller's requireSelfTherapistOrAdmin) may
// end it. Sets status='ended' + ended_at/ended_by so the assignment history in
// patient_therapist_assignments is preserved (the partial unique index added in
// the fix_patient_therapist_assignment_unique migration allows unlimited
// 'ended' rows per patient while still enforcing one active assignment).
export async function unassignPatient(therapistId: string, patientId: string, endedById: string): Promise<void> {
  const active = await prisma.patientTherapistAssignment.findFirst({
    where: { patientId, status: "active" }
  });
  if (!active) {
    throw new NotFoundError("This patient has no active therapist assignment.");
  }
  if (active.therapistId !== therapistId) {
    throw new ConflictError("This patient is assigned to a different therapist.");
  }

  await prisma.patientTherapistAssignment.update({
    where: { id: active.id },
    data: {
      status: "ended",
      endedAt: new Date(),
      endedBy: endedById
    }
  });
}

async function computeDashboardStats(
  patientIds: string[],
  patients: TherapistPatientSummary[]
): Promise<TherapistDashboardStats> {
  if (patientIds.length === 0) {
    return { activePatients: 0, sessionsToday: 0, avgCompliancePercent: 0, pendingReviews: 0 };
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const [sessionsToday, pendingReviews] = await Promise.all([
    prisma.rehabilitationScheduleDay.count({
      where: {
        scheduledDate: { gte: startOfToday, lt: startOfTomorrow },
        rehabilitationPlan: { patientId: { in: patientIds } }
      }
    }),
    // "Pending review" = an attempt the AI has scored but no therapist has
    // reviewed yet (pt_score still null) — matches FR-PT-03's evaluation flow.
    prisma.exercisePerformanceResult.count({
      where: {
        ptScore: null,
        completedAt: { not: null },
        scheduledExercise: {
          scheduleDay: {
            rehabilitationPlan: { patientId: { in: patientIds } }
          }
        }
      }
    })
  ]);

  const avgCompliancePercent =
    patients.length > 0
      ? Math.round(patients.reduce((sum, patient) => sum + patient.compliancePercent, 0) / patients.length)
      : 0;

  return {
    activePatients: patientIds.length,
    sessionsToday,
    avgCompliancePercent,
    pendingReviews
  };
}

async function computeWeeklySessions(patientIds: string[]): Promise<WeeklySessionPoint[]> {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const rangeStart = new Date(startOfToday);
  rangeStart.setDate(rangeStart.getDate() - (WEEKLY_CHART_DAYS - 1));
  const rangeEnd = new Date(startOfToday);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const days =
    patientIds.length > 0
      ? await prisma.rehabilitationScheduleDay.findMany({
          where: {
            scheduledDate: { gte: rangeStart, lt: rangeEnd },
            rehabilitationPlan: { patientId: { in: patientIds } }
          },
          select: { scheduledDate: true, status: true }
        })
      : [];

  const points: WeeklySessionPoint[] = [];
  for (let offset = 0; offset < WEEKLY_CHART_DAYS; offset += 1) {
    const date = new Date(rangeStart);
    date.setDate(date.getDate() + offset);
    const dateKey = date.toDateString();

    const dayRows = days.filter((day) => day.scheduledDate.toDateString() === dateKey);
    const completed = dayRows.filter((day) => day.status === "completed").length;

    points.push({
      day: weekdayShortLabel(date),
      sessions: completed,
      compliancePercent: dayRows.length > 0 ? Math.round((completed / dayRows.length) * 100) : 0
    });
  }

  return points;
}

// --- GET /patients/:id/report ------------------------------------------------

/**
 * Authorization helper for the /patients/:id/report route (and any future
 * route gated by "is this therapist currently assigned to this patient").
 * Throws ForbiddenError rather than returning a boolean so controllers can
 * call it and rely on the thrown AppError reaching the error-handling
 * middleware, matching the pattern the rest of the codebase uses.
 */
export async function assertTherapistAssignedToPatient(therapistId: string, patientId: string): Promise<void> {
  const assignment = await prisma.patientTherapistAssignment.findFirst({
    where: { therapistId, patientId, status: "active" }
  });
  if (!assignment) {
    throw new ForbiddenError("You're not currently assigned to this patient.");
  }
}

export async function getPatientReport(patientId: string): Promise<PatientProgressTrend> {
  const patient = await prisma.patient.findUnique({
    where: { userId: patientId },
    include: {
      rehabilitationPlans: {
        orderBy: { createdAt: "desc" },
        include: {
          scheduleDays: {
            include: {
              scheduledExercises: {
                include: { performanceResults: true }
              }
            }
          }
        }
      }
    }
  });

  if (!patient) {
    throw new NotFoundError("Patient not found.");
  }

  const currentPlan = patient.rehabilitationPlans.find((plan) => plan.status === "active") ?? patient.rehabilitationPlans[0] ?? null;

  if (!currentPlan) {
    return { patientId, planName: "No active rehabilitation plan", points: [] };
  }

  // Every scored attempt across the plan, oldest first, bucketed into 7-day
  // "weeks" counted from the plan's start date — there's no dedicated
  // "week number" column anywhere in the schema, so this is derived purely
  // from scheduled_date arithmetic.
  const planStart = currentPlan.startDate ?? currentPlan.scheduleDays[0]?.scheduledDate ?? new Date();

  const attempts: Array<{ weekIndex: number; score: number }> = [];
  for (const day of currentPlan.scheduleDays) {
    for (const exercise of day.scheduledExercises) {
      for (const result of exercise.performanceResults) {
        const scoreSource = result.finalScore ?? result.ptScore ?? result.aiScore;
        if (scoreSource === null || scoreSource === undefined) continue;

        const diffDays = Math.floor((day.scheduledDate.getTime() - planStart.getTime()) / 86_400_000);
        const weekIndex = Math.max(0, Math.floor(diffDays / 7));
        // finalScore/ptScore/aiScore are Prisma Decimal fields (decimal.js under the
        // hood) — .toNumber() rather than a bare Number() cast, to not rely on
        // Decimal's valueOf()/toString() coercion behavior.
        attempts.push({ weekIndex, score: scoreSource.toNumber() });
      }
    }
  }

  const byWeek = new Map<number, { total: number; count: number }>();
  for (const attempt of attempts) {
    const bucket = byWeek.get(attempt.weekIndex) ?? { total: 0, count: 0 };
    bucket.total += attempt.score;
    bucket.count += 1;
    byWeek.set(attempt.weekIndex, bucket);
  }

  const points: ProgressTrendPoint[] = Array.from(byWeek.entries())
    .sort(([a], [b]) => a - b)
    .map(([weekIndex, bucket]) => ({
      week: `Week ${weekIndex + 1}`,
      score: Math.round(bucket.total / bucket.count)
    }));

  return { patientId, planName: currentPlan.name, points };
}
