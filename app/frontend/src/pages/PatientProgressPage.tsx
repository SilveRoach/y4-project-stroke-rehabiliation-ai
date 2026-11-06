import { Award, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import { useProfilePicture } from "../hooks/useProfilePicture";
import { ApiError, getPatientPlans } from "../services/api";
import { useAuth } from "../store/authStore";
import { initialsFromName, timeOfDayGreeting } from "../utils/displayName";
import { trackingIcon } from "./ProgramEditorPage";
import { ProgressRing } from "./PatientTodayPage";
import { buildMonthCalendar, planMonthRange } from "./PatientDetailPage";
import { currentDayIndex, dayDateLabel, ISO_DATE_RE } from "../utils/rehabPlan";
import type {
  HeatmapDayStatus,
  PatientRehabPlan,
  RehabPlanStatus,
  ScheduledExercise,
  ScheduledExerciseStatus
} from "../types";
import { formatTargetValue as sharedFormatTargetValue } from "../utils/targetValue";

// Patient Progress page (sidebar/bottom-nav "Progress").
// Fetches live rehabilitation plans, schedule days, and performance results
// for the authenticated patient via GET /api/v1/patients/:patientId/plans.
// Calculates real completion rate, average score from recorded attempts,
// and a day-by-day calendar heatmap. All patient-facing copy is Thai.

interface PatientProgressPageProps {
  onLogout: () => void;
  onNavigate: (label: PatientNavLabel) => void;
}

const heatmapLabels: Record<HeatmapDayStatus, string> = {
  completed: "เสร็จสิ้น",
  in_progress: "กำลังฝึก",
  skipped: "พลาด",
  pending: "รอดำเนินการ",
  cancelled: "ไม่มีการฝึก"
};

const planStatusLabels: Record<RehabPlanStatus, string> = {
  draft: "แบบร่าง",
  active: "ใช้งานอยู่",
  paused: "พักไว้",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก"
};

const exerciseStatusLabels: Record<ScheduledExerciseStatus, string> = {
  pending: "ยังไม่เริ่ม",
  in_progress: "กำลังฝึก",
  completed: "ฝึกแล้ว",
  skipped: "ไม่ได้ฝึก",
  cancelled: "ยกเลิก"
};

const exerciseStatusBadgeClass: Record<ScheduledExerciseStatus, string> = {
  completed: "good",
  in_progress: "fair",
  pending: "poor",
  skipped: "poor",
  cancelled: "poor"
};

// Mirrors backend session.service.ts's `targetValueLabel()`. Turns a raw JSON
// target value (which Prisma returns as a JS object/array/primitive/null) into
// a human-readable string. Without this, JSON objects produce "[object Object]".
const formatTargetValue = sharedFormatTargetValue;

// Thai plan-period label for the calendar footnote (e.g. "กันยายน – ตุลาคม 2026",
// or "14 วัน" for a plan with no date anchor). PatientDetailPage's own
// calendarPeriodLabel() is left as-is because the therapist-facing Schedule card
// still uses it in English — this page is Thai, so it formats its own.
function thaiPeriodLabel(plan: PatientRehabPlan): string {
  const monthYear = (date: Date): string =>
    date.toLocaleDateString("th-TH-u-ca-gregory", { month: "long", year: "numeric" });
  if (!ISO_DATE_RE.test(plan.startDateLabel)) return `${plan.heatmap.length} วัน`;
  const start = new Date(`${plan.startDateLabel}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + plan.heatmap.length - 1);
  const startLabel = monthYear(start);
  const endLabel = monthYear(end);
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

function mapServerPlans(serverPlans: any[]): PatientRehabPlan[] {
  return serverPlans.map((sp: any) => {
    const firstScheduleDate = sp.scheduleDays?.[0]?.scheduledDate
      ? sp.scheduleDays[0].scheduledDate.slice?.(0, 10) ?? new Date(sp.scheduleDays[0].scheduledDate).toISOString().slice(0, 10)
      : "";
    const start = sp.startDate
      ? sp.startDate.slice?.(0, 10) ?? new Date(sp.startDate).toISOString().slice(0, 10)
      : firstScheduleDate;
    const end = sp.endDate
      ? sp.endDate.slice?.(0, 10) ?? new Date(sp.endDate).toISOString().slice(0, 10)
      : "";
    const days = (sp.scheduleDays || []).map((sd: any) => ({
      id: sd.id,
      dateLabel: sd.scheduledDate
        ? sd.scheduledDate.slice?.(0, 10) ?? new Date(sd.scheduledDate).toISOString().slice(0, 10)
        : undefined,
      status: sd.status,
      therapistNote: sd.therapistNote ?? undefined,
      exercises: (sd.scheduledExercises || []).map((ex: any): ScheduledExercise => ({
        id: ex.id,
        exerciseLibraryId: ex.exerciseLibraryId,
        exerciseName: ex.exerciseLibrary?.name ?? ex.exerciseName ?? (ex.exerciseLibraryId ?? ""),
        versionLabel:
          ex.exerciseLibrary?.versionNumber != null ? `v${ex.exerciseLibrary.versionNumber}` : (ex.versionLabel ?? undefined),
        movementTracking: ex.exerciseLibrary?.movementTracking ?? ex.movementTracking ?? "none",
        orderNumber: ex.orderNumber ?? 0,
        targetType: ex.targetType ?? "repetitions",
        targetValueLabel: formatTargetValue(ex.targetValue),
        difficultyLevel: ex.exerciseLibrary?.difficultyLevel ?? ex.difficultyLevel ?? undefined,
        therapistInstruction: ex.therapistInstruction ?? undefined,
        status: ex.status ?? "pending",
        performanceResults: ex.performanceResults ?? []
      }))
    }));
    const heatmap = (sp.scheduleDays || []).map((sd: any) => sd.status as HeatmapDayStatus);
    return {
      id: sp.id,
      name: sp.name,
      description: sp.description ?? undefined,
      status: sp.status,
      startDateLabel: start,
      endDateLabel: end || undefined,
      heatmap,
      days
    } as PatientRehabPlan;
  });
}

function computePlanAverageScore(plan: PatientRehabPlan): number | null {
  const scores: number[] = [];
  for (const day of plan.days) {
    for (const exercise of day.exercises) {
      if (exercise.performanceResults && exercise.performanceResults.length > 0) {
        const latest = exercise.performanceResults.reduce<any>(
          (result, candidate) => (!result || candidate.attemptNumber > result.attemptNumber ? candidate : result),
          null
        );
        const score = latest?.finalScore ?? latest?.ptScore ?? latest?.aiScore;
        if (score !== null && score !== undefined) {
          const num = typeof score === "number" ? score : Number(score);
          if (!Number.isNaN(num)) scores.push(num);
        }
      }
    }
  }
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

export function PatientProgressPage({ onLogout, onNavigate }: PatientProgressPageProps) {
  const { token, user } = useAuth();
  const [plans, setPlans] = useState<PatientRehabPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Server-computed name from GET /patients/:id/plans — the same source of
  // truth PatientTodayPage uses via /patients/:id/today. The auth-store user
  // carries no displayName for patients (patient login returns only
  // id/role/phone/name fields), which is why these pages used to show a bare
  // "Patient" where the name should be.
  const [serverPatient, setServerPatient] = useState<{ displayName: string; avatarInitials: string; profilePictureFileId?: string | null } | null>(null);

  // Same fallback chain as PatientTodayPage: server name first, then whatever
  // the auth store has, then the generic label.
  const displayName = serverPatient?.displayName ?? user?.displayName ?? user?.username ?? "ผู้ป่วย";
  const avatarInitials = serverPatient?.avatarInitials ?? initialsFromName(displayName);
  const avatarUrl = useProfilePicture(token, serverPatient?.profilePictureFileId ?? null);

  useEffect(() => {
    if (!token || !user) {
      setLoading(false);
      setError("กรุณาเข้าสู่ระบบอีกครั้งเพื่อดูความก้าวหน้า");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getPatientPlans(token, user.id, ["active", "completed"])
      .then((res) => {
        if (!cancelled) {
          const mapped = mapServerPlans(res.plans || []);
          setPlans(mapped);
          setServerPatient(res.patient ?? null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "โหลดข้อมูลความก้าวหน้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user, reloadKey]);

  // The API supplies only active and completed plans for this page. "All"
  // shows both statuses; a specific plan id scopes the page to that plan.
  const [selectedPlanId, setSelectedPlanId] = useState<"all" | string>("all");

  // Reset back to "All Plans" if the selected plan disappears (e.g. a
  // therapist completed/cancelled it) rather than showing an empty page.
  useEffect(() => {
    if (selectedPlanId !== "all" && !plans.some((plan) => plan.id === selectedPlanId)) setSelectedPlanId("all");
  }, [plans, selectedPlanId]);

  // "All" shows every plan returned by the status-filtered API.
  const visiblePlans =
    selectedPlanId === "all"
      ? plans
      : plans.filter((plan) => plan.id === selectedPlanId);

  return (
    <section className="therapist-shell">
      <PatientSidebar
        activeLabel="Progress"
        onNavigate={onNavigate}
        onLogout={onLogout}
        displayName={displayName}
        avatarInitials={avatarInitials}
        avatarUrl={avatarUrl}
      />

      <div className="therapist-workspace">
        {/* Compact mobile-friendly header, reusing PatientTodayPage's pt-topbar
            chrome (avatar + greeting) instead of the wide therapist-topbar whose
            two-column profile block wastes phone space. */}
        <header className="pt-topbar">
          <div className="pt-identity">
            <span className={`avatar-badge pt-avatar${avatarUrl ? " with-photo" : ""}`}>
              {avatarUrl ? <img src={avatarUrl} alt={`รูปโปรไฟล์ของ ${displayName}`} /> : avatarInitials}
            </span>
            <div><p className="pt-greeting">{timeOfDayGreeting()}</p><h1>{displayName}</h1></div>
          </div>
        </header>

        <main className="therapist-main patient-page-main">
          {loading ? (
            <div className="summary-card">
              <p className="pd-empty-note">กำลังโหลดข้อมูลความก้าวหน้า…</p>
            </div>
          ) : error ? (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)" }}>
              <p className="pd-empty-note" style={{ color: "var(--danger, #d33)" }}>{error}</p>
              <button
                type="button"
                className="secondary-button"
                style={{ marginTop: 12 }}
                onClick={() => setReloadKey((k) => k + 1)}
              >
                ลองใหม่
              </button>
            </div>
          ) : visiblePlans.length === 0 ? (
            <div className="summary-card">
              <p className="pd-empty-note">ยังไม่มีแผนการฟื้นฟูที่ใช้งานอยู่ — ดูประวัติการฝึกสำหรับแผนที่ผ่านมา</p>
            </div>
          ) : (
            <PlanProgress
              plans={visiblePlans}
              allPlans={plans}
              selectedPlanId={selectedPlanId}
              onSelectPlan={setSelectedPlanId}
            />
          )}
        </main>
      </div>

      <PatientBottomNav activeLabel="Progress" onNavigate={onNavigate} />
    </section>
  );
}

function PlanProgress({
  plans,
  allPlans,
  selectedPlanId,
  onSelectPlan
}: {
  plans: PatientRehabPlan[];
  allPlans: PatientRehabPlan[];
  selectedPlanId: "all" | string;
  onSelectPlan: (planId: "all" | string) => void;
}) {
  // All-Plans view = more than one plan is visible. Group headers (plan name
  // above each plan's section) only make sense in that combined view.
  const showAll = selectedPlanId === "all" && plans.length > 1;

  // Aggregated figures across every visible plan for the hero + stats.
  const totalDays = plans.reduce((sum, plan) => sum + plan.days.length, 0);
  const totalCompletedDays = plans.reduce(
    (sum, plan) => sum + plan.days.filter((day) => day.status === "completed").length,
    0
  );
  const completionPercent = totalDays > 0 ? Math.round((totalCompletedDays / totalDays) * 100) : 0;
  const scores = plans
    .map((plan) => computePlanAverageScore(plan))
    .filter((score): score is number => score !== null);
  const averageScore = scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;

  // ONE schedule display for the whole page: in All-Plans view the visible
  // plans are merged into a single combined plan (by calendar date where every
  // plan is dated, otherwise by day order), so the page never shows more than
  // one calendar at a time.
  const displayPlan = showAll ? mergePlansForAllView(plans) : plans[0];

  return (
    <>
      {allPlans.length > 1 && (
        // Dropdown plan switcher — always occupies the same single row at the
        // top of the page regardless of how many plans exist (the old chip row
        // could overflow/wrap on phones). "All Plans" is the default and merges
        // every visible plan into ONE shared calendar below.
        <select
          className="pp-plan-switcher"
          value={selectedPlanId}
          onChange={(event) => onSelectPlan(event.target.value)}
          aria-label="เลือกแผนการฟื้นฟู"
        >
          <option value="all">ทุกแผน</option>
          {allPlans.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      )}

      {/* Compact hero (Today page's pt-hero-block/hero-progress-card idiom):
          a small progress ring + days-done copy. In All-Plans view the ring
          shows aggregate completion across every visible plan. */}
      <div className="pt-hero-block">
        <section className="today-main-panel hero-progress-card">
          <div className="pt-hero-left">
            <ProgressRing value={completionPercent} label={`${completionPercent}%`} size={46} />
            <div className="pt-hero-copy">
              <strong>เสร็จแล้ว {totalCompletedDays}/{totalDays} วัน</strong>
              <span>{showAll ? `${plans.length} แผนที่ใช้งานอยู่` : plans[0].name}</span>
            </div>
          </div>
          {showAll ? (
            <span className="badge-pill good">ทุกแผน</span>
          ) : (
            plans[0] && <span className={`pd-program-status ${plans[0].status}`}>{planStatusLabels[plans[0].status]}</span>
          )}
        </section>
      </div>

      {/* ONE shared calendar + schedule section for whichever plan (or merged
          set of plans) is selected in the dropdown above. */}
      <PlanSection plan={displayPlan} />

      {/* Combined summary stat card — Avg Score + Completed Days side by side
          in one card at the bottom of the page (moved down from the two-up
          pt-stats-grid that sat under the hero). */}
      <div className="summary-card pp-summary-stats">
        <div className="pp-summary-stat">
          <span className="pt-stat-icon avg"><Award size={18} /></span>
          <div className="pt-stat-body">
            <span className="pt-stat-label">คะแนนเฉลี่ย</span>
            <strong>
              {averageScore !== null ? averageScore : "—"}{averageScore !== null ? "%" : ""}{" "}
              <TrendingUp size={14} className="pt-stat-trend" />
            </strong>
          </div>
        </div>
        <div className="pp-summary-stat">
          <span className="pt-stat-icon plan"><CalendarDays size={18} /></span>
          <div className="pt-stat-body">
            <span className="pt-stat-label">วันที่ฝึกสำเร็จ</span>
            <strong>
              {totalCompletedDays} <small>จาก {totalDays}</small>
            </strong>
          </div>
        </div>
      </div>
    </>
  );
}

// Merge several plans into one combined plan-like object for the All-Plans
// view, so the page can drive a single calendar. Days are merged by calendar
// date when every day carries a valid ISO date (plans scheduled on different
// dates align correctly); otherwise they're merged by index order. Day status
// aggregates: completed/cancelled only when every plan agrees, otherwise
// in_progress > skipped > pending wins.
type TaggedExercise = ScheduledExercise & { planName?: string };

function aggregateDayStatus(statuses: Array<HeatmapDayStatus | undefined>): HeatmapDayStatus {
  const present = statuses.filter(Boolean) as HeatmapDayStatus[];
  if (present.length === 0) return "pending";
  if (present.every((status) => status === "completed")) return "completed";
  if (present.every((status) => status === "cancelled")) return "cancelled";
  if (present.some((status) => status === "in_progress")) return "in_progress";
  if (present.some((status) => status === "skipped")) return "skipped";
  return "pending";
}

function mergePlansForAllView(plans: PatientRehabPlan[]): PatientRehabPlan {
  if (plans.length === 1) return plans[0];
  const fullyDated = plans.every((plan) => plan.days.every((day) => day.dateLabel && ISO_DATE_RE.test(day.dateLabel)));

  if (fullyDated) {
    const dateKeys: string[] = [];
    const byDate = new Map<string, { statuses: HeatmapDayStatus[]; exercises: TaggedExercise[] }>();
    plans.forEach((plan) => {
      plan.days.forEach((day) => {
        if (!day.dateLabel) return;
        let bucket = byDate.get(day.dateLabel);
        if (!bucket) {
          bucket = { statuses: [], exercises: [] };
          byDate.set(day.dateLabel, bucket);
          dateKeys.push(day.dateLabel);
        }
        bucket.statuses.push(day.status);
        bucket.exercises.push(
          ...day.exercises.map(
            (exercise): TaggedExercise => ({
              ...exercise,
              id: `${plan.id}:${exercise.id}`,
              planName: plan.name
            })
          )
        );
      });
    });
    dateKeys.sort();
    const days = dateKeys.map((date, index) => {
      const bucket = byDate.get(date)!;
      return {
        id: `merged-${date}`,
        dateLabel: date,
        status: aggregateDayStatus(bucket.statuses),
        exercises: bucket.exercises
      };
    });
    const dates = plans.flatMap((plan) => plan.days.map((day) => day.dateLabel!)).sort();
    return {
      id: "all",
      name: "ทุกแผน",
      status: "active",
      startDateLabel: dates[0] ?? plans[0].startDateLabel,
      endDateLabel: dateKeys[dateKeys.length - 1],
      heatmap: days.map((day) => day.status),
      days
    };
  }

  // Fallback for plans without ISO dates (or mixed): merge by day index.
  const maxLen = plans.reduce((max, plan) => Math.max(max, plan.days.length), 0);
  const days = Array.from({ length: maxLen }, (_, index) => {
    const statuses = plans.map((plan) => plan.days[index]?.status).filter(Boolean) as HeatmapDayStatus[];
    const exercises = plans.flatMap((plan) =>
      (plan.days[index]?.exercises ?? []).map(
        (exercise): TaggedExercise => ({
          ...exercise,
          id: `${plan.id}:${exercise.id}`,
          planName: plan.name
        })
      )
    );
    const datedLabel = plans.map((plan) => plan.days[index]?.dateLabel).find((label) => label && ISO_DATE_RE.test(label));
    return {
      id: `merged-${index}`,
      dateLabel: datedLabel ?? undefined,
      status: aggregateDayStatus(statuses),
      exercises
    };
  });
  const startCandidates = plans.map((plan) => plan.startDateLabel).filter((label) => ISO_DATE_RE.test(label)).sort();
  return {
    id: "all",
    name: "ทุกแผน",
    status: "active",
    startDateLabel: startCandidates[0] ?? plans[0]?.startDateLabel ?? "",
    heatmap: days.map((day) => day.status),
    days
  };
}

// The page's single schedule section: month-navigable calendar, selected
// day's exercises, and upcoming days — driven by whichever plan (or the
// merged All-Plans combination) is selected in the dropdown.
function PlanSection({ plan }: { plan: PatientRehabPlan }) {
  const todayIndex = currentDayIndex(plan.days);
  // Viewed month ("YYYY-MM"); null = follow the plan's start month, the same
  // convention PatientDetailPage's calendar uses (resets when the plan changes).
  const [viewMonthKey, setViewMonthKey] = useState<string | null>(null);
  // Clicked calendar day (index into plan.days); null = the current program day.
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);

  // Switching plans resets both the viewed month and the day selection so the
  // section always opens on the new plan's start month / current day.
  useEffect(() => {
    setViewMonthKey(null);
    setSelectedDayIndex(null);
  }, [plan.id]);

  // Month-navigable schedule calendar, built on PatientDetailPage's exported
  // month-grid helpers: a full Sun-first 6-row grid with adjacent-month and
  // out-of-plan days shadowed out. Navigation remains available even when the
  // viewed month has no scheduled plan days.
  const monthRange = planMonthRange(plan);
  // Opening the section lands on TODAY's month (not the plan's start month) so
  // the current/in-progress day is visible immediately; falls back to the plan's
  // first month when today lies outside the plan's range.
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayMonthKey = todayIso.slice(0, 7);
  const effectiveMonthKey =
    viewMonthKey ?? (todayMonthKey >= monthRange.min && todayMonthKey <= monthRange.max ? todayMonthKey : monthRange.min);
  // Today's own day reads as in-progress (yellow) while its exercises aren't
  // all completed yet — same semantics as the Today page's calendars.
  const monthCells = buildMonthCalendar(plan, effectiveMonthKey).map((cell) =>
    cell.iso === todayIso &&
    cell.dayIndex !== null &&
    cell.status === "pending" &&
    (plan.days[cell.dayIndex]?.exercises.length ?? 0) > 0
      ? { ...cell, status: "in_progress" as HeatmapDayStatus }
      : cell
  );
  const monthLabel = (() => {
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("th-TH-u-ca-gregory", { month: "long", year: "numeric" });
  })();
  const prevMonthKey = (() => {
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const nextMonthKey = (() => {
    const [y, m] = effectiveMonthKey.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  })();

  // The exercises card follows the selected calendar day, falling back to the
  // current program day — the same tap-to-inspect interaction as
  // PatientHistoryPage's clickable calendar.
  const viewIndex = selectedDayIndex !== null && plan.days[selectedDayIndex] ? selectedDayIndex : todayIndex;
  const viewDay = plan.days[viewIndex] ?? { status: "pending" as HeatmapDayStatus, exercises: [] };

  return (
    <>
      {plan.description && (
        <p className="pp-plan-description">{plan.description}</p>
      )}

      <div className="pp-calendar-exercise-grid">
      <div className="summary-card">
        <div className="pd-calendar-header">
          <button
            type="button"
            className="icon-button pd-calendar-nav"
            onClick={() => setViewMonthKey(prevMonthKey)}
            aria-label="เดือนก่อนหน้า"
          >
            <ChevronLeft size={14} />
          </button>
          <strong>{monthLabel}</strong>
          <button
            type="button"
            className="icon-button pd-calendar-nav"
            onClick={() => setViewMonthKey(nextMonthKey)}
            aria-label="เดือนถัดไป"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="pd-calendar-weekdays">
          {["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."].map((day, index) => (
            <span key={index}>{day}</span>
          ))}
        </div>
        <div className="pd-calendar-grid">
          {monthCells.map((cell) => {
            // Same cell-classification rules as PatientDetailPage's schedule
            // calendar: scheduled days keep their status color even in
            // adjacent-month cells (softened by .adjacent), everything else is
            // shadowed out. Tapping a scheduled day selects it below.
            const hasPlanDay = cell.dayIndex !== null && cell.status !== null;
            const className = [
              "pd-calendar-cell",
              hasPlanDay ? cell.status : "",
              hasPlanDay && cell.otherMonth ? "adjacent" : "",
              !hasPlanDay ? (cell.otherMonth ? "other" : cell.outside ? "outside" : "empty") : "",
              cell.dayIndex !== null ? "clickable" : "",
              cell.dayIndex !== null && cell.dayIndex === (selectedDayIndex ?? todayIndex) ? "selected" : ""
            ].join(" ").trim();
            return (
              <button
                key={cell.key}
                type="button"
                className={className}
                title={
                  hasPlanDay
                    ? `${cell.iso} · ${heatmapLabels[cell.status!]}${cell.otherMonth ? " (เดือนก่อนหน้า/ถัดไป)" : ""}`
                    : cell.otherMonth
                      ? undefined
                      : `${cell.iso}${cell.outside ? " · ไม่มีตารางฝึก" : ""}`
                }
                onClick={() => cell.dayIndex !== null && setSelectedDayIndex(cell.dayIndex)}
              >
                {cell.dateNumber ?? ""}
              </button>
            );
          })}
        </div>
        <div className="pd-legend">
          {(["completed", "in_progress", "skipped", "pending", "cancelled"] as HeatmapDayStatus[]).map((status) => (
            <span key={status}>
              <span className={`pd-legend-dot ${status}`} />
              {heatmapLabels[status]}
            </span>
          ))}
        </div>
        <p className="pp-calendar-footnote">
          {thaiPeriodLabel(plan)} &middot; วันที่ {todayIndex + 1} จาก {plan.days.length}
          {selectedDayIndex !== null && (
            <>
              {" "}
              <button type="button" className="text-action" onClick={() => setSelectedDayIndex(null)}>
                กลับไปวันนี้
              </button>
            </>
          )}
        </p>
      </div>

      <div className="summary-card">
        <p className="eyebrow">
          ท่าบริหารของ {dayDateLabel(plan, viewIndex)}
          {viewIndex === todayIndex && <span className="next-pill">วันนี้</span>}
        </p>
        {viewDay.exercises.length === 0 ? (
          <p className="pd-empty-note">ไม่มีการฝึกที่กำหนดไว้สำหรับวันนี้</p>
        ) : (
          // Compact exercise-card list (PatientTodayPage's mobile idiom) —
          // replaces the 5-column therapist-table that required horizontal
          // scrolling on phones. Icon color follows the exercise's tracking
          // type, and the right-side status dot/badge mirrors Today's rows.
          <div className="exercise-list" aria-label="ท่าบริหารของวันที่เลือก">
            {viewDay.exercises.map((exercise) => {
              const Icon = trackingIcon[exercise.movementTracking];
              const isDone = exercise.status === "completed";
              return (
                <div className={`exercise-card${isDone ? " done" : ""}`} key={exercise.id}>
                  <span className={`exercise-icon ${isDone ? "done" : `tracking-${exercise.movementTracking}`}`} aria-hidden="true">
                    {isDone ? <CheckCircle2 size={22} /> : <Icon size={22} />}
                  </span>
                  <span className="exercise-card-body">
                    <span className="exercise-card-title-row">
                    {/* Exercise name only — version ("v1") and difficulty labels
                        removed for a cleaner mobile row; long names truncate
                        with an ellipsis (see .exercise-card-title-row strong). */}
                    <strong>{exercise.exerciseName}</strong>
                  </span>
                  <small>
                    {exercise.targetValueLabel || "ไม่ระบุ"}
                    {(exercise as TaggedExercise).planName
                      ? ` · ${(exercise as TaggedExercise).planName}`
                      : ""}
                  </small>
                  </span>
                  <span className={`badge-pill ${exerciseStatusBadgeClass[exercise.status]}`}>
                    {exerciseStatusLabels[exercise.status]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>

    </>
  );
}
