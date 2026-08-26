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

export interface AdminDashboardData {
  stats: AdminDashboardStats;
  weeklyActivity: WeeklyActivityPoint[];
  roleDistribution: RoleCount[];
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

export async function getAdminDashboard(): Promise<AdminDashboardData> {
  const [stats, weeklyActivity, roleDistribution] = await Promise.all([
    computeStats(),
    computeWeeklyActivity(),
    computeRoleDistribution()
  ]);

  return { stats, weeklyActivity, roleDistribution };
}
