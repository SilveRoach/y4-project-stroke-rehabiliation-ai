// Admin module — real Prisma queries backing GET /admin/dashboard
// (docs/04-design/api-design.md's "Dashboard & Reporting" section, FR-DASH-03).
// AdminDashboardPage.tsx was previously entirely mock beyond its health-check
// panel (see that file's own header comment) — this is the first real
// implementation of the rest of it.
//
// SCHEMA GAPS this module works around:
//
//   1. No `system_logs`/audit-log table exists anywhere in schema.prisma —
//      there's genuinely nowhere to read "System logs" from (server
//      warnings/errors, login events, etc.). That panel stays mock on the
//      frontend, clearly labeled, same as before. Not attempted here — adding
//      a real audit-log table is a schema change, out of scope for wiring an
//      existing mockup to existing data.
//
//   2. No `ai_calls`/inference-log table exists either. The weekly activity
//      chart's "AI calls" series is approximated here as the count of
//      `exercise_performance_results` rows whose `ai_evaluated_at` falls on
//      that day — each of those rows represents one AI scoring pass, which is
//      the closest real proxy for "an AI call happened" this schema can
//      support. Documented as an approximation, not literally logged AI
//      invocations (e.g. it wouldn't count a call that errored before
//      producing a score).
//
//   3. "Sessions" (dashboard stat, and the chart's "sessions" series) uses the
//      same convention as modules/therapist/therapist.service.ts and
//      modules/session-results/session.service.ts: one `rehabilitation_
//      schedule_days` row = one session. Platform-wide here (no patientId
//      filter), vs. those two modules' per-therapist/per-patient scoping.

import { displayName, relativeTimeLabel } from "../../common/formatting";
import { prisma } from "../../config/prisma";

export interface AdminDashboardStats {
  totalPatients: number;
  activePatients: number;
  totalTherapists: number;
  activeTherapists: number;
  sessionsToday: number;
}

export interface WeeklyActivityPoint {
  day: string;
  sessions: number;
  aiCalls: number;
}

export interface RoleCount {
  role: "patient" | "therapist" | "admin";
  count: number;
}

export interface AdminActivityLogEntry {
  id: string;
  type: "create" | "edit";
  table: "user" | "exercise" | "plan";
  objectName: string;
  timeLabel: string;
  timestamp: string;
  byWho: string;
  level?: "info" | "warning" | "error";
  message?: string;
}

export interface AdminDashboardData {
  stats: AdminDashboardStats;
  weeklyActivity: WeeklyActivityPoint[];
  roleDistribution: RoleCount[];
  logs: AdminActivityLogEntry[];
}

const WEEKLY_CHART_DAYS = 7;

function weekdayShortLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}

async function computeStats(): Promise<AdminDashboardStats> {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const [totalPatients, activePatients, totalTherapists, activeTherapists, sessionsToday] = await Promise.all([
    prisma.user.count({ where: { role: "patient" } }),
    prisma.user.count({ where: { role: "patient", status: "active" } }),
    prisma.user.count({ where: { role: "therapist" } }),
    prisma.user.count({ where: { role: "therapist", status: "active" } }),
    prisma.rehabilitationScheduleDay.count({
      where: { scheduledDate: { gte: startOfToday, lt: startOfTomorrow } }
    })
  ]);

  return { totalPatients, activePatients, totalTherapists, activeTherapists, sessionsToday };
}

async function computeRoleDistribution(): Promise<RoleCount[]> {
  const [patients, therapists, admins] = await Promise.all([
    prisma.user.count({ where: { role: "patient" } }),
    prisma.user.count({ where: { role: "therapist" } }),
    prisma.user.count({ where: { role: "admin" } })
  ]);

  return [
    { role: "patient", count: patients },
    { role: "therapist", count: therapists },
    { role: "admin", count: admins }
  ];
}

