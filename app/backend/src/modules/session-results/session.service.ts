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
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import * as fileService from "../files/file.service";
import type { HandTrackingGameType } from "../exercise-program-library/exercise.service";

export type SessionOutcome = "completed" | "skipped";
export type EvaluationSource = "ai" | "pt_reviewed";

export interface TherapistSessionLogEntryDto {
  id: string;
  patientId: string;
  patientName: string;
  patientAvatarInitials: string;
  // Which plan the session's schedule day belongs to — lets consumers scope
  // the log to a single plan (PatientDetailPage shows the selected plan's
  // sessions) or label entries with the plan name.
  rehabilitationPlanId: string;
  rehabilitationPlanName: string;
  dateLabel: string;
  dayLabel: string;
  exercisesAttempted: number;
  outcome: SessionOutcome;
  avgScore?: number;
  evaluationSource?: EvaluationSource;
}

export interface TherapistExerciseSessionDto extends TherapistSessionLogEntryDto {
  scheduledExerciseId: string;
  exerciseLibraryId: string;
  performanceResultId: string;
  exerciseName: string;
  exerciseVersionLabel: string;
  dateIso: string;
  completedAtIso: string;
  aiScore: number | null;
  currentScore: number | null;
  currentScoreSource: EvaluationSource | null;
  reviewed: boolean;
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
  virtualGripGameType?: HandTrackingGameType;
  baseCriteria?: any;
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
  todayDate: string;
  // Every active plan, for the "All Plans" / per-plan selector — empty array
  // when the patient has no active plan at all.
  activePlans: { id: string; name: string }[];
  plans: PatientTodayPlanDto[];
  stats: { averageScore: number | null; completedSessions: number };
}

