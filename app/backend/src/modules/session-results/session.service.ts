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
import { ForbiddenError, NotFoundError, ValidationError } from "../../common/errors";
import { prisma } from "../../config/prisma";
import * as fileService from "../files/file.service";

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

// A single active plan's own "current day" — computed independently per plan
// (each plan has its own in_progress/pending day, streak, and day number), so
// a patient with several concurrent active plans gets one of these per plan
// rather than the old single global "winner" pick.
export interface PatientTodayPlanDayDto {
  scheduleDayId: string;
  scheduledDate: string;
  status: "pending" | "in_progress" | "completed" | "skipped" | "cancelled";
  dayNumber: number;
  streak: number;
  therapistNote: string | null;
  exercises: PatientTodayExerciseDto[];
}

export interface PatientTodayPlanDto {
  id: string;
  name: string;
  totalDays: number;
  scheduleDates: string[];
  // Real per-date day status (rehabilitation_schedule_days.status) for every
  // date in scheduleDates — lets the calendar mark past days actually
  // COMPLETED as completed instead of assuming every past day was missed.
  dateStatuses: Record<string, PatientTodayPlanDayDto["status"]>;
  today: PatientTodayPlanDayDto | null;
}

export interface PatientTodayDto {
  patient: { id: string; displayName: string; avatarInitials: string; profilePictureFileId: string | null };
  // Every active plan, for the "All Plans" / per-plan selector — empty array
  // when the patient has no active plan at all.
  activePlans: { id: string; name: string }[];
  plans: PatientTodayPlanDto[];
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