async function computeWeeklyActivity(): Promise<WeeklyActivityPoint[]> {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const rangeStart = new Date(startOfToday);
  rangeStart.setDate(rangeStart.getDate() - (WEEKLY_CHART_DAYS - 1));
  const rangeEnd = new Date(startOfToday);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const [scheduleDays, aiResults] = await Promise.all([
    prisma.rehabilitationScheduleDay.findMany({
      where: { scheduledDate: { gte: rangeStart, lt: rangeEnd } },
      select: { scheduledDate: true, status: true }
    }),
    prisma.exercisePerformanceResult.findMany({
      where: { aiEvaluatedAt: { gte: rangeStart, lt: rangeEnd } },
      select: { aiEvaluatedAt: true }
    })
  ]);

  const points: WeeklyActivityPoint[] = [];
  for (let offset = 0; offset < WEEKLY_CHART_DAYS; offset += 1) {
    const date = new Date(rangeStart);
    date.setDate(date.getDate() + offset);
    const dateKey = date.toDateString();

    const sessions = scheduleDays.filter(
      (day) => day.status === "completed" && day.scheduledDate.toDateString() === dateKey
    ).length;
    const aiCalls = aiResults.filter((result) => result.aiEvaluatedAt?.toDateString() === dateKey).length;

    points.push({ day: weekdayShortLabel(date), sessions, aiCalls });
  }

  return points;
}

async function computeActivityLogs(): Promise<AdminActivityLogEntry[]> {
  const [users, exercises, plans] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        createdByUser: {
          select: { firstName: true, lastName: true, username: true }
        },
        updatedByUser: {
          select: { firstName: true, lastName: true, username: true }
        }
      }
    }),
    prisma.exerciseLibrary.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        createdByUser: {
          select: { firstName: true, lastName: true, username: true }
        }
      }
    }),
    prisma.patientRehabilitationPlan.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        createdByUser: {
          select: { firstName: true, lastName: true, username: true }
        },
        updatedByUser: {
          select: { firstName: true, lastName: true, username: true }
        }
      }
    })
  ]);

  const entries: AdminActivityLogEntry[] = [];

  for (const u of users) {
    const userName = displayName(u);
    const creatorName = u.createdByUser ? displayName(u.createdByUser) : "System";
    entries.push({
      id: `user-create-${u.id}`,
      type: "create",
      table: "user",
      objectName: userName,
      timeLabel: relativeTimeLabel(u.createdAt),
      timestamp: u.createdAt.toISOString(),
      byWho: creatorName,
      level: "info",
      message: `Created ${u.role} account for ${userName}`
    });

    if (u.updatedAt && Math.abs(u.updatedAt.getTime() - u.createdAt.getTime()) > 1000) {
      const updaterName = u.updatedByUser ? displayName(u.updatedByUser) : creatorName;
      entries.push({
        id: `user-edit-${u.id}-${u.updatedAt.getTime()}`,
        type: "edit",
        table: "user",
        objectName: userName,
        timeLabel: relativeTimeLabel(u.updatedAt),
        timestamp: u.updatedAt.toISOString(),
        byWho: updaterName,
        level: "info",
        message: `Updated account details for ${userName}`
      });
    }
  }

  for (const ex of exercises) {
    const isEdit = (ex.versionNumber && ex.versionNumber > 1) || Boolean(ex.parentExerciseId);
    const creatorName = ex.createdByUser ? displayName(ex.createdByUser) : "System";
    const exerciseLabel = ex.versionNumber > 1 ? `${ex.name} (v${ex.versionNumber})` : ex.name;
    entries.push({
      id: `exercise-${ex.id}`,
      type: isEdit ? "edit" : "create",
      table: "exercise",
      objectName: exerciseLabel,
      timeLabel: relativeTimeLabel(ex.createdAt),
      timestamp: ex.createdAt.toISOString(),
      byWho: creatorName,
      level: "info",
      message: isEdit
        ? `Created version ${ex.versionNumber} for exercise '${ex.name}'`
        : `Created exercise '${ex.name}'`
    });
  }

  for (const plan of plans) {
    const creatorName = plan.createdByUser ? displayName(plan.createdByUser) : "System";
    entries.push({
      id: `plan-create-${plan.id}`,
      type: "create",
      table: "plan",
      objectName: plan.name,
      timeLabel: relativeTimeLabel(plan.createdAt),
      timestamp: plan.createdAt.toISOString(),
      byWho: creatorName,
      level: "info",
      message: `Created rehabilitation plan '${plan.name}'`
    });

    if (plan.updatedAt && Math.abs(plan.updatedAt.getTime() - plan.createdAt.getTime()) > 1000) {
      const updaterName = plan.updatedByUser ? displayName(plan.updatedByUser) : creatorName;
      entries.push({
        id: `plan-edit-${plan.id}-${plan.updatedAt.getTime()}`,
        type: "edit",
        table: "plan",
        objectName: plan.name,
        timeLabel: relativeTimeLabel(plan.updatedAt),
        timestamp: plan.updatedAt.toISOString(),
        byWho: updaterName,
        level: "info",
        message: `Updated rehabilitation plan '${plan.name}'`
      });
    }
  }

  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return entries.slice(0, 100);
}