export interface PatientScheduledExerciseDto {
  id: string;
  exerciseLibraryId: string;
  targetType: "repetitions" | "duration";
  targetValue: unknown;
  therapistInstruction: string | null;
  exercise: {
    id: string;
    name: string;
    description: string | null;
    difficultyLevel: "easy" | "medium" | "hard";
    movementTracking: "pose" | "virtual_grip" | "none";
    demoVideoFileId: string | null;
    virtualGripGameType?: HandTrackingGameType;
    baseCriteria?: any;
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
  const todayIsoStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
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
        exercises: current.day.scheduledExercises.map((exercise) => {
          const rawCriteria = exercise.exerciseLibrary.baseCriteria;
          const baseCriteria =
            rawCriteria && typeof rawCriteria === "object" && !Array.isArray(rawCriteria)
              ? (rawCriteria as Record<string, unknown>)
              : null;
          const virtualGripGameType =
            baseCriteria?.virtualGripGameType === "path-drag" ||
            baseCriteria?.virtualGripGameType === "falling-cup" ||
            baseCriteria?.virtualGripGameType === "ball-grip"
              ? (baseCriteria.virtualGripGameType as HandTrackingGameType)
              : undefined;

          return {
            id: exercise.id,
            exerciseLibraryId: exercise.exerciseLibraryId,
            exerciseName: exercise.exerciseLibrary.name,
            versionLabel: `v${exercise.exerciseLibrary.versionNumber}`,
            movementTracking: exercise.exerciseLibrary.movementTracking,
            difficultyLevel: exercise.exerciseLibrary.difficultyLevel,
            targetValueLabel: targetValueLabel(exercise.targetValue),
            therapistInstruction: exercise.therapistInstruction,
            status: exercise.status,
            virtualGripGameType,
            baseCriteria: baseCriteria ?? undefined
          };
        })
      };
    }

    return {
      id: plan.id,
      name: plan.name,
      totalDays: plan.scheduleDays.length,
      scheduleDates: plan.scheduleDays.filter((day) => day.scheduledExercises.length > 0).map((day) => isoDate(day.scheduledDate)),
      // dateStatuses covers EVERY schedule day (not just days with exercises):
      // a skipped/cancelled day whose exercises were removed must still carry
      // its real status so the Today calendar can paint it red instead of
      // treating it as a pending rest day.
      dateStatuses: Object.fromEntries(
        plan.scheduleDays.map((day) => [isoDate(day.scheduledDate), day.status])
      ),
      today
    };
  });

  return {
    patient: { id: patient.userId, displayName: name, avatarInitials: initialsFromName(name), profilePictureFileId: patient.user.profilePictureFileId },
    todayDate: todayIsoStr,
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
  const rawCriteria = exercise.baseCriteria;
  const baseCriteria =
    rawCriteria && typeof rawCriteria === "object" && !Array.isArray(rawCriteria)
      ? (rawCriteria as Record<string, unknown>)
      : null;
  const virtualGripGameType =
    baseCriteria?.virtualGripGameType === "path-drag" ||
    baseCriteria?.virtualGripGameType === "falling-cup" ||
    baseCriteria?.virtualGripGameType === "ball-grip"
      ? (baseCriteria.virtualGripGameType as HandTrackingGameType)
      : undefined;

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
      demoVideoFileId: exercise.demoVideoFileId,
      virtualGripGameType,
      baseCriteria: baseCriteria ?? undefined
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
  input: {
    aiScore?: number | null;
    aiFeedback?: string | null;
    aiMetrics?: Record<string, unknown>;
    performanceData?: Record<string, unknown>;
    videoIncludesOverlay?: boolean;
  },
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
  const performanceData = {
    ...input.performanceData,
    ...(input.videoIncludesOverlay !== undefined ? { videoIncludesOverlay: input.videoIncludesOverlay } : {})
  };

  const { updatedExercise, result, day } = await prisma.$transaction(async (tx) => {
    const created = await tx.exercisePerformanceResult.create({
      data: {
        scheduledExerciseId,
        attemptNumber,
        referenceVideo: file.id,
        completedAt: new Date(),
        aiScore,
        aiFeedback: input.aiFeedback ?? null,
        // Rep count & friends — without these the row only knew the score, so a
        // 3-of-10-reps session looked identical to a complete one.
        ...(input.aiMetrics ? { aiMetrics: input.aiMetrics as Prisma.InputJsonObject } : {}),
        ...(Object.keys(performanceData).length > 0 ? { performanceData: performanceData as Prisma.InputJsonObject } : {}),
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
  aiEvaluatedAtIso: string | null;
  aiMetrics: Array<{ label: string; value: string }> | null;
  currentScore: number | null;
  currentScoreSource: "ai" | "pt" | "manual" | null;
  therapistReviewed: boolean;
}

export interface ScheduleDayReviewExerciseDto {
  id: string;
  scheduledExerciseId: string;
  exerciseName: string;
  exerciseVersionLabel: string;
  description: string | null;
  difficultyLevel: string;
  movementTracking: string;
  baseCriteria: Array<{ label: string; value: string }> | null;
  targetValueLabel: string;
  therapistInstruction: string | null;
  attempts: ScheduleDayReviewAttemptDto[];
}

export interface ScheduleDayReviewDto {
  sessionId: string;
  patientName: string;
  dateLabel: string;
  dayLabel: string;
  planName: string;
  scheduledDateIso: string;
  exercises: ScheduleDayReviewExerciseDto[];
}

function mapAiMetrics(metrics: unknown): Array<{ label: string; value: string }> | null {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;
  return Object.entries(metrics as Record<string, unknown>).map(([key, value]) => ({
    label: key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()),
    value: typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value) ?? String(value)
  }));
}

function mapExerciseCriteria(criteria: unknown): Array<{ label: string; value: string }> | null {
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) return null;
  const details = Object.entries(criteria as Record<string, unknown>)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .map(([key, value]) => ({
      label: key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()),
      value: String(value)
    }));
  return details.length > 0 ? details : null;
}

function currentAttemptScore(result: {
  aiScore: { toNumber(): number } | null;
  ptScore: { toNumber(): number } | null;
  finalScore: { toNumber(): number } | null;
  evaluationSource: string | null;
}): number | null {
  if (
    (result.evaluationSource === "pt" || result.evaluationSource === "manual") &&
    result.ptScore != null
  ) {
    return result.ptScore.toNumber();
  }
  return result.aiScore?.toNumber() ?? result.finalScore?.toNumber() ?? result.ptScore?.toNumber() ?? null;
}

function activeAttemptSource(result: {
  aiScore: { toNumber(): number } | null;
  ptScore: { toNumber(): number } | null;
  evaluationSource: string | null;
}): "ai" | "pt" | "manual" | null {
  if (
    (result.evaluationSource === "pt" || result.evaluationSource === "manual") &&
    result.ptScore != null
  ) {
    return result.evaluationSource;
  }
  return result.aiScore != null ? "ai" : result.ptScore != null ? "pt" : null;
}

export async function getScheduleDayReview(dayId: string, therapistId: string, isAdmin: boolean): Promise<ScheduleDayReviewDto> {
  const day = await prisma.rehabilitationScheduleDay.findUnique({
    where: { id: dayId },
    include: {
      rehabilitationPlan: { include: { patient: { include: { user: true } } } },
      scheduledExercises: {
        where: { status: "completed" },
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
      description: exercise.exerciseLibrary.description,
      difficultyLevel: exercise.exerciseLibrary.difficultyLevel,
      movementTracking: exercise.exerciseLibrary.movementTracking,
      baseCriteria: mapExerciseCriteria(exercise.exerciseLibrary.baseCriteria),
      targetValueLabel: targetValueLabel(exercise.targetValue),
      therapistInstruction: exercise.therapistInstruction,
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
        completedAtIso: result.completedAt ? result.completedAt.toISOString() : null,
        aiEvaluatedAtIso: result.aiEvaluatedAt ? result.aiEvaluatedAt.toISOString() : null,
        aiMetrics: mapAiMetrics(result.aiMetrics),
        videoIncludesOverlay:
          result.performanceData !== null &&
          typeof result.performanceData === "object" &&
          !Array.isArray(result.performanceData) &&
          result.performanceData.videoIncludesOverlay === true,
        currentScore: currentAttemptScore(result),
        currentScoreSource: activeAttemptSource(result),
        therapistReviewed:
          result.ptEvaluatedAt !== null || result.ptScore !== null || result.ptFeedback !== null
      }))
    })),
    planName: day.rehabilitationPlan.name,
    scheduledDateIso: isoDate(day.scheduledDate)
  };
}