  // Each active plan picks its own "today" day — ONLY a day actually scheduled
  // for today's calendar date. The previous rule (prefer in_progress, else
  // earliest pending) could pick a day scheduled for a FUTURE date (e.g. after
  // a missed day the next pending day is tomorrow), which leaked tomorrow's
  // exercises into the Home page's list. A plan with nothing scheduled today
  // simply gets a null today block (no exercises shown for it today).
  const todayIsoStr = isoDate(new Date());
  const planDtos: PatientTodayPlanDto[] = plans.map((plan) => {
    const candidates = plan.scheduleDays
      .map((day, index) => ({ day, index }))
      .filter(({ day }) => isoDate(day.scheduledDate) === todayIsoStr);
    const current = candidates[0];

    let today: PatientTodayPlanDayDto | null = null;
    if (current) {
      let streak = 0;
      for (let index = current.index - 1; index >= 0 && plan.scheduleDays[index].status === "completed"; index -= 1) {
        streak += 1;
      }
      today = {
        scheduleDayId: current.day.id,
        scheduledDate: isoDate(current.day.scheduledDate),
        status: current.day.status,
        dayNumber: current.index + 1,
        streak,
        therapistNote: current.day.therapistNote,
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
      id: plan.id,
      name: plan.name,
      totalDays: plan.scheduleDays.length,
      scheduleDates: plan.scheduleDays.filter((day) => day.scheduledExercises.length > 0).map((day) => isoDate(day.scheduledDate)),
      dateStatuses: Object.fromEntries(
        plan.scheduleDays
          .filter((day) => day.scheduledExercises.length > 0)
          .map((day) => [isoDate(day.scheduledDate), day.status])
      ),
      today
    };
  });

  return {
    patient: { id: patient.userId, displayName: name, avatarInitials: initialsFromName(name), profilePictureFileId: patient.user.profilePictureFileId },
    activePlans: plans.map((plan) => ({ id: plan.id, name: plan.name })),
    plans: planDtos,
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

// --- POST /scheduled-exercises/:id/results (§6.7 — real attempt submission) ---
// A patient uploads their recorded attempt video (multipart "file" field, stored
// via the files module) + the AI score/feedback fields; this creates the
// exercise_performance_results row (next attempt_number per exercise), marks the
// scheduled exercise "completed", and marks its schedule day "completed" once
// every exercise in the day is done — the same day-completion rule
// rehab.service.updateScheduledExerciseStatus uses on the therapist side.
export interface SubmittedExerciseResultDto {
  result: {
    id: string;
    attemptNumber: number;
    aiScore: number | null;
    aiFeedback: string | null;
    referenceVideoFileId: string | null;
  };
  scheduledExerciseStatus: string;
  scheduleDayStatus: string | null;
}

export async function submitExerciseResult(
  patientId: string,
  scheduledExerciseId: string,
  uploadedFile: Express.Multer.File,
  input: { aiScore?: number | null; aiFeedback?: string | null },
  isAdmin = false
): Promise<SubmittedExerciseResultDto> {
  const scheduledExercise = await findPatientScheduledExercise(patientId, scheduledExerciseId, isAdmin);
  if (scheduledExercise.status === "cancelled" || scheduledExercise.status === "skipped") {
    throw new ValidationError("This scheduled exercise can no longer accept submissions.");
  }
  if (!uploadedFile.mimetype.startsWith("video/")) {
    throw new ValidationError("The uploaded recording must be a video file.");
  }

  // Store the video through the shared files module (disk + files row), owned by
  // the patient — same ownership model the profile-picture flow uses.
  const file = await fileService.createFile(patientId, uploadedFile);

  const latestAttempt = await prisma.exercisePerformanceResult.findFirst({
    where: { scheduledExerciseId },
    orderBy: { attemptNumber: "desc" },
    select: { attemptNumber: true }
  });
  const attemptNumber = (latestAttempt?.attemptNumber ?? 0) + 1;

  const aiScore = typeof input.aiScore === "number" && Number.isFinite(input.aiScore) ? input.aiScore : null;

  const { updatedExercise, result, day } = await prisma.$transaction(async (tx) => {
    const created = await tx.exercisePerformanceResult.create({
      data: {
        scheduledExerciseId,
        attemptNumber,
        referenceVideo: file.id,
        completedAt: new Date(),
        aiScore,
        aiFeedback: input.aiFeedback ?? null,
        aiEvaluatedAt: new Date(),
        evaluationSource: "ai"
      }
    });

    const updatedEx = await tx.scheduledExercise.update({
      where: { id: scheduledExerciseId },
      data: { status: "completed", updatedAt: new Date() }
    });

    const currentDay = await tx.rehabilitationScheduleDay.findUnique({
      where: { id: scheduledExercise.scheduleDayId },
      include: { scheduledExercises: { select: { id: true, status: true } } }
    });
    let updatedDay: { status: string } | null = null;
    if (currentDay) {
      const allCompleted = currentDay.scheduledExercises.every((exercise) => exercise.status === "completed");
      updatedDay = allCompleted
        ? await tx.rehabilitationScheduleDay.update({
            where: { id: currentDay.id },
            data: { status: "completed" }
          })
        : currentDay;
    }

    return { updatedExercise: updatedEx, result: created, day: updatedDay };
  });

  return {
    result: {
      id: result.id,
      attemptNumber: result.attemptNumber,
      aiScore: result.aiScore !== null && result.aiScore !== undefined ? result.aiScore.toNumber() : null,
      aiFeedback: result.aiFeedback,
      referenceVideoFileId: result.referenceVideo
    },
    scheduledExerciseStatus: updatedExercise.status,
    scheduleDayStatus: day?.status ?? null
  };
}

// --- GET /schedule-days/:id/results (§2.7 — therapist review data) ---
// Real exercise_performance_results for one schedule day, for the assigned
// therapist (or an admin) to review — attempts newest-first per exercise, each
// carrying its reference_video file id so the review page can stream the
// patient's recorded video via GET /files/:fileId/content.
export interface ScheduleDayReviewAttemptDto {
  id: string;
  attemptNumber: number;
  aiScore: number | null;
  aiFeedback: string | null;
  ptScore: number | null;
  ptFeedback: string | null;
  finalScore: number | null;
  evaluationSource: "ai" | "pt" | "manual" | null;
  referenceVideoFileId: string | null;
  completedAtIso: string | null;
}

export interface ScheduleDayReviewExerciseDto {
  id: string;
  scheduledExerciseId: string;
  exerciseName: string;
  exerciseVersionLabel: string;
  attempts: ScheduleDayReviewAttemptDto[];
}

export interface ScheduleDayReviewDto {
  sessionId: string;
  patientName: string;
  dateLabel: string;
  dayLabel: string;
  exercises: ScheduleDayReviewExerciseDto[];
}

export async function getScheduleDayReview(dayId: string, therapistId: string, isAdmin: boolean): Promise<ScheduleDayReviewDto> {
  const day = await prisma.rehabilitationScheduleDay.findUnique({
    where: { id: dayId },
    include: {
      rehabilitationPlan: { include: { patient: { include: { user: true } } } },
      scheduledExercises: {
        where: { status: { in: ["completed", "skipped"] } },
        orderBy: { orderNumber: "asc" },
        include: {
          exerciseLibrary: true,
          performanceResults: { orderBy: { attemptNumber: "desc" } }
        }
      }
    }
  });
  if (!day) throw new NotFoundError("Schedule day not found.");

  if (!isAdmin) {
    const assignment = await prisma.patientTherapistAssignment.findFirst({
      where: { therapistId, patientId: day.rehabilitationPlan.patientId, status: "active" },
      select: { id: true }
    });
    if (!assignment) throw new ForbiddenError("You're not currently assigned to this patient.");
  }

  const patientUser = day.rehabilitationPlan.patient.user;
  const name = displayName({ firstName: patientUser.firstName, lastName: patientUser.lastName, username: patientUser.username });
  const planStart = day.rehabilitationPlan.startDate ?? day.scheduledDate;
  const dayNumber = Math.floor((day.scheduledDate.getTime() - planStart.getTime()) / 86_400_000) + 1;

  return {
    sessionId: day.id,
    patientName: name,
    dateLabel: relativeDateLabel(day.scheduledDate),
    dayLabel: `Day ${Math.max(1, dayNumber)}`,
    exercises: day.scheduledExercises.map((exercise) => ({
      id: exercise.id,
      scheduledExerciseId: exercise.id,
      exerciseName: exercise.exerciseLibrary.name,
      exerciseVersionLabel: `v${exercise.exerciseLibrary.versionNumber}`,
      attempts: exercise.performanceResults.map((result) => ({
        id: result.id,
        attemptNumber: result.attemptNumber,
        aiScore: result.aiScore !== null && result.aiScore !== undefined ? result.aiScore.toNumber() : null,
        aiFeedback: result.aiFeedback,
        ptScore: result.ptScore !== null && result.ptScore !== undefined ? result.ptScore.toNumber() : null,
        ptFeedback: result.ptFeedback,
        finalScore: result.finalScore !== null && result.finalScore !== undefined ? result.finalScore.toNumber() : null,
        evaluationSource: (result.evaluationSource as "ai" | "pt" | "manual" | null) ?? null,
        referenceVideoFileId: result.referenceVideo,
        completedAtIso: result.completedAt ? result.completedAt.toISOString() : null
      }))
    }))
  };
}

// --- PATCH /performance-results/:id/scoring ---------------------------------
// Therapist scoring for one recorded attempt — powers Session Result Review's
// PT score/feedback panel and its "Use AI score" / "Use my score" decision.
// Same access rule as getScheduleDayReview: the patient's assigned therapist or
// an admin. Providing PT fields stamps pt_evaluated_by/pt_evaluated_at;
// finalScore + evaluationSource record which score is the official result.
export interface AttemptScoringPatch {
  ptScore?: number | null;
  ptFeedback?: string | null;
  finalScore?: number | null;
  evaluationSource?: "ai" | "pt" | "manual";
}

function validateAttemptScore(value: number | null | undefined, label: string): void {
  if (value === undefined || value === null) return;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new ValidationError(`${label} must be between 0 and 100.`);
  }
}

export async function updateAttemptScoring(
  actorId: string,
  role: "patient" | "therapist" | "admin",
  resultId: string,
  payload: AttemptScoringPatch
): Promise<ScheduleDayReviewAttemptDto> {
  const result = await prisma.exercisePerformanceResult.findUnique({
    where: { id: resultId },
    include: {
      scheduledExercise: {
        include: {
          scheduleDay: {
            include: { rehabilitationPlan: { select: { patientId: true } } }
          }
        }
      }
    }
  });
  if (!result) throw new NotFoundError("Performance result not found.");

  if (role !== "admin") {
    const assignment = await prisma.patientTherapistAssignment.findFirst({
      where: {
        therapistId: actorId,
        patientId: result.scheduledExercise.scheduleDay.rehabilitationPlan.patientId,
        status: "active"
      },
      select: { id: true }
    });
    if (!assignment) throw new ForbiddenError("You're not currently assigned to this patient.");
  }

  validateAttemptScore(payload.ptScore, "PT score");
  validateAttemptScore(payload.finalScore, "Final score");

  const data: {
    ptScore?: number | null;
    ptFeedback?: string | null;
    ptEvaluatedBy?: string;
    ptEvaluatedAt?: Date;
    finalScore?: number | null;
    evaluationSource?: "ai" | "pt" | "manual";
  } = {};
  if (payload.ptScore !== undefined || payload.ptFeedback !== undefined) {
    data.ptEvaluatedBy = actorId;
    data.ptEvaluatedAt = new Date();
  }
  if (payload.ptScore !== undefined) data.ptScore = payload.ptScore;
  if (payload.ptFeedback !== undefined) data.ptFeedback = payload.ptFeedback;
  if (payload.finalScore !== undefined) data.finalScore = payload.finalScore;
  if (payload.evaluationSource !== undefined) data.evaluationSource = payload.evaluationSource;
  if (Object.keys(data).length === 0) throw new ValidationError("Nothing to update.");

  const updated = await prisma.exercisePerformanceResult.update({ where: { id: resultId }, data });
  return {
    id: updated.id,
    attemptNumber: updated.attemptNumber,
    aiScore: updated.aiScore !== null && updated.aiScore !== undefined ? updated.aiScore.toNumber() : null,
    aiFeedback: updated.aiFeedback,
    ptScore: updated.ptScore !== null && updated.ptScore !== undefined ? updated.ptScore.toNumber() : null,
    ptFeedback: updated.ptFeedback,
    finalScore: updated.finalScore !== null && updated.finalScore !== undefined ? updated.finalScore.toNumber() : null,
    evaluationSource: (updated.evaluationSource as "ai" | "pt" | "manual" | null) ?? null,
    referenceVideoFileId: updated.referenceVideo,
    completedAtIso: updated.completedAt ? updated.completedAt.toISOString() : null
  };
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