export async function getAdminDashboard(): Promise<AdminDashboardData> {
  const [stats, weeklyActivity, roleDistribution, logs] = await Promise.all([
    computeStats(),
    computeWeeklyActivity(),
    computeRoleDistribution(),
    computeActivityLogs()
  ]);

  return { stats, weeklyActivity, roleDistribution, logs };
}

export interface SyncSchedulesResult {
  success: boolean;
  message: string;
  today: string;
  updatedDaysCount: number;
  updatedExercisesCount: number;
  /** Plans flipped active → completed because today is past their end date. */
  updatedPlansCount: number;
  summary: {
    daysSkipped: number;
    daysCompleted: number;
    daysPending: number;
    daysInProgress: number;
    exercisesSkipped: number;
    exercisesPending: number;
    exercisesCompleted: number;
    plansCompleted: number;
  };
}

export async function syncScheduleStatuses(actorId?: string, clientToday?: string): Promise<SyncSchedulesResult> {
  const todayStr =
    clientToday && /^\d{4}-\d{2}-\d{2}$/.test(clientToday)
      ? clientToday
      : new Date().toISOString().slice(0, 10);

  const scheduleDays = await prisma.rehabilitationScheduleDay.findMany({
    include: {
      scheduledExercises: {
        include: {
          performanceResults: {
            select: { id: true }
          }
        }
      }
    }
  });

  // Plan-level rule: a plan whose endDate has PASSED (strictly before the
  // reference date) is over — every still-"active" plan flips to "completed",
  // the same active → completed transition PATCH /plans/:id/status allows.
  // Draft plans are never touched (they never started) and completed/cancelled
  // are terminal; plans without an endDate have nothing to compare and are
  // skipped. endDate is a @db.Date column (UTC midnight), so the ISO date
  // slice compares correctly against todayStr — the same convention the day
  // loop below already uses for scheduledDate.
  const activePlans = await prisma.patientRehabilitationPlan.findMany({
    where: { status: "active", endDate: { not: null } },
    select: { id: true, endDate: true }
  });
  const plansToComplete: string[] = [];
  for (const plan of activePlans) {
    if (plan.endDate && plan.endDate.toISOString().slice(0, 10) < todayStr) {
      plansToComplete.push(plan.id);
    }
  }

  const now = new Date();

  const exercisesToSkipped: string[] = [];
  const exercisesToPending: string[] = [];
  const exercisesToCompleted: string[] = [];

  const daysToSkipped: string[] = [];
  const daysToCompleted: string[] = [];
  const daysToPending: string[] = [];
  const daysToInProgress: string[] = [];

  for (const day of scheduleDays) {
    const dayDateStr = day.scheduledDate.toISOString().slice(0, 10);
    const isPast = dayDateStr < todayStr;
    const isToday = dayDateStr === todayStr;
    const isFuture = dayDateStr > todayStr;

    const simulatedExerciseStatuses: string[] = [];

    for (const ex of day.scheduledExercises) {
      const hasPerformance = ex.performanceResults && ex.performanceResults.length > 0;
      let targetExStatus: string = ex.status;

      if (hasPerformance) {
        targetExStatus = "completed";
      } else if (ex.status === "cancelled") {
        targetExStatus = "cancelled";
      } else if (isPast) {
        if (ex.status !== "completed") {
          targetExStatus = "skipped";
        }
      } else if (isToday) {
        if (ex.status === "skipped") {
          targetExStatus = "pending";
        }
      } else if (isFuture) {
        if (ex.status === "skipped" || ex.status === "in_progress") {
          targetExStatus = "pending";
        }
      }

      if (targetExStatus !== ex.status) {
        if (targetExStatus === "skipped") exercisesToSkipped.push(ex.id);
        else if (targetExStatus === "pending") exercisesToPending.push(ex.id);
        else if (targetExStatus === "completed") exercisesToCompleted.push(ex.id);
      }

      simulatedExerciseStatuses.push(targetExStatus);
    }

    let targetDayStatus: string = day.status;

    if (day.status === "cancelled") {
      targetDayStatus = "cancelled";
    } else {
      const totalExercises = simulatedExerciseStatuses.length;
      const completedExercises = simulatedExerciseStatuses.filter((s) => s === "completed").length;
      const inProgressExercises = simulatedExerciseStatuses.filter((s) => s === "in_progress").length;
      const allCompleted = totalExercises > 0 && completedExercises === totalExercises;

      if (allCompleted) {
        targetDayStatus = "completed";
      } else if (isPast) {
        if (day.status !== "completed") {
          targetDayStatus = "skipped";
        }
      } else if (isToday) {
        if (completedExercises > 0 || inProgressExercises > 0) {
          targetDayStatus = "in_progress";
        } else {
          if (day.status === "skipped") {
            targetDayStatus = "pending";
          }
        }
      } else if (isFuture) {
        if (day.status === "skipped" || day.status === "in_progress") {
          targetDayStatus = "pending";
        }
      }
    }

    if (targetDayStatus !== day.status) {
      if (targetDayStatus === "skipped") daysToSkipped.push(day.id);
      else if (targetDayStatus === "completed") daysToCompleted.push(day.id);
      else if (targetDayStatus === "pending") daysToPending.push(day.id);
      else if (targetDayStatus === "in_progress") daysToInProgress.push(day.id);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (exercisesToSkipped.length > 0) {
      await tx.scheduledExercise.updateMany({
        where: { id: { in: exercisesToSkipped } },
        data: { status: "skipped", updatedAt: now, ...(actorId ? { updatedBy: actorId } : {}) }
      });
    }
    if (exercisesToPending.length > 0) {
      await tx.scheduledExercise.updateMany({
        where: { id: { in: exercisesToPending } },
        data: { status: "pending", updatedAt: now, ...(actorId ? { updatedBy: actorId } : {}) }
      });
    }
    if (exercisesToCompleted.length > 0) {
      await tx.scheduledExercise.updateMany({
        where: { id: { in: exercisesToCompleted } },
        data: { status: "completed", updatedAt: now, ...(actorId ? { updatedBy: actorId } : {}) }
      });
    }

    if (daysToSkipped.length > 0) {
      await tx.rehabilitationScheduleDay.updateMany({
        where: { id: { in: daysToSkipped } },
        data: { status: "skipped", updatedAt: now, ...(actorId ? { updatedBy: actorId } : {}) }
      });
    }
    if (daysToCompleted.length > 0) {
      await tx.rehabilitationScheduleDay.updateMany({
        where: { id: { in: daysToCompleted } },
        data: { status: "completed", updatedAt: now, ...(actorId ? { updatedBy: actorId } : {}) }
      });
    }
    if (daysToPending.length > 0) {
      await tx.rehabilitationScheduleDay.updateMany({
        where: { id: { in: daysToPending } },
        data: { status: "pending", updatedAt: now, ...(actorId ? { updatedBy: actorId } : {}) }
      });
    }
    if (daysToInProgress.length > 0) {
      await tx.rehabilitationScheduleDay.updateMany({
        where: { id: { in: daysToInProgress } },
        data: { status: "in_progress", updatedAt: now, ...(actorId ? { updatedBy: actorId } : {}) }
      });
    }

    if (plansToComplete.length > 0) {
      // status: "active" guard so a plan a therapist cancelled/completed while
      // this sync was running is never flipped back.
      await tx.patientRehabilitationPlan.updateMany({
        where: { id: { in: plansToComplete }, status: "active" },
        data: { status: "completed", updatedAt: now, ...(actorId ? { updatedBy: actorId } : {}) }
      });
    }
  });

  const updatedDaysCount =
    daysToSkipped.length + daysToCompleted.length + daysToPending.length + daysToInProgress.length;
  const updatedExercisesCount =
    exercisesToSkipped.length + exercisesToPending.length + exercisesToCompleted.length;
  const updatedPlansCount = plansToComplete.length;

  return {
    success: true,
    message:
      `Synchronized ${updatedDaysCount} schedule day(s) and ${updatedExercisesCount} scheduled exercise(s) for reference date ${todayStr}.` +
      (updatedPlansCount > 0
        ? ` Completed ${updatedPlansCount} plan(s) past their end date.`
        : ""),
    today: todayStr,
    updatedDaysCount,
    updatedExercisesCount,
    updatedPlansCount,
    summary: {
      daysSkipped: daysToSkipped.length,
      daysCompleted: daysToCompleted.length,
      daysPending: daysToPending.length,
      daysInProgress: daysToInProgress.length,
      exercisesSkipped: exercisesToSkipped.length,
      exercisesPending: exercisesToPending.length,
      exercisesCompleted: exercisesToCompleted.length,
      plansCompleted: updatedPlansCount
    }
  };
}