// --- PATCH /performance-results/:id/scoring ---------------------------------
// Therapist scoring for one recorded attempt — therapist score/feedback are
// saved independently from the selected grading-score source.
// Same access rule as getScheduleDayReview: the patient's assigned therapist or
// an admin. Providing PT fields stamps pt_evaluated_by/pt_evaluated_at;
// finalScore + evaluationSource record which score is the official result.
export interface AttemptScoringPatch {
  ptScore?: number | null;
  ptFeedback?: string | null;
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
  if (payload.ptFeedback !== undefined && payload.ptFeedback !== null && typeof payload.ptFeedback !== "string") {
    throw new ValidationError("PT feedback must be text.");
  }
  if (
    payload.evaluationSource !== undefined &&
    payload.evaluationSource !== "ai" &&
    payload.evaluationSource !== "pt" &&
    payload.evaluationSource !== "manual"
  ) {
    throw new ValidationError("Evaluation source is invalid.");
  }
  if (payload.ptScore === null && result.evaluationSource === "pt" && payload.evaluationSource !== "ai") {
    throw new ValidationError("Select the AI score for grading before removing the therapist score.");
  }

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
  if (payload.ptScore !== undefined && result.evaluationSource === "pt" && payload.ptScore !== null) {
    data.finalScore = payload.ptScore;
  }
  if (payload.evaluationSource !== undefined) {
    if (payload.evaluationSource === "pt" && result.ptScore == null && payload.ptScore == null) {
      throw new ValidationError("A therapist score is required before it can be used for grading.");
    }
    if (payload.evaluationSource === "ai" && result.aiScore == null) {
      throw new ValidationError("An AI score is not available for this result.");
    }
    const selectedScore = payload.evaluationSource === "pt"
      ? payload.ptScore ?? result.ptScore
      : payload.evaluationSource === "ai"
        ? result.aiScore
        : result.finalScore;
    if (selectedScore == null) throw new ValidationError("The selected grading score is not available.");
    data.finalScore = typeof selectedScore === "number" ? selectedScore : selectedScore.toNumber();
    data.evaluationSource = payload.evaluationSource;
  }
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
    completedAtIso: updated.completedAt ? updated.completedAt.toISOString() : null,
    aiEvaluatedAtIso: updated.aiEvaluatedAt ? updated.aiEvaluatedAt.toISOString() : null,
    aiMetrics: mapAiMetrics(updated.aiMetrics),
    currentScore: currentAttemptScore(updated),
    currentScoreSource: activeAttemptSource(updated),
    therapistReviewed: updated.ptEvaluatedAt !== null || updated.ptScore !== null || updated.ptFeedback !== null
  };
}

