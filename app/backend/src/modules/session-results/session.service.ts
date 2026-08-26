// Session & Results module — real Prisma queries.
//
// IMPORTANT CONTEXT: this file, session.controller.ts, and session.routes.ts
// were all still TODO stubs with no code ever written (matching what their
// header comments already said — unlike the therapist module's earlier false
// "fully implemented" claim, these were honestly flagged). This is the first
// real implementation, scoped to exactly what TherapistSessionsPage.tsx needs:
// a cross-patient session log for a therapist's caseload.
//
// SCHEMA / API-DESIGN GAPS this module works around:
//
//   1. No `training_sessions` table exists at all (per api-design.md's own
//      "Training Sessions" section note: "no dedicated session table"). A
//      "session" here means one `rehabilitation_schedule_days` row — same
//      convention modules/therapist/therapist.service.ts's dashboard stats
//      (`sessionsToday`, `weeklySessions`) already use.
//
//   2. api-design.md's "Training Sessions" section only documents
//      `GET /patients/:id/sessions` (per-patient). TherapistSessionsPage.tsx
//      needs a log across the therapist's *whole* caseload — no such route is
//      documented. Added here as `GET /therapists/:id/sessions`, undocumented
//      beyond this comment (same situation as `PATCH /exercises/:id` in
//      modules/exercise-program-library/exercise.service.ts).
//
//   3. `exercise_performance_results` has no direct link back to a patient —
//      only `scheduledExercise -> scheduleDay -> rehabilitationPlan.patientId`.
//      A schedule day can (in this schema) hold more than one scheduled
//      exercise; this module treats "the day's outcome" as: skipped if the
//      day itself is `skipped`, completed otherwise (days are only fetched
//      here if their own status is `completed` or `skipped` to begin with —
//      `pending`/`in_progress`/`cancelled` days aren't "sessions that
//      happened" yet, so they're excluded from this log entirely).
//
//   4. Frontend's `EvaluationSource` type is `"ai" | "pt_reviewed"`, but the
//      schema's `exercise_performance_results_evaluation_source` enum is
//      `"ai" | "pt" | "manual"`. Mapped many-to-one: `pt`/`manual` (or any
//      result with a non-null `ptScore`) -> `"pt_reviewed"`; else `"ai"` if an
//      AI score exists; else omitted (no attempt was ever scored).

import { displayName, initialsFromName, relativeDateLabel } from "../../common/formatting";
import { ForbiddenError, NotFoundError } from "../../common/errors";
import { prisma } from "../../config/prisma";

export type SessionOutcome = "completed" | "skipped";
export type EvaluationSource = "ai" | "pt_reviewed";

export interface TherapistSessionLogEntryDto {
  id: string;
  patientId: string;
  patientName: string;
  patientAvatarInitials: string;
  dateLabel: string;
  dayLabel: string;
  exercisesAttempted: number;
  outcome: SessionOutcome;
  avgScore?: number;
  evaluationSource?: EvaluationSource;
}

// Caps how far back the log looks — "recent training sessions", not a full
// archive; the page has no pagination UI yet.
const RECENT_SESSIONS_LIMIT = 50;

export interface PatientTodayExerciseDto {
  id: string;
  exerciseLibraryId: string;
  exerciseName: string;
  versionLabel: string;
  movementTracking: "pose" | "virtual_grip" | "none";
  difficultyLevel: "easy" | "medium" | "hard";
  targetValueLabel: string;
  therapistInstruction: string | null;
  status: "pending" | "in_progress" | "completed" | "skipped" | "cancelled";
}

export interface PatientTodayDto {
  patient: { id: string; displayName: string; avatarInitials: string };
  scheduleDay: {
    id: string;
    scheduledDate: string;
    status: "pending" | "in_progress" | "completed" | "skipped" | "cancelled";
    dayNumber: number;
    streak: number;
    therapistNote: string | null;
    plan: { id: string; name: string; totalDays: number; scheduleDates: string[] };
    exercises: PatientTodayExerciseDto[];
  } | null;
  stats: { averageScore: number | null; completedSessions: number };
}

export interface PatientScheduledExerciseDto {
  id: string;
  exerciseLibraryId: string;
  targetType: "repetitions" | "duration" | "sets" | "distance" | "free";
  targetValue: unknown;
  therapistInstruction: string | null;
  exercise: {
    id: string;
    name: string;
    description: string | null;
    difficultyLevel: "easy" | "medium" | "hard";
    movementTracking: "pose" | "virtual_grip" | "none";
    demoVideoFileId: string | null;
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function targetValueLabel(targetValue: unknown): string {
  if (targetValue === null || targetValue === undefined) return "No target set";
  if (typeof targetValue === "string" || typeof targetValue === "number") return String(targetValue);
  if (Array.isArray(targetValue)) return targetValue.map(String).join(" · ");
  if (typeof targetValue === "object") {
    return Object.entries(targetValue as Record<string, unknown>)
      .map(([key, value]) => `${String(value)} ${key}`)
      .join(" · ");
  }
  return String(targetValue);
}

export async function getPatientToday(patientId: string): Promise<PatientTodayDto> {
  const patient = await prisma.patient.findUnique({
    where: { userId: patientId },
    include: {
      user: true,
      rehabilitationPlans: {
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
        include: {
          scheduleDays: {
            orderBy: { scheduledDate: "asc" },
            include: {
              scheduledExercises: {
                orderBy: { orderNumber: "asc" },
                include: { exerciseLibrary: true, performanceResults: true }
              }
            }
          }
        }
      }
    }
  });
  if (!patient) throw new NotFoundError("Patient not found.");

  const name = displayName(patient.user);
  const plans = patient.rehabilitationPlans;
  const candidates = plans.flatMap((plan) =>
    plan.scheduleDays
      .map((day, index) => ({ plan, day, index }))
      .filter(({ day }) => day.status === "in_progress" || day.status === "pending")
  );
  candidates.sort((a, b) => {
    const statusOrder = (day: (typeof a)["day"]) => (day.status === "in_progress" ? 0 : 1);
    return statusOrder(a.day) - statusOrder(b.day) || a.day.scheduledDate.getTime() - b.day.scheduledDate.getTime();
  });
  const current = candidates[0];

  const scores: number[] = [];
  let completedSessions = 0;
  for (const plan of plans) {
    for (const day of plan.scheduleDays) {
      if (day.status === "completed") completedSessions += 1;
      for (const exercise of day.scheduledExercises) {
        const latest = exercise.performanceResults.reduce<(typeof exercise.performanceResults)[number] | null>(
          (result, candidate) => (!result || candidate.attemptNumber > result.attemptNumber ? candidate : result),
          null
        );
        const score = latest?.finalScore ?? latest?.ptScore ?? latest?.aiScore;
        if (score !== null && score !== undefined) scores.push(score.toNumber());
      }
    }
  }

  let scheduleDay: PatientTodayDto["scheduleDay"] = null;
  if (current) {
    let streak = 0;
    for (let index = current.index - 1; index >= 0 && current.plan.scheduleDays[index].status === "completed"; index -= 1) {
      streak += 1;
    }
    scheduleDay = {
      id: current.day.id,
      scheduledDate: isoDate(current.day.scheduledDate),
      status: current.day.status,
      dayNumber: current.index + 1,
      streak,
      therapistNote: current.day.therapistNote,
      plan: {
        id: current.plan.id,
        name: current.plan.name,
        totalDays: current.plan.scheduleDays.length,
        scheduleDates: current.plan.scheduleDays
          .filter((day) => day.scheduledExercises.length > 0)
          .map((day) => isoDate(day.scheduledDate))
      },
      exercises: current.day.scheduledExercises.map((exercise) => ({
        id: exercise.id,
        exerciseLibraryId: exercise.exerciseLibraryId,
        exerciseName: exercise.exerciseLibrary.name,
        versionLabel: `v${exercise.exerciseLibrary.versionNumber}`,
        movementTracking: exercise.exerciseLibrary.movementTracking,
        difficultyLevel: exercise.exerciseLibrary.difficultyLevel,
        targetValueLabel: targetValueLabel(exercise.targetValue),
        therapistInstruction: exercise.therapistInstruction,
        status: exercise.status
      }))
    };
  }

  return {
    patient: { id: patient.userId, displayName: name, avatarInitials: initialsFromName(name) },
    scheduleDay,
    stats: { averageScore: scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null, completedSessions }
  };
}

async function findPatientScheduledExercise(patientId: string, scheduledExerciseId: string, isAdmin: boolean) {
  const scheduledExercise = await prisma.scheduledExercise.findUnique({
    where: { id: scheduledExerciseId },
    include: {
      scheduleDay: { include: { rehabilitationPlan: { select: { patientId: true } } } },
      exerciseLibrary: { include: { demoVideoFile: true } }
    }
  });
  if (!scheduledExercise) throw new NotFoundError("Scheduled exercise not found.");
  if (!isAdmin && scheduledExercise.scheduleDay.rehabilitationPlan.patientId !== patientId) {
    throw new ForbiddenError("You can only view your own scheduled exercises.");
  }
  return scheduledExercise;
}

export async function getPatientScheduledExercise(
  patientId: string,
  scheduledExerciseId: string,
  isAdmin = false
): Promise<PatientScheduledExerciseDto> {
  const scheduledExercise = await findPatientScheduledExercise(patientId, scheduledExerciseId, isAdmin);
  const exercise = scheduledExercise.exerciseLibrary;
  return {
    id: scheduledExercise.id,
    exerciseLibraryId: scheduledExercise.exerciseLibraryId,
    targetType: scheduledExercise.targetType,
    targetValue: scheduledExercise.targetValue,
    therapistInstruction: scheduledExercise.therapistInstruction,
    // This deliberately reads the relation from scheduled_exercises.exercise_library_id.
    // No version-family lookup occurs, so an assigned older version stays intact.
    exercise: {
      id: exercise.id,
      name: exercise.name,
      description: exercise.description,
      difficultyLevel: exercise.difficultyLevel,
      movementTracking: exercise.movementTracking,
      demoVideoFileId: exercise.demoVideoFileId
    }
  };
}

export async function getPatientScheduledExerciseDemoVideo(patientId: string, scheduledExerciseId: string, isAdmin = false) {
  const scheduledExercise = await findPatientScheduledExercise(patientId, scheduledExerciseId, isAdmin);
  const demoVideo = scheduledExercise.exerciseLibrary.demoVideoFile;
  if (!demoVideo) throw new NotFoundError("No demonstration video is available for this exercise.");
  return { storagePath: demoVideo.storagePath, mimeType: demoVideo.mimeType };
}

export async function getTherapistSessions(therapistId: string): Promise<TherapistSessionLogEntryDto[]> {
  const assignments = await prisma.patientTherapistAssignment.findMany({
    where: { therapistId, status: "active" },
    select: { patientId: true }
  });
  const patientIds = assignments.map((assignment) => assignment.patientId);
  if (patientIds.length === 0) return [];

  const days = await prisma.rehabilitationScheduleDay.findMany({
    where: {
      status: { in: ["completed", "skipped"] },
      rehabilitationPlan: { patientId: { in: patientIds } }
    },
    orderBy: { scheduledDate: "desc" },
    take: RECENT_SESSIONS_LIMIT,
    include: {
      rehabilitationPlan: {
        select: {
          patientId: true,
          startDate: true,
          patient: { include: { user: true } }
        }
      },
      scheduledExercises: {
        where: { status: { in: ["completed", "skipped"] } },
        include: { performanceResults: true }
      }
    }
  });

  return days.map((day) => {
    const patientUser = day.rehabilitationPlan.patient.user;
    const name = displayName({
      firstName: patientUser.firstName,
      lastName: patientUser.lastName,
      username: patientUser.username
    });

    // "Day N" of the plan — no dedicated day-number column, derived from
    // scheduled_date arithmetic, same approach used for weekly-bucketing in
    // modules/therapist/therapist.service.ts's getPatientReport().
    const planStart = day.rehabilitationPlan.startDate ?? day.scheduledDate;
    const dayNumber = Math.floor((day.scheduledDate.getTime() - planStart.getTime()) / 86_400_000) + 1;

    // Latest attempt per scheduled exercise (highest attemptNumber) feeds the
    // day's score/evaluation summary, so a retried exercise's earlier, lower
    // attempts don't drag the average down or contribute a stale evaluation
    // source alongside the attempt that actually counted.
    const latestResults = day.scheduledExercises
      .map((exercise) =>
        exercise.performanceResults.reduce<(typeof exercise.performanceResults)[number] | null>(
          (latest, result) => (!latest || result.attemptNumber > latest.attemptNumber ? result : latest),
          null
        )
      )
      .filter((result): result is NonNullable<typeof result> => result !== null);

    const scores = latestResults
      .map((result) => result.finalScore ?? result.ptScore ?? result.aiScore)
      .filter((score): score is NonNullable<typeof score> => score !== null && score !== undefined)
      .map((score) => score.toNumber());

    const avgScore = scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : undefined;

    const hasPtReview = latestResults.some(
      (result) => result.evaluationSource === "pt" || result.evaluationSource === "manual" || result.ptScore !== null
    );
    const hasAiScore = latestResults.some((result) => result.aiScore !== null);
    const evaluationSource: EvaluationSource | undefined = hasPtReview ? "pt_reviewed" : hasAiScore ? "ai" : undefined;

    return {
      id: day.id,
      patientId: day.rehabilitationPlan.patientId,
      patientName: name,
      patientAvatarInitials: initialsFromName(name),
      dateLabel: relativeDateLabel(day.scheduledDate),
      dayLabel: `Day ${Math.max(1, dayNumber)}`,
      exercisesAttempted: day.scheduledExercises.length,
      outcome: day.status === "skipped" ? "skipped" : "completed",
      avgScore,
      evaluationSource
    };
  });
}