export async function getTherapistSessions(
  therapistId: string,
  opts: { patientId?: string; planId?: string } = {}
): Promise<TherapistSessionLogEntryDto[]> {
  const assignments = await prisma.patientTherapistAssignment.findMany({
    where: { therapistId, status: "active" },
    select: { patientId: true }
  });
  // Authorization invariant stays intact with the optional scopes: the base set
  // is always the therapist's OWN assigned patients. A patientId outside that
  // set short-circuits to empty (never leaks another therapist's patient), and
  // a planId outside it simply matches nothing via the where clause below.
  let patientIds = assignments.map((assignment) => assignment.patientId);
  if (opts.patientId) {
    if (!patientIds.includes(opts.patientId)) return [];
    patientIds = [opts.patientId];
  }

  if (patientIds.length === 0) return [];

  const days = await prisma.rehabilitationScheduleDay.findMany({
    where: {
      status: { in: ["completed", "skipped"] },
      rehabilitationPlan: {
        patientId: { in: patientIds },
        // Optional plan scope — PatientDetailPage passes the currently
        // selected plan so its session history stays plan-scoped.
        ...(opts.planId ? { id: opts.planId } : {})
      }
    },
    orderBy: { scheduledDate: "desc" },
    take: RECENT_SESSIONS_LIMIT,
    include: {
      rehabilitationPlan: {
        select: {
          id: true,
          name: true,
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
      rehabilitationPlanId: day.rehabilitationPlan.id,
      rehabilitationPlanName: day.rehabilitationPlan.name,
      dateLabel: relativeDateLabel(day.scheduledDate),
      dayLabel: `Day ${Math.max(1, dayNumber)}`,
      exercisesAttempted: day.scheduledExercises.length,
      outcome: day.status === "skipped" ? "skipped" : "completed",
      avgScore,
      evaluationSource
    };
  });
}

export async function getTherapistExerciseSessions(
  therapistId: string,
  opts: { patientId?: string; planId?: string } = {}
): Promise<TherapistExerciseSessionDto[]> {
  const assignments = await prisma.patientTherapistAssignment.findMany({
    where: { therapistId, status: "active" },
    select: { patientId: true }
  });
  let patientIds = assignments.map((assignment) => assignment.patientId);
  if (opts.patientId) {
    if (!patientIds.includes(opts.patientId)) return [];
    patientIds = [opts.patientId];
  }
  if (patientIds.length === 0) return [];

  const results = await prisma.exercisePerformanceResult.findMany({
    where: {
      completedAt: { not: null },
      scheduledExercise: {
        status: "completed",
        scheduleDay: {
          rehabilitationPlan: {
            patientId: { in: patientIds },
            ...(opts.planId ? { id: opts.planId } : {})
          }
        }
      }
    },
    orderBy: [{ completedAt: "desc" }, { attemptNumber: "desc" }],
    include: {
      scheduledExercise: {
        include: {
          exerciseLibrary: true,
          scheduleDay: {
            include: {
              rehabilitationPlan: {
                include: { patient: { include: { user: true } } }
              }
            }
          }
        }
      }
    }
  });

  const latestByPatientExerciseDate = new Map<string, { result: typeof results[number]; completedAt: Date }>();
  for (const result of results) {
    if (!result.completedAt) continue;
    const scheduledExercise = result.scheduledExercise;
    const plan = scheduledExercise.scheduleDay.rehabilitationPlan;
    const dateIso = isoDate(scheduledExercise.scheduleDay.scheduledDate);
    const key = `${plan.patientId}:${scheduledExercise.exerciseLibraryId}:${dateIso}`;
    if (!latestByPatientExerciseDate.has(key)) {
      latestByPatientExerciseDate.set(key, { result, completedAt: result.completedAt });
    }
  }

  return Array.from(latestByPatientExerciseDate.values()).map(({ result, completedAt }) => {
    const scheduledExercise = result.scheduledExercise;
    const day = scheduledExercise.scheduleDay;
    const plan = day.rehabilitationPlan;
    const patientUser = plan.patient.user;
    const name = displayName({
      firstName: patientUser.firstName,
      lastName: patientUser.lastName,
      username: patientUser.username
    });
    const currentScore = currentAttemptScore(result);
    const activeSource = activeAttemptSource(result);
    const currentScoreSource: EvaluationSource | null = currentScore == null
      ? null
      : activeSource === "pt" || activeSource === "manual"
        ? "pt_reviewed"
        : "ai";
    const planStart = plan.startDate ?? day.scheduledDate;
    const dayNumber = Math.floor((day.scheduledDate.getTime() - planStart.getTime()) / 86_400_000) + 1;

    return {
      id: day.id,
      patientId: plan.patientId,
      patientName: name,
      patientAvatarInitials: initialsFromName(name),
      rehabilitationPlanId: plan.id,
      rehabilitationPlanName: plan.name,
      dateLabel: relativeDateLabel(day.scheduledDate),
      dayLabel: `Day ${Math.max(1, dayNumber)}`,
      exercisesAttempted: 1,
      outcome: "completed",
      avgScore: currentScore == null ? undefined : Math.round(currentScore),
      evaluationSource: currentScoreSource ?? undefined,
      scheduledExerciseId: scheduledExercise.id,
      exerciseLibraryId: scheduledExercise.exerciseLibraryId,
      performanceResultId: result.id,
      exerciseName: scheduledExercise.exerciseLibrary.name,
      exerciseVersionLabel: `v${scheduledExercise.exerciseLibrary.versionNumber}`,
      dateIso: isoDate(day.scheduledDate),
      completedAtIso: completedAt.toISOString(),
      aiScore: result.aiScore == null ? null : result.aiScore.toNumber(),
      currentScore,
      currentScoreSource,
      reviewed:
        result.ptEvaluatedAt != null || result.ptScore != null || result.ptFeedback != null
    };
  });
}
